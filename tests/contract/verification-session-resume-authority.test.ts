import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import type { GitHubActionsArtifactObservation } from '../../src/adapters/verification/platform/ci/runtime/verification-session-github.ts';

import type { GitHubWorkflowJobObservation } from '../../src/adapters/providers/github-api/contract.ts';
import type { HostedResumeSignal } from '../../src/adapters/providers/github-api/contract/hosted-resume-dispatch.ts';
import type { AuthenticatedGitHubJobOrigin } from '../../src/adapters/providers/github-api/hosted-job-origin.ts';
import type { GitHubApiCapability } from '../../src/adapters/providers/github-api/operation-session.ts';
import { issueGitHubApiTestCapability, withGitHubApiTestSession } from '../../src/adapters/providers/github-api/test/operation-session.ts';
import type { CodexDevelopmentVerificationSessionArtifact } from '../../src/adapters/verification/platform/ci/contract/evidence.ts';
import type { ResumedSessionProducer } from '../../src/adapters/verification/platform/ci/contract/resumed-session-producer.ts';
import type { VerificationSessionHostedRequest } from '../../src/adapters/verification/platform/ci/contract/session-request.ts';
import {
  assertAuthenticatedSessionResumeAdmissionCurrent,
  assertAuthenticatedSessionResumeArtifactTransportCurrent,
  assertAuthenticatedSessionResumeCauseCurrent,
  assertAuthenticatedSessionResumeProducerCurrent,
  assertSessionResumeArtifactTransportReadback,
  assertSessionResumeArtifactUploadReadback,
  assertSessionResumeEmitterStepReadback,
  authenticatedSessionResumeAuthorizationPrincipal,
  authenticatedSessionResumeDeadlineAtUnixMs,
  decodeSessionResumeCauseLifetime,
  revalidateAuthenticatedSessionResumeAdmission,
  withAuthenticatedResumedSessionArtifact,
  withAuthenticatedResumedSessionProducer,
  withAuthenticatedSessionResumeCause,
  type SessionResumeAdmission,
  type SessionResumeArtifactTransport,
  type SessionResumeCause
} from '../../src/adapters/verification/platform/ci/runtime/verification-session-resume-authority.ts';

// Nonphysical fixtures: these exercise the original issuer's rejection boundary
// and its pure lifetime calculation. They cannot issue production proof, and
// make no claim that GitHub, OIDC, a host, or an Engine has actually qualified.
const STARTED = '2026-10-03T00:00:00.000Z';
const START = Date.parse(STARTED);
const DEADLINE = START + 205 * 60_000;

function publishedParentPlan(conclusion: string) {
  const job: GitHubWorkflowJobObservation = {
    id: '11', runId: '12', runAttempt: 1, name: 'coordinate-verification-session',
    status: 'completed', conclusion, headSha: 'a'.repeat(40), startedAt: STARTED,
    completedAt: '2026-10-03T00:01:00.000Z', steps: [
      { name: 'Prepare canonical parent Action dispatch plan', number: 5, status: 'completed', conclusion: 'success',
        startedAt: '2026-10-03T00:00:01.000Z', completedAt: '2026-10-03T00:00:02.000Z' },
      { name: 'Upload canonical parent Action dispatch plan artifact', number: 6, status: 'completed', conclusion: 'success',
        startedAt: '2026-10-03T00:00:03.000Z', completedAt: '2026-10-03T00:00:04.000Z' }
    ]
  };
  return { job, artifact: { workflow_run: { id: 12, head_sha: 'a'.repeat(40) },
    created_at: '2026-10-03T00:00:03.000Z', updated_at: '2026-10-03T00:00:04.000Z' } };
}

test('successful immutable parent plan survives unrelated later job failure or cancellation', () => {
  for (const conclusion of ['success', 'failure', 'cancelled']) {
    const fixture = publishedParentPlan(conclusion);
    expect(() => assertSessionResumeArtifactUploadReadback(fixture.artifact, [fixture.job], DEADLINE, 'parent-plan')).not.toThrow();
  }
});

test('failed, absent or temporally inconsistent plan/upload never becomes a completed cause', () => {
  const mutations: Array<(fixture: ReturnType<typeof publishedParentPlan>) => void> = [
    value => { value.job.steps = [{ ...value.job.steps[0]!, conclusion: 'failure' }, value.job.steps[1]!]; },
    value => { value.job.steps = [value.job.steps[0]!, { ...value.job.steps[1]!, conclusion: 'cancelled' }]; },
    value => { value.job.steps = [value.job.steps[0]!]; },
    value => { value.artifact.created_at = '2026-10-03T00:00:01.000Z'; },
    value => { value.job.completedAt = '2026-10-03T00:00:03.000Z'; },
    value => { value.job.steps = [value.job.steps[0]!, { ...value.job.steps[1]!, number: 4 }]; },
    value => { value.job.steps = [{ ...value.job.steps[0]!, completedAt: STARTED }, value.job.steps[1]!]; },
    value => { value.job.conclusion = 'unknown'; }
  ];
  for (const mutate of mutations) {
    const fixture = publishedParentPlan('failure');
    mutate(fixture);
    expect(() => assertSessionResumeArtifactUploadReadback(fixture.artifact, [fixture.job], DEADLINE, 'parent-plan')).toThrow();
  }
});

