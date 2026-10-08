import { expect } from 'bun:test';
import fs from 'node:fs/promises';

import { upgradeWorkspace } from '../../src/bootstrap/upgrade/orchestration.ts';

type UpgradeFailureOptions = {
  blockId?: string;
  targetVersion?: string;
};

export async function expectUpgradeDryRunFailure(
  workspaceRoot: string,
  expectedError: object,
  options: UpgradeFailureOptions = {}
): Promise<void> {
  await expect(
    upgradeWorkspace(workspaceRoot, options.blockId ?? 'private/block-upgrade', options.targetVersion ?? '0.2.0', {
      dryRun: true
    })
  ).rejects.toMatchObject(expectedError);
}

/** A preview reports its error without publishing durable diagnostics. */
export async function expectUpgradeDryRunFailureWithoutDiagnostics(
  workspaceRoot: string,
  upgradeDiagnosticsPath: string,
  expectedError: object,
  options: UpgradeFailureOptions = {}
): Promise<void> {
  await expectUpgradeDryRunFailure(workspaceRoot, expectedError, options);
  await expect(fs.lstat(upgradeDiagnosticsPath)).rejects.toMatchObject({ code: 'ENOENT' });
}
