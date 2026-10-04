import { canonicalEquals, rawSha256, sha256 } from '../../../../../contracts/canonical.ts';
import { parseExactJsonBytes } from '../../../../../contracts/exact-json.ts';
import {
  assertCiVerificationPerJobHostedWholeWorkflowShape,
  assertCiVerificationPerJobHostedWorkflowShape,
  getCiVerificationPerJobHostedJobPolicy,
  type CiVerificationPerJobHostedStage
} from '../../../../providers/github-api/contract/hosted-job-policy.ts';
import {
  currentGitHubApiCapability, executeGitHubApiOperation, inspectGitHubApiCapability,
  type GitHubApiCapability, type GitHubApiOperation
} from '../../../../providers/github-api/operation-session.ts';
import { SEC_LINUX_VERIFICATION_NATIVE_PROFILE } from '../../../../providers/linux-verification/contract.ts';
import { createCiVerificationNativeHostedExecutionEnvironment } from '../../action/contract/ci.ts';
import {
  assertHostedJobRuntimeReceiptOutput, hostedJobRuntimeReceiptComplete, parseHostedJobRuntimeReceiptBytes,
  type NativeHostedJobRuntimeReceipt
} from '../contract/hosted-job-runtime.ts';
import {
  CodexDevelopmentParseHostedActionRawResult, parseHostedSutCapabilityObservation
} from '../contract/hosted-sut-observation.ts';

const WORKFLOW_PATH = '.github/workflows/compiler-pr-validation.yml';
const RECEIPT_MEMBER = 'hosted-job-runtime-receipt.json';
const SUT_OUTPUTS = Object.freeze({
  'preflight-verification-action-sut': Object.freeze({ phase: 'self-test-hosted-action-sandbox', slot: 'capability',
    prefix: 'sec-verification-action-sut-capability-v2', member: 'hosted-sut-capability.json', projection: 'action-capability' as const }),
  'execute-verification-action-sut': Object.freeze({ phase: 'execute-hosted-action-sut', slot: 'raw',
    prefix: 'sec-verification-action-raw-v2', member: 'verification-action-raw-observation.json', projection: 'action-raw' as const })
});

/** Mechanical artifact identity shared by the producer and its readback. */
export function hostedJobSutArtifactName(
  policyJobId: keyof typeof SUT_OUTPUTS,
  actionKey: string,
  runId: string,
  runAttempt: number
): string {
  if (!Object.hasOwn(SUT_OUTPUTS, policyJobId) || !/^sha256:[0-9a-f]{64}$/u.test(actionKey)
      || !/^[1-9][0-9]{0,19}$/u.test(runId) || !Number.isSafeInteger(runAttempt)
      || runAttempt < 1 || runAttempt > 1000) fail('unsupported exact SUT artifact identity');
  return `${SUT_OUTPUTS[policyJobId].prefix}-${actionKey.slice(7)}-run-${runId}-attempt-${runAttempt}`;
}

export type HostedJobRuntimeReceiptSelection = Readonly<{
  repository: string; artifactId: string; runId: string; runAttempt: number;
  policyJobId: keyof typeof SUT_OUTPUTS; phase: string; actionKey: string;
}>;

export type HostedJobRuntimeReceiptSemanticBinding = Readonly<{
  repository: string; repositoryId: string; workflowSha: string;
  runId: string; runAttempt: number;
  policyJobId: keyof typeof SUT_OUTPUTS; phase: string; actionKey: string;
  outputDigest: string; sandboxObservationDigest: string;
  executionEnvironmentRevision: string;
  resolutionDigest: string;
}>;

export type HostedJobRuntimeReceiptProvenanceData = Readonly<{
  receipt: NativeHostedJobRuntimeReceipt;
  outputSource: string;
  provenance: Readonly<{
    artifactId: string; artifactName: string; archiveDigest: string;
    receiptMember: typeof RECEIPT_MEMBER; outputMember: string;
    checkRunUrl: string; launcherStepNumber: number; uploadStepNumber: number;
    artifactCreatedAtUnixMs: number; artifactUpdatedAtUnixMs: number;
    sourceAnchor: 'authenticated-current-default'; observedAtUnixMs: number;
  }>;
}>;

