import { expect } from 'bun:test';
import fs from 'node:fs/promises';

import { upgradeWorkspace } from '../../platform/orchestrator.ts';

type UpgradeDiagnosticsSnapshot = {
  failedCheck: string;
  errorCode?: string;
  details?: unknown;
};

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
    upgradeWorkspace(workspaceRoot, options.blockId ?? 'private/slot-contract', options.targetVersion ?? '0.2.0', {
      dryRun: true
    })
  ).rejects.toMatchObject(expectedError);
}

export async function expectUpgradeDryRunFailureWithDiagnostics(
  workspaceRoot: string,
  upgradeDiagnosticsPath: string,
  expectedError: object,
  expectedDiagnostics: UpgradeDiagnosticsSnapshot,
  options: UpgradeFailureOptions = {}
): Promise<void> {
  let failure: unknown;
  try {
    await upgradeWorkspace(
      workspaceRoot,
      options.blockId ?? 'private/slot-contract',
      options.targetVersion ?? '0.2.0',
      { dryRun: true }
    );
  } catch (error) {
    failure = error;
  }

  expect(failure).toMatchObject(expectedError);
  if (expectedDiagnostics.errorCode) {
    expect(failure).toMatchObject({ code: expectedDiagnostics.errorCode });
  }
  if (expectedDiagnostics.details && typeof expectedDiagnostics.details === 'object') {
    expect(failure).toMatchObject({ details: expectedDiagnostics.details });
  }
  await expect(fs.lstat(upgradeDiagnosticsPath)).rejects.toMatchObject({ code: 'ENOENT' });
}
