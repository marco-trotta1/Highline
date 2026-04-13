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
