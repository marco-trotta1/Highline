import { sha256 } from '../utils/hash';
import type { CutoutRecord } from '../types';
import { ParseError } from '../types';

const REPORT_URL =
  'https://mpr.datamart.ams.usda.gov/services/v1.1/reports/2453?lastReports=1&allSections=true';

type CutoutApiSection = {
  reportSection?: string;
  results?: Array<Record<string, string | null>>;
};

function parseNumber(value: string | null | undefined): number | null {
  if (value == null) return null;
  const normalized = value.replace(/,/g, '').trim();
  if (!normalized) return null;
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function requireSection(
  sections: CutoutApiSection[],
  sectionName: string
): Array<Record<string, string | null>> {
  const section = sections.find((entry) => entry.reportSection === sectionName);
  if (!section?.results?.length) {
    throw new ParseError(`Missing USDA cutout API section: ${sectionName}`);
  }
  return section.results;
}

function findPrimalValue(
  rows: Array<Record<string, string | null>>,
  label: string
): number | null {
  const row = rows.find((entry) => entry.primal_desc === label);
  return parseNumber(row?.choice_600_900);
}

export function parseCutoutApiPayload(payload: CutoutApiSection[]): CutoutRecord {
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new ParseError('USDA cutout API returned no sections');
  }

  const summaryRow = requireSection(payload, 'Summary')[0];
  const currentValuesRow = requireSection(payload, 'Current Cutout Values')[0];
  const primalRows = requireSection(payload, 'Composite Primal Values');

  const reportDate = summaryRow.report_date;
  if (!reportDate) {
    throw new ParseError('USDA cutout API missing report_date');
  }

  const choiceTotal = parseNumber(currentValuesRow.choice_600_900_current);
  const selectTotal = parseNumber(currentValuesRow.select_600_900_current);
  const chuck = findPrimalValue(primalRows, 'Primal Chuck');
  const rib = findPrimalValue(primalRows, 'Primal Rib');
  const loin = findPrimalValue(primalRows, 'Primal Loin');
  const round = findPrimalValue(primalRows, 'Primal Round');
  const brisket = findPrimalValue(primalRows, 'Primal Brisket');
  const shortPlate = findPrimalValue(primalRows, 'Primal Plate');
  const flank = findPrimalValue(primalRows, 'Primal Flank');

  const fieldMap: Record<string, number | null> = {
    choice_total: choiceTotal,
    select_total: selectTotal,
    chuck,
    rib,
    loin,
    round,
    brisket,
    short_plate: shortPlate,
    flank,
  };
  const missing = Object.entries(fieldMap)
    .filter(([, value]) => value === null)
    .map(([field]) => field);

  if (missing.length > 0) {
    throw new ParseError(
      `Could not extract fields from USDA cutout API payload: ${missing.join(', ')}`
    );
  }

  const reportTypeMatch = summaryRow.report_title?.match(/\((LM_[A-Z0-9]+)\)\s*$/i);
  const reportType = reportTypeMatch?.[1] ?? 'LM_XB403';

  return {
    date: new Date(reportDate).toISOString().split('T')[0],
    report_type: reportType,
    choice_total: choiceTotal!,
    select_total: selectTotal!,
    choice_select_spread: choiceTotal! - selectTotal!,
    chuck: chuck!,
    rib: rib!,
    loin: loin!,
    round: round!,
    brisket: brisket!,
    short_plate: shortPlate!,
    flank: flank!,
    source_hash: sha256(JSON.stringify(payload)),
  };
}

export async function parseCutout(apiKey: string): Promise<CutoutRecord> {
  void apiKey;

  const response = await fetch(REPORT_URL, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new ParseError(`USDA cutout API request failed: ${response.status}`);
  }

  const payload = (await response.json()) as CutoutApiSection[];
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new ParseError('USDA cutout API returned an empty payload');
  }

  return parseCutoutApiPayload(payload);
}
