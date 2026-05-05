'use client';

import { useState, type HTMLAttributes, type ReactNode } from 'react';
import type { MarketDirectionSignal, SignalSnapshotRow } from '@/lib/types';
import {
  formatCurrency,
  formatInt,
  formatPct,
  formatSignedPct,
} from '@/lib/format';
import { Card } from '@/components/ui/Card';

type DirectionalIndicatorCardProps = HTMLAttributes<HTMLElement> & {
  signal: MarketDirectionSignal | null;
  signalSnapshot: SignalSnapshotRow | null;
};

const TONE_STYLES = {
  bull: 'border-bull/30 bg-bull/10 text-bull',
  neutral: 'border-border bg-card text-text-muted',
  bear: 'border-bear/30 bg-bear/10 text-bear',
} as const;

export function DirectionalIndicatorCard({
  signal,
  signalSnapshot,
  ...rest
}: DirectionalIndicatorCardProps) {
  const [whyOpen, setWhyOpen] = useState(false);

  return (
    <Card title="Directional Indicator" description="Buyer's market or seller's market? Composite read from futures, cash sales, and inventory." {...rest}>
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

          {signalSnapshot ? (
            <div className="mt-3">
              <button
                type="button"
                className="rounded border border-border px-2 py-1 text-[11px] font-medium text-text-muted transition-colors hover:border-text-muted/50 hover:text-text"
                aria-expanded={whyOpen}
                onClick={() => setWhyOpen((open) => !open)}
              >
                Why?
              </button>
              <div
                className={`overflow-hidden transition-[max-height,opacity] duration-200 ease-out ${
                  whyOpen ? 'max-h-64 opacity-100' : 'max-h-0 opacity-0'
                }`}
              >
                <SignalWhyPanel snapshot={signalSnapshot} />
              </div>
            </div>
          ) : null}

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

function formatSignalValue(value: number | null | undefined): string {
  if (value == null) return '—';
  return value.toFixed(2);
}

function formatWeight(value: number | null | undefined): string {
  if (value == null) return '—';
  return formatPct(value * 100, 0);
}

function SignalWhyPanel({ snapshot }: { snapshot: SignalSnapshotRow }) {
  return (
    <div className="mt-3 space-y-1.5 border-t border-border/60 pt-3 text-xs leading-5 text-text-muted">
      <AuditLine label="Futures">
        price <Mono>{formatCurrency(snapshot.futures_price)}</Mono>, change{' '}
        <Mono>{formatSignedPct(snapshot.futures_change_pct, 2)}</Mono> → signal{' '}
        <Mono>{formatSignalValue(snapshot.futures_signal)}</Mono> (weight:{' '}
        <Mono>{formatWeight(snapshot.futures_weight)}</Mono>)
      </AuditLine>
      <AuditLine label="Negotiated cash">
        avg <Mono>{formatCurrency(snapshot.negotiated_weighted_avg)}</Mono>,{' '}
        <Mono>{formatInt(snapshot.negotiated_volume_loads)}</Mono> loads,{' '}
        <Mono>{snapshot.negotiated_session_quality ?? '—'}</Mono> → signal{' '}
        <Mono>{formatSignalValue(snapshot.negotiated_signal)}</Mono> (weight:{' '}
        <Mono>{formatWeight(snapshot.negotiated_weight)}</Mono>)
      </AuditLine>
      <AuditLine label="Cold storage">
        <Mono>{formatSignedPct(snapshot.cold_storage_vs_5yr_avg_pct, 1)}</Mono> vs
        5yr avg → signal{' '}
        <Mono>{formatSignalValue(snapshot.cold_storage_signal)}</Mono> (weight:{' '}
        <Mono>{formatWeight(snapshot.cold_storage_weight)}</Mono>)
      </AuditLine>
      <AuditLine label="Composite score">
        <Mono>{formatSignalValue(snapshot.composite_score)}</Mono> →{' '}
        <Mono>{snapshot.direction}</Mono> at{' '}
        <Mono>{formatPct(snapshot.confidence * 100, 0)}</Mono> confidence
      </AuditLine>
    </div>
  );
}

function AuditLine({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <span className="font-semibold text-text-muted/80">{label}: </span>
      {children}
    </div>
  );
}

function Mono({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono tabular-nums text-text">{children}</span>
  );
}
