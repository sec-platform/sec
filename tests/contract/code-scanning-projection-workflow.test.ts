import { expect, test } from 'bun:test';
import { parse as parseYaml } from 'yaml';

import { readCompilerFile } from '../helpers/compiler-fixtures.ts';

test('CodeQL finding projection is one exact default-branch non-authority projection', async () => {
  const workflow = parseYaml(await readCompilerFile('.github/workflows/code-scanning-projection.yml')) as any;
  expect(workflow.on).toEqual({
    workflow_run: { workflows: ['CodeQL'], types: ['completed'] }
  });
  expect(workflow.permissions).toEqual({
    actions: 'read',
    contents: 'read',
    issues: 'write',
    'pull-requests': 'read',
    'security-events': 'read'
  });
  expect(workflow.concurrency).toEqual({
    group: 'sec-code-scanning-projection-${{ github.event.workflow_run.id }}',
    'cancel-in-progress': true
  });
  const job = workflow.jobs.project;
  expect(job['runs-on']).toEqual([
    'self-hosted', 'Linux', 'X64', 'sec-linux-verification-v1', 'sec-linux-verification-trusted-v1'
  ]);
  const checkout = job.steps.find((step: any) => step.name === 'Checkout trusted projection owner');
  expect(checkout.with).toMatchObject({
    ref: '${{ github.workflow_sha }}',
    'persist-credentials': false,
    lfs: false,
    submodules: false
  });
  const publish = job.steps.find((step: any) => step.name === 'Project exact CodeQL findings to the pull request');
  expect(publish.run).toContain('code-scanning-projection.ts');
  expect(publish.run).toContain('publish ${{ github.event.workflow_run.id }}');
});
