import path from 'node:path';

import { canonicalEquals, deepFreeze, uniqueSorted } from '../../system-architecture/foundation/runtime/canonical.ts';
import { CompilerError } from '../../compiler/errors.ts';
import { writeJson, type CommitFence } from './files.ts';
import type { LockFile } from '../../compiler/contract.ts';
import { isCanonicalPortableLogicalPath } from '../../system-architecture/foundation/contract/logical-path.ts';
import { getWorkspacePaths, resolvePathInside } from './paths.ts';
import { PhysicalNoFollowError } from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { calculateProjectFileHash } from './project-file-hash.ts';
import {
  PROJECT_BASELINE_FORMAT_VERSION,
  type ProjectBaselineArtifact,
  type ProjectBaselineFile
} from '../index.ts';
import { readOptionalRetainedJson } from '../../runtime-state/physical/runtime/retained-file-read.ts';

export interface ProjectBaselineAssertionOptions {
  allowedChangedPaths?: readonly string[];
  expectedArtifactPaths?: readonly string[];
}

const PROJECT_BASELINE_KEYS = new Set(['formatVersion', 'artifacts']);
const PROJECT_BASELINE_ARTIFACT_KEYS = new Set(['path', 'hash']);

export function getProjectBaselinePath(workspaceRoot: string): string {
  const { localStateRoot } = getWorkspacePaths(workspaceRoot);
  return path.join(localStateRoot, 'cache', 'project-baseline.json');
}

function requireCanonicalBaselineArtifactPath(artifactPath: string): string {
  if (!isCanonicalPortableLogicalPath(artifactPath)) {
    throw new CompilerError(
      'ERROR-DRIFT-001',
      `Project baseline path is not one canonical portable logical path: ${artifactPath}`
    );
  }
  return artifactPath;
}

function isReadOnlyProjectPath(artifactPath: string, slotTargets: ReadonlySet<string>): boolean {
  return (
    !artifactPath.startsWith('source/') &&
    !artifactPath.startsWith('control/') &&
    !artifactPath.startsWith('.sec/') &&
    !artifactPath.startsWith('project/') &&
    !slotTargets.has(artifactPath) &&
    artifactPath !== 'tsconfig.json'
  );
}

export function currentReadOnlyProjectPaths(
  lock: LockFile,
  additionalPaths: readonly string[] = []
): string[] {
  const slotTargets = new Set(
    lock.slotTasks.map((task) => requireCanonicalBaselineArtifactPath(task.target))
  );
  const candidates = [
    ...lock.installPlan.map((step) => step.to),
    ...lock.generatedPaths,
    ...additionalPaths
  ].map(requireCanonicalBaselineArtifactPath);
  return uniqueSorted(candidates)
    .filter((artifactPath) => isReadOnlyProjectPath(artifactPath, slotTargets));
}

/**
 * The retained hash backend is synchronous. Keep the batch synchronous until
 * the physical-read owner exposes a genuine async capability; Promise fanout
 * around these calls does not create filesystem concurrency.
 */
