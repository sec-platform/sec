import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';

import { canonicalEquals } from '../../../../../contracts/canonical.ts';
import { parseExactJsonBytes } from '../../../../../contracts/exact-json.ts';
import { isNativeAborted } from '../../../../../contracts/native-abort.ts';
import { settleResources } from '../../../../../execution/resource-settlement.ts';
import type { GitHubWorkflowJobObservation } from '../../../../providers/github-api/contract.ts';
import { assertCiVerificationPerJobHostedWholeWorkflowShape, assertCiVerificationPerJobHostedWorkflowShape, getCiVerificationPerJobHostedJobPolicy } from '../../../../providers/github-api/contract/hosted-job-policy.ts';
import { HOSTED_RESUME_DISPATCH_EVENT, type HostedResumeEmitter, type HostedResumeSignal } from '../../../../providers/github-api/contract/hosted-resume-dispatch.ts';
import { assertAuthenticatedGitHubJobOriginCurrent, getAuthenticatedGitHubJobOriginSignal, type AuthenticatedGitHubJobOrigin } from '../../../../providers/github-api/hosted-job-origin.ts';
import { currentGitHubApiCapability, executeGitHubApiOperation, inspectGitHubApiCapability, withGitHubApiVerificationSession, type GitHubApiCapability, type GitHubApiOperation } from '../../../../providers/github-api/operation-session.ts';
import { normalizeGitHubRepositoryPermission } from '../../../../providers/github-api/repository-permission.ts';
import { encodeVerificationActionData } from '../../action/contract/action.ts';
import { CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_FILE, parseCiVerificationActionParentDispatchPlan, parseCiVerificationActionProviderEnvelope, type CiVerificationActionParentDispatchPlan } from '../../action/contract/ci.ts';
import { CI_GITHUB_ACTIONS_IDENTITY_POLICY } from '../../action/contract/provider.ts';
import { CodexDevelopmentParseVerificationSessionArtifact, type CodexDevelopmentVerificationSessionArtifact } from '../contract/evidence.ts';
import { assertResumedSessionProducerBinding, createResumedSessionProducer, parseResumedSessionProducer, type ResumedSessionProducer } from '../contract/resumed-session-producer.ts';
import { parseVerificationSessionHostedRequest, type VerificationSessionHostedRequest } from '../contract/session-request.ts';
import { assertHostedCompilerActionReadbackProvenance } from './hosted-compiler-provenance.ts';
import { observeHostedResumeActionTerminalReadback } from './verification-action-github-provider.ts';
import { parseGitHubWorkflowJobsForAttempt } from './verification-session-github-response.ts';
import type { GitHubActionsArtifactObservation } from './verification-session-github.ts';
import { assertCiVerificationSessionResumeBinding, ciVerificationSessionResumeDisplayTitle, createCiVerificationSessionResumeSignal, parseCiVerificationSessionResumeSignal } from './verification-session-resume-contract.ts';

const COMPILER = '.github/workflows/compiler-pr-validation.yml';
const MERGE = '.github/workflows/merge-gate.yml';
const COORDINATOR = 'coordinate-verification-session';
const SESSION_MEMBER = 'verification-session-artifact.json';
const TERMINAL_CONCLUSIONS = Object.freeze(['success', 'failure', 'cancelled', 'timed_out']);

declare const causeBrand: unique symbol;
declare const admissionBrand: unique symbol;
export type SessionResumeCause = Readonly<{ readonly [causeBrand]: true }>;
export type SessionResumeAdmission = Readonly<{ readonly [admissionBrand]: true }>;

export type SessionResumeCauseData = Readonly<{
  signal: HostedResumeSignal;
  request: VerificationSessionHostedRequest;
  parentPlan: CiVerificationActionParentDispatchPlan;
  parentArtifact: GitHubActionsArtifactObservation;
  terminalArtifact: Awaited<ReturnType<typeof observeHostedResumeActionTerminalReadback>>['terminalArtifact'];
  terminalObservation: Awaited<ReturnType<typeof observeHostedResumeActionTerminalReadback>>['terminalObservation'];
  originalDeadlineAtUnixMs: number;
  deadlineAtUnixMs: number;
}>;

interface Scope {
  readonly capability: GitHubApiCapability;
  readonly repository: string;
  readonly origin?: AuthenticatedGitHubJobOrigin;
  readonly originIdentity?: string;
  readonly signal?: AbortSignal;
  deadlineAtUnixMs: number;
  closed: boolean;
}
type AdmissionRecord = Readonly<{ scope: Scope; cause: SessionResumeCauseData;
  producer: ResumedSessionProducer; request: VerificationSessionHostedRequest;
  artifact?: CodexDevelopmentVerificationSessionArtifact;
  artifactMetadata?: GitHubActionsArtifactObservation; artifactText?: string }>;
const causes = new WeakMap<object, Readonly<{ scope: Scope; data: SessionResumeCauseData }>>();
const admissions = new WeakMap<object, AdmissionRecord>();

