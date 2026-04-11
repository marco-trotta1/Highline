import FirecrawlApp from '@mendable/firecrawl-js';
import { sha256 } from '../utils/hash';
import type { SlaughterRecord, ValidationError } from '../types';
import { ParseError } from '../types';

const REPORT_URL = 'https://www.ams.usda.gov/mnreports/ams_3208.pdf';

const RATIO_MIN = 0.3;
const RATIO_MAX = 0.7;
const TOTAL_HEAD_MIN = 400_000;
const TOTAL_HEAD_MAX = 700_000;

function extractHeadCount(text: string, label: string): number | null {
  const regex = new RegExp(`${label}[:\\s]+([\\d,]+)`, 'i');
  const match = text.match(regex);
  if (!match) return null;
  return parseInt(match[1].replace(/,/g, ''), 10);
}

function extractWeekEnding(text: string): string {
  const match = text.match(/Week Ending[:\s]+(\w+ \d{1,2},?\s*\d{4})/i);
  if (match) {
    const parsed = new Date(match[1]);
    if (!isNaN(parsed.getTime())) return parsed.toISOString().split('T')[0];
  }
  return new Date().toISOString().split('T')[0];
}

export async function parseSlaughter(apiKey: string): Promise<SlaughterRecord> {
  const app = new FirecrawlApp({ apiKey });
  const result = await (app as any).scrapeUrl(REPORT_URL, { formats: ['markdown'] });
  const markdown: string = (result as { markdown?: string }).markdown ?? '';
  if (!markdown.trim()) {
    throw new ParseError('Firecrawl returned empty content for slaughter report');
  }

  const hash = sha256(markdown);
  const week_ending = extractWeekEnding(markdown);
  const total_head = extractHeadCount(markdown, 'Total Head Slaughtered');
  const steer_count = extractHeadCount(markdown, 'Steers');
  const heifer_count = extractHeadCount(markdown, 'Heifers');

  const errors: ValidationError[] = [];

  if (total_head === null || total_head < TOTAL_HEAD_MIN || total_head > TOTAL_HEAD_MAX) {
    errors.push({
      field: 'total_head',
      value: total_head,
      reason: `total_head ${total_head} is outside valid range [${TOTAL_HEAD_MIN.toLocaleString()}–${TOTAL_HEAD_MAX.toLocaleString()}]`,
    });
  }

  if (steer_count !== null && heifer_count !== null) {
    const total = steer_count + heifer_count;
    if (total > 0) {
      const ratio = steer_count / total;
      if (ratio < RATIO_MIN || ratio > RATIO_MAX) {
        errors.push({
          field: 'steer_heifer_ratio',
          value: ratio,
          reason: `steer_heifer_ratio ${ratio.toFixed(4)} is outside valid range [${RATIO_MIN}–${RATIO_MAX}]`,
        });
      }
    }
  }

  if (errors.length > 0) {
    throw new ParseError(errors.map((e) => e.reason).join('; '), errors);
  }

  const total = steer_count! + heifer_count!;

  return {
    week_ending,
    total_head: total_head!,
    steer_count: steer_count!,
    heifer_count: heifer_count!,
    steer_heifer_ratio: total > 0 ? steer_count! / total : 0,
    source_hash: hash,
  };
}