declare const authenticatedReceiptBrand: unique symbol;
/**
 * Authenticated transport/source attribution of a settled producer observation.
 * This is not a fresh live origin, native unit capability, hardware attestation or
 * independently signed artifact. No raw JWT is retained: the private OIDC
 * issuer and exact trusted launcher produced these fields under the reviewed
 * GitHub job/admin/bootstrap and no-credential-forwarding TCB. Process/root/
 * namespace, manager and cgroup identity digests remain producer observations.
 */
export type AuthenticatedHostedJobRuntimeReceipt = HostedJobRuntimeReceiptProvenanceData &
  Readonly<{ readonly [authenticatedReceiptBrand]: true }>;
const authenticatedReceipts = new WeakMap<object, HostedJobRuntimeReceiptProvenanceData>();

function fail(reason: string): never { throw new Error(`Hosted runtime receipt provenance: ${reason}.`); }
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('expected one response object');
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) fail('invalid provider ID');
  return String(value);
}
function digest(value: unknown): string {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) fail('missing immutable digest');
  return value;
}
function timestamp(value: unknown): number {
  const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 1) fail('invalid provider timestamp');
  return parsed;
}
function selection(input: HostedJobRuntimeReceiptSelection): HostedJobRuntimeReceiptSelection {
  const selected = Object.freeze({ repository: input.repository, artifactId: input.artifactId,
    runId: input.runId, runAttempt: input.runAttempt, policyJobId: input.policyJobId,
    phase: input.phase, actionKey: input.actionKey });
  if (typeof selected.repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(selected.repository)
      || typeof selected.artifactId !== 'string' || !/^[1-9][0-9]{0,19}$/u.test(selected.artifactId)
      || typeof selected.runId !== 'string' || !/^[1-9][0-9]{0,19}$/u.test(selected.runId)
      || !Number.isSafeInteger(selected.runAttempt) || selected.runAttempt < 1 || selected.runAttempt > 1000
      || !Object.hasOwn(SUT_OUTPUTS, selected.policyJobId)
      || SUT_OUTPUTS[selected.policyJobId].phase !== selected.phase) fail('unsupported exact SUT selection');
  digest(selected.actionKey);
  return selected;
}
function freezeData<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value)) freezeData(nested);
    Object.freeze(value);
  }
  return value;
}
function census(pages: readonly unknown[], field: 'jobs' | 'artifacts'): readonly Record<string, unknown>[] {
  if (pages.length < 1 || pages.length > 2) fail('incomplete or excessive census');
  let total: number | undefined;
  const records: Record<string, unknown>[] = [];
  for (const value of pages) {
    const page = object(value);
    if (!Number.isSafeInteger(page.total_count) || Number(page.total_count) < 1 || Number(page.total_count) > 200
        || (total !== undefined && total !== page.total_count) || !Array.isArray(page[field])
        || page[field].length > 100) fail('census changed or exceeded bounds');
    total = Number(page.total_count);
    records.push(...page[field].map(object));
  }
  if (records.length !== total || new Set(records.map(record => id(record.id))).size !== records.length) {
    fail('census is incomplete or duplicated');
  }
  return records;
}
function successfulStep(steps: readonly Record<string, unknown>[], name: string): Readonly<{
  number: number; started: number; completed: number;
}> {
  const matches = steps.filter(step => step.name === name);
  if (matches.length !== 1) fail('canonical producer step is not unique');
  const step = matches[0]!;
  if (step.status !== 'completed' || step.conclusion !== 'success'
      || !Number.isSafeInteger(step.number) || Number(step.number) < 1) fail('canonical producer step did not succeed');
  const started = timestamp(step.started_at), completed = timestamp(step.completed_at);
  if (completed < started) fail('producer step timestamp order differs');
  return Object.freeze({ number: Number(step.number), started, completed });
}

