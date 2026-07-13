import { createHash } from 'node:crypto';
import { lstat, mkdir, open, readdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';

import type { CommitFence } from '../../shared/fs.ts';
import {
  registerSemanticMutationIsolatedRuntimePlanBinding,
  resolveSemanticMutationIsolatedRuntimePlanBinding
} from './semantic-mutation-isolated-runtime-binding.ts';

export const SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT = '.isolated-compiler' as const;
export const SEMANTIC_MUTATION_ISOLATED_RUNNER_RELATIVE_PATH =
  '.isolated-compiler/platform/orchestrator/semantic-mutation-isolated-verification-runner.mjs' as const;
export const SEMANTIC_MUTATION_ISOLATED_BUNFIG_RELATIVE_PATH =
  '.isolated-compiler/bunfig.toml' as const;
export const SEMANTIC_MUTATION_ISOLATED_BROWSER_RELATIVE_ROOT =
  '.isolated-process/playwright-browsers' as const;

const ISOLATED_BUNFIG_BYTES = new TextEncoder().encode('# isolated runtime\n');
const FILE_ATTRIBUTE_REPARSE_POINT = 0x0000_0400;
const INVALID_FILE_ATTRIBUTES = 0xffff_ffff;
const HASH_BUFFER_SIZE = 1024 * 1024;
const MAX_MANIFEST_BYTES = 1024 * 1024;

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
  readonly destinationRelativePath: string;
  readonly rawDigest: string;
  readonly size: number;
  readonly sourceAbsolutePath: string | null;
  readonly sourceIdentity: RuntimeSourceIdentityV1 | { readonly generatedDigest: string };
}

interface RuntimeDestinationManifestEntryV1 {
  readonly relativePath: string;
  readonly rawDigest: string;
  readonly size: number;
}

interface RuntimeDestinationManifestV1 {
  readonly directories: readonly string[];
  readonly files: readonly RuntimeDestinationManifestEntryV1[];
}

