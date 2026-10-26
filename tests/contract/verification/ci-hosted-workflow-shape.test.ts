import { expect, test } from 'bun:test';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { assertCiVerificationPerJobHostedWholeWorkflowShape, assertCiVerificationPerJobHostedWorkflowShape, CI_VERIFICATION_PER_JOB_HOSTED_JOB_POLICIES, getCiVerificationPerJobHostedJobPolicy, hostedSessionCoordinationBudget } from '../../../src/adapters/providers/github-api/contract/hosted-job-policy.ts';
import { CI_MAIN_HEALTH_POLICY, CI_MAIN_HEALTH_POLICY_DIGEST, createCiMainHealthRequestOperationId } from '../../../src/adapters/self-hosting/control/main-health/provider-policy.ts';
import { buildCiContract, CI_MAIN_HEALTH_COMMANDS, CI_MAIN_HEALTH_JOB_NAME, CI_MAIN_HEALTH_STEP_ORDER, CI_VERIFICATION_PR_EVENT, CI_VERIFICATION_PR_STEP_ORDER } from '../../../src/adapters/verification/platform/ci/contract/core.ts';
import { CI_VERIFICATION_EXECUTION_MODEL } from '../../../src/adapters/verification/platform/ci/contract/plan.ts';
import { CI_VERIFICATION_HOSTED_SANDBOX_POLICY, CI_VERIFICATION_SESSION_DISPATCH_TYPE } from '../../../src/adapters/verification/platform/ci/contract/revision.ts';
import { readCompilerFile } from '../../helpers/compiler-fixtures.ts';

type Step = Record<string, unknown> & {
  name: string; id?: string; run?: string; uses?: string;
  with?: Record<string, unknown>; env?: Record<string, unknown>;
};
type Job = Record<string, unknown> & {
  name?: string; steps: Step[]; permissions?: Record<string, string>; outputs?: Record<string, string>;
};
type Workflow = Record<string, unknown> & {
  name: string; on: Record<string, { types: string[]; workflows?: string[] }>;
  permissions: Record<string, string>; jobs: Record<string, Job>;
};
const COMPILER = '.github/workflows/compiler-pr-validation.yml';
const MERGE = '.github/workflows/merge-gate.yml';
const PREFLIGHT = 'preflight-verification-action-sut';
const ALLOCATION = 'job identity, allocation, deadline or permissions differ';
const STEPS = 'setup, launcher phases or native artifact steps differ';
const HEADER = 'complete workflow header scheduling differs';

// The checked-in source is independent of the validator's step compiler. These
// controls establish source shape only, never live origin or native qualification.
let compilerWorkflowBaseline: Promise<Workflow> | undefined;

async function currentCompilerWorkflow(): Promise<Workflow> {
  compilerWorkflowBaseline ??= (async () => {
    const source = await readCompilerFile(COMPILER);
    expect(() => assertCiVerificationPerJobHostedWholeWorkflowShape(source)).not.toThrow();
    expect(assertCiVerificationPerJobHostedWorkflowShape(source, PREFLIGHT).jobId).toBe(PREFLIGHT);
    const fixture = parseYaml(source) as Workflow;
    expect(() => assertCiVerificationPerJobHostedWholeWorkflowShape(stringifyYaml(fixture))).not.toThrow();
    return fixture;
  })();
  // Callers clone this read-only baseline for each independent mutation.
  return compilerWorkflowBaseline;
}

function step(job: Job, identity: string): Step {
  const matches = job.steps.filter(value => value.id === identity || value.name === identity);
  if (matches.length !== 1) throw new Error(`Expected one authored step: ${identity}`);
  return matches[0]!;
}

