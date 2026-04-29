import path from 'node:path';
import { CI_ARTIFACT_FILES } from '../../shared/ci-artifact-contract.ts';
import { KIND_PRIORITY, PASS_STATUS_PENDING } from '../../shared/constants.ts';
import { CompilerError } from '../../shared/errors.ts';
import { loadAllManifests, loadManifestById } from '../parse/load-manifest.ts';
import type { LockFile, SlotTask } from '../../shared/lock-types.ts';
import type { ManifestEntry, PlanFile } from '../../shared/plan-manifest-types.ts';

function compareBlocks(left: ManifestEntry, right: ManifestEntry): number {
  const leftPriority = KIND_PRIORITY[left.manifest.kind] ?? 99;
  const rightPriority = KIND_PRIORITY[right.manifest.kind] ?? 99;
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }
  return left.manifest.id.localeCompare(right.manifest.id);
}

function buildCapabilityProviders(entries: ManifestEntry[]): Map<string, ManifestEntry[]> {
  const providers = new Map<string, ManifestEntry[]>();
  for (const entry of entries) {
    for (const capability of entry.manifest.provides) {
      const list = providers.get(capability) ?? [];
      list.push(entry);
      providers.set(capability, list);
    }
  }
  return providers;
}

function detectConflicts(entries: ManifestEntry[], capabilityProviders: Map<string, ManifestEntry[]>): void {
  const ids = new Set(entries.map((entry) => entry.manifest.id));
  for (const entry of entries) {
    for (const conflict of entry.manifest.conflicts) {
      if (ids.has(conflict)) {
        throw new CompilerError(
          'RESOLVE-CONFLICT-002',
          `Block "${entry.manifest.id}" conflicts with "${conflict}"`
        );
      }
        const providers = capabilityProviders.get(conflict);
        if (providers?.length) {
        throw new CompilerError(
          'RESOLVE-CONFLICT-003',
          `Block "${entry.manifest.id}" conflicts with provided capability "${conflict}"`
        );
      }
    }
  }
}

function topologicalSort(entries: ManifestEntry[], providerMap: Map<string, ManifestEntry[]>): ManifestEntry[] {
  const adjacency = new Map<string, Set<string>>(entries.map((entry) => [entry.manifest.id, new Set<string>()]));
  const indegree = new Map<string, number>(entries.map((entry) => [entry.manifest.id, 0]));

  for (const entry of entries) {
    for (const requirement of entry.manifest.requires) {
      const providers = providerMap.get(requirement) ?? [];
      for (const provider of providers) {
        if (provider.manifest.id === entry.manifest.id) {
          continue;
        }
        const providerAdjacency = adjacency.get(provider.manifest.id);
        if (!providerAdjacency) {
          throw new CompilerError('RESOLVE-INTERNAL-001', `Missing adjacency for "${provider.manifest.id}"`);
        }
        if (!providerAdjacency.has(entry.manifest.id)) {
          providerAdjacency.add(entry.manifest.id);
          indegree.set(entry.manifest.id, (indegree.get(entry.manifest.id) ?? 0) + 1);
        }
      }
    }
  }

  const queue: ManifestEntry[] = entries
    .filter((entry) => indegree.get(entry.manifest.id) === 0)
    .sort(compareBlocks);
  const result: ManifestEntry[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    result.push(current);
    const dependents = adjacency.get(current.manifest.id) ?? new Set<string>();
    for (const dependentId of [...dependents]) {
      indegree.set(dependentId, (indegree.get(dependentId) ?? 0) - 1);
      if (indegree.get(dependentId) === 0) {
        const dependent = entries.find((entry) => entry.manifest.id === dependentId);
        if (!dependent) {
          continue;
        }
        queue.push(dependent);
        queue.sort(compareBlocks);
      }
    }
  }

  if (result.length !== entries.length) {
    throw new CompilerError('RESOLVE-CYCLE-003', 'Dependency cycle detected');
  }

  return result;
}

