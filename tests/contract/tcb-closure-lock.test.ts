import { expect, test } from 'bun:test';
import {
  linkSync,
  mkdirSync,
  mkdtempSync, realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  TCB_REVIEWED_NETWORK_DISPATCHERS,
  TCB_REVIEWED_PROCESS_DISPATCHERS,
  TCB_TRUST_ROOT,
  compileTcbClosureActionResult,
  trustedRuntimeClosure as compileTrustedRuntimeClosure,
  computeTcbClosureLock,
  createTcbClosureActionPlan,
  createTcbClosureCandidateSnapshot,
  finalizeTcbClosureCandidateSnapshot,
  generateTcbClosureLock,
  readTcbClosureCandidateFile,
  runtimeRelativeImportsFromSource,
  selectTcbClosureCandidateAction,
  verifyTcbClosureLock as verifyTcbClosureLockAgainstExactTree
} from '../../src/verification/trust/compiler.ts';
import { SEC_TCB_CLOSURE_RUNTIME_PATH, SEC_TRUSTED_BOOTSTRAP_DISPATCHER_OWNER, SEC_TRUSTED_BOOTSTRAP_REGISTRY, projectSecTrustedBootstrapDispatcherDataflowV1, reverseProjectSecTrustedBootstrapDispatcherCounterexampleV1 } from '../../src/verification/trust/contract/root.ts';

const LIVE_TCB_CLOSURE = compileTrustedRuntimeClosure();
const TCB_CLOSURE_LOCK = computeTcbClosureLock(LIVE_TCB_CLOSURE);
const trustedRuntimeClosure = (
  ...args: Parameters<typeof compileTrustedRuntimeClosure>
): ReturnType<typeof compileTrustedRuntimeClosure> => args.length === 0
  ? {
    closure: new Set(LIVE_TCB_CLOSURE.closure),
    reviewedEdges: new Set(LIVE_TCB_CLOSURE.reviewedEdges),
    reviewedBoundaryEdges: new Set(LIVE_TCB_CLOSURE.reviewedBoundaryEdges),
    reviewedExternalImports: new Set(LIVE_TCB_CLOSURE.reviewedExternalImports),
    reviewedProcessDispatchers: new Set(LIVE_TCB_CLOSURE.reviewedProcessDispatchers),
    reviewedNetworkDispatchers: new Set(LIVE_TCB_CLOSURE.reviewedNetworkDispatchers),
    observedExternalImports: new Set(LIVE_TCB_CLOSURE.observedExternalImports)
  }
  : compileTrustedRuntimeClosure(...args);
const verifyTcbClosureLock = (
  input: Parameters<typeof verifyTcbClosureLockAgainstExactTree>[0]
) => verifyTcbClosureLockAgainstExactTree(input, { expectedIdentity: TCB_CLOSURE_LOCK });

const TRUSTED_DISPATCHER_PROJECTION = projectSecTrustedBootstrapDispatcherDataflowV1({
  processDispatchers: LIVE_TCB_CLOSURE.reviewedProcessDispatchers,
  networkDispatchers: LIVE_TCB_CLOSURE.reviewedNetworkDispatchers
});

function projectedBoundary(boundary: string) {
  return [...TRUSTED_DISPATCHER_PROJECTION.process, ...TRUSTED_DISPATCHER_PROJECTION.network]
    .filter((entry) => entry.boundary === boundary);
}

