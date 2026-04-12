import type { DataHealthStatus } from '@/lib/types';
import { CollapsiblePanel } from '@/components/ui/CollapsiblePanel';
import { StatusDot } from '@/components/ui/StatusDot';
import { formatRelative } from '@/lib/format';

const SOURCE_LABELS: Record<string, string> = {
  cutout_daily: 'Boxed Beef Cutout',
  negotiated_sales: 'Negotiated Sales',
  futures_snapshots: 'Live Cattle Futures',
  slaughter_weekly: 'Weekly Slaughter',
  cold_storage_monthly: 'Cold Storage',
};

type DataHealthPanelProps = {
  health: DataHealthStatus[];
};

type Level = 'fresh' | 'stale' | 'error';

function levelFor(row: DataHealthStatus): Level {
  if (row.last_updated === null) return 'error';
  if (row.stale) return 'stale';
  return 'fresh';
}

export function DataHealthPanel({ health }: DataHealthPanelProps) {
  const issues = health.filter((h) => levelFor(h) !== 'fresh');
  const subtitle =
    issues.length === 0
      ? 'All sources fresh'
      : `${issues.length} ${issues.length === 1 ? 'issue' : 'issues'}`;

  return (
    <CollapsiblePanel title="Data Health" subtitle={subtitle}>
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-text-muted">
            <th className="py-1 pr-2 font-medium">Source</th>
            <th className="py-1 pr-2 font-medium">Last updated</th>
            <th className="py-1 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {health.map((row) => {
            const level = levelFor(row);
            return (
              <tr key={row.source} className="border-t border-border/60">
                <td className="py-2 pr-2 text-text">
                  {SOURCE_LABELS[row.source] ?? row.source}
                </td>
                <td className="py-2 pr-2 font-mono tabular-nums text-text-muted">
                  {formatRelative(row.last_updated)}
                </td>
                <td className="py-2">
                  <span className="inline-flex items-center gap-2">
                    <StatusDot status={level} />
                    <span
                      className={
                        level === 'fresh'
                          ? 'text-bull'
                          : level === 'stale'
                            ? 'text-warn'
                            : 'text-bear'
                      }
                    >
                      {level === 'fresh'
                        ? 'Fresh'
                        : level === 'stale'
                          ? 'Stale'
                          : 'Error'}
                    </span>
                    {row.stale_reason && (
                      <span className="ml-2 text-text-muted">
                        — {row.stale_reason}
                      </span>
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </CollapsiblePanel>
  );
}
