import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@mendable/firecrawl-js', () => {
  return {
    default: vi.fn().mockImplementation(function () {
      return { scrapeUrl: vi.fn() };
    }),
  };
});

import FirecrawlApp from '@mendable/firecrawl-js';
import { parseSlaughter } from '../../lib/parsers/usda-slaughter';

const MOCK_MARKDOWN = `
LM_CT150 - Weekly Cattle Slaughter
Week Ending: April 05, 2026

Total Head Slaughtered: 540,000
Steers: 310,000
Heifers: 200,000
`;

describe('parseSlaughter', () => {
  let mockScrapeUrl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockScrapeUrl = vi.fn();
    (FirecrawlApp as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      function () { return { scrapeUrl: mockScrapeUrl }; }
    );
  });

  it('parses slaughter data correctly', async () => {
    mockScrapeUrl.mockResolvedValue({ markdown: MOCK_MARKDOWN, success: true });
    const result = await parseSlaughter('test-api-key');
    expect(result.total_head).toBe(540000);
    expect(result.steer_count).toBe(310000);
    expect(result.heifer_count).toBe(200000);
    expect(result.steer_heifer_ratio).toBeCloseTo(310000 / 510000, 5);
    expect(result.source_hash).toHaveLength(64);
  });

  it('throws when ratio is outside 0.3–0.7', async () => {
    const badMarkdown = MOCK_MARKDOWN.replace('Heifers: 200,000', 'Heifers: 20,000');
    mockScrapeUrl.mockResolvedValue({ markdown: badMarkdown, success: true });
    await expect(parseSlaughter('test-api-key')).rejects.toThrow('steer_heifer_ratio');
  });

  it('throws when total_head is outside 400k–700k', async () => {
    const badMarkdown = MOCK_MARKDOWN.replace('540,000', '1,200,000');
    mockScrapeUrl.mockResolvedValue({ markdown: badMarkdown, success: true });
    await expect(parseSlaughter('test-api-key')).rejects.toThrow('total_head');
  });
});
