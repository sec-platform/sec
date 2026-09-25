import { expect, test } from 'bun:test';
import { parse as parseYaml } from 'yaml';

import { CI_MAIN_HEALTH_POLICY, CI_MAIN_HEALTH_POLICY_DIGEST, createCiMainHealthRequestOperationId } from '../../src/adapters/self-hosting/control/main-health/provider-policy.ts';
import { buildCiContract, CI_MAIN_HEALTH_COMMANDS, CI_MAIN_HEALTH_JOB_NAME, CI_MAIN_HEALTH_STEP_ORDER } from '../../src/adapters/verification/platform/ci/contract/core.ts';
import { assertCiExpectedHead, buildCiFullGatePlan, buildCiQuickGatePlan, BuildVerificationPlan } from '../../src/adapters/verification/platform/ci/contract/plan.ts';
import { TrustedBootstrapSutHarness } from '../../src/adapters/verification/platform/ci/verification.ts';
import { slowTestSuiteIds } from '../../src/adapters/verification/platform/test-impact/contract/budget.ts';
import { TCB_TRUST_ROOT } from '../../src/adapters/verification/platform/trust/compiler.ts';
import {
  createTrustedBootstrapTrustRoot,
  matchTrustedBootstrapPath,
  parseTrustedBootstrapRegistry,
  TCB_CLOSURE_RUNTIME_PATH,
  TRUSTED_BOOTSTRAP_REGISTRY_PATH
} from '../../src/adapters/verification/platform/trust/contract/root.ts';
import {
  compileTcbClosureActionResult,
  createTcbClosureActionPlan,
  createTcbClosureCandidateSnapshot,
  finalizeTcbClosureCandidateSnapshot,
  readTcbClosureCandidateFile,
  selectTcbClosureCandidateAction
} from '../../src/adapters/verification/platform/trust/runtime/closure-lock.ts';
import { readCompilerFile } from '../helpers/compiler-fixtures.ts';

type WorkflowStep = Readonly<{
  name: string;
  id?: string;
  if?: string;
  uses?: string;
  run?: string;
  'working-directory'?: string;
  env?: Readonly<Record<string, string | number>>;
  with?: Readonly<Record<string, unknown>>;
}>;

type Workflow = Readonly<{
  on: Readonly<{
    push?: Readonly<{ branches?: readonly string[] }>;
    repository_dispatch?: Readonly<{ types?: readonly string[] }>;
    workflow_run?: Readonly<{ workflows?: readonly string[]; types?: readonly string[] }>;
  }>;
  env?: Readonly<Record<string, string | number>>;
  permissions?: Readonly<Record<string, string>>;
  concurrency?: Readonly<{ group?: string; 'cancel-in-progress'?: boolean; queue?: string }>;
  jobs: Readonly<Record<string, Readonly<{
    name?: string;
    if?: string;
    'runs-on'?: string | readonly string[];
    'timeout-minutes'?: number;
    needs?: string | readonly string[];
    outputs?: Readonly<Record<string, string>>;
    env?: Readonly<Record<string, string | number>>;
    permissions?: Readonly<Record<string, string>>;
    concurrency?: Readonly<{ group?: string; 'cancel-in-progress'?: boolean; queue?: string }>;
    steps: readonly WorkflowStep[];
  }>>>;
}>;

function step(workflow: Workflow, job: string, name: string): WorkflowStep {
  const found = workflow.jobs[job]?.steps.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`Missing workflow step ${job}/${name}.`);
  return found;
}

function embeddedTrustedBootstrapChecker(source: string): string {
  const normalizedSource = source.replaceAll('\r\n', '\n');
  const startDelimiter = `cat > "$out/checker.mjs" <<'CHECKER'\n`;
  const start = normalizedSource.indexOf(startDelimiter);
  if (start < 0) throw new Error('trusted bootstrap workflow checker start delimiter is missing.');
  const checkerStart = start + startDelimiter.length;
  const endDelimiter = '\n          CHECKER\n';
  const end = normalizedSource.indexOf(endDelimiter, checkerStart);
  if (end < 0) throw new Error('trusted bootstrap workflow checker end delimiter is missing.');
  return normalizedSource.slice(checkerStart, end).split('\n')
    .map((line) => line.startsWith('              ') ? line.slice(14) : line)
    .join('\n');
}

