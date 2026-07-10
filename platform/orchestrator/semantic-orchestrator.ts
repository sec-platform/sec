import path from 'node:path';

import {
  buildEngineeringIR,
  loadPlan
} from '../compiler/index.ts';
import type { EngineeringIR } from '../shared/engineering-ir-types.ts';
import { pathExists, readJson } from '../shared/fs.ts';
import { readLockFile } from '../shared/lock-utils.ts';
import { getWorkspacePaths, posixPath, resolveWorkspaceProvenancePath } from '../shared/paths.ts';
import type { ManifestEntry } from '../shared/plan-manifest-types.ts';
import type { PolicyReport } from '../shared/policy-types.ts';
import type { ProvenanceFile } from '../shared/provenance-types.ts';
import { loadWorkspaceSemanticInputs } from './semantic-inputs.ts';

function stableManifestPath(entry: ManifestEntry): string {
  const relativePath = posixPath(path.relative(entry.registryRoot, entry.manifestPath));
  return posixPath(path.posix.join(posixPath(entry.registryPath), relativePath));
}

async function readProvenanceArtifacts(workspaceRoot: string): Promise<ProvenanceFile['artifacts']> {
  const provenancePath = await resolveWorkspaceProvenancePath(workspaceRoot);
  if (!(await pathExists(provenancePath))) return [];
  return (await readJson<ProvenanceFile>(provenancePath)).artifacts;
}

async function readPolicyIds(workspaceRoot: string): Promise<string[]> {
  const { policyReportPath } = getWorkspacePaths(workspaceRoot);
  if (!(await pathExists(policyReportPath))) return [];
  const report = await readJson<PolicyReport>(policyReportPath);
  return report.merged.policies.map((policy) => policy.id);
}

export async function buildWorkspaceEngineeringIR(workspaceRoot = process.cwd()): Promise<EngineeringIR> {
  const { planPath } = getWorkspacePaths(workspaceRoot);
  const plan = await loadPlan(planPath);
  const lock = await readLockFile(workspaceRoot);
  const { manifestEntries, semanticContracts } = await loadWorkspaceSemanticInputs(
    workspaceRoot,
    lock.resolvedBlocks
  );

  return buildEngineeringIR({
    app: { name: plan.app.name },
    resolvedBlocks: lock.resolvedBlocks,
    manifests: manifestEntries.map((entry) => ({
      blockId: entry.manifest.id,
      manifestPath: stableManifestPath(entry),
      manifest: entry.manifest
    })),
    slotTasks: lock.slotTasks,
    acceptanceIds: plan.acceptance.map((acceptance) => acceptance.id),
    policyIds: await readPolicyIds(workspaceRoot),
    provenanceArtifacts: await readProvenanceArtifacts(workspaceRoot),
    semanticContracts
  });
}
