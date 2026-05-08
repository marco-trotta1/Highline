// @ts-nocheck
// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.208.0/http/server.ts';
import { getServiceClient } from '../_shared/supabase-client.ts';
import { sha256Deno } from '../_shared/log.ts';
import {
  checkSourceHashDuplicate,
  respondIngestFailure,
  respondIngestSuccess,
} from '../_shared/ingest.ts';

const USDA_MPR_URL =
  'https://mpr.datamart.ams.usda.gov/services/v1.1/reports/3208?lastReports=1&allSections=true';
const SOURCE = 'usda_slaughter';
const TOTAL_HEAD_MIN = 400_000;
const TOTAL_HEAD_MAX = 700_000;
const STEER_HEIFER_RATIO_MIN = 0.3;
const STEER_HEIFER_RATIO_MAX = 0.7;

type SlaughterRow = {
  week_ending: string;
  total_head: number;
  steer_count: number;
  heifer_count: number;
  steer_heifer_ratio: number;
  source_hash: string;
};

function parseNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = String(value).replace(/,/g, '').trim();
  if (!normalized || normalized === '(D)' || normalized === '(Z)') return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseHead(value: string | number | null | undefined): number | null {
  const parsed = parseNumber(value);
  return parsed === null ? null : Math.trunc(parsed);
}

function formatReportDate(value: string | number | null | undefined): string | null {
  if (!value) return null;
  const normalized = String(value).trim();
  const isoMatch = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  const usMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (usMatch) {
    const month = usMatch[1].padStart(2, '0');
    const day = usMatch[2].padStart(2, '0');
    return `${usMatch[3]}-${month}-${day}`;
  }
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().split('T')[0];
}

function normalize(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

function getField(row: any, names: string[]): any {
  if (!row || typeof row !== 'object') return undefined;
  const entries = Object.entries(row);
  for (const name of names) {
    const exact = row[name];
    if (exact !== undefined) return exact;

    const wanted = name.toLowerCase();
    const match = entries.find(([key]) => key.toLowerCase() === wanted);
    if (match) return match[1];
  }
  return undefined;
}

function getDate(row: any): string | null {
  return formatReportDate(getField(row, [
    'week_ending',
    'week_ending_date',
    'report_date_end',
    'report_date',
    'published_date',
  ]));
}

function getHeadCount(row: any): number | null {
  const direct = parseHead(getField(row, [
    'total_head',
    'total_head_count',
    'total_count',
    'head_count',
    'Head_Count',
    'current_volume',
    'total_slaughter',
  ]));
  if (direct !== null) return direct;

  const live = parseHead(getField(row, ['live_head_count']));
  const dressed = parseHead(getField(row, ['dress_head_count', 'dressed_head_count']));
  if (live !== null || dressed !== null) return (live ?? 0) + (dressed ?? 0);

  return null;
}

function sectionRows(payload: any): any[] {
  if (!Array.isArray(payload)) {
    throw new Error('USDA MPR slaughter API returned a non-array payload');
  }

  return payload
    .filter((section) => {
      const reportSection = normalize(section?.reportSection);
      return reportSection === 'summary' || reportSection === 'detail';
    })
    .flatMap((section) => {
      if (Array.isArray(section?.results)) return section.results;
      return section && typeof section === 'object' ? [section] : [];
    });
}

function extractFromRows(rows: any[], sourceHash: string): SlaughterRow {
  let weekEnding: string | null = null;
  let totalHead: number | null = null;
  let steerCount: number | null = null;
  let heiferCount: number | null = null;

  for (const row of rows) {
    weekEnding ??= getDate(row);

    const rowTotal = getHeadCount(row);
    const classText = normalize(getField(row, [
      'class_desc',
      'class_description',
      'class',
      'class_desc_text',
      'CatCode',
    ]));

    const aggregateSteers = parseHead(getField(row, [
      'steer_count',
      'steers',
      'steer_head_count',
      'total_steers',
    ]));
    const aggregateHeifers = parseHead(getField(row, [
      'heifer_count',
      'heifers',
      'heifer_head_count',
      'total_heifers',
    ]));

    if (aggregateSteers !== null) steerCount = aggregateSteers;
    if (aggregateHeifers !== null) heiferCount = aggregateHeifers;

    if (classText === 'all' || classText === 'all classes' || classText === 'total') {
      totalHead ??= rowTotal;
    } else if (classText.includes('steer') && !classText.includes('heifer')) {
      steerCount = (steerCount ?? 0) + (rowTotal ?? 0);
    } else if (classText.includes('heifer') && !classText.includes('steer')) {
      heiferCount = (heiferCount ?? 0) + (rowTotal ?? 0);
    } else if (rowTotal !== null && !classText) {
      totalHead ??= rowTotal;
    }
  }

  if (totalHead === null && steerCount !== null && heiferCount !== null) {
    totalHead = steerCount + heiferCount;
  }

  if (!weekEnding) throw new Error('Could not determine slaughter week_ending from USDA MPR payload');
  if (totalHead === null) throw new Error('Could not determine total_head from USDA MPR payload');
  if (steerCount === null) throw new Error('Could not determine steer_count from USDA MPR payload');
  if (heiferCount === null) throw new Error('Could not determine heifer_count from USDA MPR payload');

  const denominator = steerCount + heiferCount;
  const steerHeiferRatio = denominator > 0
    ? Number((steerCount / denominator).toFixed(4))
    : 0;

  return {
    week_ending: weekEnding,
    total_head: totalHead,
    steer_count: steerCount,
    heifer_count: heiferCount,
    steer_heifer_ratio: steerHeiferRatio,
    source_hash: sourceHash,
  };
}

function validateRow(row: SlaughterRow): void {
  if (row.total_head < TOTAL_HEAD_MIN || row.total_head > TOTAL_HEAD_MAX) {
    throw new Error(
      `total_head ${row.total_head} is outside valid range [${TOTAL_HEAD_MIN}-${TOTAL_HEAD_MAX}]`,
    );
  }

  if (
    row.steer_heifer_ratio < STEER_HEIFER_RATIO_MIN ||
    row.steer_heifer_ratio > STEER_HEIFER_RATIO_MAX
  ) {
    throw new Error(
      `steer_heifer_ratio ${row.steer_heifer_ratio.toFixed(4)} is outside valid range [${STEER_HEIFER_RATIO_MIN}-${STEER_HEIFER_RATIO_MAX}]`,
    );
  }
}

async function fetchSlaughterRow(): Promise<SlaughterRow> {
  const res = await fetch(USDA_MPR_URL, { headers: { Accept: 'application/json' } });
  const rawText = await res.text();
  if (!res.ok) throw new Error(`USDA MPR slaughter API error: ${res.status} ${rawText.slice(0, 500)}`);

  const payload = JSON.parse(rawText);
  const sourceHash = await sha256Deno(rawText);
  const row = extractFromRows(sectionRows(payload), sourceHash);
  validateRow(row);
  return row;
}

serve(async (_req: Request) => {
  const supabase = getServiceClient();
  let sourceHash: string | null = null;

  try {
    const row = await fetchSlaughterRow();
    sourceHash = row.source_hash;

    const duplicate = await checkSourceHashDuplicate(
      supabase,
      'slaughter_weekly',
      SOURCE,
      sourceHash,
    );
    if (duplicate) return duplicate;

    const { error } = await supabase
      .from('slaughter_weekly')
      .insert(row);

    if (error) throw new Error(`DB insert failed: ${error.message}`);

    return respondIngestSuccess(SOURCE, sourceHash, 1);
  } catch (err: any) {
    return respondIngestFailure(SOURCE, sourceHash, err);
  }
});
