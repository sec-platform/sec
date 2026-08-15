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
  CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1,
  CI_MAIN_HEALTH_POLICY_DIGEST_V1,
  CI_MAIN_HEALTH_POLICY_V1,
  CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS_V2,
  CI_VERIFICATION_ACTION_DISPATCH_TYPE_V2,
  CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_ARTIFACT_PREFIX_V2,
  CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_FILE_V2,
  CI_VERIFICATION_ACTION_REQUEST_SCHEMA_V2,
  CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2,
  CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST_V1,
  CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1,
  CI_VERIFICATION_SESSION_ARTIFACT_PREFIX,
  CI_VERIFICATION_SESSION_CONTRACT_REVISION,
  createCiMainHealthRequestOperationIdV1
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
  '.github/workflows/sec-merge-gate.yml': { plan: 'trusted', integrate: 'control' },
  '.github/workflows/sec-trusted-bootstrap.yml': {
    resolve: 'trusted',
    'checker-pre': 'trusted',
    'candidate-sut': 'sut',
    'checker-post': 'trusted'
  }
} as const);

test('all repository workflows route compute through the exact local Linux runner profile', async () => {
  for (const file of [
    '.github/workflows/architecture-tools.yml',
    '.github/workflows/compiler-pr-validation.yml',
    '.github/workflows/compiler-release-validation.yml',
    '.github/workflows/sec-merge-gate.yml',
    '.github/workflows/sec-trusted-bootstrap.yml'
  ]) {
    const source = await readCompilerFile(file);
    const workflow = parseYaml(source) as Workflow;
    const jobs = Object.entries(workflow.jobs);
    const roles = WORKFLOW_RUNNER_ROLES[file as keyof typeof WORKFLOW_RUNNER_ROLES];
    expect(jobs.length, file).toBeGreaterThan(0);
    expect(Object.keys(roles).sort(), file).toEqual(Object.keys(workflow.jobs).sort());
    for (const [jobId, job] of jobs) {
      const role = roles[jobId as keyof typeof roles];
      expect(job['runs-on'], `${file}:${jobId}`).toEqual([
        ...LOCAL_LINUX_RUNNER_LABELS,
        LOCAL_LINUX_RUNNER_ROLE_LABELS[role]
      ]);
    }
    expect(source, file).not.toContain('runs-on: ubuntu-latest');
    expect(source, file).not.toContain('runs-on: ubuntu-24.04');
  }
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
  for (const source of [architectureSource, releaseSource]) {
    expect(source).not.toContain('workflow_dispatch:');
    expect(source).not.toContain('workflow_call:');
    expect(source).not.toContain('inputs.ref');
    expect(source).toContain('context.sha');
    expect(source).toContain('repository.default_branch');
  }
  expect(architectureSource).toContain('context.ref !== `refs/heads/${repository.default_branch}`');
  expect(architectureSource).toContain('context.sha !== branch.commit.sha');
  expect(architectureSource).toContain('ref: ${{ steps.trusted-default.outputs.sha }}');
  expect(architectureSource).toContain('persist-credentials: false');
  expect(releaseSource).toContain('const requestedRef = context.sha');
  expect(releaseSource).toContain('context.ref !== `refs/heads/${repository.default_branch}`');
  expect(releaseSource).toContain('context.sha !== baseBranch.commit.sha');
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
  const integrationRole = WORKFLOW_RUNNER_ROLES['.github/workflows/sec-merge-gate.yml'].integrate;
  expect(integrationRole, 'post-merge MainHealth join').not.toBe(compilerRoles['main-health']);
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
  expect(contract.prWorkflowCommands.filter((command) => !source.includes(command))).toEqual([]);
  for (const name of CI_VERIFICATION_PR_STEP_ORDER) expect(source).toContain(`name: ${name}`);

  for (const key of [
    'schema', 'prNumber', 'expectedBaseSha', 'expectedBaseTreeSha', 'expectedHeadSha',
    'expectedHeadTreeSha', 'manifestPath', 'manifestDigest', 'profile',
    'expectedScopeProposalDigest', 'expectedActionPlanDigest', 'expectedSessionRevision',
    'reviewPolicyDigest', 'requestOperationId'
  ]) expect(source).toContain(`'${key}'`);
  expect(source).toContain(`sessionRequest.schema !== '${CI_VERIFICATION_PR_REQUEST_SCHEMA}'`);
  expect(source).toContain(`proposal.schema !== '${CI_VERIFICATION_ACTION_REQUEST_SCHEMA_V2}'`);
  expect(source).toContain('getCollaboratorPermissionLevel');
  expect(source).toContain("permission === 'maintain' || permission === 'admin'");
  expect(source).toContain(`sender?.login !== '${CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1.bot.login}'`);
  expect(source).toContain(`sender?.id !== ${CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1.bot.id}`);
  expect(source).toContain(`sender?.node_id !== '${CI_GITHUB_ACTIONS_IDENTITY_POLICY_V1.bot.nodeId}'`);
  expect(source).toContain("comparison.data.behind_by !== 0");
  const sessionRequestScript = String(step(
    workflow,
    'validate-hosted-request',
    'Resolve proposal against live default, PR, candidate, and actor'
  ).with?.script ?? '');
  expect(sessionRequestScript).not.toContain('parents.length !== 1');
  expect(sessionRequestScript).not.toContain('parents[0].sha');
  expect(source).not.toContain('sec-verify-frozen-v1');
  expect(source).not.toContain('codex-development-frozen-verification-request-v1');
  expect(source).not.toContain('artifact-status');
  expect(source).not.toContain('--previous-artifact');
  expect(source).not.toContain('Reuse one trusted terminal artifact');

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
  expect(reviewWait.run).toContain(
    'REVIEW_MAX_ATTEMPTS=$((REVIEW_WINDOW_SECONDS / REVIEW_POLL_INTERVAL_SECONDS + 1))'
  );
  expect(reviewWait.run).toContain('for attempt in $(seq 1 "$REVIEW_MAX_ATTEMPTS")');
  expect(reviewWait.run).toContain('[ "$attempt" -lt "$REVIEW_MAX_ATTEMPTS" ]');
  expect(reviewWait.run).not.toContain('seq 1 60');
  expect(reviewWait.run).toContain('WAITING_REVIEW');
  expect(actionDispatch.run).toContain('ensure-hosted-action-provider');
  expect(actionDispatch.run).toContain('--intent coordinate-session');
  expect(parentPlan.run).toContain('--intent prepare-parent-plan');
  expect(parentUpload.with).toMatchObject({
    path: `.tmp/codex/${CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_FILE_V2}`,
    'if-no-files-found': 'error',
    'retention-days': 90
  });
  expect(parentReadback.run).toContain('--intent verify-parent-plan');
  expect(parentReadback.run).toContain('--parent-artifact-archive-digest "$PARENT_ARCHIVE_DIGEST"');
  expect(CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_ARTIFACT_PREFIX_V2)
    .toBe('sec-verification-action-parent-dispatch-plan-v2');
  expect(source).not.toContain('coordinate-hosted-session');
  expect(source).not.toContain('dispatch-hosted-actions');
  expect(source).not.toContain('publish-hosted-action-start');
  expect(source).not.toContain('publish-hosted-action-terminal');
  expect([
    reviewWait.name, parentPlan.name, parentUpload.name, parentReadback.name, actionDispatch.name
  ].map((name) => source.indexOf(name))).toEqual([
    reviewWait.name, parentPlan.name, parentUpload.name, parentReadback.name, actionDispatch.name
  ].map((name) => source.indexOf(name)).sort((left, right) => left - right));

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
  expect(actionDispatch.run).toContain('ACTION_CHAIN_TIMEOUT_SECONDS=$((60 * (');
  expect(actionDispatch.run).toContain('ACTION_COORDINATION_MAX_ATTEMPTS=$((\n' +
    '  ACTION_CHAIN_TIMEOUT_SECONDS / ACTION_COORDINATION_POLL_INTERVAL_SECONDS + 1\n' +
    '))');
  expect(actionDispatch.run).toContain('seq 1 "$ACTION_COORDINATION_MAX_ATTEMPTS"');
  expect(actionDispatch.run).toContain(
    '[ "$attempt" -lt "$ACTION_COORDINATION_MAX_ATTEMPTS" ]'
  );
  expect(actionDispatch.run).not.toContain('seq 1 240');
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
  const preparedInputRun = preparedInput.run;
  if (preparedInputRun === undefined) {
    throw new Error('Authenticated candidate materialization step must be one run step.');
  }
  const sandboxPreflight = step(workflow, 'preflight-verification-action-sut',
    'Prove hostile SUT sandbox on the capability-bearing role');
  const capabilityReadback = step(workflow, 'claim-verification-action',
    'Verify exact SUT capability before candidate materialization');
  const marker = step(workflow, 'claim-verification-action',
    'Create immutable Action start marker from fresh provider census');
  expect(install.run).toContain('env -i');
  expect(install.run).toContain('"$BUN_BIN" install --frozen-lockfile --ignore-scripts');
  expect(install.run).toContain('cmp -- "$dependency_input"');
  expect(install.run).toContain('test ! -e .tmp/codex/candidate/.npmrc');
  for (const dependencyPath of CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS_V2) {
    expect(install.run).toContain(dependencyPath);
  }
  expect(preparedInputRun).toContain('prepare-hosted-action-inputs');
  expect(preparedInputRun).toContain('--candidate-root .tmp/codex/candidate');
  expect(sandboxPreflight.run).toContain('self-test-hosted-action-sandbox');
  expect(capabilityReadback.run).toContain('SUT capability observation is not the exact supported trusted artifact');
  expect(marker.run).toContain('--prepared-candidate-archive');
  expect(marker.run).toContain('--base-dependency-closure-digest');
  expect(marker.run).toContain('--authenticated-git-closure-digest');
  expect([sandboxPreflight.name, capabilityReadback.name, install.name, preparedInput.name, marker.name].map((name) =>
    source.indexOf(name))).toEqual([sandboxPreflight.name, capabilityReadback.name, install.name, preparedInput.name, marker.name].map(
    (name) => source.indexOf(name)).sort((left, right) => left - right));
  // `--candidate-root` is also a legitimate input of the separately owned
  // Agent activation producer. Scope this invariant to the hosted Action
  // materializer instead of coupling unrelated workflow operations by a
  // whole-file token count.
  expect(preparedInputRun.match(/--candidate-root/gu)).toHaveLength(1);
  const sutRun = step(workflow, 'execute-verification-action-sut',
    'Execute one normalized candidate operation without credentials');
  expect(sutRun.run).toContain('execute-hosted-action-sut');
  expect(sutRun.run).toContain('--output .tmp/codex/raw/verification-action-raw-observation.json');
  expect(sutRun.run).not.toContain('--candidate-root');
  expect(sutRun.run).not.toContain('verification-action-raw-result.json');
  expect(sutRun.env).toBeUndefined();
  expect(sut.if).toContain("needs.claim-verification-action.outputs.ticket-issued == 'true'");
  const assemblerRun = step(workflow, 'assemble-verification-action-terminal',
    'Assemble canonical five-state terminal artifact').run;
  expect(assemblerRun).toContain('assemble-hosted-action-terminal');
  expect(assemblerRun).toContain('--raw-result .tmp/codex/raw/verification-action-raw-observation.json');
  expect(source).toContain('--intent anchor-terminal');
  expect(source).not.toContain('working-directory: .tmp/codex/candidate\n        run: bun scripts/ci-verification.ts');
  expect(source).toContain(`${CI_VERIFICATION_SESSION_ARTIFACT_PREFIX}-pr-`);
  expect(CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2).toContain(':sandbox-v5');
  expect(CI_VERIFICATION_HOSTED_PROVIDER_REVISION_V2).not.toContain(':sandbox-v4');
  expect(CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1).toMatchObject({
    policyRevision: 'sandbox-v5',
    rootIsolation: 'private-tmpfs-chroot-retained-archive-fd-closed-before-candidate',
    toolClosure: 'private-explicit-runtime-binaries-and-dynamic-libraries-v2',
    network: 'none',
    inheritedFileDescriptors: 'stdio-plus-authenticated-archive-fd-until-private-copy',
    inputMount: 'retained-ordinary-fd-private-tmpfs-authenticated-copy-v2',
    resourceController: 'two-cpu-outer-cgroup-times-wall-aggregate-plus-per-process-prlimit'
  });
  expect(CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.archiveValidation).toMatchObject({
    retainedOrdinaryFileDescriptor: true,
    privateCopyDigestReadback: true,
    hostExtraction: false
  });
  expect(CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits).toMatchObject({
    aggregateCpuSeconds: 7200,
    perProcessCpuSeconds: 7200,
    wallSeconds: 3600
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
  const validationScript = String(step(
    workflow,
    'validate-agent-operation-activation-request',
    'Bind activation request to live main, exact draft PR, manifest, and maintainer'
  ).with?.script ?? '');
  expect(validationScript).toContain('comparison.data.commits.some');
  expect(validationScript).toContain('comparison.data.total_commits !== comparison.data.commits.length');
  expect(validationScript).toContain('(commit.parents ?? []).length !== 1');
  expect(validationScript).toContain('!pullData.draft');
  expect(validationScript).toContain('getCollaboratorPermissionLevel');
  expect(validation.outputs?.['default-branch']).toBe('${{ steps.request.outputs.default-branch }}');
  expect(validationScript).toContain("core.setOutput('default-branch', repository.data.default_branch)");
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
  expect(remoteHeadBinding.run).toContain(
    'git symbolic-ref refs/remotes/origin/HEAD "refs/remotes/origin/$SEC_ACTIVATION_DEFAULT_BRANCH"'
  );
  expect(remoteHeadBinding.run).toContain(
    'test "$(git rev-parse --verify "refs/remotes/origin/$SEC_ACTIVATION_DEFAULT_BRANCH^{commit}")" = "$SEC_ACTIVATION_BASE_SHA"'
  );
  expect(activation.steps.indexOf(remoteHeadBinding)).toBeGreaterThan(
    activation.steps.indexOf(candidateCheckout)
  );
  expect(activation.steps.indexOf(remoteHeadBinding)).toBeLessThan(
    activation.steps.findIndex(({ name }) => name === 'Setup trusted Bun for activation projection')
  );
  const activationInstall = step(
    workflow,
    'agent-operation-activation',
    'Install trusted activation dependencies from frozen lock'
  );
  expect(activationInstall.run).toBe('bun install --frozen-lockfile --ignore-scripts');
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
  expect(publication.run).toContain('publish-hosted');
  expect(publication.run).not.toContain('gh api');
  expect(publication.env?.ARTIFACT_DIGEST).toBe(
    'sha256:${{ steps.activation-upload.outputs.artifact-digest }}'
  );
  const activationRuns = activation.steps.map(({ run }) => run ?? '').join('\n');
  expect(activationRuns).not.toMatch(/bun (?:test|run typecheck|run check:)/u);
  expect(activationRuns).not.toContain('git update-ref');
  expect(activationRuns).not.toContain('hash-object -w');
});

test('exact-head workflow review findings install clean TS jobs and grant provider observers status read', async () => {
  const workflow = parseYaml(
    await readCompilerFile('.github/workflows/compiler-pr-validation.yml')
  ) as Workflow;
  const cacheAction = 'actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830';
  const frozenInstall = 'bun install --frozen-lockfile';

  expect(workflow.jobs['coordinate-verification-session']?.permissions?.statuses).toBe('read');
  expect(workflow.jobs['resolve-verification-action']?.permissions?.statuses).toBe('read');

  const assertions = [
    {
      job: 'coordinate-verification-session',
      setup: 'Setup trusted Bun for Session coordination',
      cache: 'Cache trusted Session coordinator Bun install',
      install: 'Install trusted Session coordinator dependencies from frozen lock'
    },
    {
      job: 'resolve-verification-action',
      setup: 'Setup trusted Bun for Action resolution',
      cache: 'Cache trusted Action resolver Bun install',
      install: 'Install trusted Action resolver dependencies from frozen lock'
    },
    {
      job: 'assemble-verification-action-terminal',
      setup: 'Setup fresh trusted Bun for terminal assembly',
      cache: 'Cache fresh terminal assembler Bun install',
      install: 'Install fresh terminal assembler dependencies from frozen lock'
    }
  ] as const;
  for (const assertion of assertions) {
    const steps = workflow.jobs[assertion.job]!.steps;
    const setupIndex = steps.findIndex(({ name }) => name === assertion.setup);
    const cacheIndex = steps.findIndex(({ name }) => name === assertion.cache);
    const installIndex = steps.findIndex(({ name }) => name === assertion.install);
    const firstEntrypointIndex = steps.findIndex(({ run }) => run?.includes('bun scripts/') === true);
    expect([setupIndex, cacheIndex, installIndex, firstEntrypointIndex].every((index) => index >= 0)).toBe(true);
    expect(setupIndex).toBeLessThan(cacheIndex);
    expect(cacheIndex).toBeLessThan(installIndex);
    expect(installIndex).toBeLessThan(firstEntrypointIndex);
    expect(steps[cacheIndex]?.uses).toBe(cacheAction);
    expect(steps[cacheIndex]?.with).toMatchObject({
      path: '~/.bun/install/cache',
      key: "${{ runner.os }}-bun-${{ hashFiles('bun.lock') }}"
    });
    expect(steps[installIndex]?.run).toBe(frozenInstall);
  }

  const claimSteps = workflow.jobs['claim-verification-action']!.steps;
  const claimInstallIndex = claimSteps.findIndex(
    ({ name }) => name === 'Materialize dependencies only from exact trusted base inputs'
  );
  const claimFirstEntrypointIndex = claimSteps.findIndex(({ run }) => run?.includes('bun scripts/') === true);
  expect(claimInstallIndex).toBeGreaterThan(-1);
  expect(claimInstallIndex).toBeLessThan(claimFirstEntrypointIndex);
  expect(claimSteps[claimInstallIndex]?.run).toContain('install --frozen-lockfile --ignore-scripts');
});

test('hosted sandbox runtime closure covers private-root mount tools without non-canonical aliases', async () => {
  const source = await readCompilerFile('scripts/ci-verification.ts');
  expect(source).toContain("'mount --make-rprivate /'");
  expect(source).toContain('umount -R "$root"');
  const invokedPivotTools = ['mount', 'umount'];
  const runtimeBinaries = [...CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.runtimeBinaries];

  expect(invokedPivotTools).toEqual(['mount', 'umount']);
  expect(invokedPivotTools.map((tool) => `/usr/bin/${tool}`)).toEqual(
    runtimeBinaries.filter((binary) => binary === '/usr/bin/mount' || binary === '/usr/bin/umount')
  );
  expect(runtimeBinaries.slice(
    runtimeBinaries.indexOf('/usr/bin/mktemp'),
    runtimeBinaries.indexOf('/usr/bin/prlimit') + 1
  )).toEqual(['/usr/bin/mktemp', '/usr/bin/mount', '/usr/bin/prlimit']);
  expect(runtimeBinaries.slice(
    runtimeBinaries.indexOf('/usr/bin/tr'),
    runtimeBinaries.indexOf('/usr/bin/uname') + 1
  )).toEqual(['/usr/bin/tr', '/usr/bin/umount', '/usr/bin/uname']);
  expect(new Set(runtimeBinaries).size).toBe(runtimeBinaries.length);
  expect(runtimeBinaries).not.toContain('/bin/mount');
  expect(runtimeBinaries).not.toContain('/bin/umount');
  expect(CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST_V1).toBe(
    `sha256:${createHash('sha256')
      .update(JSON.stringify(CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1))
      .digest('hex')}`
  );
});

test('trusted merge workflow consumes the Session artifact and exposes one terminal status authority', async () => {
  const [source, compilerWorkflowSource] = await Promise.all([
    readCompilerFile('.github/workflows/sec-merge-gate.yml'),
    readCompilerFile('.github/workflows/compiler-pr-validation.yml')
  ]);
  const workflow = parseYaml(source) as Workflow;
  const compilerWorkflow = parseYaml(compilerWorkflowSource) as Workflow;
  const openLane = "${{ steps.prepare-integration.outputs.integration-lane == 'open-first-effect' }}";
  const effectLane = "${{ steps.prepare-integration.outputs.integration-lane == 'open-first-effect' || steps.prepare-integration.outputs.integration-lane == 'merged-recovery' }}";
  const externalSessionLane = "${{ github.event.workflow_run.event == 'repository_dispatch' && github.event.workflow_run.conclusion == 'success' && startsWith(github.event.workflow_run.display_title, 'verify session PR #') }}";
  expect(workflow.on.workflow_run).toEqual({ workflows: ['compiler-pr-validation'], types: ['completed'] });
  expect(workflow.permissions).toEqual({ actions: 'read', contents: 'read' });
  expect(workflow.jobs.plan?.if).toBe(externalSessionLane);
  expect(workflow.jobs.integrate?.if).toBe(externalSessionLane);
  const integrationBudget = workflow.env ?? {};
  expect(integrationBudget).toMatchObject({
    SEC_INTEGRATION_DURABLE_DIRECTORY: '${{ github.workspace }}/.tmp/codex',
    SEC_INTEGRATION_PRE_MERGE_BUDGET_MINUTES: 30,
    SEC_MAIN_HEALTH_RUNNER_QUEUE_ALLOWANCE_MINUTES: 10,
    SEC_MAIN_HEALTH_PRODUCER_TIMEOUT_MINUTES: 30,
    SEC_MAIN_HEALTH_JOIN_POLL_INTERVAL_SECONDS: 10,
    SEC_INTEGRATION_CLOSEOUT_BUDGET_MINUTES: 15,
    SEC_INTEGRATION_TIMEOUT_MINUTES: 116
  });
  const integrationPreMergeBudgetMinutes = Number(
    integrationBudget.SEC_INTEGRATION_PRE_MERGE_BUDGET_MINUTES
  );
  const mainHealthRunnerQueueAllowanceMinutes = Number(
    integrationBudget.SEC_MAIN_HEALTH_RUNNER_QUEUE_ALLOWANCE_MINUTES
  );
  const mainHealthProducerBudgetMinutes = Number(
    integrationBudget.SEC_MAIN_HEALTH_PRODUCER_TIMEOUT_MINUTES
  );
  const mainHealthJoinPollIntervalSeconds = Number(
    integrationBudget.SEC_MAIN_HEALTH_JOIN_POLL_INTERVAL_SECONDS
  );
  const integrationCloseoutBudgetMinutes = Number(
    integrationBudget.SEC_INTEGRATION_CLOSEOUT_BUDGET_MINUTES
  );
  expect(workflow.jobs.integrate?.['timeout-minutes']).toBe(
    integrationPreMergeBudgetMinutes + (2 * mainHealthProducerBudgetMinutes) +
      mainHealthRunnerQueueAllowanceMinutes + Math.ceil(mainHealthJoinPollIntervalSeconds / 60) +
      integrationCloseoutBudgetMinutes
  );
  expect(workflow.jobs.integrate?.permissions).toEqual({
    actions: 'read', checks: 'read', contents: 'write',
    'pull-requests': 'write', issues: 'write', statuses: 'write'
  });
  expect(source).toContain('workflow_run');
  expect(source).toContain('bun scripts/codex/verification-session.ts prepare-integration-hosted');
  expect(source).toContain('bun scripts/codex/verification-session.ts integrate-hosted');
  expect(source).not.toContain('bun scripts/codex/verification-session.ts closeout-mutate-hosted');
  expect(source).toContain('bun scripts/codex/verification-session.ts closeout-publish-hosted');
  expect(source).toContain('sec-verification-session-hosted-integration-route-v1');
  expect(source).toContain('open-first-effect');
  expect(source).toContain('merged-recovery');
  expect(source).toContain('blocked');
  expect(source).toContain('path: .tmp/codex/branch-closeout-recovery.json');
  expect(source).toContain('process.env.WORKFLOW_SHA !== sessionBaseSha');
  expect(source).not.toContain('run.head_sha !== currentBase');
  expect(source).not.toContain('prepare-merge-gate');
  expect(source).not.toContain('merge-gate.ts authorize');
  expect(source).not.toContain('ahead_by !== 1');
  expect(source).not.toContain('- name: Dispatch and join exact post-merge MainHealth');
  expect(source).not.toContain('scope-attest');
  expect(source).not.toContain('sec-merge-bootstrap');
  expect(source).not.toContain('pull_request_review');
  expect(source).not.toContain('gh pr merge');
  expect(source).not.toContain('--admin');
  expect(source).not.toContain('pulls.update');
  expect(source).not.toContain('issues.createComment');
  expect(workflow.jobs.integrate?.concurrency).toEqual({
    group: 'sec-integration-${{ github.repository_id }}-${{ github.event.repository.default_branch }}',
    'cancel-in-progress': false,
    queue: 'max'
  });
  const phases = [
    'Create exact integration durable directory',
    'Resolve exact hosted integration lane',
    'Validate exact hosted integration lane projection',
    'Reject blocked hosted integration lane',
    'Upload exact branch closeout recovery artifact',
    'Read back exact branch closeout recovery artifact',
    'Close out exact integrated branch',
    'Publish exact branch closeout receipt'
  ];
  const names = workflow.jobs.integrate!.steps.map((entry) => entry.name);
  expect(phases.map((name) => names.indexOf(name))).toEqual([...phases.map((name) => names.indexOf(name))].sort((a, b) => a - b));
  expect(new Set(phases.map((name) => names.filter((entry) => entry === name).length))).toEqual(new Set([1]));
  const route = step(workflow, 'integrate', 'Resolve exact hosted integration lane');
  const durableDirectory = step(workflow, 'integrate', 'Create exact integration durable directory');
  expect(names.indexOf(durableDirectory.name)).toBeLessThan(names.indexOf(route.name));
  expect(durableDirectory.run).toContain('mkdir -p -- "${SEC_INTEGRATION_DURABLE_DIRECTORY}"');
  expect(durableDirectory.run).toContain('test ! -L "${SEC_INTEGRATION_DURABLE_DIRECTORY}"');
  expect(route.id).toBe('prepare-integration');
  expect(route.run).toContain('prepare-integration-hosted');
  expect(route.run).toContain('--output "${SEC_INTEGRATION_DURABLE_DIRECTORY}/integration-projection.json"');
  const routeValidation = step(workflow, 'integrate', 'Validate exact hosted integration lane projection');
  expect(routeValidation.env?.INTEGRATION_LANE)
    .toBe('${{ steps.prepare-integration.outputs.integration-lane }}');
  expect(routeValidation.env?.ROUTE_FILE)
    .toBe('${{ env.SEC_INTEGRATION_DURABLE_DIRECTORY }}/integration-projection.json');
  expect(routeValidation.run).toContain('sec-verification-session-hosted-integration-route-v1');
  const blocked = step(workflow, 'integrate', 'Reject blocked hosted integration lane');
  expect(blocked.if).toBe("${{ steps.prepare-integration.outputs.integration-lane == 'blocked' }}");
  expect(blocked.run).toContain('exit 1');
  expect(step(workflow, 'integrate', 'Upload exact branch closeout recovery artifact').if).toBe(openLane);
  expect(step(workflow, 'integrate', 'Read back exact branch closeout recovery artifact').if).toBe(openLane);
  for (const name of [
    'Close out exact integrated branch',
    'Publish exact branch closeout receipt'
  ]) {
    expect(step(workflow, 'integrate', name).if).toBe(effectLane);
  }
  const closeout = step(workflow, 'integrate', 'Close out exact integrated branch');
  expect(closeout.env).toEqual({
    GH_TOKEN: '${{ github.token }}',
    PRE_MERGE_MAIN_SHA: '${{ needs.plan.outputs.base-sha }}',
    PLANNED_CURRENT_MAIN_SHA: '${{ needs.plan.outputs.current-main-sha }}',
    MAIN_HEALTH_RUNNER_QUEUE_ALLOWANCE_MINUTES: mainHealthRunnerQueueAllowanceMinutes,
    MAIN_HEALTH_PRODUCER_TIMEOUT_MINUTES: mainHealthProducerBudgetMinutes,
    MAIN_HEALTH_JOIN_POLL_INTERVAL_SECONDS: mainHealthJoinPollIntervalSeconds
  });
  const mainHealthProducerTimeoutMinutes = compilerWorkflow.jobs['main-health']?.['timeout-minutes'];
  expect(mainHealthProducerTimeoutMinutes).toBe(mainHealthProducerBudgetMinutes);
  const sessionSource = await readCompilerFile('scripts/codex/verification-session.ts');
  expect(sessionSource).toContain('async function joinExactPostMergeMainHealthV1');
  expect(sessionSource).toContain("'sec-produce-main-health-v1'");
  expect(sessionSource).toContain('Canonical MainHealth workflow is not active.');
  expect(sessionSource).toContain('queueAllowance * 60 * 1000');
  expect(sessionSource).toContain('producerTimeout * 60 * 1000');
  expect(sessionSource).toContain('pollSeconds * 1000');
  expect(sessionSource).toContain('function assertBoundPostMergeMainV1');
  expect(sessionSource).toContain('First-effect integration did not advance main exactly once from the planned base.');
  expect(sessionSource).toContain('Recovered PR merge commit is not an ancestor of the planned live main.');
  expect(sessionSource).toContain('boundPostMergeMainSha');
  const integrateSource = sessionSource.slice(sessionSource.indexOf("if (command === 'integrate-hosted')"),
    sessionSource.indexOf("if (command === 'closeout-mutate-hosted')"));
  expect(integrateSource.indexOf('await joinExactPostMergeMainHealthV1'))
    .toBeLessThan(integrateSource.indexOf('consumeSameHostWorktreeCloseoutV1'));
  expect(integrateSource).toContain('await finalizeSameInvocationCloseoutV1');
  const reconciliationHelper = sessionSource.slice(
    sessionSource.indexOf('function observePostMergeIssueReconciliationV1('),
    sessionSource.indexOf('function selectMergedAuthorizationPublication(')
  );
  expect(reconciliationHelper).toContain('observeUnexpectedGitHubIssueClosuresV1');
  expect(reconciliationHelper).toContain("? 'no-op'");
  expect(reconciliationHelper).toContain(": 'manual-action-required'");
  expect(reconciliationHelper).toContain("? 'blocked'");
  expect(integrateSource).toContain('stopCloseoutForIssueReconciliation');
  expect(integrateSource.indexOf('observePostMergeIssueReconciliationV1({ repository,'))
    .toBeLessThan(integrateSource.indexOf('await joinExactPostMergeMainHealthV1'));
  expect(integrateSource.indexOf('stopCloseoutForIssueReconciliation(merged)'))
    .toBeLessThan(integrateSource.indexOf('await joinExactPostMergeMainHealthV1'));
  const retainedProjection = step(workflow, 'integrate', 'Retain exact integration and closeout publication projections');
  expect(retainedProjection.if)
    .toBe("always() && !cancelled() && hashFiles('.tmp/codex/integration-projection.json') != ''");
  expect(String(retainedProjection.with?.path)).toContain('.tmp/codex/integration-projection.json');
  expect(String(retainedProjection.with?.path)).toContain('.tmp/codex/closeout-publication-projection.json');
  expect(String(retainedProjection.with?.path)).not.toContain('closeout-mutation-projection.json');
  const githubAdapterSource = await readCompilerFile('scripts/codex/verification-session-github.ts');
  expect(githubAdapterSource).toContain('sec-closeout-projections-v1-run-([1-9][0-9]*)-attempt-([1-9][0-9]*)');
  expect(githubAdapterSource).toContain("'sec-closeout-projections-v1-'");
  expect(githubAdapterSource).not.toContain('sec-integration-projection-v1-');
});

test('Action execution and V4 publication are the only active CI producer path', async () => {
  const source = await readCompilerFile('scripts/ci-verification.ts');
  expect(source).toContain('buildCiVerificationActionPlanClosureV1');
  expect(source).toContain('CodexDevelopmentExecuteCiActionClosureV1');
  expect(source).toContain('CodexDevelopmentFinalizeVerificationEvidenceV4');
  expect(source).toContain('SEC_SESSION_PROPOSAL_DIGEST');
  expect(source).toContain('SEC_SCOPE_AUTHORIZATION_REVISION');
  expect(source).not.toContain('CodexDevelopmentWriteVerificationEvidenceV2Atomic');
  expect(source).not.toContain('CodexDevelopmentWriteVerificationEvidenceV3Atomic(');
  expect(source).not.toContain('HEAD^1');
  expect(source).not.toContain('process.exit(');
  expect(source).not.toContain('/dispatches');
  expect(source).not.toContain('dispatch-hosted-actions');
  expect(source).not.toContain('publish-hosted-action-start');
  expect(source).not.toContain('publish-hosted-action-terminal');
  expect(source).toContain("CI_TCB_CLOSURE_LOCK_TARGET_V1 = 'platform/shared/tcb-closure-lock.ts'");
  expect(source.match(
    /import type \{[^}]+\} from '\.\.\/platform\/shared\/tcb-closure-lock\.ts';/gu
  )).toHaveLength(1);
  expect(source.match(
    /import \{[^}]+\} from '\.\.\/platform\/shared\/tcb-closure-lock\.ts';/gu
  ) ?? []).toHaveLength(0);
  expect(source).toContain("mode === 'apply' && process.env.GITHUB_ACTIONS === 'true'");
  expect(source).toContain('argv.length === 5');
  expect(source).toContain("argv[3] === '--generated-at'");
  expect(source).toContain('--mode dry-run|apply --generated-at <canonical-iso-utc>');
  expect(source).toContain('withWorkspaceWriteLease(compilerRoot');
  expect(source).not.toContain('CodexDevelopmentExecuteTcbClosureLockCommandV1');
  expect(source).not.toContain('generateTcbClosureLockForRevision');
  const tcbCommandSource = source.slice(
    source.indexOf('export const CI_TCB_CLOSURE_LOCK_TARGET_V1'),
    source.indexOf('const HOSTED_ACTION_COMMANDS')
  );
  expect(tcbCommandSource).toContain('async function executeTcbClosureLockCommandV1(');
  expect(tcbCommandSource).not.toContain('export async function executeTcbClosureLockCommandV1(');
  expect(tcbCommandSource).not.toContain('repositoryRoot');
  expect(tcbCommandSource).not.toContain('generateLock');
  expect(tcbCommandSource).not.toContain('fault');
  expect(tcbCommandSource).not.toContain('new Date()');
  expect(tcbCommandSource).toContain('new Date(record.generatedAt).toISOString()');
  expect(tcbCommandSource.match(
    /await import\('\.\.\/platform\/shared\/tcb-closure-lock\.ts'\)/gu
  )).toHaveLength(1);
  expect(source.match(/'\.\.\/platform\/shared\/tcb-closure-lock\.ts'/gu)).toHaveLength(2);
  expect(tcbCommandSource).toContain('TCB closure lock raw-source CAS failed at the final fence.');
  expect(tcbCommandSource).toContain('TCB closure lock causal input changed after planning.');
  expect(tcbCommandSource).toContain("CI_TCB_CLOSURE_ARCHIVE_ROOT_V1 = '.tmp/codex/tcb-closure-lock-v2'");
  expect(tcbCommandSource).toContain("schema: 'sec-tcb-closure-lock-archive-operation-v3'");
  expect(tcbCommandSource).toContain("'schema', 'target', 'oldDigest', 'nextDigest', 'generatedAt', 'operationKey'");
  expect(tcbCommandSource).toContain('encodeTcbClosureOperationRecordV1(record) !== source');
  expect(tcbCommandSource).toContain('has no durable operation record');
  expect(tcbCommandSource).toContain('readTcbClosureArchiveRawDataV1(');
  expect(tcbCommandSource).toContain('tcbClosureArchiveCensusV1(');
  expect(tcbCommandSource.match(/function tcbClosureArchiveCensusV1\(/gu)).toHaveLength(1);
  expect(tcbCommandSource).toContain('must be on the same retained device as the target parent');
  expect(tcbCommandSource).toContain('must be on the same retained volume as the target parent');
  expect(tcbCommandSource).not.toContain('MoveFileExW');
  expect(tcbCommandSource).toContain('SetFileInformationByHandle');
  expect(tcbCommandSource).toContain('NtSetInformationFile');
  expect(tcbCommandSource).toContain('win32Error !== TCB_CLOSURE_WINDOWS_ERROR_INVALID_PARAMETER_V1');
  expect(tcbCommandSource).toContain('TCB_CLOSURE_WINDOWS_FILE_ID_INFO_V1');
  expect(tcbCommandSource).toContain('current source entry has a retained FileId/volume identity mismatch');
  expect(tcbCommandSource).toContain('renameat2');
  expect(tcbCommandSource).toContain('TCB_CLOSURE_LINUX_RENAME_NOREPLACE_V1');
  expect(tcbCommandSource).toContain('fsConstants.O_NOFOLLOW');
  expect(tcbCommandSource).toContain('TCB_CLOSURE_LINUX_X64_O_CLOEXEC_V1 = 0o2_000_000');
  expect(tcbCommandSource).toContain("if (process.arch !== 'x64')");
  expect(tcbCommandSource).toContain('const closeOnExec = TCB_CLOSURE_LINUX_X64_O_CLOEXEC_V1');
  expect(tcbCommandSource).not.toContain('.O_CLOEXEC');
  expect(tcbCommandSource).not.toContain('readonly fcntl:');
  expect(tcbCommandSource).not.toContain('fcntl: { args:');
  const linuxTransactionSource = tcbCommandSource.slice(
    tcbCommandSource.indexOf('async function withTcbClosureLinuxTransactionV1<T>('),
    tcbCommandSource.indexOf('async function withTcbClosureAnchoredTransactionV1<T>(')
  );
  expect(linuxTransactionSource.indexOf('try {'))
    .toBeLessThan(linuxTransactionSource.indexOf('rootDescriptor = openAbsoluteRoot();'));
  expect(tcbCommandSource).toContain('__errno_location');
  expect(tcbCommandSource).toContain('current source entry has a retained dev:ino identity mismatch');
  expect(tcbCommandSource).toContain('TCB_CLOSURE_LINUX_ERROR_FUNCTION_NOT_IMPLEMENTED_V1');
  expect(tcbCommandSource).toContain('TCB_CLOSURE_LINUX_ERROR_INVALID_ARGUMENT_V1');
  expect(tcbCommandSource).toContain('TCB_CLOSURE_LINUX_ERROR_OPERATION_NOT_SUPPORTED_V1');
  expect(tcbCommandSource).toContain('TCB_CLOSURE_DESTINATION_RACE');
  expect(tcbCommandSource).toContain('TCB_CLOSURE_UNSUPPORTED_TRANSACTION');
  expect(tcbCommandSource).toContain('FlushFileBuffers');
  expect(tcbCommandSource).toContain('retained fsync failed');
  expect(tcbCommandSource).toContain('checked CloseHandle failed');
  expect(tcbCommandSource).toContain('checked close failed');
  expect(tcbCommandSource).toContain('TCB_CLOSURE_WINDOWS_GENERIC_WRITE_V1');
  expect(tcbCommandSource).toContain('TCB_CLOSURE_WINDOWS_SHARE_READ_WRITE_V1 = 0x0000_0003');
  expect(tcbCommandSource).toContain('TCB_CLOSURE_WINDOWS_SHARE_READ_WRITE_DELETE_V1 = 0x0000_0007');
  expect(tcbCommandSource).toContain('shareMode = TCB_CLOSURE_WINDOWS_SHARE_READ_WRITE_DELETE_V1');
  expect(tcbCommandSource).not.toContain('renameSync(');
  expect(tcbCommandSource).not.toContain('unlinkSync(');
  expect(tcbCommandSource).not.toContain('paths.backup');
  expect(tcbCommandSource).not.toContain('flushTcbClosureTargetV1');
  expect(tcbCommandSource).not.toContain("['EINVAL', 'EPERM', 'EACCES', 'EBADF']");
  expect(tcbCommandSource).toContain('withTcbClosureAnchoredTransactionV1(paths');
  expect(tcbCommandSource).toContain("const tcbClosureTransactionRaceObserverV1:");
  expect(tcbCommandSource).toContain("observeTcbClosureTransactionRaceV1('before-authority-open'");
  expect(tcbCommandSource).not.toContain('export const tcbClosureTransactionRaceObserverV1');
  expect(tcbCommandSource).not.toContain('process.env.SEC_TCB');
  const applySource = tcbCommandSource.slice(
    tcbCommandSource.indexOf('async function executeTcbClosureLockCommandV1('),
    tcbCommandSource.indexOf('export async function CodexDevelopmentCiVerificationTcbClosureLockCliV1(')
  );
  expect(applySource.indexOf("mode === 'apply' && process.env.GITHUB_ACTIONS === 'true'"))
    .toBeLessThan(applySource.indexOf('withWorkspaceWriteLease(compilerRoot'));
  expect(applySource.indexOf('const raw = readTcbClosureArchiveRawDataV1('))
    .toBeLessThan(applySource.indexOf('if (targetSource === null) {'));
  const capturedRecoverySource = applySource.slice(
    applySource.indexOf('if (targetSource === null) {'),
    applySource.indexOf('const runtime = await loadTcbClosureRuntimeV1(targetSource);')
  );
  const rollbackIndex = capturedRecoverySource.indexOf("'TCB closure lock CAPTURED rollback'");
  const restoredLoadIndex = capturedRecoverySource.indexOf(
    'const runtime = await loadTcbClosureRuntimeV1(restoredTargetSource);'
  );
  const semanticCensusIndex = capturedRecoverySource.indexOf(
    'const preparedCensus = tcbClosureArchiveCensusV1(paths, preparedRaw, runtime);'
  );
  const replayIndex = capturedRecoverySource.indexOf('return completeTcbClosureApplyV1(');
  expect([rollbackIndex, restoredLoadIndex, semanticCensusIndex, replayIndex].every((index) => index >= 0))
    .toBe(true);
  expect([rollbackIndex, restoredLoadIndex, semanticCensusIndex, replayIndex])
    .toEqual([...new Set([rollbackIndex, restoredLoadIndex, semanticCensusIndex, replayIndex])]
      .sort((left, right) => left - right));
  expect(capturedRecoverySource.slice(0, rollbackIndex)).not.toContain('tcbClosureArchiveCensusV1(');
  expect(capturedRecoverySource.slice(0, rollbackIndex)).not.toContain('parseTcbClosureGeneratedRegionV2(');
  expect(capturedRecoverySource.slice(0, semanticCensusIndex)).not.toContain(
    "'TCB closure lock successor install'"
  );
  const currentPlanSource = tcbCommandSource.slice(
    tcbCommandSource.indexOf('async function currentTcbClosureLockPlanV1('),
    tcbCommandSource.indexOf('async function completeTcbClosureApplyV1(')
  );
  expect(currentPlanSource.indexOf("if (source === null) throw new Error('TCB closure lock target is missing"))
    .toBeLessThan(currentPlanSource.indexOf('await loadTcbClosureRuntimeV1(source)'));
  const completeApplySource = tcbCommandSource.slice(
    tcbCommandSource.indexOf('async function completeTcbClosureApplyV1('),
    tcbCommandSource.indexOf('async function executeTcbClosureLockCommandV1(')
  );
  expect(completeApplySource.indexOf('plannedArchive.recordName'))
    .toBeLessThan(completeApplySource.indexOf("'target',\n      stageName"));
  expect(completeApplySource.match(/transaction\.moveNoReplace\(/gu)).toHaveLength(2);
  expect(tcbCommandSource).toContain('archivePath: archive?.relativePath ?? null');
  expect(tcbCommandSource).toContain('archiveDigest: archive?.oldRawSourceDigest ?? null');
});

test('Quick and Full plan topology remains deterministic behind the Action normalizer', () => {
  expect(buildCiQuickGatePlan({ includeImports: true, includeDocs: true, includeRisk: true }).map(({ id }) => id))
    .toEqual(['imports', 'docs-doctor', 'typecheck', 'affected-tests', 'impact-risk']);
  expect(buildCiFullGatePlan().map(({ id }) => id)).toEqual([
    'imports', 'typecheck', 'docs-doctor', 'affected-tests', 'full-fast', 'test-budget', 'contract-freeze',
    'all-slow-risk', 'benchmark-task-suite', 'deps-warmup', 'resolve', 'compose', 'adapt', 'verify-all',
    'lock', 'explain', 'reference-check'
  ]);
  expect(CodexDevelopmentBuildVerificationPlanV1('full', [], undefined).gates.map(({ id }) => id))
    .not.toContain('docs-doctor');
  expect(CodexDevelopmentBuildVerificationPlanV1('full', null, undefined).gates.map(({ id }) => id))
    .toContain('docs-doctor');
  expect(() => assertCiExpectedHead('head-a', undefined)).toThrow('requires an exact expected head SHA');
  expect(() => assertCiExpectedHead('head-a', 'head-b')).toThrow('expected head-b, actual head-a');
  expect(() => assertCiExpectedHead('head-a', 'head-a')).not.toThrow();
});

test('exact-main health policy binds one stable GitHub Actions app and terminal context', async () => {
  expect(CI_MAIN_HEALTH_POLICY_V1).toEqual({
    schema: 'sec-ci-main-health-policy-v6',
    policyRevision: 'sec-ci-main-health-policy-v6',
    context: 'sec/main-health',
    app: { id: 15368, nodeId: 'MDM6QXBwMTUzNjg=', slug: 'github-actions' },
    producer: {
      identity: 'platform/shared/default-branch-revision-health.ts',
      sourceTransport: 'github-api',
      workflowPath: '.github/workflows/compiler-pr-validation.yml',
      workflowRefFormat: '.github/workflows/compiler-pr-validation.yml@<exact-main-sha>',
      eventNames: ['repository_dispatch'],
      runTitleFormats: {
        repositoryDispatch: 'SEC main health <exact-main-sha> operation <request-operation-id>',
        requestOperationId: 'sha256:<64-lowercase-hex>',
        requestSchema: 'sec-produce-main-health-request-v1',
        requestOperationIdentity: 'sha256-json-exact-main-v1'
      },
      branch: 'main'
    },
    terminal: {
      status: 'completed',
      conclusion: 'success',
      recognizedConclusions: [
        'success', 'failure', 'cancelled', 'skipped', 'timed_out',
        'action_required', 'neutral', 'stale', 'startup_failure'
      ]
    },
    convergence: {
      eventCardinality: 'at-most-one-per-allowed-event',
      terminalOutcomeIdentity: 'status-conclusion',
      failureFingerprintIdentity: 'policy-context-head-status-conclusion',
      sourceDigestIdentity: 'policy-and-canonical-matching-subset',
      ambiguousDisposition: 'locked'
    },
    degraded: {
      owner: 'ci-verification-maintainer',
      repairIdentityPolicy: 'exact-main-tree-failure-v1',
      allowedLanes: ['repair']
    },
    locked: { allowedLanes: [] }
  });
  expect(createCiMainHealthRequestOperationIdV1('93dde9e44bbcffdd7fa1d6be726df1725947f6e2'))
    .toBe('sha256:1062f573e4a315b308f46c6abd9a82815fdaa97a3b2171f0cb8b806467473a78');
  expect(CI_MAIN_HEALTH_POLICY_DIGEST_V1).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(CI_MAIN_HEALTH_JOB_ID).toBe('main-health');
  expect(CI_MAIN_HEALTH_JOB_NAME).toBe('sec/main-health');
  expect(CI_MAIN_HEALTH_STEP_ORDER).toHaveLength(9);
  expect(CI_MAIN_HEALTH_COMMANDS).toEqual([
    'bun install --frozen-lockfile',
    'bun run imports:check',
    'bun run typecheck',
    'bun run docs:doctor',
    'bun run test:fast'
  ]);
  const contract = buildCiContract();
  expect(contract.mainHealthContext).toBe(CI_MAIN_HEALTH_JOB_NAME);
  expect(contract.mainHealthPolicyDigest).toBe(CI_MAIN_HEALTH_POLICY_DIGEST_V1);
  expect(contract.mainHealthStepOrder).toEqual([...CI_MAIN_HEALTH_STEP_ORDER]);
  expect(contract.mainHealthCommands).toEqual([...CI_MAIN_HEALTH_COMMANDS]);
  const workflow = parseYaml(await readCompilerFile('.github/workflows/compiler-pr-validation.yml')) as Workflow;
  const job = workflow.jobs[CI_MAIN_HEALTH_JOB_ID]!;
  expect(job.name).toBe(CI_MAIN_HEALTH_JOB_NAME);
  expect(job.if).toBe("${{ github.event_name == 'repository_dispatch' && github.event.action == 'sec-produce-main-health-v1' }}");
  expect(job.concurrency).toEqual({
    group: 'sec-main-health-${{ github.event.client_payload.payload.mainSha }}',
    'cancel-in-progress': false,
    queue: 'max'
  });
  expect(job.steps.map((step) => step.name)).toEqual([...CI_MAIN_HEALTH_STEP_ORDER]);
  expect(job.steps.map((step) => step.id)).toEqual([
    undefined, 'checkout-main', 'setup-bun', 'cache-bun', 'install', 'imports-check', 'typecheck',
    'docs-doctor', 'test-fast'
  ]);
  expect(job.steps.filter((step) => step.run).map((step) => step.run)).toEqual([...CI_MAIN_HEALTH_COMMANDS]);
  expect((workflow.on as Record<string, unknown>).push).toBeUndefined();
  expect(job.steps[0]?.if).toBe("${{ github.event_name == 'repository_dispatch' }}");
  expect(job.steps[1]?.with).toMatchObject({
    ref: '${{ github.event.client_payload.payload.mainSha }}',
    'persist-credentials': false
  });
  expect(job.steps[2]?.with).toMatchObject({ 'bun-version-file': '.bun-version' });
  expect(job.steps[3]?.uses).toBe('actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830');
});


test('trusted base candidate root bootstrap checker is disjoint and candidate remains data', async () => {
  const source = await readCompilerFile('.github/workflows/sec-trusted-bootstrap.yml');
  const verificationSource = await readCompilerFile('scripts/ci-verification.ts');
  const tcbSource = await readCompilerFile('platform/shared/tcb-closure-lock.ts');
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
    'Checkout exact trusted base checker',
    'Checkout exact candidate as data',
    'Preflight exact trusted-base checkout',
    'Setup trusted-base Bun runtime',
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
  const preRun = pre.run;
  if (typeof preRun !== 'string') throw new Error('Trusted bootstrap PRE step must define a run script.');
  expect(preRun).toContain('importFromTrustedBase("platform/shared/tcb-closure-lock.ts")');
  expect(preRun).toContain('importFromTrustedBase("platform/shared/tcb-trust-root-contract.ts")');
  expect(preRun).toContain('createTcbClosureCandidateSnapshotV1');
  expect(preRun).toContain('finalizeTcbClosureCandidateSnapshotV1(baseSnapshot)');
  expect(preRun).toContain('finalizeTcbClosureCandidateSnapshotV1(candidateSnapshot)');
  expect(preRun).toMatch(/candidateClosure,\s+candidateSnapshotOptions/u);
  expect(preRun).toMatch(/readTcbClosureCandidateFileV1\(\s+"platform\/shared\/tcb-closure-lock\.ts",\s+candidateSnapshotOptions/u);
  expect(preRun).toContain('parseTcbClosureGeneratedRegionV2(candidateLockText).lock');
  expect(preRun).toContain('assertTcbClosureLockDataMatchesV2(parsedCandidateLock, candidateLock)');
  expect(preRun).toContain('candidate-lock-v2-generated-region-invalid');
  expect(preRun).toContain('candidate-closure-computation-failed');
  expect(preRun).toContain('candidate-lock-does-not-match-base-computed-closure');
  expect(preRun).toContain('const hardFailureReasons = new Set()');
  expect(preRun).toContain('trusted-base-lock-substitution-drift');
  expect(preRun).toContain('const substitutionKinds = new Map()');
  expect(preRun).toContain('closureDigestFailureCount === 1');
  expect(preRun).toContain('kinds.has("blob") && kinds.has("content digest")');
  expect(preRun).toContain('if (!substitutionOnlyDrift)');
  expect(preRun.indexOf('if (!substitutionOnlyDrift)'))
    .toBeLessThan(preRun.indexOf('manualReasons.add("trusted-base-lock-substitution-drift")'));
  expect(preRun).toContain('hardFailureReasons.size > 0');
  expect(preRun.indexOf('hardFailureReasons.size > 0'))
    .toBeLessThan(preRun.indexOf('manualReasons.size > 0'));
  expect(preRun).not.toContain('parseTcbClosureLockSourceV1');
  expect(preRun).not.toContain('assertTcbClosureLockDataMatchesV1');
  expect(preRun).not.toContain('candidate-lock-trust-revision-is-not-exact-base-epoch');
  expect(preRun).not.toContain('const expectedTrustRevision = expectedBase');
  expect(preRun).toContain('["rev-list", "--parents", "-n", "1", "HEAD"]');
  expect(preRun).toContain('GIT_NO_REPLACE_OBJECTS = "1"');
  expect(preRun).not.toContain('HEAD^1');
  expect(preRun).toContain('candidate-registry-differs-from-trusted-base-policy');
  expect(preRun).toContain('candidate-causal-closure-differs-from-trusted-base-closure');
  expect(preRun).toContain(
    'registryContract.matchSecTrustedBootstrapPathV3(repositoryPath, baseTrustRoot) !== null'
  );
  expect(preRun).not.toContain('!causalRuntimePaths.has(repositoryPath)');
  expect(preRun).not.toContain('baseUndecidableCausalPaths');
  const r2ChangedPaths = [
    '.github/workflows/sec-trusted-bootstrap.yml',
    'docs/work-packages/trusted-bootstrap-base-first-repair-v1.md',
    'docs/work-packages/verification-action-kernel-finalization-v1.md',
    'docs/work/active-work-package.md',
    'docs/work/rolling-plan.md',
    'platform/shared/tcb-closure-lock.ts',
    'tests/contract/ci-contract.test.ts',
    'tests/contract/documentation-authority.test.ts',
    'tests/contract/tcb-closure-lock.test.ts'
  ];
  expect(r2ChangedPaths
    .filter((repositoryPath) =>
      matchSecTrustedBootstrapPathV3(repositoryPath, TCB_TRUST_ROOT_V3) !== null
    )
    .sort()).toEqual([
    '.github/workflows/sec-trusted-bootstrap.yml',
    'platform/shared/tcb-closure-lock.ts'
  ]);
  expect(preRun).toContain('SEC_BOOTSTRAP_PHASE=pre');
  const sutSteps = workflow.jobs['candidate-sut']?.steps ?? [];
  expect(sutSteps.some((step) => step.name === 'Checkout exact trusted base checker')).toBe(false);
  expect(sutSteps.some((step) => step.uses?.includes('download-artifact'))).toBe(false);
  expect(JSON.stringify(sutSteps)).not.toContain('bootstrap-pre');
  expect(JSON.stringify(sutSteps)).not.toContain('checker.mjs');
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
  const sutRun = step(workflow, 'candidate-sut', 'Run candidate SUT through trusted private sandbox').run;
  if (typeof sutRun !== 'string') {
    throw new Error('candidate SUT regression must be one shell program.');
  }
  expect(sutRun).toContain('bun scripts/ci-verification.ts execute-trusted-bootstrap-sut');
  expect(sutRun).toContain('--base-root "$GITHUB_WORKSPACE"');
  expect(sutRun).toContain('--candidate-root "$CANDIDATE_ROOT"');
  expect(step(workflow, 'candidate-sut', 'Run candidate SUT through trusted private sandbox').env)
    .toMatchObject({
      SUT_EVIDENCE_ROOT: '${{ runner.temp }}/sec-trusted-bootstrap-sut-${{ github.run_id }}-${{ github.run_attempt }}'
    });
  expect(verificationSource).toContain('CodexDevelopmentAssertTrustedBootstrapSutMaterializationCleanV1');
  expect(verificationSource).toContain(':(top,exclude,literal)');
  expect(verificationSource).toContain(
    "['status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching']"
  );
  expect(sutRun).not.toContain('cd "$CANDIDATE_ROOT"');
  expect(sutRun).not.toContain('bun run imports:check');
  expect(sutRun).not.toContain('bun test');
  expect(sutSteps.some((candidate) =>
    candidate.name === 'Install candidate SUT dependencies without lifecycle scripts')).toBe(false);
  expect(verificationSource).toContain("phase: 'capability-self-test' | 'execute' | 'bootstrap-execute' | 'teardown'");
  expect(verificationSource).toContain('CodexDevelopmentBuildTrustedBootstrapSutSandboxCommandPlanV1');
  expect(verificationSource).toContain("'--mount', '--pid', '--fork', '--kill-child=KILL', '--net'");
  expect(verificationSource).toContain('CodexDevelopmentTrustedBootstrapSutHarnessV1');
  expect(verificationSource).toContain('CodexDevelopmentMaterializeTrustedBootstrapArchiveV3');
  expect(verificationSource).toContain('tarfile.open(fileobj=output_stream');
  expect(verificationSource).toContain('os.readlink("", dir_fd=link_fd)');
  expect(verificationSource).toContain('HOSTED_SUT_RETAINED_ARCHIVE_CHILD_PATH_V1');
  expect(verificationSource).not.toContain("'-C', candidateRoot, '.', '-C', baseRoot, 'node_modules'");
  expect(verificationSource).not.toContain("['-a', '--', baseNodeModules, candidateRoot]");
  expect(verificationSource).toContain('CI_VERIFICATION_ACTION_SANDBOX_RESIDUE_MARKER_V1');
  expect(verificationSource).toContain("schema: 'sec-trusted-bootstrap-sut-receipt-v2'");
  expect(verificationSource).toContain("BUN_INSTALL_CACHE_DIR: '/tmp/sec-hosted-dependency-home/.bun/install/cache'");
  expect(JSON.stringify(preSteps)).not.toContain('tcb-closure-lock --mode check');
  const postSteps = workflow.jobs['checker-post']?.steps ?? [];
  expect(JSON.stringify(postSteps)).not.toContain('tcb-closure-lock --mode check');
  expect(postSteps.map((step) => step.name)).toEqual([
    'Initialize fail-closed final evidence envelope',
    'Checkout exact trusted base reducer',
    'Checkout exact candidate as POST data',
    'Preflight exact trusted-base checkout',
    'Setup trusted-base Bun runtime for reducer',
    'Install trusted-base reducer dependencies without lifecycle scripts',
    'Download bounded checker PRE artifact',
    'Download bounded candidate SUT artifact',
    'Recompute POST and reduce exact bootstrap evidence',
    'Upload final canonical trusted bootstrap evidence'
  ]);
  const postPreflight = step(workflow, 'checker-post', 'Preflight exact trusted-base checkout');
  expect(postPreflight.env).toEqual(preflight.env);
  expect(postPreflight.run).toBe(preflight.run);
  if (typeof preflight.run !== 'string') {
    throw new Error('trusted bootstrap preflight must be one workflow-owned shell program.');
  }
  for (const binding of [
    'node <<\'NODE\'',
    'lstatSync(logicalRoot)',
    'metadata.isDirectory()',
    'metadata.isSymbolicLink()',
    'realpathSync.native(logicalRoot)',
    'physicalRoot !== logicalRoot',
    '["rev-parse", "--show-toplevel"]',
    '["rev-parse", "--verify", "HEAD^{commit}"]',
    '["rev-parse", "--verify", "HEAD^{tree}"]',
    '["status", "--porcelain=v1", "--untracked-files=all"]',
    '.filter(([name]) => !name.startsWith("GIT_"))',
    'GIT_NO_REPLACE_OBJECTS = "1"',
    '["--no-replace-objects", "-C", physicalRoot, ...args]'
  ]) expect(preflight.run).toContain(binding);
  expect(preflight.run).not.toContain('bun ');
  expect(preflight.run).not.toContain('checker.mjs');
  expect(preflight.run).not.toContain('importFromTrustedBase');
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
  expect(postSteps.some((step) => step.name === 'Install candidate SUT dependencies without lifecycle scripts'))
    .toBe(false);
  const post = step(workflow, 'checker-post', 'Recompute POST and reduce exact bootstrap evidence');
  expect(post.env).toMatchObject({
    BOOTSTRAP_EVIDENCE_ROOT: '${{ runner.temp }}/sec-trusted-bootstrap-pre-${{ github.run_id }}-${{ github.run_attempt }}',
    SUT_EVIDENCE_ROOT: '${{ runner.temp }}/sec-trusted-bootstrap-sut-${{ github.run_id }}-${{ github.run_attempt }}',
    FINAL_EVIDENCE_ROOT: '${{ runner.temp }}/sec-trusted-bootstrap-final-${{ github.run_id }}-${{ github.run_attempt }}',
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
  expect(postRun.indexOf('postReceipt.authorityVerdict === "manual-bootstrap-required"'))
    .toBeLessThan(postRun.indexOf('postReceipt.auxiliaryStatus === "passed"'));
  expect(postRun).toContain('status = "incomplete"');
  expect(postRun).toContain('test "$(node -p');
  expect(postRun).toContain('renameSync(temporary, envelopePath)');
  expect(postRun).toContain(
    'sha256sum environment.txt final-envelope.json post-receipt.json pre-receipt.json sut-diagnostic.json > SHA256SUMS.tmp'
  );
  expect(postRun.indexOf('renameSync(temporary, envelopePath)'))
    .toBeLessThan(postRun.indexOf('sha256sum environment.txt final-envelope.json'));
  expect(postRun).toContain('mv SHA256SUMS.tmp SHA256SUMS');
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
  const workflowTransport = JSON.stringify([
    pre.env,
    preUpload.with,
    step(workflow, 'candidate-sut', 'Run candidate SUT through trusted private sandbox').env,
    sutUpload.with,
    initialize.env,
    preDownload.with,
    sutDownload.with,
    post.env,
    finalUpload.with
  ]);
  expect(workflowTransport).not.toContain('${{ github.workspace }}/bootstrap-pre');
  expect(workflowTransport).not.toContain('${{ github.workspace }}/sut-evidence');
  expect(workflowTransport).not.toContain('${{ github.workspace }}/bootstrap-final');
  expect(finalUpload.with?.name).toBe(
    'sec-trusted-bootstrap-v1-pr-${{ needs.resolve.outputs.pull-request }}-base-${{ needs.resolve.outputs.base }}-head-${{ needs.resolve.outputs.head }}-run-${{ github.run_id }}-attempt-${{ github.run_attempt }}'
  );
  expect(preRun).toContain('trusted bootstrap PRE and POST candidate closure receipts differ');
  for (const binding of [
    'checkerBaseSha',
    'baseTreeSha',
    'candidateHeadSha',
    'candidateTreeSha',
    'candidateParentSha',
    'checkerClosureDigest',
    'candidateClosureDigest',
    'candidateFrozenClosureDigest',
    'candidateLockSourceDigest',
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
  ]) expect(preRun).toContain(binding);
  expect(preRun).toContain('trusted-base-cannot-decide-checker-policy-or-validation-plan-change');
  expect(preRun).toContain('auxiliaryStatus = "invalid"');
  expect(source).not.toContain('x-access-token');
  expect(source).not.toContain('Generate candidate TCB closure snapshot');
  expect(source).not.toContain("import('./platform/shared/tcb-closure-lock.ts')");
  expect(source).not.toContain('generateTcbClosureLockForRevision');
  expect(tcbSource).not.toContain('generateTcbClosureLockForRevision');
  expect(tcbSource).not.toContain('trustedBaseRevision');
  expect(source).toContain("registry.schema !== 'sec-trusted-bootstrap-registry-v3'");
  expect(source).not.toContain('sec-trusted-bootstrap-registry-v2');
  expect(source).toContain('reviewedBoundaryEdges.some');
  expect(source.match(/tcb-closure-lock --mode check/gu) ?? []).toHaveLength(0);
  expect(verificationSource.match(/"tcb-closure-lock", "--mode", "check"/gu) ?? []).toHaveLength(2);
  expect(verificationSource).toContain("from '../platform/shared/tcb-closure-lock.ts'");
  expect(verificationSource).toContain("import('../platform/shared/tcb-closure-lock.ts')");
});


test('trusted bootstrap and release readers share the exact registry V3 policy plus generated closure owner', async () => {
  const [bootstrapSource, releaseSource, verificationSource] = await Promise.all([
    readCompilerFile('.github/workflows/sec-trusted-bootstrap.yml'),
    readCompilerFile('.github/workflows/compiler-release-validation.yml'),
    readCompilerFile('scripts/ci-verification.ts')
  ]);
  const bootstrap = parseYaml(bootstrapSource) as Workflow;
  const release = parseYaml(releaseSource) as Workflow;
  const registryKeys = [
    'reviewedBoundaryEdges', 'reviewedSutEdges', 'runtimeEntrypoints', 'schema',
    'staticDirectoryPaths', 'staticExactPaths', 'staticPrefixes'
  ];
  for (const source of [bootstrapSource, releaseSource]) {
    expect(source).toContain("registry.schema !== 'sec-trusted-bootstrap-registry-v3'");
    expect(source).not.toContain('sec-trusted-bootstrap-registry-v2');
    expect(source).toContain('JSON.stringify(Object.keys(registry).sort()) !== JSON.stringify(registryKeys)');
    expect(source).toContain("'scripts/ci-verification.ts -> platform/shared/tcb-closure-lock.ts'");
    expect(source).toContain("'scripts/codex/verification-session.ts -> platform/shared/tcb-closure-lock.ts'");
    expect(source).toContain('reviewedBoundaryEdges.some');
    for (const key of registryKeys) expect(source).toContain(`'${key}'`);
    expect(source).toContain("const lockRegionStartMarker = '// <sec-tcb-closure-lock-generated-v2>\\n'");
    expect(source).toContain("const lockRegionEndMarker = '\\n// </sec-tcb-closure-lock-generated-v2>'");
    expect(source).toContain('const lockStart = lockRegion.indexOf(lockPrefix)');
    expect(source).toContain("const lockPrefix = 'export const TCB_CLOSURE_LOCK: TcbClosureLock = '");
    expect(source).toContain('const causalRuntimePaths = lock.modules');
  }
  expect(bootstrap.permissions).toEqual({ contents: 'read', 'pull-requests': 'read' });
  expect(release.permissions).toEqual({ contents: 'read' });
  expect(bootstrapSource).toContain('headCommit.data.parents.length !== 1');
  expect(bootstrapSource).toContain('headCommit.data.parents[0].sha !== currentBase');
  expect(releaseSource).toContain('manual-bootstrap-required: release ref changes the verifier trust root.');
  for (const source of [bootstrapSource, releaseSource]) {
    expect(source).not.toContain('pulls.merge');
    expect(source).not.toContain('gh pr merge');
    expect(source).not.toContain('IntegrationAuthorization');
    expect(source).not.toContain('--admin');
    const actionRefs = [...source.matchAll(/uses:\s+[^\s@]+@([^\s#]+)/gu)].map((match) => match[1]!);
    expect(actionRefs.length).toBeGreaterThan(0);
    expect(actionRefs.every((ref) => /^[0-9a-f]{40}$/u.test(ref))).toBe(true);
  }
  expect(bootstrapSource.match(/tcb-closure-lock --mode check/gu) ?? []).toHaveLength(0);
  expect(verificationSource.match(/"tcb-closure-lock", "--mode", "check"/gu) ?? []).toHaveLength(2);
  expect(releaseSource.match(/tcb-closure-lock --mode check/gu)).toHaveLength(1);
  expect(bootstrapSource).not.toContain('generateTcbClosureLockForRevision');
});

test('VerificationSession assigns detached local scratch cleanup solely to Issue 186 physical closeout', async () => {
  const source = await readCompilerFile('scripts/codex/verification-session.ts');
  const cleanup = source.slice(source.indexOf('async function removeLocalCandidateWorktreeV1('),
    source.indexOf('async function executePreparedLocalQuickDagV2('));
  expect(cleanup).toContain('prepareDetachedScratchWorktreePhysicalCloseoutV1');
  expect(cleanup).toContain('executeDetachedScratchWorktreePhysicalCloseoutV1');
  expect(cleanup).toContain('expectedRecoveryAuthorityDigest: observed.ownerDigest');
  expect(cleanup).toContain("receipt.terminal !== 'completed'");
  expect(cleanup).toContain('receipt.readback.registryPresent || receipt.readback.physicalPresent');
  expect(cleanup).not.toContain("'worktree', 'remove'");
  expect(cleanup).not.toContain('WorktreePhysicalCloseoutConsumptionTokenV1');
  expect(cleanup).not.toContain('assertTrustedCompletedWorktreePhysicalCloseoutV1');
});
