import path from 'node:path';

import type { SemanticGeneratorDeclaration } from '../../semantics/generation/types.ts';
import type { SemanticMutationLoadedSourceCandidate } from '../../semantics/mutation/types.ts';
import { getWorkspacePaths } from "../workspace-context.ts";
import { posixPath } from '../../contracts/relative-path.ts';
import type { LockFile, ManifestEntry } from '../../compiler/contract.ts';
import { readLockFile } from "./lock.ts";
import { buildSemanticContractSourceCandidate } from "../../semantics/provenance/source-candidate.ts";
import { loadAuthoringSemanticContractSources } from "./sources/load-authoring-semantic-contracts.ts";
import { loadManifestForResolvedBlock } from './sources/load-manifest.ts';
import { loadPlan } from './sources/load-plan.ts';
import { loadPolicyDeclarations } from './sources/load-policy-declarations.ts';
import { loadSemanticContractsForManifestEntry } from './sources/load-semantic-contract.ts';
import type { BuildEngineeringIRInput } from '../../compiler/ir/build-engineering-ir.ts';

function stableManifestPath(entry: ManifestEntry): string {
  const relativePath = posixPath(path.relative(entry.registryRoot, entry.manifestPath));
  return posixPath(path.posix.join(posixPath(entry.registryPath), relativePath));
}

export interface WorkspaceEngineeringIRBuildInput {
  engineeringIRInput: BuildEngineeringIRInput;
  generatorDeclarations: SemanticGeneratorDeclaration[];
  semanticContractSources: SemanticMutationLoadedSourceCandidate[];
  /** Exact in-memory Lock object consumed to derive this build input. */
  sourceLock: LockFile;
}

export async function loadWorkspaceEngineeringIRBuildInput(
  workspaceRoot: string
): Promise<WorkspaceEngineeringIRBuildInput> {
  workspaceRoot = path.resolve(workspaceRoot);
  const { workspaceConfigPath } = getWorkspacePaths(workspaceRoot);
  const plan = await loadPlan(workspaceConfigPath);
  const lock = readLockFile(workspaceRoot);
  const manifestEntries = await Promise.all(
    lock.resolvedBlocks.map((block) => loadManifestForResolvedBlock(workspaceRoot, block))
  );

  // Start only genuinely asynchronous reads before the synchronous retained
  // Policy observation. Promise-wrapping the Policy loader would not create
  // filesystem concurrency and would misrepresent the execution model.
  const registryContractGroupsPromise = Promise.all(
    manifestEntries.map((entry) => loadSemanticContractsForManifestEntry(entry))
  );
  const authoringContractSourcesPromise = loadAuthoringSemanticContractSources(
    workspaceRoot,
    new Set(lock.resolvedBlocks.map((block) => block.id))
  );
  const policyDeclarations = loadPolicyDeclarations(workspaceRoot);
  const [registryContractGroups, authoringContractSources] = await Promise.all([
    registryContractGroupsPromise,
    authoringContractSourcesPromise
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
    ),
    sourceLock: lock
  };
}