function fail(reason: string): never { throw new Error(`Session resume authority: ${reason}.`); }
function object(value: unknown): Record<string, any> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('expected one response object');
  return value as Record<string, any>;
}
function id(value: unknown): string {
  if (!Number.isSafeInteger(value) || Number(value) < 1) fail('invalid provider identifier');
  return String(value);
}
function time(value: unknown): number {
  const result = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (!Number.isSafeInteger(result) || result < 1) fail('invalid provider timestamp');
  return result;
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
}
function identity(value: unknown, expected: Readonly<{ login: string; id: number; nodeId: string; type: string }>): void {
  const record = object(value);
  if (record.login !== expected.login || record.id !== expected.id || record.node_id !== expected.nodeId
      || record.type !== expected.type) fail('provider principal identity differs');
}
function current(scope: Scope): void {
  if (scope.closed || isNativeAborted(scope.signal)) fail('scope is closed');
  if (Date.now() >= scope.deadlineAtUnixMs) fail('original cause or operation deadline expired');
  const api = inspectGitHubApiCapability(scope.capability);
  if (api.origin !== 'production' || api.effect !== 'verification-read' || api.repository !== scope.repository
      || currentGitHubApiCapability(scope.repository, 'verification-read') !== scope.capability) {
    fail('requires the original current production verification-read capability');
  }
  if (scope.origin !== undefined) {
    const origin = assertAuthenticatedGitHubJobOriginCurrent(scope.origin);
    if (origin.identityDigest !== scope.originIdentity || origin.repository !== scope.repository
        || scope.deadlineAtUnixMs > origin.originalDeadlineAtUnixMs) fail('original job origin differs');
    if (api.principal.transport !== 'github-actions-token' || api.principal.workflowSha !== origin.workflowSha
        || api.principal.workflowRef !== `${origin.repository}/${origin.workflowPath}@refs/heads/main`) {
      fail('current job does not retain its exact workflow credential');
    }
  }
}
function scopeFor(capability: GitHubApiCapability, origin?: AuthenticatedGitHubJobOrigin): Scope {
  const api = inspectGitHubApiCapability(capability);
  const observed = origin === undefined ? undefined : assertAuthenticatedGitHubJobOriginCurrent(origin);
  const scope: Scope = { capability, repository: api.repository, origin,
    originIdentity: observed?.identityDigest,
    signal: origin === undefined ? undefined : getAuthenticatedGitHubJobOriginSignal(origin),
    // The API owner enforces its own original operation budget. Infinity here
    // cannot extend it; the parent job's fixed deadline replaces this before issuance.
    deadlineAtUnixMs: observed?.originalDeadlineAtUnixMs ?? Number.POSITIVE_INFINITY, closed: false };
  current(scope);
  return scope;
}
async function read(scope: Scope, operation: GitHubApiOperation): Promise<any> {
  current(scope);
  const value = await executeGitHubApiOperation(scope.capability, operation);
  current(scope);
  return value;
}
async function census(scope: Scope, runId: string, runAttempt: number, field: 'jobs' | 'artifacts'): Promise<readonly Record<string, any>[]> {
  const records: Record<string, any>[] = [];
  let count: number | undefined;
  for (let page = 1; page <= 2; page += 1) {
    const response = object(await read(scope, field === 'jobs'
      ? { kind: 'verification-workflow-jobs', runId, runAttempt, page }
      : { kind: 'verification-artifacts', runId, page }));
    if (!Number.isSafeInteger(response.total_count) || response.total_count < 1 || response.total_count > 200
        || count !== undefined && count !== response.total_count || !Array.isArray(response[field])
        || response[field].length !== Math.min(100, response.total_count - (page - 1) * 100)) {
      fail('provider census is incomplete, changed or out of bounds');
    }
    count = response.total_count;
    records.push(...response[field].map(object));
    if (records.length === count) {
      if (new Set(records.map(record => id(record.id))).size !== count) fail('provider census has duplicate identifiers');
      return records;
    }
  }
  fail('provider census did not close');
}
async function jobs(scope: Scope, runId: string, runAttempt: number): Promise<readonly GitHubWorkflowJobObservation[]> {
  const records = await census(scope, runId, runAttempt, 'jobs');
  // The exact attempt endpoint owns omitted run_attempt fields. Explicit values
  // must agree and are never rewritten to hide a mismatch.
  return parseGitHubWorkflowJobsForAttempt({ runId, runAttempt,
    source: [{ jobs: records.map(record => ({ ...record, run_attempt: record.run_attempt ?? runAttempt })) }] });
}
async function source(scope: Scope, sha: string, path: string): Promise<string> {
  const record = object(await read(scope, { kind: 'verification-blob', ref: sha, path }));
  if (record.type !== 'file' || record.path !== path || record.encoding !== 'base64'
      || typeof record.content !== 'string' || record.content.length > 768 * 1024) fail('source blob unavailable');
  const encoded = record.content.replace(/\n/gu, ''), bytes = Buffer.from(encoded, 'base64');
  if (bytes.toString('base64') !== encoded || record.size !== bytes.length || bytes.length > 512 * 1024) fail('source blob bytes differ');
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
async function run(scope: Scope, runId: string, runAttempt: number): Promise<Record<string, any>> {
  const latest = object(await read(scope, { kind: 'workflow-run', runId }));
  const attempt = object(await read(scope, { kind: 'verification-workflow-run-attempt', runId, runAttempt }));
  for (const value of [latest, attempt]) {
    if (id(value.id) !== runId || value.run_attempt !== runAttempt
        || object(value.repository).full_name !== scope.repository) fail('run was retried or differs from the exact attempt');
  }
  for (const key of ['id', 'run_attempt', 'head_sha', 'path', 'event', 'actor', 'workflow_id', 'check_suite_id']) {
    if (!canonicalEquals(latest[key], attempt[key])) fail('run attempt identity changed during readback');
  }
  return attempt;
}
async function workflow(scope: Scope, value: Record<string, any>, path: string, repositoryId: string, sha: string): Promise<Readonly<{ workflow: Record<string, any>; suite: Record<string, any> }>> {
  const observedWorkflow = object(await read(scope, { kind: 'verification-workflow', workflowId: id(value.workflow_id) }));
  const suite = object(await read(scope, { kind: 'verification-check-suite', checkSuiteId: id(value.check_suite_id) }));
  const app = CI_GITHUB_ACTIONS_IDENTITY_POLICY.app;
  if (id(observedWorkflow.id) !== id(value.workflow_id) || observedWorkflow.path !== path || observedWorkflow.state !== 'active'
      || id(suite.id) !== id(value.check_suite_id) || suite.head_sha !== sha
      || id(object(suite.repository).id) !== repositoryId || suite.repository.full_name !== scope.repository
      || suite.app?.id !== app.id || suite.app?.node_id !== app.nodeId || suite.app?.slug !== app.slug) {
    fail('current App, workflow or check-suite identity differs');
  }
  return { workflow: observedWorkflow, suite };
}
async function artifact(scope: Scope, artifactId: string, runValue: Record<string, any>, permission: GitHubActionsArtifactObservation['actorPermission']): Promise<Readonly<{ raw: Record<string, any>; metadata: GitHubActionsArtifactObservation }>> {
  const raw = object(await read(scope, { kind: 'verification-artifact', artifactId }));
  const embedded = object(raw.workflow_run);
  if (id(raw.id) !== artifactId || raw.expired !== false || typeof raw.name !== 'string'
      || typeof raw.digest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(raw.digest)
      || id(embedded.id) !== id(runValue.id) || embedded.head_sha !== runValue.head_sha
      || id(embedded.repository_id) !== id(object(runValue.repository).id)
      || id(embedded.head_repository_id) !== id(object(runValue.repository).id)
      || embedded.head_branch !== 'main' || !Number.isSafeInteger(raw.size_in_bytes)
      || raw.size_in_bytes < 1 || raw.size_in_bytes > 32 * 1024 * 1024) fail('immutable artifact metadata differs');
  const inventory = await census(scope, id(runValue.id), runValue.run_attempt, 'artifacts');
  const matches = inventory.filter(entry => entry.name === raw.name);
  if (matches.length !== 1) fail('artifact slot has no unique provider writer');
  for (const key of ['id', 'name', 'digest', 'expired', 'size_in_bytes', 'created_at', 'updated_at', 'workflow_run']) {
    if (!canonicalEquals(raw[key], matches[0]![key])) fail('artifact inventory differs from exact metadata');
  }
  return freeze({ raw, metadata: { artifactId, artifactName: raw.name, archiveDigest: raw.digest as `sha256:${string}`,
    workflowPath: runValue.path, workflowRef: `${runValue.path}@${runValue.head_sha}`, workflowSha: runValue.head_sha,
    runId: id(runValue.id), runAttempt: runValue.run_attempt, eventName: runValue.event,
    actorNodeId: object(runValue.actor).node_id, actorPermission: permission, expired: false } });
}
async function member(scope: Scope, metadata: GitHubActionsArtifactObservation, fileName: string): Promise<string> {
  const result = await read(scope, { kind: 'verification-artifact-text', artifactId: metadata.artifactId,
    artifactName: metadata.artifactName, runId: metadata.runId, archiveDigest: metadata.archiveDigest, fileName });
  if (typeof result !== 'string') fail('artifact member unavailable');
  return result;
}

/** Data-only lifetime calculation. Public automatic retention has a one-day
 * minimum, longer than this CLOSED 205-minute cause. A trusted administrator
 * not manually deleting active history is an explicit TCB assumption, never a
 * fact proved by this function, a retention snapshot, or an empty inventory. */
export function decodeSessionResumeCauseLifetime(input: Readonly<{
  repositoryPrivate: unknown; parentJobStartedAt: unknown; observedAtUnixMs: number;
}>): number {
  const policy = getCiVerificationPerJobHostedJobPolicy(COMPILER, COORDINATOR);
  if (input.repositoryPrivate !== false || policy === null || policy.maximumJobDurationMs >= 24 * 60 * 60_000) {
    fail('cause has no closed public-history retention bound');
  }
  const started = time(input.parentJobStartedAt), deadline = started + policy.maximumJobDurationMs;
  if (!Number.isSafeInteger(input.observedAtUnixMs) || started > input.observedAtUnixMs
      || !Number.isSafeInteger(deadline) || deadline <= input.observedAtUnixMs) fail('original parent cause expired or invalid');
  return deadline;
}

async function parentPermission(scope: Scope, plan: CiVerificationActionParentDispatchPlan): Promise<Readonly<{ login: string; nodeId: string; permission: 'maintain' | 'admin' }>> {
  const response = object(await read(scope, { kind: 'collaborator-permission', login: plan.parentActor.login }));
  identity(response.user, plan.parentActor);
  const permission = normalizeGitHubRepositoryPermission(response);
  if ((permission !== 'maintain' && permission !== 'admin') || permission !== plan.parentActor.permission) {
    fail('original human no longer has the exact live permission');
  }
  return Object.freeze({ login: plan.parentActor.login, nodeId: plan.parentActor.nodeId, permission });
}

/** Data-only causal step predicate. Passing observed-delivery here is never
 * delivery proof: only the private production entrypoints select that mode,
 * after independently authenticating the resumed producer or its artifact. */
export function assertSessionResumeEmitterStepReadback(input: Readonly<{
  step: GitHubWorkflowJobObservation['steps'][number]; jobStartedAt: unknown;
  jobCompletedAt: unknown; jobStatus: unknown; observedAtUnixMs: number;
  causeDeadlineAtUnixMs: number; mode: 'pre-dispatch' | 'observed-delivery';
}>): void {
  const policy = getCiVerificationPerJobHostedJobPolicy(MERGE, 'integrate');
  if (policy === null || !Number.isSafeInteger(input.observedAtUnixMs)
      || !Number.isSafeInteger(input.causeDeadlineAtUnixMs)
      || input.observedAtUnixMs >= input.causeDeadlineAtUnixMs) fail('emitter cause is expired or invalid');
  const started = time(input.jobStartedAt), stepStarted = time(input.step.startedAt);
  const deadline = Math.min(started + policy.maximumJobDurationMs, input.causeDeadlineAtUnixMs);
  if (stepStarted < started || stepStarted > input.observedAtUnixMs || stepStarted >= deadline) fail('emitter start is outside its original lifetime');
  if (input.step.status === 'in_progress') {
    if (input.step.conclusion !== null || input.step.completedAt !== null || input.jobStatus !== 'in_progress'
        || input.jobCompletedAt !== null || input.observedAtUnixMs >= deadline) fail('emitter active phase differs');
    return;
  }
  if (input.mode !== 'observed-delivery' || input.step.status !== 'completed'
      || !['success', 'failure', 'cancelled'].includes(input.step.conclusion ?? '')) fail('emitter has no independently observed delivery');
  const completed = time(input.step.completedAt);
  if (completed < stepStarted || completed > deadline || completed > input.observedAtUnixMs
      || !(input.jobStatus === 'in_progress' && input.jobCompletedAt === null
        || input.jobStatus === 'completed' && time(input.jobCompletedAt) >= completed
          && time(input.jobCompletedAt) <= input.observedAtUnixMs)) fail('emitter terminal timestamp order differs');
}

async function readEmitter(scope: Scope, signal: HostedResumeSignal, mode: 'pre-dispatch' | 'observed-delivery'): Promise<void> {
  const emitter = signal.emitter;
  const observedRun = await run(scope, emitter.runId, emitter.runAttempt);
  if (observedRun.path !== MERGE || observedRun.head_sha !== emitter.workflowSha || observedRun.head_branch !== 'main'
      || observedRun.event !== 'workflow_run' || id(object(observedRun.repository).id) !== emitter.repositoryId
      || !((observedRun.status === 'in_progress' && observedRun.conclusion === null)
        || (observedRun.status === 'completed' && TERMINAL_CONCLUSIONS.includes(observedRun.conclusion)))
      || observedRun.display_title !== `integrate compiler session run ${signal.completedAction.runId} attempt ${signal.completedAction.runAttempt}`) {
    fail('resume emitter does not bind its completed Action workflow trigger');
  }
  identity(observedRun.actor, CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot);
  identity(observedRun.triggering_actor, CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot);
  await workflow(scope, observedRun, MERGE, emitter.repositoryId, emitter.workflowSha);
  const workflowSource = await source(scope, emitter.workflowSha, MERGE);
  assertCiVerificationPerJobHostedWholeWorkflowShape(workflowSource);
  const policy = assertCiVerificationPerJobHostedWorkflowShape(workflowSource, emitter.policyJobId);
  const selected = object(await read(scope, { kind: 'verification-workflow-job', jobId: emitter.jobId }));
  const inventory = await census(scope, emitter.runId, emitter.runAttempt, 'jobs');
  const matches = inventory.filter(job => id(job.id) === emitter.jobId || job.check_run_url === `https://api.github.com/repos/${scope.repository}/check-runs/${emitter.checkRunId}`);
  if (matches.length !== 1 || !canonicalEquals(matches[0], selected)
      || id(selected.run_id) !== emitter.runId || selected.run_attempt !== undefined && selected.run_attempt !== emitter.runAttempt
      || selected.name !== policy.jobName || selected.head_sha !== emitter.workflowSha
      || selected.check_run_url !== `https://api.github.com/repos/${scope.repository}/check-runs/${emitter.checkRunId}`
      || !((selected.status === 'in_progress' && selected.conclusion === null && selected.completed_at === null)
        || (selected.status === 'completed' && TERMINAL_CONCLUSIONS.includes(selected.conclusion)))
      || !canonicalEquals(selected.labels, [policy.runnerLabel]) || !Array.isArray(selected.steps)) fail('emitter exact job differs');
  const steps = selected.steps.map(object);
  const matching = steps.filter((step: Record<string, any>) => step.name === emitter.stepName || step.number === emitter.stepNumber);
  if (steps.length > 100 || new Set(steps.map((step: Record<string, any>) => step.number)).size !== steps.length
      || matching.length !== 1 || matching[0].name !== emitter.stepName || matching[0].number !== emitter.stepNumber
      || !policy.stages.some(stage => stage.kind === 'phase' && stage.phase === emitter.phase && stage.stepName === emitter.stepName)
      || time(matching[0].started_at) < time(selected.started_at) || time(matching[0].started_at) > Date.now()) {
    fail('emitter phase is absent, unknown or differs');
  }
  const step = matching[0];
  assertSessionResumeEmitterStepReadback({ step: { name: step.name, number: step.number, status: step.status,
    conclusion: step.conclusion, startedAt: step.started_at, completedAt: step.completed_at },
    jobStartedAt: selected.started_at, jobCompletedAt: selected.completed_at, jobStatus: selected.status,
    observedAtUnixMs: Date.now(), causeDeadlineAtUnixMs: scope.deadlineAtUnixMs, mode });
}

async function readCause(scope: Scope, signal: HostedResumeSignal): Promise<SessionResumeCauseData> {
  const envelope = parseCiVerificationActionProviderEnvelope(signal.completedAction.providerEnvelope);
  const request = parseVerificationSessionHostedRequest(encodeVerificationActionData(envelope.proposal.sessionRequest));
  if (signal.emitter.repository !== scope.repository) fail('cause repository differs from API scope');
  const repository = object(await read(scope, { kind: 'repository' }));
  if (repository.full_name !== scope.repository || id(repository.id) !== signal.emitter.repositoryId
      || repository.default_branch !== 'main' || repository.private !== false) fail('cause repository must be the exact public repository');
  const parentRun = await run(scope, envelope.parentRunId, envelope.parentRunAttempt);
  const parentJobs = await jobs(scope, envelope.parentRunId, envelope.parentRunAttempt);
  const selectedParent = parentJobs.filter(job => job.id === envelope.parentJobId);
  if (selectedParent.length !== 1) fail('parent plan job is absent or ambiguous');
  const originalDeadlineAtUnixMs = decodeSessionResumeCauseLifetime({ repositoryPrivate: repository.private,
    parentJobStartedAt: selectedParent[0]!.startedAt, observedAtUnixMs: Date.now() });
  scope.deadlineAtUnixMs = Math.min(scope.deadlineAtUnixMs, originalDeadlineAtUnixMs);
  current(scope);
  const parentSource = await source(scope, envelope.parentWorkflowSha, COMPILER);
  assertCiVerificationPerJobHostedWholeWorkflowShape(parentSource);
  assertCiVerificationPerJobHostedWorkflowShape(parentSource, COORDINATOR);
  const parentArtifact = await artifact(scope, envelope.parentDispatchPlanArtifactId, parentRun, 'none');
  const parentPlanSource = await member(scope, parentArtifact.metadata, CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_FILE);
  const parentPlan = parseCiVerificationActionParentDispatchPlan(parseExactJsonBytes(Buffer.from(parentPlanSource, 'utf8'), 'Original Session parent plan',
    { maximumInputBytes: 512 * 1024, maximumDepth: 32 }));
  assertSessionResumeArtifactUploadReadback(parentArtifact.raw, parentJobs, originalDeadlineAtUnixMs, 'parent-plan');
  const principal = await parentPermission(scope, parentPlan);
  const metadata = Object.freeze({ ...parentArtifact.metadata, actorPermission: principal.permission });
  const childRun = await run(scope, signal.completedAction.runId, signal.completedAction.runAttempt);
  const childWorkflow = await workflow(scope, childRun, COMPILER, signal.emitter.repositoryId, request.expectedBaseSha);
  assertHostedCompilerActionReadbackProvenance({ repository: scope.repository, repositoryId: signal.emitter.repositoryId,
    request, envelope, parentPlanSource, parentArtifact: metadata, parentArtifactInventory: [metadata], parentJobs,
    currentRun: childRun, currentWorkflow: childWorkflow.workflow, currentCheckSuite: childWorkflow.suite,
    parentRun, parentPrincipal: principal });
  const terminal = await observeHostedResumeActionTerminalReadback({ capability: scope.capability, completedAction: signal.completedAction });
  current(scope);
  assertCiVerificationSessionResumeBinding({ signal, parentPlan, actionPlan: terminal.terminalArtifact.actionPlan, ...terminal });
  // Permission is observed again after the potentially slow source/archive reads.
  await parentPermission(scope, parentPlan);
  current(scope);
  return freeze({ signal, request, parentPlan, parentArtifact: metadata, ...terminal, originalDeadlineAtUnixMs,
    deadlineAtUnixMs: scope.deadlineAtUnixMs });
}

function emitterFromOrigin(origin: AuthenticatedGitHubJobOrigin): HostedResumeEmitter {
  const value = assertAuthenticatedGitHubJobOriginCurrent(origin);
  if (value.workflowPath !== MERGE || value.policyJobId !== 'integrate' || value.role !== 'control'
      || value.phase !== 'resume-verification-session' || value.stepName !== 'Resume canonical verification Session'
      || value.runAttempt !== 1 || value.workflowSha !== value.trustedSourceSha) fail('origin is not the exact resume emitter phase');
  return Object.freeze({ repository: value.repository, repositoryId: value.repositoryId, workflowPath: MERGE,
    workflowSha: value.workflowSha, runId: value.runId, runAttempt: 1, jobId: value.jobId, checkRunId: value.checkRunId,
    policyJobId: 'integrate', phase: 'resume-verification-session', stepName: 'Resume canonical verification Session',
    stepNumber: value.stepNumber });
}

/** This grants no no-dispatch conclusion. The receiver separately owns the
 * complete run-number census, started-step tombstone and one POST attempt. */
export async function withAuthenticatedSessionResumeCause<T>(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin; completedAction: HostedResumeSignal['completedAction'];
}>, operation: (cause: SessionResumeCause) => Promise<T>): Promise<T> {
  const origin = input.origin;
  const emitter = emitterFromOrigin(origin);
  const signal = createCiVerificationSessionResumeSignal({ completedAction: input.completedAction, emitter });
  const observed = assertAuthenticatedGitHubJobOriginCurrent(origin);
  return await withGitHubApiVerificationSession({ repositoryRoot: observed.trustedDriverRoot, repository: observed.repository,
    effect: 'verification-read', deadlineAtUnixMs: observed.originalDeadlineAtUnixMs,
    signal: getAuthenticatedGitHubJobOriginSignal(origin), operation: async capability => {
      const scope = scopeFor(capability, origin), cause = Object.freeze({}) as SessionResumeCause;
      try {
        const data = await readCause(scope, signal);
        // No delivered producer exists on this path: the exact emitter must
        // still be executing this phase immediately before issuance.
        await readEmitter(scope, signal, 'pre-dispatch');
        await parentPermission(scope, data.parentPlan);
        current(scope);
        causes.set(cause, { scope, data });
        const result = await operation(cause);
        current(scope);
        return result;
      } finally { scope.closed = true; causes.delete(cause); }
    } });
}

