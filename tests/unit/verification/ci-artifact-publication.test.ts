import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { writeCiArtifactManifest } from '../../../src/adapters/compilation/emit/ci-artifacts.ts';
import { PhysicalNoFollowError } from '../../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import { readOptionalCiArtifactManifest } from '../../../src/adapters/verification/platform/ci-artifacts/runtime/authority.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from "../../../src/adapters/workspace-context.ts";
import { buildArtifactUploadPathContract } from '../../../src/application/artifact-upload-paths.ts';
import { saveLock } from "../../../src/adapters/workspace/lock.ts";
import {
  CI_ARTIFACT_FILES,
  emptyCiArtifactManifest,
  isCanonicalCiArtifactPath
} from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { formatArtifactUploadPaths } from '../../../src/entry/cli/artifact-upload-paths.ts';
import { buildReviewLock } from '../../helpers/review-fixtures.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

async function prepareManifestWorkspace(workspaceRoot: string, generatedPaths = ['package.json']): Promise<void> {
  const paths = getWorkspacePaths(workspaceRoot);
  await fs.mkdir(paths.secRoot, { recursive: true });
  await saveLock(workspaceRoot, buildReviewLock({ generatedPaths }));
  await fs.mkdir(
    path.dirname(resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.provenance)),
    { recursive: true }
  );
}

test('CI artifact publication owns an absent manifest parent below the retained artifacts root', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const contractPath = '.sec/artifacts/generated/customer-contract.json';
    const testPath = '.sec/artifacts/test-results/unit.xml';
    await prepareManifestWorkspace(workspaceRoot, ['package.json', contractPath]);
    for (const artifact of [contractPath, testPath]) {
      const target = resolveWorkspaceArtifactPath(workspaceRoot, artifact);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, artifact === contractPath ? '{}' : '<testsuites/>');
    }
    const manifestPath = resolveWorkspaceArtifactPath(
      workspaceRoot,
      CI_ARTIFACT_FILES.artifactManifest
    );
    await expect(fs.lstat(path.dirname(manifestPath))).rejects.toMatchObject({ code: 'ENOENT' });

    const manifest = await writeCiArtifactManifest(workspaceRoot);
    const readback = readOptionalCiArtifactManifest(manifestPath);

    expect(readback).toEqual(manifest);
    expect(manifest.artifacts.map((entry) => entry.path)).toContain(CI_ARTIFACT_FILES.artifactManifest);
    expect(manifest.artifacts.every((entry) => isCanonicalCiArtifactPath(entry.path))).toBe(true);
    expect(manifest.artifacts.some((entry) => entry.path === 'package.json')).toBe(false);

    // Consume the real canonical manifest. The manifest itself is already an
    // artifact, so adding the upload manifest must not duplicate its path.
    const uploads = buildArtifactUploadPathContract(manifest);
    expect(uploads.paths).toEqual([
      CI_ARTIFACT_FILES.artifactManifest, contractPath,
      CI_ARTIFACT_FILES.graphLock, CI_ARTIFACT_FILES.testResults
    ]);
    expect(uploads).toMatchObject({
      formatVersion: '2', root: 'workspace', kind: 'all', artifactStatus: 'attention',
      count: 4, byKind: { governance: 2, test: 1, contract: 1 }, uploadGroupCount: 3,
      missingCount: 10, missingReasonTypeCount: 2,
      missingReasonCounts: { 'fixed-governance-missing': 5, 'stale-semantic-projection': 5, 'declared-generated-missing': 0 }
    });
    expect(uploads.uploadGroups).toEqual([
      { kind: 'governance', count: 2, paths: [CI_ARTIFACT_FILES.artifactManifest, CI_ARTIFACT_FILES.graphLock] },
      { kind: 'test', count: 1, paths: [CI_ARTIFACT_FILES.testResults] },
      { kind: 'contract', count: 1, paths: [contractPath] }
    ]);
    expect(formatArtifactUploadPaths(uploads)).toBe(uploads.paths.join('\n'));
    const contract = buildArtifactUploadPathContract(manifest, 'contract');
    expect(contract.paths).toEqual([contractPath]);
    expect(contract.byKind).toEqual({ contract: 1 });
    expect(contract.uploadGroups).toEqual([{ kind: 'contract', count: 1, paths: [contractPath] }]);
    expect(contract.missingCount).toBe(10);
    expect(contract.missing).toContainEqual({
      path: CI_ARTIFACT_FILES.policyReport, reason: 'fixed-governance-missing', declaredBy: 'artifact-manifest'
    });
    expect(buildArtifactUploadPathContract(manifest, 'governance').paths).toEqual([
      CI_ARTIFACT_FILES.artifactManifest, CI_ARTIFACT_FILES.graphLock
    ]);
    const tests = buildArtifactUploadPathContract(manifest, 'test');
    expect(tests.paths).toEqual([CI_ARTIFACT_FILES.testResults]);
    expect(tests.missing).toContainEqual({
      path: CI_ARTIFACT_FILES.policyReport, reason: 'fixed-governance-missing', declaredBy: 'artifact-manifest'
    });
    expect(tests.missingReasonCounts['fixed-governance-missing']).toBe(5);
    const empty = emptyCiArtifactManifest();
    expect(formatArtifactUploadPaths(buildArtifactUploadPathContract(empty, 'test'))).toBe('');
    expect(buildArtifactUploadPathContract(empty).paths).toEqual([CI_ARTIFACT_FILES.artifactManifest]);
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
  });
});
