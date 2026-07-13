import path from 'node:path';

import { readLockFile } from '../../shared/lock-utils.ts';
import { getWorkspacePaths, posixPath } from '../../shared/paths.ts';
import type { ManifestEntry } from '../../shared/plan-manifest-types.ts';
import type { SemanticGeneratorDeclaration } from '../../shared/semantic-generator-types.ts';
import type { SemanticMutationLoadedSourceCandidateV1 } from '../../shared/semantic-mutation-types.ts';
import {
  buildSemanticContractSourceCandidate,
  loadAuthoringSemanticContractSources
} from '../parse/load-authoring-semantic-contracts.ts';
import { loadManifestForResolvedBlock } from '../parse/load-manifest.ts';
import { loadPlan } from '../parse/load-plan.ts';
import { loadPolicyDeclarations } from '../parse/load-policy-declarations.ts';
import { loadSemanticContractsForManifestEntry } from '../parse/load-semantic-contract.ts';
import type { BuildEngineeringIRInput } from './build-engineering-ir.ts';

function stableManifestPath(entry: ManifestEntry): string {
  const relativePath = posixPath(path.relative(entry.registryRoot, entry.manifestPath));
  return posixPath(path.posix.join(posixPath(entry.registryPath), relativePath));
}

export interface WorkspaceEngineeringIRBuildInput {
  engineeringIRInput: BuildEngineeringIRInput;
  generatorDeclarations: SemanticGeneratorDeclaration[];
  semanticContractSources: SemanticMutationLoadedSourceCandidateV1[];
}

export async function loadWorkspaceEngineeringIRBuildInput(
  workspaceRoot: string
): Promise<WorkspaceEngineeringIRBuildInput> {
  const { planPath } = getWorkspacePaths(workspaceRoot);
  const plan = await loadPlan(planPath);
  const lock = await readLockFile(workspaceRoot);
  const manifestEntries = await Promise.all(
    lock.resolvedBlocks.map((block) => loadManifestForResolvedBlock(workspaceRoot, block))
  );
  const [registryContractGroups, authoringContractSources, policyDeclarations] = await Promise.all([
    Promise.all(
      manifestEntries.map((entry) => loadSemanticContractsForManifestEntry(entry))
    ),
    loadAuthoringSemanticContractSources(
      workspaceRoot,
      new Set(lock.resolvedBlocks.map((block) => block.id))
    ),
    loadPolicyDeclarations(workspaceRoot)
  ]);
  const registryContractSources = registryContractGroups.flatMap((contracts, index) => {
    const entry = manifestEntries[index]!;
    const sourceKind = entry.registryLocation === 'compiler' ? 'compiler-registry' : 'workspace-registry';
    return contracts.map((contract) => buildSemanticContractSourceCandidate(sourceKind, contract));
  });
  const semanticContractSources = [...registryContractSources, ...authoringContractSources];
  const semanticContracts = semanticContractSources.map((source) => source.loadedContract);

  return {
    engineeringIRInput: {
      app: { id: plan.app.id, name: plan.app.name },
      resolvedBlocks: lock.resolvedBlocks,
      manifests: manifestEntries.map((entry) => ({
        blockId: entry.manifest.id,
        manifestPath: stableManifestPath(entry),
        manifest: {
          requires: entry.manifest.requires,
          provides: entry.manifest.provides,
          pins: entry.manifest.pins,
          generators: entry.manifest.generators
        }
      })),
      slotTasks: lock.slotTasks,
      acceptanceIds: plan.acceptance.map((acceptance) => acceptance.id),
      policyDeclarations: policyDeclarations.policies,
      semanticContracts
    },
    semanticContractSources,
    generatorDeclarations: manifestEntries.flatMap((entry) =>
      entry.manifest.generators.map((declaration) => ({
        blockId: entry.manifest.id,
        manifestPath: stableManifestPath(entry),
        declaration: structuredClone(declaration),
        registrySourceId: entry.registrySourceId,
        registryKind: entry.registryKind,
        registryLocation: entry.registryLocation,
        registryPath: entry.registryPath
      }))
    )
  };
}
