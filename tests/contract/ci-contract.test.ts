import { expect, test } from 'bun:test';
import { parse as parseYaml } from 'yaml';

import { assertCiVerificationPerJobHostedWholeWorkflowShape, assertCiVerificationPerJobHostedWorkflowShape, hostedSessionCoordinationBudget } from '../../src/adapters/providers/github-api/contract/hosted-job-policy.ts';
import { SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY } from '../../src/adapters/providers/linux-verification/contract.ts';
import { CI_VERIFICATION_ACTION_DISPATCH_TYPE } from '../../src/adapters/verification/platform/action/contract/ci.ts';
import { CI_VERIFICATION_HOSTED_PROVIDER_REVISION, CI_VERIFICATION_HOSTED_TOOLCHAIN_REVISION, createCiVerificationHostedProviderRevision, createCiVerificationHostedToolchainRevision } from '../../src/adapters/verification/platform/action/contract/environment.ts';
import { CI_COMPILER_WORKFLOW_RUN_IDENTITY, matchesCiCompilerWorkflowRunIdentity, matchesCiWorkflowRunIdentity } from '../../src/adapters/verification/platform/action/contract/provider.ts';
import { buildCiContract, CI_VERIFICATION_PR_EVENT, CI_VERIFICATION_PR_STEP_ORDER } from '../../src/adapters/verification/platform/ci/contract/core.ts';
import { CI_VERIFICATION_EXECUTION_MODEL } from '../../src/adapters/verification/platform/ci/contract/plan.ts';
import { CI_VERIFICATION_HOSTED_SANDBOX_POLICY, CI_VERIFICATION_SESSION_DISPATCH_TYPE } from '../../src/adapters/verification/platform/ci/contract/revision.ts';
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

test('all hosted run consumers exclude mutable provider name from identity', async () => {
  const headSha = 'a'.repeat(40);
  const compilerTitle = `verify session PR #42 session sha256:${'b'.repeat(64)}`;
  const compilerIdentity = {
    workflowPath: CI_COMPILER_WORKFLOW_RUN_IDENTITY.workflowPath,
    eventName: CI_COMPILER_WORKFLOW_RUN_IDENTITY.eventName,
    displayTitle: compilerTitle,
    headSha,
    expectedDisplayTitle: compilerTitle,
    expectedHeadSha: headSha
  } as const;
  expect(matchesCiCompilerWorkflowRunIdentity(compilerIdentity)).toBe(true);
  expect(matchesCiCompilerWorkflowRunIdentity({
    ...compilerIdentity,
    workflowPath: '.github/workflows/foreign.yml'
  })).toBe(false);
  expect(matchesCiCompilerWorkflowRunIdentity({
    ...compilerIdentity,
    eventName: 'workflow_run'
  })).toBe(false);
  expect(matchesCiCompilerWorkflowRunIdentity({
    ...compilerIdentity,
    displayTitle: 'foreign title'
  })).toBe(false);
  expect(matchesCiCompilerWorkflowRunIdentity({
    ...compilerIdentity,
    headSha: 'c'.repeat(40)
  })).toBe(false);
  expect(matchesCiWorkflowRunIdentity({
    workflowPath: '.github/workflows/merge-gate.yml',
    eventName: 'workflow_run',
    displayTitle: 'integrate compiler session run 100 attempt 1',
    headSha,
    expectedWorkflowPath: '.github/workflows/merge-gate.yml',
    expectedEventName: 'workflow_run',
    expectedDisplayTitle: 'integrate compiler session run 100 attempt 1',
    expectedHeadSha: headSha
  })).toBe(true);
});

