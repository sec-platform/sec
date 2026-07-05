import path from 'node:path';

import { uniqueSorted } from './collections.ts';
import { createConcurrencyLimit } from './concurrency.ts';
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

async function calculateArtifactHashes(
  projectRoot: string,
  artifactPaths: readonly string[]
): Promise<Array<{ path: string; hash: string | undefined }>> {
  const limit = createConcurrencyLimit();
  return Promise.all(artifactPaths.map((artifactPath) => limit(async () => {
    const absolutePath = resolvePathInside(projectRoot, artifactPath);
    const hash = absolutePath ? await calculateProjectFileHash(absolutePath) : undefined;
    return { path: artifactPath, hash };
  })));
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
  const currentArtifacts = await calculateArtifactHashes(
    projectRoot,
    baseline.artifacts.map((artifact) => artifact.path)
  );

  for (let index = 0; index < baseline.artifacts.length; index += 1) {
    const expected = baseline.artifacts[index];
    const current = currentArtifacts[index];
    if (!expected || !current?.hash) {
      throw new CompilerError(
        'ERROR-DRIFT-001',
        `Project drift detected: Read-only project file is missing after adapt: ${expected?.path ?? current?.path}`
      );
    }
    if (current.hash !== expected.hash) {
      throw new CompilerError(
        'ERROR-DRIFT-001',
        `Project drift detected: Read-only project file modified after adapt: ${expected.path}`
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
  const artifactPaths = currentReadOnlyProjectPaths(lock, additionalPaths);
  const calculated = await calculateArtifactHashes(projectRoot, artifactPaths);
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

  const baseline: ProjectBaselineFile = {
    formatVersion: PROJECT_BASELINE_FORMAT_VERSION,
    artifacts
  };
  await writeJson(getProjectBaselinePath(workspaceRoot), baseline);
  return baseline;
}