test('pre-dispatch needs the active emitter while independently delivered runs survive a failed emitter', () => {
  const step = { name: 'Resume canonical verification Session', number: 6, status: 'completed' as const,
    conclusion: 'failure', startedAt: '2026-10-03T00:00:01.000Z', completedAt: '2026-10-03T00:00:02.000Z' };
  const input = { step, jobStartedAt: STARTED, jobCompletedAt: '2026-10-03T00:00:03.000Z', jobStatus: 'completed',
    observedAtUnixMs: START + 60_000, causeDeadlineAtUnixMs: DEADLINE };
  for (const conclusion of ['success', 'failure', 'cancelled']) {
    expect(() => assertSessionResumeEmitterStepReadback({ ...input, step: { ...step, conclusion }, mode: 'pre-dispatch' })).toThrow();
    expect(() => assertSessionResumeEmitterStepReadback({ ...input, step: { ...step, conclusion }, mode: 'observed-delivery' })).not.toThrow();
  }
  expect(() => assertSessionResumeEmitterStepReadback({ ...input, mode: 'pre-dispatch',
    jobStatus: 'in_progress', jobCompletedAt: null, step: { ...step, status: 'in_progress', conclusion: null, completedAt: null } })).not.toThrow();
  for (const change of [
    { step: { ...step, startedAt: null } },
    { step: { ...step, startedAt: '2026-10-03T00:00:04.000Z' } },
    { step: { ...step, status: 'queued' as const } },
    { step: { ...step, conclusion: 'unknown' } },
    { jobCompletedAt: '2026-10-03T00:00:01.000Z' },
    { observedAtUnixMs: DEADLINE }
  ]) {
    expect(() => assertSessionResumeEmitterStepReadback({ ...input, ...change, mode: 'observed-delivery' })).toThrow();
  }
});

test('resume cause keeps the original parent job deadline across later reads', () => {
  for (const observedAtUnixMs of [START, START + 60_000, DEADLINE - 1]) {
    expect(decodeSessionResumeCauseLifetime({ repositoryPrivate: false, parentJobStartedAt: STARTED,
      observedAtUnixMs })).toBe(DEADLINE);
  }
});

test('public history bound rejects missing/private repository facts and an exhausted parent cause', () => {
  for (const repositoryPrivate of [true, undefined, null, 'false', 0]) {
    expect(() => decodeSessionResumeCauseLifetime({ repositoryPrivate, parentJobStartedAt: STARTED,
      observedAtUnixMs: START })).toThrow('public-history retention bound');
  }
  for (const observedAtUnixMs of [START - 1, DEADLINE, DEADLINE + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => decodeSessionResumeCauseLifetime({ repositoryPrivate: false, parentJobStartedAt: STARTED,
      observedAtUnixMs })).toThrow();
  }
  for (const parentJobStartedAt of [undefined, null, 'not-a-time', 0]) {
    expect(() => decodeSessionResumeCauseLifetime({ repositoryPrivate: false, parentJobStartedAt,
      observedAtUnixMs: START })).toThrow();
  }
});

test('test API sessions cannot cause an archive read or mint historical Session admission', async () => {
  let requests = 0, callbacks = 0;
  const capability = issueGitHubApiTestCapability({ repository: 'sec-platform/sec', effect: 'verification-read',
    token: 'synthetic-resume-fixture-only', principal: { transport: 'github-rest-token', login: 'fixture',
      nodeId: 'FIXTURE', userId: 1, permission: 'maintain' }, transport: async () => {
      requests += 1; throw new Error('Test transport must not mint production admission');
    } });
  await expect(withGitHubApiTestSession({ capability, operation: async () =>
    await withAuthenticatedResumedSessionArtifact({ capability, artifactId: '7' }, async () => { callbacks += 1; })
  })).rejects.toThrow('production verification-read');
  expect(requests).toBe(0);
  expect(callbacks).toBe(0);
});

test('structural API and origin casts cannot enter any production resume issuer', async () => {
  let callbacks = 0;
  const operation = async () => { callbacks += 1; };
  await expect(withAuthenticatedResumedSessionArtifact({ capability: Object.freeze({}) as GitHubApiCapability,
    artifactId: '7' }, operation)).rejects.toThrow();
  const origin = Object.freeze({}) as AuthenticatedGitHubJobOrigin;
  await expect(withAuthenticatedResumedSessionProducer({ origin }, operation)).rejects.toThrow();
  await expect(withAuthenticatedSessionResumeCause({ origin,
    completedAction: {} as HostedResumeSignal['completedAction'] }, operation)).rejects.toThrow();
  expect(callbacks).toBe(0);
});

