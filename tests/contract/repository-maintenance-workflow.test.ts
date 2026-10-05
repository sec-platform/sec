import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';

import { SEC_TRUSTED_BOOTSTRAP_REGISTRY } from '../../src/adapters/verification/platform/trust/contract/root.ts';

const WORKFLOW_PATH = '.github/workflows/repository-maintenance.yml';
const RUNTIME_PATH = 'src/adapters/self-hosting/control/repository-maintenance/repository-maintenance.ts';
const source = readFileSync(path.resolve(import.meta.dir, '../..', WORKFLOW_PATH), 'utf8');
const workflow = parseYaml(source) as any;
const steps: any[] = workflow.jobs.retire.steps;
const step = (name: string): any => {
  const found = steps.find((value) => value.name === name);
  if (found === undefined) throw new Error(`Missing workflow step ${name}`);
  return found;
};

test('one bounded explicit batch uses one runner without public comments or a false overlap lock', () => {
  expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch']);
  expect(Object.keys(workflow.on.workflow_dispatch.inputs)).toEqual(['request', 'request_digest', 'execution_digest', 'resume_receipt']);
  expect(workflow.on.workflow_dispatch.inputs.request.required).toBe(true);
  expect(workflow.on.workflow_dispatch.inputs.request_digest.required).toBe(true);
  expect(workflow['run-name']).toBe('maintenance/${{ inputs.execution_digest }}');
  expect(workflow.on.workflow_dispatch.inputs.resume_receipt.required).toBe(false);
  expect(workflow.permissions).toEqual({ actions: 'read', contents: 'write', 'pull-requests': 'read' });
  expect(workflow.concurrency).toBeUndefined();
  expect(Object.keys(workflow.jobs)).toEqual(['retire']);
  expect(workflow.jobs.retire.strategy).toBeUndefined();
  expect(workflow.jobs.retire['runs-on']).toBe('ubuntu-24.04');
  expect(workflow.jobs.retire['timeout-minutes']).toBe(20);
  expect(steps.filter((value) => value.uses?.startsWith('actions/checkout@'))).toHaveLength(1);
  expect(steps.filter((value) => value.run === 'bun install --frozen-lockfile --ignore-scripts')).toHaveLength(1);
  for (const value of steps.filter((entry) => entry.uses !== undefined)) {
    expect(value.uses).toMatch(/@[0-9a-f]{40}$/u);
  }
  expect(source).not.toContain('issues: write');
  expect(source).not.toContain('deleteArtifact');
  expect(source).not.toContain('retire-trigger');
  expect(source).not.toContain('github.rest.issues');
});

test('recovery is published and read back before effects; resume reuses exact prior artifact', () => {
  const order = [
    'Resolve exact maintenance request carrier', 'Checkout exact maintenance authority',
    'Install maintenance dependencies from frozen lock', 'Prepare exact recovery before any ref effect',
    'Upload exact pre-effect recovery', 'Read back exact pre-effect recovery identity',
    'Download exact pre-effect recovery', 'Execute exact repository maintenance request',
    'Upload repository maintenance receipt'
  ].map((name) => steps.indexOf(step(name)));
  expect(order).toEqual([...order].sort((left, right) => left - right));
  const checkout = step('Checkout exact maintenance authority');
  expect(checkout.with).toMatchObject({ ref: '${{ github.sha }}', 'fetch-depth': 0, 'persist-credentials': false });
  const prepare = step('Prepare exact recovery before any ref effect');
  expect(prepare.env.SEC_MAINTENANCE_RESUME_RECEIPT).toBe('${{ inputs.resume_receipt }}');
  expect(prepare.run).toContain('if [[ -e "$carrier_root" || -L "$carrier_root" ]]');
  expect(prepare.run).toContain('repository-maintenance.ts prepare-recovery');
  expect(prepare.run).toContain('value.reusedCarrier');
  const upload = step('Upload exact pre-effect recovery');
  expect(upload.if).toBe("${{ steps.prepare.outputs.fresh-recovery == 'true' }}");
  expect(upload.with.path).toBe('/tmp/sec-repository-maintenance-carrier/upload');
  expect(upload.with['retention-days']).toBe('${{ steps.prepare.outputs.retention-days }}');
  const download = step('Download exact pre-effect recovery');
  expect(download.with['artifact-ids']).toBe('${{ steps.recovery-readback.outputs.artifact-id }}');
  expect(download.with['run-id']).toBe('${{ steps.recovery-readback.outputs.run-id }}');
  expect(download.with.path).toBe('/tmp/sec-repository-maintenance-carrier/readback');
  const execute = step('Execute exact repository maintenance request');
  expect(execute.env.SEC_MAINTENANCE_RECOVERY_ARTIFACT_ID).toBe('${{ steps.recovery-readback.outputs.artifact-id }}');
  expect(execute.env.SEC_MAINTENANCE_RECOVERY_RUN_ATTEMPT).toBe('${{ steps.recovery-readback.outputs.run-attempt }}');
  expect(execute.run).toContain('set -euo pipefail');
  const receipt = step('Upload repository maintenance receipt');
  expect(receipt.if).toBe('always()');
  expect(receipt.with.path).toBe('/tmp/sec-repository-maintenance-carrier/maintenance-result.json');
  expect(receipt.with.name).toBe('sec-repository-maintenance-result-${{ github.run_id }}-${{ github.run_attempt }}');
});

