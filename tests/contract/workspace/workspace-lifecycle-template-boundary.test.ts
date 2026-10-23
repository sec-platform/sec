import { expect, test } from 'bun:test';

import { buildWorkspaceCreatePlan } from '../../../src/application/workspace-create.ts';

test('the minimal workspace template has business-neutral Plan data', () => {
  const minimal = buildWorkspaceCreatePlan('minimal', { officialRegistryRelativePath: 'registry/official' });
  expect(minimal.app.id).toBe('app');
  expect(minimal.app.name).toBe('app');
  expect(minimal.blocks).toEqual([]);
  expect(minimal.acceptance).toEqual([]);
});

test('reference Customer choices require the explicit reference-customer template', () => {
  const plan = buildWorkspaceCreatePlan('reference-customer', { officialRegistryRelativePath: 'registry/official' });
  expect(plan.app.id).toBe('customer-admin');
  expect(plan.blocks.map((block) => block.id)).toEqual([
    'auth/basic-session',
    'tenant/basic-workspace',
    'entity/customer-basic'
  ]);
});
