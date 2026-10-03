import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { GitHubApiCapability } from '../../src/adapters/providers/github-api/operation-session.ts';
import {
  issueGitHubApiTestCapability, withGitHubApiTestSession
} from '../../src/adapters/providers/github-api/test/operation-session.ts';
import { SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY } from '../../src/adapters/providers/linux-verification/contract.ts';
import { createHostedJobRuntimeReceipt } from '../../src/adapters/verification/platform/ci/contract/hosted-job-runtime.ts';
import { CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA, CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA } from '../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts';
import { CI_VERIFICATION_HOSTED_SANDBOX_POLICY, CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST } from '../../src/adapters/verification/platform/ci/contract/revision.ts';
import {
  assertAuthenticatedHostedJobRuntimeReceipt, decodeHostedJobRuntimeReceiptProvenance,
  readAuthenticatedHostedJobRuntimeReceipt,
  type AuthenticatedHostedJobRuntimeReceipt, type HostedJobRuntimeReceiptSelection
} from '../../src/adapters/verification/platform/ci/runtime/hosted-job-runtime-provenance.ts';
import { rawSha256, sha256 } from '../../src/contracts/canonical.ts';

const at = 1_790_000_000_000;
const stamp = (seconds: number): string => new Date(at + seconds * 1000).toISOString();
const sourceSha = 'a'.repeat(40), treeSha = 'b'.repeat(40), hash = `sha256:${'c'.repeat(64)}`;
const selected: HostedJobRuntimeReceiptSelection = Object.freeze({ repository: 'sec-platform/sec', artifactId: '40',
  runId: '20', runAttempt: 1, policyJobId: 'preflight-verification-action-sut',
  phase: 'self-test-hosted-action-sandbox', actionKey: hash });
const environment = SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY;

