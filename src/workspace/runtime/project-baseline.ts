import path from 'node:path';

import { PhysicalNoFollowError } from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { decodeExactUtf8, readOptionalRetainedOrdinaryFile } from '../../runtime-state/physical/runtime/retained-file-read.ts';
import { canonicalEquals } from '../../system-architecture/foundation/runtime/canonical.ts';
import {
  PROJECT_BASELINE_FORMAT_VERSION,
  parseProjectBaseline,
  parseProjectBaselineJson,
  type ProjectBaselineArtifact,
  type ProjectBaselineFile,
  type ProjectBaselinePathInput
} from '../contract/project-baseline.ts';
import { captureProjectPathInventory } from '../contract/project-path-inventory.ts';
import { ProjectIntegrityError } from '../contract/project-integrity.ts';
import { modelRelativePath } from '../contract/types.ts';
import { ensureDir, formatJsonFile, type CommitFence } from './files.ts';
import { publishExclusiveCanonicalWorkspaceFile, publishExpectedCanonicalWorkspaceFile } from './file-publication.ts';
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

function baselinePaths(paths: readonly string[], label: string): readonly string[] {
  try { return captureProjectPathInventory(paths, 'coalesce', label); }
  catch (cause) { throw new ProjectIntegrityError('Project baseline path inventory is invalid', {}, { cause }); }
}

function isReadOnlyProjectPath(artifactPath: string): boolean {
  return (
    !artifactPath.startsWith(`${modelRelativePath}/`) &&
    !artifactPath.startsWith(`${secRelativePath}/`) &&
    artifactPath !== workspaceConfigRelativePath &&
    artifactPath !== tsconfigRelativePath
  );
}

export function currentReadOnlyProjectPaths(input: ProjectBaselinePathInput): string[] {
  return baselinePaths(input.artifactPaths, 'Project baseline ownership').filter(isReadOnlyProjectPath);
}

/** The retained backend is synchronous; Promise fanout would not create IO concurrency. */
function calculateArtifactHashes(workspaceRoot: string, artifactPaths: readonly string[]) {
  return artifactPaths.map(artifactPath => {
    const absolutePath = resolvePathInside(workspaceRoot, artifactPath);
    return { path: artifactPath, hash: absolutePath ? calculateProjectFileHash(absolutePath) : undefined };
  });
}

function captureBaseline(value: ProjectBaselineFile): ProjectBaselineFile {
  try { return parseProjectBaseline(value); }
  catch (cause) { throw new ProjectIntegrityError('Project baseline is stale or malformed', {}, { cause }); }
}

export function readProjectBaseline(workspaceRoot: string): ProjectBaselineFile | null {
  let bytes: Uint8Array | null;
  try {
    bytes = readOptionalRetainedOrdinaryFile(getProjectBaselinePath(workspaceRoot), 'Project baseline');
  } catch (cause) {
    if (cause instanceof PhysicalNoFollowError) throw cause;
    throw new ProjectIntegrityError('Project baseline cannot be read as retained bytes', {}, { cause });
  }
  if (bytes === null) return null;
  try { return parseProjectBaselineJson(decodeExactUtf8(bytes, 'Project baseline')); }
  catch (cause) { throw new ProjectIntegrityError('Project baseline is stale or malformed', {}, { cause }); }
}

/** Receives only owned immutable contract data. Repeated publication checks do
 * not re-parse the same baseline or consult mutable caller options again. */
