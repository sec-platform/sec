import { parse as parseYaml } from 'yaml';
import { uniqueSorted } from '../../shared/collections.ts';
import { pathExists, readText } from '../../shared/fs.ts';
import type { LockFile } from '../../shared/lock-types.ts';
import { defaultLogger } from '../../shared/logger.ts';
import type { BlockManifest } from '../../shared/plan-manifest-types.ts';
import { compareCodeUnits } from '../ir/ir-canonical-primitives.ts';
import { manifestCache } from '../parse/manifest-cache.ts';

export type RuntimeEntryKind = 'page' | 'api';

export interface RuntimeAttribution {
  path: string;
  kind: RuntimeEntryKind;
  vertical?: string;
  relatedBlocks: string[];
}

export interface VerticalSliceAttribution {
  id: string;
  runtimeEntries: string[];
  relatedBlocks: string[];
}

export function classifyRuntimeEntry(targetPath: string): RuntimeEntryKind | null {
  if (/^app\/.+\/page\.tsx$/.test(targetPath) || targetPath === 'app/page.tsx') {
    return 'page';
  }
  if (/^app\/api\/.+\/route\.ts$/.test(targetPath)) {
    return 'api';
  }
  return null;
}

export class AttributionResolver {
  private blockToVertical = new Map<string, string>();

  /**
   * 异步工厂：优先查询 manifestCache（resolve-graph 阶段已预热），
   * 缓存未命中时回退到异步磁盘读取，避免重复 I/O 与同步阻塞。
   */
  public static async create(lock: LockFile): Promise<AttributionResolver> {
    const manifests = new Map<string, BlockManifest>();

    await Promise.all(
      lock.resolvedBlocks.map(async (block) => {
        try {
          const cached = manifestCache.get({ blockId: block.id, version: block.version });
          if (cached) {
            manifests.set(block.id, cached.manifest);
            return;
          }
          if (block.manifestPath && await pathExists(block.manifestPath)) {
            const content = await readText(block.manifestPath);
            const manifest = parseYaml(content) as BlockManifest;
            manifests.set(block.id, manifest);
          }
        } catch (err) {
          defaultLogger.warn('Failed to load block manifest for runtime attribution', { blockId: block.id, error: err });
        }
      })
    );

    return new AttributionResolver(manifests);
  }

