import { z } from 'zod';
import { canonicalEquals, rawSha256, sha256 } from '../../../../../contracts/canonical.ts';
import { parseExactJsonBytes } from '../../../../../contracts/exact-json.ts';
import { getCiVerificationPerJobHostedJobPolicy } from '../../../../providers/github-api/contract/hosted-job-policy.ts';
import { SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY } from '../../../../providers/linux-verification/contract.ts';
import { encodeVerificationActionData } from '../../action/contract/action.ts';
import { CI_VERIFICATION_PER_JOB_HOSTED_PROVIDER_REVISION } from '../../action/contract/environment.ts';
import { CI_HOSTED_JOB_NATIVE_RUNTIME_POLICY, CI_HOSTED_JOB_NATIVE_RUNTIME_POLICY_DIGEST, CI_HOSTED_JOB_RUNTIME_POLICY_DIGEST } from './hosted-job-runtime-policy.ts';

import { parseLinuxVerificationUnitReceipt } from '../../../../runtime-state/physical/contract/linux-verification-unit.ts';

export const HOSTED_JOB_RUNTIME_RECEIPT_SCHEMA = 'sec-hosted-job-runtime-receipt-v2' as const;
const LEGACY_HOSTED_JOB_RUNTIME_RECEIPT_SCHEMA = 'sec-hosted-job-runtime-receipt-v1' as const;
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
const nativeOuterSchema = z.object({ operationIdentityDigest: digest, boundAttemptDigest: digest,
  providerIdentityDigest: digest, inputDigest: digest, deadlineAtUnixMs: z.number().int().positive() }).strict();
const innerSupervisorSchema = z.object({ operationIdentityDigest: digest, boundAttemptDigest: digest,
  deadlineAtUnixMs: z.number().int().positive(), requirementId: z.literal('ci.hosted-sut-supervisor-process'),
  requirementContractDigest: digest, resourceCeilingIdentityDigest: digest, settlementReceiptDigest: digest }).strict();
const nativeControlSchema = z.object({ schema: z.literal('sec-hosted-sut-native-control-v1'),
  outer: nativeOuterSchema, phase: z.enum(['self-test-hosted-action-sandbox', 'execute-hosted-action-sut']),
  actionKey: digest, resolutionDigest: digest, innerSupervisor: innerSupervisorSchema, output: z.unknown() }).strict();
export type HostedSutNativeOuterCorrelation = Readonly<z.infer<typeof nativeOuterSchema>>;
export type HostedSutNativeControl = Readonly<z.infer<typeof nativeControlSchema>>;

/** The outer fields are transport correlation, never a restored operation. */
export function parseHostedSutNativeOuterCorrelation(value: unknown): HostedSutNativeOuterCorrelation {
  return Object.freeze(nativeOuterSchema.parse(value));
}

export function encodeHostedSutNativeControl(input: Omit<HostedSutNativeControl, 'schema'>): string {
  const control = nativeControlSchema.parse({ schema: 'sec-hosted-sut-native-control-v1', ...input });
  return `${encodeVerificationActionData(control)}\n`;
}

