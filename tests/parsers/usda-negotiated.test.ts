import { describe, it, expect, vi } from 'vitest';

import {
  parseNegotiatedApiPayload,
  parseNegotiatedSales,
} from '../../lib/parsers/usda-negotiated';
import {
  SourceFetchError,
  ValidationFailureError,
} from '../../lib/types';

type NegotiatedSection = {
  reportSection: string;
  results: Array<Record<string, string>>;
};

const AM_PAYLOAD: NegotiatedSection[] = [
  {
    reportSection: 'Summary',
    results: [
      {
        report_date: '04/10/2026',
        published_date: '04/10/2026 11:16:12',
        purchase_type_desc: 'NEGOTIATED CASH',
        current_period: 'Confirmed',
        current_date_volume: '656',
      },
    ],
  },
  {
    reportSection: 'Detail',
    results: [
      {
        purchase_type_code: 'NEGOTIATED CASH',
        class_desc: 'STEER',
        selling_basis_desc: 'LIVE FOB',
        grade_desc: 'Total all grades',
        head_count: '324',
        price_range_low: '246.00',
        price_range_high: '250.00',
        wtd_avg_price: '248.13',
      },
    ],
  },
];

const PM_PAYLOAD: NegotiatedSection[] = [
  {
    reportSection: 'Summary',
    results: [
      {
        report_date: '04/10/2026',
        published_date: '04/10/2026 15:01:39',
        purchase_type_desc: 'NEGOTIATED CASH',
        current_period: 'Confirmed',
        current_date_volume: '3,546',
      },
    ],
  },
  {
    reportSection: 'Detail',
    results: [
      {
        purchase_type_code: 'NEGOTIATED CASH',
        class_desc: 'STEER',
        selling_basis_desc: 'LIVE FOB',
        grade_desc: 'Total all grades',
        head_count: '2,023',
        price_range_low: '250.00',
        price_range_high: '250.00',
        wtd_avg_price: '250.00',
      },
    ],
  },
];

describe('parseNegotiatedSales', () => {
  it('parses the latest AM/PM payload and returns the parser envelope', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => AM_PAYLOAD,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => PM_PAYLOAD,
      } as Response);

    const result = await parseNegotiatedSales('unused', fetchMock);

    expect(result.parsedRecord.session).toBe('PM');
    expect(result.parsedRecord.date).toBe('2026-04-10');
    expect(result.parsedRecord.low).toBe(250);
    expect(result.parsedRecord.high).toBe(250);
    expect(result.parsedRecord.weighted_avg).toBe(250);
    expect(result.parsedRecord.volume_loads).toBe(93);
    expect(result.parsedRecord.session_quality).toBe('active');
    expect(result.rawExtractedContent).toEqual(PM_PAYLOAD);
    expect(result.sha256).toHaveLength(64);
    expect(result.parsedRecord.source_hash).toBe(result.sha256);
  });

  it('flags thin sessions when confirmed volume converts to fewer than 10 loads', () => {
    const thinPayload = structuredClone(AM_PAYLOAD);
    thinPayload[0].results[0].current_date_volume = '300';

    const result = parseNegotiatedApiPayload(thinPayload, 'AM');
    expect(result.parsedRecord.session_quality).toBe('thin');
    expect(result.parsedRecord.volume_loads).toBe(8);
  });

  it('throws ValidationFailureError when weighted average is out of range', () => {
    const invalidPayload = structuredClone(PM_PAYLOAD);
    invalidPayload[1].results[0].wtd_avg_price = '50.00';

    expect(() => parseNegotiatedApiPayload(invalidPayload, 'PM')).toThrow(
      ValidationFailureError
    );
  });

  it('throws SourceFetchError when the USDA API request fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    } as Response);

    await expect(parseNegotiatedSales('unused', fetchMock)).rejects.toThrow(
      SourceFetchError
    );
  });
});
