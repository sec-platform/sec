import { createHash } from 'node:crypto';
import { lstat, mkdir, open, readdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';

import type { CommitFence } from '../../shared/fs.ts';
import {
  buildRuntimeDependencySpec,
  encodeRuntimeDepsPreboundBinding,
  isRuntimeDependencyPackageManifest,
  RUNTIME_DEPENDENCY_PACKAGE_NAMES,
  RUNTIME_DEPS_PREBOUND_BINDING_FILE,
  type RootPackageJson
} from '../../shared/runtime-dependency-spec.ts';
import {
  SEMANTIC_MUTATION_ISOLATED_BOOTSTRAP_RELATIVE_PATH,
  SEMANTIC_MUTATION_ISOLATED_RUNNER_CORE_RELATIVE_PATH,
  SEMANTIC_MUTATION_ISOLATED_STAGED_LOADER_RELATIVE_PATH,
  semanticMutationIsolatedBootstrapBytes,
  semanticMutationIsolatedStagedLoaderBytes
} from '../semantic-mutation/isolated-verification-child-progress.ts';
import {
  withSemanticMutationIsolatedPhaseTelemetry
} from '../semantic-mutation/isolated-verification-phase-telemetry.ts';
import { RUNTIME_VERIFICATION_INVOCATION_CONTRACT } from './runtime-verification-invocation-contract.ts';
import {
  registerSemanticMutationIsolatedRuntimePlanBinding,
  resolveSemanticMutationIsolatedRuntimePlanBinding
} from './semantic-mutation-isolated-runtime-binding.ts';

export const SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT = '.isolated-compiler' as const;
export const SEMANTIC_MUTATION_ISOLATED_BUNFIG_RELATIVE_PATH =
  '.isolated-compiler/bunfig.toml' as const;
export const SEMANTIC_MUTATION_ISOLATED_BROWSER_RELATIVE_ROOT =
  '.isolated-process/playwright-browsers' as const;
export const SEMANTIC_MUTATION_ISOLATED_PROJECT_DEPS_RELATIVE_ROOT =
  'project/node_modules' as const;

const ISOLATED_BUNFIG_BYTES = new TextEncoder().encode('# isolated runtime\n');
const FILE_ATTRIBUTE_REPARSE_POINT = 0x0000_0400;
const INVALID_FILE_ATTRIBUTES = 0xffff_ffff;
const HASH_BUFFER_SIZE = 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;
const RUNTIME_FILE_CONCURRENCY = 8;
const SEMANTIC_MUTATION_ISOLATED_PROJECT_DEPS_BINDING_RELATIVE_PATH =
  `${SEMANTIC_MUTATION_ISOLATED_PROJECT_DEPS_RELATIVE_ROOT}/${RUNTIME_DEPS_PREBOUND_BINDING_FILE}` as const;
const OWNED_RUNTIME_ROOTS = Object.freeze([
  SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT,
  SEMANTIC_MUTATION_ISOLATED_PROJECT_DEPS_RELATIVE_ROOT,
  SEMANTIC_MUTATION_ISOLATED_BROWSER_RELATIVE_ROOT
] as const);

export interface SemanticMutationIsolatedRuntimeInputSources {
  readonly browserCache: string;
  readonly compilerModulesRoot: string;
  readonly compilerPackage: string;
  readonly composeTemplates: string;
  readonly dependencyModules: string;
  readonly officialPolicies: string;
  readonly officialRegistry: string;
}

export interface SemanticMutationIsolatedCompilerRegistryInput {
  readonly destinationRelativePath: string;
  readonly sourceRoot: string;
}

type BigIntMetadata = Awaited<ReturnType<typeof lstat>> & {
  readonly ctimeNs: bigint;
  readonly mtimeNs: bigint;
};

interface RuntimeSourceIdentityV1 {
  readonly ctimeNs: string;
  readonly dev: string;
  readonly ino: string;
  readonly mode: string;
  readonly mtimeNs: string;
  readonly nlink: string;
  readonly size: string;
}

interface RuntimeDirectoryIdentityV1 {
  readonly dev: string;
  readonly ino: string;
  readonly mode: string;
}

interface RuntimeInputFileV1 {
  readonly destinationMode: number | null;
  readonly destinationRelativePath: string;
  readonly rawDigest: string;
  readonly size: number;
  readonly sourceAbsolutePath: string | null;
  readonly sourceIdentity: RuntimeSourceIdentityV1 | { readonly generatedDigest: string };
}

interface RuntimeDestinationManifestEntryV1 {
  readonly mode?: number;
  readonly relativePath: string;
  readonly rawDigest: string;
  readonly size: number;
}

interface RuntimeDestinationManifestV1 {
  readonly directories: readonly string[];
  readonly files: readonly RuntimeDestinationManifestEntryV1[];
}

interface RuntimeDestinationStructureFileV1 {
  readonly absolutePath: string;
  readonly identity: RuntimeSourceIdentityV1;
  readonly mode: number;
  readonly relativePath: string;
  readonly size: number;
}

interface RuntimeDestinationStructureV1 {
  readonly directories: readonly string[];
  readonly files: readonly RuntimeDestinationStructureFileV1[];
}

interface RuntimeSourceRootProofV1 {
  readonly absolutePath: string;
  readonly expected: 'file' | 'directory';
  readonly identity: RuntimeSourceIdentityV1;
}

interface RuntimeSourceDirectoryProofV1 {
  readonly absolutePath: string;
  readonly childNames: readonly string[];
  readonly identity: RuntimeSourceIdentityV1;
}

interface RuntimeSourceSnapshotV1 {
  readonly bootstrapBundle: Uint8Array;
  readonly dependencyBinding: Uint8Array;
  readonly directories: readonly string[];
  readonly directoryProofs: readonly RuntimeSourceDirectoryProofV1[];
  readonly files: readonly RuntimeInputFileV1[];
  readonly loaderBundle: Uint8Array;
  readonly manifest: RuntimeDestinationManifestV1;
  readonly rootProofs: readonly RuntimeSourceRootProofV1[];
  readonly runnerBundle: Uint8Array;
  readonly snapshotRevision: string;
}

interface RuntimeSourceSnapshotCacheSlot {
  captures: number;
  flight?: Promise<RuntimeSourceSnapshotV1>;
  revalidations: number;
  snapshot?: RuntimeSourceSnapshotV1;
}

interface RuntimeSourceProofCollector {
  readonly directories: RuntimeSourceDirectoryProofV1[];
  readonly roots: RuntimeSourceRootProofV1[];
}

interface SemanticMutationIsolatedRuntimePlanV1 {
  readonly bootstrapBundle: Uint8Array;
  readonly dependencyBinding: Uint8Array;
  readonly directories: readonly string[];
  readonly files: readonly RuntimeInputFileV1[];
  readonly loaderBundle: Uint8Array;
  readonly manifest: RuntimeDestinationManifestV1;
  readonly planRevision: string;
  readonly runnerBundle: Uint8Array;
  readonly stagingRoot: string;
  readonly stagingRootIdentity: RuntimeDirectoryIdentityV1;
}

interface ReparsePointInspector {
  hasReparsePoint(filePath: string): boolean;
  close(): void;
}

const issuedRuntimePlans = new WeakSet<object>();
const runtimePlansByBinding = new WeakMap<object, SemanticMutationIsolatedRuntimePlanV1>();
const runtimeSourceSnapshotsBySources = new WeakMap<
  SemanticMutationIsolatedRuntimeInputSources,
  Map<string, RuntimeSourceSnapshotCacheSlot>
>();
const MAX_RUNTIME_SOURCE_SNAPSHOTS_PER_SOURCES = 4;

function sha256Bytes(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function sha256Value(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

async function runCanonicalBatches<T, R>(
  items: readonly T[],
  worker: (item: T, canonicalIndex: number) => Promise<R>,
  batchBoundary?: () => Promise<void>
): Promise<readonly R[]> {
  const output: R[] = [];
  if (items.length > 0 && batchBoundary) await batchBoundary();
  for (let offset = 0; offset < items.length; offset += RUNTIME_FILE_CONCURRENCY) {
    const batch = items.slice(offset, offset + RUNTIME_FILE_CONCURRENCY);
    const settled = await Promise.allSettled(batch.map((item, index) =>
      Promise.resolve().then(() => worker(item, offset + index))));
    if (batchBoundary) await batchBoundary();
    const failure = settled.find((result) => result.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    for (const result of settled) {
      if (result.status === 'fulfilled') output.push(result.value);
    }
  }
  return Object.freeze(output);
}

/** Test-only deterministic scheduler seam; production width remains fixed at eight. */
export function runSemanticMutationRuntimeCanonicalBatchesForTests<T, R>(
  items: readonly T[],
  worker: (item: T, canonicalIndex: number) => Promise<R>,
  batchBoundary?: () => Promise<void>
): Promise<readonly R[]> {
  return runCanonicalBatches(items, worker, batchBoundary);
}

function foldedPath(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
}

function isPathInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' ||
    (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function metadataIdentity(metadata: BigIntMetadata): RuntimeSourceIdentityV1 {
  return Object.freeze({
    ctimeNs: String(metadata.ctimeNs),
    dev: String(metadata.dev),
    ino: String(metadata.ino),
    mode: String(metadata.mode),
    mtimeNs: String(metadata.mtimeNs),
    nlink: String(metadata.nlink),
    size: String(metadata.size)
  });
}

function sameIdentity(left: RuntimeSourceIdentityV1, right: RuntimeSourceIdentityV1): boolean {
  return left.ctimeNs === right.ctimeNs && left.dev === right.dev && left.ino === right.ino &&
    left.mode === right.mode && left.mtimeNs === right.mtimeNs && left.nlink === right.nlink &&
    left.size === right.size;
}

function directoryIdentity(identity: RuntimeSourceIdentityV1): RuntimeDirectoryIdentityV1 {
  return Object.freeze({ dev: identity.dev, ino: identity.ino, mode: identity.mode });
}

function sameDirectoryIdentity(left: RuntimeDirectoryIdentityV1, right: RuntimeDirectoryIdentityV1): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

function canonicalRelativePath(relativePath: string): string {
  const canonical = relativePath.replaceAll('\\', '/');
  const segments = canonical.split('/');
  if (!canonical || canonical.startsWith('/') || path.posix.isAbsolute(canonical) ||
    segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('\0'))) {
    throw new Error('Semantic Mutation isolated runtime path is not canonical');
  }
  return canonical;
}

function absoluteDestination(stagingRoot: string, relativePath: string): string {
  const canonical = canonicalRelativePath(relativePath);
  const destination = path.resolve(stagingRoot, ...canonical.split('/'));
  const relative = path.relative(stagingRoot, destination);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Semantic Mutation isolated runtime destination escapes staging');
  }
  return destination;
}

async function createReparsePointInspector(): Promise<ReparsePointInspector> {
  if (process.platform !== 'win32') {
    return { hasReparsePoint: () => false, close: () => undefined };
  }
  const { dlopen, FFIType } = await import('bun:ffi');
  const kernel32 = dlopen('kernel32.dll', {
    GetFileAttributesW: {
      args: [FFIType.ptr],
      returns: FFIType.u32
    }
  } as const);
  return {
    hasReparsePoint(filePath: string): boolean {
      const widePath = Buffer.from(`${path.toNamespacedPath(path.resolve(filePath))}\0`, 'utf16le');
      const attributes = kernel32.symbols.GetFileAttributesW(widePath);
      if (attributes === INVALID_FILE_ATTRIBUTES) {
        throw new Error('Semantic Mutation runtime input attributes could not be proven');
      }
      return (attributes & FILE_ATTRIBUTE_REPARSE_POINT) !== 0;
    },
    close(): void {
      kernel32.close();
    }
  };
}

function assertPhysicalMetadata(
  metadata: BigIntMetadata,
  filePath: string,
  inspector: ReparsePointInspector,
  expected: 'file' | 'directory',
  rejectHardLink = false
): void {
  if (metadata.isSymbolicLink() || inspector.hasReparsePoint(filePath)) {
    throw new Error('Semantic Mutation isolated runtime input contains a reparse entry');
  }
  if ((expected === 'file' && !metadata.isFile()) ||
    (expected === 'directory' && !metadata.isDirectory())) {
    throw new Error('Semantic Mutation isolated runtime input contains a special entry');
  }
  if (expected === 'file' && rejectHardLink && Number(metadata.nlink) !== 1) {
    throw new Error('Semantic Mutation isolated runtime input contains a hard link');
  }
}

async function bigintLstat(filePath: string): Promise<BigIntMetadata> {
  return await lstat(filePath, { bigint: true }) as BigIntMetadata;
}

async function stableFileEvidence(
  filePath: string,
  inspector: ReparsePointInspector,
  collectBytes = false,
  rejectHardLink = false
): Promise<{
  readonly bytes?: Uint8Array;
  readonly identity: RuntimeSourceIdentityV1;
  readonly rawDigest: string;
  readonly size: number;
}> {
  const resolvedPath = path.resolve(filePath);
  const beforePath = await bigintLstat(resolvedPath);
  assertPhysicalMetadata(beforePath, resolvedPath, inspector, 'file', rejectHardLink);
  const beforeIdentity = metadataIdentity(beforePath);
  const handle = await open(resolvedPath, 'r');
  const chunks: Buffer[] = [];
  try {
    const beforeHandle = await handle.stat({ bigint: true }) as BigIntMetadata;
    assertPhysicalMetadata(beforeHandle, resolvedPath, inspector, 'file', rejectHardLink);
    if (!sameIdentity(beforeIdentity, metadataIdentity(beforeHandle))) {
      throw new Error('Semantic Mutation runtime input opened a different file identity');
    }
    if (beforeHandle.size > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('Semantic Mutation runtime input is too large');
    }
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(HASH_BUFFER_SIZE);
    let total = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      const chunk = buffer.subarray(0, bytesRead);
      hash.update(chunk);
      if (collectBytes) {
        if (total + bytesRead > MAX_MANIFEST_BYTES) {
          throw new Error('Semantic Mutation runtime manifest is too large');
        }
        chunks.push(Buffer.from(chunk));
      }
      total += bytesRead;
    }
    const afterHandle = await handle.stat({ bigint: true }) as BigIntMetadata;
    const afterPath = await bigintLstat(resolvedPath);
    assertPhysicalMetadata(afterPath, resolvedPath, inspector, 'file', rejectHardLink);
    if (!sameIdentity(beforeIdentity, metadataIdentity(afterHandle)) ||
      !sameIdentity(beforeIdentity, metadataIdentity(afterPath)) || total !== Number(beforeHandle.size)) {
      throw new Error('Semantic Mutation runtime input changed during stable read');
    }
    return {
      ...(collectBytes ? { bytes: new Uint8Array(Buffer.concat(chunks)) } : {}),
      identity: beforeIdentity,
      rawDigest: `sha256:${hash.digest('hex')}`,
      size: total
    };
  } finally {
    await handle.close();
  }
}

function executableDestinationMode(identity: RuntimeSourceIdentityV1): number | null {
  const mode = Number(BigInt(identity.mode) & 0o777n);
  return (mode & 0o111) === 0 ? null : mode;
}

async function assertCanonicalPhysicalRoot(
  sourceRoot: string,
  inspector: ReparsePointInspector,
  expected: 'file' | 'directory'
): Promise<{ readonly absolutePath: string; readonly identity: RuntimeSourceIdentityV1 }> {
  const absolutePath = path.resolve(sourceRoot);
  const metadata = await bigintLstat(absolutePath);
  assertPhysicalMetadata(metadata, absolutePath, inspector, expected);
  if (foldedPath(await realpath(absolutePath)) !== foldedPath(absolutePath)) {
    throw new Error('Semantic Mutation runtime input root crosses an aliased path');
  }
  return { absolutePath, identity: metadataIdentity(metadata) };
}

async function captureInputFile(
  sourcePath: string,
  destinationRelativePath: string,
  inspector: ReparsePointInspector,
  proofs: RuntimeSourceProofCollector,
  collectBytes = false
): Promise<RuntimeInputFileV1 & { readonly bytes?: Uint8Array }> {
  const source = await assertCanonicalPhysicalRoot(sourcePath, inspector, 'file');
  const evidence = await stableFileEvidence(source.absolutePath, inspector, collectBytes);
  if (!sameIdentity(source.identity, evidence.identity)) {
    throw new Error('Semantic Mutation runtime input file identity changed during capture');
  }
  proofs.roots.push(Object.freeze({
    absolutePath: source.absolutePath,
    expected: 'file',
    identity: evidence.identity
  }));
  return Object.freeze({
    destinationMode: null,
    destinationRelativePath: canonicalRelativePath(destinationRelativePath),
    rawDigest: evidence.rawDigest,
    size: evidence.size,
    sourceAbsolutePath: source.absolutePath,
    sourceIdentity: evidence.identity,
    ...(evidence.bytes ? { bytes: evidence.bytes } : {})
  });
}

async function captureInputTree(
  sourceRoot: string,
  destinationRoot: string,
  inspector: ReparsePointInspector,
  proofs: RuntimeSourceProofCollector,
  rejectHardLinks = false,
  destinationDirectories?: Set<string>,
  excludeTopLevelPackageBin = false
): Promise<RuntimeInputFileV1[]> {
  const source = await assertCanonicalPhysicalRoot(sourceRoot, inspector, 'directory');
  proofs.roots.push(Object.freeze({
    absolutePath: source.absolutePath,
    expected: 'directory',
    identity: source.identity
  }));
  const entries: RuntimeInputFileV1[] = [];
  const visit = async (directory: string, relativeDirectory: string): Promise<void> => {
    destinationDirectories?.add(canonicalRelativePath(
      relativeDirectory ? `${destinationRoot}/${relativeDirectory}` : destinationRoot
    ));
    const before = await bigintLstat(directory);
    assertPhysicalMetadata(before, directory, inspector, 'directory');
    const beforeIdentity = metadataIdentity(before);
    const names = (await readdir(directory)).sort(compareCodeUnits);
    for (const name of names) {
      if (!name || name === '.' || name === '..' || name.includes('\0')) {
        throw new Error('Semantic Mutation runtime input has an invalid entry name');
      }
      const absoluteChild = path.join(directory, name);
      const relativeChild = relativeDirectory ? `${relativeDirectory}/${name}` : name;
      const destinationRelativePath = canonicalRelativePath(`${destinationRoot}/${relativeChild}`);
      const metadata = await bigintLstat(absoluteChild);
      if (excludeTopLevelPackageBin && relativeDirectory === '' && name === '.bin') {
        assertPhysicalMetadata(metadata, absoluteChild, inspector, 'directory');
        continue;
      }
      if (metadata.isDirectory()) {
        assertPhysicalMetadata(metadata, absoluteChild, inspector, 'directory');
        await visit(absoluteChild, relativeChild);
      } else {
        assertPhysicalMetadata(metadata, absoluteChild, inspector, 'file', rejectHardLinks);
        const evidence = await stableFileEvidence(absoluteChild, inspector, false, rejectHardLinks);
        entries.push(Object.freeze({
          destinationMode: executableDestinationMode(evidence.identity),
          destinationRelativePath,
          rawDigest: evidence.rawDigest,
          size: evidence.size,
          sourceAbsolutePath: path.resolve(absoluteChild),
          sourceIdentity: evidence.identity
        }));
      }
    }
    const after = await bigintLstat(directory);
    assertPhysicalMetadata(after, directory, inspector, 'directory');
    const namesAfter = (await readdir(directory)).sort(compareCodeUnits);
    if (!sameIdentity(beforeIdentity, metadataIdentity(after)) ||
      JSON.stringify(namesAfter) !== JSON.stringify(names)) {
      throw new Error('Semantic Mutation runtime input directory changed during capture');
    }
    proofs.directories.push(Object.freeze({
      absolutePath: path.resolve(directory),
      childNames: Object.freeze([...names]),
      identity: beforeIdentity
    }));
  };
  await visit(source.absolutePath, '');
  const afterRoot = await bigintLstat(source.absolutePath);
  if (!sameIdentity(source.identity, metadataIdentity(afterRoot))) {
    throw new Error('Semantic Mutation runtime input root changed during capture');
  }
  return entries;
}

function compilerModulePath(modulesRoot: string, moduleName: string): string {
  const valid = moduleName.startsWith('@')
    ? /^@[a-z0-9._-]+\/[a-z0-9._-]+$/iu.test(moduleName)
    : /^[a-z0-9._-]+$/iu.test(moduleName);
  if (!valid) throw new Error('Compiler runtime module name is invalid');
  const root = path.resolve(modulesRoot);
  const resolved = path.resolve(root, ...moduleName.split('/'));
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Compiler runtime module path is invalid');
  }
  return resolved;
}

interface ParsedPackageManifestV1 {
  readonly dependencies: Readonly<Record<string, string>>;
}

function parsePackageManifest(bytes: Uint8Array, expectedName?: string): ParsedPackageManifestV1 {
  const value = JSON.parse(new TextDecoder().decode(bytes)) as {
    readonly name?: unknown;
    readonly dependencies?: unknown;
    readonly devDependencies?: unknown;
  };
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    (expectedName !== undefined && value.name !== expectedName) ||
    (value.dependencies !== undefined &&
      (!value.dependencies || typeof value.dependencies !== 'object' || Array.isArray(value.dependencies)))) {
    throw new Error('Compiler runtime module manifest is invalid');
  }
  return Object.freeze({
    dependencies: Object.freeze({ ...(value.dependencies as Record<string, string> | undefined) })
  });
}

