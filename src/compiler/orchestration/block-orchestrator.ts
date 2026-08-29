import { alignInterfaces } from '../align/align-interfaces.ts';
import { loadManifestById } from '../parse/load-manifest.ts';
import { loadPlan } from '../parse/load-plan.ts';
import { resolveGraph } from '../resolve/resolve-graph.ts';
import { validateResolvedTemplates } from '../verify/validate-resolved-templates.ts';
import { saveLock } from '../lock.ts';
import { getWorkspacePaths } from '../../workspace/paths.ts';
import { executePipelineStage, runPipelinePass } from '../pipeline/kernel.ts';
import type { PipelineExecutionContext } from '../pipeline/types.ts';
import type { ManifestEntry } from '../contract.ts';
import type {
  LockFile,
  PlanFile
} from '../contract.ts';
import { createWorkspaceWriteCommitFence, withWorkspaceWriteLease, type WorkspaceWriteLeaseToken } from '../../workspace/lease.ts';
import { writeYaml } from '../../workspace/yaml.ts';

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
  const { plan, manifestMap } = await runPipelinePass('parse', async () => {
    const parsedPlan = await loadPlan(planPath);
    const parsedManifests = new Map<string, ManifestEntry>();
    for (const block of parsedPlan.blocks) {
      parsedManifests.set(
        block.id,
        await loadManifestById(block.id, {
          workspaceRoot,
          version: block.version,
          registrySources: parsedPlan.registry.sources
        })
      );
    }
    return { plan: parsedPlan, manifestMap: parsedManifests };
  });
  await runPipelinePass('align', () => alignInterfaces(plan, manifestMap));
  const lock = await runPipelinePass('resolve', async () => {
    const resolved = await resolveGraph(workspaceRoot, plan);
    await validateResolvedTemplates(workspaceRoot, resolved, commitFence);
    await saveLock(workspaceRoot, resolved, commitFence);
    return resolved;
  });
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
