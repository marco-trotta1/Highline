'use client';

import { FormEvent, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  PERFORMANCE_PRIMALS,
  type InternalPriceChannel,
  type InternalPriceGrade,
  type PerformanceDataRow,
  type PerformancePrimal,
  type PerformanceSummary,
} from '@/lib/types';
import { formatCurrency, formatDateShort, formatSignedCurrency } from '@/lib/format';

type PerformanceTrackerProps = {
  initialData: PerformanceDataRow[];
  initialSummary: PerformanceSummary;
};

type FormState = {
  date: string;
  primal: PerformancePrimal;
  grade: InternalPriceGrade;
  channel: InternalPriceChannel;
  price_cwt: string;
  notes: string;
};

type PrimalTableRow = {
  primal: PerformancePrimal;
  cutoutValue: number | null;
  ourPrice: number | null;
  delta: number | null;
  sevenDayAvgDelta: number | null;
};

type TrendRow = {
  date: string;
  dailyDelta: number;
  sevenDayAvg: number | null;
};

const GRADES: InternalPriceGrade[] = ['Choice', 'Select', 'Prime'];
const CHANNELS: InternalPriceChannel[] = ['fresh', 'frozen'];
const DAY_MS = 24 * 60 * 60 * 1000;

const PRIMAL_LABELS: Record<PerformancePrimal, string> = {
  chuck: 'Chuck',
  rib: 'Rib',
  loin: 'Loin',
  round: 'Round',
  brisket: 'Brisket',
  short_plate: 'Short Plate',
  flank: 'Flank',
};

function getTodayInputValue(): string {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().split('T')[0];
}