function assertCompilerPackageManifest(bytes: Uint8Array): void {
  const value = JSON.parse(new TextDecoder().decode(bytes)) as {
    readonly dependencies?: unknown;
    readonly devDependencies?: unknown;
  };
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    !value.dependencies || typeof value.dependencies !== 'object' || Array.isArray(value.dependencies) ||
    !value.devDependencies || typeof value.devDependencies !== 'object' || Array.isArray(value.devDependencies)) {
    throw new Error('Compiler package manifest is invalid');
  }
  for (const name of ['next', 'react', 'react-dom', 'yaml']) {
    if (typeof (value.dependencies as Record<string, unknown>)[name] !== 'string' &&
      typeof (value.devDependencies as Record<string, unknown>)[name] !== 'string') {
      throw new Error('Compiler package manifest is missing a runtime dependency');
    }
  }
  for (const name of [
    '@playwright/test', '@types/bun', '@types/node', '@types/react', '@types/react-dom',
    'ts-morph', 'typescript'
  ]) {
    if (typeof (value.dependencies as Record<string, unknown>)[name] !== 'string' &&
      typeof (value.devDependencies as Record<string, unknown>)[name] !== 'string') {
      throw new Error('Compiler package manifest is missing a runtime development dependency');
    }
  }
}

async function assertRuntimeDependencyPackageClosure(
  dependencyFiles: readonly RuntimeInputFileV1[],
  inspector: ReparsePointInspector
): Promise<void> {
  for (const packageName of RUNTIME_DEPENDENCY_PACKAGE_NAMES) {
    const relativeManifest = canonicalRelativePath(
      `${SEMANTIC_MUTATION_ISOLATED_PROJECT_DEPS_RELATIVE_ROOT}/${packageName}/package.json`
    );
    const captured = dependencyFiles.find((file) =>
      file.destinationRelativePath === relativeManifest);
    if (!captured || captured.size === 0 || captured.sourceAbsolutePath === null) {
      throw new Error(`A required runtime package manifest is unavailable: ${packageName}`);
    }
    const evidence = await stableFileEvidence(captured.sourceAbsolutePath, inspector, true);
    if (evidence.rawDigest !== captured.rawDigest || evidence.size !== captured.size ||
      !sameIdentity(evidence.identity, captured.sourceIdentity as RuntimeSourceIdentityV1)) {
      throw new Error(`A required runtime package manifest changed: ${packageName}`);
    }
    let manifest: unknown;
    try {
      manifest = JSON.parse(new TextDecoder().decode(evidence.bytes!)) as unknown;
    } catch {
      throw new Error(`A required runtime package manifest is invalid: ${packageName}`);
    }
    if (!isRuntimeDependencyPackageManifest(manifest, packageName)) {
      throw new Error(`A required runtime package identity is invalid: ${packageName}`);
    }
  }
}