export function assertAuthenticatedSessionResumeCauseCurrent(cause: SessionResumeCause, input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin; completedAction: HostedResumeSignal['completedAction'];
}>): SessionResumeCauseData {
  const record = causes.get(cause);
  if (record === undefined) fail('cause was not issued in this live callback');
  current(record.scope);
  if (record.scope.origin !== input.origin || !canonicalEquals(record.data.signal.completedAction, input.completedAction)
      || !canonicalEquals(record.data.signal.emitter, emitterFromOrigin(input.origin))) fail('cause consumer identity differs');
  return record.data;
}

function actualResumeEvent(origin: AuthenticatedGitHubJobOrigin): HostedResumeSignal {
  const observed = assertAuthenticatedGitHubJobOriginCurrent(origin);
  if (observed.workflowPath !== COMPILER || observed.policyJobId !== COORDINATOR || observed.role !== 'control'
      || !['prepare-parent-plan', 'compose-hosted-evidence'].includes(observed.phase)
      || observed.runAttempt !== 1 || observed.workflowSha !== observed.trustedSourceSha) fail('origin is not a resumed coordinator phase');
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (typeof eventPath !== 'string' || eventPath.length === 0 || process.env.GITHUB_EVENT_NAME !== 'repository_dispatch') {
    fail('actual workflow event is unavailable');
  }
  const fd = openSync(eventPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  let outcome: Readonly<{ status: 'succeeded'; event: Record<string, any> }> | Readonly<{ status: 'failed'; error: unknown }>;
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size < 1 || before.size > 128 * 1024) fail('actual workflow event is out of bounds');
    const bytes = Buffer.alloc(before.size + 1);
    let count = 0;
    while (count < bytes.length) {
      const size = readSync(fd, bytes, count, bytes.length - count, count);
      if (size === 0) break;
      count += size;
    }
    const after = fstatSync(fd);
    if (count !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs
        || before.ctimeMs !== after.ctimeMs) fail('actual workflow event changed while reading');
    outcome = { status: 'succeeded', event: object(parseExactJsonBytes(bytes.subarray(0, count), 'Actual Session resume event',
      { maximumInputBytes: 128 * 1024, maximumDepth: 32 })) };
  } catch (error) { outcome = { status: 'failed', error }; }
  settleResources({ ...(outcome.status === 'failed' ? { primary: { label: 'resume-event-read', error: outcome.error } } : {}),
    cleanup: [{ label: 'resume-event-descriptor', settle: () => closeSync(fd) }] });
  if (outcome.status === 'failed') throw outcome.error;
  const event = outcome.event;
  identity(event.sender, CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot);
  const payload = object(event.client_payload);
  if (event.action !== HOSTED_RESUME_DISPATCH_EVENT || Object.keys(payload).join(',') !== 'payload'
      || id(object(event.repository).id) !== observed.repositoryId || event.repository.full_name !== observed.repository) {
    fail('actual resumed event sender, repository or payload differs');
  }
  const signal = parseCiVerificationSessionResumeSignal(encodeVerificationActionData(payload.payload));
  if (signal.emitter.repository !== observed.repository || signal.emitter.repositoryId !== observed.repositoryId
      || signal.emitter.workflowSha !== observed.workflowSha) fail('resumed event differs from authenticated origin');
  return signal;
}