function buildSlotTasks(plan: PlanFile, manifestMap: Map<string, ManifestEntry>): SlotTask[] {
  const explicitSlots = new Map(plan.slots.map((slot) => [`${slot.block}:${slot.id}`, slot] as const));
  const tasks: SlotTask[] = [];

  for (const entry of manifestMap.values()) {
    for (const manifestSlot of entry.manifest.slots) {
      if (!manifestSlot.writableZones) {
        throw new CompilerError('ALIGN-SLOT-005', `Slot "${manifestSlot.id}" is missing writableZones`);
      }
      const explicitSlot = explicitSlots.get(`${entry.manifest.id}:${manifestSlot.id}`);
      tasks.push({
        id: manifestSlot.id,
        block: entry.manifest.id,
        target: explicitSlot?.target ?? manifestSlot.target,
        ...(explicitSlot?.sourcePath ? { sourcePath: explicitSlot.sourcePath } : {}),
        symbol: explicitSlot?.symbol ?? manifestSlot.symbol,
        kind: explicitSlot?.kind ?? manifestSlot.kind,
        inputType: manifestSlot.inputType,
        outputType: manifestSlot.outputType,
        status: 'pending',
        writableZones: explicitSlot?.sourcePath ? [explicitSlot.sourcePath, ...manifestSlot.writableZones] : manifestSlot.writableZones,
        provenanceHints: {
          generator: explicitSlot ? 'mock-local-synthesizer' : null,
          verifiedBy: []
        }
      });
    }
  }

  return tasks;
}

export async function resolveGraph(workspaceRoot: string, plan: PlanFile): Promise<LockFile> {
  const explicitEntries: ManifestEntry[] = [];
  for (const block of plan.blocks) {
    explicitEntries.push(
      await loadManifestById(block.id, {
        workspaceRoot,
        version: block.version,
        registrySources: plan.registry.sources
      })
    );
  }

  const allEntries = await loadAllManifests({
    workspaceRoot,
    registrySources: plan.registry.sources
  });
  const resolvedIds = new Set(explicitEntries.map((entry) => entry.manifest.id));
  const manifestMap = new Map<string, ManifestEntry>(explicitEntries.map((entry) => [entry.manifest.id, entry]));

  let changed = true;
  while (changed) {
    changed = false;
    const providerMap = buildCapabilityProviders([...manifestMap.values()]);

    for (const entry of [...manifestMap.values()]) {
      for (const requirement of entry.manifest.requires) {
        if (providerMap.has(requirement)) {
          continue;
        }
        const providers = allEntries.filter((candidate) => candidate.manifest.provides.includes(requirement));
        if (providers.length === 0) {
          throw new CompilerError('RESOLVE-MISSING-001', `Missing provider for capability "${requirement}"`);
        }
        if (providers.length > 1) {
          throw new CompilerError(
            'RESOLVE-CONFLICT-004',
            `Ambiguous providers for capability "${requirement}": ${providers.map((provider) => provider.manifest.id).join(', ')}`
          );
        }
        const provider = providers[0];
        if (!resolvedIds.has(provider.manifest.id)) {
          resolvedIds.add(provider.manifest.id);
          manifestMap.set(provider.manifest.id, provider);
          changed = true;
        }
      }
    }
  }

  const resolvedEntries = [...manifestMap.values()];
  const providerMap = buildCapabilityProviders(resolvedEntries);
  detectConflicts(resolvedEntries, providerMap);
  const sortedEntries = topologicalSort(resolvedEntries, providerMap);

  const resolvedBlocks = sortedEntries.map((entry, index) => ({
    id: entry.manifest.id,
    version: entry.manifest.version,
    kind: entry.manifest.kind,
    installOrder: index + 1,
    manifestPath: path.relative(entry.manifestRoot, entry.manifestPath).replaceAll('\\', '/'),
    registrySourceId: entry.registrySourceId,
    registryKind: entry.registryKind,
    registryLocation: entry.registryLocation,
    registryPath: entry.registryPath
  }));

  const installPlan: LockFile['installPlan'] = [];
  for (const block of sortedEntries) {
    for (const install of block.manifest.installs) {
      installPlan.push({
        stepId: `${block.manifest.id}:${installPlan.length + 1}`,
        blockId: block.manifest.id,
        registrySourceId: block.registrySourceId,
        registryKind: block.registryKind,
        registryLocation: block.registryLocation,
        registryPath: block.registryPath,
        sourceRoot: path.relative(block.registryRoot, block.manifestRoot).replaceAll('\\', '/'),
        action: install.kind,
        from: install.from,
        to: install.to
      });
    }
  }

  return {
    formatVersion: '1',
    app: {
      name: plan.app.name,
      stack: plan.app.stack,
      mode: plan.app.mode
    },
    resolvedBlocks,
    resolvedCapabilities: [...providerMap.keys()].sort(),
    installPlan,
    slotTasks: buildSlotTasks(plan, manifestMap),
    generatedPaths: [
      'generated/routes.ts',
      CI_ARTIFACT_FILES.blockUsageMap,
      CI_ARTIFACT_FILES.installManifest
    ],
    acceptancePlan: plan.acceptance.map((entry) => entry.id),
    passStatus: {
      ...PASS_STATUS_PENDING,
      parse: 'succeeded',
      align: 'succeeded',
      resolve: 'succeeded'
    }
  };
}
