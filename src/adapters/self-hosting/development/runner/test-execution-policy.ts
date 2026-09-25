/** One default per-test deadline for every canonical test lane. */
import { deepFreeze, sha256 } from '../../../../contracts/canonical.ts';
import {
  bindSemanticOperation,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type BoundSemanticOperation,
  type CapabilityBinding,
  type OperationDigest,
  type SemanticOperationPlan
} from '../../../../execution/operation/semantic.ts';
import {
  RETAINED_WINDOWS_REPOSITORY_CHANGE_OBSERVER_CONTRACT_DIGEST,
  RETAINED_WINDOWS_REPOSITORY_CHANGE_OBSERVER_REQUIREMENT_ID
} from '../../../runtime-state/physical/runtime/windows-repository-change-observer.ts';
import {
  assertTestBudgetExecutionProvenance,
  type IssuedTestInventoryProjection,
  type TestBudgetProjection
} from '../../../verification/platform/test-impact/contract/budget.ts';
import { compilerRoot } from "../../../workspace-context.ts";
import { AFFECTED_SELECTION_OPERATION_DURATION_MS } from './affected-plan-contract.ts';
import { DEV_COMMAND_MAX_DURATION_MS } from './contract.ts';
import {
  DEFAULT_FAST_TEST_CONCURRENCY_BUDGET,
  DEFAULT_FAST_TEST_MAX_CONCURRENCY,
  FAST_TEST_PROCESS_RESOURCE_CLASS_ORDER,
  planFastTestProcesses,
  resolveManagedFastTestConcurrency,
  type FastTestProcessResourceClass
} from './fast-test-policy.ts';
import { applyDefaultFastTestConcurrency, explicitFastTestMaxConcurrency } from './test-concurrency-policy.ts';

export const DEFAULT_TEST_TIMEOUT_MS = 180_000;
/** Time reserved after a Bun case deadline for child-tree terminal observation. */
export const TEST_SUPERVISOR_SETTLEMENT_MARGIN_MS = 30_000;
/** Keeps a declared Effect operation and cleanup strictly inside Bun's case deadline. */
export const EFFECTFUL_TEST_CASE_SETTLEMENT_GUARD_MS = 1_000;
/** One semantic operation binds registration, policy, terminal, and readback provenance. */
export const EFFECTFUL_TEST_SEMANTIC_OPERATION = 'verification.effectful-test' as const;
export const TEST_SUITE_EXECUTION_OPERATION = 'development.runner.test-suite' as const;
export const TEST_SUITE_CHILD_REQUIREMENT_ID = 'development.runner.test-suite.bun-child' as const;
const FAST_TEST_BATCH_EXECUTION_OPERATION = 'development.runner.fast-test-batch' as const;

export type TestInvocationExecutionPolicy = Readonly<{
  caseTimeoutMs: number;
  supervisorTimeoutMs: number;
}>;

export type TestSuiteExecutionPolicy = Readonly<{
  schema: 'sec-test-suite-execution-policy-v1';
  suiteId: string;
  suiteOwner: string;
  files: readonly string[];
  testInventoryDigest: `sha256:${string}`;
  budgetProjectionDigest: `sha256:${string}`;
  logicalRunTimeoutMs: number;
  settlementMarginMs: number;
  caseTimeoutMs: number;
  canonicalArgv: readonly string[];
  workingDirectory: string;
  policyDigest: `sha256:${string}`;
}>;

export type TestSuiteExecutionAdmission = Readonly<{
  policy: TestSuiteExecutionPolicy;
  admittedAtUnixMs: number;
  logicalDeadlineAtUnixMs: number;
  revalidationDeadlineAtUnixMs: number;
  childDeadlineAtUnixMs: number;
}>;

type FastTestBatchInvocationPolicy = Readonly<{
  id: string;
  queue: 'parallel' | FastTestProcessResourceClass;
  files: readonly string[];
  canonicalArgv: readonly string[];
  supervisorTimeoutMs: number;
}>;

