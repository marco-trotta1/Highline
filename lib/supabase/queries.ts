import { createServerClient } from './client';
import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CutoutDailyRow,
  IngestionLogEntry,
  NegotiatedSalesRow,
  NegotiatedSessionHistoryRow,
  NegotiatedSessionPair,
  NegotiatedSessionRow,
  SlaughterWeeklyRow,
  ColdStorageMonthlyRow,
  FuturesSnapshotRow,
  SubprimalPriceRow,
  DataHealthStatus,
  DashboardSnapshot,
  InternalPriceRow,
  PerformanceDataRow,
  PerformancePrimal,
  PerformanceSummary,
  SignalSnapshotInsert,
  SignalSnapshotRow,
} from '../types';
import {
  buildSignalSnapshotInsert,
  buildBidRangeCalculatorContext,
  buildMarketDirectionSignal,
} from '../market';
import {
  type HealthProbe,
  STALE_MS,
  checkStale,
  evaluateFuturesHealth,
  getLastUpdated,
} from './health';

const CENTRAL_TIME_ZONE = 'America/Chicago';
const NEGOTIATED_INGESTION_SOURCES = ['negotiated', 'usda_negotiated'];

async function createIngestionLogClient(): Promise<SupabaseClient> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return createServerClient();
  const { createServiceRoleClient } = await import('./service');
  return createServiceRoleClient();
}

function formatDateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

function centralDateDaysAgo(days: number): string {
  const wholeDays = Math.max(0, Math.floor(days));
  return formatDateInTimeZone(
    new Date(Date.now() - wholeDays * 24 * 60 * 60 * 1000),
    CENTRAL_TIME_ZONE
  );
}

function normalizeNegotiatedSessions(
  rows: NegotiatedSessionRow[]
): NegotiatedSessionPair {
  return {
    AM: rows.find((row) => row.session === 'AM') ?? null,
    PM: rows.find((row) => row.session === 'PM') ?? null,
  };
}

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
  const { data: latestDateRow, error: latestDateError } = await supabase
    .from('negotiated_sales')
    .select('date')
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestDateError || !latestDateRow) return [];

  const { data, error } = await supabase
    .from('negotiated_sales')
    .select('*')
    .eq('date', (latestDateRow as { date: string }).date)
    .order('session', { ascending: true });
  if (error) return [];
  return (data ?? []) as NegotiatedSalesRow[];
}