test('current compiler and merge workflows have the complete authored policy census', async () => {
  const expectedRoles = {
    [COMPILER]: {
      'validate-hosted-request': 'trusted', 'validate-agent-operation-activation-request': 'trusted',
      'agent-operation-activation': 'trusted', 'coordinate-verification-session': 'control',
      'receive-verification-session-resume': 'control', 'resolve-verification-action': 'trusted',
      'preflight-verification-action-sut': 'sut', 'claim-verification-action': 'trusted',
      'execute-verification-action-sut': 'sut', 'assemble-verification-action-terminal': 'trusted',
      'main-health': 'trusted'
    },
    [MERGE]: { plan: 'trusted', authorize: 'control', 'terminal-status': 'trusted', integrate: 'control' }
  } as const;
  for (const [path, roles] of Object.entries(expectedRoles)) {
    const source = await readCompilerFile(path);
    expect(() => assertCiVerificationPerJobHostedWholeWorkflowShape(source)).not.toThrow();
    const workflow = parseYaml(source) as Workflow;
    const members = CI_VERIFICATION_PER_JOB_HOSTED_JOB_POLICIES.filter(policy => policy.workflowPath === path);
    expect(members.map<string>(policy => policy.jobId).sort()).toEqual(Object.keys(roles).sort());
    expect(Object.keys(workflow.jobs).sort()).toEqual(Object.keys(roles).sort());

    if (path === COMPILER) {
      const activation = workflow.jobs['agent-operation-activation']!;
      expect(activation.permissions).toEqual({
        actions: 'read', checks: 'read', contents: 'read', issues: 'write',
        'pull-requests': 'write', 'id-token': 'write'
      });
      expect(step(activation, 'Checkout exact trusted hosted launcher').with).toMatchObject({
        ref: '${{ github.workflow_sha }}', 'persist-credentials': false
      });
      expect(step(activation, 'Checkout exact candidate SUT').with).toMatchObject({
        ref: '${{ needs.validate-agent-operation-activation-request.outputs.head-sha }}',
        'persist-credentials': false, path: 'candidate'
      });
      const upload = step(activation, 'Upload exact Agent operation activation receipt');
      const publication = step(activation, 'Publish exact Agent operation activation receipt');
      expect(upload.if).toContain("steps.produce.outputs.disposition == 'created'");
      expect(upload.if).toContain("steps.produce.outputs.activation-ready == 'true'");
      expect(publication.if).toContain("steps.produce.outputs.disposition == 'created'");
      expect(publication.env?.ARTIFACT_ID).toBe('${{ steps.upload-activation.outputs.artifact-id }}');
      expect(publication.env?.ARTIFACT_DIGEST).toBe(
        'sha256:${{ steps.upload-activation.outputs.artifact-digest }}'
      );
      expect(workflow.jobs['main-health']!.steps[1]!.with).toMatchObject({
        ref: '${{ github.event.client_payload.payload.mainSha }}', 'persist-credentials': false
      });
      expect(workflow.permissions).toEqual({ actions: 'read', contents: 'read', 'pull-requests': 'read' });
      expect(workflow.jobs['coordinate-verification-session']!.permissions).toEqual({
        actions: 'read', checks: 'read', contents: 'write', issues: 'write',
        'pull-requests': 'write', statuses: 'read', 'id-token': 'write'
      });
      expect(workflow.jobs['resolve-verification-action']!.permissions).toEqual({
        actions: 'read', checks: 'read', contents: 'read', issues: 'read',
        'pull-requests': 'read', statuses: 'read', 'id-token': 'write'
      });
      for (const id of ['claim-verification-action', 'assemble-verification-action-terminal']) {
        expect(workflow.jobs[id]!.permissions).toEqual({
          actions: 'write', checks: 'read', contents: 'read', statuses: 'write', 'id-token': 'write'
        });
      }
      for (const id of ['preflight-verification-action-sut', 'execute-verification-action-sut']) {
        expect(workflow.jobs[id]!.permissions).toEqual({ actions: 'read', contents: 'read', 'id-token': 'write' });
      }
      const contract = buildCiContract();
      expect(Object.isFrozen(CI_MAIN_HEALTH_POLICY)).toBe(true);
      expect(createCiMainHealthRequestOperationId('93dde9e44bbcffdd7fa1d6be726df1725947f6e2'))
        .toBe('sha256:1062f573e4a315b308f46c6abd9a82815fdaa97a3b2171f0cb8b806467473a78');
      expect(CI_MAIN_HEALTH_POLICY_DIGEST).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(CI_MAIN_HEALTH_JOB_NAME).toBe('sec/main-health');
      expect(contract.mainHealthContext).toBe(CI_MAIN_HEALTH_JOB_NAME);
      expect(contract.mainHealthPolicyDigest).toBe(CI_MAIN_HEALTH_POLICY_DIGEST);
      expect(contract.mainHealthStepOrder).toEqual([...CI_MAIN_HEALTH_STEP_ORDER]);
      expect(contract.mainHealthCommands).toEqual([...CI_MAIN_HEALTH_COMMANDS]);
      expect(contract.mainHealthCommands).toEqual(['bun run deps:ensure', 'bun --version']);
      expect(CI_MAIN_HEALTH_POLICY.runtimeReadinessInput).toMatchObject({
        command: 'bun --version', dependencyPreparation: 'not-required-for-runtime-readiness',
        guarantees: ['runtime-startup', 'successful-exit', 'original-resource-release'],
        excludedQualification: ['full-fast-tests', 'typecheck', 'documentation', 'business-behavior']
      });
      expect(contract.executionModel).toBe(CI_VERIFICATION_EXECUTION_MODEL);
      expect(contract.prWorkflowEvent).toBe(CI_VERIFICATION_PR_EVENT);
      expect(contract.prDispatchType).toBe(CI_VERIFICATION_SESSION_DISPATCH_TYPE);
      const runtimeSteps = Object.entries(workflow.jobs)
        .filter(([, job]) => job.steps.some(value => typeof value.run === 'string'))
        .sort(([left], [right]) => left.localeCompare(right))
        .flatMap(([, job]) => job.steps);
      expect(CI_VERIFICATION_PR_STEP_ORDER).toEqual(runtimeSteps.map(value => value.name));
      expect(contract.prWorkflowStepOrder).toEqual(runtimeSteps.map(value => value.name));
      expect(contract.prWorkflowStepCount).toBe(runtimeSteps.length);
      expect(contract.prWorkflowCommands).toEqual(runtimeSteps.flatMap(value => value.run ?? []));
      expect(contract.prWorkflowCommandCount).toBe(contract.prWorkflowCommands.length);
      const jobMinutes = ['resolve-verification-action', 'preflight-verification-action-sut',
        'claim-verification-action', 'execute-verification-action-sut', 'assemble-verification-action-terminal']
        .map(id => Number(workflow.jobs[id]!['timeout-minutes']));
      expect(jobMinutes).toEqual([20, 10, 35, 75, 30]);
      const budget = hostedSessionCoordinationBudget();
      const completeActionMinutes = jobMinutes.reduce((sum, value) => sum + value, 0) + 5;
      expect(budget.actionWindowMs).toBe(completeActionMinutes * 60_000);
      expect(budget.reviewWindowMs).toBe(20 * 60_000);
      expect(budget.actionOverheadMs).toBe(5 * 60_000);
      expect(budget.coordinatorOverheadMs).toBe(10 * 60_000);
      expect(budget.actionPollIntervalMs).toBe(15_000);
      expect(budget.reviewPollIntervalMs).toBe(20_000);
      expect(budget.actionMaximumAttempts).toBe(completeActionMinutes * 60 / 15 + 1);
      expect(budget.reviewMaximumAttempts).toBe(20 * 60 / 20 + 1);
      expect(workflow.jobs['coordinate-verification-session']!['timeout-minutes'])
        .toBe(20 + completeActionMinutes + 10);
      const hostedSutWallClockMinutes = Math.ceil(
        CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.wallSeconds / 60
      );
      const hostedSutTerminalizationReserveMinutes = 15;
      expect(CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.wallSeconds).toBe(3_600);
      expect(workflow.jobs['execute-verification-action-sut']!['timeout-minutes']).toBe(
        hostedSutWallClockMinutes + hostedSutTerminalizationReserveMinutes
      );
    }
    for (const policy of members) {
      const authored = workflow.jobs[policy.jobId]!;
      expect<string>(policy.role).toBe((roles as Record<string, string>)[policy.jobId]!);
      expect(policy.jobName).toBe(authored.name ?? policy.jobId);
      expect(policy.maximumJobDurationMs).toBe(Number(authored['timeout-minutes']) * 60_000);
      expect<unknown>(policy.runnerLabel).toEqual(authored['runs-on']);
      for (const action of policy.trigger.actions) expect(workflow.on[policy.trigger.eventName]!.types).toContain(action);
      if (policy.trigger.eventName === 'workflow_run') {
        expect(policy.trigger.sourceWorkflowPath).toBe(COMPILER);
        expect(workflow.on.workflow_run!.workflows).toEqual(['compiler-pr-validation']);
      }
      if (policy.runtime.kind === 'per-job-runtime') {
        expect(assertCiVerificationPerJobHostedWorkflowShape(source, policy.jobId)).toBe(policy);
      }
    }
  }
  const source = await readCompilerFile(COMPILER);
  for (const id of ['validate-hosted-request', 'main-health', 'sec/main-health', 'PREFLIGHT', '../preflight-verification-action-sut']) {
    expect(() => assertCiVerificationPerJobHostedWorkflowShape(source, id)).toThrow('job is not one closed runtime member');
  }
  const member = getCiVerificationPerJobHostedJobPolicy(COMPILER, 'main-health');
  expect(member?.jobName).toBe('sec/main-health');
  expect(member).toBe(CI_VERIFICATION_PER_JOB_HOSTED_JOB_POLICIES.find(policy =>
    policy.workflowPath === COMPILER && policy.jobId === 'main-health')!);
  for (const id of ['sec/main-health', 'MAIN-HEALTH', '../main-health']) {
    expect(getCiVerificationPerJobHostedJobPolicy(COMPILER, id)).toBeNull();
  }
  expect(getCiVerificationPerJobHostedJobPolicy('.github/workflows/foreign.yml', 'main-health')).toBeNull();
});

