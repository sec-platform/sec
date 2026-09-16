import { expect, test } from 'bun:test';

import {
  addBlock,
  composeWorkspace,
  explainWorkspace,
  initWorkspace,
  lockWorkspace,
  resolveWorkspace,
  verifyWorkspace
} from '../../src/compiler/orchestration/cli.ts';
import { CI_ARTIFACT_FILES } from '../../src/verification/ci-artifacts/contract/manifest.ts';
import { readJson } from '../../src/workspace/files.ts';
import { resolveWorkspaceArtifactPath } from '../../src/workspace/runtime/paths.ts';
import { installPrivateBannerBlock } from '../helpers/private-registry-fixtures.ts';
import { createWorkspace } from '../testkit/workspace.ts';

test('workspace private registry blocks resolve, compose, and verify through an explicit reference host', async () => {
  const workspaceRoot = await createWorkspace('engineering-compiler-private-registry-');

  await initWorkspace(workspaceRoot, { template: 'reference-customer' });
  await installPrivateBannerBlock(workspaceRoot);
  await addBlock(workspaceRoot, 'private/banner-basic');

  const { lock: resolvedLock } = await resolveWorkspace(workspaceRoot);
  expect(resolvedLock.resolvedBlocks.some((block) => block.id === 'private/banner-basic')).toBe(true);
  expect(
    resolvedLock.resolvedBlocks.find((block) => block.id === 'private/banner-basic')?.registryKind
  ).toBe('private');

  await composeWorkspace(workspaceRoot);
  const { report } = await verifyWorkspace(workspaceRoot);
  expect(report.summary.status).toBe('passed');

  const locked = await lockWorkspace(workspaceRoot);
  expect(locked.passStatus.lock).toBe('succeeded');
  await explainWorkspace(workspaceRoot);

  const provenancePath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.provenance);
  const reviewSummaryPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.reviewSummary);
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
      runtimeKind?: 'library' | 'service';
      vertical?: string;
      relatedBlocks?: string[];
    }>;
  }>(reviewSummaryPath);
  expect(reviewSummary.changeSources.find((source) => source.path === 'src/installed/private/banner.ts')).toMatchObject({
    registrySourceId: 'private',
    registryKind: 'private',
    registryLocation: 'workspace'
  });
}, 120000);
