/** One default per-test deadline for every canonical test lane. */
import type { IssuedTestImpactProjection } from '../../brownfield/source-program-model/test-impact-projection.ts';
import { deepFreeze, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import {
  assertTestBudgetExecutionProvenance,
  type TestBudgetProjection
} from '../../verification/test-impact/contract/budget.ts';
import { DEFAULT_FAST_TEST_MAX_CONCURRENCY } from './fast-test-policy.ts';
import { applyDefaultFastTestConcurrency } from './test-concurrency-policy.ts';

export const DEFAULT_TEST_TIMEOUT_MS = 180_000;
/** Time reserved after a Bun case deadline for child-tree terminal observation. */
export const TEST_SUPERVISOR_SETTLEMENT_MARGIN_MS = 30_000;
/** Keeps a declared Effect operation and cleanup strictly inside Bun's case deadline. */
export const EFFECTFUL_TEST_CASE_SETTLEMENT_GUARD_MS = 1_000;
/** One semantic operation binds registration, policy, terminal, and readback provenance. */
export const EFFECTFUL_TEST_SEMANTIC_OPERATION = 'verification.effectful-test' as const;
export const TEST_SUITE_EXECUTION_OPERATION = 'development.runner.test-suite' as const;
export const TEST_SUITE_CHILD_REQUIREMENT_ID = 'development.runner.test-suite.bun-child' as const;

export type TestInvocationExecutionPolicy = Readonly<{
  caseTimeoutMs: number;
  supervisorTimeoutMs: number;
}>;

export type TestSuiteExecutionPolicy = Readonly<{
  schema: 'sec-test-suite-execution-policy-v1';
  suiteId: string;
  suiteOwner: string;
  files: readonly string[];
  sourceProjectionDigest: `sha256:${string}`;
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
  childDeadlineAtUnixMs: number;
}>;

const issuedTestSuiteExecutionPolicies = new WeakSet<object>();
const consumedTestSuiteExecutionPolicies = new WeakSet<object>();
const issuedTestSuiteExecutionAdmissions = new WeakSet<object>();

export function issueTestSuiteExecutionPolicy(input: Readonly<{
  sourceProjection: IssuedTestImpactProjection;
  budgetProjection: TestBudgetProjection;
  suiteId: string;
  selectedFiles: readonly string[];
  bunOptions: readonly string[];
  workingDirectory: string;
}>): TestSuiteExecutionPolicy {
  assertTestBudgetExecutionProvenance(input.budgetProjection, input.sourceProjection);
  const suite = input.budgetProjection.slowSuites.find(({ id }) => id === input.suiteId);
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
    sourceProjectionDigest: input.sourceProjection.projectionDigest as `sha256:${string}`,
    budgetProjectionDigest: input.budgetProjection.projectionDigest,
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

export function assertIssuedTestSuiteExecutionPolicy(
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
  if (!Number.isSafeInteger(logicalDeadlineAtUnixMs)
      || childDeadlineAtUnixMs <= admittedAtUnixMs) {
    throw new Error('Test suite execution admission deadline is invalid.');
  }
  const admission = deepFreeze({
    policy,
    admittedAtUnixMs,
    logicalDeadlineAtUnixMs,
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
  positiveSafeInteger(supervisorTimeoutMs, 'Test supervisor timeout');
  if (supervisorTimeoutMs <= caseTimeoutMs) {
    throw new Error('Test supervisor timeout must be strictly greater than the Bun case timeout.');
  }
  if (supervisorTimeoutMs - caseTimeoutMs < TEST_SUPERVISOR_SETTLEMENT_MARGIN_MS) {
    throw new Error(
      `Test supervisor timeout must reserve at least ${TEST_SUPERVISOR_SETTLEMENT_MARGIN_MS}ms `
      + 'for child-tree terminal settlement.'
    );
  }
  return Object.freeze({ caseTimeoutMs, supervisorTimeoutMs });
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
