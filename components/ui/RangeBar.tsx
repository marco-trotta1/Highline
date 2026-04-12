import { formatCurrency } from '@/lib/format';

type RangeBarProps = {
  low: number;
  high: number;
  value: number;
  className?: string;
};

export function RangeBar({ low, high, value, className = '' }: RangeBarProps) {
  const span = high - low;
  const pct = span > 0
    ? Math.min(100, Math.max(0, ((value - low) / span) * 100))
    : 50;
  return (
    <div className={`w-full ${className}`}>
      <div className="relative h-2 w-full rounded-full bg-border">
        <div
          className="absolute top-1/2 h-4 w-1 -translate-y-1/2 -translate-x-1/2 rounded-sm bg-accent"
          style={{ left: `${pct}%` }}
          aria-hidden
        />
      </div>
      <div className="mt-1.5 flex justify-between font-mono text-[10px] text-text-muted">
        <span>{formatCurrency(low)}</span>
        <span>{formatCurrency(high)}</span>
      </div>
    </div>
  );
}
