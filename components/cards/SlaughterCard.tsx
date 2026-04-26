import type { HTMLAttributes } from 'react';
import type { DataHealthStatus, SlaughterWeeklyRow } from '@/lib/types';
import { Card } from '@/components/ui/Card';
import { formatDateShort, formatPct, formatSignedPct } from '@/lib/format';

type SlaughterCardProps = HTMLAttributes<HTMLElement> & {
  latest: SlaughterWeeklyRow | null;
  fourWeekAvgHeiferPct: number | null;
  health?: DataHealthStatus;
};

export function SlaughterCard({
  latest,
  fourWeekAvgHeiferPct,
  health,
  ...rest
}: SlaughterCardProps) {
  if (!latest) {
    return (
      <Card title="Slaughter Mix" description="Heifer % this week — more heifers now means tighter cattle supply down the road." {...rest}>
        <div className="flex h-24 items-center justify-center text-sm text-text-muted">
          {health?.state === 'error'
            ? 'Error loading slaughter data'
            : 'No slaughter data yet'}
        </div>
      </Card>
    );
  }

  const denom = latest.steer_count + latest.heifer_count;
  const steerPct = denom > 0 ? (latest.steer_count / denom) * 100 : 0;
  const heiferPct = denom > 0 ? (latest.heifer_count / denom) * 100 : 0;
  const deltaHeifer =
    fourWeekAvgHeiferPct != null ? heiferPct - fourWeekAvgHeiferPct : null;

  return (
    <Card
      title="Slaughter Mix"
      subtitle={`Week ending ${formatDateShort(latest.week_ending)}`}
      description="Heifer % this week — more heifers now means tighter cattle supply down the road."
      {...rest}
    >
      <div className="flex h-3 w-full overflow-hidden rounded-full border border-border">
        <div
          className="flex h-full items-center justify-start bg-accent/80 pl-2 text-[10px] font-semibold text-white"
          style={{ width: `${steerPct}%` }}
          aria-label={`Steer ${steerPct.toFixed(1)}%`}
        />
        <div
          className="flex h-full items-center justify-end bg-warn/70 pr-2 text-[10px] font-semibold text-white"
          style={{ width: `${heiferPct}%` }}
          aria-label={`Heifer ${heiferPct.toFixed(1)}%`}
        />
      </div>
      <div className="mt-2 flex justify-between text-xs">
        <span>
          <span className="text-text-muted">Steer </span>
          <span className="font-mono text-text tabular-nums">
            {formatPct(steerPct)}
          </span>
        </span>
        <span>
          <span className="text-text-muted">Heifer </span>
          <span className="font-mono text-text tabular-nums">
            {formatPct(heiferPct)}
          </span>
        </span>
      </div>

      {deltaHeifer != null && (
        <div className="mt-3 text-xs text-text-muted">
          vs 4wk avg:{' '}
          <span
            className={`font-mono tabular-nums ${deltaHeifer > 0 ? 'text-warn' : deltaHeifer < 0 ? 'text-bull' : 'text-text-muted'}`}
          >
            {formatSignedPct(deltaHeifer, 1)} heifer
          </span>
        </div>
      )}

      <p className="mt-4 text-[10px] leading-relaxed text-text-muted">
        ↑ Heifer % = tighter Choice supply
      </p>
      {health?.state === 'stale' && health.stale_reason ? (
        <p className="mt-2 text-[10px] text-warn">{health.stale_reason}</p>
      ) : null}
    </Card>
  );
}
