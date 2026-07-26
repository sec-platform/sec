import { expect, test } from 'bun:test';
import { parse as parseYaml } from 'yaml';

import {
  assertCiExpectedHead,
  buildCiContract,
  buildCiFullGatePlan,
  buildCiQuickGatePlan,
  CI_VERIFICATION_CONTRACT_REVISION,
  CI_VERIFICATION_EXECUTION_MODEL,
  CI_VERIFICATION_PR_DISPATCH_TYPE,
  CI_VERIFICATION_PR_EVENT,
  CI_VERIFICATION_PR_STEP_ORDER,
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
  with?: Record<string, unknown>;
};

type Workflow = {
  on: {
    repository_dispatch?: { types?: string[] };
    pull_request?: unknown;
    workflow_dispatch?: unknown;
    workflow_call?: unknown;
  };
  permissions?: Record<string, string>;
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
  expect(contract.verificationContractRevision).toBe('ci-verification-v17');
  expect(contract.executionModel).toBe(CI_VERIFICATION_EXECUTION_MODEL);
  expect(contract.prWorkflowEvent).toBe(CI_VERIFICATION_PR_EVENT);
  expect(contract.prDispatchType).toBe(CI_VERIFICATION_PR_DISPATCH_TYPE);
  expect(contract.prWorkflowStepOrder).toEqual([...CI_VERIFICATION_PR_STEP_ORDER]);
  expect(contract.releaseWorkflowStepOrder).toEqual([...CI_VERIFICATION_RELEASE_STEP_ORDER]);
  expect(contract.prWorkflowCommands.filter((command) => !prWorkflowSource.includes(command))).toEqual([]);
  expect(contract.releaseWorkflowCommands.filter((command) => !releaseWorkflowSource.includes(command))).toEqual([]);

  expect(prWorkflow.on.repository_dispatch?.types).toEqual([CI_VERIFICATION_PR_DISPATCH_TYPE]);
  expect(prWorkflow.on.pull_request).toBeUndefined();
  expect(prWorkflow.permissions).toEqual({ contents: 'read', 'pull-requests': 'read' });
  const prJob = prWorkflow.jobs['compiler-pr-verification'];
  if (!prJob) throw new Error('Missing compiler-pr-verification job');
  expect(prJob.if).toBeUndefined();
  expect(prWorkflow.concurrency?.group).toBe('compiler-pr-verification-${{ github.event.client_payload.pull_request }}');
  expect(prJob.steps.map((step) => step.name)).toEqual([...CI_VERIFICATION_PR_STEP_ORDER]);

  const resolve = workflowStep(prWorkflow, 'compiler-pr-verification', CI_VERIFICATION_PR_STEP_ORDER[0]);
  expect(resolve.with?.script).toContain("payload.schema !== 'codex-development-frozen-verification-request-v1'");
  expect(resolve.with?.script).toContain("process.env.EVENT_TYPE !== 'sec-verify-frozen-v1'");
  expect(resolve.with?.script).toContain('getCollaboratorPermissionLevel');
  expect(resolve.with?.script).toContain('getBranch');
  expect(resolve.with?.script).toContain('headCommit.data.parents.length !== 1');
  expect(resolve.with?.script).toContain('headCommit.data.parents[0].sha !== currentBase');
  expect(resolve.with?.script).toContain('manual-bootstrap-required');
  expect(resolve.with?.script).toContain("core.setOutput('head', payload.expected_head)");
  expect(resolve.with?.script).toContain("core.setOutput('base', currentBase)");

  const checkout = workflowStep(prWorkflow, 'compiler-pr-verification', 'Checkout exact PR head');
  expect(checkout.with?.ref).toBe('${{ steps.verification.outputs.head }}');
  expect(checkout.with?.['persist-credentials']).toBe(false);
  const verify = workflowStep(prWorkflow, 'compiler-pr-verification', 'Run exact-head verification');
  expect(verify.run).toBe('bun scripts/ci-verification.ts --profile "$profile" --expected-head "$SEC_EXPECTED_HEAD_SHA"');
  expect(verify.env).toMatchObject({
    SEC_CHANGED_BASE: '${{ steps.verification.outputs.base }}',
    SEC_AFFECTED_TESTS_BASE: '${{ steps.verification.outputs.affected-base }}',
    SEC_EXPECTED_HEAD_SHA: '${{ steps.verification.outputs.head }}',
    SEC_WORK_PACKAGE_MANIFEST_PATH: '${{ steps.verification.outputs.manifest }}'
  });
  expect(prWorkflowSource).toContain('sec-verification-v17-${{ steps.verification.outputs.profile }}-pr-');
  expect(prWorkflowSource).not.toContain('sec-verification-v16-');
  expect(prWorkflowSource).not.toContain('sec-verification-v15-');
  expect(prWorkflowSource).not.toContain('sec-verification-v14-');
  expect(prWorkflowSource).not.toContain('sec-verification-v13-');
  expect(prWorkflowSource).not.toContain('sec-verification-v12-');
  expect(prWorkflowSource).not.toContain('sec-verification-v11-');
  expect(prWorkflowSource).not.toContain('sec-verification-v10-');
  expect(prWorkflowSource).not.toContain('sec-verification-v9-');
  expect(prWorkflowSource).not.toContain('sec-verification-v8-');
  expect(prWorkflowSource).not.toContain('sec-verification-v7-');
  expect(prWorkflowSource).not.toContain('sec-verification-v4-');
  expect(prWorkflowSource).not.toContain('continue-on-error: true');
  expect(prWorkflowSource).not.toContain('statuses: write');
  expect(prWorkflowSource).not.toContain('run-quick');
  expect(prWorkflowSource).not.toContain('run-full');
  expect(prJob.steps.filter((step) => step.if?.includes('always()')).map((step) => step.name)).toEqual([
    'Upload compact verification evidence'
  ]);

  expect(releaseWorkflow.on.workflow_dispatch).toBeDefined();
  expect(releaseWorkflow.on.workflow_call).toBeDefined();
  expect(releaseWorkflow.on.pull_request).toBeUndefined();
  expect(releaseWorkflow.permissions).toEqual({ contents: 'read' });
  const releaseJob = releaseWorkflow.jobs['compiler-release-verification'];
  if (!releaseJob) throw new Error('Missing compiler-release-verification job');
  expect(releaseJob.steps.map((step) => step.name)).toEqual([...CI_VERIFICATION_RELEASE_STEP_ORDER]);
  const releaseCheckout = workflowStep(releaseWorkflow, 'compiler-release-verification', 'Checkout exact release head');
  expect(releaseCheckout.with?.ref).toBe('${{ steps.verification.outputs.sha }}');
  expect(releaseCheckout.with?.['persist-credentials']).toBe(false);
  const releaseVerify = workflowStep(releaseWorkflow, 'compiler-release-verification', 'Run exact-head full verification');
  expect(releaseVerify.env?.SEC_EXPECTED_HEAD_SHA).toBe('${{ steps.verification.outputs.sha }}');
  expect(releaseWorkflowSource).toContain('sec-verification-v17-full-release-head-');
  expect(releaseWorkflowSource).not.toContain('sec-verification-v16-');
  expect(releaseWorkflowSource).not.toContain('sec-verification-v15-');
  expect(releaseWorkflowSource).not.toContain('sec-verification-v14-');
  expect(releaseWorkflowSource).not.toContain('sec-verification-v13-');
  expect(releaseWorkflowSource).not.toContain('sec-verification-v12-');
  expect(releaseWorkflowSource).not.toContain('sec-verification-v11-');
  expect(releaseWorkflowSource).not.toContain('sec-verification-v10-');
  expect(releaseWorkflowSource).not.toContain('sec-verification-v9-');
  expect(releaseWorkflowSource).not.toContain('sec-verification-v8-');
  expect(releaseWorkflowSource).not.toContain('sec-verification-v7-');
  expect(releaseWorkflowSource).not.toContain('sec-verification-v4-');
  expect(releaseWorkflowSource).toContain('manual-bootstrap-required');
  expect(releaseWorkflowSource).not.toContain('continue-on-error: true');
  expect(releaseWorkflowSource).not.toContain('schedule:');
  expect(releaseWorkflowSource).not.toContain('statuses: write');
  expect(releaseJob.steps.filter((step) => step.if?.includes('always()')).map((step) => step.name)).toEqual([
    'Upload compact full verification evidence'
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
  expect(verificationSource.indexOf('assertCiExpectedHead(headSha')).toBeLessThan(
    verificationSource.indexOf('CodexDevelopmentBuildVerificationPlanV1(profile')
  );
  expect(verificationSource).toContain('affectedBaseSha');
  expect(verificationSource).toContain('CodexDevelopmentFinalizeVerificationEvidenceV2');
  expect(verificationSource).not.toContain('process.exit(');

  await expect(readCompilerFile('.github/workflows/compiler-validation.yml')).rejects.toMatchObject({
    code: 'ENOENT'
  });
});

test('root typecheck uses one TypeScript-owned derived incremental cache', async () => {
  const tsconfig = JSON.parse(await readCompilerFile('tsconfig.json')) as {
    compilerOptions?: Record<string, unknown>;
  };
  const gitignore = await readCompilerFile('.gitignore');
  const runner = await readCompilerFile('platform/dev-runner/typecheck-runner.ts');

  expect(tsconfig.compilerOptions).toMatchObject({
    incremental: true,
    noEmit: true,
    strict: true,
    tsBuildInfoFile: '.tmp/typecheck/tsconfig.tsbuildinfo'
  });
  expect(gitignore.replaceAll('\r\n', '\n').split('\n')).toContain('.tmp/');
  expect(runner).toContain("['--noEmit', '-p', 'tsconfig.json', ...args]");
  expect(runner).not.toContain('tsbuildinfo');
  expect(runner).not.toContain('tsBuildInfoFile');
});
