import type { HTMLAttributes } from 'react';
import type { CutoutDailyRow, DataHealthStatus } from '@/lib/types';
import { Card } from '@/components/ui/Card';
import { Delta } from '@/components/ui/Delta';
import { formatCurrency, formatDateShort } from '@/lib/format';

type CutoutCardProps = HTMLAttributes<HTMLElement> & {
  latest: CutoutDailyRow | null;
  yesterday: CutoutDailyRow | null;
  health?: DataHealthStatus;
};

export function CutoutCard({
  latest,
  yesterday,
  health,
  ...rest
}: CutoutCardProps) {
  const choiceDelta =
    latest && yesterday ? latest.choice_total - yesterday.choice_total : null;

  return (
    <Card
      title="Cutout"
      subtitle={latest ? formatDateShort(latest.date) : undefined}
      {...rest}
    >
      {latest ? (
        <>
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-3xl font-medium tabular-nums">
              {formatCurrency(latest.choice_total)}
            </span>
            <Delta value={choiceDelta} kind="currency" className="text-sm" />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
            <div>
              <div className="text-text-muted">Select</div>
              <div className="font-mono text-base text-text tabular-nums">
                {formatCurrency(latest.select_total)}
              </div>
            </div>
            <div>
              <div className="text-text-muted">Ch–Sel spread</div>
              <div className="font-mono text-base text-text tabular-nums">
                {formatCurrency(latest.choice_select_spread)}
              </div>
            </div>
          </div>
          <p className="mt-4 text-[10px] text-text-muted">
            USDA Daily Boxed Beef Cutout
          </p>
          {health?.state === 'stale' && health.stale_reason ? (
            <p className="mt-2 text-[10px] text-warn">{health.stale_reason}</p>
          ) : null}
        </>
      ) : (
        <EmptyState
          label={
            health?.state === 'error'
              ? 'Error loading cutout data'
              : 'No cutout data yet'
          }
        />
      )}
    </Card>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="flex h-24 items-center justify-center text-sm text-text-muted">
      {label}
    </div>
  );
}
