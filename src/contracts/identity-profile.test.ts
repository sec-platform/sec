import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { canonicalEncodingChunks, canonicalJson, rawSha256, sha256 } from './canonical.ts';
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

test('shared canonical encoder retains golden bytes, sparse arrays and key order', () => {
  for (const value of [null, true, -0, 'é😀', '\ud800', [1, , 3], { b: 2, a: 1 },
    { '10': 1, '2': 2, z: 3 }, JSON.parse('{"__proto__": {"z":1,"a":2}}')]) {
    const encoded = [...canonicalEncodingChunks(value)].join('');
    assert.equal(encoded, JSON.stringify(canonicalJson(value)));
    assert.equal(sha256(value), rawSha256(encoded));
  }
  assert.equal(sha256({ b: 2, a: 1 }), 'sha256:43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777');
});

test('canonical chunks never split a surrogate pair between UTF-8 writes', () => {
  const value = Array.from({ length: 8 }, (_, index) => `${'x'.repeat(8190 + index)}😀`);
  const encoded = JSON.stringify(value);
  const hash = createHash('sha256');
  for (const chunk of canonicalEncodingChunks(value)) hash.update(chunk, 'utf8');
  assert.equal(hash.digest('hex'), createHash('sha256').update(encoded).digest('hex'));
});

test('canonical sharing and deep values retain prior stack-safe encoding', () => {
  const shared = { z: 1 };
  assert.equal([...canonicalEncodingChunks([shared, shared])].join(''), '[{"z":1},{"z":1}]');
  let value: unknown = null;
  for (let index = 0; index < 20_000; index += 1) value = [value];
  assert.equal(sha256(value), rawSha256(`${'['.repeat(20_000)}null${']'.repeat(20_000)}`));
});

test('canonical failure cannot produce a completed hash or contaminate another call', () => {
  const circular: unknown[] = []; circular.push(circular);
  for (const input of [undefined, NaN, Infinity, 1n, () => 0, Symbol(), circular]) {
    assert.throws(() => [...canonicalEncodingChunks(input)]);
    assert.throws(() => sha256(input));
  }
  assert.equal(sha256({ a: 1 }), rawSha256('{"a":1}'));
});
