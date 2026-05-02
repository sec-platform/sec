import { expect } from 'bun:test';

import { upgradeWorkspace } from '../../platform/orchestrator.ts';
import { readJson } from '../../platform/shared/fs.ts';

type UpgradeDiagnosticsSnapshot = {
  failedCheck: string;
  errorCode: string;
  details?: unknown;
};

type UpgradeFailureOptions = {
  blockId?: string;
  targetVersion?: string;
};

export async function readUpgradeDiagnosticsSnapshot(upgradeDiagnosticsPath: string): Promise<UpgradeDiagnosticsSnapshot> {
  return readJson<UpgradeDiagnosticsSnapshot>(upgradeDiagnosticsPath);
}

export async function expectUpgradeDryRunFailure(
  workspaceRoot: string,
  expectedError: object,
  options: UpgradeFailureOptions = {}
): Promise<void> {
  await expect(
    upgradeWorkspace(workspaceRoot, options.blockId ?? 'private/slot-contract', options.targetVersion ?? '0.2.0', {
      dryRun: true
    })
  ).rejects.toMatchObject(expectedError);
}

export async function expectUpgradeDryRunFailureWithDiagnostics(
  workspaceRoot: string,
  upgradeDiagnosticsPath: string,
  expectedError: object,
  expectedDiagnostics: object,
  options: UpgradeFailureOptions = {}
): Promise<void> {
  await expectUpgradeDryRunFailure(workspaceRoot, expectedError, options);
  await expect(readUpgradeDiagnosticsSnapshot(upgradeDiagnosticsPath)).resolves.toMatchObject(expectedDiagnostics);
}
