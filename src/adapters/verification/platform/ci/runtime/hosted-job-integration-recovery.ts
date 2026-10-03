/** Exact post-upload readback. A transport observation never grants integration authority. */
import { parseExactJsonBytes } from '../../../../../contracts/exact-json.ts';
import {
  assertAuthenticatedGitHubJobOriginCurrent, getAuthenticatedGitHubJobOriginSignal,
  type AuthenticatedGitHubJobOrigin, type AuthenticatedGitHubJobOriginObservation
} from '../../../../providers/github-api/hosted-job-origin.ts';
import {
  currentGitHubApiCapability, executeGitHubApiOperation, inspectGitHubApiCapability,
  withGitHubApiVerificationSession
} from '../../../../providers/github-api/operation-session.ts';

const WORKFLOW = '.github/workflows/merge-gate.yml';
function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Integration recovery observation is not an object.');
  return value as Record<string, unknown>;
}
function json(value: string): Record<string, unknown> {
  return record(parseExactJsonBytes(Buffer.from(value), 'Integration native channel', { maximumInputBytes: 1024 * 1024, maximumDepth: 16 }));
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/u.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Integration recovery identity is not a canonical positive integer.');
  return value;
}
function providerId(value: unknown): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error('Integration recovery provider identity is invalid.');
  return String(value);
}
function time(value: unknown): number {
  const result = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isSafeInteger(result) || result < 1) throw new Error('Integration recovery timestamp is invalid.');
  return result;
}

/** Pure readback predicate; only the production owner below supplies live observations. */
export function assertHostedIntegrationRecoveryReadback(input: Readonly<{
  origin: Pick<AuthenticatedGitHubJobOriginObservation, 'repository' | 'repositoryId' | 'runId' | 'runAttempt' | 'workflowSha' | 'trustedSourceSha' | 'jobId' | 'stepNumber' | 'stepName'>;
  artifactId: string; artifactName: string; archiveDigest: string; observedAtUnixMs: number;
  artifact: unknown; run: unknown; job: unknown;
}>): void {
  const { origin } = input;
  const artifact = record(input.artifact), run = record(input.run), job = record(input.job);
  const artifactRun = record(artifact.workflow_run), repository = record(run.repository);
  if (providerId(artifact.id) !== id(input.artifactId) || artifact.name !== input.artifactName
      || artifact.expired !== false || !Number.isSafeInteger(artifact.size_in_bytes)
      || Number(artifact.size_in_bytes) < 1 || Number(artifact.size_in_bytes) > 32 * 1024 * 1024
      || artifact.digest !== input.archiveDigest || !/^sha256:[0-9a-f]{64}$/u.test(input.archiveDigest)
      || providerId(artifactRun.id) !== origin.runId || artifactRun.head_sha !== origin.workflowSha
      || providerId(run.id) !== origin.runId || run.run_attempt !== origin.runAttempt
      || run.status !== 'in_progress' || run.conclusion !== null
      || !Number.isSafeInteger(input.observedAtUnixMs) || input.observedAtUnixMs < 1
      || run.path !== WORKFLOW || run.head_sha !== origin.workflowSha
      || origin.trustedSourceSha !== origin.workflowSha
      || providerId(repository.id) !== origin.repositoryId || repository.full_name !== origin.repository
      || providerId(job.id) !== origin.jobId || providerId(job.run_id) !== origin.runId
      || job.run_attempt !== origin.runAttempt || job.head_sha !== origin.workflowSha
      || job.name !== 'authorize' || job.status !== 'in_progress' || job.conclusion !== null
      || !Array.isArray(job.steps)) throw new Error('Recovery artifact API identity differs from this authenticated integration job.');
  const steps = job.steps.map(record);
  const uploads = steps.filter(step => step.name === 'Upload exact branch closeout recovery artifact');
  const verifies = steps.filter(step => step.number === origin.stepNumber && step.name === origin.stepName);
  if (uploads.length !== 1 || verifies.length !== 1) throw new Error('Integration recovery producer/consumer step inventory is ambiguous.');
  const upload = uploads[0]!, verify = verifies[0]!;
  if (upload.status !== 'completed' || upload.conclusion !== 'success'
      || !Number.isSafeInteger(upload.number) || Number(upload.number) >= origin.stepNumber
      || verify.status !== 'in_progress' || verify.conclusion !== null
      || time(artifact.created_at) < time(upload.started_at)
      || time(artifact.updated_at) < time(artifact.created_at)
      || time(artifact.updated_at) > time(upload.completed_at)
      || time(job.started_at) > time(upload.started_at)
      || time(upload.started_at) > time(upload.completed_at)
      || time(verify.started_at) > input.observedAtUnixMs
      || time(upload.completed_at) > time(verify.started_at)) {
    throw new Error('Recovery artifact is not the settled upload preceding this exact verification phase.');
  }
}