interface SemanticMutationIsolatedRuntimePlanV1 {
  readonly directories: readonly string[];
  readonly files: readonly RuntimeInputFileV1[];
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

function sha256Bytes(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function sha256Value(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
  collectBytes = false
): Promise<RuntimeInputFileV1 & { readonly bytes?: Uint8Array }> {
  const source = await assertCanonicalPhysicalRoot(sourcePath, inspector, 'file');
  const evidence = await stableFileEvidence(source.absolutePath, inspector, collectBytes);
  if (!sameIdentity(source.identity, evidence.identity)) {
    throw new Error('Semantic Mutation runtime input file identity changed during capture');
  }
  return Object.freeze({
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
  rejectHardLinks = false,
  destinationDirectories?: Set<string>
): Promise<RuntimeInputFileV1[]> {
  const source = await assertCanonicalPhysicalRoot(sourceRoot, inspector, 'directory');
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
      const metadata = await bigintLstat(absoluteChild);
      if (metadata.isDirectory()) {
        assertPhysicalMetadata(metadata, absoluteChild, inspector, 'directory');
        await visit(absoluteChild, relativeChild);
      } else {
        assertPhysicalMetadata(metadata, absoluteChild, inspector, 'file', rejectHardLinks);
        const evidence = await stableFileEvidence(absoluteChild, inspector, false, rejectHardLinks);
        entries.push(Object.freeze({
          destinationRelativePath: canonicalRelativePath(`${destinationRoot}/${relativeChild}`),
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

function parsePackageManifest(bytes: Uint8Array, expectedName?: string): Record<string, string> {
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
  return { ...(value.dependencies as Record<string, string> | undefined) };
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
    directories: plan.directories,
    files: plan.files.map((file) => ({
      destinationRelativePath: file.destinationRelativePath,
      rawDigest: file.rawDigest,
      size: file.size,
      sourceAbsolutePath: file.sourceAbsolutePath,
      sourceIdentity: file.sourceIdentity
    })),
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
  const ownedRoot = canonical === SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT ||
      canonical.startsWith(`${SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT}/`)
    ? SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT
    : SEMANTIC_MUTATION_ISOLATED_BROWSER_RELATIVE_ROOT;
  let current = path.posix.dirname(canonical);
  while (current === ownedRoot || current.startsWith(`${ownedRoot}/`)) {
    directories.add(canonicalRelativePath(current));
    if (current === ownedRoot) break;
    current = path.posix.dirname(current);
  }
}

/**
 * Captures every host runtime input once during the trusted capability probe.
 * The returned status object is the only public surface; the plan remains
 * process-local and is transferred to evidence/CapabilityPlan objects by
 * WeakMap identity.
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
    const directories = new Set<string>();
    const compilerPackage = await captureInputFile(
      input.sources.compilerPackage,
      `${SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT}/package.json`,
      inspector,
      true
    );
    assertCompilerPackageManifest(compilerPackage.bytes!);
    const playwrightDescriptor = await captureInputFile(
      path.join(input.sources.compilerModulesRoot, 'playwright-core', 'browsers.json'),
      `${SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT}/node_modules/playwright-core/browsers.json`,
      inspector,
      true
    );
    const requiredBrowserExecutable = requiredPlaywrightExecutable(playwrightDescriptor.bytes!);
    const registryInputs = input.compilerRegistries ?? [{
      destinationRelativePath:
        `${SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT}/platform/registry/official`,
      sourceRoot: input.sources.officialRegistry
    }];
    const registryFiles: RuntimeInputFileV1[] = [];
    for (const registry of [...registryInputs].sort((left, right) =>
      compareCodeUnits(left.destinationRelativePath, right.destinationRelativePath))) {
      registryFiles.push(...await captureInputTree(
        registry.sourceRoot,
        canonicalRelativePath(registry.destinationRelativePath),
        inspector,
        false,
        directories
      ));
    }
    const browserFiles = await captureInputTree(
      input.browserCache,
      SEMANTIC_MUTATION_ISOLATED_BROWSER_RELATIVE_ROOT,
      inspector,
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

    const files: RuntimeInputFileV1[] = [
      generatedInputFile(SEMANTIC_MUTATION_ISOLATED_RUNNER_RELATIVE_PATH, input.runnerBundle),
      generatedInputFile(SEMANTIC_MUTATION_ISOLATED_BUNFIG_RELATIVE_PATH, ISOLATED_BUNFIG_BYTES),
      compilerPackage,
      playwrightDescriptor,
      ...registryFiles,
      ...await captureInputTree(
        input.sources.officialPolicies,
        `${SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT}/platform/policies/official`,
        inspector,
        false,
        directories
      ),
      ...await captureInputTree(
        input.sources.composeTemplates,
        `${SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT}/platform/orchestrator/templates`,
        inspector,
        false,
        directories
      ),
      ...await captureInputTree(
        input.sources.dependencyModules,
        `${SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT}/.shared-deps/node_modules`,
        inspector,
        false,
        directories
      ),
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
        true
      );
      const dependencies = parsePackageManifest(packageManifest.bytes!, moduleName);
      const moduleFiles = await captureInputTree(
        moduleRoot,
        `${SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT}/node_modules/${moduleName}`,
        inspector,
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
      for (const dependency of Object.keys(dependencies).sort(compareCodeUnits)) {
        if (!seen.has(dependency)) pending.push(dependency);
      }
    }

    const sortedFiles = files.sort((left, right) =>
      compareCodeUnits(left.destinationRelativePath, right.destinationRelativePath));
    assertUniqueAndCanonicalFiles(sortedFiles);
    for (const file of sortedFiles) {
      addOwnedParentDirectories(directories, file.destinationRelativePath);
      if (file.sourceAbsolutePath !== null &&
        isPathInside(staging.absolutePath, path.resolve(file.sourceAbsolutePath))) {
        throw new Error('Semantic Mutation runtime source overlaps the staging workspace');
      }
    }
    const requiredRoots = [
      `${SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT}/platform/policies/official/`,
      `${SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT}/platform/orchestrator/templates/`,
      `${SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT}/.shared-deps/node_modules/`,
      `${SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT}/node_modules/`,
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
        relativePath: file.destinationRelativePath,
        rawDigest: file.rawDigest,
        size: file.size
      })))
    });
    const runnerBundle = input.runnerBundle.slice();
    const withoutRevision = {
      directories: sortedDirectories,
      files: Object.freeze(sortedFiles.map((file) => Object.freeze({
        destinationRelativePath: file.destinationRelativePath,
        rawDigest: file.rawDigest,
        size: file.size,
        sourceAbsolutePath: file.sourceAbsolutePath,
        sourceIdentity: file.sourceIdentity
      }))),
      manifest,
      runnerBundle,
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
      directories: plan.directories,
      files: plan.files,
      manifest: plan.manifest,
      runnerBundle: plan.runnerBundle,
      stagingRoot: plan.stagingRoot,
      stagingRootIdentity: plan.stagingRootIdentity
    })) || sha256Bytes(plan.runnerBundle) !==
      plan.files.find((file) => file.destinationRelativePath ===
        SEMANTIC_MUTATION_ISOLATED_RUNNER_RELATIVE_PATH)?.rawDigest) {
    throw new Error('Semantic Mutation isolated runtime plan is invalid or forged');
  }
  return plan;
}

function generatedBytes(plan: SemanticMutationIsolatedRuntimePlanV1, relativePath: string): Uint8Array {
  if (relativePath === SEMANTIC_MUTATION_ISOLATED_RUNNER_RELATIVE_PATH) return plan.runnerBundle;
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
  expected: RuntimeInputFileV1,
  commitFence: CommitFence
): Promise<void> {
  if (sha256Bytes(bytes) !== expected.rawDigest || bytes.byteLength !== expected.size) {
    throw new Error('Semantic Mutation generated runtime input changed after capability planning');
  }
  await commitFence();
  await mkdir(path.dirname(destination), { recursive: true });
  await commitFence();
  const handle = await open(destination, 'wx');
  try {
    await commitFence();
    await handle.writeFile(bytes);
    await commitFence();
    await commitFence();
    await handle.sync();
    await commitFence();
  } finally {
    await handle.close();
  }
}

async function copyPlannedFile(
  file: RuntimeInputFileV1,
  destination: string,
  inspector: ReparsePointInspector,
  commitFence: CommitFence
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
    await commitFence();
    await mkdir(path.dirname(destination), { recursive: true });
    await commitFence();
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
        await commitFence();
        const result = await destinationHandle.write(chunk, written, bytesRead - written, null);
        await commitFence();
        if (result.bytesWritten <= 0) throw new Error('Semantic Mutation runtime copy made no progress');
        written += result.bytesWritten;
      }
      total += bytesRead;
    }
    await commitFence();
    await destinationHandle.sync();
    await commitFence();
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

async function scanDestinationTree(
  stagingRoot: string,
  relativeRoot: string,
  inspector: ReparsePointInspector
): Promise<{
  readonly directories: readonly string[];
  readonly files: readonly RuntimeDestinationManifestEntryV1[];
}> {
  const absoluteRoot = absoluteDestination(stagingRoot, relativeRoot);
  await assertCanonicalPhysicalRoot(absoluteRoot, inspector, 'directory');
  const directories = new Set<string>();
  const entries = await captureInputTree(
    absoluteRoot,
    relativeRoot,
    inspector,
    true,
    directories
  );
  return {
    directories: Object.freeze([...directories].sort(compareCodeUnits)),
    files: Object.freeze(entries.map((file) => Object.freeze({
      relativePath: file.destinationRelativePath,
      rawDigest: file.rawDigest,
      size: file.size
    })))
  };
}

async function assertExactDestinationManifest(
  plan: SemanticMutationIsolatedRuntimePlanV1,
  inspector: ReparsePointInspector
): Promise<void> {
  const compiler = await scanDestinationTree(
    plan.stagingRoot,
    SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT,
    inspector
  );
  const browser = await scanDestinationTree(
    plan.stagingRoot,
    SEMANTIC_MUTATION_ISOLATED_BROWSER_RELATIVE_ROOT,
    inspector
  );
  const actual = {
    directories: [...compiler.directories, ...browser.directories].sort(compareCodeUnits),
    files: [...compiler.files, ...browser.files]
      .sort((left, right) => compareCodeUnits(left.relativePath, right.relativePath))
  };
  if (JSON.stringify(actual) !== JSON.stringify(plan.manifest)) {
    throw new Error('Semantic Mutation isolated runtime destination manifest is not exact');
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
    for (const file of plan.files) {
      if (file.sourceAbsolutePath === null || 'generatedDigest' in file.sourceIdentity) continue;
      const current = await bigintLstat(file.sourceAbsolutePath);
      assertPhysicalMetadata(current, file.sourceAbsolutePath, inspector, 'file');
      if (!sameIdentity(metadataIdentity(current), file.sourceIdentity)) {
        throw new Error('Semantic Mutation runtime source changed before materialization');
      }
    }
    const sourceIdentities = new Set(plan.files.flatMap((file) =>
      file.sourceAbsolutePath !== null && !('generatedDigest' in file.sourceIdentity)
        ? [`${file.sourceIdentity.dev}:${file.sourceIdentity.ino}`]
        : []));
    for (const relativeRoot of [
      SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT,
      SEMANTIC_MUTATION_ISOLATED_BROWSER_RELATIVE_ROOT
    ]) {
      await assertExistingDestinationDoesNotAliasSources(
        absoluteDestination(plan.stagingRoot, relativeRoot),
        sourceIdentities,
        inspector
      );
    }
    for (const relativeRoot of [
      SEMANTIC_MUTATION_ISOLATED_COMPILER_RELATIVE_ROOT,
      SEMANTIC_MUTATION_ISOLATED_BROWSER_RELATIVE_ROOT
    ]) {
      await input.commitFence();
      await rm(absoluteDestination(plan.stagingRoot, relativeRoot), { recursive: true, force: true });
      await input.commitFence();
      await mkdir(absoluteDestination(plan.stagingRoot, relativeRoot), { recursive: true });
    }
    for (const relativeDirectory of [...plan.directories].sort((left, right) => {
      const depth = left.split('/').length - right.split('/').length;
      return depth === 0 ? compareCodeUnits(left, right) : depth;
    })) {
      await input.commitFence();
      await mkdir(absoluteDestination(plan.stagingRoot, relativeDirectory), { recursive: true });
    }
    for (const file of plan.files) {
      const destination = absoluteDestination(plan.stagingRoot, file.destinationRelativePath);
      if (file.sourceAbsolutePath === null) {
        await writeGeneratedFile(
          destination,
          generatedBytes(plan, file.destinationRelativePath),
          file,
          input.commitFence
        );
      } else {
        await copyPlannedFile(file, destination, inspector, input.commitFence);
      }
    }
    await input.commitFence();
    await assertExactDestinationManifest(plan, inspector);
    return {
      browsersPath: absoluteDestination(plan.stagingRoot, SEMANTIC_MUTATION_ISOLATED_BROWSER_RELATIVE_ROOT),
      runnerRelativePath: SEMANTIC_MUTATION_ISOLATED_RUNNER_RELATIVE_PATH
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