test('hosted provider revision binds the exact trusted runtime profile', () => {
  const authority = SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY;
  expect(CI_VERIFICATION_HOSTED_TOOLCHAIN_REVISION)
    .toBe(createCiVerificationHostedToolchainRevision(authority));
  expect(CI_VERIFICATION_HOSTED_PROVIDER_REVISION)
    .toBe(createCiVerificationHostedProviderRevision(authority));
  const hostileProjectionDigest = `sha256:${'f'.repeat(64)}` as `sha256:${string}`;
  const changedRevision = createCiVerificationHostedProviderRevision({
    ...authority,
    image: { ...authority.image, dockerProjectionDigest: hostileProjectionDigest }
  });
  expect(changedRevision).not.toBe(CI_VERIFICATION_HOSTED_PROVIDER_REVISION);
});

test('release verification never loads repository bytes from a caller-selected ref', async () => {
  const releaseSource = await readCompilerFile('.github/workflows/compiler-release-validation.yml');
  const release = parseYaml(releaseSource) as Workflow;
  expect(release.on).toEqual({
    repository_dispatch: { types: ['sec-verify-release-main-v1'] }
  });
  expect(step(release, 'compiler-release-verification', 'Checkout exact release head').with)
    .toMatchObject({
      ref: '${{ steps.verification.outputs.sha }}',
      'fetch-depth': 2,
      'persist-credentials': false
    });
});

test('release verification resolves exactly one parent from the trusted default head', async () => {
  const release = parseYaml(await readCompilerFile('.github/workflows/compiler-release-validation.yml')) as Workflow;
  const script = step(release, 'compiler-release-verification',
    'Resolve trusted release request, exact head, and verifier boundary').with?.script;
  if (typeof script !== 'string') throw new Error('Missing release resolution script.');
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
    ...args: string[]
  ) => (...values: unknown[]) => Promise<void>;
  const head = 'a'.repeat(40);
  const base = 'b'.repeat(40);
  const other = 'c'.repeat(40);
  const execute = async (input: Readonly<{
    parents: readonly string[]; commitSha?: string; defaultSha?: string; ref?: string;
  }>, outputs: Map<string, string>, requestedRefs: string[]) => {
    await new AsyncFunction('github', 'context', 'core', script)({ rest: { repos: {
      getCommit: async (request: { ref: string }) => {
        requestedRefs.push(request.ref);
        return { data: { sha: input.commitSha ?? head, parents: input.parents.map((sha) => ({ sha })) } };
      },
      get: async () => ({ data: { default_branch: 'main' } }),
      getBranch: async () => ({ data: { commit: { sha: input.defaultSha ?? head } } })
    } } }, { sha: head, ref: input.ref ?? 'refs/heads/main', repo: { owner: 'sec-platform', repo: 'sec' } },
    { setOutput: (name: string, value: string) => outputs.set(name, value) });
  };
  const outputs = new Map<string, string>();
  const requestedRefs: string[] = [];
  await execute({ parents: [base] }, outputs, requestedRefs);
  expect(requestedRefs).toEqual([head]);
  expect(Object.fromEntries(outputs)).toEqual({ sha: head, base });
  for (const input of [
    { parents: [] },
    { parents: [base, other] },
    { parents: ['main'] },
    { parents: [base], commitSha: other },
    { parents: [base], defaultSha: other },
    { parents: [base], ref: 'refs/heads/other' }
  ]) {
    const rejectedOutputs = new Map<string, string>();
    const rejectedRefs: string[] = [];
    await expect(execute(input, rejectedOutputs, rejectedRefs)).rejects.toThrow();
    expect(rejectedRefs).toEqual([head]);
    expect(rejectedOutputs.size).toBe(0);
  }
});

