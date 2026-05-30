import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';

import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import {
  expectCliJson,
  expectCliText,
  expectCliSuccess,
  runCliInProcess,
  runCliPipeline
} from '../testkit/cli.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';
import { writePassingVerificationState } from '../helpers/verification-fixtures.ts';

test('CLI exposes project overview as text summary and reports missing governance artifacts', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await runCliPipeline(workspaceRoot, { verifyLane: 'fast' });
    await writePassingVerificationState(workspaceRoot);
    await expectCliSuccess(workspaceRoot, ['lock'], 'Locked project\n');
    await expectCliSuccess(workspaceRoot, ['explain']);

    await expectCliText(workspaceRoot, ['overview'], [
      'Project overview',
      'Workspace:',
      'Verification:',
      'Graph:',
      'Views:',
      'Next:'
    ]);

    const { provenancePath } = getWorkspacePaths(workspaceRoot);
    await fs.rm(provenancePath);
    const missingArtifactResult = await runCliInProcess(workspaceRoot, ['overview']);
    expect(missingArtifactResult.code).toBe(1);
    expect(missingArtifactResult.stdout).toBe('');
    expect(missingArtifactResult.stderr).toContain('Provenance report is missing');
    expect(missingArtifactResult.stderr).toContain('run the refresh chain, then bun run platform -- explain');
  });
}, 120000);

test('CLI exposes project overview as compact JSON contract', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await runCliPipeline(workspaceRoot, { verifyLane: 'fast' });
    await writePassingVerificationState(workspaceRoot);
    await expectCliSuccess(workspaceRoot, ['lock'], 'Locked project\n');
    await expectCliSuccess(workspaceRoot, ['explain']);

    const payload = await expectCliJson<{
      formatVersion: string;
      navigation: { workbenchViews: Array<{ id: string; path?: string }> };
      quality: { reports: Array<{ kind: string; available: boolean; status: string }> };
    }>(
      workspaceRoot,
      ['overview', '--json', '--compact'],
      { formatVersion: '1' },
      { compact: true }
    );

    expect(payload.navigation.workbenchViews[0]?.id).toBe('overview');
    expect(payload.navigation.workbenchViews).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'overview' })
      ])
    );
    expect(payload.quality.reports).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'code-quality', available: false, status: 'unavailable' }),
        expect.objectContaining({ kind: 'architecture-boundary', available: false, status: 'unavailable' }),
        expect.objectContaining({ kind: 'semantic-pattern', available: false, status: 'unavailable' })
      ])
    );
  });
}, 120000);

test('CLI overview reports missing required artifacts with refresh guidance', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const result = await runCliInProcess(workspaceRoot, ['overview']);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('run the refresh chain, then bun run platform -- explain');
  });
});
