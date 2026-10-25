import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { compileRepositoryModuleMembershipSnapshot } from '../../../src/adapters/repository/architecture/contract.ts';
import { compileRepositorySourceProgramModel } from '../../../src/adapters/repository/source-program-model/repository.ts';
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
  TCB_TRUST_ROOT
} from '../../../src/adapters/verification/platform/trust/compiler.ts';
import { createSecTrustedBootstrapTrustRoot, matchSecTrustedBootstrapPath, parseSecTrustedBootstrapRegistry, SEC_TCB_CLOSURE_RUNTIME_PATH, SEC_TRUSTED_BOOTSTRAP_DISPATCHER_OWNER, SEC_TRUSTED_BOOTSTRAP_REGISTRY, SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH, type SecTrustedBootstrapRegistry } from '../../../src/adapters/verification/platform/trust/contract/root.ts';
import { rawSha256 } from '../../../src/contracts/canonical.ts';
import { settleResources, type ResourceSettlementFailure } from '../../../src/execution/resource-settlement.ts';

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
  const createdRoot = mkdtempSync(path.join(tmpdir(), 'sec-tcb-candidate-root-'));
  let primary: ResourceSettlementFailure | undefined;
  try {
    const root = realpathSync.native(createdRoot);
    writeFileSync(path.join(root, 'entry.ts'), "import './leaf.ts';\n", 'utf8');
    writeFileSync(path.join(root, 'leaf.ts'), 'export const leaf = 1;\n', 'utf8');
    const snapshot = createTcbClosureCandidateSnapshot({ candidateRoot: root });
    const options = { candidateSnapshot: snapshot };
    const closure = trustedRuntimeClosure(['entry.ts'], options);
    expect([...closure.closure].sort()).toEqual(['entry.ts', 'leaf.ts']);
    const lock = computeTcbClosureLock(closure, options);
    expect(lock.modules).toEqual(['entry.ts', 'leaf.ts']);
    expect(lock.trustRevision).toMatch(/^sha256:[0-9a-f]{64}$/u);
    for (const [module, source] of [
      ['entry.ts', "import './leaf.ts';\n"], ['leaf.ts', 'export const leaf = 1;\n']
    ] as const) {
      const bytes = Buffer.from(source, 'utf8');
      expect(lock.moduleBlobs[module]).toBe(createHash('sha1')
        .update(`blob ${bytes.length}\0`).update(bytes).digest('hex'));
      expect(lock.moduleContentDigests[module]).toBe(`sha256:${createHash('sha256').update(bytes).digest('hex')}`);
    }
    finalizeTcbClosureCandidateSnapshot(snapshot);
  } catch (error) {
    primary = { label: 'TCB candidate assertions', error };
    throw error;
  } finally {
    settleResources({ primary, cleanup: [{ label: 'TCB candidate root', settle: () => rmSync(createdRoot, { recursive: true, force: true }) }] });
  }
});

test('one explicit candidate snapshot rejects discovery-to-hash mutation and missing-path appearance', () => {
  const createdRoot = mkdtempSync(path.join(tmpdir(), 'sec-tcb-candidate-snapshot-'));
  let primary: ResourceSettlementFailure | undefined;
  try {
    const root = realpathSync.native(createdRoot);
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
  } catch (error) {
    primary = { label: 'TCB candidate assertions', error };
    throw error;
  } finally {
    settleResources({ primary, cleanup: [{ label: 'TCB candidate root', settle: () => rmSync(createdRoot, { recursive: true, force: true }) }] });
  }
});

