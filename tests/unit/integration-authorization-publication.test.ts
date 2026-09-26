import { expect, test } from 'bun:test';

import type {
  GitHubWorkflowJobObservation,
  GitHubWorkflowJobStepObservation,
  GitHubWorkflowRunObservation
} from '../../src/adapters/providers/github-api/contract.ts';
import {
  HOSTED_INTEGRATION_PHASE_JOB_NAMES,
  HOSTED_INTEGRATION_PHASE_STEP_NAMES,
  assertHostedIntegrationPhaseOwnership,
  selectCanonicalIntegrationRunOwner,
  type HostedIntegrationPhase
} from '../../src/adapters/self-hosting/control/integration/integration-authorization-publication.ts';
import { parseGitHubWorkflowJobsForAttempt } from '../../src/adapters/verification/platform/ci/runtime/verification-session-github.ts';

const WORKFLOW_SHA = '1111111111111111111111111111111111111111';

function integrationRun(input: Partial<GitHubWorkflowRunObservation> & { id: string }) {
  return Object.freeze({
    name: 'merge-gate',
    displayTitle: 'integrate compiler session run 100 attempt 2',
    workflowPath: '.github/workflows/merge-gate.yml',
    event: 'workflow_run',
    status: 'in_progress',
    conclusion: null,
    headSha: WORKFLOW_SHA,
    runAttempt: 1,
    updatedAt: '2026-08-09T00:00:00.000Z',
    ...input,
    id: input.id
  } satisfies GitHubWorkflowRunObservation);
}

test('completed-source wakeup has one canonical owner across duplicates and reruns', () => {
  const input = { currentRunId: '200', currentRunAttempt: 1,
    sourceRunId: '100', sourceRunAttempt: 2, baseSha: WORKFLOW_SHA } as const;
  expect(selectCanonicalIntegrationRunOwner({ ...input, runs: [integrationRun({ id: '200' })] }))
    .toEqual({ runId: '200', runAttempt: 1, sourceRunId: '100', sourceRunAttempt: 2 });
  expect(() => selectCanonicalIntegrationRunOwner({ ...input, currentRunId: '201',
    runs: [integrationRun({ id: '201' }), integrationRun({ id: '200' })] }))
    .toThrow('canonical smallest exact workflow run owner');
  expect(() => selectCanonicalIntegrationRunOwner({ ...input, currentRunAttempt: 2,
    runs: [integrationRun({ id: '200', runAttempt: 1 })] }))
    .toThrow('canonical smallest exact workflow run owner');
  for (const conflict of [
    integrationRun({ id: '200', event: 'repository_dispatch' }),
    integrationRun({ id: '200', workflowPath: '.github/workflows/foreign.yml' }),
    integrationRun({ id: '200', headSha: '2'.repeat(40) })
  ]) {
    expect(() => selectCanonicalIntegrationRunOwner({ ...input, runs: [conflict] }))
      .toThrow('conflicting source identity');
  }
});

function step(input: Partial<GitHubWorkflowJobStepObservation> & { name: string; number: number }) {
  return Object.freeze({
    name: input.name,
    number: input.number,
    status: input.status ?? 'in_progress',
    conclusion: input.conclusion ?? null,
    startedAt: input.startedAt === undefined ? '2026-08-09T00:00:00.000Z' : input.startedAt,
    completedAt: input.completedAt ?? null
  } satisfies GitHubWorkflowJobStepObservation);
}

function job(input: {
  attempt: number;
  phase: HostedIntegrationPhase;
  current?: boolean;
  phaseStarted?: boolean;
  steps?: readonly GitHubWorkflowJobStepObservation[];
}): GitHubWorkflowJobObservation {
  const current = input.current ?? false;
  const phaseStep = step({
    name: HOSTED_INTEGRATION_PHASE_STEP_NAMES[input.phase],
    number: 5,
    status: current ? 'in_progress' : 'completed',
    conclusion: current ? null : input.phaseStarted === false ? 'skipped' : 'success',
    startedAt: current || input.phaseStarted !== false ? '2026-08-09T00:00:00.000Z' : null,
    completedAt: current ? null : '2026-08-09T00:01:00.000Z'
  });
  return Object.freeze({
    id: String(1000 + input.attempt + (input.phase === 'recoveryPreparation' ? 100 : 0)),
    runId: '900',
    runAttempt: input.attempt,
    name: HOSTED_INTEGRATION_PHASE_JOB_NAMES[input.phase],
    status: current ? 'in_progress' : 'completed',
    conclusion: current ? null : 'success',
    headSha: WORKFLOW_SHA,
    startedAt: '2026-08-09T00:00:00.000Z',
    completedAt: current ? null : '2026-08-09T00:02:00.000Z',
    steps: input.steps ?? [phaseStep]
  });
}

function observe(input: {
  phase: HostedIntegrationPhase;
  attempts: readonly Readonly<{ runAttempt: number; jobs: readonly GitHubWorkflowJobObservation[] }>[];
  currentAttempt: number;
}) {
  return assertHostedIntegrationPhaseOwnership({
    attempts: input.attempts,
    runId: '900',
    currentRunAttempt: input.currentAttempt,
    currentJobName: HOSTED_INTEGRATION_PHASE_JOB_NAMES[input.phase],
    workflowSha: WORKFLOW_SHA,
    phase: input.phase
  });
}

