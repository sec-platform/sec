import {
  canonicalEquals,
  compareCodeUnits,
  deepFreeze,
  sha256
} from './canonical-primitives.ts';

export const SEC_OPERATION_DEMAND_GRAPH_SCHEMA_V1 =
  'sec-operation-demand-graph-v1' as const;

export const SEC_OPERATION_KINDS_V1 = [
  'check-affected',
  'check-fast',
  'dependency-setup',
  'imports-apply',
  'imports-check',
  'imports-freeze',
  'test-contract-freeze',
  'test-direct-ambiguous',
  'test-direct-fast',
  'test-direct-slow',
  'test-fast',
  'test-full',
  'test-slow',
  'typecheck',
  'work-selection-observe'
] as const;

export type SecOperationKindV1 = (typeof SEC_OPERATION_KINDS_V1)[number];

export type SecOperationDemandInputV1 = Readonly<
  | {
    operation: 'work-selection-observe';
    terminalWorkIds: readonly string[];
  }
  | {
    operation: 'dependency-setup';
    terminalWorkIds: readonly [];
    hookPolicy: 'always' | 'if-installed' | 'never';
  }
  | {
    operation: Exclude<SecOperationKindV1, 'dependency-setup' | 'work-selection-observe'>;
    terminalWorkIds: readonly [];
  }
>;

export const SEC_OPERATION_CAPABILITY_DEMANDS_V1 = [
  'browser-runtime',
  'compiler-dependency-tree',
  'managed-git-hooks'
] as const;

export const SEC_OPERATION_TRANSITION_DEMANDS_V1 = [
  'roadmap-terminal-compaction'
] as const;

export const SEC_OPERATION_VERIFICATION_OBLIGATIONS_V1 = [
  'browser-runtime-materialization',
  'git-hook-lifecycle',
  'operation-demand-integrity',
  'roadmap-terminal-topology',
  'test-process-isolation'
] as const;

export type SecOperationCapabilityDemandV1 =
  (typeof SEC_OPERATION_CAPABILITY_DEMANDS_V1)[number];
export type SecOperationTransitionDemandV1 =
  (typeof SEC_OPERATION_TRANSITION_DEMANDS_V1)[number];
export type SecOperationVerificationObligationV1 =
  (typeof SEC_OPERATION_VERIFICATION_OBLIGATIONS_V1)[number];

export interface SecOperationDemandGraphV1 {
  readonly schema: typeof SEC_OPERATION_DEMAND_GRAPH_SCHEMA_V1;
  readonly input: SecOperationDemandInputV1;
  readonly capabilityDemands: readonly SecOperationCapabilityDemandV1[];
  readonly transitionDemands: readonly SecOperationTransitionDemandV1[];
  readonly verificationObligations: readonly SecOperationVerificationObligationV1[];
  readonly graphDigest: `sha256:${string}`;
}

const TEST_OPERATIONS_REQUIRING_BROWSER = new Set<SecOperationKindV1>([
  'test-direct-ambiguous',
  'test-direct-slow',
  'test-full',
  'test-slow'
]);

const TEST_OPERATIONS_REQUIRING_PROCESS_ISOLATION = new Set<SecOperationKindV1>([
  'test-contract-freeze',
  'test-direct-ambiguous',
  'test-direct-fast',
  'test-fast',
  'test-full'
]);

function canonicalTerminalWorkIds(input: SecOperationDemandInputV1): readonly string[] {
  if (input.operation !== 'work-selection-observe') {
    if (input.terminalWorkIds.length !== 0) {
      throw new Error('Operation Demand Graph V1: test operations cannot carry terminal work facts.');
    }
    return Object.freeze([]);
  }
  const terminalWorkIds = [...input.terminalWorkIds].sort(compareCodeUnits);
  if (new Set(terminalWorkIds).size !== terminalWorkIds.length
      || terminalWorkIds.some((workId) => !/^issue-[1-9][0-9]*$/u.test(workId))) {
    throw new Error('Operation Demand Graph V1: terminal work facts must be unique canonical Issue work ids.');
  }
  return Object.freeze(terminalWorkIds);
}

/**
 * The only compiler from a selected operation plus validated facts to derived
 * transitions, capability materialization and verification obligations.
 * Consumers recompile this graph before Effects; ambient packages, caches,
 * entrypoints and environment variables therefore cannot add demand.
 */
export function compileSecOperationDemandGraphV1(
  input: SecOperationDemandInputV1
): SecOperationDemandGraphV1 {
  if (!SEC_OPERATION_KINDS_V1.includes(input.operation)) {
    throw new Error('Operation Demand Graph V1: operation is not canonical.');
  }
  const terminalWorkIds = canonicalTerminalWorkIds(input);
  const hookPolicy = input.operation === 'dependency-setup' ? input.hookPolicy : null;
  if (hookPolicy !== null && !['always', 'if-installed', 'never'].includes(hookPolicy)) {
    throw new Error('Operation Demand Graph V1: dependency setup hook policy is not canonical.');
  }
  const compilerDemanded = input.operation !== 'work-selection-observe';
  const browserDemanded = TEST_OPERATIONS_REQUIRING_BROWSER.has(input.operation);
  const terminalTransitionDemanded = terminalWorkIds.length > 0;
  const withoutDigest = deepFreeze({
    schema: SEC_OPERATION_DEMAND_GRAPH_SCHEMA_V1,
    input: {
      operation: input.operation,
      terminalWorkIds,
      ...(hookPolicy === null ? {} : { hookPolicy })
    } as SecOperationDemandInputV1,
    capabilityDemands: Object.freeze([
      ...(compilerDemanded ? ['compiler-dependency-tree' as const] : []),
      ...(browserDemanded ? ['browser-runtime' as const] : []),
      ...(hookPolicy !== null && hookPolicy !== 'never' ? ['managed-git-hooks' as const] : [])
    ].sort(compareCodeUnits)),
    transitionDemands: Object.freeze([
      ...(terminalTransitionDemanded ? ['roadmap-terminal-compaction' as const] : [])
    ]),
    verificationObligations: Object.freeze([
      'operation-demand-integrity' as const,
      ...(terminalTransitionDemanded ? ['roadmap-terminal-topology' as const] : []),
      ...(browserDemanded ? ['browser-runtime-materialization' as const] : []),
      ...(hookPolicy !== null && hookPolicy !== 'never' ? ['git-hook-lifecycle' as const] : []),
      ...(TEST_OPERATIONS_REQUIRING_PROCESS_ISOLATION.has(input.operation)
        ? ['test-process-isolation' as const]
        : [])
    ].sort(compareCodeUnits))
  });
  return deepFreeze({
    ...withoutDigest,
    graphDigest: sha256(withoutDigest) as `sha256:${string}`
  });
}

export function assertSecOperationDemandGraphV1(graph: SecOperationDemandGraphV1): void {
  const compiled = compileSecOperationDemandGraphV1(graph.input);
  if (!canonicalEquals(graph, compiled)) {
    throw new Error('Operation Demand Graph V1: graph differs from the canonical compiler output.');
  }
}
