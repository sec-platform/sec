import { expect, test } from 'bun:test';

import type { HostedResumeSignal } from '../../src/adapters/providers/github-api/contract/hosted-resume-dispatch.ts';
import { createCiVerificationActionParentDispatchPlan, createCiVerificationActionProposal, createCiVerificationActionProviderEnvelope } from '../../src/adapters/verification/platform/action/contract/ci.ts';
import { CI_GITHUB_ACTIONS_IDENTITY_POLICY, verificationActionProviderTerminalArtifactName } from '../../src/adapters/verification/platform/action/contract/provider.ts';
import { reduceCiVerificationSessionResumeCensus, type CiVerificationSessionResumeCensusInput, type CiVerificationSessionResumeCensusJob, type CiVerificationSessionResumeCensusJobPage, type CiVerificationSessionResumeCensusRun, type CiVerificationSessionResumeCensusRunPage } from '../../src/adapters/verification/platform/ci/runtime/verification-session-resume-census.ts';
import { ciVerificationSessionWakeKey, createCiVerificationSessionResumeSignal } from '../../src/adapters/verification/platform/ci/runtime/verification-session-resume-contract.ts';
import { createVerificationSessionPerJobHostedRequest } from '../../src/adapters/verification/platform/ci/runtime/verification-session-runtime.ts';
import { sha256 } from '../../src/contracts/canonical.ts';

const BASE = 'a'.repeat(40), REPOSITORY = 'sec-platform/sec';
const human = { id: 10, login: 'maintainer', nodeId: 'U_10', type: 'User' as const };
const completion = '2026-10-03T14:00:00Z';
const causeTitle = 'integrate compiler session run 21 attempt 1';
const resumeStep = 'Resume canonical verification Session';

function cause(): HostedResumeSignal['completedAction'] {
  const actionKey = sha256('closed Action');
  const request = createVerificationSessionPerJobHostedRequest({ prNumber: 7,
    expectedBaseSha: BASE, expectedBaseTreeSha: 'b'.repeat(40), expectedHeadSha: 'c'.repeat(40),
    expectedHeadTreeSha: 'd'.repeat(40), manifestPath: 'config/repository/work-packages/resume.json',
    manifestDigest: sha256('manifest'), profile: 'quick', expectedScopeProposalDigest: sha256('scope'),
    expectedActionPlanDigest: sha256('closure'), expectedSessionRevision: sha256('session'), reviewPolicyDigest: sha256('review') });
  const proposal = createCiVerificationActionProposal({ sessionRequest: request, proposedActionKey: actionKey });
  const parentPlan = createCiVerificationActionParentDispatchPlan({ repositoryId: '1', repository: REPOSITORY,
    parentRunId: '11', parentRunAttempt: 1, parentJobId: '12',
    parentWorkflowRef: `${REPOSITORY}/.github/workflows/compiler-pr-validation.yml@refs/heads/main`,
    parentWorkflowSha: BASE, parentActor: { ...human, permission: 'maintain' }, proposals: [proposal] });
  return { providerEnvelope: createCiVerificationActionProviderEnvelope({ proposal, parentPlan,
    parentDispatchPlanArtifactId: '13', parentDispatchPlanArchiveDigest: sha256('parent archive') }),
    runId: '21', runAttempt: 1, terminalArtifactId: '31', terminalArtifactName: verificationActionProviderTerminalArtifactName(actionKey),
    terminalArchiveDigest: sha256('terminal archive'), terminalPayloadDigest: sha256('terminal payload') };
}

