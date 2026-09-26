import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { assertDocumentationSourceReadback, materializeDocumentationPackage } from './documentation-source.ts';

import { rawSha256Hex, isPlainObject, sha256 } from '../../contracts/canonical.ts';
import { parseExactJson } from '../../contracts/exact-json.ts';
import { isCanonicalPortableLogicalPath } from '../../contracts/logical-path.ts';
import { acquirePhysicalMutationLease } from '../runtime-state/physical/runtime/mutation-lease.ts';
import {
  assertSameNoFollowDirectoryIdentity,
  copyNoFollowDirectoryTreesBulk,
  createNoFollowOrdinaryDirectoryChain,
  inspectExactNoFollowDirectoryPresence,
  inspectNoFollowDirectoryChain,
  inspectNoFollowOrdinaryFileEntry,
  publishExclusiveDurableCanonicalFile,
  readNoFollowOrdinaryFile,
  relocateRetainedNoFollowDirectory,
  retainNoFollowOrdinaryFile,
  scanNoFollowDirectoryDirectMetadata,
  scanNoFollowDirectoryTreeInventory,
  type PhysicalDirectoryIdentity
} from '../runtime-state/physical/runtime/physical-no-follow.ts';
import { generatedRuntimeDependencyCapabilityNames } from '../toolchain/dependencies/contract/dependency-capability-contract.ts';
import {
  COMPILER_RUNTIME_RESOURCE_RELATIVE_PATHS,
  packageArtifactLauncherScript
} from '../toolchain/runtime.ts';
import {
  allocateReleaseStage,
  materializeReleaseDirectory,
  retireReleaseTree
} from './release-physical.ts';
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

