import { sortedKeys } from '../../../compiler/semantic-mutation/canonical.ts';

export const SEMANTIC_MUTATION_ISOLATED_PROGRESS_FORMAT =
  'semantic-mutation-isolated-progress-v1' as const;

export const SEMANTIC_MUTATION_ISOLATED_PROGRESS_CHECKPOINTS = Object.freeze([
  'bootstrap-entered',
  'loader-entered',
  'core-import-started',
  'module-entered',
  'catch-armed',
  'verify-all',
  'postcondition',
  'failure-caught',
  'catch-tree-validated',
  'outcome-publish-started'
] as const);

export type SemanticMutationIsolatedProgressCheckpoint =
  (typeof SEMANTIC_MUTATION_ISOLATED_PROGRESS_CHECKPOINTS)[number];

export const SEMANTIC_MUTATION_ISOLATED_EXIT_CODES = Object.freeze({
  runnerControlledFailure: 70,
  runnerEntryFailure: 71,
  runnerCatchTreeFailure: 72,
  outcomePublicationFailure: 73,
  progressPublicationFailure: 74,
  loaderImportFailure: 75,
  runnerStagingTreeFailure: 76,
  runnerEnvironmentBoundaryFailure: 77,
  runnerStagingLayoutBoundaryFailure: 78,
  bootstrapEnvironmentBoundaryFailure: 79
} as const);

export type SemanticMutationIsolatedTerminationClass =
  | 'zero'
  | 'runner-controlled-failure'
  | 'runner-entry-failure'
  | 'bootstrap-environment-boundary-failure'
  | 'runner-environment-boundary-failure'
  | 'runner-staging-layout-boundary-failure'
  | 'runner-staging-tree-failure'
  | 'runner-catch-tree-failure'
  | 'outcome-publication-failure'
  | 'progress-publication-failure'
  | 'loader-import-failure'
  | 'unclassified-nonzero';

export interface SemanticMutationIsolatedProgressTrace {
  readonly checkpoints: readonly SemanticMutationIsolatedProgressCheckpoint[];
  readonly lastCheckpoint?: SemanticMutationIsolatedProgressCheckpoint;
  readonly pendingCheckpoint?: SemanticMutationIsolatedProgressCheckpoint;
}

export type SemanticMutationIsolatedProgressReadResult =
  | Readonly<{ readonly status: 'valid'; readonly trace: SemanticMutationIsolatedProgressTrace }>
  | Readonly<{ readonly status: 'parse-error' | 'read-error' | 'protocol-error' }>;

export const SEMANTIC_MUTATION_ISOLATED_PROGRESS_MAX_CHECKPOINT_BYTES = 256;

const CHECKPOINT_INDEX = new Map<SemanticMutationIsolatedProgressCheckpoint, number>(
  SEMANTIC_MUTATION_ISOLATED_PROGRESS_CHECKPOINTS.map((checkpoint, index) => [checkpoint, index])
);
const RUNNER_ENTERED_TRACE = Object.freeze([
  'bootstrap-entered',
  'loader-entered',
  'core-import-started',
  'module-entered'
] as const satisfies readonly SemanticMutationIsolatedProgressCheckpoint[]);
const ALLOWED_FINAL_TRACES: readonly (readonly SemanticMutationIsolatedProgressCheckpoint[])[] =
  Object.freeze([
    [],
    ['bootstrap-entered'],
    ['bootstrap-entered', 'loader-entered'],
    ['bootstrap-entered', 'loader-entered', 'core-import-started'],
    RUNNER_ENTERED_TRACE,
    [...RUNNER_ENTERED_TRACE, 'catch-armed'],
    [...RUNNER_ENTERED_TRACE, 'catch-armed', 'verify-all'],
    [...RUNNER_ENTERED_TRACE, 'catch-armed', 'verify-all', 'postcondition'],
    [...RUNNER_ENTERED_TRACE, 'catch-armed', 'failure-caught'],
    [...RUNNER_ENTERED_TRACE, 'catch-armed', 'failure-caught', 'catch-tree-validated'],
    [
      ...RUNNER_ENTERED_TRACE, 'catch-armed', 'failure-caught', 'catch-tree-validated',
      'outcome-publish-started'
    ],
    [...RUNNER_ENTERED_TRACE, 'catch-armed', 'verify-all', 'failure-caught'],
    [
      ...RUNNER_ENTERED_TRACE, 'catch-armed', 'verify-all', 'failure-caught',
      'catch-tree-validated'
    ],
    [
      ...RUNNER_ENTERED_TRACE, 'catch-armed', 'verify-all', 'failure-caught',
      'catch-tree-validated', 'outcome-publish-started'
    ],
    [...RUNNER_ENTERED_TRACE, 'catch-armed', 'verify-all', 'postcondition', 'failure-caught'],
    [
      ...RUNNER_ENTERED_TRACE, 'catch-armed', 'verify-all', 'postcondition', 'failure-caught',
      'catch-tree-validated'
    ],
    [
      ...RUNNER_ENTERED_TRACE, 'catch-armed', 'verify-all', 'postcondition', 'failure-caught',
      'catch-tree-validated', 'outcome-publish-started'
    ]
  ]);

