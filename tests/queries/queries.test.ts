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
  chain.gte = vi.fn().mockResolvedValue({ data: listData ?? [singleData], error: null });
  chain.single = vi.fn().mockResolvedValue({ data: singleData, error: null });
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
  });
});