test('TCB candidate root exclusively drives closure discovery and hashing', () => {
  const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'sec-tcb-candidate-root-')));
  try {
    writeFileSync(path.join(root, 'entry.ts'), "import './leaf.ts';\n", 'utf8');
    writeFileSync(path.join(root, 'leaf.ts'), 'export const leaf = 1;\n', 'utf8');
    const snapshot = createTcbClosureCandidateSnapshot({ candidateRoot: root });
    const options = { candidateSnapshot: snapshot };
    const closure = trustedRuntimeClosure(['entry.ts'], options);
    expect([...closure.closure].sort()).toEqual(['entry.ts', 'leaf.ts']);
    const lock = computeTcbClosureLock(closure, options);
    expect(lock.modules).toEqual(['entry.ts', 'leaf.ts']);
    expect(lock.trustRevision).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(lock.moduleBlobs['entry.ts']).toMatch(/^[0-9a-f]{40}$/u);
    expect(lock.moduleContentDigests['leaf.ts']).toMatch(/^sha256:[0-9a-f]{64}$/u);
    finalizeTcbClosureCandidateSnapshot(snapshot);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('one explicit candidate snapshot rejects discovery-to-hash mutation and missing-path appearance', () => {
  const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'sec-tcb-candidate-snapshot-')));
  try {
    writeFileSync(path.join(root, 'entry.ts'), "import './leaf.ts';\n", 'utf8');
    writeFileSync(path.join(root, 'leaf.ts'), 'export const leaf = 1;\n', 'utf8');
    const snapshot = createTcbClosureCandidateSnapshot({ candidateRoot: root });
    const options = { candidateSnapshot: snapshot };
    const closure = trustedRuntimeClosure(['entry.ts'], options);
    writeFileSync(path.join(root, 'leaf.ts'), 'export const leaf = 2;\n', 'utf8');
    expect(() => computeTcbClosureLock(closure, options)).toThrow('snapshot changed');

    const missingSnapshot = createTcbClosureCandidateSnapshot({ candidateRoot: root });
    expect(() => readTcbClosureCandidateFile('appeared.ts', {
      candidateSnapshot: missingSnapshot
    })).toThrow('module is missing');
    writeFileSync(path.join(root, 'appeared.ts'), 'export const appeared = true;\n', 'utf8');
    expect(() => finalizeTcbClosureCandidateSnapshot(missingSnapshot))
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

test('TCB closure explicitly models direct OS parent-process identity without opening computed process access', () => {
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-parent-process.ts',
    'export const issuerProcessId = process.ppid;'
  )).not.toThrow();
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-parent-process.ts',
    'export const issuerProcessId = process.parentPid;'
  )).toThrow('unclassified process member parentPid');
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-parent-process.ts',
    "export const issuerProcessId = process['ppid'];"
  )).toThrow('computed process member');
});

test('TCB closure admits only direct Bun data parser calls', () => {
  for (const member of ['TOML', 'YAML']) {
    expect(() => runtimeRelativeImportsFromSource(
      'synthetic-bun-data-parser.ts',
      `export const parsed = Bun.${member}.parse('value');`
    )).not.toThrow();
    expect(() => runtimeRelativeImportsFromSource(
      'synthetic-bun-data-parser.ts',
      `const parse = Bun.${member}.parse; export const parsed = parse('value');`
    )).toThrow(`unclassified Bun namespace member Bun.${member}`);
  }
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-bun-data-parser.ts',
    "export const serialized = Bun.TOML.stringify({ install: {} });"
  )).toThrow('unclassified Bun namespace member Bun.TOML');
});

test('TCB closure classifies only a direct Bun executable lookup', () => {
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-bun-executable-lookup.ts',
    "export const executable = Bun.which('git');"
  )).not.toThrow();
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-bun-executable-lookup.ts',
    "const lookup = Bun.which; export const executable = lookup('git');"
  )).toThrow('unclassified Bun namespace member Bun.which');
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-bun-executable-lookup.ts',
    "export const executable = Bun['which']('git');"
  )).toThrow('computed Bun namespace member Bun[...]');
});

test('TCB closure is one exact-tree Action with a pure compiler result', () => {
  const input = {
    exactTreeSha: '1'.repeat(40),
    registryDigest: `sha256:${'2'.repeat(64)}` as const,
    toolchainRevision: 'bun@1.3.14:typescript',
    providerRevision: 'contract-test'
  };
  const plan = createTcbClosureActionPlan(input);
  const repeated = createTcbClosureActionPlan(input);
  const changedTree = createTcbClosureActionPlan({ ...input, exactTreeSha: '3'.repeat(40) });
  expect(repeated.action.actionKey).toBe(plan.action.actionKey);
  expect(changedTree.action.actionKey).not.toBe(plan.action.actionKey);

  const result = compileTcbClosureActionResult({ plan });
  expect(result.actionKey).toBe(plan.action.actionKey);
  expect(result.identity.closureDigest).toBe(TCB_CLOSURE_LOCK.closureDigest);
  expect(result.resultDigest).toBe(TCB_CLOSURE_LOCK.closureDigest);

  const commonDemand = {
    exactTreeSha: '3'.repeat(40),
    registryDigest: input.registryDigest,
    toolchainRevision: input.toolchainRevision,
    providerRevision: input.providerRevision,
    trustedRegistry: SEC_TRUSTED_BOOTSTRAP_REGISTRY,
    checkerResult: result
  };
  const unrelated = selectTcbClosureCandidateAction({
    ...commonDemand,
    changedPaths: ['README.md']
  });
  expect(unrelated).toEqual({ impactedPaths: [], plan: null });

  const impacted = selectTcbClosureCandidateAction({
    ...commonDemand,
    changedPaths: [SEC_TCB_CLOSURE_RUNTIME_PATH]
  });
  expect(impacted.impactedPaths).toEqual([SEC_TCB_CLOSURE_RUNTIME_PATH]);
  expect(impacted.plan?.action.upstreamActionKeys).toEqual([result.actionKey]);
  expect(impacted.plan?.dependencies).toEqual([{ actionKey: result.actionKey, kind: 'upstream' }]);
  expect(() => compileTcbClosureActionResult({ plan: impacted.plan! }))
    .toThrow('upstream results do not satisfy');
});

