import { alignInterfaces, loadManifestById, loadPlan, resolveGraph, validateResolvedTemplates } from '../compiler/index.ts';
import { saveLock } from '../shared/lock-utils.ts';
import { getWorkspacePaths } from '../shared/paths.ts';
import { executePipelineStage } from '../shared/pipeline-kernel.ts';
import type { PipelineExecutionContext } from '../shared/pipeline-types.ts';
import type { ManifestEntry } from '../shared/plan-manifest-types.ts';
import type { LockFile, PlanFile } from '../shared/types.ts';
import {
  createWorkspaceWriteCommitFence,
  withWorkspaceWriteLease,
  type WorkspaceWriteLeaseToken
} from '../shared/workspace-write-lease.ts';
import { writeYaml } from '../shared/yaml.ts';

export async function addBlock(
  workspaceRoot = process.cwd(),
  blockId: string,
  workspaceWriteLease?: WorkspaceWriteLeaseToken
): Promise<PlanFile> {
  return withWorkspaceWriteLease(workspaceRoot, workspaceWriteLease, async (token) => {
    const { planPath } = getWorkspacePaths(workspaceRoot);
    const plan = await loadPlan(planPath);
    if (plan.blocks.some((entry) => entry.id === blockId)) {
      return plan;
    }
    const manifestEntry = await loadManifestById(blockId, {
      workspaceRoot,
      registrySources: plan.registry.sources
    });
    plan.blocks.push({ id: blockId, version: manifestEntry.manifest.version });
    const declaredAcceptanceIds = new Set(plan.acceptance.map((entry) => entry.id));
    for (const acceptance of manifestEntry.manifest.acceptance) {
      if (!declaredAcceptanceIds.has(acceptance.id)) {
        plan.acceptance.push({ id: acceptance.id });
        declaredAcceptanceIds.add(acceptance.id);
      }
    }
    const commitFence = createWorkspaceWriteCommitFence(workspaceRoot, token);
    await writeYaml(planPath, plan, commitFence);
    return plan;
  });
}

async function resolveWorkspaceCore(
  workspaceRoot: string,
  context: PipelineExecutionContext
): Promise<{ plan: PlanFile; lock: LockFile }> {
  const commitFence = createWorkspaceWriteCommitFence(workspaceRoot, context.workspaceWriteLease);
  const { planPath } = getWorkspacePaths(workspaceRoot);
  const plan = await loadPlan(planPath);
  const manifestMap = new Map<string, ManifestEntry>();
  for (const block of plan.blocks) {
    manifestMap.set(
      block.id,
      await loadManifestById(block.id, {
        workspaceRoot,
        version: block.version,
        registrySources: plan.registry.sources
      })
    );
  }
  alignInterfaces(plan, manifestMap);
  const lock = await resolveGraph(workspaceRoot, plan);
  await validateResolvedTemplates(workspaceRoot, lock, commitFence);
  await saveLock(workspaceRoot, lock, commitFence);
  return { plan, lock };
}

export async function resolveWorkspace(
  workspaceRoot = process.cwd(),
  context?: PipelineExecutionContext
): Promise<{ plan: PlanFile; lock: LockFile }> {
  return executePipelineStage(
    workspaceRoot,
    'resolve',
    context,
    (stageContext) => resolveWorkspaceCore(workspaceRoot, stageContext),
    { extractLock: (result) => result.lock }
  );
}