function receiver(number: number, change: Partial<CiVerificationSessionResumeCensusRun> = {}): CiVerificationSessionResumeCensusRun {
  return { runId: String(1000 + number), runNumber: number, runAttempt: 1, workflowId: '77', repositoryId: '1',
    repository: REPOSITORY, workflowPath: '.github/workflows/merge-gate.yml', eventName: 'workflow_run',
    displayTitle: number === 3 ? causeTitle : `another receiver ${number}`, headSha: BASE,
    status: number === 3 ? 'in_progress' : 'completed',
    createdAt: new Date(Date.parse(completion) + (number - 2) * 60_000).toISOString(),
    actor: human, triggeringActor: human, ...change };
}
function runPages(runs: readonly CiVerificationSessionResumeCensusRun[]): readonly CiVerificationSessionResumeCensusRunPage[] {
  return Array.from({ length: Math.max(1, Math.ceil(runs.length / 100)) }, (_, index) => ({
    page: index + 1, perPage: 100, totalCount: runs.length, hasNextPage: (index + 1) * 100 < runs.length,
    runs: runs.slice(index * 100, (index + 1) * 100)
  }));
}
function jobPages(jobs: readonly CiVerificationSessionResumeCensusJob[]): readonly CiVerificationSessionResumeCensusJobPage[] {
  return [{ page: 1, perPage: 100, totalCount: jobs.length, hasNextPage: false, jobs }];
}
function fixture(): CiVerificationSessionResumeCensusInput {
  return { completedAction: cause(), completedActionCompletedAt: completion, currentReceiver: receiver(3),
    receiverHistoryPages: runPages([receiver(4), receiver(3), receiver(2), receiver(1)]),
    compilerHistory: { workflowId: '88', headSha: BASE, paginationComplete: true, pages: runPages([]) }, priorReceiverJobs: [] };
}
function successor(input: CiVerificationSessionResumeCensusInput, change: Partial<CiVerificationSessionResumeCensusRun> = {}): CiVerificationSessionResumeCensusRun {
  return receiver(12, { runId: '2012', workflowId: '88', workflowPath: '.github/workflows/compiler-pr-validation.yml',
    eventName: 'repository_dispatch', displayTitle: `resume Session ${ciVerificationSessionWakeKey(input.completedAction)}`,
    actor: CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot, triggeringActor: CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot, ...change });
}
function withCompiler(input: CiVerificationSessionResumeCensusInput, runs: readonly CiVerificationSessionResumeCensusRun[]): CiVerificationSessionResumeCensusInput {
  return { ...input, compilerHistory: { ...input.compilerHistory, pages: runPages(runs) } };
}
function withOther(input: CiVerificationSessionResumeCensusInput, number: 2 | 4,
  receiverChanges: Partial<CiVerificationSessionResumeCensusRun> = {},
  stepChanges: Partial<CiVerificationSessionResumeCensusJob['steps'][number]> = {}): CiVerificationSessionResumeCensusInput {
  const other = receiver(number, { displayTitle: causeTitle, ...receiverChanges });
  const jobs: readonly CiVerificationSessionResumeCensusJob[] = [{ id: String(3000 + number), name: 'integrate',
    runId: other.runId, runAttempt: 1, headSha: BASE, status: 'completed',
    steps: [{ name: resumeStep, number: 6, status: 'completed', conclusion: 'skipped', startedAt: null, ...stepChanges }] }];
  return { ...input, receiverHistoryPages: runPages([receiver(4), receiver(3), receiver(2), receiver(1)]
    .map(run => run.runNumber === number ? other : run)),
    priorReceiverJobs: [{ runId: other.runId, runAttempt: 1, paginationComplete: true, pages: jobPages(jobs) }] };
}

test('cause-only wake helper retains the exact existing wire digest without an invented emitter', () => {
  const completedAction = cause();
  const signal = createCiVerificationSessionResumeSignal({ completedAction, emitter: {
    repositoryId: '1', repository: REPOSITORY, workflowPath: '.github/workflows/merge-gate.yml', workflowSha: BASE,
    runId: '1003', runAttempt: 1, jobId: '3003', checkRunId: '4003', policyJobId: 'integrate',
    phase: 'resume-verification-session', stepName: resumeStep, stepNumber: 6
  } });
  expect(ciVerificationSessionWakeKey(completedAction)).toBe(signal.wakeKey);
  expect(ciVerificationSessionWakeKey(completedAction)).toBe(sha256({ schema: 'sec-verification-session-wake-key-v1', completedAction }));
  for (const change of [{ runId: '0' }, { runAttempt: 0 }, { terminalPayloadDigest: 'bad' }, { terminalArtifactName: 'foreign' }]) {
    expect(() => ciVerificationSessionWakeKey({ ...completedAction, ...change } as HostedResumeSignal['completedAction'])).toThrow();
  }
  expect(() => ciVerificationSessionWakeKey({ ...completedAction,
    terminalArtifactName: 'a'.repeat(32 * 1024) })).toThrow('provider wire limit');
});

test('complete unfiltered receiver prefix and complete empty compiler query produce only unseen data', () => {
  expect(reduceCiVerificationSessionResumeCensus(fixture())).toEqual({ disposition: 'unseen', existingRun: null, reason: null });
});

