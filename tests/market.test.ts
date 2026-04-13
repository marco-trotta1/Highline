import { describe, expect, it } from 'vitest';
import {
  buildBidRangeCalculatorContext,
  buildMarketDirectionSignal,
  calculateBidRange,
  evaluateFuturesHealth,
} from '../lib/market';
import type {
  ColdStorageMonthlyRow,
  DataHealthStatus,
  FuturesSnapshotRow,
  NegotiatedSalesRow,
} from '../lib/types';

const FUTURES_SAMPLE: FuturesSnapshotRow = {
  id: 'fut-1',
  timestamp: '2026-04-13T17:40:00Z',
  front_month_contract: 'LEJ26',
  front_month_price: 251.775,
  change_today: 2,
  change_pct: 0.8,
  source: 'yahoo_finance',
  created_at: '2026-04-13T17:40:01Z',
};

const NEGOTIATED_ROWS: NegotiatedSalesRow[] = [
  {
    id: 'neg-2',
    date: '2026-04-13',
    session: 'PM',
    low: 249,
    high: 251,
    weighted_avg: 250,
    volume_loads: 58,
    session_quality: 'active',
    source_hash: 'hash',
    created_at: '2026-04-13T18:05:00Z',
  },
  {
    id: 'neg-1',
    date: '2026-04-13',
    session: 'AM',
    low: 244,
    high: 251,
    weighted_avg: 248.58,
    volume_loads: 307,
    session_quality: 'active',
    source_hash: 'hash',
    created_at: '2026-04-13T15:05:00Z',
  },
];

const COLD_STORAGE_SAMPLE: ColdStorageMonthlyRow = {
  id: 'cold-1',
  month: 3,
  year: 2026,
  total_beef_million_lbs: 428.2,
  vs_5yr_avg_pct: -3.2,
  source_hash: 'cold-hash',
  created_at: '2026-04-01T12:00:00Z',
};

describe('evaluateFuturesHealth', () => {
  it('keeps intraday futures fresh at 49 minutes during market hours', () => {
    const probe = { lastUpdated: '2026-04-13T17:11:00Z', errorMessage: null };
    const now = new Date('2026-04-13T18:00:00Z');

    const health = evaluateFuturesHealth('futures_snapshots', probe, now);

    expect(health.state).toBe('fresh');
    expect(health.stale).toBe(false);
  });

  it('accepts the prior session close before the next market open', () => {
    const probe = { lastUpdated: '2026-04-10T18:04:00Z', errorMessage: null };
    const now = new Date('2026-04-13T12:45:00Z');

    const health = evaluateFuturesHealth('futures_snapshots', probe, now);

    expect(health.state).toBe('fresh');
  });
});

describe('market signals', () => {
  it('builds a bullish directional signal from firmer futures, negotiated cash, and tight storage', () => {
    const futuresHealth: DataHealthStatus = {
      source: 'futures_snapshots',
      state: 'fresh',
      last_updated: FUTURES_SAMPLE.timestamp,
      stale: false,
      stale_reason: null,
      error_message: null,
    };

    const signal = buildMarketDirectionSignal({
      futures: FUTURES_SAMPLE,
      futuresHealth,
      negotiatedRows: NEGOTIATED_ROWS,
      coldStorage: COLD_STORAGE_SAMPLE,
    });

    expect(signal?.tone).toBe('bull');
    expect(signal?.confidence_pct).toBeGreaterThanOrEqual(60);
    expect(signal?.drivers).toHaveLength(3);
  });

  it('builds a bid range around the negotiated benchmark with market adjustments', () => {
    const signal = buildMarketDirectionSignal({
      futures: FUTURES_SAMPLE,
      futuresHealth: {
        source: 'futures_snapshots',
        state: 'fresh',
        last_updated: FUTURES_SAMPLE.timestamp,
        stale: false,
        stale_reason: null,
        error_message: null,
      },
      negotiatedRows: NEGOTIATED_ROWS,
      coldStorage: COLD_STORAGE_SAMPLE,
    });
    const context = buildBidRangeCalculatorContext({
      negotiatedRows: NEGOTIATED_ROWS,
      cutoutChoice: 302.5,
      marketSignal: signal,
    });

    const output = calculateBidRange(context, {
      grade: 'choice-plus',
      brand: 'natural',
      channel: 'grid',
      weight_lbs: 1450,
    });

    expect(context.benchmark_price).toBeGreaterThan(248);
    expect(output.midpoint).toBeGreaterThan(output.benchmark);
    expect(output.high).toBeGreaterThan(output.low);
  });
});
