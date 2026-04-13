import { formatCurrency } from '@/lib/format';

type MarkerTone = 'accent' | 'bull' | 'bear' | 'warn';

type RangeBarProps = {
  low: number;
  high: number;
  value: number;
  referenceMarkers?: Array<{
    value: number;
    label: string;
    tone?: MarkerTone;
  }>;
  className?: string;
};

const MARKER_TONE: Record<MarkerTone, string> = {
  accent: 'bg-accent',
  bull: 'bg-bull',
  bear: 'bg-bear',
  warn: 'bg-warn',
};

export function RangeBar({
  low,
  high,
  value,
  referenceMarkers = [],
  className = '',
}: RangeBarProps) {
  const domainValues = [low, high, value, ...referenceMarkers.map((marker) => marker.value)];
  const min = Math.min(...domainValues);
  const max = Math.max(...domainValues);
  const span = Math.max(max - min, 1);
  const pct = Math.min(100, Math.max(0, ((value - min) / span) * 100));
  const lowPct = Math.min(100, Math.max(0, ((low - min) / span) * 100));
  const highPct = Math.min(100, Math.max(0, ((high - min) / span) * 100));

  return (
    <div className={`w-full ${className}`}>
      <div className="relative h-2 w-full rounded-full bg-border">
        <div
          className="absolute top-0 h-2 rounded-full bg-accent/20"
          style={{ left: `${lowPct}%`, width: `${Math.max(highPct - lowPct, 2)}%` }}
          aria-hidden
        />
        <div
          className="absolute top-1/2 h-4 w-1 -translate-y-1/2 -translate-x-1/2 rounded-sm bg-accent"
          style={{ left: `${pct}%` }}
          aria-hidden
        />
        {referenceMarkers.map((marker) => {
          const markerPct = Math.min(
            100,
            Math.max(0, ((marker.value - min) / span) * 100)
          );
          return (
            <div
              key={`${marker.label}-${marker.value}`}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2"
              style={{ left: `${markerPct}%` }}
              aria-hidden
            >
              <span
                className={`block h-3 w-3 rounded-full border border-bg ${
                  MARKER_TONE[marker.tone ?? 'warn']
                }`}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3 font-mono text-[10px] text-text-muted">
        <span>{formatCurrency(low)}</span>
        <span>{formatCurrency(high)}</span>
      </div>
      {referenceMarkers.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-3 text-[10px] text-text-muted">
          {referenceMarkers.map((marker) => (
            <span key={`${marker.label}-legend`} className="inline-flex items-center gap-1.5">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  MARKER_TONE[marker.tone ?? 'warn']
                }`}
              />
              {marker.label}: {formatCurrency(marker.value)}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
