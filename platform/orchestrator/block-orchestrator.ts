import { loadManifestById } from '../compiler/parse/load-manifest.ts';
import { loadPlan } from '../compiler/parse/load-plan.ts';
import { getWorkspacePaths } from '../shared/paths.ts';
import { writeYaml } from '../shared/yaml.ts';
import { writeJson } from '../shared/fs.ts';
import { alignInterfaces } from '../compiler/align/align-interfaces.ts';
import { resolveGraph } from '../compiler/resolve/resolve-graph.ts';
import { validateResolvedTemplates } from '../compiler/verify/validate-resolved-templates.ts';
import type { LockFile, PlanFile } from '../shared/types.ts';
import type { ManifestEntry } from '../shared/plan-manifest-types.ts';

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

export async function resolveWorkspace(
  workspaceRoot = process.cwd()
): Promise<{ plan: PlanFile; lock: LockFile }> {
  const { lockPath, planPath } = getWorkspacePaths(workspaceRoot);
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
  await validateResolvedTemplates(workspaceRoot, lock);
  await writeJson(lockPath, lock);
  return { plan, lock };
}
