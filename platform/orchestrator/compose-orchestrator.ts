import { composeProject } from '../compiler/compose/compose-project.ts';
import { loadPlan } from '../compiler/parse/load-plan.ts';
import { adaptProject } from '../compiler/synthesize/adapt-project.ts';
import { CompilerError } from '../shared/errors.ts';
import { pathExists, readJson } from '../shared/fs.ts';
import { resolveWorkspaceLockPath, resolveWorkspacePlanPath } from '../shared/paths.ts';
import type { LockFile, PlanFile } from '../shared/types.ts';

export async function composeWorkspace(
  workspaceRoot = process.cwd()
): Promise<{ plan: PlanFile; lock: LockFile }> {
  const readableLockPath = await resolveWorkspaceLockPath(workspaceRoot);
  if (!(await pathExists(readableLockPath))) {
    throw new CompilerError('COMPOSE-BLOCKED-001', 'graph.lock.json is missing');
  }
  const plan = await loadPlan(await resolveWorkspacePlanPath(workspaceRoot));
  const lock = await readJson<LockFile>(readableLockPath);
  await composeProject(workspaceRoot, lock);
  return { plan, lock };
}

export async function adaptWorkspace(
  workspaceRoot = process.cwd()
): Promise<{ plan: PlanFile; lock: LockFile }> {
  const plan = await loadPlan(await resolveWorkspacePlanPath(workspaceRoot));
  const lock = await readJson<LockFile>(await resolveWorkspaceLockPath(workspaceRoot));
  await adaptProject(workspaceRoot, plan, lock);
  return { plan, lock };
}