test('native concurrency order is not run_number order: a higher-numbered started receiver is a tombstone', () => {
  const input = withOther(fixture(), 4, {}, { status: 'in_progress', conclusion: null, startedAt: '2026-10-03T14:03:00Z' });
  expect(input.currentReceiver.runNumber).toBeLessThan(input.receiverHistoryPages[0]!.runs[0]!.runNumber);
  expect(reduceCiVerificationSessionResumeCensus(input)).toMatchObject({ disposition: 'unknown', reason: 'resume-step-started-tombstone' });
  expect(reduceCiVerificationSessionResumeCensus(withOther(fixture(), 2, {},
    { status: 'completed', conclusion: 'success', startedAt: '2026-10-03T14:00:20Z' }))).toMatchObject({ disposition: 'unknown' });
});

test('a unique actual compiler successor recovers even when the receiver previously started or is a rerun', () => {
  const input = withOther(fixture(), 4, {}, { startedAt: '2026-10-03T14:03:00Z' });
  const existing = successor(input);
  expect(reduceCiVerificationSessionResumeCensus(withCompiler(input, [existing]))).toEqual({ disposition: 'existing', existingRun: existing, reason: null });
  const rerun = { ...fixture(), currentReceiver: receiver(3, { runAttempt: 2 }) };
  expect(reduceCiVerificationSessionResumeCensus(rerun)).toMatchObject({ disposition: 'unknown', reason: 'receiver-rerun-recovery-only' });
  expect(reduceCiVerificationSessionResumeCensus(withCompiler(rerun, [successor(rerun)]))).toMatchObject({ disposition: 'existing' });
});

test('two compiler successors, incomplete pagination or a caller-filtered array never establish absence or uniqueness', () => {
  const input = fixture(), first = successor(input), second = successor(input, { runId: '2013', runNumber: 13 });
  expect(reduceCiVerificationSessionResumeCensus(withCompiler(input, [first, second]))).toMatchObject({ disposition: 'unknown', reason: 'multiple-compiler-successors' });
  const one = withCompiler(input, [first]);
  expect(reduceCiVerificationSessionResumeCensus({ ...one, compilerHistory: { ...one.compilerHistory, paginationComplete: false } })).toMatchObject({ disposition: 'unknown' });
  expect(reduceCiVerificationSessionResumeCensus({ ...one, compilerHistory: { ...one.compilerHistory,
    pages: [{ ...one.compilerHistory.pages[0]!, totalCount: 2 }] } })).toMatchObject({ disposition: 'unknown' });
});

test('matching title alone cannot supply compiler workflow, source, repository, event or GitHub App identity', () => {
  const input = fixture();
  for (const change of [
    { workflowId: '99' }, { workflowPath: '.github/workflows/foreign.yml' }, { headSha: 'f'.repeat(40) },
    { repository: 'foreign/sec' }, { repositoryId: '2' }, { eventName: 'workflow_dispatch' },
    { actor: human }, { triggeringActor: human }, { createdAt: '2026-10-03T13:59:59Z' }
  ]) expect(reduceCiVerificationSessionResumeCensus(withCompiler(input, [successor(input, change)]))).toMatchObject({ disposition: 'unknown' });
  // The full query legitimately includes human-started, unrelated compiler runs.
  expect(reduceCiVerificationSessionResumeCensus(withCompiler(input,
    [successor(input, { displayTitle: 'original human Session', actor: human, triggeringActor: human })]))).toMatchObject({ disposition: 'unseen' });
});

test('the actual repository head query retains other workflows and their independent run_number domains', () => {
  const input = fixture();
  const original = successor(input, { displayTitle: 'original human Session', actor: human, triggeringActor: human });
  const otherWorkflow = receiver(original.runNumber, { runId: '9012' });
  expect(original.workflowId).not.toBe(otherWorkflow.workflowId);
  expect(original.runNumber).toBe(otherWorkflow.runNumber);
  expect(reduceCiVerificationSessionResumeCensus(withCompiler(input, [original, otherWorkflow]))).toMatchObject({ disposition: 'unseen' });
  expect(reduceCiVerificationSessionResumeCensus(withCompiler(input, [successor(input), otherWorkflow]))).toMatchObject({ disposition: 'existing' });
  expect(reduceCiVerificationSessionResumeCensus(withCompiler(input, [original,
    { ...otherWorkflow, repositoryId: '2' }]))).toMatchObject({ disposition: 'unknown' });
});

