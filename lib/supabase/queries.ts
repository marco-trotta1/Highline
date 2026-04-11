import { createServiceClient } from './client';
import type {
  CutoutDailyRow,
  NegotiatedSalesRow,
  SlaughterWeeklyRow,
  ColdStorageMonthlyRow,
  FuturesSnapshotRow,
  DataHealthStatus,
} from '../types';

const STALE_MS = {
  negotiated_sales: 4 * 60 * 60 * 1000,
  slaughter_weekly: 8 * 24 * 60 * 60 * 1000,
  cold_storage_monthly: 35 * 24 * 60 * 60 * 1000,
  futures_snapshots: 45 * 60 * 1000,
};

export async function getLatestCutout(): Promise<CutoutDailyRow | null> {
  const supabase = createServiceClient();
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
  const supabase = createServiceClient();
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
  const supabase = createServiceClient();
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
  const supabase = createServiceClient();
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
  const supabase = createServiceClient();
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
  const supabase = createServiceClient();
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
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('futures_snapshots')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(1)
    .single();
  if (error) return null;
  return data as FuturesSnapshotRow;
}

export async function getDataHealth(): Promise<DataHealthStatus[]> {
  const supabase = createServiceClient();
  const now = Date.now();

  async function getLastUpdated(table: string, timestampCol: string): Promise<string | null> {
    const { data } = await supabase
      .from(table)
      .select(timestampCol)
      .order(timestampCol, { ascending: false })
      .limit(1)
      .single();
    return (data as Record<string, string> | null)?.[timestampCol] ?? null;
  }

  const [negUpdated, slaughterUpdated, coldUpdated, futuresUpdated] = await Promise.all([
    getLastUpdated('negotiated_sales', 'created_at'),
    getLastUpdated('slaughter_weekly', 'created_at'),
    getLastUpdated('cold_storage_monthly', 'created_at'),
    getLastUpdated('futures_snapshots', 'created_at'),
  ]);

  function checkStale(source: string, lastUpdated: string | null, thresholdMs: number): DataHealthStatus {
    if (!lastUpdated) {
      return { source, last_updated: null, stale: true, stale_reason: 'No data yet' };
    }
    const age = now - new Date(lastUpdated).getTime();
    const stale = age > thresholdMs;
    return {
      source,
      last_updated: lastUpdated,
      stale,
      stale_reason: stale ? `Last update was ${Math.round(age / 60000)} minutes ago` : null,
    };
  }

  return [
    checkStale('negotiated_sales', negUpdated, STALE_MS.negotiated_sales),
    checkStale('slaughter_weekly', slaughterUpdated, STALE_MS.slaughter_weekly),
    checkStale('cold_storage_monthly', coldUpdated, STALE_MS.cold_storage_monthly),
    checkStale('futures_snapshots', futuresUpdated, STALE_MS.futures_snapshots),
  ];
}
