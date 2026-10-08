import { expect, test } from 'bun:test';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { assertCiVerificationPerJobHostedWholeWorkflowShape, assertCiVerificationPerJobHostedWorkflowShape, CI_VERIFICATION_PER_JOB_HOSTED_JOB_POLICIES, getCiVerificationPerJobHostedJobPolicy } from '../../src/adapters/providers/github-api/contract/hosted-job-policy.ts';
import { readCompilerFile } from '../helpers/compiler-fixtures.ts';

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
async function currentCompilerWorkflow(): Promise<Workflow> {
  const source = await readCompilerFile(COMPILER);
  expect(() => assertCiVerificationPerJobHostedWholeWorkflowShape(source)).not.toThrow();
  expect(assertCiVerificationPerJobHostedWorkflowShape(source, PREFLIGHT).jobId).toBe(PREFLIGHT);
  const fixture = parseYaml(source) as Workflow;
  expect(() => assertCiVerificationPerJobHostedWholeWorkflowShape(stringifyYaml(fixture))).not.toThrow();
  return fixture;
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
  const mutations: Array<[string, string, (job: Job) => void]> = [
    ['self-hosted allocation', ALLOCATION, job => { job['runs-on'] = 'self-hosted'; }],
    ['caller-selected allocation', ALLOCATION, job => { job['runs-on'] = '${{ inputs.runner }}'; }],
    ['renewed deadline', ALLOCATION, job => { job['timeout-minutes'] = 11; }],
    ['expanded Actions permission', ALLOCATION, job => { job.permissions!.actions = 'write'; }],
    ['candidate host execution', STEPS, job => { job.steps.push({ name: 'Run candidate', run: 'bun candidate/hostile.ts' }); }],
    ['caller-selected trusted checkout', STEPS, job => {
      step(job, 'Checkout exact trusted hosted launcher').with!.ref = '${{ github.event.client_payload.head }}';
    }],
    ['persisted checkout credentials', STEPS, job => {
      step(job, 'Checkout exact trusted hosted launcher').with!['persist-credentials'] = true;
    }],
    ['mutable bootstrap action', STEPS, job => { step(job, 'Setup exact trusted bootstrap Bun').uses = 'oven-sh/setup-bun@main'; }],
    ['omitted executable digest check', STEPS, job => {
      job.steps = job.steps.filter(value => value !== step(job, 'Verify exact bootstrap Bun bytes'));
    }],
    ['dependency lifecycle scripts', STEPS, job => { step(job, 'Install exact trusted launcher dependencies').run = 'bun install --frozen-lockfile'; }],
    ['foreign phase', STEPS, job => {
      step(job, 'preflight').run = step(job, 'preflight').run!.replace('--phase self-test-hosted-action-sandbox', '--phase execute-hosted-action-sut');
    }],
    ['candidate appended to launcher', STEPS, job => { step(job, 'preflight').run += '; bun candidate.ts'; }],
    ['launcher process injection', STEPS, job => { step(job, 'preflight').env!.NODE_OPTIONS = '--require ./candidate.js'; }],
    ['download outside input slot', STEPS, job => { step(job, 'download-resolution').with!.path = '${{ github.workspace }}'; }],
    ['upload outside output slot', STEPS, job => { step(job, 'upload-capability').with!.path = '${{ runner.temp }}/../'; }],
    ['artifact overwrite', STEPS, job => { step(job, 'upload-capability').with!.overwrite = true; }],
    ['foreign artifact name', STEPS, job => { step(job, 'upload-capability').with!.name = 'foreign-artifact'; }],
    ['phase before input download', STEPS, job => {
      const input = step(job, 'download-resolution');
      const phase = step(job, 'preflight');
      const inputIndex = job.steps.indexOf(input);
      const phaseIndex = job.steps.indexOf(phase);
      job.steps[inputIndex] = phase; job.steps[phaseIndex] = input;
    }],
    ['ignored phase failure', STEPS, job => { step(job, 'preflight')['continue-on-error'] = true; }],
    ['unadmitted job container', 'selected job has an unadmitted field', job => { job.container = { image: 'unqualified:latest' }; }],
    ['unadmitted job environment', 'selected job has an unadmitted field', job => { job.env = { BASH_ENV: '/tmp/candidate.sh' }; }],
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