test('TCB closure lock binds the reviewed causal module set', () => {
  expect(TCB_CLOSURE_LOCK.moduleCount).toBe(TCB_CLOSURE_LOCK.modules.length);
  expect(new Set(TCB_CLOSURE_LOCK.modules).size).toBe(TCB_CLOSURE_LOCK.moduleCount);
  expect(SEC_TRUSTED_BOOTSTRAP_REGISTRY.reviewedExternalImports)
    .toContain('src/development/runner/env-manager.ts -> node:net');
  expect(SEC_TRUSTED_BOOTSTRAP_REGISTRY.reviewedExternalImports).toContain(
    'src/external-capabilities/linux-verification/contract.ts -> zod'
  );
  expect(SEC_TRUSTED_BOOTSTRAP_REGISTRY.reviewedExternalImports).toContain(
    'src/brownfield/source-program-model/test-impact-projection.ts -> zod'
  );
  expect(SEC_TRUSTED_BOOTSTRAP_REGISTRY.reviewedExternalImports).not.toContain('zod');
  expect(TCB_CLOSURE_LOCK.reviewedExternalImports)
    .toContain('src/development/runner/env-manager.ts -> node:net');
});

test('TCB closure lock is the sole causal-runtime identity consumed by the trust-root view', () => {
  expect(TCB_TRUST_ROOT.causalRuntimePaths).toEqual(TCB_CLOSURE_LOCK.modules);
  expect(TCB_CLOSURE_LOCK.modules).toContain(SEC_TRUSTED_BOOTSTRAP_DISPATCHER_OWNER);
  expect(TCB_CLOSURE_LOCK.modules.some((entry) => entry.includes('sec-merge-bootstrap'))).toBe(false);
  expect(TCB_CLOSURE_LOCK.reviewedBoundaryEdges).toEqual([]);
});

test('TCB closure lock binds Git blobs and content digests for every module', () => {
  for (const module of TCB_CLOSURE_LOCK.modules) {
    expect(TCB_CLOSURE_LOCK.moduleBlobs[module]).toMatch(/^[0-9a-f]{40}$/);
    expect(TCB_CLOSURE_LOCK.moduleContentDigests[module]).toMatch(/^sha256:[0-9a-f]{64}$/);
  }
  expect(Object.keys(TCB_CLOSURE_LOCK.moduleBlobs)).toHaveLength(TCB_CLOSURE_LOCK.moduleCount);
  expect(Object.keys(TCB_CLOSURE_LOCK.moduleContentDigests)).toHaveLength(TCB_CLOSURE_LOCK.moduleCount);
});

test('Action provider preflight consumes the production dispatcher dataflow projection', () => {
  const entries = projectedBoundary('verification-action');
  expect(entries.length).toBeGreaterThan(0);
  expect(new Set(entries.map((entry) => entry.identity)).size).toBe(entries.length);
  expect(entries.every((entry) => entry.kind === 'process')).toBe(true);
  expect(entries.every((entry) => entry.authority.ownerId === SEC_TRUSTED_BOOTSTRAP_DISPATCHER_OWNER)).toBe(true);
  expect(entries.every((entry) => entry.authority.principleId === 'sec-trusted-bootstrap-dispatcher-dataflow-v1')).toBe(true);
  expect(entries.every((entry) => entry.authority.evidence.includes('module-graph-closure'))).toBe(true);
  expect(entries.every((entry) => entry.dataflow.shell === 'forbidden')).toBe(true);
  expect(entries.every((entry) => entry.dataflow.deadline === 'bounded' || entry.dataflow.deadline === 'provider-bound'))
    .toBe(true);
  expect(entries.every((entry) => TCB_CLOSURE_LOCK.modules.includes(entry.repositoryPath))).toBe(true);

  const processIdentity = entries[0]!.identity;
  expect(() => projectSecTrustedBootstrapDispatcherDataflowV1({
    processDispatchers: [processIdentity, processIdentity]
  })).toThrow('duplicate identity');
  const networkIdentity = TRUSTED_DISPATCHER_PROJECTION.network[0]!.identity;
  expect(() => projectSecTrustedBootstrapDispatcherDataflowV1({
    processDispatchers: [networkIdentity]
  })).toThrow('Network loader cannot be projected as a process dispatcher');
});

