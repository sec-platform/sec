import fs from 'node:fs/promises';
import path from 'node:path';
import { pathExists, readJson } from '../../shared/fs.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath, resolveWorkspaceLockPath } from '../../shared/paths.ts';
import { writeProvenance } from './write-provenance.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import {
  CI_ARTIFACT_MANIFEST_PATH,
  CI_ARTIFACT_PATHS,
  buildCiArtifactUploadGroups,
  ciArtifactKindForPath,
  ciArtifactUploadName,
  countCiArtifactMissingReasons,
  countCiArtifactMissingReasonTypes,
  emptyCiArtifactManifest,
  fixedCiArtifactPaths,
  isCiContractArtifactPath,
  normalizeCiArtifactPath,
  uniqueSortedCiArtifactPaths
} from '../../shared/ci-artifact-contract.ts';
import type {
  CiArtifactEntry,
  CiArtifactManifest,
  CiArtifactMissingEntry
} from '../../shared/ci-artifact-types.ts';

interface GeneratedPathResult {
  paths: string[];
  lockExists: boolean;
}

function uniqueSortedMissing(entries: CiArtifactMissingEntry[]): CiArtifactMissingEntry[] {
  const entriesByPath = new Map(entries.map((entry) => [
    normalizeCiArtifactPath(entry.path),
    { ...entry, path: normalizeCiArtifactPath(entry.path) }
  ]));
  return [...entriesByPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

async function readGeneratedPaths(workspaceRoot: string): Promise<GeneratedPathResult> {
  const readableLockPath = await resolveWorkspaceLockPath(workspaceRoot);
  if (!(await pathExists(readableLockPath))) {
    return { paths: [], lockExists: false };
  }
  const lock = await readJson<LockFile>(readableLockPath);
  return { paths: lock.generatedPaths, lockExists: true };
}

export async function buildCiArtifactManifest(workspaceRoot = process.cwd()): Promise<CiArtifactManifest> {
  const generatedPathResult = await readGeneratedPaths(workspaceRoot);
  const artifacts = uniqueSortedCiArtifactPaths([
    ...fixedCiArtifactPaths(),
    ...generatedPathResult.paths
  ]);
  const entries: CiArtifactEntry[] = [];
  const missing: CiArtifactMissingEntry[] = [];
  const generatedPaths = new Set(generatedPathResult.paths.map(normalizeCiArtifactPath));
  const requiredGovernanceArtifacts = new Set(CI_ARTIFACT_PATHS.requiredGovernance.map(normalizeCiArtifactPath));
  const viewArtifacts = new Set(CI_ARTIFACT_PATHS.view.map(normalizeCiArtifactPath));

  for (const artifactPath of artifacts) {
    const exists = artifactPath.endsWith('/**')
      ? await pathExists(resolveWorkspaceArtifactPath(workspaceRoot, artifactPath.slice(0, -3)))
      : await pathExists(resolveWorkspaceArtifactPath(workspaceRoot, artifactPath));
    if (generatedPathResult.lockExists && requiredGovernanceArtifacts.has(artifactPath) && !exists) {
      missing.push({
        path: artifactPath,
        reason: 'fixed-governance-missing',
        declaredBy: 'artifact-manifest'
      });
    } else if (generatedPathResult.lockExists && viewArtifacts.has(artifactPath) && !exists) {
      missing.push({
        path: artifactPath,
        reason: 'fixed-view-missing',
        declaredBy: 'artifact-manifest'
      });
    } else if (generatedPaths.has(artifactPath) && !exists) {
      missing.push({
        path: artifactPath,
        reason: 'declared-generated-missing',
        declaredBy: 'graph.lock.json'
      });
    }
    if (!exists) {
      continue;
    }
    entries.push({
      path: artifactPath,
      kind: ciArtifactKindForPath(artifactPath),
      uploadName: ciArtifactUploadName(artifactPath),
      exists
    });
  }

  const sortedMissing = generatedPathResult.lockExists ? uniqueSortedMissing(missing) : [];
  const contractPaths = uniqueSortedCiArtifactPaths(entries
    .map((entry) => entry.path)
    .filter(isCiContractArtifactPath));
  const uploadGroups = buildCiArtifactUploadGroups(entries);
  const missingReasonCounts = countCiArtifactMissingReasons(sortedMissing);
  return {
    formatVersion: '1',
    root: 'workspace',
    summary: {
      artifactStatus: sortedMissing.length > 0 ? 'attention' : 'passed',
      artifactCount: entries.length,
      governanceCount: entries.filter((entry) => entry.kind === 'governance').length,
      viewCount: entries.filter((entry) => entry.kind === 'view').length,
      testCount: entries.filter((entry) => entry.kind === 'test').length,
      contractCount: contractPaths.length,
      contractPaths,
      uploadGroupCount: uploadGroups.length,
      missingCount: sortedMissing.length,
      missingReasonTypeCount: countCiArtifactMissingReasonTypes(missingReasonCounts),
      missingReasonCounts
    },
    artifacts: entries,
    uploadGroups,
    missing: sortedMissing
  };
}

export async function writeCiArtifactManifest(workspaceRoot = process.cwd()): Promise<CiArtifactManifest> {
  const { ciArtifactsPath, lockPath } = getWorkspacePaths(workspaceRoot);
  const lock = await readJson<LockFile>(await resolveWorkspaceLockPath(workspaceRoot));
  if (!lock.generatedPaths.includes(CI_ARTIFACT_MANIFEST_PATH)) {
    lock.generatedPaths.push(CI_ARTIFACT_MANIFEST_PATH);
    lock.generatedPaths.sort((left, right) => left.localeCompare(right));
  }
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  await fs.mkdir(path.dirname(ciArtifactsPath), { recursive: true });
  await fs.writeFile(
    ciArtifactsPath,
    `${JSON.stringify(emptyCiArtifactManifest(), null, 2)}\n`,
    'utf8'
  );
  const manifest = await buildCiArtifactManifest(workspaceRoot);
  await fs.writeFile(ciArtifactsPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await writeProvenance(workspaceRoot, lock);
  return manifest;
}
