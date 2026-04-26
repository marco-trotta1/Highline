'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import type {
  BidRangeCalculatorContext,
  BidRangeInput,
  MarketDirectionSignal,
} from '@/lib/types';
import { calculateBidRange } from '@/lib/market';
import {
  formatCurrency,
  formatInt,
  formatSignedCurrency,
} from '@/lib/format';
import { Card } from '@/components/ui/Card';

type BidRangeCalculatorCardProps = {
  context: BidRangeCalculatorContext;
  signal: MarketDirectionSignal | null;
  className?: string;
};

const DEFAULT_INPUT: BidRangeInput = {
  grade: 'choice',
  brand: 'commodity',
  channel: 'cash',
  weight_lbs: 1450,
};

export function BidRangeCalculatorCard({
  context,
  signal,
  className,
}: BidRangeCalculatorCardProps) {
  const [input, setInput] = useState<BidRangeInput>(DEFAULT_INPUT);

  const output = calculateBidRange(context, input);
  const benchmarkLabel =
    context.benchmark_price == null
      ? 'Waiting for negotiated data'
      : `${formatCurrency(output.benchmark)} benchmark`;

  return (
    <Card title="Bid Range Calculator" description="Your number. What to bid live cattle today, calculated from current market signals." className={className}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Grade">
          <select
            value={input.grade}
            onChange={(event) =>
              setInput((prev) => ({
                ...prev,
                grade: event.target.value as BidRangeInput['grade'],
              }))
            }
            className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text outline-none"
          >
            <option value="standard">Standard</option>
            <option value="choice">Choice</option>
            <option value="choice-plus">Choice+</option>
            <option value="prime-capable">Prime-capable</option>
          </select>
        </Field>
        <Field label="Brand">
          <select
            value={input.brand}
            onChange={(event) =>
              setInput((prev) => ({
                ...prev,
                brand: event.target.value as BidRangeInput['brand'],
              }))
            }
            className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text outline-none"
          >
            <option value="commodity">Commodity</option>
            <option value="program">Program</option>
            <option value="natural">Natural / NHTC</option>
            <option value="branded">Branded premium</option>
          </select>
        </Field>
        <Field label="Channel">
          <select
            value={input.channel}
            onChange={(event) =>
              setInput((prev) => ({
                ...prev,
                channel: event.target.value as BidRangeInput['channel'],
              }))
            }
            className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text outline-none"
          >
            <option value="cash">Cash</option>
            <option value="formula">Formula</option>
            <option value="grid">Grid</option>
            <option value="program">Program</option>
          </select>
        </Field>
        <Field label="Weight">
          <input
            type="number"
            min={1100}
            max={1800}
            step={25}
            value={input.weight_lbs}
            onChange={(event) =>
              setInput((prev) => ({
                ...prev,
                weight_lbs: Number(event.target.value) || DEFAULT_INPUT.weight_lbs,
              }))
            }
            className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-text outline-none"
          />
        </Field>
      </div>

      <div className="mt-5 rounded-lg border border-border/70 bg-bg/60 p-4">
        <div className="text-xs uppercase tracking-[0.12em] text-text-muted">
          Suggested range
        </div>
        <div className="mt-2 flex items-end gap-3">
          <div className="font-mono text-3xl font-medium tabular-nums">
            {context.benchmark_price == null
              ? '—'
              : `${formatCurrency(output.low)} - ${formatCurrency(output.high)}`}
          </div>
          <div className="pb-1 text-xs text-text-muted">per cwt</div>
        </div>
        <div className="mt-2 text-sm text-text-muted">
          {context.benchmark_price == null
            ? 'Awaiting negotiated and cutout anchors.'
            : `Midpoint ${formatCurrency(output.midpoint)} · ${benchmarkLabel}`}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-text-muted">
        {output.adjustments.map((adjustment) => (
          <div
            key={adjustment.label}
            className="flex items-center justify-between rounded-md border border-border/60 bg-bg/40 px-3 py-2"
          >
            <span>{adjustment.label}</span>
            <span className="font-mono text-text">
              {formatSignedCurrency(adjustment.amount)}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-3 text-[10px] text-text-muted">
        {context.latest_session ? (
          <span>Latest negotiated: {context.latest_session}</span>
        ) : null}
        {context.spread_to_cutout != null ? (
          <span>Cutout spread: {formatSignedCurrency(context.spread_to_cutout)}</span>
        ) : null}
        {signal ? (
          <span>
            Tone: {signal.tone.toUpperCase()} {signal.confidence_pct}%
          </span>
        ) : null}
        <span>Weight input: {formatInt(input.weight_lbs)} lb</span>
      </div>
    </Card>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">
        {label}
      </div>
      {children}
    </label>
  );
}
