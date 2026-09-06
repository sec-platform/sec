import { deepFreeze } from '../../system-architecture/foundation/runtime/canonical.ts';
import type { ManifestEntry } from '../contract.ts';
import type { RegistryKind, RegistryLocation } from '../registry/contract/types.ts';

export interface ManifestCacheKey {
  readonly workspaceRoot: string;
  readonly registrySourceId: string;
  readonly registryKind: RegistryKind;
  readonly registryLocation: RegistryLocation;
  readonly registryPath: string;
  readonly blockId: string;
  readonly version?: string;
  readonly sourceDigest: `sha256:${string}`;
}

interface ManifestCacheRecord {
  readonly workspaceRoot: string;
  readonly sourceDigest: `sha256:${string}`;
  readonly entry: ManifestEntry;
}

/**
 * In-process parse/validation cache only. It is never an authority source.
 * One logical manifest locator owns at most one cache record; exact observed
 * source bytes decide whether that record is reusable. New source bytes replace
 * the old record instead of retaining an unbounded history of stale revisions.
 *
 * Cached entries are deeply frozen before publication. A consumer therefore
 * cannot mutate a shared parsed Manifest and make later reads observe bytes
 * that never existed in the bound authority source.
 */
// A cache admission limit, not a manifest validity/resource authorization limit.
// Eviction changes reuse only. This entry-count default is not a byte/RSS bound.
export const DEFAULT_MANIFEST_CACHE_ENTRIES = 1024;
export class ManifestCache {
  private readonly records = new Map<string, ManifestCacheRecord>();
  private readonly maximumEntries: number;

  constructor(maximumEntries = DEFAULT_MANIFEST_CACHE_ENTRIES) {
    if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 0) throw new TypeError('Manifest cache capacity must be a non-negative safe integer');
    this.maximumEntries = maximumEntries;
  }

  get size(): number { return this.records.size; }

  private capture(key: ManifestCacheKey): ManifestCacheKey {
    const { workspaceRoot, registrySourceId, registryKind, registryLocation, registryPath, blockId, version, sourceDigest } = key;
    return Object.freeze({ workspaceRoot, registrySourceId, registryKind, registryLocation, registryPath, blockId, version, sourceDigest });
  }

  private locatorKey(key: ManifestCacheKey): string {
    return JSON.stringify([
      key.workspaceRoot,
      key.registrySourceId,
      key.registryKind,
      key.registryLocation,
      key.registryPath,
      key.blockId,
      key.version ?? null
    ]);
  }

  get(key: ManifestCacheKey): ManifestEntry | undefined {
    key = this.capture(key);
    const locator = this.locatorKey(key);
    const record = this.records.get(locator);
    if (record === undefined) return undefined;
    this.records.delete(locator);
    if (record.sourceDigest !== key.sourceDigest) return undefined;
    this.records.set(locator, record); // Most recently reused, not merely inserted.
    return record.entry;
  }

  set(key: ManifestCacheKey, entry: ManifestEntry): void {
    key = this.capture(key);
    if (
      entry.manifest.id !== key.blockId ||
      (key.version !== undefined && entry.manifest.version !== key.version) ||
      entry.registrySourceId !== key.registrySourceId ||
      entry.registryKind !== key.registryKind ||
      entry.registryLocation !== key.registryLocation ||
      entry.registryPath !== key.registryPath
    ) {
      throw new Error('Manifest cache entry does not match its causal registry identity.');
    }
    if (this.maximumEntries === 0) return;
    const snapshot = deepFreeze(entry);
    const locator = this.locatorKey(key);
    this.records.delete(locator);
    this.records.set(locator, Object.freeze({ workspaceRoot: key.workspaceRoot,
      sourceDigest: key.sourceDigest, entry: snapshot }));
    while (this.records.size > this.maximumEntries) this.records.delete(this.records.keys().next().value!);
  }

  clearWorkspace(workspaceRoot: string): void {
    for (const [locator, record] of this.records) if (record.workspaceRoot === workspaceRoot) this.records.delete(locator);
  }

  clear(): void {
    this.records.clear();
  }
}

export const manifestCache = new ManifestCache();