export function parseHostedSutNativeControl(source: Uint8Array): HostedSutNativeControl {
  return Object.freeze(nativeControlSchema.parse(parseExactJsonBytes(source, 'Native SUT control record',
    { maximumInputBytes: CI_HOSTED_JOB_NATIVE_RUNTIME_POLICY.outputBytesPerStream, maximumDepth: 64 })));
}
const receiptSchema = z.object({
  schema: z.literal(LEGACY_HOSTED_JOB_RUNTIME_RECEIPT_SCHEMA),
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
export type LegacyHostedJobRuntimeReceipt = Readonly<z.infer<typeof receiptSchema>>;
export type HostedJobRuntimeReceiptOrigin = Readonly<z.infer<typeof originSchema>>;

export function parseLegacyHostedJobRuntimeReceipt(value: unknown): LegacyHostedJobRuntimeReceipt {
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

const nativeReceiptSchema = z.object({
  schema: z.literal(HOSTED_JOB_RUNTIME_RECEIPT_SCHEMA),
  providerRevision: text,
  policyDigest: z.literal(CI_HOSTED_JOB_NATIVE_RUNTIME_POLICY_DIGEST),
  origin: originSchema,
  operation: z.object({ phase: text, actionKey: digest, operationIdentityDigest: digest,
    boundAttemptDigest: digest, deadlineAtUnixMs: z.number().int().positive(), resolutionDigest: digest }).strict(),
  nativeUnit: z.unknown().transform(value => parseLinuxVerificationUnitReceipt(value)),
  innerSupervisor: innerSupervisorSchema,
  execution: z.object({ started: z.literal(true), settled: z.literal(true),
    exitCode: z.number().int().min(0).max(255), stdoutBytes: z.number().int().nonnegative(),
    stderrBytes: z.number().int().nonnegative(), outputDigest: digest,
    outputTruncated: z.literal(false), sandboxObservationDigest: digest }).strict(),
  cleanup: z.object({ providerScopeSettled: z.literal(true), sessionSettlementDigest: digest, processSettlementDigest: digest,
    outputSettled: z.literal(true),
    ownedSourcesReleased: z.literal(true), innerSupervisorSettled: z.literal(true) }).strict(),
  receiptDigest: digest
}).strict();

/** Data, including historical data, is not a live unit or an authenticated job. */
export type NativeHostedJobRuntimeReceipt = Readonly<z.infer<typeof nativeReceiptSchema>>;
export type HostedJobRuntimeReceipt = LegacyHostedJobRuntimeReceipt | NativeHostedJobRuntimeReceipt;

export function parseHostedJobRuntimeReceipt(value: unknown): HostedJobRuntimeReceipt {
  if (value !== null && typeof value === 'object' && 'schema' in value
      && value.schema === LEGACY_HOSTED_JOB_RUNTIME_RECEIPT_SCHEMA) {
    return parseLegacyHostedJobRuntimeReceipt(value);
  }
  const receipt = nativeReceiptSchema.parse(value);
  const unit = receipt.nativeUnit;
  const policy = getCiVerificationPerJobHostedJobPolicy(receipt.origin.workflowPath, receipt.origin.policyJobId);
  if (policy === null || policy.runtime.kind !== 'per-job-runtime' || policy.role !== 'sut'
      || receipt.origin.role !== 'sut'
      || !policy.stages.some(stage => stage.kind === 'phase' && stage.phase === receipt.operation.phase)
      || receipt.origin.trustedSourceSha !== receipt.origin.workflowSha
      || receipt.operation.deadlineAtUnixMs > receipt.origin.originalDeadlineAtUnixMs
      || receipt.operation.operationIdentityDigest !== unit.operationIdentityDigest
      || receipt.operation.boundAttemptDigest !== unit.boundAttemptDigest
      || receipt.operation.deadlineAtUnixMs !== unit.deadlineAtUnixMs
      || unit.inputs.dependencyContentDigest === null
      || receipt.innerSupervisor.deadlineAtUnixMs > unit.deadlineAtUnixMs
      || receipt.innerSupervisor.operationIdentityDigest === unit.operationIdentityDigest
      || receipt.innerSupervisor.boundAttemptDigest === unit.boundAttemptDigest
      || unit.gitBefore.baseSha !== receipt.origin.trustedSourceSha
      || unit.gitBefore.baseTreeSha !== receipt.origin.trustedSourceTreeSha
      || unit.gitBefore.headSha !== receipt.origin.trustedSourceSha
      || unit.gitBefore.headTreeSha !== receipt.origin.trustedSourceTreeSha
      || !canonicalEquals(unit.gitBefore, unit.gitAfter)
      || receipt.execution.exitCode !== unit.execution.exitCode
      || receipt.execution.stderrBytes !== unit.execution.stderrBytes) {
    throw new Error('Native hosted runtime receipt differs from its actual source, unit, deadline or output.');
  }
  const { receiptDigest, ...content } = receipt;
  if (receiptDigest !== sha256(content)) throw new Error('Hosted job runtime receipt digest mismatch.');
  return Object.freeze(receipt);
}

/** Reconstruct the one fixed control channel from the same-archive public
 * output. Public output and outer stdout are distinct authenticated byte domains. */
export function assertHostedJobRuntimeReceiptOutput(receipt: NativeHostedJobRuntimeReceipt, outputSource: string): void {
  const parsed = parseHostedJobRuntimeReceipt(receipt);
  if (parsed.schema !== HOSTED_JOB_RUNTIME_RECEIPT_SCHEMA) throw new Error('Native SUT control requires a native receipt.');
  const output = parseExactJsonBytes(Buffer.from(outputSource, 'utf8'), 'Native SUT public output',
    { maximumInputBytes: CI_HOSTED_JOB_NATIVE_RUNTIME_POLICY.outputBytesPerStream, maximumDepth: 64 });
  if (outputSource !== `${encodeVerificationActionData(output)}\n`
      || rawSha256(outputSource) !== parsed.execution.outputDigest
      || Buffer.byteLength(outputSource, 'utf8') !== parsed.execution.stdoutBytes) {
    throw new Error('Native SUT public output bytes differ from its receipt.');
  }
  const unit = parsed.nativeUnit;
  const control = encodeHostedSutNativeControl({ outer: { operationIdentityDigest: unit.operationIdentityDigest,
    boundAttemptDigest: unit.boundAttemptDigest, providerIdentityDigest: unit.providerIdentityDigest,
    inputDigest: unit.inputDigest, deadlineAtUnixMs: unit.deadlineAtUnixMs },
    phase: nativeControlSchema.shape.phase.parse(parsed.operation.phase), actionKey: parsed.operation.actionKey,
    resolutionDigest: parsed.operation.resolutionDigest, innerSupervisor: parsed.innerSupervisor, output });
  if (rawSha256(control) !== unit.execution.stdoutDigest
      || Buffer.byteLength(control, 'utf8') !== unit.execution.stdoutBytes) {
    throw new Error('Native SUT control bytes differ from the original unit stdout.');
  }
}

export function parseHostedJobRuntimeReceiptBytes(bytes: Uint8Array): HostedJobRuntimeReceipt {
  return parseHostedJobRuntimeReceipt(parseExactJsonBytes(bytes, 'Hosted job runtime receipt',
    { maximumInputBytes: 64 * 1024, maximumDepth: 12 }));
}

/** Serialization only. The host producer must first consume the physical
 * owner's exact live result and all original source/process settlement. */
export function createHostedJobRuntimeReceipt(
  input: Omit<NativeHostedJobRuntimeReceipt, 'schema' | 'policyDigest' | 'receiptDigest'>
): NativeHostedJobRuntimeReceipt {
  const content = { schema: HOSTED_JOB_RUNTIME_RECEIPT_SCHEMA,
    policyDigest: CI_HOSTED_JOB_NATIVE_RUNTIME_POLICY_DIGEST, ...input };
  const parsed = parseHostedJobRuntimeReceipt({ ...content, receiptDigest: sha256(content) });
  if (parsed.schema !== HOSTED_JOB_RUNTIME_RECEIPT_SCHEMA) throw new Error('Native runtime receipt schema changed.');
  return parsed;
}

/** Independent current source/runtime/environment binding is mandatory at the
 * authenticated archive consumer; decoding a historical v1 cannot satisfy it. */
export function assertHostedJobRuntimeReceiptBinding(receipt: HostedJobRuntimeReceipt, expected: Readonly<{
  origin: HostedJobRuntimeReceiptOrigin;
  phase: string;
  actionKey: string;
  resolutionDigest: string;
  executionEnvironmentRevision: string;
  runtimeManifestDigest: string;
}>): asserts receipt is NativeHostedJobRuntimeReceipt {
  const parsed = parseHostedJobRuntimeReceipt(receipt);
  if (parsed.schema !== HOSTED_JOB_RUNTIME_RECEIPT_SCHEMA
      || !canonicalEquals(parsed.origin, expected.origin) || parsed.operation.phase !== expected.phase
      || parsed.operation.actionKey !== expected.actionKey
      || parsed.operation.resolutionDigest !== expected.resolutionDigest
      || parsed.providerRevision !== expected.executionEnvironmentRevision
      || parsed.nativeUnit.inputs.runtimeManifestDigest !== expected.runtimeManifestDigest) {
    throw new Error('Hosted job runtime receipt differs from independent native job, runtime or Action binding.');
  }
}

/** Completeness of native observations only; original authenticated evidence
 * consumer owns verdicts. Historical Docker data is never a native fallback. */
export function hostedJobRuntimeReceiptComplete(receipt: HostedJobRuntimeReceipt): receipt is NativeHostedJobRuntimeReceipt {
  const parsed = parseHostedJobRuntimeReceipt(receipt);
  return parsed.schema === HOSTED_JOB_RUNTIME_RECEIPT_SCHEMA
    && parsed.nativeUnit.execution.stdoutBytes <= CI_HOSTED_JOB_NATIVE_RUNTIME_POLICY.outputBytesPerStream
    && parsed.execution.stdoutBytes <= CI_HOSTED_JOB_NATIVE_RUNTIME_POLICY.outputBytesPerStream
    && parsed.execution.stderrBytes <= CI_HOSTED_JOB_NATIVE_RUNTIME_POLICY.outputBytesPerStream;
}