async function readResumedProducer(scope: Scope, cause: SessionResumeCauseData, producer: ResumedSessionProducer): Promise<Record<string, any>> {
  const observed = await run(scope, producer.runId, producer.runAttempt);
  identity(observed.actor, CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot);
  identity(observed.triggering_actor, CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot);
  if (observed.path !== COMPILER || observed.head_sha !== producer.workflowSha || observed.head_branch !== 'main'
      || observed.event !== 'repository_dispatch' || observed.run_attempt !== 1
      || id(object(observed.repository).id) !== cause.signal.emitter.repositoryId
      || observed.display_title !== ciVerificationSessionResumeDisplayTitle(cause.signal)) fail('resumed producer actual run differs');
  if (scope.origin !== undefined) {
    const origin = assertAuthenticatedGitHubJobOriginCurrent(scope.origin);
    const job = object(await read(scope, { kind: 'verification-workflow-job', jobId: origin.jobId }));
    const steps = Array.isArray(job.steps) ? job.steps.map(object) : [];
    const active = steps.filter((step: Record<string, any>) => step.status === 'in_progress');
    if (observed.status !== 'in_progress' || observed.conclusion !== null || id(job.id) !== origin.jobId
        || id(job.run_id) !== origin.runId || job.run_attempt !== undefined && job.run_attempt !== origin.runAttempt
        || job.head_sha !== origin.workflowSha || job.name !== origin.jobName
        || job.check_run_url !== `https://api.github.com/repos/${scope.repository}/check-runs/${origin.checkRunId}`
        || job.status !== 'in_progress' || job.conclusion !== null || job.completed_at !== null
        || active.length !== 1 || active[0].name !== origin.stepName || active[0].number !== origin.stepNumber
        || active[0].conclusion !== null || active[0].completed_at !== null) fail('current resumed producer phase is no longer exact');
  }
  await workflow(scope, observed, COMPILER, cause.signal.emitter.repositoryId, producer.workflowSha);
  const workflowSource = await source(scope, producer.workflowSha, COMPILER);
  assertCiVerificationPerJobHostedWholeWorkflowShape(workflowSource);
  assertCiVerificationPerJobHostedWorkflowShape(workflowSource, COORDINATOR);
  if (!canonicalEquals(producer.originalParentActor, cause.parentPlan.parentActor)
      || !canonicalEquals(producer.resumeSignal, cause.signal)) fail('resumed producer relabeled its original human or cause');
  return observed;
}

