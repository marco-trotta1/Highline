// @ts-nocheck
// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getServiceClient } from '../_shared/supabase-client.ts';
import { writeIngestionLog, sha256Deno } from '../_shared/log.ts';
import {
  checkSourceHashDuplicate,
  respondIngestFailure,
} from '../_shared/ingest.ts';

type RawRow = Record<string, string | number | null | undefined>;
type SubprimalRow = {
  date: string;
  session: 'AM' | 'PM';
  grade: string;
  item_description: string;
  number_trades: number | null;
  total_pounds: number | null;
  price_range_low: number | null;
  price_range_high: number | null;
  weighted_average: number;
  source_hash: string;
};
type SupabaseWriter = {
  from: (table: string) => {
    upsert: (
      rows: SubprimalRow[],
      options: { onConflict: string },
    ) => Promise<{ error: { message: string } | null }>;
  };
};

const REPORT_URL =
  'https://mpr.datamart.ams.usda.gov/services/v1.1/reports/2453?lastReports=1&allSections=true';
const SOURCE = 'usda_cutout';
const SUBPRIMAL_SECTIONS = [
  { sectionName: 'Choice Cuts', grade: 'Choice', logSource: 'usda_cutout_subprimal_choice' },
  { sectionName: 'Select Cuts', grade: 'Select', logSource: 'usda_cutout_subprimal_select' },
  {
    sectionName: 'Choice and Select Cuts',
    grade: 'Choice and Select',
    logSource: 'usda_cutout_subprimal_choice_select',
  },
];

function parseNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = value.replace(/,/g, '').trim();
  if (!normalized) return null;
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatReportDate(value: string | number | null | undefined): string | null {
  if (!value) return null;
  const normalized = String(value).trim();
  const usMatch = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (usMatch) return `${usMatch[3]}-${usMatch[1]}-${usMatch[2]}`;

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().split('T')[0];
}

function getCutoutSession(reportUrl: string): 'AM' | 'PM' {
  const reportId = reportUrl.match(/\/reports\/(\d+)/)?.[1];
  if (reportId === '2452') return 'PM';
  if (reportId === '2453') return 'AM';
  throw new Error(`Unsupported USDA cutout report id for session: ${reportId ?? 'unknown'}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function requireSection(payload: unknown[], sectionName: string): RawRow[] {
  const section = payload.find(
    (entry): entry is Record<string, unknown> => isRecord(entry) && entry.reportSection === sectionName,
  );
  if (!section || !Array.isArray(section.results) || section.results.length === 0) {
    throw new Error(`Missing USDA cutout API section: ${sectionName}`);
  }
  return section.results as RawRow[];
}

function findPrimalValue(rows: RawRow[], label: string): number | null {
  const row = rows.find((entry) => entry.primal_desc === label);
  return parseNumber(row?.choice_600_900);
}

async function buildSubprimalRows(
  rows: RawRow[],
  grade: string,
  session: 'AM' | 'PM',
): Promise<SubprimalRow[]> {
  const subprimalRows: SubprimalRow[] = [];

  for (const row of rows) {
    const weighted_average = parseNumber(row.weighted_average);
    if (weighted_average === null) continue;

    const date = formatReportDate(row.report_date);
    if (!date) {
      throw new Error(`Unrecognized sub-primal report_date "${row.report_date}" (${grade})`);
    }

    const item_description = String(row.item_description ?? '').trim();
    if (!item_description) continue;

    subprimalRows.push({
      date,
      session,
      grade,
      item_description,
      number_trades: parseNumber(row.number_trades),
      total_pounds: parseNumber(row.total_pounds),
      price_range_low: parseNumber(row.price_range_low),
      price_range_high: parseNumber(row.price_range_high),
      weighted_average,
      source_hash: await sha256Deno(JSON.stringify(row)),
    });
  }

  return subprimalRows;
}

async function upsertSubprimalPrices(
  supabase: SupabaseWriter,
  payload: unknown[],
  session: 'AM' | 'PM',
  sourceHash: string | null,
) {
  const counts: Record<string, number> = {};

  for (const { sectionName, grade, logSource } of SUBPRIMAL_SECTIONS) {
    const rows = requireSection(payload, sectionName);
    const subprimalRows = await buildSubprimalRows(rows, grade, session);

    if (subprimalRows.length > 0) {
      const { error } = await supabase
        .from('subprimal_prices')
        .upsert(subprimalRows, { onConflict: 'date,session,grade,item_description' });
      if (error) throw new Error(`Sub-primal DB upsert failed (${grade}): ${error.message}`);
    }

    counts[grade] = subprimalRows.length;
    await writeIngestionLog({
      source: logSource,
      source_hash: sourceHash,
      status: 'success',
      records_inserted: subprimalRows.length,
    });
  }

  return counts;
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

    const duplicate = await checkSourceHashDuplicate(
      supabase,
      'cutout_daily',
      SOURCE,
      sourceHash
    );
    if (duplicate) return duplicate;

    const summaryRow = requireSection(payload, 'Summary')[0];
    const currentValuesRow = requireSection(payload, 'Current Cutout Values')[0];
    const primalRows = requireSection(payload, 'Composite Primal Values');

    const reportTypeMatch = summaryRow.report_title?.match(/\((LM_[A-Z0-9]+)\)\s*$/i);
    const report_type = reportTypeMatch?.[1] ?? 'LM_XB403';

    const reportDate = summaryRow.report_date;
    if (!reportDate) throw new Error('USDA cutout API missing report_date');
    const date = new Date(reportDate).toISOString().split('T')[0];
    const session = getCutoutSession(REPORT_URL);

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

    const subprimal_counts = await upsertSubprimalPrices(supabase, payload, session, sourceHash);

    await writeIngestionLog({ source: SOURCE, source_hash: sourceHash, status: 'success', records_inserted: 1 });
    return new Response(JSON.stringify({ status: 'success', records_inserted: 1, subprimal_counts }), { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return respondIngestFailure(SOURCE, sourceHash, { message });
  }
});
