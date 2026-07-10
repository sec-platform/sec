import path from 'node:path';

import {
  buildEngineeringIR,
  loadPlan,
  loadPolicyDeclarations
} from '../compiler/index.ts';
import type { EngineeringIR } from '../shared/engineering-ir-types.ts';
import { readLockFile } from '../shared/lock-utils.ts';
import { getWorkspacePaths, posixPath } from '../shared/paths.ts';
import type { ManifestEntry } from '../shared/plan-manifest-types.ts';
import { loadWorkspaceSemanticInputs } from './semantic-inputs.ts';

function stableManifestPath(entry: ManifestEntry): string {
  const relativePath = posixPath(path.relative(entry.registryRoot, entry.manifestPath));
  return posixPath(path.posix.join(posixPath(entry.registryPath), relativePath));
}

export async function buildWorkspaceEngineeringIR(workspaceRoot = process.cwd()): Promise<EngineeringIR> {
  const { planPath } = getWorkspacePaths(workspaceRoot);
  const plan = await loadPlan(planPath);
  const lock = await readLockFile(workspaceRoot);
  const [{ manifestEntries, semanticContracts }, policyDeclarations] = await Promise.all([
    loadWorkspaceSemanticInputs(workspaceRoot, lock.resolvedBlocks),
    loadPolicyDeclarations(workspaceRoot)
  ]);

  return buildEngineeringIR({
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
  });
}
