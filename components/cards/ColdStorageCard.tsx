import type { HTMLAttributes } from 'react';
import type { ColdStorageMonthlyRow } from '@/lib/types';
import { Card } from '@/components/ui/Card';
import { Sparkline } from '@/components/ui/Sparkline';
import { formatMonthYear, formatSignedPct } from '@/lib/format';

type ColdStorageCardProps = HTMLAttributes<HTMLElement> & {
  latest: ColdStorageMonthlyRow | null;
  history: ColdStorageMonthlyRow[];
};

export function ColdStorageCard({
  latest,
  history,
  ...rest
}: ColdStorageCardProps) {
  if (!latest) {
    return (
      <Card title="Cold Storage" {...rest}>
        <div className="flex h-24 items-center justify-center text-sm text-text-muted">
          No cold storage data yet
        </div>
      </Card>
    );
  }

  const vs = latest.vs_5yr_avg_pct;
  // Higher cold storage = more supply sitting around = bearish.
  // Lower = tighter supply = bullish.
  const bearish = vs > 0;
  const bullish = vs < 0;
  const badgeClasses = bearish
    ? 'border-warn/30 bg-warn/10 text-warn'
    : bullish
      ? 'border-bull/30 bg-bull/10 text-bull'
      : 'border-border bg-card text-text-muted';
  const badgeLabel = bearish
    ? `${formatSignedPct(vs, 1)} above avg`
    : bullish
      ? `${formatSignedPct(vs, 1)} below avg`
      : 'at avg';

  const sparkValues = history.map((r) => r.total_beef_million_lbs);
  const sparkColor = bearish
    ? 'text-warn'
    : bullish
      ? 'text-bull'
      : 'text-text-muted';

  return (
    <Card
      title="Cold Storage"
      subtitle={formatMonthYear(latest.month, latest.year)}
      {...rest}
    >
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-3xl font-medium tabular-nums">
          {latest.total_beef_million_lbs.toFixed(1)}
          <span className="ml-1 text-sm text-text-muted">M lbs</span>
        </span>
      </div>

      <div className="mt-3">
        <span
          className={`inline-flex h-5 items-center rounded-full border px-2 text-[10px] font-semibold tracking-wider ${badgeClasses}`}
        >
          {badgeLabel.toUpperCase()}
        </span>
      </div>

      {sparkValues.length >= 2 && (
        <div className="mt-4">
          <Sparkline
            values={sparkValues}
            width={200}
            height={36}
            className={sparkColor}
          />
          <div className="mt-1 flex justify-between text-[10px] text-text-muted">
            <span>
              {history.length > 0 &&
                formatMonthYear(history[0].month, history[0].year)}
            </span>
            <span>
              {history.length > 0 &&
                formatMonthYear(
                  history[history.length - 1].month,
                  history[history.length - 1].year
                )}
            </span>
          </div>
        </div>
      )}

      <p className="mt-4 text-[10px] text-text-muted">
        USDA Monthly Cold Storage · vs. 5-year seasonal average
      </p>
    </Card>
  );
}
