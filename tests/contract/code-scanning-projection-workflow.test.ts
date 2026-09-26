import { expect, test } from 'bun:test';
import { parse as parseYaml } from 'yaml';

import { readCompilerFile } from '../helpers/compiler-fixtures.ts';

test('CodeQL finding projection runs trusted default code after same-repository PR changes', async () => {
  const workflow = parseYaml(await readCompilerFile('.github/workflows/code-scanning-projection.yml')) as any;
  expect(workflow.on).toEqual({
    pull_request_target: { types: ['opened', 'reopened', 'synchronize', 'ready_for_review'] }
  });
  expect(workflow.permissions).toEqual({
    checks: 'read',
    contents: 'read',
    issues: 'write',
    'pull-requests': 'read',
    'security-events': 'read'
  });
  expect(workflow.concurrency).toEqual({
    group: 'sec-code-scanning-projection-${{ github.event.pull_request.number }}',
    'cancel-in-progress': true
  });
  const job = workflow.jobs.project;
  expect(job.if).toContain("github.event.pull_request.base.ref == 'main'");
  expect(job.if).toContain('github.event.pull_request.head.repo.full_name == github.repository');
  expect(job['runs-on']).toEqual([
    'self-hosted', 'Linux', 'X64', 'sec-linux-verification-v1', 'sec-linux-verification-trusted-v1'
  ]);
  const checkout = job.steps.find((step: any) => step.name === 'Checkout trusted projection owner');
  expect(checkout.with).toMatchObject({
    ref: '${{ github.sha }}',
    'persist-credentials': false,
    lfs: false,
    submodules: false
  });
  const join = job.steps.find((step: any) => step.name === 'Join final GitHub Advanced Security CodeQL check');
  expect(join.uses).toBe('actions/github-script@3a2844b7e9c422d3c10d287c895573f7108da1b3');
  expect(join.with.script).toContain("run.app?.slug === 'github-advanced-security'");
  expect(join.with.script).toContain("run.conclusion === 'success' || run.conclusion === 'failure'");
  const publish = job.steps.find((step: any) => step.name === 'Project exact CodeQL findings to the pull request');
  expect(publish.run).toBe('bun src/adapters/verification/platform/ci/runtime/code-scanning-projection.ts publish');
  expect(publish.env.SEC_CODE_SCANNING_CHECK_ID).toBe('${{ steps.codeql.outputs.check-id }}');
});