test('Quick and Full plan topology remains deterministic behind the Action normalizer', () => {
  const quickGates = buildCiQuickGatePlan({
    includeImports: true,
    includeDocs: true,
    selectedSlowSuites: ['e2e-artifacts']
  });
  expect(quickGates.map(({ id }) => id)).toEqual([
    'imports', 'docs-doctor', 'typecheck', 'affected-tests', 'slow-suite-e2e-artifacts'
  ]);
  expect(quickGates.find(({ id }) => id === 'typecheck')?.args).toEqual(['run', 'typecheck:verified']);
  const fullGates = buildCiFullGatePlan();
  const fullGateIds = fullGates.map(({ id }) => id);
  expect(fullGates.find(({ id }) => id === 'typecheck')?.args).toEqual(['run', 'typecheck:verified']);
  expect(fullGateIds).toEqual(expect.arrayContaining([
    'imports', 'typecheck', 'docs-doctor', 'full-fast', 'test-budget',
    'deps-warmup', 'resolve', 'compose',
    'verify-all', 'lock', 'explain', 'reference-check'
  ]));
  expect(fullGateIds.filter((id) => id.startsWith('slow-suite-')).sort()).toEqual(
    slowTestSuiteIds().map((suite) => `slow-suite-${suite}`).sort()
  );
  expect(BuildVerificationPlan('full', [], null).gates.map(({ id }) => id))
    .toContain('docs-doctor');
  expect(BuildVerificationPlan('full', null, null).gates.map(({ id }) => id))
    .toContain('docs-doctor');
  expect(() => BuildVerificationPlan('quick', [], null))
    .toThrow('owner-issued test-impact source provider');
  expect(() => assertCiExpectedHead('head-a', undefined)).toThrow('requires an exact expected head SHA');
  expect(() => assertCiExpectedHead('head-a', 'head-b')).toThrow('expected head-b, actual head-a');
  expect(() => assertCiExpectedHead('head-a', 'head-a')).not.toThrow();
});

test('trusted bootstrap SUT retains the verified typecheck owner', async () => {
  const packageScripts = (JSON.parse(await readCompilerFile('package.json')) as {
    scripts: Record<string, string>;
  }).scripts;
  expect(packageScripts.typecheck).toContain('native-typecheck.ts');
  expect(packageScripts['typecheck:verified']).toContain('runner/cli.ts typecheck');
  expect(TrustedBootstrapSutHarness).toContain(
    '  await execute("typecheck", ["bun", "run", "typecheck:verified"]);'
  );
  expect(TrustedBootstrapSutHarness).not.toContain(
    '  await execute("typecheck", ["bun", "run", "typecheck"]);'
  );
});

test('exact-main health policy binds one stable GitHub Actions app and terminal context', async () => {
  expect(Object.isFrozen(CI_MAIN_HEALTH_POLICY)).toBe(true);
  expect(createCiMainHealthRequestOperationId('93dde9e44bbcffdd7fa1d6be726df1725947f6e2'))
    .toBe('sha256:1062f573e4a315b308f46c6abd9a82815fdaa97a3b2171f0cb8b806467473a78');
  expect(CI_MAIN_HEALTH_POLICY_DIGEST).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(CI_MAIN_HEALTH_JOB_NAME).toBe('sec/main-health');
  const contract = buildCiContract();
  expect(contract.mainHealthContext).toBe(CI_MAIN_HEALTH_JOB_NAME);
  expect(contract.mainHealthPolicyDigest).toBe(CI_MAIN_HEALTH_POLICY_DIGEST);
  expect(contract.mainHealthStepOrder).toEqual([...CI_MAIN_HEALTH_STEP_ORDER]);
  expect(contract.mainHealthCommands).toEqual([...CI_MAIN_HEALTH_COMMANDS]);
  expect(contract.mainHealthCommands).toContain('bun run typecheck:verified');
  expect(contract.mainHealthCommands).not.toContain('bun run typecheck');
  const workflow = parseYaml(await readCompilerFile('.github/workflows/compiler-pr-validation.yml')) as Workflow;
  const job = Object.values(workflow.jobs).find(({ name }) => name === CI_MAIN_HEALTH_JOB_NAME);
  if (!job) throw new Error(`MainHealth workflow job is missing: ${CI_MAIN_HEALTH_JOB_NAME}`);
  expect(job.name).toBe(CI_MAIN_HEALTH_JOB_NAME);
  expect(job.if).toBe("${{ github.event_name == 'repository_dispatch' && github.event.action == 'sec-produce-main-health-v1' }}");
  expect(job.concurrency).toEqual({
    group: 'sec-main-health-${{ github.event.client_payload.payload.mainSha }}',
    'cancel-in-progress': false,
    queue: 'max'
  });
  expect(job.steps.map((step) => step.name)).toEqual([...CI_MAIN_HEALTH_STEP_ORDER]);
  expect(job.steps.filter((step) => step.run).map((step) => step.run)).toEqual([...CI_MAIN_HEALTH_COMMANDS]);
  expect(job.steps.find((step) => step.id === 'typecheck')?.run).toBe('bun run typecheck:verified');
  expect((workflow.on as Record<string, unknown>).push).toBeUndefined();
  expect(job.steps[0]?.if).toBe("${{ github.event_name == 'repository_dispatch' }}");
  expect(job.steps[1]?.with).toMatchObject({
    ref: '${{ github.event.client_payload.payload.mainSha }}',
    'persist-credentials': false
  });
  expect(job.steps[2]?.with).toMatchObject({ 'bun-version-file': '.bun-version' });
  expect(job.steps[3]?.uses).toBe('actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9');
});