export async function withAuthenticatedResumedSessionProducer<T>(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin;
}>, operation: (readback: Readonly<{ producer: ResumedSessionProducer; request: VerificationSessionHostedRequest;
  parentPlan: CiVerificationActionParentDispatchPlan; parentArtifact: GitHubActionsArtifactObservation;
  originalDeadlineAtUnixMs: number; admission: SessionResumeAdmission }>) => Promise<T>): Promise<T> {
  const origin = input.origin, signal = actualResumeEvent(origin);
  const observed = assertAuthenticatedGitHubJobOriginCurrent(origin);
  return await withGitHubApiVerificationSession({ repositoryRoot: observed.trustedDriverRoot, repository: observed.repository,
    effect: 'verification-read', deadlineAtUnixMs: observed.originalDeadlineAtUnixMs,
    signal: getAuthenticatedGitHubJobOriginSignal(origin), operation: async capability => {
      const scope = scopeFor(capability, origin), admission = Object.freeze({}) as SessionResumeAdmission;
      try {
        const cause = await readCause(scope, signal);
        const producer = createResumedSessionProducer({ workflowRef: `${COMPILER}@${observed.workflowSha}`,
          workflowSha: observed.workflowSha, runId: observed.runId, runAttempt: observed.runAttempt,
          originalParentActor: cause.parentPlan.parentActor, resumeSignal: signal });
        await readResumedProducer(scope, cause, producer);
        // The actual native event and this current App run independently prove
        // delivery; a later failed/cancelled emitter step cannot erase it.
        await readEmitter(scope, signal, 'observed-delivery');
        await parentPermission(scope, cause.parentPlan);
        current(scope);
        admissions.set(admission, { scope, cause, producer, request: cause.request });
        const result = await operation(Object.freeze({ producer, request: cause.request, parentPlan: cause.parentPlan,
          parentArtifact: cause.parentArtifact, originalDeadlineAtUnixMs: cause.originalDeadlineAtUnixMs, admission }));
        current(scope);
        return result;
      } finally { scope.closed = true; admissions.delete(admission); }
    } });
}

