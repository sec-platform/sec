import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyMigrationEntries } from '../../platform/upgrade/upgrade-workspace.ts';
import { createWorkspace } from '../helpers/workspace-fixtures.ts';
import { slotContractUpdate } from './migration-fixtures.ts';

test('slot-contract-update migration rejects missing custom slot targets', async () => {
  const workspaceRoot = await createWorkspace();
  try {
    const projectRoot = path.join(workspaceRoot, 'project');
    const manifestRoot = path.join(workspaceRoot, 'manifest');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(manifestRoot, { recursive: true });

    await expect(
      applyMigrationEntries(
        projectRoot,
        manifestRoot,
        ['custom/customer_normalizer.ts'],
        [slotContractUpdate('custom/customer_normalizer.ts')]
      )
    ).rejects.toMatchObject({
      code: 'UPGRADE-MIGRATION-016'
    });
  } finally {
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  }
});
