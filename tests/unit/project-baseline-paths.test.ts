import { expect, test } from 'bun:test';

import { currentReadOnlyProjectPaths } from '../../src/adapters/workspace/project-baseline.ts';
import type { ProjectBaselinePathInput } from '../../src/workspace/contract/project-baseline.ts';

function baselinePathInput(): ProjectBaselinePathInput {
  return {
    artifactPaths: [
      'src/installed/service.ts',
      'src/ui/page.tsx',
      'src/installed/customization.ts',
      'model/policies/policy.spec.yaml',
      '.sec/artifacts/evidence/report.json',
      'tsconfig.json',
      'src/ui/brand.tsx',
      'src/installed/customization.ts',
      'model/patches/manual.ts',
      '.sec/cache/local.json'
    ]
  };
}

test('project baseline includes project source outputs but excludes model and control paths', () => {
  expect(currentReadOnlyProjectPaths(baselinePathInput())).toEqual([
    'src/installed/customization.ts',
    'src/installed/service.ts',
    'src/ui/brand.tsx',
    'src/ui/page.tsx'
  ]);
});