function assertCapturedBaseline(
  root: string,
  baseline: ProjectBaselineFile,
  allowedChangedPaths: ReadonlySet<string>
): void {
  const currentArtifacts = calculateArtifactHashes(root, baseline.artifacts.map(artifact => artifact.path));
  for (let index = 0; index < baseline.artifacts.length; index += 1) {
    const expected = baseline.artifacts[index]!;
    const current = currentArtifacts[index];
    if (current?.hash === undefined) {
      if (allowedChangedPaths.has(expected.path)) continue;
      throw new ProjectIntegrityError(
        `Project drift detected: Read-only project file is missing after composition: ${expected.path}`,
        { path: expected.path, expectedHash: expected.hash, actualHash: current?.hash }
      );
    }
    if (current.hash !== expected.hash && !allowedChangedPaths.has(expected.path)) {
      throw new ProjectIntegrityError(
        `Project drift detected: Read-only project file modified after composition: ${expected.path}`,
        { path: expected.path, expectedHash: expected.hash, actualHash: current.hash }
      );
    }
  }
}

export function assertProjectBaseline(
  workspaceRoot: string,
  baseline: ProjectBaselineFile,
  options: ProjectBaselineAssertionOptions = {}
): void {
  const { workspaceRoot: root } = getWorkspacePaths(path.resolve(workspaceRoot));
  const { allowedChangedPaths, expectedArtifactPaths } = options;
  const allowed = new Set(baselinePaths(allowedChangedPaths === undefined ? [] : allowedChangedPaths, 'Allowed project changes'));
  const expectedPaths = expectedArtifactPaths === undefined ? undefined : baselinePaths(expectedArtifactPaths, 'Expected project ownership');
  const captured = captureBaseline(baseline);
  if (expectedPaths !== undefined && !canonicalEquals(captured.artifacts.map(artifact => artifact.path), expectedPaths)) {
    throw new ProjectIntegrityError('Project baseline is stale or malformed: artifact path set does not match the current generated ownership set');
  }
  assertCapturedBaseline(root, captured, allowed);
}

export async function writeProjectBaseline(
  workspaceRoot: string,
  input: ProjectBaselinePathInput,
  commitFence?: CommitFence
): Promise<ProjectBaselineFile> {
  // Fix the root before caller-owned path data or callbacks can change cwd.
  const { workspaceRoot: root, cacheRoot } = getWorkspacePaths(path.resolve(workspaceRoot));
  if (commitFence !== undefined && typeof commitFence !== 'function') throw new TypeError('Project baseline fence must be callable');
  const artifactPaths = currentReadOnlyProjectPaths(input);
  const artifacts: ProjectBaselineArtifact[] = calculateArtifactHashes(root, artifactPaths).map(artifact => {
    if (artifact.hash === undefined) {
      throw new ProjectIntegrityError(`Project baseline failed: Declared read-only project file is missing: ${artifact.path}`);
    }
    return { path: artifact.path, hash: artifact.hash };
  });
  const baseline = parseProjectBaseline({ formatVersion: PROJECT_BASELINE_FORMAT_VERSION, artifacts });
  const targetPath = getProjectBaselinePath(root);
  const previous = readOptionalRetainedOrdinaryFile(targetPath, 'Project baseline preimage');
  const bytes = Buffer.from(formatJsonFile(baseline), 'utf8');
  const noChanges = new Set<string>();
  const fence: CommitFence = async () => {
    await commitFence?.();
    assertCapturedBaseline(root, baseline, noChanges);
  };
  if (previous !== null && Buffer.from(previous).equals(bytes)) {
    // Equal output does not justify another publication, but still requires
    // current admission, artifact integrity and baseline readback.
    await fence();
  } else {
    // Keep the existing baseline directory lifecycle. Publication is confined
    // to that established cache subtree, not a broader creation vocabulary.
    await ensureDir(cacheRoot, fence);
    const publication = { workspaceRoot: cacheRoot, targetPath, bytes, label: 'Project baseline', commitFence: fence };
    if (previous === null) await publishExclusiveCanonicalWorkspaceFile(publication);
    else await publishExpectedCanonicalWorkspaceFile({ ...publication, expectedBytes: previous });
  }
  const observed = readProjectBaseline(root);
  if (observed === null || !canonicalEquals(observed, baseline)) {
    throw new ProjectIntegrityError('Project baseline changed before publication readback completed');
  }
  assertCapturedBaseline(root, baseline, noChanges);
  return baseline;
}
