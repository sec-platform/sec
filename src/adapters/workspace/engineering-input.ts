import path from 'node:path';

import type { LockFile, ManifestEntry, PlanFile } from '../../compiler/contract.ts';
import { CompilerError } from '../../compiler/errors.ts';
import type { BuildEngineeringIRInput } from '../../compiler/ir/build-engineering-ir.ts';
import { prepareManifestResolution } from '../../compiler/resolve/resolve-plan.ts';
import { canonicalEquals, uniqueSorted } from '../../contracts/canonical.ts';
import { posixPath } from '../../contracts/relative-path.ts';
import type { SemanticGeneratorDeclaration } from '../../semantics/generation/types.ts';
import type { SemanticMutationLoadedSourceCandidate } from '../../semantics/mutation/types.ts';
import { buildSemanticContractSourceCandidate } from "../../semantics/provenance/source-candidate.ts";
import { getWorkspacePaths } from "../workspace-context.ts";
import { readLockFile } from "./lock.ts";
import { loadAuthoringSemanticContractSources } from "./sources/load-authoring-semantic-contracts.ts";
import { loadManifestForResolvedBlock } from './sources/load-manifest.ts';
import { loadPlan } from './sources/load-plan.ts';
import { loadPolicyDeclarations } from './sources/load-policy-declarations.ts';
import { loadSemanticContractsForManifestEntry } from './sources/load-semantic-contract.ts';

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

function assertPlanLockSelectionCompatible(plan: PlanFile, lock: LockFile): void {
  const incompatible = (detail: string): never => {
    throw new CompilerError('WORKSPACE-INPUT-001', `Workspace Plan/Lock selection is inconsistent: ${detail}`);
  };
  if (plan.app.id !== lock.app.id || plan.app.name !== lock.app.name
      || plan.app.stack !== lock.app.stack || plan.app.mode !== lock.app.mode) {
    incompatible('app identity or target changed');
  }
  if (!canonicalEquals(uniqueSorted(plan.acceptance.map((item) => item.id)), lock.acceptancePlan)) {
    incompatible('acceptance plan changed');
  }
  const resolvedById = new Map(lock.resolvedBlocks.map((block) => [block.id, block] as const));
  for (const selected of plan.blocks) {
    const resolved = resolvedById.get(selected.id);
    if (!resolved || (selected.version !== undefined && selected.version !== resolved.version)) {
      incompatible(`selected block ${selected.id} is absent or has a different version`);
    }
  }
  const sourcesById = new Map(plan.registry.sources.map((source) => [source.id, source] as const));
  for (const resolved of lock.resolvedBlocks) {
    const source = sourcesById.get(resolved.registrySourceId);
    if (!source || source.kind !== resolved.registryKind
        || source.location !== resolved.registryLocation || source.path !== resolved.registryPath) {
      incompatible(`resolved block ${resolved.id} has a stale registry source`);
    }
  }
}

async function captureWorkspaceEngineeringIRBuildInput(
  workspaceRoot: string
): Promise<WorkspaceEngineeringIRBuildInput & { plan: PlanFile }> {
  workspaceRoot = path.resolve(workspaceRoot);
  const { workspaceConfigPath } = getWorkspacePaths(workspaceRoot);
  const plan = await loadPlan(workspaceConfigPath);
  const lock = readLockFile(workspaceRoot);
  assertPlanLockSelectionCompatible(plan, lock);
  const manifestEntries = await Promise.all(
    lock.resolvedBlocks.map((block) => loadManifestForResolvedBlock(workspaceRoot, block))
  );
  const entriesById = new Map(manifestEntries.map((entry) => [entry.manifest.id, entry] as const));
  const explicitEntries = plan.blocks.map((block) => entriesById.get(block.id)!);
  const resolvedSelection = prepareManifestResolution(workspaceRoot, explicitEntries, manifestEntries);
  // A cloned workspace may retain the producer's workspace-relative manifestPath;
  // the loader validates the current registry source instead of consuming that field.
  const comparableBlocks = (blocks: LockFile['resolvedBlocks']) => blocks.map(
    ({ manifestPath: _manifestPath, ...identity }) => identity
  );
  if (!canonicalEquals(comparableBlocks(resolvedSelection.resolvedBlocks), comparableBlocks(lock.resolvedBlocks))
      || !canonicalEquals(resolvedSelection.resolvedCapabilities, lock.resolvedCapabilities)) {
    throw new CompilerError('WORKSPACE-INPUT-001',
      'Workspace Plan/Lock selection is inconsistent: resolved block closure changed');
  }

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
    plan,
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

/** A workspace is mutable while asynchronous source reads are in flight. Both
 * observations must agree before any consumer can use a composed Plan/Lock,
 * manifest, Policy and semantic-contract input. This is a stability check,
 * not a claim that an uncooperative external writer cannot perform ABA. */
export async function loadWorkspaceEngineeringIRBuildInput(
  workspaceRoot: string
): Promise<WorkspaceEngineeringIRBuildInput> {
  const first = await captureWorkspaceEngineeringIRBuildInput(workspaceRoot);
  const second = await captureWorkspaceEngineeringIRBuildInput(workspaceRoot);
  if (!canonicalEquals(first, second)) {
    throw new CompilerError('WORKSPACE-INPUT-001',
      'Workspace engineering input changed during source capture');
  }
  const { plan: _plan, ...input } = first;
  return input;
}
