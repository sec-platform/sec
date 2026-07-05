import { expect, test } from 'bun:test';

import type { LockFile } from '../../platform/shared/lock-types.ts';
import { currentReadOnlyProjectPaths } from '../../platform/shared/project-baseline.ts';

function lockFixture(): LockFile {
  return {
    formatVersion: '1',
    app: {
      name: 'baseline-path-test',
      stack: 'nextjs-ts-prisma-sqlite',
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
      registryPath: 'platform/registry/official',
      sourceRoot: 'test.block',
      action: 'copy',
      from: 'files/src/service.ts',
      to: 'src/service.ts'
    }],
    slotTasks: [{
      id: 'custom_slot',
      block: 'test/block',
      target: 'custom/slot.ts',
      symbol: 'customSlot',
      kind: 'adapter',
      status: 'filled',
      writableZones: ['custom/slot.ts'],
      provenanceHints: {
        generator: null,
        verifiedBy: []
      }
    }],
    generatedPaths: [
      'app/page.tsx',
      'custom/slot.ts',
      'control/evidence/report.json',
      'next-env.d.ts',
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
    ['components/brand.tsx', 'custom/slot.ts', '.sec/cache/local.json']
  )).toEqual([
    'app/page.tsx',
    'components/brand.tsx',
    'src/service.ts'
  ]);
});
