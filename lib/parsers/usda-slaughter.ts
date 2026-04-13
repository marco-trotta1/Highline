import { PDFParse } from 'pdf-parse';
import { sha256 } from '../utils/hash';
import type { ParserResult, SlaughterRecord, ValidationError } from '../types';
import { ParseError, SourceFetchError, ValidationFailureError } from '../types';

const REPORT_SLUG_ID = 3208;
const MARS_REPORT_URL = `https://marsapi.ams.usda.gov/services/v3.1/public/listPublishedReport/${REPORT_SLUG_ID}?format=json`;
const TOTAL_HEAD_MIN = 400_000;
const TOTAL_HEAD_MAX = 700_000;
const FED_SHARE_MIN = 0.6;
const FED_SHARE_MAX = 0.95;

type FetchLike = typeof fetch;

type PublishedReportResponse = {
  reports?: Array<{
    fileName?: string;
    fileExtension?: string;
  }>;
};

function parseNumber(value: string): number {
  return Number.parseInt(value.replace(/,/g, ''), 10);
}

function requireMatch(
  text: string,
  regex: RegExp,
  failureMessage: string
): RegExpMatchArray {
  const match = text.match(regex);
  if (!match) {
    throw new ParseError(failureMessage);
  }
  return match;
}

function parseDateLabel(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ParseError(`USDA slaughter report returned invalid ${field}: ${value}`);
  }
  return parsed.toISOString().split('T')[0];
}

function validateSlaughterRecord(record: SlaughterRecord): void {
  const errors: ValidationError[] = [];

  if (record.total_head < TOTAL_HEAD_MIN || record.total_head > TOTAL_HEAD_MAX) {
    errors.push({
      field: 'total_head',
      value: record.total_head,
      reason: `total_head ${record.total_head} is outside valid range [${TOTAL_HEAD_MIN.toLocaleString()}-${TOTAL_HEAD_MAX.toLocaleString()}]`,
    });
  }

  if (
    record.steer_heifer_ratio < FED_SHARE_MIN ||
    record.steer_heifer_ratio > FED_SHARE_MAX
  ) {
    errors.push({
      field: 'steer_heifer_ratio',
      value: record.steer_heifer_ratio,
      reason: `steer_heifer_ratio ${record.steer_heifer_ratio.toFixed(4)} is outside valid range [${FED_SHARE_MIN}-${FED_SHARE_MAX}]`,
    });
  }

  if (errors.length > 0) {
    throw new ValidationFailureError(
      errors.map((error) => error.reason).join('; '),
      errors
    );
  }
}

export function parseSlaughterReportText(
  text: string
): ParserResult<SlaughterRecord, string> {
  const normalizedText = text.replace(/\r/g, '').trim();
  if (!normalizedText) {
    throw new ParseError('USDA slaughter PDF text extraction returned empty content');
  }

  const hash = sha256(normalizedText);
  const reportDateMatch = requireMatch(
    normalizedText,
    /Report for ([A-Za-z]+ \d{1,2}, \d{4}) - /,
    'Could not find the USDA slaughter report date'
  );
  const projectedSaturdayMatch = requireMatch(
    normalizedText,
    /Sat ([A-Za-z]{3} \d{1,2}, \d{4})[\s\S]*?Cattle\s+[\d,]+\s+[\d,]+\s+[\d,]+\s+([\d,]+)/,
    'Could not find the USDA slaughter projected week-ending cattle total'
  );
  const breakdownMatch = requireMatch(
    normalizedText,
    /Previous Day Breakdown[\s\S]*?Cattle\s+Steers\/Heifers\s+([\d,]+)\s+Cows\/Bulls\s+([\d,]+)/,
    'Could not find the USDA slaughter previous-day cattle breakdown'
  );

  const totalHead = parseNumber(projectedSaturdayMatch[2]);
  const steersHeifers = parseNumber(breakdownMatch[1]);
  const cowsBulls = parseNumber(breakdownMatch[2]);
  const denominator = steersHeifers + cowsBulls;
  const parsedRecord: SlaughterRecord = {
    week_ending: parseDateLabel(projectedSaturdayMatch[1], 'week_ending'),
    total_head: totalHead,
    // The official 3208 source reports a fed/non-fed breakdown, not separate steer/heifer counts.
    // We retain the existing record shape by storing the fed count in `steer_count`
    // and the non-fed companion count in `heifer_count`.
    steer_count: steersHeifers,
    heifer_count: cowsBulls,
    steer_heifer_ratio: denominator > 0 ? steersHeifers / denominator : 0,
    source_hash: hash,
  };

  // Ensure the report date is parseable even though the stored date is the projected Saturday WTD line.
  parseDateLabel(reportDateMatch[1], 'report_date');
  validateSlaughterRecord(parsedRecord);

  return {
    parsedRecord,
    rawExtractedContent: normalizedText,
    sha256: hash,
  };
}

export async function fetchLatestSlaughterPdfUrl(
  fetchImpl: FetchLike = fetch
): Promise<string> {
  const response = await fetchImpl(MARS_REPORT_URL, {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new SourceFetchError(
      `USDA MARS report lookup failed for ${REPORT_SLUG_ID}: ${response.status} ${response.statusText}`
    );
  }

  const payload = (await response.json()) as PublishedReportResponse;
  const report = payload.reports?.[0];
  if (!report?.fileName || report.fileExtension !== 'pdf') {
    throw new SourceFetchError(`USDA MARS report lookup returned no PDF for ${REPORT_SLUG_ID}`);
  }

  return `https://www.ams.usda.gov/mnreports/${report.fileName}.pdf`;
}

export async function fetchSlaughterReportText(
  fetchImpl: FetchLike = fetch
): Promise<string> {
  const pdfUrl = await fetchLatestSlaughterPdfUrl(fetchImpl);
  const response = await fetchImpl(pdfUrl);

  if (!response.ok) {
    throw new SourceFetchError(
      `USDA slaughter PDF fetch failed: ${response.status} ${response.statusText}`
    );
  }

  const data = Buffer.from(await response.arrayBuffer());
  const parser = new PDFParse({ data });

  try {
    const result = await parser.getText();
    const text = result.text?.trim();
    if (!text) {
      throw new SourceFetchError('USDA slaughter PDF text extraction returned no text');
    }
    return text;
  } finally {
    await parser.destroy();
  }
}

export async function parseSlaughter(
  _apiKey: string,
  fetchImpl: FetchLike = fetch
): Promise<ParserResult<SlaughterRecord, string>> {
  void _apiKey;
  const text = await fetchSlaughterReportText(fetchImpl);
  return parseSlaughterReportText(text);
}
