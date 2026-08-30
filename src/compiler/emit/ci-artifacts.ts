import { readOptionalRetainedJson } from '../../runtime-state/physical/runtime/retained-file-read.ts';
import type { ExplainGraph } from '../../semantic/projection/contract/explain.ts';
import { compareCodeUnits } from '../../system-architecture/foundation/runtime/canonical.ts';
import { countMatching } from '../../system-architecture/foundation/runtime/collections.ts';
import { buildCiArtifactUploadGroups, CI_ARTIFACT_MANIFEST_PATH, CI_ARTIFACT_PATHS, CI_EMIT_ARTIFACT_PATHS, ciArtifactKindForPath, ciArtifactUploadName, countCiArtifactMissingReasons, countCiArtifactMissingReasonTypes, fixedCiArtifactPaths, isCiContractArtifactPath, normalizeCiArtifactPath, uniqueSortedCiArtifactPaths } from '../../verification/ci-artifacts/contract/manifest.ts';
import type { CiArtifactEntry, CiArtifactManifest, CiArtifactMissingEntry } from '../../verification/ci-artifacts/contract/types.ts';
import { CI_ARTIFACT_FORMAT_VERSION, CI_ARTIFACT_MISSING_REASON } from '../../verification/ci-artifacts/contract/types.ts';
import { validateCiArtifactManifest } from '../../verification/ci-artifacts/runtime/authority.ts';
import { formatJsonFile, pathExists, publishCanonicalWorkspaceFile, type CommitFence } from '../../workspace/files.ts';
import { getWorkspacePaths, resolveWorkspaceArtifactPath } from '../../workspace/paths.ts';
import type { LockFile } from '../contract.ts';
import { readLockFile, writeLockWithGeneratedPaths } from '../lock.ts';
import { semanticViewArtifactsAreCurrent } from './semantic-view-artifact-contract.ts';
import { writeProvenance } from './write-provenance.ts';

interface GeneratedPathResult {
  paths: string[];
  lockExists: boolean;
  lock: LockFile | null;
}

function uniqueSortedMissing(entries: CiArtifactMissingEntry[]): CiArtifactMissingEntry[] {
  const entriesByPath = new Map<string, CiArtifactMissingEntry>();
  for (const entry of entries) {
    const canonicalPath = normalizeCiArtifactPath(entry.path);
    const candidate = { ...entry, path: canonicalPath };
    const previous = entriesByPath.get(canonicalPath);
    if (previous && (previous.reason !== candidate.reason || previous.declaredBy !== candidate.declaredBy)) {
      throw new Error(`CI artifact missing-state conflict for ${canonicalPath}`);
    }
    entriesByPath.set(canonicalPath, candidate);
  }
  return [...entriesByPath.values()].sort((left, right) => compareCodeUnits(left.path, right.path));
}

function readGeneratedPaths(workspaceRoot: string): GeneratedPathResult {
  try {
    const lock = readLockFile(workspaceRoot);
    return { paths: lock.generatedPaths, lockExists: true, lock };
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return { paths: [], lockExists: false, lock: null };
    }
    throw error;
  }
}

function semanticEmitArtifactsAreCurrent(workspaceRoot: string, lock: LockFile): boolean {
  if (lock.passStatus.lock !== 'succeeded' || lock.passStatus.emit !== 'succeeded') return false;
  const { explainGraphPath } = getWorkspacePaths(workspaceRoot);
  const explainGraph = readOptionalRetainedJson<ExplainGraph>(
    explainGraphPath,
    'CI Artifact Explain Graph'
  );
  return explainGraph !== null && semanticViewArtifactsAreCurrent(lock, explainGraph);
}

async function buildCiArtifactManifestWithPlannedPaths(
  workspaceRoot: string,
  plannedPaths: ReadonlySet<string>
): Promise<CiArtifactManifest> {
  const generatedPathResult = readGeneratedPaths(workspaceRoot);
  const semanticEmitArtifactsCurrent = generatedPathResult.lock
    ? semanticEmitArtifactsAreCurrent(workspaceRoot, generatedPathResult.lock)
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

  for (const artifactPath of artifacts) {
    const exists = plannedPaths.has(artifactPath) || (artifactPath.endsWith('/**')
      ? await pathExists(resolveWorkspaceArtifactPath(workspaceRoot, artifactPath.slice(0, -3)))
      : await pathExists(resolveWorkspaceArtifactPath(workspaceRoot, artifactPath)));
    if (generatedPathResult.lockExists && requiredGovernanceArtifacts.has(artifactPath) && !exists) {
      missing.push({
        path: artifactPath,
        reason: CI_ARTIFACT_MISSING_REASON.fixedGovernanceMissing,
        declaredBy: 'artifact-manifest'
      });
    } else if (generatedPaths.has(artifactPath) && !exists) {
      missing.push({
        path: artifactPath,
        reason: CI_ARTIFACT_MISSING_REASON.declaredGeneratedMissing,
        declaredBy: 'graph.lock.json'
      });
    }
    if (!exists) continue;
    entries.push({
      path: artifactPath,
      kind: ciArtifactKindForPath(artifactPath),
      uploadName: ciArtifactUploadName(artifactPath),
      exists: true
    });
  }

  const sortedMissing = generatedPathResult.lockExists ? uniqueSortedMissing(missing) : [];
  const contractPaths = uniqueSortedCiArtifactPaths(entries
    .map((entry) => entry.path)
    .filter(isCiContractArtifactPath));
  const uploadGroups = buildCiArtifactUploadGroups(entries);
  const missingReasonCounts = countCiArtifactMissingReasons(sortedMissing);
  return validateCiArtifactManifest({
    formatVersion: CI_ARTIFACT_FORMAT_VERSION,
    root: 'workspace',
    summary: {
      artifactStatus: sortedMissing.length > 0 ? 'attention' : 'passed',
      artifactCount: entries.length,
      governanceCount: countMatching(entries, (entry) => entry.kind === 'governance'),
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
  });
}

/** Pure inventory observation: callers cannot self-authorize absent artifacts
 * by claiming that they intend to publish them later. */
export function buildCiArtifactManifest(workspaceRoot = process.cwd()): Promise<CiArtifactManifest> {
  return buildCiArtifactManifestWithPlannedPaths(workspaceRoot, new Set());
}

export async function writeCiArtifactManifest(
  workspaceRoot = process.cwd(),
  commitFence?: CommitFence
): Promise<CiArtifactManifest> {
  const { ciArtifactsPath, lockPath } = getWorkspacePaths(workspaceRoot);
  const lock = readLockFile(workspaceRoot);
  await writeLockWithGeneratedPaths(lockPath, lock, [CI_ARTIFACT_MANIFEST_PATH], commitFence);
  const manifest = await buildCiArtifactManifestWithPlannedPaths(
    workspaceRoot,
    new Set([CI_ARTIFACT_MANIFEST_PATH])
  );
  await publishCanonicalWorkspaceFile({
    workspaceRoot,
    targetPath: ciArtifactsPath,
    bytes: Buffer.from(formatJsonFile(manifest), 'utf8'),
    label: 'CI artifact manifest',
    commitFence
  });
  await writeProvenance(workspaceRoot, lock, commitFence);
  return manifest;
}
