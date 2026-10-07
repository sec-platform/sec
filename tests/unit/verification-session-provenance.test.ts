import { expect, test } from 'bun:test';
import type { VerificationSessionGitHubClient } from '../../src/adapters/verification/platform/ci/runtime/verification-session-github.ts';
import { assertHostedRecoveryArtifactProvenance, assertHostedRecoveryArtifactUploadWindow, decodeHostedRecoveryControlStepFacts, observeHostedIntegrationPrincipals, readAuthenticatedHostedControlStepFacts, readVerifiedHostedRecoveryTransport } from '../../src/adapters/verification/platform/ci/runtime/verification-session.ts';
import type { GitHubActionsArtifactObservation } from '../../src/execution/verification/session.ts';

type GitHubPrincipalObservation = Awaited<ReturnType<VerificationSessionGitHubClient['observePrincipal']>>;

const base = '1'.repeat(40);
const metadata: GitHubActionsArtifactObservation = {
  artifactId: '30', artifactName: 'recovery', workflowPath: '.github/workflows/merge-gate.yml',
  workflowRef: `.github/workflows/merge-gate.yml@${base}`, workflowSha: base,
  runId: '20', runAttempt: 1, eventName: 'workflow_run', actorNodeId: 'INITIATOR',
  actorPermission: 'maintain', expired: false, archiveDigest: null
};
const producingRun = { id: 20, run_attempt: 1, event: 'workflow_run',
  path: '.github/workflows/merge-gate.yml', head_sha: base,
  actor: { login: 'initiator', node_id: 'INITIATOR' } };
const expected = { metadata, producingRun, baseSha: base, runId: '20', runAttempt: 1 };

test('recovery artifact binds its workflow_run producing attempt independently of App publication', () => {
  expect(() => assertHostedRecoveryArtifactProvenance(expected)).not.toThrow();
  expect(() => assertHostedRecoveryArtifactProvenance({ ...expected,
    metadata: { ...metadata, actorPermission: 'admin' } })).not.toThrow();
});

for (const [name, patch] of [
  ['compiler event', { eventName: 'repository_dispatch' }],
  ['foreign workflow', { workflowPath: '.github/workflows/foreign.yml' }],
  ['foreign revision', { workflowSha: '2'.repeat(40) }],
  ['other run', { runId: '21' }],
  ['other attempt', { runAttempt: 2 }],
  ['publisher substituted for initiator', { actorNodeId: 'MDM6Qm90NDE4OTgyODI=', actorPermission: 'none' }],
  ['write-only initiator', { actorPermission: 'write' }],
  ['expired archive', { expired: true }]
] as const) test(`recovery provenance rejects ${name}`, () => {
  expect(() => assertHostedRecoveryArtifactProvenance({ ...expected,
    metadata: { ...metadata, ...patch } })).toThrow('provenance drifted');
});

for (const [name, patch] of [
  ['event', { event: 'repository_dispatch' }], ['attempt', { run_attempt: 2 }],
  ['head', { head_sha: '2'.repeat(40) }], ['actor', { actor: { login: 'other', node_id: 'OTHER' } }]
] as const) test(`recovery provenance rejects producing-run ${name} drift`, () => {
  expect(() => assertHostedRecoveryArtifactProvenance({ ...expected,
    producingRun: { ...producingRun, ...patch } })).toThrow('provenance drifted');
});

function principals(permission: GitHubPrincipalObservation['permission'] = 'maintain') {
  const records: Record<string, GitHubPrincipalObservation> = {
    initiator: { login: 'initiator', nodeId: 'INITIATOR', permission: 'maintain' },
    rerunner: { login: 'rerunner', nodeId: 'RERUNNER', permission }
  };
  return {
    github: { observePrincipal: async (_repository: string, login: string) => {
      if (!Object.hasOwn(records, login)) throw new Error('Unknown fixture principal');
      return records[login]!;
    } },
    repository: 'sec-platform/sec',
    sourceRun: { actor: { login: 'initiator', node_id: 'INITIATOR' },
      triggering_actor: { login: 'initiator', node_id: 'INITIATOR' } },
    currentRun: { actor: { login: 'initiator', node_id: 'INITIATOR' },
      triggering_actor: { login: 'rerunner', node_id: 'RERUNNER' } },
    environment: { GITHUB_ACTOR: 'initiator', GITHUB_TRIGGERING_ACTOR: 'rerunner' }
  };
}

