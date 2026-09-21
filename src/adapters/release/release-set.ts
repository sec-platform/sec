import { materializeDocumentationPackage, assertDocumentationSourceReadback } from './documentation-source.ts';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { digest, isPlainObject, sha256 } from '../../contracts/canonical.ts';
import { parseExactJson } from '../../contracts/exact-json.ts';
import { isCanonicalPortableLogicalPath } from '../../contracts/logical-path.ts';
import { acquirePhysicalMutationLease } from '../runtime-state/physical/runtime/mutation-lease.ts';
import {
  assertSameNoFollowDirectoryIdentity,
  inspectExactNoFollowDirectoryPresence,
  inspectNoFollowDirectoryChain,
  relocateRetainedNoFollowDirectory,
  type PhysicalDirectoryIdentity
} from '../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS,
  packageArtifactLauncherScript
} from '../toolchain/runtime.ts';
import { generatedRuntimeDependencyCapabilityNames } from '../toolchain/dependencies/contract/dependency-capability-contract.ts';
import { releaseBunEntrypointBytes } from './release-artifact.ts';
import {
  buildFrozenReleaseBundle,
  disposeFrozenReleaseSource,
  prepareFrozenReleaseSource,
  type FrozenReleaseSource,
  type ReleaseBuilderIdentity
} from './release-source-materialization.ts';

export const RUNTIME_PACKAGE_MANIFEST = 'runtime-package-manifest.json' as const;
export const DOCUMENTATION_PACKAGE_MANIFEST = 'documentation-package-manifest.json' as const;
export const RELEASE_SET_MANIFEST = 'release-set-manifest.json' as const;

const DOCUMENTATION_BASELINE = '.documentation/baseline.json' as const;
const DOCUMENTATION_SOURCE_MANIFEST = '.documentation/source-manifest.json' as const;
const THIRD_PARTY_NOTICE = 'THIRD_PARTY_NOTICES.json' as const;
const RUNTIME_REQUIRED_ROOT_FILES = Object.freeze([
  'package.json',
  'bun.lock',
  '.bun-version',
  'LICENSE',
  'NOTICE',
  'REUSE.toml'
]);
const RUNTIME_OPTIONAL_ROOT_FILES = Object.freeze(['mise.toml', 'bunfig.toml']);
const RUNTIME_OPTIONAL_ROOT_DIRECTORIES = Object.freeze(['LICENSES']);
const RUNTIME_REQUIRED_PACKAGE_FILES = Object.freeze([
  ...RUNTIME_REQUIRED_ROOT_FILES,
  THIRD_PARTY_NOTICE
]);

export interface ReleasePackageFile {
  readonly path: string;
  readonly bytes: number;
  readonly digest: `sha256:${string}`;
  readonly executable: boolean;
}

export interface RuntimePackageManifest {
  readonly schema: 'sec-runtime-package-manifest-v1';
  readonly packageVersion: string;
  readonly sourceCommit: string;
  readonly sourceTree: string;
  readonly dependencyLockDigest: `sha256:${string}`;
  readonly builder: ReleaseBuilderIdentity;
  readonly entrypoint: string;
  readonly files: readonly ReleasePackageFile[];
  readonly contentDigest: `sha256:${string}`;
}

export interface DocumentationPackageManifest {
  readonly schema: 'sec-documentation-package-manifest-v2';
  readonly sourceCommit: string;
  readonly sourceTree: string;
  readonly sourceSetSha256: `sha256:${string}`;
  readonly entrypoint: string;
  readonly files: readonly ReleasePackageFile[];
  readonly contentDigest: `sha256:${string}`;
}

export interface ReleaseSetMember {
  readonly name: 'documentation' | 'runtime';
  readonly manifestPath: string;
  readonly manifestDigest: `sha256:${string}`;
  readonly fileCount: number;
}

export interface ReleaseSetManifest {
  readonly schema: 'sec-release-set-manifest-v1';
  readonly sourceCommit: string;
  readonly sourceTree: string;
  readonly members: readonly ReleaseSetMember[];
  readonly contentDigest: `sha256:${string}`;
}

export interface ReleaseSetCleanupFinding {
  readonly phase: 'previous-release-set' | 'release-set-stage' | 'frozen-source';
  readonly path: string;
  readonly state: 'cleanup-unconfirmed';
  readonly detail: string;
}

export interface ReleaseSetBuildReceipt {
  readonly schema: 'sec-release-set-build-receipt-v1';
  readonly publicationStatus: 'accepted';
  readonly sourceCommit: string;
  readonly sourceTree: string;
  readonly artifactRoot: string;
  readonly manifestDigest: `sha256:${string}`;
  readonly fileCount: number;
  readonly cleanupFindings: readonly ReleaseSetCleanupFinding[];
}