function requiredPlaywrightExecutable(bytes: Uint8Array): string {
  const value = JSON.parse(new TextDecoder().decode(bytes)) as {
    readonly browsers?: unknown;
  };
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.browsers)) {
    throw new Error('Playwright browser descriptor is invalid');
  }
  const descriptor = value.browsers.find((entry: unknown) => {
    return Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry) &&
      (entry as { readonly name?: unknown }).name === 'chromium-headless-shell';
  }) as { readonly revision?: unknown } | undefined;
  if (!descriptor || typeof descriptor.revision !== 'string' ||
    !/^[1-9][0-9]*$/u.test(descriptor.revision)) {
    throw new Error('Playwright Chromium headless-shell revision is unavailable');
  }
  return `chromium_headless_shell-${descriptor.revision}/` +
    'chrome-headless-shell-win64/chrome-headless-shell.exe';
}

function generatedInputFile(destinationRelativePath: string, bytes: Uint8Array): RuntimeInputFileV1 {
  const rawDigest = sha256Bytes(bytes);
  return Object.freeze({
    destinationMode: null,
    destinationRelativePath: canonicalRelativePath(destinationRelativePath),
    rawDigest,
    size: bytes.byteLength,
    sourceAbsolutePath: null,
    sourceIdentity: Object.freeze({ generatedDigest: rawDigest })
  });
}

function canonicalPlanPayload(plan: Omit<SemanticMutationIsolatedRuntimePlanV1, 'planRevision'>): unknown {
  return {
    domain: 'semantic-mutation-isolated-runtime-plan-v1',
    bootstrapBundleDigest: sha256Bytes(plan.bootstrapBundle),
    dependencyBindingDigest: sha256Bytes(plan.dependencyBinding),
    directories: plan.directories,
    files: plan.files.map((file) => ({
      destinationMode: file.destinationMode,
      destinationRelativePath: file.destinationRelativePath,
      rawDigest: file.rawDigest,
      size: file.size,
      sourceAbsolutePath: file.sourceAbsolutePath,
      sourceIdentity: file.sourceIdentity
    })),
    loaderBundleDigest: sha256Bytes(plan.loaderBundle),
    manifest: plan.manifest,
    runnerBundleDigest: sha256Bytes(plan.runnerBundle),
    stagingRoot: plan.stagingRoot,
    stagingRootIdentity: plan.stagingRootIdentity
  };
}

function assertUniqueAndCanonicalFiles(files: readonly RuntimeInputFileV1[]): void {
  const destinations = new Set<string>();
  for (const file of files) {
    const relativePath = canonicalRelativePath(file.destinationRelativePath);
    const destinationKey = process.platform === 'win32'
      ? relativePath.toLocaleLowerCase('en-US')
      : relativePath;
    if (destinations.has(destinationKey)) {
      throw new Error('Semantic Mutation runtime plan has a duplicate destination');
    }
    destinations.add(destinationKey);
  }
}

function addOwnedParentDirectories(directories: Set<string>, relativePath: string): void {
  const canonical = canonicalRelativePath(relativePath);
  const ownedRoot = OWNED_RUNTIME_ROOTS.find((root) =>
    canonical === root || canonical.startsWith(`${root}/`));
  if (!ownedRoot) {
    throw new Error('Semantic Mutation runtime destination is outside an owned root');
  }
  let current = path.posix.dirname(canonical);
  while (current === ownedRoot || current.startsWith(`${ownedRoot}/`)) {
    directories.add(canonicalRelativePath(current));
    if (current === ownedRoot) break;
    current = path.posix.dirname(current);
  }
}

