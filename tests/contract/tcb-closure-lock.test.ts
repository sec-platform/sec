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

import { compileSecRepositoryModuleMembershipSnapshot } from '../../src/adapters/repository/architecture/contract.ts';
import { compileRepositorySourceProgramModel } from '../../src/adapters/repository/source-program-model/repository.ts';
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
} from '../../src/adapters/verification/platform/trust/compiler.ts';
import { SEC_TCB_CLOSURE_RUNTIME_PATH, SEC_TRUSTED_BOOTSTRAP_DISPATCHER_OWNER, SEC_TRUSTED_BOOTSTRAP_REGISTRY } from '../../src/adapters/verification/platform/trust/contract/root.ts';
import { rawSha256 } from '../../src/contracts/canonical.ts';

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

test('TCB closure models direct OS identity reads without admitting identity mutation or computed process access', () => {
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-parent-process.ts',
    'export const issuerProcessId = process.ppid;'
  )).not.toThrow();
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-effective-user.ts',
    "export const effectiveUserId = typeof process.geteuid === 'function' ? process.geteuid() : undefined;"
  )).not.toThrow();
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-effective-user.ts',
    'process.seteuid(0);'
  )).toThrow('unclassified process member seteuid');
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-effective-user.ts',
    "export const effectiveUserId = process['geteuid']();"
  )).toThrow('computed process member');
  for (const source of ['export const realUserId = process.getuid();', 'export const realUserId = process.getuid?.();']) {
    expect(() => runtimeRelativeImportsFromSource('synthetic-real-user.ts', source)).not.toThrow();
  }
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-real-user.ts',
    'process.setuid(0);'
  )).toThrow('unclassified process member setuid');
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-real-user.ts',
    "export const realUserId = process['getuid']();"
  )).toThrow('computed process member');
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-real-user.ts',
    'export const realUserId = process.getRealUserId();'
  )).toThrow('unclassified process member getRealUserId');
  for (const source of ['export const realGroupId = process.getgid();', 'export const realGroupId = process.getgid?.();']) {
    expect(() => runtimeRelativeImportsFromSource('synthetic-real-group.ts', source)).not.toThrow();
  }
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-real-group.ts', 'process.setgid(0);'
  )).toThrow('unclassified process member setgid');
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-real-group.ts', "export const realGroupId = process['getgid']();"
  )).toThrow('computed process member');
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-real-group.ts', 'export const realGroupId = process.getRealGroupId();'
  )).toThrow('unclassified process member getRealGroupId');
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-owned-listener.ts',
    "const cancel = () => undefined; process.once('SIGTERM', cancel); process.removeListener('SIGTERM', cancel);"
  )).not.toThrow();
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-owned-listener.ts', "process.removeAllListeners('SIGTERM');"
  )).toThrow('unclassified process member removeAllListeners');
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-parent-process.ts',
    'export const issuerProcessId = process.parentPid;'
  )).toThrow('unclassified process member parentPid');
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-parent-process.ts',
    "export const issuerProcessId = process['ppid'];"
  )).toThrow('computed process member');
});

test('TCB closure distinguishes runtime-local process bindings from the host process namespace', () => {
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-local-process-binding.ts',
    [
      'function consume(value: unknown): unknown { return value; }',
      "const process = { custom: 'local' };",
      "export const direct = process.custom;",
      "export const computed = process['custom'];",
      'export const passed = consume(process);'
    ].join('\n')
  )).not.toThrow();

  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-host-process-escape.ts',
    'export const escaped = process;'
  )).toThrow('escaped process namespace');
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-ambient-process-alias.ts',
    'declare const process: any; export const hidden = process.mainModule.require("./hidden.ts");'
  )).toThrow('escaped process namespace');
});

