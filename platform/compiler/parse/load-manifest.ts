import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

import { compareCodeUnits, rawSha256 } from '../../shared/canonical-primitives.ts';
import { CompilerError } from '../../shared/errors.ts';
import { isFileNotFoundError, pathExists } from '../../shared/fs.ts';
import type { ResolvedBlock } from '../../shared/lock-types.ts';
import {
  blockDirName,
  isSafeRelativePath,
  officialRegistryRelativePath,
  posixPath,
  resolvePathInside,
  resolveRegistryRoot
} from '../../shared/paths.ts';
import type { BlockManifest, ManifestEntry, PlanRegistrySource } from '../../shared/plan-manifest-types.ts';
import type { RegistryKind, RegistryLocation } from '../../shared/registry-types.ts';
import { manifestCache, type ManifestCacheKey } from './manifest-cache.ts';
import { normalizeAndValidateSemanticManifestFields } from './validate-semantic-manifest.ts';

export interface ResolvedRegistrySource {
  id: string;
  kind: RegistryKind;
  location: RegistryLocation;
  path: string;
  root: string;
}

interface ManifestLoadOptions {
  workspaceRoot?: string;
  version?: string;
  registrySources?: PlanRegistrySource[];
}

function registryBlockRoot(registryRoot: string, blockId: string): string {
  return path.join(registryRoot, blockDirName(blockId));
}

function versionedManifestPath(registryRoot: string, blockId: string, version: string): string {
  return path.join(registryBlockRoot(registryRoot, blockId), 'versions', version, 'block.manifest.yaml');
}

function rootManifestPath(registryRoot: string, blockId: string): string {
  return path.join(registryBlockRoot(registryRoot, blockId), 'block.manifest.yaml');
}

interface ManifestSourceBytes {
  readonly raw: string;
  readonly digest: `sha256:${string}`;
}

async function tryReadManifestSource(manifestPath: string): Promise<ManifestSourceBytes | null> {
  try {
    const raw = await fs.readFile(manifestPath, 'utf8');
    return { raw, digest: rawSha256(raw) };
  } catch (error) {
    if (isFileNotFoundError(error)) return null;
    throw error;
  }
}

function parseManifestSource(source: ManifestSourceBytes): BlockManifest {
  return YAML.parse(source.raw) as BlockManifest;
}

function mergedManifestSourceDigest(
  root: ManifestSourceBytes | null,
  versioned: ManifestSourceBytes
): `sha256:${string}` {
  return rawSha256(`root:${root?.digest ?? 'none'}\nversioned:${versioned.digest}`);
}

function mergeVersionedManifest(rootManifest: BlockManifest | null, versionedManifest: BlockManifest): BlockManifest {
  return rootManifest ? { ...rootManifest, ...versionedManifest } : versionedManifest;
}

export function resolveRegistrySources(
  workspaceRoot = process.cwd(),
  sources: PlanRegistrySource[]
): ResolvedRegistrySource[] {
  const effectiveSources = sources.length > 0
    ? sources
    : [{
        id: 'official',
        kind: 'official',
        location: 'compiler',
        path: posixPath(officialRegistryRelativePath)
      } satisfies PlanRegistrySource];

  return effectiveSources.map((source) => ({
    id: source.id,
    kind: source.kind,
    location: source.location,
    path: posixPath(source.path),
    root: resolveRegistryRoot(workspaceRoot, source.location, source.path)
  }));
}

function manifestCacheKey(
  workspaceRoot: string,
  registrySource: ResolvedRegistrySource,
  blockId: string,
  version: string | undefined,
  sourceDigest: `sha256:${string}`
): ManifestCacheKey {
  return {
    workspaceRoot,
    registrySourceId: registrySource.id,
    registryKind: registrySource.kind,
    registryLocation: registrySource.location,
    registryPath: registrySource.path,
    blockId,
    ...(version === undefined ? {} : { version }),
    sourceDigest
  };
}

function manifestEntryFromPath(
  registrySource: ResolvedRegistrySource,
  manifest: ManifestEntry['manifest'],
  manifestPath: string,
  resourceRoots: string[] = [path.dirname(manifestPath)]
): ManifestEntry {
  return {
    manifest,
    manifestPath,
    manifestRoot: path.dirname(manifestPath),
    resourceRoots,
    registryRoot: registrySource.root,
    registrySourceId: registrySource.id,
    registryKind: registrySource.kind,
    registryLocation: registrySource.location,
    registryPath: registrySource.path
  };
}

function assertRequestedManifestIdentity(manifest: BlockManifest, requestedBlockId: string, manifestPath: string): void {
  if (manifest.id !== requestedBlockId) {
    throw new CompilerError(
      'MANIFEST-SCHEMA-011',
      `Manifest at "${manifestPath}" declares id "${manifest.id}" but was addressed as "${requestedBlockId}"`
    );
  }
}

