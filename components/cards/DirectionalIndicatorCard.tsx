import type { HTMLAttributes } from 'react';
import type { MarketDirectionSignal } from '@/lib/types';
import { Card } from '@/components/ui/Card';

type DirectionalIndicatorCardProps = HTMLAttributes<HTMLElement> & {
  signal: MarketDirectionSignal | null;
};

const TONE_STYLES = {
  bull: 'border-bull/30 bg-bull/10 text-bull',
  neutral: 'border-border bg-card text-text-muted',
  bear: 'border-bear/30 bg-bear/10 text-bear',
} as const;

export function DirectionalIndicatorCard({
  signal,
  ...rest
}: DirectionalIndicatorCardProps) {
  return (
    <Card title="Directional Indicator" {...rest}>
      {!signal ? (
        <div className="flex h-24 items-center justify-center text-sm text-text-muted">
          Not enough market data yet
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-mono text-3xl font-medium uppercase tracking-[0.08em]">
                {signal.tone}
              </div>
              <p className="mt-2 max-w-md text-sm text-text-muted">
                {signal.summary}
              </p>
            </div>
            <span
              className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${
                TONE_STYLES[signal.tone]
              }`}
            >
              {signal.confidence_label} {signal.confidence_pct}%
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {signal.drivers.map((driver) => (
              <div
                key={driver.key}
                className="flex items-start justify-between gap-3 border-t border-border/60 pt-3"
              >
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.12em] text-text-muted">
                    {driver.label}
                  </div>
                  <div className="mt-1 text-sm text-text">{driver.detail}</div>
                </div>
                <span
                  className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${
                    TONE_STYLES[driver.tone]
                  }`}
                >
                  {driver.tone}
                </span>
              </div>
            ))}
          </div>

          <p className="mt-4 text-[10px] text-text-muted">
            Weighted ruleset: futures 45%, negotiated 35%, cold storage 20%.
          </p>
        </>
      )}
    </Card>
  );
}
