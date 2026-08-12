import { afterAll, afterEach, beforeEach, expect, mock, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';

import type { DevCommandObservation } from '../../platform/dev-runner/command-runner.ts';
import * as actualEnvManager from '../../platform/dev-runner/env-manager.ts';
import {
  DEFAULT_CONCURRENT_FAST_SHARD_CONCURRENCY,
  DEFAULT_FAST_TEST_CONCURRENCY_BUDGET,
  DEFAULT_FAST_TEST_EXCLUDED_FILES,
  DEFAULT_FAST_TEST_MAX_CONCURRENCY,
  DEFAULT_FAST_TEST_PROCESS_SHARD_SIZE,
  DEFAULT_FAST_TEST_RESOURCE_CLASS_LIMITS,
  DEFAULT_FAST_TEST_TIMEOUT_MS,
  FAST_TEST_PROCESS_ISOLATION_REGISTRY,
  FAST_TEST_PROCESS_RESOURCE_CLASS_ORDER,
  isDefaultFastTestFile,
  planFastTestProcesses,
  PROCESS_ISOLATED_FAST_TEST_FILES
} from '../../platform/dev-runner/fast-test-policy.ts';
import { applyDefaultFastTestConcurrency } from '../../platform/dev-runner/test-concurrency-policy.ts';

const actualCommandRunner = await import('../../platform/dev-runner/command-runner.ts');

const {
  cleanStaleTestWorkspaces: actualCleanStaleTestWorkspaces,
  cleanTestWorkspaces: actualCleanTestWorkspaces,
  getTestWorkspaceTemplateRoot,
  getTestWorkspaceTempRoot,
  pathEnvKey,
  resolveTestWorkspaceNamespace,
  TEST_WORKSPACE_NAMESPACE_ENV
} = actualEnvManager;

const commandCalls: { command: string; args: string[]; stdoutMode: 'bytes' | 'text' }[] = [];
const devCommandCalls: { command: string; args: string[] }[] = [];
const devCommandEnvironments: NodeJS.ProcessEnv[] = [];
const devCommandExitCodes: number[] = [];
const devCommandFailures: Array<Error | null> = [];
const devCommandObservationOverrides: Array<Partial<DevCommandObservation> | undefined> = [];
const devCommandSettlements: Array<Promise<void> | undefined> = [];
const devCommandStartObservers: Array<(() => void) | undefined> = [];
const devCommandCompletionObservers: Array<(() => void) | undefined> = [];
const canonicalBrowserCachePath = path.resolve('.shared-deps', '.playwright-browsers');
let testDependencyBootstrapCalls = 0;
let hasTestDependencyBootstrapFailure = false;
let testDependencyBootstrapFailure: unknown;
let cleanupFailure: Error | null = null;
const isolatedFastTestFileSet = new Set<string>(PROCESS_ISOLATED_FAST_TEST_FILES);
let changedFiles = ['platform/unmapped-source.ts'];
let materializeTestWorkspace = false;
let previousTestWorkspaceNamespace: string | undefined;
let previousAffectedTestsBase: string | undefined;
let previousChangedBase: string | undefined;

mock.module('../../platform/shared/fs.ts', () => ({
  pathExists: async (targetPath: string) => {
    try {
      await fs.access(targetPath);
      return true;
    } catch {
      return false;
    }
  }
}));

const processCommand = (
  command: string,
  args: string[],
  stdoutMode: 'bytes' | 'text'
): { code: number; stdout: string | Uint8Array; stderr: string } => {
  commandCalls.push({ command, args, stdoutMode });
  const stdout = (value: string): string | Uint8Array => (
    stdoutMode === 'bytes' ? new TextEncoder().encode(value) : value
  );

  if (command === 'git' && args.includes('diff')) {
    return { code: 0, stdout: stdout(changedFiles.map((file) => `M\0${file}\0`).join('')), stderr: '' };
  }

  if (command === 'git' && args.includes('ls-files')) {
    return { code: 0, stdout: stdout(''), stderr: '' };
  }

  return { code: 1, stdout: stdout(''), stderr: `Unexpected command: ${command} ${args.join(' ')}` };
};

mock.module('../../platform/shared/process.ts', () => ({
  runCommand: async (command: string, args: string[]) => processCommand(command, args, 'text'),
  runCommandBytes: async (command: string, args: string[]) => processCommand(command, args, 'bytes')
}));

mock.module('../../platform/dev-runner/env-manager.ts', () => ({
  cleanStaleTestWorkspaces: actualCleanStaleTestWorkspaces,
  cleanTestWorkspaces: async (env: NodeJS.ProcessEnv) => {
    if (cleanupFailure) throw cleanupFailure;
    await actualCleanTestWorkspaces(env);
  },
  getTestWorkspaceTemplateRoot,
  getTestWorkspaceTempRoot,
  pathEnvKey,
  resolveTestWorkspaceNamespace,
  TEST_WORKSPACE_NAMESPACE_ENV
}));

mock.module('../../platform/dev-runner/command-runner.ts', () => ({
  ...actualCommandRunner,
  runDevCommand: async (
    command: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    options?: { observe: true }
  ) => {
    devCommandCalls.push({ command, args });
    devCommandEnvironments.push(env);
    devCommandStartObservers.shift()?.();
    if (materializeTestWorkspace) {
      await fs.mkdir(getTestWorkspaceTempRoot(env), { recursive: true });
    }
    const failure = devCommandFailures.shift();
    const settlement = devCommandSettlements.shift();
    const completionObserver = devCommandCompletionObservers.shift();
    const exitCode = devCommandExitCodes.shift() ?? 0;
    const override = devCommandObservationOverrides.shift();
    if (settlement) await settlement;
    completionObserver?.();
    if (failure) throw failure;
    if (!options?.observe) return exitCode;
    return {
      schema: 'sec-dev-command-observation-v1',
      effectiveArgv: [
        command,
        ...applyDefaultFastTestConcurrency(
          command,
          args,
          DEFAULT_FAST_TEST_MAX_CONCURRENCY
        )
      ],
      terminal: { kind: 'exited', exitCode },
      observationIntegrity: { kind: 'complete' },
      durationMs: 1,
      stdoutTail: '',
      stderrTail: '',
      ...override
    } satisfies DevCommandObservation;
  }
}));

mock.module('../../platform/dev-runner/dependency-bootstrap.ts', () => ({
  ensureTestDependencies: async () => {
    testDependencyBootstrapCalls += 1;
    if (hasTestDependencyBootstrapFailure) throw testDependencyBootstrapFailure;
    return {
      browserCachePath: canonicalBrowserCachePath,
      manifestHash: 'test-manifest',
      nodeModulesPath: path.resolve('node_modules'),
      source: 'existing'
    };
  }
}));

const testRunnerModule = await import('../../platform/dev-runner/test-runner.ts');
const {
  resolveAffectedTestExecution,
  runAffectedTests,
  FAST_TEST_FAILURE_RECEIPT_PREFIX,
  scheduleBoundedFastTestInvocations,
  runFastTests,
  runSlowTests,
  runTests
} = testRunnerModule;
const { getFastTestFilesSync, slowTestSuiteFiles } = await import('../../platform/shared/test-budget-contract.ts');

function invocationTestFiles(args: readonly string[]): string[] {
  return args.filter((arg) => /^tests\/.+\.(test|spec)\.tsx?$/u.test(arg));
}

function plannedProcessFiles(plan: ReturnType<typeof planFastTestProcesses>): string[] {
  return [
    ...plan.concurrentShards.flat(),
    ...plan.resourceClassOrder.flatMap((resourceClass) => plan.resourceQueues[resourceClass])
  ];
}

type ProcessGlobalHazardKind =
  | 'mock-module'
  | 'process-env-assignment'
  | 'process-env-delete'
  | 'process-env-object-assign';

interface ProcessGlobalHazard {
  readonly kind: ProcessGlobalHazardKind;
  readonly line: number;
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function isNamedMember(
  expression: ts.Expression,
  receiverName: string,
  memberName: string
): boolean {
  const unwrapped = unwrapExpression(expression);
  if (ts.isPropertyAccessExpression(unwrapped)) {
    const receiver = unwrapExpression(unwrapped.expression);
    return ts.isIdentifier(receiver) &&
      receiver.text === receiverName &&
      unwrapped.name.text === memberName;
  }
  if (!ts.isElementAccessExpression(unwrapped) || !unwrapped.argumentExpression) return false;
  const receiver = unwrapExpression(unwrapped.expression);
  const member = unwrapExpression(unwrapped.argumentExpression);
  return ts.isIdentifier(receiver) &&
    receiver.text === receiverName &&
    (ts.isStringLiteralLike(member) || ts.isNoSubstitutionTemplateLiteral(member)) &&
    member.text === memberName;
}

function isProcessEnvExpression(expression: ts.Expression): boolean {
  return isNamedMember(expression, 'process', 'env');
}

function targetsProcessEnv(expression: ts.Expression): boolean {
  const unwrapped = unwrapExpression(expression);
  if (isProcessEnvExpression(unwrapped)) return true;
  if (ts.isPropertyAccessExpression(unwrapped) || ts.isElementAccessExpression(unwrapped)) {
    return targetsProcessEnv(unwrapped.expression);
  }
  return false;
}

function processGlobalHazards(source: string, fileName: string): ProcessGlobalHazard[] {
  const sourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  const hazards: ProcessGlobalHazard[] = [];
  const record = (kind: ProcessGlobalHazardKind, node: ts.Node): void => {
    hazards.push({
      kind,
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1
    });
  };
  const visit = (node: ts.Node): void => {
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
      targetsProcessEnv(node.left)
    ) {
      record('process-env-assignment', node);
    } else if (ts.isDeleteExpression(node) && targetsProcessEnv(node.expression)) {
      record('process-env-delete', node);
    } else if (ts.isCallExpression(node)) {
      if (isNamedMember(node.expression, 'mock', 'module')) {
        record('mock-module', node);
      } else if (
        isNamedMember(node.expression, 'Object', 'assign') &&
        node.arguments[0] !== undefined &&
        isProcessEnvExpression(node.arguments[0])
      ) {
        record('process-env-object-assign', node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return hazards;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => { resolve = settle; });
  return { promise, resolve };
}

function configureTestDependencyBootstrapFailure(value: unknown): void {
  hasTestDependencyBootstrapFailure = true;
  testDependencyBootstrapFailure = value;
}

beforeEach(() => {
  previousTestWorkspaceNamespace = process.env[TEST_WORKSPACE_NAMESPACE_ENV];
  previousAffectedTestsBase = process.env.SEC_AFFECTED_TESTS_BASE;
  previousChangedBase = process.env.SEC_CHANGED_BASE;
  delete process.env[TEST_WORKSPACE_NAMESPACE_ENV];
  delete process.env.SEC_AFFECTED_TESTS_BASE;
  delete process.env.SEC_CHANGED_BASE;
  commandCalls.length = 0;
  devCommandCalls.length = 0;
  devCommandEnvironments.length = 0;
  devCommandExitCodes.length = 0;
  devCommandFailures.length = 0;
  devCommandObservationOverrides.length = 0;
  devCommandSettlements.length = 0;
  devCommandStartObservers.length = 0;
  devCommandCompletionObservers.length = 0;
  testDependencyBootstrapCalls = 0;
  hasTestDependencyBootstrapFailure = false;
  testDependencyBootstrapFailure = undefined;
  cleanupFailure = null;
  changedFiles = ['platform/unmapped-source.ts'];
  materializeTestWorkspace = false;
  delete process.env.SEC_AFFECTED_TESTS_FULL_FAST_FALLBACK;
});

afterEach(() => {
  if (previousTestWorkspaceNamespace === undefined) {
    delete process.env[TEST_WORKSPACE_NAMESPACE_ENV];
  } else {
    process.env[TEST_WORKSPACE_NAMESPACE_ENV] = previousTestWorkspaceNamespace;
  }
  if (previousAffectedTestsBase === undefined) {
    delete process.env.SEC_AFFECTED_TESTS_BASE;
  } else {
    process.env.SEC_AFFECTED_TESTS_BASE = previousAffectedTestsBase;
  }
  if (previousChangedBase === undefined) {
    delete process.env.SEC_CHANGED_BASE;
  } else {
    process.env.SEC_CHANGED_BASE = previousChangedBase;
  }
});

afterAll(() => {
  mock.restore();
});

test('fast process planning deterministically bounds concurrent shards without duplicate or missing files', () => {
  const concurrentFiles = Array.from(
    { length: DEFAULT_FAST_TEST_PROCESS_SHARD_SIZE * 2 + 1 },
    (_, index) => `tests/unit/concurrent-${String(index).padStart(2, '0')}.test.ts`
  );
  const isolatedFiles = [
    'tests/unit/work-package-gate-execution.test.ts',
    'tests/integration/pipeline-kernel.test.ts',
    'tests/integration/pipeline-workspace-write-lease.test.ts'
  ];
  const files = [
    ...concurrentFiles.slice(0, 3),
    isolatedFiles[0],
    ...concurrentFiles.slice(3),
    ...isolatedFiles.slice(1)
  ];
  const plan = planFastTestProcesses(files);
  const plannedFiles = plannedProcessFiles(plan);

  expect(plan.concurrentShards.map((shard) => shard.length)).toEqual([
    DEFAULT_FAST_TEST_PROCESS_SHARD_SIZE,
    DEFAULT_FAST_TEST_PROCESS_SHARD_SIZE,
    1
  ]);
  expect(plan.resourceClassOrder).toEqual(FAST_TEST_PROCESS_RESOURCE_CLASS_ORDER);
  expect(plan.resourceQueues['independent-process']).toEqual(isolatedFiles.slice(1));
  expect(plan.resourceQueues['shared-host-runtime']).toEqual([]);
  expect(plan.resourceQueues['repository-worktree']).toEqual(isolatedFiles.slice(0, 1));
  expect(plan.resourceQueues['host-profile']).toEqual([]);
  expect(plan.resourceLimits).toEqual(DEFAULT_FAST_TEST_RESOURCE_CLASS_LIMITS);
  expect([...plannedFiles].sort()).toEqual([...files].sort());
  expect(new Set(plannedFiles).size).toBe(files.length);
  expect(planFastTestProcesses(files)).toEqual(plan);
  expect(planFastTestProcesses(concurrentFiles.slice(0, 2)).concurrentShards).toEqual([
    concurrentFiles.slice(0, 2)
  ]);
});

test('fast process planning removes stale isolation and bounds structural process waves', () => {
  const files = getFastTestFilesSync().filter(isDefaultFastTestFile);
  const plan = planFastTestProcesses(files);
  const registeredFiles = new Set(PROCESS_ISOLATED_FAST_TEST_FILES);
  const resourceClassByFile: ReadonlyMap<
    string,
    (typeof FAST_TEST_PROCESS_RESOURCE_CLASS_ORDER)[number]
  > = new Map(
    FAST_TEST_PROCESS_ISOLATION_REGISTRY.map(
      ({ file, resourceClass }) => [file, resourceClass] as const
    )
  );
  const plannedFiles = plannedProcessFiles(plan);
  const processWaves = Math.ceil(plan.concurrentShards.length / DEFAULT_CONCURRENT_FAST_SHARD_CONCURRENCY)
    + plan.resourceClassOrder.reduce((waves, resourceClass) => (
      waves + Math.ceil(
        plan.resourceQueues[resourceClass].length / plan.resourceLimits[resourceClass]
      )
    ), 0);
  const structurallyMaximumProcessWaves = plan.concurrentShards.length
    + plan.resourceClassOrder.reduce((waves, resourceClass) => (
      waves + plan.resourceQueues[resourceClass].length
    ), 0);

  expect([...registeredFiles]).toEqual(expect.arrayContaining([
    'tests/unit/command-runner.test.ts',
    'tests/unit/work-package-gate-execution.test.ts',
    'tests/unit/work-package-profile-census-repair.test.ts',
    'tests/unit/work-package-profile-probe-diagnostic.test.ts',
    'tests/integration/pipeline-kernel.test.ts',
    'tests/integration/pipeline-workspace-write-lease.test.ts',
    'tests/integration/semantic-mutation-apply.test.ts',
    'tests/integration/semantic-mutation-recovery-lifecycle.test.ts',
    'tests/integration/workbench-writer-lease.test.ts',
    'tests/integration/workspace-engineering-ir.test.ts'
  ]));
  expect([...registeredFiles]).not.toContain('tests/integration/overview.test.ts');
  expect([...registeredFiles]).not.toContain('tests/integration/semantic-core-vertical.test.ts');
  expect([...registeredFiles]).not.toContain('tests/integration/compiler-dependency-installation.test.ts');
  expect([...registeredFiles]).not.toContain('tests/integration/project-base.test.ts');
  expect([...registeredFiles]).not.toContain('tests/integration/project-dependency-runtime.test.ts');
  expect([...registeredFiles]).not.toContain('tests/unit/import-organizer-staged.test.ts');
  const unisolated = planFastTestProcesses(['tests/unit/import-organizer-staged.test.ts']);
  expect(unisolated.concurrentShards).toEqual([['tests/unit/import-organizer-staged.test.ts']]);
  for (const resourceClass of unisolated.resourceClassOrder) {
    expect(unisolated.resourceQueues[resourceClass]).toEqual([]);
  }
  for (const resourceClass of plan.resourceClassOrder) {
    expect(plan.resourceQueues[resourceClass]).toEqual(
      files.filter((file) => resourceClassByFile.get(file) === resourceClass)
    );
  }
  expect([...plannedFiles].sort()).toEqual([...files].sort());
  expect(new Set(plannedFiles).size).toBe(files.length);
  expect(DEFAULT_CONCURRENT_FAST_SHARD_CONCURRENCY).toBeGreaterThanOrEqual(1);
  expect(Object.values(plan.resourceLimits).every((limit) => limit >= 1)).toBe(true);
  expect(processWaves).toBeLessThanOrEqual(structurallyMaximumProcessWaves);
  expect(structurallyMaximumProcessWaves).toBeLessThanOrEqual(plannedFiles.length);
  expect(FAST_TEST_PROCESS_ISOLATION_REGISTRY.find(
    ({ file }) => file === 'tests/unit/work-package-gate-execution.test.ts'
  )?.processLimit).toBe(DEFAULT_FAST_TEST_RESOURCE_CLASS_LIMITS['repository-worktree']);
  expect(FAST_TEST_PROCESS_ISOLATION_REGISTRY.find(
    ({ file }) => file === 'tests/integration/workspace-engineering-ir.test.ts'
  )?.processLimit).toBe(DEFAULT_FAST_TEST_RESOURCE_CLASS_LIMITS['independent-process']);
});

test('fast process isolation AST recognizes executable global hazards without text false positives', () => {
  const hazards = processGlobalHazards(`
    // process.env.COMMENTED = 'not executable'; mock.module('commented', () => ({}));
    const text = "delete process.env.STRING_ONLY; Object.assign(process.env, { STRING_ONLY: '1' });";
    const observed = process.env.READ_ONLY;
    const copy = { ...process.env };
    process.env.ASSIGNED = '1';
    process.env.COALESCED ??= '2';
    delete process.env.DELETED;
    Object.assign(process.env, { ASSIGNED_OBJECT: '3' });
    mock.module('node:fs', () => ({}));
  `, 'tests/unit/process-global-hazard-sentinel.test.ts');

  expect(hazards.map(({ kind }) => kind)).toEqual([
    'process-env-assignment',
    'process-env-assignment',
    'process-env-delete',
    'process-env-object-assign',
    'mock-module'
  ]);
});

test('default fast process-global hazards have unique typed isolation and single-file queues', async () => {
  const newlyIsolatedFiles = [
    'tests/contract/document-control-plane-lifecycle.test.ts',
    'tests/contract/repository-audit.test.ts',
    'tests/unit/branch-lifecycle-temp-repo.test.ts',
    'tests/unit/verification-action-github-provider.test.ts',
    'tests/unit/verification-action-runner.test.ts',
    'tests/unit/verification-session-runtime.test.ts'
  ];
  const lockedHazardFiles = [
    ...newlyIsolatedFiles,
    'tests/unit/test-runner.test.ts',
    'tests/unit/command-runner.test.ts'
  ];
  const defaultFastFiles = getFastTestFilesSync().filter(isDefaultFastTestFile);
  const detectedHazards = new Map<string, ProcessGlobalHazard[]>();

  await Promise.all(defaultFastFiles.map(async (file) => {
    const hazards = processGlobalHazards(await fs.readFile(file, 'utf8'), file);
    if (hazards.length > 0) detectedHazards.set(file, hazards);
  }));

  expect([...detectedHazards.keys()]).toEqual(expect.arrayContaining(lockedHazardFiles));
  for (const [file, hazards] of detectedHazards) {
    expect(hazards.length).toBeGreaterThan(0);
    const entries = FAST_TEST_PROCESS_ISOLATION_REGISTRY.filter((entry) => entry.file === file);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      resourceClass: 'independent-process',
      processLimit: DEFAULT_FAST_TEST_RESOURCE_CLASS_LIMITS['independent-process']
    });
  }
  for (const file of newlyIsolatedFiles) {
    expect(FAST_TEST_PROCESS_ISOLATION_REGISTRY.filter((entry) => entry.file === file)).toEqual([
      expect.objectContaining({
        reason: 'process-global-environment',
        resourceClass: 'independent-process'
      })
    ]);
  }
  for (const file of ['tests/unit/test-runner.test.ts', 'tests/unit/command-runner.test.ts']) {
    expect(FAST_TEST_PROCESS_ISOLATION_REGISTRY.filter((entry) => entry.file === file)).toEqual([
      expect.objectContaining({
        reason: 'process-global-mocks',
        resourceClass: 'independent-process'
      })
    ]);
  }

  const plan = planFastTestProcesses(newlyIsolatedFiles);
  expect(plan.concurrentShards).toEqual([]);
  expect(plan.resourceQueues['independent-process']).toEqual(newlyIsolatedFiles);
  for (const resourceClass of plan.resourceClassOrder.filter(
    (resourceClass) => resourceClass !== 'independent-process'
  )) {
    expect(plan.resourceQueues[resourceClass]).toEqual([]);
  }
});

test('fast process resource classes uniquely derive limits and isolate production runtime owners', () => {
  for (const entry of FAST_TEST_PROCESS_ISOLATION_REGISTRY) {
    expect(entry.processLimit).toBe(DEFAULT_FAST_TEST_RESOURCE_CLASS_LIMITS[entry.resourceClass]);
  }

  const productionHostAndRuntimeLifecycleFiles = [
    'tests/integration/semantic-mutation-apply.test.ts',
    'tests/unit/windows-appcontainer-executor.test.ts',
    'tests/unit/windows-appcontainer-host-tool-lifecycle.test.ts'
  ];
  for (const file of productionHostAndRuntimeLifecycleFiles) {
    expect(FAST_TEST_PROCESS_ISOLATION_REGISTRY.find(
      (entry) => entry.file === file
    )).toMatchObject({
      reason: 'production-host-and-runtime-lifecycle',
      resourceClass: 'shared-host-runtime',
      processLimit: DEFAULT_FAST_TEST_RESOURCE_CLASS_LIMITS['shared-host-runtime']
    });
  }
  expect(FAST_TEST_PROCESS_ISOLATION_REGISTRY.find(
    ({ file }) => file === 'tests/integration/semantic-mutation-recovery-lifecycle.test.ts'
  )).toMatchObject({
    resourceClass: 'independent-process',
    processLimit: DEFAULT_FAST_TEST_RESOURCE_CLASS_LIMITS['independent-process']
  });
  const resourcePlan = planFastTestProcesses([
    'tests/integration/semantic-mutation-recovery-lifecycle.test.ts',
    ...productionHostAndRuntimeLifecycleFiles,
    'tests/unit/work-package-gate-execution.test.ts',
    'tests/unit/work-package-profile-probe-diagnostic.test.ts'
  ]);
  expect(resourcePlan.concurrentShards).toEqual([]);
  expect(resourcePlan.resourceClassOrder).toEqual([
    'independent-process',
    'shared-host-runtime',
    'repository-worktree',
    'host-profile'
  ]);
  expect(resourcePlan.resourceQueues).toEqual({
    'independent-process': [
      'tests/integration/semantic-mutation-recovery-lifecycle.test.ts'
    ],
    'shared-host-runtime': productionHostAndRuntimeLifecycleFiles,
    'repository-worktree': ['tests/unit/work-package-gate-execution.test.ts'],
    'host-profile': ['tests/unit/work-package-profile-probe-diagnostic.test.ts']
  });
  expect(resourcePlan.resourceLimits).toEqual(DEFAULT_FAST_TEST_RESOURCE_CLASS_LIMITS);
});

test('fast tests use one bounded default timeout policy', () => {
  expect(DEFAULT_FAST_TEST_TIMEOUT_MS).toBe(180_000);
});

test('default fast inventory excludes deterministic deep acceptance while complete inventory retains it', () => {
  const complete = getFastTestFilesSync();
  const defaultFiles = complete.filter(isDefaultFastTestFile);

  expect(DEFAULT_FAST_TEST_EXCLUDED_FILES).toEqual(expect.arrayContaining([
    'tests/integration/semantic-mutation-apply.test.ts',
    'tests/integration/upgrade-pipeline-kernel.test.ts',
    'tests/integration/workbench-pipeline.test.ts',
    'tests/unit/semantic-mutation-isolated-child-fence.test.ts',
    'tests/unit/work-package-gate-execution.test.ts'
  ]));
  expect(DEFAULT_FAST_TEST_EXCLUDED_FILES.every((file) => complete.includes(file))).toBe(true);
  expect(defaultFiles.every(isDefaultFastTestFile)).toBe(true);
  expect(defaultFiles.length).toBe(complete.length - DEFAULT_FAST_TEST_EXCLUDED_FILES.length);
});

// 这些测试使用全局 mock，必须串行执行以避免并发干扰
test.serial('targeted concurrent-safe fast tests run only the requested files', async () => {
  const code = await runFastTests(['tests/unit/path-containment.test.ts']);

  expect(code).toBe(0);
  expect(testDependencyBootstrapCalls).toBe(1);
  expect(devCommandEnvironments).toHaveLength(1);
  expect(devCommandEnvironments[0]?.PLAYWRIGHT_BROWSERS_PATH).toBe(canonicalBrowserCachePath);
  expect(devCommandEnvironments[0]?.SEC_SKIP_RUNTIME_DEPS_SETUP).toBe('1');
  expect(devCommandEnvironments[0]?.SEC_TEST_WORKSPACE_NAMESPACE).toMatch(/^fast-\d+-[a-z0-9]+-\d+$/u);
  expect(devCommandCalls).toEqual([
    {
      command: 'bun',
      args: [
        'test',
        '--concurrent',
        'tests/unit/path-containment.test.ts',
        '--timeout',
        String(DEFAULT_FAST_TEST_TIMEOUT_MS)
      ]
    }
  ]);
});

test.serial('one pre-fanout bootstrap overwrites poisoned browser state for every managed child', async () => {
  const previousBrowserCachePath = process.env.PLAYWRIGHT_BROWSERS_PATH;
  process.env.PLAYWRIGHT_BROWSERS_PATH = 'poisoned-browser-cache';
  try {
    const code = await runFastTests([
      'tests/unit/path-containment.test.ts',
      'tests/unit/test-runner.test.ts'
    ]);

    expect(code).toBe(0);
    expect(testDependencyBootstrapCalls).toBe(1);
    expect(devCommandCalls).toHaveLength(2);
    expect(devCommandEnvironments).toHaveLength(2);
    expect(devCommandEnvironments.every((env) =>
      env.PLAYWRIGHT_BROWSERS_PATH === canonicalBrowserCachePath &&
      env.SEC_SKIP_RUNTIME_DEPS_SETUP === '1')).toBe(true);
  } finally {
    if (previousBrowserCachePath === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH;
    else process.env.PLAYWRIGHT_BROWSERS_PATH = previousBrowserCachePath;
  }
});

test.serial('bootstrap failure launches no managed test child', async () => {
  configureTestDependencyBootstrapFailure(new Error('browser bootstrap failed'));

  await expect(runFastTests(['tests/unit/path-containment.test.ts']))
    .rejects.toThrow('browser bootstrap failed');
  expect(testDependencyBootstrapCalls).toBe(1);
  expect(devCommandCalls).toEqual([]);
  expect(devCommandEnvironments).toEqual([]);
});

test.serial('fast tests preserve options across concurrent and serial invocations', async () => {
  const code = await runFastTests(['--timeout', '30000']);
  const defaultFastTestFiles = getFastTestFilesSync().filter(isDefaultFastTestFile);

  expect(code).toBe(0);
  const concurrentCalls = devCommandCalls.filter(({ args }) => args.includes('--concurrent'));
  expect(concurrentCalls.length).toBeGreaterThan(1);
  for (const call of concurrentCalls) {
    expect(call.command).toBe('bun');
    expect(call.args.slice(0, 2)).toEqual(['test', '--concurrent']);
    expect(invocationTestFiles(call.args).length).toBeLessThanOrEqual(DEFAULT_FAST_TEST_PROCESS_SHARD_SIZE);
    expect(call.args.slice(-2)).toEqual(['--timeout', '30000']);
    expect(call.args.some((arg) => isolatedFastTestFileSet.has(arg))).toBe(false);
    expect(call.args.some((arg) => arg.startsWith('tests/e2e/'))).toBe(false);
  }
  for (const file of PROCESS_ISOLATED_FAST_TEST_FILES.filter(isDefaultFastTestFile)) {
    expect(devCommandCalls).toContainEqual({
      command: 'bun',
      args: ['test', file, '--timeout', '30000']
    });
  }
  const invokedFiles = devCommandCalls.flatMap(({ args }) => invocationTestFiles(args));
  expect([...invokedFiles].sort()).toEqual(defaultFastTestFiles);
  expect(DEFAULT_FAST_TEST_EXCLUDED_FILES.some((file) => invokedFiles.includes(file))).toBe(false);
  expect(new Set(invokedFiles).size).toBe(invokedFiles.length);
  expect(new Set(devCommandEnvironments.map(
    (env) => env.SEC_TEST_WORKSPACE_NAMESPACE
  )).size).toBe(1);
});

test.serial('fast tests preserve equals-form timeout overrides without adding the default', async () => {
  const code = await runFastTests([
    'tests/unit/path-containment.test.ts',
    '--timeout=45000'
  ]);

  expect(code).toBe(0);
  expect(devCommandCalls).toEqual([{
    command: 'bun',
    args: ['test', '--concurrent', 'tests/unit/path-containment.test.ts', '--timeout=45000']
  }]);
});

test.serial('explicit inner concurrency is byte-preserved while managed outer concurrency adapts', async () => {
  const selectedFiles = getFastTestFilesSync()
    .filter((file) => !isolatedFastTestFileSet.has(file))
    .slice(0, DEFAULT_FAST_TEST_PROCESS_SHARD_SIZE + 1);
  const explicit = String(DEFAULT_FAST_TEST_CONCURRENCY_BUDGET.globalBudget);
  devCommandExitCodes.push(7, 0);
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (message?: unknown) => { errors.push(String(message)); };

  try {
    const code = await runFastTests([
      ...selectedFiles,
      '--max-concurrency',
      explicit
    ]);

    expect(code).toBe(7);
    expect(devCommandCalls).toHaveLength(1);
    const explicitIndex = devCommandCalls[0].args.indexOf('--max-concurrency');
    expect(explicitIndex).toBeGreaterThanOrEqual(0);
    expect(devCommandCalls[0].args.slice(explicitIndex, explicitIndex + 2))
      .toEqual(['--max-concurrency', explicit]);
    expect(errors.filter((message) => message.startsWith(FAST_TEST_FAILURE_RECEIPT_PREFIX)))
      .toHaveLength(1);
  } finally {
    console.error = originalError;
  }
});

test.serial('managed fast tests reject over-budget explicit concurrency before spawning', async () => {
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (message?: unknown) => { errors.push(String(message)); };
  const impossible = DEFAULT_FAST_TEST_CONCURRENCY_BUDGET.globalBudget + 1;

  try {
    const code = await runFastTests([
      'tests/unit/path-containment.test.ts',
      `--max-concurrency=${impossible}`
    ]);

    expect(code).toBe(1);
    expect(devCommandCalls).toEqual([]);
    expect(errors).toContain(
      `Bun --max-concurrency ${impossible} exceeds the managed fast-test global budget `
      + `${DEFAULT_FAST_TEST_CONCURRENCY_BUDGET.globalBudget}.`
    );
  } finally {
    console.error = originalError;
  }
});

test.serial('passing managed execution emits no failure receipt', async () => {
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (message?: unknown) => { errors.push(String(message)); };

  try {
    expect(await runFastTests(['tests/unit/path-containment.test.ts'])).toBe(0);
    expect(errors.some((message) => message.startsWith(FAST_TEST_FAILURE_RECEIPT_PREFIX)))
      .toBe(false);
  } finally {
    console.error = originalError;
  }
});

test.serial('bounded concurrent shard failures settle siblings and stop later batches', async () => {
  const failingBatchOffset = Math.min(1, DEFAULT_CONCURRENT_FAST_SHARD_CONCURRENCY - 1);
  const selectedFiles = getFastTestFilesSync()
    .filter((file) => !isolatedFastTestFileSet.has(file))
    .slice(0, DEFAULT_FAST_TEST_PROCESS_SHARD_SIZE * DEFAULT_CONCURRENT_FAST_SHARD_CONCURRENCY + 1);
  expect(selectedFiles).toHaveLength(
    DEFAULT_FAST_TEST_PROCESS_SHARD_SIZE * DEFAULT_CONCURRENT_FAST_SHARD_CONCURRENCY + 1
  );
  devCommandExitCodes.push(
    ...Array.from(
      { length: DEFAULT_CONCURRENT_FAST_SHARD_CONCURRENCY },
      (_, index) => index === failingBatchOffset ? 7 : 0
    ),
    0
  );

  const code = await runFastTests(selectedFiles);

  expect(code).toBe(7);
  expect(devCommandCalls).toHaveLength(DEFAULT_CONCURRENT_FAST_SHARD_CONCURRENCY);
  expect(devCommandCalls.every(({ args }) => args.includes('--concurrent'))).toBe(true);
  expect(devCommandCalls.flatMap(({ args }) => invocationTestFiles(args))).toEqual(
    selectedFiles.slice(
      0,
      DEFAULT_FAST_TEST_PROCESS_SHARD_SIZE * DEFAULT_CONCURRENT_FAST_SHARD_CONCURRENCY
    )
  );
});

test.serial('failed explicit resource batch settles started siblings then emits one bounded plan-order receipt', async () => {
  const independentFiles = [
    'tests/integration/pipeline-kernel.test.ts',
    'tests/integration/ticket-pipeline.test.ts'
  ];
  const expectedFirstBatchSize = Math.min(
    DEFAULT_FAST_TEST_RESOURCE_CLASS_LIMITS['independent-process'],
    independentFiles.length
  );
  const siblingCanStart = expectedFirstBatchSize > 1;
  const siblingSettlement = deferred();
  const siblingStarted = deferred();

  devCommandExitCodes.push(7, 9);
  devCommandObservationOverrides.push(
    { stdoutTail: 'a'.repeat(4096), stderrTail: 'first failure' },
    { stdoutTail: 'second failure', stderrTail: 'b'.repeat(4096) }
  );
  if (siblingCanStart) {
    devCommandSettlements.push(undefined, siblingSettlement.promise);
    devCommandStartObservers.push(undefined, siblingStarted.resolve);
  }
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (message?: unknown) => { errors.push(String(message)); };

  try {
    const run = runFastTests(independentFiles);
    if (siblingCanStart) {
      await siblingStarted.promise;
      expect(errors.filter((message) => message.startsWith(FAST_TEST_FAILURE_RECEIPT_PREFIX)))
        .toEqual([]);
      siblingSettlement.resolve();
    }

    expect(await run).toBe(7);
    expect(devCommandCalls).toHaveLength(expectedFirstBatchSize);
    const receipts = errors.filter((message) => message.startsWith(FAST_TEST_FAILURE_RECEIPT_PREFIX));
    expect(receipts).toHaveLength(1);
    const receipt = JSON.parse(receipts[0].slice(FAST_TEST_FAILURE_RECEIPT_PREFIX.length)) as {
      queue: string;
      batchIndex: number;
      failures: Array<{
        invocationId: string;
        stdoutTail: string;
        stderrTail: string;
      }>;
    };
    expect(receipt.queue).toBe('independent-process');
    expect(receipt.batchIndex).toBe(0);
    expect(receipt.failures.map(({ invocationId }) => invocationId)).toEqual(
      Array.from(
        { length: expectedFirstBatchSize },
        (_, index) => `independent-process:${String(index + 1).padStart(3, '0')}`
      )
    );
    for (const failure of receipt.failures) {
      expect(Buffer.byteLength(failure.stdoutTail)).toBeLessThanOrEqual(2 * 1024);
      expect(Buffer.byteLength(failure.stderrTail)).toBeLessThanOrEqual(2 * 1024);
    }
  } finally {
    siblingSettlement.resolve();
    console.error = originalError;
  }
});

test.serial('failure receipt normalizes lone surrogates within final serialized tail caps', async () => {
  devCommandExitCodes.push(7);
  devCommandObservationOverrides.push({
    stdoutTail: '\ud800'.repeat(4096),
    stderrTail: '\udc00'.repeat(4096)
  });
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (message?: unknown) => { errors.push(String(message)); };

  try {
    expect(await runFastTests(['tests/unit/path-containment.test.ts'])).toBe(7);

    const receipts = errors.filter((message) => message.startsWith(FAST_TEST_FAILURE_RECEIPT_PREFIX));
    expect(receipts).toHaveLength(1);
    const receipt = JSON.parse(receipts[0].slice(FAST_TEST_FAILURE_RECEIPT_PREFIX.length)) as {
      failures: Array<{ stdoutTail: string; stderrTail: string }>;
    };
    for (const field of [receipt.failures[0].stdoutTail, receipt.failures[0].stderrTail]) {
      expect(Buffer.byteLength(field, 'utf8')).toBeLessThanOrEqual(2 * 1024);
      expect(field.length).toBeGreaterThan(0);
      expect([...field].every((character) => character === '�')).toBe(true);
    }
  } finally {
    console.error = originalError;
  }
});

test.serial('bounded executor mechanism is deterministic at limits 1, 2, 3, 4, and above 4', async () => {
  for (const limit of [1, 2, 3, 4, 7]) {
    const invocations = Array.from({ length: limit * 2 + 1 }, (_, index) => ({
      id: `independent-process:limit-${limit}-${String(index + 1).padStart(3, '0')}`,
      queue: 'independent-process' as const,
      args: ['test', `tests/unit/bounded-${limit}-${index + 1}.test.ts`]
    }));
    const invocationIndexes = new Map(invocations.map((invocation, index) => [invocation.id, index]));
    const startedCounts = invocations.map(() => 0);
    const settlements = Array.from({ length: limit * 2 }, () => deferred());
    const completions = Array.from({ length: limit * 2 }, () => deferred());
    const firstBatchStarted = deferred();
    const secondBatchStarted = deferred();
    const completionOrder: number[] = [];
    const exitCodes = Array.from({ length: limit * 2 }, (_, index) => (
      index < limit
        ? 0
        : index === limit
          ? 7
          : index === limit * 2 - 1
            ? 9
            : 0
    ));
    let active = 0;
    let peak = 0;
    let started = 0;

    const run = scheduleBoundedFastTestInvocations(
      invocations,
      limit,
      async (invocation) => {
        const index = invocationIndexes.get(invocation.id)!;
        startedCounts[index] += 1;
        started += 1;
        active += 1;
        peak = Math.max(peak, active);
        if (started === limit) firstBatchStarted.resolve();
        if (started === limit * 2) secondBatchStarted.resolve();
        await settlements[index]!.promise;
        active -= 1;
        completionOrder.push(index);
        completions[index]!.resolve();
        return { exitCode: exitCodes[index]! };
      },
      ({ exitCode }) => exitCode !== 0
    );
    await firstBatchStarted.promise;
    expect(started).toBe(limit);

    for (let index = limit - 1; index >= 0; index -= 1) {
      if (index === 0) expect(started).toBe(limit);
      settlements[index]!.resolve();
      await completions[index]!.promise;
    }

    await secondBatchStarted.promise;
    expect(started).toBe(limit * 2);

    for (let index = limit * 2 - 1; index >= limit; index -= 1) {
      settlements[index]!.resolve();
      await completions[index]!.promise;
    }

    const failedBatch = await run;
    expect(failedBatch).not.toBeNull();
    if (!failedBatch) throw new Error('Expected the second scheduler batch to fail.');
    expect(failedBatch.batchIndex).toBe(1);
    expect(active).toBe(0);
    expect(peak).toBe(limit);
    expect(startedCounts.slice(0, limit * 2)).toEqual(
      Array.from({ length: limit * 2 }, () => 1)
    );
    expect(startedCounts[limit * 2]).toBe(0);
    expect(completionOrder).toEqual([
      ...Array.from({ length: limit }, (_, index) => limit - index - 1),
      ...Array.from({ length: limit }, (_, index) => limit * 2 - index - 1)
    ]);
    expect(failedBatch.invocations.map(({ id }) => id)).toEqual(
      invocations.slice(limit, limit * 2).map(({ id }) => id)
    );
    expect(failedBatch.outcomes.flatMap((outcome, outcomeIndex) => (
      outcome.status === 'fulfilled' && outcome.value.exitCode !== 0
        ? [failedBatch.invocations[outcomeIndex]!.id]
        : []
    ))).toEqual(
      limit === 1
        ? [invocations[limit]!.id]
        : [invocations[limit]!.id, invocations[limit * 2 - 1]!.id]
    );
  }
});

test.serial('pure bounded scheduler settles synchronous dispatch rejection with every started sibling', async () => {
  const invocations = [
    { id: 'independent-process:001', queue: 'independent-process' as const, args: ['first'] },
    { id: 'independent-process:002', queue: 'independent-process' as const, args: ['second'] }
  ];
  const started: string[] = [];

  const failedBatch = await scheduleBoundedFastTestInvocations(
    invocations,
    2,
    (invocation) => {
      started.push(invocation.id);
      if (invocation === invocations[0]) throw new Error('synchronous dispatch sentinel');
      return Promise.resolve(0);
    },
    (exitCode) => exitCode !== 0
  );

  expect(started).toEqual(invocations.map(({ id }) => id));
  expect(failedBatch?.batchIndex).toBe(0);
  expect(failedBatch?.outcomes.map(({ status }) => status)).toEqual(['rejected', 'fulfilled']);
});

test.serial('observed failure receipt bounds terminal, integrity, argv, and UTF-8 tails', async () => {
  const longText = '🙂界'.repeat(700);
  const longArg = `--test-name-pattern=${longText}argv sentinel`;
  devCommandExitCodes.push(7);
  devCommandObservationOverrides.push({
    terminal: { kind: 'spawn-failed', error: `${longText}spawn failure sentinel` },
    observationIntegrity: {
      kind: 'failed',
      error: `${longText}integrity failure sentinel`
    },
    stdoutTail: `${longText}stdout sentinel`,
    stderrTail: `${longText}stderr sentinel`
  });
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (message?: unknown) => { errors.push(String(message)); };

  try {
    expect(await runFastTests([
      'tests/integration/pipeline-kernel.test.ts',
      longArg
    ])).toBe(1);

    const receipts = errors.filter((message) => message.startsWith(FAST_TEST_FAILURE_RECEIPT_PREFIX));
    expect(receipts).toHaveLength(1);
    const receipt = JSON.parse(receipts[0].slice(FAST_TEST_FAILURE_RECEIPT_PREFIX.length)) as {
      failures: Array<{
        kind: string;
        terminal: { kind: string; error?: string };
        observationIntegrity: { kind: string; error?: string };
        effectiveArgv: string[];
        effectiveArgvTruncated: boolean;
        stdoutTail: string;
        stderrTail: string;
      }>;
    };
    expect(receipt.failures).toHaveLength(1);
    const failure = receipt.failures[0]!;
    expect(failure.kind).toBe('observed-command-failure');
    expect(failure.terminal.kind).toBe('spawn-failed');
    expect(failure.observationIntegrity.kind).toBe('failed');
    expect(failure.effectiveArgvTruncated).toBe(true);
    expect(failure.effectiveArgv.some((arg) => arg.endsWith('argv sentinel'))).toBe(true);
    for (const arg of failure.effectiveArgv) {
      expect(Buffer.byteLength(arg, 'utf8')).toBeLessThanOrEqual(512);
      expect(arg).not.toContain('�');
    }
    expect(Buffer.byteLength(failure.stdoutTail, 'utf8')).toBeLessThanOrEqual(2 * 1024);
    expect(Buffer.byteLength(failure.stderrTail, 'utf8')).toBeLessThanOrEqual(2 * 1024);
    expect(Buffer.byteLength(failure.terminal.error ?? '', 'utf8')).toBeLessThanOrEqual(1024);
    expect(Buffer.byteLength(failure.observationIntegrity.error ?? '', 'utf8'))
      .toBeLessThanOrEqual(1024);
    expect(failure.stdoutTail.endsWith('sentinel')).toBe(true);
    expect(failure.stderrTail.endsWith('sentinel')).toBe(true);
    expect(failure.terminal.error).not.toContain('�');
    expect(failure.observationIntegrity.error).not.toContain('�');
  } finally {
    console.error = originalError;
  }
});

test.serial('observer rejection receipt bounds planned argv and UTF-8 error', async () => {
  const longText = '🙂界'.repeat(700);
  const longArg = `--test-name-pattern=${longText}argv sentinel`;
  devCommandFailures.push(new Error(`${longText}observer rejection sentinel`));
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (message?: unknown) => { errors.push(String(message)); };

  try {
    expect(await runFastTests([
      'tests/integration/pipeline-kernel.test.ts',
      longArg
    ])).toBe(1);

    const receipts = errors.filter((message) => message.startsWith(FAST_TEST_FAILURE_RECEIPT_PREFIX));
    expect(receipts).toHaveLength(1);
    const receipt = JSON.parse(receipts[0].slice(FAST_TEST_FAILURE_RECEIPT_PREFIX.length)) as {
      failures: Array<{
        kind: string;
        plannedArgv: string[];
        plannedArgvTruncated: boolean;
        error: string;
        effectiveArgv?: string[];
      }>;
    };
    expect(receipt.failures).toHaveLength(1);
    const failure = receipt.failures[0]!;
    expect(failure.kind).toBe('observer-rejected');
    expect(failure).not.toHaveProperty('effectiveArgv');
    expect(failure.plannedArgv[0]).toBe('bun');
    expect(failure.plannedArgvTruncated).toBe(true);
    expect(failure.plannedArgv.some((arg) => arg.endsWith('argv sentinel'))).toBe(true);
    for (const arg of failure.plannedArgv) {
      expect(Buffer.byteLength(arg, 'utf8')).toBeLessThanOrEqual(512);
      expect(arg).not.toContain('�');
    }
    expect(Buffer.byteLength(failure.error, 'utf8')).toBeLessThanOrEqual(1024);
    expect(failure.error.endsWith('observer rejection sentinel')).toBe(true);
    expect(failure.error).not.toContain('�');
  } finally {
    console.error = originalError;
  }
});

test.serial('runFastTests preserves unresolved terminal and failed observation integrity composition', async () => {
  const independentCandidates = [
    'tests/integration/pipeline-kernel.test.ts',
    'tests/integration/pipeline-workspace-write-lease.test.ts'
  ];
  const independentFiles = getFastTestFilesSync().filter(
    (file) => independentCandidates.includes(file)
  );
  expect(independentFiles).toHaveLength(2);
  const laterClassFile = 'tests/integration/workbench-writer-lease.test.ts';
  const expectedFirstBatchSize = Math.min(
    DEFAULT_FAST_TEST_RESOURCE_CLASS_LIMITS['independent-process'],
    independentFiles.length
  );
  const siblingCanStart = expectedFirstBatchSize > 1;
  const siblingSettlement = deferred();
  const siblingStarted = deferred();

  devCommandObservationOverrides.push({
    terminal: { kind: 'unresolved', reason: 'close-without-status' },
    observationIntegrity: {
      kind: 'failed',
      error: 'observation integrity sentinel'
    }
  });
  if (siblingCanStart) {
    devCommandObservationOverrides.push(undefined);
    devCommandSettlements.push(undefined, siblingSettlement.promise);
    devCommandStartObservers.push(undefined, siblingStarted.resolve);
  }

  const errors: string[] = [];
  const originalError = console.error;
  console.error = (message?: unknown) => { errors.push(String(message)); };

  try {
    const run = runFastTests([
      ...independentFiles,
      laterClassFile
    ]);
    if (siblingCanStart) {
      await siblingStarted.promise;
      expect(errors.filter((message) => message.startsWith(FAST_TEST_FAILURE_RECEIPT_PREFIX)))
        .toEqual([]);
      siblingSettlement.resolve();
    }

    expect(await run).toBe(1);
    const receipts = errors.filter((message) => message.startsWith(FAST_TEST_FAILURE_RECEIPT_PREFIX));
    expect(receipts).toHaveLength(1);
    const receipt = JSON.parse(receipts[0].slice(FAST_TEST_FAILURE_RECEIPT_PREFIX.length)) as {
      failures: Array<{
        terminal: { kind: string; reason?: string };
        observationIntegrity: { kind: string; error?: string };
      }>;
    };
    expect(receipt.failures).toHaveLength(1);
    expect(receipt.failures[0].terminal).toEqual({
      kind: 'unresolved',
      reason: 'close-without-status'
    });
    expect(receipt.failures[0].observationIntegrity).toEqual({
      kind: 'failed',
      error: 'observation integrity sentinel'
    });
    expect(devCommandCalls.some(({ args }) => args.includes(laterClassFile))).toBe(false);
    expect(devCommandCalls).toHaveLength(expectedFirstBatchSize);
  } finally {
    siblingSettlement.resolve();
    console.error = originalError;
  }
});

test.serial('each resource class obeys its own bounded batches and deterministic class order', async () => {
  const availableFiles = new Set(getFastTestFilesSync());
  const filesByClass = Object.fromEntries(FAST_TEST_PROCESS_RESOURCE_CLASS_ORDER.map(
    (resourceClass) => {
      const requiredCount = resourceClass === 'host-profile'
        ? 1
        : DEFAULT_FAST_TEST_RESOURCE_CLASS_LIMITS[resourceClass] + 1;
      return [
        resourceClass,
        FAST_TEST_PROCESS_ISOLATION_REGISTRY
          .filter((entry) => (
            entry.resourceClass === resourceClass && availableFiles.has(entry.file)
          ))
          .map(({ file }) => file)
          .slice(0, requiredCount)
      ];
    }
  )) as Record<typeof FAST_TEST_PROCESS_RESOURCE_CLASS_ORDER[number], string[]>;

  for (const resourceClass of FAST_TEST_PROCESS_RESOURCE_CLASS_ORDER) {
    const expectedCount = resourceClass === 'host-profile'
      ? 1
      : DEFAULT_FAST_TEST_RESOURCE_CLASS_LIMITS[resourceClass] + 1;
    expect(filesByClass[resourceClass]).toHaveLength(expectedCount);
  }

  const waves: Array<{
    resourceClass: typeof FAST_TEST_PROCESS_RESOURCE_CLASS_ORDER[number];
    size: number;
    started: ReturnType<typeof deferred>;
    settlement: ReturnType<typeof deferred>;
  }> = [];
  for (const resourceClass of FAST_TEST_PROCESS_RESOURCE_CLASS_ORDER) {
    const files = filesByClass[resourceClass];
    const limit = DEFAULT_FAST_TEST_RESOURCE_CLASS_LIMITS[resourceClass];
    for (let index = 0; index < files.length; index += limit) {
      const size = Math.min(limit, files.length - index);
      const started = deferred();
      const settlement = deferred();
      waves.push({ resourceClass, size, started, settlement });
      for (let offset = 0; offset < size; offset += 1) {
        devCommandSettlements.push(settlement.promise);
        devCommandStartObservers.push(
          offset === size - 1 ? started.resolve : undefined
        );
      }
    }
  }

  const selectedFiles = FAST_TEST_PROCESS_RESOURCE_CLASS_ORDER.flatMap(
    (resourceClass) => filesByClass[resourceClass]
  );
  const run = runFastTests(selectedFiles);
  let cumulativeStarts = 0;
  const observedWaveClasses: string[] = [];
  try {
    for (const wave of waves) {
      await wave.started.promise;
      cumulativeStarts += wave.size;
      expect(devCommandCalls).toHaveLength(cumulativeStarts);
      expect(wave.size).toBeLessThanOrEqual(
        DEFAULT_FAST_TEST_RESOURCE_CLASS_LIMITS[wave.resourceClass]
      );
      const waveCalls = devCommandCalls.slice(cumulativeStarts - wave.size, cumulativeStarts);
      for (const call of waveCalls) {
        const [file] = invocationTestFiles(call.args);
        const resourceClass = FAST_TEST_PROCESS_ISOLATION_REGISTRY.find(
          (entry) => entry.file === file
        )?.resourceClass;
        expect(resourceClass).toBe(wave.resourceClass);
        observedWaveClasses.push(resourceClass!);
      }
      wave.settlement.resolve();
    }

    expect(await run).toBe(0);
    expect(observedWaveClasses).toEqual(FAST_TEST_PROCESS_RESOURCE_CLASS_ORDER.flatMap(
      (resourceClass) => filesByClass[resourceClass].map(() => resourceClass)
    ));
    expect(DEFAULT_FAST_TEST_RESOURCE_CLASS_LIMITS['host-profile']).toBe(1);
  } finally {
    for (const wave of waves) wave.settlement.resolve();
  }
});

test.serial('resource-class failure stops every later class', async () => {
  devCommandExitCodes.push(7, 0, 0, 0);
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (message?: unknown) => { errors.push(String(message)); };

  try {
    const code = await runFastTests([
      'tests/integration/pipeline-kernel.test.ts',
      'tests/integration/workbench-writer-lease.test.ts',
      'tests/unit/work-package-gate-execution.test.ts',
      'tests/unit/work-package-profile-probe-diagnostic.test.ts'
    ]);

    expect(code).toBe(7);
    expect(devCommandCalls).toHaveLength(1);
    expect(invocationTestFiles(devCommandCalls[0].args)).toEqual([
      'tests/integration/pipeline-kernel.test.ts'
    ]);
    const receipt = errors.find((message) => message.startsWith(FAST_TEST_FAILURE_RECEIPT_PREFIX));
    expect(receipt).toContain('"queue":"independent-process"');
  } finally {
    console.error = originalError;
  }
});

test.serial('temp-root runtime tests run before deterministic resource-class owners', async () => {
  const code = await runFastTests([
    'tests/integration/project-dependency-runtime.test.ts',
    'tests/integration/pipeline-kernel.test.ts',
    'tests/integration/ticket-pipeline.test.ts',
    'tests/integration/workbench-writer-lease.test.ts'
  ]);

  expect(code).toBe(0);
  expect(devCommandCalls).toEqual([
    {
      command: 'bun',
      args: [
        'test',
        '--concurrent',
        'tests/integration/project-dependency-runtime.test.ts',
        '--timeout',
        String(DEFAULT_FAST_TEST_TIMEOUT_MS)
      ]
    },
    {
      command: 'bun',
      args: ['test', 'tests/integration/pipeline-kernel.test.ts', '--timeout', String(DEFAULT_FAST_TEST_TIMEOUT_MS)]
    },
    {
      command: 'bun',
      args: ['test', 'tests/integration/ticket-pipeline.test.ts', '--timeout', String(DEFAULT_FAST_TEST_TIMEOUT_MS)]
    },
    {
      command: 'bun',
      args: [
        'test',
        'tests/integration/workbench-writer-lease.test.ts',
        '--timeout',
        String(DEFAULT_FAST_TEST_TIMEOUT_MS)
      ]
    }
  ]);
});

test.serial('full test planning retains every default-excluded fast owner', async () => {
  const code = await runTests();

  expect(code).toBe(0);
  const invokedFiles = devCommandCalls.flatMap(({ args }) => invocationTestFiles(args));
  expect(invokedFiles).toEqual(expect.arrayContaining(DEFAULT_FAST_TEST_EXCLUDED_FILES));
});

test.serial('failed fast children leave no run-owned workspace residue', async () => {
  materializeTestWorkspace = true;
  devCommandExitCodes.push(7);

  const code = await runFastTests(['tests/unit/path-containment.test.ts']);
  const workspaceEnv = devCommandEnvironments[0]!;

  expect(code).toBe(7);
  expect(workspaceEnv.SEC_TEST_WORKSPACE_NAMESPACE).toMatch(/^fast-/u);
  await expect(fs.access(getTestWorkspaceTempRoot(workspaceEnv))).rejects.toThrow();
});

test.serial('fast tests preserve an explicit workspace namespace through child execution and cleanup', async () => {
  const namespace = 'test-runner-explicit-namespace';
  process.env[TEST_WORKSPACE_NAMESPACE_ENV] = namespace;
  materializeTestWorkspace = true;

  const code = await runFastTests(['tests/unit/path-containment.test.ts']);
  const workspaceEnv = devCommandEnvironments[0]!;

  expect(code).toBe(0);
  expect(workspaceEnv[TEST_WORKSPACE_NAMESPACE_ENV]).toBe(namespace);
  await expect(fs.access(getTestWorkspaceTempRoot(workspaceEnv))).rejects.toThrow();
});

test.serial('final workspace cleanup failure remains visible and nonzero', async () => {
  cleanupFailure = new Error('cleanup sentinel');
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (message?: unknown) => { errors.push(String(message)); };

  try {
    const code = await runFastTests(['tests/unit/path-containment.test.ts']);

    expect(code).toBe(1);
    expect(devCommandCalls).toHaveLength(1);
    expect(errors).toContain('Fast test workspace cleanup failed: cleanup sentinel');
  } finally {
    console.error = originalError;
  }
});

test.serial('cleanup failure preserves a more specific child exit and its receipt', async () => {
  cleanupFailure = new Error('cleanup after child sentinel');
  devCommandExitCodes.push(7);
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (message?: unknown) => { errors.push(String(message)); };

  try {
    const code = await runFastTests(['tests/unit/path-containment.test.ts']);

    expect(code).toBe(7);
    const receipt = errors.find((message) => message.startsWith(FAST_TEST_FAILURE_RECEIPT_PREFIX));
    expect(receipt).toContain('"terminal":{"kind":"exited","exitCode":7}');
    expect(errors).toContain(
      'Fast test workspace cleanup failed: cleanup after child sentinel'
    );
  } finally {
    console.error = originalError;
  }
});

test.serial('cleanup failure remains additive to a preserved bootstrap exception', async () => {
  const bootstrapFailure = new Error('bootstrap primary sentinel');
  configureTestDependencyBootstrapFailure(bootstrapFailure);
  cleanupFailure = new Error('cleanup secondary sentinel');
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (message?: unknown) => { errors.push(String(message)); };

  try {
    let caught = false;
    let thrown: unknown;
    try {
      await runFastTests(['tests/unit/path-containment.test.ts']);
    } catch (error) {
      caught = true;
      thrown = error;
    }

    expect(caught).toBe(true);
    expect(thrown).toBe(bootstrapFailure);
    expect(devCommandCalls).toEqual([]);
    expect(errors).toContain('Fast test workspace cleanup failed: cleanup secondary sentinel');
  } finally {
    console.error = originalError;
  }
});

test.serial('cleanup remains additive while every falsy primary is rethrown unchanged', async () => {
  const cases = [
    { label: 'undefined', value: undefined },
    { label: 'null', value: null },
    { label: 'zero', value: 0 },
    { label: 'false', value: false },
    { label: 'empty-string', value: '' }
  ] as const;
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (message?: unknown) => { errors.push(String(message)); };

  try {
    for (const { label, value } of cases) {
      configureTestDependencyBootstrapFailure(value);
      cleanupFailure = new Error(`cleanup secondary ${label}`);
      let caught = false;
      let thrown: unknown = Symbol('not-thrown');

      try {
        await runFastTests(['tests/unit/path-containment.test.ts']);
      } catch (error) {
        caught = true;
        thrown = error;
      }

      expect(caught).toBe(true);
      expect(thrown).toBe(value);
      expect(errors).toContain(`Fast test workspace cleanup failed: cleanup secondary ${label}`);
    }
    expect(devCommandCalls).toEqual([]);
  } finally {
    console.error = originalError;
  }
});

test.serial('thrown isolated child waits for its bounded siblings before parent cleanup', async () => {
  materializeTestWorkspace = true;
  const selectedFiles = [
    'tests/integration/pipeline-kernel.test.ts',
    'tests/integration/ticket-pipeline.test.ts'
  ];
  const expectedFirstBatchSize = Math.min(
    DEFAULT_FAST_TEST_RESOURCE_CLASS_LIMITS['independent-process'],
    selectedFiles.length
  );
  devCommandFailures.push(
    new Error('spawn sentinel'),
    ...Array.from({ length: expectedFirstBatchSize - 1 }, () => null)
  );

  const code = await runFastTests(selectedFiles);
  const workspaceEnv = devCommandEnvironments[0]!;

  expect(code).toBe(1);
  expect(devCommandCalls).toHaveLength(expectedFirstBatchSize);
  await expect(fs.access(getTestWorkspaceTempRoot(workspaceEnv))).rejects.toThrow();
});

test.serial('fast tests reject explicit slow file selectors', async () => {
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (message?: unknown) => {
    errors.push(String(message));
  };

  try {
    const code = await runFastTests(['tests/e2e/registry.test.ts']);

    expect(code).toBe(1);
    expect(devCommandCalls).toEqual([]);
    expect(errors).toContain('Fast test runner cannot run slow test files: tests/e2e/registry.test.ts');
  } finally {
    console.error = originalError;
  }
});

test.serial('slow suite selector expands to the registered suite files', async () => {
  const suiteFiles = slowTestSuiteFiles('e2e-pipeline');
  const code = await runSlowTests(['--suite', 'e2e-pipeline', '--timeout', '180000']);

  expect(code).toBe(0);
  expect(suiteFiles.length).toBeGreaterThan(0);
  expect(devCommandCalls).toEqual([
    { command: 'bun', args: ['test', ...suiteFiles, '--timeout', '180000'] }
  ]);
});

test.serial('slow suite selector rejects unknown suite ids', async () => {
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (message?: unknown) => {
    errors.push(String(message));
  };

  try {
    const code = await runSlowTests(['--suite', 'not-a-suite']);

    expect(code).toBe(1);
    expect(devCommandCalls).toEqual([]);
    expect(errors[0]).toContain('Unknown slow test suite "not-a-suite". Available suites:');
  } finally {
    console.error = originalError;
  }
});

test.serial('affected tests fail before dependency bootstrap for unresolved source ownership', async () => {
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (message?: unknown) => {
    errors.push(String(message));
  };

  try {
    const code = await runAffectedTests();

    expect(code).toBe(1);
    expect(testDependencyBootstrapCalls).toBe(0);
    expect(devCommandCalls).toEqual([]);
    expect(devCommandEnvironments).toEqual([]);
    expect(errors).toContain('Affected test ownership is unresolved for changed paths: platform/unmapped-source.ts');
  } finally {
    console.error = originalError;
  }
});

test.serial('affected tests fail closed for mixed mapped and unresolved paths before any child', async () => {
  changedFiles = [
    'scripts/release-helper.ts',
    'assets/new.bin'
  ];

  const code = await runAffectedTests();

  expect(code).toBe(1);
  expect(testDependencyBootstrapCalls).toBe(0);
  expect(devCommandCalls).toEqual([]);
  expect(devCommandEnvironments).toEqual([]);
});

test.serial('affected plan reports resolved selection without dependency or test execution', async () => {
  changedFiles = ['tests/unit/path-containment.test.ts'];
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown) => {
    logs.push(String(message));
  };

  try {
    const code = await runAffectedTests(['--plan']);
    const plan = JSON.parse(logs.join('\n')) as Record<string, unknown>;

    expect(code).toBe(0);
    expect(plan).toMatchObject({
      schema: 'sec-affected-test-plan-v1',
      changedPaths: ['tests/unit/path-containment.test.ts'],
      selectedFastTests: ['tests/unit/path-containment.test.ts'],
      unresolvedPaths: [],
      resolved: true
    });
    expect(testDependencyBootstrapCalls).toBe(0);
    expect(devCommandCalls).toEqual([]);
    expect(devCommandEnvironments).toEqual([]);
  } finally {
    console.log = originalLog;
  }
});

test.serial('deleted test paths remain changed facts without becoming runnable tests', async () => {
  changedFiles = ['tests/integration/project-runtime.test.ts'];
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown) => {
    logs.push(String(message));
  };

  try {
    const code = await runAffectedTests(['--plan']);
    const plan = JSON.parse(logs.join('\n')) as Record<string, unknown>;

    expect(code).toBe(0);
    expect(plan).toMatchObject({
      schema: 'sec-affected-test-plan-v1',
      changedPaths: ['tests/integration/project-runtime.test.ts'],
      selectedFastTests: [],
      selectedSlowTests: [],
      unresolvedPaths: [],
      resolved: true
    });
    expect(testDependencyBootstrapCalls).toBe(0);
    expect(devCommandCalls).toEqual([]);
  } finally {
    console.log = originalLog;
  }
});

test.serial('resolved affected plan executes without repeating Git discovery', async () => {
  changedFiles = ['tests/unit/path-containment.test.ts'];
  const execution = await resolveAffectedTestExecution();

  expect(execution).not.toBeNull();
  expect(Object.isFrozen(execution)).toBe(true);
  expect(Object.isFrozen(execution!.plan)).toBe(true);
  expect(Object.isFrozen(execution!.plan.selectedFastTests)).toBe(true);
  expect(commandCalls).toHaveLength(2);
  const code = await execution!.run();

  expect(code).toBe(0);
  expect(commandCalls).toHaveLength(2);
  expect(testDependencyBootstrapCalls).toBe(1);
  expect(devCommandCalls).toHaveLength(1);
});

test('affected execution does not export an arbitrary-plan runner', () => {
  expect('runAffectedTestPlan' in testRunnerModule).toBe(false);
});

test('bounded fast-test authority binding remains module-private', () => {
  expect('runBoundedFastTestInvocations' in testRunnerModule).toBe(false);
  expect(typeof scheduleBoundedFastTestInvocations).toBe('function');
});

test.serial('affected plan lists every unresolved path and exits nonzero without side effects', async () => {
  changedFiles = [
    'assets/new.bin',
    'platform/unmapped-source.ts'
  ];
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown) => {
    logs.push(String(message));
  };

  try {
    const code = await runAffectedTests(['--plan']);
    const plan = JSON.parse(logs.join('\n')) as Record<string, unknown>;

    expect(code).toBe(1);
    expect(plan).toMatchObject({
      changedPaths: [
        'assets/new.bin',
        'platform/unmapped-source.ts'
      ],
      unresolvedPaths: [
        'assets/new.bin',
        'platform/unmapped-source.ts'
      ],
      resolved: false
    });
    expect(testDependencyBootstrapCalls).toBe(0);
    expect(devCommandCalls).toEqual([]);
    expect(devCommandEnvironments).toEqual([]);
  } finally {
    console.log = originalLog;
  }
});

