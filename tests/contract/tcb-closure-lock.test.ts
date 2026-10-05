import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
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

import { compileRepositoryModuleMembershipSnapshot } from '../../src/adapters/repository/architecture/contract.ts';
import { compileRepositorySourceProgramModel } from '../../src/adapters/repository/source-program-model/repository.ts';
import {
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
  TCB_REVIEWED_NETWORK_DISPATCHERS,
  TCB_REVIEWED_PROCESS_DISPATCHERS,
  TCB_TRUST_ROOT,
  verifyTcbClosureLock as verifyTcbClosureLockAgainstExactTree
} from '../../src/adapters/verification/platform/trust/compiler.ts';
import { createSecTrustedBootstrapTrustRoot, matchSecTrustedBootstrapPath, SEC_TCB_CLOSURE_RUNTIME_PATH, SEC_TRUSTED_BOOTSTRAP_DISPATCHER_OWNER, SEC_TRUSTED_BOOTSTRAP_REGISTRY } from '../../src/adapters/verification/platform/trust/contract/root.ts';
import { rawSha256 } from '../../src/contracts/canonical.ts';
import { settleResources, type ResourceSettlementFailure } from '../../src/execution/resource-settlement.ts';

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

const supervisorOwner = 'src/adapters/verification/platform/ci/runtime/hosted-sut-supervisor.ts';
const supervisorResource = 'src/adapters/verification/platform/ci/runtime/hosted-sut-supervisor.py';
const nativeUnitOwner = 'src/adapters/runtime-state/physical/runtime/linux-verification-unit.ts';
const nativeUnitResource = 'src/adapters/runtime-state/physical/runtime/linux-verification-unit-helper.py';
const nativeDependencyEntrypoint = 'src/bootstrap/toolchain/native-verification-dependencies.ts';

const reviewedRuntimeResources = [
  { owner: supervisorOwner, resource: supervisorResource, specifier: './hosted-sut-supervisor.py' },
  { owner: nativeUnitOwner, resource: nativeUnitResource, specifier: './linux-verification-unit-helper.py' }
] as const;

test('TCB fixed resources bind the actual Python bytes as a causal terminal', () => {
  for (const { owner, resource, specifier } of reviewedRuntimeResources) {
    const bytes = readFileSync(resource);
    expect(TCB_CLOSURE_LOCK.modules).toContain(resource);
    expect(TCB_CLOSURE_LOCK.moduleContentDigests[resource]).toBe(rawSha256(bytes));
    expect(TCB_CLOSURE_LOCK.moduleBlobs[resource]).toBe(createHash('sha1')
      .update(`blob ${bytes.length}\0`).update(bytes).digest('hex'));
    expect(runtimeRelativeImportsFromSource(owner, readFileSync(owner, 'utf8')))
      .toContain(specifier);
  }
});

test('TCB fixed resources reject missing, ambiguous, shadowed and redirected declarations', () => {
  for (const { owner, resource, specifier } of reviewedRuntimeResources) {
    const resourceSource = "import { fileURLToPath } from 'node:url';\n"
      + "const HELPER_PATH = fileURLToPath(new URL('" + specifier + "', import.meta.url));\n";
    expect(runtimeRelativeImportsFromSource(owner, resourceSource))
      .toEqual([specifier]);
    for (const source of [
      "import { fileURLToPath } from 'node:url';\n",
      resourceSource.replace('const HELPER_PATH', 'let HELPER_PATH'),
      resourceSource + 'const HELPER_PATH = "duplicate";\n',
      resourceSource + 'const { HELPER_PATH } = other;\n',
      resourceSource + 'function run(HELPER_PATH: string) { return HELPER_PATH; }\n',
      resourceSource.replace(specifier, './other.py'),
      resourceSource.replace(specifier, specifier === './hosted-sut-supervisor.py'
        ? './linux-verification-unit-helper.py' : './hosted-sut-supervisor.py'),
      resourceSource.replace(specifier, './nested/../' + path.posix.basename(resource)),
      resourceSource.replace("'" + specifier + "'", 'selectedPath'),
      resourceSource.replace('import.meta.url', 'callerRoot'),
      resourceSource.replace("'node:url'", "'./url.ts'"),
      resourceSource.replace('fileURLToPath }', 'fileURLToPath as resolvePath }')
        .replace('= fileURLToPath(', '= resolvePath('),
      resourceSource.replace('const HELPER_PATH', 'const URL = other; const HELPER_PATH'),
      resourceSource.replace('const HELPER_PATH', 'declare const URL: any; const HELPER_PATH'),
      resourceSource + "import '" + specifier + "';\n"
    ]) {
      expect(() => runtimeRelativeImportsFromSource(owner, source)).toThrow();
    }
    expect(() => runtimeRelativeImportsFromSource('other.ts', "import '" + specifier + "';"))
      .toThrow('Python ESM import');
  }
});