const REQUEST_BODY = JSON.stringify({ schema: 'sec-repository-maintenance-request-v2',
  repository: 'sec-platform/sec', expectedMainSha: 'a'.repeat(40),
  operations: [{ kind: 'exact-ref-retirement' }] });

async function requestScript(
  overrides: Record<string, unknown> = {},
  outputs: Record<string, string> = {}
): Promise<Record<string, string>> {
  const main = 'a'.repeat(40);
  const context = { actor: 'maintainer', ref: 'refs/heads/main',
    repo: { owner: 'sec-platform', repo: 'sec' }, payload: { sender: { login: 'maintainer', type: 'User' } },
    ...(overrides.context as object ?? {}) };
  const environment = { REQUEST_JSON: REQUEST_BODY,
    EVENT_NAME: 'workflow_dispatch', WORKFLOW_SHA: main, EVENT_SHA: main, REQUEST_DIGEST: 'sha256:' + 'c'.repeat(64), EXECUTION_DIGEST: 'sha256:' + 'd'.repeat(64), RUN_ATTEMPT: '1',
    ...(overrides.env as object ?? {}) };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const evaluate = new AsyncFunction('github', 'context', 'core', 'process', step('Resolve exact maintenance request carrier').with.script);
  await evaluate({ rest: { repos: { getCollaboratorPermissionLevel: async (input: unknown) => {
    expect(input).toEqual({ owner: 'sec-platform', repo: 'sec', username: 'maintainer' });
    return { data: Object.hasOwn(overrides, 'permission') ? overrides.permission : { permission: 'admin' } };
  } } } },
    context, { setOutput: (name: string, value: string) => { outputs[name] = value; } }, { env: environment });
  return outputs;
}

test('pre-checkout script reads maintainer permission and rejects actor, role, main and budget drift', async () => {
  expect(Object.keys(await requestScript())).toEqual(['request-json']);
  for (const permission of [
    { permission: 'admin', role_name: 'admin' },
    { permission: 'write', role_name: 'maintain' },
    { permission: 'maintain', role_name: 'maintain' },
    { permission: 'maintain' }
  ]) expect(await requestScript({ permission })).toEqual({ 'request-json': REQUEST_BODY });
  for (const permission of [
    { permission: 'write', role_name: 'write' },
    { permission: 'read', role_name: 'read' },
    { permission: 'read', role_name: 'triage' },
    { permission: 'none', role_name: 'none' },
    { permission: 'read', role_name: 'maintain' },
    { permission: 'admin', role_name: 'write' },
    { permission: 'admin', role_name: 'custom-role' },
    {}, null
  ]) {
    const outputs: Record<string, string> = {};
    await expect(requestScript({ permission }, outputs)).rejects.toThrow('requires current maintain/admin permission');
    expect(outputs).toEqual({});
  }
  for (const overrides of [
    { permission: { permission: 'write' } },
    { permission: { permission: 'admin', role_name: 'custom-admin' } },
    { context: { payload: { sender: { login: 'other', type: 'User' } } } },
    { context: { payload: { sender: { login: 'maintainer', type: 'Bot' } } } },
    { context: { ref: 'refs/heads/other' } },
    { env: { EVENT_NAME: 'repository_dispatch' } },
    { env: { REQUEST_DIGEST: 'invalid' } },
    { env: { EXECUTION_DIGEST: 'invalid' } },
    { env: { RUN_ATTEMPT: '2' } },
    { env: { WORKFLOW_SHA: 'b'.repeat(40) } },
    { env: { REQUEST_JSON: ' '.repeat(60 * 1024 + 1) } }
  ]) await expect(requestScript(overrides)).rejects.toThrow();
});

