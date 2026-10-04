import { expect, test } from 'bun:test';
import * as crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';

import { SEC_TRUSTED_BOOTSTRAP_REGISTRY } from '../../src/adapters/verification/platform/trust/contract/root.ts';

const WORKFLOW_PATH = '.github/workflows/repository-maintenance.yml';
const RUNTIME_PATH =
  'src/adapters/self-hosting/control/repository-maintenance/repository-maintenance.ts';

async function executeMaintenanceRequestScript(
  script: string,
  permission: unknown,
  outputs: Map<string, string>
): Promise<string> {
  const main = 'a'.repeat(40);
  const body = JSON.stringify({
    schema: 'sec-repository-maintenance-request-v1',
    repository: 'sec-platform/sec',
    expectedMainSha: main
  });
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as
    new (...args: string[]) => (...values: unknown[]) => Promise<void>;
  await new AsyncFunction('github', 'context', 'core', 'process', 'require', script)(
    { rest: {
      issues: { getComment: async (input: unknown) => {
        expect(input).toEqual({ owner: 'sec-platform', repo: 'sec', comment_id: 7 });
        return { data: { id: 7,
          issue_url: 'https://api.github.com/repos/sec-platform/sec/issues/313',
          user: { login: 'maintainer', type: 'User' }, performed_via_github_app: null,
          author_association: 'MEMBER', body } };
      } },
      repos: { getCollaboratorPermissionLevel: async (input: unknown) => {
        expect(input).toEqual({ owner: 'sec-platform', repo: 'sec', username: 'maintainer' });
        return { data: permission };
      } }
    } },
    { repo: { owner: 'sec-platform', repo: 'sec' }, actor: 'maintainer' },
    { setOutput: (name: string, value: string) => outputs.set(name, value), info() {} },
    { env: {
      PAYLOAD_JSON: JSON.stringify({ schema: 'sec-repository-maintenance-dispatch-v1',
        issue_number: 313, comment_id: 7,
        comment_body_sha256: `sha256:${crypto.createHash('sha256').update(body).digest('hex')}` }),
      EVENT_NAME: 'repository_dispatch', EVENT_ACTION: 'sec-repository-maintenance-v2',
      WORKFLOW_SHA: main, EVENT_SHA: main
    } },
    (name: string) => {
      if (name !== 'crypto') throw new Error('Unexpected maintenance script dependency');
      return crypto;
    }
  );
  return body;
}