test('receiver gaps above currentN, deleted runs, duplicate identities and inconsistent ordering are unknown', () => {
  const input = fixture();
  const variants = [
    [receiver(5), receiver(3), receiver(2), receiver(1)],
    [receiver(4), receiver(3), receiver(1)],
    [receiver(4), receiver(3), receiver(2, { runId: receiver(3).runId }), receiver(1)],
    [receiver(4), receiver(3), receiver(2, { runNumber: 3 }), receiver(1)],
    [receiver(3), receiver(4), receiver(2), receiver(1)],
    [receiver(4), receiver(3), receiver(2, { createdAt: '2026-10-03T14:04:00Z' }), receiver(1)]
  ];
  for (const runs of variants) expect(reduceCiVerificationSessionResumeCensus({ ...input, receiverHistoryPages: runPages(runs) })).toMatchObject({ disposition: 'unknown' });
});

test('no strict older anchor, current omitted, filtered source, or partial individual pages cannot authorize unseen', () => {
  const input = fixture();
  for (const runs of [
    [receiver(4), receiver(3), receiver(2)],
    [receiver(4), receiver(2), receiver(1)],
    [receiver(4), receiver(3, { workflowId: '99' }), receiver(2), receiver(1)],
    [receiver(4), receiver(3, { headSha: 'f'.repeat(40) }), receiver(2), receiver(1)]
  ]) expect(reduceCiVerificationSessionResumeCensus({ ...input, receiverHistoryPages: runPages(runs) })).toMatchObject({ disposition: 'unknown' });
  expect(reduceCiVerificationSessionResumeCensus({ ...input,
    receiverHistoryPages: [{ ...input.receiverHistoryPages[0]!, totalCount: 5 }] })).toMatchObject({ disposition: 'unknown' });
});

test('complete page-1 prefix can stop at its anchor while older total history remains unread', () => {
  const input = fixture();
  const runs = Array.from({ length: 101 }, (_, index) => receiver(103 - index));
  const current = runs[0]!;
  const actualCurrent = { ...current, displayTitle: causeTitle, status: 'in_progress' as const };
  const all = [{ ...actualCurrent }, ...runs.slice(1)];
  // Move the completion frontier into the first page; page 2 is irrelevant history.
  const completedActionCompletedAt = runs[80]!.createdAt;
  const prefix = runPages(all).slice(0, 1);
  expect(prefix[0]!.hasNextPage).toBe(true);
  expect(reduceCiVerificationSessionResumeCensus({ ...input, completedActionCompletedAt, currentReceiver: actualCurrent,
    receiverHistoryPages: prefix })).toMatchObject({ disposition: 'unseen' });
  expect(reduceCiVerificationSessionResumeCensus({ ...input, completedActionCompletedAt, currentReceiver: actualCurrent,
    receiverHistoryPages: [{ ...prefix[0]!, page: 2 }] })).toMatchObject({ disposition: 'unknown' });
});

test('matching settled receiver requires a real complete integrate and resume-step observation', () => {
  const input = withOther(fixture(), 4);
  expect(reduceCiVerificationSessionResumeCensus(input)).toMatchObject({ disposition: 'unseen' });
  expect(reduceCiVerificationSessionResumeCensus({ ...input, priorReceiverJobs: [] })).toMatchObject({ disposition: 'unknown' });
  const observed = input.priorReceiverJobs[0]!, job = observed.pages[0]!.jobs[0]!;
  for (const jobs of [[], [{ ...job, name: 'foreign' }], [{ ...job, steps: [] }], [job, { ...job, id: '9999' }]]) {
    expect(reduceCiVerificationSessionResumeCensus({ ...input, priorReceiverJobs: [{ ...observed, pages: jobPages(jobs) }] })).toMatchObject({ disposition: 'unknown' });
  }
  expect(reduceCiVerificationSessionResumeCensus({ ...input, priorReceiverJobs: [{ ...observed, paginationComplete: false }] })).toMatchObject({ disposition: 'unknown' });
});

