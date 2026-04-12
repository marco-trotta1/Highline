import type { HTMLAttributes } from 'react';
import type { NegotiatedSalesRow } from '@/lib/types';
import { Card } from '@/components/ui/Card';
import { RangeBar } from '@/components/ui/RangeBar';
import { Tooltip } from '@/components/ui/Tooltip';
import { formatCurrency, formatInt } from '@/lib/format';

type NegotiatedCardProps = HTMLAttributes<HTMLElement> & {
  today: NegotiatedSalesRow[];
};

export function NegotiatedCard({ today, ...rest }: NegotiatedCardProps) {
  const sessions = [...today].sort((a, b) => (a.session === 'AM' ? -1 : 1));

  return (
    <Card title="Negotiated Sales" {...rest}>
      {sessions.length === 0 ? (
        <div className="flex h-24 items-center justify-center text-sm text-text-muted">
          No sessions reported today
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {sessions.map((s) => (
            <SessionBlock key={s.id} row={s} />
          ))}
        </div>
      )}
    </Card>
  );
}

function SessionBlock({ row }: { row: NegotiatedSalesRow }) {
  const isThin = row.session_quality === 'thin';
  const qualityLabel = isThin ? 'THIN' : 'ACTIVE';
  const qualityClasses = isThin
    ? 'border-warn/30 bg-warn/10 text-warn'
    : 'border-bull/30 bg-bull/10 text-bull';

  const badge = (
    <span
      className={`inline-flex h-5 items-center rounded-full border px-2 text-[10px] font-semibold tracking-wider ${qualityClasses}`}
    >
      {qualityLabel}
    </span>
  );

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-muted">
          {row.session} session
        </span>
        {isThin ? (
          <Tooltip content="Low volume session — price signal less reliable">
            {badge}
          </Tooltip>
        ) : (
          badge
        )}
      </div>
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-2xl font-medium tabular-nums">
          {formatCurrency(row.weighted_avg)}
        </span>
        <span className="text-xs text-text-muted">
          <span className="font-mono text-text tabular-nums">
            {formatInt(row.volume_loads)}
          </span>{' '}
          loads
        </span>
      </div>
      <div className="mt-3">
        <RangeBar low={row.low} high={row.high} value={row.weighted_avg} />
      </div>
    </div>
  );
}