test('release verification binds local parent checks before the hosted Linux executor', async () => {
  const source = await readCompilerFile('.github/workflows/compiler-release-validation.yml');
  assertCiVerificationPerJobHostedWholeWorkflowShape(source);
  const release = parseYaml(source) as Workflow;
  const job = 'compiler-release-verification';
  const steps = release.jobs[job]!.steps;
  const verifyParent = step(release, job, 'Verify checked-out release parent and tree');
  const verify = step(release, job, 'Run exact-head full verification');
  const dependencies = steps.find(({ run }) => run === 'bun run deps:ensure');
  expect(dependencies).toBeDefined();
  expect(dependencies?.if).toBeUndefined();
  expect(dependencies?.['working-directory']).toBeUndefined();
  expect(steps.indexOf(dependencies!)).toBeGreaterThan(steps.indexOf(verifyParent));
  expect(steps.indexOf(dependencies!)).toBeLessThan(steps.indexOf(verify));
  const contract = buildCiContract();
  expect(release.permissions).toEqual({ contents: 'read' });
  expect(steps.map(({ name }) => name)).toEqual(contract.releaseWorkflowStepOrder);
  expect(contract.releaseWorkflowStepCount).toBe(steps.length);
  expect(verifyParent.env).toEqual({
    SEC_EXPECTED_HEAD_SHA: '${{ steps.verification.outputs.sha }}',
    SEC_CHANGED_BASE: '${{ steps.verification.outputs.base }}'
  });
  expect(verify.env).toMatchObject({
    SEC_CHANGED_BASE: '${{ steps.verification.outputs.base }}',
    SEC_AFFECTED_TESTS_BASE: '${{ steps.verification.outputs.base }}'
  });
  expect(steps.flatMap(({ run }) => run ?? []).join('\n')).not.toMatch(/\bgit\s+fetch\b/u);
  expect(release.jobs[job]!['runs-on']).toBe('ubuntu-24.04');
  expect(verifyParent.if).toBeUndefined();
  expect(steps.indexOf(verifyParent)).toBeGreaterThan(steps.indexOf(step(release, job, 'Checkout exact release head')));
  expect(steps.indexOf(verifyParent)).toBeLessThan(steps.indexOf(verify));
});

test('release payload expires independently of retained build identity and verification evidence', async () => {
  const release = parseYaml(await readCompilerFile('.github/workflows/compiler-release-validation.yml')) as Workflow;
  const job = 'compiler-release-verification';
  const steps = release.jobs[job]!.steps;
  const build = step(release, job, 'Build and bind exact-head release set');
  const manifests = step(release, job, 'Upload exact-head release manifests');
  const payload = step(release, job, 'Upload exact-head runtime and documentation release set');
  const evidence = step(release, job, 'Upload compact full verification evidence');

  // All three files must be copied under set -e before the payload can expire.
  expect(build.run).toContain('set -euo pipefail');
  expect(build.run).toContain('cp -- build/release-set/release-set-manifest.json');
  expect(build.run).toContain('build/release-set/runtime/runtime-package-manifest.json');
  expect(build.run).toContain('build/release-set/documentation/documentation-package-manifest.json');
  expect(build.run).toContain('manifest_root="$RUNNER_TEMP/sec-release-manifests-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"');
  expect(manifests.with).toMatchObject({
    name: 'sec-release-manifests-${{ steps.verification.outputs.sha }}-run-${{ github.run_id }}-attempt-${{ github.run_attempt }}',
    path: '${{ runner.temp }}/sec-release-manifests-${{ github.run_id }}-${{ github.run_attempt }}',
    'if-no-files-found': 'error',
    'retention-days': 90
  });
  expect(steps.indexOf(build)).toBeLessThan(steps.indexOf(manifests));
  expect(steps.indexOf(manifests)).toBeLessThan(steps.indexOf(payload));
  expect(manifests.if).toBeUndefined();
  expect(payload.if).toBeUndefined();
  expect(payload.with).toMatchObject({
    path: 'build/release-set/',
    'include-hidden-files': true,
    'if-no-files-found': 'error',
    'retention-days': 7
  });
  expect(evidence.if).toBe('always()');
  expect(evidence.with).toMatchObject({
    path: '.tmp/ci-verification-evidence.json',
    'if-no-files-found': 'error',
    'retention-days': 90
  });
});

