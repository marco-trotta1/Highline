// @ts-nocheck
// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getServiceClient } from '../_shared/supabase-client.ts';
import { writeIngestionLog, sha256Deno } from '../_shared/log.ts';
import {
  respondIngestFailure,
  respondIngestSuccess,
} from '../_shared/ingest.ts';

const NASS_ENDPOINT = 'https://quickstats.nass.usda.gov/api/api_GET/';
const SOURCE = 'cold_storage';

const MONTHS: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  SEPT: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};

function buildNassUrl(apiKey: string): string {
  const params = new URLSearchParams({
    key: apiKey,
    commodity_desc: 'BEEF',
    statisticcat_desc: 'STOCKS',
    unit_desc: 'MIL LB',
    freq_desc: 'MONTHLY',
    format: 'JSON',
  });
  return `${NASS_ENDPOINT}?${params.toString()}`;
}

function parseMonth(value: string | null | undefined): number | null {
  if (!value) return null;
  const upper = String(value).toUpperCase();
  for (const [label, month] of Object.entries(MONTHS)) {
    if (upper.includes(label)) return month;
  }
  return null;
}

function parseNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = String(value).replace(/,/g, '').trim();
  if (!normalized || normalized === '(D)' || normalized === '(Z)') return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function latestColdStorageRow(rows: any[]) {
  return rows
    .map((row) => ({
      row,
      year: Number.parseInt(String(row?.year ?? ''), 10),
      month: parseMonth(row?.reference_period_desc),
    }))
    .filter((entry) => Number.isFinite(entry.year) && entry.month !== null)
    .sort((a, b) => {
      if (b.year !== a.year) return b.year - a.year;
      return (b.month ?? 0) - (a.month ?? 0);
    })[0] ?? null;
}

serve(async (_req: Request) => {
  const supabase = getServiceClient();
  let sourceHash: string | null = null;

  try {
    const apiKey = Deno.env.get('NASS_API_KEY');
    if (!apiKey) {
      await writeIngestionLog({
        source: SOURCE,
        source_hash: null,
        status: 'failed',
        error_message: 'NASS_API_KEY not configured',
        records_inserted: 0,
      });
      return new Response(
        JSON.stringify({ status: 'failed', error: 'NASS_API_KEY not configured' }),
        { status: 200 },
      );
    }

    const res = await fetch(buildNassUrl(apiKey), {
      headers: { Accept: 'application/json' },
    });
    const rawText = await res.text();
    if (!res.ok) throw new Error(`NASS API error: ${res.status} ${rawText.slice(0, 500)}`);

    sourceHash = await sha256Deno(rawText);
    const payload = JSON.parse(rawText);
    if (payload.error?.length) {
      throw new Error(`NASS API returned: ${payload.error.join('; ')}`);
    }

    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const latest = latestColdStorageRow(rows);
    if (!latest) throw new Error('NASS API returned no monthly beef cold storage rows');

    const total_beef_million_lbs = parseNumber(latest.row?.Value);
    if (total_beef_million_lbs === null) {
      throw new Error(`Could not parse cold storage Value from latest row: ${latest.row?.Value}`);
    }

    const row = {
      month: latest.month,
      year: latest.year,
      total_beef_million_lbs,
      vs_5yr_avg_pct: null,
      source_hash: sourceHash,
    };

    const { data, error } = await supabase
      .from('cold_storage_monthly')
      .upsert(row, { onConflict: 'source_hash', ignoreDuplicates: true })
      .select('id');

    if (error) throw new Error(`DB insert failed: ${error.message}`);

    return respondIngestSuccess(SOURCE, sourceHash, data?.length ?? 1);
  } catch (err: any) {
    return respondIngestFailure(SOURCE, sourceHash, err);
  }
});