test.serial('affected-test Git discovery requests byte-preserving stdout through the shared process seam', async () => {
  changedFiles = ['docs/04-AI自主实现执行蓝图.md'];
  const code = await runAffectedTests();

  expect(code).toBe(0);
  expect(commandCalls).toHaveLength(2);
  expect(commandCalls.every((call) => call.command === 'git' && call.stdoutMode === 'bytes')).toBe(true);
  expect(commandCalls.some((call) => call.args.includes('diff'))).toBe(true);
  expect(commandCalls.some((call) => call.args.includes('ls-files'))).toBe(true);
});

test.serial('affected tests map semantic Contract files through explicit contract ownership', async () => {
  changedFiles = ['platform/registry/official/ticket.basic/contracts/ticket.yaml'];

  const code = await runAffectedTests();

  expect(code).toBe(0);
  const invokedTests = devCommandCalls.flatMap((call) => call.args);
  expect(invokedTests).toEqual(expect.arrayContaining([
    'tests/unit/validated-engineering-ir.test.ts',
    'tests/integration/semantic-core-vertical.test.ts',
    'tests/integration/ticket-pipeline.test.ts'
  ]));
  expect(invokedTests).not.toContain('tests/unit/path-containment.test.ts');
});

test.serial('affected tests combine changed fast tests with source-owned coverage', async () => {
  changedFiles = [
    'scripts/release-helper.ts',
    'tests/unit/path-containment.test.ts'
  ];

  const code = await runAffectedTests();

  expect(code).toBe(0);
  expect(devCommandCalls).toHaveLength(1);
  expect(devCommandCalls[0]?.command).toBe('bun');
  expect(devCommandCalls[0]?.args.slice(0, 2)).toEqual(['test', '--concurrent']);
  expect(devCommandCalls[0]?.args).toContain('tests/contract/usage.test.ts');
  expect(devCommandCalls[0]?.args).toContain('tests/unit/path-containment.test.ts');
});