test('TCB fixed resources preserve raw bytes while existing TypeScript normalization stays unchanged', () => {
  for (const { owner, resource, specifier } of reviewedRuntimeResources) {
    const resourceSource = "import { fileURLToPath } from 'node:url';\n"
      + "const HELPER_PATH = fileURLToPath(new URL('" + specifier + "', import.meta.url));\n";
    const createdRoot = mkdtempSync(path.join(tmpdir(), 'sec-tcb-python-bytes-'));
    let primary: ResourceSettlementFailure | undefined;
    try {
      const root = realpathSync.native(createdRoot);
      mkdirSync(path.join(root, path.posix.dirname(owner)), { recursive: true });
      writeFileSync(path.join(root, owner), resourceSource.replaceAll('\n', '\r\n'));
      const helper = path.join(root, resource);
      const original = Buffer.from('# opaque Python resource\r\nvalue = 1\r\n', 'utf8');
      writeFileSync(helper, original);
      const closure = trustedRuntimeClosure([owner], { candidateRoot: root });
      expect([...closure.closure].sort()).toEqual([owner, resource].sort());
      const first = computeTcbClosureLock(closure, { candidateRoot: root });
      expect(first.moduleContentDigests[owner]).toBe(rawSha256(resourceSource));
      expect(first.moduleContentDigests[resource]).toBe(rawSha256(original));
      writeFileSync(helper, original.toString('utf8').replaceAll('\r\n', '\n'));
      const changed = computeTcbClosureLock(closure, { candidateRoot: root });
      expect(changed.moduleContentDigests[owner]).toBe(first.moduleContentDigests[owner]);
      expect(changed.moduleBlobs[resource]).not.toBe(first.moduleBlobs[resource]);
      expect(changed.moduleContentDigests[resource]).not.toBe(first.moduleContentDigests[resource]);
      expect(changed.trustRevision).not.toBe(first.trustRevision);
      expect(changed.closureDigest).not.toBe(first.closureDigest);
      expect(verifyTcbClosureLockAgainstExactTree(closure, { candidateRoot: root, expectedIdentity: first }).status)
        .toBe('failed');
      const snapshot = createTcbClosureCandidateSnapshot({ candidateRoot: root });
      const captured = trustedRuntimeClosure([owner], { candidateSnapshot: snapshot });
      writeFileSync(helper, '# changed after discovery\n');
      expect(() => computeTcbClosureLock(captured, { candidateSnapshot: snapshot })).toThrow('snapshot changed');
      expect(() => trustedRuntimeClosure([resource, owner], { candidateRoot: root }))
        .toThrow('not a reviewed resource edge');
      expect(() => trustedRuntimeClosure([owner, resource], { candidateRoot: root }))
        .toThrow('not a reviewed resource edge');
    } catch (error) {
      primary = { label: 'runtime-resource-assertions', error };
    } finally {
      settleResources({ primary, cleanup: [{ label: 'runtime-resource-fixture',
        settle: () => rmSync(createdRoot, { recursive: true, force: true }) }] });
    }
  }
});

test('TCB fixed resources reject absent and nonordinary bytes through the original snapshot reader', () => {
  for (const { owner, resource, specifier } of reviewedRuntimeResources) {
    const resourceSource = "import { fileURLToPath } from 'node:url';\n"
      + "const HELPER_PATH = fileURLToPath(new URL('" + specifier + "', import.meta.url));\n";
    const createdRoot = mkdtempSync(path.join(tmpdir(), 'sec-tcb-python-ordinary-'));
    let primary: ResourceSettlementFailure | undefined;
    try {
      const root = realpathSync.native(createdRoot);
      mkdirSync(path.join(root, path.posix.dirname(owner)), { recursive: true });
      writeFileSync(path.join(root, owner), resourceSource);
      const helper = path.join(root, resource);
      expect(() => trustedRuntimeClosure([owner], { candidateRoot: root })).toThrow('does not resolve');
      mkdirSync(helper);
      expect(() => trustedRuntimeClosure([owner], { candidateRoot: root })).toThrow();
      rmSync(helper, { recursive: true });
      const other = path.join(root, 'other.py');
      writeFileSync(other, '# original\n');
      symlinkSync(other, helper);
      expect(() => trustedRuntimeClosure([owner], { candidateRoot: root })).toThrow();
      rmSync(helper);
      linkSync(other, helper);
      expect(() => trustedRuntimeClosure([owner], { candidateRoot: root })).toThrow();
    } catch (error) {
      primary = { label: 'runtime-resource-assertions', error };
    } finally {
      settleResources({ primary, cleanup: [{ label: 'runtime-resource-fixture',
        settle: () => rmSync(createdRoot, { recursive: true, force: true }) }] });
    }
  }
});