/** Native channel decoding supplies locators only, never provider or effect authority. */
export function parseHostedIntegrationRecoveryChannels(input: Readonly<{
  origin: Pick<AuthenticatedGitHubJobOriginObservation, 'runId' | 'runAttempt' | 'trustedSourceSha'>;
  needsJson: string; stepsJson: string;
}>): Readonly<{ artifactId: string; artifactName: string; digest: string }> {
  const { origin, needsJson, stepsJson } = input;
  const needs = json(needsJson), steps = json(stepsJson);
  const plan = record(needs.plan), planned = record(plan.outputs);
  const prepare = record(steps.prepare), prepared = record(prepare.outputs);
  const upload = record(steps['upload-recovery']), uploaded = record(upload.outputs);
  if (plan.result !== 'success' || prepare.outcome !== 'success' || upload.outcome !== 'success'
      || prepared['integration-lane'] !== 'open-first-effect') throw new Error('Integration recovery lacks its successful original preparation/upload.');
  const prNumber = id(planned['pr-number']);
  const sessionRevision = planned['session-revision'];
  if (typeof sessionRevision !== 'string' || !/^[0-9a-f]{64}$/u.test(sessionRevision)
      || planned['base-sha'] !== origin.trustedSourceSha) throw new Error('Integration recovery planned source or Session identity differs.');
  const artifactName = `sec-branch-closeout-recovery-v1-pr-${prNumber}-session-${sessionRevision}-run-${origin.runId}-attempt-${origin.runAttempt}`;
  if (prepared['recovery-artifact-name'] !== artifactName) throw new Error('Integration recovery artifact name differs from its exact preparation.');
  const artifactId = id(uploaded['artifact-id']);
  const archiveDigest = uploaded['artifact-digest'];
  if (typeof archiveDigest !== 'string' || !/^(?:sha256:)?[0-9a-f]{64}$/u.test(archiveDigest)) throw new Error('Integration recovery upload digest is absent.');
  const digest = archiveDigest.startsWith('sha256:') ? archiveDigest : `sha256:${archiveDigest}`;
  return Object.freeze({ artifactId, artifactName, digest });
}

export async function verifyHostedIntegrationRecovery(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin;
  nativeChannels: Readonly<{ needsJson: string; stepsJson: string }>;
}>): Promise<Readonly<Record<string, string>>> {
  const originCapability = input.origin;
  const origin = assertAuthenticatedGitHubJobOriginCurrent(originCapability);
  const needsJson = input.nativeChannels.needsJson, stepsJson = input.nativeChannels.stepsJson;
  if (origin.workflowPath !== WORKFLOW || origin.role !== 'control' || origin.policyJobId !== 'authorize'
      || origin.phase !== 'verify-integration-recovery' || origin.trustedDriverRoot !== process.cwd()
      || needsJson !== process.env.SEC_HOSTED_NEEDS_JSON || stepsJson !== process.env.SEC_HOSTED_STEPS_JSON) {
    throw new Error('Integration recovery requires its genuine native executing phase.');
  }
  const { artifactId, artifactName, digest } = parseHostedIntegrationRecoveryChannels({ origin, needsJson, stepsJson });
  return withGitHubApiVerificationSession({ repositoryRoot: origin.trustedDriverRoot, repository: origin.repository,
    effect: 'verification-read', deadlineAtUnixMs: origin.deadlineAtUnixMs,
    signal: getAuthenticatedGitHubJobOriginSignal(originCapability), operation: async capability => {
      const session = inspectGitHubApiCapability(capability);
      if (session.origin !== 'production' || session.repository !== origin.repository || session.effect !== 'verification-read'
          || currentGitHubApiCapability(origin.repository, 'verification-read') !== capability) throw new Error('Original integration recovery API session is absent.');
      const artifact = await executeGitHubApiOperation(capability, { kind: 'verification-artifact', artifactId });
      const run = await executeGitHubApiOperation(capability, { kind: 'workflow-run', runId: origin.runId });
      const job = await executeGitHubApiOperation(capability, { kind: 'verification-workflow-job', jobId: origin.jobId });
      assertHostedIntegrationRecoveryReadback({ origin, artifactId, artifactName, archiveDigest: digest, observedAtUnixMs: Date.now(), artifact, run, job });
      assertAuthenticatedGitHubJobOriginCurrent(originCapability);
      if (currentGitHubApiCapability(origin.repository, 'verification-read') !== capability) throw new Error('Integration recovery API session changed before settlement.');
      return Object.freeze({ 'recovery-artifact-name': artifactName, 'recovery-artifact-id': artifactId,
        'recovery-artifact-digest': digest });
    } });
}