async function captureRuntimeSourceSnapshot(
  input: RuntimeSourceSnapshotInputV1,
  inspector: ReparsePointInspector
): Promise<RuntimeSourceSnapshotV1> {
    const proofs: RuntimeSourceProofCollector = { directories: [], roots: [] };
    const directories = new Set<string>();
    const compilerPackage = await captureInputFile(
      input.sources.compilerPackage,
      `${SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT}/package.json`,
      inspector,
      proofs,
      true
    );
    assertCompilerPackageManifest(compilerPackage.bytes!);
    const runtimeDependencySpec = buildRuntimeDependencySpec(
      JSON.parse(new TextDecoder().decode(compilerPackage.bytes!)) as RootPackageJson
    );
    const dependencyBinding = encodeRuntimeDepsPreboundBinding(runtimeDependencySpec);
    const playwrightDescriptor = await captureInputFile(
      path.join(input.sources.compilerModulesRoot, 'playwright-core', 'browsers.json'),
      `${SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT}/node_modules/playwright-core/browsers.json`,
      inspector,
      proofs,
      true
    );
    const requiredBrowserExecutable = requiredPlaywrightExecutable(playwrightDescriptor.bytes!);
    const registryInputs = input.compilerRegistries;
    const registryFiles: RuntimeInputFileV1[] = [];
    for (const registry of [...registryInputs].sort((left, right) =>
      compareCodeUnits(left.destinationRelativePath, right.destinationRelativePath))) {
      registryFiles.push(...await captureInputTree(
        registry.sourceRoot,
        canonicalRelativePath(registry.destinationRelativePath),
        inspector,
        proofs,
        false,
        directories
      ));
    }
    const browserFiles = await captureInputTree(
      input.browserCache,
      SEMANTIC_MUTATION_ISOLATED_BROWSER_RELATIVE_ROOT,
      inspector,
      proofs,
      false,
      directories
    );
    const requiredBrowserDestination = canonicalRelativePath(
      `${SEMANTIC_MUTATION_ISOLATED_BROWSER_RELATIVE_ROOT}/${requiredBrowserExecutable}`
    );
    const executable = browserFiles.find((file) =>
      file.destinationRelativePath === requiredBrowserDestination);
    if (!executable || executable.size === 0) {
      throw new Error('The exact preinstalled Playwright executable is unavailable');
    }

    const bootstrapBundle = semanticMutationIsolatedBootstrapBytes();
    const runnerBundle = input.runnerBundle.slice();
    const dependencyFiles = await captureInputTree(
      input.sources.dependencyModules,
      SEMANTIC_MUTATION_ISOLATED_PROJECT_DEPS_RELATIVE_ROOT,
      inspector,
      proofs,
      false,
      directories,
      true
    );
    await assertRuntimeDependencyPackageClosure(dependencyFiles, inspector);
    for (const descriptor of Object.values(RUNTIME_VERIFICATION_INVOCATION_CONTRACT)) {
      const requiredInputs = [
        descriptor.moduleRelativePath,
        descriptor.packageManifest?.relativePath ?? null
      ].filter((value) => value !== null);
      for (const relativePath of requiredInputs) {
        const requiredDestination = canonicalRelativePath(
          `${SEMANTIC_MUTATION_ISOLATED_PROJECT_DEPS_RELATIVE_ROOT}/${relativePath}`
        );
        const requiredInput = dependencyFiles.find((file) =>
          file.destinationRelativePath === requiredDestination);
        if (!requiredInput || requiredInput.size === 0) {
          throw new Error(`A required direct runtime input is unavailable: ${relativePath}`);
        }
      }
    }

    const files: RuntimeInputFileV1[] = [
      generatedInputFile(SEMANTIC_MUTATION_ISOLATED_BOOTSTRAP_RELATIVE_PATH, bootstrapBundle),
      generatedInputFile(SEMANTIC_MUTATION_ISOLATED_RUNNER_CORE_RELATIVE_PATH, runnerBundle),
      generatedInputFile(SEMANTIC_MUTATION_ISOLATED_BUNFIG_RELATIVE_PATH, ISOLATED_BUNFIG_BYTES),
      generatedInputFile(
        SEMANTIC_MUTATION_ISOLATED_PROJECT_DEPS_BINDING_RELATIVE_PATH,
        dependencyBinding
      ),
      compilerPackage,
      playwrightDescriptor,
      ...registryFiles,
      ...await captureInputTree(
        input.sources.officialPolicies,
        `${SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT}/platform/policies/official`,
        inspector,
        proofs,
        false,
        directories
      ),
      ...await captureInputTree(
        input.sources.composeTemplates,
        `${SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT}/platform/compiler/compose/templates`,
        inspector,
        proofs,
        false,
        directories
      ),
      ...dependencyFiles,
      ...browserFiles
    ];

    const pending = ['ts-morph', 'typescript'];
    const seen = new Set<string>();
    while (pending.length > 0) {
      const moduleName = pending.shift()!;
      if (seen.has(moduleName)) continue;
      const moduleRoot = compilerModulePath(input.sources.compilerModulesRoot, moduleName);
      const packageManifest = await captureInputFile(
        path.join(moduleRoot, 'package.json'),
        `${SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT}/node_modules/${moduleName}/package.json`,
        inspector,
        proofs,
        true
      );
      const parsedManifest = parsePackageManifest(packageManifest.bytes!, moduleName);
      const moduleFiles = await captureInputTree(
        moduleRoot,
        `${SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT}/node_modules/${moduleName}`,
        inspector,
        proofs,
        false,
        directories
      );
      const capturedManifest = moduleFiles.find((file) =>
        file.destinationRelativePath === packageManifest.destinationRelativePath);
      if (!capturedManifest || capturedManifest.rawDigest !== packageManifest.rawDigest ||
        capturedManifest.size !== packageManifest.size ||
        !sameIdentity(
          capturedManifest.sourceIdentity as RuntimeSourceIdentityV1,
          packageManifest.sourceIdentity as RuntimeSourceIdentityV1
        )) {
        throw new Error('Compiler runtime module manifest changed during closure capture');
      }
      files.push(...moduleFiles);
      seen.add(moduleName);
      for (const dependency of Object.keys(parsedManifest.dependencies).sort(compareCodeUnits)) {
        if (!seen.has(dependency)) pending.push(dependency);
      }
    }
    const loaderBundle = semanticMutationIsolatedStagedLoaderBytes(Object.freeze({
      formatRevision: 'semantic-mutation-isolated-bundled-loader-binding-v1',
      executionRevision: 'semantic-mutation-bundled-core-relocation-v1'
    }));
    files.push(generatedInputFile(SEMANTIC_MUTATION_ISOLATED_STAGED_LOADER_RELATIVE_PATH, loaderBundle));

    const sortedFiles = files.sort((left, right) =>
      compareCodeUnits(left.destinationRelativePath, right.destinationRelativePath));
    assertUniqueAndCanonicalFiles(sortedFiles);
    for (const file of sortedFiles) {
      addOwnedParentDirectories(directories, file.destinationRelativePath);
    }
    const requiredRoots = [
      `${SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT}/platform/policies/official/`,
      `${SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT}/platform/compiler/compose/templates/`,
      `${SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT}/node_modules/`,
      `${SEMANTIC_MUTATION_ISOLATED_PROJECT_DEPS_RELATIVE_ROOT}/`,
      `${SEMANTIC_MUTATION_ISOLATED_BROWSER_RELATIVE_ROOT}/`
    ];
    for (const registry of registryInputs) {
      requiredRoots.push(`${canonicalRelativePath(registry.destinationRelativePath)}/`);
    }
    if (requiredRoots.some((root) => !sortedFiles.some((file) =>
      file.destinationRelativePath.startsWith(root)))) {
      throw new Error('A required Semantic Mutation runtime input is empty');
    }
    const sortedDirectories = Object.freeze([...directories]
      .map(canonicalRelativePath)
      .sort(compareCodeUnits));
    const foldedDirectories = new Set<string>();
    for (const directory of sortedDirectories) {
      const key = process.platform === 'win32' ? directory.toLocaleLowerCase('en-US') : directory;
      if (foldedDirectories.has(key)) {
        throw new Error('Semantic Mutation runtime plan has a duplicate directory');
      }
      foldedDirectories.add(key);
    }
    const manifest = Object.freeze({
      directories: sortedDirectories,
      files: Object.freeze(sortedFiles.map((file) => Object.freeze({
        ...(file.destinationMode === null ? {} : { mode: file.destinationMode }),
        relativePath: file.destinationRelativePath,
        rawDigest: file.rawDigest,
        size: file.size
      })))
    });
    const withoutRevision = {
      bootstrapBundle,
      dependencyBinding,
      directories: sortedDirectories,
      directoryProofs: canonicalDirectoryProofs(proofs.directories),
      files: Object.freeze(sortedFiles.map((file) => Object.freeze({
        destinationMode: file.destinationMode,
        destinationRelativePath: file.destinationRelativePath,
        rawDigest: file.rawDigest,
        size: file.size,
        sourceAbsolutePath: file.sourceAbsolutePath,
        sourceIdentity: file.sourceIdentity
      }))),
      loaderBundle,
      manifest,
      rootProofs: canonicalRootProofs(proofs.roots),
      runnerBundle
    } satisfies Omit<RuntimeSourceSnapshotV1, 'snapshotRevision'>;
    return Object.freeze({
      ...withoutRevision,
      snapshotRevision: sha256Value(canonicalRuntimeSourceSnapshotPayload(withoutRevision))
    });
}

