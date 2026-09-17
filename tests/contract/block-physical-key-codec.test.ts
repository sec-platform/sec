import { expect, test } from 'bun:test';


import { encodeCanonicalBlockPhysicalKey, isCanonicalBlockId, matchesCanonicalBlockPhysicalKey } from '../../src/semantics/identity/block.ts';
import { blockDirName } from "../../src/adapters/workspace-context.ts";

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
  const keys = accepted.map(encodeCanonicalBlockPhysicalKey);

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
    expect(() => encodeCanonicalBlockPhysicalKey(invalid)).toThrow();
  }
});

test('physical key validation is bound to an already known logical identity', () => {
  expect(matchesCanonicalBlockPhysicalKey('auth/basic-session', 'auth.basic-session')).toBe(true);
  expect(matchesCanonicalBlockPhysicalKey('auth/basic-session', 'auth/basic-session')).toBe(false);
  expect(matchesCanonicalBlockPhysicalKey('auth/basic-session', 'auth.basic_session')).toBe(false);
  expect(matchesCanonicalBlockPhysicalKey('a.b/c', 'a.b.c')).toBe(false);
});
