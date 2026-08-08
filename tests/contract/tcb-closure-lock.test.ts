import { expect, test } from 'bun:test';

import {
  TCB_CLOSURE_LOCK,
  TCB_CLOSURE_LOCK_RECEIPT,
  TCB_CLOSURE_TRUST_REVISION,
  computeTcbClosureLock,
  trustedRuntimeClosure,
  verifyTcbClosureLock
} from '../../platform/shared/tcb-closure-lock.ts';
import { SEC_TRUSTED_BOOTSTRAP_REGISTRY_V1 } from '../../platform/shared/tcb-trust-root-contract.ts';

test('TCB closure lock has the correct schema and trust revision', () => {
  expect(TCB_CLOSURE_LOCK.schema).toBe('sec-tcb-closure-lock-v1');
  expect(TCB_CLOSURE_LOCK.trustRevision).toBe(TCB_CLOSURE_TRUST_REVISION);
  expect(TCB_CLOSURE_LOCK.trustRevision).toBe('26dcb43c77c9bdfebee35efc217113c958ed017d');
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
