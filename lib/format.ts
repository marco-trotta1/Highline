const ISO_DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  const date = ISO_DATE_ONLY_RE.test(iso)
    ? new Date(`${iso}T00:00:00Z`)
    : new Date(iso);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(ISO_DATE_ONLY_RE.test(iso) ? { timeZone: 'UTC' } : {}),
  });
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

// CME futures contract month codes (industry standard).
const FUTURES_MONTH_CODES: Record<string, string> = {
  F: 'Jan', G: 'Feb', H: 'Mar', J: 'Apr', K: 'May', M: 'Jun',
  N: 'Jul', Q: 'Aug', U: 'Sep', V: 'Oct', X: 'Nov', Z: 'Dec',
};

// Parse CME contract codes like "LCM26" → "Jun 2026".
// Falls back to the raw code if parsing fails.
export function formatContractName(code: string | null | undefined): string {
  if (!code) return '—';
  const match = code.match(/([A-Z])(\d{1,2})$/);
  if (!match) return code;
  const month = FUTURES_MONTH_CODES[match[1]];
  if (!month) return code;
  const year = match[2].length === 2 ? `20${match[2]}` : `2${match[2].padStart(3, '0')}`;
  return `${month} ${year}`;
}
