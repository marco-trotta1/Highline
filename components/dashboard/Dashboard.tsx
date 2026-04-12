'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
import { subscribeToSnapshot } from '@/lib/supabase/realtime';

type DashboardProps = {
  initialData: DashboardSnapshot;
};

type FlashKey = 'cutout' | 'negotiated' | 'futures';
type ConnectionStatus = 'connected' | 'reconnecting';

export function Dashboard({ initialData }: DashboardProps) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot>(initialData);
  const [connection, setConnection] = useState<ConnectionStatus>('connected');
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

  const triggerFlash = useCallback((key: FlashKey) => {
    setFlash((prev) => ({ ...prev, [key]: true }));
    const existing = flashTimers.current[key];
    if (existing) clearTimeout(existing);
    flashTimers.current[key] = setTimeout(() => {
      setFlash((prev) => ({ ...prev, [key]: false }));
    }, 1500);
  }, []);

  useEffect(() => {
    const timersAtCleanup = flashTimers.current;
    const unsubscribe = subscribeToSnapshot(
      (table, row) => {
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
          const today = new Date().toISOString().split('T')[0];
          if (next.date !== today) return;
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
  }, [triggerFlash]);

  useEffect(() => {
    if (connection !== 'reconnecting') return;
    let cancelled = false;
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/snapshot', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as DashboardSnapshot;
        if (!cancelled) setSnapshot(data);
      } catch {
        /* swallow — next tick will retry */
      }
    }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [connection]);

  return (
    <>
      <TopNav health={snapshot.health} connection={connection} />
      <main className="mx-auto w-full max-w-7xl px-4 pb-[env(safe-area-inset-bottom)] pt-6 sm:px-6 lg:px-8">
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