test('TCB fixed native dependency entry retains its real transitive TypeScript source closure', () => {
  expect(SEC_TRUSTED_BOOTSTRAP_REGISTRY.runtimeEntrypoints).toContain(nativeDependencyEntrypoint);
  const closure = trustedRuntimeClosure([nativeDependencyEntrypoint]);
  for (const source of [nativeDependencyEntrypoint,
    'src/bootstrap/toolchain/dependency-operation.ts',
    'src/adapters/toolchain/dependencies/runtime/project-runtime.ts']) {
    expect(closure.closure.has(source)).toBe(true);
    expect(TCB_CLOSURE_LOCK.modules).toContain(source);
  }
});

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
  for (const member of ['getuid', 'geteuid', 'getgid', 'getegid']) {
    for (const source of [
      `export const identity = process.${member}();`,
      `export const identity = process.${member}?.();`,
      `export const identity = typeof process.${member} === 'function' ? process.${member}() : undefined;`
    ]) {
      expect(() => runtimeRelativeImportsFromSource('synthetic-process-identity.ts', source)).not.toThrow();
    }
    expect(() => runtimeRelativeImportsFromSource(
      'synthetic-process-identity.ts', `export const identity = process['${member}']();`
    )).toThrow('computed process member');
    for (const source of [
      `const host = process; export const identity = host.${member}();`,
      `const { ${member}: read } = process; export const identity = read();`,
      `Object.getOwnPropertyDescriptor(process, '${member}');`,
      `Object.defineProperty(process, '${member}', { get: () => () => 0 });`
    ]) {
      expect(() => runtimeRelativeImportsFromSource('synthetic-process-identity.ts', source))
        .toThrow('escaped process namespace');
    }
    expect(() => runtimeRelativeImportsFromSource(
      'synthetic-process-identity.ts', `export const identity = globalThis.process.${member}();`
    )).toThrow('unclassified globalThis member process');
  }
  for (const member of ['setuid', 'seteuid', 'setgid', 'setegid', 'setgroups']) {
    expect(() => runtimeRelativeImportsFromSource('synthetic-process-mutation.ts', `process.${member}(0);`))
      .toThrow(`unclassified process member ${member}`);
  }
  expect(() => runtimeRelativeImportsFromSource('synthetic-process-stream.ts', 'const input = process.stdin;'))
    .toThrow('unclassified process member stdin');
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
  expect(plan.action.producer.revision).toBe('sec-tcb-closure-action-producer-v3');
  for (const revision of ['sec-tcb-closure-action-producer-v1', 'sec-tcb-closure-action-producer-v2']) {
    expect(() => compileTcbClosureActionResult({ plan: {
      ...plan, action: { ...plan.action, producer: { ...plan.action.producer, revision } }
    } })).toThrow('not one canonical derivation plan');
  }
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
    changedPaths: ['README.md', 'src/other.py']
  });
  expect(unrelated).toEqual({ impactedPaths: [], plan: null });

  const impacted = selectTcbClosureCandidateAction({
    ...commonDemand,
    changedPaths: [SEC_TCB_CLOSURE_RUNTIME_PATH]
  });
  expect(impacted.impactedPaths).toEqual([SEC_TCB_CLOSURE_RUNTIME_PATH]);
  for (const source of [supervisorResource, nativeUnitResource, nativeDependencyEntrypoint]) {
    const sourceOnly = selectTcbClosureCandidateAction({ ...commonDemand, changedPaths: [source] });
    expect(sourceOnly.impactedPaths).toEqual([source]);
    expect(sourceOnly.plan?.action.upstreamActionKeys).toEqual([result.actionKey]);
  }
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
  expect(SEC_TRUSTED_BOOTSTRAP_REGISTRY.reviewedExternalImports).not.toContain('zod');
  expect(TCB_CLOSURE_LOCK.reviewedExternalImports)
    .toContain('src/adapters/self-hosting/development/runner/env-manager.ts -> node:net');
});

