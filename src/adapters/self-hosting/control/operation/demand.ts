import { canonicalEquals, compareCodeUnits, deepFreeze, sha256 } from '../../../../contracts/canonical.ts';

const OPERATION_DEMAND_GRAPH_SCHEMA =
  'sec-operation-demand-graph-v1' as const;

const OPERATION_KINDS = [
  'check-affected',
  'check-fast',
  'dependency-setup',
  'imports-apply',
  'imports-check',
  'imports-freeze',
  'test-direct-ambiguous',
  'test-direct-fast',
  'test-direct-slow',
  'test-fast',
  'test-full',
  'test-slow',
  'typecheck',
  'work-selection-observe'
] as const;

export type OperationKind = (typeof OPERATION_KINDS)[number];

export type OperationDemandInput = Readonly<
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
    operation: Exclude<OperationKind, 'dependency-setup' | 'work-selection-observe'>;
    terminalWorkIds: readonly [];
  }
>;

const OPERATION_CAPABILITY_DEMANDS = [
  'compiler-dependency-tree',
  'managed-git-hooks'
] as const;

const OPERATION_TRANSITION_DEMANDS = [
  'roadmap-terminal-compaction'
] as const;

const OPERATION_VERIFICATION_OBLIGATIONS = [
  'git-hook-lifecycle',
  'operation-demand-integrity',
  'roadmap-terminal-topology',
  'test-process-isolation'
] as const;

type OperationCapabilityDemand =
  (typeof OPERATION_CAPABILITY_DEMANDS)[number];
type OperationTransitionDemand =
  (typeof OPERATION_TRANSITION_DEMANDS)[number];
type OperationVerificationObligation =
  (typeof OPERATION_VERIFICATION_OBLIGATIONS)[number];

export interface OperationDemandGraph {
  readonly schema: typeof OPERATION_DEMAND_GRAPH_SCHEMA;
  readonly input: OperationDemandInput;
  readonly capabilityDemands: readonly OperationCapabilityDemand[];
  readonly transitionDemands: readonly OperationTransitionDemand[];
  readonly verificationObligations: readonly OperationVerificationObligation[];
  readonly graphDigest: `sha256:${string}`;
}

const TEST_OPERATIONS_REQUIRING_PROCESS_ISOLATION = new Set<OperationKind>([
  'test-direct-ambiguous',
  'test-direct-fast',
  'test-fast',
  'test-full'
]);

function canonicalTerminalWorkIds(input: OperationDemandInput): readonly string[] {
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
export function compileOperationDemandGraph(
  input: OperationDemandInput
): OperationDemandGraph {
  if (!OPERATION_KINDS.includes(input.operation)) {
    throw new Error('Operation Demand Graph V1: operation is not canonical.');
  }
  const terminalWorkIds = canonicalTerminalWorkIds(input);
  const hookPolicy = input.operation === 'dependency-setup' ? input.hookPolicy : null;
  if (hookPolicy !== null && !['always', 'if-installed', 'never'].includes(hookPolicy)) {
    throw new Error('Operation Demand Graph V1: dependency setup hook policy is not canonical.');
  }
  const compilerDemanded = input.operation !== 'work-selection-observe';
  const terminalTransitionDemanded = terminalWorkIds.length > 0;
  const withoutDigest = deepFreeze({
    schema: OPERATION_DEMAND_GRAPH_SCHEMA,
    input: {
      operation: input.operation,
      terminalWorkIds,
      ...(hookPolicy === null ? {} : { hookPolicy })
    } as OperationDemandInput,
    capabilityDemands: Object.freeze([
      ...(compilerDemanded ? ['compiler-dependency-tree' as const] : []),
      ...(hookPolicy !== null && hookPolicy !== 'never' ? ['managed-git-hooks' as const] : [])
    ].sort(compareCodeUnits)),
    transitionDemands: Object.freeze([
      ...(terminalTransitionDemanded ? ['roadmap-terminal-compaction' as const] : [])
    ]),
    verificationObligations: Object.freeze([
      'operation-demand-integrity' as const,
      ...(terminalTransitionDemanded ? ['roadmap-terminal-topology' as const] : []),
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

export function assertOperationDemandGraph(graph: OperationDemandGraph): void {
  const compiled = compileOperationDemandGraph(graph.input);
  if (!canonicalEquals(graph, compiled)) {
    throw new Error('Operation Demand Graph V1: graph differs from the canonical compiler output.');
  }
}
