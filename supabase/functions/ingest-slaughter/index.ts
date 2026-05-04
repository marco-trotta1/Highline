// @ts-nocheck
// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getServiceClient } from '../_shared/supabase-client.ts';
import { sha256Deno } from '../_shared/log.ts';
import {
  respondIngestFailure,
  respondIngestSuccess,
} from '../_shared/ingest.ts';

const QUICK_STATS_URL = 'https://quickstats.nass.usda.gov/api/api_GET/';
const MPR_REPORT_ID = '3208';
const SOURCE = 'slaughter';

type QuickStatsRow = {
  Value?: string;
  year?: string;
  week_ending?: string;
  reference_period_desc?: string;
  class_desc?: string;
};

type QuickStatsResponse = {
  data?: QuickStatsRow[];
  error?: string[];
};

function todayIso(): string {
  return new Date().toISOString().split('T')[0];
}

function buildMprUrl(): string {
  return `https://marsapi.ams.usda.gov/services/v1.2/reports/${MPR_REPORT_ID}?q=report_date_end=${todayIso()}`;
}

function parseNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = String(value).replace(/,/g, '').trim();
  if (!normalized || normalized === '(D)' || normalized === '(Z)') return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseHead(value: string | number | null | undefined): number | null {
  const parsed = parseNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function formatReportDate(value: string | number | null | undefined): string | null {
  if (!value) return null;
  const normalized = String(value).trim();
  const isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const usMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usMatch) {
    const month = usMatch[1].padStart(2, '0');
    const day = usMatch[2].padStart(2, '0');
    return `${usMatch[3]}-${month}-${day}`;
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().split('T')[0];
}

function buildQuickStatsUrl(apiKey: string): string {
  const currentYear = new Date().getUTCFullYear();
  const params = new URLSearchParams({
    key: apiKey,
    source_desc: 'SURVEY',
    sector_desc: 'ANIMALS & PRODUCTS',
    group_desc: 'LIVESTOCK',
    commodity_desc: 'CATTLE',
    statisticcat_desc: 'SLAUGHTERED',
    agg_level_desc: 'NATIONAL',
    freq_desc: 'WEEKLY',
    unit_desc: 'HEAD',
    year__GE: String(currentYear - 1),
    format: 'JSON',
  });
  return `${QUICK_STATS_URL}?${params.toString()}`;
}

function rowWeekEnding(row: QuickStatsRow): string | null {
  return row.week_ending ?? row.reference_period_desc ?? null;
}

function findByClass(
  rows: QuickStatsRow[],
  matcher: (cls: string) => boolean,
): QuickStatsRow | undefined {
  return rows.find((row) => matcher(row.class_desc?.toUpperCase() ?? ''));
}

function extractRows(payload: any): any[] {
  if (Array.isArray(payload)) {
    return payload.flatMap((entry) => {
      if (Array.isArray(entry?.results)) return entry.results;
      return entry && typeof entry === 'object' ? [entry] : [];
    });
  }

  if (Array.isArray(payload?.results)) {
    return payload.results.flatMap((entry: any) => {
      if (Array.isArray(entry?.results)) return entry.results;
      return entry && typeof entry === 'object' ? [entry] : [];
    });
  }

  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function buildInsertRow(row: any, sourceHash: string) {
  const week_ending = formatReportDate(row?.report_date);
  const total_head = parseHead(row?.total_slaughter);
  const steer_count = parseHead(row?.steers);
  const heifer_count = parseHead(row?.heifers);

  if (!week_ending || total_head === null || steer_count === null || heifer_count === null) {
    return null;
  }

  return {
    week_ending,
    total_head,
    steer_count,
    heifer_count,
    steer_heifer_ratio: heifer_count > 0
      ? Number((steer_count / heifer_count).toFixed(2))
      : null,
    source_hash: sourceHash,
  };
}

async function fetchMprSlaughterRow() {
  const res = await fetch(buildMprUrl(), { headers: { Accept: 'application/json' } });
  const rawText = await res.text();
  if (!res.ok) throw new Error(`USDA slaughter API error: ${res.status} ${rawText.slice(0, 500)}`);

  const payload = JSON.parse(rawText);
  const rows = extractRows(payload);
  const sourceHash = await sha256Deno(rawText);
  const selected = rows.find((row) => buildInsertRow(row, sourceHash));
  if (!selected) {
    throw new Error('USDA slaughter API returned no row with report_date, total_slaughter, steers, and heifers');
  }

  return buildInsertRow(selected, sourceHash);
}

async function fetchNassSlaughterRow(apiKey: string) {
  const apiRes = await fetch(buildQuickStatsUrl(apiKey), {
    headers: { Accept: 'application/json' },
  });
  if (!apiRes.ok) throw new Error(`NASS Quick Stats error: ${apiRes.status}`);
  const payload = (await apiRes.json()) as QuickStatsResponse;

  if (payload.error?.length) {
    throw new Error(`NASS Quick Stats returned: ${payload.error.join('; ')}`);
  }
  if (!payload.data?.length) {
    throw new Error('NASS Quick Stats returned no rows for weekly cattle slaughter');
  }

  const sourceHash = await sha256Deno(JSON.stringify(payload));
  const latestWeek = payload.data
    .map(rowWeekEnding)
    .filter((w): w is string => !!w)
    .sort()
    .at(-1);

  if (!latestWeek) {
    throw new Error('Could not determine latest week_ending from NASS Quick Stats rows');
  }

  const latestRows = payload.data.filter((row) => rowWeekEnding(row) === latestWeek);
  const steerRow = findByClass(latestRows, (cls) => cls === 'STEERS');
  const heiferRow = findByClass(latestRows, (cls) => cls === 'HEIFERS');
  const allClassesRow = findByClass(
    latestRows,
    (cls) => cls === 'ALL CLASSES' || cls === 'ALL' || cls === '',
  );
  const cowRow = findByClass(latestRows, (cls) => cls.startsWith('COWS'));
  const bullRow = findByClass(latestRows, (cls) => cls === 'BULLS');

  const steer_count = parseHead(steerRow?.Value);
  const heifer_count = parseHead(heiferRow?.Value);
  if (steer_count === null || heifer_count === null) {
    throw new Error(`Missing STEERS or HEIFERS rows in NASS payload for week ${latestWeek}`);
  }

  const total_head =
    parseHead(allClassesRow?.Value) ??
    steer_count + heifer_count + (parseHead(cowRow?.Value) ?? 0) + (parseHead(bullRow?.Value) ?? 0);

  return {
    week_ending: formatReportDate(latestWeek),
    total_head,
    steer_count,
    heifer_count,
    steer_heifer_ratio: heifer_count > 0
      ? Number((steer_count / heifer_count).toFixed(2))
      : null,
    source_hash: sourceHash,
  };
}

serve(async (_req: Request) => {
  const supabase = getServiceClient();
  let sourceHash: string | null = null;

  try {
    const apiKey = Deno.env.get('NASS_API_KEY');
    const row = apiKey
      ? await fetchNassSlaughterRow(apiKey)
      : await fetchMprSlaughterRow();

    if (!row?.week_ending) throw new Error('Could not determine slaughter week_ending');
    sourceHash = row.source_hash;

    const { data, error } = await supabase
      .from('slaughter_weekly')
      .upsert(row, { onConflict: 'source_hash', ignoreDuplicates: true })
      .select('id');

    if (error) throw new Error(`DB insert failed: ${error.message}`);

    return respondIngestSuccess(SOURCE, sourceHash, data?.length ?? 1);
  } catch (err: any) {
    return respondIngestFailure(SOURCE, sourceHash, err);
  }
});
