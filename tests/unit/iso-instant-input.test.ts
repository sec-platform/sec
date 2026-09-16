import { describe, expect, test } from 'bun:test';

import { canonicalizeIsoInstantInputV1 } from '../../src/system-architecture/foundation/contract/iso-instant.ts';

describe('ISO instant presentation input', () => {
  test('preserves canonical ECMAScript instants', () => {
    expect(canonicalizeIsoInstantInputV1('2026-08-20T11:26:19.559Z'))
      .toBe('2026-08-20T11:26:19.559Z');
  });

  test('canonicalizes PowerShell round-trip UTC and offset forms', () => {
    expect(canonicalizeIsoInstantInputV1('2026-08-20T11:26:19.5597234Z'))
      .toBe('2026-08-20T11:26:19.559Z');
    expect(canonicalizeIsoInstantInputV1('2026-08-20T19:26:19.5597234+08:00'))
      .toBe('2026-08-20T11:26:19.559Z');
  });

  test('rejects malformed, impossible, and non-instant inputs', () => {
    for (const value of [
      '2026-08-20T11:26:19Z',
      '2026-02-30T00:00:00.0000000Z',
      '2026-08-20T24:00:00.0000000Z',
      '2026-08-20',
      0,
      null
    ]) {
      expect(() => canonicalizeIsoInstantInputV1(value, 'generatedAt')).toThrow(/^generatedAt /u);
    }
  });
});
