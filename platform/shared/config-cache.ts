import { readFileSync, statSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';

// ConfigCache caches parsed JSON/YAML results keyed on
// `stat(filePath).mtimeMs + stat(filePath).size`. When the file's mtime or
// size changes, the entry is invalidated and the next read re-parses the
// content. This eliminates redundant fs reads and JSON/YAML parsing for
// config files that rarely change between dev-loop invocations (package.json,
// bun.lock, tsconfig.json, etc.).

interface ConfigCacheEntry {
  readonly signature: string;
  readonly value: unknown;
}

function fileSignature(filePath: string, mtimeMs: number, size: number): string {
  return `${filePath}:${mtimeMs}:${size}`;
}

export class ConfigCache {
  private readonly entries = new Map<string, ConfigCacheEntry>();

  async getOrRead<T>(filePath: string, parser: (content: string) => T): Promise<T> {
    const metadata = await stat(filePath);
    const signature = fileSignature(filePath, metadata.mtimeMs, metadata.size);
    const existing = this.entries.get(filePath);
    if (existing !== undefined && existing.signature === signature) {
      return existing.value as T;
    }
    const content = await readFile(filePath, 'utf8');
    const value = parser(content);
    this.entries.set(filePath, { signature, value: value as unknown });
    return value;
  }

  getOrReadSync<T>(filePath: string, parser: (content: string) => T): T {
    const metadata = statSync(filePath);
    const signature = fileSignature(filePath, metadata.mtimeMs, metadata.size);
    const existing = this.entries.get(filePath);
    if (existing !== undefined && existing.signature === signature) {
      return existing.value as T;
    }
    const content = readFileSync(filePath, 'utf8');
    const value = parser(content);
    this.entries.set(filePath, { signature, value: value as unknown });
    return value;
  }

  invalidate(filePath: string): void {
    this.entries.delete(filePath);
  }

  clear(): void {
    this.entries.clear();
  }
}

let _defaultConfigCache: ConfigCache | null = null;

export function getDefaultConfigCache(): ConfigCache {
  if (_defaultConfigCache === null) {
    _defaultConfigCache = new ConfigCache();
  }
  return _defaultConfigCache;
}
