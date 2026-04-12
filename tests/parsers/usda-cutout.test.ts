import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  parseCutout,
  parseCutoutApiPayload,
} from '../../lib/parsers/usda-cutout';

const MOCK_PAYLOAD = [
  {
    reportSection: 'Summary',
    results: [
      {
        report_date: '04/10/2026',
        report_title:
          'National Daily Boxed Beef Cutout & Boxed Beef Cuts - Negotiated Sales - PM (PDF) (LM_XB403)',
      },
    ],
  },
  {
    reportSection: 'Current Cutout Values',
    results: [
      {
        choice_600_900_current: '380.90',
        select_600_900_current: '381.34',
      },
    ],
  },
  {
    reportSection: 'Composite Primal Values',
    results: [
      { primal_desc: 'Primal Chuck', choice_600_900: '317.93' },
      { primal_desc: 'Primal Rib', choice_600_900: '531.88' },
      { primal_desc: 'Primal Loin', choice_600_900: '510.63' },
      { primal_desc: 'Primal Round', choice_600_900: '319.64' },
      { primal_desc: 'Primal Brisket', choice_600_900: '346.22' },
      { primal_desc: 'Primal Plate', choice_600_900: '304.79' },
      { primal_desc: 'Primal Flank', choice_600_900: '221.22' },
    ],
  },
];

describe('parseCutout', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('parses all cutout fields from the USDA API payload', async () => {
    const result = parseCutoutApiPayload(MOCK_PAYLOAD);
    expect(result.choice_total).toBe(380.9);
    expect(result.select_total).toBe(381.34);
    expect(result.choice_select_spread).toBeCloseTo(-0.44, 2);
    expect(result.chuck).toBe(317.93);
    expect(result.rib).toBe(531.88);
    expect(result.loin).toBe(510.63);
    expect(result.round).toBe(319.64);
    expect(result.brisket).toBe(346.22);
    expect(result.short_plate).toBe(304.79);
    expect(result.flank).toBe(221.22);
    expect(result.source_hash).toHaveLength(64);
  });

  it('returns report_type from the report title', async () => {
    const result = parseCutoutApiPayload(MOCK_PAYLOAD);
    expect(result.report_type).toBe('LM_XB403');
  });

  it('fetches the USDA API and parses the latest cutout report', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => MOCK_PAYLOAD,
    } as Response);

    const result = await parseCutout('unused-api-key');
    expect(result.date).toBe('2026-04-10');
    expect(result.choice_total).toBe(380.9);
  });
});
