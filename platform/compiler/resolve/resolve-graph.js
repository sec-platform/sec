import path from 'node:path';
import { KIND_PRIORITY, PASS_STATUS_PENDING } from '../../shared/constants.js';
import { CompilerError } from '../../shared/errors.js';
import { loadAllManifests, loadManifestById } from '../parse/load-manifest.js';

function compareBlocks(left, right) {
  const leftPriority = KIND_PRIORITY[left.manifest.kind] ?? 99;
  const rightPriority = KIND_PRIORITY[right.manifest.kind] ?? 99;
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }
  return left.manifest.id.localeCompare(right.manifest.id);
}

function buildCapabilityProviders(entries) {
  const providers = new Map();
  for (const entry of entries) {
    for (const capability of entry.manifest.provides) {
      const list = providers.get(capability) ?? [];
      list.push(entry);
      providers.set(capability, list);
    }
  }
  return providers;
}

function detectConflicts(entries, capabilityProviders) {
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

function topologicalSort(entries, providerMap) {
  const adjacency = new Map(entries.map((entry) => [entry.manifest.id, new Set()]));
  const indegree = new Map(entries.map((entry) => [entry.manifest.id, 0]));

  for (const entry of entries) {
    for (const requirement of entry.manifest.requires) {
      const providers = providerMap.get(requirement) ?? [];
      for (const provider of providers) {
        if (provider.manifest.id === entry.manifest.id) {
          continue;
        }
        if (!adjacency.get(provider.manifest.id).has(entry.manifest.id)) {
          adjacency.get(provider.manifest.id).add(entry.manifest.id);
          indegree.set(entry.manifest.id, indegree.get(entry.manifest.id) + 1);
        }
      }
    }
  }

  const queue = entries.filter((entry) => indegree.get(entry.manifest.id) === 0).sort(compareBlocks);
  const result = [];

  while (queue.length > 0) {
    const current = queue.shift();
    result.push(current);
    for (const dependentId of [...adjacency.get(current.manifest.id)]) {
      indegree.set(dependentId, indegree.get(dependentId) - 1);
      if (indegree.get(dependentId) === 0) {
        const dependent = entries.find((entry) => entry.manifest.id === dependentId);
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

function buildSlotTasks(plan, manifestMap) {
  return plan.slots.map((slot) => {
    const manifestSlot = manifestMap.get(slot.block).manifest.slots.find((candidate) => candidate.id === slot.id);
    return {
      id: slot.id,
      block: slot.block,
      target: slot.target,
      symbol: slot.symbol,
      kind: slot.kind,
      status: 'pending',
      writableZones: manifestSlot.writableZones,
      provenanceHints: {
        generator: 'mock-local-synthesizer',
        verifiedBy: []
      }
    };
  });
}

export async function resolveGraph(plan) {
  const explicitEntries = [];
  for (const block of plan.blocks) {
    explicitEntries.push(await loadManifestById(block.id));
  }

  const allEntries = await loadAllManifests();
  const resolvedIds = new Set(explicitEntries.map((entry) => entry.manifest.id));
  const manifestMap = new Map(explicitEntries.map((entry) => [entry.manifest.id, entry]));

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
    manifestPath: path.relative(process.cwd(), entry.manifestPath).replaceAll('\\', '/')
  }));

  const installPlan = [];
  for (const block of sortedEntries) {
    for (const install of block.manifest.installs) {
      installPlan.push({
        stepId: `${block.manifest.id}:${installPlan.length + 1}`,
        blockId: block.manifest.id,
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
      'generated/block-usage-map.json',
      'generated/install-manifest.json'
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
