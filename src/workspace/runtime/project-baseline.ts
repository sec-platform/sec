import path from 'node:path';

import { PhysicalNoFollowError } from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  decodeExactUtf8,
  readOptionalRetainedOrdinaryFile
} from '../../runtime-state/physical/runtime/retained-file-read.ts';
import { isCanonicalPortableLogicalPath } from '../../system-architecture/foundation/contract/logical-path.ts';
import { canonicalEquals, uniqueSorted } from '../../system-architecture/foundation/runtime/canonical.ts';
import {
  PROJECT_BASELINE_FORMAT_VERSION,
  parseProjectBaseline,
  parseProjectBaselineJson,
  type ProjectBaselineArtifact,
  type ProjectBaselineFile,
  type ProjectBaselinePathInput
} from '../contract/project-baseline.ts';
import { ProjectIntegrityError } from '../contract/project-integrity.ts';
import { modelRelativePath } from '../contract/types.ts';
import { writeJson, type CommitFence } from './files.ts';
import {
  getWorkspacePaths,
  resolvePathInside,
  secRelativePath,
  tsconfigRelativePath,
  workspaceConfigRelativePath
} from './paths.ts';
import { calculateProjectFileHash } from './project-file-hash.ts';

export interface ProjectBaselineAssertionOptions {
  allowedChangedPaths?: readonly string[];
  expectedArtifactPaths?: readonly string[];
}

export function getProjectBaselinePath(workspaceRoot: string): string {
  const { cacheRoot } = getWorkspacePaths(workspaceRoot);
  return path.join(cacheRoot, 'project-baseline.json');
}

function requireCanonicalBaselineArtifactPath(artifactPath: string): string {
  if (!isCanonicalPortableLogicalPath(artifactPath)) {
    throw new ProjectIntegrityError(
      `Project baseline path is not one canonical portable logical path: ${artifactPath}`
    );
  }
  return artifactPath;
}

function isReadOnlyProjectPath(artifactPath: string): boolean {
  return (
    !artifactPath.startsWith(`${modelRelativePath}/`) &&
    !artifactPath.startsWith(`${secRelativePath}/`) &&
    artifactPath !== workspaceConfigRelativePath &&
    artifactPath !== tsconfigRelativePath
  );
}

export function currentReadOnlyProjectPaths(
  input: ProjectBaselinePathInput
): string[] {
  const candidates = input.artifactPaths.map(requireCanonicalBaselineArtifactPath);
  return uniqueSorted(candidates)
    .filter(isReadOnlyProjectPath);
}

/**
 * The retained hash backend is synchronous. Keep the batch synchronous until
 * the physical-read owner exposes a genuine async capability; Promise fanout
 * around these calls does not create filesystem concurrency.
 */
function calculateArtifactHashes(
  workspaceRoot: string,
  artifactPaths: readonly string[]
): Array<{ path: string; hash: string | undefined }> {
  return artifactPaths.map((rawArtifactPath) => {
    const artifactPath = requireCanonicalBaselineArtifactPath(rawArtifactPath);
    const absolutePath = resolvePathInside(workspaceRoot, artifactPath);
    const hash = absolutePath ? calculateProjectFileHash(absolutePath) : undefined;
    return { path: artifactPath, hash };
  });
}

function allowedChangedPathSet(options: ProjectBaselineAssertionOptions): ReadonlySet<string> {
  return new Set((options.allowedChangedPaths ?? []).map(requireCanonicalBaselineArtifactPath));
}

function expectedArtifactPaths(options: ProjectBaselineAssertionOptions): readonly string[] | null {
  if (options.expectedArtifactPaths === undefined) return null;
  return uniqueSorted(options.expectedArtifactPaths.map(requireCanonicalBaselineArtifactPath));
}

function invalidBaseline(message: string): never {
  throw new ProjectIntegrityError(`Project baseline is stale or malformed: ${message}`);
}

export function readProjectBaseline(workspaceRoot: string): ProjectBaselineFile | null {
  let bytes: Uint8Array | null;
  try {
    bytes = readOptionalRetainedOrdinaryFile(
      getProjectBaselinePath(workspaceRoot),
      'Project baseline'
    );
  } catch (error) {
    if (error instanceof PhysicalNoFollowError) throw error;
    throw new ProjectIntegrityError(
      `Project baseline cannot be read as retained bytes: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (bytes === null) return null;
  try {
    return parseProjectBaselineJson(decodeExactUtf8(bytes, 'Project baseline'));
  } catch (error) {
    throw new ProjectIntegrityError(
      `Project baseline is stale or malformed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export function assertProjectBaseline(
  workspaceRoot: string,
  baseline: ProjectBaselineFile,
  options: ProjectBaselineAssertionOptions = {}
): void {
  const baselineArtifactPaths = baseline.artifacts.map((artifact) => artifact.path);
  const expectedPaths = expectedArtifactPaths(options);
  if (expectedPaths !== null && !canonicalEquals(baselineArtifactPaths, expectedPaths)) {
    invalidBaseline('artifact path set does not match the current generated ownership set');
  }

  const { workspaceRoot: root } = getWorkspacePaths(workspaceRoot);
  const allowedChangedPaths = allowedChangedPathSet(options);
  const currentArtifacts = calculateArtifactHashes(root, baselineArtifactPaths);

  for (let index = 0; index < baseline.artifacts.length; index += 1) {
    const expected = baseline.artifacts[index];
    const current = currentArtifacts[index];
    const artifactPath = expected?.path ?? current?.path ?? '';
    if (!expected || !current?.hash) {
      if (allowedChangedPaths.has(artifactPath)) continue;
      throw new ProjectIntegrityError(
        `Project drift detected: Read-only project file is missing after composition: ${artifactPath}`,
        {
          path: artifactPath,
          expectedHash: expected?.hash,
          actualHash: current?.hash
        }
      );
    }
    if (current.hash !== expected.hash) {
      if (allowedChangedPaths.has(artifactPath)) continue;
      throw new ProjectIntegrityError(
        `Project drift detected: Read-only project file modified after composition: ${expected.path}`,
        {
          path: expected.path,
          expectedHash: expected.hash,
          actualHash: current.hash
        }
      );
    }
  }
}

export async function writeProjectBaseline(
  workspaceRoot: string,
  input: ProjectBaselinePathInput,
  commitFence?: CommitFence
): Promise<ProjectBaselineFile> {
  const { workspaceRoot: root } = getWorkspacePaths(workspaceRoot);
  const artifactPaths = currentReadOnlyProjectPaths(input);
  const calculated = calculateArtifactHashes(root, artifactPaths);
  const artifacts: ProjectBaselineArtifact[] = [];

  for (const artifact of calculated) {
    if (!artifact.hash) {
      throw new ProjectIntegrityError(
        `Project baseline failed: Declared read-only project file is missing: ${artifact.path}`
      );
    }
    artifacts.push({ path: artifact.path, hash: artifact.hash });
  }

  const baseline = parseProjectBaseline({
    formatVersion: PROJECT_BASELINE_FORMAT_VERSION,
    artifacts
  });
  await writeJson(getProjectBaselinePath(workspaceRoot), baseline, commitFence);
  return baseline;
}