test('queued same-cause receiver has no effect only under the caller-owned global concurrency invariant', () => {
  const input = withOther(fixture(), 4, { status: 'queued' });
  const observed = input.priorReceiverJobs[0]!;
  expect(reduceCiVerificationSessionResumeCensus({ ...input, priorReceiverJobs: [{ ...observed, pages: jobPages([]) }] })).toMatchObject({ disposition: 'unseen' });
  const originalJob = observed.pages[0]!.jobs[0]!;
  const queuedJob: CiVerificationSessionResumeCensusJob = { ...originalJob, status: 'queued',
    steps: originalJob.steps.map(step => ({ ...step, status: 'queued', conclusion: null })) };
  expect(reduceCiVerificationSessionResumeCensus({ ...input,
    priorReceiverJobs: [{ ...observed, pages: jobPages([queuedJob]) }] })).toMatchObject({ disposition: 'unseen' });
  expect(reduceCiVerificationSessionResumeCensus(withOther(fixture(), 4, { status: 'in_progress' }))).toMatchObject({ disposition: 'unknown' });
  expect(reduceCiVerificationSessionResumeCensus(withOther(fixture(), 4, { status: 'queued' },
    { startedAt: '2026-10-03T14:03:00Z' }))).toMatchObject({ disposition: 'unknown' });
});

test('a queued resume-step projection under a settled receiver and job is unknown until explicitly skipped', () => {
  const settledSkipped = withOther(fixture(), 4);
  expect(reduceCiVerificationSessionResumeCensus(settledSkipped)).toMatchObject({ disposition: 'unseen' });
  const unsettledStep = withOther(fixture(), 4, {}, { status: 'queued', conclusion: null, startedAt: null });
  expect(unsettledStep.priorReceiverJobs[0]!.pages[0]!.jobs[0]!.status).toBe('completed');
  expect(reduceCiVerificationSessionResumeCensus(unsettledStep)).toMatchObject({ disposition: 'unknown', reason: 'resume-step-observation-incomplete' });
});

test('job origin, attempt, duplicate page rows and inconsistent step closure remain unknown', () => {
  const input = withOther(fixture(), 4), observed = input.priorReceiverJobs[0]!, job = observed.pages[0]!.jobs[0]!;
  for (const changed of [
    { ...job, runId: '9999' }, { ...job, runAttempt: 2 }, { ...job, headSha: 'f'.repeat(40) },
    { ...job, steps: [...job.steps, job.steps[0]!] },
    { ...job, steps: [{ ...job.steps[0]!, conclusion: 'success' }] }
  ]) expect(reduceCiVerificationSessionResumeCensus({ ...input,
    priorReceiverJobs: [{ ...observed, pages: jobPages([changed]) }] })).toMatchObject({ disposition: 'unknown' });
  expect(reduceCiVerificationSessionResumeCensus({ ...input,
    priorReceiverJobs: [observed, observed] })).toMatchObject({ disposition: 'unknown' });
});

test('malformed data and accessors produce unknown without reading caller-controlled hooks', () => {
  const input = fixture();
  expect(reduceCiVerificationSessionResumeCensus({ ...input, completedActionCompletedAt: 'not a timestamp' })).toMatchObject({ disposition: 'unknown' });
  let touched = false;
  const accessor = { ...input, get currentReceiver() { touched = true; return input.currentReceiver; } };
  expect(reduceCiVerificationSessionResumeCensus(accessor)).toMatchObject({ disposition: 'unknown' });
  expect(touched).toBe(false);
});


test('repository head query at its 1000-result provider ceiling cannot prove completeness', () => {
  const input = fixture();
  const unrelated = Array.from({ length: 999 }, (_, index) => successor(input, {
    runId: String(20000 + index), runNumber: index + 1, displayTitle: `unrelated compiler run ${index}`
  }));
  expect(reduceCiVerificationSessionResumeCensus(withCompiler(input, unrelated))).toMatchObject({ disposition: 'unseen' });
  const atCeiling = [...unrelated, successor(input, { runId: '30000', runNumber: 1000 })];
  expect(reduceCiVerificationSessionResumeCensus(withCompiler(input, atCeiling))).toMatchObject({
    disposition: 'unknown', reason: 'compiler-filtered-query-ceiling'
  });
  expect(reduceCiVerificationSessionResumeCensus(withCompiler(input, [...atCeiling,
    successor(input, { runId: '30001', runNumber: 1001, displayTitle: 'another compiler run' })]))).toMatchObject({ disposition: 'unknown' });
});