function compilerWorkflowFixture(): string {
  // Independent proposed source DATA. Only the two reviewed API-only programs
  // come from authored source; no active YAML is changed or declared qualified.
  const authored = parseYaml(readFileSync(new URL('../../.github/workflows/compiler-pr-validation.yml', import.meta.url), 'utf8')) as Record<string, any>;
  const setup = [
    { name: 'Checkout exact trusted hosted launcher', uses: 'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
      with: { ref: '${{ github.workflow_sha }}', 'fetch-depth': 0, 'persist-credentials': false } },
    { name: 'Setup exact trusted bootstrap Bun', uses: 'oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6',
      with: { 'bun-version': '1.4.0' } },
    { name: 'Verify exact bootstrap Bun bytes', shell: 'bash',
      run: "set -euo pipefail\nprintf '%s  %s\\n' '33d56b070be6a9e3da0ab013038b43d1645d0534ca811ecdba4472599117eb4b' \"$(command -v bun)\" | sha256sum --check --strict" },
    { name: 'Install exact trusted launcher dependencies', shell: 'bash',
      run: 'exec bun --no-env-file install --frozen-lockfile --ignore-scripts' }
  ];
  const phase = (job: string, selector: string, id: string, name: string) => ({ name, id, shell: 'bash',
    env: { GH_TOKEN: '${{ github.token }}', SEC_HOSTED_NEEDS_JSON: '${{ toJSON(needs) }}',
      SEC_HOSTED_STEPS_JSON: '${{ toJSON(steps) }}' },
    run: `exec bun --no-env-file src/adapters/verification/platform/ci/runtime/hosted-job-runtime.ts --job ${job} --phase ${selector}` });
  const upload = (job: string, slot: string, producer: string, name: string, days = 90) => ({ name, id: `upload-${slot}`,
    if: `\${{ always() && !cancelled() && steps.${producer}.outputs.${slot}-ready == 'true' }}`,
    uses: 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a', with: {
      name: `\${{ steps.${producer}.outputs.${slot}-artifact-name }}`, path: `\${{ runner.temp }}/sec-hosted-job/${job}/out/${slot}`,
      'if-no-files-found': 'error', 'retention-days': days, 'include-hidden-files': true, overwrite: false } });
  const download = (job: string, slot: string, producer: string, name: string) => ({ name, id: `download-${slot}`,
    uses: 'actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c',
    if: `\${{ needs.${producer}.outputs.${slot}-artifact-name != '' }}`, with: {
      name: `\${{ needs.${producer}.outputs.${slot}-artifact-name }}`, path: `\${{ runner.temp }}/sec-hosted-job/${job}/in/${slot}` } });
  const resolution = (job: string) => download(job, 'resolution', 'resolve-verification-action', 'Download trusted Action resolution transport');
  const prepared = (job: string) => download(job, 'prepared', 'claim-verification-action', 'Download exact prepared candidate ticket transport');
  const readControl = { actions: 'read', checks: 'read', contents: 'read', issues: 'read', 'pull-requests': 'read', statuses: 'read' };
  const readSut = { actions: 'read', contents: 'read' };
  const writeStatus = { actions: 'write', checks: 'read', contents: 'read', statuses: 'write' };
  const job = (minutes: number, permissions: Record<string, string>, steps: readonly unknown[], name?: string) => ({
    ...(name === undefined ? {} : { name }), 'runs-on': 'ubuntu-24.04', 'timeout-minutes': minutes,
    permissions: { ...permissions, 'id-token': 'write' }, steps: [...structuredClone(setup), ...steps]
  });
  return stringifyYaml({ name: 'compiler-pr-validation', on: { repository_dispatch: { types: [
    'sec-verify-session-v2', 'sec-produce-verification-action-v2', 'sec-produce-main-health-v1', 'sec-produce-agent-operation-activation-v1'
  ] } }, permissions: { actions: 'read', contents: 'read', 'pull-requests': 'read' }, jobs: {
    'validate-hosted-request': { ...authored.jobs['validate-hosted-request'], 'runs-on': 'ubuntu-24.04' },
    'validate-agent-operation-activation-request': { ...authored.jobs['validate-agent-operation-activation-request'], 'runs-on': 'ubuntu-24.04' },
    'agent-operation-activation': job(10, { actions: 'read', checks: 'read', contents: 'read', issues: 'write', 'pull-requests': 'write' }, [
      phase('agent-operation-activation', 'produce-hosted', 'produce', 'Compile exact hosted activation payload'),
      upload('agent-operation-activation', 'activation', 'produce', 'Upload exact Agent operation activation receipt'),
      phase('agent-operation-activation', 'publish-hosted', 'publish', 'Publish exact Agent operation activation receipt')
    ]),
    'coordinate-verification-session': job(205, { ...readControl, contents: 'write', issues: 'write', 'pull-requests': 'write' }, [
      phase('coordinate-verification-session', 'prepare-parent-plan', 'parent-plan', 'Prepare canonical parent Action dispatch plan'),
      upload('coordinate-verification-session', 'parent-plan', 'parent-plan', 'Upload canonical parent Action dispatch plan artifact'),
      phase('coordinate-verification-session', 'coordinate-session', 'coordinate', 'Reconcile canonical ActionKey producers once'),
      phase('coordinate-verification-session', 'compose-hosted-evidence', 'compose', 'Compose settled canonical Session evidence'),
      upload('coordinate-verification-session', 'session', 'compose', 'Upload sole terminal Verification Session artifact')
    ]),
    'resolve-verification-action': job(20, readControl, [
      phase('resolve-verification-action', 'resolve-hosted-action', 'resolve', 'Rebuild trusted Session envelope and exact ActionKey member'),
      upload('resolve-verification-action', 'resolution', 'resolve', 'Upload trusted Action resolution transport', 1)
    ]),
    'preflight-verification-action-sut': job(10, readSut, [resolution('preflight-verification-action-sut'),
      phase('preflight-verification-action-sut', 'self-test-hosted-action-sandbox', 'preflight', 'Prove hostile SUT sandbox on the executing job'),
      upload('preflight-verification-action-sut', 'capability', 'preflight', 'Upload exact SUT capability observation', 1)
    ]),
    'claim-verification-action': job(35, writeStatus, [resolution('claim-verification-action'),
      download('claim-verification-action', 'capability', 'preflight-verification-action-sut', 'Download exact SUT capability observation'),
      phase('claim-verification-action', 'prepare-start-marker', 'prepare', 'Create immutable Action start marker from fresh provider census'),
      upload('claim-verification-action', 'start', 'prepare', 'Upload immutable Action start marker'),
      phase('claim-verification-action', 'claim-start', 'claim', 'Publish durable start tombstone and issue execution ticket'),
      upload('claim-verification-action', 'prepared', 'claim', 'Upload exact prepared candidate and execution ticket transport', 1)
    ]),
    'execute-verification-action-sut': job(75, readSut, [resolution('execute-verification-action-sut'), prepared('execute-verification-action-sut'),
      phase('execute-verification-action-sut', 'execute-hosted-action-sut', 'execute', 'Execute one normalized candidate operation without credentials'),
      upload('execute-verification-action-sut', 'raw', 'execute', 'Upload untrusted raw SUT transport only', 1)
    ]),
    'assemble-verification-action-terminal': job(30, writeStatus, [resolution('assemble-verification-action-terminal'), prepared('assemble-verification-action-terminal'),
      download('assemble-verification-action-terminal', 'raw', 'execute-verification-action-sut', 'Download raw SUT transport for terminal assembly'),
      phase('assemble-verification-action-terminal', 'assemble-hosted-action-terminal', 'assemble', 'Assemble canonical five-state terminal artifact'),
      upload('assemble-verification-action-terminal', 'terminal', 'assemble', 'Upload canonical terminal Action artifact'),
      phase('assemble-verification-action-terminal', 'prepare-terminal-anchor', 'anchor', 'Create exact post-upload terminal anchor'),
      upload('assemble-verification-action-terminal', 'anchor', 'anchor', 'Upload exact post-upload terminal anchor'),
      phase('assemble-verification-action-terminal', 'anchor-terminal', 'publish', 'Publish neutral terminal provider tombstone')
    ]),
    'main-health': job(30, readSut, [
      phase('main-health', 'imports:check', 'imports', 'Reject import organization drift'),
      phase('main-health', 'typecheck:verified', 'typecheck', 'Run exact-main TypeScript checks'),
      phase('main-health', 'audit', 'audit', 'Reject static architecture contradictions'),
      phase('main-health', 'docs:doctor', 'docs', 'Validate active documentation authority'),
      phase('main-health', 'test', 'test', 'Run the complete fast test inventory')
    ], 'sec/main-health')
  } });
}

