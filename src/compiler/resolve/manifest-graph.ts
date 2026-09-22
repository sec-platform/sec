import { canonicalEquals, compareCodeUnits } from '../../contracts/canonical.ts';
import type { ManifestEntry } from '../contract/plan-manifest.ts';
import { CompilerError } from '../errors.ts';
import { KIND_PRIORITY } from '../registry/kind-priority.ts';

type Providers = Map<string, ManifestEntry[]>;

function addProvider(index: Providers, entry: ManifestEntry): void {
  // Repeating a capability in one manifest is not a second implementation.
  for (const capability of new Set(entry.manifest.provides)) {
    const providers = index.get(capability);
    if (providers === undefined) index.set(capability, [entry]);
    else providers.push(entry);
  }
}

/** A rank-only binary heap for this resolver's ready set. Every vertex is
 * admitted once. Rank already encodes the existing kind + code-unit ID order;
 * there is no repeated sorting/copying of all remaining ready vertices.
 */
class ReadyRanks {
  private readonly ranks: number[] = [];

  add(rank: number): void {
    let index = this.ranks.length;
    this.ranks.push(rank);
    while (index > 0) {
      const parent = (index - 1) >>> 1;
      const value = this.ranks[parent]!;
      if (value <= rank) break;
      this.ranks[index] = value;
      index = parent;
    }
    this.ranks[index] = rank;
  }

  take(): number | undefined {
    if (this.ranks.length === 0) return undefined;
    const first = this.ranks[0]!;
    const last = this.ranks.pop()!;
    if (this.ranks.length > 0) {
      let index = 0;
      while (index * 2 + 1 < this.ranks.length) {
        let child = index * 2 + 1;
        if (child + 1 < this.ranks.length && this.ranks[child + 1]! < this.ranks[child]!) child++;
        if (this.ranks[child]! >= last) break;
        this.ranks[index] = this.ranks[child]!;
        index = child;
      }
      this.ranks[index] = last;
    }
    return first;
  }
}

function orderManifests(entries: readonly ManifestEntry[], providers: Providers): ManifestEntry[] {
  // Sorting once keeps the exact prior tie policy, including dynamically ready
  // lower-ranked nodes. Sorting whole dependency layers would change that policy.
  const ranked = [...entries].sort((left, right) =>
    (KIND_PRIORITY[left.manifest.kind] ?? 99) - (KIND_PRIORITY[right.manifest.kind] ?? 99)
      || compareCodeUnits(left.manifest.id, right.manifest.id));
  const rankById = new Map(ranked.map((entry, rank) => [entry.manifest.id, rank]));
  const adjacency = ranked.map(() => new Set<number>());
  const indegree = ranked.map(() => 0);
  for (let rank = 0; rank < ranked.length; rank++) {
    const entry = ranked[rank]!;
    for (const requirement of new Set(entry.manifest.requires)) {
      const candidates = providers.get(requirement);
      if (candidates === undefined || candidates.length === 0) {
        throw new CompilerError('RESOLVE-MISSING-001', `Missing provider for capability "${requirement}"`);
      }
      for (const provider of candidates) {
        const predecessor = rankById.get(provider.manifest.id);
        if (predecessor === undefined) {
          throw new CompilerError('RESOLVE-INTERNAL-001', `Missing adjacency for "${provider.manifest.id}"`);
        }
        if (predecessor === rank || adjacency[predecessor]!.has(rank)) continue;
        adjacency[predecessor]!.add(rank);
        indegree[rank]!++;
      }
    }
  }
  const ready = new ReadyRanks();
  for (let rank = 0; rank < ranked.length; rank++) if (indegree[rank] === 0) ready.add(rank);
  const ordered: ManifestEntry[] = [];
  for (let rank = ready.take(); rank !== undefined; rank = ready.take()) {
    ordered.push(ranked[rank]!);
    for (const dependent of adjacency[rank]!) {
      indegree[dependent]!--;
      if (indegree[dependent] === 0) ready.add(dependent);
    }
  }
  if (ordered.length !== ranked.length) {
    throw new CompilerError('RESOLVE-CYCLE-003', 'Dependency cycle detected', {
      // Unscheduled vertices may include descendants of a cycle; this is not
      // labelled a minimal cycle witness or a proof that every listed node cycles.
      blockedBlockIds: ranked.filter((_entry, rank) => indegree[rank]! > 0).map(entry => entry.manifest.id)
    });
  }
  return ordered;
}

