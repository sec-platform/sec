import { CI_ARTIFACT_FILES } from '../../shared/ci-artifact-contract.ts';
import { uniqueSorted } from '../../shared/collections.ts';
import { KIND_PRIORITY, PASS_STATUS_PENDING } from '../../shared/constants.ts';
import { CompilerError } from '../../shared/errors.ts';
import type { LockFile, SlotTask } from '../../shared/lock-types.ts';
import {
  isCanonicalPortableLogicalPathV1,
  portableLogicalPathCollisionKeyV1
} from '../../shared/logical-path-identity.ts';
import { relativePosixPath } from '../../shared/paths.ts';
import type { ManifestEntry, PlanFile } from '../../shared/plan-manifest-types.ts';
import { loadAllManifests, loadManifestById, resolveManifestResource } from '../parse/load-manifest.ts';

function buildCapabilityProviders(entries: readonly ManifestEntry[]): Map<string, ManifestEntry[]> {
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

function detectConflicts(entries: readonly ManifestEntry[], capabilityProviders: Map<string, ManifestEntry[]>): void {
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

function assertUniqueResolvedSlotIds(entries: readonly ManifestEntry[]): void {
  const ownerBySlotId = new Map<string, string>();
  for (const entry of entries) {
    for (const slot of entry.manifest.slots) {
      const previousOwner = ownerBySlotId.get(slot.id);
      if (previousOwner !== undefined && previousOwner !== entry.manifest.id) {
        throw new CompilerError(
          'RESOLVE-CONFLICT-005',
          `Resolved Slot id "${slot.id}" is declared by both "${previousOwner}" and "${entry.manifest.id}"`,
          { slotId: slot.id, blockIds: [previousOwner, entry.manifest.id].sort() }
        );
      }
      ownerBySlotId.set(slot.id, entry.manifest.id);
    }
  }
}

function topologicalSort(entries: readonly ManifestEntry[], providerMap: Map<string, ManifestEntry[]>): ManifestEntry[] {
  const adjacency = new Map<string, Set<string>>(entries.map((entry) => [entry.manifest.id, new Set<string>()]));
  const indegree = new Map<string, number>(entries.map((entry) => [entry.manifest.id, 0]));
  const entryMap = new Map<string, ManifestEntry>(entries.map((entry) => [entry.manifest.id, entry]));

  for (const entry of entries) {
    for (const requirement of entry.manifest.requires) {
      const providers = providerMap.get(requirement) ?? [];
      for (const provider of providers) {
        if (provider.manifest.id === entry.manifest.id) continue;
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

  type PriorityBucket = Map<string, ManifestEntry>;
  const buckets = new Map<number, PriorityBucket>();
  const bucketPriorities: number[] = [];
  let totalCount = 0;

  function bucketAdd(entry: ManifestEntry): void {
    const priority = KIND_PRIORITY[entry.manifest.kind] ?? 99;
    let bucket = buckets.get(priority);
    if (!bucket) {
      bucket = new Map();
      buckets.set(priority, bucket);
      bucketPriorities.push(priority);
      bucketPriorities.sort((a, b) => a - b);
    }
    bucket.set(entry.manifest.id, entry);
    totalCount += 1;
  }

  function bucketShift(): ManifestEntry | null {
    if (totalCount === 0) return null;
    for (const priority of bucketPriorities) {
      const bucket = buckets.get(priority);
      if (bucket && bucket.size > 0) {
        const sortedIds = [...bucket.keys()].sort();
        const firstId = sortedIds[0];
        const item = bucket.get(firstId)!;
        bucket.delete(firstId);
        totalCount -= 1;
        return item;
      }
    }
    return null;
  }

  for (const entry of entries) {
    if (indegree.get(entry.manifest.id) === 0) bucketAdd(entry);
  }

  const result: ManifestEntry[] = [];
  while (totalCount > 0) {
    const current = bucketShift();
    if (!current) break;
    result.push(current);
    const dependents = adjacency.get(current.manifest.id) ?? new Set<string>();
    for (const dependentId of dependents) {
      const newIndegree = (indegree.get(dependentId) ?? 0) - 1;
      indegree.set(dependentId, newIndegree);
      if (newIndegree === 0) {
        const dependent = entryMap.get(dependentId);
        if (dependent) bucketAdd(dependent);
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
      const target = explicitSlot?.target ?? manifestSlot.target;
      if (!isCanonicalPortableLogicalPathV1(target)) {
        throw new CompilerError(
          'ALIGN-SLOT-006',
          `Slot "${entry.manifest.id}:${manifestSlot.id}" target is not one canonical portable logical path`
        );
      }
      tasks.push({
        id: manifestSlot.id,
        block: entry.manifest.id,
        target,
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
        },
        ...(manifestSlot.exports ? { exports: manifestSlot.exports } : {}),
        ...(manifestSlot.mockTemplate ? { mockTemplate: manifestSlot.mockTemplate } : {})
      });
    }
  }

  const ownerByTarget = new Map<string, string>();
  for (const task of tasks) {
    const owner = `${task.block}:${task.id}`;
    const identity = portableLogicalPathCollisionKeyV1(task.target, 'Resolved Slot target');
    const previous = ownerByTarget.get(identity);
    if (previous !== undefined) {
      throw new CompilerError(
        'RESOLVE-CONFLICT-007',
        `Resolved Slot target "${task.target}" has multiple owners: "${previous}", "${owner}"`,
        { target: task.target, slotOwners: [previous, owner].sort() }
      );
    }
    ownerByTarget.set(identity, owner);
  }
  return tasks;
}

function assertInstallTargetOwnership(installPlan: readonly LockFile['installPlan'][number][]): void {
  const byTarget = new Map<string, LockFile['installPlan']>();
  for (const step of installPlan) {
    const identity = portableLogicalPathCollisionKeyV1(step.to, 'Install target');
    const group = byTarget.get(identity) ?? [];
    group.push(step);
    byTarget.set(identity, group);
  }
  for (const group of byTarget.values()) {
    if (group.length <= 1) continue;
    const target = group[0]!.to;
    if (group.every((step) => step.action === 'merge-prisma' && step.to === target)) continue;
    throw new CompilerError(
      'RESOLVE-CONFLICT-006',
      `Install target "${target}" has multiple owners without an explicit composition strategy`,
      {
        target,
        owners: group.map((step) => ({ blockId: step.blockId, action: step.action })).sort((left, right) =>
          `${left.blockId}:${left.action}`.localeCompare(`${right.blockId}:${right.action}`)
        )
      }
    );
  }
}

export async function resolveGraph(workspaceRoot: string, plan: PlanFile): Promise<LockFile> {
  const explicitEntries = await Promise.all(
    plan.blocks.map((block) =>
      loadManifestById(block.id, {
        workspaceRoot,
        version: block.version,
        registrySources: plan.registry.sources
      })
    )
  );

  const allEntries = await loadAllManifests({
    workspaceRoot,
    registrySources: plan.registry.sources
  });
  const allProviderMap = buildCapabilityProviders(allEntries);
  const manifestMap = new Map<string, ManifestEntry>(explicitEntries.map((entry) => [entry.manifest.id, entry]));
  const selectedCapabilities = new Set(explicitEntries.flatMap((entry) => entry.manifest.provides));
  const closureQueue = [...explicitEntries];

  for (let index = 0; index < closureQueue.length; index += 1) {
    const entry = closureQueue[index]!;
    for (const requirement of entry.manifest.requires) {
      if (selectedCapabilities.has(requirement)) continue;
      const providers = allProviderMap.get(requirement) ?? [];
      if (providers.length === 0) {
        throw new CompilerError('RESOLVE-MISSING-001', `Missing provider for capability "${requirement}"`);
      }
      if (providers.length > 1) {
        throw new CompilerError(
          'RESOLVE-CONFLICT-004',
          `Ambiguous providers for capability "${requirement}": ${providers.map((provider) => provider.manifest.id).join(', ')}`
        );
      }
      const provider = providers[0]!;
      if (!manifestMap.has(provider.manifest.id)) {
        manifestMap.set(provider.manifest.id, provider);
        closureQueue.push(provider);
        for (const capability of provider.manifest.provides) selectedCapabilities.add(capability);
      }
    }
  }

  const resolvedEntries = [...manifestMap.values()];
  assertUniqueResolvedSlotIds(resolvedEntries);
  const providerMap = buildCapabilityProviders(resolvedEntries);
  detectConflicts(resolvedEntries, providerMap);
  const sortedEntries = topologicalSort(resolvedEntries, providerMap);

  const resolvedBlocks = sortedEntries.map((entry, index) => ({
    id: entry.manifest.id,
    version: entry.manifest.version,
    kind: entry.manifest.kind,
    installOrder: index + 1,
    manifestPath: relativePosixPath(workspaceRoot, entry.manifestPath),
    registrySourceId: entry.registrySourceId,
    registryKind: entry.registryKind,
    registryLocation: entry.registryLocation,
    registryPath: entry.registryPath
  }));

  const installDescriptors = sortedEntries.flatMap((block) =>
    block.manifest.installs.map((install) => ({ block, install }))
  );
  const installPlan: LockFile['installPlan'] = await Promise.all(
    installDescriptors.map(async ({ block, install }, index) => {
      const resource = await resolveManifestResource(block, install.from);
      return {
        stepId: `${block.manifest.id}:${index + 1}`,
        blockId: block.manifest.id,
        registrySourceId: block.registrySourceId,
        registryKind: block.registryKind,
        registryLocation: block.registryLocation,
        registryPath: block.registryPath,
        sourceRoot: relativePosixPath(block.registryRoot, resource.root),
        action: install.kind,
        from: install.from,
        to: install.to
      };
    })
  );
  assertInstallTargetOwnership(installPlan);
  const sortedManifestMap = new Map(sortedEntries.map((entry) => [entry.manifest.id, entry] as const));
  const slotTasks = buildSlotTasks(plan, sortedManifestMap);

  return {
    formatVersion: '1',
    app: {
      id: plan.app.id,
      name: plan.app.name,
      stack: plan.app.stack,
      mode: plan.app.mode
    },
    resolvedBlocks,
    resolvedCapabilities: uniqueSorted([...providerMap.keys()]),
    installPlan,
    slotTasks,
    generatedPaths: uniqueSorted([
      'generated/routes.ts',
      CI_ARTIFACT_FILES.blockUsageMap,
      CI_ARTIFACT_FILES.installManifest
    ]),
    acceptancePlan: uniqueSorted(plan.acceptance.map((entry) => entry.id)),
    passStatus: {
      ...PASS_STATUS_PENDING,
      parse: 'succeeded',
      align: 'succeeded',
      resolve: 'succeeded'
    }
  };
}
