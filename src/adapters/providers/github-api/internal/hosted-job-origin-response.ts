import { sha256 } from '../../../../contracts/canonical.ts';
import {
  CI_VERIFICATION_PER_JOB_HOSTED_JOB_POLICY_DIGEST,
  getCiVerificationPerJobHostedJobPolicy,
  type CiVerificationPerJobHostedJobPolicy
} from '../contract/hosted-job-policy.ts';
import type { GitHubHostedJobSignedClaims } from './hosted-job-origin-jwt.ts';

function fail(message: string): never { throw new Error(`GitHub authenticated job binding: ${message}`); }
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('response is not an object');
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) fail('provider ID is invalid');
  return String(value);
}
function gitSha(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) fail('provider source SHA is invalid');
  return value;
}

export interface AuthenticatedGitHubJobBinding {
  readonly repository: string;
  readonly repositoryId: string;
  readonly workflowPath: string;
  readonly workflowSha: string;
  readonly trustedSourceSha: string;
  readonly trustedSourceTreeSha: string;
  readonly runId: string;
  readonly runAttempt: number;
  readonly jobId: string;
  readonly checkRunId: string;
  readonly jobName: string;
  readonly role: 'control' | 'trusted' | 'sut';
  readonly policyJobId: string;
  readonly policyDigest: `sha256:${string}`;
  readonly launcherRevision: string;
  readonly originalDeadlineAtUnixMs: number;
  readonly identityDigest: `sha256:${string}`;
}

/** Pure response binding. This DTO has no authority without the live transport owner. */
export function decodeAuthenticatedGitHubJobBinding(input: Readonly<{
  claims: GitHubHostedJobSignedClaims;
  jobId: string;
  repository: unknown;
  defaultBranch: unknown;
  run: unknown;
  jobs: readonly unknown[];
  observedAtUnixMs: number;
}>): AuthenticatedGitHubJobBinding {
  const claims = input.claims;
  const repository = object(input.repository);
  if (repository.full_name !== claims.repository || id(repository.id) !== claims.repositoryId
      || repository.default_branch !== 'main') fail('signed repository differs from authenticated repository');
  const branch = object(input.defaultBranch);
  const commit = object(branch.commit);
  const trustedSourceSha = gitSha(commit.sha);
  const trustedSourceTreeSha = gitSha(object(object(commit.commit).tree).sha);
  if (branch.name !== 'main' || trustedSourceSha !== claims.workflowSha) fail('workflow is not current trusted default at issuance');
  const workflowPrefix = `${claims.repository}/`;
  const suffix = '@refs/heads/main';
  if (!claims.workflowRef.startsWith(workflowPrefix) || !claims.workflowRef.endsWith(suffix)) fail('workflow ref is not exact');
  const workflowPath = claims.workflowRef.slice(workflowPrefix.length, -suffix.length);
  const policy = getCiVerificationPerJobHostedJobPolicy(workflowPath, input.jobId);
  if (policy === null || policy.runtime.kind !== 'per-job-runtime') fail('job has no canonical runtime policy');
  const selectedPolicy: CiVerificationPerJobHostedJobPolicy = policy;
  if (claims.eventName !== policy.trigger.eventName) fail('signed trigger differs from job policy');
  const run = object(input.run);
  if (id(run.id) !== claims.runId || run.run_attempt !== claims.runAttempt || run.path !== workflowPath
      || run.head_sha !== claims.workflowSha || run.head_branch !== 'main' || run.event !== claims.eventName
      || run.status !== 'in_progress' || run.conclusion !== null
      || object(run.repository).full_name !== claims.repository
      || id(object(run.repository).id) !== claims.repositoryId) fail('authenticated run differs from signed job origin');
  // The check_run_id claim is joined to the exact job's provider-owned URL.
  // Neither matching display name nor a current run alone establishes the job.
  const records: Record<string, unknown>[] = [];
  let expectedTotal: number | undefined;
  for (const pageValue of input.jobs) {
    const page = object(pageValue);
    if (!Number.isSafeInteger(page.total_count) || Number(page.total_count) < 1
        || Number(page.total_count) > 200 || !Array.isArray(page.jobs)) fail('job census is invalid');
    if (expectedTotal !== undefined && expectedTotal !== page.total_count) fail('job census changed during pagination');
    expectedTotal = Number(page.total_count);
    records.push(...page.jobs.map(object));
  }
  if (expectedTotal === undefined || records.length !== expectedTotal
      || new Set(records.map(job => id(job.id))).size !== records.length) fail('job census is incomplete or duplicated');
  const checkRunUrl = `https://api.github.com/repos/${claims.repository}/check-runs/${claims.checkRunId}`;
  const candidates = records.filter(job => job.check_run_url === checkRunUrl);
  if (candidates.length !== 1) fail('signed check run has no unique job');
  const job = candidates[0]!;
  // This census is fetched from the exact authenticated /attempts/{attempt}/
  // jobs endpoint. GitHub's job schema may omit run_attempt; an explicit value
  // must still agree, and cannot override the request's signed attempt.
  if (id(job.run_id) !== claims.runId || (job.run_attempt !== undefined && job.run_attempt !== claims.runAttempt)
      || job.head_sha !== trustedSourceSha || job.name !== selectedPolicy.jobName
      || job.status !== 'in_progress' || job.conclusion !== null || job.completed_at !== null
      || !Array.isArray(job.labels) || job.labels.length !== 1 || job.labels[0] !== policy.runnerLabel) {
    fail('exact job differs from approved source, role or native placement policy');
  }
  const startedAt = typeof job.started_at === 'string' ? Date.parse(job.started_at) : Number.NaN;
  if (!Number.isSafeInteger(input.observedAtUnixMs) || !Number.isSafeInteger(startedAt)
      || startedAt < 1 || startedAt > input.observedAtUnixMs) fail('provider job start time is invalid');
  const originalDeadlineAtUnixMs = startedAt + policy.maximumJobDurationMs;
  if (!Number.isSafeInteger(originalDeadlineAtUnixMs) || originalDeadlineAtUnixMs <= input.observedAtUnixMs) fail('original job deadline is exhausted');
  const binding = Object.freeze({ repository: claims.repository, repositoryId: claims.repositoryId,
    workflowPath, workflowSha: claims.workflowSha, trustedSourceSha, trustedSourceTreeSha,
    runId: claims.runId, runAttempt: claims.runAttempt, jobId: id(job.id), checkRunId: claims.checkRunId,
    jobName: policy.jobName, role: policy.role, policyJobId: policy.jobId,
    policyDigest: CI_VERIFICATION_PER_JOB_HOSTED_JOB_POLICY_DIGEST,
    launcherRevision: policy.runtime.launcherRevision, originalDeadlineAtUnixMs });
  return Object.freeze({ ...binding, identityDigest: sha256({ schema: 'sec-authenticated-github-job-origin-v1', ...binding }) });
}
