import { sha256 } from '../utils/hash';
import type { CutoutRecord, ParserResult } from '../types';
import { ParseError, SourceFetchError, ValidationFailureError } from '../types';

const REPORT_URL =
  'https://mpr.datamart.ams.usda.gov/services/v1.1/reports/2453?lastReports=1&allSections=true';

type CutoutApiSection = {
  reportSection?: string;
  results?: Array<Record<string, string | null>>;
};

type FetchLike = typeof fetch;

function parseNumber(value: string | null | undefined): number | null {
  if (value == null) return null;
  const normalized = value.replace(/,/g, '').trim();
  if (!normalized) return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function requireSection(
  sections: CutoutApiSection[],
  sectionName: string
): Array<Record<string, string | null>> {
  const section = sections.find((entry) => entry.reportSection === sectionName);
  if (!section?.results?.length) {
    throw new ParseError(`USDA cutout API payload missing section: ${sectionName}`);
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

function validateCutoutRecord(record: CutoutRecord): void {
  const invalidField = Object.entries(record).find(([key, value]) => {
    if (key === 'date' || key === 'report_type' || key === 'source_hash') return false;
    return typeof value === 'number' && !Number.isFinite(value);
  });

  if (invalidField) {
    throw new ValidationFailureError(
      `USDA cutout record contains a non-finite numeric value for ${invalidField[0]}`
    );
  }
}

export function parseCutoutApiPayload(
  payload: CutoutApiSection[]
): ParserResult<CutoutRecord, CutoutApiSection[]> {
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new ParseError('USDA cutout API returned no sections');
  }

  const rawExtractedContent = payload;
  const hash = sha256(JSON.stringify(payload));
  const summaryRow = requireSection(payload, 'Summary')[0];
  const currentValuesRow = requireSection(payload, 'Current Cutout Values')[0];
  const primalRows = requireSection(payload, 'Composite Primal Values');

  const reportDate = summaryRow.report_date;
  if (!reportDate) {
    throw new ParseError('USDA cutout API missing report_date');
  }

  const parsedDate = new Date(reportDate);
  if (Number.isNaN(parsedDate.getTime())) {
    throw new ParseError(`USDA cutout API returned invalid report_date: ${reportDate}`);
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
  const parsedRecord: CutoutRecord = {
    date: parsedDate.toISOString().split('T')[0],
    report_type: reportTypeMatch?.[1] ?? 'LM_XB403',
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
    source_hash: hash,
  };

  validateCutoutRecord(parsedRecord);

  return {
    parsedRecord,
    rawExtractedContent,
    sha256: hash,
  };
}

export async function fetchCutoutPayload(
  fetchImpl: FetchLike = fetch
): Promise<CutoutApiSection[]> {
  const response = await fetchImpl(REPORT_URL, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new SourceFetchError(
      `USDA cutout API request failed: ${response.status} ${response.statusText}`
    );
  }

  const payload = (await response.json()) as CutoutApiSection[];
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new SourceFetchError('USDA cutout API returned an empty payload');
  }

  return payload;
}

export async function parseCutout(
  _apiKey: string,
  fetchImpl: FetchLike = fetch
): Promise<ParserResult<CutoutRecord, CutoutApiSection[]>> {
  void _apiKey;
  const payload = await fetchCutoutPayload(fetchImpl);
  return parseCutoutApiPayload(payload);
}
