import type { ManifestEntry } from '../../shared/plan-manifest-types.ts';
import { loadAllManifests } from './load-manifest.ts';

interface CacheKey {
  blockId: string;
  version?: string;
  workspaceRoot?: string;
}

class ManifestCache {
  private entries = new Map<string, ManifestEntry>();
  private allEntriesCache: ManifestEntry[] | null = null;
  private allEntriesKey: string | null = null;

  private cacheKey(key: CacheKey): string {
    return `${key.workspaceRoot ?? '__default__'}::${key.blockId}@${key.version ?? 'latest'}`;
  }

  /**
   * 纯缓存查询：仅检查内存 Map，不触发磁盘读取。
   * 命中返回 ManifestEntry，未命中返回 undefined。
   * 调用方（如 loadManifestById）负责在磁盘读取后调用 set() 回填缓存。
   */
  get(key: CacheKey): ManifestEntry | undefined {
    return this.entries.get(this.cacheKey(key));
  }

  /**
   * 回填缓存。loadManifestById 在磁盘读取成功后调用此方法，
   * 使后续相同 blockId+version 的查询直接命中缓存。
   */
  set(key: CacheKey, entry: ManifestEntry): void {
    this.entries.set(this.cacheKey(key), entry);
  }

  async getAll(options: { workspaceRoot?: string } = {}): Promise<ManifestEntry[]> {
    const cacheKey = options.workspaceRoot ?? '__default__';
    if (this.allEntriesCache && this.allEntriesKey === cacheKey) {
      return this.allEntriesCache;
    }
    this.allEntriesCache = await loadAllManifests({ workspaceRoot: options.workspaceRoot });
    this.allEntriesKey = cacheKey;
    for (const entry of this.allEntriesCache) {
      this.set({ blockId: entry.manifest.id, version: entry.manifest.version, workspaceRoot: options.workspaceRoot }, entry);
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