test('artifact readback reports actual expiry and rejects expiry/digest/run drift', async () => {
  const now = Date.now();
  const main = 'a'.repeat(40);
  const digest = 'sha256:' + 'c'.repeat(64);
  const artifact = { id: 101, name: 'sec-repository-maintenance-recovery-42-1', expired: false,
    size_in_bytes: 123, digest, workflow_run: { id: 42 }, expires_at: new Date(now + 86_400_000).toISOString() };
  const run = { id: 42, run_attempt: 1, head_sha: main, path: '.github/workflows/repository-maintenance.yml', event: 'workflow_dispatch', display_title: `maintenance/${digest}` };
  const evaluate = new (Object.getPrototypeOf(async function () {}).constructor)(
    'github', 'context', 'core', 'process', step('Read back exact pre-effect recovery identity').with.script);
  const check = async (changes: object = {}, runChanges: object = {}) => {
    const outputs: Record<string, string> = {};
    await evaluate({ rest: { actions: {
      getArtifact: async () => ({ data: { ...artifact, ...changes } }),
      getWorkflowRunAttempt: async () => ({ data: { ...run, ...runChanges } })
    } } }, { repo: { owner: 'sec-platform', repo: 'sec' }, runId: 900 },
    { setOutput: (name: string, value: string) => { outputs[name] = value; }, notice: () => {} },
    { env: { ARTIFACT_ID: '101', EXPECTED_ARTIFACT_NAME: artifact.name, EXPECTED_ARTIFACT_DIGEST: digest,
      EXPECTED_RUN_ID: '42', EXPECTED_RUN_ATTEMPT: '1', EXPECTED_HEAD_SHA: main, EXPECTED_EXECUTION_DIGEST: digest } });
    return outputs;
  };
  expect((await check())['expires-at']).toBe(artifact.expires_at);
  expect((await check())['run-id']).toBe('42');
  for (const suffix of ['@main', '@refs/heads/main']) {
    expect((await check({}, { path: run.path + suffix }))['run-id']).toBe('42');
  }
  await expect(check({}, { path: run.path + '@other' })).rejects.toThrow();
  for (const change of [{ expired: true }, { expires_at: 'not-a-date' },
    { expires_at: new Date(now - 1).toISOString() }, { digest: 'sha256:' + 'd'.repeat(64) },
    { workflow_run: { id: 900 } }]) await expect(check(change)).rejects.toThrow();
  await expect(check({}, { run_attempt: 2 })).rejects.toThrow();
  await expect(check({}, { display_title: 'maintenance/other-plan' })).rejects.toThrow();
});

test('workflow shell stages parse without invoking a provider', () => {
  for (const value of steps.filter((entry) => entry.run !== undefined)) {
    const result = spawnSync('bash', ['-n'], { input: value.run, encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  }
});

test('privileged maintenance remains within the existing causal TCB', () => {
  expect(SEC_TRUSTED_BOOTSTRAP_REGISTRY.runtimeEntrypoints).toContain(RUNTIME_PATH);
  expect(SEC_TRUSTED_BOOTSTRAP_REGISTRY.staticDirectoryPaths).toContain('.github/workflows/');
});
