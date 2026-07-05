import path from 'node:path';

import { uniqueSorted } from './collections.ts';
import { CompilerError } from './errors.ts';
import { readOptionalJson, writeJson } from './fs.ts';
import type { LockFile } from './lock-types.ts';
import { getWorkspacePaths, posixPath, resolvePathInside } from './paths.ts';
import { calculateProjectFileHash } from './project-file-hash.ts';
import {
  COMPOSITION_BASELINE_FORMAT_VERSION,
  type CompositionBaselineArtifact,
  type CompositionBaselineFile
} from './project-integrity-baseline.ts';

export function getCompositionBaselinePath(workspaceRoot: string): string {
  const { localStateRoot } = getWorkspacePaths(workspaceRoot);
  return path.join(localStateRoot, 'cache', 'composition-baseline.json');
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

export function currentReadOnlyProjectPaths(lock: LockFile): string[] {
  const slotTargets = new Set(lock.slotTasks.map((task) => posixPath(task.target)));
  return uniqueSorted([
    ...lock.installPlan.map((step) => posixPath(step.to)),
    ...lock.generatedPaths.map(posixPath)
  ]).filter((artifactPath) => isReadOnlyProjectPath(artifactPath, slotTargets));
}

export async function readCompositionBaseline(workspaceRoot: string): Promise<CompositionBaselineFile | null> {
  const baseline = await readOptionalJson<CompositionBaselineFile>(getCompositionBaselinePath(workspaceRoot));
  if (baseline && baseline.formatVersion !== COMPOSITION_BASELINE_FORMAT_VERSION) {
    throw new CompilerError(
      'ERROR-DRIFT-001',
      `Unsupported composition baseline formatVersion "${String(baseline.formatVersion)}"`
    );
  }
  return baseline;
}

export async function assertCompositionBaseline(
  workspaceRoot: string,
  baseline: CompositionBaselineFile
): Promise<void> {
  const { projectRoot } = getWorkspacePaths(workspaceRoot);
  for (const artifact of baseline.artifacts) {
    const absolutePath = resolvePathInside(projectRoot, artifact.path);
    const currentHash = absolutePath ? await calculateProjectFileHash(absolutePath) : undefined;
    if (!currentHash) {
      throw new CompilerError(
        'ERROR-DRIFT-001',
        `Composition drift detected: Read-only project file is missing after compose: ${artifact.path}`
      );
    }
    if (currentHash !== artifact.hash) {
      throw new CompilerError(
        'ERROR-DRIFT-001',
        `Composition drift detected: Read-only project file modified after compose: ${artifact.path}`
      );
    }
  }
}

export async function writeCompositionBaseline(
  workspaceRoot: string,
  lock: LockFile
): Promise<CompositionBaselineFile> {
  const { projectRoot } = getWorkspacePaths(workspaceRoot);
  const artifacts: CompositionBaselineArtifact[] = [];

  for (const artifactPath of currentReadOnlyProjectPaths(lock)) {
    const absolutePath = resolvePathInside(projectRoot, artifactPath);
    const hash = absolutePath ? await calculateProjectFileHash(absolutePath) : undefined;
    if (!hash) {
      throw new CompilerError(
        'ERROR-DRIFT-001',
        `Composition baseline failed: Declared read-only project file is missing: ${artifactPath}`
      );
    }
    artifacts.push({ path: artifactPath, hash });
  }

  const baseline: CompositionBaselineFile = {
    formatVersion: COMPOSITION_BASELINE_FORMAT_VERSION,
    artifacts
  };
  await writeJson(getCompositionBaselinePath(workspaceRoot), baseline);
  return baseline;
}
