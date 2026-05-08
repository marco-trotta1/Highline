// @ts-nocheck
// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getServiceClient } from '../_shared/supabase-client.ts';
import { writeIngestionLog, sha256Deno } from '../_shared/log.ts';

const REPORT_ENDPOINTS = {
  AM: 'https://mpr.datamart.ams.usda.gov/services/v1.1/reports/2660?lastReports=1&allSections=true',
  PM: 'https://mpr.datamart.ams.usda.gov/services/v1.1/reports/2661?lastReports=1&allSections=true',
} as const;

const SOURCE = 'usda_negotiated';
const HEAD_PER_LOAD = 38;
const THIN_THRESHOLD = 10;

type NegotiatedSession = keyof typeof REPORT_ENDPOINTS;

function parseNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const normalized = String(value).replace(/,/g, '').trim();
  if (!normalized) return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function requireSection(payload: any[], sectionName: string): any[] {
  const section = payload.find((entry) => entry.reportSection === sectionName);
  if (!section?.results?.length) {
    throw new Error(`USDA negotiated API payload missing section: ${sectionName}`);
  }
  return section.results;
}

function parseIsoDate(value: string | null | undefined, field: string): string {
  if (!value) {
    throw new Error(`USDA negotiated API missing ${field}`);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`USDA negotiated API returned invalid ${field}: ${value}`);
  }

  return parsed.toISOString().split('T')[0];
}

function scoreDetailRow(row: any): number {
  let score = 0;

  if (String(row.purchase_type_code ?? '').toUpperCase() === 'NEGOTIATED CASH') score += 100;
  if (String(row.grade_desc ?? '').toLowerCase() === 'total all grades') score += 50;
  if (parseNumber(row.wtd_avg_price) !== null) score += 20;
  if (parseNumber(row.price_range_low) !== null) score += 10;
  if (String(row.selling_basis_desc ?? '').toUpperCase() === 'LIVE FOB') score += 25;

  const headCount = parseNumber(row.head_count);
  if (headCount !== null) score += headCount;

  return score;
}

function selectRepresentativeDetailRow(rows: any[]): any {
  const candidates = rows.filter(
    (row) =>
      String(row.purchase_type_code ?? '').toUpperCase() === 'NEGOTIATED CASH' &&
      String(row.grade_desc ?? '').toLowerCase() === 'total all grades' &&
      parseNumber(row.wtd_avg_price) !== null,
  );

  const ranked = (candidates.length > 0 ? candidates : rows)
    .filter((row) => String(row.purchase_type_code ?? '').toUpperCase() === 'NEGOTIATED CASH')
    .sort((left, right) => scoreDetailRow(right) - scoreDetailRow(left));

  const winner = ranked[0];
  if (!winner) {
    throw new Error('USDA negotiated API returned no negotiated cash detail rows');
  }

  return winner;
}

function extractSnapshot(payload: any, session: NegotiatedSession, sourceHash: string) {
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error(`USDA negotiated API returned an empty payload for ${session}`);
  }

  const summaryRows = requireSection(payload, 'Summary');
  const detailRows = requireSection(payload, 'Detail');
  const summaryRow =
    summaryRows.find(
      (row) =>
        String(row.purchase_type_desc ?? '').toUpperCase() === 'NEGOTIATED CASH' &&
        String(row.current_period ?? '').toLowerCase() === 'confirmed',
    ) ?? summaryRows[0];

  if (!summaryRow) {
    throw new Error(`USDA negotiated API did not contain a summary row for ${session}`);
  }

  const representativeRow = selectRepresentativeDetailRow(detailRows);
  const low = parseNumber(representativeRow.price_range_low);
  const high = parseNumber(representativeRow.price_range_high);
  const weighted_avg = parseNumber(representativeRow.wtd_avg_price);
  const confirmedHead = parseNumber(summaryRow.current_date_volume);
  const fallbackHead = parseNumber(representativeRow.head_count);
  const volume_loads = Math.round((confirmedHead ?? fallbackHead ?? 0) / HEAD_PER_LOAD);

  if (low === null || high === null || weighted_avg === null) {
    throw new Error(
      `USDA negotiated API detail rows for ${session} did not include low/high/weighted average values`,
    );
  }

  return {
    date: parseIsoDate(String(summaryRow.report_date ?? ''), 'report_date'),
    session,
    low,
    high,
    weighted_avg,
    volume_loads,
    session_quality: volume_loads < THIN_THRESHOLD ? 'thin' : 'active',
    source_hash: sourceHash,
  };
}

async function fetchSnapshot(session: NegotiatedSession) {
  const response = await fetch(REPORT_ENDPOINTS[session], {
    headers: { Accept: 'application/json' },
  });
  const rawText = await response.text();

  if (!response.ok) {
    throw new Error(
      `USDA negotiated API request failed for ${session}: ${response.status} ${rawText.slice(0, 500)}`,
    );
  }

  const sourceHash = await sha256Deno(rawText);
  return extractSnapshot(JSON.parse(rawText), session, sourceHash);
}

serve(async (_req: Request) => {
  const supabase = getServiceClient();
  let sourceHash: string | null = null;

  try {
    const rows = await Promise.all(
      (Object.keys(REPORT_ENDPOINTS) as NegotiatedSession[]).map(fetchSnapshot),
    );
    sourceHash = await sha256Deno(JSON.stringify(rows.map((row) => row.source_hash)));

    const { data, error } = await supabase
      .from('negotiated_sales')
      .upsert(rows, { onConflict: 'date,session' })
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
