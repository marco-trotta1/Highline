import { sha256 } from '../utils/hash';
import type {
  NegotiatedSalesRecord,
  ParserResult,
  ValidationError,
} from '../types';
import { ParseError, SourceFetchError, ValidationFailureError } from '../types';

const REPORT_ENDPOINTS = {
  AM: 'https://mpr.datamart.ams.usda.gov/services/v1.1/reports/2660?lastReports=1&allSections=true',
  PM: 'https://mpr.datamart.ams.usda.gov/services/v1.1/reports/2661?lastReports=1&allSections=true',
} as const;

const HEAD_PER_LOAD = 38;
const WEIGHTED_AVG_MIN = 150;
const WEIGHTED_AVG_MAX = 400;
const VOLUME_MIN = 0;
const VOLUME_MAX = 500;
const THIN_THRESHOLD = 10;

type NegotiatedSession = keyof typeof REPORT_ENDPOINTS;

type NegotiatedApiRow = Record<string, string | number | null>;

type NegotiatedApiSection = {
  reportSection?: string;
  results?: NegotiatedApiRow[];
};

type FetchLike = typeof fetch;

function parseNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const normalized = String(value).replace(/,/g, '').trim();
  if (!normalized) return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function requireSection(
  payload: NegotiatedApiSection[],
  sectionName: string
): NegotiatedApiRow[] {
  const section = payload.find((entry) => entry.reportSection === sectionName);
  if (!section?.results?.length) {
    throw new ParseError(`USDA negotiated API payload missing section: ${sectionName}`);
  }
  return section.results;
}

function parseIsoDate(value: string | null | undefined, field: string): string {
  if (!value) {
    throw new ParseError(`USDA negotiated API missing ${field}`);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ParseError(`USDA negotiated API returned invalid ${field}: ${value}`);
  }

  return parsed.toISOString().split('T')[0];
}

function parsePublishedAt(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? Number.NEGATIVE_INFINITY : parsed.getTime();
}

