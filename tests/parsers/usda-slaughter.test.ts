import { describe, it, expect } from 'vitest';

import { parseSlaughterReportText } from '../../lib/parsers/usda-slaughter';
import { ValidationFailureError } from '../../lib/types';

const MOCK_REPORT_TEXT = `
Daily Livestock and Poultry Slaughter
Report for April 10, 2026 - Final
Current Day Slaughter
Previous Day Slaughter
Previous Day Breakdown
Prev Week Last Year 2026 2025 YTD
Fri Apr 10, 2026 Week Ago Year Ago WTD WTD WTD YTD YTD % Change
Calves 1,000 1,000 515 5,000 5,000 2,421 32,591 37,849 -13.9%
Cattle 83,000 96,000 94,976 508,000 525,000 558,926 7,579,788 8,425,309 -10.0%
Prev Week Last Year 2026 2025 YTD
Sat Apr 11, 2026 Week Ago Year Ago WTD WTD WTD YTD YTD % Change
Cattle 4,000 8,000 5,046 512,000 533,000 563,972 7,583,788 8,430,355 -10.0%
Thu Apr 9, 2026
Cattle
Steers/Heifers 84,000
Cows/Bulls 21,000
`;

describe('parseSlaughter', () => {
  it('parses the official slaughter text into a parser envelope', () => {
    const result = parseSlaughterReportText(MOCK_REPORT_TEXT);

    expect(result.parsedRecord.week_ending).toBe('2026-04-11');
    expect(result.parsedRecord.total_head).toBe(512000);
    expect(result.parsedRecord.steer_count).toBe(84000);
    expect(result.parsedRecord.heifer_count).toBe(21000);
    expect(result.parsedRecord.steer_heifer_ratio).toBeCloseTo(0.8, 4);
    expect(result.sha256).toHaveLength(64);
  });

  it('throws ValidationFailureError when the projected total is out of range', () => {
    const invalidText = MOCK_REPORT_TEXT.replace('512,000', '900,000');

    expect(() => parseSlaughterReportText(invalidText)).toThrow(ValidationFailureError);
  });
});
