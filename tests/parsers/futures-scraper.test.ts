import { describe, it, expect, vi } from 'vitest';

import {
  extractFrontMonthFromRowText,
  scrapeFutures,
} from '../../lib/parsers/futures-scraper';
import { SourceFetchError } from '../../lib/types';

describe('scrapeFutures', () => {
  it('extracts the front-month contract from rendered widget text', () => {
    const parsed = extractFrontMonthFromRowText(
      "Live Cattle LEJ26 198.350 -0.425 -0.21% April 10, 2026 12:40 PM"
    );

    expect(parsed.contract).toBe('LEJ26');
    expect(parsed.price).toBe(198.35);
    expect(parsed.change).toBe(-0.425);
    expect(parsed.changePct).toBe(-0.21);
  });

  it('maps Agri Beef month-year rows back to Live Cattle contract codes', () => {
    const parsed = extractFrontMonthFromRowText(
      'April 2026 251.775 2.000 252.250 249.750 April 10, 2026 at 01:04 PM 251.775'
    );

    expect(parsed.contract).toBe('LEJ26');
    expect(parsed.price).toBe(251.775);
    expect(parsed.change).toBe(2);
    expect(parsed.changePct).toBeCloseTo(0.8007, 3);
  });

  it('returns a parser envelope on successful scrape', async () => {
    const closePage = vi.fn();
    const closeBrowser = vi.fn();
    const page = {
      goto: vi.fn().mockResolvedValue(null),
      locator: vi.fn((selector: string) => {
        if (selector === 'body') {
          return {
            innerText: vi.fn().mockResolvedValue('Live Cattle LEJ26 198.350 -0.425 -0.21%'),
          };
        }

        return {
          count: vi.fn().mockResolvedValue(1),
          nth: vi.fn().mockReturnValue({
            innerText: vi.fn().mockResolvedValue(
              'Live Cattle LEJ26 198.350 -0.425 -0.21% April 10, 2026 12:40 PM'
            ),
          }),
        };
      }),
      close: closePage,
    };

    const browserFactory = vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue(page),
      close: closeBrowser,
    });

    const result = await scrapeFutures(browserFactory as never);

    expect(result.parsedRecord.front_month_contract).toBe('LEJ26');
    expect(result.parsedRecord.front_month_price).toBe(198.35);
    expect(result.parsedRecord.change_today).toBe(-0.425);
    expect(result.parsedRecord.change_pct).toBe(-0.21);
    expect(result.rawExtractedContent.renderedRow).toContain('LEJ26');
    expect(result.sha256).toHaveLength(64);
    expect(closePage).toHaveBeenCalled();
    expect(closeBrowser).toHaveBeenCalled();
  });

  it('throws SourceFetchError when Playwright cannot launch', async () => {
    const browserFactory = vi
      .fn()
      .mockRejectedValue(new Error('Executable doesn’t exist'));

    await expect(scrapeFutures(browserFactory as never)).rejects.toThrow(SourceFetchError);
  });
});