test('TCB closure distinguishes a local module binding from the host module namespace', () => {
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-local-module-binding.ts',
    'const module = { moduleId: "local" }; export const id = module.moduleId;'
  )).not.toThrow();
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-host-module-escape.ts',
    'export const escaped = module;'
  )).toThrow('escaped module loader namespace');
});

test('TCB closure includes statically named relative ESM loads and rejects hidden dynamic source', () => {
  expect(runtimeRelativeImportsFromSource(
    'synthetic-static-dynamic-import.ts',
    'export const loaded = import("./leaf.ts");'
  )).toEqual(['./leaf.ts']);
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-computed-dynamic-import.ts',
    'const target = "./leaf.ts"; export const loaded = import(target);'
  )).toThrow('dynamic import is not statically resolvable');
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-eval-loader.ts',
    'export const loaded = eval("import(\\"./hidden.ts\\")");'
  )).toThrow('(eval)');
});

test('TCB closure admits the compiler API and rejects the retired code-generation provider', () => {
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-compiler-api.ts',
    "import ts from 'typescript'; export const factory = ts.factory;"
  )).not.toThrow();
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-retired-codegen-provider.ts',
    "import { Project } from 'ts-morph'; export const project = new Project();"
  )).toThrow('ts-morph');
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

test('TCB closure classifies only direct Bun standard-input reads and stream sources', () => {
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-bun-stdin.ts',
    'export const bytes = await Bun.stdin.bytes();'
  )).not.toThrow();
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-bun-stdin.ts',
    'export const stream = Bun.stdin.stream();'
  )).not.toThrow();
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-bun-stdin.ts',
    'const stdin = Bun.stdin; export const bytes = await stdin.bytes();'
  )).toThrow('unclassified Bun namespace member Bun.stdin');
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-bun-stdin.ts',
    'const stream = Bun.stdin.stream; export const input = stream();'
  )).toThrow('unclassified Bun namespace member Bun.stdin');
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-bun-stdin.ts',
    "export const bytes = await Bun['stdin'].bytes();"
  )).toThrow('computed Bun namespace member Bun[...]');
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-bun-stdin.ts',
    "export const stream = Bun.stdin['stream']();"
  )).toThrow('unclassified Bun namespace member Bun.stdin');
});

test('TCB closure does not treat erased provider type references as runtime transport', () => {
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-worker-type.ts',
    "import { Worker as ThreadWorker } from 'node:worker_threads';\n"
      + 'export let worker: ThreadWorker | null = null;\n'
  )).not.toThrow();
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
  expect(result.resultDigest).toBe(result.identity.closureDigest);

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
    .toContain('src/adapters/self-hosting/development/runner/env-manager.ts -> node:net');
  expect(SEC_TRUSTED_BOOTSTRAP_REGISTRY.reviewedExternalImports).toContain(
    'src/adapters/providers/linux-verification/contract.ts -> zod'
  );
  expect(SEC_TRUSTED_BOOTSTRAP_REGISTRY.reviewedExternalImports).toContain(
    'src/adapters/repository/source-program-model/test-impact-projection.ts -> zod'
  );
  expect(SEC_TRUSTED_BOOTSTRAP_REGISTRY.reviewedExternalImports).toContain(
    'src/adapters/verification/platform/ci/contract/hosted-job-runtime.ts -> zod'
  );
  expect(SEC_TRUSTED_BOOTSTRAP_REGISTRY.reviewedExternalImports).not.toContain('zod');
  expect(TCB_CLOSURE_LOCK.reviewedExternalImports)
    .toContain('src/adapters/self-hosting/development/runner/env-manager.ts -> node:net');
});

test('TCB runtime receipt schema permits its exact reviewed parser edge only', () => {
  const source = "import { z } from 'zod'; export const schema = z.object({ value: z.string() }).strict();";
  expect(() => runtimeRelativeImportsFromSource(
    'src/adapters/verification/platform/ci/contract/hosted-job-runtime.ts', source
  )).not.toThrow();
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-unreviewed-receipt-parser.ts', source
  )).toThrow('TCB runtime import is outside the approved relative/external policy');
});