test('Hosted archive inventory consumes one bounded production dispatcher projection', () => {
  const entries = projectedBoundary('hosted-archive-inventory');
  expect(entries.length).toBeGreaterThan(0);
  expect(entries.every((entry) => entry.kind === 'process')).toBe(true);
  expect(entries.every((entry) => entry.dataflow.executable === 'fixed-interpreter')).toBe(true);
  expect(entries.every((entry) => entry.dataflow.environment === 'explicit-allowlist')).toBe(true);
  expect(entries.every((entry) => entry.dataflow.output === 'bounded')).toBe(true);
  expect(entries.every((entry) => entry.dataflow.shell === 'forbidden')).toBe(true);
});

test('verification-action runner receives a narrow repository capability and cannot dispatch processes', () => {
  const repositoryPath = 'src/verification/action/runner.ts';
  expect(TRUSTED_DISPATCHER_PROJECTION.process.some((entry) => entry.repositoryPath === repositoryPath)).toBe(false);

  const repositoryRoot = path.resolve(import.meta.dir, '../..');
  const snapshot = createTcbClosureCandidateSnapshot({ candidateRoot: repositoryRoot });
  const observedExternalImports = new Set<string>();
  const moduleReferences = runtimeRelativeImportsFromSource(
    repositoryPath,
    Buffer.from(readTcbClosureCandidateFile(repositoryPath, { candidateSnapshot: snapshot })).toString('utf8'),
    new Set(),
    new Set(),
    observedExternalImports
  );
  finalizeTcbClosureCandidateSnapshot(snapshot);
  expect(observedExternalImports).not.toContain('node:child_process');
  expect(moduleReferences).not.toContain('./branch-lifecycle-command.ts');
});

test('TCB network effects consume one direct canonical dataflow projection', () => {
  const entries = projectedBoundary('github-api');
  expect(entries.length).toBeGreaterThan(0);
  expect(entries.every((entry) => entry.kind === 'network')).toBe(true);
  expect(entries.every((entry) => entry.loader === 'globalThis.fetch')).toBe(true);
  expect(entries.every((entry) => entry.dataflow.argv === 'url-and-request-init')).toBe(true);
  expect(entries.every((entry) => entry.dataflow.environment === 'provider-bound')).toBe(true);
  expect(entries.every((entry) => entry.dataflow.shell === 'not-applicable')).toBe(true);

  const counterexample = reverseProjectSecTrustedBootstrapDispatcherCounterexampleV1({
    projection: TRUSTED_DISPATCHER_PROJECTION,
    dispatcherIdentity: entries[0]!.identity,
    designDelta: 'effect-dataflow'
  });
  expect(counterexample.status).toBe('counterexample');
  expect(counterexample.owner.principleId).toBe('sec-trusted-bootstrap-dispatcher-dataflow-v1');
  expect(counterexample.designDelta.machineTarget).toBe('tcb-closure-lock.reviewedNetworkDispatchers');
  expect(counterexample.migrationClosure.ownerId).toBe(SEC_TRUSTED_BOOTSTRAP_DISPATCHER_OWNER);
  expect(counterexample.migrationClosure.evidence).toContain('content-digest-readback');

  const unknown = reverseProjectSecTrustedBootstrapDispatcherCounterexampleV1({
    projection: TRUSTED_DISPATCHER_PROJECTION,
    dispatcherIdentity: 'scripts/unknown.ts::function-declaration:nearMiss::spawn#1',
    designDelta: 'dispatcher-identity'
  });
  expect(unknown.owner.ownerId).toBe(SEC_TRUSTED_BOOTSTRAP_DISPATCHER_OWNER);
  expect(unknown.designDelta.machineTarget).toBe('tcb-closure-lock.reviewedProcessDispatchers');
  expect(() => reverseProjectSecTrustedBootstrapDispatcherCounterexampleV1({
    projection: TRUSTED_DISPATCHER_PROJECTION,
    dispatcherIdentity: entries[0]!.identity,
    designDelta: 'not-a-design-delta' as never
  })).toThrow('design delta is not recognized');
});

