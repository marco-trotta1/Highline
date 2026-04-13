import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/supabase/client', () => ({
  createServerClient: vi.fn(),
}));

import { createServerClient } from '../../lib/supabase/client';
import {
  getLatestCutout,
  getCutoutHistory,
  getTodayNegotiated,
  getNegotiatedHistory,
  getLatestSlaughter,
  getLatestColdStorage,
  getLatestFutures,
  getYesterdayCutout,
  getSnapshot,
  getDataHealth,
} from '../../lib/supabase/queries';

const MOCK_CUTOUT = {
  id: 'uuid-1',
  date: '2026-04-10',
  report_type: 'LM_XB459',
  choice_total: 302.5,
  select_total: 288.0,
  choice_select_spread: 14.5,
  chuck: 230.0,
  rib: 420.0,
  loin: 380.0,
  round: 220.0,
  brisket: 210.0,
  short_plate: 175.0,
  flank: 195.0,
  source_hash: 'abc123',
  created_at: '2026-04-10T11:05:00Z',
  updated_at: '2026-04-10T11:05:00Z',
};

function makeQueryChain(singleData: unknown, listData?: unknown[]) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.order = vi.fn().mockReturnValue(chain);
  chain.limit = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.lt = vi.fn().mockReturnValue(chain);
  chain.gte = vi.fn().mockResolvedValue({ data: listData ?? [singleData], error: null });
  chain.single = vi.fn().mockResolvedValue({ data: singleData, error: null });
  chain.maybeSingle = vi.fn().mockResolvedValue({ data: singleData, error: null });
  return chain;
}

describe('getLatestCutout', () => {
  it('returns the most recent cutout row', async () => {
    const chain = makeQueryChain(MOCK_CUTOUT);
    (createServerClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue(chain),
    });
    const result = await getLatestCutout();
    expect(result?.choice_total).toBe(302.5);
    expect(result?.report_type).toBe('LM_XB459');
  });

  it('returns null on error', async () => {
    const chain = makeQueryChain(null);
    chain.single = vi.fn().mockResolvedValue({ data: null, error: { message: 'no rows' } });
    (createServerClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue(chain),
    });
    const result = await getLatestCutout();
    expect(result).toBeNull();
  });
});

describe('getYesterdayCutout', () => {
  it('returns the most recent cutout row strictly before today', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-12T12:00:00Z'));

    const rows = [
      { ...MOCK_CUTOUT, id: 'uuid-2', date: '2026-04-10', choice_total: 301.25 },
      { ...MOCK_CUTOUT, id: 'uuid-1', date: '2026-04-11', choice_total: 302.5 },
    ];

    let orderedRows = [...rows];
    let limitedRows = [...rows];

    const chain: Record<string, unknown> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockImplementation((column: string, options?: { ascending?: boolean }) => {
      if (column === 'date') {
        orderedRows = [...orderedRows].sort((a, b) =>
          options?.ascending ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)
        );
        limitedRows = orderedRows;
      }
      return chain;
    });
    chain.lt = vi.fn().mockImplementation((column: string, value: string) => {
      if (column === 'date') {
        orderedRows = orderedRows.filter((row) => row.date < value);
        limitedRows = orderedRows;
      }
      return chain;
    });
    chain.limit = vi.fn().mockImplementation((count: number) => {
      limitedRows = orderedRows.slice(0, count);
      return chain;
    });
    chain.maybeSingle = vi.fn().mockImplementation(async () => ({
      data: limitedRows[0] ?? null,
      error: null,
    }));

    (createServerClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue(chain),
    });

    const result = await getYesterdayCutout();

    expect(result?.date).toBe('2026-04-11');
    expect(result?.choice_total).toBe(302.5);
    expect(chain.lt).toHaveBeenCalledWith('date', '2026-04-12');
    expect(chain.limit).toHaveBeenCalledWith(1);

    vi.useRealTimers();
  });

  it('returns the most recent cutout row strictly before the provided reference date', async () => {
    const rows = [
      { ...MOCK_CUTOUT, id: 'uuid-3', date: '2026-04-10', choice_total: 301.25 },
      { ...MOCK_CUTOUT, id: 'uuid-2', date: '2026-04-11', choice_total: 302.5 },
      { ...MOCK_CUTOUT, id: 'uuid-1', date: '2026-04-12', choice_total: 303.75 },
    ];

    let orderedRows = [...rows];
    let limitedRows = [...rows];

    const chain: Record<string, unknown> = {};
    chain.select = vi.fn().mockReturnValue(chain);
    chain.order = vi.fn().mockImplementation((column: string, options?: { ascending?: boolean }) => {
      if (column === 'date') {
        orderedRows = [...orderedRows].sort((a, b) =>
          options?.ascending ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date)
        );
        limitedRows = orderedRows;
      }
      return chain;
    });
    chain.lt = vi.fn().mockImplementation((column: string, value: string) => {
      if (column === 'date') {
        orderedRows = orderedRows.filter((row) => row.date < value);
        limitedRows = orderedRows;
      }
      return chain;
    });
    chain.limit = vi.fn().mockImplementation((count: number) => {
      limitedRows = orderedRows.slice(0, count);
      return chain;
    });
    chain.maybeSingle = vi.fn().mockImplementation(async () => ({
      data: limitedRows[0] ?? null,
      error: null,
    }));

    (createServerClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue(chain),
    });

    const result = await getYesterdayCutout('2026-04-12');

    expect(result?.date).toBe('2026-04-11');
    expect(result?.choice_total).toBe(302.5);
    expect(chain.lt).toHaveBeenCalledWith('date', '2026-04-12');
  });
});

