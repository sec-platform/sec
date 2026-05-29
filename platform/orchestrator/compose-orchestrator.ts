import { composeProject } from '../compiler/compose/compose-project.ts';
import { loadWorkspacePlan } from '../compiler/parse/load-plan.ts';
import { adaptProject } from '../compiler/synthesize/adapt-project.ts';
import { CompilerError } from '../shared/errors.ts';
import { pathExists } from '../shared/fs.ts';
import { readLockFile } from '../shared/lock-utils.ts';
import { resolveWorkspaceLockPath } from '../shared/paths.ts';
import type { LockFile, PlanFile } from '../shared/types.ts';

export async function composeWorkspace(
  workspaceRoot = process.cwd(),
  options?: { lock?: boolean }
): Promise<{ plan: PlanFile; lock: LockFile }> {
  const readableLockPath = await resolveWorkspaceLockPath(workspaceRoot);
  if (!(await pathExists(readableLockPath))) {
    throw new CompilerError('COMPOSE-BLOCKED-001', 'graph.lock.json is missing');
  }
  const plan = await loadWorkspacePlan(workspaceRoot);
  const lock = await readLockFile(workspaceRoot);
  await composeProject(workspaceRoot, lock, { lockFiles: !!options?.lock });
  return { plan, lock };
}

export async function adaptWorkspace(
  workspaceRoot = process.cwd()
): Promise<{ plan: PlanFile; lock: LockFile }> {
  const plan = await loadWorkspacePlan(workspaceRoot);
  const lock = await readLockFile(workspaceRoot);
  await adaptProject(workspaceRoot, plan, lock);
  return { plan, lock };
}
