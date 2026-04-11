import { describe, it, expect, vi } from 'vitest';

vi.mock('playwright', () => ({
  chromium: {
    launch: vi.fn(),
  },
}));

import { chromium } from 'playwright';
import { scrapeFutures } from '../../lib/parsers/futures-scraper';

describe('scrapeFutures', () => {
  it('returns a FuturesSnapshot on successful scrape', async () => {
    const mockPage = {
      goto: vi.fn().mockResolvedValue(null),
      waitForSelector: vi.fn().mockResolvedValue(null),
      evaluate: vi.fn().mockResolvedValue({
        contract: 'LCM26',
        price: 190.5,
        change: -1.25,
        changePct: -0.65,
      }),
      close: vi.fn(),
    };
    const mockBrowser = {
      newPage: vi.fn().mockResolvedValue(mockPage),
      close: vi.fn(),
    };
    (chromium.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

    const result = await scrapeFutures();
    expect(result).not.toBeNull();
    expect(result!.front_month_contract).toBe('LCM26');
    expect(result!.front_month_price).toBe(190.5);
    expect(result!.change_today).toBe(-1.25);
    expect(result!.change_pct).toBe(-0.65);
    expect(result!.source).toBe('agribeef_scrape');
    expect(result!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns null when page fails to load', async () => {
    const mockBrowser = {
      newPage: vi.fn().mockRejectedValue(new Error('Navigation timeout')),
      close: vi.fn(),
    };
    (chromium.launch as ReturnType<typeof vi.fn>).mockResolvedValue(mockBrowser);

    const result = await scrapeFutures();
    expect(result).toBeNull();
  });
});