test('original issuer verifies authority before observing hostile cause and locator getters', async () => {
  let accesses = 0, callbacks = 0;
  const operation = async () => { callbacks += 1; };
  const causeInput = Object.defineProperty({ origin: {} as AuthenticatedGitHubJobOrigin }, 'completedAction',
    { get: () => { accesses += 1; throw undefined; } });
  await expect(withAuthenticatedSessionResumeCause(causeInput as {
    origin: AuthenticatedGitHubJobOrigin; completedAction: HostedResumeSignal['completedAction'];
  }, operation)).rejects.toThrow();
  const artifactInput = Object.defineProperty({ capability: {} as GitHubApiCapability }, 'artifactId',
    { get: () => { accesses += 1; throw undefined; } });
  await expect(withAuthenticatedResumedSessionArtifact(artifactInput as {
    capability: GitHubApiCapability; artifactId: string;
  }, operation)).rejects.toThrow();
  expect(accesses).toBe(0);
  expect(callbacks).toBe(0);
});

test('data, clones, digests and serialized empty handles never restore admission', async () => {
  const artifact = {} as CodexDevelopmentVerificationSessionArtifact;
  const producer = {} as ResumedSessionProducer;
  const request = {} as VerificationSessionHostedRequest;
  for (const value of [Object.freeze({}), {}, JSON.parse('{}'), structuredClone({}),
    { artifact, producer, request, originalDeadlineAtUnixMs: Date.now() + 60_000 }]) {
    const admission = value as SessionResumeAdmission;
    expect(() => assertAuthenticatedSessionResumeAdmissionCurrent(admission, { artifact })).toThrow('live callback');
    expect(() => assertAuthenticatedSessionResumeArtifactTransportCurrent(admission, {} as Parameters<typeof assertAuthenticatedSessionResumeArtifactTransportCurrent>[1])).toThrow('live callback');
    expect(() => assertAuthenticatedSessionResumeProducerCurrent(admission, { producer, request })).toThrow('live callback');
    expect(() => authenticatedSessionResumeAuthorizationPrincipal(admission)).toThrow('live callback');
    expect(() => authenticatedSessionResumeDeadlineAtUnixMs(admission)).toThrow('live callback');
    await expect(revalidateAuthenticatedSessionResumeAdmission(admission)).rejects.toThrow('live callback');
    expect(() => assertAuthenticatedSessionResumeCauseCurrent(value as SessionResumeCause,
      { origin: {} as AuthenticatedGitHubJobOrigin, completedAction: {} as HostedResumeSignal['completedAction'] })).toThrow('live callback');
  }
});

test('unissued handle fails before inspecting caller-controlled consumer fields', () => {
  let accesses = 0;
  const input = Object.defineProperty({}, 'artifact', { get: () => { accesses += 1; throw new Error('caller getter'); } });
  expect(() => assertAuthenticatedSessionResumeAdmissionCurrent({} as SessionResumeAdmission,
    input as { artifact: CodexDevelopmentVerificationSessionArtifact })).toThrow('live callback');
  expect(accesses).toBe(0);
});


test('direct archive binding rejects changed IDs, producer metadata, reuploads and bytes after a valid data comparison', () => {
  const artifactText = '{}\n';
  const metadata: GitHubActionsArtifactObservation = { artifactId: '123', artifactName: 'fixture',
    archiveDigest: null, workflowPath: '.github/workflows/compiler-pr-validation.yml',
    workflowRef: `.github/workflows/compiler-pr-validation.yml@${'a'.repeat(40)}`, workflowSha: 'a'.repeat(40),
    runId: '400', runAttempt: 1, eventName: 'repository_dispatch', actorNodeId: 'APP', actorPermission: 'none', expired: false };
  const transport: SessionResumeArtifactTransport = { ...metadata, artifactFileName: 'verification-session-artifact.json',
    artifactByteDigest: `sha256:${createHash('sha256').update(artifactText).digest('hex')}`,
    artifactByteLength: Buffer.byteLength(artifactText), artifactExpired: false, downloadTransport: 'github-actions-artifact-api' };
  expect(() => assertSessionResumeArtifactTransportReadback(transport, { metadata, artifactText })).not.toThrow();
  for (const mutation of [ { artifactId: '124' }, { artifactName: 'other' }, { runId: '401' }, { runAttempt: 2 },
    { actorNodeId: 'OTHER' }, { workflowSha: 'b'.repeat(40) }, { artifactByteLength: 4 },
    { artifactByteDigest: `sha256:${'f'.repeat(64)}` }, { artifactExpired: true } ]) {
    expect(() => assertSessionResumeArtifactTransportReadback({ ...transport, ...mutation }, { metadata, artifactText })).toThrow();
  }
  expect(() => assertAuthenticatedSessionResumeArtifactTransportCurrent({} as SessionResumeAdmission, transport))
    .toThrow('live callback');
});