/**
 * Reuses only staging-independent host source evidence. Every issuance still
 * creates a fresh staging-bound plan and process-local opaque result.
 */
export async function issueSemanticMutationIsolatedRuntimeCapability(input: {
  readonly browserCache: string;
  readonly compilerRegistries?: readonly SemanticMutationIsolatedCompilerRegistryInput[];
  readonly runnerBundle: Uint8Array;
  readonly sources: SemanticMutationIsolatedRuntimeInputSources;
  readonly stagingWorkspaceRoot: string;
}): Promise<Readonly<{ status: 'available' }>> {
  if (!(input.runnerBundle instanceof Uint8Array) || input.runnerBundle.byteLength === 0) {
    throw new Error('Semantic Mutation isolated runner bundle is empty');
  }
  const inspector = await createReparsePointInspector();
  try {
    const staging = await assertCanonicalPhysicalRoot(input.stagingWorkspaceRoot, inspector, 'directory');
    const snapshotInput = Object.freeze({
      browserCache: path.resolve(input.browserCache),
      compilerRegistries: normalizedCompilerRegistries(input),
      runnerBundle: input.runnerBundle.slice(),
      sources: input.sources
    });
    const snapshot = await getRuntimeSourceSnapshot(
      snapshotInput,
      inspector,
      input.stagingWorkspaceRoot
    );
    for (const file of snapshot.files) {
      if (file.sourceAbsolutePath !== null &&
        isPathInside(staging.absolutePath, path.resolve(file.sourceAbsolutePath))) {
        throw new Error('Semantic Mutation runtime source overlaps the staging workspace');
      }
    }
    const withoutRevision = {
      bootstrapBundle: snapshot.bootstrapBundle,
      dependencyBinding: snapshot.dependencyBinding,
      directories: snapshot.directories,
      files: snapshot.files,
      loaderBundle: snapshot.loaderBundle,
      manifest: snapshot.manifest,
      runnerBundle: snapshot.runnerBundle,
      stagingRoot: staging.absolutePath,
      stagingRootIdentity: directoryIdentity(staging.identity)
    } satisfies Omit<SemanticMutationIsolatedRuntimePlanV1, 'planRevision'>;
    const plan = Object.freeze({
      ...withoutRevision,
      planRevision: sha256Value(canonicalPlanPayload(withoutRevision))
    });
    issuedRuntimePlans.add(plan);
    const result = Object.freeze({ status: 'available' as const });
    runtimePlansByBinding.set(result, plan);
    registerSemanticMutationIsolatedRuntimePlanBinding(result);
    return result;
  } finally {
    inspector.close();
  }
}

function requireRuntimePlan(binding: unknown): SemanticMutationIsolatedRuntimePlanV1 {
  if (!binding || typeof binding !== 'object') {
    throw new Error('Semantic Mutation isolated runtime plan binding is missing');
  }
  const resolvedBinding = resolveSemanticMutationIsolatedRuntimePlanBinding(binding);
  if (!resolvedBinding) {
    throw new Error('Semantic Mutation isolated runtime plan is invalid or forged');
  }
  const plan = runtimePlansByBinding.get(resolvedBinding);
  if (!plan || !issuedRuntimePlans.has(plan) ||
      plan.planRevision !== sha256Value(canonicalPlanPayload({
      bootstrapBundle: plan.bootstrapBundle,
      dependencyBinding: plan.dependencyBinding,
      directories: plan.directories,
      files: plan.files,
      loaderBundle: plan.loaderBundle,
      manifest: plan.manifest,
      runnerBundle: plan.runnerBundle,
      stagingRoot: plan.stagingRoot,
      stagingRootIdentity: plan.stagingRootIdentity
    })) || sha256Bytes(plan.bootstrapBundle) !==
      plan.files.find((file) => file.destinationRelativePath ===
        SEMANTIC_MUTATION_ISOLATED_BOOTSTRAP_RELATIVE_PATH)?.rawDigest ||
    sha256Bytes(plan.dependencyBinding) !==
      plan.files.find((file) => file.destinationRelativePath ===
        SEMANTIC_MUTATION_ISOLATED_PROJECT_DEPS_BINDING_RELATIVE_PATH)?.rawDigest ||
    sha256Bytes(plan.loaderBundle) !==
      plan.files.find((file) => file.destinationRelativePath ===
        SEMANTIC_MUTATION_ISOLATED_STAGED_LOADER_RELATIVE_PATH)?.rawDigest ||
    sha256Bytes(plan.runnerBundle) !==
      plan.files.find((file) => file.destinationRelativePath ===
        SEMANTIC_MUTATION_ISOLATED_RUNNER_CORE_RELATIVE_PATH)?.rawDigest) {
    throw new Error('Semantic Mutation isolated runtime plan is invalid or forged');
  }
  return plan;
}

function generatedBytes(plan: SemanticMutationIsolatedRuntimePlanV1, relativePath: string): Uint8Array {
  if (relativePath === SEMANTIC_MUTATION_ISOLATED_BOOTSTRAP_RELATIVE_PATH) {
    return plan.bootstrapBundle;
  }
  if (relativePath === SEMANTIC_MUTATION_ISOLATED_STAGED_LOADER_RELATIVE_PATH) {
    return plan.loaderBundle;
  }
  if (relativePath === SEMANTIC_MUTATION_ISOLATED_PROJECT_DEPS_BINDING_RELATIVE_PATH) {
    return plan.dependencyBinding;
  }
  if (relativePath === SEMANTIC_MUTATION_ISOLATED_RUNNER_CORE_RELATIVE_PATH) {
    return plan.runnerBundle;
  }
  if (relativePath === SEMANTIC_MUTATION_ISOLATED_BUNFIG_RELATIVE_PATH) return ISOLATED_BUNFIG_BYTES;
  throw new Error('Semantic Mutation isolated runtime generated input is unknown');
}

async function assertStagingPlanBinding(
  plan: SemanticMutationIsolatedRuntimePlanV1,
  stagingWorkspaceRoot: string,
  inspector: ReparsePointInspector
): Promise<void> {
  const staging = await assertCanonicalPhysicalRoot(stagingWorkspaceRoot, inspector, 'directory');
  if (foldedPath(staging.absolutePath) !== foldedPath(plan.stagingRoot) ||
    !sameDirectoryIdentity(directoryIdentity(staging.identity), plan.stagingRootIdentity)) {
    throw new Error('Semantic Mutation isolated runtime plan targets a different staging workspace');
  }
}

async function writeGeneratedFile(
  destination: string,
  bytes: Uint8Array,
  expected: RuntimeInputFileV1
): Promise<void> {
  if (sha256Bytes(bytes) !== expected.rawDigest || bytes.byteLength !== expected.size) {
    throw new Error('Semantic Mutation generated runtime input changed after capability planning');
  }
  const handle = await open(destination, 'wx');
  try {
    await handle.writeFile(bytes);
    if (expected.destinationMode !== null) await handle.chmod(expected.destinationMode);
  } finally {
    await handle.close();
  }
}

async function copyPlannedFile(
  file: RuntimeInputFileV1,
  destination: string,
  inspector: ReparsePointInspector
): Promise<void> {
  if (file.sourceAbsolutePath === null || 'generatedDigest' in file.sourceIdentity) {
    throw new Error('Semantic Mutation runtime source binding is invalid');
  }
  const beforePath = await bigintLstat(file.sourceAbsolutePath);
  assertPhysicalMetadata(beforePath, file.sourceAbsolutePath, inspector, 'file');
  const beforeIdentity = metadataIdentity(beforePath);
  if (!sameIdentity(beforeIdentity, file.sourceIdentity)) {
    throw new Error('Semantic Mutation runtime source identity changed after capability planning');
  }
  const sourceHandle = await open(file.sourceAbsolutePath, 'r');
  let destinationHandle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const beforeHandle = await sourceHandle.stat({ bigint: true }) as BigIntMetadata;
    if (!sameIdentity(metadataIdentity(beforeHandle), file.sourceIdentity)) {
      throw new Error('Semantic Mutation runtime source opened a different identity');
    }
    destinationHandle = await open(destination, 'wx');
    const buffer = Buffer.allocUnsafe(HASH_BUFFER_SIZE);
    const hash = createHash('sha256');
    let total = 0;
    while (true) {
      const { bytesRead } = await sourceHandle.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      const chunk = buffer.subarray(0, bytesRead);
      hash.update(chunk);
      let written = 0;
      while (written < bytesRead) {
        const result = await destinationHandle.write(chunk, written, bytesRead - written, null);
        if (result.bytesWritten <= 0) throw new Error('Semantic Mutation runtime copy made no progress');
        written += result.bytesWritten;
      }
      total += bytesRead;
    }
    if (file.destinationMode !== null) await destinationHandle.chmod(file.destinationMode);
    const afterHandle = await sourceHandle.stat({ bigint: true }) as BigIntMetadata;
    const afterPath = await bigintLstat(file.sourceAbsolutePath);
    assertPhysicalMetadata(afterPath, file.sourceAbsolutePath, inspector, 'file');
    if (!sameIdentity(metadataIdentity(afterHandle), file.sourceIdentity) ||
      !sameIdentity(metadataIdentity(afterPath), file.sourceIdentity) ||
      total !== file.size || `sha256:${hash.digest('hex')}` !== file.rawDigest) {
      throw new Error('Semantic Mutation runtime source changed during materialization');
    }
  } finally {
    await destinationHandle?.close();
    await sourceHandle.close();
  }
}