function calculateArtifactHashes(
  projectRoot: string,
  artifactPaths: readonly string[]
): Array<{ path: string; hash: string | undefined }> {
  return artifactPaths.map((rawArtifactPath) => {
    const artifactPath = requireCanonicalBaselineArtifactPath(rawArtifactPath);
    const absolutePath = resolvePathInside(projectRoot, artifactPath);
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
  throw new CompilerError('ERROR-DRIFT-001', `Project baseline is stale or malformed: ${message}`);
}

function hasExactKeys(value: Record<string, unknown>, expected: ReadonlySet<string>): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function validateProjectBaseline(value: unknown): ProjectBaselineFile {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalidBaseline('root must be one object');
  }
  const baseline = value as Record<string, unknown>;
  if (!hasExactKeys(baseline, PROJECT_BASELINE_KEYS)) {
    return invalidBaseline('root has an unsupported field set');
  }
  if (baseline.formatVersion !== PROJECT_BASELINE_FORMAT_VERSION) {
    return invalidBaseline(`unsupported formatVersion "${String(baseline.formatVersion)}"`);
  }
  if (!Array.isArray(baseline.artifacts)) {
    return invalidBaseline('artifacts must be an array');
  }

  const artifacts: ProjectBaselineArtifact[] = [];
  const seenPaths = new Set<string>();
  for (const rawArtifact of baseline.artifacts) {
    if (rawArtifact === null || typeof rawArtifact !== 'object' || Array.isArray(rawArtifact)) {
      return invalidBaseline('every artifact must be one object');
    }
    const artifact = rawArtifact as Record<string, unknown>;
    if (!hasExactKeys(artifact, PROJECT_BASELINE_ARTIFACT_KEYS)) {
      return invalidBaseline('artifact has an unsupported field set');
    }
    if (typeof artifact.path !== 'string' || !isCanonicalPortableLogicalPath(artifact.path)) {
      return invalidBaseline(`artifact path is not canonical: ${String(artifact.path)}`);
    }
    if (typeof artifact.hash !== 'string' || !/^[0-9a-f]{64}$/u.test(artifact.hash)) {
      return invalidBaseline(`artifact hash is invalid for ${artifact.path}`);
    }
    if (seenPaths.has(artifact.path)) {
      return invalidBaseline(`duplicate artifact path ${artifact.path}`);
    }
    seenPaths.add(artifact.path);
    artifacts.push({ path: artifact.path, hash: artifact.hash });
  }

  const artifactPaths = artifacts.map((artifact) => artifact.path);
  if (!canonicalEquals(artifactPaths, uniqueSorted(artifactPaths))) {
    return invalidBaseline('artifact paths must be canonically ordered');
  }

  return deepFreeze({
    formatVersion: PROJECT_BASELINE_FORMAT_VERSION,
    artifacts
  });
}

export function readProjectBaseline(workspaceRoot: string): ProjectBaselineFile | null {
  let raw: unknown;
  try {
    raw = readOptionalRetainedJson<unknown>(
      getProjectBaselinePath(workspaceRoot),
      'Project baseline'
    );
  } catch (error) {
    if (error instanceof PhysicalNoFollowError) throw error;
    throw new CompilerError(
      'ERROR-DRIFT-001',
      `Project baseline cannot be read as retained JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  return raw === null ? null : validateProjectBaseline(raw);
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

  const { projectRoot } = getWorkspacePaths(workspaceRoot);
  const allowedChangedPaths = allowedChangedPathSet(options);
  const currentArtifacts = calculateArtifactHashes(projectRoot, baselineArtifactPaths);

  for (let index = 0; index < baseline.artifacts.length; index += 1) {
    const expected = baseline.artifacts[index];
    const current = currentArtifacts[index];
    const artifactPath = expected?.path ?? current?.path ?? '';
    if (!expected || !current?.hash) {
      if (allowedChangedPaths.has(artifactPath)) continue;
      throw new CompilerError(
        'ERROR-DRIFT-001',
        `Project drift detected: Read-only project file is missing after adapt: ${artifactPath}`,
        {
          path: artifactPath,
          expectedHash: expected?.hash,
          actualHash: current?.hash
        }
      );
    }
    if (current.hash !== expected.hash) {
      if (allowedChangedPaths.has(artifactPath)) continue;
      throw new CompilerError(
        'ERROR-DRIFT-001',
        `Project drift detected: Read-only project file modified after adapt: ${expected.path}`,
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
  lock: LockFile,
  additionalPaths: readonly string[] = [],
  commitFence?: CommitFence
): Promise<ProjectBaselineFile> {
  const { projectRoot } = getWorkspacePaths(workspaceRoot);
  const artifactPaths = currentReadOnlyProjectPaths(lock, additionalPaths);
  const calculated = calculateArtifactHashes(projectRoot, artifactPaths);
  const artifacts: ProjectBaselineArtifact[] = [];

  for (const artifact of calculated) {
    if (!artifact.hash) {
      throw new CompilerError(
        'ERROR-DRIFT-001',
        `Project baseline failed: Declared read-only project file is missing: ${artifact.path}`
      );
    }
    artifacts.push({ path: artifact.path, hash: artifact.hash });
  }

  const baseline = deepFreeze<ProjectBaselineFile>({
    formatVersion: PROJECT_BASELINE_FORMAT_VERSION,
    artifacts
  });
  await writeJson(getProjectBaselinePath(workspaceRoot), baseline, commitFence);
  return baseline;
}
