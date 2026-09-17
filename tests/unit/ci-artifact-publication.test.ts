import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { writeCiArtifactManifest } from '../../src/adapters/compilation/emit/ci-artifacts.ts';
import { saveLock } from "../../src/adapters/workspace/lock.ts";
import { PhysicalNoFollowError } from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import {
  CI_ARTIFACT_FILES,
  isCanonicalCiArtifactPath
} from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { readOptionalCiArtifactManifest } from '../../src/adapters/verification/platform/ci-artifacts/runtime/authority.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from "../../src/adapters/workspace-context.ts";
import { buildReviewLock } from '../helpers/review-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

async function prepareManifestWorkspace(workspaceRoot: string): Promise<void> {
  const paths = getWorkspacePaths(workspaceRoot);
  await fs.mkdir(paths.secRoot, { recursive: true });
  await saveLock(workspaceRoot, buildReviewLock({ generatedPaths: ['package.json'] }));
  await fs.mkdir(
    path.dirname(resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.provenance)),
    { recursive: true }
  );
}

test('CI artifact publication owns an absent manifest parent below the retained artifacts root', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await prepareManifestWorkspace(workspaceRoot);
    const manifestPath = resolveWorkspaceArtifactPath(
      workspaceRoot,
      CI_ARTIFACT_FILES.artifactManifest
    );
    await expect(fs.lstat(path.dirname(manifestPath))).rejects.toMatchObject({ code: 'ENOENT' });

    const manifest = await writeCiArtifactManifest(workspaceRoot);
    const readback = readOptionalCiArtifactManifest(manifestPath);

    expect(readback).toEqual(manifest);
    expect(manifest.artifacts.every((entry) => isCanonicalCiArtifactPath(entry.path))).toBe(true);
    expect(manifest.artifacts.some((entry) => entry.path === 'package.json')).toBe(false);
  });
});

test('CI artifact publication rejects a foreign manifest parent before manifest effect', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await prepareManifestWorkspace(workspaceRoot);
    const manifestPath = resolveWorkspaceArtifactPath(
      workspaceRoot,
      CI_ARTIFACT_FILES.artifactManifest
    );
    const manifestParent = path.dirname(manifestPath);
    await fs.writeFile(manifestParent, 'foreign-parent', 'utf8');

    let failure: unknown;
    try {
      await writeCiArtifactManifest(workspaceRoot);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(PhysicalNoFollowError);
    expect((failure as PhysicalNoFollowError).code).toBe('PHYSICAL_NO_FOLLOW_DURABILITY_FAILED');
    expect(await fs.readFile(manifestParent, 'utf8')).toBe('foreign-parent');
    let manifestExists = true;
    try {
      await fs.access(manifestPath);
    } catch {
      manifestExists = false;
    }
    expect(manifestExists).toBe(false);
  });
});
