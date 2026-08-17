import { expect, test } from 'bun:test';

import { readCompilerFile } from '../helpers/compiler-fixtures.ts';

test('Workbench mutation ingress no longer owns Plan mutation or Plan publication', async () => {
  const source = await readCompilerFile('platform/compiler/workbench/apply-view-mutations.ts');

  expect(source).toContain("from '../operations/engineering-operation.ts'");
  expect(source).toContain('applyEngineeringOperations(');
  for (const retiredWorkbenchAuthority of [
    "import YAML from 'yaml'",
    'PlanFile',
    'PlanSlot',
    'loadPlan(',
    'validatePlan(',
    "label: 'Workbench Plan mutation'",
    'targetPath: planPath'
  ]) {
    expect(source).not.toContain(retiredWorkbenchAuthority);
  }
});

test('canonical Engineering Operation owner validates and publishes source/app.yaml', async () => {
  const source = await readCompilerFile('platform/compiler/operations/engineering-operation.ts');

  expect(source).toContain('applyEngineeringOperations');
  expect(source).toContain('validatePlan(plan)');
  expect(source).toContain('publishCanonicalWorkspaceFileV1');
  expect(source).toContain("label: 'Engineering Operation Plan publication'");
  expect(source).toContain("'ENGINEERING-OPERATION-001'");
});
