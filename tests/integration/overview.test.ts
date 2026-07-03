import { afterAll, beforeAll, expect, test } from 'bun:test';
import fs from 'node:fs/promises';

import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import {
    expectCliJson,
    expectCliSuccess,
    expectCliText,
    runCliInProcess
} from '../testkit/cli.ts';
import { prepareLockedWorkspace, withTempWorkspace } from '../testkit/workspace.ts';

// 共享一个 locked + explained 的 workspace，避免每个 test 重新跑完整 pipeline
// （完整 pipeline 约 5-7s，3 个测试 × 7s = 21s → 共享后仅 1 次 ~7s）
let sharedWorkspace: string | null = null;

beforeAll(async () => {
  sharedWorkspace = await prepareLockedWorkspace({ prefix: 'engineering-compiler-overview-shared-' });
  await expectCliSuccess(sharedWorkspace, ['explain']);
}, 120000);

afterAll(async () => {
  if (sharedWorkspace) {
    await fs.rm(sharedWorkspace, { recursive: true, force: true });
  }
});

test('CLI exposes project overview as text summary and reports missing governance artifacts', async () => {
  const workspaceRoot = sharedWorkspace!;
  await expectCliText(workspaceRoot, ['overview'], [
    'Project overview',
    'Workspace:',
    'Verification:',
    'Graph:',
    'Views:',
    'Next:'
  ]);

  // 复制共享 workspace 的一份副本来测试"缺失产物"路径（避免污染共享状态）
  await withTempWorkspace(async (tempRoot) => {
    await fs.cp(workspaceRoot, tempRoot, { recursive: true });
    const { provenancePath } = getWorkspacePaths(tempRoot);
    await fs.rm(provenancePath);
    const missingArtifactResult = await runCliInProcess(tempRoot, ['overview']);
    expect(missingArtifactResult.code).toBe(1);
    expect(missingArtifactResult.stdout).toBe('');
    expect(missingArtifactResult.stderr).toContain('Provenance report is missing');
    expect(missingArtifactResult.stderr).toContain('run the refresh chain, then bun run platform -- explain');
  });
}, 120000);

test('CLI exposes project overview as compact JSON contract', async () => {
  const workspaceRoot = sharedWorkspace!;
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
}, 120000);

test('CLI overview reports missing required artifacts with refresh guidance', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const result = await runCliInProcess(workspaceRoot, ['overview']);

    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('run the refresh chain, then bun run platform -- explain');
  });
});
