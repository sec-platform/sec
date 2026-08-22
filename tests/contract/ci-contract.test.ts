import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { parse as parseYaml } from 'yaml';

import {
  assertCiExpectedHead,
  buildCiContract,
  buildCiFullGatePlan,
  buildCiQuickGatePlan,
  CI_MAIN_HEALTH_COMMANDS,
  CI_MAIN_HEALTH_JOB_ID,
  CI_MAIN_HEALTH_JOB_NAME,
  CI_MAIN_HEALTH_STEP_ORDER,
  CI_VERIFICATION_CONTRACT_REVISION,
  CI_VERIFICATION_EXECUTION_MODEL,
  CI_VERIFICATION_PR_DISPATCH_TYPE,
  CI_VERIFICATION_PR_EVENT,
  CI_VERIFICATION_PR_REQUEST_SCHEMA,
  CI_VERIFICATION_PR_STEP_ORDER,
  CodexDevelopmentBuildVerificationPlanV1
} from '../../platform/shared/ci-contract.ts';
import {
  CI_COMPILER_WORKFLOW_RUN_IDENTITY_V1,
  CI_MAIN_HEALTH_POLICY_DIGEST_V1,
  CI_MAIN_HEALTH_POLICY_V1,
  CI_VERIFICATION_ACTION_DISPATCH_TYPE_V2,
  CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_ARTIFACT_PREFIX_V2,
  CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_FILE_V2,
  CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2,
  CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST_V1,
  CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1,
  CI_VERIFICATION_SESSION_CONTRACT_REVISION,
  createCiMainHealthRequestOperationIdV1,
  matchesCiCompilerWorkflowRunIdentityV1,
  matchesCiWorkflowRunIdentityV1
} from '../../platform/shared/ci-verification-revision.ts';
import { TCB_TRUST_ROOT_V3 } from '../../platform/shared/tcb-closure-lock.ts';
import {
  matchSecTrustedBootstrapPathV3,
  SEC_TRUSTED_BOOTSTRAP_REGISTRY_V3
} from '../../platform/shared/tcb-trust-root-contract.ts';
import {
  LOCAL_GITHUB_ACTIONS_GITHUB_CLI_ARCHIVE_SHA256_V1,
  LOCAL_GITHUB_ACTIONS_GITHUB_CLI_VERSION_V1,
  LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2
} from '../../scripts/codex/local-github-actions-runner.ts';
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
  '.github/workflows/architecture-tools.yml': { 'architecture-tools': 'sut' },
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

