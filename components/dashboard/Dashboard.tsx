'use client';

import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import type {
  DashboardSnapshot,
  CutoutDailyRow,
  NegotiatedSalesRow,
  FuturesSnapshotRow,
} from '@/lib/types';
import { TopNav } from '@/components/nav/TopNav';
import { CutoutCard } from '@/components/cards/CutoutCard';
import { NegotiatedCard } from '@/components/cards/NegotiatedCard';
import { NegotiatedSessionsCard } from '@/components/cards/NegotiatedSessionsCard';
import { FuturesCard } from '@/components/cards/FuturesCard';
import { SlaughterCard } from '@/components/cards/SlaughterCard';
import { ColdStorageCard } from '@/components/cards/ColdStorageCard';
import { DataHealthPanel } from '@/components/cards/DataHealthPanel';
import { DirectionalIndicatorCard } from '@/components/cards/DirectionalIndicatorCard';
import { BidRangeCalculatorCard } from '@/components/cards/BidRangeCalculatorCard';
import { KpiCard } from '@/components/dashboard/KpiCard';
import { SignalBreakdownTable } from '@/components/dashboard/SignalBreakdownTable';
import { CutoutTrendCard } from '@/components/dashboard/CutoutTrendCard';
import {
  formatCurrency,
  formatDateTime,
  formatInt,
  formatSignedCurrency,
} from '@/lib/format';
import { subscribeToSnapshot } from '@/lib/supabase/realtime';

type DashboardProps = {
  initialData: DashboardSnapshot;
};

type FlashKey = 'cutout' | 'negotiated' | 'futures';
type ConnectionStatus = 'connected' | 'reconnecting';
type FreshnessSource = 'cutout' | 'negotiated' | 'slaughter' | 'futures';
type FreshnessSeverity = 'failed' | 'stale';
type IngestionLogRow = {
  source: string;
  timestamp: string;
  status: 'success' | 'failed' | 'duplicate';
};
type FreshnessWarning = {
  source: FreshnessSource;
  hoursAgo: number | null;
  severity: FreshnessSeverity;
  signature: string;
};

const FRESHNESS_STALE_MS = 4 * 60 * 60 * 1000;
const FRESHNESS_DISMISS_KEY = 'highline:freshness-warning-dismissed';
const FRESHNESS_SOURCE_ALIASES: Record<FreshnessSource, string[]> = {
  cutout: ['cutout', 'usda_cutout'],
  negotiated: ['negotiated', 'usda_negotiated'],
  slaughter: ['slaughter', 'usda_slaughter'],
  futures: ['futures', 'usda_futures_agribeef'],
};

function sourceLabel(source: FreshnessSource): string {
  return source.replace('_', ' ');
}

function buildFreshnessWarning(rows: IngestionLogRow[]): FreshnessWarning | null {
  const now = Date.now();
  const warnings: FreshnessWarning[] = [];

  for (const [source, aliases] of Object.entries(FRESHNESS_SOURCE_ALIASES) as Array<[FreshnessSource, string[]]>) {
    const sourceRows = rows
      .filter((row) => aliases.includes(row.source))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    const latest = sourceRows[0];
    const latestSuccess = sourceRows.find((row) => row.status === 'success');
    const lastSuccessMs = latestSuccess ? new Date(latestSuccess.timestamp).getTime() : Number.NaN;
    const hoursAgo = Number.isFinite(lastSuccessMs)
      ? Math.max(0, Math.round((now - lastSuccessMs) / (60 * 60 * 1000)))
      : null;

    if (latest?.status === 'failed') {
      warnings.push({
        source,
        hoursAgo,
        severity: 'failed',
        signature: `${source}:failed:${latest.timestamp}`,
      });
      continue;
    }

    if (!latestSuccess || now - lastSuccessMs > FRESHNESS_STALE_MS) {
      warnings.push({
        source,
        hoursAgo,
        severity: 'stale',
        signature: `${source}:stale:${latestSuccess?.timestamp ?? 'none'}`,
      });
    }
  }

  return warnings.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === 'failed' ? -1 : 1;
    return (b.hoursAgo ?? Number.POSITIVE_INFINITY) - (a.hoursAgo ?? Number.POSITIVE_INFINITY);
  })[0] ?? null;
}

