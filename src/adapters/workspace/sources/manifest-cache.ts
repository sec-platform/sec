import type { ManifestEntry } from '../../../compiler/contract.ts';
import { deepFreeze } from '../../../contracts/canonical.ts';
import type { RegistryKind, RegistryLocation } from '../../../contracts/registry-source.ts';

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

export type ManifestObservedSourceKey = Omit<ManifestCacheKey, 'blockId' | 'version'> & Readonly<{
  manifestPath: string;
}>;

interface ManifestCacheRecord {
  readonly sourceLocator: string | undefined;
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
const DEFAULT_MANIFEST_CACHE_ENTRIES = 1024;
export class ManifestCache {
  private readonly records = new Map<string, ManifestCacheRecord>();
  // Secondary lookup only. It refers to the same bounded LRU records; it owns
  // neither another entry cache nor independent capacity/eviction policy.
  private readonly sourceLocators = new Map<string, string>();
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

  private sourceKey(key: Omit<ManifestObservedSourceKey, 'sourceDigest'>): string {
    return JSON.stringify([key.workspaceRoot, key.registrySourceId, key.registryKind,
      key.registryLocation, key.registryPath, key.manifestPath]);
  }

  private discard(locator: string): void {
    const record = this.records.get(locator);
    this.records.delete(locator);
    if (record?.sourceLocator !== undefined && this.sourceLocators.get(record.sourceLocator) === locator) {
      this.sourceLocators.delete(record.sourceLocator);
    }
  }

  private reuse(locator: string, sourceDigest: `sha256:${string}`): ManifestEntry | undefined {
    const record = this.records.get(locator);
    if (record === undefined) return undefined;
    if (record.sourceDigest !== sourceDigest) { this.discard(locator); return undefined; }
    this.records.delete(locator);
    this.records.set(locator, record);
    return record.entry;
  }

  get(key: ManifestCacheKey): ManifestEntry | undefined {
    key = this.capture(key);
    return this.reuse(this.locatorKey(key), key.sourceDigest);
  }

  /** The caller has read current source bytes but does not yet know the logical
   * ID. Consult an already validated path binding, never decode an ID from a
   * directory name. Version overlays cannot enter this root-source projection.
   */
  getByObservedSource(key: ManifestObservedSourceKey): ManifestEntry | undefined {
    const { workspaceRoot, registrySourceId, registryKind, registryLocation, registryPath, manifestPath, sourceDigest } = key;
    const source = this.sourceKey({ workspaceRoot, registrySourceId, registryKind, registryLocation, registryPath, manifestPath });
    const locator = this.sourceLocators.get(source);
    return locator === undefined ? undefined : this.reuse(locator, sourceDigest);
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
    const sourceLocator = key.version === undefined && typeof snapshot.manifestPath === 'string' && snapshot.manifestPath.length > 0
      ? this.sourceKey({ ...key, manifestPath: snapshot.manifestPath }) : undefined;
    this.discard(locator);
    if (sourceLocator !== undefined) {
      const previousLocator = this.sourceLocators.get(sourceLocator);
      if (previousLocator !== undefined) this.discard(previousLocator);
      this.sourceLocators.set(sourceLocator, locator);
    }
    this.records.set(locator, Object.freeze({ workspaceRoot: key.workspaceRoot, sourceLocator,
      sourceDigest: key.sourceDigest, entry: snapshot }));
    while (this.records.size > this.maximumEntries) this.discard(this.records.keys().next().value!);
  }

  clearWorkspace(workspaceRoot: string): void {
    for (const [locator, record] of this.records) if (record.workspaceRoot === workspaceRoot) this.discard(locator);
  }

  clear(): void {
    this.records.clear();
    this.sourceLocators.clear();
  }
}

export const manifestCache = new ManifestCache();
