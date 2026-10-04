import { expect, test } from 'bun:test';

import { parseNativeVerificationDependencyRequest } from '../../src/bootstrap/toolchain/native-verification-dependencies.ts';
import { ExactJsonError, type ExactJsonFailureKind } from '../../src/contracts/exact-json.ts';

const request = Object.freeze({
  schema: 'sec-native-verification-dependency-setup-v1',
  phase: 'prepare',
  kind: 'source-program',
  deadlineAtUnixMs: 1_893_456_000_000,
  transportDigest: `sha256:${'a'.repeat(64)}`
});

function bytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function expectJsonFailure(input: Uint8Array, kind: ExactJsonFailureKind): void {
  let caught: unknown;
  try { parseNativeVerificationDependencyRequest(input); }
  catch (error) { caught = error; }
  expect(caught).toBeInstanceOf(ExactJsonError);
  expect((caught as ExactJsonError).kind).toBe(kind);
}

test('native dependency wire decoding preserves every closed phase and consumer kind as data only', () => {
  for (const phase of ['prepare', 'observe'] as const) {
    for (const kind of ['source-program', 'verification-action', 'main-health', 'hosted-sut', 'dependency-canary'] as const) {
      const expected = { ...request, phase, kind };
      const parsed = parseNativeVerificationDependencyRequest(bytes(expected));
      expect(parsed).toEqual(expected);
      expect(parseNativeVerificationDependencyRequest(bytes(parsed))).toEqual(expected);
    }
  }
});

test('native dependency request cannot supply paths, commands or authority projections', () => {
  for (const extra of [
    { root: '/tmp/other' }, { executable: '/bin/sh' }, { argv: ['-c', 'true'] },
    { ready: true }, { generationDigest: request.transportDigest }, { actionKind: 'source-program' }
  ]) {
    expect(() => parseNativeVerificationDependencyRequest(bytes({ ...request, ...extra }))).toThrow();
  }
  const missing = { ...request };
  Reflect.deleteProperty(missing, 'transportDigest');
  expect(() => parseNativeVerificationDependencyRequest(bytes(missing))).toThrow();
});

test('native dependency request rejects unknown operations and malformed identities or deadlines', () => {
  for (const patch of [
    { schema: 'sec-native-verification-dependency-setup-v2' }, { phase: 'install' }, { kind: 'shell' },
    { transportDigest: 'sha256:abc' }, { transportDigest: `sha256:${'A'.repeat(64)}` },
    { transportDigest: 'a'.repeat(64) }, { deadlineAtUnixMs: 0 }, { deadlineAtUnixMs: -1 },
    { deadlineAtUnixMs: 1.5 }, { deadlineAtUnixMs: Number.MAX_SAFE_INTEGER + 1 },
    { deadlineAtUnixMs: '1893456000000' }
  ]) {
    expect(() => parseNativeVerificationDependencyRequest(bytes({ ...request, ...patch }))).toThrow();
  }
});

test('native dependency request rejects duplicate decisions in the original JSON bytes', () => {
  const text = JSON.stringify(request);
  const duplicate = `${text.slice(0, -1)},"phase":"observe"}`;
  expectJsonFailure(new TextEncoder().encode(duplicate), 'duplicate-key');
  const escapedDuplicate = `${text.slice(0, -1)},"ph\\u0061se":"prepare"}`;
  expectJsonFailure(new TextEncoder().encode(escapedDuplicate), 'duplicate-key');
});

test('native dependency request uses actual byte-view bounds and exact UTF-8', () => {
  const encoded = bytes(request);
  const backing = new Uint8Array(encoded.length + 20);
  backing.fill(0xff);
  backing.set(encoded, 10);
  expect(parseNativeVerificationDependencyRequest(backing.subarray(10, 10 + encoded.length))).toEqual(request);
  expectJsonFailure(backing, 'invalid-utf8');
  expectJsonFailure(new Uint8Array([0xff]), 'invalid-utf8');
  expectJsonFailure(new Uint8Array([0xef, 0xbb, 0xbf, ...encoded]), 'invalid-json');
});

test('native dependency request enforces byte and recursive-container limits before semantic decoding', () => {
  const encoded = bytes(request);
  const atLimit = new Uint8Array(4_096).fill(0x20);
  atLimit.set(encoded);
  expect(parseNativeVerificationDependencyRequest(atLimit)).toEqual(request);
  const overLimit = new Uint8Array(4_097).fill(0x20);
  overLimit.set(encoded);
  Object.defineProperty(overLimit, 'byteLength', { value: 1 });
  expectJsonFailure(overLimit, 'input-too-large');
  expectJsonFailure(bytes({ ...request, kind: { nested: { value: 'source-program' } } }), 'depth-limit');
});