test('all hosted workflow-run consumers exclude mutable provider name from identity', async () => {
  const headSha = 'a'.repeat(40);
  const compilerTitle = `verify session PR #42 session sha256:${'b'.repeat(64)}`;
  const compilerIdentity = {
    workflowPath: CI_COMPILER_WORKFLOW_RUN_IDENTITY_V1.workflowPath,
    eventName: CI_COMPILER_WORKFLOW_RUN_IDENTITY_V1.eventName,
    displayTitle: compilerTitle,
    headSha,
    expectedDisplayTitle: compilerTitle,
    expectedHeadSha: headSha
  } as const;
  expect(matchesCiCompilerWorkflowRunIdentityV1(compilerIdentity)).toBe(true);
  expect(matchesCiCompilerWorkflowRunIdentityV1({
    ...compilerIdentity,
    workflowPath: '.github/workflows/foreign.yml'
  })).toBe(false);
  expect(matchesCiCompilerWorkflowRunIdentityV1({
    ...compilerIdentity,
    eventName: 'workflow_run'
  })).toBe(false);
  expect(matchesCiCompilerWorkflowRunIdentityV1({
    ...compilerIdentity,
    displayTitle: 'foreign title'
  })).toBe(false);
  expect(matchesCiCompilerWorkflowRunIdentityV1({
    ...compilerIdentity,
    headSha: 'c'.repeat(40)
  })).toBe(false);
  expect(matchesCiWorkflowRunIdentityV1({
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
  expect(CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2).toContain(
    'github-actions:self-hosted:ubuntu-24.04:x64:sec-linux-verification-v1:roles-control-trusted-sut-v1:runner-2.336.0'
  );
  expect(CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2).toContain(':node-24.19.0:');
  expect(CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2).toContain(':python-3.12.3:');
  expect(CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2).toContain(
    `:unzip-6.00:gh-${LOCAL_GITHUB_ACTIONS_GITHUB_CLI_VERSION_V1}:`
      + `gh-archive-sha256-${LOCAL_GITHUB_ACTIONS_GITHUB_CLI_ARCHIVE_SHA256_V1}:`
      + `image-${LOCAL_GITHUB_ACTIONS_RUNNER_EXPECTED_IMAGE_ID_V2.replace(':', '-')}:`
  );
  expect(CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2).not.toContain(
    'a51fddb5b7b5374cd7d48bd1843bb8eede70739b9a85953782c1b10a1064a6cf'
  );
  expect(CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2).toContain(':container-init-v1:');
});

test('persistent runners never load a workflow or repository bytes from a caller-selected ref', async () => {
  const [architectureSource, releaseSource] = await Promise.all([
    readCompilerFile('.github/workflows/architecture-tools.yml'),
    readCompilerFile('.github/workflows/compiler-release-validation.yml')
  ]);
  const architecture = parseYaml(architectureSource) as Workflow;
  const release = parseYaml(releaseSource) as Workflow;
  expect(architecture.on).toEqual({
    repository_dispatch: { types: ['sec-run-architecture-tools-v1'] }
  });
  expect(release.on).toEqual({
    repository_dispatch: { types: ['sec-verify-release-main-v1'] }
  });
  expect(step(architecture, 'architecture-tools', 'Checkout').with).toMatchObject({
    ref: '${{ steps.trusted-default.outputs.sha }}',
    'persist-credentials': false
  });
  expect(step(release, 'compiler-release-verification', 'Checkout exact release head').with)
    .toMatchObject({
      ref: '${{ steps.verification.outputs.sha }}',
      'persist-credentials': false
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

  expect(contract.verificationContractRevision).toBe(CI_VERIFICATION_CONTRACT_REVISION);
  expect(contract.verificationContractRevision).toBe('ci-verification-v19');
  expect(contract.executionModel).toBe(CI_VERIFICATION_EXECUTION_MODEL);
  expect(contract.executionModel).toBe('verification-session-v2-action-closure');
  expect(contract.prWorkflowEvent).toBe(CI_VERIFICATION_PR_EVENT);
  expect(contract.prDispatchType).toBe(CI_VERIFICATION_PR_DISPATCH_TYPE);
  expect(contract.prDispatchType).toBe('sec-verify-session-v2');
  expect(CI_VERIFICATION_PR_REQUEST_SCHEMA).toBe('sec-verification-session-hosted-request-v1');
  expect(CI_VERIFICATION_SESSION_CONTRACT_REVISION).toBe('ci-verification-session-v2');
  expect(workflow.on.repository_dispatch?.types).toEqual([
    CI_VERIFICATION_PR_DISPATCH_TYPE,
    CI_VERIFICATION_ACTION_DISPATCH_TYPE_V2,
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
    path: `.tmp/codex/${CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_FILE_V2}`,
    'if-no-files-found': 'error',
    'retention-days': 90
  });
  expect(CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_ARTIFACT_PREFIX_V2)
    .toBe('sec-verification-action-parent-dispatch-plan-v2');
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
    CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.wallSeconds / 60
  );
  const hostedSutTerminalizationReserveMinutes = 15;
  expect(CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits.wallSeconds).toBe(3_600);
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
  expect(CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2).toContain(':sandbox-v6');
  expect(CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2).not.toContain(':sandbox-v4');
  expect(CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1).toMatchObject({
    policyRevision: 'sandbox-v6',
    rootIsolation: 'private-tmpfs-chroot-retained-archive-fd-closed-before-candidate',
    toolClosure: 'private-explicit-runtime-binaries-and-dynamic-libraries-v2',
    network: 'none',
    inheritedFileDescriptors: 'stdio-plus-authenticated-archive-fd-until-private-copy',
    inputMount: 'retained-ordinary-fd-private-tmpfs-authenticated-copy-v2',
    resourceController: 'outer-cgroup-cpu-memory-pids-times-wall-plus-non-memory-prlimit'
  });
  expect(CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.archiveValidation).toMatchObject({
    retainedOrdinaryFileDescriptor: true,
    privateCopyDigestReadback: true,
    hostExtraction: false
  });
  expect(CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits).toMatchObject({
    aggregateCpuSeconds: 7200,
    perProcessCpuSeconds: 7200,
    wallSeconds: 3600,
    virtualAddressSpace: 'unlimited'
  });
  expect(CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.outerSutContainerCapabilities).toEqual([
    'CHOWN', 'SETGID', 'SETPCAP', 'SETUID', 'SYS_ADMIN', 'SYS_CHROOT'
  ]);
  expect(CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.runtimeBinaries).toContain('/usr/bin/tar');
  expect(CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.runtimeDirectories).toEqual(['/usr/lib/git-core']);
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
  expect(upload.uses).toBe('actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02');
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
  const cacheAction = 'actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830';

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
