import { describe, expect, it } from 'vitest';

import { formatDateShort } from '../lib/format';

describe('formatDateShort', () => {
  it('preserves the calendar day for date-only ISO strings', () => {
    expect(formatDateShort('2026-04-10')).toBe('Apr 10');
  });

  it('formats timestamps without crashing', () => {
    expect(formatDateShort('2026-04-10T20:34:08.467887+00:00')).toBeTruthy();
  });
});