/** Data-only phase/upload comparison, reused by the authenticated reader. It
 * cannot issue admission; later unrelated parent-job failure does not erase a
 * successfully published original plan. */
export function assertSessionResumeArtifactUploadReadback(raw: Record<string, any>, selectedJobs: readonly GitHubWorkflowJobObservation[], originalDeadline: number,
  slot: 'session' | 'parent-plan' = 'session'): void {
  const policy = getCiVerificationPerJobHostedJobPolicy(COMPILER, COORDINATOR);
  if (policy === null) fail('coordinator policy unavailable');
  const selected = selectedJobs.filter(job => job.name === policy.jobName);
  if (selected.length !== 1) fail('Session artifact writer is not unique');
  const job = selected[0]!;
  const phase = policy.stages.filter(stage => stage.kind === 'phase'
    && stage.phase === (slot === 'session' ? 'compose-hosted-evidence' : 'prepare-parent-plan'));
  const upload = policy.stages.filter(stage => stage.kind === 'upload' && stage.slot === slot);
  if (phase.length !== 1 || upload.length !== 1) fail('Session writer has no closed compose/upload phases');
  const successful = (name: string) => {
    const found = job.steps.filter(step => step.name === name);
    if (found.length !== 1 || found[0]!.status !== 'completed' || found[0]!.conclusion !== 'success') fail('Session writer phase did not succeed');
    return found[0]!;
  };
  const composed = successful(phase[0]!.stepName), uploaded = successful(upload[0]!.stepName);
  if (job.headSha !== raw.workflow_run.head_sha || job.runId !== id(raw.workflow_run.id)
      || job.runAttempt !== 1
      || !(job.status === 'completed' && TERMINAL_CONCLUSIONS.includes(job.conclusion ?? '')
          && (slot === 'parent-plan' || job.conclusion === 'success')
        || slot === 'parent-plan' && job.status === 'in_progress' && job.conclusion === null && job.completedAt === null)
      || uploaded.number <= composed.number || time(uploaded.startedAt) < time(composed.completedAt)
      || time(composed.completedAt) < time(composed.startedAt)
      || time(raw.created_at) < time(uploaded.startedAt) || time(raw.updated_at) < time(raw.created_at)
      || time(raw.updated_at) > time(uploaded.completedAt) || time(uploaded.completedAt) > originalDeadline
      || time(job.startedAt) > time(composed.startedAt)
      || job.status === 'completed' && time(job.completedAt) < time(uploaded.completedAt)) {
    fail('Session artifact does not bind its successful compose/upload window');
  }
}

