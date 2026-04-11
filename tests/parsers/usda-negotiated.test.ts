import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Firecrawl before importing the parser
vi.mock('@mendable/firecrawl-js', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      scrapeUrl: vi.fn(),
    })),
  };
});

import FirecrawlApp from '@mendable/firecrawl-js';
import { parseNegotiatedSales } from '../../lib/parsers/usda-negotiated';

const MOCK_MARKDOWN = `
LM_CT113 - Negotiated Sales - Live Cattle
Report Date: April 10, 2026

Session: AM
Low Price: 188.00
High Price: 192.00
Weighted Average: 190.25
Volume: 15 Loads
`;

const THIN_MOCK_MARKDOWN = `
LM_CT113 - Negotiated Sales - Live Cattle
Report Date: April 10, 2026

Session: PM
Low Price: 189.00
High Price: 191.00
Weighted Average: 190.00
Volume: 8 Loads
`;

describe('parseNegotiatedSales', () => {
  let mockScrapeUrl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockScrapeUrl = vi.fn();
    (FirecrawlApp as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      function () { return { scrapeUrl: mockScrapeUrl }; }
    );
  });

  it('parses AM session from markdown', async () => {
    mockScrapeUrl.mockResolvedValue({ markdown: MOCK_MARKDOWN, success: true });
    const result = await parseNegotiatedSales('test-api-key');
    expect(result.session).toBe('AM');
    expect(result.low).toBe(188.0);
    expect(result.high).toBe(192.0);
    expect(result.weighted_avg).toBe(190.25);
    expect(result.volume_loads).toBe(15);
    expect(result.session_quality).toBe('active');
    expect(result.source_hash).toHaveLength(64);
  });

  it('flags thin session when volume < 10 loads', async () => {
    mockScrapeUrl.mockResolvedValue({ markdown: THIN_MOCK_MARKDOWN, success: true });
    const result = await parseNegotiatedSales('test-api-key');
    expect(result.session_quality).toBe('thin');
    expect(result.volume_loads).toBe(8);
  });

  it('throws ParseError when weighted_avg is out of range', async () => {
    const badMarkdown = MOCK_MARKDOWN.replace('190.25', '50.00');
    mockScrapeUrl.mockResolvedValue({ markdown: badMarkdown, success: true });
    await expect(parseNegotiatedSales('test-api-key')).rejects.toThrow('weighted_avg');
  });

  it('throws ParseError when volume is out of range', async () => {
    const badMarkdown = MOCK_MARKDOWN.replace('15 Loads', '600 Loads');
    mockScrapeUrl.mockResolvedValue({ markdown: badMarkdown, success: true });
    await expect(parseNegotiatedSales('test-api-key')).rejects.toThrow('volume_loads');
  });

  it('throws when scrape returns no markdown', async () => {
    mockScrapeUrl.mockResolvedValue({ markdown: '', success: true });
    await expect(parseNegotiatedSales('test-api-key')).rejects.toThrow();
  });
});
