'use client';

import { useEffect, useMemo, useState, type HTMLAttributes } from 'react';
import {
  Line,
  LineChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  NegotiatedSessionHistoryRow,
  NegotiatedSessionPair,
  NegotiatedSessionRow,
} from '@/lib/types';
import { Card } from '@/components/ui/Card';
import {
  formatCurrency,
  formatDateTime,
  formatInt,
  formatSignedCurrency,
} from '@/lib/format';
import { createBrowserClient } from '@/lib/supabase/client';

type NegotiatedSessionsCardProps = HTMLAttributes<HTMLElement> & {
  sessions: NegotiatedSessionPair;
  history: NegotiatedSessionHistoryRow[];
  lastUpdated: string | null;
};

type SparklinePoint = {
  date: string;
  AM: number | null;
  PM: number | null;
};

type NegotiatedSessionCardData = {
  sessions: NegotiatedSessionPair;
  history: NegotiatedSessionHistoryRow[];
  lastUpdated: string | null;
};

const CENTRAL_TIME_ZONE = 'America/Chicago';
const NEGOTIATED_INGESTION_SOURCES = ['negotiated', 'usda_negotiated'];
const SESSION_SELECT = 'session,low,high,weighted_avg,volume_loads,session_quality';
const HISTORY_SELECT = 'date,session,weighted_avg,volume_loads';
const POLL_MS = 5 * 60 * 1000;

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
  return formatDateInTimeZone(
    new Date(Date.now() - days * 24 * 60 * 60 * 1000),
    CENTRAL_TIME_ZONE
  );
}

function normalizeSessions(rows: NegotiatedSessionRow[]): NegotiatedSessionPair {
  return {
    AM: rows.find((row) => row.session === 'AM') ?? null,
    PM: rows.find((row) => row.session === 'PM') ?? null,
  };
}