test('active PR contract has one V2 Session dispatch and no legacy verification authority', async () => {
  const source = await readCompilerFile('.github/workflows/compiler-pr-validation.yml');
  const workflow = parseYaml(source) as Workflow;
  const contract = buildCiContract();

  expect(contract.executionModel).toBe(CI_VERIFICATION_EXECUTION_MODEL);
  expect(contract.prWorkflowEvent).toBe(CI_VERIFICATION_PR_EVENT);
  expect(contract.prDispatchType).toBe(CI_VERIFICATION_SESSION_DISPATCH_TYPE);
  expect([...(workflow.on.repository_dispatch?.types ?? [])].sort()).toEqual([
    CI_VERIFICATION_SESSION_DISPATCH_TYPE,
    'sec-resume-verification-session-v1',
    CI_VERIFICATION_ACTION_DISPATCH_TYPE,
    'sec-produce-main-health-v1',
    'sec-produce-agent-operation-activation-v1'
  ].sort());
  expect(workflow.permissions).toEqual({ actions: 'read', contents: 'read', 'pull-requests': 'read' });
  expect(workflow.concurrency).toBeUndefined();
  expect(workflow.on.push).toBeUndefined();
  const runtimeSteps = Object.entries(workflow.jobs)
    .filter(([, job]) => job.steps.some(value => typeof value.run === 'string'))
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([, job]) => job.steps);
  expect(CI_VERIFICATION_PR_STEP_ORDER).toEqual(runtimeSteps.map(value => value.name));
  expect(contract.prWorkflowStepOrder).toEqual(runtimeSteps.map(value => value.name));
  expect(contract.prWorkflowStepCount).toBe(runtimeSteps.length);
  expect(contract.prWorkflowCommands).toEqual(runtimeSteps.flatMap(value => value.run ?? []));
  expect(contract.prWorkflowCommandCount).toBe(contract.prWorkflowCommands.length);

  const coordinator = workflow.jobs['coordinate-verification-session']!;
  expect(coordinator.permissions).toEqual({
    actions: 'read', checks: 'read', contents: 'write', issues: 'write',
    'pull-requests': 'write', statuses: 'read', 'id-token': 'write'
  });
  expect(coordinator.concurrency).toEqual({
    group: 'sec-verification-session-${{ github.repository_id }}-${{ needs.validate-hosted-request.outputs.session-revision-hex }}',
    'cancel-in-progress': false,
    queue: 'max'
  });
  const parentPlan = step(workflow, 'coordinate-verification-session',
    'Prepare canonical parent Action dispatch plan');
  const parentUpload = step(workflow, 'coordinate-verification-session',
    'Upload canonical parent Action dispatch plan artifact');
  const actionDispatch = step(workflow, 'coordinate-verification-session',
    'Complete original Action coordination and canonical Session');
  expect(parentUpload.with).toMatchObject({
    path: '${{ github.workspace }}/.tmp/codex/hosted-job/coordinate-verification-session/out/parent-plan',
    'if-no-files-found': 'error',
    'retention-days': 90
  });
  const coordinatorStepNames = coordinator.steps.map(({ name }) => name);
  expect([
    parentPlan.name, parentUpload.name, actionDispatch.name
  ].map((name) => coordinatorStepNames.indexOf(name))).toEqual([
    parentPlan.name, parentUpload.name, actionDispatch.name
  ].map((name) => coordinatorStepNames.indexOf(name)).sort((left, right) => left - right));

  const resolver = workflow.jobs['resolve-verification-action']!;
  const preflight = workflow.jobs['preflight-verification-action-sut']!;
  const claim = workflow.jobs['claim-verification-action']!;
  const sut = workflow.jobs['execute-verification-action-sut']!;
  const assembler = workflow.jobs['assemble-verification-action-terminal']!;
  const jobMinutes = [resolver, preflight, claim, sut, assembler].map(job => job['timeout-minutes']!);
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
  expect(coordinator['timeout-minutes']).toBe(20 + completeActionMinutes + 10);
  for (const job of [claim, assembler]) expect(job.concurrency).toEqual({
    group: 'sec-verification-action-${{ github.repository_id }}-${{ needs.resolve-verification-action.outputs.action-key-hex }}',
    'cancel-in-progress': false,
    queue: 'max'
  });
  expect(resolver.permissions).toEqual({
    actions: 'read', checks: 'read', contents: 'read', issues: 'read',
    'pull-requests': 'read', statuses: 'read', 'id-token': 'write'
  });
  expect(claim.permissions).toEqual({
    actions: 'write', checks: 'read', contents: 'read', statuses: 'write', 'id-token': 'write'
  });
  expect(preflight.permissions).toEqual({ actions: 'read', contents: 'read', 'id-token': 'write' });
  expect(sut.permissions).toEqual({ actions: 'read', contents: 'read', 'id-token': 'write' });
  expect(assembler.permissions).toEqual({
    actions: 'write', checks: 'read', contents: 'read', statuses: 'write', 'id-token': 'write'
  });
  // This preserves the canonical sandbox execution ceiling and reserves a
  // separately named post-execution budget for mandatory terminalization.
  const hostedSutWallClockMinutes = Math.ceil(
    CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.wallSeconds / 60
  );
  const hostedSutTerminalizationReserveMinutes = 15;
  expect(CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.wallSeconds).toBe(3_600);
  expect(sut['timeout-minutes']).toBe(
    hostedSutWallClockMinutes + hostedSutTerminalizationReserveMinutes
  );
  const candidateCheckout = step(workflow, 'claim-verification-action',
    'Checkout exact candidate for trusted materialization only');
  expect(candidateCheckout.with).toMatchObject({
    ref: '${{ needs.validate-hosted-request.outputs.head-sha }}',
    path: '.tmp/codex/candidate',
    'persist-credentials': false
  });
  const install = step(workflow, 'claim-verification-action',
    'Install exact trusted launcher dependencies');
  const sandboxPreflight = step(workflow, 'preflight-verification-action-sut',
    'Prove hostile SUT sandbox on the executing job');
  const capabilityReadback = step(workflow, 'claim-verification-action',
    'Download exact SUT capability observation');
  const marker = step(workflow, 'claim-verification-action',
    'Create immutable Action start marker from fresh provider census');
  const claimStepNames = claim.steps.map(({ name }) => name);
  const markerUpload = step(workflow, 'claim-verification-action', 'Upload immutable Action start marker');
  const claimTicket = step(workflow, 'claim-verification-action',
    'Publish durable start tombstone and issue execution ticket');
  expect([install.name, capabilityReadback.name, candidateCheckout.name, marker.name, markerUpload.name, claimTicket.name]
    .map((name) => claimStepNames.indexOf(name))).toEqual(
      [install.name, capabilityReadback.name, candidateCheckout.name, marker.name, markerUpload.name, claimTicket.name]
        .map((name) => claimStepNames.indexOf(name))
        .sort((left, right) => left - right)
    );
  expect(claim.needs).toContain('preflight-verification-action-sut');
  expect(sandboxPreflight.run).toContain('--phase self-test-hosted-action-sandbox');
  const sutRun = step(workflow, 'execute-verification-action-sut',
    'Execute one normalized candidate operation without credentials');
  // Credentials belong to the trusted launcher; its sandbox boundary owns
  // exclusion from the candidate process, rather than an empty workflow env.
  expect(sutRun.run).toBe('exec bun --no-env-file src/bootstrap/development/hosted-job-runtime.ts --job execute-verification-action-sut --phase execute-hosted-action-sut');
  expect(sut.if).toContain("needs.claim-verification-action.outputs.ticket-issued == 'true'");
  expect(step(workflow, 'assemble-verification-action-terminal',
    'Assemble canonical five-state terminal artifact').name)
    .toBe('Assemble canonical five-state terminal artifact');
  expect(CI_VERIFICATION_HOSTED_PROVIDER_REVISION).toContain(':sandbox-v7');
  expect(CI_VERIFICATION_HOSTED_PROVIDER_REVISION).not.toContain(':sandbox-v5');
  expect(CI_VERIFICATION_HOSTED_SANDBOX_POLICY).toMatchObject({
    policyRevision: 'sandbox-v7',
    rootIsolation: 'private-tmpfs-chroot-retained-archive-fd-closed-before-candidate',
    toolClosure: 'private-explicit-runtime-binaries-python-stdlib-and-dynamic-libraries-v3',
    network: 'none',
    inheritedFileDescriptors: 'stdio-plus-authenticated-archive-fd-until-private-copy',
    inputMount: 'retained-ordinary-fd-private-tmpfs-authenticated-copy-v2',
    resourceController: 'two-cpu-outer-cgroup-times-wall-aggregate-plus-per-process-prlimit'
  });
  expect(CI_VERIFICATION_HOSTED_SANDBOX_POLICY.archiveValidation).toMatchObject({
    retainedOrdinaryFileDescriptor: true,
    privateCopyDigestReadback: true,
    hostExtraction: false
  });
  expect(CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits).toMatchObject({
    aggregateCpuSeconds: 7200,
    perProcessCpuSeconds: 7200,
    wallSeconds: 3600
  });
  expect(CI_VERIFICATION_HOSTED_SANDBOX_POLICY.outerSutContainerCapabilities).toEqual([
    'CHOWN', 'SETGID', 'SETPCAP', 'SETUID', 'SYS_ADMIN', 'SYS_CHROOT'
  ]);
  expect(CI_VERIFICATION_HOSTED_SANDBOX_POLICY.runtimeBinaries).toContain('/usr/bin/tar');
  expect(CI_VERIFICATION_HOSTED_SANDBOX_POLICY.python.version)
    .toBe(SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY.runtime.pythonVersion);
  expect(CI_VERIFICATION_HOSTED_SANDBOX_POLICY.runtimeBinaries)
    .toContain(CI_VERIFICATION_HOSTED_SANDBOX_POLICY.python.executablePath);
  expect(CI_VERIFICATION_HOSTED_SANDBOX_POLICY.runtimeDirectories).toEqual([
    '/usr/lib/git-core',
    CI_VERIFICATION_HOSTED_SANDBOX_POLICY.python.stdlibDirectory
  ]);
});