/** Owns this manifest dependency graph only, not every graph in the system.
 * Preserve existing unique-provider closure and all-selected-provider ordering.
 * Catalog validation and physical source observation remain with their loader.
 */
export function resolveManifestGraph(
  explicitEntries: readonly ManifestEntry[],
  catalog: readonly ManifestEntry[]
): Readonly<{ entries: readonly ManifestEntry[]; capabilities: readonly string[] }> {
  const byId = new Map<string, ManifestEntry>();
  const selectedProviders: Providers = new Map();
  const queue: ManifestEntry[] = [];
  const select = (entry: ManifestEntry): void => {
    byId.set(entry.manifest.id, entry);
    addProvider(selectedProviders, entry);
    queue.push(entry);
  };
  for (const entry of explicitEntries) {
    const selected = byId.get(entry.manifest.id);
    if (selected === undefined) select(entry);
    else if (!canonicalEquals(selected, entry)) {
      throw new CompilerError('RESOLVE-CONFLICT-004', `Conflicting explicit selections for block "${entry.manifest.id}"`, {
        selectedVersion: selected.manifest.version, requestedVersion: entry.manifest.version,
        selectedSource: selected.registrySourceId, requestedSource: entry.registrySourceId
      });
    }
  }
  const catalogProviders: Providers = new Map();
  for (const entry of catalog) addProvider(catalogProviders, entry);
  for (let index = 0; index < queue.length; index++) {
    const entry = queue[index]!;
    for (const requirement of entry.manifest.requires) {
      if (selectedProviders.has(requirement)) continue;
      const candidates = catalogProviders.get(requirement) ?? [];
      if (candidates.length === 0) {
        throw new CompilerError('RESOLVE-MISSING-001', `Missing provider for capability "${requirement}"`);
      }
      if (candidates.length > 1) {
        throw new CompilerError('RESOLVE-CONFLICT-004',
          `Ambiguous providers for capability "${requirement}": ${candidates.map(provider => provider.manifest.id).join(', ')}`);
      }
      const provider = candidates[0]!;
      const alreadySelected = byId.get(provider.manifest.id);
      if (alreadySelected !== undefined) {
        // The catalog can offer a newer version of an explicitly selected ID.
        // Its capability does not exist in the selected version; do not silently
        // skip it and manufacture a lock with an unsatisfied requirement.
        throw new CompilerError('RESOLVE-CONFLICT-004',
          `Selected block "${provider.manifest.id}" does not provide required capability "${requirement}"`, {
            requiredBy: entry.manifest.id, requirement, selectedVersion: alreadySelected.manifest.version,
            candidateVersion: provider.manifest.version
          });
      }
      select(provider);
    }
  }
  for (const entry of queue) {
    for (const conflict of entry.manifest.conflicts) {
      if (byId.has(conflict)) {
        throw new CompilerError('RESOLVE-CONFLICT-002', `Block "${entry.manifest.id}" conflicts with "${conflict}"`);
      }
      if (selectedProviders.has(conflict)) {
        throw new CompilerError('RESOLVE-CONFLICT-003', `Block "${entry.manifest.id}" conflicts with provided capability "${conflict}"`);
      }
    }
  }
  return Object.freeze({ entries: Object.freeze(orderManifests(queue, selectedProviders)),
    capabilities: Object.freeze([...selectedProviders.keys()].sort(compareCodeUnits)) });
}