test('TCB closure lock is the sole causal-runtime identity consumed by the trust-root view', () => {
  expect(TCB_TRUST_ROOT.causalRuntimePaths).toEqual(TCB_CLOSURE_LOCK.modules);
  expect(TCB_CLOSURE_LOCK.modules).toContain(SEC_TRUSTED_BOOTSTRAP_DISPATCHER_OWNER);
  expect(TCB_CLOSURE_LOCK.modules.some((entry) => entry.includes('sec-merge-bootstrap'))).toBe(false);
  expect(TCB_CLOSURE_LOCK.reviewedBoundaryEdges).toEqual([
    'src/adapters/self-hosting/control/main-health/post-merge-plan.ts -> src/adapters/verification/platform/trust/runtime/closure-lock.ts',
    'src/adapters/verification/platform/ci/runtime/hosted-bootstrap-checker.ts -> src/adapters/verification/platform/trust/runtime/closure-lock.ts'
  ]);
});

test('default TCB entrypoints protect the real hosted launcher and its retained child subtree', () => {
  const launcher = 'src/adapters/verification/platform/ci/runtime/hosted-job-runtime.ts';
  const publisher = 'src/adapters/providers/docker/runtime/linux-static-toolchain-publisher.ts';
  expect(SEC_TRUSTED_BOOTSTRAP_REGISTRY.runtimeEntrypoints).toContain(launcher);
  const snapshot = createTcbClosureCandidateSnapshot({
    candidateRoot: path.resolve(import.meta.dir, '../..')
  });
  const options = { candidateSnapshot: snapshot };
  // No explicit test-only entrypoint: the production default must reach all of these.
  const closure = compileTrustedRuntimeClosure(undefined, options);
  const lock = computeTcbClosureLock(closure, options);
  for (const module of [
    launcher, publisher,
    'src/adapters/verification/platform/ci/runtime/hosted-job-bootstrap-phases.ts',
    'src/adapters/verification/platform/ci/runtime/hosted-job-container.ts',
    'src/adapters/verification/platform/ci/runtime/hosted-bootstrap-checker.ts',
    'src/adapters/verification/platform/ci/runtime/hosted-candidate-workspace.ts',
    'src/adapters/providers/docker/contract/linux-static-toolchain.ts'
  ]) {
    expect(lock.modules).toContain(module);
    expect(lock.moduleBlobs[module]).toMatch(/^[0-9a-f]{40}$/u);
    expect(lock.moduleContentDigests[module]).toBe(rawSha256(readTcbClosureCandidateFile(module, options)));
  }
  expect(lock.modules).not.toContain(SEC_TCB_CLOSURE_RUNTIME_PATH);
  expect(lock.reviewedBoundaryEdges).toContain(
    `src/adapters/verification/platform/ci/runtime/hosted-bootstrap-checker.ts -> ${SEC_TCB_CLOSURE_RUNTIME_PATH}`
  );
  finalizeTcbClosureCandidateSnapshot(snapshot);
});

