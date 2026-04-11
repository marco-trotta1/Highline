import { chromium } from 'playwright';
import type { FuturesSnapshot } from '../types';

const AGRIBEEF_URL = 'https://www.agribeef.com/market-quotes/';
const FUTURES_SELECTOR = 'table, [class*="futures"], [class*="market"]';
const TIMEOUT_MS = 30_000;

interface RawFuturesData {
  contract: string;
  price: number;
  change: number;
  changePct: number;
}

export async function scrapeFutures(): Promise<FuturesSnapshot | null> {
  let browser;
  try {
    browser = await chromium.launch({
      headless: process.env.PLAYWRIGHT_HEADLESS !== 'false',
    });
    const page = await browser.newPage();

    await page.goto(AGRIBEEF_URL, { waitUntil: 'networkidle', timeout: TIMEOUT_MS });
    await page.waitForSelector(FUTURES_SELECTOR, { timeout: TIMEOUT_MS });

    const raw: RawFuturesData | null = await page.evaluate(() => {
      // Adapt selectors to match the actual Agri Beef DOM after live inspection
      const rows = document.querySelectorAll('table tr, [class*="quote-row"], [class*="futures-row"]');
      if (!rows.length) return null;

      const firstRow = rows[0];
      const cells = firstRow.querySelectorAll('td, [class*="cell"]');
      if (cells.length < 3) return null;

      const contract = cells[0]?.textContent?.trim() ?? '';
      const price = parseFloat(cells[1]?.textContent?.replace(/[^0-9.-]/g, '') ?? '0');
      const change = parseFloat(cells[2]?.textContent?.replace(/[^0-9.-]/g, '') ?? '0');
      const changePct = parseFloat(cells[3]?.textContent?.replace(/[^0-9.%-]/g, '') ?? '0');

      if (!contract || isNaN(price)) return null;
      return { contract, price, change, changePct };
    });

    await page.close();

    if (!raw) {
      console.warn('[futures-scraper] Could not extract data from Agri Beef page');
      return null;
    }

    return {
      timestamp: new Date().toISOString(),
      front_month_contract: raw.contract,
      front_month_price: raw.price,
      change_today: raw.change,
      change_pct: raw.changePct,
      source: 'agribeef_scrape',
    };
  } catch (err) {
    console.error('[futures-scraper] Scrape failed:', err);
    return null;
  } finally {
    await browser?.close();
  }
}
