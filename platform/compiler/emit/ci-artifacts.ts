import {
  buildCiArtifactUploadGroups,
  CI_ARTIFACT_MANIFEST_PATH,
  CI_ARTIFACT_MISSING_REASON,
  CI_ARTIFACT_PATHS,
  CI_EMIT_ARTIFACT_PATHS,
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
import { countMatching } from '../../shared/collections.ts';
import type { ExplainGraph } from '../../shared/explain-types.ts';
import { pathExists, readJson, writeJson, type CommitFence } from '../../shared/fs.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import { readLockFile, writeLockWithGeneratedPaths } from '../../shared/lock-utils.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from '../../shared/paths.ts';
import { semanticViewArtifactsAreCurrent } from './semantic-view-artifact-contract.ts';
import { writeProvenance } from './write-provenance.ts';

interface GeneratedPathResult {
  paths: string[];
  lockExists: boolean;
  lock: LockFile | null;
}

function uniqueSortedMissing(entries: CiArtifactMissingEntry[]): CiArtifactMissingEntry[] {
  const entriesByPath = new Map(entries.map((entry) => [
    normalizeCiArtifactPath(entry.path),
    { ...entry, path: normalizeCiArtifactPath(entry.path) }
  ]));
  return [...entriesByPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

async function readGeneratedPaths(workspaceRoot: string): Promise<GeneratedPathResult> {
  try {
    const lock = await readLockFile(workspaceRoot);
    return { paths: lock.generatedPaths, lockExists: true, lock };
  } catch {
    return { paths: [], lockExists: false, lock: null };
  }
}

async function semanticEmitArtifactsAreCurrent(workspaceRoot: string, lock: LockFile): Promise<boolean> {
  if (lock.passStatus.lock !== 'succeeded' || lock.passStatus.emit !== 'succeeded') return false;
  const { explainGraphPath } = getWorkspacePaths(workspaceRoot);
  if (!(await pathExists(explainGraphPath))) return false;
  try {
    return semanticViewArtifactsAreCurrent(lock, await readJson<ExplainGraph>(explainGraphPath));
  } catch {
    return false;
  }
}

export async function buildCiArtifactManifest(workspaceRoot = process.cwd()): Promise<CiArtifactManifest> {
  const generatedPathResult = await readGeneratedPaths(workspaceRoot);
  const semanticEmitArtifactsCurrent = generatedPathResult.lock
    ? await semanticEmitArtifactsAreCurrent(workspaceRoot, generatedPathResult.lock)
    : false;
  const staleSemanticArtifacts = !semanticEmitArtifactsCurrent
    ? new Set(CI_EMIT_ARTIFACT_PATHS.map(normalizeCiArtifactPath))
    : new Set<string>();
  const artifacts = uniqueSortedCiArtifactPaths([
    ...fixedCiArtifactPaths(),
    ...generatedPathResult.paths
  ]).filter((artifactPath) => !staleSemanticArtifacts.has(artifactPath));
  const entries: CiArtifactEntry[] = [];
  const missing: CiArtifactMissingEntry[] = [...staleSemanticArtifacts].map((artifactPath) => ({
    path: artifactPath,
    reason: CI_ARTIFACT_MISSING_REASON.staleSemanticProjection,
    declaredBy: 'artifact-manifest'
  }));
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
        reason: CI_ARTIFACT_MISSING_REASON.fixedGovernanceMissing,
        declaredBy: 'artifact-manifest'
      });
    } else if (generatedPathResult.lockExists && viewArtifacts.has(artifactPath) && !exists) {
      missing.push({
        path: artifactPath,
        reason: CI_ARTIFACT_MISSING_REASON.fixedViewMissing,
        declaredBy: 'artifact-manifest'
      });
    } else if (generatedPaths.has(artifactPath) && !exists) {
      missing.push({
        path: artifactPath,
        reason: CI_ARTIFACT_MISSING_REASON.declaredGeneratedMissing,
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
      governanceCount: countMatching(entries, (entry) => entry.kind === 'governance'),
      viewCount: countMatching(entries, (entry) => entry.kind === 'view'),
      testCount: countMatching(entries, (entry) => entry.kind === 'test'),
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

export async function writeCiArtifactManifest(
  workspaceRoot = process.cwd(),
  commitFence?: CommitFence
): Promise<CiArtifactManifest> {
  const { ciArtifactsPath, lockPath } = getWorkspacePaths(workspaceRoot);
  const lock = await readLockFile(workspaceRoot);
  await writeLockWithGeneratedPaths(lockPath, lock, [CI_ARTIFACT_MANIFEST_PATH], commitFence);
  await writeJson(ciArtifactsPath, emptyCiArtifactManifest(), commitFence);
  const manifest = await buildCiArtifactManifest(workspaceRoot);
  await writeJson(ciArtifactsPath, manifest, commitFence);
  await writeProvenance(workspaceRoot, lock, commitFence);
  return manifest;
}