test('every per-job SUT launcher installs locked trusted source dependencies before its first phase', async () => {
  const [compiler, bootstrap] = await Promise.all([
    readCompilerFile('.github/workflows/compiler-pr-validation.yml'),
    readCompilerFile('.github/workflows/trusted-bootstrap.yml')
  ]).then((sources) => sources.map((source) => parseYaml(source) as Workflow));
  const cases = [
    {
      workflow: bootstrap!,
      job: 'candidate-sut',
      install: 'Install exact trusted launcher dependencies',
      entrypoint: 'Run candidate SUT through trusted private sandbox'
    },
    {
      workflow: compiler!,
      job: 'preflight-verification-action-sut',
      install: 'Install exact trusted launcher dependencies',
      entrypoint: 'Prove hostile SUT sandbox on the executing job'
    },
    {
      workflow: compiler!,
      job: 'claim-verification-action',
      install: 'Install exact trusted launcher dependencies',
      entrypoint: 'Create immutable Action start marker from fresh provider census'
    },
    {
      workflow: compiler!,
      job: 'execute-verification-action-sut',
      install: 'Install exact trusted launcher dependencies',
      entrypoint: 'Execute one normalized candidate operation without credentials'
    }
  ] as const;
  for (const candidate of cases) {
    const job = candidate.workflow.jobs[candidate.job]!;
    const install = step(candidate.workflow, candidate.job, candidate.install);
    const entrypoint = step(candidate.workflow, candidate.job, candidate.entrypoint);
    expect(install['working-directory']).toBeUndefined();
    expect(install.run).toBe('exec bun --no-env-file install --frozen-lockfile --ignore-scripts');
    expect(step(candidate.workflow, candidate.job, 'Checkout exact trusted hosted launcher').with?.ref)
      .toBe('${{ github.workflow_sha }}');
    expect(job.permissions?.['id-token']).toBe('write');
    expect(job.steps.indexOf(install)).toBeLessThan(job.steps.indexOf(entrypoint));
  }
  const cleanBase = step(bootstrap!, 'candidate-sut', 'Checkout clean exact base SUT input');
  expect(cleanBase.with).toMatchObject({
    ref: '${{ needs.resolve.outputs.base }}',
    path: 'base-sut',
    'persist-credentials': false
  });
  const bootstrapEntrypoint = step(
    bootstrap!, 'candidate-sut', 'Run candidate SUT through trusted private sandbox'
  );
  expect(bootstrapEntrypoint.env?.SEC_HOSTED_NEEDS_JSON).toBe('${{ toJSON(needs) }}');
  expect(bootstrapEntrypoint.run)
    .toBe('exec bun --no-env-file src/bootstrap/development/hosted-job-runtime.ts --job candidate-sut --phase execute-trusted-bootstrap-sut');
});

