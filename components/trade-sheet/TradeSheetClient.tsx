'use client';

import { useState } from 'react';
import type { SubprimalPriceRow } from '@/lib/types';

type Grade = 'Choice' | 'Select' | 'Choice and Select';

const GRADES: Grade[] = ['Choice', 'Select', 'Choice and Select'];

const PRIMAL_ORDER = [
  'Rib',
  'Chuck',
  'Brisket',
  'Short Plate',
  'Round',
  'Loin',
  'Flank',
] as const;
type Primal = (typeof PRIMAL_ORDER)[number];

function getPrimal(desc: string): Primal | null {
  if (desc.startsWith('Rib')) return 'Rib';
  if (desc.startsWith('Chuck')) return 'Chuck';
  if (desc.startsWith('Brisket')) return 'Brisket';
  if (desc.startsWith('Short Plate')) return 'Short Plate';
  if (desc.startsWith('Round')) return 'Round';
  if (desc.startsWith('Loin')) return 'Loin';
  if (desc.startsWith('Flank')) return 'Flank';
  return null;
}

type DisplayRow = {
  item_description: string;
  primal: Primal | null;
  number_trades: number | null;
  price_range_low: number | null;
  price_range_high: number | null;
  weighted_average: number | null;
  delta: number | null;
};

function buildDisplayRows(
  rows: SubprimalPriceRow[],
  grade: Grade,
  hasBothSessions: boolean
): DisplayRow[] {
  const gradeRows = rows.filter((r) => r.grade === grade);
  const byItem = new Map<string, { am?: SubprimalPriceRow; pm?: SubprimalPriceRow }>();
  for (const row of gradeRows) {
    const entry = byItem.get(row.item_description) ?? {};
    if (row.session === 'AM') entry.am = row;
    else if (row.session === 'PM') entry.pm = row;
    byItem.set(row.item_description, entry);
  }

  const result: DisplayRow[] = [];
  for (const [item_description, { am, pm }] of byItem) {
    const display = pm ?? am;
    if (!display) continue;
    const delta =
      hasBothSessions &&
      am?.weighted_average != null &&
      pm?.weighted_average != null
        ? pm.weighted_average - am.weighted_average
        : null;
    result.push({
      item_description,
      primal: getPrimal(item_description),
      number_trades: display.number_trades,
      price_range_low: display.price_range_low,
      price_range_high: display.price_range_high,
      weighted_average: display.weighted_average,
      delta,
    });
  }

  return result.sort((a, b) => {
    const aIdx =
      a.primal !== null
        ? (PRIMAL_ORDER as readonly string[]).indexOf(a.primal)
        : PRIMAL_ORDER.length;
    const bIdx =
      b.primal !== null
        ? (PRIMAL_ORDER as readonly string[]).indexOf(b.primal)
        : PRIMAL_ORDER.length;
    if (aIdx !== bIdx) return aIdx - bIdx;
    return a.item_description.localeCompare(b.item_description);
  });
}

function fmtPrice(n: number | null): string {
  return n == null ? '—' : n.toFixed(2);
}

function fmtTrades(n: number | null): string {
  return n == null ? '—' : String(Math.round(n));
}

function fmtDelta(n: number | null): { text: string; cls: string } {
  if (n == null) return { text: '—', cls: 'text-text-muted' };
  if (n === 0) return { text: '0.00', cls: 'text-text-muted' };
  const sign = n > 0 ? '+' : '-';
  return {
    text: `${sign}${Math.abs(n).toFixed(2)}`,
    cls: n > 0 ? 'text-bull' : 'text-bear',
  };
}

function fmtReportDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const weekday = d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
  const month = d.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
  const day = d.toLocaleDateString('en-US', { day: 'numeric', timeZone: 'UTC' });
  const year = d.toLocaleDateString('en-US', { year: 'numeric', timeZone: 'UTC' });
  return `${weekday}, ${month} ${day} ${year}`;
}

function fmtStaleDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

