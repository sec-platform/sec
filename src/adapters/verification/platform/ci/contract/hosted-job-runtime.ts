import { z } from 'zod';
import { canonicalEquals, sha256 } from '../../../../../contracts/canonical.ts';
import { parseExactJsonBytes } from '../../../../../contracts/exact-json.ts';
import { getCiVerificationPerJobHostedJobPolicy } from '../../../../providers/github-api/contract/hosted-job-policy.ts';
import { SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY } from '../../../../providers/linux-verification/contract.ts';
import { CI_VERIFICATION_PER_JOB_HOSTED_PROVIDER_REVISION } from '../../action/contract/environment.ts';
import { CI_HOSTED_JOB_RUNTIME_POLICY, CI_HOSTED_JOB_RUNTIME_POLICY_DIGEST } from './hosted-job-runtime-policy.ts';

export const HOSTED_JOB_RUNTIME_RECEIPT_SCHEMA = 'sec-hosted-job-runtime-receipt-v1' as const;
const digest = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const sha = z.string().regex(/^[0-9a-f]{40}$/u);
const id = z.string().regex(/^[1-9][0-9]{0,19}$/u);
const text = z.string().min(1).max(512).refine(value => !/[\u0000-\u001f\u007f]/u.test(value));
const environment = SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY;
const originSchema = z.object({
  repository: text, repositoryId: id, workflowPath: text, workflowSha: sha,
  trustedSourceSha: sha, trustedSourceTreeSha: sha, runId: id,
  runAttempt: z.number().int().min(1).max(1000), jobId: id, checkRunId: id,
  policyJobId: text, role: z.enum(['control', 'trusted', 'sut']),
  identityDigest: digest, workflowSourceDigest: digest, launcherSourceDigest: digest,
  originalDeadlineAtUnixMs: z.number().int().positive()
}).strict();
const receiptSchema = z.object({
  schema: z.literal(HOSTED_JOB_RUNTIME_RECEIPT_SCHEMA),
  providerRevision: z.literal(CI_VERIFICATION_PER_JOB_HOSTED_PROVIDER_REVISION),
  policyDigest: z.literal(CI_HOSTED_JOB_RUNTIME_POLICY_DIGEST),
  origin: originSchema,
  operation: z.object({ phase: text, actionKey: digest.nullable(), operationIdentityDigest: digest,
    boundAttemptDigest: digest, deadlineAtUnixMs: z.number().int().positive() }).strict(),
  materialization: z.object({ specDigest: digest, runtimeManifestDigest: z.literal(environment.image.runtimeContentDigest),
    dockerProjectionDigest: z.literal(environment.image.dockerProjectionDigest), provenanceArtifactDigest: digest,
    executionImageDigest: z.literal(environment.trustedRuntime.imageDigest),
    bunExecutableDigest: z.literal(environment.trustedRuntime.bunExecutableDigest),
    engineProviderIdentityDigest: digest, ociExporterIdentityDigest: digest }).strict(),
  container: z.object({ id: z.string().regex(/^[0-9a-f]{64}$/u), name: text,
    ownershipDigest: digest, creationReadbackDigest: digest,
    startedReadbackDigest: digest.nullable(), terminalReadbackDigest: digest.nullable() }).strict(),
  execution: z.object({ started: z.boolean(), settled: z.boolean(), exitCode: z.number().int().min(0).max(255).nullable(),
    stdoutBytes: z.number().int().nonnegative(), stderrBytes: z.number().int().nonnegative(),
    outputDigest: digest, outputTruncated: z.boolean(), sandboxObservationDigest: digest.nullable() }).strict(),
  cleanup: z.object({ containerAbsent: z.boolean(), providerScopeSettled: z.boolean(),
    outputSettled: z.boolean(), ownedSourcesReleased: z.boolean() }).strict(),
  receiptDigest: digest
}).strict();

/** Serializable observation only. Parsing/self-hashing never issues a live runtime. */
export type HostedJobRuntimeReceipt = Readonly<z.infer<typeof receiptSchema>>;
export type HostedJobRuntimeReceiptOrigin = Readonly<z.infer<typeof originSchema>>;

