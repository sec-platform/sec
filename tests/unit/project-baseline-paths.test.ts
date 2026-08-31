import { expect, test } from 'bun:test';

import type { LockFile } from '../../src/compiler/contract.ts';
import { currentReadOnlyProjectPaths } from '../../src/workspace/project.ts';

function lockFixture(): LockFile {
  return {
    formatVersion: '1',
    app: {
      id: 'baseline-path-test',
      name: 'baseline-path-test',
      stack: 'typescript-library',
      mode: 'single-tenant'
    },
    resolvedBlocks: [],
    resolvedCapabilities: [],
    installPlan: [{
      stepId: 'test:block:1',
      blockId: 'test/block',
      registrySourceId: 'official',
      registryKind: 'official',
      registryLocation: 'compiler',
      registryPath: 'catalog/registry/official',
      sourceRoot: 'test.block',
      action: 'copy',
      from: 'files/src/service.ts',
      to: 'src/installed/service.ts'
    }],
    slotTasks: [{
      id: 'custom_slot',
      block: 'test/block',
      target: 'src/slots/custom-slot.ts',
      symbol: 'customSlot',
      kind: 'adapter',
      status: 'filled',
      writableZones: ['src/slots/custom-slot.ts'],
      provenanceHints: {
        generator: null,
        verifiedBy: []
      }
    }],
    generatedPaths: [
      'src/ui/page.tsx',
      'src/slots/custom-slot.ts',
      'model/policies/policy.spec.yaml',
      '.sec/artifacts/evidence/report.json',
      'tsconfig.json'
    ],
    acceptancePlan: [],
    passStatus: {
      parse: 'succeeded',
      align: 'succeeded',
      resolve: 'succeeded',
      compose: 'succeeded',
      adapt: 'succeeded',
      verify: 'pending',
      repair: 'pending',
      lock: 'pending',
      emit: 'pending'
    }
  };
}

test('project baseline includes block, generated, and override outputs but excludes writable and control paths', () => {
  expect(currentReadOnlyProjectPaths(
    lockFixture(),
    ['src/ui/brand.tsx', 'src/slots/custom-slot.ts', 'model/patches/manual.ts', '.sec/cache/local.json']
  )).toEqual([
    'src/installed/service.ts',
    'src/ui/brand.tsx',
    'src/ui/page.tsx'
  ]);
});
