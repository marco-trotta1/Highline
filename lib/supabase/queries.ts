import { createServerClient } from './client';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CutoutDailyRow,
  NegotiatedSalesRow,
  SlaughterWeeklyRow,
  ColdStorageMonthlyRow,
  FuturesSnapshotRow,
  SubprimalPriceRow,
  DataHealthStatus,
  DashboardSnapshot,
} from '../types';
import {
  buildBidRangeCalculatorContext,
  buildMarketDirectionSignal,
} from '../market';
import {
  STALE_MS,
  checkStale,
  evaluateFuturesHealth,
  getLastUpdated,
} from './health';

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
    .order('date', { ascending: false })
    .gte('date', since);
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

export async function getYesterdayCutout(referenceDate?: string): Promise<CutoutDailyRow | null> {
  const supabase = createServerClient();
  const cutoffDate = referenceDate ?? new Date().toISOString().split('T')[0];
  const { data, error } = await supabase
    .from('cutout_daily')
    .select('*')
    .order('date', { ascending: false })
    .lt('date', cutoffDate)
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

  const [cutoutUpdated, negUpdated, slaughterUpdated, coldUpdated, futuresUpdated] = await Promise.all([
    getLastUpdated(supabase, 'cutout_daily', 'created_at'),
    getLastUpdated(supabase, 'negotiated_sales', 'created_at'),
    getLastUpdated(supabase, 'slaughter_weekly', 'created_at'),
    getLastUpdated(supabase, 'cold_storage_monthly', 'created_at'),
    getLastUpdated(supabase, 'futures_snapshots', 'timestamp'),
  ]);

  return [
    checkStale('cutout_daily', cutoutUpdated, STALE_MS.cutout_daily, now),
    checkStale('negotiated_sales', negUpdated, STALE_MS.negotiated_sales, now),
    evaluateFuturesHealth('futures_snapshots', futuresUpdated),
    checkStale('slaughter_weekly', slaughterUpdated, STALE_MS.slaughter_weekly, now),
    checkStale('cold_storage_monthly', coldUpdated, STALE_MS.cold_storage_monthly, now),
  ];
}

export async function getSubprimalPrices(
  supabase: SupabaseClient,
  date: string,
  grade: 'Choice' | 'Select' | 'Choice and Select'
): Promise<SubprimalPriceRow[]> {
  const { data, error } = await supabase
    .from('subprimal_prices')
    .select('*')
    .eq('date', date)
    .eq('grade', grade)
    .order('session', { ascending: true })
    .order('item_description', { ascending: true });
  if (error) return [];
  return (data ?? []) as SubprimalPriceRow[];
}

export async function getSubprimalPricesLatestDate(): Promise<SubprimalPriceRow[]> {
  const supabase = createServerClient();
  const { data: dateRow, error: dateError } = await supabase
    .from('subprimal_prices')
    .select('date')
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (dateError || !dateRow) return [];
  const { data, error } = await supabase
    .from('subprimal_prices')
    .select('*')
    .eq('date', (dateRow as { date: string }).date)
    .order('session', { ascending: true })
    .order('item_description', { ascending: true });
  if (error) return [];
  return (data ?? []) as SubprimalPriceRow[];
}

// Single-shot aggregator used by the dashboard Server Component and the
// polling-fallback /api/snapshot route. Fetches everything in parallel.
export async function getSnapshot(): Promise<DashboardSnapshot> {
  const [
    cutoutLatest,
    negotiatedToday,
    futuresLatest,
    slaughterLatest,
    slaughterHistory,
    coldStorageLatest,
    coldStorageHistory,
    negotiatedHistory,
    health,
  ] = await Promise.all([
    getLatestCutout(),
    getTodayNegotiated(),
    getLatestFutures(),
    getLatestSlaughter(),
    getSlaughterHistory(4),
    getLatestColdStorage(),
    getColdStorageHistory(12),
    getNegotiatedHistory(7),
    getDataHealth(),
  ]);
  const cutoutPrev = cutoutLatest ? await getYesterdayCutout(cutoutLatest.date) : null;

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

  const futuresHealth = health.find((row) => row.source === 'futures_snapshots');
  const marketDirection = buildMarketDirectionSignal({
    futures: futuresLatest,
    futuresHealth,
    negotiatedRows: negotiatedHistory,
    coldStorage: coldStorageLatest,
  });
  const calculatorContext = buildBidRangeCalculatorContext({
    negotiatedRows: negotiatedHistory,
    cutoutChoice: cutoutLatest?.choice_total ?? null,
    marketSignal: marketDirection,
  });

  return {
    cutout: { latest: cutoutLatest, yesterday: cutoutPrev },
    negotiated: { today: negotiatedToday },
    futures: { latest: futuresLatest },
    slaughter: { latest: slaughterLatest, fourWeekAvgHeiferPct },
    coldStorage: { latest: coldStorageLatest, history: coldStorageHistory },
    market: { direction: marketDirection, calculator: calculatorContext },
    health,
    fetchedAt: new Date().toISOString(),
  };
}