function assertRegistryDirectoryIdentity(
  registrySource: ResolvedRegistrySource,
  directoryName: string,
  manifest: BlockManifest,
  manifestPath: string
): void {
  const expectedDirectory = blockDirName(manifest.id);
  if (directoryName !== expectedDirectory) {
    throw new CompilerError(
      'MANIFEST-SCHEMA-012',
      `Registry "${registrySource.id}" manifest "${manifest.id}" must live in directory "${expectedDirectory}", not "${directoryName}" (${manifestPath})`
    );
  }
}

export async function resolveManifestResource(
  entry: ManifestEntry,
  resourcePath: string
): Promise<{ root: string; path: string }> {
  const roots = entry.resourceRoots.length > 0 ? entry.resourceRoots : [entry.manifestRoot];
  for (const root of roots) {
    const candidate = resolvePathInside(root, resourcePath);
    if (!candidate) {
      throw new CompilerError('MANIFEST-SCHEMA-006', `Manifest resource path "${resourcePath}" escapes its resource root`);
    }
    if (await pathExists(candidate)) return { root, path: candidate };
  }
  const root = roots[0] ?? entry.manifestRoot;
  const candidate = resolvePathInside(root, resourcePath);
  if (!candidate) {
    throw new CompilerError('MANIFEST-SCHEMA-006', `Manifest resource path "${resourcePath}" escapes its resource root`);
  }
  return { root, path: candidate };
}

export function validateManifest(manifest: BlockManifest): asserts manifest is ManifestEntry['manifest'] {
  if (!manifest?.id || !manifest?.version || !manifest?.kind) {
    throw new CompilerError('MANIFEST-SCHEMA-001', 'Manifest missing id/version/kind');
  }

  manifest.stackProfiles ??= [];
  manifest.compatibility ??= {
    blockApi: '1',
    compilerApi: '1',
    stackProfiles: [...manifest.stackProfiles]
  };
  manifest.requires ??= [];
  manifest.provides ??= [];
  manifest.conflicts ??= [];
  normalizeAndValidateSemanticManifestFields(manifest);
  manifest.installs ??= [];
  manifest.pins = {
    inputs: manifest.pins?.inputs ?? [],
    outputs: manifest.pins?.outputs ?? []
  };
  manifest.slots ??= [];
  manifest.acceptance ??= [];
  manifest.routes ??= [];
  manifest.uiPortals ??= [];
  manifest.uiHooks ??= [];
  manifest.upgrade ??= { from: [], migrations: [] };
  manifest.upgrade.from ??= [];
  manifest.upgrade.migrations ??= [];

  if (!Array.isArray(manifest.stackProfiles) || manifest.stackProfiles.length === 0) {
    throw new CompilerError('MANIFEST-SCHEMA-002', `Manifest "${manifest.id}" must declare stackProfiles`);
  }
  if (!Array.isArray(manifest.installs) || manifest.installs.length === 0) {
    throw new CompilerError('MANIFEST-SCHEMA-003', `Manifest "${manifest.id}" must declare installs`);
  }
  for (const install of manifest.installs) {
    if (!install.kind || !install.from || !install.to) {
      throw new CompilerError('MANIFEST-SCHEMA-005', `Manifest "${manifest.id}" install entries require kind/from/to`);
    }
    if (!isSafeRelativePath(install.from) || !isSafeRelativePath(install.to)) {
      throw new CompilerError('MANIFEST-SCHEMA-006', `Manifest "${manifest.id}" install paths must stay inside their allowed roots`);
    }
  }
  for (const slot of manifest.slots) {
    if (!slot.target || !isSafeRelativePath(slot.target)) {
      throw new CompilerError('MANIFEST-SCHEMA-007', `Manifest "${manifest.id}" slot targets must stay inside the project tree`);
    }
    if (slot.writableZones?.some((zone) => !isSafeRelativePath(zone))) {
      throw new CompilerError('MANIFEST-SCHEMA-008', `Manifest "${manifest.id}" slot writableZones must stay inside the project tree`);
    }
  }
  for (const portal of manifest.uiPortals) {
    if (!portal.id) throw new CompilerError('MANIFEST-SCHEMA-009', `Manifest "${manifest.id}" UI Portals require an id`);
  }
  for (const hook of manifest.uiHooks) {
    if (!hook.targetPortal || !hook.component || !hook.importFrom) {
      throw new CompilerError('MANIFEST-SCHEMA-010', `Manifest "${manifest.id}" UI Hooks require targetPortal/component/importFrom`);
    }
  }
}