test('local Actions runner dispatcher binds executable domain, cwd, environment, bounds, and ordinal', () => {
  const entries = projectedBoundary('local-actions-runner');
  expect(entries.length).toBeGreaterThan(0);
  expect(entries.every((entry) => entry.kind === 'process')).toBe(true);
  expect(entries.every((entry) => entry.dataflow.executable === 'command-input')).toBe(true);
  expect(entries.every((entry) => entry.dataflow.cwd === 'caller-cwd')).toBe(true);
  expect(entries.every((entry) => entry.dataflow.environment === 'provider-bound')).toBe(true);
  expect(entries.every((entry) => entry.dataflow.output === 'bounded')).toBe(true);
  expect(entries.every((entry) => entry.dataflow.deadline === 'bounded')).toBe(true);
  expect(entries.every((entry) => entry.dataflow.shell === 'forbidden')).toBe(true);
});

test('docs-doctor index-tree consumes the production dispatcher projection', () => {
  const entries = projectedBoundary('docs-doctor-index');
  expect(entries.length).toBeGreaterThan(0);
  expect(entries.every((entry) => entry.kind === 'process')).toBe(true);
  expect(entries.every((entry) => entry.dataflow.cwd === 'repository-root')).toBe(true);
  expect(entries.every((entry) => entry.dataflow.environment === 'provider-bound')).toBe(true);
  expect(entries.every((entry) => entry.dataflow.output === 'bounded')).toBe(true);
  expect(entries.every((entry) => entry.dataflow.shell === 'forbidden')).toBe(true);
  expect(entries.every((entry) => TRUSTED_DISPATCHER_PROJECTION.process.includes(entry))).toBe(true);
});

test('live TCB closure passes lock verification', () => {
  const closure = trustedRuntimeClosure();
  const verification = verifyTcbClosureLock(closure);
  expect(verification.status).toBe('passed');
  expect(verification.failures).toEqual([]);
});

test('live process dispatcher allowlist exactly matches the derived identity', () => {
  expect([...TCB_REVIEWED_PROCESS_DISPATCHERS].sort()).toEqual(
    [...TCB_CLOSURE_LOCK.reviewedProcessDispatchers].sort()
  );
});

test('live network dispatcher allowlist exactly matches the derived identity', () => {
  expect([...TCB_REVIEWED_NETWORK_DISPATCHERS].sort()).toEqual(
    [...(TCB_CLOSURE_LOCK.reviewedNetworkDispatchers ?? [])].sort()
  );
});

test.serial('TCB generation rejects a stale reviewed dispatcher authorization', () => {
  const stale =
    'src/verification/ci/verification.ts::function-declaration:retiredDispatcher::spawnSync#1';
  expect(TCB_REVIEWED_PROCESS_DISPATCHERS.has(stale)).toBe(false);
  TCB_REVIEWED_PROCESS_DISPATCHERS.add(stale);
  try {
    expect(() => generateTcbClosureLock()).toThrow(
      'TCB reviewed process dispatcher allowlist must exactly equal the live causal dispatcher census.'
    );
  } finally {
    TCB_REVIEWED_PROCESS_DISPATCHERS.delete(stale);
  }
  expect(TCB_REVIEWED_PROCESS_DISPATCHERS.has(stale)).toBe(false);
});

test.serial('TCB generation rejects a stale reviewed network dispatcher authorization', () => {
  const stale =
    'src/control/integration/integration-authorization-status-github.ts::function-declaration:retiredNetwork::globalThis.fetch#1';
  expect(TCB_REVIEWED_NETWORK_DISPATCHERS.has(stale)).toBe(false);
  TCB_REVIEWED_NETWORK_DISPATCHERS.add(stale);
  try {
    expect(() => generateTcbClosureLock()).toThrow(
      'TCB reviewed network dispatcher allowlist must exactly equal the live causal dispatcher census.'
    );
  } finally {
    TCB_REVIEWED_NETWORK_DISPATCHERS.delete(stale);
  }
  expect(TCB_REVIEWED_NETWORK_DISPATCHERS.has(stale)).toBe(false);
});

