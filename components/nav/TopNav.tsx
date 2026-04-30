'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { StatusDot } from '@/components/ui/StatusDot';
import type { DataHealthStatus } from '@/lib/types';

type ConnectionStatus = 'connected' | 'reconnecting';
type OverallStatus = 'fresh' | 'stale' | 'no_data' | 'error';

type TopNavProps = {
  health?: DataHealthStatus[];
  connection?: ConnectionStatus;
};

function overallHealth(health: DataHealthStatus[]): OverallStatus {
  if (health.length === 0) return 'error';
  if (health.some((h) => h.state === 'error')) return 'error';
  if (health.some((h) => h.state === 'stale')) return 'stale';
  if (health.some((h) => h.state === 'no_data')) return 'no_data';
  return 'fresh';
}

function statusLabel(status: OverallStatus, health: DataHealthStatus[]): string {
  if (status === 'fresh') return 'All data fresh';
  if (status === 'stale') return `${health.filter((h) => h.state === 'stale').length} source(s) stale`;
  if (status === 'no_data') return `${health.filter((h) => h.state === 'no_data').length} source(s) awaiting first load`;
  return 'Data errors';
}

export function TopNav({ health = [], connection = 'connected' }: TopNavProps) {
  const pathname = usePathname();
  const status = overallHealth(health);
  const label = statusLabel(status, health);

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
          <div className="flex items-center gap-2" title={label} aria-label={label}>
            <StatusDot status={status} pulse={status === 'fresh'} size="md" />
            <span className="hidden text-xs text-text-muted sm:inline">
              {label}
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
