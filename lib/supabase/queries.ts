import { createServerClient } from './client';
import type {
  CutoutDailyRow,
  NegotiatedSalesRow,
  SlaughterWeeklyRow,
  ColdStorageMonthlyRow,
  FuturesSnapshotRow,
  DataHealthStatus,
  DashboardSnapshot,
} from '../types';

const STALE_MS = {
  cutout_daily: 4 * 60 * 60 * 1000,
  negotiated_sales: 4 * 60 * 60 * 1000,
  slaughter_weekly: 8 * 24 * 60 * 60 * 1000,
  cold_storage_monthly: 35 * 24 * 60 * 60 * 1000,
  futures_snapshots: 45 * 60 * 1000,
};

type HealthProbe = {
  lastUpdated: string | null;
  errorMessage: string | null;
};

export async function getLatestCutout(): Promise<CutoutDailyRow | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('cutout_daily')
    .select('*')
    .order('date', { ascending: false })
    .limit(1)
    .single();
  if (error) return null;
  return data as CutoutDailyRow;
}

export async function getCutoutHistory(days: number): Promise<CutoutDailyRow[]> {
  const supabase = createServerClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('cutout_daily')
    .select('*')
    .gte('date', since)
    .order('date', { ascending: false });
  if (error) return [];
  return (data ?? []) as CutoutDailyRow[];
}

export async function getTodayNegotiated(): Promise<NegotiatedSalesRow[]> {
  const supabase = createServerClient();
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('negotiated_sales')
    .select('*')
    .eq('date', today)
    .order('session', { ascending: true });
  if (error) return [];
  return (data ?? []) as NegotiatedSalesRow[];
}

export async function getNegotiatedHistory(days: number): Promise<NegotiatedSalesRow[]> {
  const supabase = createServerClient();
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('negotiated_sales')
    .select('*')
    .gte('date', since)
    .order('date', { ascending: false });
  if (error) return [];
  return (data ?? []) as NegotiatedSalesRow[];
}

export async function getLatestSlaughter(): Promise<SlaughterWeeklyRow | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('slaughter_weekly')
    .select('*')
    .order('week_ending', { ascending: false })
    .limit(1)
    .single();
  if (error) return null;
  return data as SlaughterWeeklyRow;
}

export async function getLatestColdStorage(): Promise<ColdStorageMonthlyRow | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('cold_storage_monthly')
    .select('*')
    .order('year', { ascending: false })
    .order('month', { ascending: false })
    .limit(1)
    .single();
  if (error) return null;
  return data as ColdStorageMonthlyRow;
}

export async function getLatestFutures(): Promise<FuturesSnapshotRow | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('futures_snapshots')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(1)
    .single();
  if (error) return null;
  return data as FuturesSnapshotRow;
}

export async function getYesterdayCutout(): Promise<CutoutDailyRow | null> {
  const supabase = createServerClient();
  const today = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('cutout_daily')
    .select('*')
    .order('date', { ascending: false })
    .lt('date', today)
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data ?? null) as CutoutDailyRow | null;
}

export async function getSlaughterHistory(weeks: number): Promise<SlaughterWeeklyRow[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('slaughter_weekly')
    .select('*')
    .order('week_ending', { ascending: false })
    .limit(weeks);
  if (error) return [];
  return (data ?? []) as SlaughterWeeklyRow[];
}

export async function getColdStorageHistory(months: number): Promise<ColdStorageMonthlyRow[]> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('cold_storage_monthly')
    .select('*')
    .order('year', { ascending: false })
    .order('month', { ascending: false })
    .limit(months);
  if (error) return [];
  return ((data ?? []) as ColdStorageMonthlyRow[]).reverse();
}

export async function getDataHealth(): Promise<DataHealthStatus[]> {
  const supabase = createServerClient();
  const now = Date.now();

  async function getLastUpdated(table: string, timestampCol: string): Promise<HealthProbe> {
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

  const [cutoutUpdated, negUpdated, slaughterUpdated, coldUpdated, futuresUpdated] = await Promise.all([
    getLastUpdated('cutout_daily', 'created_at'),
    getLastUpdated('negotiated_sales', 'created_at'),
    getLastUpdated('slaughter_weekly', 'created_at'),
    getLastUpdated('cold_storage_monthly', 'created_at'),
    getLastUpdated('futures_snapshots', 'created_at'),
  ]);

  function checkStale(
    source: string,
    probe: HealthProbe,
    thresholdMs: number
  ): DataHealthStatus {
    if (probe.errorMessage) {
      return {
        source,
        state: 'error',
        last_updated: null,
        stale: false,
        stale_reason: 'Query failed',
        error_message: probe.errorMessage,
      };
    }

    const { lastUpdated } = probe;

    if (!lastUpdated) {
      return {
        source,
        state: 'no_data',
        last_updated: null,
        stale: false,
        stale_reason: 'No data yet',
        error_message: null,
      };
    }

    const age = now - new Date(lastUpdated).getTime();
    const stale = age > thresholdMs;
    return {
      source,
      state: stale ? 'stale' : 'fresh',
      last_updated: lastUpdated,
      stale,
      stale_reason: stale ? `Last update was ${Math.round(age / 60000)} minutes ago` : null,
      error_message: null,
    };
  }

  return [
    checkStale('cutout_daily', cutoutUpdated, STALE_MS.cutout_daily),
    checkStale('negotiated_sales', negUpdated, STALE_MS.negotiated_sales),
    checkStale('futures_snapshots', futuresUpdated, STALE_MS.futures_snapshots),
    checkStale('slaughter_weekly', slaughterUpdated, STALE_MS.slaughter_weekly),
    checkStale('cold_storage_monthly', coldUpdated, STALE_MS.cold_storage_monthly),
  ];
}

// Single-shot aggregator used by the dashboard Server Component and the
// polling-fallback /api/snapshot route. Fetches everything in parallel.
export async function getSnapshot(): Promise<DashboardSnapshot> {
  const [
    cutoutLatest,
    cutoutPrev,
    negotiatedToday,
    futuresLatest,
    slaughterLatest,
    slaughterHistory,
    coldStorageLatest,
    coldStorageHistory,
    health,
  ] = await Promise.all([
    getLatestCutout(),
    getYesterdayCutout(),
    getTodayNegotiated(),
    getLatestFutures(),
    getLatestSlaughter(),
    getSlaughterHistory(4),
    getLatestColdStorage(),
    getColdStorageHistory(12),
    getDataHealth(),
  ]);

  // 4-week heifer % average from the last 4 slaughter rows.
  const fourWeekAvgHeiferPct = (() => {
    if (slaughterHistory.length === 0) return null;
    const pctSum = slaughterHistory.reduce((acc, row) => {
      const denom = row.steer_count + row.heifer_count;
      if (denom === 0) return acc;
      return acc + (row.heifer_count / denom) * 100;
    }, 0);
    return pctSum / slaughterHistory.length;
  })();

  return {
    cutout: { latest: cutoutLatest, yesterday: cutoutPrev },
    negotiated: { today: negotiatedToday },
    futures: { latest: futuresLatest },
    slaughter: { latest: slaughterLatest, fourWeekAvgHeiferPct },
    coldStorage: { latest: coldStorageLatest, history: coldStorageHistory },
    health,
    fetchedAt: new Date().toISOString(),
  };
}
