import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { parse as parseYaml } from 'yaml';

import { SEC_TRUSTED_BOOTSTRAP_REGISTRY } from '../../src/adapters/verification/platform/trust/contract/root.ts';

const WORKFLOW_PATH = '.github/workflows/repository-maintenance.yml';
const RUNTIME_PATH =
  'src/adapters/self-hosting/control/repository-maintenance/repository-maintenance.ts';

test('repository maintenance workflow exposes one maintainer-only lifecycle trigger', () => {
  const source = readFileSync(path.resolve(import.meta.dir, '../..', WORKFLOW_PATH), 'utf8');
  const workflow = parseYaml(source) as any;
  expect(workflow.on).toEqual({ issue_comment: { types: ['created'] } });
  expect(workflow.permissions).toEqual({
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
  const execute = retire.steps.find((step: any) =>
    step.name === 'Execute exact repository maintenance request');
  expect(install.run).toBe('bun install --frozen-lockfile --ignore-scripts');
  expect(retire.steps.indexOf(install)).toBeLessThan(retire.steps.indexOf(execute));
  expect(execute.shell).toBe('bash');
  expect(execute.run).toContain('set -euo pipefail');
  expect(execute.run).toContain('sec-repository-maintenance-request.json');
  expect(execute.run).toContain('sec-repository-maintenance-result.json');
  expect(execute.run).toContain(
    'bun src/adapters/self-hosting/control/repository-maintenance/repository-maintenance.ts --json'
  );
  expect(execute.run).toContain('| tee');
  expect(execute.env.GH_TOKEN).toBe('${{ github.token }}');
  expect(execute.env.SEC_MAINTENANCE_REQUEST_JSON)
    .toBe('${{ github.event.comment.body }}');
  expect(execute.env.SEC_BRANCH_RECOVERY_ROOT).toBeUndefined();
  const stage = retire.steps.find((step: any) =>
    step.name === 'Stage repository maintenance receipt');
  const upload = retire.steps.find((step: any) =>
    step.name === 'Upload repository maintenance receipt');
  const retireTrigger = retire.steps.find((step: any) =>
    step.name === 'Retire maintenance trigger comment');
  expect(stage.if).toBe('always()');
  expect(stage.run).toContain('recovery_root="$(dirname "$GITHUB_WORKSPACE")/sec-recovery"');
  expect(stage.run).toContain('artifact_root="$RUNNER_TEMP/sec-repository-maintenance-recovery"');
  expect(stage.run).toContain('sec-repository-maintenance-request.json');
  expect(stage.run).toContain('sec-repository-maintenance-result.json');
  expect(retire.steps.indexOf(stage)).toBeLessThan(retire.steps.indexOf(upload));
  expect(upload.if).toBe('always()');
  expect(upload.with.path).toBe('${{ runner.temp }}/sec-repository-maintenance-recovery');
  expect(upload.with['if-no-files-found']).toBe('error');
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