test('TrustedBootstrap SUT policy rejects credential, input checkout, deadline and upload drift', async () => {
  const source = await readCompilerFile('.github/workflows/trusted-bootstrap.yml');
  expect(() => assertCiVerificationPerJobHostedWorkflowShape(source, 'candidate-sut')).not.toThrow();
  for (const mutate of [
    (job: Record<string, any>) => { delete job.permissions['id-token']; },
    (job: Record<string, any>) => { job['timeout-minutes'] = 91; },
    (job: Record<string, any>) => { job.needs = ['resolve']; },
    (job: Record<string, any>) => { job['runs-on'] = ['self-hosted']; },
    (job: Record<string, any>) => { job.steps.find((step: WorkflowStep) => step.name === 'Checkout exact candidate SUT only').with.ref = '${{ github.sha }}'; },
    (job: Record<string, any>) => { job.steps.find((step: WorkflowStep) => step.name === 'Upload bounded candidate SUT artifact').if = 'success()'; },
    (job: Record<string, any>) => { job.steps.find((step: WorkflowStep) => step.name === 'Upload bounded candidate SUT artifact').with.path += '\n${{ github.workspace }}/.tmp/foreign'; }
  ]) {
    const workflow = parseYaml(source) as { jobs: Record<string, Record<string, any>> };
    mutate(workflow.jobs['candidate-sut']!);
    expect(() => assertCiVerificationPerJobHostedWorkflowShape(JSON.stringify(workflow), 'candidate-sut')).toThrow();
  }
});