test('computeTcbClosureLock produces the exact-tree identity digest', () => {
  const closure = trustedRuntimeClosure();
  const live = computeTcbClosureLock(closure);
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
    reviewedBoundaryEdges: new Set(closure.reviewedBoundaryEdges),
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
  const removedModule = TCB_CLOSURE_LOCK.modules[0]!;
  tampered.delete(removedModule);
  const verification = verifyTcbClosureLock({
    closure: tampered,
    reviewedEdges: closure.reviewedEdges,
    reviewedBoundaryEdges: closure.reviewedBoundaryEdges,
    reviewedExternalImports: closure.reviewedExternalImports,
    reviewedProcessDispatchers: closure.reviewedProcessDispatchers
  });
  expect(verification.status).toBe('failed');
  expect(verification.failures).toEqual(expect.arrayContaining([
    expect.stringContaining(`contraction: missing module ${removedModule}`)
  ]));
});

test('substituting a module path causes the lock to break', () => {
  const closure = trustedRuntimeClosure();
  const tampered = new Set(closure.closure);
  const removedModule = TCB_CLOSURE_LOCK.modules[0]!;
  const replacementModule = `${removedModule}.replacement`;
  tampered.delete(removedModule);
  tampered.add(replacementModule);
  const verification = verifyTcbClosureLock({
    closure: tampered,
    reviewedEdges: closure.reviewedEdges,
    reviewedBoundaryEdges: closure.reviewedBoundaryEdges,
    reviewedExternalImports: closure.reviewedExternalImports,
    reviewedProcessDispatchers: closure.reviewedProcessDispatchers
  });
  expect(verification.status).toBe('failed');
  expect(verification.failures).toEqual(expect.arrayContaining([
    expect.stringContaining(`contraction: missing module ${removedModule}`),
    expect.stringContaining(`expansion: unexpected module ${replacementModule}`)
  ]));
});

test('introducing an unauthorized edge causes the lock to break', () => {
  const closure = trustedRuntimeClosure();
  const tampered = {
    closure: closure.closure,
    reviewedEdges: new Set(closure.reviewedEdges).add(
      'src/verification/ci/verification.ts -> src/compiler/orchestration/unauthorized-target.ts'
    ),
    reviewedBoundaryEdges: closure.reviewedBoundaryEdges,
    reviewedExternalImports: closure.reviewedExternalImports,
    reviewedProcessDispatchers: closure.reviewedProcessDispatchers
  };
  const verification = verifyTcbClosureLock(tampered);
  expect(verification.status).toBe('failed');
  expect(verification.failures).toEqual(expect.arrayContaining([
    expect.stringContaining('edge addition: unexpected edge')
  ]));
});

test('TCB closure traverses the retired SUT seam without a reviewed stop edge', () => {
  const closure = trustedRuntimeClosure();
  expect([...closure.reviewedEdges]).toEqual([]);
  expect(SEC_TRUSTED_BOOTSTRAP_REGISTRY.reviewedSutEdges).toEqual([]);
});

test('adding an unauthorized boundary causes the lock to break', () => {
  const closure = trustedRuntimeClosure();
  const verification = verifyTcbClosureLock({
    ...closure,
    reviewedBoundaryEdges: new Set(closure.reviewedBoundaryEdges).add(
      'src/verification/ci/runtime/verification-session.ts -> src/verification/ci/contract/core.ts'
    )
  });
  expect(verification.status).toBe('failed');
  expect(verification.failures).toEqual(expect.arrayContaining([
    expect.stringContaining('boundary edge addition: unexpected edge')
  ]));
});

test('adding an unauthorized external import causes the lock to break', () => {
  const closure = trustedRuntimeClosure();
  const tampered = {
    closure: closure.closure,
    reviewedEdges: closure.reviewedEdges,
    reviewedBoundaryEdges: closure.reviewedBoundaryEdges,
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
    reviewedBoundaryEdges: closure.reviewedBoundaryEdges,
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

test('adding an unauthorized network dispatcher causes the lock to break', () => {
  const closure = trustedRuntimeClosure();
  const verification = verifyTcbClosureLock({
    ...closure,
    reviewedNetworkDispatchers: new Set(closure.reviewedNetworkDispatchers).add(
      'platform/shared/untrusted.ts::function-declaration:untrustedFetch::globalThis.fetch#1'
    )
  });
  expect(verification.status).toBe('failed');
  expect(verification.failures).toEqual(expect.arrayContaining([
    expect.stringContaining('network dispatcher addition: unexpected')
  ]));
});