export type FastTestBatchExecutionPolicy = Readonly<{
  schema: 'sec-fast-test-batch-execution-policy-v1';
  files: readonly string[];
  testInventoryDigest: `sha256:${string}`;
  budgetProjectionDigest: `sha256:${string}`;
  invocations: readonly FastTestBatchInvocationPolicy[];
  executionWaves: readonly (readonly string[])[];
  concurrentProcessLimit: number;
  resourceClassOrder: readonly FastTestProcessResourceClass[];
  resourceLimits: Readonly<Record<FastTestProcessResourceClass, number>>;
  logicalRunTimeoutMs: number;
  settlementMarginMs: number;
  workingDirectory: string;
  policyDigest: `sha256:${string}`;
}>;

export type FastTestBatchExecutionAdmission = Readonly<{
  policy: FastTestBatchExecutionPolicy;
  admittedAtUnixMs: number;
  logicalDeadlineAtUnixMs: number;
  revalidationDeadlineAtUnixMs: number;
  childDeadlineAtUnixMs: number;
  operationPlan: SemanticOperationPlan;
}>;

const issuedTestSuiteExecutionPolicies = new WeakSet<object>();
const consumedTestSuiteExecutionPolicies = new WeakSet<object>();
const issuedTestSuiteExecutionAdmissions = new WeakSet<object>();
const issuedFastTestBatchExecutionPolicies = new WeakSet<object>();
const consumedFastTestBatchExecutionPolicies = new WeakSet<object>();
const issuedFastTestBatchExecutionAdmissions = new WeakSet<object>();
const boundFastTestBatchExecutionAdmissions = new WeakSet<object>();

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length
    && new Set(left).size === left.length
    && left.every((value) => right.includes(value));
}

