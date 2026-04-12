// @ts-nocheck
// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getServiceClient } from '../_shared/supabase-client.ts';
import { writeIngestionLog, sha256Deno } from '../_shared/log.ts';

const REPORT_URL =
  'https://mpr.datamart.ams.usda.gov/services/v1.1/reports/2453?lastReports=1&allSections=true';
const SOURCE = 'usda_cutout';

function parseNumber(value: string | null | undefined): number | null {
  if (value == null) return null;
  const normalized = value.replace(/,/g, '').trim();
  if (!normalized) return null;
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function requireSection(payload: any[], sectionName: string): Record<string, string | null>[] {
  const section = payload.find((entry) => entry?.reportSection === sectionName);
  if (!section?.results?.length) {
    throw new Error(`Missing USDA cutout API section: ${sectionName}`);
  }
  return section.results;
}

function findPrimalValue(rows: Record<string, string | null>[], label: string): number | null {
  const row = rows.find((entry) => entry.primal_desc === label);
  return parseNumber(row?.choice_600_900);
}

serve(async (_req: Request) => {
  const supabase = getServiceClient();
  let sourceHash: string | null = null;

  try {
    const apiRes = await fetch(REPORT_URL, {
      headers: { Accept: 'application/json' },
    });
    if (!apiRes.ok) throw new Error(`USDA cutout API error: ${apiRes.status}`);
    const payload = await apiRes.json();
    if (!Array.isArray(payload) || payload.length === 0) {
      throw new Error('USDA cutout API returned empty payload');
    }

    sourceHash = await sha256Deno(JSON.stringify(payload));

    const { data: existing } = await supabase
      .from('cutout_daily')
      .select('id')
      .eq('source_hash', sourceHash)
      .single();

    if (existing) {
      await writeIngestionLog({ source: SOURCE, source_hash: sourceHash, status: 'duplicate', records_inserted: 0 });
      return new Response(JSON.stringify({ status: 'duplicate' }), { status: 200 });
    }

    const summaryRow = requireSection(payload, 'Summary')[0];
    const currentValuesRow = requireSection(payload, 'Current Cutout Values')[0];
    const primalRows = requireSection(payload, 'Composite Primal Values');

    const reportTypeMatch = summaryRow.report_title?.match(/\((LM_[A-Z0-9]+)\)\s*$/i);
    const report_type = reportTypeMatch?.[1] ?? 'LM_XB403';

    const reportDate = summaryRow.report_date;
    if (!reportDate) throw new Error('USDA cutout API missing report_date');
    const date = new Date(reportDate).toISOString().split('T')[0];

    const choice_total = parseNumber(currentValuesRow.choice_600_900_current);
    const select_total = parseNumber(currentValuesRow.select_600_900_current);
    const chuck = findPrimalValue(primalRows, 'Primal Chuck');
    const rib = findPrimalValue(primalRows, 'Primal Rib');
    const loin = findPrimalValue(primalRows, 'Primal Loin');
    const round = findPrimalValue(primalRows, 'Primal Round');
    const brisket = findPrimalValue(primalRows, 'Primal Brisket');
    const short_plate = findPrimalValue(primalRows, 'Primal Plate');
    const flank = findPrimalValue(primalRows, 'Primal Flank');

    const fields: Record<string, number | null> = {
      choice_total, select_total, chuck, rib, loin, round, brisket, short_plate, flank,
    };
    const missing = Object.entries(fields)
      .filter(([, v]) => v === null)
      .map(([k]) => k);

    if (missing.length > 0) {
      throw new Error(`Could not extract cutout fields: ${missing.join(', ')}`);
    }

    const { error } = await supabase.from('cutout_daily').insert({
      date,
      report_type,
      choice_total,
      select_total,
      choice_select_spread: (choice_total ?? 0) - (select_total ?? 0),
      chuck,
      rib,
      loin,
      round,
      brisket,
      short_plate,
      flank,
      source_hash: sourceHash,
      updated_at: new Date().toISOString(),
    });

    if (error) throw new Error(`DB insert failed: ${error.message}`);

    await writeIngestionLog({ source: SOURCE, source_hash: sourceHash, status: 'success', records_inserted: 1 });
    return new Response(JSON.stringify({ status: 'success', records_inserted: 1 }), { status: 200 });
  } catch (err: any) {
    await writeIngestionLog({ source: SOURCE, source_hash: sourceHash, status: 'failed', error_message: err.message, records_inserted: 0 });
    return new Response(JSON.stringify({ status: 'failed', error: err.message }), { status: 500 });
  }
});
