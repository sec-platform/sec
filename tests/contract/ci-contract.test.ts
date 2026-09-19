import { expect, test } from 'bun:test';
import { parse as parseYaml } from 'yaml';

import { SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY } from '../../src/adapters/providers/linux-verification/contract.ts';
import { CI_VERIFICATION_ACTION_DISPATCH_TYPE, CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_FILE } from '../../src/adapters/verification/platform/action/contract/ci.ts';
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

const LOCAL_LINUX_RUNNER_LABELS = Object.freeze([
  'self-hosted', 'Linux', 'X64', 'sec-linux-verification-v1'
] as const);
const LOCAL_LINUX_RUNNER_ROLE_LABELS = Object.freeze({
  control: 'sec-linux-verification-control-v1',
  trusted: 'sec-linux-verification-trusted-v1',
  sut: 'sec-linux-verification-sut-v1'
} as const);
const WORKFLOW_RUNNER_ROLES = Object.freeze({
  '.github/workflows/compiler-pr-validation.yml': {
    'validate-hosted-request': 'trusted',
    'validate-agent-operation-activation-request': 'trusted',
    'agent-operation-activation': 'trusted',
    'coordinate-verification-session': 'control',
    'resolve-verification-action': 'trusted',
    'preflight-verification-action-sut': 'sut',
    'claim-verification-action': 'trusted',
    'execute-verification-action-sut': 'sut',
    'assemble-verification-action-terminal': 'trusted',
    'main-health': 'trusted'
  },
  '.github/workflows/compiler-release-validation.yml': { 'compiler-release-verification': 'sut' },
  '.github/workflows/sec-merge-gate.yml': {
    plan: 'trusted',
    authorize: 'control',
    'terminal-status': 'trusted',
    integrate: 'control'
  },
  '.github/workflows/sec-trusted-bootstrap.yml': {
    resolve: 'trusted',
    'checker-pre': 'trusted',
    'candidate-sut': 'sut',
    'checker-post': 'trusted'
  }
} as const);

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
    workflowPath: '.github/workflows/sec-merge-gate.yml',
    eventName: 'workflow_run',
    displayTitle: 'integrate compiler session run 100 attempt 1',
    headSha,
    expectedWorkflowPath: '.github/workflows/sec-merge-gate.yml',
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
      'persist-credentials': false
    });
});

test('release verification publishes one exact runtime/documentation release set', async () => {
  const release = parseYaml(
    await readCompilerFile('.github/workflows/compiler-release-validation.yml')
  ) as Workflow;
  const resolver = step(
    release,
    'compiler-release-verification',
    'Resolve trusted release request, exact head, and verifier boundary'
  );
  expect(resolver.with?.script).toContain("core.setOutput('tree', commit.commit.tree.sha)");

  expect(step(
    release,
    'compiler-release-verification',
    'Build exact-head release set'
  ).run).toBe('bun run release:build');

  expect(step(
    release,
    'compiler-release-verification',
    'Verify exact-head release set identity'
  ).env).toMatchObject({
    SEC_EXPECTED_HEAD_SHA: '${{ steps.verification.outputs.sha }}',
    SEC_EXPECTED_TREE_SHA: '${{ steps.verification.outputs.tree }}'
  });

  const upload = step(
    release,
    'compiler-release-verification',
    'Upload exact-head release set'
  );
  expect(upload.uses).toBe(
    'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'
  );
  expect(upload.with).toMatchObject({
    name: 'sec-release-head-${{ steps.verification.outputs.sha }}-run-${{ github.run_id }}-attempt-${{ github.run_attempt }}',
    path: '.tmp/release-set',
    'include-hidden-files': true,
    'if-no-files-found': 'error',
    'retention-days': 90
  });
});

test('coordinators never occupy the sole role of a downstream producer they join', () => {
  const compilerRoles = WORKFLOW_RUNNER_ROLES['.github/workflows/compiler-pr-validation.yml'];
  const sessionCoordinatorRole = compilerRoles['coordinate-verification-session'];
  for (const downstream of [
    'resolve-verification-action',
    'preflight-verification-action-sut',
    'claim-verification-action',
    'execute-verification-action-sut',
    'assemble-verification-action-terminal'
  ] as const) {
    expect(sessionCoordinatorRole, downstream).not.toBe(compilerRoles[downstream]);
  }
  const mergeRoles = WORKFLOW_RUNNER_ROLES['.github/workflows/sec-merge-gate.yml'];
  expect(mergeRoles.authorize, 'authorization must not occupy trusted leaf role').not.toBe(mergeRoles['terminal-status']);
  expect(mergeRoles.integrate, 'post-merge MainHealth join').not.toBe(compilerRoles['main-health']);
});

