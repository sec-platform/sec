import { createHash } from 'node:crypto';

import type { ObservedCommandOutcome } from '../../shared/observed-process.ts';
import {
  semanticMutationRunnerBuildFailureSubstage,
  type SemanticMutationRunnerBuildFailureSubstage
} from './semantic-mutation-runner-build-protocol.ts';

const EMPTY_STREAM_DIGEST =
  `sha256:${createHash('sha256').update(new Uint8Array()).digest('hex')}` as const;

export type SemanticMutationRunnerBuildSettlementRejection =
  | 'execute-rejected'
  | 'timed-out'
  | 'not-started'
  | 'closure-unproven'
  | 'requested-termination'
  | 'not-exited'
  | 'exit-status-unproven'
  | 'stdout-truncated'
  | 'stderr-truncated'
  | 'stdout-evidence-mismatch'
  | 'stderr-evidence-mismatch'
  | 'declared-failure-contaminated'
  | 'unexpected-exit'
  | 'protocol-frame-invalid'
  | 'output-ownership-unproven';

export type SemanticMutationRunnerBuildSettlementClassification =
  | Readonly<{ readonly status: 'success' }>
  | Readonly<{
      readonly status: 'child-failure';
      readonly substage: SemanticMutationRunnerBuildFailureSubstage;
    }>
  | Readonly<{
      readonly status: 'rejected';
      readonly reason: SemanticMutationRunnerBuildSettlementRejection;
    }>;

const SUCCESS = Object.freeze({ status: 'success' as const });
const REJECTIONS = Object.freeze({
  executeRejected: Object.freeze({ status: 'rejected' as const, reason: 'execute-rejected' as const }),
  timedOut: Object.freeze({ status: 'rejected' as const, reason: 'timed-out' as const }),
  notStarted: Object.freeze({ status: 'rejected' as const, reason: 'not-started' as const }),
  closureUnproven: Object.freeze({ status: 'rejected' as const, reason: 'closure-unproven' as const }),
  requestedTermination: Object.freeze({
    status: 'rejected' as const,
    reason: 'requested-termination' as const
  }),
  notExited: Object.freeze({ status: 'rejected' as const, reason: 'not-exited' as const }),
  exitStatusUnproven: Object.freeze({
    status: 'rejected' as const,
    reason: 'exit-status-unproven' as const
  }),
  stdoutTruncated: Object.freeze({ status: 'rejected' as const, reason: 'stdout-truncated' as const }),
  stderrTruncated: Object.freeze({ status: 'rejected' as const, reason: 'stderr-truncated' as const }),
  stdoutEvidenceMismatch: Object.freeze({
    status: 'rejected' as const,
    reason: 'stdout-evidence-mismatch' as const
  }),
  stderrEvidenceMismatch: Object.freeze({
    status: 'rejected' as const,
    reason: 'stderr-evidence-mismatch' as const
  }),
  declaredFailureContaminated: Object.freeze({
    status: 'rejected' as const,
    reason: 'declared-failure-contaminated' as const
  }),
  unexpectedExit: Object.freeze({ status: 'rejected' as const, reason: 'unexpected-exit' as const }),
  protocolFrameInvalid: Object.freeze({
    status: 'rejected' as const,
    reason: 'protocol-frame-invalid' as const
  }),
  outputOwnershipUnproven: Object.freeze({
    status: 'rejected' as const,
    reason: 'output-ownership-unproven' as const
  })
});

export const SEMANTIC_MUTATION_RUNNER_BUILD_PROTOCOL_FRAME_INVALID =
  REJECTIONS.protocolFrameInvalid;
export const SEMANTIC_MUTATION_RUNNER_BUILD_OUTPUT_OWNERSHIP_UNPROVEN =
  REJECTIONS.outputOwnershipUnproven;

function observedDigest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function classifySemanticMutationRunnerBuildSettlement(
  outcome: ObservedCommandOutcome | undefined,
  observedStdout: Uint8Array
): SemanticMutationRunnerBuildSettlementClassification {
  if (outcome === undefined) return REJECTIONS.executeRejected;
  if (outcome.status === 'timed-out' || outcome.trigger === 'timed-out') {
    return REJECTIONS.timedOut;
  }
  if (!outcome.started) return REJECTIONS.notStarted;
  const closedTree = outcome.termination.childCloseObserved &&
    outcome.termination.streamsDrained && outcome.termination.treeClosed;
  if (!closedTree) return REJECTIONS.closureUnproven;
  if (outcome.termination.requested || outcome.termination.gracefulAttempted ||
    outcome.termination.forcedAttempted) {
    return REJECTIONS.requestedTermination;
  }
  if (outcome.status !== 'exited') return REJECTIONS.notExited;
  if (outcome.exitCode === null || outcome.signal !== null) {
    return REJECTIONS.exitStatusUnproven;
  }
  if (outcome.stdout.observerTruncated) return REJECTIONS.stdoutTruncated;
  if (outcome.stderr.observerTruncated) return REJECTIONS.stderrTruncated;
  const failureSubstage = semanticMutationRunnerBuildFailureSubstage(outcome.exitCode);
  if (failureSubstage !== undefined) {
    if (observedStdout.byteLength !== 0 || outcome.stdout.bytes !== 0 ||
      outcome.stdout.digest !== EMPTY_STREAM_DIGEST || outcome.stderr.bytes !== 0 ||
      outcome.stderr.digest !== EMPTY_STREAM_DIGEST) {
      return REJECTIONS.declaredFailureContaminated;
    }
    return Object.freeze({ status: 'child-failure' as const, substage: failureSubstage });
  }
  if (outcome.exitCode !== 0) return REJECTIONS.unexpectedExit;
  if (outcome.stdout.bytes !== observedStdout.byteLength ||
    outcome.stdout.digest !== observedDigest(observedStdout)) {
    return REJECTIONS.stdoutEvidenceMismatch;
  }
  if (outcome.stderr.bytes !== 0 || outcome.stderr.digest !== EMPTY_STREAM_DIGEST) {
    return REJECTIONS.stderrEvidenceMismatch;
  }
  return SUCCESS;
}