export function issueFastTestBatchExecutionPolicy(input: Readonly<{
  testInventory: IssuedTestInventoryProjection;
  budgetProjection: TestBudgetProjection;
  selectedFiles: readonly string[];
  bunOptions: readonly string[];
}>): FastTestBatchExecutionPolicy {
  const budgetProjection = input.budgetProjection;
  const testInventory = input.testInventory;
  assertTestBudgetExecutionProvenance(budgetProjection, testInventory);
  const files = Object.freeze([...input.selectedFiles]);
  if (files.length === 0 || !sameStringSet(files, files)
      || files.some((file) => !budgetProjection.fastTestFiles.includes(file))) {
    throw new Error('Fast test batch requires unique current canonical fast test files.');
  }
  const bunOptions = canonicalBunTestOptions(input.bunOptions);
  for (const option of bunOptions) {
    const name = option.split('=', 1)[0]!;
    if (['--parallel', '--isolate', '--no-isolate', '--no-orphans'].includes(name)) {
      throw new Error(`Bun ${name} is owned by the fast test execution policy.`);
    }
  }
  const managedConcurrency = resolveManagedFastTestConcurrency(
    DEFAULT_FAST_TEST_CONCURRENCY_BUDGET,
    explicitFastTestMaxConcurrency(bunOptions)
  );
  const processPlan = planFastTestProcesses(files);
  const invocation = (
    queue: 'parallel' | FastTestProcessResourceClass,
    invocationFiles: readonly string[],
    index: number
  ): FastTestBatchInvocationPolicy => {
    const boundedOptions = explicitFastTestMaxConcurrency(bunOptions) === null
      ? ['--max-concurrency', String(managedConcurrency.innerConcurrency), ...bunOptions]
      : bunOptions;
    const args = [
      'test', ...invocationFiles.map((file) => `./${file}`),
      ...(queue === 'parallel'
        ? [`--parallel=${managedConcurrency.outerProcessConcurrency}`, '--isolate']
        : []),
      '--no-orphans', ...withDefaultTestTimeout(boundedOptions)
    ];
    const executionPolicy = compileTestInvocationExecutionPolicy(args, DEV_COMMAND_MAX_DURATION_MS);
    return deepFreeze({
      id: `${queue}:${String(index + 1).padStart(3, '0')}`,
      queue,
      files: Object.freeze([...invocationFiles]),
      canonicalArgv: Object.freeze(['bun', ...args]),
      supervisorTimeoutMs: executionPolicy.supervisorTimeoutMs
    });
  };
  const concurrentInvocations = processPlan.parallelFiles.length === 0
    ? []
    : [invocation('parallel', processPlan.parallelFiles, 0)];
  const resourceInvocations = Object.fromEntries(FAST_TEST_PROCESS_RESOURCE_CLASS_ORDER.map(
    (resourceClass) => [resourceClass, processPlan.resourceQueues[resourceClass].map(
      (file, index) => invocation(resourceClass, [file], index)
    )]
  )) as Record<FastTestProcessResourceClass, FastTestBatchInvocationPolicy[]>;
  const invocations = Object.freeze([
    ...concurrentInvocations,
    ...FAST_TEST_PROCESS_RESOURCE_CLASS_ORDER.flatMap((resourceClass) => resourceInvocations[resourceClass])
  ]);
  const wavesFor = (
    selectedInvocations: readonly FastTestBatchInvocationPolicy[],
    concurrency: number
  ): readonly (readonly string[])[] => {
    const waves: (readonly string[])[] = [];
    for (let index = 0; index < selectedInvocations.length; index += concurrency) {
      waves.push(Object.freeze(selectedInvocations.slice(index, index + concurrency).map(({ id }) => id)));
    }
    return waves;
  };
  const executionWaves = Object.freeze([
    ...wavesFor(concurrentInvocations, managedConcurrency.outerProcessConcurrency),
    ...FAST_TEST_PROCESS_RESOURCE_CLASS_ORDER.flatMap((resourceClass) => wavesFor(
      resourceInvocations[resourceClass],
      managedConcurrency.resourceClassLimits[resourceClass]
    ))
  ]);
  if (!sameStringSet(files, invocations.flatMap(({ files: invocationFiles }) => invocationFiles))) {
    throw new Error('Fast test batch planner did not dispatch every selected file exactly once.');
  }
  const invocationById = new Map(invocations.map((invocation) => [invocation.id, invocation]));
  const executionDurationMs = executionWaves.reduce((total, wave) => {
    const waveDuration = Math.max(...wave.map((id) => invocationById.get(id)!.supervisorTimeoutMs));
    const next = total + waveDuration;
    if (!Number.isSafeInteger(next)) throw new Error('Fast test batch duration exceeds the safe integer range.');
    return next;
  }, 0);
  const logicalRunTimeoutMs = AFFECTED_SELECTION_OPERATION_DURATION_MS
    + executionDurationMs
    + TEST_SUPERVISOR_SETTLEMENT_MARGIN_MS;
  if (!Number.isSafeInteger(logicalRunTimeoutMs)) {
    throw new Error('Fast test batch logical duration exceeds the safe integer range.');
  }
  const unsigned = deepFreeze({
    schema: 'sec-fast-test-batch-execution-policy-v1' as const,
    files,
    testInventoryDigest: testInventory.inventoryDigest,
    budgetProjectionDigest: budgetProjection.projectionDigest,
    invocations,
    executionWaves,
    concurrentProcessLimit: managedConcurrency.outerProcessConcurrency,
    resourceClassOrder: FAST_TEST_PROCESS_RESOURCE_CLASS_ORDER,
    resourceLimits: managedConcurrency.resourceClassLimits,
    logicalRunTimeoutMs,
    settlementMarginMs: TEST_SUPERVISOR_SETTLEMENT_MARGIN_MS,
    workingDirectory: compilerRoot
  });
  const policy = deepFreeze({
    ...unsigned,
    policyDigest: sha256(unsigned) as `sha256:${string}`
  });
  issuedFastTestBatchExecutionPolicies.add(policy);
  return policy;
}

export function assertIssuedFastTestBatchExecutionAdmission(
  admission: FastTestBatchExecutionAdmission
): void {
  if (!issuedFastTestBatchExecutionAdmissions.has(admission)) {
    throw new Error('Fast test batch execution requires an owner-issued admission.');
  }
}

