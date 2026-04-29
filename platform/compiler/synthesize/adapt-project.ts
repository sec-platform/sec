import fs from 'node:fs/promises';
import path from 'node:path';
import { getWorkspacePaths, resolveWorkspaceArtifactPath, toProjectRuntimePath } from '../../shared/paths.ts';
import { CompilerError } from '../../shared/errors.ts';
import { applyOverrides } from '../compose/apply-overrides.ts';
import { buildTaskEnvelope } from './build-task-envelope.ts';
import { synthesizeSlotSource } from './mock-slot-synthesizer.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import type { PlanFile } from '../../shared/plan-manifest-types.ts';

function projectRelativeImport(fromFile: string, toFile: string): string {
  const relativePath = path.posix.relative(path.posix.dirname(fromFile), toFile);
  return relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
}

function rebaseRelativeImports(source: string, fromFile: string, toFile: string): string {
  return source.replace(/(from\s+['"])(\.{1,2}\/[^'"]+)(['"])/g, (_match, prefix: string, specifier: string, suffix: string) => {
    const resolvedTarget = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
    return `${prefix}${projectRelativeImport(toFile, resolvedTarget)}${suffix}`;
  });
}

export async function adaptProject(workspaceRoot: string, plan: PlanFile, lock: LockFile): Promise<LockFile> {
  const { lockPath } = getWorkspacePaths(workspaceRoot);

  if (lock.passStatus.compose !== 'succeeded') {
    throw new CompilerError('SLOT-WRITE-003', 'compose must succeed before adapt');
  }

  for (const task of lock.slotTasks) {
    if (task.status !== 'generated' && task.status !== 'pending') {
      continue;
    }
    const envelope = buildTaskEnvelope(plan, lock, task);
    const targetPath = resolveWorkspaceArtifactPath(workspaceRoot, task.target);
    const sourcePath = task.sourcePath ? resolveWorkspaceArtifactPath(workspaceRoot, task.sourcePath) : targetPath;
    const authoredSource = await fs.readFile(sourcePath, 'utf8').catch(async (error: unknown) => {
      if (error instanceof Error && 'code' in error && (error as { code?: string }).code === 'ENOENT') {
        const synthesizedSource = synthesizeSlotSource(envelope);
        await fs.mkdir(path.dirname(sourcePath), { recursive: true });
        await fs.writeFile(sourcePath, synthesizedSource, 'utf8');
        return synthesizedSource;
      }
      throw error;
    });
    const runtimeSource = task.sourcePath ? rebaseRelativeImports(authoredSource, task.sourcePath, toProjectRuntimePath(task.target)) : authoredSource;
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, runtimeSource, 'utf8');
    task.status = 'filled';
  }

  await applyOverrides(workspaceRoot, 'adapt');

  lock.passStatus.adapt = 'succeeded';
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  return lock;
}
