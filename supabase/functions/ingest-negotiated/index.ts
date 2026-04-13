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

function formatReportDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = String(value).trim();
  const isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const usMatch = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (usMatch) return `${usMatch[3]}-${usMatch[1]}-${usMatch[2]}`;

  return null;
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
  const detailSection = payload.find((s: any) => s?.reportSection === 'Detail');
  if (!detailSection) throw new Error(`No Detail section in payload (${session})`);

  const allRows: any[] = Array.isArray(detailSection.results) ? detailSection.results : [];
  const rows = allRows.filter((r: any) => {
    const classDesc = String(r?.class_desc ?? '').trim().toUpperCase();
    const sellingBasisDesc = String(r?.selling_basis_desc ?? '').trim().toUpperCase();
    const purchaseTypeCode = String(r?.purchase_type_code ?? '').trim().toUpperCase();
    const gradeDesc = String(r?.grade_desc ?? '').trim().toUpperCase();
    const price = parseNumber(r?.wtd_avg_price);
    const head = parseNumber(r?.head_count);

    return (
      classDesc === 'STEER' &&
      sellingBasisDesc.startsWith('LIVE') &&
      purchaseTypeCode === 'NEGOTIATED CASH' &&
      gradeDesc === 'TOTAL ALL GRADES' &&
      price !== null &&
      head !== null
    );
  });

  if (rows.length === 0) {
    throw new Error(
      `No matching Detail rows for ${session} (STEER, LIVE*, NEGOTIATED CASH, Total all grades)`,
    );
  }

  let totalHead = 0;
  let weightedSum = 0;
  let low: number | null = null;
  let high: number | null = null;

  for (const r of rows) {
    const price = parseNumber(r.wtd_avg_price) as number;
    const head = parseNumber(r.head_count) as number;
    totalHead += head;
    weightedSum += price * head;

    const rLow = parseNumber(r.price_range_low);
    const rHigh = parseNumber(r.price_range_high);
    if (rLow !== null) low = low === null ? rLow : Math.min(low, rLow);
    if (rHigh !== null) high = high === null ? rHigh : Math.max(high, rHigh);
  }

  const weighted_avg = totalHead > 0 ? weightedSum / totalHead : null;
  if (weighted_avg === null) throw new Error(`No total head after filtering (${session})`);

  const reportDate = rows[0].report_date ?? rows[0].slug_date;
  if (!reportDate) throw new Error(`Missing report_date (${session})`);
  const date = formatReportDate(reportDate);
  if (!date) throw new Error(`Unrecognized report_date format "${reportDate}" (${session})`);

  return {
    date,
    session,
    low,
    high,
    weighted_avg,
    volume_loads: Math.round(totalHead / 35),
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

    const snapshots = [
      extractSnapshot(amPayload, 'AM'),
      extractSnapshot(pmPayload, 'PM'),
    ];

    const rows = snapshots
      .map(({ date, session, low, high, weighted_avg, volume_loads }) => {
        if (weighted_avg === null || weighted_avg < 150 || weighted_avg > 400) {
          throw new Error(`${session} weighted_avg ${weighted_avg} outside valid range [$150–$400/cwt]`);
        }
        if (volume_loads === null || volume_loads < 0 || volume_loads > 100000) {
          throw new Error(`${session} volume_loads ${volume_loads} outside valid range [0–100000]`);
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

    const { error } = await supabase
      .from('negotiated_sales')
      .upsert(rows, { onConflict: 'date,session' });
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
