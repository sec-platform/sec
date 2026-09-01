/** One default per-test deadline for every canonical test lane. */
export const DEFAULT_TEST_TIMEOUT_MS = 180_000;
/** Time reserved after a Bun case deadline for child-tree terminal observation. */
export const TEST_SUPERVISOR_SETTLEMENT_MARGIN_MS = 30_000;
/** Keeps a declared Effect operation and cleanup strictly inside Bun's case deadline. */
export const EFFECTFUL_TEST_CASE_SETTLEMENT_GUARD_MS = 1_000;
/** One semantic operation binds registration, policy, terminal, and readback provenance. */
export const EFFECTFUL_TEST_SEMANTIC_OPERATION = 'verification.effectful-test' as const;

export type TestInvocationExecutionPolicy = Readonly<{
  caseTimeoutMs: number;
  supervisorTimeoutMs: number;
}>;

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
