import { expect, test } from 'vitest';

import { readJson } from '../../platform/shared/fs.ts';

import {
  adaptWorkspace,
  composeWorkspace,
  initWorkspace,
  lockWorkspace,
  resolveWorkspace,
  upgradeWorkspace,
  verifyWorkspace
} from '../../platform/orchestrator.ts';
import { CI_ARTIFACT_FILES } from '../../platform/shared/ci-artifact-contract.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { writeYaml } from '../../platform/shared/yaml.ts';
import { createWorkspace } from '../helpers/test-utils.ts';

test('upgrade is blocked when a manual override conflicts with impacted files', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-upgrade-conflict-');
  const { lockPath, overrideManifestPath, provenancePath, upgradeDiagnosticsPath } = getWorkspacePaths(workspaceRoot);

  await initWorkspace(workspaceRoot, { reset: true });
  await resolveWorkspace(workspaceRoot);
  await composeWorkspace(workspaceRoot);
  await adaptWorkspace(workspaceRoot);
  await verifyWorkspace(workspaceRoot);
  await lockWorkspace(workspaceRoot);

  await writeYaml(overrideManifestPath, {
    overrides: [
      {
        id: 'manual-auth-session-hotfix',
        entry: 'patches/manual-auth-session-hotfix.ts',
        target: 'src/installed/auth/session.ts',
        reason: 'manual-auth-session-hotfix',
        source: 'manual',
        appliesAfter: ['adapt'],
        conflictsWith: []
      }
    ]
  });

  await expect(upgradeWorkspace(workspaceRoot, 'auth/basic-session', '0.1.1')).rejects.toThrow();
  const diagnostics = await readJson<{
    status: string;
    failedCheck: string;
    errorCode: string;
    message: string;
  }>(upgradeDiagnosticsPath);
  expect(diagnostics).toMatchObject({
    status: 'blocked',
    failedCheck: 'override-conflicts',
    errorCode: 'UPGRADE-CONFLICT-001'
  });
  expect(diagnostics.message).toContain('manual-auth-session-hotfix');
  const lock = await readJson<{ generatedPaths: string[] }>(lockPath);
  expect(lock.generatedPaths).toContain(CI_ARTIFACT_FILES.upgradeDiagnostics);
  const provenance = await readJson<{
    artifacts: Array<{ path: string; generatedByPass?: string }>;
  }>(provenancePath);
  expect(provenance.artifacts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: CI_ARTIFACT_FILES.upgradeDiagnostics, generatedByPass: 'upgrade' })
    ])
  );
}, 120000);
