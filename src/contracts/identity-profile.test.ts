import assert from 'node:assert/strict';
import { test } from 'node:test';

import { IDENTITY_PROFILE, identityFrameHeader, parseIdentity, type Identity } from './identity-profile.ts';

const hash = `blake3:${'a'.repeat(64)}`;
const record = () => ({ profile: IDENTITY_PROFILE, domain: 'evidence', schema: 'record/v2', digest: hash });

test('identity header freezes exact magic, version, endianness and lengths', () => {
  assert.equal(Buffer.from(identityFrameHeader('evidence', 'record/v2')).toString('hex'),
    '7365632e6964656e746974790001000865766964656e636500097265636f72642f7632');
});

test('length framing separates otherwise ambiguous domain/schema concatenations', () => {
  assert.notDeepEqual(identityFrameHeader('ab', 'c'), identityFrameHeader('a', 'bc'));
  assert.notDeepEqual(identityFrameHeader('evidence', 'record/v2'), identityFrameHeader('evidence', 'record/v3'));
  assert.notDeepEqual(identityFrameHeader('evidence', 'record/v2'), identityFrameHeader('revision', 'record/v2'));
});

test('headers do not expose mutable global prefix state', () => {
  const first = identityFrameHeader('evidence', 'record/v2');
  const expected = Buffer.from(first);
  first.fill(0);
  assert.deepEqual(Buffer.from(identityFrameHeader('evidence', 'record/v2')), expected);
});

test('namespace grammar rejects normalization, suffix-newline and encoding ambiguity', () => {
  for (const invalid of ['', 'Evidence', 'évidence', ' evidence', 'a:b', 'a\n', 'a\r', 'a\u2028',
    'a\0', '-a', '1a', 'a'.repeat(129), null, {}, new String('a')]) {
    assert.throws(() => identityFrameHeader(invalid as string, 'record/v2'), TypeError);
    assert.throws(() => identityFrameHeader('evidence', invalid as string), TypeError);
  }
  assert.equal(identityFrameHeader('a'.repeat(128), 'b'.repeat(128)).byteLength, 274);
});

test('identity parsing copies and freezes exact metadata for its consumer', () => {
  const input = record();
  const captured = parseIdentity(input, 'evidence', 'record/v2');
  input.digest = `blake3:${'b'.repeat(64)}`;
  assert.equal(captured.digest, hash);
  assert.equal(Object.isFrozen(captured), true);
  assert.notEqual(captured, input);
  const nullPrototype = Object.assign(Object.create(null), record());
  assert.deepEqual(parseIdentity(nullPrototype, 'evidence', 'record/v2'), record());
});

test('mixed algorithms, profiles, domains and schemas fail before digest use', () => {
  for (const input of [
    { ...record(), digest: `sha256:${'a'.repeat(64)}` },
    { ...record(), digest: 'a'.repeat(64) },
    { ...record(), digest: `${hash}\n` },
    { ...record(), profile: 'blake3-512-canonical-json-v1' },
    { ...record(), profile: 'blake3-256-canonical-json-v2' },
    { ...record(), domain: 'revision' },
    { ...record(), schema: 'record/v1' }
  ]) assert.throws(() => parseIdentity(input, 'evidence', 'record/v2'), TypeError);
});

test('identity parser rejects shape ambiguity without invoking accessors', () => {
  let invoked = 0;
  const accessor = { ...record() };
  Object.defineProperty(accessor, 'digest', { enumerable: true, get() { invoked += 1; return hash; } });
  const nonenumerable = { ...record() };
  Object.defineProperty(nonenumerable, 'digest', { enumerable: false, value: hash });
  const symbol = { ...record(), [Symbol('extra')]: true };
  const inherited = Object.create(record());
  const missing = { ...record() } as Partial<ReturnType<typeof record>>;
  delete missing.schema;
  for (const input of [null, [], 1, 'identity', accessor, nonenumerable, symbol, inherited,
    { ...record(), extra: true }, missing]) {
    assert.throws(() => parseIdentity(input, 'evidence', 'record/v2'), TypeError);
  }
  assert.equal(invoked, 0);
});

test('identity parser does not interrogate proxy traps', () => {
  const input = new Proxy(record(), {
    ownKeys() { throw new Error('trap invoked'); },
    getPrototypeOf() { throw new Error('trap invoked'); },
    getOwnPropertyDescriptor() { throw new Error('trap invoked'); }
  });
  assert.throws(() => parseIdentity(input, 'evidence', 'record/v2'), TypeError);
});

test('identity brands preserve semantic domain and schema separation', () => {
  const evidence = parseIdentity(record(), 'evidence', 'record/v2');
  // @ts-expect-error same 32 bytes cannot erase the semantic domain
  const revision: Identity<'revision', 'record/v2'> = evidence;
  // @ts-expect-error schema version remains part of the identity type
  const older: Identity<'evidence', 'record/v1'> = evidence;
  void revision; void older;
});
