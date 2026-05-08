import type { DataHealthStatus } from './types';
import { formatDateTime, formatRelativeLong } from './format';

const SOURCE_CADENCE: Record<string, string> = {
  cutout_daily: 'Expected twice each business day.',
  negotiated_sales: 'Expected twice each business day.',
  futures_snapshots: 'Expected every 30 minutes while the market is open.',
  slaughter_weekly: 'Expected weekly.',
  cold_storage_monthly: 'Expected monthly.',
};

export function formatDataHealthAge(iso: string | null): string {
  if (!iso) return 'No data';
  const relative = formatRelativeLong(iso);
  if (relative === 'unknown') return 'Unknown';
  return relative;
}

export function formatDataHealthDetail(row: DataHealthStatus): string | null {
  if (row.error_message) return row.error_message;
  if (row.state === 'no_data') return 'No successful update has been recorded.';
  if (row.state !== 'stale') return null;

  const cadence = SOURCE_CADENCE[row.source] ?? 'Update cadence depends on the source.';
  if (!row.last_updated) return cadence;

  return `Last updated ${formatRelativeLong(row.last_updated)} (${formatDateTime(row.last_updated)}). ${cadence}`;
}