test('hosted activation is a lightweight trusted-main artifact producer, not a candidate credential', async () => {
  const workflow = parseYaml(
    await readCompilerFile('.github/workflows/compiler-pr-validation.yml')
  ) as Workflow;
  const validation = workflow.jobs['validate-agent-operation-activation-request']!;
  const activation = workflow.jobs['agent-operation-activation']!;
  expect(validation.if).toContain("github.event.action == 'sec-produce-agent-operation-activation-v1'");
  expect(activation.name).toBe('agent-operation-activation');
  expect(activation.needs).toBe('validate-agent-operation-activation-request');
  expect(activation.concurrency).toEqual({
    group: 'sec-agent-operation-activation-${{ github.repository_id }}-${{ needs.validate-agent-operation-activation-request.outputs.request-operation-hex }}',
    'cancel-in-progress': false
  });
  expect(activation.permissions).toEqual({
    actions: 'read',
    checks: 'read',
    contents: 'read',
    issues: 'write',
    'pull-requests': 'write',
    'id-token': 'write'
  });
  expect(step(
    workflow,
    'validate-agent-operation-activation-request',
    'Bind activation request to live main, exact draft PR, manifest, and maintainer'
  ).name).toBe('Bind activation request to live main, exact draft PR, manifest, and maintainer');
  expect(validation.outputs?.['default-branch']).toBe('${{ steps.request.outputs.default-branch }}');
  const trustedCheckout = step(
    workflow,
    'agent-operation-activation',
    'Checkout exact trusted hosted launcher'
  );
  const candidateCheckout = step(
    workflow,
    'agent-operation-activation',
    'Checkout exact candidate SUT'
  );
  expect(trustedCheckout.with).toMatchObject({
    ref: '${{ github.workflow_sha }}',
    'persist-credentials': false
  });
  expect(candidateCheckout.with).toMatchObject({
    ref: '${{ needs.validate-agent-operation-activation-request.outputs.head-sha }}',
    'persist-credentials': false,
    path: 'candidate'
  });
  const producer = step(workflow, 'agent-operation-activation', 'Compile exact hosted activation payload');
  const upload = step(
    workflow,
    'agent-operation-activation',
    'Upload exact Agent operation activation receipt'
  );
  const publication = step(
    workflow,
    'agent-operation-activation',
    'Publish exact Agent operation activation receipt'
  );
  expect(upload.uses).toBe('actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a');
  expect(upload.if).toContain("steps.produce.outputs.disposition == 'created'");
  expect(upload.if).toContain("steps.produce.outputs.activation-ready == 'true'");
  expect(upload.with?.['retention-days']).toBe(90);
  expect(publication.if).toContain("steps.produce.outputs.disposition == 'created'");
  expect(publication.env?.ARTIFACT_ID).toBe('${{ steps.upload-activation.outputs.artifact-id }}');
  expect(publication.env?.ARTIFACT_DIGEST).toBe(
    'sha256:${{ steps.upload-activation.outputs.artifact-digest }}'
  );
  expect(activation.steps.indexOf(candidateCheckout)).toBeLessThan(activation.steps.indexOf(producer));
  expect(activation.steps.indexOf(producer)).toBeLessThan(activation.steps.indexOf(upload));
  expect(activation.steps.indexOf(upload)).toBeLessThan(activation.steps.indexOf(publication));
});

