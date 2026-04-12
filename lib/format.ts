export function formatCurrency(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '—';
  return `$${n.toFixed(decimals)}`;
}

export function formatSignedCurrency(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '—';
  if (n === 0) return '$0.00';
  const sign = n > 0 ? '+' : '−';
  return `${sign}$${Math.abs(n).toFixed(decimals)}`;
}

export function formatPct(n: number | null | undefined, decimals = 1): string {
  if (n == null) return '—';
  return `${n.toFixed(decimals)}%`;
}

export function formatSignedPct(n: number | null | undefined, decimals = 2): string {
  if (n == null) return '—';
  if (n === 0) return '0.00%';
  const sign = n > 0 ? '+' : '−';
  return `${sign}${Math.abs(n).toFixed(decimals)}%`;
}

export function formatInt(n: number | null | undefined): string {
  if (n == null) return '—';
  return new Intl.NumberFormat('en-US').format(Math.round(n));
}

export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatRelative(iso: string | null | undefined, nowMs?: number): string {
  if (!iso) return 'never';
  const now = nowMs ?? Date.now();
  const ms = now - new Date(iso).getTime();
  if (ms < 0) return 'just now';
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}

export function formatMonthYear(month: number, year: number): string {
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}