test('a valid selected job cannot hide mutations of other executable workflow members', async () => {
  const fixture = await currentCompilerWorkflow();
  const mutations: Array<[string, string, (value: Workflow) => void]> = [
    ['missing retained member', 'complete job census differs', value => { delete value.jobs['main-health']; }],
    ['API-only hidden writer', 'API-only executable source differs', value => {
      value.jobs['validate-hosted-request']!.steps.push({ name: 'Hidden writer', run: 'upload forged artifact' });
    }],
    ['API-only process injection', 'API-only executable source differs', value => {
      value.jobs['validate-hosted-request']!.env = { NODE_OPTIONS: '--require ./candidate.js' };
    }],
    ['API-only permission expansion', 'API-only executable source differs', value => {
      value.jobs['validate-hosted-request']!.permissions = { contents: 'write' };
    }],
    ['retained member credential injection', 'mature entry recipe differs', value => {
      value.jobs['main-health']!.env = { ACTIONS_RUNTIME_TOKEN: '${{ secrets.TOKEN }}' };
    }],
    ['retained member omitted readiness shell', 'mature entry recipe differs', value => {
      delete step(value.jobs['main-health']!, 'runtime-readiness').shell;
    }],
    ['retained member readiness shell substitution', 'mature entry recipe differs', value => {
      step(value.jobs['main-health']!, 'runtime-readiness').shell = 'bash {0}';
    }],
    ['retained member readiness command substitution', 'mature entry recipe differs', value => {
      step(value.jobs['main-health']!, 'runtime-readiness').run = 'bun --version --eval "process.exit(0)"';
    }],
    ['retained member readiness input redirection', 'mature entry recipe differs', value => {
      step(value.jobs['main-health']!, 'runtime-readiness').env = {
        SEC_MAIN_HEALTH_SHA: '${{ github.event.client_payload.payload.otherSha }}'
      };
    }],
    ['retained member hidden writer', 'mature entry recipe differs', value => {
      value.jobs['main-health']!.steps.push({ name: 'Foreign upload', run: 'upload another job output' });
    }],
    ['selected-only job set', 'complete job census differs', value => { value.jobs = { [PREFLIGHT]: value.jobs[PREFLIGHT]! }; }]
  ];
  for (const [label, guard, mutate] of mutations) {
    const changed = structuredClone(fixture);
    mutate(changed);
    const source = stringifyYaml(changed);
    expect(() => assertCiVerificationPerJobHostedWorkflowShape(source, PREFLIGHT), label).not.toThrow();
    expect(() => assertCiVerificationPerJobHostedWholeWorkflowShape(source), label).toThrow(guard);
  }
});