function fixture() {
  const workflowSource = compilerWorkflowFixture();
  const launcherSource = '// Independent simulated authenticated source response; data only.\n';
  const observation = { commandPlanDigest: hash,
    lifecycle: { supervisorSpawned: true, supervisorClosed: true, supervisorCloseCode: 0, supervisorSignal: null,
      namespaceEstablished: true, candidateStarted: true, candidateUnitSettled: true, observationGap: null },
    exitCode: 0, markerObserved: true, outputDigest: hash,
    cleanup: { supervisorSpawned: true, supervisorClosed: true, exitCode: 0, outputDigest: hash }, diagnostic: null };
  const outputSource = `${JSON.stringify({ schema: 'sec-verification-action-sut-capability-v2', actionKey: hash, observation })}\n`;
  const receipt = createHostedJobRuntimeReceipt({
    origin: { repository: selected.repository, repositoryId: '10', workflowPath: '.github/workflows/compiler-pr-validation.yml',
      workflowSha: sourceSha, trustedSourceSha: sourceSha, trustedSourceTreeSha: treeSha, runId: selected.runId,
      runAttempt: 1, jobId: '30', checkRunId: '31', policyJobId: selected.policyJobId, role: 'sut', identityDigest: hash,
      workflowSourceDigest: rawSha256(workflowSource), launcherSourceDigest: rawSha256(launcherSource),
      originalDeadlineAtUnixMs: at + 600_000 },
    operation: { phase: selected.phase, actionKey: hash, operationIdentityDigest: hash, boundAttemptDigest: hash,
      deadlineAtUnixMs: at + 540_000 },
    materialization: { specDigest: hash, runtimeManifestDigest: environment.image.runtimeContentDigest,
      dockerProjectionDigest: environment.image.dockerProjectionDigest, provenanceArtifactDigest: hash,
      executionImageDigest: environment.trustedRuntime.imageDigest, bunExecutableDigest: environment.trustedRuntime.bunExecutableDigest,
      engineProviderIdentityDigest: hash, ociExporterIdentityDigest: hash },
    container: { id: 'd'.repeat(64), name: 'fixture-owned-container', ownershipDigest: hash,
      creationReadbackDigest: hash, startedReadbackDigest: hash, terminalReadbackDigest: hash },
    execution: { started: true, settled: true, exitCode: 0, stdoutBytes: Buffer.byteLength(outputSource), stderrBytes: 0,
      outputDigest: rawSha256(outputSource), outputTruncated: false, sandboxObservationDigest: sha256(observation) },
    cleanup: { containerAbsent: true, providerScopeSettled: true, outputSettled: true, ownedSourcesReleased: true }
  });
  const run = { id: 20, run_attempt: 1, path: receipt.origin.workflowPath, head_sha: sourceSha, head_branch: 'main',
    event: 'repository_dispatch', status: 'in_progress', conclusion: null, repository: { full_name: selected.repository, id: 10 } };
  const defaultBranch = { name: 'main', commit: { sha: sourceSha, commit: { tree: { sha: treeSha } } } };
  const names = ['Checkout exact trusted hosted launcher', 'Setup exact trusted bootstrap Bun',
    'Verify exact bootstrap Bun bytes', 'Install exact trusted launcher dependencies',
    'Download trusted Action resolution transport', 'Prove hostile SUT sandbox on the executing job',
    'Upload exact SUT capability observation'];
  const job = { id: 30, run_id: 20, run_attempt: 1, name: selected.policyJobId, head_sha: sourceSha,
    check_run_url: `https://api.github.com/repos/${selected.repository}/check-runs/31`,
    labels: ['ubuntu-24.04'], status: 'completed', conclusion: 'success', started_at: stamp(0), completed_at: stamp(80),
    steps: names.map((name, i) => ({ name, number: i + 2, status: 'completed', conclusion: 'success',
      started_at: stamp(i * 10), completed_at: stamp((i + 1) * 10) })) };
  const artifact = { id: 40, name: `sec-verification-action-sut-capability-v2-${hash.slice(7)}-run-20-attempt-1`,
    digest: hash, size_in_bytes: 4000, expired: false, created_at: stamp(61), updated_at: stamp(69),
    workflow_run: { id: 20, repository_id: 10, head_repository_id: 10, head_sha: sourceSha, head_branch: 'main' } };
  return { selection: selected, repository: { full_name: selected.repository, id: 10, default_branch: 'main' },
    defaultBranch, finalDefaultBranch: structuredClone(defaultBranch), run, finalRun: structuredClone(run),
    jobs: [{ total_count: 1, jobs: [job] }], artifact, artifacts: [{ total_count: 1, artifacts: [structuredClone(artifact)] }],
    workflowSource, launcherSource, receiptSource: `${JSON.stringify(receipt)}\n`, outputSource, observedAtUnixMs: at + 90_000 };
}
function replaceReceipt(input: ReturnType<typeof fixture>, update: (value: ReturnType<typeof createHostedJobRuntimeReceipt>) => void): void {
  const value = JSON.parse(input.receiptSource) as ReturnType<typeof createHostedJobRuntimeReceipt>;
  update(value);
  const { receiptDigest: _, ...content } = value;
  input.receiptSource = JSON.stringify({ ...content, receiptDigest: sha256(content) });
}
function semantic(input: ReturnType<typeof fixture>) {
  const receipt = JSON.parse(input.receiptSource) as ReturnType<typeof createHostedJobRuntimeReceipt>;
  return { repository: selected.repository, repositoryId: '10', workflowSha: sourceSha, runId: '20', runAttempt: 1,
    policyJobId: selected.policyJobId, phase: selected.phase, actionKey: hash,
    outputDigest: receipt.execution.outputDigest, sandboxObservationDigest: receipt.execution.sandboxObservationDigest! };
}

