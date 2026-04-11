import FirecrawlApp from '@mendable/firecrawl-js';
import { sha256 } from '../utils/hash';
import type { CutoutRecord } from '../types';
import { ParseError } from '../types';

const REPORT_URL = 'https://www.ams.usda.gov/mnreports/ams_2466.pdf';

function extractPrice(text: string, label: string): number | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`${escaped}[:\\s]+(\\d+\\.\\d+)`, 'i');
  const match = text.match(regex);
  if (!match) return null;
  return parseFloat(match[1]);
}

function extractReportType(text: string): string {
  const match = text.match(/^(LM_\w+)/m);
  return match ? match[1] : 'Unknown';
}

function extractDate(text: string): string {
  const match = text.match(/Report Date[:\s]+(\w+ \d{1,2},?\s*\d{4})/i);
  if (match) {
    const parsed = new Date(match[1]);
    if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
  }
  return new Date().toISOString().split('T')[0];
}

export async function parseCutout(apiKey: string): Promise<CutoutRecord> {
  const app = new FirecrawlApp({ apiKey });
  const result = await (app as any).scrapeUrl(REPORT_URL, { formats: ['markdown'] });
  const markdown: string = (result as { markdown?: string }).markdown ?? '';
  if (!markdown.trim()) {
    throw new ParseError('Firecrawl returned empty content for cutout report');
  }

  const hash = sha256(markdown);
  const choice_total = extractPrice(markdown, 'Choice Total');
  const select_total = extractPrice(markdown, 'Select Total');
  const choice_select_spread = extractPrice(markdown, 'Choice-Select Spread');
  const chuck = extractPrice(markdown, 'Chuck');
  const rib = extractPrice(markdown, 'Rib');
  const loin = extractPrice(markdown, 'Loin');
  const round = extractPrice(markdown, 'Round');
  const brisket = extractPrice(markdown, 'Brisket');
  const short_plate = extractPrice(markdown, 'Short Plate');
  const flank = extractPrice(markdown, 'Flank');

  const fieldMap: Record<string, number | null> = {
    choice_total, select_total, chuck, rib, loin, round, brisket, short_plate, flank,
  };
  const missing = Object.entries(fieldMap)
    .filter(([, v]) => v === null)
    .map(([k]) => k);

  if (missing.length > 0) {
    throw new ParseError(`Could not extract fields from cutout report: ${missing.join(', ')}`);
  }

  return {
    date: extractDate(markdown),
    report_type: extractReportType(markdown),
    choice_total: choice_total!,
    select_total: select_total!,
    choice_select_spread: choice_select_spread ?? choice_total! - select_total!,
    chuck: chuck!,
    rib: rib!,
    loin: loin!,
    round: round!,
    brisket: brisket!,
    short_plate: short_plate!,
    flank: flank!,
    source_hash: hash,
  };
}
