// @ts-nocheck
// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getServiceClient } from '../_shared/supabase-client.ts';
import { writeIngestionLog, sha256Deno } from '../_shared/log.ts';

const REPORT_ID = '2453';
const SOURCE = 'negotiated';
const THIN_THRESHOLD = 10;

function todayIso(): string {
  return new Date().toISOString().split('T')[0];
}

function buildReportUrl(): string {
  const today = todayIso();
  return `https://marsapi.ams.usda.gov/services/v1.2/reports/${REPORT_ID}?q=report_date_end=${today}&allSections=true`;
}

function parseNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = String(value).replace(/,/g, '').trim();
  if (!normalized || normalized === '(D)' || normalized === '(Z)') return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseInteger(value: string | number | null | undefined): number | null {
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

function parseSession(row: any): 'AM' | 'PM' | null {
  const slug = String(row?.slug_id ?? row?.slug_name ?? row?.report_title ?? '').toLowerCase();
  if (slug.includes('am')) return 'AM';
  if (slug.includes('pm')) return 'PM';
  return null;
}

async function buildRows(payload: any) {
  const rawRows = extractRows(payload);
  const rows = [];

  for (const row of rawRows) {
    const date = formatReportDate(row?.report_date);
    const session = parseSession(row);
    const low = parseNumber(row?.price_low);
    const high = parseNumber(row?.price_high);
    const weighted_avg = parseNumber(row?.wtd_avg);
    const volume_loads = parseInteger(row?.number_of_trades);

    if (!date || !session || weighted_avg === null || volume_loads === null) continue;

    rows.push({
      date,
      session,
      low,
      high,
      weighted_avg,
      volume_loads,
      session_quality: volume_loads >= THIN_THRESHOLD ? 'active' : 'thin',
      source_hash: await sha256Deno(JSON.stringify({ source: SOURCE, row })),
    });
  }

  return rows;
}

serve(async (_req: Request) => {
  const supabase = getServiceClient();
  let sourceHash: string | null = null;

  try {
    const res = await fetch(buildReportUrl(), {
      headers: { Accept: 'application/json' },
    });
    const rawText = await res.text();
    if (!res.ok) throw new Error(`USDA negotiated API error: ${res.status} ${rawText.slice(0, 500)}`);

    sourceHash = await sha256Deno(rawText);
    const payload = JSON.parse(rawText);
    const rows = await buildRows(payload);
    if (rows.length === 0) {
      throw new Error('USDA negotiated API returned no rows with report_date, slug_id, wtd_avg, and number_of_trades');
    }

    const { data, error } = await supabase
      .from('negotiated_sales')
      .upsert(rows, { onConflict: 'source_hash', ignoreDuplicates: true })
      .select('id');

    if (error) throw new Error(`DB insert failed: ${error.message}`);

    const recordsInserted = data?.length ?? rows.length;
    await writeIngestionLog({
      source: SOURCE,
      source_hash: sourceHash,
      status: 'success',
      records_inserted: recordsInserted,
    });
    return new Response(
      JSON.stringify({ status: 'success', records_inserted: recordsInserted }),
      { status: 200 },
    );
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
