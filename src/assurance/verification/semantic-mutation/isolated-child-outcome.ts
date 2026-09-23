import {
  PIPELINE_EXECUTION_BOUNDARIES,
  type PipelineExecutionBoundary
} from '../../../compiler/pipeline/execution-boundaries.ts';
import { compareCodeUnits, sortedKeys } from '../../../compiler/semantic-mutation/canonical.ts';
import { parseExactJsonBytes } from '../../../contracts/exact-json.ts';

export const SEMANTIC_MUTATION_ISOLATED_CHILD_OUTCOME_FORMAT =
  'semantic-mutation-isolated-child-outcome-v1' as const;

export type SemanticMutationIsolatedChildFailureStage =
  | 'preflight'
  | 'verify-all'
  | 'postcondition';

export interface SemanticMutationIsolatedChildOutcome {
  readonly formatVersion: typeof SEMANTIC_MUTATION_ISOLATED_CHILD_OUTCOME_FORMAT;
  readonly status: 'failed';
  readonly stage: SemanticMutationIsolatedChildFailureStage;
  readonly boundary?: PipelineExecutionBoundary;
}

const MAX_OUTCOME_BYTES = 512;
const CHILD_FAILURE_STAGES = new Set<SemanticMutationIsolatedChildFailureStage>([
  'preflight',
  'verify-all',
  'postcondition'
]);
const PIPELINE_BOUNDARIES = new Set<PipelineExecutionBoundary>(
  PIPELINE_EXECUTION_BOUNDARIES
);

function exactObjectKeys(
  value: Record<string, unknown>,
  expected: readonly string[]
): boolean {
  const actual = sortedKeys(value);
  const sortedExpected = [...expected].sort(compareCodeUnits);
  return actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index]);
}

function canonicalOutcome(value: unknown): SemanticMutationIsolatedChildOutcome {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Semantic Mutation isolated child outcome is invalid');
  }
  const record = value as Record<string, unknown>;
  const hasBoundary = Object.hasOwn(record, 'boundary');
  if (!exactObjectKeys(
      record,
      hasBoundary
        ? ['boundary', 'formatVersion', 'stage', 'status']
        : ['formatVersion', 'stage', 'status']
    ) ||
    record.formatVersion !== SEMANTIC_MUTATION_ISOLATED_CHILD_OUTCOME_FORMAT ||
    record.status !== 'failed' ||
    typeof record.stage !== 'string' ||
    !CHILD_FAILURE_STAGES.has(record.stage as SemanticMutationIsolatedChildFailureStage) ||
    (hasBoundary && (
      record.stage !== 'verify-all' ||
      typeof record.boundary !== 'string' ||
      !PIPELINE_BOUNDARIES.has(record.boundary as PipelineExecutionBoundary)
    ))) {
    throw new Error('Semantic Mutation isolated child outcome is invalid');
  }
  return Object.freeze({
    formatVersion: SEMANTIC_MUTATION_ISOLATED_CHILD_OUTCOME_FORMAT,
    status: 'failed',
    stage: record.stage as SemanticMutationIsolatedChildFailureStage,
    ...(hasBoundary ? { boundary: record.boundary as PipelineExecutionBoundary } : {})
  });
}

export function buildSemanticMutationIsolatedChildOutcome(
  stage: SemanticMutationIsolatedChildFailureStage,
  boundary?: PipelineExecutionBoundary
): SemanticMutationIsolatedChildOutcome {
  return canonicalOutcome({
    formatVersion: SEMANTIC_MUTATION_ISOLATED_CHILD_OUTCOME_FORMAT,
    status: 'failed',
    stage,
    ...(boundary === undefined ? {} : { boundary })
  });
}

export function semanticMutationIsolatedChildOutcomeBytes(
  value: SemanticMutationIsolatedChildOutcome
): Uint8Array {
  const outcome = canonicalOutcome(value);
  return new TextEncoder().encode(`${JSON.stringify(outcome)}\n`);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index]);
}

export function parseSemanticMutationIsolatedChildOutcomeBytes(
  bytes: Uint8Array
): SemanticMutationIsolatedChildOutcome {
  let parsed: unknown;
  try {
    parsed = parseExactJsonBytes(
      bytes,
      'Semantic Mutation isolated child outcome',
      { maximumInputBytes: MAX_OUTCOME_BYTES, maximumDepth: 1 }
    );
  } catch {
    throw new Error('Semantic Mutation isolated child outcome bytes are invalid');
  }
  const outcome = canonicalOutcome(parsed);
  if (!sameBytes(bytes, semanticMutationIsolatedChildOutcomeBytes(outcome))) {
    throw new Error('Semantic Mutation isolated child outcome bytes are not canonical');
  }
  return outcome;
}
