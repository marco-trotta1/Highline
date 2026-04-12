'use client';

import Image from 'next/image';
import type { DataHealthStatus } from '@/lib/types';

type ConnectionStatus = 'connected' | 'reconnecting';

type TopNavProps = {
  health: DataHealthStatus[];
  connection: ConnectionStatus;
};

function overallHealth(health: DataHealthStatus[]): 'healthy' | 'stale' | 'error' {
  if (health.length === 0) return 'error';
  const staleCount = health.filter((h) => h.stale).length;
  const missingCount = health.filter((h) => h.last_updated === null).length;
  if (missingCount > 0) return 'error';
  if (staleCount > 0) return 'stale';
  return 'healthy';
}

export function TopNav({ health, connection }: TopNavProps) {
  const status = overallHealth(health);
  const dotColor =
    status === 'healthy' ? 'bg-bull' : status === 'stale' ? 'bg-warn' : 'bg-bear';
  const dotLabel =
    status === 'healthy'
      ? 'All data fresh'
      : status === 'stale'
        ? `${health.filter((h) => h.stale).length} source(s) stale`
        : 'Data errors';

  return (
    <nav className="sticky top-0 z-50 flex h-14 items-center justify-between gap-4 border-b border-border bg-bg/90 px-4 backdrop-blur-sm sm:px-6">
      <div className="flex items-center gap-3">
        <Image
          src="/agribeef-logo.png"
          alt="Agribeef"
          width={128}
          height={32}
          priority
          className="h-8 w-auto"
        />
        <span className="font-sans text-sm font-semibold tracking-[0.25em] text-text/70">
          HIGHLINE
        </span>
      </div>

      <div className="flex items-center gap-3">
        {connection === 'reconnecting' ? (
          <span className="flex items-center gap-2 rounded-full border border-warn/30 bg-warn/10 px-3 py-1 text-xs font-medium text-warn">
            <span
              className="h-1.5 w-1.5 rounded-full bg-warn"
              data-pulse="true"
            />
            Reconnecting…
          </span>
        ) : null}

        <div
          className="flex items-center gap-2"
          title={dotLabel}
          aria-label={dotLabel}
        >
          <span
            className={`h-2.5 w-2.5 rounded-full ${dotColor}`}
            data-pulse={status === 'healthy' ? 'true' : 'false'}
          />
          <span className="hidden text-xs text-text-muted sm:inline">
            {dotLabel}
          </span>
        </div>

        <div
          className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-xs font-medium text-text-muted"
          aria-label="User"
        >
          AB
        </div>
      </div>
    </nav>
  );
}
