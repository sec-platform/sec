import { expect, test } from 'bun:test';


import { blockDirName } from "../../../src/adapters/workspace-context.ts";
import { encodeCanonicalBlockPhysicalKey, isCanonicalBlockId } from '../../../src/semantics/identity/block.ts';

test('canonical Block physical key codec is injective over accepted logical identities', () => {
  const ids = [
    'auth/basic-session',
    'auth/basic_session',
    'tenant/basic-workspace',
    'entity/customer-basic',
    'feature/a/b',
    'feature/a-b'
  ];
  for (const id of ids) expect(isCanonicalBlockId(id)).toBe(true);
  const keys = ids.map(encodeCanonicalBlockPhysicalKey);

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
    'single',
    'ticket//basic'
  ]) {
    expect(isCanonicalBlockId(invalid)).toBe(false);
    expect(() => encodeCanonicalBlockPhysicalKey(invalid)).toThrow();
  }
});
