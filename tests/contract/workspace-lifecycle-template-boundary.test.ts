import { expect, test } from 'bun:test';

import {
  buildMinimalWorkspacePlan,
  buildReferenceWorkspacePlan,
  buildWorkspaceCreatePlan
} from '../../src/application/workspace-create.ts';

test('ordinary workspace creation defaults to business-neutral minimal Plan data', () => {
  const minimal = buildMinimalWorkspacePlan({ officialRegistryRelativePath: 'registry/official' });
  expect(minimal.app.id).toBe('app');
  expect(minimal.app.name).toBe('app');
  expect(minimal.blocks).toEqual([]);
  expect(minimal.acceptance).toEqual([]);
  expect(buildWorkspaceCreatePlan('minimal', { officialRegistryRelativePath: 'registry/official' })).toEqual(minimal);
});

test('reference Customer choices require the explicit reference-customer template', () => {
  const plan = buildReferenceWorkspacePlan({ officialRegistryRelativePath: 'registry/official' });
  expect(buildWorkspaceCreatePlan('reference-customer', { officialRegistryRelativePath: 'registry/official' })).toEqual(plan);
  expect(plan.app.id).toBe('customer-admin');
  expect(plan.blocks.map((block) => block.id)).toEqual([
    'auth/basic-session',
    'tenant/basic-workspace',
    'entity/customer-basic'
  ]);
});
