import path from 'node:path';
import { addBlockToPlan } from '../../application/add-block.ts';
import { createWorkspaceWriteCommitFence, withWorkspaceWriteLease, type WorkspaceWriteLeaseToken } from '../../adapters/filesystem/write-lease.ts';
import { getWorkspacePaths } from "../../adapters/workspace-context.ts";
import { writeYaml } from '../../adapters/workspace/yaml.ts';
import { alignInterfaces } from '../../compiler/align/align-interfaces.ts';
import type { LockFile, ManifestEntry, PlanFile } from '../../compiler/contract.ts';
import { saveLock } from "../../adapters/workspace/lock.ts";
import { loadManifestById } from '../../adapters/workspace/sources/load-manifest.ts';
import { loadPlan } from '../../adapters/workspace/sources/load-plan.ts';
import { executePipelineStage, runPipelinePass } from '../../adapters/compilation/pipeline/kernel.ts';
import type { PipelineExecutionContext } from '../../adapters/compilation-protocol/types.ts';
import { captureManifestSelection, resolveCapturedManifestSelection } from '../../adapters/workspace/resolve-graph.ts';
import { validateResolvedTemplates } from '../../adapters/verification/validate-resolved-templates.ts';

export async function addBlock(
  workspaceRoot = process.cwd(),
  blockId: string,
  workspaceWriteLease?: WorkspaceWriteLeaseToken
): Promise<{
  readonly plan: PlanFile;
  readonly changed: boolean;
  readonly selectedBlock: {
    readonly id: string;
    readonly version: string;
    readonly registrySourceId: string;
    readonly registryKind: ManifestEntry['registryKind'];
  };
}> {
  workspaceRoot = path.resolve(workspaceRoot);
  return withWorkspaceWriteLease(workspaceRoot, workspaceWriteLease, async (token) => {
    const { workspaceConfigPath } = getWorkspacePaths(workspaceRoot);
    return addBlockToPlan(blockId, {
      readPlan: () => loadPlan(workspaceConfigPath),
      selectManifest: ({ blockId: id, version, registrySources }) =>
        loadManifestById(id, { workspaceRoot, version, registrySources }),
      writePlan: (plan) => writeYaml(
        workspaceConfigPath, plan, createWorkspaceWriteCommitFence(workspaceRoot, token)
      )
    });
  });
}

async function resolveWorkspaceCore(
  workspaceRoot: string,
  context: PipelineExecutionContext
): Promise<{ plan: PlanFile; lock: LockFile }> {
  const commitFence = createWorkspaceWriteCommitFence(workspaceRoot, context.workspaceWriteLease);
  const { workspaceConfigPath } = getWorkspacePaths(workspaceRoot);
  const { plan, selection } = await runPipelinePass('parse', async () => {
    const plan = await loadPlan(workspaceConfigPath);
    return { plan, selection: captureManifestSelection(workspaceRoot, plan) };
  });
  const manifestMap = new Map(selection.explicitEntries.map(entry => [entry.manifest.id, entry]));
  await runPipelinePass('align', () => alignInterfaces(plan, manifestMap));
  const lock = await runPipelinePass('resolve', async () => {
    const resolved = await resolveCapturedManifestSelection(selection);
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
  workspaceRoot = path.resolve(workspaceRoot);
  return executePipelineStage(
    workspaceRoot,
    'resolve',
    context,
    (stageContext) => resolveWorkspaceCore(workspaceRoot, stageContext),
    { extractLock: (result) => result.lock }
  );
}
