import fs from 'node:fs/promises';
import path from 'node:path';
import { getWorkspacePaths } from '../../shared/paths.ts';
import { CompilerError } from '../../shared/errors.ts';
import { buildTaskEnvelope } from './build-task-envelope.ts';
import { synthesizeSlotSource } from './mock-slot-synthesizer.ts';
import type { LockFile, PlanFile } from '../../shared/types.ts';

export async function adaptProject(workspaceRoot: string, plan: PlanFile, lock: LockFile): Promise<LockFile> {
  const { projectRoot, lockPath } = getWorkspacePaths(workspaceRoot);

  if (lock.passStatus.compose !== 'succeeded') {
    throw new CompilerError('SLOT-WRITE-003', 'compose must succeed before adapt');
  }

  for (const task of lock.slotTasks) {
    if (task.status !== 'generated' && task.status !== 'pending') {
      continue;
    }
    const envelope = buildTaskEnvelope(plan, lock, task);
    const targetPath = path.join(projectRoot, task.target);
    const source = synthesizeSlotSource(envelope);
    await fs.writeFile(targetPath, source, 'utf8');
    task.status = 'filled';
  }

  lock.passStatus.adapt = 'succeeded';
  await fs.writeFile(lockPath, `${JSON.stringify(lock, null, 2)}\n`, 'utf8');
  return lock;
}
