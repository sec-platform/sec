import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  TCB_CLOSURE_LOCK,
  TCB_CLOSURE_LOCK_RECEIPT,
  TCB_CLOSURE_TRUST_REVISION,
  assertTcbClosureLockDataMatchesV1,
  computeTcbClosureLock,
  createTcbClosureCandidateSnapshotV1,
  finalizeTcbClosureCandidateSnapshotV1,
  parseTcbClosureLockSourceV1,
  readTcbClosureCandidateFileV1,
  trustedRuntimeClosure,
  verifyTcbClosureLock
} from '../../platform/shared/tcb-closure-lock.ts';
import { SEC_TRUSTED_BOOTSTRAP_REGISTRY_V1 } from '../../platform/shared/tcb-trust-root-contract.ts';

test('TCB candidate root exclusively drives closure discovery and hashing', () => {
  const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'sec-tcb-candidate-root-')));
  try {
    writeFileSync(path.join(root, 'entry.ts'), "import './leaf.ts';\n", 'utf8');
    writeFileSync(path.join(root, 'leaf.ts'), 'export const leaf = 1;\n', 'utf8');
    const closure = trustedRuntimeClosure(['entry.ts'], { candidateRoot: root });
    expect([...closure.closure].sort()).toEqual(['entry.ts', 'leaf.ts']);
    const lock = computeTcbClosureLock(closure, 'candidate-root-test', { candidateRoot: root });
    expect(lock.modules).toEqual(['entry.ts', 'leaf.ts']);
    expect(lock.moduleBlobs['entry.ts']).toMatch(/^[0-9a-f]{40}$/u);
    expect(lock.moduleContentDigests['leaf.ts']).toMatch(/^sha256:[0-9a-f]{64}$/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('one explicit candidate snapshot rejects discovery-to-hash mutation and missing-path appearance', () => {
  const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'sec-tcb-candidate-snapshot-')));
  try {
    writeFileSync(path.join(root, 'entry.ts'), "import './leaf.ts';\n", 'utf8');
    writeFileSync(path.join(root, 'leaf.ts'), 'export const leaf = 1;\n', 'utf8');
    const snapshot = createTcbClosureCandidateSnapshotV1({ candidateRoot: root });
    const options = { candidateSnapshot: snapshot };
    const closure = trustedRuntimeClosure(['entry.ts'], options);
    writeFileSync(path.join(root, 'leaf.ts'), 'export const leaf = 2;\n', 'utf8');
    expect(() => computeTcbClosureLock(closure, 'snapshot-test', options))
      .toThrow('snapshot changed');

    const missingSnapshot = createTcbClosureCandidateSnapshotV1({ candidateRoot: root });
    expect(() => readTcbClosureCandidateFileV1('appeared.ts', {
      candidateSnapshot: missingSnapshot
    })).toThrow('module is missing');
    writeFileSync(path.join(root, 'appeared.ts'), 'export const appeared = true;\n', 'utf8');
    expect(() => finalizeTcbClosureCandidateSnapshotV1(missingSnapshot))
      .toThrow('after observing a missing module');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('TCB candidate root rejects aliases, traversal, and non-regular candidate leaves', () => {
  const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'sec-tcb-candidate-negative-')));
  const outside = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'sec-tcb-candidate-outside-')));
  try {
    writeFileSync(path.join(root, 'entry.ts'), 'export const entry = 1;\n', 'utf8');
    writeFileSync(path.join(root, 'root-file'), 'not a directory\n', 'utf8');
    mkdirSync(path.join(root, 'directory.ts'));
    const outsideFile = path.join(outside, 'leaf.ts');
    const hardLinkSource = path.join(outside, 'hard-link-source.ts');
    writeFileSync(outsideFile, 'export const outside = true;\n', 'utf8');
    writeFileSync(hardLinkSource, 'export const hardLinkSource = true;\n', 'utf8');
    linkSync(hardLinkSource, path.join(root, 'leaf.ts'));
    symlinkSync(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');

    expect(() => trustedRuntimeClosure(['entry.ts'], {
      candidateRoot: `${root}${path.sep}`
    })).toThrow('absolute canonical path');
    expect(() => trustedRuntimeClosure(['entry.ts'], {
      candidateRoot: path.join(root, 'root-file')
    })).toThrow('physical non-symlink canonical directory');
    expect(() => trustedRuntimeClosure(['../entry.ts'], { candidateRoot: root }))
      .toThrow('module path is not canonical');
    expect(() => trustedRuntimeClosure(['directory.ts'], { candidateRoot: root }))
      .toThrow('physical single-link regular file');
    expect(() => trustedRuntimeClosure(['leaf.ts'], { candidateRoot: root }))
      .toThrow('physical single-link regular file');
    expect(() => trustedRuntimeClosure(['linked/leaf.ts'], { candidateRoot: root }))
      .toThrow('module path is not canonical');
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('checker closure strictly parses frozen V1 lock data and compares every field', () => {
  const canonicalSource = readFileSync(
    path.resolve(import.meta.dir, '../../platform/shared/tcb-closure-lock.ts'),
    'utf8'
  );
  expect(parseTcbClosureLockSourceV1(canonicalSource)).toEqual(TCB_CLOSURE_LOCK);
  expect(() => parseTcbClosureLockSourceV1(canonicalSource.replace(
    '"schema": "sec-tcb-closure-lock-v1"',
    '"schema": "sec-tcb-closure-lock-v2"'
  ))).toThrow('manual-bootstrap-required');
  expect(() => parseTcbClosureLockSourceV1(canonicalSource.replace(
    '"schema": "sec-tcb-closure-lock-v1",',
    '"schema": "sec-tcb-closure-lock-v1",\n  "schema": "sec-tcb-closure-lock-v1",'
  ))).toThrow('duplicate');
  expect(() => parseTcbClosureLockSourceV1(canonicalSource.replace(
    '"moduleCount": 78,',
    '"moduleCount": Number(78),'
  ))).toThrow('JSON-compatible literal AST');

  const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'sec-tcb-lock-data-')));
  try {
    writeFileSync(path.join(root, 'entry.ts'), "import './leaf.ts';\n", 'utf8');
    writeFileSync(path.join(root, 'leaf.ts'), 'export const leaf = 1;\n', 'utf8');
    const closure = trustedRuntimeClosure(['entry.ts'], { candidateRoot: root });
    const original = computeTcbClosureLock(closure, '1'.repeat(40), { candidateRoot: root });
    const parsed = parseTcbClosureLockSourceV1(
      `export const TCB_CLOSURE_LOCK: TcbClosureLock = ${JSON.stringify(original, null, 2)};\n`
    );
    expect(() => assertTcbClosureLockDataMatchesV1(parsed, original)).not.toThrow();
    const forgedRevisionLock = computeTcbClosureLock(closure, '2'.repeat(40), { candidateRoot: root });
    const validForgedRevisionAndDigest = parseTcbClosureLockSourceV1(
      `export const TCB_CLOSURE_LOCK: TcbClosureLock = ${JSON.stringify(forgedRevisionLock, null, 2)};\n`
    );
    expect(validForgedRevisionAndDigest.trustRevision).toBe('2'.repeat(40));
    expect(() => assertTcbClosureLockDataMatchesV1(validForgedRevisionAndDigest, original))
      .toThrow('does not match');
    writeFileSync(path.join(root, 'leaf.ts'), 'export const leaf = 2;\n', 'utf8');
    const changed = computeTcbClosureLock(closure, original.trustRevision, { candidateRoot: root });
    expect(() => assertTcbClosureLockDataMatchesV1(parsed, changed))
      .toThrow('does not match');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('TCB closure lock has the correct schema and trust revision', () => {
  expect(TCB_CLOSURE_LOCK.schema).toBe('sec-tcb-closure-lock-v1');
  expect(TCB_CLOSURE_LOCK.trustRevision).toBe(TCB_CLOSURE_TRUST_REVISION);
  expect(TCB_CLOSURE_LOCK.trustRevision).toBe('33216029c751fd55a1bace1b5ce63d3937a0064c');
});

test('TCB closure lock binds the reviewed causal module set', () => {
  expect(TCB_CLOSURE_LOCK.moduleCount).toBe(TCB_CLOSURE_LOCK.modules.length);
  expect(TCB_CLOSURE_LOCK.modules).toContain('platform/shared/canonical-primitives.ts');
  expect(new Set(TCB_CLOSURE_LOCK.modules).size).toBe(TCB_CLOSURE_LOCK.moduleCount);
});

test('TCB closure lock and registry causalRuntimePaths have exact identity parity', () => {
  expect(TCB_CLOSURE_LOCK.modules).toEqual(SEC_TRUSTED_BOOTSTRAP_REGISTRY_V1.causalRuntimePaths);
  expect(TCB_CLOSURE_LOCK.modules).toContain('platform/shared/tcb-trust-root-contract.ts');
  expect(TCB_CLOSURE_LOCK.modules).not.toContain('scripts/codex/repository-audit.ts');
});

test('TCB closure lock binds Git blobs and content digests for every module', () => {
  for (const module of TCB_CLOSURE_LOCK.modules) {
    expect(TCB_CLOSURE_LOCK.moduleBlobs[module]).toMatch(/^[0-9a-f]{40}$/);
    expect(TCB_CLOSURE_LOCK.moduleContentDigests[module]).toMatch(/^sha256:[0-9a-f]{64}$/);
  }
  expect(Object.keys(TCB_CLOSURE_LOCK.moduleBlobs)).toHaveLength(TCB_CLOSURE_LOCK.moduleCount);
  expect(Object.keys(TCB_CLOSURE_LOCK.moduleContentDigests)).toHaveLength(TCB_CLOSURE_LOCK.moduleCount);
});

test('TCB closure lock receipt records the generation metadata', () => {
  expect(TCB_CLOSURE_LOCK_RECEIPT.schema).toBe('sec-tcb-closure-lock-receipt-v1');
  expect(TCB_CLOSURE_LOCK_RECEIPT.trustRevision).toBe(TCB_CLOSURE_TRUST_REVISION);
  expect(TCB_CLOSURE_LOCK_RECEIPT.moduleCount).toBe(TCB_CLOSURE_LOCK.moduleCount);
  expect(TCB_CLOSURE_LOCK_RECEIPT.closureDigest).toBe(TCB_CLOSURE_LOCK.closureDigest);
  expect(TCB_CLOSURE_LOCK_RECEIPT.generatedBy).toBe('tcb-closure-maintainer');
});

test('live TCB closure passes lock verification', () => {
  const closure = trustedRuntimeClosure();
  const verification = verifyTcbClosureLock(closure);
  expect(verification.status).toBe('passed');
  expect(verification.failures).toEqual([]);
});

test('computeTcbClosureLock produces a closure digest that matches the frozen lock', () => {
  const closure = trustedRuntimeClosure();
  const live = computeTcbClosureLock(closure, TCB_CLOSURE_TRUST_REVISION);
  expect(live.closureDigest).toBe(TCB_CLOSURE_LOCK.closureDigest);
});

// ---------------------------------------------------------------------------
// Negative tests — each proves that a specific tampering breaks the lock
// ---------------------------------------------------------------------------

test('adding an untrusted module causes the lock to break (expansion)', () => {
  const closure = trustedRuntimeClosure();
  const tampered = {
    closure: new Set(closure.closure).add('platform/shared/untrusted-intruder.ts'),
    reviewedEdges: new Set(closure.reviewedEdges),
    reviewedExternalImports: new Set(closure.reviewedExternalImports),
    reviewedProcessDispatchers: new Set(closure.reviewedProcessDispatchers)
  };
  const verification = verifyTcbClosureLock(tampered);
  expect(verification.status).toBe('failed');
  expect(verification.failures).toEqual(expect.arrayContaining([
    expect.stringContaining('expansion: unexpected module platform/shared/untrusted-intruder.ts')
  ]));
});

test('removing a reviewed module causes the lock to break (contraction)', () => {
  const closure = trustedRuntimeClosure();
  const tampered = new Set(closure.closure);
  tampered.delete('platform/shared/canonical-primitives.ts');
  const verification = verifyTcbClosureLock({
    closure: tampered,
    reviewedEdges: closure.reviewedEdges,
    reviewedExternalImports: closure.reviewedExternalImports,
    reviewedProcessDispatchers: closure.reviewedProcessDispatchers
  });
  expect(verification.status).toBe('failed');
  expect(verification.failures).toEqual(expect.arrayContaining([
    expect.stringContaining('contraction: missing module platform/shared/canonical-primitives.ts')
  ]));
});

test('substituting a module path causes the lock to break', () => {
  const closure = trustedRuntimeClosure();
  const tampered = new Set(closure.closure);
  tampered.delete('platform/shared/canonical-primitives.ts');
  tampered.add('platform/shared/canonical-primitives-fake.ts');
  const verification = verifyTcbClosureLock({
    closure: tampered,
    reviewedEdges: closure.reviewedEdges,
    reviewedExternalImports: closure.reviewedExternalImports,
    reviewedProcessDispatchers: closure.reviewedProcessDispatchers
  });
  expect(verification.status).toBe('failed');
  expect(verification.failures).toEqual(expect.arrayContaining([
    expect.stringContaining('contraction: missing module platform/shared/canonical-primitives.ts'),
    expect.stringContaining('expansion: unexpected module platform/shared/canonical-primitives-fake.ts')
  ]));
});

test('introducing an unauthorized edge causes the lock to break', () => {
  const closure = trustedRuntimeClosure();
  const tampered = {
    closure: closure.closure,
    reviewedEdges: new Set(closure.reviewedEdges).add(
      'scripts/ci-workspace-fast.ts -> platform/unauthorized-target.ts'
    ),
    reviewedExternalImports: closure.reviewedExternalImports,
    reviewedProcessDispatchers: closure.reviewedProcessDispatchers
  };
  const verification = verifyTcbClosureLock(tampered);
  expect(verification.status).toBe('failed');
  expect(verification.failures).toEqual(expect.arrayContaining([
    expect.stringContaining('edge addition: unexpected edge')
  ]));
});

test('removing a reviewed edge causes the lock to break', () => {
  const closure = trustedRuntimeClosure();
  const tampered = {
    closure: closure.closure,
    reviewedEdges: new Set<string>(),
    reviewedExternalImports: closure.reviewedExternalImports,
    reviewedProcessDispatchers: closure.reviewedProcessDispatchers
  };
  const verification = verifyTcbClosureLock(tampered);
  expect(verification.status).toBe('failed');
  expect(verification.failures).toEqual(expect.arrayContaining([
    expect.stringContaining('edge removal: missing edge')
  ]));
});

test('adding an unauthorized external import causes the lock to break', () => {
  const closure = trustedRuntimeClosure();
  const tampered = {
    closure: closure.closure,
    reviewedEdges: closure.reviewedEdges,
    reviewedExternalImports: new Set(closure.reviewedExternalImports).add(
      'platform/shared/untrusted-module.ts -> node:worker_threads'
    ),
    reviewedProcessDispatchers: closure.reviewedProcessDispatchers
  };
  const verification = verifyTcbClosureLock(tampered);
  expect(verification.status).toBe('failed');
  expect(verification.failures).toEqual(expect.arrayContaining([
    expect.stringContaining('external import addition: unexpected')
  ]));
});

test('adding an unauthorized process dispatcher causes the lock to break', () => {
  const closure = trustedRuntimeClosure();
  const tampered = {
    closure: closure.closure,
    reviewedEdges: closure.reviewedEdges,
    reviewedExternalImports: closure.reviewedExternalImports,
    reviewedProcessDispatchers: new Set(closure.reviewedProcessDispatchers).add(
      'platform/shared/untrusted.ts::function-declaration:untrustedSpawn::spawn#1'
    )
  };
  const verification = verifyTcbClosureLock(tampered);
  expect(verification.status).toBe('failed');
  expect(verification.failures).toEqual(expect.arrayContaining([
    expect.stringContaining('process dispatcher addition: unexpected')
  ]));
});