async function scanDestinationStructure(
  stagingRoot: string,
  relativeRoot: string,
  inspector: ReparsePointInspector
): Promise<RuntimeDestinationStructureV1> {
  const absoluteRoot = absoluteDestination(stagingRoot, relativeRoot);
  const root = await assertCanonicalPhysicalRoot(absoluteRoot, inspector, 'directory');
  const directories = new Set<string>();
  const files: RuntimeDestinationStructureFileV1[] = [];
  const visit = async (directory: string, relativeDirectory: string): Promise<void> => {
    directories.add(canonicalRelativePath(relativeDirectory));
    const before = await bigintLstat(directory);
    assertPhysicalMetadata(before, directory, inspector, 'directory');
    const beforeIdentity = metadataIdentity(before);
    const names = (await readdir(directory)).sort(compareCodeUnits);
    for (const name of names) {
      if (!name || name === '.' || name === '..' || name.includes('\0')) {
        throw new Error('Semantic Mutation runtime destination has an invalid entry name');
      }
      const absoluteChild = path.join(directory, name);
      const relativeChild = canonicalRelativePath(`${relativeDirectory}/${name}`);
      const metadata = await bigintLstat(absoluteChild);
      if (metadata.isDirectory()) {
        assertPhysicalMetadata(metadata, absoluteChild, inspector, 'directory');
        await visit(absoluteChild, relativeChild);
      } else {
        assertPhysicalMetadata(metadata, absoluteChild, inspector, 'file', true);
        if (metadata.size > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new Error('Semantic Mutation runtime destination is too large');
        }
        files.push(Object.freeze({
          absolutePath: path.resolve(absoluteChild),
          identity: metadataIdentity(metadata),
          mode: Number(BigInt(metadata.mode) & 0o777n),
          relativePath: relativeChild,
          size: Number(metadata.size)
        }));
      }
    }
    const after = await bigintLstat(directory);
    assertPhysicalMetadata(after, directory, inspector, 'directory');
    const namesAfter = (await readdir(directory)).sort(compareCodeUnits);
    if (!sameIdentity(beforeIdentity, metadataIdentity(after)) ||
      JSON.stringify(namesAfter) !== JSON.stringify(names)) {
      throw new Error('Semantic Mutation runtime destination changed during structural scan');
    }
  };
  await visit(root.absolutePath, canonicalRelativePath(relativeRoot));
  const afterRoot = await bigintLstat(root.absolutePath);
  if (!sameDirectoryIdentity(directoryIdentity(metadataIdentity(afterRoot)), directoryIdentity(root.identity))) {
    throw new Error('Semantic Mutation runtime destination root changed during structural scan');
  }
  return {
    directories: Object.freeze([...directories].sort(compareCodeUnits)),
    files: Object.freeze(files.sort((left, right) => compareCodeUnits(left.relativePath, right.relativePath)))
  };
}

async function exactDestinationStructure(
  plan: SemanticMutationIsolatedRuntimePlanV1,
  inspector: ReparsePointInspector
): Promise<RuntimeDestinationStructureV1> {
  const structures = await Promise.all(OWNED_RUNTIME_ROOTS.map((relativeRoot) =>
    scanDestinationStructure(plan.stagingRoot, relativeRoot, inspector)));
  return Object.freeze({
    directories: structures.flatMap((structure) => structure.directories).sort(compareCodeUnits),
    files: structures.flatMap((structure) => structure.files)
      .sort((left, right) => compareCodeUnits(left.relativePath, right.relativePath))
  });
}

function assertExactDestinationStructure(
  plan: SemanticMutationIsolatedRuntimePlanV1,
  actual: RuntimeDestinationStructureV1
): void {
  const expected = {
    directories: plan.manifest.directories,
    files: plan.manifest.files.map((file) => ({
      ...(file.mode === undefined ? {} : { mode: file.mode }),
      relativePath: file.relativePath,
      size: file.size
    }))
  };
  const expectedByPath = new Map(plan.manifest.files.map((file) => [file.relativePath, file]));
  const observed = {
    directories: actual.directories,
    files: actual.files.map((file) => ({
      ...(expectedByPath.get(file.relativePath)?.mode === undefined ? {} : { mode: file.mode }),
      relativePath: file.relativePath,
      size: file.size
    }))
  };
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    throw new Error('Semantic Mutation isolated runtime destination structure is not exact');
  }
}

async function assertExactDestinationManifest(
  plan: SemanticMutationIsolatedRuntimePlanV1,
  inspector: ReparsePointInspector,
  afterHash?: () => Promise<void>
): Promise<void> {
  const structure = await exactDestinationStructure(plan, inspector);
  assertExactDestinationStructure(plan, structure);
  const files = await runCanonicalBatches(structure.files, async (file) => {
    const evidence = await stableFileEvidence(file.absolutePath, inspector, false, true);
    if (!sameIdentity(file.identity, evidence.identity)) {
      throw new Error('Semantic Mutation isolated runtime destination changed before launch');
    }
    return Object.freeze({
      ...(plan.manifest.files.find((entry) => entry.relativePath === file.relativePath)?.mode === undefined
        ? {}
        : { mode: Number(BigInt(evidence.identity.mode) & 0o777n) }),
      relativePath: file.relativePath,
      rawDigest: evidence.rawDigest,
      size: evidence.size
    });
  });
  const actual = { directories: structure.directories, files };
  if (JSON.stringify(actual) !== JSON.stringify(plan.manifest)) {
    throw new Error('Semantic Mutation isolated runtime destination manifest is not exact');
  }
  await afterHash?.();
  const afterHashStructure = await exactDestinationStructure(plan, inspector);
  assertExactDestinationStructure(plan, afterHashStructure);
  if (afterHashStructure.files.length !== structure.files.length ||
    afterHashStructure.files.some((file, index) => {
      const before = structure.files[index];
      return before === undefined || file.relativePath !== before.relativePath ||
        !sameIdentity(file.identity, before.identity);
    })) {
    throw new Error('Semantic Mutation isolated runtime destination changed during launch proof');
  }
}

interface RuntimeSourceSnapshotInputV1 {
  readonly browserCache: string;
  readonly compilerRegistries: readonly SemanticMutationIsolatedCompilerRegistryInput[];
  readonly runnerBundle: Uint8Array;
  readonly sources: SemanticMutationIsolatedRuntimeInputSources;
}

function normalizedCompilerRegistries(input: {
  readonly compilerRegistries?: readonly SemanticMutationIsolatedCompilerRegistryInput[];
  readonly sources: SemanticMutationIsolatedRuntimeInputSources;
}): readonly SemanticMutationIsolatedCompilerRegistryInput[] {
  const registries = input.compilerRegistries ?? [{
    destinationRelativePath:
      `${SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT}/platform/registry/official`,
    sourceRoot: input.sources.officialRegistry
  }];
  return Object.freeze([...registries]
    .map((registry) => Object.freeze({
      destinationRelativePath: canonicalRelativePath(registry.destinationRelativePath),
      sourceRoot: path.resolve(registry.sourceRoot)
    }))
    .sort((left, right) => compareCodeUnits(
      left.destinationRelativePath,
      right.destinationRelativePath
    )));
}

function runtimeSourceSnapshotCacheKey(input: RuntimeSourceSnapshotInputV1): string {
  return sha256Value({
    domain: 'semantic-mutation-runtime-source-snapshot-cache-key-v1',
    browserCache: foldedPath(path.resolve(input.browserCache)),
    compilerRegistries: input.compilerRegistries.map((registry) => ({
      destinationRelativePath: registry.destinationRelativePath,
      sourceRoot: foldedPath(path.resolve(registry.sourceRoot))
    })),
    generatedDigests: {
      bootstrap: sha256Bytes(semanticMutationIsolatedBootstrapBytes()),
      bunfig: sha256Bytes(ISOLATED_BUNFIG_BYTES),
      loader: sha256Bytes(semanticMutationIsolatedStagedLoaderBytes(Object.freeze({
        formatRevision: 'semantic-mutation-isolated-bundled-loader-binding-v1',
        executionRevision: 'semantic-mutation-bundled-core-relocation-v1'
      }))),
      runner: sha256Bytes(input.runnerBundle)
    },
    sources: {
      browserCache: foldedPath(path.resolve(input.sources.browserCache)),
      compilerModulesRoot: foldedPath(path.resolve(input.sources.compilerModulesRoot)),
      compilerPackage: foldedPath(path.resolve(input.sources.compilerPackage)),
      composeTemplates: foldedPath(path.resolve(input.sources.composeTemplates)),
      dependencyModules: foldedPath(path.resolve(input.sources.dependencyModules)),
      officialPolicies: foldedPath(path.resolve(input.sources.officialPolicies)),
      officialRegistry: foldedPath(path.resolve(input.sources.officialRegistry))
    }
  });
}

function canonicalRuntimeSourceSnapshotPayload(
  snapshot: Omit<RuntimeSourceSnapshotV1, 'snapshotRevision'>
): unknown {
  return {
    domain: 'semantic-mutation-runtime-source-snapshot-v1',
    bootstrapBundleDigest: sha256Bytes(snapshot.bootstrapBundle),
    dependencyBindingDigest: sha256Bytes(snapshot.dependencyBinding),
    directories: snapshot.directories,
    files: snapshot.files.map((file) => ({
      destinationMode: file.destinationMode,
      destinationRelativePath: file.destinationRelativePath,
      rawDigest: file.rawDigest,
      size: file.size,
      sourceAbsolutePath: file.sourceAbsolutePath
    })),
    loaderBundleDigest: sha256Bytes(snapshot.loaderBundle),
    manifest: snapshot.manifest,
    runnerBundleDigest: sha256Bytes(snapshot.runnerBundle)
  };
}

