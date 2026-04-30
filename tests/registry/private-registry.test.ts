import fs from 'node:fs/promises';
import { expect, test } from 'vitest';

import {
  adaptWorkspace,
  addBlock,
  composeWorkspace,
  explainWorkspace,
  initWorkspace,
  lockWorkspace,
  resolveWorkspace,
  verifyWorkspace
} from '../../platform/orchestrator.ts';
import { readJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import { installPrivateBannerBlock } from '../helpers/private-registry-fixtures.ts';
import { createWorkspace } from '../helpers/test-utils.ts';

test('workspace private registry blocks resolve, compose, and verify through the normal pipeline', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-private-registry-');

  await initWorkspace(workspaceRoot, { reset: true });
  await installPrivateBannerBlock(workspaceRoot);
  await addBlock(workspaceRoot, 'private/banner-basic');

  const { lock: resolvedLock } = await resolveWorkspace(workspaceRoot);
  expect(resolvedLock.resolvedBlocks.some((block) => block.id === 'private/banner-basic')).toBe(true);
  expect(
    resolvedLock.resolvedBlocks.find((block) => block.id === 'private/banner-basic')?.registryKind
  ).toBe('private');

  await composeWorkspace(workspaceRoot);
  await adaptWorkspace(workspaceRoot);
  const { report } = await verifyWorkspace(workspaceRoot);
  expect(report.summary.status).toBe('passed');

  const locked = await lockWorkspace(workspaceRoot);
  expect(locked.passStatus.lock).toBe('succeeded');
  await explainWorkspace(workspaceRoot);

  const { provenancePath, reviewSummaryPath, sourceViewPath } = getWorkspacePaths(workspaceRoot);
  const provenance = await readJson<{
    artifacts: Array<{ path: string; registrySourceId?: string; registryKind?: string; registryLocation?: string }>;
  }>(provenancePath);
  expect(provenance.artifacts.find((artifact) => artifact.path === 'src/installed/private/banner.ts')).toMatchObject({
    registrySourceId: 'private',
    registryKind: 'private',
    registryLocation: 'workspace'
  });

  const reviewSummary = await readJson<{
    changeSources: Array<{
      path: string;
      registrySourceId?: string;
      registryKind?: string;
      registryLocation?: string;
      runtimeKind?: 'page' | 'api';
      vertical?: string;
      relatedBlocks?: string[];
    }>;
  }>(reviewSummaryPath);
  expect(reviewSummary.changeSources.find((source) => source.path === 'src/installed/private/banner.ts')).toMatchObject({
    registrySourceId: 'private',
    registryKind: 'private',
    registryLocation: 'workspace'
  });

  const sourceView = await fs.readFile(sourceViewPath, 'utf8');
  expect(sourceView).toContain('Registry');
  expect(sourceView).toContain('private (private, workspace)');
}, 120000);
