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
  CI_VERIFICATION_RELEASE_STEP_ORDER,
  CodexDevelopmentBuildVerificationPlanV1
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
  jobs: Record<string, {
    if?: string;
    needs?: string | string[];
    outputs?: Record<string, string>;
    steps: WorkflowStep[];
  }>;
};

function workflowStep(workflow: Workflow, jobId: string, name: string): WorkflowStep {
  const step = workflow.jobs[jobId]?.steps.find((candidate) => candidate.name === name);
  if (!step) throw new Error(`Missing workflow step: ${jobId}/${name}`);
  return step;
}

test('active GitHub validation workflows structurally enforce fresh exact heads and ordered gates', async () => {
  const prWorkflowSource = await readCompilerFile('.github/workflows/compiler-pr-validation.yml');
  const releaseWorkflowSource = await readCompilerFile('.github/workflows/compiler-release-validation.yml');
  const bootstrapWorkflowSource = await readCompilerFile('.github/workflows/sec-trusted-bootstrap.yml');
  const verificationSource = await readCompilerFile('scripts/ci-verification.ts');
  const prWorkflow = parseYaml(prWorkflowSource) as Workflow;
  const releaseWorkflow = parseYaml(releaseWorkflowSource) as Workflow;
  const bootstrapWorkflow = parseYaml(bootstrapWorkflowSource) as Workflow;
  const contract = buildCiContract();

  expect(contract.verificationContractRevision).toBe(CI_VERIFICATION_CONTRACT_REVISION);
  expect(contract.verificationContractRevision).toBe('ci-verification-v19');
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
  expect(prWorkflowSource).toContain('sec-verification-v19-${{ steps.verification.outputs.profile }}-pr-');
  expect(prWorkflowSource).not.toContain('sec-verification-v18-');
  expect(prWorkflowSource).not.toContain('sec-verification-v17-');
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

  expect(bootstrapWorkflow.on.repository_dispatch?.types).toEqual(['sec-trusted-bootstrap-v1']);
  expect(bootstrapWorkflow.on.pull_request).toBeUndefined();
  expect(bootstrapWorkflow.permissions).toEqual({ contents: 'read', 'pull-requests': 'read' });
  const bootstrapResolve = bootstrapWorkflow.jobs.resolve;
  const bootstrapPre = bootstrapWorkflow.jobs['checker-pre'];
  const bootstrapSut = bootstrapWorkflow.jobs['candidate-sut'];
  const bootstrapPost = bootstrapWorkflow.jobs['checker-post'];
  if (!bootstrapResolve || !bootstrapPre || !bootstrapSut || !bootstrapPost) {
    throw new Error('Missing trusted bootstrap DAG job');
  }
  expect(bootstrapWorkflowSource).toContain("payload.schema !== 'sec-trusted-bootstrap-request-v1'");
  expect(bootstrapWorkflowSource).toContain("const registryPath = 'platform/shared/ci-trust-root-registry.json';");
  expect(bootstrapWorkflowSource).toContain(
    'Trusted bootstrap is only valid when the exact candidate changes the trusted-base verifier boundary.'
  );
  expect(bootstrapWorkflowSource).toContain('persist-credentials: false');
  expect(bootstrapWorkflowSource).toContain('bun install --frozen-lockfile --ignore-scripts');
  expect(bootstrapWorkflowSource).toContain('ACTIONS_RUNTIME_TOKEN');
  expect(bootstrapWorkflowSource).toContain('GITHUB_ENV GITHUB_OUTPUT GITHUB_PATH GITHUB_STEP_SUMMARY');
  expect(bootstrapWorkflowSource).toContain('git diff --check');
  expect(bootstrapWorkflowSource).not.toContain('GIT_ALTERNATE_OBJECT_DIRECTORIES');
  expect(bootstrapWorkflowSource).not.toContain('x-access-token');
  const bootstrapRegression = workflowStep(
    bootstrapWorkflow,
    'candidate-sut',
    'Run isolated candidate SUT regression'
  );
  expect(bootstrapRegression.env).toMatchObject({
    SEC_REPOSITORY_AUDIT_DEFAULT_REF: '${{ needs.resolve.outputs.base }}'
  });
  expect(bootstrapRegression.run).toContain('git update-ref refs/remotes/origin/main "$SEC_BOOTSTRAP_BASE"');
  expect(bootstrapRegression.run).toContain('auxiliaryStatus: required("SEC_SUT_STATUS")');
  expect(bootstrapRegression.run).not.toContain('status: required("SEC_SUT_STATUS")');
  expect(bootstrapWorkflowSource).not.toContain('generateTcbClosureLockForRevision');
  expect(workflowStep(bootstrapWorkflow, 'checker-pre', 'Produce trusted-base PRE candidate-root receipt').run)
    .toContain('SEC_BOOTSTRAP_PHASE=pre');
  expect(workflowStep(bootstrapWorkflow, 'checker-post', 'Recompute POST and reduce exact bootstrap evidence').run)
    .toContain('SEC_BOOTSTRAP_PHASE=post');
  expect(bootstrapWorkflowSource).toContain('tests/unit/tcb-trust-root-contract.test.ts');
  expect(bootstrapWorkflowSource).toContain('tests/contract/tcb-closure-lock.test.ts');
  expect(bootstrapWorkflowSource).toContain('tests/contract/default-branch-revision-health.test.ts');
  expect(bootstrapWorkflowSource).toContain('bun scripts/codex/repository-audit.ts --json');
  expect(bootstrapWorkflowSource).toContain('bun run test:affected');
  expect(bootstrapWorkflowSource).not.toContain('statuses: write');
  expect(bootstrapWorkflowSource).not.toContain('contents: write');

  expect(releaseWorkflow.on.workflow_dispatch).toBeDefined();
  expect(releaseWorkflow.on.workflow_call).toBeDefined();
  expect(releaseWorkflow.on.pull_request).toBeUndefined();
  expect(releaseWorkflowSource).toContain('WORKFLOW_HEAD: ${{ github.sha }}');
  expect(releaseWorkflowSource).toContain('Release verifier workflow must execute from the current trusted default branch.');
  expect(releaseWorkflow.permissions).toEqual({ contents: 'read' });
  const releaseJob = releaseWorkflow.jobs['compiler-release-verification'];
  if (!releaseJob) throw new Error('Missing compiler-release-verification job');
  expect(releaseJob.steps.map((step) => step.name)).toEqual([...CI_VERIFICATION_RELEASE_STEP_ORDER]);
  const releaseCheckout = workflowStep(releaseWorkflow, 'compiler-release-verification', 'Checkout exact release head');
  expect(releaseCheckout.with?.ref).toBe('${{ steps.verification.outputs.sha }}');
  expect(releaseCheckout.with?.['persist-credentials']).toBe(false);
  const releaseVerify = workflowStep(releaseWorkflow, 'compiler-release-verification', 'Run exact-head full verification');
  expect(releaseVerify.env?.SEC_EXPECTED_HEAD_SHA).toBe('${{ steps.verification.outputs.sha }}');
  expect(releaseWorkflowSource).toContain('sec-verification-v19-full-release-head-');
  expect(releaseWorkflowSource).not.toContain('sec-verification-v18-');
  expect(releaseWorkflowSource).not.toContain('sec-verification-v17-');
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
  // Full gate conditionally includes docs-doctor based on documentation lifecycle changes.
  expect(buildCiFullGatePlan({ hasDocumentationLifecycleChange: false }).map((step) => step.id)).not.toContain('docs-doctor');
  expect(buildCiFullGatePlan({ hasDocumentationLifecycleChange: true }).map((step) => step.id)).toContain('docs-doctor');
  // Build plan with empty changedFiles and no documentation-lifecycle owners omits docs-doctor in full profile.
  const fullPlanNoDocChange = CodexDevelopmentBuildVerificationPlanV1('full', [], undefined);
  expect(fullPlanNoDocChange.gates.map((step) => step.id)).not.toContain('docs-doctor');
  // Build plan with null changedFiles (unknown changes) includes docs-doctor as conservative default.
  const fullPlanUnknownChanges = CodexDevelopmentBuildVerificationPlanV1('full', null, undefined);
  expect(fullPlanUnknownChanges.gates.map((step) => step.id)).toContain('docs-doctor');
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

test('trusted base candidate root bootstrap checker is disjoint and candidate remains data', async () => {
  const source = await readCompilerFile('.github/workflows/sec-trusted-bootstrap.yml');
  const verificationSource = await readCompilerFile('scripts/ci-verification.ts');
  const workflow = parseYaml(source) as Workflow;
  expect(workflow.jobs.resolve?.outputs).toMatchObject({
    base: '${{ steps.resolve.outputs.base }}',
    'base-tree': '${{ steps.resolve.outputs.base-tree }}',
    head: '${{ steps.resolve.outputs.head }}',
    tree: '${{ steps.resolve.outputs.tree }}',
    manifest: '${{ steps.resolve.outputs.manifest }}',
    'registry-digest': '${{ steps.resolve.outputs.registry-digest }}',
    'bun-version': '${{ steps.resolve.outputs.bun-version }}'
  });
  expect(workflow.jobs['checker-pre']?.needs).toBe('resolve');
  expect(workflow.jobs['candidate-sut']?.needs).toEqual(['resolve', 'checker-pre']);
  expect(workflow.jobs['checker-post']?.needs).toEqual(['resolve', 'checker-pre', 'candidate-sut']);
  expect(workflow.jobs['checker-post']?.if).toBe("${{ always() && needs.resolve.result == 'success' }}");
  expect(workflow.jobs['checker-post']?.if).not.toContain('needs.checker-pre.result');
  const preTrustedCheckout = workflowStep(workflow, 'checker-pre', 'Checkout exact trusted base checker');
  const preCandidateCheckout = workflowStep(workflow, 'checker-pre', 'Checkout exact candidate as data');
  expect(preTrustedCheckout.with).toMatchObject({
    ref: '${{ needs.resolve.outputs.base }}',
    path: 'trusted-base',
    'fetch-depth': 1,
    'persist-credentials': false
  });
  expect(preCandidateCheckout.with).toMatchObject({
    ref: '${{ needs.resolve.outputs.head }}',
    path: 'candidate-data',
    'fetch-depth': 2,
    'persist-credentials': false
  });
  const pre = workflowStep(workflow, 'checker-pre', 'Produce trusted-base PRE candidate-root receipt');
  expect(pre.env).toMatchObject({
    SEC_BOOTSTRAP_BASE: '${{ needs.resolve.outputs.base }}',
    SEC_BOOTSTRAP_BASE_TREE: '${{ needs.resolve.outputs.base-tree }}'
  });
  expect(pre.run).toContain('importFromTrustedBase("platform/shared/tcb-closure-lock.ts")');
  expect(pre.run).toContain('importFromTrustedBase("platform/shared/tcb-trust-root-contract.ts")');
  expect(pre.run).toContain('parseTcbClosureLockSourceV1');
  expect(pre.run).toContain('assertTcbClosureLockDataMatchesV1');
  expect(pre.run).toContain('createTcbClosureCandidateSnapshotV1');
  expect(pre.run).toContain('finalizeTcbClosureCandidateSnapshotV1(baseSnapshot)');
  expect(pre.run).toContain('finalizeTcbClosureCandidateSnapshotV1(candidateSnapshot)');
  expect(pre.run).toContain('const expectedTrustRevision = expectedBase');
  expect(pre.run).toContain('parsedCandidateLock.trustRevision !== expectedTrustRevision');
  expect(pre.run).toContain('hardFailureReasons.add("candidate-lock-trust-revision-is-not-exact-base-epoch")');
  expect(pre.run).toMatch(/candidateClosure,\s+expectedTrustRevision,\s+candidateSnapshotOptions/u);
  expect(pre.run).not.toMatch(/candidateClosure,\s+parsedCandidateLock\.trustRevision,/u);
  expect(pre.run).toContain('["rev-list", "--parents", "-n", "1", "HEAD"]');
  expect(pre.run).toContain('GIT_NO_REPLACE_OBJECTS = "1"');
  expect(pre.run).not.toContain('HEAD^1');
  expect(pre.run).toContain('candidate-registry-differs-from-trusted-base-policy');
  expect(pre.run).toContain('candidate-lock-schema-or-checker-change');
  expect(pre.run).toContain('candidate-causal-closure-differs-from-trusted-base-registry');
  expect(pre.run).toContain('SEC_BOOTSTRAP_PHASE=pre');
  const sutSteps = workflow.jobs['candidate-sut']?.steps ?? [];
  expect(sutSteps.some((step) => step.name === 'Checkout exact trusted base checker')).toBe(false);
  expect(sutSteps.some((step) => step.uses?.includes('download-artifact'))).toBe(false);
  expect(JSON.stringify(sutSteps)).not.toContain('bootstrap-pre');
  expect(JSON.stringify(sutSteps)).not.toContain('checker.mjs');
  expect(workflowStep(workflow, 'candidate-sut', 'Checkout exact candidate SUT only').with)
    .toMatchObject({ path: 'candidate-sut', 'persist-credentials': false });
  const postSteps = workflow.jobs['checker-post']?.steps ?? [];
  expect(postSteps[0]?.name).toBe('Initialize fail-closed final evidence envelope');
  const initialize = workflowStep(workflow, 'checker-post', 'Initialize fail-closed final evidence envelope');
  expect(initialize.env).toMatchObject({
    FINAL_EVIDENCE_ROOT: '${{ github.workspace }}/bootstrap-final',
    SEC_BOOTSTRAP_BASE: '${{ needs.resolve.outputs.base }}',
    SEC_BOOTSTRAP_BASE_TREE: '${{ needs.resolve.outputs.base-tree }}',
    SEC_BOOTSTRAP_HEAD: '${{ needs.resolve.outputs.head }}',
    SEC_BOOTSTRAP_TREE: '${{ needs.resolve.outputs.tree }}',
    SEC_BOOTSTRAP_RUN_ID: '${{ github.run_id }}',
    SEC_BOOTSTRAP_RUN_ATTEMPT: '${{ github.run_attempt }}'
  });
  const initializeRun = initialize.run;
  if (typeof initializeRun !== 'string') {
    throw new Error('trusted bootstrap final evidence initializer must be one shell program.');
  }
  for (const binding of [
    'sec-trusted-bootstrap-final-evidence-v1',
    'baseSha',
    'baseTreeSha',
    'headSha',
    'treeSha',
    'runId',
    'runAttempt',
    'status: "incomplete"',
    'reason: "checker-post-not-complete"',
    'receiptDigest',
    '^[1-9][0-9]{0,19}$',
    'final-envelope.json',
    'sha256sum final-envelope.json > SHA256SUMS.tmp',
    'mv SHA256SUMS.tmp SHA256SUMS'
  ]) expect(initializeRun).toContain(binding);
  expect(initializeRun).toContain('renameSync(temporary, path.join(root, "final-envelope.json"))');
  expect(initializeRun.indexOf('renameSync(temporary, path.join(root, "final-envelope.json"))'))
    .toBeLessThan(initializeRun.indexOf('sha256sum final-envelope.json > SHA256SUMS.tmp'));
  expect(postSteps.findIndex((step) => step.uses?.includes('checkout'))).toBeGreaterThan(0);
  expect(postSteps.findIndex((step) => step.uses?.includes('setup-bun'))).toBeGreaterThan(0);
  expect(postSteps.findIndex((step) => step.uses?.includes('download-artifact'))).toBeGreaterThan(0);
  expect(postSteps.some((step) => step.name === 'Install candidate SUT dependencies without lifecycle scripts'))
    .toBe(false);
  const post = workflowStep(workflow, 'checker-post', 'Recompute POST and reduce exact bootstrap evidence');
  expect(post.env).toMatchObject({
    SEC_BOOTSTRAP_BASE_TREE: '${{ needs.resolve.outputs.base-tree }}',
    SEC_BOOTSTRAP_RUN_ID: '${{ github.run_id }}',
    SEC_BOOTSTRAP_RUN_ATTEMPT: '${{ github.run_attempt }}'
  });
  const postRun = post.run;
  if (typeof postRun !== 'string') {
    throw new Error('trusted bootstrap POST reducer must be one shell program.');
  }
  expect(postRun).toContain('SEC_BOOTSTRAP_PHASE=post');
  expect(postRun).toContain('sha256sum -c SHA256SUMS');
  expect(postRun).toContain("printf 'baseTree=%s\\n' '${{ needs.resolve.outputs.base-tree }}'");
  expect(postRun).toContain('postReceipt.authorityVerdict === "manual-bootstrap-required"');
  expect(postRun).toContain('postReceipt.authorityVerdict === "failed"');
  expect(postRun).toContain('postReceipt.auxiliaryStatus === "passed"');
  expect(postRun).toContain('status = "incomplete"');
  expect(postRun).toContain('test "$(node -p');
  expect(postRun).toContain('renameSync(temporary, envelopePath)');
  expect(postRun).toContain(
    'sha256sum environment.txt final-envelope.json post-receipt.json pre-receipt.json sut-diagnostic.json > SHA256SUMS.tmp'
  );
  expect(postRun.indexOf('renameSync(temporary, envelopePath)'))
    .toBeLessThan(postRun.indexOf('sha256sum environment.txt final-envelope.json'));
  expect(postRun).toContain('mv SHA256SUMS.tmp SHA256SUMS');
  const finalUpload = workflowStep(workflow, 'checker-post', 'Upload final canonical trusted bootstrap evidence');
  expect(finalUpload.if).toBe('always()');
  expect(finalUpload.with?.['if-no-files-found']).toBe('error');
  const finalUploadPath = finalUpload.with?.path;
  if (typeof finalUploadPath !== 'string') {
    throw new Error('trusted bootstrap final artifact path must be one string.');
  }
  expect(finalUploadPath.split('\n')).toEqual([
    'bootstrap-final/final-envelope.json',
    'bootstrap-final/SHA256SUMS',
    'bootstrap-final/environment.txt',
    'bootstrap-final/post-receipt.json',
    'bootstrap-final/pre-receipt.json',
    'bootstrap-final/sut-diagnostic.json',
    ''
  ]);
  expect(finalUpload.with?.path).not.toBe('bootstrap-final');
  expect(pre.run).toContain('trusted bootstrap PRE and POST candidate closure receipts differ');
  for (const binding of [
    'checkerBaseSha',
    'baseTreeSha',
    'candidateHeadSha',
    'candidateTreeSha',
    'candidateParentSha',
    'checkerClosureDigest',
    'candidateClosureDigest',
    'checkerToolBlob',
    'checkerWorkflowBlob',
    'candidateToolBlob',
    'candidateWorkflowBlob',
    'candidateTrustRevision',
    'checkerProgramDigest',
    'authorityVerdict',
    'authorityReason',
    'baseUndecidablePaths',
    'auxiliaryStatus',
    'sutEvidenceDigest',
    'sutJobResult',
    'sutDiagnosticDigest',
    'receiptDigest'
  ]) expect(pre.run).toContain(binding);
  expect(pre.run).toContain('trusted-base-cannot-decide-checker-policy-or-validation-plan-change');
  expect(pre.run).toContain('auxiliaryStatus = "invalid"');
  expect(source).not.toContain('x-access-token');
  expect(source).not.toContain('Generate candidate TCB closure snapshot');
  expect(source).not.toContain("import('./platform/shared/tcb-closure-lock.ts')");
  expect(source).not.toContain('generateTcbClosureLockForRevision');
  expect(verificationSource).not.toContain("from '../platform/shared/tcb-closure-lock.ts'");
  expect(verificationSource).not.toContain('import("../platform/shared/tcb-closure-lock.ts")');
});