interface ReleasePackageFile {
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

interface ReleaseSetMember {
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

interface ReleaseSetCleanupFinding {
  readonly phase: 'previous-release-set' | 'release-set-stage' | 'frozen-source' | 'failed-release-set';
  readonly path: string;
  readonly state: 'cleanup-unconfirmed';
  readonly detail: string;
  readonly retainedObjectId?: string;
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
  const builder = root.builder;
  const files = parseFileInventory(root.files, `${label} files`, [RUNTIME_PACKAGE_MANIFEST]);
  if (!files.some((file) => file.path === root.entrypoint
      && (file.executable || (builder.platform === 'win32' && file.path.endsWith('.js'))))) {
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
    if (member.name !== 'documentation' && member.name !== 'runtime') {
      throw new Error(`${label} member is invalid`);
    }
    const memberName = member.name;
    const expectedManifestPath = memberName === 'documentation'
      ? `documentation/${DOCUMENTATION_PACKAGE_MANIFEST}`
      : memberName === 'runtime'
        ? `runtime/${RUNTIME_PACKAGE_MANIFEST}`
        : null;
    if (expectedManifestPath === null
        || names.has(memberName) || member.manifestPath !== expectedManifestPath
        || !prefixedDigest(member.manifestDigest)
        || typeof member.fileCount !== 'number' || !Number.isSafeInteger(member.fileCount)
        || member.fileCount < 1) {
      throw new Error(`${label} member is invalid`);
    }
    names.add(memberName);
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
  const physicalRoot = inspectNoFollowDirectoryChain(path.resolve(root), 'Release package inventory root').target;
  const entries = scanNoFollowDirectoryTreeInventory(physicalRoot, {
    includeByteDigest: true,
    includePermissionMode: true
  });
  const files: ReleasePackageFile[] = [];
  for (const entry of entries) {
    if (excluded.includes(entry.relativePath)) continue;
    if (entry.kind === 'link') {
      throw new Error(`Release package contains a link/reparse entry: ${entry.relativePath}`);
    }
    if (entry.kind === 'directory') continue;
    if (entry.kind !== 'file' || entry.byteDigest === undefined) {
      throw new Error(`Release package contains an unsupported entry: ${entry.relativePath}`);
    }
    files.push(Object.freeze({
      path: entry.relativePath,
      bytes: entry.size,
      digest: entry.byteDigest,
      executable: ((entry.permissionMode ?? 0) & 0o111) !== 0
    }));
  }
  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  return Object.freeze(files);
}
function sameInventory(left: readonly ReleasePackageFile[], right: readonly ReleasePackageFile[]): boolean {
  return sha256(left) === sha256(right);
}

async function writeJsonExclusive(target: string, value: unknown): Promise<Buffer> {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  const absolute = path.resolve(target);
  const parent = inspectNoFollowDirectoryChain(path.dirname(absolute), 'Release JSON publication parent').target;
  publishExclusiveDurableCanonicalFile({
    parent,
    name: path.basename(absolute),
    bytes,
    validate: (current) => {
      if (!Buffer.from(current).equals(bytes)) {
        throw new Error('Release JSON publication readback differs');
      }
    }
  });
  return bytes;
}

function readReleaseLeaf(root: string, name: string, label: string): Buffer {
  const parent = inspectNoFollowDirectoryChain(path.resolve(root), `${label} parent`).target;
  const bytes = readNoFollowOrdinaryFile(parent, name);
  if (bytes === null) throw new Error(`${label} is missing`);
  return Buffer.from(bytes);
}

function missingSourceFile(source: string): NodeJS.ErrnoException {
  const error = new Error(`Release source member is missing: ${source}`) as NodeJS.ErrnoException;
  error.code = 'ENOENT';
  error.path = source;
  return error;
}

function retainReleaseSourceFile(source: string, label: string) {
  const absolute = path.resolve(source);
  const parent = inspectNoFollowDirectoryChain(path.dirname(absolute), `${label} parent`);
  const entry = inspectNoFollowOrdinaryFileEntry(parent.target, path.basename(absolute));
  if (entry === null) throw missingSourceFile(absolute);
  return retainNoFollowOrdinaryFile(
    parent,
    path.basename(absolute),
    { device: entry.device, inode: entry.inode },
    label
  );
}

function readOrdinarySourceFile(source: string, label: string): Buffer {
  const retained = retainReleaseSourceFile(source, label);
  try {
    return Buffer.from(retained.readBytes());
  } finally {
    retained.dispose();
  }
}

async function copyOrdinaryFile(source: string, destination: string): Promise<void> {
  const retained = retainReleaseSourceFile(source, `Release source member ${source}`);
  try {
    const absoluteDestination = path.resolve(destination);
    const parent = inspectNoFollowDirectoryChain(
      path.dirname(absoluteDestination),
      `Release destination parent ${destination}`
    ).target;
    const bytes = Buffer.from(retained.readBytes());
    publishExclusiveDurableCanonicalFile({
      parent,
      name: path.basename(absoluteDestination),
      bytes,
      permissionSource: retained,
      validate: (current) => {
        if (!Buffer.from(current).equals(bytes)) {
          throw new Error(`Release copied file readback differs: ${destination}`);
        }
      }
    });
  } finally {
    retained.dispose();
  }
}

async function copyOrdinaryTree(source: string, destination: string): Promise<void> {
  const sourceIdentity = inspectNoFollowDirectoryChain(
    path.resolve(source),
    `Release source tree ${source}`
  ).target;
  await copyNoFollowDirectoryTreesBulk([{
    source: sourceIdentity,
    target: path.resolve(destination)
  }], {
    preservePermissionMode: true
  });
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
  const runtimeIdentity = inspectNoFollowDirectoryChain(path.resolve(runtimeRoot), 'Runtime package root').target;
  const evidenceIdentity = createNoFollowOrdinaryDirectoryChain(
    runtimeIdentity,
    ['THIRD_PARTY_LICENSES'],
    undefined,
    0o755
  );
  for (const packageRoot of roots) {
    const packageIdentity = inspectNoFollowDirectoryChain(
      path.resolve(packageRoot),
      `Bundled package root ${packageRoot}`
    ).target;
    const parsed = JSON.parse(
      readOrdinarySourceFile(path.join(packageIdentity.path, 'package.json'), 'Bundled package.json').toString('utf8')
    ) as Record<string, unknown>;
    if (!nonemptyText(parsed.name) || !nonemptyText(parsed.version) || !nonemptyText(parsed.license)) {
      throw new Error(`Bundled package has incomplete license metadata: ${packageRoot}`);
    }
    const entries = scanNoFollowDirectoryDirectMetadata(packageIdentity, {
      deadlineAtMs: Number.POSITIVE_INFINITY,
      maximumEntries: 100_000
    });
    const licenseNames = entries
      .filter((entry) => entry.kind === 'file' && /^(?:licen[cs]e|copying|notice)(?:\..*)?$/iu.test(entry.relativePath))
      .map((entry) => entry.relativePath)
      .sort();
    if (licenseNames.length === 0) {
      throw new Error(`Bundled package has no distributable license file: ${parsed.name}@${parsed.version}`);
    }
    const packageIdentityDigest = sha256(Object.freeze({
      name: parsed.name,
      version: parsed.version
    })).slice('sha256:'.length);
    const directoryName = `package-${packageIdentityDigest}`;
    const destinationRoot = createNoFollowOrdinaryDirectoryChain(
      evidenceIdentity,
      [directoryName],
      undefined,
      0o755
    ).path;
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
  const raw = JSON.parse(
    readOrdinarySourceFile(path.join(source.root, 'package.json'), 'Frozen portable package.json').toString('utf8')
  ) as Record<string, unknown>;
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
  const runtimeParent = inspectNoFollowDirectoryChain(
    path.dirname(path.resolve(runtimeRoot)),
    'Runtime package parent'
  ).target;
  const runtimeIdentity = createNoFollowOrdinaryDirectoryChain(
    runtimeParent,
    [path.basename(runtimeRoot)],
    undefined,
    0o755
  );
  const distSegments = path.posix.dirname(source.entrypoint.artifact)
    .split('/')
    .filter((segment) => segment.length > 0 && segment !== '.');
  const distRoot = createNoFollowOrdinaryDirectoryChain(
    runtimeIdentity,
    distSegments,
    undefined,
    0o755
  ).path;
  const bundle = await buildFrozenReleaseBundle(source, distRoot, { externalPackageNames: [] });

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
      if ((error as NodeJS.ErrnoException).code !== 'PHYSICAL_NO_FOLLOW_ABSENT') throw error;
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
  const documentationParent = inspectNoFollowDirectoryChain(
    path.dirname(path.resolve(documentationRoot)),
    'Documentation package parent'
  ).target;
  createNoFollowOrdinaryDirectoryChain(
    documentationParent,
    [path.basename(documentationRoot)],
    undefined,
    0o755
  );
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

async function assertRuntimePackageReadback(runtimeRoot: string): Promise<RuntimePackageManifest> {
  const manifest = parseRuntimePackageManifestBytes(
    readReleaseLeaf(runtimeRoot, RUNTIME_PACKAGE_MANIFEST, 'Runtime package manifest')
  );
  const physical = await inventoryFiles(runtimeRoot, [RUNTIME_PACKAGE_MANIFEST]);
  if (!sameInventory(physical, manifest.files)) {
    throw new Error('Runtime package physical inventory differs from its manifest');
  }
  return manifest;
}

async function assertDocumentationPackageReadback(
  documentationRoot: string
): Promise<DocumentationPackageManifest> {
  const manifest = parseDocumentationPackageManifestBytes(
    readReleaseLeaf(documentationRoot, DOCUMENTATION_PACKAGE_MANIFEST, 'Documentation package manifest')
  );
  const physical = await inventoryFiles(documentationRoot, [DOCUMENTATION_PACKAGE_MANIFEST]);
  if (!sameInventory(physical, manifest.files)) {
    throw new Error('Documentation package physical inventory differs from its manifest');
  }
  await assertDocumentationSourceReadback(documentationRoot, manifest.sourceSetSha256, manifest.files);
  return manifest;
}

export async function assertReleaseSetReadback(releaseRoot: string): Promise<ReleaseSetManifest> {
  const absoluteRoot = path.resolve(releaseRoot);
  const physicalRoot = inspectNoFollowDirectoryChain(absoluteRoot, 'Release set readback root').target;
  const entries = scanNoFollowDirectoryDirectMetadata(physicalRoot, {
    deadlineAtMs: Number.POSITIVE_INFINITY,
    maximumEntries: 4
  });
  const expectedKinds = new Map<string, 'directory' | 'file'>([
    ['documentation', 'directory'],
    [RELEASE_SET_MANIFEST, 'file'],
    ['runtime', 'directory']
  ]);
  if (entries.length !== expectedKinds.size) {
    throw new Error('Release set contains an undeclared top-level entry');
  }
  for (const entry of entries) {
    if (expectedKinds.get(entry.relativePath) !== entry.kind) {
      throw new Error(`Release set top-level entry has an invalid physical type: ${entry.relativePath}`);
    }
  }
  const manifestBytes = readReleaseLeaf(absoluteRoot, RELEASE_SET_MANIFEST, 'Release set manifest');
  const manifest = parseReleaseSetManifestBytes(manifestBytes);
  const documentationRoot = path.join(absoluteRoot, 'documentation');
  const runtimeRoot = path.join(absoluteRoot, 'runtime');
  const [documentation, runtime] = await Promise.all([
    assertDocumentationPackageReadback(documentationRoot),
    assertRuntimePackageReadback(runtimeRoot)
  ]);
  if (documentation.sourceCommit !== manifest.sourceCommit || runtime.sourceCommit !== manifest.sourceCommit
      || documentation.sourceTree !== manifest.sourceTree || runtime.sourceTree !== manifest.sourceTree) {
    throw new Error('Release set members do not share the manifest source identity');
  }
  const actual = new Map<ReleaseSetMember['name'], { bytes: Buffer; fileCount: number }>([
    ['documentation', {
      bytes: readReleaseLeaf(documentationRoot, DOCUMENTATION_PACKAGE_MANIFEST, 'Documentation member manifest'),
      fileCount: documentation.files.length
    }],
    ['runtime', {
      bytes: readReleaseLeaf(runtimeRoot, RUNTIME_PACKAGE_MANIFEST, 'Runtime member manifest'),
      fileCount: runtime.files.length
    }]
  ]);
  for (const member of manifest.members) {
    const observed = actual.get(member.name)!;
    if (`sha256:${rawSha256Hex(observed.bytes)}` !== member.manifestDigest
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
  const runtimeManifestBytes = readReleaseLeaf(runtimeRoot, RUNTIME_PACKAGE_MANIFEST, 'Staged runtime manifest');
  const documentationManifestBytes = readReleaseLeaf(
    documentationRoot,
    DOCUMENTATION_PACKAGE_MANIFEST,
    'Staged documentation manifest'
  );
  const members = Object.freeze<ReleaseSetMember[]>([
    Object.freeze({
      name: 'documentation',
      manifestPath: `documentation/${DOCUMENTATION_PACKAGE_MANIFEST}`,
      manifestDigest: `sha256:${rawSha256Hex(documentationManifestBytes)}`,
      fileCount: documentation.files.length
    }),
    Object.freeze({
      name: 'runtime',
      manifestPath: `runtime/${RUNTIME_PACKAGE_MANIFEST}`,
      manifestDigest: `sha256:${rawSha256Hex(runtimeManifestBytes)}`,
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

function retainedFailedReleaseSetFinding(
  directory: PhysicalDirectoryIdentity,
  detail: string
): ReleaseSetCleanupFinding {
  const retained = assertSameNoFollowDirectoryIdentity(directory, 'Retained failed release set').target;
  return Object.freeze({
    phase: 'failed-release-set' as const,
    path: retained.path,
    state: 'cleanup-unconfirmed' as const,
    detail,
    retainedObjectId: retained.objectId
  });
}

async function assertPublicationParent(parent: PhysicalDirectoryIdentity): Promise<void> {
  assertSameNoFollowDirectoryIdentity(parent, 'Release set publication parent');
}

async function publishReleaseSet(
  stage: PhysicalDirectoryIdentity,
  destinationRoot: string,
  expected: ReleaseSetManifest,
  parent: PhysicalDirectoryIdentity
): Promise<readonly ReleaseSetCleanupFinding[]> {
  const destinationName = path.basename(destinationRoot);
  const key = rawSha256Hex(destinationName);
  const backupName = `.sec-release-set-previous-${key}`;
  const backupRoot = path.join(parent.path, backupName);
  const failedPrefix = `.sec-release-set-failed-${key}`;
  const lease = acquirePhysicalMutationLease(parent, `.sec-release-set-publication-${key}.lock`);
  if (lease === null) throw new Error(`Release set publication is contended: ${destinationRoot}`);
  let primary: { error: unknown } | undefined;
  const findings: ReleaseSetCleanupFinding[] = [];
  const retainFailed = (directory: PhysicalDirectoryIdentity, detail: string): void => {
    const displaced = relocateRetainedNoFollowDirectory({
      directory,
      tombstoneName: `${failedPrefix}-${randomUUID()}`
    });
    findings.push(retainedFailedReleaseSetFinding(displaced, detail));
  };
  try {
    lease.acknowledgeReclaimedRecovery();
    await assertPublicationParent(parent);
    const retainedFailedNames = scanNoFollowDirectoryDirectMetadata(parent, {
      deadlineAtMs: performance.now() + 30_000,
      maximumEntries: 100_000
    }).filter(({ relativePath }) => relativePath === failedPrefix
      || relativePath.startsWith(`${failedPrefix}-`));
    for (const { relativePath, kind } of retainedFailedNames) {
      if (kind !== 'directory') {
        throw new Error(`Release set failed-preimage name is not an ordinary directory: ${relativePath}`);
      }
      const retainedFailed = inspectExactNoFollowDirectoryPresence(
        path.join(parent.path, relativePath), 'Release set failed preimage'
      );
      if (retainedFailed.state !== 'present') {
        throw new Error(`Release set failed preimage disappeared during readback: ${relativePath}`);
      }
      findings.push(retainedFailedReleaseSetFinding(
        retainedFailed.directory.target,
        'Previously displaced malformed release set remains retained for recovery.'
      ));
    }
    const retainedBackup = inspectExactNoFollowDirectoryPresence(backupRoot, 'Release set previous backup');
    const retainedDestination = inspectExactNoFollowDirectoryPresence(destinationRoot, 'Release set destination');
    if (retainedBackup.state === 'present') {
      if (retainedDestination.state === 'absent') {
        relocateRetainedNoFollowDirectory({ directory: retainedBackup.directory.target, tombstoneName: destinationName });
      } else {
        try {
          await assertReleaseSetReadback(destinationRoot);
          retireReleaseTree(
            retainedBackup.directory.target,
            parent,
            'Release set interrupted previous cleanup root'
          );
        } catch (error) {
          retainFailed(retainedDestination.directory.target, failureText(error));
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
          retireReleaseTree(stage, parent, 'Exact retry release set stage');
          return Object.freeze(findings);
        }
      } catch {
        // The exact preimage is retained below even if malformed.
      }
      relocateRetainedNoFollowDirectory({ directory: current.directory.target, tombstoneName: backupName });
    }

    relocateRetainedNoFollowDirectory({ directory: stage, tombstoneName: destinationName });
    try {
      const published = await assertReleaseSetReadback(destinationRoot);
      if (published.contentDigest !== expected.contentDigest) {
        throw new Error('Published release set differs from the staged manifest');
      }
    } catch (error) {
      const published = inspectExactNoFollowDirectoryPresence(destinationRoot, 'Failed release set candidate');
      if (published.state === 'present') {
        retainFailed(published.directory.target, failureText(error));
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
        retireReleaseTree(
          backup.directory.target,
          parent,
          'Release set previous cleanup root'
        );
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
  const parent = materializeReleaseDirectory(parentPath, 'Release set destination parent');
  if (parent.path !== parentPath) throw new Error('Release set destination parent changed lexical identity');

  const source = await prepareFrozenReleaseSource(repositoryRoot);
  let stage: PhysicalDirectoryIdentity | null = null;
  let manifest: ReleaseSetManifest | null = null;
  let primary: { error: unknown } | undefined;
  let publicationFindings: readonly ReleaseSetCleanupFinding[] = Object.freeze([]);
  try {
    await assertPublicationParent(parent);
    stage = allocateReleaseStage(parent, '.sec-release-set-stage-');
    manifest = await buildStagedReleaseSet(source, stage.path);
    publicationFindings = await publishReleaseSet(stage, absoluteDestination, manifest, parent);
    stage = null;
  } catch (error) {
    primary = { error };
  }

  const cleanupFindings: ReleaseSetCleanupFinding[] = [...publicationFindings];
  if (stage !== null) {
    try {
      retireReleaseTree(stage, parent, 'Release set failed stage cleanup');
    } catch (error) {
      cleanupFindings.push(cleanupFinding('release-set-stage', stage.path, error));
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