test.serial('affected tests run changed concurrent-safe fast files directly', async () => {
  changedFiles = ['tests/unit/path-containment.test.ts'];
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown) => {
    logs.push(String(message));
  };

  try {
    const code = await runAffectedTests();

    expect(code).toBe(0);
    expect(devCommandCalls).toEqual([
      {
        command: 'bun',
        args: [
          'test',
          '--concurrent',
          'tests/unit/path-containment.test.ts',
          '--timeout',
          String(DEFAULT_FAST_TEST_TIMEOUT_MS)
        ]
      }
    ]);
  } finally {
    console.log = originalLog;
  }
});

test.serial('affected tests isolate changed serial fast files', async () => {
  changedFiles = ['tests/unit/test-runner.test.ts'];

  const code = await runAffectedTests();

  expect(code).toBe(0);
  expect(devCommandCalls).toEqual([
    {
      command: 'bun',
      args: ['test', 'tests/unit/test-runner.test.ts', '--timeout', String(DEFAULT_FAST_TEST_TIMEOUT_MS)]
    }
  ]);
});

test.serial('affected tests treat changed slow files as notice-only quick-lane input', async () => {
  changedFiles = ['tests/e2e/registry.test.ts'];
  const logs: string[] = [];
  const errors: string[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (message?: unknown) => {
    logs.push(String(message));
  };
  console.error = (message?: unknown) => {
    errors.push(String(message));
  };

  try {
    const code = await runAffectedTests();

    expect(code).toBe(0);
    expect(devCommandCalls).toEqual([]);
    expect(errors).toEqual([]);
    expect(logs).toContain('Changed slow test files require PR risk or release/full verification: tests/e2e/registry.test.ts');
    expect(logs).toContain('No affected fast test files detected.');
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
});

test.serial('affected tests allow broad fast-suite fallback when explicitly enabled', async () => {
  changedFiles = ['tests/setup/unmapped.ts'];
  process.env.SEC_AFFECTED_TESTS_FULL_FAST_FALLBACK = '1';
  const defaultFastTestFiles = getFastTestFilesSync().filter(isDefaultFastTestFile);
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown) => {
    logs.push(String(message));
  };

  try {
    const code = await runAffectedTests();

    expect(code).toBe(0);
    const concurrentCalls = devCommandCalls.filter(({ args }) => args.includes('--concurrent'));
    expect(concurrentCalls.length).toBeGreaterThan(1);
    expect(concurrentCalls.every(({ args }) => (
      invocationTestFiles(args).length <= DEFAULT_FAST_TEST_PROCESS_SHARD_SIZE
    ))).toBe(true);
    expect(concurrentCalls.every(({ args }) => (
      args.slice(-2).join(' ') === `--timeout ${DEFAULT_FAST_TEST_TIMEOUT_MS}`
    ))).toBe(true);
    for (const file of PROCESS_ISOLATED_FAST_TEST_FILES.filter(isDefaultFastTestFile)) {
      expect(devCommandCalls).toContainEqual({
        command: 'bun',
        args: ['test', file, '--timeout', String(DEFAULT_FAST_TEST_TIMEOUT_MS)]
      });
    }
    const invokedFiles = devCommandCalls.flatMap(({ args }) => invocationTestFiles(args));
    expect([...invokedFiles].sort()).toEqual(defaultFastTestFiles);
    expect(DEFAULT_FAST_TEST_EXCLUDED_FILES.some((file) => invokedFiles.includes(file))).toBe(false);
    expect(new Set(invokedFiles).size).toBe(invokedFiles.length);
    expect(logs).toContain('No affected fast tests matched source changes; running the fast test suite because SEC_AFFECTED_TESTS_FULL_FAST_FALLBACK=1.');
  } finally {
    console.log = originalLog;
  }
});

test.serial('affected tests fail closed for source change with empty closure and no fallback (Issue #206)', async () => {
  // tests/setup/unmapped.ts is a .ts file (→ sourceChanged=true via typescript
  // kind) under tests/setup/ (→ BOUNDED_BASELINE_PATTERLS → ownershipResolved=true)
  // with no ownership declaration, fallback rule, or reverse-import edge
  // (→ selectedFastTests=[]). Previously this returned 0 — a false-green.
  changedFiles = ['tests/setup/unmapped.ts'];
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (message?: unknown) => {
    errors.push(String(message));
  };

  try {
    const code = await runAffectedTests();

    expect(code).toBe(1);
    expect(testDependencyBootstrapCalls).toBe(0);
    expect(devCommandCalls).toEqual([]);
    expect(devCommandEnvironments).toEqual([]);
    expect(errors.some((e) => e.includes('Failing closed'))).toBe(true);
  } finally {
    console.error = originalError;
  }
});

test.serial('affected plan projects invalidated verificationResult for fail-closed boundary (Issue #206)', async () => {
  changedFiles = ['tests/setup/unmapped.ts'];
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown) => {
    logs.push(String(message));
  };

  try {
    const code = await runAffectedTests(['--plan']);
    const plan = JSON.parse(logs.join('\n')) as Record<string, unknown>;

    // --plan must fail closed (exit 1) for the fail-closed trust boundary.
    expect(code).toBe(1);
    expect(plan).toHaveProperty('verificationResult');
    const vr = plan.verificationResult as Record<string, unknown>;
    expect(vr.status).toBe('invalidated');
    expect(vr.reasonCode).toBe('selection-unresolved');
    expect(vr.applicability).toBe('unresolved');
    expect(vr.disposition).toBe('not-executed');
    expect(plan.selectionTrustBoundary).toBe('unresolved-selection');
    expect(testDependencyBootstrapCalls).toBe(0);
    expect(devCommandCalls).toEqual([]);
  } finally {
    console.log = originalLog;
  }
});

