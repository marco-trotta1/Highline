import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@mendable/firecrawl-js', () => ({
  default: vi.fn().mockImplementation(function () {
    return { scrapeUrl: vi.fn() };
  }),
}));

import FirecrawlApp from '@mendable/firecrawl-js';
import { parseCutout } from '../../lib/parsers/usda-cutout';

const MOCK_MARKDOWN = `
LM_XB459 - Daily Boxed Beef Cutout
Report Date: April 10, 2026

Choice Total: 302.50
Select Total: 288.00
Choice-Select Spread: 14.50

Primal Values:
Chuck: 230.00
Rib: 420.00
Loin: 380.00
Round: 220.00
Brisket: 210.00
Short Plate: 175.00
Flank: 195.00
`;

describe('parseCutout', () => {
  let mockScrapeUrl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockScrapeUrl = vi.fn();
    (FirecrawlApp as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      function () { return { scrapeUrl: mockScrapeUrl }; }
    );
  });

  it('parses all cutout fields', async () => {
    mockScrapeUrl.mockResolvedValue({ markdown: MOCK_MARKDOWN, success: true });
    const result = await parseCutout('test-api-key');
    expect(result.choice_total).toBe(302.5);
    expect(result.select_total).toBe(288.0);
    expect(result.choice_select_spread).toBe(14.5);
    expect(result.chuck).toBe(230.0);
    expect(result.rib).toBe(420.0);
    expect(result.loin).toBe(380.0);
    expect(result.round).toBe(220.0);
    expect(result.brisket).toBe(210.0);
    expect(result.short_plate).toBe(175.0);
    expect(result.flank).toBe(195.0);
    expect(result.source_hash).toHaveLength(64);
  });

  it('returns report_type from report header', async () => {
    mockScrapeUrl.mockResolvedValue({ markdown: MOCK_MARKDOWN, success: true });
    const result = await parseCutout('test-api-key');
    expect(result.report_type).toBe('LM_XB459');
  });
});
