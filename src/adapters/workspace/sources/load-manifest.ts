import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { failureMessage } from '../../../contracts/failure-inspection.ts';
import { parseYamlValue } from '../../formats/yaml.ts';

import { assertSameNoFollowDirectoryIdentity, inspectNoFollowDirectoryChain, PhysicalNoFollowError } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { isCanonicalBlockId, isCanonicalRegistryVersion } from '../../../semantics/identity/block.ts';
import { compareCodeUnits, rawSha256 } from '../../../contracts/canonical.ts';
import { pathExists } from "../../filesystem/files.ts";
import { blockDirName, officialRegistryRelativePath, resolveRegistryRoot } from "../../workspace-context.ts";
import { resolvePathInside } from "../../../contracts/relative-path.ts";
import { isSafeRelativePath, posixPath } from '../../../contracts/relative-path.ts';
import type { BlockManifest, ManifestEntry, PlanRegistrySource, ResolvedBlock } from '../../../compiler/contract.ts';
import { CompilerError } from '../../../compiler/errors.ts';
import type { RegistryKind, RegistryLocation } from '../../../contracts/registry-source.ts';
import { manifestCache, type ManifestCacheKey } from './manifest-cache.ts';
import { decodeExactAuthorityUtf8, readOptionalAuthorityBytes } from './read-authority-source.ts';
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

export const MANIFEST_YAML_MAX_INPUT_BYTES = 1024 * 1024;
export const MANIFEST_YAML_MAX_ALIAS_COUNT = 100;

const MANIFEST_ROOT_FIELDS = new Set<keyof BlockManifest>([
  'id',
  'version',
  'kind',
  'stackProfiles',
  'compatibility',
  'requires',
  'provides',
  'conflicts',
  'installs',
  'pins',
  'acceptance',
  'upgrade',
  'contracts',
  'generators'
]);

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
  readonly path: string;
  readonly raw: string;
  readonly digest: `sha256:${string}`;
}

function tryReadManifestSource(manifestPath: string): ManifestSourceBytes | null {
  const bytes = readOptionalAuthorityBytes(manifestPath, 'Manifest source');
  if (bytes === null) return null;
  const raw = decodeExactAuthorityUtf8(bytes, `Manifest source ${path.resolve(manifestPath)}`);
  return { path: path.resolve(manifestPath), raw, digest: rawSha256(raw) };
}

