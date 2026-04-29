import type { ManifestEntry } from '../../shared/plan-manifest-types.ts';
import { loadManifestById, loadAllManifests } from './load-manifest.ts';

interface CacheKey {
  blockId: string;
  version?: string;
}

class ManifestCache {
  private entries = new Map<string, ManifestEntry>();
  private allEntriesCache: ManifestEntry[] | null = null;
  private allEntriesKey: string | null = null;

  private cacheKey(key: CacheKey): string {
    return `${key.blockId}@${key.version ?? 'latest'}`;
  }

  async get(key: CacheKey): Promise<ManifestEntry> {
    const cacheId = this.cacheKey(key);
    const cached = this.entries.get(cacheId);
    if (cached) {
      return cached;
    }
    const entry = await loadManifestById(key.blockId, {
      version: key.version,
      registrySources: undefined
    });
    this.entries.set(cacheId, entry);
    return entry;
  }

  async getAll(options: { workspaceRoot?: string } = {}): Promise<ManifestEntry[]> {
    const cacheKey = options.workspaceRoot ?? '__default__';
    if (this.allEntriesCache && this.allEntriesKey === cacheKey) {
      return this.allEntriesCache;
    }
    this.allEntriesCache = await loadAllManifests({ workspaceRoot: options.workspaceRoot });
    this.allEntriesKey = cacheKey;
    for (const entry of this.allEntriesCache) {
      this.entries.set(this.cacheKey({ blockId: entry.manifest.id, version: entry.manifest.version }), entry);
    }
    return this.allEntriesCache;
  }

  clear(): void {
    this.entries.clear();
    this.allEntriesCache = null;
    this.allEntriesKey = null;
  }
}

export const manifestCache = new ManifestCache();
