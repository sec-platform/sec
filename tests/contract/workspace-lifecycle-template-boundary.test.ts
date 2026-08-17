import { expect, test } from 'bun:test';

import { buildReferenceWorkspacePlan } from '../../platform/reference/reference-workspace-template.ts';
import { readCompilerFile } from '../helpers/compiler-fixtures.ts';

test('Workspace Lifecycle owner does not embed reference business identities', async () => {
  const lifecycle = await readCompilerFile('platform/orchestrator/workspace-orchestrator.ts');
  const template = await readCompilerFile('platform/reference/reference-workspace-template.ts');

  for (const businessIdentity of [
    'customer-admin',
    'auth/basic-session',
    'tenant/basic-workspace',
    'entity/customer-basic',
    'customer_normalizer',
    'normalizeCustomerInput'
  ]) {
    expect(lifecycle).not.toContain(businessIdentity);
    expect(template).toContain(businessIdentity);
  }
  expect(lifecycle).toContain('buildReferenceWorkspacePlan()');
  expect(lifecycle).toContain('id: plan.app.id');
  expect(lifecycle).toContain('acceptancePlan: plan.acceptance.map');
});

test('reference workspace choices are explicit template data', () => {
  const plan = buildReferenceWorkspacePlan();
  expect(plan.app.id).toBe('customer-admin');
  expect(plan.blocks.map((block) => block.id)).toEqual([
    'auth/basic-session',
    'tenant/basic-workspace',
    'entity/customer-basic'
  ]);
  expect(plan.slots.map((slot) => slot.id)).toEqual(['customer_normalizer']);
});