test('TCB candidate root rejects aliases, traversal, and non-regular candidate leaves', () => {
  const createdRoot = mkdtempSync(path.join(tmpdir(), 'sec-tcb-candidate-negative-'));
  const cleanup: Parameters<typeof settleResources>[0]['cleanup'][number][] = [
    { label: 'TCB candidate root', settle: () => rmSync(createdRoot, { recursive: true, force: true }) }
  ];
  let primary: ResourceSettlementFailure | undefined;
  try {
    const root = realpathSync.native(createdRoot);
    const createdOutside = mkdtempSync(path.join(tmpdir(), 'sec-tcb-candidate-outside-'));
    cleanup.push({ label: 'TCB outside root', settle: () => rmSync(createdOutside, { recursive: true, force: true }) });
    const outside = realpathSync.native(createdOutside);
    writeFileSync(path.join(root, 'entry.ts'), 'export const entry = 1;\n', 'utf8');
    writeFileSync(path.join(root, 'root-file'), 'not a directory\n', 'utf8');
    mkdirSync(path.join(root, 'directory.ts'));
    const outsideFile = path.join(outside, 'leaf.ts');
    const hardLinkSource = path.join(outside, 'hard-link-source.ts');
    writeFileSync(outsideFile, 'export const outside = true;\n', 'utf8');
    writeFileSync(hardLinkSource, 'export const hardLinkSource = true;\n', 'utf8');
    linkSync(hardLinkSource, path.join(root, 'leaf.ts'));
    symlinkSync(outside, path.join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    const hardLinkIdentity = statSync(hardLinkSource, { bigint: true });
    const outsideIdentity = statSync(outsideFile, { bigint: true });

    expect(() => trustedRuntimeClosure(['entry.ts'], {
      candidateRoot: `${root}${path.sep}`
    })).toThrow('absolute canonical path');
    expect(() => trustedRuntimeClosure(['entry.ts'], {
      candidateRoot: path.join(root, 'root-file')
    })).toThrow('physical non-symlink canonical directory');
    expect(() => trustedRuntimeClosure(['../entry.ts'], { candidateRoot: root }))
      .toThrow('module path is not canonical');
    expect(() => trustedRuntimeClosure(['directory.ts'], { candidateRoot: root }))
      .toThrow('TCB candidate module bounded read failed');
    expect(() => trustedRuntimeClosure(['leaf.ts'], { candidateRoot: root }))
      .toThrow('TCB candidate module bounded read failed');
    expect(readFileSync(hardLinkSource, 'utf8')).toBe('export const hardLinkSource = true;\n');
    expect(readFileSync(path.join(root, 'leaf.ts'), 'utf8')).toBe('export const hardLinkSource = true;\n');
    expect(() => trustedRuntimeClosure(['linked/leaf.ts'], { candidateRoot: root }))
      .toThrow('TCB candidate module bounded read failed');
    expect(readFileSync(outsideFile, 'utf8')).toBe('export const outside = true;\n');
    expect(statSync(hardLinkSource, { bigint: true })).toMatchObject({
      dev: hardLinkIdentity.dev, ino: hardLinkIdentity.ino, nlink: hardLinkIdentity.nlink
    });
    expect(statSync(outsideFile, { bigint: true })).toMatchObject({
      dev: outsideIdentity.dev, ino: outsideIdentity.ino, nlink: outsideIdentity.nlink
    });
  } catch (error) {
    primary = { label: 'TCB candidate assertions', error };
    throw error;
  } finally {
    settleResources({ primary, cleanup });
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

test('TCB closure retains empty and inline-type ESM module evaluation edges', () => {
  for (const statement of [
    "import {} from './leaf.ts';",
    "import { type T } from './leaf.ts';",
    "export {} from './leaf.ts';",
    "export { type T } from './leaf.ts';"
  ]) {
    expect(runtimeRelativeImportsFromSource('entry.ts', statement)).toEqual(['./leaf.ts']);
    const observedExternalImports = new Set<string>();
    expect(runtimeRelativeImportsFromSource('entry.ts', statement.replace('./leaf.ts', 'node:fs'),
      new Set(), new Set(), observedExternalImports)).toEqual([]);
    expect([...observedExternalImports]).toEqual(['node:fs']);
    expect(() => runtimeRelativeImportsFromSource('entry.ts',
      statement.replace('./leaf.ts', 'unreviewed-package')))
      .toThrow('outside the approved relative/external policy');
  }
});

test('TCB empty and inline-type edges cannot bypass classified external import policy', () => {
  // Each classified import branch, plus both forms of the shared re-export guard.
  for (const statement of [
    "import { type T } from 'bun';",
    "import {} from 'node:child_process';",
    "import {} from 'node:https';",
    "import {} from 'node:module';",
    "import { type T } from 'node:worker_threads';",
    "export {} from 'bun';",
    "export { type T } from 'node:child_process';"
  ]) {
    expect(() => runtimeRelativeImportsFromSource('entry.ts', statement))
      .toThrow('TCB runtime loader is outside the relative ESM closure model');
  }
});

test('TCB empty and inline-type edges bind transitive bytes and reject an unreviewed terminal', () => {
  const createdRoot = mkdtempSync(path.join(tmpdir(), 'sec-tcb-module-evaluation-'));
  let primary: ResourceSettlementFailure | undefined;
  try {
    const root = realpathSync.native(createdRoot);
    writeFileSync(path.join(root, 'entry.ts'), "import './bridge.ts';\n");
    for (const statement of [
      "import {} from './terminal.ts';",
      "import { type T } from './terminal.ts';",
      "export {} from './terminal.ts';",
      "export { type T } from './terminal.ts';"
    ]) {
      writeFileSync(path.join(root, 'bridge.ts'), statement + '\n');
      const terminal = 'export type T = string;\nexport const value = 1;\n';
      writeFileSync(path.join(root, 'terminal.ts'), terminal);
      const closure = trustedRuntimeClosure(['entry.ts'], { candidateRoot: root });
      expect([...closure.closure].sort()).toEqual(['bridge.ts', 'entry.ts', 'terminal.ts']);
      const lock = computeTcbClosureLock(closure, { candidateRoot: root });
      expect(lock.modules).toEqual(['bridge.ts', 'entry.ts', 'terminal.ts']);
      expect(lock.moduleContentDigests['terminal.ts']).toBe(rawSha256(terminal));

      writeFileSync(path.join(root, 'terminal.ts'), 'export type T = string;\n'
        + 'function unreviewedFetch() { return globalThis.fetch("https://example.invalid/tcb"); }\n'
        + 'void unreviewedFetch();\n');
      expect(() => trustedRuntimeClosure(['entry.ts'], { candidateRoot: root }))
        .toThrow('unreviewed network dispatcher terminal.ts::function-declaration:unreviewedFetch::globalThis.fetch#1');
    }
  } catch (error) {
    primary = { label: 'module-evaluation-assertions', error };
  } finally {
    settleResources({ primary, cleanup: [{ label: 'module-evaluation-fixture',
      settle: () => rmSync(createdRoot, { recursive: true, force: true }) }] });
  }
});

test('TCB statement-level type imports and re-exports erase module evaluation', () => {
  // Statement-level type syntax is erased before the specifier policy is consulted.
  for (const statement of [
    "import type { T } from './missing.ts';",
    "import type * as Types from 'bun';",
    "export type { T } from 'node:child_process';",
    "export type * from 'unreviewed-package';"
  ]) {
    const observedExternalImports = new Set<string>();
    expect(runtimeRelativeImportsFromSource('entry.ts', statement,
      new Set(), new Set(), observedExternalImports)).toEqual([]);
    expect([...observedExternalImports]).toEqual([]);
  }
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
  const identity = result.identity;
  expect(identity.moduleCount).toBe(identity.modules.length);
  expect(new Set(identity.modules).size).toBe(identity.moduleCount);
  for (const module of identity.modules) {
    expect(identity.moduleBlobs[module]).toMatch(/^[0-9a-f]{40}$/);
    expect(identity.moduleContentDigests[module]).toMatch(/^sha256:[0-9a-f]{64}$/);
  }
  expect(Object.keys(identity.moduleBlobs)).toHaveLength(identity.moduleCount);
  expect(Object.keys(identity.moduleContentDigests)).toHaveLength(identity.moduleCount);
  expect(SEC_TRUSTED_BOOTSTRAP_REGISTRY.reviewedExternalImports)
    .toContain('src/adapters/self-hosting/development/runner/env-manager.ts -> node:net');
  expect(SEC_TRUSTED_BOOTSTRAP_REGISTRY.reviewedExternalImports)
    .toContain('src/adapters/providers/linux-verification/contract.ts -> zod');
  expect(SEC_TRUSTED_BOOTSTRAP_REGISTRY.reviewedExternalImports)
    .toContain('src/adapters/repository/source-program-model/test-impact-projection.ts -> zod');
  expect(SEC_TRUSTED_BOOTSTRAP_REGISTRY.reviewedExternalImports).not.toContain('zod');
  expect(identity.reviewedExternalImports)
    .toContain('src/adapters/self-hosting/development/runner/env-manager.ts -> node:net');
  expect([...TCB_REVIEWED_PROCESS_DISPATCHERS].sort()).toEqual([...identity.reviewedProcessDispatchers].sort());
  expect([...TCB_REVIEWED_NETWORK_DISPATCHERS].sort()).toEqual([...identity.reviewedNetworkDispatchers].sort());
  expect(identity.reviewedEdges).toEqual([]);
  expect(SEC_TRUSTED_BOOTSTRAP_REGISTRY.reviewedSutEdges).toEqual([]);

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

function canonicalSource(value: SecTrustedBootstrapRegistry | Record<string, unknown>): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function registrySource(): string {
  return readFileSync(path.resolve(import.meta.dir, '../../../src/adapters/verification/platform/trust/contract/ci-trust-root-registry.json'), 'utf8');
}

function mutate(patch: Partial<Record<keyof SecTrustedBootstrapRegistry, unknown>>): string {
  return canonicalSource({ ...SEC_TRUSTED_BOOTSTRAP_REGISTRY, ...patch });
}

test('canonical trust-root registry and closure preserve exact privilege boundaries', () => {
  expect(TCB_TRUST_ROOT.causalRuntimePaths).toEqual(TCB_CLOSURE_LOCK.modules);
  expect(TCB_CLOSURE_LOCK.modules).toContain(SEC_TRUSTED_BOOTSTRAP_DISPATCHER_OWNER);
  expect(TCB_CLOSURE_LOCK.modules.some((entry) => entry.includes('sec-merge-bootstrap'))).toBe(false);
  expect(TCB_CLOSURE_LOCK.reviewedBoundaryEdges).toEqual([
    'src/adapters/self-hosting/control/main-health/post-merge-plan.ts -> src/adapters/verification/platform/trust/runtime/closure-lock.ts'
  ]);

  const parsed = parseSecTrustedBootstrapRegistry(registrySource());
  expect(parsed).toEqual(SEC_TRUSTED_BOOTSTRAP_REGISTRY);
  expect(registrySource()).not.toContain('causalRuntimePaths');
  expect(parsed.reviewedSutEdges).toEqual([]);
  expect(parsed.staticDirectoryPaths).not.toContain('.shared-deps/');
  expect(parsed.reviewedBoundaryEdges).toEqual([
    'src/adapters/self-hosting/control/main-health/post-merge-plan.ts -> src/adapters/verification/platform/trust/runtime/closure-lock.ts'
  ]);
  expect(parsed.reviewedExternalImports).toContain(
    'src/adapters/repository/source-program-model/test-impact-projection.ts -> zod'
  );

  const causalRuntimePath = TCB_TRUST_ROOT.causalRuntimePaths[0]!;
  expect(matchSecTrustedBootstrapPath('scripts/codex/untrusted.ts', TCB_TRUST_ROOT)).toBeNull();
  expect(matchSecTrustedBootstrapPath(causalRuntimePath, TCB_TRUST_ROOT)).toEqual({
    kind: 'causal-runtime',
    rule: causalRuntimePath
  });
  expect(matchSecTrustedBootstrapPath(SEC_TCB_CLOSURE_RUNTIME_PATH, TCB_TRUST_ROOT)).toEqual({
    kind: 'static-exact',
    rule: SEC_TCB_CLOSURE_RUNTIME_PATH
  });
  expect(matchSecTrustedBootstrapPath(SEC_TRUSTED_BOOTSTRAP_DISPATCHER_OWNER, TCB_TRUST_ROOT)).toEqual({
    kind: 'causal-runtime',
    rule: SEC_TRUSTED_BOOTSTRAP_DISPATCHER_OWNER
  });
  expect(matchSecTrustedBootstrapPath(SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH, TCB_TRUST_ROOT)).toEqual({
    kind: 'static-exact',
    rule: SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH
  });
  expect(matchSecTrustedBootstrapPath('.github/workflows/compiler-pr-validation.yml', TCB_TRUST_ROOT)).toEqual({
    kind: 'static-directory',
    rule: '.github/workflows/'
  });
  expect(matchSecTrustedBootstrapPath('.env.production', TCB_TRUST_ROOT)).toEqual({
    kind: 'static-prefix',
    rule: '.env'
  });
  for (const helper of [
    'src/adapters/verification/platform/ci/runtime/hosted-sut-supervisor.py',
    'src/adapters/runtime-state/physical/runtime/linux-verification-unit-helper.py'
  ]) {
    expect(matchSecTrustedBootstrapPath(helper, TCB_TRUST_ROOT)).toEqual({ kind: 'causal-runtime', rule: helper });
    expect(parsed.staticExactPaths).not.toContain(helper);
    expect(TCB_CLOSURE_LOCK.moduleContentDigests[helper]).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(matchSecTrustedBootstrapPath(path.posix.join(path.posix.dirname(helper), 'other.py'), TCB_TRUST_ROOT))
      .toBeNull();
  }
  const entry = 'src/bootstrap/toolchain/native-verification-dependencies.ts';
  expect(parsed.runtimeEntrypoints).toContain(entry);
  expect(TCB_CLOSURE_LOCK.modules).toContain(entry);
  expect(parsed.staticDirectoryPaths).not.toContain('src/bootstrap/toolchain/');
  expect(matchSecTrustedBootstrapPath('src/bootstrap/toolchain/unreviewed-entry.ts', TCB_TRUST_ROOT)).toBeNull();
  expect(matchSecTrustedBootstrapPath('src/unreviewed.py', TCB_TRUST_ROOT)).toBeNull();
  expect(TCB_TRUST_ROOT.paths).not.toContain('scripts/codex/');

  const base = SEC_TRUSTED_BOOTSTRAP_REGISTRY;
  const failures = [
    registrySource().trimEnd(),
    `${registrySource()}\n`,
    canonicalSource({ ...base, unknown: true }),
    registrySource().replace(
      '  "schema": "sec-trusted-bootstrap-registry-v3",\n',
      '  "schema": "sec-trusted-bootstrap-registry-v3",\n  "schema": "sec-trusted-bootstrap-registry-v3",\n'
    ),
    mutate({ staticExactPaths: [...base.staticExactPaths, base.staticExactPaths[0]!].sort() }),
    mutate({ staticExactPaths: [...base.staticExactPaths].reverse() }),
    mutate({ staticExactPaths: [...base.staticExactPaths.slice(0, -1), 'C:/escape.ts'].sort() }),
    mutate({ staticExactPaths: [...base.staticExactPaths.slice(0, -1), '../escape.ts'].sort() }),
    mutate({ staticExactPaths: [...base.staticExactPaths.slice(0, -1), 'platform\\escape.ts'].sort() }),
    mutate({ staticExactPaths: [...base.staticExactPaths.slice(0, -1), 'docs/'].sort() }),
    mutate({ staticDirectoryPaths: [...base.staticDirectoryPaths.slice(0, -1), 'tests/testkit'].sort() }),
    mutate({ staticDirectoryPaths: [...base.staticDirectoryPaths, 'scripts/codex/'].sort() }),
    mutate({ staticDirectoryPaths: [...base.staticDirectoryPaths, 'src/adapters/verification/platform/'].sort() }),
    mutate({ staticPrefixes: ['.env', '.env.'] }),
    mutate({ staticPrefixes: ['../'] }),
    mutate({ staticExactPaths: base.staticExactPaths.filter((entry) => entry !== '.bun-version') }),
    mutate({
      staticExactPaths: base.staticExactPaths.filter((entry) => entry !== SEC_TCB_CLOSURE_RUNTIME_PATH)
    }),
    mutate({
      staticExactPaths: base.staticExactPaths.filter((entry) => entry !== SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH)
    }),
    mutate({
      reviewedBoundaryEdges: ['src/adapters/verification/platform/ci/runtime/verification-session.ts -> platform/shared/ci-contract.ts']
    }),
    mutate({
      reviewedBoundaryEdges: ['src/adapters/verification/platform/ci/runtime/verification-session.ts -> src/adapters/self-hosting/control/main-health/contract.ts']
    }),
    mutate({
      reviewedExternalImports: [
        ...base.reviewedExternalImports,
        'src/adapters/repository/source-program-model/test-impact-projection.ts -> zod'
      ].sort()
    }),
    mutate({ reviewedExternalImports: ['* -> zod'] }),
    mutate({
      reviewedExternalImports: [
        'src/adapters/repository/source-program-model/test-impact-projection.ts -> zod/*'
      ]
    }),
    mutate({
      reviewedExternalImports: [
        'src/adapters/repository/source-program-model/test-impact-projection.ts -> ../zod'
      ]
    }),
    mutate({
      reviewedExternalImports: [
        'src/adapters/repository/source-program-model/test-impact-projection.ts -> zod as parser'
      ]
    })
  ];

  for (const source of failures) {
    expect(() => parseSecTrustedBootstrapRegistry(source)).toThrow();
  }
});

test('MainHealth compiler boundary composes canonical policy and causal identities without path aliases', () => {
  const snapshot = createTcbClosureCandidateSnapshot({
    candidateRoot: path.resolve(import.meta.dir, '../../..')
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

  const base = SEC_TRUSTED_BOOTSTRAP_REGISTRY;
  const modules = lock.modules;
  const syntheticModule = 'scripts/codex/untrusted.ts';
  expect(() => createSecTrustedBootstrapTrustRoot({
    registry: base,
    causalRuntimePaths: [...modules, SEC_TCB_CLOSURE_RUNTIME_PATH].sort()
  })).toThrow(`Trusted bootstrap path cannot be both staticExact and causalRuntime: ${SEC_TCB_CLOSURE_RUNTIME_PATH}.`);
  const causalFailures = [
    modules.filter((entry) => entry !== SEC_TRUSTED_BOOTSTRAP_DISPATCHER_OWNER),
    [...modules].reverse(),
    [...modules, modules[0]!].sort(),
    [...modules.slice(0, -1), 'virtual/e\u0301.ts'].sort()
  ];
  for (const causalRuntimePaths of causalFailures) {
    expect(() => createSecTrustedBootstrapTrustRoot({ registry: base, causalRuntimePaths })).toThrow();
  }
  for (const registry of [
    { ...base, staticExactPaths: [...base.staticExactPaths].reverse() },
    { ...base, runtimeEntrypoints: [...base.runtimeEntrypoints, syntheticModule].sort() },
    { ...base, reviewedSutEdges: [`${syntheticModule} -> platform/untrusted.ts`] },
    { ...base, reviewedBoundaryEdges: [`${syntheticModule} -> ${SEC_TCB_CLOSURE_RUNTIME_PATH}`] }
  ]) {
    expect(() => createSecTrustedBootstrapTrustRoot({ registry, causalRuntimePaths: modules })).toThrow();
  }

  for (const repositoryPath of [
    '../src/adapters/self-hosting/control/integration/merge-gate.ts',
    '/src/adapters/self-hosting/control/integration/merge-gate.ts',
    'scripts\\codex\\merge-gate.ts',
    'scripts//codex/merge-gate.ts',
    'C:/src/adapters/self-hosting/control/integration/merge-gate.ts'
  ]) {
    expect(() => matchSecTrustedBootstrapPath(repositoryPath, trustRoot)).toThrow();
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

  const repositoryRoot = path.resolve(import.meta.dir, '../../..');
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

test('TCB retired network imports reject alternate import forms', () => {
  const publisher = 'src/adapters/providers/docker/runtime/linux-static-toolchain-publisher.ts';
  for (const source of [
    "import { get } from 'node:https'; function download() { return get(target); }",
    "import { request as send } from 'node:https'; function download() { return send(target); }",
    "import https from 'node:https'; function download() { return https.request(target); }",
    "import * as https from 'node:https'; function download() { return https.request(target); }",
    "export { request } from 'node:https';",
    "export const https = import('node:https');",
    "import { request } from 'node:http'; function download() { return request(target); }"
  ]) {
    expect(() => runtimeRelativeImportsFromSource(publisher, source)).toThrow();
  }
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

test('TCB shared origin and session owner records both exact reviewed fetch dispatchers', () => {
  const owner = 'src/adapters/providers/github-api/internal/operation-session-runtime.ts';
  const sites = ['jsonRequest', 'withProductionSession'].map(name =>
    `${owner}::function-declaration:${name}::globalThis.fetch#1`);
  const network = new Set<string>();
  for (const site of sites) expect(TCB_REVIEWED_NETWORK_DISPATCHERS.has(site)).toBe(true);
  expect(() => runtimeRelativeImportsFromSource(owner, readFileSync(owner, 'utf8'),
    new Set(), new Set(), new Set(), network)).not.toThrow();
  expect([...network].sort()).toEqual(sites.sort());
  const facade = 'src/adapters/providers/github-api/hosted-job-origin.ts';
  const facadeNetwork = new Set<string>();
  expect(() => runtimeRelativeImportsFromSource(facade, readFileSync(facade, 'utf8'),
    new Set(), new Set(), new Set(), facadeNetwork)).not.toThrow();
  expect([...facadeNetwork]).toEqual([]);
});

test('TCB active hosted origin does not credit a locally bound fetch callback', () => {
  const owner = 'src/adapters/providers/github-api/internal/operation-session-runtime.ts';
  const network = new Set<string>();
  expect(() => runtimeRelativeImportsFromSource(owner,
    'function jsonRequest(fetch: (target: unknown) => unknown, target: unknown) { return fetch(target); }',
    new Set(), new Set(), new Set(), network)).not.toThrow();
  expect([...network]).toEqual([]);
});
