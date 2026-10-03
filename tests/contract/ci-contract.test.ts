import { expect, test } from 'bun:test';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { assertCiVerificationPerJobHostedWholeWorkflowShape, assertCiVerificationPerJobHostedWorkflowShape, CI_VERIFICATION_PER_JOB_HOSTED_JOB_POLICIES, getCiVerificationPerJobHostedJobPolicy } from '../../src/adapters/providers/github-api/contract/hosted-job-policy.ts';
import { SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY } from '../../src/adapters/providers/linux-verification/contract.ts';
import { buildCiVerificationActionPlanClosure, CI_VERIFICATION_ACTION_DISPATCH_TYPE, CI_VERIFICATION_ACTION_PARENT_DISPATCH_PLAN_FILE, CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT, CI_VERIFICATION_PER_JOB_HOSTED_EXECUTION_ENVIRONMENT, parseCiVerificationHostedExecutionEnvironment, resolveCiVerificationHostedExecutionEnvironment } from '../../src/adapters/verification/platform/action/contract/ci.ts';
import { CI_VERIFICATION_HOSTED_PROVIDER_REVISION, CI_VERIFICATION_HOSTED_TOOLCHAIN_REVISION, CI_VERIFICATION_PER_JOB_HOSTED_PROVIDER_REVISION, createCiVerificationHostedProviderRevision, createCiVerificationHostedToolchainRevision, createCiVerificationPerJobHostedProviderRevision } from '../../src/adapters/verification/platform/action/contract/environment.ts';
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
  '.github/workflows/merge-gate.yml': {
    plan: 'trusted',
    authorize: 'control',
    'terminal-status': 'trusted',
    integrate: 'control'
  },
  '.github/workflows/trusted-bootstrap.yml': {
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

test('per-job identity keeps the exact historical provider and active default unchanged', () => {
  expect(CI_VERIFICATION_HOSTED_PROVIDER_REVISION).toBe(
    'github-actions:self-hosted:ubuntu-24.04:x64:sec-linux-verification-v1:roles-control-trusted-sut-v1:'
    + 'runner-2.336.0:node-24.19.0:python-3.12.3:unzip-6.00:gh-2.97.0:'
    + 'gh-archive-sha256-a2c9b8497e1f85b1ad0dfcb78b5a622e098801b8e461e459e88e1ee12f018112:'
    + 'image-sha256-859df0e6886706c1c91b3b529397421ffd08a0d1ffed58df8b3019f187b859b1:'
    + 'container-init-v1:bun-1.4.0:action-producer-v2:sandbox-v7'
  );
  expect(CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT.executionEnvironmentRevision)
    .toBe(CI_VERIFICATION_HOSTED_PROVIDER_REVISION);
  expect(CI_VERIFICATION_PER_JOB_HOSTED_PROVIDER_REVISION)
    .not.toBe(CI_VERIFICATION_HOSTED_PROVIDER_REVISION);
  expect(CI_VERIFICATION_PER_JOB_HOSTED_PROVIDER_REVISION.length).toBeLessThanOrEqual(512);
  expect(CI_VERIFICATION_PER_JOB_HOSTED_PROVIDER_REVISION).toMatch(
    /^github-actions:github-hosted:ubuntu-24\.04:x64:per-job-v1:execution-policy-sha256:[0-9a-f]{64}:action-producer-v2:sandbox-v7:outer-job-container-v1$/u
  );
});

test('hosted environment data decodes only the two exact profiles and preserves old wire bytes', () => {
  const legacy = CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT;
  const perJob = CI_VERIFICATION_PER_JOB_HOSTED_EXECUTION_ENVIRONMENT;
  expect(perJob.executionEnvironmentRevision).toBe(CI_VERIFICATION_PER_JOB_HOSTED_PROVIDER_REVISION);
  for (const environment of [legacy, perJob]) {
    const wire = JSON.stringify(environment);
    expect(parseCiVerificationHostedExecutionEnvironment(JSON.parse(wire))).toBe(environment);
    expect(JSON.stringify(parseCiVerificationHostedExecutionEnvironment(JSON.parse(wire)))).toBe(wire);
    expect(resolveCiVerificationHostedExecutionEnvironment(environment.executionEnvironmentRevision)).toBe(environment);
    expect(Object.isFrozen(environment)).toBe(true);
    for (const [key, value] of Object.entries({
      contractRevision: 'foreign', kind: 'local', os: 'darwin', arch: 'arm64',
      runnerImage: 'self-hosted', toolchainRevision: 'foreign', executionEnvironmentRevision: 'foreign'
    })) {
      expect(() => parseCiVerificationHostedExecutionEnvironment({ ...environment, [key]: value })).toThrow();
    }
    expect(() => parseCiVerificationHostedExecutionEnvironment({ ...environment, qualified: true })).toThrow();
    const { runnerImage: _runnerImage, ...missingImage } = environment;
    expect(() => parseCiVerificationHostedExecutionEnvironment(missingImage)).toThrow();
  }
  for (const revision of ['github-actions@trusted-default', 'ubuntu-24.04',
    `${CI_VERIFICATION_PER_JOB_HOSTED_PROVIDER_REVISION}:trusted`, '']) {
    expect(() => resolveCiVerificationHostedExecutionEnvironment(revision)).toThrow();
  }
  for (const value of [null, [], 'github-hosted-per-job-v1', { executionEnvironmentRevision: 1 }]) {
    expect(() => parseCiVerificationHostedExecutionEnvironment(value)).toThrow();
  }
});

test('per-job provider identity invalidates every changed immutable execution input', () => {
  const authority = SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY;
  const changedDigest = `sha256:${'f'.repeat(64)}` as const;
  const changes = [
    { ...authority, image: { ...authority.image, runtimeContentDigest: changedDigest } },
    { ...authority, image: { ...authority.image, dockerProjectionDigest: changedDigest } },
    { ...authority, trustedRuntime: { ...authority.trustedRuntime, imageDigest: changedDigest } },
    { ...authority, trustedRuntime: { ...authority.trustedRuntime, bunExecutableDigest: changedDigest } },
    { ...authority, trustedRuntime: { ...authority.trustedRuntime, bunArchiveDigest: changedDigest } },
    { ...authority, trustedRuntime: { ...authority.trustedRuntime, bunExecutablePath: '/other/bun' } },
    { ...authority, provider: { ...authority.provider, sourcePolicyRevision: 'changed-source-policy' } },
    { ...authority, runtime: { ...authority.runtime, resources: {
      ...authority.runtime.resources, sut: { ...authority.runtime.resources.sut, pids: 257 }
    } } }
  ];
  const revisions = changes.map(createCiVerificationPerJobHostedProviderRevision);
  for (const revision of revisions) expect(revision).not.toBe(CI_VERIFICATION_PER_JOB_HOSTED_PROVIDER_REVISION);
  expect(new Set(revisions).size).toBe(changes.length);
});

test('real Action planner separates placement keys and agrees with the declared producer revision', () => {
  const digest = `sha256:${'a'.repeat(64)}` as const;
  const plan = (providerRevision: string) => buildCiVerificationActionPlanClosure({
    candidate: {
      baseSha: '1'.repeat(40), baseTreeSha: '2'.repeat(40),
      headSha: '3'.repeat(40), headTreeSha: '4'.repeat(40),
      manifestPath: 'config/repository/work-packages/example-v1.md',
      manifestDigest: digest, scopeAuthorizationRevision: digest, profile: 'quick',
      toolchainRevision: CI_VERIFICATION_HOSTED_TOOLCHAIN_REVISION,
      providerRevision, contractRevision: 'ci-verification-v19',
      requiredBlobs: ['.bun-version', 'bun.lock', 'bunfig.toml', 'package.json'].map((path) => ({ path, digest }))
    },
    gates: [{ id: 'hosted-placement-contract', phase: 'quick',
      argv: ['bun', 'test', 'tests/contract/ci-contract.test.ts'], runtime: 'bun',
      environment: {}, coveredScopeIds: [] }]
  });
  const legacy = plan('github-actions@trusted-default');
  const perJob = plan(CI_VERIFICATION_PER_JOB_HOSTED_PROVIDER_REVISION);
  expect(perJob.actions[0]?.action.actionKey).not.toBe(legacy.actions[0]?.action.actionKey);
  expect(legacy.actions[0]?.action.environment.providerRevision).toBe(CI_VERIFICATION_HOSTED_PROVIDER_REVISION);
  expect(perJob.actions[0]?.action.environment.providerRevision).toBe(CI_VERIFICATION_PER_JOB_HOSTED_PROVIDER_REVISION);
  const declaredProducer = /:(action-producer-v[0-9]+):/u.exec(CI_VERIFICATION_PER_JOB_HOSTED_PROVIDER_REVISION)?.[1];
  expect(declaredProducer).toBeDefined();
  expect(`sec-ci-verification-${declaredProducer}`).toBe(perJob.producerRevision);
  expect(perJob.actions[0]?.action.producer.revision).toBe(perJob.producerRevision);
  expect(perJob.actions[0]?.action.operation.revision).toBe(perJob.producerRevision);
});

test('closed per-job policy preserves every authored job id, role, name, event and deadline', async () => {
  const policies = CI_VERIFICATION_PER_JOB_HOSTED_JOB_POLICIES;
  const identities = new Set(policies.map(({ workflowPath, jobId }) => `${workflowPath}#${jobId}`));
  expect(identities.size).toBe(policies.length);
  for (const [workflowPath, expectedRoles] of Object.entries(WORKFLOW_RUNNER_ROLES)) {
    const workflow = parseYaml(await readCompilerFile(workflowPath)) as Workflow;
    const roleById: Readonly<Record<string, typeof policies[number]['role']>> = expectedRoles;
    const members = policies.filter((policy) => policy.workflowPath === workflowPath);
    const jobIds: string[] = members.map(({ jobId }) => jobId);
    expect(jobIds.sort()).toEqual(Object.keys(workflow.jobs).sort());
    for (const policy of members) {
      const authored = workflow.jobs[policy.jobId]!;
      expect(policy.role).toBe(roleById[policy.jobId]);
      expect(policy.jobName).toBe(authored.name ?? policy.jobId);
      expect(policy.maximumJobDurationMs).toBe(authored['timeout-minutes']! * 60_000);
      expect(policy.runnerLabel).toBe('ubuntu-24.04');
      expect(policy.allocation).toBe('github-managed-per-job');
      if (policy.trigger.eventName === 'repository_dispatch') {
        for (const action of policy.trigger.actions) expect(workflow.on.repository_dispatch?.types).toContain(action);
      } else {
        expect(workflow.on.workflow_run?.types).toEqual(['completed']);
        expect(workflow.on.workflow_run?.workflows).toEqual(['compiler-pr-validation']);
        expect(policy.trigger.sourceWorkflowPath).toBe('.github/workflows/compiler-pr-validation.yml');
      }
    }
  }
});

test('per-job workflow tokens cannot delete active wake history through Actions write', () => {
  for (const policy of CI_VERIFICATION_PER_JOB_HOSTED_JOB_POLICIES) {
    const grants: Readonly<Record<string, string>> | null = policy.requiredPermissions;
    if (policy.runtime.kind === 'per-job-runtime') expect(grants?.actions).toBe('read');
  }
  for (const id of ['claim-verification-action', 'assemble-verification-action-terminal']) {
    const policy = CI_VERIFICATION_PER_JOB_HOSTED_JOB_POLICIES.find(policy => policy.jobId === id)!;
    expect(policy.requiredPermissions).toMatchObject({ actions: 'read', statuses: 'write' });
  }
});

test('only each actual runtime job requires its own origin; API-only jobs receive none', async () => {
  const policies = CI_VERIFICATION_PER_JOB_HOSTED_JOB_POLICIES;
  for (const policy of policies) {
    const workflow = parseYaml(await readCompilerFile(policy.workflowPath)) as Workflow;
    const authored = workflow.jobs[policy.jobId]!;
    const apiOnly = authored.steps.every(({ uses }) => uses?.startsWith('actions/github-script@') === true);
    expect(policy.runtime.kind === 'api-only').toBe(apiOnly);
    if (policy.runtime.kind === 'per-job-runtime') {
      expect(policy.runtime.oidcPermission).toBe('id-token:write');
      expect(policy.runtime.launcherPath).toBe('src/adapters/verification/platform/ci/runtime/hosted-job-runtime.ts');
      expect(policy.runtime.sourceAdmission).toBe('authenticated-current-default-at-issuance');
      expect(policy.runtime.sourceRetention).toBe('exact-original-source-through-operation-settlement');
      expect(policy.runtime.candidateCredentialBoundary)
        .toBe('no-host-credentials-descriptors-sockets-or-actions-files');
    } else expect(policy.runtime.oidcPermission).toBeNull();
    // Source preparation is not permission activation, and cannot silently
    // substitute a native VM for the physical execution environment.
    expect(authored.permissions?.['id-token']).toBeUndefined();
    expect(workflow.permissions?.['id-token']).toBeUndefined();
    expect(authored['runs-on']).toEqual([
      ...LOCAL_LINUX_RUNNER_LABELS, LOCAL_LINUX_RUNNER_ROLE_LABELS[policy.role]
    ]);
  }
  expect(policies.filter(({ runtime }) => runtime.kind === 'per-job-runtime')).toHaveLength(14);
  expect(policies.filter(({ runtime }) => runtime.kind === 'api-only')).toHaveLength(5);
});

test('policy lookup uses exact authored identity and returns an immutable source member', () => {
  const workflowPath = '.github/workflows/compiler-pr-validation.yml';
  const policy = getCiVerificationPerJobHostedJobPolicy(workflowPath, 'main-health');
  expect(policy?.jobName).toBe('sec/main-health');
  expect(policy).toBe(CI_VERIFICATION_PER_JOB_HOSTED_JOB_POLICIES.find(({ jobId }) => jobId === 'main-health')!);
  expect(getCiVerificationPerJobHostedJobPolicy(workflowPath, 'sec/main-health')).toBeNull();
  expect(getCiVerificationPerJobHostedJobPolicy('.github/workflows/foreign.yml', 'main-health')).toBeNull();
  expect(getCiVerificationPerJobHostedJobPolicy(workflowPath, 'MAIN-HEALTH')).toBeNull();
  expect(getCiVerificationPerJobHostedJobPolicy(workflowPath, '../main-health')).toBeNull();
  expect(Object.isFrozen(policy)).toBe(true);
  expect(Object.isFrozen(policy?.runtime)).toBe(true);
  expect(Object.isFrozen(policy?.trigger.actions)).toBe(true);
});

function perJobPreflightWorkflowFixture() {
  return {
    name: 'compiler-pr-validation',
    on: { repository_dispatch: { types: [
      'sec-verify-session-v2', 'sec-produce-verification-action-v2',
      'sec-produce-main-health-v1', 'sec-produce-agent-operation-activation-v1'
    ] } },
    jobs: { 'preflight-verification-action-sut': {
      'runs-on': 'ubuntu-24.04', 'timeout-minutes': 10,
      permissions: { actions: 'read', contents: 'read', 'id-token': 'write' },
      steps: [
        { name: 'Checkout exact trusted hosted launcher',
          uses: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
          with: { ref: '${{ github.workflow_sha }}', 'fetch-depth': 0, 'persist-credentials': false } },
        { name: 'Setup exact trusted bootstrap Bun',
          uses: 'oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6', with: { 'bun-version': '1.4.0' } },
        { name: 'Verify exact bootstrap Bun bytes', shell: 'bash',
          run: "set -euo pipefail\nprintf '%s  %s\\n' '33d56b070be6a9e3da0ab013038b43d1645d0534ca811ecdba4472599117eb4b' \"$(command -v bun)\" | sha256sum --check --strict" },
        { name: 'Install exact trusted launcher dependencies', shell: 'bash',
          run: 'exec bun --no-env-file install --frozen-lockfile --ignore-scripts' },
        { name: 'Download trusted Action resolution transport', id: 'download-resolution',
          uses: 'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c',
          if: "${{ needs.resolve-verification-action.outputs.resolution-artifact-name != '' }}",
          with: { name: '${{ needs.resolve-verification-action.outputs.resolution-artifact-name }}',
            path: '${{ runner.temp }}/sec-hosted-job/preflight-verification-action-sut/in/resolution' } },
        { name: 'Prove hostile SUT sandbox on the executing job', id: 'preflight', shell: 'bash',
          env: { GH_TOKEN: '${{ github.token }}', SEC_HOSTED_NEEDS_JSON: '${{ toJSON(needs) }}',
            SEC_HOSTED_STEPS_JSON: '${{ toJSON(steps) }}' },
          run: 'exec bun --no-env-file src/adapters/verification/platform/ci/runtime/hosted-job-runtime.ts --job preflight-verification-action-sut --phase self-test-hosted-action-sandbox' },
        { name: 'Upload exact SUT capability observation', id: 'upload-capability',
          if: "${{ always() && !cancelled() && steps.preflight.outputs.capability-ready == 'true' }}",
          uses: 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
          with: { name: '${{ steps.preflight.outputs.capability-artifact-name }}',
            path: '${{ runner.temp }}/sec-hosted-job/preflight-verification-action-sut/out/capability',
            'if-no-files-found': 'error', 'retention-days': 1, 'include-hidden-files': true, overwrite: false } }
      ] as Array<Record<string, unknown>>
    } }
  };
}

test('independent workflow fixture admits only the pinned staged launcher and quarantined artifact shape', () => {
  const fixture = perJobPreflightWorkflowFixture();
  const policy = assertCiVerificationPerJobHostedWorkflowShape(stringifyYaml(fixture), 'preflight-verification-action-sut');
  expect(policy.jobId).toBe('preflight-verification-action-sut');
  expect(policy.role).toBe('sut');
  expect(policy.stages.map(({ kind }) => kind)).toEqual(['download', 'phase', 'upload']);
  expect(policy.maximumJobDurationMs).toBe(600_000);
  if (policy.runtime.kind !== 'per-job-runtime') throw new Error('Expected runtime policy.');
  expect(policy.runtime.trustBoundary.excluded).toContain('stolen-or-deliberately-relayed-job-credentials');
  expect(policy.runtime.originContinuity)
    .toBe('fresh-token-at-admission-original-job-deadline-abort-or-finally-close');
  expect(() => assertCiVerificationPerJobHostedWorkflowShape(stringifyYaml(fixture), 'validate-hosted-request')).toThrow();
  expect(() => assertCiVerificationPerJobHostedWorkflowShape(stringifyYaml(fixture), 'sec/main-health')).toThrow();
});

test('per-job source exposes only exact native artifact IDs and digests to trusted consumers', () => {
  const fixture = perJobPreflightWorkflowFixture();
  const job = fixture.jobs['preflight-verification-action-sut'] as Record<string, unknown>;
  job.outputs = { 'capability-artifact-id': '${{ steps.upload-capability.outputs.artifact-id }}',
    'capability-artifact-digest': '${{ steps.upload-capability.outputs.artifact-digest }}' };
  expect(() => assertCiVerificationPerJobHostedWorkflowShape(stringifyYaml(fixture), 'preflight-verification-action-sut')).not.toThrow();
  for (const [key, value] of [
    ['other-artifact-id', '${{ steps.upload-capability.outputs.artifact-id }}'],
    ['capability-artifact-id', '${{ steps.download-resolution.outputs.artifact-id }}'],
    ['capability-token', '${{ steps.upload-capability.outputs.token }}'],
    ['capability-artifact-id', '${{ steps.upload-raw.outputs.artifact-id }}']
  ]) {
    job.outputs = { [key!]: value };
    expect(() => assertCiVerificationPerJobHostedWorkflowShape(stringifyYaml(fixture), 'preflight-verification-action-sut')).toThrow();
  }
});

async function completeBootstrapWorkflowFixture() {
  const authored = parseYaml(await readCompilerFile('.github/workflows/trusted-bootstrap.yml')) as Workflow;
  const setup = perJobPreflightWorkflowFixture().jobs['preflight-verification-action-sut'].steps.slice(0, 4);
  const phase = (job: string, name: string, id: string, selector: string) => ({ name, id, shell: 'bash',
    env: { GH_TOKEN: '${{ github.token }}', SEC_HOSTED_NEEDS_JSON: '${{ toJSON(needs) }}',
      SEC_HOSTED_STEPS_JSON: '${{ toJSON(steps) }}' },
    run: `exec bun --no-env-file src/adapters/verification/platform/ci/runtime/hosted-job-runtime.ts --job ${job} --phase ${selector}` });
  const upload = (job: string, name: string, slot: string, producer: string, retention: number) => ({
    name, id: `upload-${slot}`,
    if: `\${{ always() && !cancelled() && steps.${producer}.outputs.${slot}-ready == 'true' }}`,
    uses: 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
    with: { name: `\${{ steps.${producer}.outputs.${slot}-artifact-name }}`,
      path: `\${{ runner.temp }}/sec-hosted-job/${job}/out/${slot}`, 'if-no-files-found': 'error',
      'retention-days': retention, 'include-hidden-files': true, overwrite: false } });
  const download = (name: string, slot: string, producer: string) => ({
    name, id: `download-${slot}`, uses: 'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c',
    if: `\${{ needs.${producer}.outputs.${slot}-artifact-name != '' }}`,
    with: { name: `\${{ needs.${producer}.outputs.${slot}-artifact-name }}`,
      path: `\${{ runner.temp }}/sec-hosted-job/checker-post/in/${slot}` } });
  const runtimeJob = (minutes: number, steps: readonly unknown[]) => ({
    'runs-on': 'ubuntu-24.04', 'timeout-minutes': minutes,
    permissions: { actions: 'read', contents: 'read', 'pull-requests': 'read', 'id-token': 'write' },
    steps: [...structuredClone(setup), ...steps]
  });
  return {
    name: 'trusted-bootstrap', on: { repository_dispatch: { types: ['sec-trusted-bootstrap-v1'] } },
    permissions: { contents: 'read', 'pull-requests': 'read' },
    jobs: {
      resolve: { ...structuredClone(authored.jobs.resolve!), 'runs-on': 'ubuntu-24.04' },
      'checker-pre': runtimeJob(30, [
        phase('checker-pre', 'Produce trusted-base PRE candidate-root receipt', 'pre', 'checker-pre'),
        upload('checker-pre', 'Upload bounded checker PRE artifact', 'pre', 'pre', 1)
      ]),
      'candidate-sut': runtimeJob(90, [
        phase('candidate-sut', 'Run candidate SUT through trusted private sandbox', 'sut', 'execute-trusted-bootstrap-sut'),
        upload('candidate-sut', 'Upload bounded candidate SUT artifact', 'sut', 'sut', 1)
      ]),
      'checker-post': runtimeJob(30, [
        download('Download bounded checker PRE artifact', 'pre', 'checker-pre'),
        download('Download bounded candidate SUT artifact', 'sut', 'candidate-sut'),
        phase('checker-post', 'Reuse PRE Actions and reduce exact bootstrap evidence', 'post', 'checker-post'),
        upload('checker-post', 'Upload final canonical trusted bootstrap evidence', 'bootstrap', 'post', 90)
      ])
    } as Record<string, Record<string, unknown>>
  };
}

test('whole-workflow artifact writer closure checks every job and inherited API permissions', async () => {
  const fixture = await completeBootstrapWorkflowFixture();
  expect(() => assertCiVerificationPerJobHostedWholeWorkflowShape(stringifyYaml(fixture))).not.toThrow();
  const mutate: readonly ((value: typeof fixture) => void)[] = [
    value => { delete value.jobs['checker-post']; },
    value => { value.jobs.attacker = { 'runs-on': 'ubuntu-24.04', steps: [{ run: 'upload forged artifact' }] }; },
    value => { (value.jobs.resolve!.steps as Array<Record<string, unknown>>).push({ run: 'upload forged artifact' }); },
    value => { value.jobs.resolve!.env = { NODE_OPTIONS: '--require ./candidate.js' }; },
    value => { value.jobs.resolve!.permissions = { contents: 'write' }; },
    value => { (value.permissions as Record<string, string>).actions = 'write'; },
    value => { value.jobs['candidate-sut']!.env = { ACTIONS_RUNTIME_TOKEN: '${{ secrets.TOKEN }}' }; },
    value => { (value.jobs['candidate-sut']!.steps as Array<Record<string, unknown>>).push({ run: 'upload another job output' }); },
    value => { (value as Record<string, unknown>).defaults = { run: { 'working-directory': './candidate' } }; }
  ];
  for (const change of mutate) {
    const changed = structuredClone(fixture);
    change(changed);
    expect(() => assertCiVerificationPerJobHostedWholeWorkflowShape(stringifyYaml(changed))).toThrow();
  }
  // A valid selected job is insufficient evidence for the complete writer set.
  expect(() => assertCiVerificationPerJobHostedWholeWorkflowShape(
    stringifyYaml(perJobPreflightWorkflowFixture()))).toThrow();
});

test('workflow shape rejects host candidate execution, policy substitution and artifact escape', () => {
  type Fixture = ReturnType<typeof perJobPreflightWorkflowFixture>;
  const job = (fixture: Fixture) => fixture.jobs['preflight-verification-action-sut'];
  const step = (fixture: Fixture, index: number) => job(fixture).steps[index]!;
  const mutations: Array<(fixture: Fixture) => void> = [
    (fixture) => { job(fixture)['runs-on'] = 'self-hosted'; },
    (fixture) => { job(fixture)['runs-on'] = '${{ inputs.runner }}'; },
    (fixture) => { job(fixture)['timeout-minutes'] = 11; },
    (fixture) => { job(fixture).permissions.actions = 'write'; },
    (fixture) => { job(fixture).steps.push({ run: 'bun candidate/hostile.ts' }); },
    (fixture) => { step(fixture, 0).with = { ref: '${{ github.event.client_payload.head }}',
      'fetch-depth': 0, 'persist-credentials': false }; },
    (fixture) => { (step(fixture, 0).with as Record<string, unknown>)['persist-credentials'] = true; },
    (fixture) => { step(fixture, 1).uses = 'oven-sh/setup-bun@main'; },
    (fixture) => { job(fixture).steps.splice(2, 1); },
    (fixture) => { step(fixture, 3).run = 'bun install --frozen-lockfile'; },
    (fixture) => { step(fixture, 5).run = String(step(fixture, 5).run).replace('--phase self-test-hosted-action-sandbox', '--phase execute-hosted-action-sut'); },
    (fixture) => { step(fixture, 5).run = `${String(step(fixture, 5).run)}; bun candidate.ts`; },
    (fixture) => { (step(fixture, 5).env as Record<string, unknown>).NODE_OPTIONS = '--require ./candidate.js'; },
    (fixture) => { (step(fixture, 4).with as Record<string, unknown>).path = '${{ github.workspace }}'; },
    (fixture) => { (step(fixture, 6).with as Record<string, unknown>).path = '${{ runner.temp }}/../'; },
    (fixture) => { (step(fixture, 6).with as Record<string, unknown>).overwrite = true; },
    (fixture) => { (step(fixture, 6).with as Record<string, unknown>).name = 'foreign-artifact'; },
    (fixture) => { job(fixture).steps.splice(4, 2, step(fixture, 5), step(fixture, 4)); },
    (fixture) => { step(fixture, 5)['continue-on-error'] = true; },
    (fixture) => { Object.assign(job(fixture), { container: { image: 'unqualified:latest' } }); },
    (fixture) => { Object.assign(job(fixture), { outputs: { leak: '${{ secrets.SECRET }}' } }); },
    (fixture) => { Object.assign(fixture, { env: { BASH_ENV: '/tmp/candidate.sh' } }); },
    (fixture) => { fixture.name = 'foreign'; },
    (fixture) => { fixture.on.repository_dispatch.types.push('arbitrary'); }
  ];
  for (const [index, mutate] of mutations.entries()) {
    const fixture = perJobPreflightWorkflowFixture();
    mutate(fixture);
    expect(() => assertCiVerificationPerJobHostedWorkflowShape(stringifyYaml(fixture),
      'preflight-verification-action-sut'), `mutation ${index}`).toThrow();
  }
  const source = stringifyYaml(perJobPreflightWorkflowFixture());
  expect(() => assertCiVerificationPerJobHostedWorkflowShape(`${source}\nname: compiler-pr-validation\n`,
    'preflight-verification-action-sut')).toThrow();
  expect(() => assertCiVerificationPerJobHostedWorkflowShape('x'.repeat(512 * 1024 + 1),
    'preflight-verification-action-sut')).toThrow();
});

test('every current legacy workflow remains unqualified for the new live origin issuer', async () => {
  for (const policy of CI_VERIFICATION_PER_JOB_HOSTED_JOB_POLICIES) {
    if (policy.runtime.kind !== 'per-job-runtime') continue;
    const source = await readCompilerFile(policy.workflowPath);
    expect(() => assertCiVerificationPerJobHostedWorkflowShape(source, policy.jobId), policy.jobId).toThrow();
  }
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
  }>, outputs: Map<string, string>) => {
    await new AsyncFunction('github', 'context', 'core', script)({ rest: { repos: {
      getCommit: async (request: { ref: string }) => {
        expect(request.ref).toBe(head);
        return { data: { sha: input.commitSha ?? head, parents: input.parents.map((sha) => ({ sha })) } };
      },
      get: async () => ({ data: { default_branch: 'main' } }),
      getBranch: async () => ({ data: { commit: { sha: input.defaultSha ?? head } } })
    } } }, { sha: head, ref: input.ref ?? 'refs/heads/main', repo: { owner: 'sec-platform', repo: 'sec' } },
    { setOutput: (name: string, value: string) => outputs.set(name, value) });
  };
  const outputs = new Map<string, string>();
  await execute({ parents: [base] }, outputs);
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
    await expect(execute(input, rejectedOutputs)).rejects.toThrow();
    expect(rejectedOutputs.size).toBe(0);
  }
});

test('release verification binds local parent checks before the Linux executor', async () => {
  const release = parseYaml(await readCompilerFile('.github/workflows/compiler-release-validation.yml')) as Workflow;
  const job = 'compiler-release-verification';
  const steps = release.jobs[job]!.steps;
  const verifyParent = step(release, job, 'Verify checked-out release parent and tree');
  const verify = step(release, job, 'Run exact-head full verification');
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
  expect(release.jobs[job]!['runs-on']).toEqual([
    ...LOCAL_LINUX_RUNNER_LABELS, LOCAL_LINUX_RUNNER_ROLE_LABELS.sut
  ]);
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
  const mergeRoles = WORKFLOW_RUNNER_ROLES['.github/workflows/merge-gate.yml'];
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

test('every cold SUT facade installs exact-base dependencies before its first repository module import', async () => {
  const [compiler, bootstrap] = await Promise.all([
    readCompilerFile('.github/workflows/compiler-pr-validation.yml'),
    readCompilerFile('.github/workflows/trusted-bootstrap.yml')
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
