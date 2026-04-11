import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@mendable/firecrawl-js', () => ({
  default: vi.fn().mockImplementation(function () {
    return { scrapeUrl: vi.fn() };
  }),
}));

import FirecrawlApp from '@mendable/firecrawl-js';
import { parseColdStorage } from '../../lib/parsers/usda-cold-storage';

const MOCK_SUPABASE_DATA = [
  { total_beef_million_lbs: 480.0 },
  { total_beef_million_lbs: 470.0 },
  { total_beef_million_lbs: 460.0 },
  { total_beef_million_lbs: 455.0 },
  { total_beef_million_lbs: 450.0 },
];

const MOCK_MARKDOWN = `
USDA Cold Storage Report
March 2026

Total Beef in Cold Storage: 490.5 million pounds
`;

describe('parseColdStorage', () => {
  let mockScrapeUrl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockScrapeUrl = vi.fn();
    (FirecrawlApp as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      function () { return { scrapeUrl: mockScrapeUrl }; }
    );
  });

  it('parses cold storage data and computes 5yr avg pct', async () => {
    mockScrapeUrl.mockResolvedValue({ markdown: MOCK_MARKDOWN, success: true });
    const result = await parseColdStorage('test-api-key', MOCK_SUPABASE_DATA);
    expect(result.total_beef_million_lbs).toBe(490.5);
    expect(result.month).toBe(3);
    expect(result.year).toBe(2026);
    // 5yr avg = (480+470+460+455+450)/5 = 463
    // vs_5yr_avg_pct = ((490.5 - 463) / 463) * 100 ≈ 5.94
    expect(result.vs_5yr_avg_pct).toBeCloseTo(5.94, 1);
    expect(result.source_hash).toHaveLength(64);
  });

  it('computes 0% when no historical data available', async () => {
    mockScrapeUrl.mockResolvedValue({ markdown: MOCK_MARKDOWN, success: true });
    const result = await parseColdStorage('test-api-key', []);
    expect(result.vs_5yr_avg_pct).toBe(0);
  });
});
