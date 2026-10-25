import { expect, test } from 'bun:test';

import type { NoFollowDirectoryTreeInventoryEntry } from '../../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import { assertHostedCandidateDependencyPayload, parseNativeVerificationDependencyRequest } from '../../../src/bootstrap/toolchain/native-verification-dependencies.ts';
import { ExactJsonError, type ExactJsonFailureKind } from '../../../src/contracts/exact-json.ts';

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
  for (const kind of ['source-program', 'verification-action', 'main-health', 'hosted-sut', 'dependency-canary'] as const) {
    const expected = { ...request, kind };
    expect(parseNativeVerificationDependencyRequest(bytes(expected))).toEqual(expected);
  }
  const observed = { ...request, phase: 'observe' };
  expect(parseNativeVerificationDependencyRequest(bytes(observed))).toEqual(observed);
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

test('native dependency request binds exact JSON decisions and byte/depth limits before semantic decoding', () => {
  const text = JSON.stringify(request);
  expectJsonFailure(new TextEncoder().encode(`${text.slice(0, -1)},"phase":"observe"}`), 'duplicate-key');
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


const innerCandidate = Object.freeze({ schema: 'sec-hosted-candidate-preparation-v1',
  actionKey: `sha256:${'1'.repeat(64)}`, resolutionDigest: `sha256:${'2'.repeat(64)}`,
  authorizationDigest: `sha256:${'3'.repeat(64)}`, operationSemanticDigest: `sha256:${'4'.repeat(64)}`,
  baseSha: 'a'.repeat(40), baseTreeSha: 'b'.repeat(40), headSha: 'c'.repeat(40), headTreeSha: 'd'.repeat(40),
  archiveDigest: `sha256:${'5'.repeat(64)}`, inventoryDigest: `sha256:${'6'.repeat(64)}`,
  dependencyClosureDigest: `sha256:${'7'.repeat(64)}`, gitBundleDigest: `sha256:${'8'.repeat(64)}`,
  deadlineAtUnixMs: request.deadlineAtUnixMs, inputAccess: 'read-only' });

test('inner candidate is a closed distinct target context, not an arbitrary-root request', () => {
  for (const phase of ['prepare', 'observe'] as const) {
    const wire = { ...request, phase, kind: 'hosted-candidate' as const, candidate: innerCandidate };
    expect(parseNativeVerificationDependencyRequest(bytes(wire))).toEqual(wire);
  }
  const wire = { ...request, kind: 'hosted-candidate', candidate: innerCandidate };
  for (const patch of [{ root: '/elsewhere' }, { phase: 'install' }, { kind: 'hosted-sut' },
    { candidate: undefined }, { candidate: { ...innerCandidate, targetRoot: '/workspace' } },
    { candidate: { ...innerCandidate, deadlineAtUnixMs: request.deadlineAtUnixMs + 1 } },
    { candidate: { ...innerCandidate, inputAccess: 'caller-chooses' } },
    { candidate: { ...innerCandidate, authority: true } }]) {
    expect(() => parseNativeVerificationDependencyRequest(bytes({ ...wire, ...patch }))).toThrow();
  }
  expect(() => parseNativeVerificationDependencyRequest(bytes({ ...request, candidate: innerCandidate }))).toThrow();
});

test('candidate payload admits missing or differently bound regenerated metadata and retains all package obligations', () => {
  // These inventories are comparison data, never physical issuer capabilities.
  const member = (relativePath: string, patch: Partial<NoFollowDirectoryTreeInventoryEntry> = {}): NoFollowDirectoryTreeInventoryEntry => ({
    relativePath, kind: 'file', device: '1', inode: '2', size: 4,
    contentDigest: `sha256:${'1'.repeat(64)}`, byteDigest: `sha256:${'2'.repeat(64)}`,
    linkTarget: null, permissionMode: 0o444, ...patch
  });
  const raw = [member('package', { kind: 'directory', size: 0, permissionMode: 0o555 }),
    member('package/tool.js', { permissionMode: 0o555 }), member('.bin', { kind: 'directory', size: 0, permissionMode: 0o555 }),
    member('.bin/tool', { kind: 'link', size: 0, linkTarget: '../package/tool.js', permissionMode: null }),
    member('package/.sec-private-payload')];
  const control = '.sec-compiler-deps-binding-v5.json';
  const trusted = [...raw.map(entry => ({ ...entry, relativePath: `node_modules/${entry.relativePath}` })),
    member(`node_modules/${control}`)];
  expect(() => assertHostedCandidateDependencyPayload(raw, trusted)).not.toThrow();
  expect(() => assertHostedCandidateDependencyPayload([...raw, member(control, {
    byteDigest: `sha256:${'3'.repeat(64)}`, size: 500
  })], trusted)).not.toThrow();
  // Relative spellings remain exact; collapsing x/.. could traverse a symlink.
  for (const changed of [raw.slice(0, -1), [...raw, member('.sec-other')],
    raw.map(entry => entry.relativePath !== 'package/tool.js' ? entry : { ...entry, byteDigest: `sha256:${'4'.repeat(64)}` as const }),
    raw.map(entry => entry.relativePath !== 'package/tool.js' ? entry : { ...entry, permissionMode: 0o444 }),
    ...['../../outside', '/workspace/node_modules/package/tool.js', '../package/other.js', './tool', '..',
      '../package/../package/tool.js', '../package\\tool.js'].map(linkTarget =>
      raw.map(entry => entry.kind !== 'link' ? entry : { ...entry, linkTarget })),
    [...raw, member(control, { kind: 'link', linkTarget: 'package/tool.js' })],
    [...raw, member(control, { kind: 'directory' })]]) {
    expect(() => assertHostedCandidateDependencyPayload(changed, trusted)).toThrow();
  }
});