test('valid independent response data is frozen but never authenticates itself or its clone', () => {
  const input = fixture(), data = decodeHostedJobRuntimeReceiptProvenance(input);
  expect(data.provenance.receiptMember).toBe('hosted-job-runtime-receipt.json');
  expect(data.provenance.outputMember).toBe('hosted-sut-capability.json');
  expect(Object.isFrozen(data.receipt.origin)).toBe(true);
  for (const forged of [data, structuredClone(data), Object.freeze({}), { ...data }]) {
    expect(() => assertAuthenticatedHostedJobRuntimeReceipt(forged as AuthenticatedHostedJobRuntimeReceipt, semantic(input))).toThrow();
  }
});

test('test transport, test capability, and structural capability casts cannot mint authenticated receipts', async () => {
  let requests = 0;
  const capability = issueGitHubApiTestCapability({ repository: selected.repository, token: 'synthetic-fixture-token-only',
    effect: 'verification-read', principal: { transport: 'github-rest-token', login: 'fixture', nodeId: 'FIXTURE',
      userId: 1, permission: 'maintain' }, transport: async () => { requests += 1; throw new Error('Must not dispatch'); } });
  await expect(withGitHubApiTestSession({ capability, operation: () =>
    readAuthenticatedHostedJobRuntimeReceipt({ ...selected, capability }) })).rejects.toThrow('production verification transport');
  await expect(readAuthenticatedHostedJobRuntimeReceipt({ ...selected, capability: {} as GitHubApiCapability })).rejects.toThrow();
  expect(requests).toBe(0);
});

