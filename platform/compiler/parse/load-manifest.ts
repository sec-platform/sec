import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CompilerError } from '../../shared/errors.ts';
import type { ResolvedBlock } from '../../shared/lock-types.ts';
import {
  blockDirName,
  isSafeRelativePath,
  officialRegistryRelativePath,
  resolveRegistryRoot
} from '../../shared/paths.ts';
import type {
  BlockManifest,
  ManifestEntry,
  PlanRegistrySource
} from '../../shared/plan-manifest-types.ts';
import type { RegistryKind, RegistryLocation } from '../../shared/registry-types.ts';
import { readYaml } from '../../shared/yaml.ts';

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

async function tryReadManifest(manifestPath: string): Promise<BlockManifest | null> {
  try {
    return await readYaml<BlockManifest>(manifestPath);
  } catch (error) {
    if (error instanceof Error && 'code' in error && (error as { code?: string }).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export function resolveRegistrySources(
  workspaceRoot = process.cwd(),
  sources: PlanRegistrySource[]
): ResolvedRegistrySource[] {
  const effectiveSources = sources.length > 0
    ? sources
    : [
        {
          id: 'official',
          kind: 'official',
          location: 'compiler',
          path: officialRegistryRelativePath.replaceAll('\\', '/')
        } satisfies PlanRegistrySource
      ];

  return effectiveSources.map((source) => ({
    id: source.id,
    kind: source.kind,
    location: source.location,
    path: source.path.replaceAll('\\', '/'),
    root: resolveRegistryRoot(workspaceRoot, source.location, source.path)
  }));
}

function manifestEntryFromPath(
  registrySource: ResolvedRegistrySource,
  manifest: BlockManifest,
  manifestPath: string
): ManifestEntry {
  return {
    manifest,
    manifestPath,
    manifestRoot: path.dirname(manifestPath),
    registryRoot: registrySource.root,
    registrySourceId: registrySource.id,
    registryKind: registrySource.kind,
    registryLocation: registrySource.location,
    registryPath: registrySource.path
  };
}

export function validateManifest(manifest: BlockManifest): void {
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
  manifest.installs ??= [];
  manifest.pins = {
    inputs: manifest.pins?.inputs ?? [],
    outputs: manifest.pins?.outputs ?? []
  };
  manifest.slots ??= [];
  manifest.acceptance ??= [];
  manifest.routes ??= [];
  manifest.upgrade ??= {
    from: [],
    migrations: []
  };
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
}

export async function loadManifestById(blockId: string, options: ManifestLoadOptions = {}): Promise<ManifestEntry> {
  const version = options.version;
  const registrySources = resolveRegistrySources(options.workspaceRoot, options.registrySources ?? []);

  for (const registrySource of registrySources) {
    const candidatePaths = version
      ? [versionedManifestPath(registrySource.root, blockId, version), rootManifestPath(registrySource.root, blockId)]
      : [rootManifestPath(registrySource.root, blockId)];

    for (const manifestPath of candidatePaths) {
      const manifest = await tryReadManifest(manifestPath);
      if (!manifest) {
        continue;
      }
      validateManifest(manifest);
      if (version && manifest.version !== version) {
        continue;
      }
      return manifestEntryFromPath(registrySource, manifest, manifestPath);
    }
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
    registrySources: [
      {
        id: block.registrySourceId,
        kind: block.registryKind,
        location: block.registryLocation,
        path: block.registryPath
      }
    ]
  });
}

export async function loadAllManifests(options: ManifestLoadOptions = {}): Promise<ManifestEntry[]> {
  const manifests: ManifestEntry[] = [];
  const seenIds = new Set<string>();

  for (const registrySource of resolveRegistrySources(options.workspaceRoot, options.registrySources ?? [])) {
    let entries: Dirent[] = [];
    try {
      entries = await fs.readdir(registrySource.root, { withFileTypes: true });
    } catch (error) {
      if (error instanceof Error && 'code' in error && (error as { code?: string }).code === 'ENOENT') {
        continue;
      }
      throw error;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const manifestPath = path.join(registrySource.root, entry.name, 'block.manifest.yaml');
      const manifest = await readYaml<BlockManifest>(manifestPath);
      validateManifest(manifest);
      if (seenIds.has(manifest.id)) {
        continue;
      }
      seenIds.add(manifest.id);
      manifests.push(manifestEntryFromPath(registrySource, manifest, manifestPath));
    }
  }

  return manifests;
}
