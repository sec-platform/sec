import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';

import { SEC_TRUSTED_BOOTSTRAP_REGISTRY } from '../../src/adapters/verification/platform/trust/contract/root.ts';

const WORKFLOW_PATH = '.github/workflows/repository-maintenance.yml';
const RUNTIME_PATH =
  'src/adapters/self-hosting/control/repository-maintenance/repository-maintenance.ts';

test('repository maintenance workflow persists and reads back recovery before any ref effect', () => {
  const source = readFileSync(path.resolve(import.meta.dir, '../..', WORKFLOW_PATH), 'utf8');
  const workflow = parseYaml(source) as any;
  expect(workflow.on).toEqual({ issue_comment: { types: ['created'] } });
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
  expect(retire.if).toContain('github.event.issue.number == 313');
  expect(retire.if).toContain("github.event.comment.author_association == 'OWNER'");
  expect(retire.if).toContain("github.event.comment.author_association == 'MEMBER'");
  expect(retire.if).toContain('github.actor == github.event.comment.user.login');
  expect(retire.if).toContain(
    'startsWith(github.event.comment.body, \'{"schema":"sec-repository-maintenance-request-v1"\')'
  );

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
  expect(prepare.shell).toBe('bash');
  expect(prepare.run).toContain('prepare-recovery');
  expect(prepare.run).toContain('sec-repository-maintenance-recovery-preparation.json');
  expect(prepare.run).toContain('recovery_root="$(dirname "$GITHUB_WORKSPACE")/sec-recovery"');
  expect(prepare.run).toContain('requires-recovery=');
  expect(prepare.env.GH_TOKEN).toBe('${{ github.token }}');

  expect(uploadRecovery.if).toBe("${{ steps.prepare.outputs.requires-recovery == 'true' }}");
  expect(uploadRecovery.uses).toBe(
    'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'
  );
  expect(uploadRecovery.with.name)
    .toBe('sec-repository-maintenance-recovery-${{ github.run_id }}-${{ github.run_attempt }}');
  expect(uploadRecovery.with.path).toBe('${{ runner.temp }}/sec-repository-maintenance-recovery');
  expect(uploadRecovery.with['retention-days']).toBe(30);

  expect(readbackRecovery.if)
    .toBe("${{ steps.prepare.outputs.requires-recovery == 'true' }}");
  expect(readbackRecovery.uses)
    .toBe('actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3');
  expect(readbackRecovery.with.script).toContain('github.rest.actions.getArtifact');
  expect(readbackRecovery.with.script).toContain('github.rest.actions.getWorkflowRun');
  expect(readbackRecovery.id).toBe('recovery-readback');
  expect(readbackRecovery.env.EXPECTED_ARTIFACT_DIGEST)
    .toBe('sha256:${{ steps.upload-recovery.outputs.artifact-digest }}');
  expect(readbackRecovery.with.script).toContain('artifact.data.workflow_run?.id !== context.runId');
  expect(readbackRecovery.with.script)
    .toContain('artifact.data.digest !== process.env.EXPECTED_ARTIFACT_DIGEST');

  expect(downloadRecovery.if)
    .toBe("${{ steps.prepare.outputs.requires-recovery == 'true' }}");
  expect(downloadRecovery.uses)
    .toBe('actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c');
  expect(downloadRecovery.with['artifact-ids'])
    .toBe('${{ steps.upload-recovery.outputs.artifact-id }}');
  expect(downloadRecovery.with.name).toBeUndefined();
  expect(downloadRecovery.with.path)
    .toBe('${{ runner.temp }}/sec-repository-maintenance-recovery-readback');

  expect(retire.steps.indexOf(install)).toBeLessThan(retire.steps.indexOf(prepare));
  expect(retire.steps.indexOf(prepare)).toBeLessThan(retire.steps.indexOf(uploadRecovery));
  expect(retire.steps.indexOf(uploadRecovery)).toBeLessThan(retire.steps.indexOf(readbackRecovery));
  expect(retire.steps.indexOf(readbackRecovery)).toBeLessThan(retire.steps.indexOf(downloadRecovery));
  expect(retire.steps.indexOf(downloadRecovery)).toBeLessThan(retire.steps.indexOf(execute));

  expect(execute.shell).toBe('bash');
  expect(execute.run).toContain('set -euo pipefail');
  expect(execute.run).toContain('sec-repository-maintenance-result.json');
  expect(execute.run).toContain(
    'bun src/adapters/self-hosting/control/repository-maintenance/repository-maintenance.ts --json'
  );
  expect(execute.run).toContain('| tee');
  expect(execute.env.GH_TOKEN).toBe('${{ github.token }}');
  expect(execute.env.SEC_MAINTENANCE_REQUEST_JSON)
    .toBe('${{ github.event.comment.body }}');
  expect(execute.env.SEC_MAINTENANCE_RECOVERY_PREPARATION_PATH)
    .toBe('${{ runner.temp }}/sec-repository-maintenance-recovery-preparation.json');
  expect(execute.env.SEC_MAINTENANCE_RECOVERY_READBACK_ROOT)
    .toBe('${{ runner.temp }}/sec-repository-maintenance-recovery-readback');
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
  expect(retire.steps.indexOf(execute)).toBeLessThan(retire.steps.indexOf(stage));
  expect(retire.steps.indexOf(stage)).toBeLessThan(retire.steps.indexOf(upload));
  expect(upload.if).toBe('always()');
  expect(upload.with.path).toBe('${{ runner.temp }}/sec-repository-maintenance-receipt');
  expect(upload.with['if-no-files-found']).toBe('error');
  expect(upload.with['retention-days']).toBe(30);
  expect(retire.steps.indexOf(upload)).toBeLessThan(retire.steps.indexOf(retireTrigger));
  expect(retireTrigger.if).toBe('success()');
  expect(retireTrigger.run).toBe(
    'bun src/adapters/self-hosting/control/repository-maintenance/repository-maintenance.ts retire-trigger'
  );
  expect(retireTrigger.env.GH_TOKEN).toBe('${{ github.token }}');
  expect(retireTrigger.env.SEC_MAINTENANCE_COMMENT_ID).toBe('${{ github.event.comment.id }}');
});

test('privileged repository maintenance runtime is part of the causal TCB policy', () => {
  expect(SEC_TRUSTED_BOOTSTRAP_REGISTRY.runtimeEntrypoints).toContain(RUNTIME_PATH);
  expect(SEC_TRUSTED_BOOTSTRAP_REGISTRY.staticDirectoryPaths)
    .toContain('.github/workflows/');
});