type Props = {
  rows: SubprimalPriceRow[];
  latestDate: string | null;
  isStale: boolean;
};

export function TradeSheetClient({ rows, latestDate, isStale }: Props) {
  const [grade, setGrade] = useState<Grade>('Choice');

  const sessions = new Set(rows.map((r) => r.session));
  const hasBothSessions = sessions.has('AM') && sessions.has('PM');
  const singleSession: 'AM' | 'PM' | null = hasBothSessions
    ? null
    : sessions.has('PM')
      ? 'PM'
      : sessions.has('AM')
        ? 'AM'
        : null;

  const displayRows = buildDisplayRows(rows, grade, hasBothSessions);

  const grouped = new Map<Primal | null, DisplayRow[]>();
  for (const row of displayRows) {
    const arr = grouped.get(row.primal) ?? [];
    arr.push(row);
    grouped.set(row.primal, arr);
  }

  const colCount = hasBothSessions ? 6 : 5;
  const allGroups: Array<Primal | null> = [...PRIMAL_ORDER, null];

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text">Trade Sheet</h1>
        <div className="flex items-center gap-2">
          {singleSession && (
            <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-medium text-text-muted">
              {singleSession}
            </span>
          )}
          <span className="font-mono text-sm text-text-muted">
            {latestDate ? fmtReportDate(latestDate) : 'Awaiting first ingest'}
          </span>
        </div>
      </div>

      {/* Stale warning */}
      {isStale && latestDate && (
        <div className="flex items-center rounded-lg border border-warn/30 bg-warn/10 px-4 py-2.5 text-sm text-warn">
          Showing {fmtStaleDate(latestDate)} data — market closed or ingest pending.
        </div>
      )}

      {/* Grade toggle */}
      <div className="flex w-fit items-center gap-1 rounded-lg border border-border bg-card p-1">
        {GRADES.map((g) => (
          <button
            key={g}
            onClick={() => setGrade(g)}
            className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${
              grade === g
                ? 'bg-bg text-text shadow-sm'
                : 'text-text-muted hover:text-text'
            }`}
          >
            {g}
          </button>
        ))}
      </div>

      {/* Table */}
      {latestDate ? (
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                    Cut
                  </th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                    Trades
                  </th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                    Low
                  </th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                    High
                  </th>
                  <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                    Wtd Avg
                  </th>
                  {hasBothSessions && (
                    <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted">
                      Δ
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {allGroups.flatMap((primal) => {
                  const label = primal ?? 'Other';
                  const primalRows = grouped.get(primal);
                  if (!primalRows?.length) return [];
                  return [
                    <tr key={`hdr-${label}`} className="border-b border-border/40">
                      <td
                        colSpan={colCount}
                        className="bg-card/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-text-muted"
                      >
                        {label}
                      </td>
                    </tr>,
                    ...primalRows.map((row) => {
                      const delta = fmtDelta(row.delta);
                      return (
                        <tr
                          key={row.item_description}
                          className="border-b border-border/20 transition-colors last:border-0 hover:bg-card/60"
                        >
                          <td className="px-4 py-3 text-left text-text">
                            {row.item_description}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-text">
                            {fmtTrades(row.number_trades)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-text">
                            {fmtPrice(row.price_range_low)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-text">
                            {fmtPrice(row.price_range_high)}
                          </td>
                          <td className="px-4 py-3 text-right font-mono text-text">
                            {fmtPrice(row.weighted_average)}
                          </td>
                          {hasBothSessions && (
                            <td
                              className={`px-4 py-3 text-right font-mono ${delta.cls}`}
                            >
                              {delta.text}
                            </td>
                          )}
                        </tr>
                      );
                    }),
                  ];
                })}
              </tbody>
            </table>
          </div>
        </section>
      ) : (
        <section className="rounded-lg border border-border bg-card px-4 py-12 text-center text-sm text-text-muted">
          No data yet — awaiting first ingest.
        </section>
      )}
    </div>
  );
}
