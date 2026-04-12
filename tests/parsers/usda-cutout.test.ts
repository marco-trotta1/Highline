import { describe, it, expect, vi } from 'vitest';

import {
  parseCutout,
  parseCutoutApiPayload,
} from '../../lib/parsers/usda-cutout';
import { SourceFetchError } from '../../lib/types';

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
  it('parses the USDA API payload into a parser envelope', () => {
    const result = parseCutoutApiPayload(MOCK_PAYLOAD);

    expect(result.parsedRecord.date).toBe('2026-04-10');
    expect(result.parsedRecord.report_type).toBe('LM_XB403');
    expect(result.parsedRecord.choice_total).toBe(380.9);
    expect(result.parsedRecord.select_total).toBe(381.34);
    expect(result.parsedRecord.choice_select_spread).toBeCloseTo(-0.44, 2);
    expect(result.parsedRecord.short_plate).toBe(304.79);
    expect(result.rawExtractedContent).toEqual(MOCK_PAYLOAD);
    expect(result.sha256).toHaveLength(64);
    expect(result.parsedRecord.source_hash).toBe(result.sha256);
  });

  it('fetches the USDA cutout API and parses the latest report', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => MOCK_PAYLOAD,
    } as Response);

    const result = await parseCutout('unused', fetchMock);
    expect(result.parsedRecord.date).toBe('2026-04-10');
    expect(result.parsedRecord.choice_total).toBe(380.9);
  });

  it('throws SourceFetchError when the USDA cutout request fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: 'Bad Gateway',
    } as Response);

    await expect(parseCutout('unused', fetchMock)).rejects.toThrow(SourceFetchError);
  });
});
