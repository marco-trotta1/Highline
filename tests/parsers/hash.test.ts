import { describe, it, expect } from 'vitest';
import { sha256 } from '../../lib/utils/hash';

describe('sha256', () => {
  it('produces a 64-char hex string', () => {
    const result = sha256('hello world');
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic', () => {
    expect(sha256('abc')).toBe(sha256('abc'));
  });

  it('is sensitive to content changes', () => {
    expect(sha256('abc')).not.toBe(sha256('abcd'));
  });
});
