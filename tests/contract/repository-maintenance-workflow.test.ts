import { expect, test } from 'bun:test';
import { parse as parseYaml } from 'yaml';

import { readCompilerFile } from '../helpers/compiler-fixtures.ts';

test('repository maintenance is a thin current-main workflow_dispatch over canonical owners', async () => {
  const workflow = parseYaml(await readCompilerFile('.github/workflows/repository-maintenance.yml')) as any;
  expect(workflow.on).toEqual({ workflow_dispatch: { inputs: {
    request_json: {
      description: 'Canonical sec-repository-maintenance-request-v1 JSON', required: true, type: 'string'
    },
    request_digest: {
      description: 'Expected sha256 digest of the canonical request value', required: true, type: 'string'
    }
  } } });
  expect(workflow.permissions).toEqual({ contents: 'read' });
  expect(workflow.concurrency).toEqual({
    group: 'sec-repository-maintenance-${{ github.repository_id }}',
    'cancel-in-progress': false
  });
  const job = workflow.jobs.maintenance;
  expect(job.env.SEC_BRANCH_RECOVERY_ROOT).toContain('runner.temp');
  expect(job['runs-on']).toEqual([
    'self-hosted', 'Linux', 'X64', 'sec-linux-verification-v1', 'sec-linux-verification-trusted-v1'
  ]);
  const checkout = job.steps.find((step: any) => step.name === 'Checkout exact current main owner');
  expect(checkout.with).toMatchObject({
    ref: '${{ steps.admission.outputs.main-sha }}',
    'fetch-depth': 0,
    'persist-credentials': false
  });
  const execute = job.steps.find((step: any) => step.name === 'Execute canonical repository maintenance owner');
  expect(execute.run).toContain('src/adapters/self-hosting/control/repository-maintenance/repository-maintenance.ts execute');
  expect(execute.run).not.toMatch(/git push|git update-ref|curl|gh api/u);
  const upload = job.steps.find((step: any) => step.name === 'Upload bounded maintenance receipt');
  expect(upload.with.path).toContain('${{ env.SEC_BRANCH_RECOVERY_ROOT }}/');
});