function canonicalRootProofs(
  proofs: readonly RuntimeSourceRootProofV1[]
): readonly RuntimeSourceRootProofV1[] {
  const unique = new Map<string, RuntimeSourceRootProofV1>();
  for (const proof of proofs) {
    const key = `${proof.expected}:${foldedPath(proof.absolutePath)}`;
    const previous = unique.get(key);
    if (previous && !sameIdentity(previous.identity, proof.identity)) {
      throw new Error('Semantic Mutation runtime source root changed during capture');
    }
    unique.set(key, proof);
  }
  return Object.freeze([...unique.values()].sort((left, right) =>
    compareCodeUnits(left.absolutePath, right.absolutePath)));
}

function canonicalDirectoryProofs(
  proofs: readonly RuntimeSourceDirectoryProofV1[]
): readonly RuntimeSourceDirectoryProofV1[] {
  const unique = new Map<string, RuntimeSourceDirectoryProofV1>();
  for (const proof of proofs) {
    const key = foldedPath(proof.absolutePath);
    const previous = unique.get(key);
    if (previous && (!sameIdentity(previous.identity, proof.identity) ||
      JSON.stringify(previous.childNames) !== JSON.stringify(proof.childNames))) {
      throw new Error('Semantic Mutation runtime source directory changed during capture');
    }
    unique.set(key, proof);
  }
  return Object.freeze([...unique.values()].sort((left, right) =>
    compareCodeUnits(left.absolutePath, right.absolutePath)));
}

