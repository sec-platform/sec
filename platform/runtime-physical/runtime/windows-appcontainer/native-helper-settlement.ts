import { rawSha256 } from '../../../foundation/canonical.ts';

import type { ObservedCommandOutcome } from '../observed-process.ts';

export type WindowsAppContainerObservedNativeHelperMode =
  | 'derive'
  | 'create-profile'
  | 'suspended-create'
  | 'execute';

export type WindowsAppContainerObservedNativeHelperSettlementRejection =
  | 'timed-out'
  | 'not-started'
  | 'closure-unproven'
  | 'requested-termination'
  | 'not-exited'
  | 'exit-status-unproven'
  | 'stdout-truncated'
  | 'stderr-truncated'
  | 'stdout-evidence-mismatch'
  | 'stderr-evidence-mismatch';

export type WindowsAppContainerObservedNativeHelperSettlementClassification =
  | Readonly<{ readonly status: 'success' }>
  | Readonly<{
      readonly status: 'rejected';
      readonly reason: WindowsAppContainerObservedNativeHelperSettlementRejection;
    }>;

export type WindowsAppContainerObservedNativeHelperSettlement = Readonly<{
  readonly mode: WindowsAppContainerObservedNativeHelperMode;
  readonly reason: WindowsAppContainerObservedNativeHelperSettlementRejection;
}>;

export interface WindowsAppContainerObservedNativeHelperDiagnosticCapture {
  readonly bytes: number;
  readonly digest: `sha256:${string}`;
  readonly present: boolean;
}

const CLASSIFICATIONS = Object.freeze({
  success: Object.freeze({ status: 'success' as const }),
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
  })
});

export const WINDOWS_APPCONTAINER_OBSERVED_NATIVE_HELPER_EXIT_STATUS_UNPROVEN =
  CLASSIFICATIONS.exitStatusUnproven;

const settlementsByError =
  new WeakMap<Error, WindowsAppContainerObservedNativeHelperSettlement>();

function observedOutputMatches(
  contents: Uint8Array,
  evidence: ObservedCommandOutcome['stdout']
): boolean {
  return evidence.bytes === contents.byteLength &&
    evidence.digest === rawSha256(contents);
}

export function classifyWindowsAppContainerObservedNativeHelperSettlement(
  outcome: ObservedCommandOutcome,
  stdout: Uint8Array,
  diagnostic: WindowsAppContainerObservedNativeHelperDiagnosticCapture
): WindowsAppContainerObservedNativeHelperSettlementClassification {
  if (outcome.status === 'timed-out' || outcome.trigger === 'timed-out') {
    return CLASSIFICATIONS.timedOut;
  }
  if (!outcome.started) return CLASSIFICATIONS.notStarted;
  const closedTree = outcome.termination.childCloseObserved &&
    outcome.termination.streamsDrained && outcome.termination.treeClosed;
  if (!closedTree) return CLASSIFICATIONS.closureUnproven;
  if (outcome.termination.requested) return CLASSIFICATIONS.requestedTermination;
  if (outcome.status !== 'exited') return CLASSIFICATIONS.notExited;
  if (outcome.exitCode === null || outcome.signal !== null) {
    return CLASSIFICATIONS.exitStatusUnproven;
  }
  if (outcome.stdout.observerTruncated) return CLASSIFICATIONS.stdoutTruncated;
  if (outcome.stderr.observerTruncated) return CLASSIFICATIONS.stderrTruncated;
  if (!observedOutputMatches(stdout, outcome.stdout)) {
    return CLASSIFICATIONS.stdoutEvidenceMismatch;
  }
  if (diagnostic.bytes !== outcome.stderr.bytes ||
    diagnostic.digest !== outcome.stderr.digest ||
    diagnostic.present !== (outcome.stderr.bytes > 0)) {
    return CLASSIFICATIONS.stderrEvidenceMismatch;
  }
  return CLASSIFICATIONS.success;
}

export function bindWindowsAppContainerObservedNativeHelperSettlement(
  error: Error,
  mode: WindowsAppContainerObservedNativeHelperMode,
  classification: WindowsAppContainerObservedNativeHelperSettlementClassification
): void {
  if (classification.status !== 'rejected') return;
  settlementsByError.set(error, Object.freeze({ mode, reason: classification.reason }));
}

export function copyWindowsAppContainerObservedNativeHelperSettlement(
  source: Error,
  target: Error
): void {
  const settlement = settlementsByError.get(source);
  if (settlement) settlementsByError.set(target, settlement);
}

/** Test-only finite sidecar; it never retains process, command, path, or output values. */
export function windowsAppContainerObservedNativeHelperSettlementForTests(
  error: Error
): WindowsAppContainerObservedNativeHelperSettlement | undefined {
  return settlementsByError.get(error);
}