test('current-default source, exact run attempt, signed producer fields and original lifetime cannot be caller replacements', () => {
  expect(() => decodeHostedJobRuntimeReceiptProvenance(fixture())).not.toThrow();
  const mutations: Array<(value: ReturnType<typeof fixture>) => void> = [
    value => { value.finalDefaultBranch.commit.sha = 'e'.repeat(40); },
    value => { value.finalRun.run_attempt = 2; },
    value => { value.jobs[0]!.jobs[0]!.check_run_url = 'https://api.github.com/repos/sec-platform/sec/check-runs/999'; },
    value => { value.jobs[0]!.jobs[0]!.id = 999; },
    value => { value.jobs[0]!.jobs[0]!.labels = ['self-hosted']; },
    value => { value.jobs[0]!.jobs[0]!.started_at = stamp(1); },
    value => { value.launcherSource += '\n// drift\n'; },
    value => { value.workflowSource += '\n# digest drift\n'; },
    value => replaceReceipt(value, receipt => { receipt.origin.identityDigest = 'not-a-digest'; }),
    value => replaceReceipt(value, receipt => { receipt.origin.workflowSha = 'e'.repeat(40); receipt.origin.trustedSourceSha = 'e'.repeat(40); })
  ];
  for (const mutate of mutations) { const value = fixture(); mutate(value); expect(() => decodeHostedJobRuntimeReceiptProvenance(value)).toThrow(); }
});