test('TCB runtime receipt schema permits its exact reviewed parser edge only', () => {
  const repositoryPath = 'src/adapters/verification/platform/ci/contract/hosted-job-runtime.ts';
  const source = "import { z } from 'zod'; export const schema = z.object({ value: z.string() }).strict();";
  const reviewedExternalImports = new Set<string>();
  const observedExternalImports = new Set<string>();
  expect(runtimeRelativeImportsFromSource(
    repositoryPath, source, new Set(), reviewedExternalImports, observedExternalImports
  )).toEqual([]);
  expect([...reviewedExternalImports]).toEqual([`${repositoryPath} -> zod`]);
  expect([...observedExternalImports]).toEqual(['zod']);
  expect(() => runtimeRelativeImportsFromSource(
    'synthetic-unreviewed-receipt-parser.ts', source
  )).toThrow('TCB runtime import is outside the approved relative/external policy');
});

test('TCB closure lock is the sole causal-runtime identity consumed by the trust-root view', () => {
  expect(TCB_TRUST_ROOT.causalRuntimePaths).toEqual(TCB_CLOSURE_LOCK.modules);
  expect(TCB_CLOSURE_LOCK.modules).toContain(SEC_TRUSTED_BOOTSTRAP_DISPATCHER_OWNER);
  expect(TCB_CLOSURE_LOCK.modules.some((entry) => entry.includes('sec-merge-bootstrap'))).toBe(false);
  expect(TCB_CLOSURE_LOCK.reviewedBoundaryEdges).toEqual([
    'src/adapters/self-hosting/control/main-health/post-merge-plan.ts -> src/adapters/verification/platform/trust/runtime/closure-lock.ts'
  ]);
});

test('MainHealth compiler boundary retains exact static protection and covers its real dependencies', () => {
  const snapshot = createTcbClosureCandidateSnapshot({
    candidateRoot: path.resolve(import.meta.dir, '../..')
  });
  const options = { candidateSnapshot: snapshot };
  const lock = generateTcbClosureLock(options);
  const trustRoot = createSecTrustedBootstrapTrustRoot({
    registry: SEC_TRUSTED_BOOTSTRAP_REGISTRY,
    causalRuntimePaths: lock.modules
  });
  const boundary = trustedRuntimeClosure([SEC_TCB_CLOSURE_RUNTIME_PATH], options);
  finalizeTcbClosureCandidateSnapshot(snapshot);

  expect(lock.modules).toContain('src/adapters/self-hosting/control/main-health/post-merge-plan.ts');
  expect(lock.modules).not.toContain(SEC_TCB_CLOSURE_RUNTIME_PATH);
  expect(matchSecTrustedBootstrapPath(SEC_TCB_CLOSURE_RUNTIME_PATH, trustRoot)).toEqual({
    kind: 'static-exact',
    rule: SEC_TCB_CLOSURE_RUNTIME_PATH
  });
  expect(boundary.closure.has(SEC_TCB_CLOSURE_RUNTIME_PATH)).toBe(true);
  for (const dependency of boundary.closure) {
    expect(matchSecTrustedBootstrapPath(dependency, trustRoot)).not.toBeNull();
  }
});

