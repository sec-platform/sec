import { hostedJobRuntimeReceiptComplete, parseHostedJobRuntimeReceipt, type HostedJobRuntimeReceipt } from './hosted-job-runtime.ts';

/** Historical transport data only. The real assembler additionally requires the
 * private proof issued by the production GitHub artifact reader. */
export type HostedActionRuntimeExecution = Readonly<{
  receipt: HostedJobRuntimeReceipt;
  transport: Readonly<{
    artifactId: string; artifactName: string; archiveDigest: string;
    receiptMember: 'hosted-job-runtime-receipt.json'; outputMember: 'verification-action-raw-observation.json';
    checkRunUrl: string; launcherStepNumber: number; uploadStepNumber: number;
    artifactCreatedAtUnixMs: number; artifactUpdatedAtUnixMs: number;
    sourceAnchor: 'authenticated-current-default'; observedAtUnixMs: number;
  }>;
}>;

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) {
    throw new Error('Hosted runtime execution record has unknown or missing fields.');
  }
  return value as Record<string, unknown>;
}

export function parseHostedActionRuntimeExecution(value: unknown): HostedActionRuntimeExecution {
  const record = exact(value, ['receipt', 'transport']);
  const receipt = parseHostedJobRuntimeReceipt(record.receipt);
  const transport = exact(record.transport, ['artifactId', 'artifactName', 'archiveDigest', 'receiptMember',
    'outputMember', 'checkRunUrl', 'launcherStepNumber', 'uploadStepNumber',
    'artifactCreatedAtUnixMs', 'artifactUpdatedAtUnixMs', 'sourceAnchor', 'observedAtUnixMs']);
  const positive = (value: unknown) => Number.isSafeInteger(value) && Number(value) > 0;
  if (typeof transport.artifactId !== 'string' || !/^[1-9][0-9]{0,19}$/u.test(transport.artifactId)
    || typeof transport.archiveDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(transport.archiveDigest)
    || typeof transport.artifactName !== 'string' || transport.artifactName.length > 255
    || transport.receiptMember !== 'hosted-job-runtime-receipt.json'
    || transport.outputMember !== 'verification-action-raw-observation.json'
    || transport.sourceAnchor !== 'authenticated-current-default'
    || !positive(transport.launcherStepNumber) || !positive(transport.uploadStepNumber)
    || Number(transport.launcherStepNumber) >= Number(transport.uploadStepNumber)
    || Number(transport.uploadStepNumber) > 100
    || !positive(transport.artifactCreatedAtUnixMs) || !positive(transport.artifactUpdatedAtUnixMs)
    || !positive(transport.observedAtUnixMs)
    || Number(transport.artifactCreatedAtUnixMs) > Number(transport.artifactUpdatedAtUnixMs)
    || Number(transport.artifactUpdatedAtUnixMs) > Number(transport.observedAtUnixMs)
    || Number(transport.artifactUpdatedAtUnixMs) > receipt.origin.originalDeadlineAtUnixMs
    || !hostedJobRuntimeReceiptComplete(receipt) || receipt.execution.exitCode !== 0
    || receipt.origin.policyJobId !== 'execute-verification-action-sut' || receipt.origin.role !== 'sut'
    || receipt.operation.phase !== 'execute-hosted-action-sut' || receipt.operation.actionKey === null
    || transport.artifactName !== `sec-verification-action-raw-v2-${receipt.operation.actionKey.slice(7)}`
      + `-run-${receipt.origin.runId}-attempt-${receipt.origin.runAttempt}`
    || transport.checkRunUrl !== `https://api.github.com/repos/${receipt.origin.repository}/check-runs/${receipt.origin.checkRunId}`) {
    throw new Error('Hosted runtime execution record is not a complete executing-job transport.');
  }
  return Object.freeze({ receipt, transport: Object.freeze({ ...transport }) }) as HostedActionRuntimeExecution;
}

export function assertHostedActionRuntimeExecutionBinding(record: HostedActionRuntimeExecution, expected: Readonly<{
  actionKey: string; repository: string; repositoryId: number; baseSha: string; baseTreeSha: string;
  runId: string; runAttempt: number; sandboxReceiptDigest: string;
}>): void {
  const { receipt } = parseHostedActionRuntimeExecution(record);
  if (receipt.operation.actionKey !== expected.actionKey || receipt.origin.repository !== expected.repository
    || receipt.origin.repositoryId !== String(expected.repositoryId) || receipt.origin.workflowSha !== expected.baseSha
    || receipt.origin.trustedSourceSha !== expected.baseSha || receipt.origin.trustedSourceTreeSha !== expected.baseTreeSha
    || receipt.origin.runId !== expected.runId || receipt.origin.runAttempt !== expected.runAttempt
    || receipt.execution.sandboxObservationDigest !== expected.sandboxReceiptDigest) {
    throw new Error('Hosted runtime execution record differs from the exact Action, source, run or inner receipt.');
  }
}