export function admitFastTestBatchExecutionPolicy(
  policy: FastTestBatchExecutionPolicy
): FastTestBatchExecutionAdmission {
  if (!issuedFastTestBatchExecutionPolicies.has(policy)) {
    throw new Error('Fast test batch execution requires an owner-issued policy.');
  }
  if (consumedFastTestBatchExecutionPolicies.has(policy)) {
    throw new Error('Fast test batch execution policy is single-use.');
  }
  const admittedAtUnixMs = Date.now();
  const logicalDeadlineAtUnixMs = admittedAtUnixMs + policy.logicalRunTimeoutMs;
  const revalidationDeadlineAtUnixMs = admittedAtUnixMs + AFFECTED_SELECTION_OPERATION_DURATION_MS;
  const childDeadlineAtUnixMs = logicalDeadlineAtUnixMs - policy.settlementMarginMs;
  if (!Number.isSafeInteger(logicalDeadlineAtUnixMs)
      || !Number.isSafeInteger(revalidationDeadlineAtUnixMs)
      || revalidationDeadlineAtUnixMs > childDeadlineAtUnixMs
      || childDeadlineAtUnixMs <= admittedAtUnixMs) {
    throw new Error('Fast test batch execution admission deadline is invalid.');
  }
  consumedFastTestBatchExecutionPolicies.add(policy);
  const operationPlan = compileSemanticOperationPlan({
    operation: FAST_TEST_BATCH_EXECUTION_OPERATION,
    intentDigest: policy.policyDigest as OperationDigest,
    decisionDigest: policy.policyDigest as OperationDigest,
    deadlineAtUnixMs: logicalDeadlineAtUnixMs,
    attempt: issueSemanticOperationAttemptContext({ authorityGrantDigest: policy.policyDigest as OperationDigest }),
    aggregateBudgets: [{ resource: 'duration-ms', maximum: policy.logicalRunTimeoutMs }],
    requirements: [{
      id: RETAINED_WINDOWS_REPOSITORY_CHANGE_OBSERVER_REQUIREMENT_ID,
      contractDigest: RETAINED_WINDOWS_REPOSITORY_CHANGE_OBSERVER_CONTRACT_DIGEST,
      effectKinds: ['filesystem'],
      failureKinds: ['provider.deadline-exhausted', 'provider.unavailable', 'provider.unverified']
    }]
  });
  const admission = deepFreeze({
    policy,
    admittedAtUnixMs,
    logicalDeadlineAtUnixMs,
    revalidationDeadlineAtUnixMs,
    childDeadlineAtUnixMs,
    operationPlan
  });
  issuedFastTestBatchExecutionAdmissions.add(admission);
  return admission;
}

export function bindFastTestBatchExecutionAdmission(
  admission: FastTestBatchExecutionAdmission,
  providerBinding: CapabilityBinding
): BoundSemanticOperation {
  assertIssuedFastTestBatchExecutionAdmission(admission);
  if (boundFastTestBatchExecutionAdmissions.has(admission)) {
    throw new Error('Fast test batch execution admission was already bound.');
  }
  if (providerBinding.requirementId !== RETAINED_WINDOWS_REPOSITORY_CHANGE_OBSERVER_REQUIREMENT_ID
      || providerBinding.contractDigest !== RETAINED_WINDOWS_REPOSITORY_CHANGE_OBSERVER_CONTRACT_DIGEST) {
    throw new Error('Fast test batch observer provider binding is invalid.');
  }
  boundFastTestBatchExecutionAdmissions.add(admission);
  return bindSemanticOperation(admission.operationPlan, [providerBinding]);
}

export function issueTestSuiteExecutionPolicy(input: Readonly<{
  testInventory: IssuedTestInventoryProjection;
  budgetProjection: TestBudgetProjection;
  suiteId: string;
  selectedFiles: readonly string[];
  bunOptions: readonly string[];
  workingDirectory: string;
}>): TestSuiteExecutionPolicy {
  const budgetProjection = input.budgetProjection;
  const testInventory = input.testInventory;
  const suiteId = input.suiteId;
  assertTestBudgetExecutionProvenance(budgetProjection, testInventory);
  const suite = budgetProjection.slowSuites.find(({ id }) => id === suiteId);
  if (suite === undefined || suite.files.length === 0) {
    throw new Error('Test suite execution requires one current canonical slow suite.');
  }
  const selectedFiles = Object.freeze([...input.selectedFiles]);
  if (selectedFiles.length === 0
      || new Set(selectedFiles).size !== selectedFiles.length
      || selectedFiles.some((file) => !suite.files.includes(file))) {
    throw new Error('Test suite execution argv differs from its canonical suite files.');
  }
  const canonicalArgv = Object.freeze([
    'bun',
    ...applyDefaultFastTestConcurrency(
      'bun',
      ['test', ...selectedFiles, ...canonicalBunTestOptions(input.bunOptions)],
      DEFAULT_FAST_TEST_MAX_CONCURRENCY
    )
  ]);
  const caseTimeoutMs = explicitBunTestTimeout(canonicalArgv.slice(1)) ?? DEFAULT_TEST_TIMEOUT_MS;
  positiveSafeInteger(suite.logicalRunTimeoutMs, 'Test suite logical run timeout');
  if (suite.logicalRunTimeoutMs <= TEST_SUPERVISOR_SETTLEMENT_MARGIN_MS + 1) {
    throw new Error('Test suite logical run timeout must reserve terminal observer settlement.');
  }
  const unsigned = deepFreeze({
    schema: 'sec-test-suite-execution-policy-v1' as const,
    suiteId: suite.id,
    suiteOwner: suite.owner,
    files: selectedFiles,
    testInventoryDigest: testInventory.inventoryDigest,
    budgetProjectionDigest: budgetProjection.projectionDigest,
    logicalRunTimeoutMs: suite.logicalRunTimeoutMs,
    settlementMarginMs: TEST_SUPERVISOR_SETTLEMENT_MARGIN_MS,
    caseTimeoutMs,
    canonicalArgv,
    workingDirectory: input.workingDirectory
  });
  const policy = deepFreeze({
    ...unsigned,
    policyDigest: sha256(unsigned) as `sha256:${string}`
  });
  issuedTestSuiteExecutionPolicies.add(policy);
  return policy;
}