test('compiler boundary only cuts the reviewed importer and still observes target bytes', () => {
  const createdRoot = mkdtempSync(path.join(tmpdir(), 'sec-tcb-boundary-'));
  let primary: ResourceSettlementFailure | undefined;
  try {
    const root = realpathSync.native(createdRoot);
    const importer = 'src/adapters/self-hosting/control/main-health/post-merge-plan.ts';
    const foreignImporter = 'src/adapters/self-hosting/control/main-health/unreviewed-plan.ts';
    const target = SEC_TCB_CLOSURE_RUNTIME_PATH;
    const dependency = path.posix.join(path.posix.dirname(target), 'fixture-dependency.ts');
    const specifier = path.posix.relative(path.posix.dirname(importer), target);
    mkdirSync(path.join(root, path.posix.dirname(importer)), { recursive: true });
    mkdirSync(path.join(root, path.posix.dirname(target)), { recursive: true });
    writeFileSync(path.join(root, importer), `import '${specifier}';\n`);
    writeFileSync(path.join(root, foreignImporter), `import '${specifier}';\n`);
    writeFileSync(path.join(root, target), "import './fixture-dependency.ts';\n");
    writeFileSync(path.join(root, dependency), 'export const dependency = 1;\n');

    const foreignSnapshot = createTcbClosureCandidateSnapshot({ candidateRoot: root });
    const foreignClosure = trustedRuntimeClosure([foreignImporter], { candidateSnapshot: foreignSnapshot });
    finalizeTcbClosureCandidateSnapshot(foreignSnapshot);
    expect([...foreignClosure.reviewedBoundaryEdges]).toEqual([]);
    expect([...foreignClosure.closure].sort()).toEqual([foreignImporter, target, dependency].sort());

    const snapshot = createTcbClosureCandidateSnapshot({ candidateRoot: root });
    const closure = trustedRuntimeClosure([importer], { candidateSnapshot: snapshot });
    expect([...closure.closure]).toEqual([importer]);
    expect([...closure.reviewedBoundaryEdges]).toEqual([`${importer} -> ${target}`]);
    writeFileSync(path.join(root, target), 'export const changed = true;\n');
    expect(() => finalizeTcbClosureCandidateSnapshot(snapshot)).toThrow('snapshot changed');
  } catch (error) {
    primary = { label: 'compiler-boundary-assertions', error };
  } finally {
    settleResources({
      primary,
      cleanup: [{ label: 'compiler-boundary-fixture', settle: () => rmSync(createdRoot, { recursive: true, force: true }) }]
    });
  }
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
  const moduleMembership = compileRepositoryModuleMembershipSnapshot({
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

test('TCB retired HTTPS bindings reject direct, escaped and substituted network dispatchers', () => {
  const publisher = 'src/adapters/providers/docker/runtime/linux-static-toolchain-publisher.ts';
  const prefix = "import { Agent, request } from 'node:https';\n";
  const direct = 'function download(agent: Agent) { return new Promise(resolve => { request(target, { agent }, resolve); }); }';
  const network = new Set<string>();
  expect(() => runtimeRelativeImportsFromSource(publisher, prefix + direct,
    new Set(), new Set(), new Set(), network)).toThrow('unreviewed node:https importer');
  expect([...network]).toEqual([]);
  expect(() => runtimeRelativeImportsFromSource(publisher,
    prefix + 'function publishLinuxDockerStaticToolchain() { return new Agent({ keepAlive: false }); }'))
    .toThrow('unreviewed node:https importer');
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
  expect(() => runtimeRelativeImportsFromSource(publisher,
    "import { request } from 'node:https'; function download(request: (url: unknown) => unknown) { return request(target); }",
    new Set(), new Set(), new Set(), network)).toThrow('unreviewed node:https importer');
  // A denied historical import cannot turn a local callback into network authority.
  expect([...network]).toEqual([]);
  expect([...network]).not.toEqual([`${publisher}::function-declaration:download::node:https.request#1`]);
});

test('TCB live census excludes the retired publisher and denies its actual HTTPS source', () => {
  const publisher = 'src/adapters/providers/docker/runtime/linux-static-toolchain-publisher.ts';
  const network = new Set<string>();
  const external = new Set<string>();
  expect(TCB_CLOSURE_LOCK.modules).not.toContain(publisher);
  expect(TCB_REVIEWED_NETWORK_DISPATCHERS.has(`${publisher}::function-declaration:download::node:https.request#1`))
    .toBe(false);
  expect(SEC_TRUSTED_BOOTSTRAP_REGISTRY.reviewedExternalImports
    .filter((edge) => edge.startsWith(`${publisher} -> `))).toEqual([]);
  expect(() => runtimeRelativeImportsFromSource(publisher, readFileSync(publisher, 'utf8'),
    new Set(), new Set(), external, network)).toThrow('unreviewed node:https importer');
  expect([...network]).toEqual([]);
  expect(external.has(`${publisher} -> node:https`)).toBe(false);
});

test('TCB active hosted origin source records its exact reviewed fetch dispatcher', () => {
  const owner = 'src/adapters/providers/github-api/hosted-job-origin.ts';
  const site = `${owner}::function-declaration:jsonRequest::globalThis.fetch#1`;
  const network = new Set<string>();
  expect(TCB_REVIEWED_NETWORK_DISPATCHERS.has(site)).toBe(true);
  expect(() => runtimeRelativeImportsFromSource(owner, readFileSync(owner, 'utf8'),
    new Set(), new Set(), new Set(), network)).not.toThrow();
  expect([...network]).toEqual([site]);
});

test('TCB active hosted origin does not credit a locally bound fetch callback', () => {
  const owner = 'src/adapters/providers/github-api/hosted-job-origin.ts';
  const network = new Set<string>();
  expect(() => runtimeRelativeImportsFromSource(owner,
    'function jsonRequest(fetch: (target: unknown) => unknown, target: unknown) { return fetch(target); }',
    new Set(), new Set(), new Set(), network)).not.toThrow();
  expect([...network]).toEqual([]);
});
