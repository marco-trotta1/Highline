// @ts-nocheck
// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getServiceClient } from '../_shared/supabase-client.ts';
import { sha256Deno } from '../_shared/log.ts';
import {
  checkSourceHashDuplicate,
  respondIngestFailure,
  respondIngestSuccess,
} from '../_shared/ingest.ts';

const NASS_ENDPOINT = 'https://quickstats.nass.usda.gov/api/api_GET/';
const SOURCE = 'usda_cold_storage';

const MONTH_NAMES: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4,
  may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

function parseMonth(ref: string | undefined | null): number | null {
  if (!ref) return null;
  const lower = String(ref).toLowerCase();
  for (const [name, num] of Object.entries(MONTH_NAMES)) {
    if (lower.includes(name)) return num;
  }
  return null;
}

function rowMonth(row: any): number | null {
  const begin = parseInt(String(row?.begin_code ?? ''), 10);
  if (Number.isFinite(begin) && begin >= 1 && begin <= 12) return begin;
  return parseMonth(row?.reference_period_desc);
}

serve(async (_req: Request) => {
  const supabase = getServiceClient();
  let sourceHash: string | null = null;

  try {
    const apiKey = Deno.env.get('NASS_API_KEY');
    if (!apiKey) throw new Error('NASS_API_KEY not set');

    const currentYear = new Date().getUTCFullYear();
    const params = new URLSearchParams({
      key: apiKey,
      short_desc: 'BEEF, COLD STORAGE, FROZEN - STOCKS, MEASURED IN LB',
      agg_level_desc: 'NATIONAL',
      year__GE: String(currentYear - 2),
      format: 'JSON',
    });

    const url = `${NASS_ENDPOINT}?${params.toString()}`;
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    const rawText = await res.text();
    if (!res.ok) throw new Error(`NASS API error: ${res.status} ${rawText.slice(0, 500)}`);
    sourceHash = await sha256Deno(rawText);

    const payload = JSON.parse(rawText);
    const allRows: any[] = Array.isArray(payload?.data) ? payload.data : [];

    const rows = allRows.filter((r: any) => {
      const sd = String(r?.short_desc ?? '').toUpperCase();
      const cd = String(r?.commodity_desc ?? '').toUpperCase();
      return sd.includes('BEEF') || sd.includes('CATTLE') || cd.includes('BEEF') || cd.includes('CATTLE');
    });

    if (rows.length === 0) throw new Error('No BEEF/CATTLE rows in NASS response');

    rows.sort((a: any, b: any) => {
      const ya = parseInt(String(a?.year ?? '0'), 10);
      const yb = parseInt(String(b?.year ?? '0'), 10);
      if (yb !== ya) return yb - ya;
      const ma = rowMonth(a) ?? 0;
      const mb = rowMonth(b) ?? 0;
      return mb - ma;
    });

    const latest = rows[0];
    const month = rowMonth(latest);
    const year = parseInt(String(latest?.year ?? ''), 10);
    const rawValue = String(latest?.Value ?? '').replace(/,/g, '').trim();
    const valueLbs = parseFloat(rawValue);

    if (month === null) throw new Error(`Could not parse month from latest row: ref=${latest?.reference_period_desc} begin=${latest?.begin_code}`);
    if (!Number.isFinite(year)) throw new Error('Could not parse year from latest row');
    if (!Number.isFinite(valueLbs)) throw new Error('Could not parse Value from latest row');

    const total_beef_million_lbs = parseFloat((valueLbs / 1_000_000).toFixed(4));

    const duplicate = await checkSourceHashDuplicate(
      supabase,
      'cold_storage_monthly',
      SOURCE,
      sourceHash
    );
    if (duplicate) return duplicate;

    const { data: historical } = await supabase
      .from('cold_storage_monthly')
      .select('total_beef_million_lbs')
      .order('year', { ascending: false })
      .order('month', { ascending: false })
      .limit(60);

    let vs_5yr_avg_pct = 0;
    if (historical && historical.length > 0) {
      const avg = historical.reduce((s: number, r: { total_beef_million_lbs: number }) => s + r.total_beef_million_lbs, 0) / historical.length;
      vs_5yr_avg_pct = avg > 0 ? parseFloat((((total_beef_million_lbs - avg) / avg) * 100).toFixed(2)) : 0;
    }

    const { error } = await supabase.from('cold_storage_monthly').insert({
      month,
      year,
      total_beef_million_lbs,
      vs_5yr_avg_pct,
      source_hash: sourceHash,
    });

    if (error) throw new Error(`DB insert failed: ${error.message}`);

    return respondIngestSuccess(SOURCE, sourceHash);
  } catch (err: any) {
    return respondIngestFailure(SOURCE, sourceHash, err);
  }
});