function assertIssuedTestSuiteExecutionPolicy(
  policy: TestSuiteExecutionPolicy
): void {
  if (!issuedTestSuiteExecutionPolicies.has(policy)) {
    throw new Error('Test suite execution requires an owner-issued policy.');
  }
}

export function admitTestSuiteExecutionPolicy(
  policy: TestSuiteExecutionPolicy
): TestSuiteExecutionAdmission {
  assertIssuedTestSuiteExecutionPolicy(policy);
  if (consumedTestSuiteExecutionPolicies.has(policy)) {
    throw new Error('Test suite execution policy is single-use.');
  }
  const admittedAtUnixMs = Date.now();
  consumedTestSuiteExecutionPolicies.add(policy);
  const logicalDeadlineAtUnixMs = admittedAtUnixMs + policy.logicalRunTimeoutMs;
  const childDeadlineAtUnixMs = logicalDeadlineAtUnixMs - policy.settlementMarginMs;
  const revalidationDeadlineAtUnixMs = Math.min(
    admittedAtUnixMs + AFFECTED_SELECTION_OPERATION_DURATION_MS,
    childDeadlineAtUnixMs
  );
  if (!Number.isSafeInteger(logicalDeadlineAtUnixMs)
      || !Number.isSafeInteger(revalidationDeadlineAtUnixMs)
      || revalidationDeadlineAtUnixMs > childDeadlineAtUnixMs
      || childDeadlineAtUnixMs <= admittedAtUnixMs) {
    throw new Error('Test suite execution admission deadline is invalid.');
  }
  const admission = deepFreeze({
    policy,
    admittedAtUnixMs,
    logicalDeadlineAtUnixMs,
    revalidationDeadlineAtUnixMs,
    childDeadlineAtUnixMs
  });
  issuedTestSuiteExecutionAdmissions.add(admission);
  return admission;
}

export function assertIssuedTestSuiteExecutionAdmission(
  admission: TestSuiteExecutionAdmission
): void {
  if (!issuedTestSuiteExecutionAdmissions.has(admission)) {
    throw new Error('Test suite execution requires an owner-issued admission.');
  }
}

export type EffectfulTestExecutionPolicy = Readonly<{
  semanticOperation: typeof EFFECTFUL_TEST_SEMANTIC_OPERATION;
  operationTimeoutMs: number;
  cleanupSettlementMarginMs: number;
  caseTimeoutMs: number;
}>;

export type EffectfulTestTerminalState =
  | Readonly<{
    terminal: 'authority-unresolved';
    semanticOperation: typeof EFFECTFUL_TEST_SEMANTIC_OPERATION;
    operationId: string;
    resourceRoot: string | null;
    reason: string;
  }>
  | Readonly<{
    terminal: 'physical-residue';
    semanticOperation: typeof EFFECTFUL_TEST_SEMANTIC_OPERATION;
    operationId: string;
    resourceRoot: string;
    reason: string;
  }>;

function positiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function explicitBunTestTimeout(args: readonly string[]): number | null {
  let timeout: number | null = null;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    let raw: string | undefined;
    if (argument === '--timeout') {
      raw = args[index + 1];
      if (raw === undefined) throw new Error('Bun test timeout value is required.');
      index += 1;
    } else if (argument.startsWith('--timeout=')) {
      raw = argument.slice('--timeout='.length);
    }
    if (raw === undefined) continue;
    if (timeout !== null) throw new Error('Bun test timeout can only be specified once.');
    if (!/^[1-9][0-9]*$/u.test(raw)) {
      throw new Error('Bun test timeout must be a positive safe integer.');
    }
    timeout = positiveSafeInteger(Number(raw), 'Bun test timeout');
  }
  return timeout;
}

const TEST_SUITE_OPTIONS_WITH_VALUE = new Set([
  '--timeout', '--rerun-each', '--seed', '--coverage-reporter', '--coverage-dir',
  '--test-name-pattern', '-t', '--reporter', '--reporter-outfile', '--max-concurrency'
]);

function canonicalBunTestOptions(options: readonly string[]): string[] {
  const captured = [...options];
  for (let index = 0; index < captured.length; index += 1) {
    const option = captured[index]!;
    if (!option.startsWith('-')) {
      throw new Error('Test suite execution options contain an extra test selector.');
    }
    const name = option.includes('=') ? option.slice(0, option.indexOf('=')) : option;
    if (['--test-worker', '--shard', '--changed', '--path-ignore-patterns'].includes(name)) {
      throw new Error(`Bun ${name} is owned by the test execution policy.`);
    }
    if (TEST_SUITE_OPTIONS_WITH_VALUE.has(name) && !option.includes('=')) {
      const value = captured[index + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new Error(`Test suite execution option ${name} requires one value.`);
      }
      index += 1;
    }
  }
  return captured;
}

export function compileTestInvocationExecutionPolicy(
  args: readonly string[],
  supervisorTimeoutMs: number
): TestInvocationExecutionPolicy {
  const caseTimeoutMs = explicitBunTestTimeout(args) ?? DEFAULT_TEST_TIMEOUT_MS;
  const supervisorTimeout = supervisorTimeoutMs;
  positiveSafeInteger(supervisorTimeout, 'Test supervisor timeout');
  if (supervisorTimeout <= caseTimeoutMs) {
    throw new Error('Test supervisor timeout must be strictly greater than the Bun case timeout.');
  }
  if (supervisorTimeout - caseTimeoutMs < TEST_SUPERVISOR_SETTLEMENT_MARGIN_MS) {
    throw new Error(
      `Test supervisor timeout must reserve at least ${TEST_SUPERVISOR_SETTLEMENT_MARGIN_MS}ms `
      + 'for child-tree terminal settlement.'
    );
  }
  return Object.freeze({ caseTimeoutMs, supervisorTimeoutMs: supervisorTimeout });
}

export function compileEffectfulTestExecutionPolicy(input: Readonly<{
  operationTimeoutMs: number;
  cleanupSettlementMarginMs: number;
}>): EffectfulTestExecutionPolicy {
  const operationTimeoutMs = positiveSafeInteger(
    input.operationTimeoutMs,
    'Effectful test operation timeout'
  );
  const cleanupSettlementMarginMs = positiveSafeInteger(
    input.cleanupSettlementMarginMs,
    'Effectful test cleanup settlement margin'
  );
  const caseTimeoutMs = operationTimeoutMs
    + cleanupSettlementMarginMs
    + EFFECTFUL_TEST_CASE_SETTLEMENT_GUARD_MS;
  if (!Number.isSafeInteger(caseTimeoutMs) || caseTimeoutMs >= DEFAULT_TEST_TIMEOUT_MS) {
    throw new Error(
      'Effectful test operation deadline plus cleanup settlement must remain strictly inside '
      + `the canonical ${DEFAULT_TEST_TIMEOUT_MS}ms Bun case ceiling.`
    );
  }
  return Object.freeze({
    semanticOperation: EFFECTFUL_TEST_SEMANTIC_OPERATION,
    operationTimeoutMs,
    cleanupSettlementMarginMs,
    caseTimeoutMs
  });
}

export function withDefaultTestTimeout(options: readonly string[]): string[] {
  return options.some((option) => option === '--timeout' || option.startsWith('--timeout='))
    ? [...options]
    : [...options, '--timeout', String(DEFAULT_TEST_TIMEOUT_MS)];
}