test('provider observers have status read and install trusted dependencies before their first phase', async () => {
  const workflow = parseYaml(
    await readCompilerFile('.github/workflows/compiler-pr-validation.yml')
  ) as Workflow;
  expect(workflow.jobs['coordinate-verification-session']?.permissions?.statuses).toBe('read');
  expect(workflow.jobs['resolve-verification-action']?.permissions?.statuses).toBe('read');

  const assertions = [
    {
      job: 'coordinate-verification-session',
      entrypoint: 'Prepare canonical parent Action dispatch plan'
    },
    {
      job: 'resolve-verification-action',
      entrypoint: 'Rebuild trusted Session envelope and exact ActionKey member'
    },
    {
      job: 'assemble-verification-action-terminal',
      entrypoint: 'Assemble canonical five-state terminal artifact'
    }
  ] as const;
  for (const assertion of assertions) {
    const steps = workflow.jobs[assertion.job]!.steps;
    const install = step(workflow, assertion.job, 'Install exact trusted launcher dependencies');
    const installIndex = steps.indexOf(install);
    const firstEntrypointIndex = steps.findIndex(({ name }) => name === assertion.entrypoint);
    expect(firstEntrypointIndex).toBeGreaterThanOrEqual(0);
    expect(installIndex).toBeLessThan(firstEntrypointIndex);
    expect(install.run).toBe('exec bun --no-env-file install --frozen-lockfile --ignore-scripts');
    expect(install['working-directory']).toBeUndefined();
  }
});