/** Data-only response validator. Its result is never entered in the proof table. */
export function decodeHostedJobRuntimeReceiptProvenance(input: Readonly<{
  selection: HostedJobRuntimeReceiptSelection;
  repository: unknown; defaultBranch: unknown; finalDefaultBranch: unknown;
  run: unknown; finalRun: unknown; jobs: readonly unknown[];
  artifact: unknown; artifacts: readonly unknown[];
  workflowSource: string; launcherSource: string;
  receiptSource: string; outputSource: string; observedAtUnixMs: number;
}>): HostedJobRuntimeReceiptProvenanceData {
  const selected = selection(input.selection), output = SUT_OUTPUTS[selected.policyJobId];
  const receipt = parseHostedJobRuntimeReceiptBytes(Buffer.from(input.receiptSource, 'utf8'));
  const origin = receipt.origin;
  if (!hostedJobRuntimeReceiptComplete(receipt) || receipt.execution.exitCode !== 0
      || origin.repository !== selected.repository || origin.workflowPath !== WORKFLOW_PATH
      || origin.runId !== selected.runId || origin.runAttempt !== selected.runAttempt
      || origin.policyJobId !== selected.policyJobId || origin.role !== 'sut'
      || receipt.operation.phase !== selected.phase || receipt.operation.actionKey !== selected.actionKey) {
    fail('receipt does not bind the selected complete SUT phase');
  }
  const environment = createCiVerificationNativeHostedExecutionEnvironment();
  const accepted = SEC_LINUX_VERIFICATION_NATIVE_PROFILE.acceptedContent;
  if (accepted.status !== 'accepted'
      || receipt.providerRevision !== environment.executionEnvironmentRevision
      || receipt.nativeUnit.inputs.runtimeManifestDigest !== accepted.manifestDigest) {
    fail('receipt does not bind the actually accepted native environment');
  }
  const repository = object(input.repository);
  if (repository.full_name !== selected.repository || id(repository.id) !== origin.repositoryId
      || repository.default_branch !== 'main') fail('repository binding differs');
  for (const value of [input.defaultBranch, input.finalDefaultBranch]) {
    const branch = object(value), commit = object(branch.commit);
    if (branch.name !== 'main' || commit.sha !== origin.workflowSha
        || origin.trustedSourceSha !== origin.workflowSha
        || object(object(commit.commit).tree).sha !== origin.trustedSourceTreeSha) {
      fail('receipt source is not the current authenticated default');
    }
  }
  assertCiVerificationPerJobHostedWholeWorkflowShape(input.workflowSource);
  const policy = assertCiVerificationPerJobHostedWorkflowShape(input.workflowSource, selected.policyJobId);
  if (policy !== getCiVerificationPerJobHostedJobPolicy(WORKFLOW_PATH, selected.policyJobId)
      || policy.runtime.kind !== 'per-job-runtime' || rawSha256(input.workflowSource) !== origin.workflowSourceDigest
      || rawSha256(input.launcherSource) !== origin.launcherSourceDigest) fail('exact source or policy binding differs');
  for (const value of [input.run, input.finalRun]) {
    const run = object(value), runRepository = object(run.repository);
    if (id(run.id) !== selected.runId || run.run_attempt !== selected.runAttempt
        || run.path !== WORKFLOW_PATH || run.head_sha !== origin.workflowSha || run.head_branch !== 'main'
        || run.event !== policy.trigger.eventName || runRepository.full_name !== selected.repository
        || id(runRepository.id) !== origin.repositoryId
        || !((run.status === 'in_progress' && run.conclusion === null)
          || (run.status === 'completed' && run.conclusion === 'success'))) fail('exact workflow run binding differs');
  }
  const jobs = census(input.jobs, 'jobs');
  const checkRunUrl = `https://api.github.com/repos/${selected.repository}/check-runs/${origin.checkRunId}`;
  const matchingJobs = jobs.filter(job => id(job.id) === origin.jobId || job.check_run_url === checkRunUrl
    || job.name === policy.jobName);
  if (matchingJobs.length !== 1) fail('producer job/check-run/phase is ambiguous');
  const job = matchingJobs[0]!;
  if (id(job.id) !== origin.jobId || id(job.run_id) !== selected.runId
      || (job.run_attempt !== undefined && job.run_attempt !== selected.runAttempt)
      || job.check_run_url !== checkRunUrl || job.name !== policy.jobName || job.head_sha !== origin.workflowSha
      || job.status !== 'completed' || job.conclusion !== 'success'
      || !canonicalEquals(job.labels, [policy.runnerLabel]) || !Array.isArray(job.steps)) fail('producer job binding differs');
  const started = timestamp(job.started_at), completed = timestamp(job.completed_at);
  if (!Number.isSafeInteger(input.observedAtUnixMs) || input.observedAtUnixMs < completed || completed < started
      || origin.originalDeadlineAtUnixMs !== started + policy.maximumJobDurationMs
      || completed > origin.originalDeadlineAtUnixMs) fail('producer original lifetime differs');
  const phases = policy.stages.filter(
    (stage): stage is Extract<CiVerificationPerJobHostedStage, { kind: 'phase' }> =>
      stage.kind === 'phase' && stage.phase === selected.phase);
  if (phases.length !== 1) fail('producer phase is not unique');
  const phase = phases[0]!;
  const uploads = policy.stages.filter(
    (stage): stage is Extract<CiVerificationPerJobHostedStage, { kind: 'upload' }> =>
      stage.kind === 'upload' && stage.slot === output.slot
      && stage.producerStepId === phase.stepId);
  if (uploads.length !== 1) fail('artifact slot has no unique closed phase writer');
  const steps = job.steps.map(object);
  if (steps.length > 100 || new Set(steps.map(step => step.number)).size !== steps.length) fail('step census is ambiguous');
  const launcher = successfulStep(steps, phase.stepName), upload = successfulStep(steps, uploads[0]!.stepName);
  let previous = { number: 0, completed: started };
  for (const name of ['Checkout exact trusted hosted launcher', 'Setup exact trusted bootstrap Bun',
    'Verify exact bootstrap Bun bytes', 'Install exact trusted launcher dependencies']) {
    const bootstrap = successfulStep(steps, name);
    if (bootstrap.number <= previous.number || bootstrap.started < previous.completed) fail('bootstrap order differs');
    previous = bootstrap;
  }
  if (launcher.number <= previous.number || launcher.started < previous.completed
      || upload.number <= launcher.number || upload.started < launcher.completed || upload.completed > completed) {
    fail('canonical launcher/upload order differs');
  }
  const artifact = object(input.artifact), artifactRun = object(artifact.workflow_run);
  const artifactName = hostedJobSutArtifactName(selected.policyJobId, selected.actionKey, selected.runId, selected.runAttempt);
  const archiveDigest = digest(artifact.digest);
  const artifactCreatedAtUnixMs = timestamp(artifact.created_at), artifactUpdatedAtUnixMs = timestamp(artifact.updated_at);
  if (id(artifact.id) !== selected.artifactId || artifact.name !== artifactName || artifact.expired !== false
      || !Number.isSafeInteger(artifact.size_in_bytes) || Number(artifact.size_in_bytes) < 1
      || Number(artifact.size_in_bytes) > 32 * 1024 * 1024
      || id(artifactRun.id) !== selected.runId || id(artifactRun.repository_id) !== origin.repositoryId
      || id(artifactRun.head_repository_id) !== origin.repositoryId || artifactRun.head_sha !== origin.workflowSha
      || artifactRun.head_branch !== 'main' || artifactCreatedAtUnixMs < upload.started
      || artifactUpdatedAtUnixMs < artifactCreatedAtUnixMs || artifactUpdatedAtUnixMs > upload.completed) {
    fail('immutable artifact or successful upload window differs');
  }
  const matchingArtifacts = census(input.artifacts, 'artifacts').filter(member => member.name === artifactName);
  if (matchingArtifacts.length !== 1) fail('artifact name has multiple or absent writers');
  const member = matchingArtifacts[0]!;
  for (const key of ['id', 'name', 'digest', 'size_in_bytes', 'expired', 'created_at', 'updated_at', 'workflow_run']) {
    if (!canonicalEquals(member[key], artifact[key])) fail('artifact census differs from exact readback');
  }
  if (typeof input.outputSource !== 'string' || Buffer.byteLength(input.outputSource, 'utf8') > 8 * 1024 * 1024
      || Buffer.byteLength(input.outputSource, 'utf8') !== receipt.execution.stdoutBytes
      || rawSha256(input.outputSource) !== receipt.execution.outputDigest) fail('same-archive output bytes differ');
  assertHostedJobRuntimeReceiptOutput(receipt, input.outputSource);
  const outputValue = parseExactJsonBytes(Buffer.from(input.outputSource, 'utf8'), 'Hosted runtime output',
    { maximumInputBytes: 8 * 1024 * 1024, maximumDepth: 32 });
  if (selected.policyJobId === 'execute-verification-action-sut') {
    const raw = CodexDevelopmentParseHostedActionRawResult(input.outputSource);
    if (raw.sandboxReceipt.actionKey !== selected.actionKey
        || raw.sandboxReceipt.receiptDigest !== receipt.execution.sandboxObservationDigest
        || raw.sandboxReceipt.authenticatedArchive.archiveDigest !== receipt.nativeUnit.inputs.sutArchiveDigest
        || timestamp(raw.startedAt) < launcher.started || timestamp(raw.finishedAt) > launcher.completed
        || timestamp(raw.finishedAt) > receipt.operation.deadlineAtUnixMs) fail('raw sandbox observation differs');
  } else {
    const capability = object(outputValue);
    if (capability.schema !== output.prefix || capability.actionKey !== selected.actionKey
        || receipt.nativeUnit.inputs.sutArchiveDigest !== null
        || sha256(parseHostedSutCapabilityObservation(capability.observation)) !== receipt.execution.sandboxObservationDigest) {
      fail('preflight sandbox observation differs');
    }
  }
  return freezeData({ receipt, outputSource: input.outputSource, provenance: {
    artifactId: selected.artifactId, artifactName, archiveDigest, receiptMember: RECEIPT_MEMBER,
    outputMember: output.member, checkRunUrl, launcherStepNumber: launcher.number, uploadStepNumber: upload.number,
    artifactCreatedAtUnixMs, artifactUpdatedAtUnixMs,
    sourceAnchor: 'authenticated-current-default' as const, observedAtUnixMs: input.observedAtUnixMs
  } });
}

