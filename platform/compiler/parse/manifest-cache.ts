import type { ManifestEntry } from '../../shared/plan-manifest-types.ts';
import type { RegistryKind, RegistryLocation } from '../../shared/registry-types.ts';

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

/**
 * In-process parse/validation cache only. It is never an authority source.
 * The key binds both logical registry identity and exact observed source bytes,
 * so a long-lived process cannot reuse a parsed manifest after its source changes.
 */
class ManifestCache {
  private readonly entries = new Map<string, ManifestEntry>();

  private cacheKey(key: ManifestCacheKey): string {
    return JSON.stringify([
      key.workspaceRoot,
      key.registrySourceId,
      key.registryKind,
      key.registryLocation,
      key.registryPath,
      key.blockId,
      key.version ?? null,
      key.sourceDigest
    ]);
  }

  get(key: ManifestCacheKey): ManifestEntry | undefined {
    return this.entries.get(this.cacheKey(key));
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
    this.entries.set(this.cacheKey(key), entry);
  }

  clear(): void {
    this.entries.clear();
  }
}

export const manifestCache = new ManifestCache();
