'use client';

import { useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CutoutDailyRow } from '@/lib/types';
import { Tooltip } from '@/components/ui/Tooltip';
import { formatDateShort } from '@/lib/format';

type Window = '7d' | '14d' | '30d' | '90d';

const WINDOWS: Window[] = ['7d', '14d', '30d', '90d'];

type CutoutTrendCardProps = {
  latest: CutoutDailyRow | null;
  yesterday: CutoutDailyRow | null;
};

export function CutoutTrendCard({ latest, yesterday }: CutoutTrendCardProps) {
  const [activeWindow, setActiveWindow] = useState<Window>('7d');

  const points = [yesterday, latest]
    .filter((row): row is CutoutDailyRow => row !== null)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .map((row) => ({
      date: row.date,
      label: formatDateShort(row.date),
      choice: row.choice_total,
    }));

  return (
    <div className="rounded-xl border border-[#1E2330] bg-[#13161E] p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <h2 className="text-sm font-medium text-zinc-200">Cutout Trend</h2>
          <Tooltip content="Choice boxed beef cutout values over the selected window. Source: USDA daily report.">
            <span aria-hidden className="text-zinc-500">
              ⓘ
            </span>
          </Tooltip>
        </div>
        <div className="flex gap-1 rounded-md border border-[#2A3040] bg-[#1E2330] p-0.5">
          {WINDOWS.map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setActiveWindow(w)}
              aria-pressed={w === activeWindow}
              className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
                w === activeWindow
                  ? 'bg-[#2A3040] text-zinc-100'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {w}
            </button>
          ))}
        </div>
      </div>
      <div className="h-64 w-full">
        {points.length < 2 ? (
          <div className="flex h-full items-center justify-center text-sm text-zinc-500">
            Not enough data to render trend
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 10, right: 16, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="cutoutFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#3B82F6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1E2330" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                stroke="#52525B"
                tick={{ fill: '#71717A', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: '#1E2330' }}
              />
              <YAxis
                stroke="#52525B"
                tick={{ fill: '#71717A', fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: '#1E2330' }}
                tickFormatter={(value: number) => `$${value.toFixed(0)}`}
                domain={['auto', 'auto']}
                width={56}
              />
              <RechartsTooltip
                contentStyle={{
                  backgroundColor: '#13161E',
                  border: '1px solid #2A3040',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelStyle={{ color: '#E5E7EB' }}
                formatter={(value) => [
                  typeof value === 'number' ? `$${value.toFixed(2)}` : String(value),
                  'Choice',
                ]}
              />
              <Legend
                verticalAlign="bottom"
                height={28}
                iconType="circle"
                wrapperStyle={{ fontSize: 12, color: '#9CA3AF' }}
              />
              <Area
                name="Choice cutout ($/cwt)"
                type="monotone"
                dataKey="choice"
                stroke="#3B82F6"
                strokeWidth={2}
                fill="url(#cutoutFill)"
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
