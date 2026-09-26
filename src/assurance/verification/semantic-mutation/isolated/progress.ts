export const ISOLATED_PROGRESS_CHECKPOINTS = Object.freeze([
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

export type IsolatedProgressCheckpoint =
  (typeof ISOLATED_PROGRESS_CHECKPOINTS)[number];

export const ISOLATED_EXIT_CODES = Object.freeze({
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

export type IsolatedTerminationClass =
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

export interface IsolatedProgressTrace {
  readonly checkpoints: readonly IsolatedProgressCheckpoint[];
  readonly lastCheckpoint?: IsolatedProgressCheckpoint;
  readonly pendingCheckpoint?: IsolatedProgressCheckpoint;
}

export type IsolatedProgressReadResult =
  | Readonly<{ readonly status: 'valid'; readonly trace: IsolatedProgressTrace }>
  | Readonly<{ readonly status: 'parse-error' | 'read-error' | 'protocol-error' }>;

const SEMANTIC_MUTATION_ISOLATED_PROGRESS_TRANSPORT_FORMAT =
  'sec-isolated-progress/1' as const;
const SEMANTIC_MUTATION_ISOLATED_PROGRESS_MAX_TRANSPORT_BYTES = 4096;
export type IsolatedProgressFramePhase = 'pending' | 'committed';

const CHECKPOINT_INDEX = new Map<IsolatedProgressCheckpoint, number>(
  ISOLATED_PROGRESS_CHECKPOINTS.map((checkpoint, index) => [checkpoint, index])
);
const RUNNER_ENTERED_TRACE = Object.freeze([
  'bootstrap-entered',
  'loader-entered',
  'core-import-started',
  'module-entered'
] as const satisfies readonly IsolatedProgressCheckpoint[]);
const ALLOWED_FINAL_TRACES: readonly (readonly IsolatedProgressCheckpoint[])[] =
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

function semanticMutationIsolatedProgressCheckpointIndex(
  checkpoint: IsolatedProgressCheckpoint
): number {
  const index = CHECKPOINT_INDEX.get(checkpoint);
  if (index === undefined) {
    throw new Error('Semantic Mutation isolated checkpoint is unknown');
  }
  return index;
}

export function isolatedProgressFrameText(
  phase: IsolatedProgressFramePhase,
  checkpoint: IsolatedProgressCheckpoint
): string {
  semanticMutationIsolatedProgressCheckpointIndex(checkpoint);
  if (phase !== 'pending' && phase !== 'committed') {
    throw new Error('Semantic Mutation isolated progress frame phase is invalid');
  }
  return `${SEMANTIC_MUTATION_ISOLATED_PROGRESS_TRANSPORT_FORMAT} ${phase} ${checkpoint}\n`;
}

export function parseIsolatedProgressTransportBytes(
  bytes: Uint8Array
): IsolatedProgressReadResult {
  if (!(bytes instanceof Uint8Array) ||
      bytes.byteLength > SEMANTIC_MUTATION_ISOLATED_PROGRESS_MAX_TRANSPORT_BYTES) {
    return { status: 'parse-error' };
  }
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { status: 'parse-error' };
  }
  const checkpoints: IsolatedProgressCheckpoint[] = [];
  let pending: IsolatedProgressCheckpoint | undefined;
  if (source.length !== 0) {
    if (!source.endsWith('\n')) return { status: 'protocol-error' };
    const lines = source.slice(0, -1).split('\n');
    for (const line of lines) {
      const fields = line.split(' ');
      if (fields.length !== 3 ||
          fields[0] !== SEMANTIC_MUTATION_ISOLATED_PROGRESS_TRANSPORT_FORMAT ||
          (fields[1] !== 'pending' && fields[1] !== 'committed') ||
          !ISOLATED_PROGRESS_CHECKPOINTS.includes(
            fields[2] as IsolatedProgressCheckpoint
          )) {
        return { status: 'protocol-error' };
      }
      const phase = fields[1] as IsolatedProgressFramePhase;
      const checkpoint = fields[2] as IsolatedProgressCheckpoint;
      if (phase === 'pending') {
        if (pending !== undefined ||
            !isIsolatedProgressTransitionAllowed(checkpoints, checkpoint)) {
          return { status: 'protocol-error' };
        }
        pending = checkpoint;
      } else {
        if (pending !== checkpoint) return { status: 'protocol-error' };
        checkpoints.push(checkpoint);
        pending = undefined;
      }
    }
  }
  if (!isSemanticMutationIsolatedProgressObservationValid(
    checkpoints,
    pending === undefined ? [] : [pending]
  )) {
    return { status: 'protocol-error' };
  }
  return {
    status: 'valid',
    trace: Object.freeze({
      checkpoints: Object.freeze([...checkpoints]),
      ...(checkpoints.at(-1) === undefined ? {} : { lastCheckpoint: checkpoints.at(-1)! }),
      ...(pending === undefined ? {} : { pendingCheckpoint: pending })
    })
  };
}

function sameTrace(
  left: readonly IsolatedProgressCheckpoint[],
  right: readonly IsolatedProgressCheckpoint[]
): boolean {
  return left.length === right.length &&
    left.every((checkpoint, index) => checkpoint === right[index]);
}

function isSemanticMutationIsolatedProgressFinalTraceAllowed(
  trace: readonly IsolatedProgressCheckpoint[]
): boolean {
  return ALLOWED_FINAL_TRACES.some((allowed) => sameTrace(trace, allowed));
}

export function isIsolatedProgressTransitionAllowed(
  trace: readonly IsolatedProgressCheckpoint[],
  checkpoint: IsolatedProgressCheckpoint
): boolean {
  return ALLOWED_FINAL_TRACES.some((allowed) =>
    allowed.length === trace.length + 1 &&
    allowed[allowed.length - 1] === checkpoint &&
    allowed.slice(0, -1).every((value, index) => value === trace[index]));
}

function isSemanticMutationIsolatedProgressObservationValid(
  checkpoints: readonly IsolatedProgressCheckpoint[],
  pending: readonly IsolatedProgressCheckpoint[]
): boolean {
  return isSemanticMutationIsolatedProgressFinalTraceAllowed(checkpoints) &&
    pending.length <= 1 &&
    (pending[0] === undefined ||
      isIsolatedProgressTransitionAllowed(checkpoints, pending[0]));
}

export function classifyIsolatedTermination(
  exitCode: number
): IsolatedTerminationClass {
  if (!Number.isSafeInteger(exitCode) || exitCode < 0) {
    throw new Error('Semantic Mutation isolated exit code is invalid');
  }
  if (exitCode === 0) return 'zero';
  if (exitCode === ISOLATED_EXIT_CODES.runnerControlledFailure) {
    return 'runner-controlled-failure';
  }
  if (exitCode === ISOLATED_EXIT_CODES.runnerEntryFailure) {
    return 'runner-entry-failure';
  }
  if (exitCode === ISOLATED_EXIT_CODES.runnerCatchTreeFailure) {
    return 'runner-catch-tree-failure';
  }
  if (exitCode === ISOLATED_EXIT_CODES.outcomePublicationFailure) {
    return 'outcome-publication-failure';
  }
  if (exitCode === ISOLATED_EXIT_CODES.progressPublicationFailure) {
    return 'progress-publication-failure';
  }
  if (exitCode === ISOLATED_EXIT_CODES.loaderImportFailure) {
    return 'loader-import-failure';
  }
  if (exitCode === ISOLATED_EXIT_CODES.runnerStagingTreeFailure) {
    return 'runner-staging-tree-failure';
  }
  if (exitCode === ISOLATED_EXIT_CODES.runnerEnvironmentBoundaryFailure) {
    return 'runner-environment-boundary-failure';
  }
  if (exitCode === ISOLATED_EXIT_CODES.runnerStagingLayoutBoundaryFailure) {
    return 'runner-staging-layout-boundary-failure';
  }
  if (exitCode === ISOLATED_EXIT_CODES.bootstrapEnvironmentBoundaryFailure) {
    return 'bootstrap-environment-boundary-failure';
  }
  return 'unclassified-nonzero';
}
