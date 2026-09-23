import type { BlockManifest, LockFile } from '../../../compiler/contract.ts';
import { compareCodeUnits, uniqueSorted } from '../../../contracts/canonical.ts';
import type {
  ReviewRuntimeEntry,
  ReviewRuntimeEntryKind,
  ReviewVerticalSlice
} from './contract/types.ts';

export function classifyRuntimeEntry(
  targetPath: string
): ReviewRuntimeEntryKind | null {
  if (/^(?:lib|src\/runtime)\/.+\.ts$/u.test(targetPath)) return 'library';
  if (/^src\/installed\/.+\.ts$/u.test(targetPath)) return 'service';
  return null;
}

function capabilityNamespace(capability: string): string | null {
  const [namespace, name, ...rest] = capability.split('/');
  if (!namespace || !name || rest.length > 0) return null;
  return namespace;
}

function manifestVertical(manifest: BlockManifest): string | null {
  const namespaces = uniqueSorted(
    (manifest.provides ?? [])
      .map(capabilityNamespace)
      .filter((value): value is string => value !== null)
  );
  return namespaces.length === 1 ? namespaces[0]! : null;
}

function addToSetMap(
  map: Map<string, Set<string>>,
  key: string,
  value: string
): void {
  let values = map.get(key);
  if (!values) {
    values = new Set<string>();
    map.set(key, values);
  }
  values.add(value);
}

function sortedSetMap(
  source: ReadonlyMap<string, ReadonlySet<string>>
): Map<string, string[]> {
  return new Map(
    [...source].map(([key, values]) => [key, uniqueSorted([...values])])
  );
}

class RuntimeAttributionResolver {
  private readonly blockToVertical = new Map<string, string>();
  private readonly providersByCapability: ReadonlyMap<string, string[]>;
  private readonly ownersByTarget: ReadonlyMap<string, string[]>;
  private readonly relatedClosureByOwnerSet = new Map<string, readonly string[]>();

  constructor(
    lock: LockFile,
    private readonly manifests: ReadonlyMap<string, BlockManifest>
  ) {
    const providersByCapability = new Map<string, Set<string>>();
    const ownersByTarget = new Map<string, Set<string>>();
    for (const [blockId, manifest] of manifests.entries()) {
      const vertical = manifestVertical(manifest);
      if (vertical) this.blockToVertical.set(blockId, vertical);
      for (const capability of manifest.provides ?? []) {
        addToSetMap(providersByCapability, capability, blockId);
      }
    }
    for (const step of lock.installPlan) {
      addToSetMap(ownersByTarget, step.to, step.blockId);
    }
    this.providersByCapability = sortedSetMap(providersByCapability);
    this.ownersByTarget = sortedSetMap(ownersByTarget);
  }

  private exactOwners(targetPath: string): readonly string[] {
    return this.ownersByTarget.get(targetPath) ?? [];
  }

  private relatedClosure(owners: readonly string[]): string[] {
    const canonicalOwners = uniqueSorted([...owners]);
    const cacheKey = canonicalOwners.join('\0');
    const cached = this.relatedClosureByOwnerSet.get(cacheKey);
    if (cached) return [...cached];

    const related = new Set<string>(canonicalOwners);
    const queue = [...canonicalOwners];
    for (let index = 0; index < queue.length; index += 1) {
      const blockId = queue[index]!;
      const manifest = this.manifests.get(blockId);
      if (!manifest) continue;
      for (const requirement of manifest.requires ?? []) {
        for (const provider of this.providersByCapability.get(requirement) ?? []) {
          if (related.has(provider)) continue;
          related.add(provider);
          queue.push(provider);
        }
      }
    }
    const closure = Object.freeze(uniqueSorted([...related]));
    this.relatedClosureByOwnerSet.set(cacheKey, closure);
    return [...closure];
  }

  runtimeEntry(targetPath: string, kind: ReviewRuntimeEntryKind): ReviewRuntimeEntry {
    const ownerVerticals = uniqueSorted(
      this.exactOwners(targetPath)
        .map(blockId => this.blockToVertical.get(blockId))
        .filter((value): value is string => value !== undefined)
    );
    const vertical = ownerVerticals.length === 1 ? ownerVerticals[0]! : null;
    return {
      path: targetPath,
      kind,
      ...(vertical ? { vertical } : {}),
      relatedBlocks: this.relatedClosure(this.exactOwners(targetPath))
    };
  }
}

/**
 * Attribute runtime targets from one already-captured manifest set. Assurance
 * owns the evidence relationship; adapters only capture the manifests.
 */
export function buildRuntimeAttributionsFromManifests(
  lock: LockFile,
  targetPaths: readonly string[],
  manifests: ReadonlyMap<string, BlockManifest>
): ReviewRuntimeEntry[] {
  const runtimeTargets = uniqueSorted([...targetPaths])
    .map(targetPath => ({ targetPath, kind: classifyRuntimeEntry(targetPath) }))
    .filter(
      (entry): entry is { targetPath: string; kind: ReviewRuntimeEntryKind } =>
        entry.kind !== null
    );
  if (runtimeTargets.length === 0) return [];

  const resolver = new RuntimeAttributionResolver(lock, manifests);
  return runtimeTargets
    .map(({ targetPath, kind }) => resolver.runtimeEntry(targetPath, kind))
    .sort((left, right) => compareCodeUnits(left.path, right.path));
}

export function buildVerticalSliceAttributions(
  entries: readonly ReviewRuntimeEntry[]
): ReviewVerticalSlice[] {
  const slices = new Map<
    string,
    { runtimeEntries: Set<string>; relatedBlocks: Set<string> }
  >();
  for (const entry of entries) {
    if (!entry.vertical) continue;
    let slice = slices.get(entry.vertical);
    if (!slice) {
      slice = {
        runtimeEntries: new Set<string>(),
        relatedBlocks: new Set<string>()
      };
      slices.set(entry.vertical, slice);
    }
    slice.runtimeEntries.add(entry.path);
    for (const blockId of entry.relatedBlocks) slice.relatedBlocks.add(blockId);
  }
  return [...slices.entries()]
    .map(([id, slice]) => ({
      id,
      runtimeEntries: uniqueSorted([...slice.runtimeEntries]),
      relatedBlocks: uniqueSorted([...slice.relatedBlocks])
    }))
    .sort((left, right) => compareCodeUnits(left.id, right.id));
}
