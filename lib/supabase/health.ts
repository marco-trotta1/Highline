import type { SupabaseClient } from '@supabase/supabase-js';
import type { DataHealthStatus } from '../types';
import { formatDateShort } from '../format';

const FUTURES_OPEN_MINUTES = 8 * 60 + 30;
const FUTURES_CLOSE_MINUTES = 13 * 60 + 5;
const FUTURES_INTRADAY_STALE_MS = 90 * 60 * 1000;

export const STALE_MS = {
  cutout_daily: 4 * 60 * 60 * 1000,
  negotiated_sales: 4 * 60 * 60 * 1000,
  slaughter_weekly: 8 * 24 * 60 * 60 * 1000,
  cold_storage_monthly: 35 * 24 * 60 * 60 * 1000,
  futures_snapshots: 90 * 60 * 1000,
};

export type HealthProbe = {
  lastUpdated: string | null;
  errorMessage: string | null;
};

const chicagoFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  weekday: 'short',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function chicagoParts(now: Date) {
  const parts = Object.fromEntries(
    chicagoFormatter.formatToParts(now).map((part) => [part.type, part.value])
  );

  return {
    weekday: parts.weekday ?? 'Mon',
    isoDate: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour ?? '0') * 60 + Number(parts.minute ?? '0'),
  };
}

function previousBusinessDate(isoDate: string): string {
  const date = new Date(`${isoDate}T12:00:00Z`);
  do {
    date.setUTCDate(date.getUTCDate() - 1);
  } while (date.getUTCDay() === 0 || date.getUTCDay() === 6);

  return date.toISOString().slice(0, 10);
}

function isChicagoMarketOpen(now: Date): boolean {
  const parts = chicagoParts(now);
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return false;
  return (
    parts.minutes >= FUTURES_OPEN_MINUTES &&
    parts.minutes <= FUTURES_CLOSE_MINUTES
  );
}

function expectedFuturesSessionDate(now: Date): string {
  const parts = chicagoParts(now);
  if (parts.weekday === 'Sat') return previousBusinessDate(parts.isoDate);
  if (parts.weekday === 'Sun') return previousBusinessDate(parts.isoDate);
  if (parts.minutes < FUTURES_OPEN_MINUTES) return previousBusinessDate(parts.isoDate);
  return parts.isoDate;
}

function errorState(source: string, errorMessage: string): DataHealthStatus {
  return {
    source,
    state: 'error',
    last_updated: null,
    stale: false,
    stale_reason: 'Query failed',
    error_message: errorMessage,
  };
}

function noDataState(source: string): DataHealthStatus {
  return {
    source,
    state: 'no_data',
    last_updated: null,
    stale: false,
    stale_reason: 'No data yet',
    error_message: null,
  };
}

export async function getLastUpdated(
  supabase: SupabaseClient,
  table: string,
  timestampCol: string
): Promise<HealthProbe> {
  const { data, error } = await supabase
    .from(table)
    .select(timestampCol)
    .order(timestampCol, { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { lastUpdated: null, errorMessage: error.message };
  }

  return {
    lastUpdated: (data as Record<string, string> | null)?.[timestampCol] ?? null,
    errorMessage: null,
  };
}

export function checkStale(
  source: string,
  probe: HealthProbe,
  thresholdMs: number,
  now = Date.now()
): DataHealthStatus {
  if (probe.errorMessage) return errorState(source, probe.errorMessage);
  if (!probe.lastUpdated) return noDataState(source);

  const age = now - new Date(probe.lastUpdated).getTime();
  const stale = age > thresholdMs;
  return {
    source,
    state: stale ? 'stale' : 'fresh',
    last_updated: probe.lastUpdated,
    stale,
    stale_reason: stale ? `Last update was ${Math.round(age / 60000)} minutes ago` : null,
    error_message: null,
  };
}

export function evaluateFuturesHealth(
  source: string,
  probe: HealthProbe,
  now = new Date()
): DataHealthStatus {
  if (probe.errorMessage) return errorState(source, probe.errorMessage);
  if (!probe.lastUpdated) return noDataState(source);

  const snapshotTime = new Date(probe.lastUpdated);
  const ageMs = now.getTime() - snapshotTime.getTime();
  const marketOpen = isChicagoMarketOpen(now);
  const expectedDate = expectedFuturesSessionDate(now);
  const snapshotDate = chicagoParts(snapshotTime).isoDate;

  let staleReason: string | null = null;

  if (snapshotDate < expectedDate) {
    staleReason = `Last futures snapshot is from ${formatDateShort(snapshotDate)}`;
  } else if (marketOpen && ageMs > FUTURES_INTRADAY_STALE_MS) {
    staleReason = `Last update was ${Math.round(ageMs / 60000)} minutes ago`;
  }

  return {
    source,
    state: staleReason ? 'stale' : 'fresh',
    last_updated: probe.lastUpdated,
    stale: Boolean(staleReason),
    stale_reason: staleReason,
    error_message: null,
  };
}