test('provider phase owner requires the exact current in-progress named step', () => {
  const phase = 'integration' as const;
  const ownership = observe({ phase, currentAttempt: 1,
    attempts: [{ runAttempt: 1, jobs: [job({ attempt: 1, phase, current: true })] }] });
  expect(ownership).toMatchObject({ runId: '900', runAttempt: 1, jobName: 'integrate',
    phase, stepName: HOSTED_INTEGRATION_PHASE_STEP_NAMES.integration,
    priorAttemptStarted: false });

  const queued = job({ attempt: 1, phase, current: true, steps: [step({
    name: HOSTED_INTEGRATION_PHASE_STEP_NAMES.integration,
    number: 5, status: 'queued', startedAt: null
  })] });
  expect(() => observe({ phase, currentAttempt: 1,
    attempts: [{ runAttempt: 1, jobs: [queued] }] }))
    .toThrow('not provider-confirmed in progress');
});

test('authorization recovery preparation belongs to the read-only authorize job', () => {
  const phase = 'recoveryPreparation' as const;
  const ownership = observe({ phase, currentAttempt: 1,
    attempts: [{ runAttempt: 1, jobs: [job({ attempt: 1, phase, current: true })] }] });
  expect(ownership.jobName).toBe('authorize');
  expect(ownership.stepName).toBe(HOSTED_INTEGRATION_PHASE_STEP_NAMES.recoveryPreparation);

  expect(() => assertHostedIntegrationPhaseOwnership({
    attempts: [{ runAttempt: 1, jobs: [job({ attempt: 1, phase, current: true })] }],
    runId: '900',
    currentRunAttempt: 1,
    currentJobName: 'integrate',
    workflowSha: WORKFLOW_SHA,
    phase
  })).toThrow('phase identity is invalid');
});

test('prior started integration phase is a durable ambiguous-effect tombstone', () => {
  const phase = 'integration' as const;
  const ownership = observe({ phase, currentAttempt: 2, attempts: [
    { runAttempt: 1, jobs: [job({ attempt: 1, phase, phaseStarted: true })] },
    { runAttempt: 2, jobs: [job({ attempt: 2, phase, current: true })] }
  ] });
  expect(ownership.priorAttemptStarted).toBe(true);
});

test('a different prior hosted effect phase across authorize and integrate jobs blocks rerun', () => {
  const priorRecovery = job({ attempt: 1, phase: 'recoveryPreparation', phaseStarted: true });
  const ownership = observe({ phase: 'integration', currentAttempt: 2, attempts: [
    { runAttempt: 1, jobs: [priorRecovery] },
    { runAttempt: 2, jobs: [job({ attempt: 2, phase: 'integration', current: true })] }
  ] });
  expect(ownership.priorAttemptStarted).toBe(false);
  expect(ownership.priorEffectStarted).toBe(true);
  expect(ownership.priorEffectPhases).toEqual(['recoveryPreparation']);
});

test('a provider-skipped prior phase is not treated as an effect start', () => {
  const phase = 'closeoutMutation' as const;
  const ownership = observe({ phase, currentAttempt: 2, attempts: [
    { runAttempt: 1, jobs: [job({ attempt: 1, phase, phaseStarted: false })] },
    { runAttempt: 2, jobs: [job({ attempt: 2, phase, current: true })] }
  ] });
  expect(ownership.priorAttemptStarted).toBe(false);
});

test('attempt gaps and duplicate canonical jobs fail closed', () => {
  const phase = 'closeoutPublication' as const;
  expect(() => observe({ phase, currentAttempt: 2,
    attempts: [{ runAttempt: 2, jobs: [job({ attempt: 2, phase, current: true })] }] }))
    .toThrow('pagination/attempt gap');
  const canonical = job({ attempt: 1, phase, current: true });
  expect(() => observe({ phase, currentAttempt: 1,
    attempts: [{ runAttempt: 1, jobs: [canonical, { ...canonical, id: '2000' }] }] }))
    .toThrow('duplicate canonical jobs');
});

test('same-name phase records with malformed completion facts fail closed', () => {
  const phase = 'closeoutMutation' as const;
  const malformed = job({ attempt: 1, phase, phaseStarted: true, steps: [step({
    name: HOSTED_INTEGRATION_PHASE_STEP_NAMES.closeoutMutation,
    number: 5,
    status: 'completed',
    conclusion: null,
    startedAt: '2026-08-09T00:00:00.000Z',
    completedAt: null
  })] });
  expect(() => observe({ phase, currentAttempt: 2, attempts: [
    { runAttempt: 1, jobs: [malformed] },
    { runAttempt: 2, jobs: [job({ attempt: 2, phase, current: true })] }
  ] })).toThrow('facts are incomplete');
});

test('GitHub workflow job parser requires a complete page-object inventory', () => {
  const providerJob = {
    id: 1001,
    run_id: 900,
    run_attempt: 1,
    name: 'integrate',
    status: 'in_progress',
    conclusion: null,
    head_sha: WORKFLOW_SHA,
    started_at: '2026-08-09T00:00:00.000Z',
    completed_at: null,
    steps: [{ name: HOSTED_INTEGRATION_PHASE_STEP_NAMES.integration, number: 5,
      status: 'in_progress', conclusion: null, started_at: '2026-08-09T00:00:01.000Z',
      completed_at: null }]
  };
  const exact = parseGitHubWorkflowJobsForAttempt({
    source: [{ jobs: [providerJob] }],
    runId: '900',
    runAttempt: 1
  });
  expect(exact).toHaveLength(1);
  expect(exact[0]).toMatchObject({ id: '1001', runId: '900', runAttempt: 1,
    name: 'integrate', steps: [{ name: HOSTED_INTEGRATION_PHASE_STEP_NAMES.integration }] });

  expect(() => parseGitHubWorkflowJobsForAttempt({
    source: [providerJob],
    runId: '900',
    runAttempt: 1
  }))
    .toThrow('complete page-object array');
});
