import path from 'node:path';

import {
  buildEngineeringIR,
  buildValidatedEngineeringIR,
  loadPlan,
  loadPolicyDeclarations,
  type BuildEngineeringIRInput
} from '../compiler/index.ts';
import type {
  EngineeringIR,
  ValidatedEngineeringIRSnapshot
} from '../shared/engineering-ir-types.ts';
import { readLockFile } from '../shared/lock-utils.ts';
import { getWorkspacePaths, posixPath } from '../shared/paths.ts';
import { executePipelineStage } from '../shared/pipeline-kernel.ts';
import { bindPipelineSemanticContext } from '../shared/pipeline-semantic-context.ts';
import type {
  PipelineExecutionContext,
  PipelineSemanticContext
} from '../shared/pipeline-types.ts';
import type { ManifestEntry } from '../shared/plan-manifest-types.ts';
import { loadWorkspaceSemanticInputs } from './semantic-inputs.ts';

function stableManifestPath(entry: ManifestEntry): string {
  const relativePath = posixPath(path.relative(entry.registryRoot, entry.manifestPath));
  return posixPath(path.posix.join(posixPath(entry.registryPath), relativePath));
}

async function loadWorkspaceEngineeringIRInput(
  workspaceRoot: string
): Promise<BuildEngineeringIRInput> {
  const { planPath } = getWorkspacePaths(workspaceRoot);
  const plan = await loadPlan(planPath);
  const lock = await readLockFile(workspaceRoot);
  const [{ manifestEntries, semanticContracts }, policyDeclarations] = await Promise.all([
    loadWorkspaceSemanticInputs(workspaceRoot, lock.resolvedBlocks),
    loadPolicyDeclarations(workspaceRoot)
  ]);

  return {
    app: { id: plan.app.id, name: plan.app.name },
    resolvedBlocks: lock.resolvedBlocks,
    manifests: manifestEntries.map((entry) => ({
      blockId: entry.manifest.id,
      manifestPath: stableManifestPath(entry),
      manifest: entry.manifest
    })),
    slotTasks: lock.slotTasks,
    acceptanceIds: plan.acceptance.map((acceptance) => acceptance.id),
    policyDeclarations: policyDeclarations.policies,
    semanticContracts
  };
}

export async function buildWorkspaceEngineeringIR(workspaceRoot = process.cwd()): Promise<EngineeringIR> {
  return buildEngineeringIR(await loadWorkspaceEngineeringIRInput(workspaceRoot));
}

async function buildWorkspaceValidatedEngineeringIR(
  workspaceRoot: string
): Promise<ValidatedEngineeringIRSnapshot> {
  return buildValidatedEngineeringIR(await loadWorkspaceEngineeringIRInput(workspaceRoot));
}

export async function runWorkspaceSemanticFrontend(
  workspaceRoot: string,
  context: PipelineExecutionContext
): Promise<PipelineSemanticContext> {
  return executePipelineStage(
    workspaceRoot,
    'semantic',
    context,
    async () => bindPipelineSemanticContext(
      context,
      await buildWorkspaceValidatedEngineeringIR(workspaceRoot)
    ),
    { extractLock: () => readLockFile(workspaceRoot) }
  );
}
