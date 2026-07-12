import { expect, test } from 'bun:test';
import { parse as parseYaml } from 'yaml';

import {
  assertCiExpectedHead,
  buildCiContract,
  buildCiFullGatePlan,
  buildCiQuickGatePlan,
  CI_VERIFICATION_CONTRACT_REVISION,
  CI_VERIFICATION_EXECUTION_MODEL,
  CI_VERIFICATION_PR_STEP_ORDER,
  CI_VERIFICATION_PR_TRIGGER_TYPES,
  CI_VERIFICATION_RELEASE_STEP_ORDER
} from '../../platform/shared/ci-contract.ts';
import { readCompilerFile } from '../helpers/compiler-fixtures.ts';

type WorkflowStep = {
  name: string;
  id?: string;
  if?: string;
  uses?: string;
  run?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
};

type Workflow = {
  on: { pull_request?: { types?: string[] }; workflow_dispatch?: unknown; workflow_call?: unknown };
  concurrency?: { group?: string };
  jobs: Record<string, { if?: string; steps: WorkflowStep[] }>;
};

function workflowStep(workflow: Workflow, jobId: string, name: string): WorkflowStep {
  const step = workflow.jobs[jobId]?.steps.find((candidate) => candidate.name === name);
  if (!step) throw new Error(`Missing workflow step: ${jobId}/${name}`);
  return step;
}