/** The locator selects an actual API archive. No caller observation or parsed
 * artifact can stand in for these reads or enter the private admission table. */
export async function withAuthenticatedResumedSessionArtifact<T>(input: Readonly<{
  capability: GitHubApiCapability; artifactId: string;
}>, operation: (readback: Readonly<{ artifact: CodexDevelopmentVerificationSessionArtifact; artifactText: string;
  metadata: GitHubActionsArtifactObservation; admission: SessionResumeAdmission }>) => Promise<T>): Promise<T> {
  const capability = input.capability;
  const scope = scopeFor(capability), admission = Object.freeze({}) as SessionResumeAdmission;
  try {
    const artifactId = input.artifactId;
    if (typeof artifactId !== 'string' || !/^[1-9][0-9]{0,19}$/u.test(artifactId)) fail('invalid artifact locator');
    const initial = object(await read(scope, { kind: 'verification-artifact', artifactId }));
    const runId = id(object(initial.workflow_run).id);
    const observedRun = await run(scope, runId, 1);
    const selected = await artifact(scope, artifactId, observedRun, 'none');
    if (!canonicalEquals(initial, selected.raw)) fail('artifact changed during readback');
    const artifactText = await member(scope, selected.metadata, SESSION_MEMBER);
    const parsed = CodexDevelopmentParseVerificationSessionArtifact(artifactText);
    if (artifactText !== `${encodeVerificationActionData(parsed)}\n`) fail('Session artifact bytes are not canonical');
    const producer = parseResumedSessionProducer(parsed.producer);
    if (producer.runId !== runId || producer.runAttempt !== 1
        || selected.metadata.artifactName !== `sec-verification-session-v2-pr-${parsed.session.prNumber}-session-${parsed.session.sessionRevision.slice(7)}-run-${runId}-attempt-1`
        || parsed.session.repository !== scope.repository || selected.metadata.workflowSha !== producer.workflowSha
        || selected.metadata.actorNodeId !== producer.actorNodeId) fail('actual Session artifact producer differs');
    const cause = await readCause(scope, producer.resumeSignal);
    await readResumedProducer(scope, cause, producer);
    assertResumedSessionProducerBinding({ producer, session: parsed.session, scope: parsed.scopeAuthorization,
      actionPlan: parsed.evidence.actionPlan });
    assertSessionResumeArtifactUploadReadback(selected.raw, await jobs(scope, runId, 1), cause.originalDeadlineAtUnixMs);
    // The source-bound canonical artifact and successful compose/upload close
    // delivery before a historical failed/cancelled emitter may be consumed.
    await readEmitter(scope, producer.resumeSignal, 'observed-delivery');
    await parentPermission(scope, cause.parentPlan);
    current(scope);
    const immutable = freeze(parsed);
    admissions.set(admission, { scope, cause, producer, request: cause.request, artifact: immutable,
      artifactMetadata: freeze(selected.metadata), artifactText });
    const result = await operation(Object.freeze({ artifact: immutable, artifactText, metadata: selected.metadata, admission }));
    current(scope);
    return result;
  } finally { scope.closed = true; admissions.delete(admission); }
}

