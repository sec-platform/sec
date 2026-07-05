import {
  alignInterfaces,
  loadManifestById,
  loadManifestForResolvedBlock,
  loadPlan,
  loadSemanticContractsForManifestEntry,
  resolveGraph,
  validateResolvedTemplates
} from '../compiler/index.ts';
import { buildSemanticGeneratorPlan } from '../compiler/semantic-plan.ts';
import { saveLock } from '../shared/lock-utils.ts';
import { getWorkspacePaths } from '../shared/paths.ts';
import type { ManifestEntry } from '../shared/plan-manifest-types.ts';
import type { LockFile, PlanFile } from '../shared/types.ts';
import { writeYaml } from '../shared/yaml.ts';

export async function addBlock(workspaceRoot = process.cwd(), blockId: string): Promise<PlanFile> {
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
  await writeYaml(planPath, plan);
  return plan;
}

async function buildSemanticLoweringPlan(workspaceRoot: string, lock: LockFile): Promise<LockFile['semanticLoweringTasks']> {
  const manifestEntries = await Promise.all(
    lock.resolvedBlocks.map((block) => loadManifestForResolvedBlock(workspaceRoot, block))
  );
  const contracts = (await Promise.all(
    manifestEntries.map((entry) => loadSemanticContractsForManifestEntry(entry))
  )).flat();
  return buildSemanticGeneratorPlan(manifestEntries, contracts);
}

export async function resolveWorkspace(
  workspaceRoot = process.cwd()
): Promise<{ plan: PlanFile; lock: LockFile }> {
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
  lock.semanticLoweringTasks = await buildSemanticLoweringPlan(workspaceRoot, lock);
  await validateResolvedTemplates(workspaceRoot, lock);
  await saveLock(workspaceRoot, lock);
  return { plan, lock };
}
