import { expect, test } from 'bun:test';


import {
  encodeCanonicalBlockPhysicalKeyV1,
  isCanonicalBlockId,
  matchesCanonicalBlockPhysicalKeyV1
} from '../../platform/shared/block-identity.ts';
import { blockDirName } from '../../platform/shared/paths.ts';

test('canonical Block physical key codec is injective over accepted logical identities', () => {
  const ids = [
    'auth/basic-session',
    'auth/basic_session',
    'tenant/basic-workspace',
    'entity/customer-basic',
    'feature/a/b',
    'feature/a-b'
  ];
  const accepted = ids.filter(isCanonicalBlockId);
  const keys = accepted.map(encodeCanonicalBlockPhysicalKeyV1);

  expect(new Set(keys).size).toBe(keys.length);
  expect(blockDirName('auth/basic-session')).toBe('auth.basic-session');
  expect(blockDirName('feature/a/b')).toBe('feature.a.b');
});

test('invalid logical identities never acquire a new physical key', () => {
  for (const invalid of [
    'a.b/c',
    'a\\b/c',
    'a:b/c',
    'A/b',
    'con/value',
    'single'
  ]) {
    expect(isCanonicalBlockId(invalid)).toBe(false);
    expect(() => encodeCanonicalBlockPhysicalKeyV1(invalid)).toThrow();
  }
});

test('physical key validation is bound to an already known logical identity', () => {
  expect(matchesCanonicalBlockPhysicalKeyV1('auth/basic-session', 'auth.basic-session')).toBe(true);
  expect(matchesCanonicalBlockPhysicalKeyV1('auth/basic-session', 'auth/basic-session')).toBe(false);
  expect(matchesCanonicalBlockPhysicalKeyV1('auth/basic-session', 'auth.basic_session')).toBe(false);
  expect(matchesCanonicalBlockPhysicalKeyV1('a.b/c', 'a.b.c')).toBe(false);
});