export async function getTodayNegotiatedSessions(): Promise<NegotiatedSessionPair> {
  const supabase = createServerClient();
  const { data: latestDateRow, error: latestDateError } = await supabase
    .from('negotiated_sales')
    .select('date')
    .order('date', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latestDateError || !latestDateRow) return { AM: null, PM: null };

  const { data, error } = await supabase
    .from('negotiated_sales')
    .select('session,low,high,weighted_avg,volume_loads,session_quality')
    .eq('date', (latestDateRow as { date: string }).date)
    .order('session', { ascending: true });
  if (error) return { AM: null, PM: null };
  return normalizeNegotiatedSessions((data ?? []) as NegotiatedSessionRow[]);
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

export async function getNegotiatedSessionHistory(
  days: number = 7
): Promise<NegotiatedSessionHistoryRow[]> {
  const supabase = createServerClient();
  const since = centralDateDaysAgo(days);
  const { data, error } = await supabase
    .from('negotiated_sales')
    .select('date,session,weighted_avg,volume_loads')
    .order('date', { ascending: false })
    .order('session', { ascending: true })
    .gte('date', since);
  if (error) return [];
  return (data ?? []) as NegotiatedSessionHistoryRow[];
}

export async function getLatestNegotiatedIngestionTimestamp(): Promise<string | null> {
  const supabase = await createIngestionLogClient();
  const { data, error } = await supabase
    .from('ingestion_log')
    .select('timestamp')
    .in('source', NEGOTIATED_INGESTION_SOURCES)
    .eq('status', 'success')
    .order('timestamp', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return ((data ?? null) as Pick<IngestionLogEntry, 'timestamp'> | null)?.timestamp ?? null;
}

async function getLatestNegotiatedIngestionProbe(): Promise<HealthProbe> {
  const supabase = await createIngestionLogClient();
  const { data, error } = await supabase
    .from('ingestion_log')
    .select('timestamp')
    .in('source', NEGOTIATED_INGESTION_SOURCES)
    .eq('status', 'success')
    .order('timestamp', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return { lastUpdated: null, errorMessage: error.message };
  }

  return {
    lastUpdated: ((data ?? null) as Pick<IngestionLogEntry, 'timestamp'> | null)?.timestamp ?? null,
    errorMessage: null,
  };
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

export async function getLatestSignalSnapshot(): Promise<SignalSnapshotRow | null> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('signal_snapshots')
    .select('*')
    .order('timestamp', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data ?? null) as SignalSnapshotRow | null;
}

async function insertSignalSnapshot(
  snapshot: SignalSnapshotInsert
): Promise<SignalSnapshotRow | null> {
  try {
    const { createServiceRoleClient } = await import('./service');
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from('signal_snapshots')
      .insert(snapshot)
      .select('*')
      .single();

    if (error) {
      console.error('signal_snapshots insert failed', error);
      return null;
    }

    return data as SignalSnapshotRow;
  } catch (error) {
    console.error('signal_snapshots insert failed', error);
    return null;
  }
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
    getLatestNegotiatedIngestionProbe(),
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

const DAY_MS = 24 * 60 * 60 * 1000;

function dateDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString().split('T')[0];
}

function asFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getCutoutPrimalValue(
  cutout: CutoutDailyRow,
  primal: PerformancePrimal
): number | null {
  return asFiniteNumber(cutout[primal]);
}

function average(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (valid.length === 0) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function withSevenDayRollingAverage(rows: PerformanceDataRow[]): PerformanceDataRow[] {
  const byPrimal = new Map<PerformancePrimal, PerformanceDataRow[]>();

  for (const row of rows) {
    const primalRows = byPrimal.get(row.primal) ?? [];
    primalRows.push(row);
    byPrimal.set(row.primal, primalRows);
  }

  const rollingById = new Map<string, number | null>();
  for (const primalRows of byPrimal.values()) {
    const sorted = [...primalRows].sort((a, b) => a.date.localeCompare(b.date));
    for (const row of sorted) {
      const rowTime = new Date(`${row.date}T00:00:00Z`).getTime();
      const windowStart = rowTime - 6 * DAY_MS;
      const windowValues = sorted
        .filter((candidate) => {
          const candidateTime = new Date(`${candidate.date}T00:00:00Z`).getTime();
          return candidateTime >= windowStart && candidateTime <= rowTime;
        })
        .map((candidate) => candidate.delta);
      rollingById.set(row.id, average(windowValues));
    }
  }

  return rows.map((row) => ({
    ...row,
    seven_day_avg_delta: rollingById.get(row.id) ?? null,
  }));
}

export async function getPerformanceData(): Promise<PerformanceDataRow[]> {
  const supabase = createServerClient();
  const since = dateDaysAgo(30);

  const [internalResult, cutoutResult] = await Promise.all([
    supabase
      .from('internal_prices')
      .select('*')
      .gte('date', since)
      .order('date', { ascending: false })
      .order('primal', { ascending: true }),
    supabase
      .from('cutout_daily')
      .select('*')
      .gte('date', since)
      .order('date', { ascending: false }),
  ]);

  if (internalResult.error || cutoutResult.error) return [];

  const cutoutByDate = new Map<string, CutoutDailyRow>();
  for (const cutout of (cutoutResult.data ?? []) as CutoutDailyRow[]) {
    cutoutByDate.set(cutout.date, cutout);
  }

  const joined: PerformanceDataRow[] = [];
  for (const row of (internalResult.data ?? []) as InternalPriceRow[]) {
    const cutout = cutoutByDate.get(row.date);
    if (!cutout) continue;

    const internalPrice = asFiniteNumber(row.price_cwt);
    const cutoutValue = getCutoutPrimalValue(cutout, row.primal);
    if (internalPrice == null || cutoutValue == null) continue;

    joined.push({
      ...row,
      price_cwt: internalPrice,
      cutout_value: cutoutValue,
      delta: internalPrice - cutoutValue,
      seven_day_avg_delta: null,
    });
  }

  return withSevenDayRollingAverage(joined).sort((a, b) => {
    const dateSort = b.date.localeCompare(a.date);
    if (dateSort !== 0) return dateSort;
    return a.primal.localeCompare(b.primal);
  });
}

export async function getPerformanceSummary(
  rows?: PerformanceDataRow[]
): Promise<PerformanceSummary> {
  const performanceRows = rows ?? await getPerformanceData();
  if (performanceRows.length === 0) {
    return {
      today_avg_delta: null,
      seven_day_avg_delta: null,
      thirty_day_avg_delta: null,
      today_date: null,
    };
  }

  const latestDate = performanceRows.reduce(
    (latest, row) => (row.date > latest ? row.date : latest),
    performanceRows[0].date
  );
  const latestTime = new Date(`${latestDate}T00:00:00Z`).getTime();
  const sevenDayStart = latestTime - 6 * DAY_MS;

  return {
    today_avg_delta: average(
      performanceRows.filter((row) => row.date === latestDate).map((row) => row.delta)
    ),
    seven_day_avg_delta: average(
      performanceRows
        .filter((row) => {
          const rowTime = new Date(`${row.date}T00:00:00Z`).getTime();
          return rowTime >= sevenDayStart && rowTime <= latestTime;
        })
        .map((row) => row.delta)
    ),
    thirty_day_avg_delta: average(performanceRows.map((row) => row.delta)),
    today_date: latestDate,
  };
}

// Single-shot aggregator used by the dashboard Server Component and the
// polling-fallback /api/snapshot route. Fetches everything in parallel.
export async function getSnapshot(): Promise<DashboardSnapshot> {
  const [
    cutoutLatest,
    negotiatedToday,
    negotiatedSessions,
    negotiatedSessionHistory,
    negotiatedLastUpdated,
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
    getTodayNegotiatedSessions(),
    getNegotiatedSessionHistory(7),
    getLatestNegotiatedIngestionTimestamp(),
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
  const signalSnapshotInsert = buildSignalSnapshotInsert({
    futures: futuresLatest,
    negotiatedRows: negotiatedHistory,
    coldStorage: coldStorageLatest,
    marketSignal: marketDirection,
  });
  const insertedSignalSnapshot = signalSnapshotInsert
    ? await insertSignalSnapshot(signalSnapshotInsert)
    : null;
  const latestSignalSnapshot =
    insertedSignalSnapshot ?? (await getLatestSignalSnapshot());
  const calculatorContext = buildBidRangeCalculatorContext({
    negotiatedRows: negotiatedHistory,
    cutoutChoice: cutoutLatest?.choice_total ?? null,
    marketSignal: marketDirection,
  });

  return {
    cutout: { latest: cutoutLatest, yesterday: cutoutPrev },
    negotiated: {
      today: negotiatedToday,
      sessions: negotiatedSessions,
      sessionHistory: negotiatedSessionHistory,
      lastUpdated: negotiatedLastUpdated,
    },
    futures: { latest: futuresLatest },
    slaughter: { latest: slaughterLatest, fourWeekAvgHeiferPct },
    coldStorage: { latest: coldStorageLatest, history: coldStorageHistory },
    market: {
      direction: marketDirection,
      calculator: calculatorContext,
      latestSignalSnapshot,
    },
    health,
    fetchedAt: new Date().toISOString(),
  };
}