function parseManifestSource(source: ManifestSourceBytes): BlockManifest {
  try {
    return parseYamlValue(source.raw, { label: `Manifest ${source.path}`,
      maximumInputBytes: MANIFEST_YAML_MAX_INPUT_BYTES,
      stringKeys: true, maximumAliasCount: MANIFEST_YAML_MAX_ALIAS_COUNT }) as BlockManifest;
  } catch (error) {
    throw new CompilerError('MANIFEST-SCHEMA-001',
      `Manifest YAML is invalid: ${source.path}: ${failureMessage(error)}`,
      { manifestPath: source.path }, { cause: error });
  }
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

function validateRegistrySource(source: PlanRegistrySource): void {
  if (!source || typeof source !== 'object' || typeof source.id !== 'string' || source.id.length === 0) {
    throw new CompilerError('MANIFEST-SCHEMA-016', 'Registry source requires one non-empty id');
  }
  if (source.kind !== 'official' && source.kind !== 'private' && source.kind !== 'community') {
    throw new CompilerError(
      'MANIFEST-SCHEMA-016',
      `Registry source "${source.id}" has unsupported kind "${String(source.kind)}"`
    );
  }
  if (source.location !== 'compiler' && source.location !== 'workspace') {
    throw new CompilerError(
      'MANIFEST-SCHEMA-016',
      `Registry source "${source.id}" has unsupported location "${String(source.location)}"`
    );
  }
  if (source.location === 'compiler' && source.kind !== 'official') {
    throw new CompilerError(
      'MANIFEST-SCHEMA-016',
      `Registry source "${source.id}" cannot use compiler location unless it is official`
    );
  }
  if (typeof source.path !== 'string' || !isSafeRelativePath(source.path)) {
    throw new CompilerError(
      'MANIFEST-SCHEMA-016',
      `Registry source "${source.id}" has an unsafe relative path`
    );
  }
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

  return effectiveSources.map((source) => {
    validateRegistrySource(source);
    return {
      id: source.id,
      kind: source.kind,
      location: source.location,
      path: posixPath(source.path),
      root: resolveRegistryRoot(workspaceRoot, source.location, source.path)
    };
  });
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

function assertRequestedManifestLocator(blockId: string, version: string | undefined): void {
  if (!isCanonicalBlockId(blockId)) {
    throw new CompilerError(
      'MANIFEST-SCHEMA-015',
      `Manifest block id "${blockId}" is not one canonical lowercase namespace/name identity`
    );
  }
  if (version !== undefined && !isCanonicalRegistryVersion(version)) {
    throw new CompilerError(
      'MANIFEST-SCHEMA-015',
      `Manifest version "${version}" is not one canonical registry version`
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
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new CompilerError('MANIFEST-SCHEMA-001', 'Manifest must be one object');
  }
  const unknownFields = Object.keys(manifest).filter((field) => !MANIFEST_ROOT_FIELDS.has(field as keyof BlockManifest));
  if (unknownFields.length > 0) {
    throw new CompilerError(
      'MANIFEST-SCHEMA-001',
      `Manifest has unsupported fields: ${unknownFields.sort().join(', ')}`
    );
  }
  if (!isCanonicalBlockId(manifest.id) || !isCanonicalRegistryVersion(manifest.version)) {
    throw new CompilerError(
      'MANIFEST-SCHEMA-015',
      `Manifest has a non-canonical id/version locator: ${String(manifest.id)}@${String(manifest.version)}`
    );
  }
  if (manifest.kind !== 'capability' && manifest.kind !== 'strategy' && manifest.kind !== 'infra' && manifest.kind !== 'governance') {
    throw new CompilerError('MANIFEST-SCHEMA-001', `Manifest "${manifest.id}" has unsupported kind "${String(manifest.kind)}"`);
  }
  manifest.stackProfiles ??= [];
  if (!Array.isArray(manifest.stackProfiles)) {
    throw new CompilerError('MANIFEST-SCHEMA-002', `Manifest "${manifest.id}" stackProfiles must be an array`);
  }
  manifest.compatibility ??= {
    blockApi: '1',
    compilerApi: '1',
    stackProfiles: [...manifest.stackProfiles]
  };
  manifest.requires ??= [];
  manifest.provides ??= [];
  manifest.conflicts ??= [];
  if (!Array.isArray(manifest.requires) || !Array.isArray(manifest.provides) || !Array.isArray(manifest.conflicts)) {
    throw new CompilerError('MANIFEST-SCHEMA-001', `Manifest "${manifest.id}" dependency declarations must be arrays`);
  }
  normalizeAndValidateSemanticManifestFields(manifest);
  manifest.installs ??= [];
  manifest.pins = {
    inputs: manifest.pins?.inputs ?? [],
    outputs: manifest.pins?.outputs ?? []
  };
  manifest.acceptance ??= [];
  manifest.upgrade ??= { from: [], migrations: [] };
  manifest.upgrade.from ??= [];
  manifest.upgrade.migrations ??= [];

  if (manifest.stackProfiles.length === 0) {
    throw new CompilerError('MANIFEST-SCHEMA-002', `Manifest "${manifest.id}" must declare stackProfiles`);
  }
  if (!Array.isArray(manifest.installs) || manifest.installs.length === 0) {
    throw new CompilerError('MANIFEST-SCHEMA-003', `Manifest "${manifest.id}" must declare installs`);
  }
  if (!Array.isArray(manifest.acceptance)) {
    throw new CompilerError('MANIFEST-SCHEMA-001', `Manifest "${manifest.id}" collection fields must be arrays`);
  }
  if (!Array.isArray(manifest.pins.inputs) || !Array.isArray(manifest.pins.outputs)) {
    throw new CompilerError('MANIFEST-SCHEMA-001', `Manifest "${manifest.id}" pins must be arrays`);
  }
  if (!Array.isArray(manifest.upgrade.from) || !Array.isArray(manifest.upgrade.migrations)) {
    throw new CompilerError('MANIFEST-SCHEMA-001', `Manifest "${manifest.id}" upgrade fields must be arrays`);
  }

  for (const install of manifest.installs) {
    if (!install || typeof install !== 'object' || !install.kind || !install.from || !install.to) {
      throw new CompilerError('MANIFEST-SCHEMA-005', `Manifest "${manifest.id}" install entries require kind/from/to`);
    }
    if (!isSafeRelativePath(install.from) || !isSafeRelativePath(install.to)) {
      throw new CompilerError('MANIFEST-SCHEMA-006', `Manifest "${manifest.id}" install paths must stay inside their allowed roots`);
    }
  }
}

/** Retained Manifest lookup is synchronous. `loadAllManifests` stays async because registry enumeration uses fs.readdir. */
export function loadManifestById(blockId: string, options: ManifestLoadOptions = {}): ManifestEntry {
  const version = options.version;
  assertRequestedManifestLocator(blockId, version);
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const registrySources = resolveRegistrySources(workspaceRoot, options.registrySources ?? []);

  for (const registrySource of registrySources) {
    const rootPath = rootManifestPath(registrySource.root, blockId);
    let rootSource: ManifestSourceBytes | null | undefined;

    if (version) {
      const manifestPath = versionedManifestPath(registrySource.root, blockId, version);
      const versionedSource = tryReadManifestSource(manifestPath);
      if (versionedSource) {
        rootSource = tryReadManifestSource(rootPath);
        const sourceDigest = mergedManifestSourceDigest(rootSource, versionedSource);
        const cacheKey = manifestCacheKey(workspaceRoot, registrySource, blockId, version, sourceDigest);
        const cached = manifestCache.get(cacheKey);
        if (cached) return cached;

        const versionedManifest = parseManifestSource(versionedSource);
        const rootManifest = rootSource ? parseManifestSource(rootSource) : null;
        const manifest = mergeVersionedManifest(rootManifest, versionedManifest);
        validateManifest(manifest);
        assertRequestedManifestIdentity(manifest, blockId, manifestPath);
        if (manifest.version !== version) {
          throw new CompilerError(
            'MANIFEST-SCHEMA-022',
            `Versioned manifest at "${manifestPath}" declares version "${manifest.version}" but was addressed as "${version}"`
          );
        }
        const versionRoot = path.dirname(manifestPath);
        const resourceRoots = rootManifest ? [versionRoot, path.dirname(rootPath)] : [versionRoot];
        const entry = manifestEntryFromPath(registrySource, manifest, manifestPath, resourceRoots);
        manifestCache.set(cacheKey, entry);
        return entry;
      }
    }

    rootSource ??= tryReadManifestSource(rootPath);
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

export function loadManifestForResolvedBlock(
  workspaceRoot: string,
  block: Pick<ResolvedBlock, 'id' | 'version' | 'registrySourceId' | 'registryKind' | 'registryLocation' | 'registryPath'>
): ManifestEntry {
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
    let registryRoot;
    try {
      registryRoot = inspectNoFollowDirectoryChain(
        path.resolve(registrySource.root),
        `Registry ${registrySource.id} root`
      ).target;
    } catch (error) {
      if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') continue;
      throw error;
    }

    const entries: Dirent[] = await fs.readdir(registryRoot.path, { withFileTypes: true });
    assertSameNoFollowDirectoryIdentity(registryRoot, `Registry ${registrySource.id} root`);

    const directoryEntries = entries
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => compareCodeUnits(left.name, right.name));
    const sourceEntries = directoryEntries.map((entry) => {
      const manifestPath = path.join(registryRoot.path, entry.name, 'block.manifest.yaml');
      const source = tryReadManifestSource(manifestPath);
      if (!source) {
        throw new CompilerError(
          'MANIFEST-SCHEMA-013',
          `Registry "${registrySource.id}" directory "${entry.name}" is missing block.manifest.yaml`
        );
      }
      const cached = manifestCache.getByObservedSource({ workspaceRoot,
        registrySourceId: registrySource.id, registryKind: registrySource.kind,
        registryLocation: registrySource.location, registryPath: registrySource.path,
        manifestPath, sourceDigest: source.digest });
      if (cached !== undefined) {
        assertRegistryDirectoryIdentity(registrySource, entry.name, cached.manifest, manifestPath);
        // Catalog callers historically receive mutable independent entries.
        // Reuse validated parse work without exposing the cache's shared object.
        return structuredClone(cached);
      }
      const manifest = parseManifestSource(source);
      validateManifest(manifest);
      assertRegistryDirectoryIdentity(registrySource, entry.name, manifest, manifestPath);
      const parsed = manifestEntryFromPath(registrySource, manifest, manifestPath);
      manifestCache.set(manifestCacheKey(workspaceRoot, registrySource, manifest.id, undefined, source.digest),
        structuredClone(parsed));
      return parsed;
    });

    assertSameNoFollowDirectoryIdentity(registryRoot, `Registry ${registrySource.id} root`);
    for (const entry of sourceEntries) {
      if (selectedIds.has(entry.manifest.id)) continue;
      selectedIds.add(entry.manifest.id);
      manifests.push(entry);
    }
  }

  return manifests;
}