test('current rerun principal is checked independently while source initiator remains original', async () => {
  expect(await observeHostedIntegrationPrincipals(principals())).toEqual({
    sourceTriggeringActor: { login: 'initiator', nodeId: 'INITIATOR', permission: 'maintain' }
  });
  await expect(observeHostedIntegrationPrincipals(principals('write')))
    .rejects.toThrow('integrate-hosted triggering actor stable identity/live permission mismatch');
  await expect(observeHostedIntegrationPrincipals(principals('none'))).rejects.toThrow('permission mismatch');
});

test('current actor environment and API identity must agree before authority can proceed', async () => {
  const input = principals();
  await expect(observeHostedIntegrationPrincipals({ ...input,
    environment: { ...input.environment, GITHUB_TRIGGERING_ACTOR: 'initiator' } }))
    .rejects.toThrow('environment/API identity mismatch');
  await expect(observeHostedIntegrationPrincipals({ ...input,
    currentRun: { ...input.currentRun, triggering_actor: { login: 'rerunner', node_id: 'OTHER' } } }))
    .rejects.toThrow('stable identity/live permission mismatch');
  await expect(observeHostedIntegrationPrincipals({ ...input,
    sourceRun: { ...input.sourceRun, actor: { login: 'initiator', node_id: 'OTHER' } } }))
    .rejects.toThrow('source actor stable identity/live permission mismatch');
});


// Original provider observations are data here. These cases do not issue a
// live origin or qualify a native/GitHub execution environment.
function recoveryStepReadback() {
  const startedAt = '2026-10-04T20:00:00Z';
  const deadline = Date.parse(startedAt) + 116 * 60_000;
  return {
    origin: { repository: 'sec-platform/sec', repositoryId: '5', workflowPath: '.github/workflows/merge-gate.yml',
      workflowSha: base, trustedSourceSha: base, runId: '20', runAttempt: 1, jobId: '7', checkRunId: '8',
      jobName: 'authorize', policyJobId: 'authorize', phase: 'verify-integration-recovery',
      stepName: 'Read back exact branch closeout recovery artifact', stepNumber: 9,
      originalDeadlineAtUnixMs: deadline, deadlineAtUnixMs: deadline },
    run: { ...producingRun, repository: { id: 5, full_name: 'sec-platform/sec' }, status: 'in_progress', conclusion: null },
    job: { id: 7, run_id: 20, name: 'authorize', head_sha: base,
      check_run_url: 'https://api.github.com/repos/sec-platform/sec/check-runs/8',
      started_at: startedAt, completed_at: null, status: 'in_progress', conclusion: null,
      steps: [
        { number: 7, name: 'Prepare exact integration recovery artifact', status: 'completed', conclusion: 'success',
          started_at: '2026-10-04T20:00:01Z', completed_at: '2026-10-04T20:00:02Z' },
        { number: 8, name: 'Upload exact branch closeout recovery artifact', status: 'completed', conclusion: 'success',
          started_at: '2026-10-04T20:00:03Z', completed_at: '2026-10-04T20:00:05Z' },
        { number: 9, name: 'Read back exact branch closeout recovery artifact', status: 'in_progress', conclusion: null,
          started_at: '2026-10-04T20:00:06Z', completed_at: null }
      ] },
    observedAtUnixMs: Date.parse('2026-10-04T20:00:07Z')
  };
}

test('recovery readback binds ordered preparation and upload to the exact current verifier', () => {
  expect(decodeHostedRecoveryControlStepFacts(recoveryStepReadback())).toEqual({
    preparation: { name: 'Prepare exact integration recovery artifact', number: 7, status: 'completed', conclusion: 'success' },
    upload: { name: 'Upload exact branch closeout recovery artifact', number: 8, status: 'completed', conclusion: 'success' },
    uploadWindow: { startedAtUnixMs: Date.parse('2026-10-04T20:00:03Z'), completedAtUnixMs: Date.parse('2026-10-04T20:00:05Z') }
  });
});