test('artifact name alone, absent archive digest, duplicate writer and upload time coincidence are insufficient', () => {
  expect(() => decodeHostedJobRuntimeReceiptProvenance(fixture())).not.toThrow();
  const mutations: Array<(value: ReturnType<typeof fixture>) => void> = [
    value => { value.artifact.digest = ''; },
    value => { value.artifact.id = 41; },
    value => { value.artifact.expired = true; },
    value => { value.artifact.workflow_run.head_repository_id = 11; },
    value => { value.artifact.created_at = stamp(59); },
    value => { value.artifact.updated_at = stamp(71); },
    value => { value.jobs[0]!.jobs[0]!.steps[6]!.conclusion = 'skipped'; },
    value => { value.jobs[0]!.jobs[0]!.steps[5]!.conclusion = 'failure'; },
    value => { value.jobs[0]!.jobs[0]!.steps[2]!.conclusion = 'failure'; },
    value => { value.artifacts[0]!.total_count = 2; value.artifacts[0]!.artifacts.push({ ...value.artifact, id: 41 }); },
    value => { value.jobs[0]!.total_count = 2; value.jobs[0]!.jobs.push({ ...value.jobs[0]!.jobs[0]!, id: 32 }); },
    value => { value.artifacts[0]!.artifacts[0]!.digest = `sha256:${'e'.repeat(64)}`; }
  ];
  for (const mutate of mutations) { const value = fixture(); mutate(value); expect(() => decodeHostedJobRuntimeReceiptProvenance(value)).toThrow(); }
});

test('same-archive output bytes, sandbox observation and complete cleanup remain mandatory', () => {
  expect(() => decodeHostedJobRuntimeReceiptProvenance(fixture())).not.toThrow();
  const mutations: Array<(value: ReturnType<typeof fixture>) => void> = [
    value => { value.outputSource += '\n'; },
    value => replaceReceipt(value, receipt => { receipt.execution.sandboxObservationDigest = `sha256:${'e'.repeat(64)}`; }),
    value => replaceReceipt(value, receipt => { receipt.execution.outputTruncated = true; }),
    value => replaceReceipt(value, receipt => { receipt.cleanup.containerAbsent = false; }),
    value => replaceReceipt(value, receipt => { receipt.execution.exitCode = 1; }),
    value => replaceReceipt(value, receipt => { receipt.materialization.executionImageDigest = 'sha256:wrong' as typeof environment.trustedRuntime.imageDigest; }),
    value => { value.selection = { ...selected, policyJobId: 'execute-verification-action-sut', phase: 'execute-hosted-action-sut' }; }
  ];
  for (const mutate of mutations) { const value = fixture(); mutate(value); expect(() => decodeHostedJobRuntimeReceiptProvenance(value)).toThrow(); }
});

function rawFixture() {
  const value = fixture(), policy = CI_VERIFICATION_HOSTED_SANDBOX_POLICY;
  const capability = JSON.parse(value.outputSource).observation;
  const content = {
    schema: CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA, policyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST,
    actionKey: hash, capability, commandPlanDigest: hash, resources: policy.limits,
    authenticatedArchive: { archiveDigest: hash, inventoryDigest: hash, dependencyClosureDigest: hash,
      gitBundleDigest: hash, entryCount: 1, totalFileBytes: 1 },
    rootIsolation: { substrate: policy.substrate, namespaces: policy.namespaces, uid: policy.isolatedUid,
      gid: policy.isolatedGid, network: policy.network, inputMount: policy.inputMount, workspace: policy.workspace,
      outputTransport: policy.outputTransport, candidateEnvironmentNames: [] },
    execution: { lifecycle: capability.lifecycle, unitName: null, exitCode: 0, authenticatedInputDigest: hash,
      postExecutionInputDigest: hash, postExecutionReadbackErrorDigest: null, stdoutStderrDigest: hash,
      stdoutDigest: hash, stderrDigest: hash, stdoutBytesObserved: 1, stderrBytesObserved: 0,
      outputTruncated: false, boundedFailureTailDigest: hash },
    cleanup: capability.cleanup, diagnostic: null
  };
  const sandboxReceipt = { ...content, receiptDigest: sha256(content) };
  const raw = { schema: CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA, executionAuthorizationDigest: hash,
    command: { commandPlanDigest: hash, executionAuthorizationDigest: hash, physicalCommandProjectionDigest: hash },
    sandboxReceipt, startedAt: stamp(61), finishedAt: stamp(69) };
  value.selection = { ...selected, policyJobId: 'execute-verification-action-sut', phase: 'execute-hosted-action-sut' };
  value.outputSource = `${JSON.stringify({ ...raw, rawResultDigest: sha256(raw) })}\n`;
  replaceReceipt(value, receipt => {
    receipt.origin.policyJobId = value.selection.policyJobId;
    receipt.origin.originalDeadlineAtUnixMs = at + 75 * 60_000;
    receipt.operation.phase = value.selection.phase;
    receipt.execution.outputDigest = rawSha256(value.outputSource);
    receipt.execution.sandboxObservationDigest = sandboxReceipt.receiptDigest;
    receipt.execution.stdoutBytes = Buffer.byteLength(value.outputSource);
  });
  value.jobs[0]!.jobs[0]!.name = value.selection.policyJobId;
  value.jobs[0]!.jobs[0]!.steps[5]!.name = 'Execute one normalized candidate operation without credentials';
  value.jobs[0]!.jobs[0]!.steps[6]!.name = 'Upload untrusted raw SUT transport only';
  value.jobs[0]!.jobs[0]!.steps.splice(5, 0, { ...value.jobs[0]!.jobs[0]!.steps[4]!, name: 'Download exact prepared candidate ticket transport' });
  value.jobs[0]!.jobs[0]!.steps.forEach((step, i) => { step.number = i + 2; step.started_at = stamp(i * 10); step.completed_at = stamp((i + 1) * 10); });
  value.jobs[0]!.jobs[0]!.completed_at = stamp(90);
  value.observedAtUnixMs = at + 100_000;
  value.artifact.created_at = stamp(71);
  value.artifact.updated_at = stamp(79);
  value.artifact.name = `sec-verification-action-raw-v2-${hash.slice(7)}-run-20-attempt-1`;
  value.artifacts[0]!.artifacts[0] = structuredClone(value.artifact);
  return value;
}

