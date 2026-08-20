import { compareCodeUnits } from '../../platform/shared/canonical-primitives.ts';
import {
  auditBranchLifecycle as auditBranchLifecycleCore
} from './branch-lifecycle-audit.ts';
import type {
  BranchCloseoutAttempt,
  BranchLifecycleAuditFinding,
  BranchLifecycleAuditReport,
  BranchLifecycleDispositionRecord,
  BranchLifecycleInventory,
  BranchPullRequestObservation
} from './branch-lifecycle-types.ts';

const REQUIRED_TERMINAL_OPERATIONS: readonly BranchCloseoutAttempt['operation'][] = [
  'recovery-create',
  'recovery-verify',
  'remote-delete',
  'local-delete',
  'prune',
  'readback'
];

function finding(
  code: string,
  message: string,
  pullRequest: BranchPullRequestObservation
): BranchLifecycleAuditFinding {
  return {
    code,
    severity: 'error',
    branch: pullRequest.headBranch,
    message: `PR #${pullRequest.number}: ${message}`
  };
}

function terminalAttemptFindings(
  pullRequest: BranchPullRequestObservation
): BranchLifecycleAuditFinding[] {
  const receipt = pullRequest.closeoutReceipt?.receipt;
  if (
    receipt === null
    || receipt === undefined
    || (receipt.closeoutStatus !== 'completed' && receipt.closeoutStatus !== 'protected-pending')
  ) {
    return [];
  }
  const findings: BranchLifecycleAuditFinding[] = [];
  const failed = receipt.attempts.filter(({ status }) => status === 'failed');
  if (failed.length > 0) {
    findings.push(finding(
      'closeout-receipt-attempt-failed',
      `terminal receipt contains failed attempts: ${failed.map(({ operation }) => operation).join(', ')}`,
      pullRequest
    ));
  }
  for (const operation of REQUIRED_TERMINAL_OPERATIONS) {
    if (!receipt.attempts.some((attempt) => attempt.operation === operation)) {
      findings.push(finding(
        'closeout-receipt-attempt-missing',
        `terminal receipt is missing ${operation}`,
        pullRequest
      ));
    }
  }
  return findings;
}

function receiptFindings(
  inventory: BranchLifecycleInventory
): { findings: BranchLifecycleAuditFinding[]; unknown: boolean } {
  const findings: BranchLifecycleAuditFinding[] = [];
  let unknown = false;
  for (const pullRequest of inventory.pullRequests) {
    if (
      pullRequest.isCrossRepository
      || (pullRequest.state !== 'merged' && pullRequest.state !== 'closed')
      || pullRequest.closeoutReceipt === undefined
    ) {
      continue;
    }
    const observation = pullRequest.closeoutReceipt;
    if (observation.requirement === 'not-required') continue;
    if (observation.requirement === 'unknown' || observation.status === 'unknown') {
      unknown = true;
      findings.push(finding(
        'closeout-receipt-applicability-unknown',
        observation.reason ?? 'receipt enforcement applicability is unknown',
        pullRequest
      ));
      continue;
    }
    if (observation.status === 'missing') {
      findings.push(finding(
        'closeout-receipt-missing',
        observation.reason ?? 'required closeout receipt is missing',
        pullRequest
      ));
      continue;
    }
    if (observation.status === 'invalid') {
      findings.push(finding(
        'closeout-receipt-invalid',
        observation.reason ?? 'published closeout receipt is invalid',
        pullRequest
      ));
      continue;
    }
    if (observation.status === 'conflicted') {
      findings.push(finding(
        'closeout-receipt-conflicted',
        observation.reason ?? 'published closeout receipts conflict',
        pullRequest
      ));
      continue;
    }
    if (observation.status !== 'present' || observation.receipt === null) {
      findings.push(finding(
        'closeout-receipt-state-invalid',
        `unexpected receipt observation ${observation.status}`,
        pullRequest
      ));
      continue;
    }
    if (
      observation.receipt.closeoutStatus !== 'completed'
      && observation.receipt.closeoutStatus !== 'protected-pending'
    ) {
      findings.push(finding(
        'closeout-receipt-nonterminal',
        `published receipt reports ${observation.receipt.closeoutStatus}`,
        pullRequest
      ));
    }
    if (pullRequest.state === 'merged' && observation.receipt.mainSha === null) {
      findings.push(finding(
        'closeout-receipt-main-missing',
        'merged closeout receipt does not bind a main SHA',
        pullRequest
      ));
    }
    findings.push(...terminalAttemptFindings(pullRequest));
  }
  return { findings, unknown };
}

export function auditBranchLifecycle(
  inventory: BranchLifecycleInventory,
  dispositions: readonly BranchLifecycleDispositionRecord[] = []
): BranchLifecycleAuditReport {
  const core = auditBranchLifecycleCore(inventory, dispositions);
  const receipts = receiptFindings(inventory);
  const findings = [...core.findings, ...receipts.findings].sort((left, right) =>
    compareCodeUnits(left.severity, right.severity)
    || compareCodeUnits(left.branch ?? '', right.branch ?? '')
    || compareCodeUnits(left.code, right.code)
    || compareCodeUnits(left.message, right.message)
  );
  const hasError = findings.some(({ severity }) => severity === 'error');
  const status = receipts.unknown || core.status === 'blocked'
    ? 'blocked'
    : hasError || core.status === 'drift'
      ? 'drift'
      : core.status;
  return { ...core, status, findings };
}
