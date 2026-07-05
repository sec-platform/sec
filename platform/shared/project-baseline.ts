import path from 'node:path';

import { uniqueSorted } from './collections.ts';
import { CompilerError } from './errors.ts';
import { readOptionalJson, writeJson } from './fs.ts';
import type { LockFile } from './lock-types.ts';
import { getWorkspacePaths, posixPath, resolvePathInside } from './paths.ts';
import { calculateProjectFileHash } from './project-file-hash.ts';
import {
  PROJECT_BASELINE_FORMAT_VERSION,
  type ProjectBaselineArtifact,
  type ProjectBaselineFile
} from './project-integrity-baseline.ts';

export function getProjectBaselinePath(workspaceRoot: string): string {
  const { localStateRoot } = getWorkspacePaths(workspaceRoot);
  return path.join(localStateRoot, 'cache', 'project-baseline.json');
}

function isReadOnlyProjectPath(artifactPath: string, slotTargets: ReadonlySet<string>): boolean {
  const normalized = posixPath(artifactPath);
  return (
    !normalized.startsWith('source/') &&
    !normalized.startsWith('control/') &&
    !normalized.startsWith('.sec/') &&
    !normalized.startsWith('project/') &&
    !slotTargets.has(normalized) &&
    normalized !== 'next-env.d.ts' &&
    normalized !== 'tsconfig.json'
  );
}

export function currentReadOnlyProjectPaths(
  lock: LockFile,
  additionalPaths: readonly string[] = []
): string[] {
  const slotTargets = new Set(lock.slotTasks.map((task) => posixPath(task.target)));
  return uniqueSorted([
    ...lock.installPlan.map((step) => posixPath(step.to)),
    ...lock.generatedPaths.map(posixPath),
    ...additionalPaths.map(posixPath)
  ]).filter((artifactPath) => isReadOnlyProjectPath(artifactPath, slotTargets));
}

export async function readProjectBaseline(workspaceRoot: string): Promise<ProjectBaselineFile | null> {
  const baseline = await readOptionalJson<ProjectBaselineFile>(getProjectBaselinePath(workspaceRoot));
  if (baseline && baseline.formatVersion !== PROJECT_BASELINE_FORMAT_VERSION) {
    throw new CompilerError(
      'ERROR-DRIFT-001',
      `Unsupported project baseline formatVersion "${String(baseline.formatVersion)}"`
    );
  }
  return baseline;
}

export async function assertProjectBaseline(
  workspaceRoot: string,
  baseline: ProjectBaselineFile
): Promise<void> {
  const { projectRoot } = getWorkspacePaths(workspaceRoot);
  for (const artifact of baseline.artifacts) {
    const absolutePath = resolvePathInside(projectRoot, artifact.path);
    const currentHash = absolutePath ? await calculateProjectFileHash(absolutePath) : undefined;
    if (!currentHash) {
      throw new CompilerError(
        'ERROR-DRIFT-001',
        `Project drift detected: Read-only project file is missing after adapt: ${artifact.path}`
      );
    }
    if (currentHash !== artifact.hash) {
      throw new CompilerError(
        'ERROR-DRIFT-001',
        `Project drift detected: Read-only project file modified after adapt: ${artifact.path}`
      );
    }
  }
}

export async function writeProjectBaseline(
  workspaceRoot: string,
  lock: LockFile,
  additionalPaths: readonly string[] = []
): Promise<ProjectBaselineFile> {
  const { projectRoot } = getWorkspacePaths(workspaceRoot);
  const artifacts: ProjectBaselineArtifact[] = [];

  for (const artifactPath of currentReadOnlyProjectPaths(lock, additionalPaths)) {
    const absolutePath = resolvePathInside(projectRoot, artifactPath);
    const hash = absolutePath ? await calculateProjectFileHash(absolutePath) : undefined;
    if (!hash) {
      throw new CompilerError(
        'ERROR-DRIFT-001',
        `Project baseline failed: Declared read-only project file is missing: ${artifactPath}`
      );
    }
    artifacts.push({ path: artifactPath, hash });
  }

  const baseline: ProjectBaselineFile = {
    formatVersion: PROJECT_BASELINE_FORMAT_VERSION,
    artifacts
  };
  await writeJson(getProjectBaselinePath(workspaceRoot), baseline);
  return baseline;
}