test('hosted launcher child and static-exact boundary bytes remain in the same candidate snapshot', () => {
  const root = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'sec-tcb-hosted-subtree-')));
  const launcher = 'src/adapters/verification/platform/ci/runtime/hosted-job-runtime.ts';
  const phases = 'src/adapters/verification/platform/ci/runtime/hosted-job-bootstrap-phases.ts';
  const checker = 'src/adapters/verification/platform/ci/runtime/hosted-bootstrap-checker.ts';
  const sources = new Map([
    [launcher, "import './hosted-job-bootstrap-phases.ts';\n"],
    [phases, "import './hosted-bootstrap-checker.ts';\n"],
    [checker, "import '../../trust/runtime/closure-lock.ts';\n"],
    [SEC_TCB_CLOSURE_RUNTIME_PATH, 'export const boundary = 1;\n']
  ]);
  try {
    for (const [module, source] of sources) {
      mkdirSync(path.dirname(path.join(root, module)), { recursive: true });
      writeFileSync(path.join(root, module), source);
    }
    const snapshot = createTcbClosureCandidateSnapshot({ candidateRoot: root });
    const options = { candidateSnapshot: snapshot };
    const closure = compileTrustedRuntimeClosure([launcher], options);
    expect([...closure.closure].sort()).toEqual([launcher, phases, checker].sort());
    writeFileSync(path.join(root, phases), `${sources.get(phases)!}export const changed = true;\n`);
    expect(() => computeTcbClosureLock(closure, options)).toThrow('snapshot changed');

    const boundarySnapshot = createTcbClosureCandidateSnapshot({ candidateRoot: root });
    compileTrustedRuntimeClosure([launcher], { candidateSnapshot: boundarySnapshot });
    writeFileSync(path.join(root, SEC_TCB_CLOSURE_RUNTIME_PATH), 'export const boundary = 2;\n');
    expect(() => finalizeTcbClosureCandidateSnapshot(boundarySnapshot)).toThrow('snapshot changed');

    // An arbitrary importer cannot borrow the checker's static-exact edge.
    writeFileSync(path.join(root, 'unreviewed.ts'), `import './${SEC_TCB_CLOSURE_RUNTIME_PATH}';\n`);
    writeFileSync(path.join(root, SEC_TCB_CLOSURE_RUNTIME_PATH), "import { request } from 'node:http';\n");
    expect(() => compileTrustedRuntimeClosure(['unreviewed.ts'], { candidateRoot: root }))
      .toThrow('outside the approved relative/external policy');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('TCB publisher classifies its actual HTTPS request without broad network import privileges', () => {
  const publisher = 'src/adapters/providers/docker/runtime/linux-static-toolchain-publisher.ts';
  const dispatcher = `${publisher}::function-declaration:download::node:https.request#1`;
  const snapshot = createTcbClosureCandidateSnapshot({ candidateRoot: path.resolve(import.meta.dir, '../..') });
  const source = Buffer.from(readTcbClosureCandidateFile(publisher, { candidateSnapshot: snapshot })).toString('utf8');
  const reviewedExternalImports = new Set<string>();
  const network = new Set<string>();
  runtimeRelativeImportsFromSource(publisher, source, new Set(), reviewedExternalImports, new Set(), network);
  expect([...network]).toEqual([dispatcher]);
  for (const specifier of ['node:https', 'node:stream/promises', 'node:tls', 'node:zlib']) {
    expect(reviewedExternalImports).toContain(`${publisher} -> ${specifier}`);
    expect(SEC_TRUSTED_BOOTSTRAP_REGISTRY.reviewedExternalImports).toContain(`${publisher} -> ${specifier}`);
    expect(() => runtimeRelativeImportsFromSource('unreviewed-network-owner.ts', `import '${specifier}';`)).toThrow();
  }
  expect(() => runtimeRelativeImportsFromSource('unreviewed-network-owner.ts', source)).toThrow('node:https');
  finalizeTcbClosureCandidateSnapshot(snapshot);
});

test('TCB HTTPS bindings reject escaped, substituted and additional network dispatchers', () => {
  const publisher = 'src/adapters/providers/docker/runtime/linux-static-toolchain-publisher.ts';
  const prefix = "import { Agent, request } from 'node:https';\n";
  const direct = 'function download(agent: Agent) { return new Promise(resolve => { request(target, { agent }, resolve); }); }';
  const network = new Set<string>();
  expect(() => runtimeRelativeImportsFromSource(publisher, prefix + direct,
    new Set(), new Set(), new Set(), network)).not.toThrow();
  expect([...network]).toEqual([`${publisher}::function-declaration:download::node:https.request#1`]);
  expect(() => runtimeRelativeImportsFromSource(publisher,
    prefix + 'function publishLinuxDockerStaticToolchain() { return new Agent({ keepAlive: false }); }'))
    .not.toThrow();
  for (const source of [
    "import { get } from 'node:https'; function download() { return get(target); }",
    "import { request as send } from 'node:https'; function download() { return send(target); }",
    "import https from 'node:https'; function download() { return https.request(target); }",
    "import * as https from 'node:https'; function download() { return https.request(target); }",
    "export { request } from 'node:https';",
    "export const https = import('node:https');",
    "import { request } from 'node:http'; function download() { return request(target); }",
    prefix + 'function download() { const send = request; return send(target); }',
    prefix + 'function download() { return consume(request); }',
    prefix + 'function download() { return request.call(null, target); }',
    prefix + "function download() { return request['call'](null, target); }",
    prefix + 'function download() { return request?.(target); }',
    prefix + 'function download() { return new request(target); }',
    prefix + 'function download() { return { request }; }',
    prefix + 'export { request };',
    prefix + 'export { request as escaped };',
    prefix + 'function download() { return consume(Agent); }',
    prefix + 'function download() { return Agent(target); }',
    prefix + 'function download() { return new Agent.prototype.constructor(); }',
    prefix + 'function unknownOwner() { return request(target); }',
    prefix + 'function download() { request(target); return request(target); }',
    prefix + 'function download() { request(target); } function download() { request(target); }'
  ]) {
    expect(() => runtimeRelativeImportsFromSource(publisher, source)).toThrow();
  }
});

test('TCB HTTPS dispatcher census never credits a shadowed local binding', () => {
  const publisher = 'src/adapters/providers/docker/runtime/linux-static-toolchain-publisher.ts';
  const network = new Set<string>();
  runtimeRelativeImportsFromSource(publisher,
    "import { request } from 'node:https'; function download(request: (url: unknown) => unknown) { return request(target); }",
    new Set(), new Set(), new Set(), network);
  // The unchanged exact census equality in generateTcbClosureLock rejects this missing dispatcher.
  expect([...network]).toEqual([]);
  expect([...network]).not.toEqual([`${publisher}::function-declaration:download::node:https.request#1`]);
});

test('TCB closure keeps Linux endpoint native effects in the reviewed physical owner', () => {
  const adapter = 'src/adapters/providers/docker/runtime/linux-endpoint.ts';
  const native = 'src/adapters/runtime-state/physical/runtime/physical-no-follow-native.ts';
  expect(TCB_CLOSURE_LOCK.modules).toContain(adapter);
  expect(TCB_CLOSURE_LOCK.modules).toContain(native);
  expect(TCB_CLOSURE_LOCK.reviewedExternalImports).toContain(`${native} -> bun:ffi`);
  expect(TCB_CLOSURE_LOCK.reviewedExternalImports).not.toContain(`${adapter} -> bun:ffi`);
  expect(() => runtimeRelativeImportsFromSource(adapter, "import { dlopen } from 'bun:ffi';"))
    .toThrow('outside the approved relative/external policy');
  expect(() => runtimeRelativeImportsFromSource(native, "import { dlopen } from 'bun:ffi';"))
    .not.toThrow();
});

test('TCB closure lock binds Git blobs and content digests for every module', () => {
  for (const module of TCB_CLOSURE_LOCK.modules) {
    expect(TCB_CLOSURE_LOCK.moduleBlobs[module]).toMatch(/^[0-9a-f]{40}$/);
    expect(TCB_CLOSURE_LOCK.moduleContentDigests[module]).toMatch(/^sha256:[0-9a-f]{64}$/);
  }
  expect(Object.keys(TCB_CLOSURE_LOCK.moduleBlobs)).toHaveLength(TCB_CLOSURE_LOCK.moduleCount);
  expect(Object.keys(TCB_CLOSURE_LOCK.moduleContentDigests)).toHaveLength(TCB_CLOSURE_LOCK.moduleCount);
});

test('reviewed dispatcher census remains non-authorizing source observation', () => {
  const packageSource = JSON.stringify({
    name: 'tcb-observation-fixture',
    private: true,
    scripts: { inspect: 'bun ./src/example/cli.ts' }
  });
  const descriptorSource = JSON.stringify({
    importGraph: 'runtime',
    externalEntrypoints: [],
    capabilityProviders: []
  });
  const sources = [
    ['package.json', packageSource],
    ['src/example/module.json', descriptorSource],
    [
      'src/example/cli.ts',
      "import { spawnSync } from 'node:child_process';\n"
      + "export function run(): void { spawnSync('git', ['status']); }\n"
    ]
  ] as const;
  const files = sources.map(([repositoryPath, source]) => ({
    path: repositoryPath,
    source,
    contentDigest: rawSha256(source)
  }));
  const sourceRevision = rawSha256(JSON.stringify(
    files.map(({ contentDigest, path: repositoryPath }) => ({ path: repositoryPath, contentDigest }))
  ));
  const moduleMembership = compileSecRepositoryModuleMembershipSnapshot({
    repositoryFiles: files.map(({ path: repositoryPath }) => repositoryPath),
    descriptorSources: [{
      descriptorPath: 'src/example/module.json',
      source: descriptorSource
    }]
  });
  const model = compileRepositorySourceProgramModel({
    sourceRevision,
    files,
    moduleMembership,
    reviewedProcessDispatchers: [
      'src/example/cli.ts::function-declaration:run::spawnSync#1'
    ]
  });

  expect(model.candidates).toContainEqual(expect.objectContaining({
    code: 'direct-process-transport-outside-owner',
    subject: 'src/example/cli.ts'
  }));
  expect('authority' in TCB_CLOSURE_LOCK).toBe(false);
});

test('verification-action runner receives a narrow repository capability and cannot dispatch processes', () => {
  const repositoryPath = 'src/adapters/verification/platform/action/runner.ts';
  expect(TCB_CLOSURE_LOCK.reviewedProcessDispatchers.some((entry) =>
    entry.startsWith(`${repositoryPath}::`)
  )).toBe(false);

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

test('closure identity changes when its reviewed dispatcher observation changes', () => {
  const changed = trustedRuntimeClosure();
  changed.reviewedProcessDispatchers.add(
    'src/synthetic.ts::function-declaration:dispatch::spawn#1'
  );
  const changedLock = computeTcbClosureLock(changed);

  expect(changedLock.reviewedProcessDispatchers).not.toEqual(
    TCB_CLOSURE_LOCK.reviewedProcessDispatchers
  );
  expect(changedLock.trustRevision).not.toBe(TCB_CLOSURE_LOCK.trustRevision);
  expect(changedLock.closureDigest).not.toBe(TCB_CLOSURE_LOCK.closureDigest);
});

test('live network dispatcher allowlist exactly matches the derived identity', () => {
  expect([...TCB_REVIEWED_NETWORK_DISPATCHERS].sort()).toEqual(
    [...(TCB_CLOSURE_LOCK.reviewedNetworkDispatchers ?? [])].sort()
  );
});

test.serial('TCB generation rejects a stale reviewed dispatcher authorization', () => {
  const stale =
    'src/adapters/verification/platform/ci/verification.ts::function-declaration:retiredDispatcher::spawnSync#1';
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
    'src/adapters/self-hosting/control/integration/integration-authorization-status-github.ts::function-declaration:retiredNetwork::globalThis.fetch#1';
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
      'src/adapters/verification/platform/ci/verification.ts -> src/compiler/orchestration/unauthorized-target.ts'
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
      'src/adapters/verification/platform/ci/runtime/verification-session.ts -> src/adapters/verification/platform/ci/contract/core.ts'
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
