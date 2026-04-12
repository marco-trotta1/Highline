import type { HTMLAttributes } from 'react';
import type { DataHealthStatus, FuturesSnapshotRow } from '@/lib/types';
import { Card } from '@/components/ui/Card';
import { Delta } from '@/components/ui/Delta';
import { formatCurrency, formatContractName } from '@/lib/format';

type FuturesCardProps = HTMLAttributes<HTMLElement> & {
  latest: FuturesSnapshotRow | null;
  health?: DataHealthStatus;
};

export function FuturesCard({ latest, health, ...rest }: FuturesCardProps) {
  return (
    <Card title="Live Cattle Futures" {...rest}>
      {latest ? (
        <>
          <div className="mb-1 text-xs text-text-muted">
            {formatContractName(latest.front_month_contract)}
            <span className="ml-2 font-mono text-[10px] text-text-muted/70">
              {latest.front_month_contract}
            </span>
          </div>
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-3xl font-medium tabular-nums">
              {formatCurrency(latest.front_month_price)}
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-3 text-sm">
            <Delta value={latest.change_today} kind="currency" />
            <Delta value={latest.change_pct} kind="percent" />
          </div>
          <p className="mt-4 text-[10px] text-text-muted">
            Source: agribeef.com/market-quotes
          </p>
          {health?.state === 'stale' && health.stale_reason ? (
            <p className="mt-2 text-[10px] text-warn">{health.stale_reason}</p>
          ) : null}
        </>
      ) : (
        <div className="flex h-24 items-center justify-center text-sm text-text-muted">
          {health?.state === 'error'
            ? 'Error loading futures data'
            : 'No futures snapshot yet'}
        </div>
      )}
    </Card>
  );
}
