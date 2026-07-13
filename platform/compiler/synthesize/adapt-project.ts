import fs from 'node:fs/promises';

import { CompilerError } from '../../shared/errors.ts';
import { isFileNotFoundError, writeText, type CommitFence } from '../../shared/fs.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import { assertPassStatus, saveLock } from '../../shared/lock-utils.ts';
import { rebaseRelativeImports } from '../../shared/path-imports.ts';
import { resolveWorkspaceArtifactPath, toProjectRuntimePath } from '../../shared/paths.ts';
import type { PlanFile } from '../../shared/plan-manifest-types.ts';
import { writeProjectBaseline } from '../../shared/project-baseline.ts';
import { applyOverrides } from '../compose/apply-overrides.ts';
import { loadOverrideManifest } from '../parse/load-override-manifest.ts';
import { buildTaskEnvelope } from './build-task-envelope.ts';
import { synthesizeSlotSource } from './mock-slot-synthesizer.ts';

export async function adaptProject(
  workspaceRoot: string,
  plan: PlanFile,
  lock: LockFile,
  commitFence?: CommitFence
): Promise<LockFile> {
  assertPassStatus(lock, 'compose', 'succeeded', new CompilerError('SLOT-WRITE-003', 'compose must succeed before adapt'));

  for (const task of lock.slotTasks) {
    if (task.status !== 'generated' && task.status !== 'pending') {
      continue;
    }
    const envelope = buildTaskEnvelope(plan, lock, task);
    const targetPath = resolveWorkspaceArtifactPath(workspaceRoot, task.target);
    const sourcePath = task.sourcePath ? resolveWorkspaceArtifactPath(workspaceRoot, task.sourcePath) : targetPath;
    const authoredSource = await fs.readFile(sourcePath, 'utf8').catch(async (error: unknown) => {
      if (isFileNotFoundError(error)) {
        const synthesizedSource = synthesizeSlotSource(envelope);
        await writeText(sourcePath, synthesizedSource, commitFence);
        return synthesizedSource;
      }
      throw error;
    });
    const runtimeSource = task.sourcePath ? rebaseRelativeImports(authoredSource, task.sourcePath, toProjectRuntimePath(task.target)) : authoredSource;
    await writeText(targetPath, runtimeSource, commitFence);
    task.status = 'filled';
  }

  await applyOverrides(workspaceRoot, 'adapt', commitFence);
  const overrideManifest = await loadOverrideManifest(workspaceRoot);
  await writeProjectBaseline(
    workspaceRoot,
    lock,
    overrideManifest.overrides.map((entry) => entry.target),
    commitFence
  );

  lock.passStatus.adapt = 'succeeded';
  await saveLock(workspaceRoot, lock, commitFence);
  return lock;
}
