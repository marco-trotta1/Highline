'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { DataHealthStatus } from '@/lib/types';

type ConnectionStatus = 'connected' | 'reconnecting';

type TopNavProps = {
  health?: DataHealthStatus[];
  connection?: ConnectionStatus;
};

function overallHealth(
  health: DataHealthStatus[]
): 'healthy' | 'stale' | 'no_data' | 'error' {
  if (health.length === 0) return 'error';
  const errorCount = health.filter((h) => h.state === 'error').length;
  const staleCount = health.filter((h) => h.state === 'stale').length;
  const noDataCount = health.filter((h) => h.state === 'no_data').length;
  if (errorCount > 0) return 'error';
  if (staleCount > 0) return 'stale';
  if (noDataCount > 0) return 'no_data';
  return 'healthy';
}

export function TopNav({ health = [], connection = 'connected' }: TopNavProps) {
  const pathname = usePathname();
  const status = overallHealth(health);
  const dotColor =
    status === 'healthy'
      ? 'bg-bull'
      : status === 'stale'
        ? 'bg-warn'
        : status === 'no_data'
          ? 'bg-text-muted'
          : 'bg-bear';
  const dotLabel =
    status === 'healthy'
      ? 'All data fresh'
      : status === 'stale'
        ? `${health.filter((h) => h.state === 'stale').length} source(s) stale`
        : status === 'no_data'
          ? `${health.filter((h) => h.state === 'no_data').length} source(s) awaiting first load`
          : 'Data errors';

  return (
    <nav className="sticky top-0 z-50 flex h-14 items-center justify-between gap-4 border-b border-border bg-bg/90 px-4 backdrop-blur-sm sm:px-6">
      <div className="flex items-center gap-3">
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/agribeef-logo.png"
            alt="Agribeef"
            width={128}
            height={32}
            priority
            className="h-8 w-auto"
          />
          <span className="font-sans text-sm font-semibold leading-none tracking-[0.25em] text-text/70">
            HIGHLINE
          </span>
        </Link>

        <div className="ml-2 flex items-center gap-1">
          <Link
            href="/"
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              pathname === '/' ? 'bg-card text-text' : 'text-text-muted hover:text-text'
            }`}
          >
            Dashboard
          </Link>
          <Link
            href="/trade-sheet"
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              pathname === '/trade-sheet' ? 'bg-card text-text' : 'text-text-muted hover:text-text'
            }`}
          >
            Trade Sheet
          </Link>
        </div>
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

        {health.length > 0 && (
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
        )}

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
