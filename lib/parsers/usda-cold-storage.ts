import FirecrawlApp from '@mendable/firecrawl-js';
import { sha256 } from '../utils/hash';
import type { ColdStorageRecord } from '../types';
import { ParseError } from '../types';

const REPORT_URL = 'https://www.nass.usda.gov/Publications/Todays_Reports/reports/cofd0426.pdf';

const MONTH_NAMES: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4,
  may: 5, june: 6, july: 7, august: 8,
  september: 9, october: 10, november: 11, december: 12,
};

function extractBeefLbs(text: string): number | null {
  const match = text.match(/Total Beef[^:]*:\s*([\d,]+\.?\d*)\s*million/i);
  if (!match) return null;
  return parseFloat(match[1].replace(/,/g, ''));
}

function extractMonthYear(text: string): { month: number; year: number } | null {
  const match = text.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/i
  );
  if (!match) return null;
  return { month: MONTH_NAMES[match[1].toLowerCase()], year: parseInt(match[2], 10) };
}

export async function parseColdStorage(
  apiKey: string,
  historicalRows: Array<{ total_beef_million_lbs: number }>
): Promise<ColdStorageRecord> {
  const app = new FirecrawlApp({ apiKey });
  const result = await (app as any).scrapeUrl(REPORT_URL, { formats: ['markdown'] });
  const markdown: string = (result as { markdown?: string }).markdown ?? '';
  if (!markdown.trim()) {
    throw new ParseError('Firecrawl returned empty content for cold storage report');
  }

  const hash = sha256(markdown);
  const total_beef_million_lbs = extractBeefLbs(markdown);
  const monthYear = extractMonthYear(markdown);

  if (total_beef_million_lbs === null) {
    throw new ParseError('Could not extract total beef lbs from cold storage report');
  }
  if (monthYear === null) {
    throw new ParseError('Could not extract month/year from cold storage report');
  }

  let vs_5yr_avg_pct = 0;
  if (historicalRows.length > 0) {
    const avg =
      historicalRows.reduce((sum, r) => sum + r.total_beef_million_lbs, 0) /
      historicalRows.length;
    vs_5yr_avg_pct = avg > 0 ? ((total_beef_million_lbs - avg) / avg) * 100 : 0;
  }

  return {
    month: monthYear.month,
    year: monthYear.year,
    total_beef_million_lbs,
    vs_5yr_avg_pct: parseFloat(vs_5yr_avg_pct.toFixed(2)),
    source_hash: hash,
  };
}