export function assertAuthenticatedSessionResumeAdmissionCurrent(admission: SessionResumeAdmission,
  input: Readonly<{ artifact: CodexDevelopmentVerificationSessionArtifact }>): void {
  const record = admissions.get(admission);
  if (record === undefined || record.artifact === undefined) fail('artifact admission was not issued in this live callback');
  current(record.scope);
  if (record.artifact !== input.artifact || record.artifact.artifactDigest !== input.artifact.artifactDigest
      || !canonicalEquals(record.producer, input.artifact.producer)) fail('admission does not bind this exact Session artifact');
}

/** Bind direct origin and transport to the actual archive read in this
 * callback. This lane has no cross-run/reupload authority. */
export type SessionResumeArtifactTransport = Readonly<{ artifactId: string; artifactName: string; artifactFileName: string;
  artifactByteDigest: string; artifactByteLength: number; artifactExpired: boolean;
  workflowPath: string; workflowRef: string; workflowSha: string; runId: string; runAttempt: number;
  eventName: string; actorNodeId: string; downloadTransport: string }>;

/** Data comparison only; this never inserts a record in the admission table. */
export function assertSessionResumeArtifactTransportReadback(transport: SessionResumeArtifactTransport,
  readback: Readonly<{ metadata: GitHubActionsArtifactObservation; artifactText: string }>): void {
  const expected = readback.metadata;
  for (const key of ['artifactId', 'artifactName', 'workflowPath', 'workflowRef', 'workflowSha', 'runId',
    'runAttempt', 'eventName', 'actorNodeId'] as const) {
    if (transport[key] !== expected[key]) fail('transport differs from the actual admitted API archive');
  }
  if (transport.artifactFileName !== SESSION_MEMBER || transport.artifactExpired !== false || expected.expired
      || transport.downloadTransport !== 'github-actions-artifact-api'
      || transport.artifactByteLength !== Buffer.byteLength(readback.artifactText)
      || transport.artifactByteDigest !== `sha256:${createHash('sha256').update(readback.artifactText).digest('hex')}`) {
    fail('transport bytes differ from the actual admitted API archive');
  }
}

export function assertAuthenticatedSessionResumeArtifactTransportCurrent(admission: SessionResumeAdmission,
  transport: SessionResumeArtifactTransport): void {
  const record = admissions.get(admission);
  if (record?.artifact === undefined || record.artifactMetadata === undefined || record.artifactText === undefined) {
    fail('artifact transport admission was not issued in this live callback');
  }
  current(record.scope);
  assertSessionResumeArtifactTransportReadback(transport, { metadata: record.artifactMetadata, artifactText: record.artifactText });
}

export function assertAuthenticatedSessionResumeProducerCurrent(admission: SessionResumeAdmission,
  input: Readonly<{ producer: ResumedSessionProducer; request: VerificationSessionHostedRequest }>): void {
  const record = admissions.get(admission);
  if (record === undefined || record.artifact !== undefined || record.scope.origin === undefined) fail('producer admission was not issued in this live callback');
  current(record.scope);
  if (!canonicalEquals(record.producer, input.producer) || !canonicalEquals(record.request, input.request)) fail('admission does not bind this producer and original request');
}

/** Original live-authorized human, kept distinct from the actual App producer.
 * The immutable DTO is a projection only; each consumer still needs admission. */
export function authenticatedSessionResumeAuthorizationPrincipal(admission: SessionResumeAdmission): CiVerificationActionParentDispatchPlan['parentActor'] {
  const record = admissions.get(admission);
  if (record === undefined) fail('admission was not issued in this live callback');
  current(record.scope);
  return record.cause.parentPlan.parentActor;
}

/** Remaining original operation/cause deadline; observing it never extends it. */
export function authenticatedSessionResumeDeadlineAtUnixMs(admission: SessionResumeAdmission): number {
  const record = admissions.get(admission);
  if (record === undefined) fail('admission was not issued in this live callback');
  current(record.scope);
  return record.scope.deadlineAtUnixMs;
}

/** Revalidate immediately before a later Gate consumer without extending the
 * original callback, API session or parent-job deadline. */
export async function revalidateAuthenticatedSessionResumeAdmission(admission: SessionResumeAdmission): Promise<void> {
  const record = admissions.get(admission);
  if (record === undefined) fail('admission was not issued in this live callback');
  current(record.scope);
  await parentPermission(record.scope, record.cause.parentPlan);
  current(record.scope);
}