test('trusted base candidate root bootstrap checker is disjoint and candidate remains data', async () => {
  const source = await readCompilerFile('.github/workflows/trusted-bootstrap.yml');
  const workflow = parseYaml(source) as Workflow;
  const checkerSource = embeddedTrustedBootstrapChecker(source);
  expect(() => new Bun.Transpiler({ loader: 'js', target: 'bun' }).transformSync(checkerSource))
    .not.toThrow();
  expect([
    createTcbClosureCandidateSnapshot,
    readTcbClosureCandidateFile,
    createTcbClosureActionPlan,
    selectTcbClosureCandidateAction,
    compileTcbClosureActionResult,
    finalizeTcbClosureCandidateSnapshot,
    parseTrustedBootstrapRegistry,
    createTrustedBootstrapTrustRoot
  ].every((contract) => typeof contract === 'function')).toBe(true);
  expect(TRUSTED_BOOTSTRAP_REGISTRY_PATH)
    .toBe('src/adapters/verification/platform/trust/contract/ci-trust-root-registry.json');
  expect(checkerSource).not.toMatch(/TcbClosure[A-Za-z]+V1|TrustedBootstrap[A-Za-z]+V3|terminal\.resultDigest/u);
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
  const preTrustedCheckout = step(workflow, 'checker-pre', 'Checkout exact trusted base checker');
  const preCandidateCheckout = step(workflow, 'checker-pre', 'Checkout exact candidate as data');
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
  const preSteps = workflow.jobs['checker-pre']?.steps ?? [];
  expect(preSteps.map((step) => step.name)).toEqual([
    'Setup trusted-base Bun runtime',
    'Checkout exact trusted base checker',
    'Checkout exact candidate as data',
    'Preflight exact trusted-base checkout',
    'Install trusted-base checker dependencies without lifecycle scripts',
    'Produce trusted-base PRE candidate-root receipt',
    'Upload bounded checker PRE artifact'
  ]);
  const preflight = step(workflow, 'checker-pre', 'Preflight exact trusted-base checkout');
  expect(preflight.env).toEqual({
    TRUSTED_BASE_ROOT: '${{ github.workspace }}/trusted-base',
    SEC_BOOTSTRAP_BASE: '${{ needs.resolve.outputs.base }}',
    SEC_BOOTSTRAP_BASE_TREE: '${{ needs.resolve.outputs.base-tree }}'
  });
  const pre = step(workflow, 'checker-pre', 'Produce trusted-base PRE candidate-root receipt');
  expect(pre.env).toMatchObject({
    BOOTSTRAP_EVIDENCE_ROOT: '${{ runner.temp }}/sec-trusted-bootstrap-pre-${{ github.run_id }}-${{ github.run_attempt }}',
    SEC_BOOTSTRAP_BASE: '${{ needs.resolve.outputs.base }}',
    SEC_BOOTSTRAP_BASE_TREE: '${{ needs.resolve.outputs.base-tree }}'
  });
  const r2ChangedPaths = [
    '.github/workflows/trusted-bootstrap.yml',
    'config/repository/work-packages/trusted-bootstrap-base-first-repair-v1.md',
    'config/repository/work-packages/verification-action-kernel-finalization-v1.md',
    'config/repository/active-work-package.md',
    'config/repository/rolling-plan.md',
    TCB_CLOSURE_RUNTIME_PATH,
    'tests/contract/ci-contract.test.ts',
    'tests/unit/active-documentation-contract.test.ts',
    'tests/contract/tcb-closure-lock.test.ts'
  ];
  expect(r2ChangedPaths
    .filter((repositoryPath) =>
      matchTrustedBootstrapPath(repositoryPath, TCB_TRUST_ROOT) !== null
    )
    .sort()).toEqual([
    '.github/workflows/trusted-bootstrap.yml',
    TCB_CLOSURE_RUNTIME_PATH
  ]);
  const sutSteps = workflow.jobs['candidate-sut']?.steps ?? [];
  expect(sutSteps.some((step) => step.name === 'Checkout exact trusted base checker')).toBe(false);
  expect(sutSteps.some((step) => step.uses?.includes('download-artifact'))).toBe(false);
  expect(step(workflow, 'candidate-sut', 'Checkout exact trusted base sandbox owner').with)
    .toMatchObject({
      ref: '${{ needs.resolve.outputs.base }}',
      'fetch-depth': 0,
      'persist-credentials': false
    });
  expect(step(workflow, 'candidate-sut', 'Checkout exact candidate SUT only').with)
    .toMatchObject({ path: 'candidate-sut', 'persist-credentials': false });
  expect(step(workflow, 'candidate-sut', 'Restore exact-base dependency download cache').with)
    .toMatchObject({
      path: '/tmp/sec-hosted-dependency-home/.bun/install/cache',
      key: "${{ runner.os }}-trusted-bootstrap-bun-${{ hashFiles('bun.lock') }}"
    });
  expect(step(workflow, 'candidate-sut', 'Run candidate SUT through trusted private sandbox').env)
    .toMatchObject({
      SUT_EVIDENCE_ROOT: '${{ runner.temp }}/sec-trusted-bootstrap-sut-${{ github.run_id }}-${{ github.run_attempt }}'
    });
  expect(step(workflow, 'candidate-sut', 'Run candidate SUT through trusted private sandbox').run)
    .toContain('bun src/adapters/verification/platform/ci/verification.ts execute-trusted-bootstrap-sut');
  expect(sutSteps.some((candidate) =>
    candidate.name === 'Install candidate SUT dependencies without lifecycle scripts')).toBe(false);
  const postSteps = workflow.jobs['checker-post']?.steps ?? [];
  expect(postSteps.map((step) => step.name)).toEqual([
    'Setup trusted-base Bun runtime for reducer',
    'Initialize fail-closed final evidence envelope',
    'Checkout exact trusted base reducer',
    'Checkout exact candidate as POST data',
    'Preflight exact trusted-base checkout',
    'Install trusted-base reducer dependencies without lifecycle scripts',
    'Download bounded checker PRE artifact',
    'Download bounded candidate SUT artifact',
    'Reuse PRE Actions and reduce exact bootstrap evidence',
    'Upload final canonical trusted bootstrap evidence'
  ]);
  const postPreflight = step(workflow, 'checker-post', 'Preflight exact trusted-base checkout');
  expect(postPreflight.env).toEqual(preflight.env);
  const initialize = step(workflow, 'checker-post', 'Initialize fail-closed final evidence envelope');
  expect(initialize.env).toMatchObject({
    FINAL_EVIDENCE_ROOT: '${{ runner.temp }}/sec-trusted-bootstrap-final-${{ github.run_id }}-${{ github.run_attempt }}',
    SEC_BOOTSTRAP_BASE: '${{ needs.resolve.outputs.base }}',
    SEC_BOOTSTRAP_BASE_TREE: '${{ needs.resolve.outputs.base-tree }}',
    SEC_BOOTSTRAP_HEAD: '${{ needs.resolve.outputs.head }}',
    SEC_BOOTSTRAP_TREE: '${{ needs.resolve.outputs.tree }}',
    SEC_BOOTSTRAP_RUN_ID: '${{ github.run_id }}',
    SEC_BOOTSTRAP_RUN_ATTEMPT: '${{ github.run_attempt }}'
  });
  expect(postSteps.some((step) => step.name === 'Install candidate SUT dependencies without lifecycle scripts'))
    .toBe(false);
  const post = step(workflow, 'checker-post', 'Reuse PRE Actions and reduce exact bootstrap evidence');
  expect(post.env).toMatchObject({
    BOOTSTRAP_EVIDENCE_ROOT: '${{ runner.temp }}/sec-trusted-bootstrap-pre-${{ github.run_id }}-${{ github.run_attempt }}',
    SUT_EVIDENCE_ROOT: '${{ runner.temp }}/sec-trusted-bootstrap-sut-${{ github.run_id }}-${{ github.run_attempt }}',
    FINAL_EVIDENCE_ROOT: '${{ runner.temp }}/sec-trusted-bootstrap-final-${{ github.run_id }}-${{ github.run_attempt }}',
    SEC_BOOTSTRAP_BASE_TREE: '${{ needs.resolve.outputs.base-tree }}',
    SEC_BOOTSTRAP_RUN_ID: '${{ github.run_id }}',
    SEC_BOOTSTRAP_RUN_ATTEMPT: '${{ github.run_attempt }}'
  });
  const preArtifactName = 'sec-trusted-bootstrap-pre-${{ needs.resolve.outputs.head }}-run-${{ github.run_id }}-attempt-${{ github.run_attempt }}';
  const sutArtifactName = 'sec-trusted-bootstrap-sut-${{ needs.resolve.outputs.head }}-run-${{ github.run_id }}-attempt-${{ github.run_attempt }}';
  const preArtifactRoot = '${{ runner.temp }}/sec-trusted-bootstrap-pre-${{ github.run_id }}-${{ github.run_attempt }}';
  const sutArtifactRoot = '${{ runner.temp }}/sec-trusted-bootstrap-sut-${{ github.run_id }}-${{ github.run_attempt }}';
  const finalArtifactRoot = '${{ runner.temp }}/sec-trusted-bootstrap-final-${{ github.run_id }}-${{ github.run_attempt }}';
  const preUpload = step(workflow, 'checker-pre', 'Upload bounded checker PRE artifact');
  const preDownload = step(workflow, 'checker-post', 'Download bounded checker PRE artifact');
  const sutUpload = step(workflow, 'candidate-sut', 'Upload bounded candidate SUT artifact');
  const sutDownload = step(workflow, 'checker-post', 'Download bounded candidate SUT artifact');
  expect(preUpload.with?.name).toBe(preArtifactName);
  expect(preDownload.with?.name).toBe(preArtifactName);
  expect(sutUpload.with?.name).toBe(sutArtifactName);
  expect(sutDownload.with?.name).toBe(sutArtifactName);
  expect(preUpload.with?.path).toBe(preArtifactRoot);
  expect(preDownload.with?.path).toBe(preArtifactRoot);
  expect(sutDownload.with?.path).toBe(sutArtifactRoot);
  const sutUploadPath = sutUpload.with?.path;
  if (typeof sutUploadPath !== 'string') {
    throw new Error('trusted bootstrap SUT artifact path must be one string.');
  }
  expect(sutUploadPath.split('\n').filter(Boolean).every((path) => path.startsWith(`${sutArtifactRoot}/`)))
    .toBe(true);
  const finalUpload = step(workflow, 'checker-post', 'Upload final canonical trusted bootstrap evidence');
  expect(finalUpload.if).toBe('always()');
  expect(finalUpload.with?.['if-no-files-found']).toBe('error');
  const finalUploadPath = finalUpload.with?.path;
  if (typeof finalUploadPath !== 'string') {
    throw new Error('trusted bootstrap final artifact path must be one string.');
  }
  expect(finalUploadPath.split('\n')).toEqual([
    `${finalArtifactRoot}/final-envelope.json`,
    `${finalArtifactRoot}/SHA256SUMS`,
    `${finalArtifactRoot}/environment.txt`,
    `${finalArtifactRoot}/post-receipt.json`,
    `${finalArtifactRoot}/pre-receipt.json`,
    `${finalArtifactRoot}/sut-diagnostic.json`,
    ''
  ]);
  expect(finalUpload.with?.name).toBe(
    'sec-trusted-bootstrap-v1-pr-${{ needs.resolve.outputs.pull-request }}-base-${{ needs.resolve.outputs.base }}-head-${{ needs.resolve.outputs.head }}-run-${{ github.run_id }}-attempt-${{ github.run_attempt }}'
  );
});
