import path from 'node:path';
import { readOptionalRetainedJson } from '../../runtime-state/physical/runtime/retained-file-read.ts';
import type { ExplainGraph } from '../../../semantics/projection/explain.ts';
import { compareCodeUnits } from '../../../contracts/canonical.ts';
import { countMatching } from '../../../contracts/collections.ts';
import { buildCiArtifactUploadGroups, CI_ARTIFACT_FILES, CI_ARTIFACT_MANIFEST_PATH, CI_ARTIFACT_PATHS, CI_ARTIFACT_ROOT_RELATIVE_PATH, CI_EMIT_ARTIFACT_PATHS, ciArtifactKindForPath, ciArtifactUploadName, countCiArtifactMissingReasons, countCiArtifactMissingReasonTypes, fixedCiArtifactPaths, isCanonicalCiArtifactPath, isCiContractArtifactPath, normalizeCiArtifactPath, uniqueSortedCiArtifactPaths } from '../../../assurance/verification/ci-artifacts/contract/manifest.ts';
import type { CiArtifactEntry, CiArtifactManifest, CiArtifactMissingEntry } from '../../../assurance/verification/ci-artifacts/contract/types.ts';
import { CI_ARTIFACT_FORMAT_VERSION, CI_ARTIFACT_MISSING_REASON } from '../../../assurance/verification/ci-artifacts/contract/types.ts';
import { validateCiArtifactManifest } from '../../verification/platform/ci-artifacts/runtime/authority.ts';
import { formatJsonFile } from "../../../contracts/json-text.ts";
import { pathExists } from "../../filesystem/files.ts";
import { publishCanonicalWorkspaceFile } from "../../filesystem/file-publication.ts";
import { type CommitFence } from "../../../contracts/commit-fence.ts";
import { resolveWorkspaceArtifactPath } from "../../workspace-context.ts";
import type { LockFile } from '../../../compiler/contract.ts';
import { readLockFile, writeLockWithGeneratedPaths } from "../../workspace/lock.ts";
import { semanticViewArtifactsAreCurrent } from './semantic-view-artifact-contract.ts';
import { writeProvenance } from './write-provenance.ts';

interface GeneratedPathResult {
  /** Mixed workspace output identities from the compiler lock. */
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
  const explainGraphPath = resolveWorkspaceArtifactPath(
    workspaceRoot,
    CI_ARTIFACT_FILES.explainGraph
  );
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
  workspaceRoot = path.resolve(workspaceRoot);
  const generatedPathResult = readGeneratedPaths(workspaceRoot);
  const semanticEmitArtifactsCurrent = generatedPathResult.lock
    ? semanticEmitArtifactsAreCurrent(workspaceRoot, generatedPathResult.lock)
    : false;
  const staleSemanticArtifacts = !semanticEmitArtifactsCurrent
    ? new Set(CI_EMIT_ARTIFACT_PATHS.map(normalizeCiArtifactPath))
    : new Set<string>();
  const generatedArtifactPaths = generatedPathResult.paths.filter(isCanonicalCiArtifactPath);
  const artifacts = uniqueSortedCiArtifactPaths([
    ...fixedCiArtifactPaths(),
    ...generatedArtifactPaths
  ]).filter((artifactPath) => !staleSemanticArtifacts.has(artifactPath));
  const entries: CiArtifactEntry[] = [];
  const missing: CiArtifactMissingEntry[] = [...staleSemanticArtifacts].map((artifactPath) => ({
    path: artifactPath,
    reason: CI_ARTIFACT_MISSING_REASON.staleSemanticProjection,
    declaredBy: 'artifact-manifest'
  }));
  const generatedPaths = new Set(generatedArtifactPaths.map(normalizeCiArtifactPath));
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
  workspaceRoot = path.resolve(workspaceRoot);
  const lockPath = resolveWorkspaceArtifactPath(
    workspaceRoot,
    CI_ARTIFACT_FILES.graphLock
  );
  const ciArtifactsPath = resolveWorkspaceArtifactPath(
    workspaceRoot,
    CI_ARTIFACT_FILES.artifactManifest
  );
  const artifactsRootPath = resolveWorkspaceArtifactPath(
    workspaceRoot,
    CI_ARTIFACT_ROOT_RELATIVE_PATH
  );
  const lock = readLockFile(workspaceRoot);
  await writeLockWithGeneratedPaths(lockPath, lock, [CI_ARTIFACT_MANIFEST_PATH], commitFence);
  const manifest = await buildCiArtifactManifestWithPlannedPaths(
    workspaceRoot,
    new Set([CI_ARTIFACT_MANIFEST_PATH])
  );
  const manifestBytes = Buffer.from(formatJsonFile(manifest), 'utf8');
  await publishCanonicalWorkspaceFile({
    workspaceRoot: artifactsRootPath,
    targetPath: ciArtifactsPath,
    bytes: manifestBytes,
    label: 'CI artifact manifest',
    commitFence
  });
  await writeProvenance(workspaceRoot, lock, commitFence);
  return manifest;
}
