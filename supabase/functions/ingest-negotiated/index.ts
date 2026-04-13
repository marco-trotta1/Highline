// @ts-nocheck
// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getServiceClient } from '../_shared/supabase-client.ts';
import { writeIngestionLog, sha256Deno } from '../_shared/log.ts';

// AM Report: LM_CT113, PM Report: LM_CT114
// National Daily Direct Slaughter Cattle Report - Negotiated Purchases
const AM_URL = 'https://mpr.datamart.ams.usda.gov/services/v1.1/reports/2660?lastReports=1&allSections=true';
const PM_URL = 'https://mpr.datamart.ams.usda.gov/services/v1.1/reports/2661?lastReports=1&allSections=true';
const SOURCE = 'usda_negotiated';
const THIN_THRESHOLD = 10;

function parseNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = String(value).replace(/,/g, '').trim();
  if (!normalized) return null;
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchReport(url: string, session: 'AM' | 'PM'): Promise<any[]> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`USDA negotiated API error (${session}): ${res.status}`);
  const payload = await res.json();
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error(`USDA negotiated API returned empty payload (${session})`);
  }
  return payload;
}

function extractSnapshot(payload: any[], session: 'AM' | 'PM') {
  let row: Record<string, any> | null = null;
  for (const section of payload) {
    const hit = section?.results?.find?.((r: any) => r?.weighted_average != null);
    if (hit) { row = hit; break; }
  }
  if (!row) throw new Error(`No row with weighted_average in payload (${session})`);

  const reportDate = row.report_date ?? row.slug_date;
  if (!reportDate) throw new Error(`Missing report_date (${session})`);
  const date = new Date(reportDate).toISOString().split('T')[0];

  return {
    date,
    session,
    low: parseNumber(row.low_price),
    high: parseNumber(row.high_price),
    weighted_avg: parseNumber(row.weighted_average),
    volume_loads: parseNumber(row.volume),
  };
}

serve(async (_req: Request) => {
  const supabase = getServiceClient();
  let sourceHash: string | null = null;

  try {
    const [amPayload, pmPayload] = await Promise.all([
      fetchReport(AM_URL, 'AM'),
      fetchReport(PM_URL, 'PM'),
    ]);

    sourceHash = await sha256Deno(JSON.stringify({ am: amPayload, pm: pmPayload }));

    const { data: existing } = await supabase
      .from('negotiated_sales')
      .select('id')
      .eq('source_hash', sourceHash)
      .single();

    if (existing) {
      await writeIngestionLog({ source: SOURCE, source_hash: sourceHash, status: 'duplicate', records_inserted: 0 });
      return new Response(JSON.stringify({ status: 'duplicate' }), { status: 200 });
    }

    const snapshots = [
      extractSnapshot(amPayload, 'AM'),
      extractSnapshot(pmPayload, 'PM'),
    ];

    const rows = snapshots.map(({ date, session, low, high, weighted_avg, volume_loads }) => {
      if (weighted_avg === null || weighted_avg < 150 || weighted_avg > 400) {
        throw new Error(`${session} weighted_avg ${weighted_avg} outside valid range [$150–$400/cwt]`);
      }
      if (volume_loads === null || volume_loads < 0 || volume_loads > 500) {
        throw new Error(`${session} volume_loads ${volume_loads} outside valid range [0–500]`);
      }
      return {
        date,
        session,
        low,
        high,
        weighted_avg,
        volume_loads,
        session_quality: volume_loads < THIN_THRESHOLD ? 'thin' : 'active',
        source_hash: sourceHash,
      };
    });

    const { error } = await supabase.from('negotiated_sales').insert(rows);
    if (error) throw new Error(`DB insert failed: ${error.message}`);

    await writeIngestionLog({ source: SOURCE, source_hash: sourceHash, status: 'success', records_inserted: rows.length });
    return new Response(JSON.stringify({ status: 'success', records_inserted: rows.length }), { status: 200 });
  } catch (err: any) {
    await writeIngestionLog({
      source: SOURCE,
      source_hash: sourceHash,
      status: 'failed',
      error_message: err.message,
      records_inserted: 0,
    });
    return new Response(JSON.stringify({ status: 'failed', error: err.message }), { status: 500 });
  }
});
