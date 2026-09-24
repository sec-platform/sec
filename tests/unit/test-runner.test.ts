import { afterAll, afterEach, beforeEach, expect, mock, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import ts from 'typescript';

import type { GitReadSession } from '../../src/adapters/providers/git-read/runtime/session.ts';
import {
  assertWorkspaceTypeScriptProjectGenerationEvidence,
  compileVirtualWorkspaceSourceSnapshot,
  type WorkspaceSourceSnapshot
} from '../../src/adapters/repository/source-program-model/workspace-source-snapshot.ts';
import { inspectNoFollowDirectoryChain } from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import type { PreparedWindowsRepositoryChangeObserver } from '../../src/adapters/runtime-state/physical/runtime/windows-repository-change-observer.ts';
import { AFFECTED_SELECTION_OPERATION_DURATION_MS, compileAffectedTestSelectionSemanticOperation } from '../../src/adapters/self-hosting/development/runner/affected-plan-contract.ts';
import type {
  DevCommandObservation,
  ObserveDevCommandOptions
} from '../../src/adapters/self-hosting/development/runner/command-runner.ts';
import { DEV_COMMAND_MAX_DURATION_MS } from '../../src/adapters/self-hosting/development/runner/contract.ts';
import type { OperationDependencyBootstrapResult } from '../../src/adapters/self-hosting/development/runner/dependency-bootstrap.ts';
import * as actualEnvManager from '../../src/adapters/self-hosting/development/runner/env-manager.ts';
import {
  assertFastTestProcessPolicyInventory,
  assertUniqueFastTestProcessIsolationDefinitions,
  DEFAULT_FAST_TEST_CONCURRENCY_BUDGET,
  DEFAULT_FAST_TEST_EXCLUDED_FILES,
  DEFAULT_FAST_TEST_MAX_CONCURRENCY,
  DEFAULT_FAST_TEST_RESOURCE_CLASS_LIMITS,
  FAST_TEST_PROCESS_ISOLATION_REGISTRY,
  FAST_TEST_PROCESS_RESOURCE_CLASS_ORDER,
  isDefaultFastTestFile,
  planFastTestProcesses
} from '../../src/adapters/self-hosting/development/runner/fast-test-policy.ts';
import { applyDefaultFastTestConcurrency } from '../../src/adapters/self-hosting/development/runner/test-concurrency-policy.ts';
import {
  admitFastTestBatchExecutionPolicy,
  assertIssuedFastTestBatchExecutionAdmission,
  assertIssuedTestSuiteExecutionAdmission,
  compileTestInvocationExecutionPolicy,
  DEFAULT_TEST_TIMEOUT_MS,
  issueFastTestBatchExecutionPolicy,
  TEST_SUPERVISOR_SETTLEMENT_MARGIN_MS,
  type FastTestBatchExecutionAdmission,
  type TestSuiteExecutionAdmission
} from '../../src/adapters/self-hosting/development/runner/test-execution-policy.ts';
import { compileTestBudgetProjection, FAST_TEST_PROCESS_POLICY_TEST_FILE, TEST_ARCHITECTURE_POLICY_TEST_FILE } from '../../src/adapters/verification/platform/test-impact/contract/budget.ts';
import { compilerRoot } from "../../src/adapters/workspace-context.ts";
import { rawSha256 } from '../../src/contracts/canonical.ts';
import { isSecRepositoryTestModulePath, normalizeSecRepositoryTestModulePath } from '../../src/contracts/repository-test-path.ts';
import { createExactGitTreeTestRunnerFixture } from '../helpers/test-impact-provider.ts';

const actualCommandRunner = await import('../../src/adapters/self-hosting/development/runner/command-runner.ts');
const actualPhysicalProcess = await import('../../src/adapters/runtime-state/physical/runtime/process.ts');
const testImpactFixture = await createExactGitTreeTestRunnerFixture();
afterAll(() => testImpactFixture.dispose());
const samePathContentDriftPath = 'tests/unit/path-containment.test.ts';
const samePathContentDriftBefore = testImpactFixture.workingTreeSnapshot;
if (samePathContentDriftBefore.file(samePathContentDriftPath) === null) {
  throw new Error(`Drift fixture source is absent: ${samePathContentDriftPath}`);
}
const samePathContentDriftSnapshot = compileVirtualWorkspaceSourceSnapshot({
  subject: Object.freeze({
    kind: 'virtual-mutation' as const,
    provenance: Object.freeze({
      kind: 'source-program-virtual-mutation' as const,
      baseSnapshotDigest: samePathContentDriftBefore.snapshotDigest,
      mutationDigest: rawSha256('same-path-content-drift')
    })
  }),
  files: samePathContentDriftBefore.files.map((file) => {
    if (file.path !== samePathContentDriftPath) return file;
    const source = `${file.source}\n// same-path-content-drift\n`;
    return Object.freeze({ ...file, source, contentDigest: rawSha256(source) });
  }),
  moduleMembership: samePathContentDriftBefore.moduleMembership
});
if (samePathContentDriftSnapshot.snapshotDigest === samePathContentDriftBefore.snapshotDigest) {
  throw new Error('Drift fixture did not change the source snapshot digest.');
}
const actualWorkspaceSnapshots = await import('../../src/adapters/repository/source-program-model/workspace-source-snapshot.ts');
const testBudgetSnapshotOverrides: Array<WorkspaceSourceSnapshot | Error> = [];
mock.module('../../src/adapters/repository/source-program-model/workspace-source-snapshot.ts', () => ({
  ...actualWorkspaceSnapshots,
  acquireWorkingTreeWorkspaceSourceSnapshot: async () => {
    const snapshot = testBudgetSnapshotOverrides.shift() ?? testImpactFixture.workingTreeSnapshot;
    if (snapshot instanceof Error) throw snapshot;
    return snapshot;
  }
}));
const dependencyRuntime = await import('../../src/adapters/toolchain/dependencies/runtime.ts');
const compilerDependencyAuthority = await dependencyRuntime.observeCompilerDependencyExecutionGenerationAuthority({
  deadlineAtUnixMs: Date.now() + 10_000
});
if (compilerDependencyAuthority === null) {
  throw new Error('Test runner requires one existing compiler generation authority.');
}
const compilerDependencyFixture = dependencyRuntime.projectCompilerDepsReadyState(
  compilerDependencyAuthority
);
const actualDependencyBootstrap = await import('../../src/adapters/self-hosting/development/runner/dependency-bootstrap.ts');

const {
  bindTestWorkspaceSupervisorLeaseIssuerProjection,
  createTestWorkspaceRunChildAssignment,
  createTestWorkspaceSupervisorLease,
  deriveTestWorkspaceRunNamespace: deriveTestWorkspaceRunNamespaceV1,
  getTestWorkspaceTemplateRoot,
  getTestWorkspaceTempRoot,
  parseTestWorkspaceRunChildAssignment: parseTestWorkspaceRunChildAssignmentV1,
  pathEnvKey,
  prepareTestWorkspaceRun: prepareTestWorkspaceRunV1,
  resolveTestWorkspaceRunChild,
  resolveTestWorkspaceNamespace,
  settlePreparedTestWorkspaceRun: actualSettlePreparedTestWorkspaceRunV1,
  TEST_WORKSPACE_BOUND_CHILD_LOCATOR_ENV,
  TEST_WORKSPACE_NAMESPACE_ENV,
  TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT_ENV,
  TEST_WORKSPACE_RUN_CHILD_ENV
} = actualEnvManager;

type ObservedCommandOptions = Readonly<{
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  envMode?: 'inherit' | 'replace';
}>;

const commandCalls: {
  command: string;
  args: string[];
  stdoutMode: 'bytes' | 'text';
  options?: ObservedCommandOptions;
}[] = [];
const devCommandCalls: { command: string; args: string[] }[] = [];
const devCommandOptions: Array<ObserveDevCommandOptions | undefined> = [];
const devCommandEnvironments: NodeJS.ProcessEnv[] = [];
const devCommandExitCodes: number[] = [];
const devCommandFailures: Array<Error | null> = [];
const devCommandObservationOverrides: Array<Partial<DevCommandObservation> | undefined> = [];
const devCommandSettlements: Array<Promise<void> | undefined> = [];
const devCommandStartObservers: Array<(() => void) | undefined> = [];
const devCommandCompletionObservers: Array<(() => void) | undefined> = [];
const DEFAULT_MANAGED_INNER_ARGS = ['--no-orphans', '--max-concurrency', String(DEFAULT_FAST_TEST_MAX_CONCURRENCY)] as const;
const DEFAULT_NATIVE_PARALLEL_ARGS = [`--parallel=${DEFAULT_FAST_TEST_CONCURRENCY_BUDGET.concurrentProcessLimit}`, '--isolate'] as const;
let fastDependencyBootstrapCalls = 0;
let testDependencyBootstrapCalls = 0;
const gitReadSessionDeadlineRequests: Array<number | undefined> = [];
const gitReadSessions: GitReadSession[] = [];
const operationEvents: Array<'git-read-session' | 'dev-command'> = [];
let hasTestDependencyBootstrapFailure = false;
let testDependencyBootstrapFailure: unknown;
let cleanupFailure: Error | null = null;
let invocationRuntimeCleanupFailure: Error | null = null;
const mockedAssignedCleanupTokens = new WeakSet<object>();
const isolatedFastTestFileSet = new Set<string>(
  FAST_TEST_PROCESS_ISOLATION_REGISTRY.map(({ file }) => file)
);
let changedFiles = ['platform/unmapped-source.ts'];
let materializeTestWorkspace = false;
let trustedCallerAssignmentFixture: actualEnvManager.TestWorkspaceRunChildAssignment | null = null;
let previousTestWorkspaceNamespace: string | undefined;
let previousTestWorkspaceRunChild: string | undefined;
let previousTestWorkspaceRunChildAssignment: string | undefined;
let previousTestWorkspaceBoundChildLocator: string | undefined;
let previousAffectedTestsBase: string | undefined;
let previousChangedBase: string | undefined;
let previousConsoleLog: typeof console.log;
let previousConsoleError: typeof console.error;

mock.module('../../src/adapters/filesystem/files.ts', () => ({
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
  stdoutMode: 'bytes' | 'text',
  options?: ObservedCommandOptions
): { code: number; stdout: string | Uint8Array; stderr: string } => {
  commandCalls.push({ command, args, stdoutMode, options });
  const stdout = (value: string | Uint8Array): string | Uint8Array => (
    stdoutMode === 'bytes'
      ? (typeof value === 'string' ? new TextEncoder().encode(value) : value)
      : (typeof value === 'string' ? value : new TextDecoder().decode(value))
  );

  const isGitCommand = command === 'git' || path.basename(command).toLowerCase().startsWith('git.');

  if (isGitCommand && args.includes('rev-parse')) {
    // Exact object identity for the read-session start/end fences.
    return {
      code: 0,
      stdout: stdout(`${testImpactFixture.sourceCommitSha}\n`),
      stderr: ''
    };
  }

  if (isGitCommand && args.some((arg) => (
    arg === 'diff' || arg === 'diff-index' || arg === 'diff-files'
  ))) {
    return { code: 0, stdout: stdout(changedFiles.map((file) => `M\0${file}\0`).join('')), stderr: '' };
  }

  if (isGitCommand && args.includes('ls-files')) {
    if (args.includes('--deleted')) {
      return { code: 0, stdout: stdout(testImpactFixture.deletedTrackedOutput), stderr: '' };
    }
    if (args.includes('--stage')) {
      return { code: 0, stdout: stdout(testImpactFixture.indexStageOutput), stderr: '' };
    }
    return { code: 0, stdout: stdout(''), stderr: '' };
  }

  if (isGitCommand && args.includes('status')) {
    return { code: 0, stdout: stdout(''), stderr: '' };
  }

  return { code: 1, stdout: stdout(''), stderr: `Unexpected command: ${command} ${args.join(' ')}` };
};

mock.module('../../src/adapters/runtime-state/physical/runtime/process.ts', () => ({
  ...actualPhysicalProcess,
  runCommand: async (command: string, args: string[], options?: ObservedCommandOptions) =>
    processCommand(command, args, 'text', options),
  runCommandBytes: async (command: string, args: string[], options?: ObservedCommandOptions) =>
    processCommand(command, args, 'bytes', options),
  runRetainedCommandBytes: (
    ...[boundary, args]: Parameters<typeof actualPhysicalProcess.runRetainedCommandBytes>
  ) => Promise.resolve(processCommand(boundary.executable.childPath, args, 'bytes'))
}));

// Git selection remains transport-only in this fixture. Source selection is
// injected separately as a test-origin TestImpact capability, so this session
// can never be promoted into a production Source Snapshot.
const actualGitReadEnvironment = await import(
  '../../src/adapters/providers/git-read/test/session.ts'
);
const createTestGitReadSession = actualGitReadEnvironment.createHostGitReadSessionForTests;
mock.module('../../src/adapters/providers/git-read/runtime/session.ts', () => ({
  ...actualGitReadEnvironment,
  createAuthorityGitReadSession: (
    input: Parameters<typeof actualGitReadEnvironment.createAuthorityGitReadSession>[0]
  ) => {
    operationEvents.push('git-read-session');
    gitReadSessionDeadlineRequests.push(input.deadlineAtUnixMs);
    const session = createTestGitReadSession(input);
    gitReadSessions.push(session);
    return Object.freeze({
      status: 'ready' as const,
      route: 'host-local-git-v1' as const,
      session
    });
  }
}));

const actualCheckAffectedSource = await import(
  '../../src/adapters/self-hosting/development/runner/check-affected-source.ts'
);
const testImpactObservationOverrides: Array<typeof testImpactFixture.affectedObservation> = [];
mock.module('../../src/adapters/self-hosting/development/runner/check-affected-source.ts', () => ({
  ...actualCheckAffectedSource,
  // Source authority was already issued from the real fixture Git object.
  // The GitRead session exercised below remains transport/fence-only and its
  // structural test origin can never acquire Source Program authority.
  issueCheckAffectedTestImpactProjection: async () => (
    testImpactObservationOverrides.shift() ?? testImpactFixture.affectedObservation
  )
}));

mock.module('../../src/adapters/self-hosting/development/runner/env-manager.ts', () => ({
  consumeTestWorkspaceSupervisorChallenge: async () =>
    Object.freeze({ schema: 'sec-test-workspace-run-child-authority-v1' as const }),
  consumeTestWorkspaceSupervisorChallengeV1: async () =>
    Object.freeze({ schema: 'sec-test-workspace-run-child-authority-v1' as const }),
  createTestWorkspaceRunChildAssignment,
  deriveTestWorkspaceRunNamespaceV1,
  deriveTestWorkspaceRunNamespace: deriveTestWorkspaceRunNamespaceV1,
  getTestWorkspaceTemplateRoot,
  getTestWorkspaceTempRoot,
  parseTestWorkspaceRunChildAssignmentV1: (
    serialized: string | undefined,
    parentNamespace: string,
    runChild: string
  ) => trustedCallerAssignmentFixture !== null && serialized === JSON.stringify(trustedCallerAssignmentFixture) &&
      trustedCallerAssignmentFixture.name === runChild
      ? trustedCallerAssignmentFixture
      : parseTestWorkspaceRunChildAssignmentV1(serialized, parentNamespace, runChild),
  parseTestWorkspaceRunChildAssignment: (
    serialized: string | undefined,
    parentNamespace: string,
    runChild: string
  ) => trustedCallerAssignmentFixture !== null && serialized === JSON.stringify(trustedCallerAssignmentFixture) &&
      trustedCallerAssignmentFixture.name === runChild
    ? trustedCallerAssignmentFixture
    : parseTestWorkspaceRunChildAssignmentV1(serialized, parentNamespace, runChild),
  pathEnvKey,
  prepareTestWorkspaceRunV1: (
    env: NodeJS.ProcessEnv,
    authority: actualEnvManager.TestWorkspaceRunChildAuthority | null
  ) => {
    if (authority === null) return prepareTestWorkspaceRunV1(env, null);
    const token = Object.freeze({ schema: 'prepared-test-workspace-run-v1' as const });
    mockedAssignedCleanupTokens.add(token);
    return token;
  },
  prepareTestWorkspaceRun: (
    env: NodeJS.ProcessEnv,
    authority: actualEnvManager.TestWorkspaceRunChildAuthority | null
  ) => {
    if (authority === null) return prepareTestWorkspaceRunV1(env, null);
    const token = Object.freeze({ schema: 'prepared-test-workspace-run-v1' as const });
    mockedAssignedCleanupTokens.add(token);
    return token;
  },
  resolveTestWorkspaceRunChild,
  resolveTestWorkspaceNamespace,
  settlePreparedTestWorkspaceRunV1: (token: actualEnvManager.PreparedTestWorkspaceRun) => {
    if (cleanupFailure) throw cleanupFailure;
    if (mockedAssignedCleanupTokens.has(token)) return;
    actualSettlePreparedTestWorkspaceRunV1(token);
  },
  settlePreparedTestWorkspaceRun: (token: actualEnvManager.PreparedTestWorkspaceRun) => {
    if (cleanupFailure) throw cleanupFailure;
    if (mockedAssignedCleanupTokens.has(token)) return;
    actualSettlePreparedTestWorkspaceRunV1(token);
  },
  TEST_WORKSPACE_BOUND_CHILD_LOCATOR_ENV,
  TEST_WORKSPACE_NAMESPACE_ENV,
  TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT_ENV,
  TEST_WORKSPACE_RUN_CHILD_ENV
}));

const mockedTestInvocationRuntimeIsolationMode = (platform: NodeJS.Platform) =>
  platform === 'win32' || platform === 'linux' ? 'retained' : 'unavailable';
const mockedCreateTestInvocationRuntimeRoots = async () => {
    const runRoot = mkdtempSync(path.join(tmpdir(), 'sec-test-runner-invocation-'));
    const generation = path.basename(runRoot);
    const stateRoot = path.join(runRoot, 'state-authority', generation);
    const cacheRoot = path.join(runRoot, 'cache-authority', generation);
    mkdirSync(stateRoot, { recursive: true });
    mkdirSync(cacheRoot, { recursive: true });
    return Object.freeze({
      stateRoot,
      cacheRoot,
      prepareProcessTemp: (environment: NodeJS.ProcessEnv) => {
        const processRoot = mkdtempSync(path.join(tmpdir(), 'sec-test-runner-process-'));
        const tempRoot = path.join(processRoot, 'tmp');
        mkdirSync(tempRoot);
        environment.TMP = tempRoot;
        environment.TEMP = tempRoot;
        environment.TMPDIR = tempRoot;
        return Object.freeze({
          processRoot,
          tempRoot,
          cleanup: () => rmSync(processRoot, { recursive: true, force: true })
        });
      },
      cleanup: () => {
        rmSync(runRoot, { recursive: true, force: true });
        if (invocationRuntimeCleanupFailure !== null) throw invocationRuntimeCleanupFailure;
      }
    });
  };

mock.module('../../src/adapters/self-hosting/development/runner/test-process-temp.ts', () => ({
  testInvocationRuntimeIsolationModeForPlatform: mockedTestInvocationRuntimeIsolationMode,
  testInvocationRuntimeIsolationModeForPlatformV1: mockedTestInvocationRuntimeIsolationMode,
  createTestInvocationRuntimeRoots: mockedCreateTestInvocationRuntimeRoots,
  createTestInvocationRuntimeRootsV1: mockedCreateTestInvocationRuntimeRoots
}));

mock.module('../../src/adapters/self-hosting/development/runner/command-runner.ts', () => ({
  ...actualCommandRunner,
  runDevCommand: async (
    command: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    options?: ObserveDevCommandOptions
  ) => {
    operationEvents.push('dev-command');
    devCommandCalls.push({ command, args });
    devCommandOptions.push(options);
    devCommandEnvironments.push(env);
    devCommandStartObservers.shift()?.();
    if (materializeTestWorkspace) {
      await fs.mkdir(getTestWorkspaceTempRoot({
        ...env,
        [TEST_WORKSPACE_BOUND_CHILD_LOCATOR_ENV]: undefined
      }), { recursive: true });
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

mock.module('../../src/adapters/self-hosting/development/runner/dependency-bootstrap.ts', () => ({
  ...actualDependencyBootstrap,
  ensureOperationDependencies: async () => {
    fastDependencyBootstrapCalls += 1;
    if (hasTestDependencyBootstrapFailure) throw testDependencyBootstrapFailure;
    return compilerDependencyFixture;
  },
  reuseOperationDependencies: (result: unknown) => result
}));

// These unit cases verify suite selection and command dispatch. The physical
// zero-write fence has its own integration coverage; preserve the real issued
// suite admission here while delegating only to the already-mocked command.
mock.module('../../src/adapters/self-hosting/development/runner/repository-mutation-fence.ts', () => ({
  runRepositoryZeroWriteOperation: async (
    _commandId: string,
    operation: (
      processSession?: undefined,
      executionContext?: Readonly<{
        testSuiteAdmission: TestSuiteExecutionAdmission;
        testSuiteObserver: PreparedWindowsRepositoryChangeObserver;
      }>
    ) => Promise<number>,
    options: Readonly<{
      retainProcessSession?: boolean;
      fastTestBatchAdmission?: FastTestBatchExecutionAdmission;
      testSuiteAdmission?: TestSuiteExecutionAdmission;
    }>
  ) => {
    if (options.fastTestBatchAdmission !== undefined) {
      if (options.retainProcessSession !== false) {
        throw new Error('Fast test batch requires one settled root-discovery session.');
      }
      assertIssuedFastTestBatchExecutionAdmission(options.fastTestBatchAdmission);
      return operation();
    }
    if (options.testSuiteAdmission === undefined) {
      return operation();
    }
    if (options.retainProcessSession !== false) {
      throw new Error('Test runner suite dispatch requires one settled root-discovery session and issued admission.');
    }
    assertIssuedTestSuiteExecutionAdmission(options.testSuiteAdmission);
    return operation(undefined, Object.freeze({
      testSuiteAdmission: options.testSuiteAdmission,
      testSuiteObserver: Object.freeze({}) as PreparedWindowsRepositoryChangeObserver
    }));
  }
}));

const testRunnerModule = await import('../../src/adapters/self-hosting/development/runner/test-runner.ts');
const canonicalAffectedIssuer = (await import(
  '../../src/adapters/self-hosting/development/runner/check-affected-source.ts'
)).issueCheckAffectedTestImpactProjection;
const {
  resolveAffectedTestExecution: resolveAffectedTestExecutionWithIssuer,
  runAffectedTests: runAffectedTestsWithIssuer,
  FAST_TEST_FAILURE_RECEIPT_PREFIX,
  runFastTests,
  runSlowTests,
  runTests
} = testRunnerModule;
const resolveAffectedTestExecution = () => resolveAffectedTestExecutionWithIssuer({
  operation: compileAffectedTestSelectionSemanticOperation({ purpose: 'check-affected' }),
  issueTestImpactProjection: async () => testImpactFixture.affectedObservation
});
const runAffectedTests = (args: string[] = []) => runAffectedTestsWithIssuer(
  async () => testImpactFixture.affectedObservation,
  args
);
const testBudgetDomain = await import('../../src/adapters/verification/platform/test-impact/contract/budget.ts');
const testBudgetProjection = testBudgetDomain.compileTestBudgetProjection(
  testImpactFixture.provider.testInventory
);
const getFastTestFilesSync = () => testBudgetDomain.getFastTestFilesSync(testBudgetProjection);
const slowTestSuiteFiles = (suiteId: string) => (
  testBudgetDomain.slowTestSuiteFiles(testBudgetProjection, suiteId)
);

function invocationTestFiles(args: readonly string[]): string[] {
  return args.filter(isSecRepositoryTestModulePath).map(normalizeSecRepositoryTestModulePath);
}

function fastInvocationRunRoots(environment: NodeJS.ProcessEnv): Readonly<{
  stateRoot: string;
  cacheRoot: string;
}> {
  const stateHome = environment.SEC_STATE_HOME;
  const cacheHome = environment.SEC_CACHE_HOME;
  if (stateHome === undefined || cacheHome === undefined || path.basename(stateHome) !== path.basename(cacheHome) ||
    path.basename(path.dirname(stateHome)) !== 'invocation-runtime' ||
    path.basename(path.dirname(cacheHome)) !== 'invocation-runtime') {
    throw new Error('Fast invocation runtime environment is malformed');
  }
  const stateRoot = path.dirname(path.dirname(stateHome));
  const cacheRoot = path.dirname(path.dirname(cacheHome));
  if (path.basename(stateRoot) !== path.basename(cacheRoot) || stateRoot === cacheRoot) {
    throw new Error('Fast invocation State/Cache generations are not disjoint peers');
  }
  return Object.freeze({ stateRoot, cacheRoot });
}

function plannedProcessFiles(plan: ReturnType<typeof planFastTestProcesses>): string[] {
  return [
    ...plan.parallelFiles,
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
  previousConsoleLog = console.log;
  previousConsoleError = console.error;
  console.log = () => undefined;
  console.error = () => undefined;
  previousTestWorkspaceNamespace = process.env[TEST_WORKSPACE_NAMESPACE_ENV];
  previousTestWorkspaceRunChild = process.env[TEST_WORKSPACE_RUN_CHILD_ENV];
  previousTestWorkspaceRunChildAssignment = process.env[TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT_ENV];
  previousTestWorkspaceBoundChildLocator = process.env[TEST_WORKSPACE_BOUND_CHILD_LOCATOR_ENV];
  previousAffectedTestsBase = process.env.SEC_AFFECTED_TESTS_BASE;
  previousChangedBase = process.env.SEC_CHANGED_BASE;
  delete process.env[TEST_WORKSPACE_NAMESPACE_ENV];
  delete process.env[TEST_WORKSPACE_RUN_CHILD_ENV];
  delete process.env[TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT_ENV];
  delete process.env[TEST_WORKSPACE_BOUND_CHILD_LOCATOR_ENV];
  delete process.env.SEC_AFFECTED_TESTS_BASE;
  delete process.env.SEC_CHANGED_BASE;
  commandCalls.length = 0;
  devCommandCalls.length = 0;
  devCommandOptions.length = 0;
  devCommandEnvironments.length = 0;
  devCommandExitCodes.length = 0;
  devCommandFailures.length = 0;
  devCommandObservationOverrides.length = 0;
  devCommandSettlements.length = 0;
  devCommandStartObservers.length = 0;
  devCommandCompletionObservers.length = 0;
  fastDependencyBootstrapCalls = 0;
  testDependencyBootstrapCalls = 0;
  gitReadSessionDeadlineRequests.length = 0;
  gitReadSessions.length = 0;
  operationEvents.length = 0;
  testImpactObservationOverrides.length = 0;
  testBudgetSnapshotOverrides.length = 0;
  hasTestDependencyBootstrapFailure = false;
  testDependencyBootstrapFailure = undefined;
  cleanupFailure = null;
  invocationRuntimeCleanupFailure = null;
  changedFiles = ['platform/unmapped-source.ts'];
  materializeTestWorkspace = false;
  trustedCallerAssignmentFixture = null;
  delete process.env.SEC_AFFECTED_TESTS_FULL_FAST_FALLBACK;
});

afterEach(() => {
  console.log = previousConsoleLog;
  console.error = previousConsoleError;
  if (previousTestWorkspaceNamespace === undefined) {
    delete process.env[TEST_WORKSPACE_NAMESPACE_ENV];
  } else {
    process.env[TEST_WORKSPACE_NAMESPACE_ENV] = previousTestWorkspaceNamespace;
  }
  if (previousTestWorkspaceRunChild === undefined) {
    delete process.env[TEST_WORKSPACE_RUN_CHILD_ENV];
  } else {
    process.env[TEST_WORKSPACE_RUN_CHILD_ENV] = previousTestWorkspaceRunChild;
  }
  if (previousTestWorkspaceRunChildAssignment === undefined) {
    delete process.env[TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT_ENV];
  } else {
    process.env[TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT_ENV] = previousTestWorkspaceRunChildAssignment;
  }
  if (previousTestWorkspaceBoundChildLocator === undefined) {
    delete process.env[TEST_WORKSPACE_BOUND_CHILD_LOCATOR_ENV];
  } else {
    process.env[TEST_WORKSPACE_BOUND_CHILD_LOCATOR_ENV] = previousTestWorkspaceBoundChildLocator;
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

test('TestImpact fixture authority is bound to its fixture-owned exact Git commit', () => {
  expect(testImpactFixture.provider.projection.subject).toMatchObject({
    kind: 'physical-repository',
    provenance: {
      kind: 'git-tree',
      commitSha: testImpactFixture.fixtureCommitSha
    }
  });
  expect(testImpactFixture.fixtureCommitSha).not.toBe(testImpactFixture.sourceCommitSha);
  expect(path.resolve(testImpactFixture.repositoryRoot)).not.toBe(path.resolve(compilerRoot));
});

test('native parallel planning preserves every selected file and isolates external resources', () => {
  const concurrentFiles = ['tests/unit/a.test.ts', 'tests/unit/b.test.ts'];
  const isolatedFiles = [
    'tests/unit/command-runner.test.ts',
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

  expect(plan.parallelFiles).toEqual(concurrentFiles);
  expect(plan.resourceClassOrder).toEqual(FAST_TEST_PROCESS_RESOURCE_CLASS_ORDER);
  expect(plan.resourceQueues['independent-process']).toEqual(isolatedFiles);
  expect(plan.resourceQueues['shared-host-runtime']).toEqual([]);
  expect(plan.resourceQueues['repository-worktree']).toEqual([]);
  expect(plan.resourceQueues['host-profile']).toEqual([]);
  expect(plan.resourceLimits).toEqual(DEFAULT_FAST_TEST_RESOURCE_CLASS_LIMITS);
  expect([...plannedFiles].sort()).toEqual([...files].sort());
  expect(new Set(plannedFiles).size).toBe(files.length);
  expect(planFastTestProcesses(files)).toEqual(plan);
  expect(planFastTestProcesses(concurrentFiles).parallelFiles).toEqual(concurrentFiles);
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

test('complete fast process-global hazards have unique typed isolation and single-file queues', async () => {
  const lockedHazardFiles = [
    'tests/contract/repository-audit.test.ts',
    'tests/unit/branch-lifecycle-temp-repo.test.ts',
    'tests/unit/ci-orchestration-git-isolation.test.ts',
    'tests/unit/exact-git-blob.test.ts',
    'tests/unit/test-runner.test.ts'
  ];
  const completeFastFiles = getFastTestFilesSync();
  assertFastTestProcessPolicyInventory(completeFastFiles);
  const detectedHazards = new Map<string, ProcessGlobalHazard[]>();

  await Promise.all(completeFastFiles.map(async (file) => {
    const hazards = processGlobalHazards(await fs.readFile(file, 'utf8'), file);
    if (hazards.length > 0) detectedHazards.set(file, hazards);
  }));

  expect([...detectedHazards.keys()]).toEqual(expect.arrayContaining(lockedHazardFiles));
  for (const [file, hazards] of detectedHazards) {
    expect(hazards.length).toBeGreaterThan(0);
    const entries = FAST_TEST_PROCESS_ISOLATION_REGISTRY.filter((entry) => entry.file === file);
    if (entries.length !== 1) {
      throw new Error(`Process-global test hazard has ${entries.length} isolation owners: ${file}`);
    }
    expect(entries[0]!.processLimit)
      .toBe(DEFAULT_FAST_TEST_RESOURCE_CLASS_LIMITS[entries[0]!.resourceClass]);
  }
  const detectedHazardFiles = [...detectedHazards.keys()];
  const plan = planFastTestProcesses(detectedHazardFiles);
  expect(plan.parallelFiles).toEqual([]);
  expect(plan.resourceClassOrder.flatMap((resourceClass) => plan.resourceQueues[resourceClass]).sort())
    .toEqual(detectedHazardFiles.sort());
});

test('fast process policy covers default-excluded files and rejects stale or duplicate identities', () => {
  const completeFastFiles = getFastTestFilesSync();
  const excludedFastFile = 'tests/unit/semantic-mutation-isolated-child-fence.test.ts';
  expect(DEFAULT_FAST_TEST_EXCLUDED_FILES).toContain(excludedFastFile);
  expect(isDefaultFastTestFile(excludedFastFile)).toBe(false);
  expect(completeFastFiles).toContain(excludedFastFile);
  expect(processGlobalHazards(
    "process.env.EXCLUDED_POLICY_SENTINEL = '1';",
    excludedFastFile
  )).toEqual([expect.objectContaining({
    kind: 'process-env-assignment'
  })]);
  expect(() => assertFastTestProcessPolicyInventory(completeFastFiles))
    .not.toThrow();

  const registeredFile = FAST_TEST_PROCESS_ISOLATION_REGISTRY[0]!.file;
  expect(() => assertFastTestProcessPolicyInventory(
    completeFastFiles.filter((file) => file !== registeredFile)
  )).toThrow(`Fast-test process isolation registration is stale: ${registeredFile}`);
  const definition = FAST_TEST_PROCESS_ISOLATION_REGISTRY[0]!;
  expect(() => assertUniqueFastTestProcessIsolationDefinitions([definition, definition]))
    .toThrow(`Fast-test process isolation registration is duplicated: ${definition.file}`);
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
    ...productionHostAndRuntimeLifecycleFiles
  ]);
  expect(resourcePlan.parallelFiles).toEqual([]);
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
    'repository-worktree': [],
    'host-profile': []
  });
  expect(resourcePlan.resourceLimits).toEqual(DEFAULT_FAST_TEST_RESOURCE_CLASS_LIMITS);
});

test('fast batch policy derives supervisor ceilings and waves from its canonical planner', () => {
  const testInventory = testImpactFixture.provider.testInventory;
  const budgetProjection = compileTestBudgetProjection(testInventory);
  const selectedFiles = budgetProjection.fastTestFiles.slice(0, 20);
  let inventoryReads = 0;
  let budgetReads = 0;
  const forgedCallerFields = {
    get testInventory() {
      return inventoryReads++ === 0 ? testInventory : { ...testInventory, inventoryDigest: 'sha256:forged' as const };
    },
    get budgetProjection() {
      return budgetReads++ === 0 ? budgetProjection : { ...budgetProjection, projectionDigest: 'sha256:forged' as const };
    },
    selectedFiles,
    bunOptions: [],
    workingDirectory: process.cwd(),
    supervisorTimeoutMs: Number.MAX_SAFE_INTEGER,
    executionWaves: [['forged:001']]
  };

  const policy = issueFastTestBatchExecutionPolicy(forgedCallerFields);
  expect(policy.testInventoryDigest).toBe(testInventory.inventoryDigest);
  expect(policy.budgetProjectionDigest).toBe(budgetProjection.projectionDigest);
  const canonicalSupervisorTimeoutMs = DEV_COMMAND_MAX_DURATION_MS;
  expect(policy.invocations.every(({ supervisorTimeoutMs }) => (
    supervisorTimeoutMs === canonicalSupervisorTimeoutMs
  ))).toBe(true);
  expect(policy.executionWaves).not.toEqual(forgedCallerFields.executionWaves);
  expect(policy.workingDirectory).toBe(compilerRoot);
  expect(policy.executionWaves.flat()).toEqual(policy.invocations.map(({ id }) => id));
  expect(policy.logicalRunTimeoutMs).toBe(
    AFFECTED_SELECTION_OPERATION_DURATION_MS
      + policy.executionWaves.length * canonicalSupervisorTimeoutMs
      + TEST_SUPERVISOR_SETTLEMENT_MARGIN_MS
  );
  expect(canonicalSupervisorTimeoutMs - DEFAULT_TEST_TIMEOUT_MS)
    .toBeGreaterThanOrEqual(TEST_SUPERVISOR_SETTLEMENT_MARGIN_MS);

  const admission = admitFastTestBatchExecutionPolicy(policy);
  assertIssuedFastTestBatchExecutionAdmission(admission);
  expect(admission.childDeadlineAtUnixMs).toBe(
    admission.logicalDeadlineAtUnixMs - TEST_SUPERVISOR_SETTLEMENT_MARGIN_MS
  );
  expect(admission.revalidationDeadlineAtUnixMs).toBe(
    admission.admittedAtUnixMs + AFFECTED_SELECTION_OPERATION_DURATION_MS
  );
  expect(() => admitFastTestBatchExecutionPolicy(policy)).toThrow('single-use');
  expect(() => assertIssuedFastTestBatchExecutionAdmission({ ...admission }))
    .toThrow('owner-issued admission');
});

test.serial('direct fast execution rejects unavailable inventory reobservation before child execution', async () => {
  testBudgetSnapshotOverrides.push(
    testImpactFixture.workspaceSnapshot,
    new Error('Inventory source became unavailable')
  );

  expect(await runFastTests(['tests/unit/path-containment.test.ts'])).toBe(1);
  expect(devCommandCalls).toEqual([]);
  expect(operationEvents).toContain('git-read-session');
});

// 这些测试使用全局 mock，必须串行执行以避免并发干扰
test.serial('targeted fast tests preserve ordinary sequential semantics', async () => {
  const code = await runFastTests(['tests/unit/path-containment.test.ts']);

  expect(code).toBe(0);
  expect(fastDependencyBootstrapCalls).toBe(1);
  expect(testDependencyBootstrapCalls).toBe(0);
  expect(devCommandEnvironments).toHaveLength(1);
  expect(devCommandEnvironments[0]?.SEC_SKIP_RUNTIME_DEPS_SETUP).toBe('1');
  expect(devCommandEnvironments[0]?.SEC_TEST_WORKSPACE_NAMESPACE).toMatch(/^fast-[0-9a-f]{64}$/u);
  expect(devCommandEnvironments[0]?.SEC_TEST_WORKSPACE_RUN_CHILD).toBeUndefined();
  expect(devCommandEnvironments[0]?.SEC_STATE_HOME).toMatch(
    /[\\/]invocation-runtime[\\/]parallel-001$/u
  );
  expect(devCommandEnvironments[0]?.SEC_CACHE_HOME).toMatch(
    /[\\/]invocation-runtime[\\/]parallel-001$/u
  );
  expect(devCommandCalls).toEqual([
    {
      command: 'bun',
      args: [
        'test',
        './tests/unit/path-containment.test.ts',
        ...DEFAULT_NATIVE_PARALLEL_ARGS,
        ...DEFAULT_MANAGED_INNER_ARGS,
        '--timeout',
        String(DEFAULT_TEST_TIMEOUT_MS)
      ]
    }
  ]);
});

test.serial('fast compiler bootstrap failure launches no managed test child', async () => {
  configureTestDependencyBootstrapFailure(new Error('compiler bootstrap failed'));

  await expect(runFastTests(['tests/unit/path-containment.test.ts']))
    .rejects.toThrow('compiler bootstrap failed');
  expect(fastDependencyBootstrapCalls).toBe(1);
  expect(testDependencyBootstrapCalls).toBe(0);
  expect(devCommandCalls).toEqual([]);
  expect(devCommandEnvironments).toEqual([]);
});

test.serial('fast tests preserve options across process shards and isolated invocations', async () => {
  const code = await runFastTests(['--timeout', '30000']);
  const defaultFastTestFiles = getFastTestFilesSync().filter(isDefaultFastTestFile);

  expect(code).toBe(0);
  const shardCalls = devCommandCalls.filter(({ args }) => invocationTestFiles(args).length > 1);
  expect(shardCalls.length).toBe(1);
  for (const call of shardCalls) {
    expect(call.command).toBe('bun');
    expect(call.args[0]).toBe('test');
    expect(call.args).not.toContain('--concurrent');
    expect(call.args).toEqual(expect.arrayContaining([...DEFAULT_NATIVE_PARALLEL_ARGS]));
    expect(call.args.slice(-2)).toEqual(['--timeout', '30000']);
    expect(call.args.some((arg) => isolatedFastTestFileSet.has(arg))).toBe(false);
    expect(call.args.some((arg) => arg.startsWith('tests/e2e/'))).toBe(false);
  }
  for (const file of FAST_TEST_PROCESS_ISOLATION_REGISTRY
    .map(({ file }) => file)
    .filter(isDefaultFastTestFile)) {
    expect(devCommandCalls).toContainEqual({
      command: 'bun',
      args: ['test', `./${file}`, ...DEFAULT_MANAGED_INNER_ARGS, '--timeout', '30000']
    });
  }
  const invokedFiles = devCommandCalls.flatMap(({ args }) => invocationTestFiles(args));
  expect([...invokedFiles].sort()).toEqual(defaultFastTestFiles);
  expect(DEFAULT_FAST_TEST_EXCLUDED_FILES.some((file) => invokedFiles.includes(file))).toBe(false);
  expect(new Set(invokedFiles).size).toBe(invokedFiles.length);
  expect(new Set(devCommandEnvironments.map(
    (env) => env.SEC_TEST_WORKSPACE_NAMESPACE
  )).size).toBe(1);
  expect(new Set(devCommandEnvironments.map((env) => env.SEC_STATE_HOME)).size)
    .toBe(devCommandEnvironments.length);
  expect(new Set(devCommandEnvironments.map((env) => env.SEC_CACHE_HOME)).size)
    .toBe(devCommandEnvironments.length);
  for (const environment of devCommandEnvironments) {
    expect(environment.SEC_STATE_HOME).toMatch(/[\\/]invocation-runtime[\\/][^\\/]+$/u);
    expect(environment.SEC_CACHE_HOME).toMatch(/[\\/]invocation-runtime[\\/][^\\/]+$/u);
    expect(path.basename(environment.SEC_STATE_HOME!)).toBe(path.basename(environment.SEC_CACHE_HOME!));
    expect(path.dirname(environment.SEC_STATE_HOME!)).not.toBe(path.dirname(environment.SEC_CACHE_HOME!));
  }
  expect(devCommandEnvironments.every(
    (env) => env.SEC_TEST_WORKSPACE_RUN_CHILD === undefined
  )).toBe(true);
});

test.serial('fast tests preserve equals-form timeout overrides without adding the default', async () => {
  const caseTimeoutMs = 45_000;
  const code = await runFastTests([
    'tests/unit/path-containment.test.ts',
    `--timeout=${caseTimeoutMs}`
  ]);

  expect(code).toBe(0);
  expect(devCommandCalls).toEqual([{
    command: 'bun',
    args: [
      'test',
      './tests/unit/path-containment.test.ts',
      ...DEFAULT_NATIVE_PARALLEL_ARGS,
      ...DEFAULT_MANAGED_INNER_ARGS,
      `--timeout=${caseTimeoutMs}`
    ]
  }]);
  const supervisorTimeoutMs = devCommandOptions[0]?.timeoutMs;
  expect(supervisorTimeoutMs).toBeNumber();
  expect(supervisorTimeoutMs!).toBeGreaterThan(caseTimeoutMs);
  expect(() => compileTestInvocationExecutionPolicy(
    devCommandCalls[0]!.args,
    supervisorTimeoutMs!
  )).not.toThrow();
});

test.serial('explicit inner concurrency is byte-preserved while managed outer concurrency adapts', async () => {
  const selectedFiles = getFastTestFilesSync()
    .filter((file) => !isolatedFastTestFileSet.has(file))
    .slice(0, 2);
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


test.serial('failed explicit resource batch settles started siblings then emits one bounded plan-order receipt', async () => {
  const independentFiles = [
    'tests/integration/pipeline-kernel.test.ts',
    'tests/integration/semantic-projections.test.ts'
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

test.serial('copied TCB recovery is one-file isolated and emits an exact diagnostic-only failure receipt', async () => {
  const file = 'tests/unit/ci-verification-execution.test.ts';
  const plan = planFastTestProcesses([file]);
  expect(plan.parallelFiles).toEqual([]);
  expect(plan.resourceQueues['independent-process']).toEqual([file]);
  devCommandExitCodes.push(7);
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (message?: unknown) => { errors.push(String(message)); };

  try {
    expect(await runFastTests([file])).toBe(7);
    expect(devCommandCalls).toEqual([{
      command: 'bun',
      args: ['test', `./${file}`, ...DEFAULT_MANAGED_INNER_ARGS, '--timeout', '180000']
    }]);
    const receipts = errors.filter((message) => message.startsWith(FAST_TEST_FAILURE_RECEIPT_PREFIX));
    expect(receipts).toHaveLength(1);
    const receipt = JSON.parse(receipts[0].slice(FAST_TEST_FAILURE_RECEIPT_PREFIX.length)) as {
      schema: string;
      replayAuthority: string;
      queue: string;
      failures: Array<{ selectedTestFiles: string[]; effectiveArgv: string[] }>;
    };
    expect(receipt).toMatchObject({
      schema: 'sec-fast-test-failure-receipt-v2',
      replayAuthority: 'none-diagnostic-only',
      queue: 'independent-process'
    });
    expect(receipt.failures).toHaveLength(1);
    expect(receipt.failures[0].selectedTestFiles).toEqual([file]);
    expect(receipt.failures[0].effectiveArgv.filter(isSecRepositoryTestModulePath)).toEqual([`./${file}`]);
  } finally {
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
  const laterClassFile = 'tests/unit/semantic-mutation-isolated-child-fence.test.ts';
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
    expect(devCommandCalls.some(({ args }) => invocationTestFiles(args).includes(laterClassFile))).toBe(false);
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
      const requiredCount = DEFAULT_FAST_TEST_RESOURCE_CLASS_LIMITS[resourceClass] + 1;
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
    const files = filesByClass[resourceClass];
    if (files.length === 0) continue;
    expect(files).toHaveLength(DEFAULT_FAST_TEST_RESOURCE_CLASS_LIMITS[resourceClass] + 1);
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
        expect(String(resourceClass)).toBe(wave.resourceClass);
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
      'tests/unit/semantic-mutation-isolated-child-fence.test.ts'
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

test.serial('deterministic resource-class owners run in class order', async () => {
  const code = await runFastTests([
    'tests/integration/pipeline-kernel.test.ts',
    'tests/integration/semantic-projections.test.ts',
    'tests/unit/semantic-mutation-isolated-child-fence.test.ts'
  ]);

  expect(code).toBe(0);
  expect(devCommandCalls).toEqual([
    {
      command: 'bun',
      args: [
        'test', './tests/integration/pipeline-kernel.test.ts', ...DEFAULT_MANAGED_INNER_ARGS,
        '--timeout', String(DEFAULT_TEST_TIMEOUT_MS)
      ]
    },
    {
      command: 'bun',
      args: [
        'test', './tests/integration/semantic-projections.test.ts', ...DEFAULT_MANAGED_INNER_ARGS,
        '--timeout', String(DEFAULT_TEST_TIMEOUT_MS)
      ]
    },
    {
      command: 'bun',
      args: [
        'test',
        './tests/unit/semantic-mutation-isolated-child-fence.test.ts',
        ...DEFAULT_MANAGED_INNER_ARGS,
        '--timeout',
        String(DEFAULT_TEST_TIMEOUT_MS)
      ]
    }
  ]);
});

test.serial('full test planning retains every default-excluded fast owner', async () => {
  const code = await runTests();

  expect(code).toBe(0);
  const invokedFiles = devCommandCalls.flatMap(({ args }) => invocationTestFiles(args));
  expect(invokedFiles).toEqual(expect.arrayContaining(DEFAULT_FAST_TEST_EXCLUDED_FILES));
  const fastFiles = new Set(getFastTestFilesSync());
  for (const [index, call] of devCommandCalls.entries()) {
    const files = invocationTestFiles(call.args);
    const environment = devCommandEnvironments[index]!;
    if (files.length > 0 && files.every((file) => fastFiles.has(file))) {
      expect(environment.SEC_STATE_HOME).toMatch(/[\\/]invocation-runtime[\\/][^\\/]+$/u);
      expect(environment.SEC_CACHE_HOME).toMatch(/[\\/]invocation-runtime[\\/][^\\/]+$/u);
    } else {
      expect(environment.SEC_STATE_HOME).toBeUndefined();
      expect(environment.SEC_CACHE_HOME).toBeUndefined();
    }
  }
});

test.serial('explicit fast test files skip dependency bootstrap entirely', async () => {
  const code = await runTests(['tests/unit/path-containment.test.ts', '--timeout', '10000']);

  expect(code).toBe(0);
  expect(fastDependencyBootstrapCalls).toBe(1);
  expect(testDependencyBootstrapCalls).toBe(0);
  expect(devCommandCalls).toEqual([{
    command: 'bun',
    args: [
      'test',
      './tests/unit/path-containment.test.ts',
      ...DEFAULT_NATIVE_PARALLEL_ARGS,
      ...DEFAULT_MANAGED_INNER_ARGS,
      '--timeout',
      '10000'
    ]
  }]);
  const environment = devCommandEnvironments[0]!;
  expect(path.basename(environment.SEC_STATE_HOME!)).toBe('parallel-001');
  expect(path.basename(environment.SEC_CACHE_HOME!)).toBe('parallel-001');
  const runtimeRoots = fastInvocationRunRoots(environment);
  await expect(fs.access(runtimeRoots.stateRoot)).rejects.toThrow();
  await expect(fs.access(runtimeRoots.cacheRoot)).rejects.toThrow();
});

test.serial('composite check reuses one materialized compiler capability without a second bootstrap', async () => {
  const prepared = compilerDependencyFixture satisfies OperationDependencyBootstrapResult;

  const code = await runFastTests(['tests/unit/path-containment.test.ts'], prepared);

  expect(code).toBe(0);
  expect(fastDependencyBootstrapCalls).toBe(0);
  expect(testDependencyBootstrapCalls).toBe(0);
});

test.serial('option-only selection preserves fast isolation and canonical slow dispatch', async () => {
  const args = ['--test-name-pattern', 'owner behavior'];
  const code = await runTests(args);

  expect(code).toBe(0);
  expect(devCommandCalls.length).toBeGreaterThan(1);
  const fastFiles = new Set(getFastTestFilesSync());
  for (const [index, call] of devCommandCalls.entries()) {
    expect(call.args).toEqual(expect.arrayContaining(args));
    const files = invocationTestFiles(call.args);
    const environment = devCommandEnvironments[index]!;
    if (files.length > 0 && files.every((file) => fastFiles.has(file))) {
      expect(environment.SEC_STATE_HOME).toMatch(/[\\/]invocation-runtime[\\/][^\\/]+$/u);
      expect(environment.SEC_CACHE_HOME).toMatch(/[\\/]invocation-runtime[\\/][^\\/]+$/u);
      const runtimeRoots = fastInvocationRunRoots(environment);
      await expect(fs.access(runtimeRoots.stateRoot)).rejects.toThrow();
      await expect(fs.access(runtimeRoots.cacheRoot)).rejects.toThrow();
    } else {
      expect(environment.SEC_STATE_HOME).toBeUndefined();
      expect(environment.SEC_CACHE_HOME).toBeUndefined();
    }
  }
});

test.serial('ambiguous direct selectors fail closed before dispatch', async () => {
  for (const args of [
    ['path-containment'],
    ['tests/unit/path-containment.test.ts', 'tests/e2e/workspace.test.ts']
  ]) {
    const priorCalls = devCommandCalls.length;
    expect(await runTests(args)).toBe(1);
    expect(devCommandCalls).toHaveLength(priorCalls);
  }
});

test.serial('exact slow selection bypasses the fast invocation runtime', async () => {

  const priorCalls = devCommandCalls.length;
  expect(await runTests(['tests/e2e/workspace.test.ts'])).toBe(0);
  expect(devCommandCalls).toHaveLength(priorCalls + 1);
  expect(devCommandEnvironments.at(-1)?.SEC_STATE_HOME).toBeUndefined();
  expect(devCommandEnvironments.at(-1)?.SEC_CACHE_HOME).toBeUndefined();
});

test.serial('failed fast children leave no run-owned workspace residue', async () => {
  materializeTestWorkspace = true;
  devCommandExitCodes.push(7);

  const code = await runFastTests(['tests/unit/path-containment.test.ts']);
  const workspaceEnv = devCommandEnvironments[0]!;

  expect(code).toBe(7);
  expect(workspaceEnv.SEC_TEST_WORKSPACE_NAMESPACE).toMatch(/^fast-/u);
  const runtimeRoots = fastInvocationRunRoots(workspaceEnv);
  await expect(fs.access(runtimeRoots.stateRoot)).rejects.toThrow();
  await expect(fs.access(runtimeRoots.cacheRoot)).rejects.toThrow();
});

test.serial('fast tests preserve the caller namespace and clean only a unique run-owned child', async () => {
  const parentNamespace = 'test-runner-explicit-namespace';
  const parentEnv = { [TEST_WORKSPACE_NAMESPACE_ENV]: parentNamespace };
  const parentRoot = getTestWorkspaceTempRoot(parentEnv);
  const sentinelPath = path.join(parentRoot, 'caller-owned-sentinel.txt');
  process.env[TEST_WORKSPACE_NAMESPACE_ENV] = parentNamespace;
  materializeTestWorkspace = true;
  await fs.mkdir(parentRoot, { recursive: true });
  await fs.writeFile(sentinelPath, 'caller-owned', 'utf8');

  try {
    const code = await runFastTests(['tests/unit/path-containment.test.ts']);
    const workspaceEnv = devCommandEnvironments[0]!;

    expect(code).toBe(0);
    expect(workspaceEnv[TEST_WORKSPACE_NAMESPACE_ENV]).toBe(parentNamespace);
    expect(workspaceEnv[TEST_WORKSPACE_RUN_CHILD_ENV]).toMatch(/^fast-[0-9a-f]{64}$/u);
    const runtimeRoots = fastInvocationRunRoots(workspaceEnv);
    expect(path.dirname(runtimeRoots.stateRoot)).not.toBe(parentRoot);
    expect(path.resolve(runtimeRoots.stateRoot).startsWith(path.resolve(compilerRoot))).toBe(false);
    expect(path.resolve(runtimeRoots.cacheRoot).startsWith(path.resolve(compilerRoot))).toBe(false);
    expect(await fs.readFile(sentinelPath, 'utf8')).toBe('caller-owned');
    await expect(fs.access(runtimeRoots.stateRoot)).rejects.toThrow();
    await expect(fs.access(runtimeRoots.cacheRoot)).rejects.toThrow();
  } finally {
    await fs.rm(parentRoot, { recursive: true, force: true });
  }
});

test.serial('overlapping fast runs sharing one caller namespace own disjoint cleanup children', async () => {
  const parentNamespace = 'test-runner-overlapping-parent';
  const parentEnv = { [TEST_WORKSPACE_NAMESPACE_ENV]: parentNamespace };
  const parentRoot = getTestWorkspaceTempRoot(parentEnv);
  const sentinelPath = path.join(parentRoot, 'caller-owned-sentinel.txt');
  const firstGate = deferred();
  const secondGate = deferred();
  const bothStarted = deferred();
  let started = 0;
  const observeStart = (): void => {
    started += 1;
    if (started === 2) bothStarted.resolve();
  };
  let runs: readonly Promise<number>[] = [];
  process.env[TEST_WORKSPACE_NAMESPACE_ENV] = parentNamespace;
  materializeTestWorkspace = true;
  devCommandSettlements.push(firstGate.promise, secondGate.promise);
  devCommandStartObservers.push(observeStart, observeStart);
  await fs.mkdir(parentRoot, { recursive: true });
  await fs.writeFile(sentinelPath, 'caller-owned', 'utf8');

  try {
    runs = [
      runFastTests(['tests/unit/path-containment.test.ts']),
      runFastTests(['tests/unit/path-containment.test.ts'])
    ];
    await bothStarted.promise;
    const childNamespaces = devCommandEnvironments.map(
      (env) => env[TEST_WORKSPACE_RUN_CHILD_ENV]
    );
    expect(childNamespaces).toHaveLength(2);
    expect(new Set(childNamespaces).size).toBe(2);
    expect(childNamespaces.every((value) => /^fast-[0-9a-f]{64}$/u.test(value ?? ''))).toBe(true);
    expect(devCommandEnvironments.every(
      (env) => env[TEST_WORKSPACE_NAMESPACE_ENV] === parentNamespace
    )).toBe(true);
    const runtimeRoots = devCommandEnvironments.map(fastInvocationRunRoots);
    expect(runtimeRoots.every(
      ({ stateRoot, cacheRoot }) => path.dirname(stateRoot) !== parentRoot &&
        !path.resolve(stateRoot).startsWith(path.resolve(compilerRoot)) &&
        !path.resolve(cacheRoot).startsWith(path.resolve(compilerRoot))
    )).toBe(true);
    expect(new Set(runtimeRoots.map(({ stateRoot }) => stateRoot)).size).toBe(2);
    expect(new Set(runtimeRoots.map(({ cacheRoot }) => cacheRoot)).size).toBe(2);
    expect(await fs.readFile(sentinelPath, 'utf8')).toBe('caller-owned');

    firstGate.resolve();
    secondGate.resolve();
    expect(await Promise.all(runs)).toEqual([0, 0]);
    for (const roots of runtimeRoots) {
      await expect(fs.access(roots.stateRoot)).rejects.toThrow();
      await expect(fs.access(roots.cacheRoot)).rejects.toThrow();
    }
    expect(await fs.readFile(sentinelPath, 'utf8')).toBe('caller-owned');
  } finally {
    firstGate.resolve();
    secondGate.resolve();
    await Promise.allSettled(runs);
    await fs.rm(parentRoot, { recursive: true, force: true });
  }
});

test.serial('fast tests reject an inherited run child instead of escaping its caller cleanup scope', async () => {
  process.env[TEST_WORKSPACE_NAMESPACE_ENV] = 'test-runner-existing-parent';
  process.env[TEST_WORKSPACE_RUN_CHILD_ENV] = `fast-${'e'.repeat(64)}`;

  await expect(runFastTests(['tests/unit/path-containment.test.ts']))
    .rejects.toThrow('runFastTests cannot start beneath an existing run-owned workspace child');
  expect(devCommandCalls).toEqual([]);
});

test.serial('fast tests consume one Gate-assigned physical child and scrub the opaque assignment', async () => {
  const parentNamespace = 'test-runner-gate-assigned-parent';
  const nonce = 'f'.repeat(64);
  const fakeRepositoryRoot = await fs.mkdtemp(path.join(tmpdir(), 'sec-test-runner-gate-repository-'));
  const executionSnapshotRoot = path.join(
    fakeRepositoryRoot,
    '.tmp',
    'gate-execution-snapshots',
    parentNamespace
  );
  const supervisorLease = createTestWorkspaceSupervisorLease({
    namespace: parentNamespace,
    runId: 'test-runner-gate-assigned',
    repositoryRoot: fakeRepositoryRoot,
    executionSnapshotRoot,
    issuerProcessId: process.ppid,
    nonce: 'e'.repeat(64)
  });
  const supervisorLeasePath = path.join(
    fakeRepositoryRoot,
    '.tmp',
    'test-workspaces',
    '.gate-supervisor-leases',
    `${parentNamespace}.lock`
  );
  await fs.mkdir(path.dirname(supervisorLeasePath), { recursive: true });
  await fs.writeFile(supervisorLeasePath, JSON.stringify(supervisorLease), { encoding: 'utf8', flag: 'wx' });
  const supervisorBinding = bindTestWorkspaceSupervisorLeaseIssuerProjection(
    supervisorLeasePath,
    parentNamespace,
    supervisorLease.executionSnapshotRoot
  );
  const draft = createTestWorkspaceRunChildAssignment({
    parentNamespace,
    issuerProcessId: process.ppid,
    device: 'draft-device',
    inode: 'draft-inode',
    nonce,
    supervisorLeaseDigest: supervisorLease.leaseDigest,
    supervisorLeasePath: supervisorBinding.path,
    supervisorLeaseDevice: supervisorBinding.device,
    supervisorLeaseInode: supervisorBinding.inode,
    namespaceDevice: 'draft-namespace-device',
    namespaceInode: 'draft-namespace-inode'
  });
  const parentRoot = getTestWorkspaceTempRoot({ [TEST_WORKSPACE_NAMESPACE_ENV]: parentNamespace });
  const runChild = draft.name;
  const runChildRoot = getTestWorkspaceTempRoot({
    [TEST_WORKSPACE_NAMESPACE_ENV]: parentNamespace,
    [TEST_WORKSPACE_RUN_CHILD_ENV]: runChild
  });
  await fs.mkdir(runChildRoot, { recursive: true });
  const namespaceIdentity = inspectNoFollowDirectoryChain(parentRoot).target;
  const identity = inspectNoFollowDirectoryChain(runChildRoot).target;
  const assignment = createTestWorkspaceRunChildAssignment({
    parentNamespace,
    issuerProcessId: process.ppid,
    device: identity.device,
    inode: identity.inode,
    nonce,
    supervisorLeaseDigest: supervisorLease.leaseDigest,
    supervisorLeasePath: supervisorBinding.path,
    supervisorLeaseDevice: supervisorBinding.device,
    supervisorLeaseInode: supervisorBinding.inode,
    namespaceDevice: namespaceIdentity.device,
    namespaceInode: namespaceIdentity.inode
  });
  process.env[TEST_WORKSPACE_NAMESPACE_ENV] = parentNamespace;
  process.env[TEST_WORKSPACE_RUN_CHILD_ENV] = runChild;
  process.env[TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT_ENV] = JSON.stringify(assignment);
  trustedCallerAssignmentFixture = assignment;
  try {
    const code = await runFastTests(['tests/unit/path-containment.test.ts']);
    const workspaceEnv = devCommandEnvironments[0]!;

    expect(code).toBe(0);
    expect(workspaceEnv[TEST_WORKSPACE_NAMESPACE_ENV]).toBe(parentNamespace);
    expect(workspaceEnv[TEST_WORKSPACE_RUN_CHILD_ENV]).toBe(runChild);
    expect(workspaceEnv[TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT_ENV]).toBeUndefined();
    expect(workspaceEnv[TEST_WORKSPACE_BOUND_CHILD_LOCATOR_ENV]).toBe(JSON.stringify(assignment));
    await expect(runFastTests(['tests/unit/path-containment.test.ts']))
      .rejects.toThrow('runFastTests caller assignment authority was already consumed');
  } finally {
    await fs.rm(parentRoot, { recursive: true, force: true });
    await fs.rm(fakeRepositoryRoot, { recursive: true, force: true });
  }
});

test.serial('a nested managed process cannot self-sign a new sibling beneath a live Gate supervisor', async () => {
  const parentNamespace = `test-runner-cross-process-${process.pid}-${Date.now()}`;
  const parentRoot = getTestWorkspaceTempRoot({
    [TEST_WORKSPACE_NAMESPACE_ENV]: parentNamespace
  });
  const fakeRepositoryRoot = await fs.mkdtemp(path.join(tmpdir(), 'sec-forged-gate-root-'));
  await fs.mkdir(parentRoot, { recursive: true });
  const source = `
    import { mkdirSync, writeFileSync } from 'node:fs';
    import path from 'node:path';
    import {
      bindTestWorkspaceSupervisorLeaseIssuerProjection,
      createTestWorkspaceRunChildAssignment,
      createTestWorkspaceSupervisorLease,
      getTestWorkspaceTempRoot,
      TEST_WORKSPACE_NAMESPACE_ENV,
      TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT_ENV,
      TEST_WORKSPACE_RUN_CHILD_ENV
    } from './src/adapters/self-hosting/development/runner/env-manager.ts';
    import { inspectNoFollowDirectoryChain } from './src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
    const parentNamespace = process.env[TEST_WORKSPACE_NAMESPACE_ENV];
    if (!parentNamespace) process.exit(7);
    const fakeRepositoryRoot = process.env.SEC_TEST_FAKE_GATE_REPOSITORY_ROOT;
    if (!fakeRepositoryRoot) process.exit(6);
    const executionSnapshotRoot = path.join(
      fakeRepositoryRoot,
      '.tmp',
      'gate-execution-snapshots',
      parentNamespace
    );
    const supervisorLease = createTestWorkspaceSupervisorLease({
      namespace: parentNamespace,
      runId: 'nested-self-issued',
      repositoryRoot: fakeRepositoryRoot,
      executionSnapshotRoot,
      issuerProcessId: process.pid,
      nonce: '${'c'.repeat(64)}'
    });
    const supervisorLeasePath = path.join(
      fakeRepositoryRoot,
      '.tmp',
      'test-workspaces',
      '.gate-supervisor-leases',
      parentNamespace + '.lock'
    );
    mkdirSync(path.dirname(supervisorLeasePath), { recursive: true });
    writeFileSync(supervisorLeasePath, JSON.stringify(supervisorLease), { flag: 'wx' });
    const supervisorBinding = bindTestWorkspaceSupervisorLeaseIssuerProjection(
      supervisorLeasePath,
      parentNamespace,
      executionSnapshotRoot
    );
    const draft = createTestWorkspaceRunChildAssignment({
      parentNamespace,
      issuerProcessId: process.pid,
      device: 'pending-device',
      inode: 'pending-inode',
      nonce: '${'b'.repeat(64)}',
      supervisorLeaseDigest: supervisorLease.leaseDigest,
      supervisorLeasePath: supervisorBinding.path,
      supervisorLeaseDevice: supervisorBinding.device,
      supervisorLeaseInode: supervisorBinding.inode,
      namespaceDevice: 'pending-namespace-device',
      namespaceInode: 'pending-namespace-inode'
    });
    const siblingEnv = {
      [TEST_WORKSPACE_NAMESPACE_ENV]: parentNamespace,
      [TEST_WORKSPACE_RUN_CHILD_ENV]: draft.name
    };
    const sibling = getTestWorkspaceTempRoot(siblingEnv);
    mkdirSync(sibling);
    writeFileSync(sibling + '/foreign-owner.txt', 'preserve');
    const namespaceIdentity = inspectNoFollowDirectoryChain(path.dirname(sibling)).target;
    const identity = inspectNoFollowDirectoryChain(sibling).target;
    const forged = createTestWorkspaceRunChildAssignment({
      parentNamespace,
      issuerProcessId: process.pid,
      device: identity.device,
      inode: identity.inode,
      nonce: '${'b'.repeat(64)}',
      supervisorLeaseDigest: supervisorLease.leaseDigest,
      supervisorLeasePath: supervisorBinding.path,
      supervisorLeaseDevice: supervisorBinding.device,
      supervisorLeaseInode: supervisorBinding.inode,
      namespaceDevice: namespaceIdentity.device,
      namespaceInode: namespaceIdentity.inode
    });
    const victim = Bun.spawn([process.execPath, '-e', \`
      import { runFastTests } from './src/adapters/self-hosting/development/runner/test-runner.ts';
      try {
        await runFastTests(['tests/unit/path-containment.test.ts']);
        process.exit(9);
      } catch (error) {
        if (!String(error).includes('Gate execution snapshot binding is invalid')) process.exit(8);
      }
    \`], {
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        [TEST_WORKSPACE_NAMESPACE_ENV]: parentNamespace,
        [TEST_WORKSPACE_RUN_CHILD_ENV]: forged.name,
        [TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT_ENV]: JSON.stringify(forged)
      }
    });
    process.exit(await victim.exited);
  `;
  try {
    const child = Bun.spawn([process.execPath, '-e', source], {
      cwd: compilerRoot,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        [TEST_WORKSPACE_NAMESPACE_ENV]: parentNamespace,
        SEC_TEST_FAKE_GATE_REPOSITORY_ROOT: fakeRepositoryRoot,
        [TEST_WORKSPACE_RUN_CHILD_ASSIGNMENT_ENV]: undefined
      }
    });
    expect(await child.exited).toBe(0);
    const siblings = await fs.readdir(parentRoot);
    expect(siblings).toHaveLength(1);
    expect(await fs.readFile(path.join(parentRoot, siblings[0]!, 'foreign-owner.txt'), 'utf8')).toBe('preserve');
  } finally {
    await fs.rm(parentRoot, { recursive: true, force: true });
    await fs.rm(fakeRepositoryRoot, { recursive: true, force: true });
  }
});

test.serial('invocation runtime cleanup failure remains visible and nonzero', async () => {
  invocationRuntimeCleanupFailure = new Error('runtime cleanup sentinel');
  const errors: string[] = [];
  const originalError = console.error;
  console.error = (message?: unknown) => { errors.push(String(message)); };

  try {
    const code = await runFastTests(['tests/unit/path-containment.test.ts']);

    expect(code).toBe(1);
    expect(devCommandCalls).toHaveLength(1);
    expect(errors).toContain('Fast test invocation runtime cleanup failed: runtime cleanup sentinel');
  } finally {
    console.error = originalError;
  }
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
    'tests/integration/semantic-projections.test.ts'
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
  const runtimeRoots = fastInvocationRunRoots(workspaceEnv);
  await expect(fs.access(runtimeRoots.stateRoot)).rejects.toThrow();
  await expect(fs.access(runtimeRoots.cacheRoot)).rejects.toThrow();
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
    expect(testDependencyBootstrapCalls).toBe(0);
    expect(devCommandCalls).toEqual([]);
    expect(errors).toContain('Fast test runner cannot run slow test files: tests/e2e/registry.test.ts');
  } finally {
    console.error = originalError;
  }
});

test.serial('slow suite selector applies the shared default timeout', async () => {
  const suiteFiles = slowTestSuiteFiles('e2e-pipeline');
  const code = await runSlowTests(['--suite', 'e2e-pipeline']);

  expect(code).toBe(0);
  expect(suiteFiles.length).toBeGreaterThan(0);
  expect(devCommandCalls).toEqual([
    { command: 'bun', args: ['test', ...suiteFiles, '--timeout', String(DEFAULT_TEST_TIMEOUT_MS)] }
  ]);
});

test.serial('slow suite selector preserves an explicit timeout override', async () => {
  const suiteFiles = slowTestSuiteFiles('e2e-pipeline');
  const code = await runSlowTests(['--suite', 'e2e-pipeline', '--timeout=240000']);

  expect(code).toBe(0);
  expect(devCommandCalls).toEqual([
    { command: 'bun', args: ['test', ...suiteFiles, '--timeout=240000'] }
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
    expect(testDependencyBootstrapCalls).toBe(0);
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
      owners: ['dev-runner', 'verification.test-governance'],
      selectedFastTests: [
        TEST_ARCHITECTURE_POLICY_TEST_FILE,
        'tests/unit/path-containment.test.ts',
        FAST_TEST_PROCESS_POLICY_TEST_FILE
      ],
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

test.serial('canonical docs-only Git selection does not construct ProjectInput or select tests', async () => {
  changedFiles = ['docs/运行/保证/要求证据与裁决.md'];
  const execution = await resolveAffectedTestExecutionWithIssuer({
    operation: compileAffectedTestSelectionSemanticOperation({ purpose: 'check-affected' }),
    issueTestImpactProjection: canonicalAffectedIssuer
  });

  expect(execution).not.toBeNull();
  expect(execution!.projectGenerationEvidence).toBeNull();
  expect(execution!.plan.changedPaths).toEqual(changedFiles);
  expect(execution!.plan.selectedFastTests).toEqual([]);
  expect(execution!.plan.identity?.sourceEpoch).toBeNull();
  expect(await execution!.run()).toBe(0);
  expect(testDependencyBootstrapCalls).toBe(0);
  expect(devCommandCalls).toEqual([]);
});

test.serial('affected plan applies the same process-policy sentinel to a default-excluded fast test', async () => {
  changedFiles = ['tests/unit/semantic-mutation-isolated-child-fence.test.ts'];
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
      changedPaths: ['tests/unit/semantic-mutation-isolated-child-fence.test.ts'],
      owners: ['dev-runner', 'verification.test-governance'],
      selectedFastTests: [
        TEST_ARCHITECTURE_POLICY_TEST_FILE,
        'tests/unit/semantic-mutation-isolated-child-fence.test.ts',
        FAST_TEST_PROCESS_POLICY_TEST_FILE
      ],
      unresolvedPaths: [],
      resolved: true
    });
    expect(testDependencyBootstrapCalls).toBe(0);
    expect(devCommandCalls).toEqual([]);
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
      owners: ['dev-runner', 'verification.test-governance'],
      selectedFastTests: [
        TEST_ARCHITECTURE_POLICY_TEST_FILE,
        FAST_TEST_PROCESS_POLICY_TEST_FILE
      ],
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

test.serial('resolved affected plan executes only after its final Git revalidation', async () => {
  changedFiles = ['tests/unit/path-containment.test.ts'];
  const execution = await resolveAffectedTestExecution();
  expect(execution).not.toBeNull();
  expect(Object.isFrozen(execution)).toBe(true);
  expect(Object.isFrozen(execution!.plan)).toBe(true);
  expect(Object.isFrozen(execution!.plan.selectedFastTests)).toBe(true);
  expect(() => assertWorkspaceTypeScriptProjectGenerationEvidence(
    execution!.projectGenerationEvidence!
  )).not.toThrow();
  expect(JSON.stringify(execution!.plan)).not.toContain('projectGenerationEvidence');
  // Resolution performs one bounded observation fence; run() performs the
  // required last-mile fence immediately before child admission.
  const resolutionCommandCount = commandCalls.length;
  const resolutionSessionCount = gitReadSessions.length;
  const resolutionSessions = new Set(gitReadSessions);
  const resolutionEventCount = operationEvents.length;
  expect(resolutionCommandCount).toBeGreaterThan(0);
  expect(resolutionSessionCount).toBeGreaterThan(0);
  const code = await execution!.run();

  expect(code).toBe(0);
  expect(commandCalls.length).toBeGreaterThan(resolutionCommandCount);
  expect(gitReadSessions.length).toBeGreaterThan(resolutionSessionCount);
  const executionEvents = operationEvents.slice(resolutionEventCount);
  const firstChildAdmission = executionEvents.indexOf('dev-command');
  expect(firstChildAdmission).toBeGreaterThan(0);
  expect(executionEvents.slice(0, firstChildAdmission)).toContain('git-read-session');
  for (const session of gitReadSessions) {
    expect(actualGitReadEnvironment.isProductionGitReadSession(session)).toBe(false);
    expect(actualGitReadEnvironment.isTestGitReadSession(session)).toBe(true);
    expect(session.consumeRecords(0)).toMatchObject({
      reason: 'command-error',
      detail: 'Git read session is closed.'
    });
  }
  expect(gitReadSessionDeadlineRequests.length).toBeGreaterThan(resolutionSessionCount);
  expect(gitReadSessions.slice(resolutionSessionCount).every((session) => (
    !resolutionSessions.has(session)
  ))).toBe(true);
  expect(fastDependencyBootstrapCalls).toBe(1);
  expect(testDependencyBootstrapCalls).toBe(0);
  expect(devCommandCalls).toHaveLength(2);
});

test.serial('affected execution rejects same-path modified content drift even when Git summaries are unchanged', async () => {
  changedFiles = [samePathContentDriftPath];
  let observationCount = 0;
  const execution = await resolveAffectedTestExecutionWithIssuer({
    operation: compileAffectedTestSelectionSemanticOperation({ purpose: 'check-affected' }),
    verifyAtResolution: false,
    issueTestImpactProjection: async () => {
      observationCount += 1;
      return testImpactFixture.affectedObservation;
    }
  });
  expect(execution).not.toBeNull();
  const initialGitCommandCount = commandCalls.length;
  testBudgetSnapshotOverrides.push(samePathContentDriftSnapshot);

  expect(await execution!.run()).toBe(1);
  expect(observationCount).toBe(1);
  expect(commandCalls.length).toBeGreaterThan(initialGitCommandCount);
  expect(devCommandCalls).toEqual([]);
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

test.serial('affected-test Git discovery requests byte-preserving stdout through the retained Git provider', async () => {
  changedFiles = ['tests/unit/path-containment.test.ts'];
  const code = await runAffectedTests();

  expect(code).toBe(0);
  expect(commandCalls.length).toBeGreaterThan(0);
  expect(commandCalls.every((call) => (
    (call.command === 'git' || path.basename(call.command).toLowerCase().startsWith('git.'))
    && call.stdoutMode === 'bytes'
  ))).toBe(true);
  expect(commandCalls.some((call) => call.args.some((arg) => arg.startsWith('diff')))).toBe(true);
  expect(commandCalls.some((call) => call.args.includes('ls-files'))).toBe(true);
});

test.serial('affected base ref validation rejects option-like, NUL, and oversized values before Git effect', async () => {
  for (const value of [
    '--verify',
    'a'.repeat(257)
  ]) {
    process.env.SEC_AFFECTED_TESTS_BASE = value;
    commandCalls.length = 0;
    expect(await runAffectedTests(['--plan'])).toBe(1);
    expect(commandCalls).toEqual([]);
  }

  process.env.SEC_AFFECTED_TESTS_BASE = `main${String.fromCharCode(0)}suffix`;
  commandCalls.length = 0;
  await expect(runAffectedTests(['--plan'])).rejects.toThrow('NUL');
  expect(commandCalls).toEqual([]);
});

test.serial('affected tests do not fabricate semantic Contract ownership outside the exact fixture tree', async () => {
  changedFiles = ['catalog/registry/official/ticket.basic/contracts/ticket.yaml'];

  const code = await runAffectedTests();

  expect(code).toBe(1);
  expect(testDependencyBootstrapCalls).toBe(0);
  expect(devCommandCalls).toEqual([]);
});

test.serial('affected tests combine multiple tracked fast-test facts with policy coverage', async () => {
  changedFiles = [
    'tests/contract/usage.test.ts',
    'tests/unit/path-containment.test.ts'
  ];

  const code = await runAffectedTests();

  expect(code).toBe(0);
  expect(devCommandCalls).toHaveLength(2);
  const concurrentInvocation = devCommandCalls.find((call) => (
    Array.isArray(call.args) && invocationTestFiles(call.args).includes('tests/unit/path-containment.test.ts')
  ));
  expect(concurrentInvocation?.command).toBe('bun');
  expect(concurrentInvocation?.args[0]).toBe('test');
  expect(concurrentInvocation?.args).not.toContain('--concurrent');
  expect(concurrentInvocation?.args).toContain('./tests/contract/usage.test.ts');
  expect(concurrentInvocation?.args).toContain('./tests/unit/path-containment.test.ts');
  expect(devCommandCalls.flatMap((call) => invocationTestFiles(call.args)))
    .toContain(FAST_TEST_PROCESS_POLICY_TEST_FILE);
  expect(devCommandCalls.flatMap((call) => invocationTestFiles(call.args)))
    .toContain(TEST_ARCHITECTURE_POLICY_TEST_FILE);
});

test.serial('affected tests run changed fast files with the global test-policy sentinels', async () => {
  changedFiles = ['tests/unit/path-containment.test.ts'];
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (message?: unknown) => {
    logs.push(String(message));
  };

  try {
    const code = await runAffectedTests();

    expect(code).toBe(0);
    expect(devCommandCalls.flatMap((call) => invocationTestFiles(call.args)).sort()).toEqual([
      FAST_TEST_PROCESS_POLICY_TEST_FILE,
      TEST_ARCHITECTURE_POLICY_TEST_FILE,
      'tests/unit/path-containment.test.ts'
    ].sort());
    const ordinaryInvocation = devCommandCalls.find((call) => (
      Array.isArray(call.args) && invocationTestFiles(call.args).includes('tests/unit/path-containment.test.ts')
    ));
    expect(ordinaryInvocation).toBeDefined();
    const ordinaryArgs = [...ordinaryInvocation!.args];
    expect(ordinaryInvocation!.command).toBe('bun');
    expect(ordinaryArgs).toContain('test');
    expect(ordinaryArgs).toContain('./tests/unit/path-containment.test.ts');
    expect(ordinaryArgs).not.toContain('--concurrent');
    expect(devCommandCalls.find((call) => (
      Array.isArray(call.args) && invocationTestFiles(call.args).includes(FAST_TEST_PROCESS_POLICY_TEST_FILE)
    )))
      .toMatchObject({
        command: 'bun',
        args: [
          'test', `./${FAST_TEST_PROCESS_POLICY_TEST_FILE}`, ...DEFAULT_MANAGED_INNER_ARGS,
          '--timeout', String(DEFAULT_TEST_TIMEOUT_MS)
        ]
      });
  } finally {
    console.log = originalLog;
  }
});

test.serial('affected tests isolate changed serial fast files', async () => {
  changedFiles = ['tests/unit/test-runner.test.ts'];

  const code = await runAffectedTests();

  expect(code).toBe(0);
  expect(devCommandCalls.flatMap((call) => invocationTestFiles(call.args)).sort()).toEqual([
    TEST_ARCHITECTURE_POLICY_TEST_FILE,
    'tests/unit/test-runner.test.ts'
  ].sort());
  expect(devCommandCalls.find((call) => invocationTestFiles(call.args).includes('tests/unit/test-runner.test.ts'))).toMatchObject({
    command: 'bun',
    args: [
      'test', './tests/unit/test-runner.test.ts', ...DEFAULT_MANAGED_INNER_ARGS,
      '--timeout', String(DEFAULT_TEST_TIMEOUT_MS)
    ]
  });
});

test.serial('affected tests select the process-policy sentinel for the MainHealth hazard regression', async () => {
  changedFiles = ['tests/unit/physical-no-follow.test.ts'];

  const code = await runAffectedTests();

  expect(code).toBe(0);
  expect(devCommandCalls.flatMap((call) => invocationTestFiles(call.args)).sort()).toEqual([
    FAST_TEST_PROCESS_POLICY_TEST_FILE,
    TEST_ARCHITECTURE_POLICY_TEST_FILE,
    'tests/unit/physical-no-follow.test.ts'
  ].sort());
  expect(devCommandCalls).toHaveLength(3);
  expect(devCommandCalls.every((call) => call.args[0] === 'test')).toBe(true);
  expect(devCommandCalls.every((call) => !call.args.includes('--concurrent'))).toBe(true);
});

test.serial('affected tests run the architecture policy sentinel for changed slow files', async () => {
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
    expect(devCommandCalls.flatMap((call) => invocationTestFiles(call.args)))
      .toEqual([TEST_ARCHITECTURE_POLICY_TEST_FILE]);
    expect(errors).toEqual([]);
    expect(logs).toContain('Changed slow test files require canonical slow-test closure or release/full verification: tests/e2e/registry.test.ts');
    expect(logs.some((line) => line.includes(TEST_ARCHITECTURE_POLICY_TEST_FILE))).toBe(true);
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
});

test.serial('affected plan projects required policy coverage for a changed slow test (Issue #206)', async () => {
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
    expect(vr.reasonCode).toBe('not-dispatched');
    expect(vr.applicability).toBe('required');
    expect(plan.selectionTrustBoundary).toBe('applicable-with-tests');
    expect(plan.selectedFastTests).toEqual([TEST_ARCHITECTURE_POLICY_TEST_FILE]);
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