test('recovery job readback accepts the provider-omitted attempt only with its exact origin-bound identities', () => {
  const value = recoveryStepReadback();
  expect(Object.hasOwn(value.job, 'run_attempt')).toBe(false);
  expect(() => decodeHostedRecoveryControlStepFacts(value)).not.toThrow();
  expect(() => decodeHostedRecoveryControlStepFacts({ ...value,
    job: { ...value.job, run_attempt: 1 } })).not.toThrow();
  for (const run_attempt of [null, undefined, 2, '1']) {
    expect(() => decodeHostedRecoveryControlStepFacts({ ...value,
      job: { ...value.job, run_attempt } })).toThrow();
  }
  for (const patch of [{ id: 8 }, { run_id: 21 }, { head_sha: '2'.repeat(40) },
    { check_run_url: 'https://api.github.com/repos/sec-platform/sec/check-runs/9' }]) {
    expect(() => decodeHostedRecoveryControlStepFacts({ ...value, job: { ...value.job, ...patch } })).toThrow();
  }
  expect(() => decodeHostedRecoveryControlStepFacts({ ...value,
    run: { ...value.run, run_attempt: 2 } })).toThrow();
});

test('recovery readback rejects changed native job, run, repository, attempt, source or phase', () => {
  const value = recoveryStepReadback();
  for (const patch of [{ id: 21 }, { run_attempt: 2 }, { head_sha: '2'.repeat(40) },
    { path: '.github/workflows/other.yml' }, { event: 'repository_dispatch' }, { status: 'completed' },
    { conclusion: 'failure' }, { repository: { id: 6, full_name: 'sec-platform/sec' } },
    { repository: { id: 5, full_name: 'other/repo' } }]) {
    expect(() => decodeHostedRecoveryControlStepFacts({ ...value, run: { ...value.run, ...patch } })).toThrow();
  }
  for (const patch of [{ id: 8 }, { run_id: 21 }, { run_attempt: 2 }, { name: 'integrate' },
    { head_sha: '2'.repeat(40) }, { check_run_url: 'https://api.github.com/repos/other/repo/check-runs/8' },
    { status: 'completed' }, { conclusion: 'success' }]) {
    expect(() => decodeHostedRecoveryControlStepFacts({ ...value, job: { ...value.job, ...patch } })).toThrow();
  }
  for (const patch of [{ phase: 'prepare-integration-hosted' }, { policyJobId: 'integrate' },
    { trustedSourceSha: '2'.repeat(40) }, { stepName: 'Other verifier' }, { stepNumber: 10 },
    { originalDeadlineAtUnixMs: value.origin.originalDeadlineAtUnixMs + 1 },
    { deadlineAtUnixMs: value.origin.deadlineAtUnixMs + 1 }]) {
    expect(() => decodeHostedRecoveryControlStepFacts({ ...value, origin: { ...value.origin, ...patch } })).toThrow();
  }
});

test('recovery readback rejects missing, duplicate, failed or reordered producer and verifier steps', () => {
  const value = recoveryStepReadback();
  const [preparation, upload, verifier] = value.job.steps;
  for (const steps of [[], [preparation, verifier], [upload, verifier], [preparation, upload],
    [...value.job.steps, { ...upload, number: 10 }], [...value.job.steps, { ...verifier, number: 10 }],
    [...value.job.steps, { ...preparation, number: 10 }],
    [preparation, { ...upload, number: 9 }, verifier], [preparation, { ...upload, number: 10 }, verifier],
    [{ ...preparation, number: 10 }, upload, verifier],
    [{ ...preparation, conclusion: 'failure' }, upload, verifier],
    [preparation, { ...upload, conclusion: 'failure' }, verifier],
    [preparation, { ...upload, status: 'in_progress' }, verifier],
    [preparation, upload, { ...verifier, status: 'completed' }],
    [preparation, upload, { ...verifier, conclusion: 'success' }]]) {
    expect(() => decodeHostedRecoveryControlStepFacts({ ...value, job: { ...value.job, steps } })).toThrow();
  }
});

test('recovery readback rejects a completed job timestamp or a second active provider step', () => {
  const value = recoveryStepReadback();
  for (const completed_at of ['2026-10-04T20:00:07Z', 'invalid', undefined]) {
    expect(() => decodeHostedRecoveryControlStepFacts({ ...value,
      job: { ...value.job, completed_at } })).toThrow();
  }
  expect(() => decodeHostedRecoveryControlStepFacts({ ...value, job: { ...value.job,
    steps: [...value.job.steps, { number: 10, name: 'Unrelated active step', status: 'in_progress',
      conclusion: null, started_at: '2026-10-04T20:00:06Z', completed_at: null }] } })).toThrow();
});

