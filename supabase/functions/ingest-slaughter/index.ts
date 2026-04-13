// @ts-nocheck
// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getServiceClient } from '../_shared/supabase-client.ts';
import { writeIngestionLog, sha256Deno } from '../_shared/log.ts';

const QUICK_STATS_URL = 'https://quickstats.nass.usda.gov/api/api_GET/';
const SOURCE = 'usda_slaughter';

type QuickStatsRow = {
  Value?: string;
  year?: string;
  week_ending?: string;
  reference_period_desc?: string;
  class_desc?: string;
  short_desc?: string;
};

type QuickStatsResponse = {
  data?: QuickStatsRow[];
  error?: string[];
};

function parseHead(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = value.replace(/,/g, '').trim();
  if (!normalized || normalized === '(D)' || normalized === '(Z)') return null;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) ? parsed : null;
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
  matcher: (cls: string) => boolean
): QuickStatsRow | undefined {
  return rows.find((row) => {
    const cls = row.class_desc?.toUpperCase() ?? '';
    return matcher(cls);
  });
}

serve(async (_req: Request) => {
  const supabase = getServiceClient();
  let sourceHash: string | null = null;

  try {
    const apiKey = Deno.env.get('NASS_API_KEY');
    if (!apiKey) throw new Error('NASS_API_KEY not set');

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

    sourceHash = await sha256Deno(JSON.stringify(payload));

    const { data: existing } = await supabase
      .from('slaughter_weekly')
      .select('id')
      .eq('source_hash', sourceHash)
      .single();

    if (existing) {
      await writeIngestionLog({ source: SOURCE, source_hash: sourceHash, status: 'duplicate', records_inserted: 0 });
      return new Response(JSON.stringify({ status: 'duplicate' }), { status: 200 });
    }

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
      (cls) => cls === 'ALL CLASSES' || cls === 'ALL' || cls === ''
    );
    const cowRow = findByClass(latestRows, (cls) => cls.startsWith('COWS'));
    const bullRow = findByClass(latestRows, (cls) => cls === 'BULLS');

    const steer_count = parseHead(steerRow?.Value);
    const heifer_count = parseHead(heiferRow?.Value);
    if (steer_count === null || heifer_count === null) {
      throw new Error(
        `Missing STEERS or HEIFERS rows in NASS payload for week ${latestWeek}`
      );
    }

    const total_head =
      parseHead(allClassesRow?.Value) ??
      steer_count + heifer_count + (parseHead(cowRow?.Value) ?? 0) + (parseHead(bullRow?.Value) ?? 0);

    if (total_head < 400_000 || total_head > 700_000) {
      throw new Error(`total_head ${total_head} outside valid range [400k–700k]`);
    }

    const fedCattle = steer_count + heifer_count;
    const steer_heifer_ratio = fedCattle > 0 ? steer_count / fedCattle : 0;

    if (steer_heifer_ratio < 0.3 || steer_heifer_ratio > 0.7) {
      throw new Error(
        `steer_heifer_ratio ${steer_heifer_ratio.toFixed(4)} outside valid range [0.3–0.7]`
      );
    }

    const week_ending = new Date(latestWeek).toISOString().split('T')[0];

    const { error } = await supabase.from('slaughter_weekly').insert({
      week_ending,
      total_head,
      steer_count,
      heifer_count,
      steer_heifer_ratio,
      source_hash: sourceHash,
    });

    if (error) throw new Error(`DB insert failed: ${error.message}`);

    await writeIngestionLog({ source: SOURCE, source_hash: sourceHash, status: 'success', records_inserted: 1 });
    return new Response(JSON.stringify({ status: 'success', records_inserted: 1 }), { status: 200 });
  } catch (err: any) {
    await writeIngestionLog({ source: SOURCE, source_hash: sourceHash, status: 'failed', error_message: err.message, records_inserted: 0 });
    return new Response(JSON.stringify({ status: 'failed', error: err.message }), { status: 500 });
  }
});