describe('getSnapshot', () => {
  it('uses the row before the latest cutout date for yesterday', async () => {
    const latestCutout = { ...MOCK_CUTOUT, id: 'uuid-latest', date: '2026-04-10', choice_total: 303.75 };
    const previousCutout = { ...MOCK_CUTOUT, id: 'uuid-prev', date: '2026-04-09', choice_total: 301.25 };

    const latestCutoutChain = makeQueryChain(latestCutout);
    const previousCutoutChain = makeQueryChain(previousCutout);
    const negotiatedChain = makeQueryChain(null, []);
    const futuresChain = makeQueryChain(null);
    const slaughterLatestChain = makeQueryChain(null);
    const slaughterHistoryChain = makeQueryChain(null, []);
    const coldStorageLatestChain = makeQueryChain(null);
    const coldStorageHistoryChain = makeQueryChain(null, []);
    const healthChain = makeQueryChain({ created_at: '2026-04-10T11:05:00Z' });

    let cutoutQueryCount = 0;
    let slaughterQueryCount = 0;
    let coldStorageQueryCount = 0;

    const from = vi.fn().mockImplementation((table: string) => {
      if (table === 'cutout_daily') {
        cutoutQueryCount += 1;
        if (cutoutQueryCount === 1) return latestCutoutChain;
        if (cutoutQueryCount === 2) return healthChain;
        if (cutoutQueryCount === 3) return previousCutoutChain;
      }

      if (table === 'negotiated_sales') return negotiatedChain;
      if (table === 'futures_snapshots') return futuresChain;

      if (table === 'slaughter_weekly') {
        slaughterQueryCount += 1;
        if (slaughterQueryCount === 1) return slaughterLatestChain;
        if (slaughterQueryCount === 2) return slaughterHistoryChain;
        return healthChain;
      }

      if (table === 'cold_storage_monthly') {
        coldStorageQueryCount += 1;
        if (coldStorageQueryCount === 1) return coldStorageLatestChain;
        if (coldStorageQueryCount === 2) return coldStorageHistoryChain;
        return healthChain;
      }

      return healthChain;
    });

    (createServerClient as ReturnType<typeof vi.fn>).mockReturnValue({ from });

    const snapshot = await getSnapshot();

    expect(snapshot.cutout.latest?.date).toBe('2026-04-10');
    expect(snapshot.cutout.yesterday?.date).toBe('2026-04-09');
    expect(previousCutoutChain.lt).toHaveBeenCalledWith('date', '2026-04-10');
  });
});

describe('getDataHealth', () => {
  it('marks negotiated stale when last update > 4 hours ago', async () => {
    const staleTime = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    const chain = makeQueryChain({ created_at: staleTime });
    (createServerClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue(chain),
    });
    const health = await getDataHealth();
    const neg = health.find((h) => h.source === 'negotiated_sales');
    expect(neg?.stale).toBe(true);
    expect(neg?.stale_reason).toBeTruthy();
  });

  it('marks negotiated fresh when last update < 4 hours ago', async () => {
    const freshTime = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const chain = makeQueryChain({ created_at: freshTime });
    (createServerClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue(chain),
    });
    const health = await getDataHealth();
    const neg = health.find((h) => h.source === 'negotiated_sales');
    expect(neg?.stale).toBe(false);
    expect(neg?.state).toBe('fresh');
  });

  it('marks source as no_data when the table is empty', async () => {
    const chain = makeQueryChain(null);
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    (createServerClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue(chain),
    });
    const health = await getDataHealth();
    const neg = health.find((h) => h.source === 'negotiated_sales');
    expect(neg?.state).toBe('no_data');
    expect(neg?.stale).toBe(false);
    expect(neg?.error_message).toBeNull();
  });

  it('marks source as error when the health query fails', async () => {
    const chain = makeQueryChain(null);
    chain.maybeSingle = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    (createServerClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue(chain),
    });
    const health = await getDataHealth();
    const neg = health.find((h) => h.source === 'negotiated_sales');
    expect(neg?.state).toBe('error');
    expect(neg?.stale).toBe(false);
    expect(neg?.error_message).toBe('permission denied');
  });
});