type ThirdPartyNoticePackage = Readonly<{
  name: string;
  version: string;
  license: string;
  licenseFiles: readonly string[];
}>;

function failureText(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error);
  } catch {
    return '<unprintable failure>';
  }
}

function exactRecord(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!isPlainObject(value) || Object.keys(value).length !== keys.length
      || keys.some((key) => !Object.hasOwn(value, key))) {
    throw new Error(`${label} must contain exactly its declared fields`);
  }
  return value;
}

function nonemptyText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0');
}

function gitObjectId(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(value);
}

function prefixedDigest(value: unknown): value is `sha256:${string}` {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function memberPath(value: unknown, forbidden: readonly string[] = []): value is string {
  return nonemptyText(value)
    && isCanonicalPortableLogicalPath(value)
    && !forbidden.includes(value);
}

function assertBuilder(value: unknown, label: string): asserts value is ReleaseBuilderIdentity {
  const record = exactRecord(value, [
    'schema', 'runtime', 'version', 'executableSha256', 'platform', 'architecture'
  ], label);
  if (record.schema !== 'sec-release-builder-identity-v1' || record.runtime !== 'bun'
      || !nonemptyText(record.version) || !prefixedDigest(record.executableSha256)
      || !nonemptyText(record.platform) || !nonemptyText(record.architecture)) {
    throw new Error(`${label} is invalid`);
  }
}

function parseFileInventory(
  value: unknown,
  label: string,
  forbidden: readonly string[]
): readonly ReleasePackageFile[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  const seen = new Set<string>();
  const files: ReleasePackageFile[] = [];
  for (const raw of value) {
    const file = exactRecord(raw, ['path', 'bytes', 'digest', 'executable'], `${label} member`);
    if (!memberPath(file.path, forbidden)
        || typeof file.bytes !== 'number' || !Number.isSafeInteger(file.bytes)
        || file.bytes < 0 || Object.is(file.bytes, -0)
        || !prefixedDigest(file.digest) || typeof file.executable !== 'boolean') {
      throw new Error(`${label} member is invalid`);
    }
    if (seen.has(file.path)) throw new Error(`${label} contains a duplicate path`);
    seen.add(file.path);
    files.push(Object.freeze(file as unknown as ReleasePackageFile));
  }
  return Object.freeze(files);
}

function decodeJson(bytes: Uint8Array, label: string, keys: readonly string[], depth: number): Record<string, unknown> {
  const source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  return parseExactJson(source, label, { rootObjectKeys: keys }, depth) as Record<string, unknown>;
}

export function parseRuntimePackageManifestBytes(
  bytes: Uint8Array,
  label = 'Runtime package manifest'
): RuntimePackageManifest {
  const root = decodeJson(bytes, label, [
    'schema', 'packageVersion', 'sourceCommit', 'sourceTree', 'dependencyLockDigest',
    'builder', 'entrypoint', 'files', 'contentDigest'
  ], 3);
  if (root.schema !== 'sec-runtime-package-manifest-v1' || !nonemptyText(root.packageVersion)
      || !gitObjectId(root.sourceCommit) || !gitObjectId(root.sourceTree)
      || root.sourceCommit.length !== root.sourceTree.length
      || !prefixedDigest(root.dependencyLockDigest)
      || !memberPath(root.entrypoint, [RUNTIME_PACKAGE_MANIFEST])
      || !prefixedDigest(root.contentDigest)) {
    throw new Error(`${label} identity is invalid`);
  }
  assertBuilder(root.builder, `${label} builder`);
  const files = parseFileInventory(root.files, `${label} files`, [RUNTIME_PACKAGE_MANIFEST]);
  if (!files.some((file) => file.path === root.entrypoint && file.executable)) {
    throw new Error(`${label} entrypoint must be one executable package member`);
  }
  for (const required of RUNTIME_REQUIRED_PACKAGE_FILES) {
    if (!files.some((file) => file.path === required)) {
      throw new Error(`${label} is missing required package member ${required}`);
    }
  }
  const material = {
    schema: root.schema,
    packageVersion: root.packageVersion,
    sourceCommit: root.sourceCommit,
    sourceTree: root.sourceTree,
    dependencyLockDigest: root.dependencyLockDigest,
    builder: root.builder,
    entrypoint: root.entrypoint,
    files
  };
  if (sha256(material) !== root.contentDigest) throw new Error(`${label} digest is invalid`);
  return Object.freeze({ ...material, contentDigest: root.contentDigest }) as RuntimePackageManifest;
}

export function parseDocumentationPackageManifestBytes(
  bytes: Uint8Array,
  label = 'Documentation package manifest'
): DocumentationPackageManifest {
  const root = decodeJson(bytes, label, [
    'schema', 'sourceCommit', 'sourceTree', 'sourceSetSha256', 'entrypoint', 'files', 'contentDigest'
  ], 3);
  if (root.schema !== 'sec-documentation-package-manifest-v2'
      || !gitObjectId(root.sourceCommit) || !gitObjectId(root.sourceTree)
      || root.sourceCommit.length !== root.sourceTree.length
      || !prefixedDigest(root.sourceSetSha256)
      || !memberPath(root.entrypoint, [DOCUMENTATION_PACKAGE_MANIFEST])
      || !prefixedDigest(root.contentDigest)) {
    throw new Error(`${label} identity is invalid`);
  }
  const files = parseFileInventory(root.files, `${label} files`, [DOCUMENTATION_PACKAGE_MANIFEST]);
  if (!files.some((file) => file.path === root.entrypoint)) {
    throw new Error(`${label} entrypoint is not a package member`);
  }
  for (const required of [DOCUMENTATION_BASELINE, DOCUMENTATION_SOURCE_MANIFEST, 'REUSE.toml']) {
    if (!files.some((file) => file.path === required)) {
      throw new Error(`${label} is missing required documentation member ${required}`);
    }
  }
  const material = {
    schema: root.schema,
    sourceCommit: root.sourceCommit,
    sourceTree: root.sourceTree,
    sourceSetSha256: root.sourceSetSha256,
    entrypoint: root.entrypoint,
    files
  };
  if (sha256(material) !== root.contentDigest) throw new Error(`${label} digest is invalid`);
  return Object.freeze({ ...material, contentDigest: root.contentDigest }) as DocumentationPackageManifest;
}

export function parseReleaseSetManifestBytes(
  bytes: Uint8Array,
  label = 'Release set manifest'
): ReleaseSetManifest {
  const root = decodeJson(bytes, label, [
    'schema', 'sourceCommit', 'sourceTree', 'members', 'contentDigest'
  ], 3);
  if (root.schema !== 'sec-release-set-manifest-v1'
      || !gitObjectId(root.sourceCommit) || !gitObjectId(root.sourceTree)
      || root.sourceCommit.length !== root.sourceTree.length
      || !prefixedDigest(root.contentDigest) || !Array.isArray(root.members)
      || root.members.length !== 2) {
    throw new Error(`${label} identity is invalid`);
  }
  const members: ReleaseSetMember[] = [];
  const names = new Set<string>();
  for (const raw of root.members) {
    const member = exactRecord(raw, [
      'name', 'manifestPath', 'manifestDigest', 'fileCount'
    ], `${label} member`);
    const expectedManifestPath = member.name === 'documentation'
      ? `documentation/${DOCUMENTATION_PACKAGE_MANIFEST}`
      : member.name === 'runtime'
        ? `runtime/${RUNTIME_PACKAGE_MANIFEST}`
        : null;
    if (expectedManifestPath === null
        || names.has(member.name) || member.manifestPath !== expectedManifestPath
        || !prefixedDigest(member.manifestDigest)
        || typeof member.fileCount !== 'number' || !Number.isSafeInteger(member.fileCount)
        || member.fileCount < 1) {
      throw new Error(`${label} member is invalid`);
    }
    names.add(member.name);
    members.push(Object.freeze(member as unknown as ReleaseSetMember));
  }
  members.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  if (members[0]?.name !== 'documentation' || members[1]?.name !== 'runtime') {
    throw new Error(`${label} does not contain the canonical member set`);
  }
  const material = {
    schema: root.schema,
    sourceCommit: root.sourceCommit,
    sourceTree: root.sourceTree,
    members: Object.freeze(members)
  };
  if (sha256(material) !== root.contentDigest) throw new Error(`${label} digest is invalid`);
  return Object.freeze({ ...material, contentDigest: root.contentDigest }) as ReleaseSetManifest;
}

async function inventoryFiles(root: string, excluded: readonly string[]): Promise<readonly ReleasePackageFile[]> {
  const files: ReleasePackageFile[] = [];
  async function walk(directory: string, prefix: string): Promise<void> {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (excluded.includes(relative)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Release package contains a symbolic link: ${relative}`);
      if (entry.isDirectory()) {
        await walk(absolute, relative);
        continue;
      }
      if (!entry.isFile()) throw new Error(`Release package contains a non-ordinary entry: ${relative}`);
      const [bytes, metadata] = await Promise.all([fs.readFile(absolute), fs.stat(absolute)]);
      files.push(Object.freeze({
        path: relative.replaceAll('\\', '/'),
        bytes: bytes.byteLength,
        digest: `sha256:${digest(bytes)}` as `sha256:${string}`,
        executable: (metadata.mode & 0o111) !== 0
      }));
    }
  }
  await walk(root, '');
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return Object.freeze(files);
}

function sameInventory(left: readonly ReleasePackageFile[], right: readonly ReleasePackageFile[]): boolean {
  return sha256(left) === sha256(right);
}

async function writeJsonExclusive(target: string, value: unknown): Promise<Buffer> {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.writeFile(target, bytes, { flag: 'wx' });
  return bytes;
}

async function copyOrdinaryFile(source: string, destination: string): Promise<void> {
  const metadata = await fs.lstat(source);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error(`Release source member is not one ordinary file: ${source}`);
  }
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
  await fs.chmod(destination, metadata.mode & 0o777);
}

async function copyOrdinaryTree(source: string, destination: string): Promise<void> {
  const metadata = await fs.lstat(source);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`Release source tree is not one ordinary directory: ${source}`);
  }
  await fs.mkdir(destination, { recursive: true });
  const entries = await fs.readdir(source, { withFileTypes: true });
  entries.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  for (const entry of entries) {
    const from = path.join(source, entry.name);
    const to = path.join(destination, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Release source tree contains a symbolic link: ${from}`);
    if (entry.isDirectory()) await copyOrdinaryTree(from, to);
    else if (entry.isFile()) await copyOrdinaryFile(from, to);
    else throw new Error(`Release source tree contains a non-ordinary entry: ${from}`);
  }
}

function sourceInputAbsolutePath(sourceRoot: string, inputPath: string): string | null {
  if (inputPath.startsWith('node:') || inputPath.startsWith('bun:')) return null;
  return path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(sourceRoot, inputPath);
}

function packageRootForInput(sourceRoot: string, inputPath: string): string | null {
  const absolute = sourceInputAbsolutePath(sourceRoot, inputPath);
  if (absolute === null) return null;
  const modulesRoot = path.join(path.resolve(sourceRoot), 'node_modules');
  const relative = path.relative(modulesRoot, absolute);
  if (relative === '' || path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) {
    return null;
  }
  const parts = relative.split(path.sep);
  const count = parts[0]?.startsWith('@') ? 2 : 1;
  if (parts.length < count) return null;
  return path.join(modulesRoot, ...parts.slice(0, count));
}

async function materializeThirdPartyLicenseEvidence(
  source: FrozenReleaseSource,
  inputPaths: readonly string[],
  runtimeRoot: string
): Promise<void> {
  const roots = [...new Set(inputPaths.map((input) => packageRootForInput(source.root, input)).filter(
    (value): value is string => value !== null
  ))].sort();
  const notices: ThirdPartyNoticePackage[] = [];
  const evidenceRoot = path.join(runtimeRoot, 'THIRD_PARTY_LICENSES');
  for (const packageRoot of roots) {
    const packageJsonPath = path.join(packageRoot, 'package.json');
    const parsed = JSON.parse(await fs.readFile(packageJsonPath, 'utf8')) as Record<string, unknown>;
    if (!nonemptyText(parsed.name) || !nonemptyText(parsed.version) || !nonemptyText(parsed.license)) {
      throw new Error(`Bundled package has incomplete license metadata: ${packageRoot}`);
    }
    const entries = await fs.readdir(packageRoot, { withFileTypes: true });
    const licenseNames = entries
      .filter((entry) => entry.isFile() && /^(?:licen[cs]e|copying|notice)(?:\..*)?$/iu.test(entry.name))
      .map((entry) => entry.name)
      .sort();
    if (licenseNames.length === 0) {
      throw new Error(`Bundled package has no distributable license file: ${parsed.name}@${parsed.version}`);
    }
    const packageIdentityDigest = sha256(Object.freeze({
      name: parsed.name,
      version: parsed.version
    })).slice('sha256:'.length);
    const directoryName = `package-${packageIdentityDigest}`;
    const destinationRoot = path.join(evidenceRoot, directoryName);
    for (const fileName of licenseNames) {
      await copyOrdinaryFile(path.join(packageRoot, fileName), path.join(destinationRoot, fileName));
    }
    notices.push(Object.freeze({
      name: parsed.name,
      version: parsed.version,
      license: parsed.license,
      licenseFiles: Object.freeze(licenseNames.map((name) => `THIRD_PARTY_LICENSES/${directoryName}/${name}`))
    }));
  }
  await writeJsonExclusive(path.join(runtimeRoot, THIRD_PARTY_NOTICE), Object.freeze({
    schema: 'sec-third-party-notices-v1',
    packages: Object.freeze(notices)
  }));
}

async function writePortablePackageJson(
  source: FrozenReleaseSource,
  runtimeRoot: string
): Promise<void> {
  const raw = JSON.parse(await fs.readFile(path.join(source.root, 'package.json'), 'utf8')) as Record<string, unknown>;
  if (!nonemptyText(raw.name) || raw.version !== source.packageVersion
      || raw.type !== 'module' || !nonemptyText(raw.packageManager)
      || typeof raw.bin !== 'object' || raw.bin === null) {
    throw new Error('Frozen package metadata is incomplete for portable runtime publication');
  }
  const sourceDependencies = isPlainObject(raw.dependencies) ? raw.dependencies : Object.freeze({});
  const sourceDevDependencies = isPlainObject(raw.devDependencies) ? raw.devDependencies : Object.freeze({});
  const selectManagedDependencies = (
    sourceSection: Record<string, unknown>,
    names: readonly string[],
    section: 'dependencies' | 'devDependencies'
  ): Readonly<Record<string, string>> => Object.freeze(Object.fromEntries(names.map((name) => {
    const version = sourceSection[name];
    if (!nonemptyText(version)) {
      throw new Error(`Portable runtime is missing managed ${section} declaration: ${name}`);
    }
    return [name, version];
  })));
  const dependencies = selectManagedDependencies(
    sourceDependencies,
    generatedRuntimeDependencyCapabilityNames('dependency'),
    'dependencies'
  );
  const devDependencies = selectManagedDependencies(
    sourceDevDependencies,
    generatedRuntimeDependencyCapabilityNames('devDependency'),
    'devDependencies'
  );
  const portable = Object.freeze({
    name: raw.name,
    version: raw.version,
    ...(raw.description === undefined ? {} : { description: raw.description }),
    ...(raw.license === undefined ? {} : { license: raw.license }),
    ...(raw.author === undefined ? {} : { author: raw.author }),
    ...(raw.repository === undefined ? {} : { repository: raw.repository }),
    ...(raw.bugs === undefined ? {} : { bugs: raw.bugs }),
    ...(raw.homepage === undefined ? {} : { homepage: raw.homepage }),
    ...(raw.keywords === undefined ? {} : { keywords: raw.keywords }),
    private: true,
    type: 'module',
    packageManager: raw.packageManager,
    bin: raw.bin,
    scripts: Object.freeze({
      [source.entrypoint.command]: packageArtifactLauncherScript(source.entrypoint.artifact)
    }),
    dependencies,
    devDependencies
  });
  await writeJsonExclusive(path.join(runtimeRoot, 'package.json'), portable);
}

async function buildRuntimePackage(
  source: FrozenReleaseSource,
  runtimeRoot: string
): Promise<RuntimePackageManifest> {
  await fs.mkdir(runtimeRoot, { recursive: true });
  const distRoot = path.join(runtimeRoot, path.posix.dirname(source.entrypoint.artifact));
  await fs.mkdir(distRoot, { recursive: true });
  const bundle = await buildFrozenReleaseBundle(source, distRoot, { externalPackageNames: [] });

  const entrypointPath = path.join(runtimeRoot, ...source.entrypoint.artifact.split('/'));
  await fs.writeFile(entrypointPath, releaseBunEntrypointBytes(await fs.readFile(entrypointPath)));
  await fs.chmod(entrypointPath, 0o755);

  for (const relativePath of Object.values(COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS)) {
    await copyOrdinaryTree(
      path.join(source.root, relativePath),
      path.join(distRoot, relativePath)
    );
  }
  for (const fileName of RUNTIME_REQUIRED_ROOT_FILES) {
    if (fileName === 'package.json') continue;
    await copyOrdinaryFile(path.join(source.root, fileName), path.join(runtimeRoot, fileName));
  }
  await writePortablePackageJson(source, runtimeRoot);
  for (const fileName of RUNTIME_OPTIONAL_ROOT_FILES) {
    try {
      await copyOrdinaryFile(path.join(source.root, fileName), path.join(runtimeRoot, fileName));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  for (const directoryName of RUNTIME_OPTIONAL_ROOT_DIRECTORIES) {
    try {
      await copyOrdinaryTree(path.join(source.root, directoryName), path.join(runtimeRoot, directoryName));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  await materializeThirdPartyLicenseEvidence(source, bundle.inputPaths, runtimeRoot);

  const files = await inventoryFiles(runtimeRoot, [RUNTIME_PACKAGE_MANIFEST]);
  const material = Object.freeze({
    schema: 'sec-runtime-package-manifest-v1' as const,
    packageVersion: source.packageVersion,
    sourceCommit: source.sourceCommit,
    sourceTree: source.sourceTree,
    dependencyLockDigest: source.dependencyLockDigest,
    builder: source.builder,
    entrypoint: source.entrypoint.artifact,
    files
  });
  const manifest = Object.freeze({
    ...material,
    contentDigest: sha256(material) as `sha256:${string}`
  });
  await writeJsonExclusive(path.join(runtimeRoot, RUNTIME_PACKAGE_MANIFEST), manifest);
  return assertRuntimePackageReadback(runtimeRoot);
}

async function buildDocumentationPackage(
  source: FrozenReleaseSource,
  documentationRoot: string
): Promise<DocumentationPackageManifest> {
  await fs.mkdir(documentationRoot, { recursive: true });
  const contract = await materializeDocumentationPackage(source.root, documentationRoot);
  const files = await inventoryFiles(documentationRoot, [DOCUMENTATION_PACKAGE_MANIFEST]);
  const material = Object.freeze({
    schema: 'sec-documentation-package-manifest-v2' as const,
    sourceCommit: source.sourceCommit,
    sourceTree: source.sourceTree,
    sourceSetSha256: `sha256:${contract.sourceSetSha256}` as `sha256:${string}`,
    entrypoint: contract.entrypoint,
    files
  });
  const manifest = Object.freeze({
    ...material,
    contentDigest: sha256(material) as `sha256:${string}`
  });
  await writeJsonExclusive(path.join(documentationRoot, DOCUMENTATION_PACKAGE_MANIFEST), manifest);
  return assertDocumentationPackageReadback(documentationRoot);
}

export async function assertRuntimePackageReadback(runtimeRoot: string): Promise<RuntimePackageManifest> {
  const manifest = parseRuntimePackageManifestBytes(
    await fs.readFile(path.join(runtimeRoot, RUNTIME_PACKAGE_MANIFEST))
  );
  const physical = await inventoryFiles(runtimeRoot, [RUNTIME_PACKAGE_MANIFEST]);
  if (!sameInventory(physical, manifest.files)) {
    throw new Error('Runtime package physical inventory differs from its manifest');
  }
  return manifest;
}

export async function assertDocumentationPackageReadback(
  documentationRoot: string
): Promise<DocumentationPackageManifest> {
  const manifest = parseDocumentationPackageManifestBytes(
    await fs.readFile(path.join(documentationRoot, DOCUMENTATION_PACKAGE_MANIFEST))
  );
  const physical = await inventoryFiles(documentationRoot, [DOCUMENTATION_PACKAGE_MANIFEST]);
  if (!sameInventory(physical, manifest.files)) {
    throw new Error('Documentation package physical inventory differs from its manifest');
  }
  await assertDocumentationSourceReadback(documentationRoot, manifest.sourceSetSha256, manifest.files);
  return manifest;
}

export async function assertReleaseSetReadback(releaseRoot: string): Promise<ReleaseSetManifest> {
  const entries = await fs.readdir(releaseRoot, { withFileTypes: true });
  const names = entries.map((entry) => entry.name).sort();
  if (sha256(names) !== sha256(['documentation', RELEASE_SET_MANIFEST, 'runtime'].sort())) {
    throw new Error('Release set contains an undeclared top-level entry');
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink() || (entry.name === RELEASE_SET_MANIFEST ? !entry.isFile() : !entry.isDirectory())) {
      throw new Error(`Release set top-level entry has an invalid physical type: ${entry.name}`);
    }
  }
  const manifestBytes = await fs.readFile(path.join(releaseRoot, RELEASE_SET_MANIFEST));
  const manifest = parseReleaseSetManifestBytes(manifestBytes);
  const [documentation, runtime] = await Promise.all([
    assertDocumentationPackageReadback(path.join(releaseRoot, 'documentation')),
    assertRuntimePackageReadback(path.join(releaseRoot, 'runtime'))
  ]);
  if (documentation.sourceCommit !== manifest.sourceCommit || runtime.sourceCommit !== manifest.sourceCommit
      || documentation.sourceTree !== manifest.sourceTree || runtime.sourceTree !== manifest.sourceTree) {
    throw new Error('Release set members do not share the manifest source identity');
  }
  const actual = new Map<ReleaseSetMember['name'], { bytes: Buffer; fileCount: number }>([
    ['documentation', {
      bytes: await fs.readFile(path.join(releaseRoot, 'documentation', DOCUMENTATION_PACKAGE_MANIFEST)),
      fileCount: documentation.files.length
    }],
    ['runtime', {
      bytes: await fs.readFile(path.join(releaseRoot, 'runtime', RUNTIME_PACKAGE_MANIFEST)),
      fileCount: runtime.files.length
    }]
  ]);
  for (const member of manifest.members) {
    const observed = actual.get(member.name)!;
    if (`sha256:${digest(observed.bytes)}` !== member.manifestDigest
        || observed.fileCount !== member.fileCount) {
      throw new Error(`Release set member binding differs from manifest: ${member.name}`);
    }
  }
  return manifest;
}

async function buildStagedReleaseSet(source: FrozenReleaseSource, stageRoot: string): Promise<ReleaseSetManifest> {
  const runtimeRoot = path.join(stageRoot, 'runtime');
  const documentationRoot = path.join(stageRoot, 'documentation');
  // No shared-stage writer may outlive a failed sibling and race its cleanup.
  const documentation = await buildDocumentationPackage(source, documentationRoot);
  const runtime = await buildRuntimePackage(source, runtimeRoot);
  const runtimeManifestBytes = await fs.readFile(path.join(runtimeRoot, RUNTIME_PACKAGE_MANIFEST));
  const documentationManifestBytes = await fs.readFile(
    path.join(documentationRoot, DOCUMENTATION_PACKAGE_MANIFEST)
  );
  const members = Object.freeze<ReleaseSetMember[]>([
    Object.freeze({
      name: 'documentation',
      manifestPath: `documentation/${DOCUMENTATION_PACKAGE_MANIFEST}`,
      manifestDigest: `sha256:${digest(documentationManifestBytes)}`,
      fileCount: documentation.files.length
    }),
    Object.freeze({
      name: 'runtime',
      manifestPath: `runtime/${RUNTIME_PACKAGE_MANIFEST}`,
      manifestDigest: `sha256:${digest(runtimeManifestBytes)}`,
      fileCount: runtime.files.length
    })
  ]);
  const material = Object.freeze({
    schema: 'sec-release-set-manifest-v1' as const,
    sourceCommit: source.sourceCommit,
    sourceTree: source.sourceTree,
    members
  });
  const manifest = Object.freeze({
    ...material,
    contentDigest: sha256(material) as `sha256:${string}`
  });
  await writeJsonExclusive(path.join(stageRoot, RELEASE_SET_MANIFEST), manifest);
  return assertReleaseSetReadback(stageRoot);
}

function cleanupFinding(
  phase: ReleaseSetCleanupFinding['phase'],
  targetPath: string,
  error: unknown
): ReleaseSetCleanupFinding {
  return Object.freeze({
    phase,
    path: targetPath,
    state: 'cleanup-unconfirmed' as const,
    detail: failureText(error)
  });
}

async function assertPublicationParent(parent: PhysicalDirectoryIdentity): Promise<void> {
  assertSameNoFollowDirectoryIdentity(parent, 'Release set publication parent');
}

async function publishReleaseSet(
  stageRoot: string,
  destinationRoot: string,
  expected: ReleaseSetManifest,
  parent: PhysicalDirectoryIdentity
): Promise<readonly ReleaseSetCleanupFinding[]> {
  const destinationName = path.basename(destinationRoot);
  const key = createHash('sha256').update(destinationName).digest('hex');
  const backupName = `.sec-release-set-previous-${key}`;
  const backupRoot = path.join(parent.path, backupName);
  const lease = acquirePhysicalMutationLease(parent, `.sec-release-set-publication-${key}.lock`);
  if (lease === null) throw new Error(`Release set publication is contended: ${destinationRoot}`);
  let primary: { error: unknown } | undefined;
  const findings: ReleaseSetCleanupFinding[] = [];
  try {
    lease.acknowledgeReclaimedRecovery();
    await assertPublicationParent(parent);
    const retainedBackup = inspectExactNoFollowDirectoryPresence(backupRoot, 'Release set previous backup');
    const retainedDestination = inspectExactNoFollowDirectoryPresence(destinationRoot, 'Release set destination');
    if (retainedBackup.state === 'present') {
      if (retainedDestination.state === 'absent') {
        relocateRetainedNoFollowDirectory({ directory: retainedBackup.directory.target, tombstoneName: destinationName });
      } else {
        try {
          await assertReleaseSetReadback(destinationRoot);
          assertSameNoFollowDirectoryIdentity(retainedBackup.directory.target, 'Release set previous cleanup root');
          await fs.rm(backupRoot, { recursive: true, force: false });
        } catch {
          const failedName = `.sec-release-set-failed-${randomUUID()}`;
          relocateRetainedNoFollowDirectory({
            directory: retainedDestination.directory.target,
            tombstoneName: failedName
          });
          relocateRetainedNoFollowDirectory({
            directory: retainedBackup.directory.target,
            tombstoneName: destinationName
          });
        }
      }
    }

    const current = inspectExactNoFollowDirectoryPresence(destinationRoot, 'Release set destination');
    if (current.state === 'present') {
      try {
        const currentManifest = await assertReleaseSetReadback(destinationRoot);
        if (currentManifest.contentDigest === expected.contentDigest) {
          const stage = inspectNoFollowDirectoryChain(stageRoot, 'Exact retry release set stage').target;
          assertSameNoFollowDirectoryIdentity(stage, 'Exact retry release set stage');
          await fs.rm(stageRoot, { recursive: true, force: false });
          return Object.freeze([]);
        }
      } catch {
        // The exact preimage is retained below even if malformed.
      }
      relocateRetainedNoFollowDirectory({ directory: current.directory.target, tombstoneName: backupName });
    }

    const stage = inspectNoFollowDirectoryChain(stageRoot, 'Release set staged root').target;
    relocateRetainedNoFollowDirectory({ directory: stage, tombstoneName: destinationName });
    try {
      const published = await assertReleaseSetReadback(destinationRoot);
      if (published.contentDigest !== expected.contentDigest) {
        throw new Error('Published release set differs from the staged manifest');
      }
    } catch (error) {
      const published = inspectExactNoFollowDirectoryPresence(destinationRoot, 'Failed release set candidate');
      if (published.state === 'present') {
        relocateRetainedNoFollowDirectory({
          directory: published.directory.target,
          tombstoneName: `.sec-release-set-failed-${randomUUID()}`
        });
      }
      const backup = inspectExactNoFollowDirectoryPresence(backupRoot, 'Release set rollback backup');
      if (backup.state === 'present') {
        relocateRetainedNoFollowDirectory({ directory: backup.directory.target, tombstoneName: destinationName });
      }
      throw error;
    }

    const backup = inspectExactNoFollowDirectoryPresence(backupRoot, 'Release set previous cleanup root');
    if (backup.state === 'present') {
      try {
        assertSameNoFollowDirectoryIdentity(backup.directory.target, 'Release set previous cleanup root');
        await fs.rm(backupRoot, { recursive: true, force: false });
      } catch (error) {
        findings.push(cleanupFinding('previous-release-set', backupRoot, error));
      }
    }
    return Object.freeze(findings);
  } catch (error) {
    primary = { error };
    throw error;
  } finally {
    try {
      if (lease.recoveryPending) lease.restoreReclaimedOwner();
      else lease.release();
    } catch (settlement) {
      if (primary !== undefined) {
        throw new AggregateError([primary.error, settlement], 'Release set publication and lease settlement both failed');
      }
      throw settlement;
    }
  }
}

export async function buildReleaseSet(
  repositoryRoot: string,
  destinationRoot: string
): Promise<ReleaseSetBuildReceipt> {
  const absoluteDestination = path.resolve(destinationRoot);
  const parentPath = path.dirname(absoluteDestination);
  await fs.mkdir(parentPath, { recursive: true });
  const parent = inspectNoFollowDirectoryChain(parentPath, 'Release set destination parent').target;
  if (parent.path !== parentPath) throw new Error('Release set destination parent changed lexical identity');

  const source = await prepareFrozenReleaseSource(repositoryRoot);
  let stageRoot: string | null = null;
  let manifest: ReleaseSetManifest | null = null;
  let primary: { error: unknown } | undefined;
  let publicationFindings: readonly ReleaseSetCleanupFinding[] = Object.freeze([]);
  try {
    await assertPublicationParent(parent);
    stageRoot = await fs.mkdtemp(path.join(parent.path, '.sec-release-set-stage-'));
    inspectNoFollowDirectoryChain(stageRoot, 'Release set stage root');
    manifest = await buildStagedReleaseSet(source, stageRoot);
    publicationFindings = await publishReleaseSet(stageRoot, absoluteDestination, manifest, parent);
    stageRoot = null;
  } catch (error) {
    primary = { error };
  }

  const cleanupFindings: ReleaseSetCleanupFinding[] = [...publicationFindings];
  if (stageRoot !== null) {
    try {
      await fs.rm(stageRoot, { recursive: true, force: true });
    } catch (error) {
      cleanupFindings.push(cleanupFinding('release-set-stage', stageRoot, error));
    }
  }
  try {
    await disposeFrozenReleaseSource(source);
  } catch (error) {
    cleanupFindings.push(cleanupFinding('frozen-source', source.stageRoot, error));
  }
  if (primary !== undefined) {
    const cleanupSuffix = cleanupFindings.length === 0
      ? ''
      : `; cleanup=${cleanupFindings.map((finding) =>
        `${finding.phase}:${finding.path}:${finding.state}:${finding.detail}`).join(' | ')}`;
    throw new Error(
      `Release set build/publication failed: ${failureText(primary.error)}${cleanupSuffix}`,
      { cause: primary.error }
    );
  }
  if (manifest === null) throw new Error('Release set reached accepted state without a manifest');
  return Object.freeze({
    schema: 'sec-release-set-build-receipt-v1' as const,
    publicationStatus: 'accepted' as const,
    sourceCommit: source.sourceCommit,
    sourceTree: source.sourceTree,
    artifactRoot: absoluteDestination,
    manifestDigest: manifest.contentDigest,
    fileCount: manifest.members.reduce((sum, member) => sum + member.fileCount, 0),
    cleanupFindings: Object.freeze(cleanupFindings)
  });
}