  private constructor(manifests: Map<string, BlockManifest>) {
    // 1. Detect anchors via route paths
    for (const [blockId, manifest] of manifests.entries()) {
      if (manifest.routes && manifest.routes.length > 0) {
        for (const route of manifest.routes) {
          const cleanPath = route.path.replace(/^\//, '').split('/')[0];
          let vertical = cleanPath;
          if (cleanPath.startsWith('ticket')) vertical = 'ticket';
          else if (cleanPath.startsWith('customer')) vertical = 'customer';

          this.blockToVertical.set(blockId, vertical);
          break;
        }
      }
    }

    // 2. Topological propagation for dependencies
    let changed = true;
    while (changed) {
      changed = false;
      for (const [blockId, manifest] of manifests.entries()) {
        if (this.blockToVertical.has(blockId)) {
          continue;
        }

        for (const req of manifest.requires || []) {
          const foundVertical = this.findVerticalForRequire(req, this.blockToVertical);
          if (foundVertical) {
            this.blockToVertical.set(blockId, foundVertical);
            changed = true;
            break;
          }
        }
      }
    }
  }

  private findVerticalForRequire(req: string, mapping: Map<string, string>): string | null {
    if (mapping.has(req)) {
      return mapping.get(req)!;
    }
    for (const [blockId, vertical] of mapping.entries()) {
      const namespace = blockId.split('/')[0];
      if (req.startsWith(namespace + '/')) {
        return vertical;
      }
    }
    return null;
  }

  public detectVertical(targetPath: string): string | null {
    const pathLower = targetPath.toLowerCase();

    for (const [blockId, vertical] of this.blockToVertical.entries()) {
      const namespace = blockId.split('/')[0];
      if (pathLower.includes(namespace)) {
        return vertical;
      }
    }

    if (pathLower.startsWith('app/')) {
      const parts = pathLower.split('/');
      if (parts.length > 1) {
        const segment = parts[1];
        if (segment.startsWith('ticket')) return 'ticket';
        if (segment.startsWith('customer')) return 'customer';

        for (const [blockId, vertical] of this.blockToVertical.entries()) {
          const namespace = blockId.split('/')[0];
          if (segment.includes(namespace)) {
            return vertical;
          }
        }
      }
    }

    // Static fallback
    if (pathLower.includes('ticket') || pathLower.includes('worklog')) {
      return 'ticket';
    }
    if (pathLower.includes('customer')) {
      return 'customer';
    }

    return null;
  }

  public getRelatedBlocks(targetPath: string, lock: LockFile): string[] {
    const vertical = this.detectVertical(targetPath);
    const related = new Set<string>();

    for (const block of lock.resolvedBlocks) {
      const blockVertical = this.blockToVertical.get(block.id) ?? this.detectVertical(block.id);
      if (vertical && blockVertical === vertical) {
        related.add(block.id);
      }
      if (targetPath.includes('/export') && block.id.startsWith('export/')) {
        related.add(block.id);
      }
      if (targetPath.includes('/summary') && block.id.includes('summary')) {
        const summaryVertical = this.detectVertical(block.id);
        if (!vertical || summaryVertical === vertical) {
          related.add(block.id);
        }
      }
    }
    return [...related];
  }
}

export function detectVerticalFromPath(targetPath: string): string | null {
  const pathLower = targetPath.toLowerCase();
  if (pathLower.includes('ticket') || pathLower.includes('worklog')) {
    return 'ticket';
  }
  if (pathLower.includes('customer')) {
    return 'customer';
  }
  return null;
}

export async function inferRelatedBlocks(lock: LockFile, targetPath: string): Promise<string[]> {
  const resolver = await AttributionResolver.create(lock);
  return uniqueSorted(resolver.getRelatedBlocks(targetPath, lock));
}

export async function buildRuntimeAttribution(lock: LockFile, targetPath: string): Promise<RuntimeAttribution | null> {
  const kind = classifyRuntimeEntry(targetPath);
  if (!kind) {
    return null;
  }

  const resolver = await AttributionResolver.create(lock);
  const vertical = resolver.detectVertical(targetPath);
  return {
    path: targetPath,
    kind,
    ...(vertical ? { vertical } : {}),
    relatedBlocks: uniqueSorted(resolver.getRelatedBlocks(targetPath, lock))
  };
}

export async function buildRuntimeAttributions(lock: LockFile, targetPaths: string[]): Promise<RuntimeAttribution[]> {
  const resolver = await AttributionResolver.create(lock);
  return uniqueSorted(targetPaths)
    .map((targetPath) => {
      const kind = classifyRuntimeEntry(targetPath);
      if (!kind) return null;
      const vertical = resolver.detectVertical(targetPath);
      return {
        path: targetPath,
        kind,
        ...(vertical ? { vertical } : {}),
        relatedBlocks: uniqueSorted(resolver.getRelatedBlocks(targetPath, lock))
      };
    })
    .filter((entry): entry is RuntimeAttribution => entry !== null)
    .sort((left, right) => compareCodeUnits(left.path, right.path));
}

export function buildVerticalSliceAttributions(entries: RuntimeAttribution[]): VerticalSliceAttribution[] {
  const slices = new Map<string, { runtimeEntries: Set<string>; relatedBlocks: Set<string> }>();

  for (const entry of entries) {
    if (!entry.vertical) {
      continue;
    }

    let slice = slices.get(entry.vertical);
    if (!slice) {
      slice = { runtimeEntries: new Set<string>(), relatedBlocks: new Set<string>() };
      slices.set(entry.vertical, slice);
    }

    slice.runtimeEntries.add(entry.path);
    for (const blockId of entry.relatedBlocks) {
      slice.relatedBlocks.add(blockId);
    }
  }

  return [...slices.entries()]
    .map(([id, slice]) => ({
      id,
      runtimeEntries: uniqueSorted([...slice.runtimeEntries]),
      relatedBlocks: uniqueSorted([...slice.relatedBlocks])
    }))
    .sort((left, right) => compareCodeUnits(left.id, right.id));
}