async function sourceBlob(capability: GitHubApiCapability, ref: string, path: string): Promise<string> {
  const value = object(await executeGitHubApiOperation(capability, { kind: 'verification-blob', ref, path }));
  if (value.type !== 'file' || value.path !== path || value.encoding !== 'base64'
      || typeof value.content !== 'string' || value.content.length > 768 * 1024) fail('source blob is unavailable');
  const encoded = value.content.replace(/\n/gu, ''), bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded || value.size !== bytes.length || bytes.length > 512 * 1024) fail('source bytes differ');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
async function readCensus(capability: GitHubApiCapability, selected: Pick<HostedJobRuntimeReceiptSelection, 'runId' | 'runAttempt'>,
  field: 'jobs' | 'artifacts'): Promise<readonly unknown[]> {
  const pages: unknown[] = [];
  for (let page = 1; page <= 2; page += 1) {
    const operation: GitHubApiOperation = field === 'jobs'
      ? { kind: 'verification-workflow-jobs', runId: selected.runId, runAttempt: selected.runAttempt, page }
      : { kind: 'verification-artifacts', runId: selected.runId, page };
    const value = await executeGitHubApiOperation(capability, operation);
    pages.push(value);
    const total = object(value).total_count;
    if (!Number.isSafeInteger(total) || Number(total) < 1 || Number(total) > 200) fail('census bound exceeded');
    if (Number(total) <= page * 100) { census(pages, field); return pages; }
  }
  fail('incomplete census');
}