test('active PR contract has one V2 Session dispatch and no legacy verification authority', async () => {
  const source = await readCompilerFile('.github/workflows/compiler-pr-validation.yml');
  const workflow = parseYaml(source) as Workflow;
  const contract = buildCiContract();

  expect(contract.executionModel).toBe(CI_VERIFICATION_EXECUTION_MODEL);
  expect(contract.prWorkflowEvent).toBe(CI_VERIFICATION_PR_EVENT);
  expect(contract.prDispatchType).toBe(CI_VERIFICATION_SESSION_DISPATCH_TYPE);
  expect(workflow.on.repository_dispatch?.types).toEqual([
    CI_VERIFICATION_SESSION_DISPATCH_TYPE,
    CI_VERIFICATION_ACTION_DISPATCH_TYPE,
    'sec-produce-main-health-v1',
    'sec-produce-agent-operation-activation-v1'
  ]);
  expect(workflow.permissions).toEqual({ actions: 'read', contents: 'read', 'pull-requests': 'read' });
  expect(workflow.concurrency).toBeUndefined();
  expect(workflow.on.push).toBeUndefined();
  const workflowStepNames = new Set(Object.values(workflow.jobs)
    .flatMap((job) => job.steps.map(({ name }) => name)));
  expect(CI_VERIFICATION_PR_STEP_ORDER.filter((name) => !workflowStepNames.has(name))).toEqual([]);

  const coordinator = workflow.jobs['coordinate-verification-session']!;
  expect(coordinator['runs-on']).toEqual([
    ...LOCAL_LINUX_RUNNER_LABELS, LOCAL_LINUX_RUNNER_ROLE_LABELS.control
  ]);
  expect(coordinator.permissions).toEqual({
    actions: 'read', checks: 'read', contents: 'write', issues: 'write',
    'pull-requests': 'write', statuses: 'read'
  });
  expect(coordinator.concurrency).toEqual({
    group: 'sec-verification-session-${{ github.repository_id }}-${{ needs.validate-hosted-request.outputs.session-revision-hex }}',
    'cancel-in-progress': false,
    queue: 'max'
  });
  const reviewWait = step(workflow, 'coordinate-verification-session',
    'Publish or join Review request and wait for exact Review clearance');
  const parentPlan = step(workflow, 'coordinate-verification-session',
    'Prepare canonical parent Action dispatch plan');
  const parentUpload = step(workflow, 'coordinate-verification-session',
    'Upload canonical parent Action dispatch plan artifact');
  const parentReadback = step(workflow, 'coordinate-verification-session',
    'Read back canonical parent Action dispatch plan artifact');
  const actionDispatch = step(workflow, 'coordinate-verification-session',
    'Dispatch or join canonical ActionKey producers until terminal');
  expect(parentUpload.with).toMatchObject({
    path: `.tmp/codex/${CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_FILE}`,
    'if-no-files-found': 'error',
    'retention-days': 90
  });
  const coordinatorStepNames = coordinator.steps.map(({ name }) => name);
  expect([
    reviewWait.name, parentPlan.name, parentUpload.name, parentReadback.name, actionDispatch.name
  ].map((name) => coordinatorStepNames.indexOf(name))).toEqual([
    reviewWait.name, parentPlan.name, parentUpload.name, parentReadback.name, actionDispatch.name
  ].map((name) => coordinatorStepNames.indexOf(name)).sort((left, right) => left - right));

  const resolver = workflow.jobs['resolve-verification-action']!;
  const preflight = workflow.jobs['preflight-verification-action-sut']!;
  const claim = workflow.jobs['claim-verification-action']!;
  const sut = workflow.jobs['execute-verification-action-sut']!;
  const assembler = workflow.jobs['assemble-verification-action-terminal']!;
  const actionBudget = {
    resolver: Number(workflow.env?.SEC_ACTION_RESOLVER_TIMEOUT_MINUTES),
    preflight: Number(workflow.env?.SEC_ACTION_SUT_PREFLIGHT_TIMEOUT_MINUTES),
    claim: Number(workflow.env?.SEC_ACTION_CLAIM_TIMEOUT_MINUTES),
    sut: Number(workflow.env?.SEC_ACTION_SUT_TIMEOUT_MINUTES),
    assembler: Number(workflow.env?.SEC_ACTION_ASSEMBLER_TIMEOUT_MINUTES),
    transition: Number(workflow.env?.SEC_ACTION_COORDINATION_OVERHEAD_MINUTES),
    pollSeconds: Number(workflow.env?.SEC_ACTION_COORDINATION_POLL_INTERVAL_SECONDS),
    review: Number(workflow.env?.SEC_SESSION_REVIEW_WINDOW_MINUTES),
    reviewPollSeconds: Number(workflow.env?.SEC_SESSION_REVIEW_POLL_INTERVAL_SECONDS),
    coordinator: Number(workflow.env?.SEC_SESSION_COORDINATOR_OVERHEAD_MINUTES)
  };
  expect(actionBudget).toEqual({
    resolver: 20, preflight: 10, claim: 35, sut: 75, assembler: 30, transition: 5,
    pollSeconds: 15, review: 20, reviewPollSeconds: 20, coordinator: 10
  });
  expect(reviewWait.env).toMatchObject({
    REVIEW_WINDOW_MINUTES: actionBudget.review,
    REVIEW_POLL_INTERVAL_SECONDS: actionBudget.reviewPollSeconds
  });
  const completeSequentialActionMinutes = actionBudget.resolver + actionBudget.preflight + actionBudget.claim +
    actionBudget.sut + actionBudget.assembler;
  expect(resolver['timeout-minutes']).toBe(actionBudget.resolver);
  expect(preflight['timeout-minutes']).toBe(actionBudget.preflight);
  expect(claim['timeout-minutes']).toBe(actionBudget.claim);
  expect(sut['timeout-minutes']).toBe(actionBudget.sut);
  expect(assembler['timeout-minutes']).toBe(actionBudget.assembler);
  expect(coordinator['timeout-minutes']).toBe(
    actionBudget.review + completeSequentialActionMinutes + actionBudget.transition +
      actionBudget.coordinator
  );
  expect(workflow.env?.SEC_SESSION_COORDINATOR_TIMEOUT_MINUTES)
    .toBe(coordinator['timeout-minutes']);
  const actionDispatchBudget = actionDispatch.env ?? {};
  expect(actionDispatchBudget).toMatchObject({
    ACTION_RESOLVER_TIMEOUT_MINUTES: actionBudget.resolver,
    ACTION_SUT_PREFLIGHT_TIMEOUT_MINUTES: actionBudget.preflight,
    ACTION_CLAIM_TIMEOUT_MINUTES: actionBudget.claim,
    ACTION_SUT_TIMEOUT_MINUTES: actionBudget.sut,
    ACTION_ASSEMBLER_TIMEOUT_MINUTES: actionBudget.assembler,
    ACTION_COORDINATION_OVERHEAD_MINUTES: actionBudget.transition,
    ACTION_COORDINATION_POLL_INTERVAL_SECONDS: actionBudget.pollSeconds
  });
  for (const job of [claim, assembler]) expect(job['runs-on']).toEqual([
    ...LOCAL_LINUX_RUNNER_LABELS, LOCAL_LINUX_RUNNER_ROLE_LABELS.trusted
  ]);
  for (const job of [preflight, sut]) expect(job['runs-on']).toEqual([
    ...LOCAL_LINUX_RUNNER_LABELS, LOCAL_LINUX_RUNNER_ROLE_LABELS.sut
  ]);
  for (const job of [claim, assembler]) expect(job.concurrency).toEqual({
    group: 'sec-verification-action-${{ github.repository_id }}-${{ needs.resolve-verification-action.outputs.action-key-hex }}',
    'cancel-in-progress': false,
    queue: 'max'
  });
  expect(resolver.permissions).toEqual({
    actions: 'read', checks: 'read', contents: 'read', issues: 'read',
    'pull-requests': 'read', statuses: 'read'
  });
  expect(claim.permissions).toEqual({
    actions: 'write', checks: 'read', contents: 'read', statuses: 'write'
  });
  expect(preflight.permissions).toEqual({ actions: 'read', contents: 'read' });
  expect(sut.permissions).toEqual({ actions: 'read', contents: 'read' });
  expect(assembler.permissions).toEqual({
    actions: 'write', checks: 'read', contents: 'read', statuses: 'write'
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
    'Materialize dependencies only from exact trusted base inputs');
  const preparedInput = step(workflow, 'claim-verification-action',
    'Build authenticated raw candidate and dependency closure before provider start');
  const sandboxPreflight = step(workflow, 'preflight-verification-action-sut',
    'Prove hostile SUT sandbox on the capability-bearing role');
  const capabilityReadback = step(workflow, 'claim-verification-action',
    'Verify exact SUT capability before candidate materialization');
  const marker = step(workflow, 'claim-verification-action',
    'Create immutable Action start marker from fresh provider census');
  const claimStepNames = claim.steps.map(({ name }) => name);
  expect([capabilityReadback.name, install.name, preparedInput.name, marker.name]
    .map((name) => claimStepNames.indexOf(name))).toEqual(
      [capabilityReadback.name, install.name, preparedInput.name, marker.name]
        .map((name) => claimStepNames.indexOf(name))
        .sort((left, right) => left - right)
    );
  expect(sandboxPreflight.name).toBe('Prove hostile SUT sandbox on the capability-bearing role');
  const sutRun = step(workflow, 'execute-verification-action-sut',
    'Execute one normalized candidate operation without credentials');
  expect(sutRun.env).toBeUndefined();
  expect(sut.if).toContain("needs.claim-verification-action.outputs.ticket-issued == 'true'");
  expect(step(workflow, 'assemble-verification-action-terminal',
    'Assemble canonical five-state terminal artifact').name)
    .toBe('Assemble canonical five-state terminal artifact');
  expect(CI_VERIFICATION_HOSTED_PROVIDER_REVISION).toContain(':sandbox-v6');
  expect(CI_VERIFICATION_HOSTED_PROVIDER_REVISION).not.toContain(':sandbox-v5');
  expect(CI_VERIFICATION_HOSTED_SANDBOX_POLICY).toMatchObject({
    policyRevision: 'sandbox-v6',
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

test('every cold SUT facade installs exact-base dependencies before its first repository module import', async () => {
  const [compiler, bootstrap] = await Promise.all([
    readCompilerFile('.github/workflows/compiler-pr-validation.yml'),
    readCompilerFile('.github/workflows/sec-trusted-bootstrap.yml')
  ]).then((sources) => sources.map((source) => parseYaml(source) as Workflow));
  const cases = [
    {
      workflow: bootstrap!,
      job: 'candidate-sut',
      install: 'Install exact-base SUT facade dependencies without lifecycle scripts',
      entrypoint: 'Run candidate SUT through trusted private sandbox'
    },
    {
      workflow: compiler!,
      job: 'preflight-verification-action-sut',
      install: 'Install exact-base SUT preflight dependencies without lifecycle scripts',
      entrypoint: 'Prove hostile SUT sandbox on the capability-bearing role'
    },
    {
      workflow: compiler!,
      job: 'claim-verification-action',
      install: 'Install exact-base Action claim dependencies without lifecycle scripts',
      entrypoint: 'Verify exact SUT capability before candidate materialization'
    },
    {
      workflow: compiler!,
      job: 'execute-verification-action-sut',
      install: 'Install exact-base SUT facade dependencies without lifecycle scripts',
      entrypoint: 'Execute one normalized candidate operation without credentials'
    }
  ] as const;
  for (const candidate of cases) {
    const job = candidate.workflow.jobs[candidate.job]!;
    const install = step(candidate.workflow, candidate.job, candidate.install);
    const entrypoint = step(candidate.workflow, candidate.job, candidate.entrypoint);
    expect(install['working-directory']).toBeUndefined();
    expect(install.run).toContain('test ! -e .npmrc');
    expect(install.run).toContain('env -i');
    expect(install.run).toContain('HOME=/tmp/sec-hosted-dependency-home');
    expect(install.run).toContain('TMPDIR=/tmp/sec-hosted-dependency-tmp');
    expect(install.run).toContain('BUN_INSTALL_CACHE_DIR=/tmp/sec-hosted-dependency-home/.bun/install/cache');
    expect(install.run).toContain('LANG=C.UTF-8');
    expect(install.run).toContain('install --frozen-lockfile --ignore-scripts');
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
  expect(bootstrapEntrypoint.env?.BASE_SUT_ROOT).toBe('${{ github.workspace }}/base-sut');
  expect(bootstrapEntrypoint.run).toContain('--base-root "$BASE_SUT_ROOT"');
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
    'pull-requests': 'write'
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
    'Checkout exact trusted main producer'
  );
  const candidateCheckout = step(
    workflow,
    'agent-operation-activation',
    'Checkout exact candidate SUT'
  );
  expect(trustedCheckout.with?.['persist-credentials']).toBe(true);
  expect(candidateCheckout.with?.['persist-credentials']).toBe(false);
  const remoteHeadBinding = step(
    workflow,
    'agent-operation-activation',
    'Bind canonical trusted remote HEAD projection'
  );
  expect(remoteHeadBinding['working-directory']).toBe('trusted');
  expect(remoteHeadBinding.env).toEqual({
    SEC_ACTIVATION_BASE_SHA: '${{ needs.validate-agent-operation-activation-request.outputs.base-sha }}',
    SEC_ACTIVATION_DEFAULT_BRANCH: '${{ needs.validate-agent-operation-activation-request.outputs.default-branch }}'
  });
  expect(activation.steps.indexOf(remoteHeadBinding)).toBeGreaterThan(
    activation.steps.indexOf(candidateCheckout)
  );
  expect(activation.steps.indexOf(remoteHeadBinding)).toBeLessThan(
    activation.steps.findIndex(({ name }) => name === 'Setup trusted Bun for activation projection')
  );
  step(
    workflow,
    'agent-operation-activation',
    'Install trusted activation dependencies from frozen lock'
  );
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
  expect(upload.if).toContain("steps.compile-activation.outputs.disposition == 'created'");
  expect(upload.with?.['retention-days']).toBe(90);
  expect(publication.if).toContain("steps.compile-activation.outputs.disposition == 'created'");
  expect(publication.env?.ARTIFACT_DIGEST).toBe(
    'sha256:${{ steps.activation-upload.outputs.artifact-digest }}'
  );
});

test('exact-head workflow review findings install clean TS jobs and grant provider observers status read', async () => {
  const workflow = parseYaml(
    await readCompilerFile('.github/workflows/compiler-pr-validation.yml')
  ) as Workflow;
  const cacheAction = 'actions/cache@55cc8345863c7cc4c66a329aec7e433d2d1c52a9';

  expect(workflow.jobs['coordinate-verification-session']?.permissions?.statuses).toBe('read');
  expect(workflow.jobs['resolve-verification-action']?.permissions?.statuses).toBe('read');

  const assertions = [
    {
      job: 'coordinate-verification-session',
      setup: 'Setup trusted Bun for Session coordination',
      cache: 'Cache trusted Session coordinator Bun install',
      install: 'Install trusted Session coordinator dependencies from frozen lock',
      entrypoint: 'Publish or join Review request and wait for exact Review clearance'
    },
    {
      job: 'resolve-verification-action',
      setup: 'Setup trusted Bun for Action resolution',
      cache: 'Cache trusted Action resolver Bun install',
      install: 'Install trusted Action resolver dependencies from frozen lock',
      entrypoint: 'Re-observe trusted facts without candidate execution'
    },
    {
      job: 'assemble-verification-action-terminal',
      setup: 'Setup fresh trusted Bun for terminal assembly',
      cache: 'Cache fresh terminal assembler Bun install',
      install: 'Install fresh terminal assembler dependencies from frozen lock',
      entrypoint: 'Assemble canonical five-state terminal artifact'
    }
  ] as const;
  for (const assertion of assertions) {
    const steps = workflow.jobs[assertion.job]!.steps;
    const setupIndex = steps.findIndex(({ name }) => name === assertion.setup);
    const cacheIndex = steps.findIndex(({ name }) => name === assertion.cache);
    const installIndex = steps.findIndex(({ name }) => name === assertion.install);
    const firstEntrypointIndex = steps.findIndex(({ name }) => name === assertion.entrypoint);
    expect([setupIndex, cacheIndex, installIndex, firstEntrypointIndex].every((index) => index >= 0)).toBe(true);
    expect(setupIndex).toBeLessThan(cacheIndex);
    expect(cacheIndex).toBeLessThan(installIndex);
    expect(installIndex).toBeLessThan(firstEntrypointIndex);
    expect(steps[cacheIndex]?.uses).toBe(cacheAction);
    expect(steps[cacheIndex]?.with).toMatchObject({
      path: '~/.bun/install/cache',
      key: "${{ runner.os }}-bun-${{ hashFiles('bun.lock') }}"
    });
    expect(steps[installIndex]?.name).toBe(assertion.install);
  }
});
