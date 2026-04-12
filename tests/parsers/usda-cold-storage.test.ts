import { describe, it, expect } from 'vitest';

import {
  parseColdStorageQuickStatsResponse,
} from '../../lib/parsers/usda-cold-storage';

const MOCK_HISTORICAL_DATA = [
  { total_beef_million_lbs: 480.0 },
  { total_beef_million_lbs: 470.0 },
  { total_beef_million_lbs: 460.0 },
  { total_beef_million_lbs: 455.0 },
  { total_beef_million_lbs: 450.0 },
];

const MOCK_QUICK_STATS_PAYLOAD = {
  data: [
    {
      year: '2026',
      reference_period_desc: 'MAR',
      Value: '490.5',
      short_desc: 'TOTAL BEEF, COLD STORAGE, STOCKS, MEASURED IN MILLION POUNDS',
    },
  ],
};

describe('parseColdStorage', () => {
  it('parses cold storage data and computes the five-year average delta', () => {
    const result = parseColdStorageQuickStatsResponse(
      MOCK_QUICK_STATS_PAYLOAD,
      MOCK_HISTORICAL_DATA
    );

    expect(result.parsedRecord.total_beef_million_lbs).toBe(490.5);
    expect(result.parsedRecord.month).toBe(3);
    expect(result.parsedRecord.year).toBe(2026);
    expect(result.parsedRecord.vs_5yr_avg_pct).toBeCloseTo(5.94, 1);
    expect(result.sha256).toHaveLength(64);
  });

  it('computes 0% when there is no historical baseline', () => {
    const result = parseColdStorageQuickStatsResponse(MOCK_QUICK_STATS_PAYLOAD, []);
    expect(result.parsedRecord.vs_5yr_avg_pct).toBe(0);
  });
});
