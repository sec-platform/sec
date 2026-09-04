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
class ManifestCache {
  private readonly records = new Map<string, ManifestCacheRecord>();

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
    const record = this.records.get(this.locatorKey(key));
    return record?.sourceDigest === key.sourceDigest ? record.entry : undefined;
  }

  set(key: ManifestCacheKey, entry: ManifestEntry): void {
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
    const snapshot = deepFreeze(entry);
    this.records.set(this.locatorKey(key), Object.freeze({
      sourceDigest: key.sourceDigest,
      entry: snapshot
    }));
  }

  clear(): void {
    this.records.clear();
  }
}

export const manifestCache = new ManifestCache();