function buildSparklineData(rows: NegotiatedSessionHistoryRow[]): SparklinePoint[] {
  const byDate = new Map<string, SparklinePoint>();

  for (const row of rows) {
    const point = byDate.get(row.date) ?? { date: row.date, AM: null, PM: null };
    point[row.session] = row.weighted_avg;
    byDate.set(row.date, point);
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

export function NegotiatedSessionsCard({
  sessions: initialSessions,
  history: initialHistory,
  lastUpdated: initialLastUpdated,
  ...rest
}: NegotiatedSessionsCardProps) {
  const [polledData, setPolledData] = useState<NegotiatedSessionCardData | null>(null);
  const propData = useMemo(
    () => ({
      sessions: initialSessions,
      history: initialHistory,
      lastUpdated: initialLastUpdated,
    }),
    [initialSessions, initialHistory, initialLastUpdated]
  );
  const data = useMemo(() => {
    if (!polledData) return propData;
    const propUpdatedMs = propData.lastUpdated ? new Date(propData.lastUpdated).getTime() : 0;
    const polledUpdatedMs = polledData.lastUpdated ? new Date(polledData.lastUpdated).getTime() : 0;
    return polledUpdatedMs >= propUpdatedMs ? polledData : propData;
  }, [polledData, propData]);
  const chartData = useMemo(() => buildSparklineData(data.history), [data.history]);

  useEffect(() => {
    let cancelled = false;
    const supabase = createBrowserClient();

    const refresh = async () => {
      const since = centralDateDaysAgo(7);
      const latestDateResult = await supabase
        .from('negotiated_sales')
        .select('date')
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle();
      const latestDate = ((latestDateResult.data ?? null) as { date: string } | null)?.date;
      const [sessionResult, historyResult, logResult] = await Promise.all([
        latestDate
          ? supabase
              .from('negotiated_sales')
              .select(SESSION_SELECT)
              .eq('date', latestDate)
              .order('session', { ascending: true })
          : Promise.resolve({ data: [], error: latestDateResult.error }),
        supabase
          .from('negotiated_sales')
          .select(HISTORY_SELECT)
          .gte('date', since)
          .order('date', { ascending: false })
          .order('session', { ascending: true }),
        supabase
          .from('ingestion_log')
          .select('timestamp')
          .in('source', NEGOTIATED_INGESTION_SOURCES)
          .eq('status', 'success')
          .order('timestamp', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (cancelled) return;
      setPolledData((prev) => ({
        sessions: sessionResult.error
          ? prev?.sessions ?? initialSessions
          : normalizeSessions((sessionResult.data ?? []) as NegotiatedSessionRow[]),
        history: historyResult.error
          ? prev?.history ?? initialHistory
          : ((historyResult.data ?? []) as NegotiatedSessionHistoryRow[]),
        lastUpdated: logResult.error
          ? prev?.lastUpdated ?? initialLastUpdated
          : ((logResult.data ?? null) as { timestamp: string } | null)?.timestamp ?? null,
      }));
    };

    const interval = setInterval(refresh, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [initialHistory, initialLastUpdated, initialSessions]);

  return (
    <Card
      title="AM/PM Negotiated Sales"
      description="Cash market read by USDA negotiated session."
      {...rest}
    >
      <div className="grid gap-4 md:grid-cols-[1fr_auto_1fr] md:items-stretch">
        <SessionColumn
          label="AM Session"
          row={data.sessions.AM}
          lastUpdated={data.lastUpdated}
          pendingText="Pending — publishes ~10:30 AM CT"
        />
        <SessionDivider am={data.sessions.AM} pm={data.sessions.PM} />
        <SessionColumn
          label="PM Session"
          row={data.sessions.PM}
          lastUpdated={data.lastUpdated}
          pendingText="Pending — publishes ~2:00 PM CT"
        />
      </div>

      <div className="mt-5 border-t border-border/60 pt-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
            7-day session trend
          </span>
          <div className="flex items-center gap-3 text-[10px] text-text-muted">
            <LegendDot className="bg-accent" label="AM" />
            <LegendDot className="bg-warn" label="PM" />
          </div>
        </div>
        {chartData.length > 0 ? (
          <div className="h-24 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                <XAxis hide dataKey="date" />
                <YAxis hide domain={['auto', 'auto']} />
                <Line
                  type="monotone"
                  dataKey="AM"
                  connectNulls
                  stroke="var(--color-accent)"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  dataKey="PM"
                  connectNulls
                  stroke="var(--color-warn)"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex h-24 items-center justify-center text-sm text-text-muted">
            Awaiting session history
          </div>
        )}
      </div>
    </Card>
  );
}

function SessionColumn({
  label,
  row,
  lastUpdated,
  pendingText,
}: {
  label: string;
  row: NegotiatedSessionRow | null;
  lastUpdated: string | null;
  pendingText: string;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.14em] text-text-muted">
            {label}
          </h3>
          <div className="mt-1 text-[10px] text-text-muted/70">
            Updated {formatDateTime(lastUpdated)}
          </div>
        </div>
        {row ? <QualityBadge quality={row.session_quality} /> : null}
      </div>

      {row ? (
        <div>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="font-mono text-4xl font-bold tabular-nums">
              {formatCurrency(row.weighted_avg)}
            </span>
            <span className="text-xs text-text-muted">/cwt</span>
          </div>
          <dl className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <Metric label="Range" value={`${formatCurrency(row.low)} – ${formatCurrency(row.high)}`} />
            <Metric label="Loads" value={`${formatInt(row.volume_loads)} loads`} />
          </dl>
        </div>
      ) : (
        <div className="flex min-h-28 items-center rounded border border-border/70 bg-bg/30 px-4 py-5 text-sm text-text-muted">
          {pendingText}
        </div>
      )}
    </div>
  );
}

function SessionDivider({
  am,
  pm,
}: {
  am: NegotiatedSessionRow | null;
  pm: NegotiatedSessionRow | null;
}) {
  const delta = am && pm ? pm.weighted_avg - am.weighted_avg : null;
  const tone = delta == null ? 'neutral' : delta > 0 ? 'firmed' : delta < 0 ? 'softened' : 'flat';
  const toneClasses =
    tone === 'firmed'
      ? 'border-bull/30 bg-bull/10 text-bull'
      : tone === 'softened'
        ? 'border-bear/30 bg-bear/10 text-bear'
        : 'border-border bg-bg/40 text-text-muted';
  const label =
    tone === 'firmed'
      ? 'Market firmed'
      : tone === 'softened'
        ? 'Market softened'
        : 'Market unchanged';

  return (
    <div className="relative flex flex-col items-center justify-center gap-3 md:px-2">
      <div className="h-px w-full bg-border/70 md:h-full md:w-px" />
      {delta == null ? null : (
        <div
          className={`absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 rounded-md border px-3 py-2 text-center md:block ${toneClasses}`}
        >
          <div className="flex items-center justify-center gap-1.5 font-mono text-sm font-semibold tabular-nums">
            <ArrowIcon direction={delta >= 0 ? 'up' : 'down'} />
            {formatSignedCurrency(delta)}
          </div>
          <div className="mt-1 whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.12em]">
            {label}
          </div>
        </div>
      )}
      {delta == null ? null : (
        <div className={`w-full rounded-md border px-3 py-2 text-center md:hidden ${toneClasses}`}>
          <div className="flex items-center justify-center gap-1.5 font-mono text-sm font-semibold tabular-nums">
            <ArrowIcon direction={delta >= 0 ? 'up' : 'down'} />
            {formatSignedCurrency(delta)}
          </div>
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em]">
            {label}
          </div>
        </div>
      )}
    </div>
  );
}

function QualityBadge({ quality }: { quality: NegotiatedSessionRow['session_quality'] }) {
  const isThin = quality === 'thin';
  return (
    <span
      className={`inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[10px] font-semibold tracking-wider ${
        isThin
          ? 'border-warn/30 bg-warn/10 text-warn'
          : 'border-bull/30 bg-bull/10 text-bull'
      }`}
    >
      {isThin ? 'THIN' : 'ACTIVE'}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">
        {label}
      </dt>
      <dd className="mt-0.5 font-mono text-sm tabular-nums text-text">{value}</dd>
    </div>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`h-2 w-2 rounded-full ${className}`} />
      {label}
    </span>
  );
}

function ArrowIcon({ direction }: { direction: 'up' | 'down' }) {
  return (
    <svg
      aria-hidden="true"
      className={`h-4 w-4 ${direction === 'down' ? 'rotate-180' : ''}`}
      viewBox="0 0 16 16"
      fill="none"
    >
      <path
        d="M8 3.5v9M8 3.5 4.5 7M8 3.5 11.5 7"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.75"
      />
    </svg>
  );
}