test('active GitHub validation workflows structurally enforce fresh exact heads and ordered gates', async () => {
  const prWorkflowSource = await readCompilerFile('.github/workflows/compiler-pr-validation.yml');
  const releaseWorkflowSource = await readCompilerFile('.github/workflows/compiler-release-validation.yml');
  const verificationSource = await readCompilerFile('scripts/ci-verification.ts');
  const prWorkflow = parseYaml(prWorkflowSource) as Workflow;
  const releaseWorkflow = parseYaml(releaseWorkflowSource) as Workflow;
  const contract = buildCiContract();

  expect(contract.verificationContractRevision).toBe(CI_VERIFICATION_CONTRACT_REVISION);
  expect(contract.verificationContractRevision).toBe('ci-verification-v3');
  expect(contract.executionModel).toBe(CI_VERIFICATION_EXECUTION_MODEL);
  expect(contract.triggerLabels).toEqual(['run-full', 'run-quick']);
  expect(contract.prTriggerTypes).toEqual([...CI_VERIFICATION_PR_TRIGGER_TYPES]);
  expect(contract.prSynchronizeRequiredLabel).toBe('run-full');
  expect(contract.prWorkflowStepOrder).toEqual([...CI_VERIFICATION_PR_STEP_ORDER]);
  expect(contract.releaseWorkflowStepOrder).toEqual([...CI_VERIFICATION_RELEASE_STEP_ORDER]);
  expect(contract.prWorkflowCommands.filter((command) => !prWorkflowSource.includes(command))).toEqual([]);
  expect(contract.releaseWorkflowCommands.filter((command) => !releaseWorkflowSource.includes(command))).toEqual([]);

  expect(prWorkflow.on.pull_request?.types).toEqual([...CI_VERIFICATION_PR_TRIGGER_TYPES]);
  const prJob = prWorkflow.jobs['compiler-pr-verification'];
  if (!prJob) throw new Error('Missing compiler-pr-verification job');
  expect(prJob.if).toContain("github.event.action == 'synchronize'");
  expect(prJob.if).toContain("contains(github.event.pull_request.labels.*.name, 'run-full')");
  expect(prWorkflow.concurrency?.group).toBe('${{ github.workflow }}-pr-${{ github.event.pull_request.number }}');
  expect(prJob.steps.map((step) => step.name)).toEqual([...CI_VERIFICATION_PR_STEP_ORDER]);

  const resolve = workflowStep(prWorkflow, 'compiler-pr-verification', CI_VERIFICATION_PR_STEP_ORDER[0]);
  expect(resolve.with?.script).toContain('getBranch');
  expect(resolve.with?.script).toContain('baseBranch.commit.sha');
  expect(resolve.with?.script).toContain('compareCommitsWithBasehead');
  expect(resolve.with?.script).toContain('comparison.behind_by !== 0');
  expect(resolve.with?.script).toContain("core.setOutput('head', headSha)");
  expect(resolve.with?.script).toContain("core.setOutput('base', baseSha)");
  expect(resolve.with?.script).toContain('ci-verification-v3/base-${baseSha}');

  const checkout = workflowStep(prWorkflow, 'compiler-pr-verification', 'Checkout exact PR head');
  expect(checkout.with?.ref).toBe('${{ steps.verification.outputs.head }}');
  const verify = workflowStep(prWorkflow, 'compiler-pr-verification', 'Run exact-head verification');
  expect(verify.run).toBe('bun scripts/ci-verification.ts --profile "$profile" --expected-head "$SEC_EXPECTED_HEAD_SHA"');
  expect(verify.env).toMatchObject({
    SEC_CHANGED_BASE: '${{ steps.verification.outputs.base }}',
    SEC_AFFECTED_TESTS_BASE: '${{ steps.verification.outputs.base }}',
    SEC_EXPECTED_HEAD_SHA: '${{ steps.verification.outputs.head }}'
  });
  expect(prWorkflowSource).not.toContain('continue-on-error: true');
  expect(prWorkflowSource).not.toContain('Fail failed verification');
  expect(prJob.steps.filter((step) => step.if?.includes('always()')).map((step) => step.name)).toEqual([
    'Upload compact verification evidence',
    'Record exact-head verification status'
  ]);

  expect(releaseWorkflow.on.workflow_dispatch).toBeDefined();
  expect(releaseWorkflow.on.workflow_call).toBeDefined();
  expect(releaseWorkflow.on.pull_request).toBeUndefined();
  const releaseJob = releaseWorkflow.jobs['compiler-release-verification'];
  if (!releaseJob) throw new Error('Missing compiler-release-verification job');
  expect(releaseJob.steps.map((step) => step.name)).toEqual([...CI_VERIFICATION_RELEASE_STEP_ORDER]);
  const releaseCheckout = workflowStep(releaseWorkflow, 'compiler-release-verification', 'Checkout exact release head');
  expect(releaseCheckout.with?.ref).toBe('${{ steps.verification.outputs.sha }}');
  const releaseVerify = workflowStep(releaseWorkflow, 'compiler-release-verification', 'Run exact-head full verification');
  expect(releaseVerify.env?.SEC_EXPECTED_HEAD_SHA).toBe('${{ steps.verification.outputs.sha }}');
  expect(releaseWorkflowSource).toContain('sec-verification/full/ci-verification-v3');
  expect(releaseWorkflowSource).not.toContain('continue-on-error: true');
  expect(releaseWorkflowSource).not.toContain('schedule:');
  expect(releaseJob.steps.filter((step) => step.if?.includes('always()')).map((step) => step.name)).toEqual([
    'Upload compact full verification evidence',
    'Record exact-head full verification status'
  ]);

  expect(buildCiQuickGatePlan({ includeImports: true, includeDocs: true, includeRisk: true }).map((step) => step.id)).toEqual([
    'imports',
    'docs-doctor',
    'typecheck',
    'affected-tests',
    'impact-risk'
  ]);
  expect(buildCiFullGatePlan().map((step) => step.id)).toEqual([
    'imports',
    'typecheck',
    'docs-doctor',
    'affected-tests',
    'full-fast',
    'test-budget',
    'contract-freeze',
    'all-slow-risk',
    'benchmark-task-suite',
    'deps-warmup',
    'resolve',
    'compose',
    'adapt',
    'verify-all',
    'lock',
    'explain',
    'reference-check'
  ]);
  expect(() => assertCiExpectedHead('head-a', undefined)).toThrow('requires an exact expected head SHA');
  expect(() => assertCiExpectedHead('head-a', 'head-b')).toThrow('expected head-b, actual head-a');
  expect(() => assertCiExpectedHead('head-a', 'head-a')).not.toThrow();
  expect(verificationSource).toContain('assertCiExpectedHead(headSha');
  expect(verificationSource.indexOf('assertCiExpectedHead(headSha')).toBeLessThan(verificationSource.indexOf('buildCiFullGatePlan()'));
  expect(verificationSource).toContain('baseSha');
  expect(verificationSource).toContain('coverageProfiles');
  expect(verificationSource).not.toContain('quickFastGate');

  await expect(readCompilerFile('.github/workflows/compiler-validation.yml')).rejects.toMatchObject({
    code: 'ENOENT'
  });
});
