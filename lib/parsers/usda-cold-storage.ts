import { sha256 } from '../utils/hash';
import type { ColdStorageRecord, ParserResult } from '../types';
import { ParseError, SourceFetchError, ValidationFailureError } from '../types';

const QUICK_STATS_URL = 'https://quickstats.nass.usda.gov/api/api_GET/';

const MONTH_NAMES: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  APR: 4,
  MAY: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  NOV: 11,
  DEC: 12,
};

type FetchLike = typeof fetch;

type QuickStatsRow = {
  Value?: string;
  year?: string;
  reference_period_desc?: string;
  short_desc?: string;
};

type QuickStatsResponse = {
  data?: QuickStatsRow[];
  error?: string[];
};

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const normalized = value.replace(/,/g, '').trim();
  if (!normalized || normalized === '(D)' || normalized === '(Z)') {
    return null;
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseMonth(referencePeriod: string | undefined): number | null {
  if (!referencePeriod) return null;
  const token = referencePeriod.slice(0, 3).toUpperCase();
  return MONTH_NAMES[token] ?? null;
}

function validateColdStorageRecord(record: ColdStorageRecord): void {
  if (record.month < 1 || record.month > 12) {
    throw new ValidationFailureError(`month ${record.month} is outside valid range [1-12]`);
  }

  if (!Number.isFinite(record.total_beef_million_lbs) || record.total_beef_million_lbs <= 0) {
    throw new ValidationFailureError(
      `total_beef_million_lbs ${record.total_beef_million_lbs} must be a positive number`
    );
  }
}

function buildQuickStatsUrl(apiKey: string): string {
  const params = new URLSearchParams({
    key: apiKey,
    source_desc: 'SURVEY',
    sector_desc: 'ANIMALS & PRODUCTS',
    group_desc: 'WAREHOUSES',
    commodity_desc: 'TOTAL BEEF',
    util_practice_desc: 'COLD STORAGE',
    statisticcat_desc: 'STOCKS',
    unit_desc: 'MILLION POUNDS',
    freq_desc: 'MONTHLY',
    format: 'JSON',
  });

  return `${QUICK_STATS_URL}?${params.toString()}`;
}

export function parseColdStorageQuickStatsResponse(
  payload: QuickStatsResponse,
  historicalRows: Array<{ total_beef_million_lbs: number }>
): ParserResult<ColdStorageRecord, QuickStatsResponse> {
  const rawExtractedContent = payload;
  const hash = sha256(JSON.stringify(payload));

  if (payload.error?.length) {
    throw new SourceFetchError(`NASS Quick Stats returned an error: ${payload.error.join('; ')}`);
  }

  const latestRow = payload.data
    ?.map((row) => ({
      row,
      year: row.year ? Number.parseInt(row.year, 10) : Number.NaN,
      month: parseMonth(row.reference_period_desc) ?? Number.NaN,
    }))
    .filter(
      (entry) => Number.isFinite(entry.year) && Number.isFinite(entry.month)
    )
    .sort((left, right) => {
      if (right.year !== left.year) return right.year - left.year;
      return right.month - left.month;
    })[0]?.row;
  if (!latestRow) {
    throw new ParseError('NASS Quick Stats returned no cold storage rows for total beef');
  }

  const totalBeef = parseNumber(latestRow.Value);
  const month = parseMonth(latestRow.reference_period_desc);
  const year = latestRow.year ? Number.parseInt(latestRow.year, 10) : Number.NaN;

  if (totalBeef === null) {
    throw new ParseError('Could not extract total beef million lbs from NASS Quick Stats');
  }
  if (month === null || !Number.isFinite(year)) {
    throw new ParseError('Could not extract month/year from NASS Quick Stats');
  }

  let vs5yrAvgPct = 0;
  if (historicalRows.length > 0) {
    const avg =
      historicalRows.reduce((sum, row) => sum + row.total_beef_million_lbs, 0) /
      historicalRows.length;
    vs5yrAvgPct = avg > 0 ? ((totalBeef - avg) / avg) * 100 : 0;
  }

  const parsedRecord: ColdStorageRecord = {
    month,
    year,
    total_beef_million_lbs: totalBeef,
    vs_5yr_avg_pct: Number.parseFloat(vs5yrAvgPct.toFixed(2)),
    source_hash: hash,
  };

  validateColdStorageRecord(parsedRecord);

  return {
    parsedRecord,
    rawExtractedContent,
    sha256: hash,
  };
}

export async function fetchColdStorageQuickStats(
  apiKey: string,
  fetchImpl: FetchLike = fetch
): Promise<QuickStatsResponse> {
  if (!apiKey) {
    throw new SourceFetchError(
      'NASS Quick Stats API key is required to fetch official cold storage data'
    );
  }

  const response = await fetchImpl(buildQuickStatsUrl(apiKey), {
    headers: { Accept: 'application/json' },
  });

  if (!response.ok) {
    throw new SourceFetchError(
      `NASS Quick Stats request failed: ${response.status} ${response.statusText}`
    );
  }

  return (await response.json()) as QuickStatsResponse;
}

export async function parseColdStorage(
  apiKey: string,
  historicalRows: Array<{ total_beef_million_lbs: number }>,
  fetchImpl: FetchLike = fetch
): Promise<ParserResult<ColdStorageRecord, QuickStatsResponse>> {
  const payload = await fetchColdStorageQuickStats(apiKey, fetchImpl);
  return parseColdStorageQuickStatsResponse(payload, historicalRows);
}
