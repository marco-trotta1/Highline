import { chromium } from 'playwright';
import type { Browser, Page } from 'playwright';
import type { FuturesSnapshot, ParserResult, ValidationError } from '../types';
import { ParseError, SourceFetchError, ValidationFailureError } from '../types';
import { sha256 } from '../utils/hash';

const AGRIBEEF_URL = 'https://iquote.agribeef.com/futures/';
const TIMEOUT_MS = 30_000;
const ROW_SELECTORS = [
  'table tbody tr',
  'table tr',
  '[data-testid*="futures"] tr',
  '[class*="futures"] tr',
];

type RawFuturesData = {
  contract: string;
  price: number;
  change: number;
  changePct: number;
  renderedText: string;
};

const LIVE_CATTLE_MONTH_CODES: Record<string, string> = {
  FEBRUARY: 'G',
  APRIL: 'J',
  JUNE: 'M',
  AUGUST: 'Q',
  OCTOBER: 'V',
  DECEMBER: 'Z',
};

function parseNumericToken(value: string): number | null {
  const normalized = value.replace(/,/g, '').replace(/[^0-9.+-]/g, '');
  if (!normalized) return null;
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePercentToken(value: string): number | null {
  return parseNumericToken(value.replace('%', ''));
}

function tokenizeRenderedRow(rowText: string): string[] {
  return rowText
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

export function extractFrontMonthFromRowText(rowText: string): RawFuturesData {
  const compactText = rowText.replace(/\s+/g, ' ').trim();
  if (!compactText) {
    throw new ParseError('Agri Beef futures widget rendered an empty row');
  }

  const monthYearMatch = compactText.match(
    /^(February|April|June|August|October|December)\s+(\d{4})\s+([+-]?\d+(?:\.\d+)?)\s+([+-]?\d+(?:\.\d+)?)/i
  );
  if (monthYearMatch) {
    const monthName = monthYearMatch[1].toUpperCase();
    const contractCode = LIVE_CATTLE_MONTH_CODES[monthName];
    const yearSuffix = monthYearMatch[2].slice(-2);
    const price = parseNumericToken(monthYearMatch[3]);
    const change = parseNumericToken(monthYearMatch[4]);

    if (!contractCode || price === null || change === null) {
      throw new ParseError(`Could not normalize Live Cattle row: ${compactText}`);
    }

    const previousPrice = price - change;
    const changePct = previousPrice > 0 ? (change / previousPrice) * 100 : 0;

    return {
      contract: `LE${contractCode}${yearSuffix}`,
      price,
      change,
      changePct,
      renderedText: compactText,
    };
  }

  const tokens = tokenizeRenderedRow(compactText);
  const contractIndex = tokens.findIndex((token) => /^LE[A-Z]\d{2}$/i.test(token));
  if (contractIndex === -1) {
    throw new ParseError(`Could not find a Live Cattle contract in row: ${compactText}`);
  }

  const contract = tokens[contractIndex].toUpperCase();
  const numericTokens = tokens
    .slice(contractIndex + 1)
    .map((token) => ({
      raw: token,
      number: token.includes('%') ? parsePercentToken(token) : parseNumericToken(token),
    }))
    .filter((token): token is { raw: string; number: number } => token.number !== null);

  if (numericTokens.length < 2) {
    throw new ParseError(`Could not extract price/change values from row: ${compactText}`);
  }

  const [priceToken, changeToken] = numericTokens;
  const pctToken =
    numericTokens.find((token) => token.raw.includes('%')) ??
    numericTokens.find((token) => Math.abs(token.number) <= 100 && token !== priceToken);

  return {
    contract,
    price: priceToken.number,
    change: changeToken.number,
    changePct: pctToken?.number ?? 0,
    renderedText: compactText,
  };
}

async function findRenderedRowText(page: Page): Promise<string> {
  for (const selector of ROW_SELECTORS) {
    const locator = page.locator(selector);
    const count = await locator.count();
    if (count === 0) continue;

    for (let index = 0; index < count; index += 1) {
      const text = (await locator.nth(index).innerText()).trim();
      if (
        /\bLE[A-Z]\d{2}\b/i.test(text) ||
        /^(February|April|June|August|October|December)\s+\d{4}\s+[+-]?\d+(?:\.\d+)?/i.test(
          text.replace(/\s+/g, ' ').trim()
        )
      ) {
        return text;
      }
    }
  }

  const bodyText = await page.locator('body').innerText();
  throw new ParseError(
    `Could not find a Live Cattle row in the Agri Beef futures widget. Page text sample: ${bodyText
      .replace(/\s+/g, ' ')
      .slice(0, 240)}`
  );
}

function validateSnapshot(record: FuturesSnapshot): void {
  const errors: ValidationError[] = [];

  if (!/^LE[A-Z]\d{2}$/i.test(record.front_month_contract)) {
    errors.push({
      field: 'front_month_contract',
      value: record.front_month_contract,
      reason: `front_month_contract ${record.front_month_contract} is not a Live Cattle contract code`,
    });
  }

  if (!Number.isFinite(record.front_month_price) || record.front_month_price <= 0) {
    errors.push({
      field: 'front_month_price',
      value: record.front_month_price,
      reason: `front_month_price ${record.front_month_price} must be a positive number`,
    });
  }

  if (!Number.isFinite(record.change_today) || !Number.isFinite(record.change_pct)) {
    errors.push({
      field: 'change_fields',
      value: { change_today: record.change_today, change_pct: record.change_pct },
      reason: 'change_today and change_pct must both be finite numbers',
    });
  }

  if (errors.length > 0) {
    throw new ValidationFailureError(
      errors.map((error) => error.reason).join('; '),
      errors
    );
  }
}

export async function scrapeFutures(
  browserFactory: () => Promise<Browser> = () =>
    chromium.launch({ headless: process.env.PLAYWRIGHT_HEADLESS !== 'false' })
): Promise<ParserResult<FuturesSnapshot, { url: string; renderedRow: string }>> {
  let browser: Browser | undefined;

  try {
    browser = await browserFactory();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown Playwright launch failure';
    throw new SourceFetchError(`Failed to launch Playwright for Agri Beef futures: ${message}`);
  }

  try {
    const page = await browser.newPage();
    await page.goto(AGRIBEEF_URL, { waitUntil: 'networkidle', timeout: TIMEOUT_MS });
    const renderedRow = await findRenderedRowText(page);
    await page.close();

    const parsed = extractFrontMonthFromRowText(renderedRow);
    const rawExtractedContent = { url: AGRIBEEF_URL, renderedRow };
    const hash = sha256(JSON.stringify(rawExtractedContent));
    const parsedRecord: FuturesSnapshot = {
      timestamp: new Date().toISOString(),
      front_month_contract: parsed.contract,
      front_month_price: parsed.price,
      change_today: parsed.change,
      change_pct: parsed.changePct,
      source: 'agribeef_scrape',
    };

    validateSnapshot(parsedRecord);

    return {
      parsedRecord,
      rawExtractedContent,
      sha256: hash,
    };
  } catch (error) {
    if (
      error instanceof SourceFetchError ||
      error instanceof ParseError ||
      error instanceof ValidationFailureError
    ) {
      throw error;
    }

    const message = error instanceof Error ? error.message : 'Unknown futures scrape failure';
    throw new SourceFetchError(`Agri Beef futures fetch failed: ${message}`);
  } finally {
    await browser.close();
  }
}