const FILTER_OPTIONS = {
  brand: [
    { value: 'all', label: 'All Brands' },
    { value: 'commodity', label: 'Commodity' },
    { value: 'program', label: 'Program' },
    { value: 'natural', label: 'Natural' },
    { value: 'branded', label: 'Branded' },
  ],
  grade: [
    { value: 'all', label: 'All Grades' },
    { value: 'choice', label: 'Choice' },
    { value: 'select', label: 'Select' },
    { value: 'prime', label: 'Prime' },
  ],
  channel: [
    { value: 'all', label: 'All Channels' },
    { value: 'cash', label: 'Cash' },
    { value: 'formula', label: 'Formula' },
    { value: 'grid', label: 'Grid' },
  ],
  dateRange: [
    { value: '7d', label: 'Last 7 days' },
    { value: '14d', label: 'Last 14 days' },
    { value: '30d', label: 'Last 30 days' },
    { value: '90d', label: 'Last 90 days' },
  ],
} as const;

const FILTER_DEFAULTS = {
  brand: 'all',
  grade: 'all',
  channel: 'all',
  dateRange: '7d',
};

const PILL_CLASS =
  'rounded-md border border-[#2A3040] bg-[#1E2330] px-3 py-1.5 text-sm text-zinc-200 outline-none focus-visible:ring-1 focus-visible:ring-blue-500';