test('workflow header rejects inherited execution and permission substitutions', async () => {
  const fixture = await currentCompilerWorkflow();
  const mutations: Array<[string, (value: Workflow) => void]> = [
    ['inherited Actions write', value => { value.permissions.actions = 'write'; }],
    ['candidate working directory', value => { value.defaults = { run: { 'working-directory': './candidate' } }; }],
    ['inherited shell injection', value => { value.env = { BASH_ENV: '/tmp/candidate.sh' }; }],
    ['foreign workflow identity', value => { value.name = 'foreign'; }],
    ['additional dispatch event', value => { value.on.repository_dispatch!.types.push('arbitrary'); }]
  ];
  for (const [label, mutate] of mutations) {
    const changed = structuredClone(fixture);
    mutate(changed);
    const source = stringifyYaml(changed);
    expect(() => assertCiVerificationPerJobHostedWorkflowShape(source, PREFLIGHT), label).toThrow(HEADER);
    expect(() => assertCiVerificationPerJobHostedWholeWorkflowShape(source), label)
      .toThrow(label === 'foreign workflow identity' ? 'unknown complete workflow' : HEADER);
  }
});

test('selected runtime rejects host execution, policy substitution and artifact escape', async () => {
  const fixture = await currentCompilerWorkflow();
  // Keep distinct admission guards and structural changes; step contents are
  // compared as complete canonical data, not interpreted as shell instructions.
  const mutations: Array<[string, string, (job: Job) => void]> = [
    ['self-hosted allocation', ALLOCATION, job => { job['runs-on'] = 'self-hosted'; }],
    ['caller-selected allocation', ALLOCATION, job => { job['runs-on'] = '${{ inputs.runner }}'; }],
    ['renewed deadline', ALLOCATION, job => { job['timeout-minutes'] = 11; }],
    ['expanded Actions permission', ALLOCATION, job => { job.permissions!.actions = 'write'; }],
    ['candidate host execution', STEPS, job => { job.steps.push({ name: 'Run candidate', run: 'bun candidate/hostile.ts' }); }],
    ['persisted checkout credentials', STEPS, job => {
      step(job, 'Checkout exact trusted hosted launcher').with!['persist-credentials'] = true;
    }],
    ['mutable bootstrap action', STEPS, job => { step(job, 'Setup exact trusted bootstrap Bun').uses = 'oven-sh/setup-bun@main'; }],
    ['omitted executable digest check', STEPS, job => {
      job.steps = job.steps.filter(value => value !== step(job, 'Verify exact bootstrap Bun bytes'));
    }],
    ['foreign phase', STEPS, job => {
      step(job, 'preflight').run = step(job, 'preflight').run!.replace('--phase self-test-hosted-action-sandbox', '--phase execute-hosted-action-sut');
    }],
    ['launcher process injection', STEPS, job => { step(job, 'preflight').env!.NODE_OPTIONS = '--require ./candidate.js'; }],
    ['download outside input slot', STEPS, job => { step(job, 'download-resolution').with!.path = '${{ github.workspace }}'; }],
    ['upload outside output slot', STEPS, job => { step(job, 'upload-capability').with!.path = '${{ runner.temp }}/../'; }],
    ['phase before input download', STEPS, job => {
      const input = step(job, 'download-resolution');
      const phase = step(job, 'preflight');
      const inputIndex = job.steps.indexOf(input);
      const phaseIndex = job.steps.indexOf(phase);
      job.steps[inputIndex] = phase; job.steps[phaseIndex] = input;
    }],
    ['ignored phase failure', STEPS, job => { step(job, 'preflight')['continue-on-error'] = true; }],
    ['unadmitted job container', 'selected job has an unadmitted field', job => { job.container = { image: 'unqualified:latest' }; }],
    ['credential output', 'job output is not a closed launcher data output', job => { job.outputs!.leak = '${{ secrets.SECRET }}'; }]
  ];
  for (const [label, guard, mutate] of mutations) {
    const changed = structuredClone(fixture);
    mutate(changed.jobs[PREFLIGHT]!);
    const source = stringifyYaml(changed);
    expect(() => assertCiVerificationPerJobHostedWorkflowShape(source, PREFLIGHT), label).toThrow(guard);
    expect(() => assertCiVerificationPerJobHostedWholeWorkflowShape(source), label).toThrow(guard);
  }
});