test('execution receipt authenticates the same raw member and never accepts preflight as execution', () => {
  const value = rawFixture(), data = decodeHostedJobRuntimeReceiptProvenance(value);
  expect(data.provenance.outputMember).toBe('verification-action-raw-observation.json');
  expect(data.receipt.operation.phase).toBe('execute-hosted-action-sut');
  for (const mutate of [
    (input: ReturnType<typeof rawFixture>) => { input.outputSource = fixture().outputSource; },
    (input: ReturnType<typeof rawFixture>) => replaceReceipt(input, receipt => { receipt.operation.deadlineAtUnixMs = at + 68_000; }),
    (input: ReturnType<typeof rawFixture>) => {
      const raw = JSON.parse(input.outputSource);
      raw.finishedAt = stamp(71);
      const { rawResultDigest: _, ...content } = raw;
      input.outputSource = JSON.stringify({ ...content, rawResultDigest: sha256(content) });
      replaceReceipt(input, receipt => {
        receipt.execution.outputDigest = rawSha256(input.outputSource);
        receipt.execution.stdoutBytes = Buffer.byteLength(input.outputSource);
      });
    }
  ]) { const input = rawFixture(); mutate(input); expect(() => decodeHostedJobRuntimeReceiptProvenance(input)).toThrow(); }
});

test('rehashing JSON cannot authorize another workflow job or an alternate artifact writer', () => {
  expect(() => decodeHostedJobRuntimeReceiptProvenance(fixture())).not.toThrow();
  for (const inject of [
    (workflow: Record<string, any>) => {
      workflow.jobs['unexpected-artifact-writer'] = { 'runs-on': 'ubuntu-24.04', steps: [{
        name: 'Counterfeit runtime receipt', uses: 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
        with: { name: 'counterfeit', path: '/tmp/foreign' }
      }] };
    },
    (workflow: Record<string, any>) => {
      workflow.jobs['validate-hosted-request'].steps.push({ name: 'Unreviewed API-only mutation', run: 'echo unreviewed' });
    }
  ]) {
    const input = fixture(), workflow = parseYaml(input.workflowSource) as Record<string, any>;
    inject(workflow);
    input.workflowSource = stringifyYaml(workflow);
    replaceReceipt(input, receipt => { receipt.origin.workflowSourceDigest = rawSha256(input.workflowSource); });
    expect(() => decodeHostedJobRuntimeReceiptProvenance(input)).toThrow();
  }
});
