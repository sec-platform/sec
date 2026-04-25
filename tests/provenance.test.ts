import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildProvenance } from '../platform/compiler/emit/write-provenance.ts';
import type { LockFile } from '../platform/shared/types.ts';

test('buildProvenance sorts and deduplicates slot verification hints', async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'engineering-compiler-provenance-'));
  try {
    const lock: LockFile = {
      formatVersion: '1',
      app: {
        name: 'customer-admin',
        stack: 'nextjs',
        mode: 'single-tenant'
      },
      resolvedBlocks: [],
      resolvedCapabilities: [],
      installPlan: [],
      slotTasks: [
        {
          id: 'customer_normalizer',
          block: 'entity/customer-basic',
          target: 'custom/customer_normalizer.ts',
          symbol: 'normalizeCustomerInput',
          kind: 'adapter',
          status: 'filled',
          writableZones: ['custom/customer_normalizer.ts'],
          provenanceHints: {
            generator: 'test',
            verifiedBy: [
              'tests/unit/customer-normalizer.test.ts',
              'tests/acceptance/customer-flow.test.ts',
              'tests/unit/customer-normalizer.test.ts'
            ]
          }
        }
      ],
      generatedPaths: [],
      acceptancePlan: [],
      passStatus: {
        parse: 'succeeded',
        align: 'succeeded',
        resolve: 'succeeded',
        compose: 'succeeded',
        adapt: 'succeeded',
        verify: 'succeeded',
        repair: 'pending',
        lock: 'pending',
        emit: 'pending'
      }
    };

    const provenance = await buildProvenance(workspaceRoot, lock);

    expect(provenance.artifacts.find((artifact) => artifact.path === 'custom/customer_normalizer.ts')).toMatchObject({
      verifiedBy: ['tests/acceptance/customer-flow.test.ts', 'tests/unit/customer-normalizer.test.ts']
    });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
