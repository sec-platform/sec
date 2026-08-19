import { expect, test } from 'bun:test';

import {
  HOSTED_INTEGRATION_PHASE_JOB_NAMES_V1,
  HOSTED_INTEGRATION_PHASE_STEP_NAMES_V1,
  assertHostedIntegrationPhaseOwnershipV1,
  type HostedIntegrationPhaseV1
} from '../../scripts/codex/integration-authorization-publication.ts';
import type {
  GitHubWorkflowJobObservationV1,
  GitHubWorkflowJobStepObservationV1
} from '../../scripts/codex/verification-session-github.ts';
import { parseGitHubWorkflowJobsForAttemptV1 } from '../../scripts/codex/verification-session-github.ts';

const WORKFLOW_SHA = '1111111111111111111111111111111111111111';

function step(input: Partial<GitHubWorkflowJobStepObservationV1> & { name: string; number: number }) {
  return Object.freeze({
    name: input.name,
    number: input.number,
    status: input.status ?? 'in_progress',
    conclusion: input.conclusion ?? null,
    startedAt: input.startedAt === undefined ? '2026-08-09T00:00:00.000Z' : input.startedAt,
    completedAt: input.completedAt ?? null
  } satisfies GitHubWorkflowJobStepObservationV1);
}

function job(input: {
  attempt: number;
  phase: HostedIntegrationPhaseV1;
  current?: boolean;
  phaseStarted?: boolean;
  steps?: readonly GitHubWorkflowJobStepObservationV1[];
}): GitHubWorkflowJobObservationV1 {
  const current = input.current ?? false;
  const phaseStep = step({
    name: HOSTED_INTEGRATION_PHASE_STEP_NAMES_V1[input.phase],
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
    name: HOSTED_INTEGRATION_PHASE_JOB_NAMES_V1[input.phase],
    status: current ? 'in_progress' : 'completed',
    conclusion: current ? null : 'success',
    headSha: WORKFLOW_SHA,
    startedAt: '2026-08-09T00:00:00.000Z',
    completedAt: current ? null : '2026-08-09T00:02:00.000Z',
    steps: input.steps ?? [phaseStep]
  });
}

function observe(input: {
  phase: HostedIntegrationPhaseV1;
  attempts: readonly Readonly<{ runAttempt: number; jobs: readonly GitHubWorkflowJobObservationV1[] }>[];
  currentAttempt: number;
}) {
  return assertHostedIntegrationPhaseOwnershipV1({
    attempts: input.attempts,
    runId: '900',
    currentRunAttempt: input.currentAttempt,
    currentJobName: HOSTED_INTEGRATION_PHASE_JOB_NAMES_V1[input.phase],
    workflowSha: WORKFLOW_SHA,
    phase: input.phase
  });
}

test('provider phase owner requires the exact current in-progress named step', () => {
  const phase = 'integration' as const;
  const ownership = observe({ phase, currentAttempt: 1,
    attempts: [{ runAttempt: 1, jobs: [job({ attempt: 1, phase, current: true })] }] });
  expect(ownership).toMatchObject({ runId: '900', runAttempt: 1, jobName: 'integrate',
    phase, stepName: HOSTED_INTEGRATION_PHASE_STEP_NAMES_V1.integration,
    priorAttemptStarted: false });

  const queued = job({ attempt: 1, phase, current: true, steps: [step({
    name: HOSTED_INTEGRATION_PHASE_STEP_NAMES_V1.integration,
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
  expect(ownership.stepName).toBe(HOSTED_INTEGRATION_PHASE_STEP_NAMES_V1.recoveryPreparation);

  expect(() => assertHostedIntegrationPhaseOwnershipV1({
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
    name: HOSTED_INTEGRATION_PHASE_STEP_NAMES_V1.closeoutMutation,
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
    steps: [{ name: HOSTED_INTEGRATION_PHASE_STEP_NAMES_V1.integration, number: 5,
      status: 'in_progress', conclusion: null, started_at: '2026-08-09T00:00:01.000Z',
      completed_at: null }]
  };
  const exact = parseGitHubWorkflowJobsForAttemptV1({
    source: [{ jobs: [providerJob] }],
    runId: '900',
    runAttempt: 1
  });
  expect(exact).toHaveLength(1);
  expect(exact[0]).toMatchObject({ id: '1001', runId: '900', runAttempt: 1,
    name: 'integrate', steps: [{ name: HOSTED_INTEGRATION_PHASE_STEP_NAMES_V1.integration }] });

  expect(() => parseGitHubWorkflowJobsForAttemptV1({
    source: [providerJob],
    runId: '900',
    runAttempt: 1
  }))
    .toThrow('complete page-object array');
});