export function semanticMutationIsolatedProgressCheckpointIndex(
  checkpoint: SemanticMutationIsolatedProgressCheckpoint
): number {
  const index = CHECKPOINT_INDEX.get(checkpoint);
  if (index === undefined) {
    throw new Error('Semantic Mutation isolated checkpoint is unknown');
  }
  return index;
}

export function semanticMutationIsolatedProgressCheckpointBytes(
  checkpoint: SemanticMutationIsolatedProgressCheckpoint
): Uint8Array {
  semanticMutationIsolatedProgressCheckpointIndex(checkpoint);
  return new TextEncoder().encode(`${JSON.stringify({
    formatVersion: SEMANTIC_MUTATION_ISOLATED_PROGRESS_FORMAT,
    checkpoint
  })}\n`);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength &&
    left.every((byte, index) => byte === right[index]);
}

export function parseSemanticMutationIsolatedProgressCheckpointBytes(
  bytes: Uint8Array,
  expected: SemanticMutationIsolatedProgressCheckpoint
): boolean {
  if (!(bytes instanceof Uint8Array) ||
      bytes.byteLength === 0 ||
      bytes.byteLength > SEMANTIC_MUTATION_ISOLATED_PROGRESS_MAX_CHECKPOINT_BYTES) {
    return false;
  }
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return false;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(source) as unknown;
  } catch {
    return false;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const record = parsed as Record<string, unknown>;
  const keys = sortedKeys(record);
  if (keys.length !== 2 || keys[0] !== 'checkpoint' || keys[1] !== 'formatVersion' ||
      record.formatVersion !== SEMANTIC_MUTATION_ISOLATED_PROGRESS_FORMAT ||
      record.checkpoint !== expected) {
    return false;
  }
  return sameBytes(bytes, semanticMutationIsolatedProgressCheckpointBytes(expected));
}

function sameTrace(
  left: readonly SemanticMutationIsolatedProgressCheckpoint[],
  right: readonly SemanticMutationIsolatedProgressCheckpoint[]
): boolean {
  return left.length === right.length &&
    left.every((checkpoint, index) => checkpoint === right[index]);
}

export function isSemanticMutationIsolatedProgressFinalTraceAllowed(
  trace: readonly SemanticMutationIsolatedProgressCheckpoint[]
): boolean {
  return ALLOWED_FINAL_TRACES.some((allowed) => sameTrace(trace, allowed));
}

export function isSemanticMutationIsolatedProgressTransitionAllowed(
  trace: readonly SemanticMutationIsolatedProgressCheckpoint[],
  checkpoint: SemanticMutationIsolatedProgressCheckpoint
): boolean {
  return ALLOWED_FINAL_TRACES.some((allowed) =>
    allowed.length === trace.length + 1 &&
    allowed[allowed.length - 1] === checkpoint &&
    allowed.slice(0, -1).every((value, index) => value === trace[index]));
}

export function isSemanticMutationIsolatedProgressObservationValid(
  checkpoints: readonly SemanticMutationIsolatedProgressCheckpoint[],
  pending: readonly SemanticMutationIsolatedProgressCheckpoint[]
): boolean {
  return isSemanticMutationIsolatedProgressFinalTraceAllowed(checkpoints) &&
    pending.length <= 1 &&
    (pending[0] === undefined ||
      isSemanticMutationIsolatedProgressTransitionAllowed(checkpoints, pending[0]));
}

export function classifySemanticMutationIsolatedTermination(
  exitCode: number
): SemanticMutationIsolatedTerminationClass {
  if (!Number.isSafeInteger(exitCode) || exitCode < 0) {
    throw new Error('Semantic Mutation isolated exit code is invalid');
  }
  if (exitCode === 0) return 'zero';
  if (exitCode === SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerControlledFailure) {
    return 'runner-controlled-failure';
  }
  if (exitCode === SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerEntryFailure) {
    return 'runner-entry-failure';
  }
  if (exitCode === SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerCatchTreeFailure) {
    return 'runner-catch-tree-failure';
  }
  if (exitCode === SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.outcomePublicationFailure) {
    return 'outcome-publication-failure';
  }
  if (exitCode === SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.progressPublicationFailure) {
    return 'progress-publication-failure';
  }
  if (exitCode === SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.loaderImportFailure) {
    return 'loader-import-failure';
  }
  if (exitCode === SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerStagingTreeFailure) {
    return 'runner-staging-tree-failure';
  }
  if (exitCode === SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerEnvironmentBoundaryFailure) {
    return 'runner-environment-boundary-failure';
  }
  if (exitCode === SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.runnerStagingLayoutBoundaryFailure) {
    return 'runner-staging-layout-boundary-failure';
  }
  if (exitCode === SEMANTIC_MUTATION_ISOLATED_EXIT_CODES.bootstrapEnvironmentBoundaryFailure) {
    return 'bootstrap-environment-boundary-failure';
  }
  return 'unclassified-nonzero';
}