function FilterBar() {
  const [filters, setFilters] = useState(FILTER_DEFAULTS);
  const reset = () => setFilters(FILTER_DEFAULTS);
  const isDirty =
    filters.brand !== FILTER_DEFAULTS.brand ||
    filters.grade !== FILTER_DEFAULTS.grade ||
    filters.channel !== FILTER_DEFAULTS.channel ||
    filters.dateRange !== FILTER_DEFAULTS.dateRange;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Brand"
        value={filters.brand}
        onChange={(e) => setFilters((f) => ({ ...f, brand: e.target.value }))}
        className={PILL_CLASS}
      >
        {FILTER_OPTIONS.brand.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Grade"
        value={filters.grade}
        onChange={(e) => setFilters((f) => ({ ...f, grade: e.target.value }))}
        className={PILL_CLASS}
      >
        {FILTER_OPTIONS.grade.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Channel"
        value={filters.channel}
        onChange={(e) => setFilters((f) => ({ ...f, channel: e.target.value }))}
        className={PILL_CLASS}
      >
        {FILTER_OPTIONS.channel.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <select
        aria-label="Date Range"
        value={filters.dateRange}
        onChange={(e) => setFilters((f) => ({ ...f, dateRange: e.target.value }))}
        className={PILL_CLASS}
      >
        {FILTER_OPTIONS.dateRange.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={reset}
        disabled={!isDirty}
        className="ml-auto rounded-md border border-[#2A3040] bg-[#1E2330] px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:bg-[#2A3040] disabled:opacity-50"
      >
        Reset
      </button>
    </div>
  );
}

export function Dashboard({ initialData }: DashboardProps) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(initialData);
  const [connection, setConnection] = useState<ConnectionStatus>('connected');
  const [freshnessWarning, setFreshnessWarning] = useState<FreshnessWarning | null>(null);
  const [dismissedFreshnessSignature, setDismissedFreshnessSignature] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [flash, setFlash] = useState<Record<FlashKey, boolean>>({
    cutout: false,
    negotiated: false,
    futures: false,
  });

  const flashTimers = useRef<Record<FlashKey, ReturnType<typeof setTimeout> | null>>({
    cutout: null,
    negotiated: null,
    futures: null,
  });
  const healthBySource = Object.fromEntries(
    snapshot.health.map((row) => [row.source, row])
  );

  const triggerFlash = (key: FlashKey) => {
    setFlash((prev) => ({ ...prev, [key]: true }));
    const existing = flashTimers.current[key];
    if (existing) clearTimeout(existing);
    flashTimers.current[key] = setTimeout(() => {
      setFlash((prev) => ({ ...prev, [key]: false }));
    }, 1500);
  };

  const refreshSnapshot = useEffectEvent(async () => {
    try {
      const res = await fetch('/api/snapshot', { cache: 'no-store' });
      if (!res.ok) return;
      const data = (await res.json()) as DashboardSnapshot;
      setSnapshot(data);
    } catch {
      /* swallow — next refresh will retry */
    }
  });

  useEffect(() => {
    let cancelled = false;

    const loadFreshness = async () => {
      const res = await fetch('/api/ingestion-health', { cache: 'no-store' });
      if (cancelled || !res.ok) return;
      const rows = (await res.json()) as IngestionLogRow[];
      if (cancelled) return;
      const warning = buildFreshnessWarning(rows);
      if (!warning) localStorage.removeItem(FRESHNESS_DISMISS_KEY);
      setDismissedFreshnessSignature(localStorage.getItem(FRESHNESS_DISMISS_KEY));
      setFreshnessWarning(warning);
    };

    void loadFreshness();
    const interval = setInterval(loadFreshness, 60_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const timersAtCleanup = flashTimers.current;
    const unsubscribe = subscribeToSnapshot(
      async (table, row) => {
        if (table === 'cutout_daily') {
          const next = row as CutoutDailyRow;
          setSnapshot((prev) => {
            const prevLatest = prev.cutout.latest;
            const isNewer =
              !prevLatest || new Date(next.date).getTime() >= new Date(prevLatest.date).getTime();
            if (!isNewer) return prev;
            return {
              ...prev,
              cutout: {
                latest: next,
                yesterday: prevLatest && prevLatest.date !== next.date ? prevLatest : prev.cutout.yesterday,
              },
            };
          });
          triggerFlash('cutout');
        } else if (table === 'negotiated_sales') {
          const next = row as NegotiatedSalesRow;
          setSnapshot((prev) => {
            const without = prev.negotiated.today.filter((r) => r.id !== next.id);
            return {
              ...prev,
              negotiated: { ...prev.negotiated, today: [...without, next] },
            };
          });
          triggerFlash('negotiated');
        } else if (table === 'futures_snapshots') {
          const next = row as FuturesSnapshotRow;
          setSnapshot((prev) => {
            const prevLatest = prev.futures.latest;
            const isNewer =
              !prevLatest ||
              new Date(next.timestamp).getTime() >= new Date(prevLatest.timestamp).getTime();
            if (!isNewer) return prev;
            return { ...prev, futures: { latest: next } };
          });
          triggerFlash('futures');
        }
        await refreshSnapshot();
      },
      (status) => {
        setConnection(status === 'connected' ? 'connected' : 'reconnecting');
      }
    );

    return () => {
      unsubscribe();
      for (const key of Object.keys(timersAtCleanup) as FlashKey[]) {
        const t = timersAtCleanup[key];
        if (t) clearTimeout(t);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const interval = setInterval(async () => {
      if (cancelled) return;
      await refreshSnapshot();
    }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const kpis = useMemo(() => {
    const latest = snapshot.cutout.latest;
    const yesterday = snapshot.cutout.yesterday;
    const cutoutDelta =
      latest && yesterday ? latest.choice_total - yesterday.choice_total : null;
    const cutoutDeltaPct =
      cutoutDelta != null && yesterday && yesterday.choice_total !== 0
        ? (cutoutDelta / yesterday.choice_total) * 100
        : null;
    const cutoutSpark = [yesterday, latest]
      .filter((row): row is CutoutDailyRow => row !== null)
      .map((row) => row.choice_total);
    const cutoutValue =
      cutoutDelta != null
        ? `${formatSignedCurrency(cutoutDelta, 2)}`
        : '—';

    const today = snapshot.negotiated.today;
    const negTodayHead = today.reduce((sum, r) => sum + (r.volume_loads ?? 0), 0);
    const dailyVolumes = new Map<string, number>();
    for (const row of snapshot.negotiated.sessionHistory) {
      dailyVolumes.set(row.date, (dailyVolumes.get(row.date) ?? 0) + (row.volume_loads ?? 0));
    }
    const recentDays = Array.from(dailyVolumes.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-7);
    const negSparkValues = recentDays.map(([, v]) => v);
    const negAvg =
      recentDays.length > 0
        ? recentDays.reduce((sum, [, v]) => sum + v, 0) / recentDays.length
        : null;
    const negDeltaPct =
      negAvg != null && negAvg !== 0 ? ((negTodayHead - negAvg) / negAvg) * 100 : null;
    const negValue = today.length > 0 ? formatInt(negTodayHead) : '—';

    const futLatest = snapshot.futures.latest;
    const futValue = futLatest ? formatCurrency(futLatest.front_month_price, 2) : '—';
    const futDeltaPct = futLatest?.change_pct ?? null;
    const futSparkValues = futLatest
      ? [
          futLatest.front_month_price - futLatest.change_today,
          futLatest.front_month_price,
        ]
      : [];

    return {
      cutout: {
        value: cutoutValue,
        deltaPct: cutoutDeltaPct,
        spark: cutoutSpark,
      },
      negotiated: {
        value: negValue,
        deltaPct: negDeltaPct,
        spark: negSparkValues,
      },
      futures: {
        value: futValue,
        deltaPct: futDeltaPct,
        spark: futSparkValues,
      },
    };
  }, [snapshot]);

  return (
    <>
      <TopNav health={snapshot.health} connection={connection} />
      <main className="mx-auto w-full max-w-7xl px-4 pb-[env(safe-area-inset-bottom)] pt-6 sm:px-6 lg:px-8">
        <div className="space-y-6">
          <header className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-xl font-semibold text-zinc-100">Highline</h1>
              <button
                type="button"
                aria-label="Settings"
                className="rounded-md border border-[#2A3040] bg-[#1E2330] p-2 text-zinc-400 transition-colors hover:text-zinc-100"
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden
                >
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
              </button>
            </div>
            <FilterBar />
            <p className="text-xs text-zinc-500">
              Data as of {formatDateTime(snapshot.fetchedAt)} · Updates every 60s
            </p>
          </header>

          {freshnessWarning && freshnessWarning.signature !== dismissedFreshnessSignature ? (
            <div
              className={`flex items-start justify-between gap-3 rounded-md border px-4 py-3 text-sm ${
                freshnessWarning.severity === 'failed'
                  ? 'border-red-700/30 bg-red-50 text-red-700'
                  : 'border-amber-700/30 bg-amber-50 text-amber-700'
              }`}
            >
              <p>
                ⚠ Data warning: {sourceLabel(freshnessWarning.source)} last updated{' '}
                {freshnessWarning.hoursAgo === null ? 'never' : `${freshnessWarning.hoursAgo}h ago`}{' '}
                — signals may be stale
              </p>
              <button
                type="button"
                aria-label="Dismiss data warning"
                className="shrink-0 rounded px-2 font-semibold leading-5 hover:bg-black/5"
                onClick={() => {
                  localStorage.setItem(FRESHNESS_DISMISS_KEY, freshnessWarning.signature);
                  setDismissedFreshnessSignature(freshnessWarning.signature);
                }}
              >
                ×
              </button>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <KpiCard
              label="Cutout Delta"
              tooltip="Day-over-day change in the Choice boxed beef cutout (choice_total). Positive = Choice value rose vs. yesterday."
              value={kpis.cutout.value}
              deltaPct={kpis.cutout.deltaPct}
              sparklineValues={kpis.cutout.spark}
              secondaryLabel="vs previous day"
            />
            <KpiCard
              label="Negotiated Volume"
              tooltip="Total negotiated head/loads sold in today's reported sessions, vs. the trailing 7-day daily average."
              value={kpis.negotiated.value}
              deltaPct={kpis.negotiated.deltaPct}
              sparklineValues={kpis.negotiated.spark}
              secondaryLabel="vs previous 7 days"
            />
            <KpiCard
              label="Futures (LE=F)"
              tooltip="Latest live cattle futures front-month price vs. prior settle."
              value={kpis.futures.value}
              deltaPct={kpis.futures.deltaPct}
              sparklineValues={kpis.futures.spark}
              secondaryLabel="vs prior close"
            />
          </div>

          <SignalBreakdownTable drivers={snapshot.market.direction?.drivers ?? []} />

          <CutoutTrendCard
            latest={snapshot.cutout.latest}
            yesterday={snapshot.cutout.yesterday}
          />

          <section className="rounded-xl border border-[#1E2330] bg-[#13161E]">
            <button
              type="button"
              onClick={() => setDetailsOpen((open) => !open)}
              aria-expanded={detailsOpen}
              className="flex w-full items-center justify-between gap-2 px-5 py-4 text-left"
            >
              <span className="text-sm font-medium text-zinc-200">Detailed View</span>
              <span className="text-xs text-zinc-400">
                {detailsOpen ? 'Hide details ↑' : 'Show details ↓'}
              </span>
            </button>
            {detailsOpen ? (
              <div className="border-t border-[#1E2330] p-5">
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-6">
                  <CutoutCard
                    latest={snapshot.cutout.latest}
                    yesterday={snapshot.cutout.yesterday}
                    health={healthBySource.cutout_daily}
                    data-flash={flash.cutout ? 'true' : undefined}
                    className="lg:col-span-4"
                  />
                  <NegotiatedCard
                    today={snapshot.negotiated.today}
                    cutout={snapshot.cutout.latest}
                    health={healthBySource.negotiated_sales}
                    data-flash={flash.negotiated ? 'true' : undefined}
                    className="lg:col-span-4"
                  />
                  <DirectionalIndicatorCard
                    signal={snapshot.market.direction}
                    signalSnapshot={snapshot.market.latestSignalSnapshot}
                    className="lg:col-span-6"
                  />
                  <BidRangeCalculatorCard
                    context={snapshot.market.calculator}
                    signal={snapshot.market.direction}
                    className="lg:col-span-6"
                  />
                  <NegotiatedSessionsCard
                    sessions={snapshot.negotiated.sessions}
                    history={snapshot.negotiated.sessionHistory}
                    lastUpdated={snapshot.negotiated.lastUpdated}
                    data-flash={flash.negotiated ? 'true' : undefined}
                    className="lg:col-span-12"
                  />
                  <FuturesCard
                    latest={snapshot.futures.latest}
                    health={healthBySource.futures_snapshots}
                    data-flash={flash.futures ? 'true' : undefined}
                    className="lg:col-span-12"
                  />
                  <SlaughterCard
                    latest={snapshot.slaughter.latest}
                    fourWeekAvgHeiferPct={snapshot.slaughter.fourWeekAvgHeiferPct}
                    health={healthBySource.slaughter_weekly}
                    className="lg:col-span-6"
                  />
                  <ColdStorageCard
                    latest={snapshot.coldStorage.latest}
                    history={snapshot.coldStorage.history}
                    health={healthBySource.cold_storage_monthly}
                    className="lg:col-span-6"
                  />
                  <div className="lg:col-span-12">
                    <DataHealthPanel health={snapshot.health} />
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </main>
    </>
  );
}