export function parseHostedJobRuntimeReceipt(value: unknown): HostedJobRuntimeReceipt {
  const receipt = receiptSchema.parse(value);
  const policy = getCiVerificationPerJobHostedJobPolicy(receipt.origin.workflowPath, receipt.origin.policyJobId);
  if (policy === null || policy.runtime.kind !== 'per-job-runtime' || policy.role !== receipt.origin.role
      || !policy.stages.some(stage => stage.kind === 'phase' && stage.phase === receipt.operation.phase)
      || receipt.origin.trustedSourceSha !== receipt.origin.workflowSha
      || receipt.operation.deadlineAtUnixMs > receipt.origin.originalDeadlineAtUnixMs) {
    throw new Error('Hosted job runtime receipt has no exact source, job, role, phase or original deadline binding.');
  }
  const { receiptDigest, ...content } = receipt;
  if (receiptDigest !== sha256(content)) throw new Error('Hosted job runtime receipt digest mismatch.');
  return Object.freeze(receipt);
}

export function parseHostedJobRuntimeReceiptBytes(bytes: Uint8Array): HostedJobRuntimeReceipt {
  return parseHostedJobRuntimeReceipt(parseExactJsonBytes(bytes, 'Hosted job runtime receipt',
    { maximumInputBytes: 64 * 1024, maximumDepth: 8 }));
}

export function createHostedJobRuntimeReceipt(
  input: Omit<HostedJobRuntimeReceipt, 'schema' | 'providerRevision' | 'policyDigest' | 'receiptDigest'>
): HostedJobRuntimeReceipt {
  const content = { schema: HOSTED_JOB_RUNTIME_RECEIPT_SCHEMA,
    providerRevision: CI_VERIFICATION_PER_JOB_HOSTED_PROVIDER_REVISION,
    policyDigest: CI_HOSTED_JOB_RUNTIME_POLICY_DIGEST, ...input };
  return parseHostedJobRuntimeReceipt({ ...content, receiptDigest: sha256(content) });
}

/**
 * The assembler supplies its independently authenticated artifact/job binding.
 * This comparison does not authenticate the expected DTO or issue a Gate PASS.
 */
export function assertHostedJobRuntimeReceiptBinding(receipt: HostedJobRuntimeReceipt, expected: Readonly<{
  origin: HostedJobRuntimeReceiptOrigin;
  phase: string;
  actionKey: string | null;
  executionImageDigest: string;
  ociExporterIdentityDigest: string;
}>): void {
  const parsed = parseHostedJobRuntimeReceipt(receipt);
  if (!canonicalEquals(parsed.origin, expected.origin) || parsed.operation.phase !== expected.phase
      || parsed.operation.actionKey !== expected.actionKey
      || parsed.materialization.executionImageDigest !== expected.executionImageDigest
      || parsed.materialization.ociExporterIdentityDigest !== expected.ociExporterIdentityDigest) {
    throw new Error('Hosted job runtime receipt differs from independent job, materialization or Action binding.');
  }
}

/** Completeness of observations only; original authenticated evidence consumer owns verdicts. */
export function hostedJobRuntimeReceiptComplete(receipt: HostedJobRuntimeReceipt): boolean {
  const parsed = parseHostedJobRuntimeReceipt(receipt);
  return parsed.container.startedReadbackDigest !== null && parsed.container.terminalReadbackDigest !== null
    && parsed.execution.started && parsed.execution.settled && parsed.execution.exitCode !== null
    && !parsed.execution.outputTruncated
    && parsed.execution.stdoutBytes <= CI_HOSTED_JOB_RUNTIME_POLICY.outputBytesPerStream
    && parsed.execution.stderrBytes <= CI_HOSTED_JOB_RUNTIME_POLICY.outputBytesPerStream
    && (parsed.origin.role !== 'sut' || parsed.execution.sandboxObservationDigest !== null)
    && Object.values(parsed.cleanup).every(value => value === true);
}
