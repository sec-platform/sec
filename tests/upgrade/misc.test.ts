import { expect, test } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';

import {
  adaptWorkspace,
  addBlock,
  composeWorkspace,
  explainWorkspace,
  initWorkspace,
  lockWorkspace,
  resolveWorkspace,
  upgradeWorkspace,
  verifyWorkspace
} from '../../platform/orchestrator.ts';
import { writeJson } from '../../platform/shared/fs.ts';
import { applyMigrationEntries } from '../../platform/upgrade/upgrade-workspace.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { createWorkspace, writeSlotUpgradeFixture } from '../helpers/test-utils.ts';
import type { LockFile } from '../../platform/shared/types.ts';
import { readYaml, writeYaml } from '../../platform/shared/yaml.ts';

test('upgrade apply writes diagnostics when migration execution fails after planning', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-apply-diagnostics-');

  await writeSlotUpgradeFixture(workspaceRoot);

  const { planPath, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);
  const beforePlan = await fs.readFile(planPath, 'utf8');

  await expect(upgradeWorkspace(workspaceRoot, 'private/slot-contract', '0.2.0')).rejects.toMatchObject({
    code: 'UPGRADE-MIGRATION-016'
  });
  await expect(fs.readFile(planPath, 'utf8')).resolves.toBe(beforePlan);

  const diagnostics = JSON.parse(await fs.readFile(upgradeDiagnosticsPath, 'utf8')) as {
    phase: string;
    failedCheck: string;
    errorCode: string;
    message: string;
    details?: unknown;
  };
  expect(diagnostics).toMatchObject({
    phase: 'apply',
    failedCheck: 'migration-file-operations',
    errorCode: 'UPGRADE-MIGRATION-016',
    message: 'slot-contract-update target "custom/customer_normalizer.ts" is missing',
    details: {
      migrationId: 'mig-customer-normalizer-contract',
      migrationKind: 'slot-contract-update',
      slotId: 'customer_normalizer',
      target: 'custom/customer_normalizer.ts',
      rollbackStatus: 'restored'
    }
  });
});