export async function loadManifestById(blockId: string, options: ManifestLoadOptions = {}): Promise<ManifestEntry> {
  const version = options.version;
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const registrySources = resolveRegistrySources(workspaceRoot, options.registrySources ?? []);

  for (const registrySource of registrySources) {
    const rootPath = rootManifestPath(registrySource.root, blockId);
    let rootSource: ManifestSourceBytes | null | undefined;

    if (version) {
      const manifestPath = versionedManifestPath(registrySource.root, blockId, version);
      const versionedSource = await tryReadManifestSource(manifestPath);
      if (versionedSource) {
        rootSource = await tryReadManifestSource(rootPath);
        const sourceDigest = mergedManifestSourceDigest(rootSource, versionedSource);
        const cacheKey = manifestCacheKey(workspaceRoot, registrySource, blockId, version, sourceDigest);
        const cached = manifestCache.get(cacheKey);
        if (cached) return cached;

        const versionedManifest = parseManifestSource(versionedSource);
        const rootManifest = rootSource ? parseManifestSource(rootSource) : null;
        const manifest = mergeVersionedManifest(rootManifest, versionedManifest);
        validateManifest(manifest);
        assertRequestedManifestIdentity(manifest, blockId, manifestPath);
        if (manifest.version === version) {
          const versionRoot = path.dirname(manifestPath);
          const resourceRoots = rootManifest ? [versionRoot, path.dirname(rootPath)] : [versionRoot];
          const entry = manifestEntryFromPath(registrySource, manifest, manifestPath, resourceRoots);
          manifestCache.set(cacheKey, entry);
          return entry;
        }
      }
    }

    rootSource ??= await tryReadManifestSource(rootPath);
    if (!rootSource) continue;
    const cacheKey = manifestCacheKey(workspaceRoot, registrySource, blockId, version, rootSource.digest);
    const cached = manifestCache.get(cacheKey);
    if (cached) return cached;

    const manifest = parseManifestSource(rootSource);
    validateManifest(manifest);
    assertRequestedManifestIdentity(manifest, blockId, rootPath);
    if (version && manifest.version !== version) continue;
    const entry = manifestEntryFromPath(registrySource, manifest, rootPath);
    manifestCache.set(cacheKey, entry);
    return entry;
  }

  throw new CompilerError(
    'MANIFEST-SCHEMA-004',
    version ? `Unknown block "${blockId}" version "${version}"` : `Unknown block "${blockId}"`
  );
}

export async function loadManifestForResolvedBlock(
  workspaceRoot: string,
  block: Pick<ResolvedBlock, 'id' | 'version' | 'registrySourceId' | 'registryKind' | 'registryLocation' | 'registryPath'>
): Promise<ManifestEntry> {
  return loadManifestById(block.id, {
    workspaceRoot,
    version: block.version,
    registrySources: [{
      id: block.registrySourceId,
      kind: block.registryKind,
      location: block.registryLocation,
      path: block.registryPath
    }]
  });
}

export async function loadAllManifests(options: ManifestLoadOptions = {}): Promise<ManifestEntry[]> {
  const manifests: ManifestEntry[] = [];
  const selectedIds = new Set<string>();
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());

  for (const registrySource of resolveRegistrySources(workspaceRoot, options.registrySources ?? [])) {
    let entries: Dirent[] = [];
    try {
      entries = await fs.readdir(registrySource.root, { withFileTypes: true });
    } catch (error) {
      if (isFileNotFoundError(error)) continue;
      throw error;
    }

    const directoryEntries = entries
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => compareCodeUnits(left.name, right.name));
    const sourceEntries = await Promise.all(directoryEntries.map(async (entry) => {
      const manifestPath = path.join(registrySource.root, entry.name, 'block.manifest.yaml');
      const source = await tryReadManifestSource(manifestPath);
      if (!source) {
        throw new CompilerError(
          'MANIFEST-SCHEMA-013',
          `Registry "${registrySource.id}" directory "${entry.name}" is missing block.manifest.yaml`
        );
      }
      const manifest = parseManifestSource(source);
      validateManifest(manifest);
      assertRegistryDirectoryIdentity(registrySource, entry.name, manifest, manifestPath);
      return manifestEntryFromPath(registrySource, manifest, manifestPath);
    }));

    const sourceIds = new Map<string, string>();
    for (const entry of sourceEntries) {
      const previousPath = sourceIds.get(entry.manifest.id);
      if (previousPath) {
        throw new CompilerError(
          'MANIFEST-SCHEMA-014',
          `Registry "${registrySource.id}" declares block "${entry.manifest.id}" more than once: "${previousPath}" and "${entry.manifestPath}"`
        );
      }
      sourceIds.set(entry.manifest.id, entry.manifestPath);
    }

    for (const entry of sourceEntries) {
      if (selectedIds.has(entry.manifest.id)) continue;
      selectedIds.add(entry.manifest.id);
      manifests.push(entry);
    }
  }

  return manifests;
}
