import type { DataHealthStatus } from '@/lib/types';
import { CollapsiblePanel } from '@/components/ui/CollapsiblePanel';
import { StatusDot } from '@/components/ui/StatusDot';
import { formatDateTime } from '@/lib/format';

const SOURCE_LABELS: Record<string, string> = {
  cutout_daily: 'Cutout',
  negotiated_sales: 'Negotiated Sales',
  futures_snapshots: 'Futures',
  cold_storage_monthly: 'Cold Storage',
  slaughter_weekly: 'Slaughter',
};

const SOURCE_ORDER = [
  'negotiated_sales',
  'cutout_daily',
  'futures_snapshots',
  'cold_storage_monthly',
  'slaughter_weekly',
];

type DataHealthPanelProps = {
  health: DataHealthStatus[];
  focusKey?: number;
};

type Level = 'fresh' | 'stale' | 'no_data' | 'error';

function levelFor(row: DataHealthStatus): Level {
  return row.state;
}

function formatLastUpdated(iso: string | null): string {
  if (!iso) return 'No data';

  const updatedAt = new Date(iso);
  const ageMs = Date.now() - updatedAt.getTime();
  if (!Number.isFinite(updatedAt.getTime())) return 'Unknown';
  if (ageMs < 0) return formatDateTime(iso);
  if (ageMs <= 24 * 60 * 60 * 1000) return formatDateTime(iso);

  const days = Math.max(1, Math.round(ageMs / (24 * 60 * 60 * 1000)));
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

function statusText(level: Level): string {
  if (level === 'fresh') return 'Fresh';
  if (level === 'stale') return 'Stale';
  if (level === 'no_data') return 'No Data';
  return 'Error';
}

function statusClass(level: Level): string {
  if (level === 'fresh') return 'text-bull';
  if (level === 'stale') return 'text-warn';
  return 'text-bear';
}

function dotStatus(level: Level): Level {
  return level === 'no_data' ? 'error' : level;
}

function sourceRank(source: string): number {
  const index = SOURCE_ORDER.indexOf(source);
  return index === -1 ? SOURCE_ORDER.length : index;
}

export function DataHealthPanel({ health, focusKey }: DataHealthPanelProps) {
  const issues = health.filter((h) => levelFor(h) !== 'fresh');
  const subtitle =
    issues.length === 0
      ? 'All sources fresh'
      : `${issues.length} ${issues.length === 1 ? 'source' : 'sources'} need attention`;
  const rows = [...health].sort((a, b) => sourceRank(a.source) - sourceRank(b.source));

  return (
    <CollapsiblePanel
      key={focusKey ?? 'data-health'}
      id="data-health"
      title="Data Health"
      subtitle={subtitle}
      defaultOpen={focusKey !== undefined}
    >
      <div className="divide-y divide-border/60 text-xs">
        {rows.map((row) => {
          const level = levelFor(row);
          const reason = row.error_message ?? row.stale_reason;
          return (
            <div
              key={row.source}
              className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_10rem_minmax(11rem,1.3fr)] sm:items-start"
            >
              <div className="font-medium text-text">
                {SOURCE_LABELS[row.source] ?? row.source}
              </div>
              <div className="font-mono tabular-nums text-text-muted">
                {formatLastUpdated(row.last_updated)}
              </div>
              <div className="space-y-1">
                <span className="inline-flex items-center gap-2">
                  <StatusDot status={dotStatus(level)} />
                  <span className={statusClass(level)}>{statusText(level)}</span>
                </span>
                {reason ? (
                  <p className="leading-snug text-text-muted">{reason}</p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </CollapsiblePanel>
  );
}
