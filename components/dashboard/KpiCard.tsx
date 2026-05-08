'use client';

import { Line, LineChart } from 'recharts';
import { Tooltip } from '@/components/ui/Tooltip';

type KpiCardProps = {
  label: string;
  tooltip: string;
  value: string;
  deltaPct: number | null;
  sparklineValues: number[];
  secondaryLabel: string;
};

export function KpiCard({
  label,
  tooltip,
  value,
  deltaPct,
  sparklineValues,
  secondaryLabel,
}: KpiCardProps) {
  const sign =
    deltaPct == null ? null : deltaPct > 0 ? 'pos' : deltaPct < 0 ? 'neg' : 'flat';
  const deltaClass =
    sign === 'pos'
      ? 'bg-emerald-500/20 text-emerald-400'
      : sign === 'neg'
        ? 'bg-red-500/20 text-red-400'
        : 'bg-zinc-700/40 text-zinc-300';
  const arrow = sign === 'pos' ? '↑' : sign === 'neg' ? '↓' : '→';
  const sparkColor =
    sign === 'pos' ? '#34D399' : sign === 'neg' ? '#F87171' : '#71717A';

  const sparkData = sparklineValues.map((v, i) => ({ i, v }));

  return (
    <div className="rounded-xl border border-[#1E2330] bg-[#13161E] p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-1.5 text-sm text-zinc-400">
          <span>{label}</span>
          <Tooltip content={tooltip}>
            <span aria-hidden className="text-zinc-500">
              ⓘ
            </span>
          </Tooltip>
        </div>
        <div className="flex items-center gap-2">
          {sparkData.length >= 2 ? (
            <LineChart
              width={120}
              height={50}
              data={sparkData}
              margin={{ top: 4, right: 0, bottom: 4, left: 0 }}
              aria-hidden
            >
              <Line
                type="monotone"
                dataKey="v"
                stroke={sparkColor}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          ) : null}
          {deltaPct != null ? (
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${deltaClass}`}
            >
              {arrow} {Math.abs(deltaPct).toFixed(2)}%
            </span>
          ) : null}
        </div>
      </div>
      <div className="mt-4 font-mono text-4xl text-zinc-100">{value}</div>
      <p className="mt-2 text-xs text-zinc-500">{secondaryLabel}</p>
    </div>
  );
}
