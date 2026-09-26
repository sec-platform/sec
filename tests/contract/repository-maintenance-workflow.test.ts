import { expect, test } from 'bun:test';
import { parse as parseYaml } from 'yaml';

import { readCompilerFile } from '../helpers/compiler-fixtures.ts';

test('repository maintenance is a thin default-branch repository_dispatch over canonical owners', async () => {
  const workflow = parseYaml(await readCompilerFile('.github/workflows/repository-maintenance.yml')) as any;
  expect(workflow.on).toEqual({ repository_dispatch: { types: ['sec-repository-maintenance-v1'] } });
  expect(workflow.permissions).toEqual({ contents: 'read' });
  expect(workflow.concurrency).toEqual({
    group: 'sec-repository-maintenance-${{ github.repository_id }}',
    'cancel-in-progress': false
  });
  const job = workflow.jobs.maintenance;
  expect(job.if).toBe("${{ github.event_name == 'repository_dispatch' && github.event.action == 'sec-repository-maintenance-v1' }}");
  expect(job.env).toBeUndefined();
  expect(job['runs-on']).toEqual([
    'self-hosted', 'Linux', 'X64', 'sec-linux-verification-v1', 'sec-linux-verification-trusted-v1'
  ]);
  const admission = job.steps.find((step: any) => step.name === 'Admit exact main and maintainer actors');
  const checkout = job.steps.find((step: any) => step.name === 'Checkout admitted current main');
  expect(job.steps.indexOf(admission)).toBeLessThan(job.steps.indexOf(checkout));
  expect(admission.env).toEqual({ EVENT_TYPE: '${{ github.event.action }}' });
  expect(admission.with.script).toContain('GITHUB_WORKFLOW_SHA');
  expect(admission.with.script).toContain('GITHUB_TRIGGERING_ACTOR');
  expect(admission.with.script).toContain("context.eventName !== 'repository_dispatch'");
  expect(admission.with.script).toContain("process.env.EVENT_TYPE !== 'sec-repository-maintenance-v1'");
  expect(admission.with.script).not.toMatch(/createHash|request_json|request_digest|writeFile|mkdir|canonical\s*=/u);
  expect(checkout.with.ref).toBeUndefined();
  expect(checkout.with).toEqual({
    'fetch-depth': 1,
    'persist-credentials': false,
    lfs: false,
    submodules: false
  });
  expect(job.steps.some((step: any) => step.name === 'Cache Bun package downloads')).toBe(false);
  const execute = job.steps.find((step: any) => step.name === 'Execute canonical repository maintenance owner');
  expect(execute.env.SEC_MAINTENANCE_EVENT_TYPE).toBe('${{ github.event.action }}');
  expect(execute.env.SEC_MAINTENANCE_REQUEST_JSON).toBe('${{ github.event.client_payload.request_json }}');
  expect(execute.env.SEC_MAINTENANCE_REQUEST_DIGEST).toBe('${{ github.event.client_payload.request_digest }}');
  expect(execute.env.SEC_BRANCH_RECOVERY_ROOT).toContain('${{ runner.temp }}');
  expect(execute.run).toContain('src/adapters/self-hosting/control/repository-maintenance/repository-maintenance.ts execute --json');
  expect(execute.run).not.toContain('--request');
  expect(execute.run).not.toContain('github.event.client_payload');
  expect(job.steps.filter((step: any) => typeof step.run === 'string')
    .some((step: any) => step.run.includes('github.event.client_payload'))).toBe(false);
  expect(execute.run).not.toMatch(/git push|git update-ref|curl|gh api/u);
  const upload = job.steps.find((step: any) => step.name === 'Upload bounded maintenance receipt');
  expect(upload.with.path).not.toContain('request.json');
  expect(upload.with.path).toContain('${{ runner.temp }}/sec-repository-maintenance-recovery-');
});