test('producer output census binds exact launcher and native uploader ownership', async () => {
  const fixture = await currentCompilerWorkflow();
  const mutations: Array<[string, string, (outputs: Record<string, string>) => void]> = [
    ['missing native artifact id', 'required producer output census differs', outputs => { delete outputs['capability-artifact-id']; }],
    ['extra output key', 'required producer output census differs', outputs => { outputs['other-artifact-id'] = '${{ steps.upload-capability.outputs.artifact-id }}'; }],
    ['download cannot own artifact id', 'job output is not a closed launcher data output', outputs => {
      outputs['capability-artifact-id'] = '${{ steps.download-resolution.outputs.artifact-id }}';
    }],
    ['uploader token is not artifact data', 'job output is not a closed launcher data output', outputs => {
      outputs['capability-artifact-id'] = '${{ steps.upload-capability.outputs.token }}';
    }],
    ['another job uploader', 'job output is not a closed launcher data output', outputs => {
      outputs['capability-artifact-id'] = '${{ steps.upload-raw.outputs.artifact-id }}';
    }]
  ];
  for (const [label, guard, mutate] of mutations) {
    const changed = structuredClone(fixture);
    mutate(changed.jobs[PREFLIGHT]!.outputs!);
    const source = stringifyYaml(changed);
    expect(() => assertCiVerificationPerJobHostedWorkflowShape(source, PREFLIGHT), label).toThrow(guard);
    expect(() => assertCiVerificationPerJobHostedWholeWorkflowShape(source), label).toThrow(guard);
  }
});

test('workflow source rejects duplicate keys and inputs beyond its bounded parser', async () => {
  const source = await readCompilerFile(COMPILER);
  expect(() => assertCiVerificationPerJobHostedWholeWorkflowShape(source)).not.toThrow();
  for (const changed of [`${source}\nname: compiler-pr-validation\n`, 'x'.repeat(512 * 1024 + 1)]) {
    expect(() => assertCiVerificationPerJobHostedWorkflowShape(changed, PREFLIGHT)).toThrow();
    expect(() => assertCiVerificationPerJobHostedWholeWorkflowShape(changed)).toThrow();
  }
});
