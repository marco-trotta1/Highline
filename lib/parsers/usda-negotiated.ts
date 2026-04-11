import FirecrawlApp from '@mendable/firecrawl-js';
import { sha256 } from '../utils/hash';
import type { NegotiatedSalesRecord, ValidationError } from '../types';
import { ParseError } from '../types';

const REPORT_URL = 'https://www.ams.usda.gov/mnreports/ams_2453.pdf';

const WEIGHTED_AVG_MIN = 150;
const WEIGHTED_AVG_MAX = 400;
const VOLUME_MIN = 0;
const VOLUME_MAX = 500;
const THIN_THRESHOLD = 10;

function extractNumber(text: string, label: string): number | null {
  const regex = new RegExp(`${label}[:\\s]+([\\d,]+\\.?\\d*)`, 'i');
  const match = text.match(regex);
  if (!match) return null;
  return parseFloat(match[1].replace(/,/g, ''));
}

function extractSession(text: string): 'AM' | 'PM' | null {
  const match = text.match(/Session[:\s]+(AM|PM)/i);
  if (!match) return null;
  return match[1].toUpperCase() as 'AM' | 'PM';
}

function extractDate(text: string): string {
  const longMatch = text.match(/(\w+ \d{1,2},?\s*\d{4})/);
  if (longMatch) {
    const parsed = new Date(longMatch[1]);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }
  }
  const shortMatch = text.match(/(\d{2}\/\d{2}\/\d{4})/);
  if (shortMatch) {
    const [m, d, y] = shortMatch[1].split('/');
    return `${y}-${m}-${d}`;
  }
  return new Date().toISOString().split('T')[0];
}

export async function parseNegotiatedSales(
  apiKey: string
): Promise<NegotiatedSalesRecord> {
  const app = new FirecrawlApp({ apiKey });
  const result = await app.scrapeUrl(REPORT_URL, {
    formats: ['markdown'],
  });

  const markdown: string = (result as { markdown?: string }).markdown ?? '';
  if (!markdown.trim()) {
    throw new ParseError('Firecrawl returned empty content for negotiated sales report');
  }

  const hash = sha256(markdown);
  const date = extractDate(markdown);
  const session = extractSession(markdown);
  const low = extractNumber(markdown, 'Low Price');
  const high = extractNumber(markdown, 'High Price');
  const weighted_avg = extractNumber(markdown, 'Weighted Average');
  const volume_loads = extractNumber(markdown, 'Volume');

  const errors: ValidationError[] = [];

  if (session === null) {
    errors.push({ field: 'session', value: null, reason: 'Could not extract AM/PM session from report' });
  }
  if (weighted_avg === null || weighted_avg < WEIGHTED_AVG_MIN || weighted_avg > WEIGHTED_AVG_MAX) {
    errors.push({
      field: 'weighted_avg',
      value: weighted_avg,
      reason: `weighted_avg ${weighted_avg} is outside valid range [$${WEIGHTED_AVG_MIN}–$${WEIGHTED_AVG_MAX}/cwt]`,
    });
  }
  if (volume_loads === null || volume_loads < VOLUME_MIN || volume_loads > VOLUME_MAX) {
    errors.push({
      field: 'volume_loads',
      value: volume_loads,
      reason: `volume_loads ${volume_loads} is outside valid range [${VOLUME_MIN}–${VOLUME_MAX} loads]`,
    });
  }

  if (errors.length > 0) {
    throw new ParseError(
      errors.map((e) => e.reason).join('; '),
      errors
    );
  }

  return {
    date,
    session: session!,
    low: low ?? 0,
    high: high ?? 0,
    weighted_avg: weighted_avg!,
    volume_loads: volume_loads!,
    session_quality: volume_loads! < THIN_THRESHOLD ? 'thin' : 'active',
    source_hash: hash,
  };
}