function missingRuntimeInput(error: unknown): boolean {
  const code = error !== null && typeof error === 'object' && 'code' in error
    ? (error as { readonly code?: unknown }).code
    : undefined;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

async function rootProofMatches(
  proof: RuntimeSourceRootProofV1,
  inspector: ReparsePointInspector
): Promise<boolean> {
  try {
    const current = await assertCanonicalPhysicalRoot(
      proof.absolutePath,
      inspector,
      proof.expected
    );
    return sameIdentity(current.identity, proof.identity);
  } catch (error) {
    if (missingRuntimeInput(error)) return false;
    throw error;
  }
}

async function directoryProofMatches(
  proof: RuntimeSourceDirectoryProofV1,
  inspector: ReparsePointInspector
): Promise<boolean> {
  try {
    const before = await bigintLstat(proof.absolutePath);
    assertPhysicalMetadata(before, proof.absolutePath, inspector, 'directory');
    const beforeIdentity = metadataIdentity(before);
    const names = (await readdir(proof.absolutePath)).sort(compareCodeUnits);
    const after = await bigintLstat(proof.absolutePath);
    assertPhysicalMetadata(after, proof.absolutePath, inspector, 'directory');
    const namesAfter = (await readdir(proof.absolutePath)).sort(compareCodeUnits);
    return sameIdentity(beforeIdentity, proof.identity) &&
      sameIdentity(beforeIdentity, metadataIdentity(after)) &&
      JSON.stringify(names) === JSON.stringify(proof.childNames) &&
      JSON.stringify(namesAfter) === JSON.stringify(proof.childNames);
  } catch (error) {
    if (missingRuntimeInput(error)) return false;
    throw error;
  }
}

async function fileProofsMatch(
  snapshot: RuntimeSourceSnapshotV1,
  inspector: ReparsePointInspector
): Promise<boolean> {
  const unique = new Map<string, RuntimeInputFileV1>();
  for (const file of snapshot.files) {
    if (file.sourceAbsolutePath === null || 'generatedDigest' in file.sourceIdentity) continue;
    const key = foldedPath(file.sourceAbsolutePath);
    const previous = unique.get(key);
    if (previous && (!sameIdentity(
      previous.sourceIdentity as RuntimeSourceIdentityV1,
      file.sourceIdentity
    ) || previous.rawDigest !== file.rawDigest || previous.size !== file.size)) {
      throw new Error('Semantic Mutation runtime snapshot has conflicting source proofs');
    }
    unique.set(key, file);
  }
  const matches = await runCanonicalBatches(
    [...unique.values()].sort((left, right) => compareCodeUnits(
      left.sourceAbsolutePath!,
      right.sourceAbsolutePath!
    )),
    async (file) => {
      try {
        const current = await bigintLstat(file.sourceAbsolutePath!);
        assertPhysicalMetadata(current, file.sourceAbsolutePath!, inspector, 'file');
        return sameIdentity(metadataIdentity(current), file.sourceIdentity as RuntimeSourceIdentityV1);
      } catch (error) {
        if (missingRuntimeInput(error)) return false;
        throw error;
      }
    }
  );
  return matches.every(Boolean);
}

async function revalidateRuntimeSourceSnapshot(
  snapshot: RuntimeSourceSnapshotV1,
  inspector: ReparsePointInspector
): Promise<boolean> {
  const { snapshotRevision: _snapshotRevision, ...withoutRevision } = snapshot;
  if (snapshot.snapshotRevision !== sha256Value(canonicalRuntimeSourceSnapshotPayload(withoutRevision))) {
    throw new Error('Semantic Mutation runtime source snapshot is invalid');
  }
  const rootMatches = await runCanonicalBatches(
    snapshot.rootProofs,
    async (proof) => await rootProofMatches(proof, inspector)
  );
  if (!rootMatches.every(Boolean)) return false;
  const firstDirectoryPass = await runCanonicalBatches(
    snapshot.directoryProofs,
    async (proof) => await directoryProofMatches(proof, inspector)
  );
  if (!firstDirectoryPass.every(Boolean) || !await fileProofsMatch(snapshot, inspector)) return false;
  const secondDirectoryPass = await runCanonicalBatches(
    snapshot.directoryProofs,
    async (proof) => await directoryProofMatches(proof, inspector)
  );
  return secondDirectoryPass.every(Boolean);
}

function trimRuntimeSourceSnapshotBucket(
  bucket: Map<string, RuntimeSourceSnapshotCacheSlot>,
  protectedKey: string
): void {
  for (const [key, slot] of bucket) {
    if (bucket.size <= MAX_RUNTIME_SOURCE_SNAPSHOTS_PER_SOURCES) return;
    if (key !== protectedKey && slot.flight === undefined) bucket.delete(key);
  }
}

async function getRuntimeSourceSnapshot(
  input: RuntimeSourceSnapshotInputV1,
  inspector: ReparsePointInspector,
  stagingWorkspaceRoot: string
): Promise<RuntimeSourceSnapshotV1> {
  const key = runtimeSourceSnapshotCacheKey(input);
  let bucket = runtimeSourceSnapshotsBySources.get(input.sources);
  if (!bucket) {
    bucket = new Map();
    runtimeSourceSnapshotsBySources.set(input.sources, bucket);
  }
  let slot = bucket.get(key);
  if (!slot) {
    slot = { captures: 0, revalidations: 0 };
    bucket.set(key, slot);
  } else {
    bucket.delete(key);
    bucket.set(key, slot);
  }
  trimRuntimeSourceSnapshotBucket(bucket, key);
  const sharedFlight = slot.flight;
  if (sharedFlight) {
    return await withSemanticMutationIsolatedPhaseTelemetry(
      stagingWorkspaceRoot,
      'source-snapshot-single-flight-wait',
      async () => await sharedFlight
    );
  }
  const activeSlot = slot;
  const flight = (async () => {
    const currentSnapshot = activeSlot.snapshot;
    if (currentSnapshot) {
      activeSlot.revalidations += 1;
      if (await withSemanticMutationIsolatedPhaseTelemetry(
        stagingWorkspaceRoot,
        'source-snapshot-revalidate',
        async () => await revalidateRuntimeSourceSnapshot(currentSnapshot, inspector)
      )) {
        return currentSnapshot;
      }
    }
    activeSlot.captures += 1;
    return await withSemanticMutationIsolatedPhaseTelemetry(
      stagingWorkspaceRoot,
      'source-snapshot-capture',
      async () => await captureRuntimeSourceSnapshot(input, inspector)
    );
  })();
  activeSlot.flight = flight;
  try {
    const snapshot = await flight;
    activeSlot.snapshot = snapshot;
    return snapshot;
  } catch (error) {
    if (bucket.get(key) === activeSlot && activeSlot.flight === flight) bucket.delete(key);
    throw error;
  } finally {
    if (activeSlot.flight === flight) activeSlot.flight = undefined;
    trimRuntimeSourceSnapshotBucket(bucket, key);
  }
}

/** Test-only cache counters; snapshot contents and capability bindings stay private. */
export function semanticMutationRuntimeSourceSnapshotCacheStatsForTests(
  sources: SemanticMutationIsolatedRuntimeInputSources
): Readonly<{ captures: number; entries: number; flights: number; revalidations: number }> {
  const slots = [...(runtimeSourceSnapshotsBySources.get(sources)?.values() ?? [])];
  return Object.freeze({
    captures: slots.reduce((total, slot) => total + slot.captures, 0),
    entries: slots.length,
    flights: slots.filter((slot) => slot.flight !== undefined).length,
    revalidations: slots.reduce((total, slot) => total + slot.revalidations, 0)
  });
}

/**
 * Test-only launch-proof seam. It exercises the production structural scan,
 * byte hash, hardlink/reparse checks, and post-hash identity pass without
 * exposing an issued runtime binding.
 */
export async function assertSemanticMutationRuntimeDestinationManifestForTests(input: {
  readonly afterHash?: () => Promise<void>;
  readonly directories: readonly string[];
  readonly files: readonly RuntimeDestinationManifestEntryV1[];
  readonly stagingRoot: string;
}): Promise<void> {
  const plan = {
    stagingRoot: path.resolve(input.stagingRoot),
    manifest: Object.freeze({
      directories: Object.freeze([...input.directories].sort(compareCodeUnits)),
      files: Object.freeze([...input.files].sort((left, right) =>
        compareCodeUnits(left.relativePath, right.relativePath)))
    })
  } as SemanticMutationIsolatedRuntimePlanV1;
  const inspector = await createReparsePointInspector();
  try {
    await assertExactDestinationManifest(plan, inspector, input.afterHash);
  } finally {
    inspector.close();
  }
}

async function assertExistingDestinationDoesNotAliasSources(
  destinationRoot: string,
  sourceIdentities: ReadonlySet<string>,
  inspector: ReparsePointInspector
): Promise<void> {
  let root: BigIntMetadata;
  try {
    root = await bigintLstat(destinationRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  assertPhysicalMetadata(root, destinationRoot, inspector, 'directory');
  const visit = async (directory: string): Promise<void> => {
    for (const name of (await readdir(directory)).sort(compareCodeUnits)) {
      const child = path.join(directory, name);
      const metadata = await bigintLstat(child);
      if (metadata.isDirectory()) {
        assertPhysicalMetadata(metadata, child, inspector, 'directory');
        await visit(child);
      } else {
        assertPhysicalMetadata(metadata, child, inspector, 'file');
        const identity = metadataIdentity(metadata);
        if (sourceIdentities.has(`${identity.dev}:${identity.ino}`)) {
          throw new Error('Semantic Mutation runtime source aliases an existing destination');
        }
      }
    }
  };
  await visit(destinationRoot);
}

interface OwnedRuntimeParentProofV1 {
  readonly absolutePath: string;
  readonly identity: RuntimeDirectoryIdentityV1;
  readonly relativeRoot: typeof OWNED_RUNTIME_ROOTS[number];
}

async function ensureOwnedRuntimeSupportParent(
  plan: SemanticMutationIsolatedRuntimePlanV1,
  inspector: ReparsePointInspector,
  commitFence: CommitFence
): Promise<void> {
  const processRoot = path.dirname(absoluteDestination(
    plan.stagingRoot,
    SEMANTIC_MUTATION_ISOLATED_BROWSER_RELATIVE_ROOT
  ));
  try {
    await assertCanonicalPhysicalRoot(processRoot, inspector, 'directory');
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const stagingBefore = await assertCanonicalPhysicalRoot(plan.stagingRoot, inspector, 'directory');
  await commitFence();
  await mkdir(processRoot);
  await commitFence();
  const stagingAfter = await assertCanonicalPhysicalRoot(plan.stagingRoot, inspector, 'directory');
  if (!sameDirectoryIdentity(
    directoryIdentity(stagingBefore.identity),
    directoryIdentity(stagingAfter.identity)
  )) {
    throw new Error('Semantic Mutation staging root changed while creating its runtime parent');
  }
}

async function captureOwnedRuntimeParentProofs(
  plan: SemanticMutationIsolatedRuntimePlanV1,
  inspector: ReparsePointInspector,
  commitFence: CommitFence
): Promise<ReadonlyMap<string, OwnedRuntimeParentProofV1>> {
  await ensureOwnedRuntimeSupportParent(plan, inspector, commitFence);
  const proofs = new Map<string, OwnedRuntimeParentProofV1>();
  for (const relativeRoot of OWNED_RUNTIME_ROOTS) {
    const absolutePath = path.dirname(absoluteDestination(plan.stagingRoot, relativeRoot));
    const parent = await assertCanonicalPhysicalRoot(absolutePath, inspector, 'directory');
    proofs.set(relativeRoot, Object.freeze({
      absolutePath: parent.absolutePath,
      identity: directoryIdentity(parent.identity),
      relativeRoot
    }));
  }
  return proofs;
}

async function assertOwnedRuntimeParentProof(
  proof: OwnedRuntimeParentProofV1,
  inspector: ReparsePointInspector
): Promise<void> {
  const current = await assertCanonicalPhysicalRoot(proof.absolutePath, inspector, 'directory');
  if (!sameDirectoryIdentity(directoryIdentity(current.identity), proof.identity)) {
    throw new Error('Semantic Mutation runtime destination parent changed during materialization');
  }
}

export async function materializeSemanticMutationIsolatedRuntime(input: {
  readonly binding: unknown;
  readonly commitFence: CommitFence;
  readonly stagingWorkspaceRoot: string;
}): Promise<{ readonly browsersPath: string; readonly runnerRelativePath: string }> {
  const plan = requireRuntimePlan(input.binding);
  const inspector = await createReparsePointInspector();
  try {
    await assertStagingPlanBinding(plan, input.stagingWorkspaceRoot, inspector);
    if (plan.files.some((file) => file.sourceAbsolutePath !== null &&
      isPathInside(plan.stagingRoot, path.resolve(file.sourceAbsolutePath)))) {
      throw new Error('Semantic Mutation runtime source overlaps a materialization target');
    }
    await runCanonicalBatches(plan.files, async (file) => {
      if (file.sourceAbsolutePath === null || 'generatedDigest' in file.sourceIdentity) return;
      const current = await bigintLstat(file.sourceAbsolutePath);
      assertPhysicalMetadata(current, file.sourceAbsolutePath, inspector, 'file');
      if (!sameIdentity(metadataIdentity(current), file.sourceIdentity)) {
        throw new Error('Semantic Mutation runtime source changed before materialization');
      }
    });
    const sourceIdentities = new Set(plan.files.flatMap((file) =>
      file.sourceAbsolutePath !== null && !('generatedDigest' in file.sourceIdentity)
        ? [`${file.sourceIdentity.dev}:${file.sourceIdentity.ino}`]
        : []));
    const parentProofs = await captureOwnedRuntimeParentProofs(plan, inspector, input.commitFence);
    for (const relativeRoot of OWNED_RUNTIME_ROOTS) {
      const parentProof = parentProofs.get(relativeRoot);
      if (!parentProof) throw new Error('Semantic Mutation runtime destination parent proof is missing');
      await assertOwnedRuntimeParentProof(parentProof, inspector);
      await assertExistingDestinationDoesNotAliasSources(
        absoluteDestination(plan.stagingRoot, relativeRoot),
        sourceIdentities,
        inspector
      );
      await input.commitFence();
      await assertOwnedRuntimeParentProof(parentProof, inspector);
      await rm(absoluteDestination(plan.stagingRoot, relativeRoot), { recursive: true, force: true });
      await input.commitFence();
      await assertOwnedRuntimeParentProof(parentProof, inspector);
      await mkdir(absoluteDestination(plan.stagingRoot, relativeRoot));
      await assertOwnedRuntimeParentProof(parentProof, inspector);
      await assertCanonicalPhysicalRoot(
        absoluteDestination(plan.stagingRoot, relativeRoot),
        inspector,
        'directory'
      );
    }
    const orderedDirectories = [...plan.directories].sort((left, right) => {
      const depth = left.split('/').length - right.split('/').length;
      return depth === 0 ? compareCodeUnits(left, right) : depth;
    });
    await runCanonicalBatches(orderedDirectories, async (relativeDirectory) => {
      await mkdir(absoluteDestination(plan.stagingRoot, relativeDirectory), { recursive: true });
    }, input.commitFence);
    await runCanonicalBatches(plan.files, async (file) => {
      const destination = absoluteDestination(plan.stagingRoot, file.destinationRelativePath);
      if (file.sourceAbsolutePath === null) {
        await writeGeneratedFile(
          destination,
          generatedBytes(plan, file.destinationRelativePath),
          file
        );
      } else {
        await copyPlannedFile(file, destination, inspector);
      }
    }, input.commitFence);
    await input.commitFence();
    const structure = await exactDestinationStructure(plan, inspector);
    assertExactDestinationStructure(plan, structure);
    return {
      browsersPath: absoluteDestination(plan.stagingRoot, SEMANTIC_MUTATION_ISOLATED_BROWSER_RELATIVE_ROOT),
      runnerRelativePath: SEMANTIC_MUTATION_ISOLATED_BOOTSTRAP_RELATIVE_PATH
    };
  } finally {
    inspector.close();
  }
}

/** Revalidates the exact materialized manifest immediately before launch. */
export async function assertSemanticMutationIsolatedRuntimeLaunchManifest(input: {
  readonly binding: unknown;
  readonly commitFence: CommitFence;
  readonly stagingWorkspaceRoot: string;
}): Promise<void> {
  const plan = requireRuntimePlan(input.binding);
  const inspector = await createReparsePointInspector();
  try {
    await input.commitFence();
    await assertStagingPlanBinding(plan, input.stagingWorkspaceRoot, inspector);
    await assertExactDestinationManifest(plan, inspector);
    await input.commitFence();
  } finally {
    inspector.close();
  }
}
