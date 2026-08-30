import { expect, test } from 'bun:test';

import {
  buildMinimalWorkspacePlan,
  buildWorkspaceCreatePlan
} from '../../src/compiler/orchestration/workspace-create-template.ts';
import { buildReferenceWorkspacePlan } from '../../src/reference/reference-workspace-template.ts';

test('ordinary workspace creation defaults to business-neutral minimal Plan data', () => {
  const minimal = buildMinimalWorkspacePlan();
  expect(minimal.app.id).toBe('app');
  expect(minimal.app.name).toBe('app');
  expect(minimal.blocks).toEqual([]);
  expect(minimal.slots).toEqual([]);
  expect(minimal.acceptance).toEqual([]);
  expect(buildWorkspaceCreatePlan('minimal')).toEqual(minimal);
});

test('reference Customer choices require the explicit reference-customer template', () => {
  const plan = buildReferenceWorkspacePlan();
  expect(buildWorkspaceCreatePlan('reference-customer')).toEqual(plan);
  expect(plan.app.id).toBe('customer-admin');
  expect(plan.blocks.map((block) => block.id)).toEqual([
    'auth/basic-session',
    'tenant/basic-workspace',
    'entity/customer-basic'
  ]);
  expect(plan.slots.map((slot) => slot.id)).toEqual(['customer_normalizer']);
});