test('repository maintenance workflow persists and reads back recovery before any ref effect', async () => {
  const source = readFileSync(path.resolve(import.meta.dir, '../..', WORKFLOW_PATH), 'utf8');
  const workflow = parseYaml(source) as any;

  expect(workflow.on).toEqual({ repository_dispatch: { types: ['sec-repository-maintenance-v2'] } });
  expect(workflow.permissions).toEqual({
    actions: 'read',
    contents: 'write',
    issues: 'write',
    'pull-requests': 'read'
  });
  expect(workflow.concurrency).toEqual({
    group: 'sec-repository-maintenance',
    'cancel-in-progress': false
  });

  const retire = workflow.jobs.retire;
  expect(retire['runs-on']).toBe('ubuntu-24.04');
  expect(retire['timeout-minutes']).toBe(20);
  expect(retire.if).toBeUndefined();
  expect(retire.outputs).toEqual({
    'requires-recovery': '${{ steps.prepare.outputs.requires-recovery }}',
    'recovery-artifact-id': '${{ steps.upload-recovery.outputs.artifact-id }}',
    'recovery-artifact-digest': '${{ steps.upload-recovery.outputs.artifact-digest }}',
    'receipt-artifact-id': '${{ steps.upload-receipt.outputs.artifact-id }}',
    'receipt-artifact-digest': '${{ steps.upload-receipt.outputs.artifact-digest }}'
  });

  const request = retire.steps.find((step: any) =>
    step.name === 'Resolve exact maintenance request carrier');
  expect(request.id).toBe('request');
  expect(request.uses).toBe(
    'actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3'
  );
  expect(request.env.PAYLOAD_JSON).toBe('${{ toJSON(github.event.client_payload) }}');
  expect(request.with.script).toContain("process.env.EVENT_NAME !== 'repository_dispatch'");
  expect(request.with.script).toContain("process.env.EVENT_ACTION !== 'sec-repository-maintenance-v2'");
  expect(request.with.script).toContain("payload.schema !== 'sec-repository-maintenance-dispatch-v1'");
  expect(request.with.script).toContain('payload.issue_number !== 313');
  expect(request.with.script).toContain('github.rest.issues.getComment');
  expect(request.with.script).toContain('github.rest.repos.getCollaboratorPermissionLevel');
  expect(request.with.script).toContain("comment.data.user?.login !== context.actor");
  expect(request.with.script).toContain('normalizeGitHubRepositoryPermission(permission.data)');
  expect(request.with.script).toContain('!isRepositoryMaintenancePermission(role)');
  expect(request.with.script).not.toContain('associationAccepted');
  expect(source).not.toContain('SEC_MAINTENANCE_AUTHOR_ASSOCIATION');
  // Exercise the actual workflow decision, including GitHub's legacy write
  // projection of maintain. Raw permission text cannot establish this contract.
  for (const permission of [
    { permission: 'admin', role_name: 'admin' },
    { permission: 'write', role_name: 'maintain' },
    { permission: 'maintain', role_name: 'maintain' },
    { permission: 'maintain' }
  ]) {
    const outputs = new Map<string, string>();
    const body = await executeMaintenanceRequestScript(request.with.script, permission, outputs);
    expect(Object.fromEntries(outputs)).toEqual({
      'request-json': body, 'issue-number': '313', 'comment-id': '7',
      'comment-author': 'maintainer'
    });
  }
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
    const outputs = new Map<string, string>();
    await expect(executeMaintenanceRequestScript(request.with.script, permission, outputs))
      .rejects.toThrow('Repository maintenance trigger comment or dispatcher authority differs.');
    expect(outputs.size).toBe(0);
  }
  expect(request.with.script).toContain('bodyDigest !== payload.comment_body_sha256');
  expect(request.with.script).toContain('request?.expectedMainSha !== process.env.EVENT_SHA');

  const checkout = retire.steps.find((step: any) =>
    step.name === 'Checkout exact maintenance authority');
  expect(checkout.uses).toBe(
    'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1'
  );
  expect(checkout.with).toMatchObject({
    ref: '${{ github.sha }}',
    'fetch-depth': 0,
    'persist-credentials': false
  });

  const install = retire.steps.find((step: any) =>
    step.name === 'Install maintenance dependencies from frozen lock');
  const prepare = retire.steps.find((step: any) =>
    step.name === 'Prepare exact recovery before any ref effect');
  const uploadRecovery = retire.steps.find((step: any) =>
    step.name === 'Upload exact pre-effect recovery');
  const readbackRecovery = retire.steps.find((step: any) =>
    step.name === 'Read back exact pre-effect recovery identity');
  const downloadRecovery = retire.steps.find((step: any) =>
    step.name === 'Download exact pre-effect recovery');
  const execute = retire.steps.find((step: any) =>
    step.name === 'Execute exact repository maintenance request');

  expect(install.run).toBe('bun install --frozen-lockfile --ignore-scripts');

  expect(prepare.id).toBe('prepare');
  expect(prepare.shell).toBe('bash');
  expect(prepare.run).toContain('set -euo pipefail');
  expect(prepare.run).toContain('carrier_root="/tmp/sec-repository-maintenance-carrier"');
  expect(prepare.run).toContain('if [[ -e "$carrier_root" || -L "$carrier_root" ]]');
  expect(prepare.run).toContain('mkdir -- "$carrier_root"');
  expect(prepare.run).toContain('test ! -L "$carrier_root"');
  expect(prepare.run).toContain('preparation_file="$carrier_root/recovery-preparation.json"');
  expect(prepare.run).toContain('repository-maintenance.ts prepare-recovery');
  expect(prepare.run).toContain('recovery_root="$(dirname "$GITHUB_WORKSPACE")/sec-recovery"');
  expect(prepare.run).toContain('artifact_root="$carrier_root/upload"');
  expect(prepare.run).toContain('^sec-branch-closeout-[A-Za-z0-9.-]+\\.bundle$');
  expect(prepare.run).toContain('"$artifact_root/recovery.bundle"');
  expect(prepare.run).toContain('"$artifact_root/recovery.bundle.sha256"');
  expect(prepare.run).toContain('requires-recovery=');
  expect(prepare.env.GH_TOKEN).toBe('${{ github.token }}');

  expect(uploadRecovery.id).toBe('upload-recovery');
  expect(uploadRecovery.if).toBe("${{ steps.prepare.outputs.requires-recovery == 'true' }}");
  expect(uploadRecovery.uses).toBe(
    'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'
  );
  expect(uploadRecovery.with).toMatchObject({
    name: 'sec-repository-maintenance-recovery-${{ github.run_id }}-${{ github.run_attempt }}',
    path: '/tmp/sec-repository-maintenance-carrier/upload',
    'if-no-files-found': 'error',
    'retention-days': 30
  });

  expect(readbackRecovery.id).toBe('recovery-readback');
  expect(readbackRecovery.if)
    .toBe("${{ steps.prepare.outputs.requires-recovery == 'true' }}");
  expect(readbackRecovery.uses)
    .toBe('actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3');
  expect(readbackRecovery.env.ARTIFACT_ID)
    .toBe('${{ steps.upload-recovery.outputs.artifact-id }}');
  expect(readbackRecovery.env.EXPECTED_ARTIFACT_DIGEST)
    .toBe('sha256:${{ steps.upload-recovery.outputs.artifact-digest }}');
  expect(readbackRecovery.with.script).toContain('github.rest.actions.getArtifact');
  expect(readbackRecovery.with.script).toContain('github.rest.actions.getWorkflowRun');
  expect(readbackRecovery.with.script).toContain('artifact.data.id !== artifactId');
  expect(readbackRecovery.with.script)
    .toContain('artifact.data.digest !== process.env.EXPECTED_ARTIFACT_DIGEST');
  expect(readbackRecovery.with.script)
    .toContain('artifact.data.workflow_run?.id !== context.runId');
  expect(readbackRecovery.with.script)
    .toContain('run.data.run_attempt !== expectedRunAttempt');

  expect(downloadRecovery.if)
    .toBe("${{ steps.prepare.outputs.requires-recovery == 'true' }}");
  expect(downloadRecovery.uses)
    .toBe('actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c');
  expect(downloadRecovery.with['artifact-ids'])
    .toBe('${{ steps.upload-recovery.outputs.artifact-id }}');
  expect(downloadRecovery.with.name).toBeUndefined();
  expect(downloadRecovery.with.path)
    .toBe('/tmp/sec-repository-maintenance-carrier/readback');

  expect(retire.steps.indexOf(request)).toBeLessThan(retire.steps.indexOf(checkout));
  expect(retire.steps.indexOf(checkout)).toBeLessThan(retire.steps.indexOf(install));
  expect(retire.steps.indexOf(install)).toBeLessThan(retire.steps.indexOf(prepare));
  expect(retire.steps.indexOf(prepare)).toBeLessThan(retire.steps.indexOf(uploadRecovery));
  expect(retire.steps.indexOf(uploadRecovery)).toBeLessThan(retire.steps.indexOf(readbackRecovery));
  expect(retire.steps.indexOf(readbackRecovery)).toBeLessThan(retire.steps.indexOf(downloadRecovery));
  expect(retire.steps.indexOf(downloadRecovery)).toBeLessThan(retire.steps.indexOf(execute));

  expect(execute.shell).toBe('bash');
  expect(execute.run).toContain('set -euo pipefail');
  expect(execute.run).toContain(
    'bun src/adapters/self-hosting/control/repository-maintenance/repository-maintenance.ts --json'
  );
  expect(execute.run).toContain('sec-repository-maintenance-result.json');
  expect(execute.run).toContain('| tee');
  expect(execute.env.GH_TOKEN).toBe('${{ github.token }}');
  expect(execute.env.SEC_MAINTENANCE_REQUEST_JSON)
    .toBe('${{ steps.request.outputs.request-json }}');
  expect(execute.env.SEC_MAINTENANCE_ISSUE_NUMBER)
    .toBe('${{ steps.request.outputs.issue-number }}');
  expect(execute.env.SEC_MAINTENANCE_COMMENT_AUTHOR)
    .toBe('${{ steps.request.outputs.comment-author }}');
  expect(execute.env.SEC_MAINTENANCE_RECOVERY_PREPARATION_PATH).toBeUndefined();
  expect(execute.env.SEC_MAINTENANCE_RECOVERY_READBACK_ROOT).toBeUndefined();
  expect(execute.env.SEC_MAINTENANCE_RECOVERY_ARTIFACT_ID)
    .toBe('${{ steps.upload-recovery.outputs.artifact-id }}');
  expect(execute.env.SEC_MAINTENANCE_RECOVERY_ARTIFACT_NAME)
    .toBe('sec-repository-maintenance-recovery-${{ github.run_id }}-${{ github.run_attempt }}');
  expect(execute.env.SEC_MAINTENANCE_RECOVERY_ARTIFACT_DIGEST)
    .toBe('sha256:${{ steps.upload-recovery.outputs.artifact-digest }}');
  expect(execute.env.SEC_MAINTENANCE_RECOVERY_RUN_ID).toBe('${{ github.run_id }}');
  expect(execute.env.SEC_MAINTENANCE_RECOVERY_RUN_ATTEMPT).toBe('${{ github.run_attempt }}');
  expect(execute.env.SEC_BRANCH_RECOVERY_ROOT).toBeUndefined();

  const stage = retire.steps.find((step: any) =>
    step.name === 'Stage terminal repository maintenance receipt');
  const upload = retire.steps.find((step: any) =>
    step.name === 'Upload repository maintenance receipt');
  const retireTrigger = retire.steps.find((step: any) =>
    step.name === 'Retire maintenance trigger comment');

  expect(stage.if).toBe('always()');
  expect(stage.run).toContain('artifact_root="$RUNNER_TEMP/sec-repository-maintenance-receipt"');
  expect(stage.run).not.toContain('recovery_root=');
  expect(stage.run).toContain('sec-repository-maintenance-request.json');
  expect(stage.run).toContain('sec-repository-maintenance-result.json');

  expect(upload.id).toBe('upload-receipt');
  expect(upload.if).toBe('always()');
  expect(upload.with).toMatchObject({
    path: '${{ runner.temp }}/sec-repository-maintenance-receipt',
    'if-no-files-found': 'error',
    'retention-days': 30
  });

  expect(retire.steps.indexOf(execute)).toBeLessThan(retire.steps.indexOf(stage));
  expect(retire.steps.indexOf(stage)).toBeLessThan(retire.steps.indexOf(upload));
  expect(retire.steps.indexOf(upload)).toBeLessThan(retire.steps.indexOf(retireTrigger));

  expect(retireTrigger.if).toBe('success()');
  expect(retireTrigger.run).toBe(
    'bun src/adapters/self-hosting/control/repository-maintenance/repository-maintenance.ts retire-trigger'
  );
  expect(retireTrigger.env.GH_TOKEN).toBe('${{ github.token }}');
  expect(retireTrigger.env.SEC_MAINTENANCE_COMMENT_ID)
    .toBe('${{ steps.request.outputs.comment-id }}');

  const carrierRetirement = workflow.jobs['retire-recovery-carrier'];
  expect(carrierRetirement.needs).toBe('retire');
  expect(carrierRetirement.if)
    .toBe("${{ needs.retire.result == 'success' && needs.retire.outputs.requires-recovery == 'true' }}");
  expect(carrierRetirement['runs-on']).toBe('ubuntu-24.04');
  expect(carrierRetirement['timeout-minutes']).toBe(5);
  expect(carrierRetirement.permissions).toEqual({ actions: 'write' });
  expect(carrierRetirement.steps).toHaveLength(1);
  const carrierStep = carrierRetirement.steps[0];
  expect(carrierStep.name).toBe('Retire exact terminal recovery carrier');
  expect(carrierStep.uses)
    .toBe('actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3');
  expect(carrierStep.env.RECOVERY_ARTIFACT_ID)
    .toBe('${{ needs.retire.outputs.recovery-artifact-id }}');
  expect(carrierStep.env.RECEIPT_ARTIFACT_ID)
    .toBe('${{ needs.retire.outputs.receipt-artifact-id }}');
  expect(carrierStep.with.script).toContain('github.rest.actions.deleteArtifact');
  expect(carrierStep.with.script).toContain('error?.status !== 404');
  expect(carrierStep.with.script).toContain('artifact.data.workflow_run?.id !== context.runId');
  expect(carrierStep.with.script).toContain('run.data.run_attempt !== expectedRunAttempt');
  expect(carrierStep.with.script).toContain('const receiptReadback = await readArtifact(receiptId)');
});

test('privileged repository maintenance runtime is part of the causal TCB policy', () => {
  expect(SEC_TRUSTED_BOOTSTRAP_REGISTRY.runtimeEntrypoints).toContain(RUNTIME_PATH);
  expect(SEC_TRUSTED_BOOTSTRAP_REGISTRY.staticDirectoryPaths)
    .toContain('.github/workflows/');
});