/** Resolve the original immutable artifact ID from its exact run/name census.
 * This is selection only; the same reader below still owns authentication. */
export async function readAuthenticatedHostedJobRuntimeReceiptByName(input:
  Omit<HostedJobRuntimeReceiptSelection, 'artifactId'> & Readonly<{ capability: GitHubApiCapability }>
): Promise<AuthenticatedHostedJobRuntimeReceipt> {
  const identity = inspectGitHubApiCapability(input.capability);
  if (identity.origin !== 'production' || identity.repository !== input.repository
      || identity.effect !== 'verification-read'
      || currentGitHubApiCapability(input.repository, 'verification-read') !== input.capability) {
    fail('artifact selection requires live original verification transport');
  }
  const name = hostedJobSutArtifactName(input.policyJobId, input.actionKey, input.runId, input.runAttempt);
  const artifacts = census(await readCensus(input.capability, input, 'artifacts'), 'artifacts');
  const matches = artifacts.filter(artifact => artifact.name === name);
  if (matches.length !== 1) fail('exact native runtime artifact has no unique immutable ID');
  return await readAuthenticatedHostedJobRuntimeReceipt({ ...input, artifactId: id(matches[0]!.id) });
}

/**
 * Only this real production API path can issue a proof. Selectors narrow the
 * query; neither expected DTOs, source hashes, JWKs nor test transports mint it.
 * Each exact member read is digest-bound by the original artifact transport
 * owner to the SAME immutable archive, even when fetched in separate requests.
 * Current-main is deliberately a conservative new-acceptance source anchor;
 * historical parsing never silently restores this authority.
 */