test('recovery readback rejects reversed, absent, future and outside-original-lifetime step times', () => {
  const value = recoveryStepReadback();
  for (const [index, patch] of [
    [0, { started_at: '2026-10-04T19:59:59Z' }], [0, { completed_at: '2026-10-04T20:00:00Z' }],
    [0, { completed_at: null }], [1, { started_at: '2026-10-04T20:00:01Z' }],
    [1, { started_at: null }], [1, { completed_at: null }], [1, { completed_at: 'invalid' }],
    [1, { completed_at: '2026-10-04T20:00:02Z' }], [1, { completed_at: '2026-10-04T20:00:07Z' }],
    [2, { started_at: '2026-10-04T20:00:04Z' }], [2, { started_at: '2026-10-04T20:00:08Z' }],
    [2, { started_at: null }], [2, { completed_at: '2026-10-04T20:00:07Z' }]
  ] as const) {
    const steps = value.job.steps.map((step, selected) => selected === index ? { ...step, ...patch } : step);
    expect(() => decodeHostedRecoveryControlStepFacts({ ...value, job: { ...value.job, steps } })).toThrow();
  }
  for (const observedAtUnixMs of [Number.NaN, Date.parse('2026-10-04T20:00:05Z'), value.origin.deadlineAtUnixMs]) {
    expect(() => decodeHostedRecoveryControlStepFacts({ ...value, observedAtUnixMs })).toThrow();
  }
});

test('skipped recovery upload without timestamps retains its absence-only lane', () => {
  const value = recoveryStepReadback();
  expect(Object.hasOwn(value.job, 'run_attempt')).toBe(false);
  const steps = value.job.steps.map((step, index) => index === 1
    ? { ...step, conclusion: 'skipped', started_at: null, completed_at: null } : step);
  const observed = decodeHostedRecoveryControlStepFacts({ ...value, job: { ...value.job, steps } });
  expect(observed.upload).toMatchObject({ status: 'completed', conclusion: 'skipped' });
  expect(observed.uploadWindow).toBeNull();
  expect(() => assertHostedRecoveryArtifactUploadWindow({ ...metadata,
    createdAt: '2026-10-04T20:00:04Z', updatedAt: '2026-10-04T20:00:04Z' }, observed.uploadWindow)).toThrow();
});

test('recovery artifact timestamps must fit the actual upload even when other provenance matches', () => {
  const window = { startedAtUnixMs: Date.parse('2026-10-04T20:00:03Z'), completedAtUnixMs: Date.parse('2026-10-04T20:00:05Z') };
  const artifact = { ...metadata, createdAt: '2026-10-04T20:00:03Z', updatedAt: '2026-10-04T20:00:05Z' };
  expect(() => assertHostedRecoveryArtifactProvenance({ ...expected, metadata: artifact })).not.toThrow();
  expect(() => assertHostedRecoveryArtifactUploadWindow(artifact, window)).not.toThrow();
  for (const patch of [{ createdAt: undefined }, { updatedAt: undefined }, { createdAt: 'invalid' },
    { updatedAt: 'invalid' }, { createdAt: '2026-10-04T20:00:02Z' },
    { createdAt: '2026-10-04T20:00:06Z' }, { updatedAt: '2026-10-04T20:00:06Z' },
    { updatedAt: '2026-10-04T20:00:02Z' }]) {
    expect(() => assertHostedRecoveryArtifactUploadWindow({ ...artifact, ...patch }, window)).toThrow();
  }
});

test('copied recovery origin cannot read caller provider fields or enter native transport', async () => {
  let touched = 0;
  const unissued = {} as Parameters<typeof readAuthenticatedHostedControlStepFacts>[0]['origin'];
  const input = { origin: unissued,
    get ctx(): never { touched += 1; throw new Error('untrusted ctx'); },
    get github(): never { touched += 1; throw new Error('untrusted github'); },
    get repository(): never { touched += 1; throw new Error('untrusted repository'); },
    get runId(): never { touched += 1; throw new Error('untrusted run'); },
    get runAttempt(): never { touched += 1; throw new Error('untrusted attempt'); },
    get expectedArtifactName(): never { touched += 1; throw new Error('untrusted artifact'); }
  };
  expect(() => readAuthenticatedHostedControlStepFacts(input)).toThrow();
  await expect(readVerifiedHostedRecoveryTransport(input)).rejects.toThrow();
  expect(touched).toBe(0);
});