test.serial('affected plan projects not-applicable for non-source change with no fast tests (Issue #206)', async () => {
  // Only a slow test file changed: sourceChanged=false, selectedFastTests=[].
  // This is the legitimate "no impact" boundary → not-applicable, exit 0.
  changedFiles = ['tests/e2e/registry.test.ts'];
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown) => {
    logs.push(String(message));
  };

  try {
    const code = await runAffectedTests(['--plan']);
    const plan = JSON.parse(logs.join('\n')) as Record<string, unknown>;

    expect(code).toBe(0);
    const vr = plan.verificationResult as Record<string, unknown>;
    expect(vr.status).toBe('not-run');
    expect(vr.reasonCode).toBe('not-applicable');
    expect(vr.applicability).toBe('not-applicable');
    expect(plan.selectionTrustBoundary).toBe('applicable-no-tests');
  } finally {
    console.log = originalLog;
  }
});

test.serial('affected plan projects not-dispatched for applicable selection with fast tests (Issue #206)', async () => {
  changedFiles = ['tests/unit/path-containment.test.ts'];
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown) => {
    logs.push(String(message));
  };

  try {
    const code = await runAffectedTests(['--plan']);
    const plan = JSON.parse(logs.join('\n')) as Record<string, unknown>;

    expect(code).toBe(0);
    const vr = plan.verificationResult as Record<string, unknown>;
    expect(vr.status).toBe('not-run');
    expect(vr.reasonCode).toBe('not-dispatched');
    expect(vr.applicability).toBe('required');
    expect(plan.selectionTrustBoundary).toBe('applicable-with-tests');
  } finally {
    console.log = originalLog;
  }
});

test.serial('affected plan projects invalidated for unresolved ownership (Issue #206)', async () => {
  changedFiles = ['platform/unmapped-source.ts'];
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown) => {
    logs.push(String(message));
  };

  try {
    const code = await runAffectedTests(['--plan']);
    const plan = JSON.parse(logs.join('\n')) as Record<string, unknown>;

    expect(code).toBe(1);
    const vr = plan.verificationResult as Record<string, unknown>;
    expect(vr.status).toBe('invalidated');
    expect(vr.reasonCode).toBe('selection-unresolved');
    expect(vr.applicability).toBe('unresolved');
    expect(plan.selectionTrustBoundary).toBe('unresolved-ownership');
  } finally {
    console.log = originalLog;
  }
});