function scoreDetailRow(row: NegotiatedApiRow): number {
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

function selectRepresentativeDetailRow(rows: NegotiatedApiRow[]): NegotiatedApiRow {
  const candidates = rows.filter(
    (row) =>
      String(row.purchase_type_code ?? '').toUpperCase() === 'NEGOTIATED CASH' &&
      String(row.grade_desc ?? '').toLowerCase() === 'total all grades' &&
      parseNumber(row.wtd_avg_price) !== null
  );

  const ranked = (candidates.length > 0 ? candidates : rows)
    .filter((row) => String(row.purchase_type_code ?? '').toUpperCase() === 'NEGOTIATED CASH')
    .sort((left, right) => scoreDetailRow(right) - scoreDetailRow(left));

  const winner = ranked[0];
  if (!winner) {
    throw new ParseError('USDA negotiated API returned no negotiated cash detail rows');
  }

  return winner;
}

function validateNegotiatedRecord(record: NegotiatedSalesRecord): void {
  const errors: ValidationError[] = [];

  if (record.weighted_avg < WEIGHTED_AVG_MIN || record.weighted_avg > WEIGHTED_AVG_MAX) {
    errors.push({
      field: 'weighted_avg',
      value: record.weighted_avg,
      reason: `weighted_avg ${record.weighted_avg} is outside valid range [$${WEIGHTED_AVG_MIN}-$${WEIGHTED_AVG_MAX}/cwt]`,
    });
  }

  if (record.volume_loads < VOLUME_MIN || record.volume_loads > VOLUME_MAX) {
    errors.push({
      field: 'volume_loads',
      value: record.volume_loads,
      reason: `volume_loads ${record.volume_loads} is outside valid range [${VOLUME_MIN}-${VOLUME_MAX} loads]`,
    });
  }

  if (record.low > record.high) {
    errors.push({
      field: 'price_range',
      value: { low: record.low, high: record.high },
      reason: `low price ${record.low} cannot be greater than high price ${record.high}`,
    });
  }

  if (errors.length > 0) {
    throw new ValidationFailureError(
      errors.map((error) => error.reason).join('; '),
      errors
    );
  }
}

export function parseNegotiatedApiPayload(
  payload: NegotiatedApiSection[],
  session: NegotiatedSession
): ParserResult<NegotiatedSalesRecord, NegotiatedApiSection[]> {
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new ParseError('USDA negotiated API returned an empty payload');
  }

  const rawExtractedContent = payload;
  const hash = sha256(JSON.stringify(payload));
  const summaryRows = requireSection(payload, 'Summary');
  const detailRows = requireSection(payload, 'Detail');
  const summaryRow =
    summaryRows.find(
      (row) =>
        String(row.purchase_type_desc ?? '').toUpperCase() === 'NEGOTIATED CASH' &&
        String(row.current_period ?? '').toLowerCase() === 'confirmed'
    ) ?? summaryRows[0];

  if (!summaryRow) {
    throw new ParseError('USDA negotiated API did not contain a summary row');
  }

  const representativeRow = selectRepresentativeDetailRow(detailRows);
  const priceLow = parseNumber(representativeRow.price_range_low);
  const priceHigh = parseNumber(representativeRow.price_range_high);
  const weightedAvg = parseNumber(representativeRow.wtd_avg_price);
  const confirmedHead = parseNumber(summaryRow.current_date_volume);
  const fallbackHead = parseNumber(representativeRow.head_count);
  const volumeLoads = Math.round((confirmedHead ?? fallbackHead ?? 0) / HEAD_PER_LOAD);

  if (priceLow === null || priceHigh === null || weightedAvg === null) {
    throw new ParseError(
      'USDA negotiated API detail rows did not include low/high/weighted average values'
    );
  }

  const parsedRecord: NegotiatedSalesRecord = {
    date: parseIsoDate(String(summaryRow.report_date ?? ''), 'report_date'),
    session,
    low: priceLow,
    high: priceHigh,
    weighted_avg: weightedAvg,
    volume_loads: volumeLoads,
    session_quality: volumeLoads < THIN_THRESHOLD ? 'thin' : 'active',
    source_hash: hash,
  };

  validateNegotiatedRecord(parsedRecord);

  return {
    parsedRecord,
    rawExtractedContent,
    sha256: hash,
  };
}

export async function fetchNegotiatedPayload(
  session: NegotiatedSession,
  fetchImpl: FetchLike = fetch
): Promise<NegotiatedApiSection[]> {
  const response = await fetchImpl(REPORT_ENDPOINTS[session], {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new SourceFetchError(
      `USDA negotiated API request failed for ${session}: ${response.status} ${response.statusText}`
    );
  }

  const payload = (await response.json()) as NegotiatedApiSection[];
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new SourceFetchError(`USDA negotiated API returned no data for ${session}`);
  }

  return payload;
}

export async function parseNegotiatedSales(
  _apiKey: string,
  fetchImpl: FetchLike = fetch
): Promise<ParserResult<NegotiatedSalesRecord, NegotiatedApiSection[]>> {
  void _apiKey;

  const payloads = await Promise.all(
    (Object.keys(REPORT_ENDPOINTS) as NegotiatedSession[]).map(async (session) => ({
      session,
      payload: await fetchNegotiatedPayload(session, fetchImpl),
    }))
  );

  const latest = payloads
    .map(({ session, payload }) => ({
      session,
      payload,
      publishedAt: parsePublishedAt(
        String(requireSection(payload, 'Summary')[0]?.published_date ?? '')
      ),
    }))
    .sort((left, right) => right.publishedAt - left.publishedAt)[0];

  if (!latest) {
    throw new SourceFetchError('USDA negotiated API returned no AM or PM reports');
  }

  return parseNegotiatedApiPayload(latest.payload, latest.session);
}