function average(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  if (valid.length === 0) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

function deltaClass(value: number | null): string {
  if (value == null) return 'text-text-muted';
  if (value > 0) return 'text-bull';
  if (value < 0) return 'text-bear';
  return 'text-text-muted';
}

function buildSummary(rows: PerformanceDataRow[]): PerformanceSummary {
  if (rows.length === 0) {
    return {
      today_avg_delta: null,
      seven_day_avg_delta: null,
      thirty_day_avg_delta: null,
      today_date: null,
    };
  }

  const latestDate = rows.reduce(
    (latest, row) => (row.date > latest ? row.date : latest),
    rows[0].date
  );
  const latestTime = new Date(`${latestDate}T00:00:00Z`).getTime();
  const sevenDayStart = latestTime - 6 * DAY_MS;

  return {
    today_avg_delta: average(rows.filter((row) => row.date === latestDate).map((row) => row.delta)),
    seven_day_avg_delta: average(
      rows
        .filter((row) => {
          const rowTime = new Date(`${row.date}T00:00:00Z`).getTime();
          return rowTime >= sevenDayStart && rowTime <= latestTime;
        })
        .map((row) => row.delta)
    ),
    thirty_day_avg_delta: average(rows.map((row) => row.delta)),
    today_date: latestDate,
  };
}

function buildPrimalRows(rows: PerformanceDataRow[], summary: PerformanceSummary): PrimalTableRow[] {
  const anchorDate = summary.today_date;
  const anchorTime = anchorDate ? new Date(`${anchorDate}T00:00:00Z`).getTime() : null;
  const sevenDayStart = anchorTime == null ? null : anchorTime - 6 * DAY_MS;

  return PERFORMANCE_PRIMALS.map((primal) => {
    const primalRows = rows
      .filter((row) => row.primal === primal)
      .sort((a, b) => b.date.localeCompare(a.date));
    const latest = primalRows[0];
    const sevenDayAvgDelta =
      anchorTime == null || sevenDayStart == null
        ? null
        : average(
            primalRows
              .filter((row) => {
                const rowTime = new Date(`${row.date}T00:00:00Z`).getTime();
                return rowTime >= sevenDayStart && rowTime <= anchorTime;
              })
              .map((row) => row.delta)
          );

    return {
      primal,
      cutoutValue: latest?.cutout_value ?? null,
      ourPrice: latest?.price_cwt ?? null,
      delta: latest?.delta ?? null,
      sevenDayAvgDelta,
    };
  });
}

function buildTrendRows(rows: PerformanceDataRow[]): TrendRow[] {
  const byDate = new Map<string, number[]>();
  for (const row of rows) {
    const values = byDate.get(row.date) ?? [];
    values.push(row.delta);
    byDate.set(row.date, values);
  }

  const daily = [...byDate.entries()]
    .map(([date, values]) => ({ date, dailyDelta: average(values) ?? 0 }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const withRolling = daily.map((row) => {
    const rowTime = new Date(`${row.date}T00:00:00Z`).getTime();
    const windowStart = rowTime - 6 * DAY_MS;
    const rollingValues = daily
      .filter((candidate) => {
        const candidateTime = new Date(`${candidate.date}T00:00:00Z`).getTime();
        return candidateTime >= windowStart && candidateTime <= rowTime;
      })
      .map((candidate) => candidate.dailyDelta);
    return {
      ...row,
      sevenDayAvg: average(rollingValues),
    };
  });

  return withRolling.slice(-14);
}

function fmtSigned(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return `${formatSignedCurrency(value)}/cwt`;
}

function fmtMoney(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return formatCurrency(value);
}

function SummaryMetric({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
        {label}
      </div>
      <div className={`mt-1 font-mono text-lg font-bold tabular-nums ${deltaClass(value)}`}>
        {fmtSigned(value)}
      </div>
    </div>
  );
}

export function PerformanceTracker({
  initialData,
  initialSummary,
}: PerformanceTrackerProps) {
  const [rows, setRows] = useState(initialData);
  const [summary, setSummary] = useState(initialSummary);
  const [form, setForm] = useState<FormState>({
    date: getTodayInputValue(),
    primal: 'chuck',
    grade: 'Choice',
    channel: 'fresh',
    price_cwt: '',
    notes: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const primalRows = useMemo(() => buildPrimalRows(rows, summary), [rows, summary]);
  const trendRows = useMemo(() => buildTrendRows(rows), [rows]);

  async function refreshPerformanceData() {
    const res = await fetch('/api/internal-prices', { cache: 'no-store' });
    if (!res.ok) throw new Error('Unable to refresh performance data');
    const nextRows = (await res.json()) as PerformanceDataRow[];
    setRows(nextRows);
    setSummary(buildSummary(nextRows));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const res = await fetch('/api/internal-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date: form.date,
          primal: form.primal,
          brand: 'AB',
          grade: form.grade,
          channel: form.channel,
          price_cwt: Number(form.price_cwt),
          notes: form.notes,
        }),
      });

      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error ?? 'Unable to save internal price');
      }

      await refreshPerformanceData();
      setForm((prev) => ({ ...prev, price_cwt: '', notes: '' }));
      setMessage('Price saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save internal price');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="sticky top-14 z-40 rounded-lg border border-border bg-card/95 p-4 shadow-lg shadow-black/10 backdrop-blur">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SummaryMetric
            label="Today's carcass advantage"
            value={summary.today_avg_delta}
          />
          <SummaryMetric
            label="7-day rolling avg"
            value={summary.seven_day_avg_delta}
          />
          <SummaryMetric
            label="30-day avg"
            value={summary.thirty_day_avg_delta}
          />
        </div>
      </div>

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h1 className="text-xl font-semibold text-text">Cutout Performance Tracker</h1>
          <p className="mt-1 text-sm text-text-muted">
            Internal AB prices versus USDA primal cutout values.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                  Primal
                </th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                  USDA Cutout
                </th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                  Our Price
                </th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                  Delta
                </th>
                <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                  7d Avg Delta
                </th>
              </tr>
            </thead>
            <tbody>
              {primalRows.map((row) => (
                <tr
                  key={row.primal}
                  className="border-b border-border/30 transition-colors last:border-0 hover:bg-bg/30"
                >
                  <td className="px-4 py-3 font-medium text-text">
                    {PRIMAL_LABELS[row.primal]}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-text">
                    {fmtMoney(row.cutoutValue)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-text">
                    {fmtMoney(row.ourPrice)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono font-bold tabular-nums ${deltaClass(row.delta)}`}
                  >
                    {fmtSigned(row.delta)}
                  </td>
                  <td
                    className={`px-4 py-3 text-right font-mono font-semibold tabular-nums ${deltaClass(row.sevenDayAvgDelta)}`}
                  >
                    {fmtSigned(row.sevenDayAvgDelta)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <div className="mb-4 flex items-baseline justify-between gap-3">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
            Delta Trend
          </h2>
          <span className="font-mono text-xs text-text-muted">
            Last 14 days
          </span>
        </div>
        <div className="h-72">
          {trendRows.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendRows} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="rgba(156, 163, 175, 0.15)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDateShort}
                  stroke="#9CA3AF"
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                />
                <YAxis
                  stroke="#9CA3AF"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `$${Number(value).toFixed(0)}`}
                  width={48}
                />
                <Tooltip
                  contentStyle={{
                    background: '#141820',
                    border: '1px solid #1E2430',
                    borderRadius: 8,
                    color: '#E5E7EB',
                  }}
                  labelFormatter={(label) => formatDateShort(String(label))}
                  formatter={(value, name) => [
                    fmtSigned(Number(value)),
                    name === 'dailyDelta' ? 'Daily delta' : '7-day rolling avg',
                  ]}
                />
                <Legend />
                <Line
                  type="monotone"
                  dataKey="dailyDelta"
                  name="Daily delta"
                  stroke="#3B82F6"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="sevenDayAvg"
                  name="7-day rolling avg"
                  stroke="#22C55E"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-text-muted">
              No internal prices entered yet.
            </div>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-4">
        <h2 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
          Price Entry
        </h2>
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <label className="lg:col-span-2">
            <span className="mb-1 block text-xs font-medium text-text-muted">Date</span>
            <input
              type="date"
              value={form.date}
              onChange={(event) => setForm((prev) => ({ ...prev, date: event.target.value }))}
              className="h-10 w-full rounded border border-border bg-bg px-3 font-mono text-sm text-text outline-none focus:border-accent"
              required
            />
          </label>

          <label className="lg:col-span-2">
            <span className="mb-1 block text-xs font-medium text-text-muted">Primal</span>
            <select
              value={form.primal}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, primal: event.target.value as PerformancePrimal }))
              }
              className="h-10 w-full rounded border border-border bg-bg px-3 text-sm text-text outline-none focus:border-accent"
            >
              {PERFORMANCE_PRIMALS.map((primal) => (
                <option key={primal} value={primal}>
                  {PRIMAL_LABELS[primal]}
                </option>
              ))}
            </select>
          </label>

          <label className="lg:col-span-2">
            <span className="mb-1 block text-xs font-medium text-text-muted">Grade</span>
            <select
              value={form.grade}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, grade: event.target.value as InternalPriceGrade }))
              }
              className="h-10 w-full rounded border border-border bg-bg px-3 text-sm text-text outline-none focus:border-accent"
            >
              {GRADES.map((grade) => (
                <option key={grade} value={grade}>
                  {grade}
                </option>
              ))}
            </select>
          </label>

          <label className="lg:col-span-2">
            <span className="mb-1 block text-xs font-medium text-text-muted">Channel</span>
            <select
              value={form.channel}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, channel: event.target.value as InternalPriceChannel }))
              }
              className="h-10 w-full rounded border border-border bg-bg px-3 text-sm capitalize text-text outline-none focus:border-accent"
            >
              {CHANNELS.map((channel) => (
                <option key={channel} value={channel}>
                  {channel}
                </option>
              ))}
            </select>
          </label>

          <label className="lg:col-span-2">
            <span className="mb-1 block text-xs font-medium text-text-muted">Price</span>
            <input
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={form.price_cwt}
              onChange={(event) => setForm((prev) => ({ ...prev, price_cwt: event.target.value }))}
              placeholder="$/cwt"
              className="h-10 w-full rounded border border-border bg-bg px-3 font-mono text-sm text-text outline-none focus:border-accent"
              required
            />
          </label>

          <label className="lg:col-span-10">
            <span className="mb-1 block text-xs font-medium text-text-muted">Notes</span>
            <input
              type="text"
              value={form.notes}
              onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
              className="h-10 w-full rounded border border-border bg-bg px-3 text-sm text-text outline-none focus:border-accent"
            />
          </label>

          <div className="flex items-end gap-3 lg:col-span-2">
            <button
              type="submit"
              disabled={isSubmitting}
              className="h-10 w-full rounded bg-accent px-4 text-sm font-semibold text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? 'Saving' : 'Save'}
            </button>
          </div>
        </form>
        {error ? <p className="mt-3 text-sm text-bear">{error}</p> : null}
        {message ? <p className="mt-3 text-sm text-bull">{message}</p> : null}
      </section>
    </div>
  );
}
