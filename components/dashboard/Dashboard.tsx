'use client';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import type {
  DashboardSnapshot,
  CutoutDailyRow,
  NegotiatedSalesRow,
  FuturesSnapshotRow,
} from '@/lib/types';
import { TopNav } from '@/components/nav/TopNav';
import { CutoutCard } from '@/components/cards/CutoutCard';
import { NegotiatedCard } from '@/components/cards/NegotiatedCard';
import { FuturesCard } from '@/components/cards/FuturesCard';
import { SlaughterCard } from '@/components/cards/SlaughterCard';
import { ColdStorageCard } from '@/components/cards/ColdStorageCard';
import { DataHealthPanel } from '@/components/cards/DataHealthPanel';
import { DirectionalIndicatorCard } from '@/components/cards/DirectionalIndicatorCard';
import { BidRangeCalculatorCard } from '@/components/cards/BidRangeCalculatorCard';
import { subscribeToSnapshot } from '@/lib/supabase/realtime';
import { createBrowserClient } from '@/lib/supabase/client';

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

export function Dashboard({ initialData }: DashboardProps) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(initialData);
  const [connection, setConnection] = useState<ConnectionStatus>('connected');
  const [freshnessWarning, setFreshnessWarning] = useState<FreshnessWarning | null>(null);
  const [dismissedFreshnessSignature, setDismissedFreshnessSignature] = useState<string | null>(null);
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
    const supabase = createBrowserClient();
    const aliases = Object.values(FRESHNESS_SOURCE_ALIASES).flat();

    const loadFreshness = async () => {
      const { data, error } = await supabase
        .from('ingestion_log')
        .select('source,timestamp,status')
        .in('source', aliases)
        .order('timestamp', { ascending: false })
        .limit(100);

      if (cancelled || error) return;
      const warning = buildFreshnessWarning((data ?? []) as IngestionLogRow[]);
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
            return { ...prev, negotiated: { today: [...without, next] } };
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

  return (
    <>
      <TopNav health={snapshot.health} connection={connection} />
      <main className="mx-auto w-full max-w-7xl px-4 pb-[env(safe-area-inset-bottom)] pt-6 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-6">
          {freshnessWarning && freshnessWarning.signature !== dismissedFreshnessSignature ? (
            <div className="lg:col-span-12">
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
            </div>
          ) : null}
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
          <FuturesCard
            latest={snapshot.futures.latest}
            health={healthBySource.futures_snapshots}
            data-flash={flash.futures ? 'true' : undefined}
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
      </main>
    </>
  );
}