export async function readAuthenticatedHostedJobRuntimeReceipt(input: HostedJobRuntimeReceiptSelection &
  Readonly<{ capability: GitHubApiCapability }>): Promise<AuthenticatedHostedJobRuntimeReceipt> {
  const selected = selection(input), capability = input.capability;
  const identity = inspectGitHubApiCapability(capability);
  if (identity.origin !== 'production' || identity.repository !== selected.repository
      || identity.effect !== 'verification-read'
      || currentGitHubApiCapability(selected.repository, 'verification-read') !== capability) fail('requires live production verification transport');
  const repository = await executeGitHubApiOperation(capability, { kind: 'repository' });
  const defaultBranch = await executeGitHubApiOperation(capability, { kind: 'branch', branch: 'main' });
  const sourceSha = object(object(defaultBranch).commit).sha;
  if (typeof sourceSha !== 'string' || !/^[0-9a-f]{40}$/u.test(sourceSha)) fail('default source SHA is unavailable');
  const workflowSource = await sourceBlob(capability, sourceSha, WORKFLOW_PATH);
  assertCiVerificationPerJobHostedWholeWorkflowShape(workflowSource);
  const policy = assertCiVerificationPerJobHostedWorkflowShape(workflowSource, selected.policyJobId);
  if (policy.runtime.kind !== 'per-job-runtime') fail('runtime source is unavailable');
  const launcherSource = await sourceBlob(capability, sourceSha, policy.runtime.launcherPath);
  const run = await executeGitHubApiOperation(capability, { kind: 'workflow-run', runId: selected.runId });
  const artifact = object(await executeGitHubApiOperation(capability, { kind: 'verification-artifact', artifactId: selected.artifactId }));
  const archiveDigest = digest(artifact.digest), output = SUT_OUTPUTS[selected.policyJobId];
  const artifactName = hostedJobSutArtifactName(selected.policyJobId, selected.actionKey, selected.runId, selected.runAttempt);
  const members = object(await executeGitHubApiOperation(capability, { kind: 'verification-artifact-members',
    artifactId: selected.artifactId, artifactName, runId: selected.runId, archiveDigest, projection: output.projection }));
  const receiptSource = members[RECEIPT_MEMBER], outputSource = members[output.member];
  if (typeof receiptSource !== 'string' || typeof outputSource !== 'string') fail('artifact projection is unavailable');
  const jobs = await readCensus(capability, selected, 'jobs'), artifacts = await readCensus(capability, selected, 'artifacts');
  const finalRun = await executeGitHubApiOperation(capability, { kind: 'workflow-run', runId: selected.runId });
  const finalDefaultBranch = await executeGitHubApiOperation(capability, { kind: 'branch', branch: 'main' });
  const data = decodeHostedJobRuntimeReceiptProvenance({ selection: selected, repository, defaultBranch, finalDefaultBranch,
    run, finalRun, jobs, artifact, artifacts, workflowSource, launcherSource, receiptSource, outputSource, observedAtUnixMs: Date.now() });
  if (currentGitHubApiCapability(selected.repository, 'verification-read') !== capability) fail('original API session is no longer current');
  const proof = Object.freeze({ ...data }) as AuthenticatedHostedJobRuntimeReceipt;
  authenticatedReceipts.set(proof, data);
  return proof;
}

/** Match independently held Action/ticket/actual bytes; producer-only identities are not caller authority. */
export function assertAuthenticatedHostedJobRuntimeReceipt(proof: AuthenticatedHostedJobRuntimeReceipt,
  actual: HostedJobRuntimeReceiptSemanticBinding): HostedJobRuntimeReceiptProvenanceData {
  const data = authenticatedReceipts.get(proof);
  if (data === undefined) fail('proof was not issued by the authenticated reader');
  const { receipt } = data, { origin } = receipt;
  if (!canonicalEquals({ repository: origin.repository, repositoryId: origin.repositoryId, workflowSha: origin.workflowSha,
    runId: origin.runId, runAttempt: origin.runAttempt, policyJobId: origin.policyJobId,
    phase: receipt.operation.phase, actionKey: receipt.operation.actionKey,
    outputDigest: receipt.execution.outputDigest, sandboxObservationDigest: receipt.execution.sandboxObservationDigest,
    executionEnvironmentRevision: receipt.providerRevision, resolutionDigest: receipt.operation.resolutionDigest }, actual)) {
    fail('actual Action/ticket/job/output semantic binding differs');
  }
  return data;
}
