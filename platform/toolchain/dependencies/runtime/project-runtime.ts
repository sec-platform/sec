import crypto from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { GeneratedStateWorktreeRetirementProviderV1 } from '../../../../tooling/sec-dev/generated-state-lifecycle.ts';
import {
  parseGitWorktreeAdminLocatorV1,
  parseGitWorktreeAdminPathV1
} from '../../../runtime-state/worktree-closeout-contract.ts';
import { loadCanonicalBunRuntimeVersion } from '../../runtime.ts';
import {
  canonicalEquals,
  canonicalJson,
  compareCodeUnits,
  digest,
  sortedKeys,
  uniqueSorted
} from '../../../foundation/canonical.ts';
import { CompilerError } from '../../../shared/errors.ts';
import {
  ensureDir,
  formatJsonFile,
  isFileNotFoundError,
  pathExists,
  readJson,
  writeJson,
  writeText,
  type CommitFence
} from '../../../workspace/files.ts';
import {
  generatedStateDigestV1,
  generatedStateDomainProviderMaterialDigestV1,
  type GeneratedStatePhysicalIdentityV1,
  type GeneratedStateRegistrationV1
} from '../../../shared/generated-state-contract.ts';
import { compilerRoot, isPathInside } from '../../../workspace/paths.ts';
import {
  assertRetainedNoFollowCapabilityV1,
  assertSameNoFollowDirectoryIdentityV1,
  copyNoFollowDirectoryTreesBulkV1,
  createExclusiveNoFollowDirectoryV1,
  createExclusiveNoFollowRandomDirectoryV1,
  createNoFollowOrdinaryDirectoryChainV1,
  deleteRetainedNoFollowEntryV1,
  inspectExactNoFollowDirectoryPresenceV1,
  inspectNoFollowDirectoryChildV1,
  inspectNoFollowDirectoryChainV1,
  inspectNoFollowLinkEntryV1,
  inspectNoFollowOrdinaryFileEntryV1,
  publishExclusiveNoFollowLinkV1,
  publishExclusiveDurableCanonicalFileV1,
  readNoFollowOrdinaryFileV1,
  retainNoFollowOrdinaryFileV1,
  retainNoFollowDirectoryForChildProcessV1,
  relocateRetainedNoFollowDirectoryAcrossParentsV1,
  relocateRetainedNoFollowLinkAcrossParentsV1,
  replaceDurableCanonicalFileV1,
  scanNoFollowDirectoryTreeV1,
  scanNoFollowDirectoryTreeInventoryV1,
  scanNoFollowDirectoryTreeMetadataV1,
  PhysicalNoFollowError,
  type PhysicalDirectoryChainV1,
  type PhysicalDirectoryIdentityV1,
  type RetainedNoFollowOrdinaryFileV1
} from '../../../runtime-physical/index.ts';
import {
  buildIsolatedProcessEnvironment,
  ensureIsolatedProcessDirectories,
  ISOLATED_VERIFICATION_ENV_KEY,
  pathEnvKey,
  RETAINED_EXECUTABLE_CHILD_DESCRIPTOR_V1,
  RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR_V1,
  runRetainedCommand,
  runCommand,
  type CommandResult
} from '../../../runtime-physical/index.ts';
import {
  buildRuntimeDependencyMaterializationBinding,
  buildRuntimePackageManifest,
  isRuntimeDependencyMaterializationBinding,
  isRuntimeDependencyPackageManifest,
  isRuntimeDependencyPackageName,
  isRuntimeDepsPreboundBinding,
  loadRuntimeDependencySpec,
  RUNTIME_DEPENDENCY_PACKAGE_NAMES,
  RUNTIME_DEPS_PREBOUND_BINDING_FILE,
  type RootPackageJson,
  type RuntimeDependencyMaterializationBinding,
  type RuntimeDependencyResolutionEdge,
  type RuntimeDependencyResolvedPackage,
  type RuntimeDependencySpec,
  type RuntimeDependencyToolchainBinding
} from '../contract/runtime-dependency-spec.ts';

export interface RuntimeDepsStamp {
  binding: Readonly<RuntimeDependencyMaterializationBinding>;
  formatVersion: 'runtime-deps-stamp-v4';
  manifestHash: string;
  packageManager: 'bun';
  installedAt: string;
  sourceGeneration: Readonly<RuntimeDependencySourceGenerationV1>;
  target: Readonly<RuntimeDependencyTargetIdentityV1>;
}

export interface RuntimeDependencySourceGenerationV1 {
  readonly schema: 'sec-runtime-dependency-source-generation-v1';
  readonly ownerRoot: string;
  readonly ownerRootPhysical: Readonly<GeneratedStatePhysicalIdentityV1>;
  readonly sourcePath: string;
  readonly physical: Readonly<GeneratedStatePhysicalIdentityV1>;
  readonly bindingDigest: `sha256:${string}`;
  /** Digest of every no-follow source-tree entry, including content bytes. */
  readonly treeDigest: `sha256:${string}`;
  /** Number of entries covered by treeDigest; part of the bounded contract. */
  readonly treeEntryCount: number;
  readonly epoch: `sha256:${string}`;
}

export interface RuntimeDependencyTargetIdentityV1 {
  readonly schema: 'sec-runtime-dependency-target-identity-v1';
  readonly kind: 'directory' | 'link';
  readonly physical: Readonly<GeneratedStatePhysicalIdentityV1>;
  readonly linkTarget: string | null;
}

export interface SharedDepsReadyState {
  binding: Readonly<RuntimeDependencyMaterializationBinding>;
  packageManager: 'bun';
  root: string;
  nodeModulesPath: string;
  manifestHash: string;
  readonly sourceGeneration: Readonly<RuntimeDependencySourceGenerationV1>;
}

export interface CompilerDepsReadyState {
  manifestHash: string;
  nodeModulesPath: string;
  packageManager: 'bun';
  readonly requiresFreshProcess: boolean;
  root: string;
  readonly runtimeMaterialization?: Readonly<RuntimeDependencyMaterializationBinding> | null;
  readonly sourceGeneration?: Readonly<RuntimeDependencySourceGenerationV1>;
  source: 'existing' | 'installed';
  readonly transitionDigest: `sha256:${string}`;
}

export interface DependencyAuthorityPaths {
  readonly compilerModulesRoot: string;
  readonly dependencyModules: string;
  readonly sharedDepsRoot: string;
}

interface CompilerDependencyPackageBinding {
  entry?: {
    path: string;
    sha256: string;
  };
  manifestSha256: string;
  name: string;
  version: string;
}

interface CompilerDepsBinding {
  readonly architecture: string;
  readonly bunExecutablePath: string;
  readonly bunExecutableSha256: string;
  readonly bunVersion: string;
  readonly declaredBunVersion: string;
  readonly dependencyManifestSha256: string;
  readonly formatVersion: 'compiler-deps-binding-v5';
  readonly installConfigSha256: string | null;
  readonly lockSha256: string;
  readonly manifestHash: string;
  readonly packages: readonly CompilerDependencyPackageBinding[];
  readonly platform: NodeJS.Platform;
  readonly runtimeMaterialization: Readonly<RuntimeDependencyMaterializationBinding> | null;
}

const COMPILER_DEPS_BINDING_FILE = '.sec-compiler-deps-binding-v5.json' as const;
const DEFAULT_DEPENDENCY_LOCK_TIMEOUT_MS = 300_000;
const MAX_DEPENDENCY_OPERATION_TIMEOUT_MS = DEFAULT_DEPENDENCY_LOCK_TIMEOUT_MS;
const DEFAULT_DEPENDENCY_LOCK_POLL_INTERVAL_MS = 50;
const MAX_DEPENDENCY_LOCK_POLL_INTERVAL_MS = 1_000;
const RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES_V1 = 100_000;
const RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES_V1 = 2 * 1024 * 1024 * 1024;
const RUNTIME_DEPENDENCY_OPERATION_CONTEXT_V1 = Symbol('sec-runtime-dependency-operation-context-v1');

export interface RuntimeDependencyInstallOptions {
  beforeCommit?: CommitFence;
  commandRunner?: typeof runCommand;
  installMode?: 'allow' | 'offline-copy-only' | 'prebound-only';
  lockTimeoutMs?: number;
  /** Monotonic source captured into one operation ledger and reused by every budget check. */
  monotonicNowMs?: () => number;
  now?: () => string;
  pollIntervalMs?: number;
  rematerialize?: boolean;
  sharedDepsRoot?: string;
  signal?: AbortSignal;
  skipSharedDepsWarmup?: boolean;
  sleep?: (ms: number) => Promise<void>;
  testCompilerPublishPlatform?: NodeJS.Platform;
  testCompilerPublishHook?: (stage: 'active-backed-up') => void | Promise<void>;
  testProjectProjectionHook?: (
    stage: 'prepared' | 'backed-up' | 'published' | 'binding-validated' | 'stamp-readback'
  ) => void | Promise<void>;
  testCompilerBridgeValidationHook?: (
    stage: 'binding-observed' | 'final-binding-observed'
  ) => void | Promise<void>;
  testCompilerRename?: (source: string, target: string) => Promise<void>;
  generatedStateLifecycle?: Readonly<{
    born(relativePath: string, operationId: string): Promise<void>;
    /** Read-only adoption of an issuer-created active registration. */
    bind?: (
      relativePath: string,
      expected?: Readonly<{
        owner?: string;
        producer?: string;
        ruleId?: string;
        physical?: GeneratedStatePhysicalIdentityV1;
      }>
    ) => Promise<GeneratedStateRegistrationV1>;
    /** Re-activate one exact retired predecessor after owner-local rollback. */
    restore?: (
      relativePath: string,
      expectedRegistrationDigest: `sha256:${string}`,
      expectedPhysical: GeneratedStatePhysicalIdentityV1,
      outcome: string
    ) => Promise<GeneratedStateRegistrationV1>;
    retired(relativePath: string, outcome: string): Promise<GeneratedStateRegistrationV1 | void>;
    disposed(relativePath: string, outcome: string): Promise<void>;
  }>;
}

type RuntimeDependencyOperationContextV1 = Readonly<{
  deadlineAtMonotonicMs: number;
  initialBudgetMs: number;
  monotonicNowMs: () => number;
  operationId: string;
  pollIntervalMs: number;
  signal: AbortSignal | undefined;
  startedAtMonotonicMs: number;
}>;

type RuntimeDependencyOperationOptionsV1<T extends RuntimeDependencyInstallOptions = RuntimeDependencyInstallOptions> =
  T & Readonly<{
    [RUNTIME_DEPENDENCY_OPERATION_CONTEXT_V1]: RuntimeDependencyOperationContextV1;
  }>;

async function bindCanonicalGeneratedStateLifecycle(
  options: RuntimeDependencyOperationOptionsV1,
  root: string
): Promise<RuntimeDependencyOperationOptionsV1> {
  if (!sameHostPath(root, compilerRoot)) return options;
  const { generatedStateProducerHooksV1 } = await import('../../../../tooling/sec-dev/generated-state-lifecycle.ts');
  return Object.freeze({
    ...options,
    generatedStateLifecycle: generatedStateProducerHooksV1({ repositoryRoot: root })
  }) as RuntimeDependencyOperationOptionsV1;
}

export async function disposeCanonicalSharedDependencies(
  options: RuntimeDependencyInstallOptions = {},
  outcome = 'maintainer-clean-requested'
): Promise<boolean> {
  const operationOptions = runtimeDependencyOperationOptionsV1(options);
  const sharedDepsRoot = defaultSharedDepsRoot();
  const observedRoot = await physicalSharedDependencyDirectory(sharedDepsRoot, true);
  if (observedRoot === null) return false;
  const lifecycleOptions = await bindCanonicalGeneratedStateLifecycle(operationOptions, compilerRoot);
  const lifecycle = lifecycleOptions.generatedStateLifecycle;
  if (lifecycle === undefined) {
    throw new Error('Canonical shared dependencies have no generated-state lifecycle owner.');
  }
  return withCompilerDependencyTransitionLeaseV1(compilerRoot, lifecycleOptions, async () => {
    const current = await physicalSharedDependencyDirectory(sharedDepsRoot, true);
    if (current === null || !sameGeneratedStateIdentityV1(
      generatedStatePhysicalIdentityV1(current),
      generatedStatePhysicalIdentityV1(observedRoot)
    )) {
      throw new CompilerError(
        'IMPORT-AUTHORITY-004',
        'Canonical shared dependency root changed before lifecycle disposal; current state is preserved'
      );
    }
    await bindExistingSharedDependencyRootV1(lifecycleOptions, current);
    await lifecycle.disposed('.shared-deps', outcome);
    return true;
  });
}

export const SHARED_DEPENDENCY_FORBIDDEN_AUTHORITY_FILES = Object.freeze([
  '.npmrc',
  '.yarnrc',
  '.yarnrc.yml',
  'bun.lock',
  'bun.lockb',
  'bunfig.toml',
  'npm-shrinkwrap.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'yarn.lock'
] as const);
export function dependencyAuthorityPaths(
  dependencyRoot = compilerRoot
): Readonly<DependencyAuthorityPaths> {
  const root = path.resolve(dependencyRoot);
  const sharedDepsRoot = path.join(root, '.shared-deps');
  return Object.freeze({
    compilerModulesRoot: path.join(root, 'node_modules'),
    dependencyModules: path.join(sharedDepsRoot, 'node_modules'),
    sharedDepsRoot
  });
}

function defaultSharedDepsRoot(): string {
  return dependencyAuthorityPaths().sharedDepsRoot;
}

function sortedRecord(record: Record<string, string> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(record ?? {}).sort(([left], [right]) => compareCodeUnits(left, right)));
}

interface CompilerDependencyIdentity {
  architecture: string;
  bunExecutablePath: string;
  bunExecutableSha256: string;
  bunVersion: string;
  declaredBunVersion: string;
  dependencyManifestSha256: string;
  installConfigSha256: string | null;
  lockSha256: string;
  manifestHash: string;
  packageNames: string[];
  packageSourceSha256: string;
  packageVersions: Record<string, string>;
  platform: NodeJS.Platform;
}

function compilerInstallConfigSha256(bytes: Uint8Array | null): string {
  const install = bytes === null
    ? null
    : (Bun.TOML.parse(Buffer.from(bytes).toString('utf8')) as Record<string, unknown>).install ?? null;
  return digest(JSON.stringify(canonicalJson({ install })));
}

type RuntimeExecutableIdentity = Readonly<{
  path: string;
  sha256: string;
  signature: string;
}>;

// Only coalesce observations that are currently in flight.  A settled
// executable digest is never retained as a process-global positive cache;
// every later operation re-proves the physical file and its bytes.
let runtimeExecutableIdentityInFlightV1: Promise<RuntimeExecutableIdentity> | null = null;

type CompilerDependencyManifestAuthority = Readonly<{
  declaredBunVersion: string;
  dependencies: Record<string, string>;
  dependencyManifestSha256: string;
  devDependencies: Record<string, string>;
}>;

function compilerDependencyManifestAuthority(
  packageJsonBytes: Uint8Array
): CompilerDependencyManifestAuthority {
  const packageJson = JSON.parse(Buffer.from(packageJsonBytes).toString('utf8')) as
    RootPackageJson & { packageManager?: string };
  const packageManagerMatch = /^bun@([^\s]+)$/u.exec(packageJson.packageManager ?? '');
  if (!packageManagerMatch) {
    throw new CompilerError('IMPORT-AUTHORITY-001', 'Root packageManager must pin one Bun version exactly');
  }
  const dependencies = sortedRecord(packageJson.dependencies);
  const devDependencies = sortedRecord(packageJson.devDependencies);
  return Object.freeze({
    declaredBunVersion: packageManagerMatch[1]!,
    dependencies,
    dependencyManifestSha256: digest(JSON.stringify({
      dependencies,
      devDependencies,
      packageManager: packageJson.packageManager
    })),
    devDependencies
  });
}

async function currentRuntimeExecutableIdentity(refresh = false): Promise<RuntimeExecutableIdentity> {
  if (!refresh && runtimeExecutableIdentityInFlightV1 !== null) {
    return runtimeExecutableIdentityInFlightV1;
  }
  const observation = (async (): Promise<RuntimeExecutableIdentity> => {
    const executablePath = await fs.realpath(process.execPath);
    const metadata = await fs.lstat(executablePath, { bigint: true });
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new CompilerError('IMPORT-AUTHORITY-001', 'Bun runtime executable must be one physical file');
    }
    const signature = [
      executablePath,
      metadata.dev,
      metadata.ino,
      metadata.mode,
      metadata.size,
      metadata.mtimeNs
    ].join(':');
    const executableBytes = await fs.readFile(executablePath);
    const after = await fs.lstat(executablePath, { bigint: true });
    if (metadata.dev !== after.dev || metadata.ino !== after.ino || metadata.mode !== after.mode ||
      metadata.size !== after.size || metadata.mtimeNs !== after.mtimeNs ||
      !sameHostPath(await fs.realpath(process.execPath), executablePath)) {
      throw new CompilerError('IMPORT-AUTHORITY-001', 'Bun runtime executable changed during observation');
    }
    return Object.freeze({
      path: executablePath,
      sha256: digest(executableBytes),
      signature
    });
  })();
  if (refresh) return observation;
  runtimeExecutableIdentityInFlightV1 = observation;
  try {
    return await observation;
  } finally {
    if (runtimeExecutableIdentityInFlightV1 === observation) {
      runtimeExecutableIdentityInFlightV1 = null;
    }
  }
}

async function compilerDependencyIdentity(root: string): Promise<CompilerDependencyIdentity> {
  const [packageJsonBytes, lockfileBytes, installConfigBytes, runtimeExecutable] = await Promise.all([
    fs.readFile(path.join(root, 'package.json')),
    fs.readFile(path.join(root, 'bun.lock')),
    fs.readFile(path.join(root, 'bunfig.toml')).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    }),
    currentRuntimeExecutableIdentity()
  ]);
  const manifestAuthority = compilerDependencyManifestAuthority(packageJsonBytes);
  const { dependencies, devDependencies } = manifestAuthority;
  const canonicalBunVersion = await loadCanonicalBunRuntimeVersion(root);
  const runtime = {
    architecture: process.arch,
    bunVersion: process.versions.bun ?? 'unknown',
    declaredBunVersion: manifestAuthority.declaredBunVersion,
    platform: process.platform
  };
  if (runtime.bunVersion === 'unknown') {
    throw new CompilerError('IMPORT-AUTHORITY-001', 'Compiler dependency bootstrap must run under Bun');
  }
  if (runtime.declaredBunVersion !== canonicalBunVersion || runtime.bunVersion !== canonicalBunVersion) {
    throw new CompilerError(
      'IMPORT-AUTHORITY-001',
      `Bun runtime identity mismatch: canonical=${canonicalBunVersion}, packageManager=${runtime.declaredBunVersion}, actual=${runtime.bunVersion}`
    );
  }
  const packageVersions = { ...dependencies, ...devDependencies };
  const lockSha256 = digest(lockfileBytes);
  const installConfigSha256 = compilerInstallConfigSha256(installConfigBytes);
  const manifestContent = (configSha256: string | null) => JSON.stringify({
    dependencyManifestSha256: manifestAuthority.dependencyManifestSha256,
    installConfigSha256: configSha256,
    lockSha256,
    runtime: {
      ...runtime,
      bunExecutablePath: runtimeExecutable.path,
      bunExecutableSha256: runtimeExecutable.sha256
    }
  });
  return {
    ...runtime,
    bunExecutablePath: runtimeExecutable.path,
    bunExecutableSha256: runtimeExecutable.sha256,
    dependencyManifestSha256: manifestAuthority.dependencyManifestSha256,
    installConfigSha256,
    lockSha256,
    manifestHash: digest(manifestContent(installConfigSha256)),
    packageNames: sortedKeys(packageVersions),
    packageSourceSha256: digest(packageJsonBytes),
    packageVersions
  };
}

/**
 * Re-prove the small compiler input surface immediately around the Bun
 * effect.  The staging copy is already durable, but a same-inode mutation of
 * the source package/lock/config or version marker must invalidate the
 * operation before/after the child runs; a root-directory identity alone is
 * not a descendant content fence.
 */
function assertCompilerDependencyInputsCurrentV1(
  root: string,
  expected: CompilerDependencyIdentity
): void {
  const sourceRoot = inspectNoFollowDirectoryChainV1(
    root,
    'Compiler dependency input source root fence'
  ).target;
  const readInput = (name: 'package.json' | 'bun.lock' | 'bunfig.toml'): Uint8Array | null => {
    const entry = inspectNoFollowOrdinaryFileEntryV1(sourceRoot, name);
    if (entry === null) return null;
    if (entry.kind !== 'file' || entry.bytes === null) {
      throw new CompilerError(
        'IMPORT-AUTHORITY-001',
        `Compiler dependency input ${name} is not an ordinary no-follow file`
      );
    }
    return entry.bytes;
  };
  const packageBytes = readInput('package.json');
  const lockBytes = readInput('bun.lock');
  const configBytes = readInput('bunfig.toml');
  if (packageBytes === null || digest(packageBytes) !== expected.packageSourceSha256 ||
      lockBytes === null || digest(lockBytes) !== expected.lockSha256 ||
      compilerInstallConfigSha256(configBytes) !== expected.installConfigSha256) {
    throw new CompilerError(
      'IMPORT-AUTHORITY-001',
      'Compiler dependency source inputs changed around materialization'
    );
  }
  const versionPath = path.join(sourceRoot.path, '.bun-version');
  let version: string;
  try {
    const versionBytes = readNoFollowOrdinaryFileV1(sourceRoot, '.bun-version');
    version = versionBytes === null ? '' : Buffer.from(versionBytes).toString('utf8').trim();
  } catch (error) {
    throw new CompilerError(
      'IMPORT-AUTHORITY-001',
      'Compiler dependency version marker is not an ordinary no-follow file',
      { versionPath, cause: error instanceof Error ? error.message : String(error) }
    );
  }
  if (version !== expected.bunVersion) {
    throw new CompilerError(
      'IMPORT-AUTHORITY-001',
      'Compiler dependency Bun version marker changed around materialization'
    );
  }
  assertSameNoFollowDirectoryIdentityV1(sourceRoot, 'Compiler dependency input source root readback');
}

function compilerDependencyInputFenceMatchesV1(
  root: string,
  expected: CompilerDependencyIdentity
): boolean {
  try {
    const packageJsonBytes = readFileSync(path.join(root, 'package.json'));
    const lockfileBytes = readFileSync(path.join(root, 'bun.lock'));
    let installConfigBytes: Buffer | null;
    try {
      installConfigBytes = readFileSync(path.join(root, 'bunfig.toml'));
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
      installConfigBytes = null;
    }
    const manifest = compilerDependencyManifestAuthority(packageJsonBytes);
    const canonicalBunVersion = readFileSync(path.join(root, '.bun-version'), 'utf8').trim();
    return manifest.declaredBunVersion === expected.declaredBunVersion &&
      manifest.dependencyManifestSha256 === expected.dependencyManifestSha256 &&
      digest(lockfileBytes) === expected.lockSha256 &&
      compilerInstallConfigSha256(installConfigBytes) === expected.installConfigSha256 &&
      canonicalBunVersion === expected.bunVersion;
  } catch {
    return false;
  }
}

function dependencyPackagePath(nodeModulesPath: string, packageName: string): string {
  return path.join(nodeModulesPath, ...packageName.split('/'), 'package.json');
}

const criticalCompilerDependencyEntries = new Set([
  '@ts-morph/common',
  'code-block-writer',
  'ts-morph',
  'typescript'
]);

function isExactPackageVersion(value: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value);
}

async function compilerDependencyPackageBinding(
  nodeModulesPath: string,
  packageName: string,
  requestedVersion: string
): Promise<CompilerDependencyPackageBinding> {
  const packageRoot = path.dirname(dependencyPackagePath(nodeModulesPath, packageName));
  const packageJsonPath = path.join(packageRoot, 'package.json');
  const packageJsonBytes = await fs.readFile(packageJsonPath);
  const manifest = JSON.parse(packageJsonBytes.toString('utf8')) as {
    main?: unknown;
    name?: unknown;
    version?: unknown;
  };
  if (manifest.name !== packageName || typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new CompilerError('IMPORT-AUTHORITY-002', `Compiler dependency manifest is invalid: ${packageName}`);
  }
  if (isExactPackageVersion(requestedVersion) && manifest.version !== requestedVersion) {
    throw new CompilerError(
      'IMPORT-AUTHORITY-002',
      `Compiler dependency version mismatch: ${packageName}@${manifest.version} != ${requestedVersion}`
    );
  }

  let entry: CompilerDependencyPackageBinding['entry'];
  if (criticalCompilerDependencyEntries.has(packageName)) {
    if (typeof manifest.main !== 'string' || manifest.main.length === 0) {
      throw new CompilerError('IMPORT-AUTHORITY-002', `Critical compiler dependency has no main entry: ${packageName}`);
    }
    const entryPath = manifest.main.replace(/^\.\//u, '').replace(/\\/gu, '/');
    const absoluteEntry = path.resolve(packageRoot, ...entryPath.split('/'));
    const relativeEntry = path.relative(packageRoot, absoluteEntry);
    if (relativeEntry.startsWith('..') || path.isAbsolute(relativeEntry)) {
      throw new CompilerError('IMPORT-AUTHORITY-002', `Critical compiler dependency entry escapes its package: ${packageName}`);
    }
    entry = {
      path: entryPath,
      sha256: digest(await fs.readFile(absoluteEntry))
    };
  }

  return {
    ...(entry ? { entry } : {}),
    manifestSha256: digest(packageJsonBytes),
    name: packageName,
    version: manifest.version
  };
}

async function compilerDependencyPackageBindings(
  nodeModulesPath: string,
  identity: CompilerDependencyIdentity
): Promise<readonly CompilerDependencyPackageBinding[]> {
  const packageNames = [...identity.packageNames];
  if (identity.packageVersions['ts-morph']) {
    packageNames.push('@ts-morph/common', 'code-block-writer');
  }
  return Promise.all(uniqueSorted(packageNames).map((packageName) => compilerDependencyPackageBinding(
    nodeModulesPath,
    packageName,
    identity.packageVersions[packageName] ?? '*'
  )));
}

async function compilerDependencyGenerationBinding(
  root: string,
  nodeModulesPath: string,
  bindingPath: string,
  identity: CompilerDependencyIdentity
): Promise<Readonly<CompilerDepsBinding> | null> {
  let binding: CompilerDepsBinding | null;
  try {
    binding = await readJson<CompilerDepsBinding>(bindingPath);
  } catch (error) {
    // Absence and malformed persisted bytes are observable cache misses. I/O,
    // permission and physical-capability failures are not: allowing those to
    // fall through would turn an unknown read into an install/publish effect.
    if (isFileNotFoundError(error) || error instanceof SyntaxError) return null;
    throw error;
  }
  if (binding === null || binding.formatVersion !== 'compiler-deps-binding-v5') return null;
  if (
    binding.architecture !== identity.architecture ||
    binding.bunExecutablePath !== identity.bunExecutablePath ||
    binding.bunExecutableSha256 !== identity.bunExecutableSha256 ||
    binding.bunVersion !== identity.bunVersion ||
    binding.declaredBunVersion !== identity.declaredBunVersion ||
    binding.dependencyManifestSha256 !== identity.dependencyManifestSha256 ||
    binding.installConfigSha256 !== identity.installConfigSha256 ||
    binding.lockSha256 !== identity.lockSha256 ||
    binding.manifestHash !== identity.manifestHash ||
    binding.platform !== identity.platform) return null;
  let packages: readonly CompilerDependencyPackageBinding[] | null;
  try {
    packages = await compilerDependencyPackageBindings(nodeModulesPath, identity);
  } catch (error) {
    if (isFileNotFoundError(error) || error instanceof SyntaxError ||
      (error instanceof CompilerError && error.code === 'IMPORT-AUTHORITY-002')) return null;
    throw error;
  }
  if (packages === null || !canonicalEquals(binding.packages, packages)) return null;
  let runtimeMaterialization: Readonly<RuntimeDependencyMaterializationBinding> | null;
  if (RUNTIME_DEPENDENCY_PACKAGE_NAMES.every((name) => identity.packageVersions[name] !== undefined)) {
    if (binding.runtimeMaterialization === null) return null;
    const runtimeSpec = await loadRuntimeDependencySpec(path.join(root, 'package.json'));
    if (!await runtimeDependencyTreeMatchesBinding({
      expected: binding.runtimeMaterialization,
      nodeModulesPath,
      root,
      runtimeSpec
    })) return null;
    runtimeMaterialization = binding.runtimeMaterialization;
  } else {
    if (binding.runtimeMaterialization !== null) return null;
    runtimeMaterialization = null;
  }
  const expected = {
    architecture: identity.architecture,
    bunExecutablePath: identity.bunExecutablePath,
    bunExecutableSha256: identity.bunExecutableSha256,
    bunVersion: identity.bunVersion,
    declaredBunVersion: identity.declaredBunVersion,
    dependencyManifestSha256: identity.dependencyManifestSha256,
    formatVersion: binding.formatVersion,
    installConfigSha256: identity.installConfigSha256,
    lockSha256: identity.lockSha256,
    manifestHash: identity.manifestHash,
    packages,
    platform: identity.platform,
    runtimeMaterialization
  } satisfies CompilerDepsBinding;
  return canonicalEquals(binding, expected) ? Object.freeze(expected) : null;
}

async function compilerRuntimeMaterializationBinding(
  root: string,
  nodeModulesPath: string,
  identity: CompilerDependencyIdentity
): Promise<Readonly<RuntimeDependencyMaterializationBinding> | null> {
  if (!RUNTIME_DEPENDENCY_PACKAGE_NAMES.every((name) => identity.packageVersions[name] !== undefined)) {
    return null;
  }
  const runtimeSpec = await loadRuntimeDependencySpec(path.join(root, 'package.json'));
  return observeRuntimeDependencyMaterializationBinding({
    nodeModulesPath,
    root,
    runtimeSpec,
    toolchain: {
      architecture: identity.architecture,
      bunExecutablePath: identity.bunExecutablePath,
      bunExecutableSha256: identity.bunExecutableSha256,
      bunVersion: identity.bunVersion,
      canonicalBunVersion: identity.bunVersion,
      compilerGenerationRevision: identity.manifestHash,
      declaredBunVersion: identity.declaredBunVersion,
      dependencyManifestSha256: identity.dependencyManifestSha256,
      installConfigSha256: identity.installConfigSha256,
      lockSha256: identity.lockSha256,
      platform: identity.platform
    }
  });
}

function buildEnv(
  additionalEnv: NodeJS.ProcessEnv = {},
  isolatedWritableRoot?: string
): NodeJS.ProcessEnv {
  const envPathKey = pathEnvKey();
  const overrides = {
    ...(isolatedWritableRoot ? {} : {
      [envPathKey]: `${path.join(dependencyAuthorityPaths().compilerModulesRoot, '.bin')}${path.delimiter}${process.env[envPathKey] ?? ''}`
    }),
    ...additionalEnv
  };
  return isolatedWritableRoot
    ? buildIsolatedProcessEnvironment(isolatedWritableRoot, overrides)
    : overrides;
}

function sleepMs(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function runtimeDependencyPositiveBoundedIntegerV1(
  field: 'lockTimeoutMs' | 'pollIntervalMs',
  configured: number | undefined,
  fallback: number,
  maximum: number
): number {
  const value = configured ?? fallback;
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new CompilerError(
      'RUNTIME-DEPS-003',
      `Runtime dependency ${field} must be a positive safe integer within its canonical ceiling`,
      { field, maximum, value }
    );
  }
  return value;
}

function defaultRuntimeDependencyMonotonicNowMsV1(): number {
  return performance.now();
}

/**
 * Capture one monotonic source for an operation.  The wrapper is the operation
 * ledger: nested helpers reuse it, and a broken injected source cannot silently
 * move an absolute deadline backwards.
 */
function createRuntimeDependencyMonotonicLedgerV1(
  source: () => number
): () => number {
  let previous = Number.NEGATIVE_INFINITY;
  return () => {
    const observed = source();
    if (!Number.isFinite(observed) || observed < previous) {
      throw new CompilerError(
        'RUNTIME-DEPS-003',
        'Runtime dependency operation monotonic clock is invalid or moved backwards',
        { observed, previous }
      );
    }
    previous = observed;
    return observed;
  };
}

function runtimeDependencyOperationOptionsV1<T extends RuntimeDependencyInstallOptions>(
  options: T
): RuntimeDependencyOperationOptionsV1<T> {
  const initialBudgetMs = runtimeDependencyPositiveBoundedIntegerV1(
    'lockTimeoutMs',
    options.lockTimeoutMs,
    DEFAULT_DEPENDENCY_LOCK_TIMEOUT_MS,
    MAX_DEPENDENCY_OPERATION_TIMEOUT_MS
  );
  const pollIntervalMs = runtimeDependencyPositiveBoundedIntegerV1(
    'pollIntervalMs',
    options.pollIntervalMs,
    DEFAULT_DEPENDENCY_LOCK_POLL_INTERVAL_MS,
    MAX_DEPENDENCY_LOCK_POLL_INTERVAL_MS
  );
  const existing = (options as unknown as Partial<RuntimeDependencyOperationOptionsV1<T>>)
    [RUNTIME_DEPENDENCY_OPERATION_CONTEXT_V1];
  const monotonicNowMs = existing?.monotonicNowMs ?? createRuntimeDependencyMonotonicLedgerV1(
    options.monotonicNowMs ?? defaultRuntimeDependencyMonotonicNowMsV1
  );
  const nowMonotonicMs = monotonicNowMs();
  const deadlineAtMonotonicMs = Math.min(
    existing?.deadlineAtMonotonicMs ?? Number.POSITIVE_INFINITY,
    nowMonotonicMs + initialBudgetMs
  );
  const context = existing !== undefined &&
      deadlineAtMonotonicMs === existing.deadlineAtMonotonicMs &&
      pollIntervalMs === existing.pollIntervalMs &&
      options.signal === existing.signal
    ? existing
    : Object.freeze({
        deadlineAtMonotonicMs,
        initialBudgetMs: existing?.initialBudgetMs ?? initialBudgetMs,
        monotonicNowMs,
        operationId: existing?.operationId ?? crypto.randomUUID(),
        pollIntervalMs,
        signal: options.signal ?? existing?.signal,
        startedAtMonotonicMs: existing?.startedAtMonotonicMs ?? nowMonotonicMs
      });
  context.signal?.throwIfAborted();
  return {
    ...options,
    lockTimeoutMs: Math.min(initialBudgetMs, context.initialBudgetMs),
    pollIntervalMs,
    [RUNTIME_DEPENDENCY_OPERATION_CONTEXT_V1]: context
  };
}

function runtimeDependencyOperationContextV1(
  options: RuntimeDependencyInstallOptions
): RuntimeDependencyOperationContextV1 {
  return (options as Partial<RuntimeDependencyOperationOptionsV1>)[RUNTIME_DEPENDENCY_OPERATION_CONTEXT_V1] ??
    runtimeDependencyOperationOptionsV1(options)[RUNTIME_DEPENDENCY_OPERATION_CONTEXT_V1];
}

function runtimeDependencyOperationRemainingMsV1(
  options: RuntimeDependencyInstallOptions,
  label: string,
  minimumMs = 1
): number {
  const context = runtimeDependencyOperationContextV1(options);
  context.signal?.throwIfAborted();
  const observedAtMonotonicMs = context.monotonicNowMs();
  const remainingMs = context.deadlineAtMonotonicMs - observedAtMonotonicMs;
  if (!Number.isFinite(remainingMs) || remainingMs < minimumMs) {
    throw new CompilerError('RUNTIME-DEPS-003', `${label} exceeded the runtime dependency operation deadline`, {
      initialBudgetMs: context.initialBudgetMs,
      minimumMs,
      observedAtMonotonicMs,
      remainingMs: Math.max(0, Math.floor(remainingMs))
    });
  }
  return remainingMs;
}

async function waitForRuntimeDependencyOperationV1(
  options: RuntimeDependencyInstallOptions,
  requestedDelayMs: number,
  sleep: (ms: number) => Promise<void>,
  label: string
): Promise<void> {
  const context = runtimeDependencyOperationContextV1(options);
  const remainingMs = runtimeDependencyOperationRemainingMsV1(options, label);
  const boundedDelayMs = Math.max(1, Math.min(requestedDelayMs, Math.floor(remainingMs)));
  let abortListener: (() => void) | undefined;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const aborted = context.signal === undefined
    ? null
    : new Promise<never>((_resolve, reject) => {
        abortListener = () => reject(context.signal?.reason ?? new Error(`${label} was aborted`));
        context.signal?.addEventListener('abort', abortListener, { once: true });
      });
  const deadline = new Promise<never>((_resolve, reject) => {
    deadlineTimer = setTimeout(() => reject(new CompilerError(
      'RUNTIME-DEPS-003',
      `${label} exceeded the runtime dependency operation deadline`,
      { initialBudgetMs: context.initialBudgetMs }
    )), Math.max(1, Math.ceil(remainingMs)));
  });
  try {
    await Promise.race([
      sleep(boundedDelayMs),
      deadline,
      ...(aborted === null ? [] : [aborted])
    ]);
  } finally {
    if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
    if (abortListener !== undefined) context.signal?.removeEventListener('abort', abortListener);
  }
  runtimeDependencyOperationRemainingMsV1(options, label);
}

async function runtimeDependencyOperationEffectFenceV1(
  options: RuntimeDependencyOperationOptionsV1,
  label: string
): Promise<void> {
  runtimeDependencyOperationRemainingMsV1(options, `${label} admission`);
  await options.beforeCommit?.();
  runtimeDependencyOperationRemainingMsV1(options, `${label} effect`);
}

function runtimeDependencyOperationDeadlineAtV1(
  options: RuntimeDependencyOperationOptionsV1,
  label: string
): number {
  runtimeDependencyOperationRemainingMsV1(options, label);
  return runtimeDependencyOperationContextV1(options).deadlineAtMonotonicMs;
}

async function hasCompleteRuntimeDeps(
  nodeModulesPath: string,
  spec?: RuntimeDependencySpec
): Promise<boolean> {
  try {
    const expected = spec ?? await loadRuntimeDependencySpec();
    const exactVersions = {
      ...expected.dependencies,
      ...expected.devDependencies
    };
    const manifests = await Promise.all(RUNTIME_DEPENDENCY_PACKAGE_NAMES.map(async (packageName) => {
      const manifest = await readJson<unknown>(dependencyPackagePath(nodeModulesPath, packageName));
      return isRuntimeDependencyPackageManifest(manifest, packageName) &&
        manifest.version === exactVersions[packageName];
    }));
    if (!manifests.every(Boolean)) return false;
    return true;
  } catch {
    return false;
  }
}

type RuntimePackageManifestObservation = Readonly<{
  dependencies: Readonly<Record<string, string>>;
  manifestSha256: string;
  name: string;
  optionalDependencies: Readonly<Record<string, string>>;
  optionalPeers: ReadonlySet<string>;
  peerDependencies: Readonly<Record<string, string>>;
  version: string;
}>;

type RuntimePackageClosureState = {
  edges: RuntimeDependencyResolutionEdge[];
  manifestSha256: string;
  name: string;
  relativePath: string;
  version: string;
};

function dependencyRecord(value: unknown, label: string): Readonly<Record<string, string>> {
  if (value === undefined) return Object.freeze({});
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CompilerError('RUNTIME-DEPS-002', `${label} must be one dependency record`);
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => compareCodeUnits(left, right));
  if (entries.some(([name, version]) => !isRuntimeDependencyPackageName(name) ||
    typeof version !== 'string' || !version)) {
    throw new CompilerError('RUNTIME-DEPS-002', `${label} contains an invalid dependency`);
  }
  return Object.freeze(Object.fromEntries(entries) as Record<string, string>);
}

function optionalPeerNames(value: unknown): ReadonlySet<string> {
  if (value === undefined) return new Set<string>();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CompilerError('RUNTIME-DEPS-002', 'Runtime dependency peer metadata is invalid');
  }
  const optional = new Set<string>();
  for (const [name, metadata] of Object.entries(value as Record<string, unknown>)) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw new CompilerError('RUNTIME-DEPS-002', 'Runtime dependency peer metadata is invalid');
    }
    const record = metadata as Record<string, unknown>;
    if (record.optional === true) optional.add(name);
  }
  return optional;
}

async function observeRuntimePackageManifest(
  packageRoot: string
): Promise<RuntimePackageManifestObservation> {
  const packageJsonPath = path.join(packageRoot, 'package.json');
  const metadata = await fs.lstat(packageJsonPath, { bigint: true });
  if (!metadata.isFile() || metadata.isSymbolicLink() ||
    !sameHostPath(await fs.realpath(packageJsonPath), packageJsonPath)) {
    throw new CompilerError('RUNTIME-DEPS-002', 'Runtime dependency package manifest is not one physical file');
  }
  const bytes = await fs.readFile(packageJsonPath);
  const after = await fs.lstat(packageJsonPath, { bigint: true });
  if (metadata.dev !== after.dev || metadata.ino !== after.ino || metadata.mode !== after.mode) {
    throw new CompilerError('RUNTIME-DEPS-002', 'Runtime dependency package manifest changed during observation');
  }
  const parsed = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
    !isRuntimeDependencyPackageName(parsed.name) ||
    typeof parsed.version !== 'string' || !parsed.version) {
    throw new CompilerError('RUNTIME-DEPS-002', 'Runtime dependency package manifest is invalid');
  }
  return Object.freeze({
    dependencies: dependencyRecord(parsed.dependencies, 'Runtime dependency dependencies'),
    manifestSha256: digest(bytes),
    name: parsed.name,
    optionalDependencies: dependencyRecord(
      parsed.optionalDependencies,
      'Runtime dependency optionalDependencies'
    ),
    optionalPeers: optionalPeerNames(parsed.peerDependenciesMeta),
    peerDependencies: dependencyRecord(
      parsed.peerDependencies,
      'Runtime dependency peerDependencies'
    ),
    version: parsed.version
  });
}

function runtimePackageRelativePath(nodeModulesPath: string, packageRoot: string): string {
  const relative = path.relative(path.resolve(nodeModulesPath), path.resolve(packageRoot));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new CompilerError('RUNTIME-DEPS-002', 'Runtime dependency package escapes node_modules');
  }
  return relative.replaceAll('\\', '/');
}

async function physicalRuntimePackageRoot(
  nodeModulesPath: string,
  candidate: string
): Promise<string | null> {
  try {
    const absolute = path.resolve(candidate);
    if (!isPathInside(nodeModulesPath, absolute)) return null;
    const metadata = await fs.lstat(absolute);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new CompilerError('RUNTIME-DEPS-002', 'Runtime dependency closure contains a reparse entry');
    }
    const physical = await fs.realpath(absolute);
    if (!sameHostPath(physical, absolute) || !isPathInside(nodeModulesPath, physical)) {
      throw new CompilerError('RUNTIME-DEPS-002', 'Runtime dependency package is not physically contained');
    }
    return absolute;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function resolveRuntimePackageRoot(
  nodeModulesPath: string,
  fromPackageRoot: string | null,
  dependencyName: string
): Promise<string | null> {
  const relativeSegments = dependencyName.split('/');
  if (fromPackageRoot === null) {
    return physicalRuntimePackageRoot(nodeModulesPath, path.join(nodeModulesPath, ...relativeSegments));
  }
  let cursor = path.resolve(fromPackageRoot);
  const modulesRoot = path.resolve(nodeModulesPath);
  while (isPathInside(modulesRoot, cursor)) {
    const candidate = path.basename(cursor).toLocaleLowerCase('en-US') === 'node_modules'
      ? path.join(cursor, ...relativeSegments)
      : path.join(cursor, 'node_modules', ...relativeSegments);
    const physical = await physicalRuntimePackageRoot(modulesRoot, candidate);
    if (physical !== null) return physical;
    if (sameHostPath(cursor, modulesRoot)) break;
    cursor = path.dirname(cursor);
  }
  return null;
}

async function observeRuntimeDependencyMaterializationBinding(input: Readonly<{
  nodeModulesPath: string;
  runtimeSpec: RuntimeDependencySpec;
  root: string;
  toolchain: Readonly<RuntimeDependencyToolchainBinding>;
}>): Promise<Readonly<RuntimeDependencyMaterializationBinding>> {
  const [
    lockfileBytes,
    packageJsonBytes,
    installConfigBytes,
    canonicalBunVersion,
    runtimeExecutable
  ] = await Promise.all([
    fs.readFile(path.join(input.root, 'bun.lock')),
    fs.readFile(path.join(input.root, 'package.json')),
    fs.readFile(path.join(input.root, 'bunfig.toml')).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    }),
    loadCanonicalBunRuntimeVersion(input.root),
    currentRuntimeExecutableIdentity()
  ]);
  const dependencyManifest = compilerDependencyManifestAuthority(packageJsonBytes);
  const observedInstallConfigSha256 = compilerInstallConfigSha256(installConfigBytes);
  const observedLegacyInstallConfigSha256 = installConfigBytes === null
    ? null
    : digest(installConfigBytes);
  if (digest(lockfileBytes) !== input.toolchain.lockSha256 ||
    dependencyManifest.dependencyManifestSha256 !== input.toolchain.dependencyManifestSha256 ||
    dependencyManifest.declaredBunVersion !== input.toolchain.declaredBunVersion ||
    (input.toolchain.installConfigSha256 !== observedInstallConfigSha256 &&
      input.toolchain.installConfigSha256 !== observedLegacyInstallConfigSha256) ||
    runtimeExecutable.path !== input.toolchain.bunExecutablePath ||
    runtimeExecutable.sha256 !== input.toolchain.bunExecutableSha256 ||
    canonicalBunVersion !== input.toolchain.bunVersion ||
    canonicalBunVersion !== input.toolchain.canonicalBunVersion ||
    canonicalBunVersion !== input.toolchain.declaredBunVersion ||
    process.arch !== input.toolchain.architecture ||
    process.platform !== input.toolchain.platform) {
    throw new CompilerError('RUNTIME-DEPS-002', 'Runtime dependency authority changed during observation');
  }
  const packages = new Map<string, RuntimePackageClosureState>();

  const visit = async (
    packageRoot: string,
    resolutionName: string
  ): Promise<string> => {
    const relativePath = runtimePackageRelativePath(input.nodeModulesPath, packageRoot);
    const existing = packages.get(relativePath);
    if (existing !== undefined) return existing.relativePath;
    const manifest = await observeRuntimePackageManifest(packageRoot);
    const state: RuntimePackageClosureState = {
      edges: [],
      manifestSha256: manifest.manifestSha256,
      name: manifest.name,
      relativePath,
      version: manifest.version
    };
    packages.set(relativePath, state);

    const dependencyKinds = new Map<string, RuntimeDependencyResolutionEdge['kind']>();
    for (const name of Object.keys(manifest.dependencies)) dependencyKinds.set(name, 'dependency');
    for (const name of Object.keys(manifest.optionalDependencies)) dependencyKinds.set(name, 'optional');
    for (const name of Object.keys(manifest.peerDependencies)) {
      if (!dependencyKinds.has(name)) dependencyKinds.set(name, 'peer');
    }
    for (const [dependencyName, kind] of [...dependencyKinds.entries()]
      .sort(([left], [right]) => compareCodeUnits(left, right))) {
      const targetRoot = await resolveRuntimePackageRoot(
        input.nodeModulesPath,
        packageRoot,
        dependencyName
      );
      const optional = kind === 'optional' ||
        (kind === 'peer' && manifest.optionalPeers.has(dependencyName));
      if (targetRoot === null) {
        if (optional) continue;
        throw new CompilerError(
          'RUNTIME-DEPS-002',
          `Runtime dependency closure is missing ${dependencyName} required by ${resolutionName}`
        );
      }
      state.edges.push(Object.freeze({
        kind,
        name: dependencyName,
        target: await visit(targetRoot, dependencyName)
      }));
    }
    return relativePath;
  };

  const exactVersions = { ...input.runtimeSpec.dependencies, ...input.runtimeSpec.devDependencies };
  const rootPackages: { name: string; target: string }[] = [];
  for (const packageName of [...RUNTIME_DEPENDENCY_PACKAGE_NAMES].sort(compareCodeUnits)) {
    const packageRoot = await resolveRuntimePackageRoot(input.nodeModulesPath, null, packageName);
    if (packageRoot === null) {
      throw new CompilerError('RUNTIME-DEPS-002', `Runtime dependency root package is absent: ${packageName}`);
    }
    const target = await visit(packageRoot, packageName);
    const observed = packages.get(target)!;
    if (observed.name !== packageName || observed.version !== exactVersions[packageName]) {
      throw new CompilerError('RUNTIME-DEPS-002', `Runtime dependency root package drifted: ${packageName}`);
    }
    rootPackages.push(Object.freeze({ name: packageName, target }));
  }

  return buildRuntimeDependencyMaterializationBinding({
    manifestHash: input.runtimeSpec.manifestHash,
    packages: [...packages.values()] as RuntimeDependencyResolvedPackage[],
    rootPackages,
    toolchain: input.toolchain
  });
}

async function installedRuntimePackagePaths(nodeModulesPath: string): Promise<readonly string[]> {
  const root = path.resolve(nodeModulesPath);
  const packages: string[] = [];
  const visitModules = async (modulesPath: string): Promise<void> => {
    const absoluteModulesPath = path.resolve(modulesPath);
    const before = await fs.lstat(modulesPath, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink() ||
      !sameHostPath(await fs.realpath(modulesPath), modulesPath) ||
      !(sameHostPath(root, absoluteModulesPath) || isPathInside(root, absoluteModulesPath))) {
      throw new CompilerError('RUNTIME-DEPS-002', 'Runtime dependency projection has a reparse modules root');
    }
    const entries = (await fs.readdir(modulesPath, { withFileTypes: true }))
      .sort((left, right) => compareCodeUnits(left.name, right.name));
    for (const entry of entries) {
      const entryPath = path.join(modulesPath, entry.name);
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new CompilerError('RUNTIME-DEPS-002', 'Runtime dependency projection has an unknown root entry');
      }
      const packageRoots = entry.name.startsWith('@')
        ? (await fs.readdir(entryPath, { withFileTypes: true }))
          .sort((left, right) => compareCodeUnits(left.name, right.name))
          .map((scoped) => {
            if (!scoped.isDirectory() || scoped.isSymbolicLink()) {
              throw new CompilerError('RUNTIME-DEPS-002', 'Runtime dependency projection scope is invalid');
            }
            return path.join(entryPath, scoped.name);
          })
        : [entryPath];
      for (const packageRoot of packageRoots) {
        const manifestMetadata = await fs.lstat(path.join(packageRoot, 'package.json'));
        if (!manifestMetadata.isFile() || manifestMetadata.isSymbolicLink()) {
          throw new CompilerError('RUNTIME-DEPS-002', 'Runtime dependency projection package is invalid');
        }
        packages.push(runtimePackageRelativePath(root, packageRoot));
        const nestedModules = path.join(packageRoot, 'node_modules');
        if (await pathExists(nestedModules)) await visitModules(nestedModules);
      }
    }
    const after = await fs.lstat(modulesPath, { bigint: true });
    const namesAfter = (await fs.readdir(modulesPath)).sort(compareCodeUnits);
    if (before.dev !== after.dev || before.ino !== after.ino || before.mode !== after.mode ||
      !canonicalEquals(namesAfter, entries.map((entry) => entry.name))) {
      throw new CompilerError('RUNTIME-DEPS-002', 'Runtime dependency projection changed during census');
    }
  };
  await visitModules(root);
  return Object.freeze(packages.sort(compareCodeUnits));
}

type PhysicalControlFileIdentity = Readonly<{
  dev: string;
  ino: string;
  mode: string;
  nlink: string;
}>;

function physicalControlFileIdentity(metadata: Readonly<{
  dev: bigint | number;
  ino: bigint | number;
  mode: bigint | number;
  nlink: bigint | number;
}>): PhysicalControlFileIdentity {
  return Object.freeze({
    dev: String(metadata.dev),
    ino: String(metadata.ino),
    mode: String(metadata.mode),
    nlink: String(metadata.nlink)
  });
}

function samePhysicalControlFileIdentity(
  left: PhysicalControlFileIdentity,
  right: PhysicalControlFileIdentity
): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode &&
    left.nlink === right.nlink;
}

async function observePhysicalControlFile(filePath: string): Promise<PhysicalControlFileIdentity> {
  const metadata = await fs.lstat(filePath, { bigint: true });
  if (!metadata.isFile() || metadata.isSymbolicLink() ||
    metadata.nlink !== 1n ||
    !sameHostPath(await fs.realpath(filePath), filePath)) {
    throw new CompilerError('RUNTIME-DEPS-002', `Runtime dependency control file is not physical: ${filePath}`);
  }
  return physicalControlFileIdentity(metadata);
}

async function readPhysicalControlText(filePath: string): Promise<string> {
  const before = await observePhysicalControlFile(filePath);
  const handle = await fs.open(filePath, 'r');
  try {
    const opened = physicalControlFileIdentity(await handle.stat({ bigint: true }));
    if (!samePhysicalControlFileIdentity(before, opened)) {
      throw new CompilerError('RUNTIME-DEPS-002', `Runtime dependency control file changed: ${filePath}`);
    }
    const text = await handle.readFile('utf8');
    const after = physicalControlFileIdentity(await handle.stat({ bigint: true }));
    const current = await observePhysicalControlFile(filePath);
    if (!samePhysicalControlFileIdentity(opened, after) ||
      !samePhysicalControlFileIdentity(after, current)) {
      throw new CompilerError('RUNTIME-DEPS-002', `Runtime dependency control file changed: ${filePath}`);
    }
    return text;
  } finally {
    await handle.close();
  }
}

async function writePhysicalControlText(
  filePath: string,
  text: string,
  commitFence?: CommitFence
): Promise<void> {
  const absolute = path.resolve(filePath);
  let observed: PhysicalControlFileIdentity | null;
  try {
    observed = await observePhysicalControlFile(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    observed = null;
  }
  await commitFence?.();
  const parent = inspectNoFollowDirectoryChainV1(
    path.dirname(absolute),
    'Runtime dependency control file parent'
  ).target;
  const name = path.basename(absolute);
  const bytes = Buffer.from(text, 'utf8');
  const validate = (candidate: Uint8Array): void => {
    if (!Buffer.from(candidate).equals(bytes)) {
      throw new CompilerError('RUNTIME-DEPS-002', `Runtime dependency control file bytes changed: ${filePath}`);
    }
  };
  if (observed === null) {
    publishExclusiveDurableCanonicalFileV1({
      parent,
      name,
      bytes,
      validate
    });
  } else {
    replaceDurableCanonicalFileV1({
      parent,
      name,
      bytes,
      expectedExisting: { device: observed.dev, inode: observed.ino },
      validate
    });
  }
  const publishedText = await readPhysicalControlText(absolute);
  if (publishedText !== text) {
    throw new CompilerError('RUNTIME-DEPS-002', 'Runtime dependency control file bytes failed exact readback');
  }
}

async function assertPhysicalControlEntries(paths: readonly string[]): Promise<void> {
  for (const filePath of paths) {
    try {
      await observePhysicalControlFile(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

async function writeManifestIfChanged(
  filePath: string,
  value: unknown,
  commitFence?: CommitFence
): Promise<void> {
  const nextText = formatJsonFile(value);
  try {
    if (await readPhysicalControlText(filePath) === nextText) return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await writePhysicalControlText(filePath, nextText, commitFence);
}

function generatedStatePhysicalIdentityV1(
  identity: Readonly<Pick<PhysicalDirectoryIdentityV1, 'device' | 'inode' | 'objectId'>>
): GeneratedStatePhysicalIdentityV1 {
  return Object.freeze({
    device: identity.device,
    inode: identity.inode,
    objectId: identity.objectId
  });
}

function isGeneratedStatePhysicalIdentityV1(value: unknown): value is GeneratedStatePhysicalIdentityV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const identity = value as Partial<GeneratedStatePhysicalIdentityV1>;
  return typeof identity.device === 'string' && identity.device.length > 0 &&
    typeof identity.inode === 'string' && identity.inode.length > 0 &&
    typeof identity.objectId === 'string' && identity.objectId.length > 0;
}

function isSha256DigestV1(value: unknown): value is `sha256:${string}` {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function sameGeneratedStateIdentityV1(
  left: Readonly<GeneratedStatePhysicalIdentityV1>,
  right: Readonly<GeneratedStatePhysicalIdentityV1>
): boolean {
  return left.device === right.device && left.inode === right.inode && left.objectId === right.objectId;
}

type RuntimeDependencySourceGenerationInputV1 = Readonly<{
  binding: unknown;
  options: RuntimeDependencyOperationOptionsV1;
  ownerRoot: string;
  sourcePath: string;
}>;

/**
 * A source-generation inventory is an invocation-local observation, not a
 * cache of authority.  Concurrent consumers may join the same in-flight
 * scan, but the entry is removed as soon as the scan settles and every
 * caller still performs its own effect-boundary readback.  This prevents a
 * waiter fan-out from repeating the 11k-entry root fence while preserving
 * mutation invalidation and fresh-process semantics.
 */
const runtimeDependencySourceGenerationInFlightV1 = new Map<
  string,
  Promise<RuntimeDependencySourceGenerationV1>
>();

function runtimeDependencySourceGenerationKeyV1(
  input: RuntimeDependencySourceGenerationInputV1
): string {
  return JSON.stringify([
    path.resolve(input.ownerRoot),
    path.resolve(input.sourcePath),
    generatedStateDigestV1(input.binding),
    runtimeDependencyOperationContextV1(input.options).operationId
  ]);
}

async function runtimeDependencySourceGenerationInternalV1(
  input: RuntimeDependencySourceGenerationInputV1
): Promise<RuntimeDependencySourceGenerationV1> {
  const options = runtimeDependencyOperationOptionsV1(input.options);
  const context = runtimeDependencyOperationContextV1(options);
  runtimeDependencyOperationRemainingMsV1(options, 'Runtime dependency source generation admission');
  const owner = inspectNoFollowDirectoryChainV1(
    input.ownerRoot,
    'Runtime dependency source owner root'
  ).target;
  const source = inspectNoFollowDirectoryChainV1(
    input.sourcePath,
    'Runtime dependency source generation'
  ).target;
  const ownerRootPhysical = generatedStatePhysicalIdentityV1(owner);
  const physical = generatedStatePhysicalIdentityV1(source);
  const bindingDigest = generatedStateDigestV1(input.binding);
  const treeInventory = scanNoFollowDirectoryTreeInventoryV1(source, {
    deadlineAtMs: context.deadlineAtMonotonicMs,
    maximumBytes: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES_V1,
    maximumEntries: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES_V1,
    signal: context.signal
  });
  runtimeDependencyOperationRemainingMsV1(options, 'Runtime dependency source generation readback');
  const currentOwner = assertSameNoFollowDirectoryIdentityV1(
    owner,
    'Runtime dependency source owner root readback'
  ).target;
  const currentSource = assertSameNoFollowDirectoryIdentityV1(
    source,
    'Runtime dependency source generation readback'
  ).target;
  if (!sameGeneratedStateIdentityV1(
    generatedStatePhysicalIdentityV1(currentOwner),
    ownerRootPhysical
  ) || !sameGeneratedStateIdentityV1(
    generatedStatePhysicalIdentityV1(currentSource),
    physical
  )) {
    throw new CompilerError(
      'RUNTIME-DEPS-004',
      'Runtime dependency source physical identity changed during generation inventory'
    );
  }
  const treeEntries = Object.freeze(treeInventory.map((entry) => Object.freeze({
    relativePath: entry.relativePath,
    kind: entry.kind,
    device: entry.device,
    inode: entry.inode,
    size: entry.size,
    contentDigest: entry.contentDigest,
    linkTarget: entry.linkTarget
  })));
  const treeDigest = generatedStateDigestV1(Object.freeze({
    schema: 'sec-runtime-dependency-source-tree-v1',
    entries: treeEntries
  }));
  const treeEntryCount = treeEntries.length;
  const epoch = generatedStateDigestV1(Object.freeze({
    schema: 'sec-runtime-dependency-generation-epoch-v1',
    ownerRoot: path.resolve(input.ownerRoot),
    ownerRootPhysical,
    physical,
    bindingDigest,
    treeDigest,
    treeEntryCount
  }));
  return Object.freeze({
    schema: 'sec-runtime-dependency-source-generation-v1' as const,
    ownerRoot: path.resolve(input.ownerRoot),
    ownerRootPhysical,
    sourcePath: path.resolve(input.sourcePath),
    physical,
    bindingDigest,
    treeDigest,
    treeEntryCount,
    epoch
  });
}

async function runtimeDependencySourceGenerationV1(
  input: RuntimeDependencySourceGenerationInputV1
): Promise<RuntimeDependencySourceGenerationV1> {
  const key = runtimeDependencySourceGenerationKeyV1(input);
  const existing = runtimeDependencySourceGenerationInFlightV1.get(key);
  if (existing !== undefined) return existing;
  const pending = runtimeDependencySourceGenerationInternalV1(input);
  runtimeDependencySourceGenerationInFlightV1.set(key, pending);
  try {
    return await pending;
  } finally {
    if (runtimeDependencySourceGenerationInFlightV1.get(key) === pending) {
      runtimeDependencySourceGenerationInFlightV1.delete(key);
    }
  }
}

function sameRuntimeDependencySourceGenerationContentV1(
  left: RuntimeDependencySourceGenerationV1,
  right: RuntimeDependencySourceGenerationV1
): boolean {
  return left.treeDigest === right.treeDigest && left.treeEntryCount === right.treeEntryCount;
}

async function runtimeDependencyTargetIdentityV1(
  targetPath: string
): Promise<RuntimeDependencyTargetIdentityV1 | null> {
  const absoluteTarget = path.resolve(targetPath);
  const parent = inspectNoFollowDirectoryChainV1(
    path.dirname(absoluteTarget),
    'Runtime dependency target parent'
  ).target;
  const name = path.basename(absoluteTarget);
  let link: ReturnType<typeof inspectNoFollowLinkEntryV1>;
  try {
    link = inspectNoFollowLinkEntryV1(parent, name);
  } catch (error) {
    // The link primitive intentionally rejects a non-link leaf. A following
    // exact directory observation below distinguishes that ordinary case from
    // a foreign file/reparse entry, which remains a typed blocker.
    if (error instanceof PhysicalNoFollowError &&
      (error.code === 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED' ||
        error.code === 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH')) {
      link = null;
    } else {
      throw error;
    }
  }
  if (link !== null) {
    if (link.kind !== 'link' || link.linkTarget === null) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Runtime dependency target is not a valid physical link');
    }
    return Object.freeze({
      schema: 'sec-runtime-dependency-target-identity-v1' as const,
      kind: 'link' as const,
      physical: Object.freeze({
        device: link.device,
        inode: link.inode,
        objectId: generatedStateDigestV1({ kind: 'link', target: link.linkTarget })
      }),
      linkTarget: link.linkTarget
    });
  }
  const directory = inspectExactNoFollowDirectoryPresenceV1(
    absoluteTarget,
    'Runtime dependency target directory'
  );
  if (directory.state === 'absent') return null;
  return Object.freeze({
    schema: 'sec-runtime-dependency-target-identity-v1' as const,
    kind: 'directory' as const,
    physical: generatedStatePhysicalIdentityV1(directory.directory.target),
    linkTarget: null
  });
}

function isRuntimeDependencySourceGenerationV1(
  value: unknown
): value is RuntimeDependencySourceGenerationV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const source = value as Partial<RuntimeDependencySourceGenerationV1>;
  return source.schema === 'sec-runtime-dependency-source-generation-v1' &&
    typeof source.ownerRoot === 'string' && path.isAbsolute(source.ownerRoot) &&
    typeof source.sourcePath === 'string' && path.isAbsolute(source.sourcePath) &&
    isGeneratedStatePhysicalIdentityV1(source.ownerRootPhysical) &&
    isGeneratedStatePhysicalIdentityV1(source.physical) &&
    isSha256DigestV1(source.bindingDigest) &&
    isSha256DigestV1(source.treeDigest) &&
    typeof source.treeEntryCount === 'number' && Number.isSafeInteger(source.treeEntryCount) && source.treeEntryCount >= 0 &&
    isSha256DigestV1(source.epoch);
}

function isRuntimeDependencyTargetIdentityV1(
  value: unknown
): value is RuntimeDependencyTargetIdentityV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const target = value as Partial<RuntimeDependencyTargetIdentityV1>;
  return target.schema === 'sec-runtime-dependency-target-identity-v1' &&
    (target.kind === 'directory' || target.kind === 'link') &&
    isGeneratedStatePhysicalIdentityV1(target.physical) &&
    (target.linkTarget === null || typeof target.linkTarget === 'string');
}

type DependencyTransitionKindV1 =
  | 'compiler-generation'
  | 'compiler-locator'
  | 'compiler-bridge'
  | 'runtime-projection'
  | 'project-projection';

type DependencyTransitionPhaseV1 =
  | 'prepared'
  | 'backed-up'
  | 'published'
  | 'binding-validated'
  | 'stamp-readback'
  | 'complete'
  | 'rolled-back'
  | 'recovery-required';

type DependencyTransitionSlotV1 = Readonly<{
  readonly path: string;
  readonly kind: 'absent' | 'directory' | 'link';
  readonly physical: Readonly<GeneratedStatePhysicalIdentityV1> | null;
  readonly linkTarget: string | null;
  readonly bindingDigest: `sha256:${string}` | null;
}>;

interface DependencyTransitionJournalV1 {
  readonly schema: 'sec-dependency-transition-journal-v1';
  readonly recordDigest: `sha256:${string}`;
  readonly previousRecordDigest: `sha256:${string}` | null;
  readonly sequence: number;
  readonly operationKey: `sha256:${string}`;
  readonly attemptNonce: string;
  readonly kind: DependencyTransitionKindV1;
  readonly ownerRoot: string;
  readonly ownerRootPhysical: Readonly<GeneratedStatePhysicalIdentityV1>;
  readonly destination: DependencyTransitionSlotV1;
  readonly preimage: DependencyTransitionSlotV1;
  readonly stage: DependencyTransitionSlotV1 | null;
  /**
   * The operation-created staging container is a separate authority from the
   * staged `node_modules` child.  Recovery must retain both identities before
   * it can dispose anything; a path/name alone is never a cleanup authority.
   */
  readonly stageRoot: DependencyTransitionSlotV1 | null;
  readonly backup: DependencyTransitionSlotV1 | null;
  readonly sourceGeneration: Readonly<RuntimeDependencySourceGenerationV1>;
  readonly phase: DependencyTransitionPhaseV1;
  readonly durability: 'known' | 'unknown';
  readonly failure: Readonly<{ code: string; message: string }> | null;
}

type DependencyTransitionUnsignedV1 = Omit<DependencyTransitionJournalV1, 'recordDigest'>;

const DEPENDENCY_TRANSITION_SCHEMA_V1 = 'sec-dependency-transition-journal-v1' as const;
const DEPENDENCY_TRANSITION_POINTER_SCHEMA_V1 = 'sec-dependency-transition-pointer-v1' as const;

interface DependencyTransitionNamespaceV1 {
  readonly ownerRoot: PhysicalDirectoryIdentityV1;
  readonly backupRoot: PhysicalDirectoryIdentityV1;
  readonly journalRoot: PhysicalDirectoryIdentityV1;
  readonly recordsRoot: PhysicalDirectoryIdentityV1;
  readonly rolloversRoot: PhysicalDirectoryIdentityV1 | null;
}

/**
 * The mutable `current.json` file is only a best-effort locator.  It is not a
 * transition authority: a caller must derive the one maximal tip from the
 * immutable record ledger before it can inspect or perform recovery effects.
 * Keeping this distinction explicit prevents a concurrent/external pointer
 * writer from making an older or foreign record appear authoritative.
 */
interface DependencyTransitionLedgerV1 {
  readonly namespace: DependencyTransitionNamespaceV1;
  readonly records: ReadonlyMap<`sha256:${string}`, DependencyTransitionJournalV1>;
  readonly ledgerDigest: `sha256:${string}`;
  readonly tip: DependencyTransitionJournalV1 | null;
}

const DEPENDENCY_TRANSITION_RECORD_CAPACITY_V1 = 10_000;
// Transition records are small canonical journal envelopes.  Reading their
// bounded bytes in one retained no-follow census avoids reopening every leaf
// after a metadata scan (O(records x phase writes)) while keeping the ledger
// memory/deadline contract explicit.  Dependency trees use the streaming
// inventory path and never enter this budget.
const DEPENDENCY_TRANSITION_RECORD_BYTES_CAPACITY_V1 = 64 * 1024 * 1024;
const DEPENDENCY_COMMAND_OUTPUT_BYTES_CAPACITY_V1 = DEPENDENCY_TRANSITION_RECORD_BYTES_CAPACITY_V1;
const DEPENDENCY_TRANSITION_ROLLOVER_TRIGGER_V1 = 9_000;
const DEPENDENCY_TRANSITION_ROLLOVER_NAMESPACE_CAPACITY_V1 = 4_096;
const DEPENDENCY_TRANSITION_ROLLOVER_SCHEMA_V1 = 'sec-dependency-transition-rollover-v1' as const;

type DependencyTransitionRolloverPhaseV1 =
  | 'prepared'
  | 'staged'
  | 'backed-up'
  | 'published'
  | 'retiring'
  | 'retired'
  | 'complete';

interface DependencyTransitionRolloverIntentV1 {
  readonly schema: typeof DEPENDENCY_TRANSITION_ROLLOVER_SCHEMA_V1;
  readonly intentDigest: `sha256:${string}`;
  readonly previousIntentDigest: `sha256:${string}` | null;
  readonly sequence: number;
  readonly phase: DependencyTransitionRolloverPhaseV1;
  readonly ownerRoot: string;
  readonly ownerRootPhysical: Readonly<GeneratedStatePhysicalIdentityV1>;
  readonly recordsRootPath: string;
  readonly sourceRecordsRootPhysical: Readonly<GeneratedStatePhysicalIdentityV1>;
  readonly retiredRecordsPath: string;
  readonly retiredRecordsPhysical: Readonly<GeneratedStatePhysicalIdentityV1> | null;
  readonly retiredRecordsDisposed: boolean;
  readonly nextRecordsPath: string;
  readonly nextRecordsPhysical: Readonly<GeneratedStatePhysicalIdentityV1> | null;
  readonly publishedRecordsRootPhysical: Readonly<GeneratedStatePhysicalIdentityV1> | null;
  readonly terminalRecordDigest: `sha256:${string}`;
  readonly ledgerDigest: `sha256:${string}`;
  readonly recordCount: number;
  readonly checkpoint: DependencyTransitionJournalV1;
}

function dependencyTransitionNamespacePaths(ownerRoot: string): Readonly<{
  backupRoot: string;
  journalRoot: string;
  recordsRoot: string;
  rolloversRoot: string;
}> {
  const backupRoot = path.join(ownerRoot, '.tmp', 'dependency-installs', 'compiler-backups');
  const journalRoot = path.join(backupRoot, '.dependency-transition-v1');
  return Object.freeze({
    backupRoot,
    journalRoot,
    recordsRoot: path.join(journalRoot, 'records'),
    rolloversRoot: path.join(journalRoot, 'rollovers')
  });
}

function dependencyTransitionDigestWithoutRecord(
  record: DependencyTransitionUnsignedV1
): `sha256:${string}` {
  return generatedStateDigestV1(canonicalJson(record));
}

/**
 * A rollover checkpoint is a compact successor for an already authenticated
 * terminal ledger.  It is deliberately not a copy of the caller's next
 * prepared operation: accepting caller fields here would let a forged
 * prepared intent become the new ledger root during crash recovery.  The
 * checkpoint keeps the terminal topology/physical receipts and derives its
 * operation identity from both the old terminal digest and the complete
 * source-ledger digest.  Recovery proves this derivation while the old ledger
 * is still present, before it is moved to the retired archive.
 */
function dependencyTransitionTerminalCheckpointV1(
  terminal: DependencyTransitionJournalV1,
  ledgerDigest: `sha256:${string}`
): DependencyTransitionJournalV1 {
  if (terminal.phase !== 'complete' && terminal.phase !== 'rolled-back') {
    throw new CompilerError('RUNTIME-DEPS-004', 'Only a terminal dependency transition can seed a rollover checkpoint');
  }
  const unsigned: DependencyTransitionUnsignedV1 = Object.freeze({
    schema: DEPENDENCY_TRANSITION_SCHEMA_V1,
    previousRecordDigest: null,
    sequence: 1,
    operationKey: generatedStateDigestV1(Object.freeze({
      schema: 'sec-dependency-transition-rollover-checkpoint-operation-v1',
      terminalRecordDigest: terminal.recordDigest,
      ledgerDigest
    })),
    attemptNonce: `rollover-checkpoint:${terminal.recordDigest.slice('sha256:'.length)}`,
    kind: terminal.kind,
    ownerRoot: terminal.ownerRoot,
    ownerRootPhysical: terminal.ownerRootPhysical,
    destination: terminal.destination,
    preimage: terminal.preimage,
    stage: terminal.stage,
    stageRoot: terminal.stageRoot,
    backup: terminal.backup,
    sourceGeneration: terminal.sourceGeneration,
    phase: terminal.phase,
    durability: terminal.durability,
    failure: terminal.failure
  });
  return Object.freeze({
    ...unsigned,
    recordDigest: dependencyTransitionDigestWithoutRecord(unsigned)
  }) as DependencyTransitionJournalV1;
}

function dependencyTransitionRecordBytes(record: DependencyTransitionJournalV1): Buffer {
  // Journal records are immutable evidence.  Their digest is over canonical
  // JSON and the bytes published under the digest-named path must use that
  // same canonical ordering; a merely parseable pretty-printed variant is a
  // collision, not a record we may adopt.
  return Buffer.from(formatJsonFile(canonicalJson(record)), 'utf8');
}

const DEPENDENCY_TRANSITION_RECORD_KEYS_V1 = Object.freeze([
  'attemptNonce', 'backup', 'destination', 'durability', 'failure',
  'kind', 'operationKey', 'ownerRoot', 'ownerRootPhysical', 'phase',
  'preimage', 'previousRecordDigest', 'recordDigest', 'schema',
  'sequence', 'sourceGeneration', 'stage', 'stageRoot'
]);
const DEPENDENCY_TRANSITION_POINTER_KEYS_V1 = Object.freeze(['recordDigest', 'schema']);
const DEPENDENCY_TRANSITION_ROLLOVER_KEYS_V1 = Object.freeze([
  'checkpoint', 'intentDigest', 'nextRecordsPath', 'nextRecordsPhysical',
  'previousIntentDigest', 'sequence',
  'ownerRoot', 'ownerRootPhysical', 'phase', 'publishedRecordsRootPhysical',
  'recordCount', 'recordsRootPath', 'retiredRecordsPath', 'retiredRecordsPhysical',
  'retiredRecordsDisposed', 'ledgerDigest',
  'schema', 'sourceRecordsRootPhysical', 'terminalRecordDigest'
]);
const DEPENDENCY_TRANSITION_SLOT_KEYS_V1 = Object.freeze([
  'bindingDigest', 'kind', 'linkTarget', 'path', 'physical'
]);
const RUNTIME_SOURCE_GENERATION_KEYS_V1 = Object.freeze([
  'bindingDigest', 'epoch', 'ownerRoot', 'ownerRootPhysical', 'physical',
  'sourcePath', 'treeDigest', 'treeEntryCount', 'schema'
]);
const GENERATED_STATE_PHYSICAL_IDENTITY_KEYS_V1 = Object.freeze(['device', 'inode', 'objectId']);

function hasExactObjectKeysV1(
  value: unknown,
  keys: readonly string[]
): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.keys(value).sort(compareCodeUnits).join('\0') ===
    [...keys].sort(compareCodeUnits).join('\0');
}

function isCanonicalAbsolutePathV1(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0') &&
    path.isAbsolute(value) && path.resolve(value) === value;
}

function isCanonicalGeneratedStatePhysicalIdentityV1(value: unknown): value is GeneratedStatePhysicalIdentityV1 {
  return hasExactObjectKeysV1(value, GENERATED_STATE_PHYSICAL_IDENTITY_KEYS_V1) &&
    typeof value.device === 'string' && value.device.length > 0 &&
    typeof value.inode === 'string' && value.inode.length > 0 &&
    typeof value.objectId === 'string' && value.objectId.length > 0;
}

function isCanonicalDependencyTransitionSlotV1(value: unknown): value is DependencyTransitionSlotV1 {
  if (!hasExactObjectKeysV1(value, DEPENDENCY_TRANSITION_SLOT_KEYS_V1) ||
      !isCanonicalAbsolutePathV1(value.path) ||
      !(['absent', 'directory', 'link'] as readonly string[]).includes(value.kind as string) ||
      (value.bindingDigest !== null && !isSha256DigestV1(value.bindingDigest)) ||
      (value.linkTarget !== null && typeof value.linkTarget !== 'string')) return false;
  if (value.kind === 'absent') {
    return value.physical === null && value.linkTarget === null && value.bindingDigest === null;
  }
  if (!isCanonicalGeneratedStatePhysicalIdentityV1(value.physical)) return false;
  return value.kind === 'link' ? value.linkTarget !== null : value.linkTarget === null;
}

function isCanonicalRuntimeDependencySourceGenerationV1(
  value: unknown
): value is RuntimeDependencySourceGenerationV1 {
  if (!hasExactObjectKeysV1(value, RUNTIME_SOURCE_GENERATION_KEYS_V1) ||
      value.schema !== 'sec-runtime-dependency-source-generation-v1' ||
      !isCanonicalAbsolutePathV1(value.ownerRoot) ||
      !isCanonicalAbsolutePathV1(value.sourcePath) ||
      !isCanonicalGeneratedStatePhysicalIdentityV1(value.ownerRootPhysical) ||
      !isCanonicalGeneratedStatePhysicalIdentityV1(value.physical) ||
      !isSha256DigestV1(value.bindingDigest) || !isSha256DigestV1(value.treeDigest) ||
      !Number.isSafeInteger(value.treeEntryCount) || (value.treeEntryCount as number) < 0 ||
      !isSha256DigestV1(value.epoch)) return false;
  return true;
}

function parseDependencyTransitionRecordV1(
  bytes: Uint8Array,
  expectedName?: string
): DependencyTransitionJournalV1 {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch (error) {
    throw new CompilerError('RUNTIME-DEPS-002', 'Dependency transition journal record is not JSON', {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  if (!hasExactObjectKeysV1(value, DEPENDENCY_TRANSITION_RECORD_KEYS_V1)) {
    throw new CompilerError('RUNTIME-DEPS-002', 'Dependency transition journal record has noncanonical keys');
  }
  const record = value as unknown as DependencyTransitionJournalV1;
  if (record.schema !== DEPENDENCY_TRANSITION_SCHEMA_V1 || !isSha256DigestV1(record.recordDigest) ||
      !isSha256DigestV1(record.previousRecordDigest) && record.previousRecordDigest !== null ||
      !Number.isSafeInteger(record.sequence) || record.sequence < 1 ||
      !isSha256DigestV1(record.operationKey) || typeof record.attemptNonce !== 'string' ||
      record.attemptNonce.length === 0 || !(['compiler-generation', 'compiler-locator', 'compiler-bridge', 'runtime-projection', 'project-projection'] as readonly string[]).includes(record.kind) ||
      !isCanonicalAbsolutePathV1(record.ownerRoot) ||
      !isCanonicalGeneratedStatePhysicalIdentityV1(record.ownerRootPhysical) ||
      !isCanonicalDependencyTransitionSlotV1(record.destination) ||
      !isCanonicalDependencyTransitionSlotV1(record.preimage) ||
      (record.stage !== null && !isCanonicalDependencyTransitionSlotV1(record.stage)) ||
      (record.stageRoot !== null && !isCanonicalDependencyTransitionSlotV1(record.stageRoot)) ||
      (record.backup !== null && !isCanonicalDependencyTransitionSlotV1(record.backup)) ||
      !isCanonicalRuntimeDependencySourceGenerationV1(record.sourceGeneration) ||
      !(['prepared', 'backed-up', 'published', 'binding-validated', 'stamp-readback', 'complete', 'rolled-back', 'recovery-required'] as readonly string[]).includes(record.phase) ||
      !(['known', 'unknown'] as readonly string[]).includes(record.durability) ||
      (record.failure !== null && (!hasExactObjectKeysV1(record.failure, ['code', 'message']) ||
        typeof record.failure.code !== 'string' || record.failure.code.length === 0 ||
        typeof record.failure.message !== 'string' || record.failure.message.length === 0))) {
    throw new CompilerError('RUNTIME-DEPS-002', 'Dependency transition journal record fields are invalid');
  }
  if (record.destination.path !== record.preimage.path ||
      (record.stage === null) !== (record.stageRoot === null) ||
      (record.stage !== null && record.stageRoot !== null && (
        path.dirname(record.stage.path) !== record.stageRoot.path ||
        (record.stageRoot.kind === 'absent' && record.stage.kind !== 'absent') ||
        (record.stageRoot.kind !== 'directory' && record.stageRoot.kind !== 'absent')
      )) ||
      (record.backup !== null && path.dirname(record.backup.path) !==
        path.join(record.ownerRoot, '.tmp', 'dependency-installs', 'compiler-backups'))) {
    throw new CompilerError('RUNTIME-DEPS-002', 'Dependency transition journal topology is noncanonical');
  }
  if (record.kind === 'compiler-bridge' && (
    record.preimage.kind !== 'absent' ||
    record.stage !== null ||
    record.stageRoot !== null ||
    record.backup !== null ||
    record.sourceGeneration.ownerRoot !== path.dirname(record.sourceGeneration.sourcePath) ||
    path.basename(record.sourceGeneration.sourcePath).toLocaleLowerCase('en-US') !== 'node_modules' ||
    path.resolve(record.destination.path) === path.resolve(record.sourceGeneration.sourcePath)
  )) {
    throw new CompilerError('RUNTIME-DEPS-002', 'Compiler bridge transition journal topology is noncanonical');
  }
  if (expectedName !== undefined && expectedName !== transitionRecordName(record.recordDigest)) {
    throw new CompilerError('RUNTIME-DEPS-002', 'Dependency transition journal filename does not match its digest');
  }
  const { recordDigest: _recordDigest, ...unsigned } = record;
  if (dependencyTransitionDigestWithoutRecord(unsigned) !== record.recordDigest) {
    throw new CompilerError('RUNTIME-DEPS-002', 'Dependency transition journal record digest is invalid');
  }
  if (formatJsonFile(canonicalJson(record)) !== Buffer.from(bytes).toString('utf8')) {
    throw new CompilerError('RUNTIME-DEPS-002', 'Dependency transition journal record bytes are not canonical');
  }
  return Object.freeze(record);
}

function assertDependencyTransitionRecordBytes(bytes: Uint8Array): void {
  parseDependencyTransitionRecordV1(bytes);
}

function assertDependencyTransitionPointerBytes(bytes: Uint8Array): void {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch (error) {
    throw new CompilerError('RUNTIME-DEPS-002', 'Dependency transition pointer is not JSON', {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  if (!hasExactObjectKeysV1(value, DEPENDENCY_TRANSITION_POINTER_KEYS_V1)) {
    throw new CompilerError('RUNTIME-DEPS-002', 'Dependency transition pointer has noncanonical keys');
  }
  const pointer = value as { schema: string; recordDigest: string };
  if (pointer.schema !== DEPENDENCY_TRANSITION_POINTER_SCHEMA_V1 || !isSha256DigestV1(pointer.recordDigest) ||
      formatJsonFile(canonicalJson(value)) !== Buffer.from(bytes).toString('utf8')) {
    throw new CompilerError('RUNTIME-DEPS-002', 'Dependency transition pointer schema is invalid');
  }
}

function rolloverIntentStableDigestV1(
  intent: Pick<DependencyTransitionRolloverIntentV1,
    'previousIntentDigest' | 'sequence' | 'ownerRoot' | 'ownerRootPhysical' |
    'recordsRootPath' | 'sourceRecordsRootPhysical' |
    'retiredRecordsPath' | 'nextRecordsPath' | 'terminalRecordDigest' | 'ledgerDigest' |
    'recordCount' | 'checkpoint'>
): `sha256:${string}` {
  return generatedStateDigestV1(Object.freeze({
    schema: DEPENDENCY_TRANSITION_ROLLOVER_SCHEMA_V1,
    previousIntentDigest: intent.previousIntentDigest,
    sequence: intent.sequence,
    ownerRoot: intent.ownerRoot,
    ownerRootPhysical: intent.ownerRootPhysical,
    recordsRootPath: intent.recordsRootPath,
    sourceRecordsRootPhysical: intent.sourceRecordsRootPhysical,
    retiredRecordsPath: intent.retiredRecordsPath,
    nextRecordsPath: intent.nextRecordsPath,
    terminalRecordDigest: intent.terminalRecordDigest,
    ledgerDigest: intent.ledgerDigest,
    recordCount: intent.recordCount,
    checkpointDigest: intent.checkpoint.recordDigest
  }));
}

function rolloverIntentFileNameV1(
  intentDigest: `sha256:${string}`,
  phase: DependencyTransitionRolloverPhaseV1
): string {
  return `rollover-${intentDigest.slice('sha256:'.length)}-${phase}.json`;
}

function rolloverResidueStemV1(
  intent: Pick<DependencyTransitionRolloverIntentV1,
    'previousIntentDigest' | 'sequence' | 'ownerRoot' | 'terminalRecordDigest' |
    'ledgerDigest' | 'recordCount' | 'checkpoint'>
): string {
  return generatedStateDigestV1(Object.freeze({
    schema: DEPENDENCY_TRANSITION_ROLLOVER_SCHEMA_V1,
    previousIntentDigest: intent.previousIntentDigest,
    sequence: intent.sequence,
    ownerRoot: path.resolve(intent.ownerRoot),
    terminalRecordDigest: intent.terminalRecordDigest,
    ledgerDigest: intent.ledgerDigest,
    recordCount: intent.recordCount,
    checkpointDigest: intent.checkpoint.recordDigest
  })).slice('sha256:'.length, 'sha256:'.length + 48);
}

function parseDependencyTransitionRolloverIntentV1(
  bytes: Uint8Array,
  expectedName?: string
): DependencyTransitionRolloverIntentV1 {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch (error) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover intent is not JSON', {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  if (!hasExactObjectKeysV1(value, DEPENDENCY_TRANSITION_ROLLOVER_KEYS_V1)) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover intent has noncanonical keys');
  }
  const intent = value as unknown as DependencyTransitionRolloverIntentV1;
  if (intent.schema !== DEPENDENCY_TRANSITION_ROLLOVER_SCHEMA_V1 ||
      !isSha256DigestV1(intent.intentDigest) ||
      (intent.previousIntentDigest !== null && !isSha256DigestV1(intent.previousIntentDigest)) ||
      !Number.isSafeInteger(intent.sequence) || intent.sequence < 1 ||
      !(['prepared', 'staged', 'backed-up', 'published', 'retiring', 'retired', 'complete'] as readonly string[]).includes(intent.phase) ||
      !isCanonicalAbsolutePathV1(intent.ownerRoot) ||
      !isCanonicalGeneratedStatePhysicalIdentityV1(intent.ownerRootPhysical) ||
      !isCanonicalAbsolutePathV1(intent.recordsRootPath) ||
      !isCanonicalGeneratedStatePhysicalIdentityV1(intent.sourceRecordsRootPhysical) ||
      !isCanonicalAbsolutePathV1(intent.retiredRecordsPath) ||
      !isCanonicalAbsolutePathV1(intent.nextRecordsPath) ||
      (intent.retiredRecordsPhysical !== null &&
        !isCanonicalGeneratedStatePhysicalIdentityV1(intent.retiredRecordsPhysical)) ||
      (intent.nextRecordsPhysical !== null &&
        !isCanonicalGeneratedStatePhysicalIdentityV1(intent.nextRecordsPhysical)) ||
      (intent.publishedRecordsRootPhysical !== null &&
        !isCanonicalGeneratedStatePhysicalIdentityV1(intent.publishedRecordsRootPhysical)) ||
      !isSha256DigestV1(intent.terminalRecordDigest) ||
      !isSha256DigestV1(intent.ledgerDigest) ||
      !Number.isSafeInteger(intent.recordCount) || intent.recordCount < 1 ||
      intent.recordCount > DEPENDENCY_TRANSITION_RECORD_CAPACITY_V1 ||
      typeof intent.retiredRecordsDisposed !== 'boolean' ||
      parseDependencyTransitionRecordV1(
        Buffer.from(formatJsonFile(canonicalJson(intent.checkpoint)), 'utf8')
      ).recordDigest !== intent.checkpoint.recordDigest) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover intent fields are invalid');
  }
  const journalRoot = path.dirname(intent.recordsRootPath);
  const rolloversRoot = path.join(journalRoot, 'rollovers');
  const residueStem = rolloverResidueStemV1(intent);
  if (path.dirname(intent.retiredRecordsPath) !== rolloversRoot ||
      path.dirname(intent.nextRecordsPath) !== rolloversRoot ||
      path.basename(intent.retiredRecordsPath) !== `records-retired-${residueStem}` ||
      path.basename(intent.nextRecordsPath) !== `records-next-${residueStem}` ||
       (intent.checkpoint.phase !== 'complete' && intent.checkpoint.phase !== 'rolled-back') ||
      intent.checkpoint.sequence !== 1 ||
      intent.checkpoint.previousRecordDigest !== null ||
      intent.checkpoint.ownerRoot !== intent.ownerRoot ||
      (intent.phase === 'prepared' && (
        intent.retiredRecordsPhysical !== null ||
        intent.nextRecordsPhysical !== null ||
        intent.publishedRecordsRootPhysical !== null ||
        intent.retiredRecordsDisposed
      )) ||
      (intent.phase === 'staged' && (
        intent.retiredRecordsPhysical !== null ||
        intent.nextRecordsPhysical === null ||
        intent.publishedRecordsRootPhysical !== null ||
        intent.retiredRecordsDisposed
      )) ||
      (intent.phase === 'backed-up' && (
        intent.retiredRecordsPhysical === null ||
        intent.nextRecordsPhysical === null ||
        intent.publishedRecordsRootPhysical !== null ||
        intent.retiredRecordsDisposed
      )) ||
      ((intent.phase === 'published' || intent.phase === 'retiring') && (
        intent.retiredRecordsPhysical === null ||
        intent.nextRecordsPhysical !== null ||
        intent.publishedRecordsRootPhysical === null ||
        intent.retiredRecordsDisposed
      )) ||
      ((intent.phase === 'retired' || intent.phase === 'complete') && (
        intent.retiredRecordsPhysical !== null ||
        intent.nextRecordsPhysical !== null ||
        intent.publishedRecordsRootPhysical === null ||
        !intent.retiredRecordsDisposed
      )) ||
      rolloverIntentStableDigestV1(intent) !== intent.intentDigest) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover intent topology or digest is invalid');
  }
  if (expectedName !== undefined && expectedName !== rolloverIntentFileNameV1(intent.intentDigest, intent.phase)) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover intent filename does not match its digest');
  }
  if (formatJsonFile(canonicalJson(intent)) !== Buffer.from(bytes).toString('utf8')) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover intent bytes are not canonical');
  }
  return Object.freeze(intent);
}

function assertDependencyTransitionRolloverIntentBytes(bytes: Uint8Array): void {
  parseDependencyTransitionRolloverIntentV1(bytes);
}

function writeDurableTransitionFileV1(
  parent: PhysicalDirectoryIdentityV1,
  name: string,
  bytes: Uint8Array,
  validate: (candidate: Uint8Array) => void,
  immutable = false,
  expectedExisting?: Readonly<{ device: string; inode: string }> | null
): void {
  const existing = inspectNoFollowOrdinaryFileEntryV1(parent, name);
  if (immutable && existing !== null) {
    const current = readNoFollowOrdinaryFileV1(parent, name);
    if (current === null) {
      throw new CompilerError('RUNTIME-DEPS-002', 'Immutable dependency transition record disappeared before reuse');
    }
    validate(current);
    if (!Buffer.from(current).equals(Buffer.from(bytes))) {
      throw new CompilerError('RUNTIME-DEPS-002', 'Immutable dependency transition record collides with different canonical bytes', {
        path: path.join(parent.path, name)
      });
    }
    return;
  }
  if (expectedExisting !== undefined) {
    replaceDurableCanonicalFileV1({ parent, name, bytes, validate, expectedExisting });
    return;
  }
  if (existing === null) {
    publishExclusiveDurableCanonicalFileV1({ parent, name, bytes, validate });
  } else {
    replaceDurableCanonicalFileV1({ parent, name, bytes, validate });
  }
}

function transitionRecordName(digestValue: `sha256:${string}`): string {
  return `record-${digestValue.slice('sha256:'.length)}.json`;
}

async function ensureDependencyTransitionNamespaceV1(
  ownerRoot: string,
  options: RuntimeDependencyOperationOptionsV1
): Promise<DependencyTransitionNamespaceV1> {
  await runtimeDependencyOperationEffectFenceV1(options, 'Dependency transition namespace creation');
  const owner = inspectNoFollowDirectoryChainV1(ownerRoot, 'Dependency transition owner root').target;
  const paths = dependencyTransitionNamespacePaths(owner.path);
  // This is the only namespace creation route. Existing names are reopened
  // without following links, so a foreign/reparse path fails closed.
  const backupRoot = createNoFollowOrdinaryDirectoryChainV1(owner, [
    '.tmp', 'dependency-installs', 'compiler-backups'
  ]);
  const journalRoot = createNoFollowOrdinaryDirectoryChainV1(backupRoot, [
    '.dependency-transition-v1'
  ]);
  const recordsRoot = createNoFollowOrdinaryDirectoryChainV1(journalRoot, ['records']);
  const rolloversRoot = createNoFollowOrdinaryDirectoryChainV1(journalRoot, ['rollovers']);
  if (paths.backupRoot !== backupRoot.path || paths.journalRoot !== journalRoot.path ||
    paths.recordsRoot !== recordsRoot.path || paths.rolloversRoot !== rolloversRoot.path) {
    throw new CompilerError('RUNTIME-DEPS-002', 'Dependency transition namespace path normalization changed');
  }
  runtimeDependencyOperationRemainingMsV1(options, 'Dependency transition namespace creation readback');
  return Object.freeze({ ownerRoot: owner, backupRoot, journalRoot, recordsRoot, rolloversRoot });
}

function inspectDependencyTransitionNamespaceV1(
  ownerRoot: string
): DependencyTransitionNamespaceV1 | null {
  try {
    const owner = inspectNoFollowDirectoryChainV1(ownerRoot, 'Dependency transition owner root').target;
    const paths = dependencyTransitionNamespacePaths(owner.path);
    const backupRoot = inspectNoFollowDirectoryChainV1(paths.backupRoot, 'Dependency transition backup root').target;
    const journalRoot = inspectNoFollowDirectoryChainV1(paths.journalRoot, 'Dependency transition journal root').target;
    const recordsRoot = inspectNoFollowDirectoryChainV1(paths.recordsRoot, 'Dependency transition records root').target;
    let rolloversRoot: PhysicalDirectoryIdentityV1 | null;
    try {
      rolloversRoot = inspectNoFollowDirectoryChainV1(paths.rolloversRoot, 'Dependency transition rollovers root').target;
    } catch (error) {
      if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') {
        // Older journals predate bounded ledger rollover.  The writer creates
        // this optional owner-local namespace before its first rollover; a
        // read-only inspection must remain effect-free.
        rolloversRoot = null;
      } else {
        throw error;
      }
    }
    if (paths.backupRoot !== backupRoot.path || paths.journalRoot !== journalRoot.path ||
        paths.recordsRoot !== recordsRoot.path ||
        (rolloversRoot !== null && paths.rolloversRoot !== rolloversRoot.path)) {
      throw new CompilerError('RUNTIME-DEPS-002', 'Dependency transition namespace path normalization changed');
    }
    return Object.freeze({ ownerRoot: owner, backupRoot, journalRoot, recordsRoot, rolloversRoot });
  } catch (error) {
    if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') return null;
    throw error;
  }
}

type DependencyTransitionRolloverNamespaceV1 = Readonly<{
  ownerRoot: PhysicalDirectoryIdentityV1;
  journalRoot: PhysicalDirectoryIdentityV1;
  rolloversRoot: PhysicalDirectoryIdentityV1;
  recordsRootPath: string;
}>;

function inspectDependencyTransitionRolloverNamespaceV1(
  ownerRoot: string
): DependencyTransitionRolloverNamespaceV1 | null {
  try {
    const owner = inspectNoFollowDirectoryChainV1(ownerRoot, 'Dependency transition rollover owner root').target;
    const paths = dependencyTransitionNamespacePaths(owner.path);
    const backupRoot = inspectNoFollowDirectoryChainV1(
      paths.backupRoot,
      'Dependency transition rollover backup root'
    ).target;
    const journalRoot = inspectNoFollowDirectoryChainV1(
      paths.journalRoot,
      'Dependency transition rollover journal root'
    ).target;
    const rolloversRoot = inspectNoFollowDirectoryChainV1(
      paths.rolloversRoot,
      'Dependency transition rollover namespace'
    ).target;
    if (paths.backupRoot !== backupRoot.path || paths.journalRoot !== journalRoot.path ||
        paths.rolloversRoot !== rolloversRoot.path) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover namespace path normalization changed');
    }
    return Object.freeze({
      ownerRoot: owner,
      journalRoot,
      rolloversRoot,
      recordsRootPath: paths.recordsRoot
    });
  } catch (error) {
    if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') return null;
    throw error;
  }
}

async function readNoFollowDirectNamesV1(
  directory: PhysicalDirectoryIdentityV1,
  label: string,
  maximumEntries: number,
  options: RuntimeDependencyOperationOptionsV1
): Promise<readonly string[]> {
  runtimeDependencyOperationRemainingMsV1(options, `${label} admission`);
  const before = assertSameNoFollowDirectoryIdentityV1(directory, `${label} before read`).target;
  const names = await fs.readdir(before.path, 'utf8');
  runtimeDependencyOperationRemainingMsV1(options, `${label} readback`);
  if (names.length > maximumEntries) {
    throw new CompilerError('RUNTIME-DEPS-004', `${label} entry capacity exceeded`, {
      maximumEntries,
      observedEntries: names.length
    });
  }
  const after = assertSameNoFollowDirectoryIdentityV1(directory, `${label} after read`).target;
  if (!sameGeneratedStateIdentityV1(
    generatedStatePhysicalIdentityV1(before),
    generatedStatePhysicalIdentityV1(after)
  )) {
    throw new CompilerError('RUNTIME-DEPS-004', `${label} identity changed during direct read`);
  }
  return Object.freeze(names.sort(compareCodeUnits));
}

function dependencyTransitionLedgerDigestV1(
  records: ReadonlyMap<`sha256:${string}`, DependencyTransitionJournalV1>
): `sha256:${string}` {
  // Each immutable record digest already binds its canonical bytes.  The
  // ordered digest set therefore forms a compact, content-addressed ledger
  // receipt without rereading every record when a rollover phase advances.
  return generatedStateDigestV1(Object.freeze({
    schema: 'sec-dependency-transition-ledger-v1',
    recordDigests: Object.freeze([...records.keys()].sort(compareCodeUnits))
  }));
}

function inspectOptionalNoFollowDirectoryChildV1(
  parent: PhysicalDirectoryIdentityV1,
  name: string,
  label: string
): PhysicalDirectoryIdentityV1 | null {
  try {
    return inspectNoFollowDirectoryChildV1(parent, name, label);
  } catch (error) {
    if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') return null;
    throw error;
  }
}

function makeDependencyTransitionRolloverIntentV1(input: Readonly<{
  readonly namespace: DependencyTransitionNamespaceV1;
  readonly terminal: DependencyTransitionJournalV1;
  readonly previousIntentDigest: `sha256:${string}` | null;
  readonly sequence: number;
  readonly ledgerDigest: `sha256:${string}`;
  readonly recordCount: number;
  readonly checkpoint: DependencyTransitionJournalV1;
  readonly nextRecordsPhysical: Readonly<GeneratedStatePhysicalIdentityV1> | null;
}>): DependencyTransitionRolloverIntentV1 {
  if (input.namespace.rolloversRoot === null) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover namespace is unavailable');
  }
  const stem = rolloverResidueStemV1({
    previousIntentDigest: input.previousIntentDigest,
    sequence: input.sequence,
    ownerRoot: input.namespace.ownerRoot.path,
    terminalRecordDigest: input.terminal.recordDigest,
    ledgerDigest: input.ledgerDigest,
    recordCount: input.recordCount,
    checkpoint: input.checkpoint
  });
  const retiredRecordsPath = path.join(input.namespace.rolloversRoot.path, `records-retired-${stem}`);
  const nextRecordsPath = path.join(input.namespace.rolloversRoot.path, `records-next-${stem}`);
  const stableInput = Object.freeze({
    previousIntentDigest: input.previousIntentDigest,
    sequence: input.sequence,
    ownerRoot: input.namespace.ownerRoot.path,
    ownerRootPhysical: generatedStatePhysicalIdentityV1(input.namespace.ownerRoot),
    recordsRootPath: input.namespace.recordsRoot.path,
    sourceRecordsRootPhysical: generatedStatePhysicalIdentityV1(input.namespace.recordsRoot),
    retiredRecordsPath,
    nextRecordsPath,
    terminalRecordDigest: input.terminal.recordDigest,
    ledgerDigest: input.ledgerDigest,
    recordCount: input.recordCount,
    checkpoint: input.checkpoint
  });
  const intentDigest = rolloverIntentStableDigestV1(stableInput);
  return Object.freeze({
    schema: DEPENDENCY_TRANSITION_ROLLOVER_SCHEMA_V1,
    intentDigest,
    previousIntentDigest: stableInput.previousIntentDigest,
    sequence: stableInput.sequence,
    phase: 'prepared',
    ownerRoot: stableInput.ownerRoot,
    ownerRootPhysical: stableInput.ownerRootPhysical,
    recordsRootPath: stableInput.recordsRootPath,
    sourceRecordsRootPhysical: stableInput.sourceRecordsRootPhysical,
    retiredRecordsPath,
    retiredRecordsPhysical: null,
    retiredRecordsDisposed: false,
    nextRecordsPath,
    nextRecordsPhysical: input.nextRecordsPhysical,
    publishedRecordsRootPhysical: null,
    terminalRecordDigest: stableInput.terminalRecordDigest,
    ledgerDigest: input.ledgerDigest,
    recordCount: input.recordCount,
    checkpoint: input.checkpoint
  });
}

function advanceDependencyTransitionRolloverIntentV1(
  previous: DependencyTransitionRolloverIntentV1,
  phase: DependencyTransitionRolloverPhaseV1,
  patch: Readonly<Partial<Pick<DependencyTransitionRolloverIntentV1,
    'retiredRecordsPhysical' | 'retiredRecordsDisposed' | 'nextRecordsPhysical' |
    'publishedRecordsRootPhysical'>>>
): DependencyTransitionRolloverIntentV1 {
  const next = Object.freeze({ ...previous, phase, ...patch });
  if (rolloverIntentStableDigestV1(next) !== previous.intentDigest) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover identity changed between phases');
  }
  return next;
}

async function assertDependencyTransitionRolloverCheckpointV1(
  recordsRoot: PhysicalDirectoryIdentityV1,
  intent: DependencyTransitionRolloverIntentV1,
  options: RuntimeDependencyOperationOptionsV1
): Promise<void> {
  const expectedName = transitionRecordName(intent.checkpoint.recordDigest);
  const names = await readNoFollowDirectNamesV1(
    recordsRoot,
    'Dependency transition rollover checkpoint records',
    2,
    options
  );
  if (names.length !== 1 || names[0] !== expectedName) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover checkpoint directory contains unknown residue', {
      expectedName,
      names
    });
  }
  const entry = inspectNoFollowOrdinaryFileEntryV1(recordsRoot, expectedName);
  if (entry === null || entry.bytes === null) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover checkpoint disappeared');
  }
  const checkpoint = parseDependencyTransitionRecordV1(entry.bytes, expectedName);
  if (checkpoint.recordDigest !== intent.checkpoint.recordDigest ||
      !Buffer.from(entry.bytes).equals(dependencyTransitionRecordBytes(intent.checkpoint))) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover checkpoint bytes differ');
  }
}

function assertDependencyTransitionRolloverCheckpointDerivedV1(
  intent: DependencyTransitionRolloverIntentV1,
  terminal: DependencyTransitionJournalV1
): void {
  const expected = dependencyTransitionTerminalCheckpointV1(terminal, intent.ledgerDigest);
  if (!Buffer.from(dependencyTransitionRecordBytes(expected)).equals(
    dependencyTransitionRecordBytes(intent.checkpoint)
  )) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover checkpoint is not derived from its authenticated terminal ledger tip');
  }
}

function assertDependencyTransitionRolloverOwnerV1(
  namespace: DependencyTransitionRolloverNamespaceV1,
  intent: DependencyTransitionRolloverIntentV1
): void {
  if (intent.ownerRoot !== namespace.ownerRoot.path ||
      intent.recordsRootPath !== namespace.recordsRootPath ||
      !sameGeneratedStateIdentityV1(
        generatedStatePhysicalIdentityV1(namespace.ownerRoot),
        intent.ownerRootPhysical
      )) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover intent belongs to a foreign owner root');
  }
}

function assertDependencyTransitionRolloverDirectoryV1(
  actual: PhysicalDirectoryIdentityV1 | null,
  expected: Readonly<GeneratedStatePhysicalIdentityV1> | null,
  label: string
): PhysicalDirectoryIdentityV1 {
  if (actual === null || expected === null ||
      !sameGeneratedStateIdentityV1(generatedStatePhysicalIdentityV1(actual), expected)) {
    throw new CompilerError('RUNTIME-DEPS-004', `${label} is absent or has a foreign physical identity`, {
      expected,
      actual: actual === null ? null : generatedStatePhysicalIdentityV1(actual)
    });
  }
  return actual;
}

function assertDependencyTransitionTerminalRolloverReadyV1(
  terminal: DependencyTransitionJournalV1,
  namespace: DependencyTransitionNamespaceV1
): void {
  if (terminal.phase !== 'complete' && terminal.phase !== 'rolled-back') {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition ledger reached capacity before a terminal receipt');
  }
  if (terminal.stage !== null && terminal.stage.kind !== 'absent' ||
      terminal.stageRoot !== null && terminal.stageRoot.kind !== 'absent' ||
      terminal.backup !== null && terminal.backup.kind !== 'absent') {
    throw new CompilerError('RUNTIME-DEPS-004', 'Terminal dependency transition retains an unknown stage or backup residue');
  }
  if (terminal.destination.kind !== 'absent' && terminal.destination.physical === null) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Terminal dependency transition destination has no physical identity');
  }
  if (terminal.ownerRoot !== namespace.ownerRoot.path ||
      !sameGeneratedStateIdentityV1(terminal.ownerRootPhysical, generatedStatePhysicalIdentityV1(namespace.ownerRoot))) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Terminal dependency transition owner identity changed');
  }
}

type DependencyTransitionRolloverArchiveEntryV1 = Readonly<{
  readonly relativePath: string;
  readonly device: string;
  readonly inode: string;
  readonly recordDigest: `sha256:${string}`;
  readonly bytesDigest: `sha256:${string}`;
}>;

const DEPENDENCY_TRANSITION_ROLLOVER_DISPOSAL_INVENTORY_SCHEMA_V1 =
  'sec-dependency-transition-rollover-disposal-inventory-v1' as const;
const DEPENDENCY_TRANSITION_ROLLOVER_DISPOSAL_INVENTORY_KEYS_V1 = Object.freeze([
  'archivePhysical', 'entries', 'intentDigest', 'inventoryDigest', 'ledgerDigest',
  'recordCount', 'schema'
]);
const DEPENDENCY_TRANSITION_ROLLOVER_DISPOSAL_INVENTORY_ENTRY_KEYS_V1 = Object.freeze([
  'bytesDigest', 'device', 'inode', 'recordDigest', 'relativePath'
]);

interface DependencyTransitionRolloverDisposalInventoryV1 {
  readonly schema: typeof DEPENDENCY_TRANSITION_ROLLOVER_DISPOSAL_INVENTORY_SCHEMA_V1;
  readonly inventoryDigest: `sha256:${string}`;
  readonly intentDigest: `sha256:${string}`;
  readonly archivePhysical: Readonly<GeneratedStatePhysicalIdentityV1>;
  readonly ledgerDigest: `sha256:${string}`;
  readonly recordCount: number;
  readonly entries: readonly DependencyTransitionRolloverArchiveEntryV1[];
}

function rolloverDisposalInventoryNameV1(
  intent: DependencyTransitionRolloverIntentV1
): string {
  return `disposal-inventory-${intent.intentDigest.slice('sha256:'.length)}.json`;
}

function rolloverDisposalInventoryBytesDigestV1(bytes: Uint8Array): `sha256:${string}` {
  return generatedStateDigestV1(Object.freeze({
    encoding: 'base64',
    bytes: Buffer.from(bytes).toString('base64')
  }));
}

function rolloverDisposalInventoryStableDigestV1(
  inventory: Omit<DependencyTransitionRolloverDisposalInventoryV1, 'inventoryDigest'>
): `sha256:${string}` {
  return generatedStateDigestV1(Object.freeze({
    schema: inventory.schema,
    intentDigest: inventory.intentDigest,
    archivePhysical: inventory.archivePhysical,
    ledgerDigest: inventory.ledgerDigest,
    recordCount: inventory.recordCount,
    entries: inventory.entries
  }));
}

function parseDependencyTransitionRolloverDisposalInventoryV1(
  bytes: Uint8Array,
  expectedName: string,
  intent: DependencyTransitionRolloverIntentV1,
  archivePhysical: Readonly<GeneratedStatePhysicalIdentityV1>
): DependencyTransitionRolloverDisposalInventoryV1 {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch (error) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory is not JSON', {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  if (!hasExactObjectKeysV1(value, DEPENDENCY_TRANSITION_ROLLOVER_DISPOSAL_INVENTORY_KEYS_V1)) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory has noncanonical keys');
  }
  const inventory = value as unknown as DependencyTransitionRolloverDisposalInventoryV1;
  if (inventory.schema !== DEPENDENCY_TRANSITION_ROLLOVER_DISPOSAL_INVENTORY_SCHEMA_V1 ||
      !isSha256DigestV1(inventory.inventoryDigest) ||
      !isSha256DigestV1(inventory.intentDigest) ||
      !isCanonicalGeneratedStatePhysicalIdentityV1(inventory.archivePhysical) ||
      !isSha256DigestV1(inventory.ledgerDigest) ||
      !Number.isSafeInteger(inventory.recordCount) || inventory.recordCount < 1 ||
      inventory.recordCount > DEPENDENCY_TRANSITION_RECORD_CAPACITY_V1 ||
      !Array.isArray(inventory.entries) || inventory.entries.length !== inventory.recordCount ||
      inventory.entries.some((entry) => !hasExactObjectKeysV1(entry, DEPENDENCY_TRANSITION_ROLLOVER_DISPOSAL_INVENTORY_ENTRY_KEYS_V1) ||
        typeof entry.relativePath !== 'string' || !/^record-[0-9a-f]{64}\.json$/u.test(entry.relativePath) ||
        typeof entry.device !== 'string' || entry.device.length === 0 ||
        typeof entry.inode !== 'string' || entry.inode.length === 0 ||
        !isSha256DigestV1(entry.recordDigest) || !isSha256DigestV1(entry.bytesDigest))) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory fields are invalid');
  }
  const entries = [...inventory.entries].sort((left, right) => compareCodeUnits(left.relativePath, right.relativePath));
  if (entries.some((entry, index) => entry !== inventory.entries[index])) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory entries are not canonicalized');
  }
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index - 1]!.relativePath === entries[index]!.relativePath) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory contains duplicate record names');
    }
  }
  if (inventory.intentDigest !== intent.intentDigest ||
      !sameGeneratedStateIdentityV1(inventory.archivePhysical, archivePhysical) ||
      inventory.recordCount !== intent.recordCount || inventory.ledgerDigest !== intent.ledgerDigest ||
      rolloverDisposalInventoryStableDigestV1(inventory) !== inventory.inventoryDigest ||
      expectedName !== rolloverDisposalInventoryNameV1(intent) ||
      formatJsonFile(canonicalJson(inventory)) !== Buffer.from(bytes).toString('utf8')) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory binding is invalid');
  }
  return Object.freeze({ ...inventory, entries: Object.freeze(entries) });
}

async function inspectDependencyTransitionRolloverArchiveV1(
  archive: PhysicalDirectoryIdentityV1,
  intent: DependencyTransitionRolloverIntentV1,
  options: RuntimeDependencyOperationOptionsV1
): Promise<readonly DependencyTransitionRolloverArchiveEntryV1[]> {
  const names = await readNoFollowDirectNamesV1(
    archive,
    'Dependency transition retired records archive',
    intent.recordCount + 2,
    options
  );
  const records = new Map<`sha256:${string}`, DependencyTransitionJournalV1>();
  const entries: DependencyTransitionRolloverArchiveEntryV1[] = [];
  const inventoryName = rolloverDisposalInventoryNameV1(intent);
  let inventory: DependencyTransitionRolloverDisposalInventoryV1 | null = null;
  for (const name of names) {
    if (name === inventoryName) {
      const inventoryEntry = inspectNoFollowOrdinaryFileEntryV1(archive, name);
      if (inventoryEntry === null || inventoryEntry.bytes === null || inventoryEntry.kind !== 'file') {
        throw new CompilerError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory disappeared or is not an ordinary file');
      }
      if (inventory !== null) {
        throw new CompilerError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory is duplicated');
      }
      inventory = parseDependencyTransitionRolloverDisposalInventoryV1(
        inventoryEntry.bytes,
        name,
        intent,
        generatedStatePhysicalIdentityV1(archive)
      );
      continue;
    }
    if (!/^record-[0-9a-f]{64}\.json$/u.test(name)) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition retired records contain unknown residue', { name });
    }
    const entry = inspectNoFollowOrdinaryFileEntryV1(archive, name);
    if (entry === null || entry.bytes === null || entry.kind !== 'file') {
      throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition retired record disappeared or is not an ordinary file', { name });
    }
    const record = parseDependencyTransitionRecordV1(entry.bytes, name);
    if (records.has(record.recordDigest)) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition retired records contain a duplicate digest', { name });
    }
    records.set(record.recordDigest, record);
    entries.push(Object.freeze({
      relativePath: name,
      device: entry.device,
      inode: entry.inode,
      recordDigest: record.recordDigest,
      bytesDigest: rolloverDisposalInventoryBytesDigestV1(entry.bytes)
    }));
  }
  if (records.size !== intent.recordCount ||
      dependencyTransitionLedgerDigestV1(records) !== intent.ledgerDigest ||
      !records.has(intent.terminalRecordDigest)) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition retired records ledger digest differs and is preserved', {
      expectedLedgerDigest: intent.ledgerDigest,
      recordCount: intent.recordCount,
      observedRecordCount: records.size,
      terminalRecordDigest: intent.terminalRecordDigest
    });
  }
  if (inventory !== null && (
    inventory.entries.length !== entries.length ||
    inventory.entries.some((expected, index) => {
      const actual = entries.find((entry) => entry.relativePath === expected.relativePath);
      return actual === undefined || actual.device !== expected.device || actual.inode !== expected.inode ||
        actual.recordDigest !== expected.recordDigest || actual.bytesDigest !== expected.bytesDigest;
    })
  )) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory does not match its untouched archive');
  }
  return Object.freeze(entries.sort((left, right) => compareCodeUnits(left.relativePath, right.relativePath)));
}

async function ensureDependencyTransitionRolloverDisposalInventoryV1(
  archive: PhysicalDirectoryIdentityV1,
  intent: DependencyTransitionRolloverIntentV1,
  options: RuntimeDependencyOperationOptionsV1
): Promise<DependencyTransitionRolloverDisposalInventoryV1> {
  const inventoryName = rolloverDisposalInventoryNameV1(intent);
  const existing = inspectNoFollowOrdinaryFileEntryV1(archive, inventoryName);
  if (existing !== null) {
    if (existing.bytes === null || existing.kind !== 'file') {
      throw new CompilerError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory is foreign and preserved');
    }
    const inventory = parseDependencyTransitionRolloverDisposalInventoryV1(
      existing.bytes,
      inventoryName,
      intent,
      generatedStatePhysicalIdentityV1(archive)
    );
    // A crash may have removed any prefix of the inventoried records before
    // the disposal receipt advanced.  The immutable inventory is the
    // closed-world authority for that effect: validate only the exact
    // remaining subset, preserving missing entries as already-disposed
    // evidence.  Requiring the full archive here would make a crash after the
    // first leaf permanently unrecoverable.
    await assertDependencyTransitionRolloverArchiveSubsetV1(archive, inventory, inventoryName, options);
    return inventory;
  }
  const entries = await inspectDependencyTransitionRolloverArchiveV1(archive, intent, options);
  const inventoryUnsigned: Omit<DependencyTransitionRolloverDisposalInventoryV1, 'inventoryDigest'> = Object.freeze({
    schema: DEPENDENCY_TRANSITION_ROLLOVER_DISPOSAL_INVENTORY_SCHEMA_V1,
    intentDigest: intent.intentDigest,
    archivePhysical: generatedStatePhysicalIdentityV1(archive),
    ledgerDigest: intent.ledgerDigest,
    recordCount: intent.recordCount,
    entries
  });
  const inventory = Object.freeze({
    ...inventoryUnsigned,
    inventoryDigest: rolloverDisposalInventoryStableDigestV1(inventoryUnsigned)
  });
  const bytes = Buffer.from(formatJsonFile(canonicalJson(inventory)), 'utf8');
  await runtimeDependencyOperationEffectFenceV1(options, 'Dependency rollover disposal inventory publication');
  writeDurableTransitionFileV1(
    archive,
    inventoryName,
    bytes,
    (candidate) => parseDependencyTransitionRolloverDisposalInventoryV1(
      candidate,
      inventoryName,
      intent,
      generatedStatePhysicalIdentityV1(archive)
    ),
    true
  );
  const readback = inspectNoFollowOrdinaryFileEntryV1(archive, inventoryName);
  if (readback === null || readback.bytes === null) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory disappeared after publication');
  }
  return parseDependencyTransitionRolloverDisposalInventoryV1(
    readback.bytes,
    inventoryName,
    intent,
    generatedStatePhysicalIdentityV1(archive)
  );
}

async function assertDependencyTransitionRolloverArchiveSubsetV1(
  archive: PhysicalDirectoryIdentityV1,
  inventory: DependencyTransitionRolloverDisposalInventoryV1,
  inventoryName: string,
  options: RuntimeDependencyOperationOptionsV1
): Promise<void> {
  const names = await readNoFollowDirectNamesV1(
    archive,
    'Dependency transition retired records archive inventoried subset',
    inventory.recordCount + 1,
    options
  );
  const expectedByName = new Map(inventory.entries.map((entry) => [entry.relativePath, entry]));
  for (const name of names) {
    if (name === inventoryName) continue;
    const expected = expectedByName.get(name);
    if (expected === undefined) {
      throw new CompilerError(
        'RUNTIME-DEPS-004',
        'Dependency transition retired records contain foreign residue outside the disposal inventory',
        { name }
      );
    }
    const entry = inspectNoFollowOrdinaryFileEntryV1(archive, name);
    if (entry === null || entry.kind !== 'file' || entry.bytes === null ||
        entry.device !== expected.device || entry.inode !== expected.inode ||
        rolloverDisposalInventoryBytesDigestV1(entry.bytes) !== expected.bytesDigest) {
      throw new CompilerError(
        'RUNTIME-DEPS-004',
        'Dependency transition retired record changed after disposal inventory publication',
        { name }
      );
    }
    const record = parseDependencyTransitionRecordV1(entry.bytes, name);
    if (record.recordDigest !== expected.recordDigest) {
      throw new CompilerError(
        'RUNTIME-DEPS-004',
        'Dependency transition retired record digest differs from disposal inventory',
        { name }
      );
    }
  }
}

async function disposeDependencyTransitionRolloverArchiveV1(
  namespace: DependencyTransitionRolloverNamespaceV1,
  intent: DependencyTransitionRolloverIntentV1,
  options: RuntimeDependencyOperationOptionsV1
): Promise<void> {
  const archiveName = path.basename(intent.retiredRecordsPath);
  const archive = inspectOptionalNoFollowDirectoryChildV1(
    namespace.rolloversRoot,
    archiveName,
    'Dependency transition retired records archive'
  );
  if (archive === null) return;
  if (intent.retiredRecordsPhysical === null ||
      !sameGeneratedStateIdentityV1(generatedStatePhysicalIdentityV1(archive), intent.retiredRecordsPhysical)) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition retired records archive identity changed and is preserved');
  }
  const inventoryName = rolloverDisposalInventoryNameV1(intent);
  const inventoryEntry = inspectNoFollowOrdinaryFileEntryV1(archive, inventoryName);
  if (inventoryEntry === null || inventoryEntry.bytes === null || inventoryEntry.kind !== 'file') {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory is absent; archive is preserved');
  }
  const inventory = parseDependencyTransitionRolloverDisposalInventoryV1(
    inventoryEntry.bytes,
    inventoryName,
    intent,
    generatedStatePhysicalIdentityV1(archive)
  );
  const names = await readNoFollowDirectNamesV1(
    archive,
    'Dependency transition retired records archive disposal',
    intent.recordCount + 2,
    options
  );
  const expectedByName = new Map(inventory.entries.map((entry) => [entry.relativePath, entry]));
  for (const name of names) {
    if (name === inventoryName) continue;
    const expected = expectedByName.get(name);
    if (expected === undefined) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition retired records contain foreign residue during disposal', { name });
    }
    const entry = inspectNoFollowOrdinaryFileEntryV1(archive, name);
    if (entry === null || entry.bytes === null || entry.kind !== 'file' ||
        entry.device !== expected.device || entry.inode !== expected.inode ||
        rolloverDisposalInventoryBytesDigestV1(entry.bytes) !== expected.bytesDigest) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition retired record changed after disposal inventory publication', { name });
    }
    await runtimeDependencyOperationEffectFenceV1(options, 'Dependency transition retired record disposal');
    deleteRetainedNoFollowEntryV1({
      root: archive,
      relativePath: name,
      kind: 'file',
      device: expected.device,
      inode: expected.inode,
      ancestorDirectories: Object.freeze([])
    });
  }
  const remainingNames = await readNoFollowDirectNamesV1(
    archive,
    'Dependency transition retired records archive disposal readback',
    intent.recordCount + 2,
    options
  );
  if (remainingNames.length !== 1 || remainingNames[0] !== inventoryName) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition retired archive contains unexpected residue after record disposal', {
      remainingNames
    });
  }
  const inventoryAfter = inspectNoFollowOrdinaryFileEntryV1(archive, inventoryName);
  if (inventoryAfter === null || inventoryAfter.bytes === null || inventoryAfter.kind !== 'file' ||
      !Buffer.from(inventoryAfter.bytes).equals(Buffer.from(inventoryEntry.bytes))) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory changed before archive retirement');
  }
  await runtimeDependencyOperationEffectFenceV1(options, 'Dependency transition rollover inventory disposal');
  deleteRetainedNoFollowEntryV1({
    root: archive,
    relativePath: inventoryName,
    kind: 'file',
    device: inventoryEntry.device,
    inode: inventoryEntry.inode,
    ancestorDirectories: Object.freeze([])
  });
  const archiveAfter = inspectOptionalNoFollowDirectoryChildV1(
    namespace.rolloversRoot,
    archiveName,
    'Dependency transition retired records archive after descendant disposal'
  );
  if (archiveAfter === null || !sameGeneratedStateIdentityV1(
    generatedStatePhysicalIdentityV1(archiveAfter),
    intent.retiredRecordsPhysical
  )) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition retired records archive disappeared before root disposal');
  }
  await runtimeDependencyOperationEffectFenceV1(options, 'Dependency transition rollover archive disposal');
  deleteRetainedNoFollowEntryV1({
    root: namespace.rolloversRoot,
    relativePath: archiveName,
    kind: 'directory',
    device: intent.retiredRecordsPhysical.device,
    inode: intent.retiredRecordsPhysical.inode,
    ancestorDirectories: Object.freeze([])
  });
  if (inspectOptionalNoFollowDirectoryChildV1(
    namespace.rolloversRoot,
    archiveName,
    'Dependency transition retired records archive final readback'
  ) !== null) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition retired records archive remains after disposal');
  }
}

async function assertDependencyTransitionTerminalReadbackV1(
  terminal: DependencyTransitionJournalV1,
  options: RuntimeDependencyOperationOptionsV1
): Promise<void> {
  runtimeDependencyOperationRemainingMsV1(options, 'Dependency transition terminal readback admission');
  const destination = await observeDependencyTransitionSlotV1(
    terminal.destination.path,
    terminal.destination.bindingDigest
  );
  if (!transitionSlotMatchesV1(destination, terminal.destination)) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Terminal dependency transition destination or binding readback drifted');
  }
  const source = await observeDependencyTransitionSlotV1(terminal.sourceGeneration.sourcePath);
  if (source.kind !== 'directory' || source.physical === null ||
      !sameGeneratedStateIdentityV1(source.physical, terminal.sourceGeneration.physical)) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Terminal dependency transition source generation readback drifted');
  }
}

async function writeDependencyTransitionRolloverIntentPhaseV1(
  namespace: DependencyTransitionRolloverNamespaceV1,
  intent: DependencyTransitionRolloverIntentV1,
  options: RuntimeDependencyOperationOptionsV1
): Promise<void> {
  await runtimeDependencyOperationEffectFenceV1(options, `Dependency transition rollover ${intent.phase} receipt publication`);
  const bytes = Buffer.from(formatJsonFile(canonicalJson(intent)), 'utf8');
  writeDurableTransitionFileV1(
    namespace.rolloversRoot,
    rolloverIntentFileNameV1(intent.intentDigest, intent.phase),
    bytes,
    assertDependencyTransitionRolloverIntentBytes,
    true
  );
  runtimeDependencyOperationRemainingMsV1(options, `Dependency transition rollover ${intent.phase} receipt readback`);
}

type DependencyTransitionRolloverObservationV1 = Readonly<{
  namespace: DependencyTransitionRolloverNamespaceV1;
  active: DependencyTransitionRolloverIntentV1 | null;
  latestComplete: DependencyTransitionRolloverIntentV1 | null;
}>;

const DEPENDENCY_TRANSITION_ROLLOVER_PHASE_ORDER_V1: Readonly<Record<DependencyTransitionRolloverPhaseV1, number>> =
  Object.freeze({
    prepared: 0,
    staged: 1,
    'backed-up': 2,
    published: 3,
    retiring: 4,
    retired: 5,
    complete: 6
  });

async function inspectActiveDependencyTransitionRolloverV1(
  ownerRoot: string,
  options: RuntimeDependencyOperationOptionsV1
): Promise<DependencyTransitionRolloverObservationV1 | null> {
  runtimeDependencyOperationRemainingMsV1(options, 'Dependency transition rollover census admission');
  const namespace = inspectDependencyTransitionRolloverNamespaceV1(ownerRoot);
  if (namespace === null) return null;
  const names = await readNoFollowDirectNamesV1(
    namespace.rolloversRoot,
    'Dependency transition rollover namespace',
    DEPENDENCY_TRANSITION_ROLLOVER_NAMESPACE_CAPACITY_V1,
    options
  );
  const phasePattern = /^rollover-[0-9a-f]{64}-(prepared|staged|backed-up|published|retiring|retired|complete)\.json$/u;
  const residuePattern = /^records-(?:retired|next)-[0-9a-f]{48}$/u;
  const grouped = new Map<string, Map<DependencyTransitionRolloverPhaseV1, DependencyTransitionRolloverIntentV1>>();
  const referencedResidue = new Set<string>();
  for (const name of names) {
    if (residuePattern.test(name)) {
      referencedResidue.add(name);
      continue;
    }
    if (!phasePattern.test(name)) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover namespace contains unknown residue', {
        name
      });
    }
    const entry = inspectNoFollowOrdinaryFileEntryV1(namespace.rolloversRoot, name);
    if (entry === null || entry.bytes === null) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover intent disappeared during census', { name });
    }
    const intent = parseDependencyTransitionRolloverIntentV1(entry.bytes, name);
    if (intent.ownerRoot !== namespace.ownerRoot.path || intent.recordsRootPath !== namespace.recordsRootPath) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover intent belongs to a foreign topology', { name });
    }
    const phases = grouped.get(intent.intentDigest) ?? new Map<DependencyTransitionRolloverPhaseV1, DependencyTransitionRolloverIntentV1>();
    if (phases.has(intent.phase)) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover phase is duplicated', {
        intentDigest: intent.intentDigest,
        phase: intent.phase
      });
    }
    phases.set(intent.phase, intent);
    grouped.set(intent.intentDigest, phases);
  }

  let active: DependencyTransitionRolloverIntentV1 | null = null;
  const latestIntents: DependencyTransitionRolloverIntentV1[] = [];
  const referencedNames = new Set<string>();
  for (const phases of grouped.values()) {
    const ordered = [...phases.values()].sort((left, right) =>
      DEPENDENCY_TRANSITION_ROLLOVER_PHASE_ORDER_V1[left.phase] -
      DEPENDENCY_TRANSITION_ROLLOVER_PHASE_ORDER_V1[right.phase]
    );
    if (ordered[0]?.phase !== 'prepared') {
      throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover chain has no prepared phase');
    }
    for (let index = 0; index < ordered.length; index += 1) {
      if (DEPENDENCY_TRANSITION_ROLLOVER_PHASE_ORDER_V1[ordered[index]!.phase] !== index) {
        throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover chain skips a phase');
      }
      if (index > 0 && ordered[index]!.intentDigest !== ordered[index - 1]!.intentDigest) {
        throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover chain changed intent identity');
      }
    }
    const latest = ordered.at(-1)!;
    latestIntents.push(latest);
    if (!latest.retiredRecordsDisposed) {
      referencedNames.add(path.basename(latest.retiredRecordsPath));
    }
    if (latest.nextRecordsPhysical !== null) {
      referencedNames.add(path.basename(latest.nextRecordsPath));
    }
  }
  for (const name of referencedResidue) {
    if (!referencedNames.has(name)) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover residue is foreign and preserved', { name });
    }
  }
  if (latestIntents.length === 0) {
    return Object.freeze({ namespace, active: null, latestComplete: null });
  }
  const intentByDigest = new Map(latestIntents.map((intent) => [intent.intentDigest, intent]));
  const childByPredecessor = new Map<`sha256:${string}`, `sha256:${string}`>();
  const roots: DependencyTransitionRolloverIntentV1[] = [];
  for (const intent of latestIntents) {
    if (intent.previousIntentDigest === null) {
      if (intent.sequence !== 1) {
        throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover root sequence is not one');
      }
      roots.push(intent);
      continue;
    }
    const predecessor = intentByDigest.get(intent.previousIntentDigest);
    if (predecessor === undefined || predecessor.sequence !== intent.sequence - 1) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover predecessor is missing or has an invalid sequence');
    }
    const existingChild = childByPredecessor.get(intent.previousIntentDigest);
    if (existingChild !== undefined && existingChild !== intent.intentDigest) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover predecessor has a forked child');
    }
    childByPredecessor.set(intent.previousIntentDigest, intent.intentDigest);
  }
  if (roots.length !== 1) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover receipts contain multiple roots');
  }
  const visited = new Set<`sha256:${string}`>();
  let cursor: DependencyTransitionRolloverIntentV1 | undefined = roots[0];
  while (cursor !== undefined) {
    if (visited.has(cursor.intentDigest)) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover receipts contain a cycle');
    }
    visited.add(cursor.intentDigest);
    const childDigest = childByPredecessor.get(cursor.intentDigest);
    cursor = childDigest === undefined ? undefined : intentByDigest.get(childDigest);
    if (childDigest !== undefined && cursor === undefined) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover child disappeared during census');
    }
  }
  if (visited.size !== latestIntents.length) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover receipts contain a disconnected epoch');
  }
  const tips = latestIntents.filter((intent) => !childByPredecessor.has(intent.intentDigest));
  if (tips.length !== 1) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover receipts do not have one maximal tip');
  }
  const tip = tips[0]!;
  if (tip.phase !== 'complete') {
    active = tip;
  }
  for (const intent of latestIntents) {
    if (intent.phase !== 'complete' && intent.intentDigest !== tip.intentDigest) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Multiple incomplete dependency transition rollovers require owner recovery');
    }
  }
  const completeIntents = latestIntents.filter((intent) => intent.phase === 'complete');
  let latestComplete: DependencyTransitionRolloverIntentV1 | null = null;
  for (const intent of completeIntents) {
    if (latestComplete !== null && latestComplete.sequence === intent.sequence) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover complete receipts fork at one sequence');
    }
    if (latestComplete === null || intent.sequence > latestComplete.sequence) latestComplete = intent;
  }
  runtimeDependencyOperationRemainingMsV1(options, 'Dependency transition rollover census readback');
  return Object.freeze({ namespace, active, latestComplete });
}

async function recoverDependencyTransitionRolloverV1(
  ownerRoot: string,
  options: RuntimeDependencyOperationOptionsV1
): Promise<void> {
  runtimeDependencyOperationRemainingMsV1(options, 'Dependency transition rollover recovery admission');
  const observation = await inspectActiveDependencyTransitionRolloverV1(ownerRoot, options);
  if (observation === null || observation.active === null) return;
  const { namespace } = observation;
  let intent = observation.active;
  assertDependencyTransitionRolloverOwnerV1(namespace, intent);
  const journalRoot = assertSameNoFollowDirectoryIdentityV1(
    namespace.journalRoot,
    'Dependency transition rollover journal root recovery'
  ).target;
  const rolloversRoot = assertSameNoFollowDirectoryIdentityV1(
    namespace.rolloversRoot,
    'Dependency transition rollover namespace recovery'
  ).target;
  if (!sameGeneratedStateIdentityV1(
    generatedStatePhysicalIdentityV1(journalRoot),
    generatedStatePhysicalIdentityV1(namespace.journalRoot)
  ) || !sameGeneratedStateIdentityV1(
    generatedStatePhysicalIdentityV1(rolloversRoot),
    generatedStatePhysicalIdentityV1(namespace.rolloversRoot)
  )) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover namespace identity changed before recovery');
  }

  const retiredName = path.basename(intent.retiredRecordsPath);
  const nextName = path.basename(intent.nextRecordsPath);
  const sourceRecordsPhysical = intent.sourceRecordsRootPhysical;
  const expectedNextPhysical = intent.nextRecordsPhysical;

  // A prepared receipt is still before the source move.  Authenticate the
  // complete source ledger before creating any recovery residue; caller-supplied
  // fields in a forged self-digest intent must never become an archive or
  // checkpoint authority.
  if (intent.phase === 'prepared') {
    const source = inspectOptionalNoFollowDirectoryChildV1(
      journalRoot,
      path.basename(namespace.recordsRootPath),
      'Dependency transition rollover prepared source records'
    );
    const retainedSource = assertDependencyTransitionRolloverDirectoryV1(
      source,
      sourceRecordsPhysical,
      'Dependency transition rollover prepared source records'
    );
    const sourceLedger = readDependencyTransitionRecordSetV1(
      retainedSource,
      namespace.ownerRoot.path,
      runtimeDependencyOperationContextV1(options),
      'Dependency transition rollover prepared source ledger'
    );
    assertDependencyTransitionRolloverLedgerBindingV1(
      sourceLedger,
      intent,
      'Dependency transition rollover prepared source ledger'
    );
  }

  if (intent.phase === 'prepared') {
    let next = inspectOptionalNoFollowDirectoryChildV1(
      rolloversRoot,
      nextName,
      'Dependency transition rollover next records'
    );
    if (next !== null) {
      const names = await readNoFollowDirectNamesV1(
        next,
        'Dependency transition rollover next records pre-staged contents',
        2,
        options
      );
      const expectedCheckpointName = transitionRecordName(intent.checkpoint.recordDigest);
      if (names.length > 1 || names.length === 1 && names[0] !== expectedCheckpointName) {
        throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover next records contain unknown pre-staged residue');
      }
    }
    if (expectedNextPhysical !== null) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Prepared dependency transition rollover unexpectedly contains a next-root identity');
    }
    if (next === null) {
      await runtimeDependencyOperationEffectFenceV1(options, 'Dependency transition rollover recovery next-root creation');
    }
    const stagedNext = next ?? createExclusiveNoFollowDirectoryV1(rolloversRoot, nextName);
    const staged = advanceDependencyTransitionRolloverIntentV1(intent, 'staged', {
      retiredRecordsPhysical: null,
      retiredRecordsDisposed: false,
      nextRecordsPhysical: generatedStatePhysicalIdentityV1(stagedNext),
      publishedRecordsRootPhysical: null
    });
    await writeDependencyTransitionRolloverIntentPhaseV1(namespace, staged, options);
    intent = staged;
  }

  if (intent.phase === 'staged') {
    const next = assertDependencyTransitionRolloverDirectoryV1(
      inspectOptionalNoFollowDirectoryChildV1(
        rolloversRoot,
        nextName,
        'Dependency transition rollover next records'
      ),
      intent.nextRecordsPhysical,
      'Dependency transition rollover next records'
    );
    const checkpointName = transitionRecordName(intent.checkpoint.recordDigest);
    const checkpointEntry = inspectNoFollowOrdinaryFileEntryV1(next, checkpointName);
    if (checkpointEntry === null) {
      await runtimeDependencyOperationEffectFenceV1(options, 'Dependency transition rollover recovery checkpoint publication');
      writeDurableTransitionFileV1(
        next,
        checkpointName,
        dependencyTransitionRecordBytes(intent.checkpoint),
        assertDependencyTransitionRecordBytes,
        true
      );
    }
    await assertDependencyTransitionRolloverCheckpointV1(next, intent, options);
    // Re-read the source/archive immediately before the move.  If a previous
    // process already completed that effect, the operation-owned retired root
    // is the only acceptable evidence; a missing/foreign root is preserved.
    const sourceBeforeMove = inspectOptionalNoFollowDirectoryChildV1(
      journalRoot,
      path.basename(namespace.recordsRootPath),
      'Dependency transition rollover source records before archive move'
    );
    if (sourceBeforeMove !== null) {
      const retainedSourceBeforeMove = assertDependencyTransitionRolloverDirectoryV1(
        sourceBeforeMove,
        sourceRecordsPhysical,
        'Dependency transition rollover source records before archive move'
      );
      const sourceLedgerBeforeMove = readDependencyTransitionRecordSetV1(
        retainedSourceBeforeMove,
        namespace.ownerRoot.path,
        runtimeDependencyOperationContextV1(options),
        'Dependency transition rollover source ledger before archive move'
      );
      assertDependencyTransitionRolloverLedgerBindingV1(
        sourceLedgerBeforeMove,
        intent,
        'Dependency transition rollover source ledger before archive move'
      );
    }
    const retired = inspectOptionalNoFollowDirectoryChildV1(
      rolloversRoot,
      retiredName,
      'Dependency transition rollover retired records'
    );
    if (retired === null) {
      const source = sourceBeforeMove;
      const retainedSource = assertDependencyTransitionRolloverDirectoryV1(
        source,
        sourceRecordsPhysical,
        'Dependency transition rollover source records'
      );
      await runtimeDependencyOperationEffectFenceV1(options, 'Dependency transition rollover archive move');
      const moved = relocateRetainedNoFollowDirectoryAcrossParentsV1({
        directory: retainedSource,
        destinationParent: rolloversRoot,
        tombstoneName: retiredName
      });
      if (!sameGeneratedStateIdentityV1(generatedStatePhysicalIdentityV1(moved), sourceRecordsPhysical)) {
        throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover retired records identity changed during move');
      }
    } else if (!sameGeneratedStateIdentityV1(
      generatedStatePhysicalIdentityV1(retired),
      sourceRecordsPhysical
    )) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover retired records are foreign and preserved');
    }
    if (retired !== null) {
      const archivedLedger = readDependencyTransitionRecordSetV1(
        retired,
        namespace.ownerRoot.path,
        runtimeDependencyOperationContextV1(options),
        'Dependency transition rollover retired ledger'
      );
      assertDependencyTransitionRolloverLedgerBindingV1(
        archivedLedger,
        intent,
        'Dependency transition rollover retired ledger'
      );
    }
    const sourceAfter = inspectOptionalNoFollowDirectoryChildV1(
      journalRoot,
      path.basename(namespace.recordsRootPath),
      'Dependency transition rollover source records readback'
    );
    if (sourceAfter !== null) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover source records remain after archive move');
    }
    const retiredAfter = inspectOptionalNoFollowDirectoryChildV1(
      rolloversRoot,
      retiredName,
      'Dependency transition rollover retired records readback'
    );
    const nextAfter = inspectOptionalNoFollowDirectoryChildV1(
      rolloversRoot,
      nextName,
      'Dependency transition rollover next records readback'
    );
    const updated = advanceDependencyTransitionRolloverIntentV1(intent, 'backed-up', {
      retiredRecordsPhysical: retiredAfter === null
        ? null
        : generatedStatePhysicalIdentityV1(retiredAfter),
      retiredRecordsDisposed: false,
      nextRecordsPhysical: nextAfter === null
        ? null
        : generatedStatePhysicalIdentityV1(nextAfter),
      publishedRecordsRootPhysical: null
    });
    if (updated.retiredRecordsPhysical === null || updated.nextRecordsPhysical === null) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover archive readback is incomplete');
    }
    await writeDependencyTransitionRolloverIntentPhaseV1(namespace, updated, options);
    intent = updated;
  }

  if (intent.phase === 'backed-up') {
    const retired = inspectOptionalNoFollowDirectoryChildV1(
      rolloversRoot,
      retiredName,
      'Dependency transition rollover retired records'
    );
    assertDependencyTransitionRolloverDirectoryV1(
      retired,
      intent.retiredRecordsPhysical,
      'Dependency transition rollover retired records'
    );
    const next = inspectOptionalNoFollowDirectoryChildV1(
      rolloversRoot,
      nextName,
      'Dependency transition rollover next records'
    );
    const canonical = inspectOptionalNoFollowDirectoryChildV1(
      journalRoot,
      path.basename(namespace.recordsRootPath),
      'Dependency transition rollover canonical records'
    );
    let published: PhysicalDirectoryIdentityV1;
    if (canonical === null) {
      const retainedNext = assertDependencyTransitionRolloverDirectoryV1(
        next,
        intent.nextRecordsPhysical,
        'Dependency transition rollover next records'
      );
      await assertDependencyTransitionRolloverCheckpointV1(retainedNext, intent, options);
      await runtimeDependencyOperationEffectFenceV1(options, 'Dependency transition rollover canonical records publication');
      published = relocateRetainedNoFollowDirectoryAcrossParentsV1({
        directory: retainedNext,
        destinationParent: journalRoot,
        tombstoneName: path.basename(namespace.recordsRootPath)
      });
    } else {
      if (next !== null) {
        throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover has both next and canonical records roots');
      }
      published = assertDependencyTransitionRolloverDirectoryV1(
        canonical,
        intent.nextRecordsPhysical,
        'Dependency transition rollover canonical records'
      );
      await assertDependencyTransitionRolloverCheckpointV1(published, intent, options);
    }
    const canonicalAfter = inspectOptionalNoFollowDirectoryChildV1(
      journalRoot,
      path.basename(namespace.recordsRootPath),
      'Dependency transition rollover canonical records readback'
    );
    if (canonicalAfter === null || !sameGeneratedStateIdentityV1(
      generatedStatePhysicalIdentityV1(canonicalAfter),
      generatedStatePhysicalIdentityV1(published)
    )) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover canonical records identity changed during publish');
    }
    const nextAfter = inspectOptionalNoFollowDirectoryChildV1(
      rolloversRoot,
      nextName,
      'Dependency transition rollover next records readback'
    );
    if (nextAfter !== null) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover next records remain after publish');
    }
    const updated = advanceDependencyTransitionRolloverIntentV1(intent, 'published', {
      retiredRecordsPhysical: intent.retiredRecordsPhysical,
      retiredRecordsDisposed: false,
      nextRecordsPhysical: null,
      publishedRecordsRootPhysical: generatedStatePhysicalIdentityV1(canonicalAfter)
    });
    await writeDependencyTransitionRolloverIntentPhaseV1(namespace, updated, options);
    intent = updated;
  }

  if (intent.phase === 'published') {
    const retired = inspectOptionalNoFollowDirectoryChildV1(
      rolloversRoot,
      retiredName,
      'Dependency transition rollover retired records'
    );
    assertDependencyTransitionRolloverDirectoryV1(
      retired,
      intent.retiredRecordsPhysical,
      'Dependency transition rollover retired records'
    );
    const canonical = inspectOptionalNoFollowDirectoryChildV1(
      journalRoot,
      path.basename(namespace.recordsRootPath),
      'Dependency transition rollover canonical records'
    );
    const retainedCanonical = assertDependencyTransitionRolloverDirectoryV1(
      canonical,
      intent.publishedRecordsRootPhysical,
      'Dependency transition rollover canonical records'
    );
    await assertDependencyTransitionRolloverCheckpointV1(retainedCanonical, intent, options);
    if (inspectOptionalNoFollowDirectoryChildV1(
      rolloversRoot,
      nextName,
      'Dependency transition rollover next records final readback'
    ) !== null) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover next records unexpectedly reappeared');
    }
    // Publish/read back a closed-world disposal inventory before touching any
    // archived record.  It binds every expected name, canonical bytes digest,
    // and physical identity, so a crash after any individual delete can resume
    // from the exact remaining subset without broad recursive cleanup.
    await ensureDependencyTransitionRolloverDisposalInventoryV1(retired!, intent, options);
    const updated = advanceDependencyTransitionRolloverIntentV1(intent, 'retiring', {
      retiredRecordsPhysical: intent.retiredRecordsPhysical,
      retiredRecordsDisposed: false,
      nextRecordsPhysical: null,
      publishedRecordsRootPhysical: intent.publishedRecordsRootPhysical
    });
    await writeDependencyTransitionRolloverIntentPhaseV1(namespace, updated, options);
    intent = updated;
  }

  if (intent.phase === 'retiring') {
    const retired = inspectOptionalNoFollowDirectoryChildV1(
      rolloversRoot,
      retiredName,
      'Dependency transition retiring records archive'
    );
    if (retired !== null) {
      assertDependencyTransitionRolloverDirectoryV1(
        retired,
        intent.retiredRecordsPhysical,
        'Dependency transition retiring records archive'
      );
      await disposeDependencyTransitionRolloverArchiveV1(namespace, intent, options);
    }
    if (inspectOptionalNoFollowDirectoryChildV1(
      rolloversRoot,
      retiredName,
      'Dependency transition retired records archive readback'
    ) !== null) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition retired records archive remains after retiring effect');
    }
    const canonical = inspectOptionalNoFollowDirectoryChildV1(
      journalRoot,
      path.basename(namespace.recordsRootPath),
      'Dependency transition retired canonical records'
    );
    const published = assertDependencyTransitionRolloverDirectoryV1(
      canonical,
      intent.publishedRecordsRootPhysical,
      'Dependency transition retired canonical records'
    );
    await assertDependencyTransitionRolloverCheckpointV1(published, intent, options);
    const updated = advanceDependencyTransitionRolloverIntentV1(intent, 'retired', {
      retiredRecordsPhysical: null,
      retiredRecordsDisposed: true,
      nextRecordsPhysical: null,
      publishedRecordsRootPhysical: intent.publishedRecordsRootPhysical
    });
    await writeDependencyTransitionRolloverIntentPhaseV1(namespace, updated, options);
    intent = updated;
  }

  if (intent.phase === 'retired') {
    if (inspectOptionalNoFollowDirectoryChildV1(
      rolloversRoot,
      retiredName,
      'Dependency transition retired records final archive readback'
    ) !== null) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition retired records archive reappeared');
    }
    const canonical = inspectOptionalNoFollowDirectoryChildV1(
      journalRoot,
      path.basename(namespace.recordsRootPath),
      'Dependency transition completed canonical records'
    );
    const published = assertDependencyTransitionRolloverDirectoryV1(
      canonical,
      intent.publishedRecordsRootPhysical,
      'Dependency transition completed canonical records'
    );
    await assertDependencyTransitionRolloverCheckpointV1(published, intent, options);
    const updated = advanceDependencyTransitionRolloverIntentV1(intent, 'complete', {
      retiredRecordsPhysical: null,
      retiredRecordsDisposed: true,
      nextRecordsPhysical: null,
      publishedRecordsRootPhysical: intent.publishedRecordsRootPhysical
    });
    await writeDependencyTransitionRolloverIntentPhaseV1(namespace, updated, options);
  }
  runtimeDependencyOperationRemainingMsV1(options, 'Dependency transition rollover recovery readback');
}

type DependencyTransitionRecordSetV1 = Readonly<{
  readonly records: ReadonlyMap<`sha256:${string}`, DependencyTransitionJournalV1>;
  readonly ledgerDigest: `sha256:${string}`;
  readonly tip: DependencyTransitionJournalV1 | null;
}>;

/**
 * Read and validate one immutable records root under one fixed deadline.  This
 * helper is also used by rollover recovery while the old root is still the
 * source of truth; recovery must not call the normal reader because that
 * reader intentionally blocks whenever an active rollover exists.
 */
function readDependencyTransitionRecordSetV1(
  recordsRoot: PhysicalDirectoryIdentityV1,
  ownerRoot: string,
  operation: RuntimeDependencyOperationContextV1,
  label: string
): DependencyTransitionRecordSetV1 {
  const before = assertSameNoFollowDirectoryIdentityV1(recordsRoot, `${label} before census`).target;
  // Records are bounded canonical control bytes.  Keep one retained
  // no-follow traversal and parse the bytes it already read instead of doing
  // a second path lookup for every record.  The aggregate byte ceiling is
  // part of admission, so a forged large/unknown record cannot turn this
  // optimization into an unbounded read.
  const census = scanNoFollowDirectoryTreeV1(before, {
    deadlineAtMs: operation.deadlineAtMonotonicMs,
    maximumEntries: DEPENDENCY_TRANSITION_RECORD_CAPACITY_V1,
    maximumBytes: DEPENDENCY_TRANSITION_RECORD_BYTES_CAPACITY_V1
  });
  const records = new Map<`sha256:${string}`, DependencyTransitionJournalV1>();
  for (const entry of census) {
    if (operation.monotonicNowMs() > operation.deadlineAtMonotonicMs) {
      throw new CompilerError('RUNTIME-DEPS-004', `${label} exceeded its read deadline`, {
        deadlineAtMs: operation.deadlineAtMonotonicMs,
        observedEntries: records.size
      });
    }
    if (entry.kind !== 'file' || !/^record-[0-9a-f]{64}\.json$/u.test(entry.relativePath)) {
      throw new CompilerError('RUNTIME-DEPS-002', `${label} contains an unknown physical entry`);
    }
    if (entry.bytes === null) {
      throw new CompilerError('RUNTIME-DEPS-002', `${label} record disappeared during census`);
    }
    const record = parseDependencyTransitionRecordV1(entry.bytes, entry.relativePath);
    if (record.ownerRoot !== ownerRoot) {
      throw new CompilerError('RUNTIME-DEPS-002', `${label} record belongs to a foreign owner root`);
    }
    if (records.has(record.recordDigest)) {
      throw new CompilerError('RUNTIME-DEPS-002', `${label} record digest is duplicated`);
    }
    records.set(record.recordDigest, record);
  }
  if (operation.monotonicNowMs() > operation.deadlineAtMonotonicMs) {
    throw new CompilerError('RUNTIME-DEPS-004', `${label} exceeded its read deadline after record validation`, {
      deadlineAtMs: operation.deadlineAtMonotonicMs,
      observedEntries: records.size
    });
  }
  const after = assertSameNoFollowDirectoryIdentityV1(recordsRoot, `${label} after census`).target;
  if (!sameGeneratedStateIdentityV1(
    generatedStatePhysicalIdentityV1(before),
    generatedStatePhysicalIdentityV1(after)
  )) {
    throw new CompilerError('RUNTIME-DEPS-002', `${label} identity changed during census`);
  }
  if (records.size === 0) {
    return Object.freeze({
      records,
      ledgerDigest: dependencyTransitionLedgerDigestV1(records),
      tip: null
    });
  }

  // The immutable ledger is a single predecessor chain.  A mutable pointer
  // is never consulted to select either the root or the maximal tip.
  const children = new Map<`sha256:${string}`, `sha256:${string}`>();
  const roots: DependencyTransitionJournalV1[] = [];
  for (const record of records.values()) {
    if (operation.monotonicNowMs() > operation.deadlineAtMonotonicMs) {
      throw new CompilerError('RUNTIME-DEPS-004', `${label} exceeded its graph-validation deadline`, {
        deadlineAtMs: operation.deadlineAtMonotonicMs,
        observedEntries: records.size
      });
    }
    if (record.previousRecordDigest === null) {
      if (record.sequence !== 1) {
        throw new CompilerError('RUNTIME-DEPS-002', `${label} root record sequence is not one`);
      }
      roots.push(record);
      continue;
    }
    const predecessor = records.get(record.previousRecordDigest);
    if (predecessor === undefined || predecessor.sequence !== record.sequence - 1) {
      throw new CompilerError('RUNTIME-DEPS-002', `${label} predecessor is missing or has an invalid sequence`);
    }
    const previousChild = children.get(record.previousRecordDigest);
    if (previousChild !== undefined && previousChild !== record.recordDigest) {
      throw new CompilerError('RUNTIME-DEPS-002', `${label} predecessor has a forked child chain`);
    }
    children.set(record.previousRecordDigest, record.recordDigest);
  }
  if (roots.length !== 1) {
    throw new CompilerError('RUNTIME-DEPS-002', `${label} contains multiple immutable epochs`);
  }
  const visited = new Set<`sha256:${string}`>();
  let cursor: DependencyTransitionJournalV1 | undefined = roots[0];
  while (cursor !== undefined) {
    if (operation.monotonicNowMs() > operation.deadlineAtMonotonicMs) {
      throw new CompilerError('RUNTIME-DEPS-004', `${label} exceeded its chain-validation deadline`, {
        deadlineAtMs: operation.deadlineAtMonotonicMs,
        observedEntries: records.size
      });
    }
    if (visited.has(cursor.recordDigest)) {
      throw new CompilerError('RUNTIME-DEPS-002', `${label} chain contains a cycle`);
    }
    visited.add(cursor.recordDigest);
    const childDigest = children.get(cursor.recordDigest);
    cursor = childDigest === undefined ? undefined : records.get(childDigest);
    if (childDigest !== undefined && cursor === undefined) {
      throw new CompilerError('RUNTIME-DEPS-002', `${label} child disappeared during immutable census`);
    }
  }
  if (visited.size !== records.size) {
    throw new CompilerError('RUNTIME-DEPS-002', `${label} contains a disconnected or foreign fork`);
  }
  const tips = [...records.values()].filter(({ recordDigest }) => !children.has(recordDigest));
  if (tips.length !== 1) {
    throw new CompilerError('RUNTIME-DEPS-002', `${label} does not have one maximal immutable tip`);
  }
  if (operation.monotonicNowMs() > operation.deadlineAtMonotonicMs) {
    throw new CompilerError('RUNTIME-DEPS-004', `${label} exceeded its final read deadline`, {
      deadlineAtMs: operation.deadlineAtMonotonicMs,
      observedEntries: records.size
    });
  }
  return Object.freeze({
    records,
    ledgerDigest: dependencyTransitionLedgerDigestV1(records),
    tip: tips[0]!
  });
}

function assertDependencyTransitionRolloverLedgerBindingV1(
  observed: DependencyTransitionRecordSetV1,
  intent: DependencyTransitionRolloverIntentV1,
  label: string
): DependencyTransitionJournalV1 {
  if (observed.records.size !== intent.recordCount || observed.ledgerDigest !== intent.ledgerDigest ||
      observed.tip === null || observed.tip.recordDigest !== intent.terminalRecordDigest) {
    throw new CompilerError('RUNTIME-DEPS-004', `${label} does not match the rollover terminal ledger receipt`, {
      expectedLedgerDigest: intent.ledgerDigest,
      observedLedgerDigest: observed.ledgerDigest,
      expectedRecordCount: intent.recordCount,
      observedRecordCount: observed.records.size,
      expectedTerminalRecordDigest: intent.terminalRecordDigest,
      observedTerminalRecordDigest: observed.tip?.recordDigest ?? null
    });
  }
  const terminal = observed.records.get(intent.terminalRecordDigest);
  if (terminal === undefined || (terminal.phase !== 'complete' && terminal.phase !== 'rolled-back')) {
    throw new CompilerError('RUNTIME-DEPS-004', `${label} terminal record is missing or nonterminal`);
  }
  assertDependencyTransitionRolloverCheckpointDerivedV1(intent, terminal);
  return terminal;
}

async function readDependencyTransitionLedgerV1(
  ownerRoot: string,
  options: RuntimeDependencyOperationOptionsV1
): Promise<DependencyTransitionLedgerV1 | null> {
  runtimeDependencyOperationRemainingMsV1(options, 'Dependency transition ledger admission');
  // Read-only admission must not create `.tmp/dependency-installs` or a
  // journal namespace. The writer/recovery effect boundary is the only route
  // allowed to create those directories.
  const activeRollover = await inspectActiveDependencyTransitionRolloverV1(ownerRoot, options);
  if (activeRollover !== null && activeRollover.active !== null) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition ledger rollover requires owner recovery', {
      intentDigest: activeRollover.active.intentDigest,
      phase: activeRollover.active.phase,
      terminalRecordDigest: activeRollover.active.terminalRecordDigest
    });
  }
  const namespace = inspectDependencyTransitionNamespaceV1(ownerRoot);
  if (namespace === null) return null;
  const latestCompleteRollover = activeRollover?.latestComplete ?? null;
  if (latestCompleteRollover !== null && !sameGeneratedStateIdentityV1(
    generatedStatePhysicalIdentityV1(namespace.recordsRoot),
    latestCompleteRollover.publishedRecordsRootPhysical!
  )) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition records root is not the latest complete rollover publication');
  }
  const observed = readDependencyTransitionRecordSetV1(
    namespace.recordsRoot,
    namespace.ownerRoot.path,
    runtimeDependencyOperationContextV1(options),
    'Dependency transition records'
  );
  const { records, tip } = observed;
  if (records.size === 0 && latestCompleteRollover !== null) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Latest complete dependency transition rollover has no checkpoint in its published records root');
  }
  if (latestCompleteRollover !== null) {
    const checkpoint = records.get(latestCompleteRollover.checkpoint.recordDigest);
    if (checkpoint === undefined ||
        !Buffer.from(dependencyTransitionRecordBytes(checkpoint)).equals(
          dependencyTransitionRecordBytes(latestCompleteRollover.checkpoint)
        ) ||
        checkpoint.previousRecordDigest !== null || checkpoint.sequence !== 1) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Published dependency transition records root does not contain the latest complete rollover checkpoint');
    }
  }
  runtimeDependencyOperationRemainingMsV1(options, 'Dependency transition ledger readback');
  return Object.freeze({ namespace, records, ledgerDigest: observed.ledgerDigest, tip });
}

async function readDependencyTransitionV1(
  ownerRoot: string,
  options: RuntimeDependencyOperationOptionsV1
): Promise<DependencyTransitionJournalV1 | null> {
  return (await readDependencyTransitionLedgerV1(ownerRoot, options))?.tip ?? null;
}

function writeDependencyTransitionPointerCacheV1(
  namespace: DependencyTransitionNamespaceV1,
  recordDigest: `sha256:${string}`
): void {
  // `current.json` is intentionally not replaced.  It is a disposable
  // locator/cache and may have been written by an external process between
  // our immutable-record publication and this best-effort hint.  Replacing it
  // would turn a check-then-replace race into an apparent authority race.  The
  // immutable census remains the only source of the transition tip.
  const pointer = Object.freeze({
    schema: DEPENDENCY_TRANSITION_POINTER_SCHEMA_V1,
    recordDigest
  });
  const pointerBytes = Buffer.from(formatJsonFile(canonicalJson(pointer)), 'utf8');
  let existing: ReturnType<typeof inspectNoFollowOrdinaryFileEntryV1>;
  try {
    existing = inspectNoFollowOrdinaryFileEntryV1(namespace.journalRoot, 'current.json');
  } catch {
    // A foreign/reparse cache entry is preserved.  It cannot affect recovery.
    return;
  }
  if (existing === null) {
    try {
      publishExclusiveDurableCanonicalFileV1({
        parent: namespace.journalRoot,
        name: 'current.json',
        bytes: pointerBytes,
        validate: assertDependencyTransitionPointerBytes
      });
    } catch {
      // Another process may have won the cache publication.  Re-readers use
      // the immutable ledger and therefore do not need a pointer repair.
    }
    return;
  }
  if (existing.bytes !== null && Buffer.from(existing.bytes).equals(pointerBytes)) return;
  // Different, malformed, or stale bytes are unknown cache residue; leave it
  // untouched rather than overwriting an external writer.
}

async function rolloverDependencyTransitionLedgerV1(
  ownerRoot: string,
  ledger: DependencyTransitionLedgerV1,
  terminal: DependencyTransitionJournalV1,
  options: RuntimeDependencyOperationOptionsV1
): Promise<DependencyTransitionJournalV1> {
  runtimeDependencyOperationRemainingMsV1(options, 'Dependency transition rollover admission');
  assertDependencyTransitionTerminalRolloverReadyV1(terminal, ledger.namespace);
  if (ledger.tip?.recordDigest !== terminal.recordDigest ||
      ledger.records.size < DEPENDENCY_TRANSITION_ROLLOVER_TRIGGER_V1 ||
      ledger.records.size > DEPENDENCY_TRANSITION_RECORD_CAPACITY_V1 ||
      ledger.ledgerDigest !== dependencyTransitionLedgerDigestV1(ledger.records)) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition ledger rollover predecessor receipt is invalid');
  }
  // The new root is a receipt for the already authenticated terminal ledger,
  // never a caller-supplied prepared operation.  This derivation must happen
  // before the durable intent so a crash cannot turn arbitrary caller fields
  // into recovery authority.
  const checkpoint = dependencyTransitionTerminalCheckpointV1(
    terminal,
    ledger.ledgerDigest
  );
  await assertDependencyTransitionTerminalReadbackV1(terminal, options);
  for (const slot of [terminal.stage, terminal.stageRoot, terminal.backup]) {
    if (slot === null) continue;
    const current = await observeDependencyTransitionSlotV1(slot.path, slot.bindingDigest);
    if (!transitionSlotMatchesV1(current, slot)) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition terminal residue changed before ledger rollover');
    }
  }
  const namespace = await ensureDependencyTransitionNamespaceV1(ownerRoot, options);
  if (namespace.rolloversRoot === null ||
      !sameGeneratedStateIdentityV1(
        generatedStatePhysicalIdentityV1(namespace.ownerRoot),
        terminal.ownerRootPhysical
      ) ||
      !sameGeneratedStateIdentityV1(
        generatedStatePhysicalIdentityV1(namespace.recordsRoot),
        generatedStatePhysicalIdentityV1(ledger.namespace.recordsRoot)
      )) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition ledger namespace changed before rollover');
  }
  const priorRollover = await inspectActiveDependencyTransitionRolloverV1(ownerRoot, options);
  if (priorRollover?.active !== null) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover already has an active recovery intent');
  }
  const previousIntentDigest = priorRollover?.latestComplete?.intentDigest ?? null;
  const sequence = (priorRollover?.latestComplete?.sequence ?? 0) + 1;
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover sequence exhausted');
  }
  const stem = rolloverResidueStemV1({
    previousIntentDigest,
    sequence,
    ownerRoot: namespace.ownerRoot.path,
    terminalRecordDigest: terminal.recordDigest,
    ledgerDigest: ledger.ledgerDigest,
    recordCount: ledger.records.size,
    checkpoint
  });
  const nextName = `records-next-${stem}`;
  const retiredName = `records-retired-${stem}`;
  const existingNext = inspectOptionalNoFollowDirectoryChildV1(
    namespace.rolloversRoot,
    nextName,
    'Dependency transition rollover next records preflight'
  );
  const existingRetired = inspectOptionalNoFollowDirectoryChildV1(
    namespace.rolloversRoot,
    retiredName,
    'Dependency transition rollover retired records preflight'
  );
  if (existingNext !== null || existingRetired !== null) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition rollover residue is foreign or belongs to an unresolved prior operation', {
      nextName,
      retiredName
    });
  }
  const intent = makeDependencyTransitionRolloverIntentV1({
    namespace,
    terminal,
    previousIntentDigest,
    sequence,
    ledgerDigest: ledger.ledgerDigest,
    recordCount: ledger.records.size,
    checkpoint,
    nextRecordsPhysical: null
  });
  await writeDependencyTransitionRolloverIntentPhaseV1(
    Object.freeze({
      ownerRoot: namespace.ownerRoot,
      journalRoot: namespace.journalRoot,
      rolloversRoot: namespace.rolloversRoot,
      recordsRootPath: namespace.recordsRoot.path
    }),
    intent,
    options
  );
  // The prepared intent is the durable owner receipt before any new records
  // root exists.  Recovery can therefore finish a crash after namespace
  // creation without treating an unreferenced `records-next-*` directory as
  // a foreign cleanup candidate.
  await runtimeDependencyOperationEffectFenceV1(options, 'Dependency transition rollover next-root creation');
  const next = createExclusiveNoFollowDirectoryV1(namespace.rolloversRoot, nextName);
  const staged = advanceDependencyTransitionRolloverIntentV1(intent, 'staged', {
    retiredRecordsPhysical: null,
    retiredRecordsDisposed: false,
    nextRecordsPhysical: generatedStatePhysicalIdentityV1(next),
    publishedRecordsRootPhysical: null
  });
  await writeDependencyTransitionRolloverIntentPhaseV1(
    Object.freeze({
      ownerRoot: namespace.ownerRoot,
      journalRoot: namespace.journalRoot,
      rolloversRoot: namespace.rolloversRoot,
      recordsRootPath: namespace.recordsRoot.path
    }),
    staged,
    options
  );
  await runtimeDependencyOperationEffectFenceV1(options, 'Dependency transition rollover checkpoint publication');
  writeDurableTransitionFileV1(
    next,
    transitionRecordName(checkpoint.recordDigest),
    dependencyTransitionRecordBytes(checkpoint),
    assertDependencyTransitionRecordBytes,
    true
  );
  await assertDependencyTransitionRolloverCheckpointV1(next, staged, options);
  await recoverDependencyTransitionRolloverV1(ownerRoot, options);
  const after = await readDependencyTransitionLedgerV1(ownerRoot, options);
  if (after === null || after.tip === null || after.tip.recordDigest !== checkpoint.recordDigest) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition ledger rollover did not publish its checkpoint');
  }
  return after.tip;
}

async function writeDependencyTransitionV1(
  ownerRoot: string,
  unsigned: DependencyTransitionUnsignedV1,
  options: RuntimeDependencyOperationOptionsV1,
  expectedCurrentRecordDigest: `sha256:${string}` | null = null
): Promise<DependencyTransitionJournalV1> {
  const namespace = await ensureDependencyTransitionNamespaceV1(ownerRoot, options);
  const currentLedger = await readDependencyTransitionLedgerV1(ownerRoot, options);
  if (expectedCurrentRecordDigest === null) {
    // A new immutable epoch may only start from an empty ledger.  The
    // immutable census, rather than current.json, is the expected-current CAS
    // preimage for this root publication.
    if (currentLedger?.tip !== null && currentLedger?.tip !== undefined) {
      throw new CompilerError('RUNTIME-DEPS-002', 'Dependency transition immutable ledger already has a predecessor', {
        expectedCurrentRecordDigest,
        currentRecordDigest: currentLedger.tip.recordDigest,
        ownerRoot: namespace.ownerRoot.path
      });
    }
  } else {
    if (currentLedger?.tip === null || currentLedger === null ||
        currentLedger.tip.recordDigest !== expectedCurrentRecordDigest) {
      throw new CompilerError('RUNTIME-DEPS-002', 'Dependency transition expected-current record digest does not match the immutable ledger tip', {
        expectedCurrentRecordDigest,
        currentRecordDigest: currentLedger?.tip?.recordDigest ?? null,
        ownerRoot: namespace.ownerRoot.path
      });
    }
    if (currentLedger.records.size >= DEPENDENCY_TRANSITION_ROLLOVER_TRIGGER_V1) {
      if (unsigned.phase !== 'prepared') {
        throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition ledger is at rollover capacity during an active operation', {
          recordCount: currentLedger.records.size,
          capacity: DEPENDENCY_TRANSITION_RECORD_CAPACITY_V1
        });
      }
      const checkpoint = await rolloverDependencyTransitionLedgerV1(
        ownerRoot,
        currentLedger,
        currentLedger.tip,
        options
      );
      // Rollover publishes only the authenticated terminal checkpoint.  The
      // caller's operation is a normal child of that checkpoint and is
      // written only after the new root has been recovered/read back.
      const childUnsigned = Object.freeze({
        ...unsigned,
        previousRecordDigest: checkpoint.recordDigest,
        sequence: checkpoint.sequence + 1
      });
      return writeDependencyTransitionV1(
        ownerRoot,
        childUnsigned,
        options,
        checkpoint.recordDigest
      );
    }
    // The full ledger census above is the expected-current CAS.  Re-parse the
    // digest-named predecessor at the write boundary as a cheap byte-level
    // guard against an external replacement after that census.
    const predecessorName = transitionRecordName(expectedCurrentRecordDigest);
    const predecessorEntry = inspectNoFollowOrdinaryFileEntryV1(namespace.recordsRoot, predecessorName);
    if (predecessorEntry === null || predecessorEntry.bytes === null) {
      throw new CompilerError('RUNTIME-DEPS-002', 'Dependency transition expected immutable predecessor is missing', {
        expectedCurrentRecordDigest,
        ownerRoot: namespace.ownerRoot.path
      });
    }
    const predecessor = parseDependencyTransitionRecordV1(predecessorEntry.bytes, predecessorName);
    if (predecessor.recordDigest !== expectedCurrentRecordDigest ||
        currentLedger.records.get(expectedCurrentRecordDigest)?.recordDigest !== predecessor.recordDigest) {
      throw new CompilerError('RUNTIME-DEPS-002', 'Dependency transition expected immutable predecessor digest changed', {
        expectedCurrentRecordDigest,
        currentRecordDigest: predecessor.recordDigest,
        ownerRoot: namespace.ownerRoot.path
      });
    }
  }
  const recordDigest = dependencyTransitionDigestWithoutRecord(unsigned);
  const record = Object.freeze({ ...unsigned, recordDigest }) as DependencyTransitionJournalV1;
  const recordBytes = dependencyTransitionRecordBytes(record);
  await runtimeDependencyOperationEffectFenceV1(options, 'Dependency transition immutable record publication');
  writeDurableTransitionFileV1(
    namespace.recordsRoot,
    transitionRecordName(recordDigest),
    recordBytes,
    assertDependencyTransitionRecordBytes,
    true
  );
  // The expected predecessor was derived from a complete immutable census
  // immediately before this exclusive record publication.  Cooperative
  // writers are serialized by the compiler-root lease; a non-cooperative
  // writer can only add a forked immutable record, which the next admission
  // census rejects before any transition effect.  Do not recensus the whole
  // ledger after every record: that would turn one operation into a repeated
  // full-root fence on the Windows path.  The pointer update below is only a
  // non-authoritative cache hint.
  runtimeDependencyOperationRemainingMsV1(options, 'Dependency transition immutable record readback');
  writeDependencyTransitionPointerCacheV1(namespace, recordDigest);
  return record;
}

function transitionSlotFromPhysicalV1(input: Readonly<{
  path: string;
  kind: 'directory' | 'link';
  physical: Readonly<GeneratedStatePhysicalIdentityV1>;
  linkTarget?: string | null;
  bindingDigest?: `sha256:${string}` | null;
}>): DependencyTransitionSlotV1 {
  return Object.freeze({
    path: path.resolve(input.path),
    kind: input.kind,
    physical: input.physical,
    linkTarget: input.linkTarget ?? null,
    bindingDigest: input.bindingDigest ?? null
  });
}

function transitionAbsentSlotV1(pathValue: string): DependencyTransitionSlotV1 {
  return Object.freeze({
    path: path.resolve(pathValue),
    kind: 'absent' as const,
    physical: null,
    linkTarget: null,
    bindingDigest: null
  });
}

async function observeDependencyTransitionSlotV1(
  targetPath: string,
  expectedBindingDigest?: `sha256:${string}` | null
): Promise<DependencyTransitionSlotV1> {
  const absolute = path.resolve(targetPath);
  try {
    const parent = inspectNoFollowDirectoryChainV1(
      path.dirname(absolute),
      'Dependency transition slot parent'
    ).target;
    const name = path.basename(absolute);
    let link: ReturnType<typeof inspectNoFollowLinkEntryV1>;
    try {
      link = inspectNoFollowLinkEntryV1(parent, name);
    } catch (error) {
      if (error instanceof PhysicalNoFollowError &&
        (error.code === 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED' ||
          error.code === 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH')) {
        link = null;
      } else {
        throw error;
      }
    }
    if (link !== null) {
      if (link.kind !== 'link' || link.linkTarget === null) {
        throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition slot is an invalid link');
      }
      return transitionSlotFromPhysicalV1({
        path: absolute,
        kind: 'link',
        physical: Object.freeze({
          device: link.device,
          inode: link.inode,
          objectId: generatedStateDigestV1({ kind: 'link', target: link.linkTarget })
        }),
        linkTarget: link.linkTarget,
        bindingDigest: expectedBindingDigest ?? null
      });
    }
    const directory = inspectExactNoFollowDirectoryPresenceV1(
      absolute,
      'Dependency transition slot'
    );
    if (directory.state === 'absent') return transitionAbsentSlotV1(absolute);
    return transitionSlotFromPhysicalV1({
      path: absolute,
      kind: 'directory',
      physical: generatedStatePhysicalIdentityV1(directory.directory.target),
      bindingDigest: expectedBindingDigest ?? null
    });
  } catch (error) {
    if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') {
      return transitionAbsentSlotV1(absolute);
    }
    throw error;
  }
}

function transitionSlotMatchesV1(
  actual: DependencyTransitionSlotV1,
  expected: DependencyTransitionSlotV1
): boolean {
  if (actual.kind !== expected.kind || path.resolve(actual.path) !== path.resolve(expected.path)) return false;
  if (actual.kind === 'absent') return true;
  return expected.physical !== null && actual.physical !== null &&
    sameGeneratedStateIdentityV1(actual.physical, expected.physical) &&
    (expected.kind !== 'link' || actual.linkTarget === expected.linkTarget);
}

function sourceGenerationWithPathV1(
  source: RuntimeDependencySourceGenerationV1,
  sourcePath: string
): RuntimeDependencySourceGenerationV1 {
  return Object.freeze({ ...source, sourcePath: path.resolve(sourcePath) });
}

function transitionFailureV1(error: unknown): Readonly<{ code: string; message: string }> {
  return Object.freeze({
    code: error instanceof CompilerError ? error.code :
      error instanceof PhysicalNoFollowError ? error.code :
        (error as NodeJS.ErrnoException).code ?? 'UNKNOWN',
    message: error instanceof Error ? error.message : String(error)
  });
}

function transitionOperationKeyV1(input: Readonly<{
  kind: DependencyTransitionKindV1;
  ownerRoot: string;
  destinationPath: string;
  preimage: DependencyTransitionSlotV1;
  stage: DependencyTransitionSlotV1 | null;
  stageRoot: DependencyTransitionSlotV1 | null;
  backup: DependencyTransitionSlotV1 | null;
  sourceGeneration: RuntimeDependencySourceGenerationV1;
}>): `sha256:${string}` {
  // `sourcePath` may change from an operation-created staging child to the
  // active compiler destination after a successful rename.  Bind the
  // operation to the immutable source physical/content observation, not that
  // mutable path spelling, so recovery can audit the stage-to-active receipt.
  const sourceGeneration = Object.freeze({
    schema: input.sourceGeneration.schema,
    ownerRoot: input.sourceGeneration.ownerRoot,
    ownerRootPhysical: input.sourceGeneration.ownerRootPhysical,
    physical: input.sourceGeneration.physical,
    bindingDigest: input.sourceGeneration.bindingDigest,
    treeDigest: input.sourceGeneration.treeDigest,
    treeEntryCount: input.sourceGeneration.treeEntryCount,
    epoch: input.sourceGeneration.epoch
  });
  // Journal records are persisted as recursively canonical JSON.  Hash the
  // same canonical projection here: otherwise a valid record re-read after
  // JSON parsing has alphabetized nested slot keys and no longer reproduces
  // the in-memory insertion-order hash created at begin time.
  return generatedStateDigestV1(canonicalJson(Object.freeze({
    schema: 'sec-dependency-transition-operation-v1',
    kind: input.kind,
    ownerRoot: path.resolve(input.ownerRoot),
    destinationPath: path.resolve(input.destinationPath),
    preimage: input.preimage,
    stagePath: input.stage?.path ?? null,
    stageRootPath: input.stageRoot?.path ?? null,
    backupPath: input.backup?.path ?? null,
    sourceGeneration
  })));
}

async function beginDependencyTransitionV1(input: Readonly<{
  kind: DependencyTransitionKindV1;
  ownerRoot: string;
  destinationPath: string;
  stagePath: string | null;
  stageRootPath?: string | null;
  backupPath: string | null;
  sourceGeneration: RuntimeDependencySourceGenerationV1;
  bindingDigest: `sha256:${string}` | null;
  options: RuntimeDependencyOperationOptionsV1;
}>): Promise<DependencyTransitionJournalV1> {
  runtimeDependencyOperationRemainingMsV1(input.options, 'Dependency transition begin admission');
  const ownerRoot = inspectNoFollowDirectoryChainV1(
    input.ownerRoot,
    'Dependency transition owner root'
  ).target;
  const destination = await observeDependencyTransitionSlotV1(input.destinationPath, input.bindingDigest);
  const preimage = destination;
  const stage = input.stagePath === null
    ? null
    : await observeDependencyTransitionSlotV1(input.stagePath, input.bindingDigest);
  const stageRoot = input.stageRootPath === undefined || input.stageRootPath === null
    ? null
    : await observeDependencyTransitionSlotV1(input.stageRootPath, input.bindingDigest);
  const backup = input.backupPath === null
    ? null
    : await observeDependencyTransitionSlotV1(input.backupPath, input.bindingDigest);
  if (input.backupPath !== null) {
    const expectedBackupPath = input.kind === 'compiler-generation'
      ? compilerTransitionBackupPathV1(ownerRoot.path, 'node_modules', input.sourceGeneration)
      : input.kind === 'compiler-locator'
        ? compilerTransitionBackupPathV1(ownerRoot.path, 'locator-preimage', input.sourceGeneration)
        : input.kind === 'runtime-projection'
          ? compilerTransitionBackupPathV1(ownerRoot.path, 'runtime', input.sourceGeneration)
          : input.stageRootPath === null || input.stageRootPath === undefined
            ? null
            : projectTransitionBackupPathV1(
              ownerRoot.path,
              path.dirname(path.dirname(path.resolve(input.stageRootPath))),
              preimage,
              input.sourceGeneration
            );
    if (expectedBackupPath === null || path.resolve(input.backupPath) !== path.resolve(expectedBackupPath)) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition backup path is not derived from canonical operation inputs');
    }
  }
  if (backup !== null && backup.kind !== 'absent') {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition backup path is occupied by a foreign identity and is preserved', {
      backupPath: backup.path,
      backupKind: backup.kind
    });
  }
  if (stage !== null && stage.kind === 'absent') {
    throw new CompilerError('RUNTIME-DEPS-002', 'Dependency transition stage disappeared before durable intent');
  }
  if (stageRoot !== null && stageRoot.kind === 'absent') {
    throw new CompilerError('RUNTIME-DEPS-002', 'Dependency transition staging root disappeared before durable intent');
  }
  if (stage !== null && stageRoot !== null && stage.kind !== 'absent' && stageRoot.kind !== 'absent') {
    const relativeStage = path.relative(stageRoot.path, stage.path);
    if (relativeStage.startsWith('..') || path.isAbsolute(relativeStage) || relativeStage.length === 0) {
      throw new CompilerError('RUNTIME-DEPS-002', 'Dependency transition stage is not contained by its recorded staging root');
    }
  }
  const current = await readDependencyTransitionV1(ownerRoot.path, input.options);
  if (current !== null && current.phase !== 'complete' && current.phase !== 'rolled-back') {
    throw new CompilerError('RUNTIME-DEPS-002', 'Dependency transition already has an active owner-local operation', {
      currentRecordDigest: current.recordDigest,
      currentPhase: current.phase,
      ownerRoot: ownerRoot.path
    });
  }
  const operationKey = transitionOperationKeyV1({
    kind: input.kind,
    ownerRoot: ownerRoot.path,
    destinationPath: input.destinationPath,
    preimage,
    stage,
    stageRoot,
    backup,
    sourceGeneration: input.sourceGeneration
  });
  return writeDependencyTransitionV1(ownerRoot.path, {
    schema: DEPENDENCY_TRANSITION_SCHEMA_V1,
    previousRecordDigest: current?.recordDigest ?? null,
    sequence: (current?.sequence ?? 0) + 1,
    operationKey,
    attemptNonce: crypto.randomUUID(),
    kind: input.kind,
    ownerRoot: ownerRoot.path,
    ownerRootPhysical: generatedStatePhysicalIdentityV1(ownerRoot),
    destination,
    preimage,
    stage,
    stageRoot,
    backup,
    sourceGeneration: input.sourceGeneration,
    phase: 'prepared',
    durability: 'known',
    failure: null
  }, input.options, current?.recordDigest ?? null);
}

async function advanceDependencyTransitionV1(
  previous: DependencyTransitionJournalV1,
  patch: Readonly<Partial<Pick<DependencyTransitionJournalV1, 'destination' | 'stage' | 'stageRoot' | 'backup' | 'sourceGeneration' | 'phase' | 'durability' | 'failure'>>>,
  options: RuntimeDependencyOperationOptionsV1
): Promise<DependencyTransitionJournalV1> {
  // A malformed or foreign predecessor must never be allowed to publish a
  // successor and thereby postpone the topology failure until recovery.
  assertTransitionOperationKeyV1(previous);
  const { recordDigest: _recordDigest, ...withoutDigest } = previous;
  const successor = Object.freeze({
    ...withoutDigest,
    previousRecordDigest: previous.recordDigest,
    sequence: previous.sequence + 1,
    ...patch
  });
  const successorOperationKey = transitionOperationKeyV1({
    kind: successor.kind,
    ownerRoot: successor.ownerRoot,
    destinationPath: successor.destination.path,
    preimage: successor.preimage,
    stage: successor.stage,
    stageRoot: successor.stageRoot,
    backup: successor.backup,
    sourceGeneration: successor.sourceGeneration
  });
  if (successorOperationKey !== previous.operationKey) {
    throw new CompilerError(
      'RUNTIME-DEPS-004',
      'Dependency transition successor changes the immutable operation topology',
      {
        expectedOperationKey: previous.operationKey,
        successorOperationKey,
        previousRecordDigest: previous.recordDigest,
        previousSequence: previous.sequence,
        nextSequence: successor.sequence,
        kind: successor.kind,
        previousPhase: previous.phase,
        nextPhase: successor.phase
      }
    );
  }
  return writeDependencyTransitionV1(previous.ownerRoot, successor, options, previous.recordDigest);
}

async function markDependencyTransitionFailureV1(
  record: DependencyTransitionJournalV1,
  error: unknown,
  options: RuntimeDependencyOperationOptionsV1,
  phase: DependencyTransitionPhaseV1 = 'recovery-required'
): Promise<DependencyTransitionJournalV1> {
  return advanceDependencyTransitionV1(record, {
    phase,
    durability: 'unknown',
    failure: transitionFailureV1(error)
  }, options);
}

type DependencyTransitionStageAuthorityV1 = Readonly<{
  /** Canonical parent under which the operation may create its stage root. */
  parent: string;
  /** Registered operation selector for the direct stage-root child. */
  prefix: string;
  /** Closed-world direct children emitted by this staging operation. */
  allowedDirectChildren: readonly string[];
  /** Compiler staging roots have a required-at-birth generated-state receipt. */
  lifecycle?: Readonly<{
    owner: string;
    producer: string;
    ruleId: string;
  }>;
}>;

function compilerDependencyStageAuthorityV1(root: string): DependencyTransitionStageAuthorityV1 {
  return Object.freeze({
    parent: path.join(path.resolve(root), '.tmp', 'dependency-installs'),
    prefix: 'c.staging-',
    allowedDirectChildren: Object.freeze(['bun.lock', 'bunfig.toml', 'node_modules', 'package.json']),
    lifecycle: Object.freeze({
      owner: COMPILER_STAGING_LIFECYCLE_OWNER_V1,
      producer: COMPILER_STAGING_LIFECYCLE_PRODUCER_V1,
      ruleId: COMPILER_STAGING_LIFECYCLE_RULE_V1
    })
  });
}

function runtimeDependencyStageAuthorityV1(sharedDepsRoot: string): DependencyTransitionStageAuthorityV1 {
  return Object.freeze({
    parent: path.resolve(sharedDepsRoot),
    prefix: '.runtime-generation-',
    allowedDirectChildren: Object.freeze(['node_modules'])
  });
}

function projectDependencyStageAuthorityV1(projectRoot: string): DependencyTransitionStageAuthorityV1 {
  return Object.freeze({
    parent: path.join(path.resolve(projectRoot), '.tmp'),
    prefix: 'project.staging-',
    allowedDirectChildren: Object.freeze(['node_modules'])
  });
}

async function disposeDependencyTransitionStageV1(
  root: string,
  stageRootPath: string,
  options: RuntimeDependencyOperationOptionsV1,
  outcome: string,
  expectedStage: DependencyTransitionSlotV1 | null,
  expectedStageRoot: DependencyTransitionSlotV1 | null,
  authority: DependencyTransitionStageAuthorityV1
): Promise<void> {
  runtimeDependencyOperationRemainingMsV1(options, 'Dependency transition stage disposal admission');
  if (expectedStageRoot === null || expectedStageRoot.kind !== 'directory' ||
      expectedStageRoot.physical === null || path.resolve(expectedStageRoot.path) !== path.resolve(stageRootPath)) {
    throw new CompilerError(
      'RUNTIME-DEPS-004',
      'Dependency transition staging root has no operation-owned physical identity; residue is preserved',
      { stageRootPath, expectedStageRoot }
    );
  }
  const stageRootParent = path.resolve(authority.parent);
  const normalizedStageRootPath = path.resolve(stageRootPath);
  if (path.dirname(normalizedStageRootPath) !== stageRootParent ||
      !path.basename(normalizedStageRootPath).startsWith(authority.prefix)) {
    throw new CompilerError(
      'RUNTIME-DEPS-004',
      'Dependency transition staging root is outside its registered operation selector; residue is preserved',
      { stageRootPath, stageRootParent, prefix: authority.prefix }
    );
  }
  const stageRoot = await observeDependencyTransitionSlotV1(stageRootPath);
  if (stageRoot.kind === 'absent') return;
  if (!transitionSlotMatchesV1(stageRoot, expectedStageRoot)) {
    throw new CompilerError(
      'RUNTIME-DEPS-004',
      'Dependency transition staging root identity changed; residue is preserved',
      { stageRootPath, expectedStageRoot, observedStageRoot: stageRoot }
    );
  }
  const stagePath = expectedStage?.path ?? null;
  if (stagePath !== null && (
      path.dirname(path.resolve(stagePath)) !== path.resolve(stageRootPath) ||
      path.basename(path.resolve(stagePath)) !== 'node_modules')) {
    throw new CompilerError(
      'RUNTIME-DEPS-004',
      'Dependency transition stage is not the recorded child of its staging root; residue is preserved',
      { stagePath, stageRootPath }
    );
  }
  const stage = stagePath === null ? null : await observeDependencyTransitionSlotV1(stagePath);
  if (expectedStage !== null) {
    if (!transitionSlotMatchesV1(stage!, expectedStage)) {
      throw new CompilerError(
        'RUNTIME-DEPS-004',
        'Dependency transition stage identity changed; residue is preserved',
        { stagePath, expectedStage, observedStage: stage }
      );
    }
  } else if (stage !== null && stage.kind !== 'absent') {
    throw new CompilerError(
      'RUNTIME-DEPS-004',
      'Dependency transition staging root contains an unrecorded child; residue is preserved',
      { stageRootPath, observedStage: stage }
    );
  }
  if (expectedStage === null) {
    const unrecorded = scanNoFollowDirectoryTreeMetadataV1(
      inspectNoFollowDirectoryChainV1(stageRootPath, 'Dependency transition empty staging root').target,
      {
        deadlineAtMs: runtimeDependencyOperationDeadlineAtV1(options, 'Dependency transition empty staging root census'),
        maximumEntries: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES_V1,
        signal: runtimeDependencyOperationContextV1(options).signal
      }
    );
    if (unrecorded.length > 0) {
      throw new CompilerError(
        'RUNTIME-DEPS-004',
        'Dependency transition staging root has unrecorded residue; it is preserved',
        { stageRootPath, entryCount: unrecorded.length }
      );
    }
  }
  const relativeStagePath = path.relative(root, stageRootPath).replaceAll('\\', '/');
  if (options.generatedStateLifecycle !== undefined) {
    if (authority.lifecycle !== undefined) {
      const bind = options.generatedStateLifecycle.bind;
      if (bind === undefined) {
        throw new CompilerError(
          'RUNTIME-DEPS-004',
          'Dependency transition staging root has no read-only lifecycle binding path; residue is preserved',
          { stageRootPath }
        );
      }
      await runtimeDependencyOperationEffectFenceV1(options, 'Dependency transition staging lifecycle bind');
      await bind(relativeStagePath, {
        owner: authority.lifecycle.owner,
        producer: authority.lifecycle.producer,
        ruleId: authority.lifecycle.ruleId,
        physical: generatedStatePhysicalIdentityV1(expectedStageRoot.physical)
      });
    }
    // Lifecycle disposal is an authority-bearing operation.  A missing,
    // foreign, or stale registration must block and preserve the stage; the
    // physical inventory below is only the second half of a successful
    // operation-owned disposal, never a provenance fallback.  Swallowing the
    // lifecycle error would let a forged journal turn an arbitrary directory
    // into deletion authority after the validation interval.
    await runtimeDependencyOperationEffectFenceV1(options, 'Dependency transition staging lifecycle disposal');
    await options.generatedStateLifecycle.disposed(relativeStagePath, outcome);
    runtimeDependencyOperationRemainingMsV1(options, 'Dependency transition staging lifecycle disposal readback');
    const afterLifecycleRoot = await observeDependencyTransitionSlotV1(stageRootPath);
    if (afterLifecycleRoot.kind === 'absent') return;
    if (!transitionSlotMatchesV1(afterLifecycleRoot, expectedStageRoot)) {
      throw new CompilerError(
        'RUNTIME-DEPS-004',
        'Dependency transition staging root changed during lifecycle disposal; residue is preserved',
        { stageRootPath, expectedStageRoot, observedStageRoot: afterLifecycleRoot }
      );
    }
    if (expectedStage !== null) {
      const afterLifecycleStage = await observeDependencyTransitionSlotV1(stagePath!);
      if (!transitionSlotMatchesV1(afterLifecycleStage, expectedStage)) {
        throw new CompilerError(
          'RUNTIME-DEPS-004',
          'Dependency transition stage changed during lifecycle disposal; residue is preserved',
          { stagePath, expectedStage, observedStage: afterLifecycleStage }
        );
      }
    }
  }
  // Even operation-created staging roots are disposed through the retained
  // no-follow inventory below. A basename prefix is metadata, not authority,
  // and cannot close the validation -> replacement race for a substituted
  // stage. Unknown or drifted stage entries therefore remain preserved and
  // return a typed blocker.
  const stageRootIdentity = inspectNoFollowDirectoryChainV1(
    stageRootPath,
    'Dependency transition staging root cleanup'
  ).target;
  if (!sameGeneratedStateIdentityV1(
    generatedStatePhysicalIdentityV1(stageRootIdentity),
    expectedStageRoot.physical
  )) {
    throw new CompilerError(
      'RUNTIME-DEPS-004',
      'Dependency transition staging root changed before inventory; residue is preserved',
      { stageRootPath, expectedStageRoot }
    );
  }
  // Rebuild the closed-world direct-child manifest immediately before the
  // retained inventory.  Lifecycle retirement above is itself an Effect and
  // can leave an operation-created root alive; an earlier preflight would
  // permit an unknown child inserted during that Effect to be swept by the
  // subsequent inventory.  Only children in the producer's declared shape
  // may enter the inventory.  Anything else is preserved and typed-blocked.
  const directChildren = scanNoFollowDirectoryTreeMetadataV1(stageRootIdentity, {
    deadlineAtMs: runtimeDependencyOperationDeadlineAtV1(options, 'Dependency transition staging direct-child census'),
    maximumEntries: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES_V1,
    signal: runtimeDependencyOperationContextV1(options).signal
  }).filter((entry) => !entry.relativePath.includes('/'));
  const allowedDirectChildren = new Set(authority.allowedDirectChildren);
  const unknownDirectChildren = directChildren.filter(({ relativePath }) => !allowedDirectChildren.has(relativePath));
  if (unknownDirectChildren.length > 0) {
    throw new CompilerError(
      'RUNTIME-DEPS-004',
      'Dependency transition staging root contains unknown operation descendants; residue is preserved',
      { stageRootPath, unknownDirectChildren: unknownDirectChildren.map(({ relativePath }) => relativePath) }
    );
  }
  const inventory = scanNoFollowDirectoryTreeMetadataV1(stageRootIdentity, {
    deadlineAtMs: runtimeDependencyOperationDeadlineAtV1(options, 'Dependency transition staging disposal inventory'),
    maximumEntries: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES_V1,
    signal: runtimeDependencyOperationContextV1(options).signal
  });
  const byPath = new Map(inventory.map((entry) => [entry.relativePath, entry]));
  const ordered = [...inventory].sort((left, right) => {
    const depth = (value: string): number => value.split('/').length;
    return depth(right.relativePath) - depth(left.relativePath) || compareCodeUnits(right.relativePath, left.relativePath);
  });
  for (const entry of ordered) {
    await runtimeDependencyOperationEffectFenceV1(options, 'Dependency transition staging descendant disposal');
    const parts = entry.relativePath.split('/');
    parts.pop();
    const ancestors = parts.map((_, index) => parts.slice(0, index + 1).join('/'))
      .map((relativePath) => {
        const ancestor = byPath.get(relativePath);
        if (ancestor === undefined || ancestor.kind !== 'directory') {
          throw new CompilerError('RUNTIME-DEPS-002', 'Dependency transition stage inventory has an incomplete ancestor chain');
        }
        return Object.freeze({
          relativePath,
          device: ancestor.device,
          inode: ancestor.inode
        });
      });
    deleteRetainedNoFollowEntryV1({
      root: stageRootIdentity,
      relativePath: entry.relativePath,
      kind: entry.kind,
      device: entry.device,
      inode: entry.inode,
      expectedLinkTarget: entry.linkTarget ?? undefined,
      ancestorDirectories: ancestors
    });
  }
  const currentStageRoot = await observeDependencyTransitionSlotV1(stageRootPath);
  if (!transitionSlotMatchesV1(currentStageRoot, expectedStageRoot)) {
    throw new CompilerError(
      'RUNTIME-DEPS-004',
      'Dependency transition staging root changed before final disposal; residue is preserved',
      { stageRootPath, expectedStageRoot, observedStageRoot: currentStageRoot }
    );
  }
  const parent = inspectNoFollowDirectoryChainV1(path.dirname(stageRootPath), 'Dependency transition staging root parent').target;
  await runtimeDependencyOperationEffectFenceV1(options, 'Dependency transition staging root disposal');
  deleteRetainedNoFollowEntryV1({
    root: parent,
    relativePath: path.basename(stageRootPath),
    kind: 'directory',
    device: expectedStageRoot.physical.device,
    inode: expectedStageRoot.physical.inode,
    ancestorDirectories: Object.freeze([])
  });
  runtimeDependencyOperationRemainingMsV1(options, 'Dependency transition staging root disposal readback');
}

export async function readRuntimeDepsStamp(stampPath: string): Promise<RuntimeDepsStamp | null> {
  let stampText: string;
  try {
    stampText = await readPhysicalControlText(stampPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }

  try {
    const value = JSON.parse(stampText) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const stamp = value as Partial<RuntimeDepsStamp>;
    if (stamp.formatVersion !== 'runtime-deps-stamp-v4' ||
      stamp.packageManager !== 'bun' ||
      typeof stamp.manifestHash !== 'string' ||
      typeof stamp.installedAt !== 'string' ||
      Number.isNaN(Date.parse(stamp.installedAt)) ||
      new Date(stamp.installedAt).toISOString() !== stamp.installedAt ||
      !isRuntimeDependencyMaterializationBinding(stamp.binding) ||
      !isRuntimeDependencySourceGenerationV1(stamp.sourceGeneration) ||
      !isRuntimeDependencyTargetIdentityV1(stamp.target) ||
      stamp.binding.manifestHash !== stamp.manifestHash) return null;
    const binding = buildRuntimeDependencyMaterializationBinding({
      manifestHash: stamp.binding.manifestHash,
      packages: stamp.binding.packages,
      rootPackages: stamp.binding.rootPackages,
      toolchain: stamp.binding.toolchain
    });
    const canonical: RuntimeDepsStamp = {
      binding,
      formatVersion: 'runtime-deps-stamp-v4',
      installedAt: stamp.installedAt,
      manifestHash: stamp.manifestHash,
      packageManager: 'bun',
      sourceGeneration: stamp.sourceGeneration,
      target: stamp.target
    };
    return canonicalEquals(value, canonical) ? Object.freeze(canonical) : null;
  } catch {
    return null;
  }
}

export async function writeRuntimeDepsStamp(
  stampPath: string,
  stamp: RuntimeDepsStamp,
  commitFence?: CommitFence
): Promise<void> {
  const canonical: RuntimeDepsStamp = {
    binding: stamp.binding,
    formatVersion: 'runtime-deps-stamp-v4',
    installedAt: stamp.installedAt,
    manifestHash: stamp.manifestHash,
    packageManager: 'bun',
    sourceGeneration: stamp.sourceGeneration,
    target: stamp.target
  };
  if (stamp.formatVersion !== 'runtime-deps-stamp-v4' ||
    stamp.packageManager !== 'bun' ||
    stamp.binding.manifestHash !== stamp.manifestHash ||
    !isRuntimeDependencyMaterializationBinding(stamp.binding) ||
    !isRuntimeDependencySourceGenerationV1(stamp.sourceGeneration) ||
    !isRuntimeDependencyTargetIdentityV1(stamp.target) ||
    Number.isNaN(Date.parse(stamp.installedAt)) ||
    new Date(stamp.installedAt).toISOString() !== stamp.installedAt ||
    !canonicalEquals(stamp, canonical)) {
    throw new CompilerError('RUNTIME-DEPS-002', 'Runtime dependency stamp is non-canonical');
  }
  const parent = inspectNoFollowDirectoryChainV1(
    path.dirname(path.resolve(stampPath)),
    'Runtime dependency stamp parent'
  ).target;
  const name = path.basename(stampPath);
  const bytes = Buffer.from(formatJsonFile(canonical), 'utf8');
  const validate = (candidate: Uint8Array): void => {
    if (!Buffer.from(candidate).equals(bytes)) {
      throw new CompilerError('RUNTIME-DEPS-002', 'Runtime dependency stamp canonical bytes changed');
    }
  };
  await commitFence?.();
  const existing = inspectNoFollowOrdinaryFileEntryV1(parent, name);
  if (existing === null) {
    publishExclusiveDurableCanonicalFileV1({ parent, name, bytes, validate });
  } else {
    replaceDurableCanonicalFileV1({
      parent,
      name,
      bytes,
      expectedExisting: { device: existing.device, inode: existing.inode },
      validate
    });
  }
  await commitFence?.();
  const readback = readNoFollowOrdinaryFileV1(parent, name);
  if (readback === null || !Buffer.from(readback).equals(bytes)) {
    throw new CompilerError(
      'RUNTIME-DEPS-002',
      'Runtime dependency stamp changed before exact publication readback'
    );
  }
}

async function runtimeDependencyTreeMatchesBinding(input: Readonly<{
  expected: Readonly<RuntimeDependencyMaterializationBinding>;
  nodeModulesPath: string;
  root: string;
  runtimeSpec: RuntimeDependencySpec;
}>): Promise<boolean> {
  let installedPaths: readonly string[];
  try {
    // Census the concrete tree first. A missing entry is an explicit content
    // mismatch and may be repaired; every other filesystem/capability failure
    // remains an unresolved read and must block before any materialization.
    installedPaths = await installedRuntimePackagePaths(input.nodeModulesPath);
  } catch (error) {
    if (isFileNotFoundError(error)) return false;
    throw error;
  }
  const observed = await observeRuntimeDependencyMaterializationBinding({
    nodeModulesPath: input.nodeModulesPath,
    root: input.root,
    runtimeSpec: input.runtimeSpec,
    toolchain: input.expected.toolchain
  });
  return canonicalEquals(observed, input.expected) &&
    canonicalEquals(
      installedPaths,
      input.expected.packages.map((entry) => entry.relativePath).sort(compareCodeUnits)
    );
}

async function sharedDependencyAuthorityResidue(sharedDepsRoot: string): Promise<string[]> {
  const observed = await Promise.all(SHARED_DEPENDENCY_FORBIDDEN_AUTHORITY_FILES.map(async (name) => {
    try {
      await fs.lstat(path.join(sharedDepsRoot, name));
      return name;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }));
  return observed.filter((name): name is (typeof SHARED_DEPENDENCY_FORBIDDEN_AUTHORITY_FILES)[number] =>
    name !== null);
}

function sameHostPath(left: string, right: string): boolean {
  const normalize = (value: string): string => {
    const resolved = path.resolve(value);
    if (process.platform !== 'win32') return resolved;
    const withoutDevicePrefix = resolved.startsWith('\\\\?\\UNC\\')
      ? `\\\\${resolved.slice('\\\\?\\UNC\\'.length)}`
      : resolved.startsWith('\\\\?\\')
        ? resolved.slice('\\\\?\\'.length)
        : resolved;
    return withoutDevicePrefix.toLocaleLowerCase('en-US');
  };
  const resolvedLeft = normalize(left);
  const resolvedRight = normalize(right);
  return process.platform === 'win32'
    ? resolvedLeft === resolvedRight
    : resolvedLeft === resolvedRight;
}

function physicalSharedDependencyDirectory(
  directoryPath: string,
  allowMissing: boolean
): PhysicalDirectoryIdentityV1 | null {
  const presence = inspectExactNoFollowDirectoryPresenceV1(
    path.resolve(directoryPath),
    'Shared dependency authority root'
  );
  if (presence.state === 'absent') {
    if (allowMissing) return null;
    throw new CompilerError('RUNTIME-DEPS-002', 'Shared dependency authority root is absent');
  }
  return presence.directory.target;
}

async function ensurePhysicalSharedDependencyRoot(
  sharedDepsRoot: string,
  commitFence?: CommitFence
): Promise<Readonly<{ identity: PhysicalDirectoryIdentityV1; created: boolean }>> {
  const existing = physicalSharedDependencyDirectory(sharedDepsRoot, true);
  if (existing !== null) return Object.freeze({ identity: existing, created: false });
  const parentPath = path.dirname(path.resolve(sharedDepsRoot));
  const parent = physicalSharedDependencyDirectory(parentPath, false);
  if (parent === null) {
    throw new CompilerError('RUNTIME-DEPS-002', 'Shared dependency authority parent is unavailable');
  }
  await commitFence?.();
  const currentParent = physicalSharedDependencyDirectory(parentPath, false);
  if (currentParent === null || !sameGeneratedStateIdentityV1(
    generatedStatePhysicalIdentityV1(currentParent),
    generatedStatePhysicalIdentityV1(parent)
  )) {
    throw new CompilerError('RUNTIME-DEPS-002', 'Shared dependency authority parent changed before creation');
  }
  const name = path.basename(path.resolve(sharedDepsRoot));
  try {
    const created = createExclusiveNoFollowDirectoryV1(parent, name);
    return Object.freeze({ identity: created, created: true });
  } catch (error) {
    // A concurrent creator is not silently adopted as producer provenance.
    // Reopen only the exact ordinary child; lifecycle binding below still
    // requires the issuer-created active registration and therefore blocks a
    // foreign collision rather than treating it as our birth.
    if (!(error instanceof PhysicalNoFollowError) || error.code !== 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED') {
      throw error;
    }
    const currentParent = physicalSharedDependencyDirectory(parentPath, false);
    if (currentParent === null || !sameGeneratedStateIdentityV1(
      generatedStatePhysicalIdentityV1(currentParent),
      generatedStatePhysicalIdentityV1(parent)
    )) {
      throw error;
    }
    const current = physicalSharedDependencyDirectory(sharedDepsRoot, true);
    if (current === null) throw error;
    return Object.freeze({ identity: current, created: false });
  }
}

async function assertSharedDependencyRootIdentity(
  expected: PhysicalDirectoryIdentityV1
): Promise<void> {
  const current = physicalSharedDependencyDirectory(expected.path, false);
  if (current === null || !sameGeneratedStateIdentityV1(
    generatedStatePhysicalIdentityV1(current),
    generatedStatePhysicalIdentityV1(expected)
  )) {
    throw new CompilerError('RUNTIME-DEPS-002', 'Shared dependency authority identity changed');
  }
}

async function assertNoSharedDependencyAuthorityResidue(sharedDepsRoot: string): Promise<void> {
  const residue = await sharedDependencyAuthorityResidue(sharedDepsRoot);
  if (residue.length > 0) {
    throw new CompilerError(
      'RUNTIME-DEPS-002',
      `Shared dependency root contains competing authority files: ${residue.join(', ')}`,
      { residue }
    );
  }
}

async function copyPhysicalTrees(input: Readonly<{
  options: RuntimeDependencyOperationOptionsV1;
  includeRelativePaths?: readonly string[];
  invalidSource: (detail: 'changed' | 'reparse' | 'special') => Error;
  maximumEntries?: number;
  roots: readonly Readonly<{ source: string; target: string }>[];
  skipNestedNodeModules?: boolean;
}>): Promise<void> {
  try {
    await copyNoFollowDirectoryTreesBulkV1(
      input.roots.map((root) => Object.freeze({
        source: inspectNoFollowDirectoryChainV1(root.source, 'Physical tree bulk source').target,
        target: root.target
      })),
      {
        assertCurrent: async () => runtimeDependencyOperationEffectFenceV1(
          input.options,
          'Runtime dependency bulk copy'
        ),
        deadlineAtMs: runtimeDependencyOperationDeadlineAtV1(
          input.options,
          'Runtime dependency bulk copy deadline'
        ),
        includeRelativePaths: input.includeRelativePaths,
        maximumEntries: input.maximumEntries,
        maximumBytes: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES_V1,
        signal: runtimeDependencyOperationContextV1(input.options).signal,
        skipNestedNodeModules: input.skipNestedNodeModules
      }
    );
    return;
  } catch (error) {
    if (error instanceof PhysicalNoFollowError) {
      const detail = error.code === 'PHYSICAL_NO_FOLLOW_IDENTITY_CHANGED'
        ? 'changed' as const
        : error.code === 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH'
          ? 'reparse' as const
          : null;
      if (detail !== null) throw input.invalidSource(detail);
    }
    throw error;
  }
}

async function stageRuntimeDependencyProjection(input: Readonly<{
  binding: Readonly<RuntimeDependencyMaterializationBinding>;
  options: RuntimeDependencyOperationOptionsV1;
  sharedDepsRoot: string;
  sourceNodeModulesPath: string;
}>): Promise<{
  nodeModulesPath: string;
  root: string;
  rootSlot: DependencyTransitionSlotV1;
  }> {
  await runtimeDependencyOperationEffectFenceV1(input.options, 'Runtime dependency staging-root creation');
  const sharedDepsRoot = inspectNoFollowDirectoryChainV1(
    input.sharedDepsRoot,
    'Runtime dependency staging parent'
  ).target;
  const stagingRoot = createExclusiveNoFollowRandomDirectoryV1(
    sharedDepsRoot,
    '.runtime-generation-'
  ).path;
  const nodeModulesPath = path.join(stagingRoot, 'node_modules');
  const stagingRootSlot = await observeDependencyTransitionSlotV1(stagingRoot);
  try {
    await copyPhysicalTrees({
      options: input.options,
      invalidSource: (detail) => new CompilerError(
        'RUNTIME-DEPS-002',
        detail === 'changed'
          ? 'Runtime dependency source changed during projection'
          : `Runtime dependency source contains a ${detail} entry`
      ),
      // One operation-scoped copy scans the immutable source tree once and
      // filters the package roots from that same inventory.  Per-package
      // copies used to repeat the full no-follow fence and inventory for every
      // package, which both made the 11k-file projection unbounded in practice
      // and widened the source/target race window.
      includeRelativePaths: input.binding.packages.map((packageIdentity) => packageIdentity.relativePath),
      maximumEntries: 100_000,
      roots: [{
        source: input.sourceNodeModulesPath,
        target: nodeModulesPath
      }],
      skipNestedNodeModules: true
    });
    return { nodeModulesPath, root: stagingRoot, rootSlot: stagingRootSlot };
  } catch (error) {
    try {
      await disposeDependencyTransitionStageV1(
        input.sharedDepsRoot,
        stagingRoot,
        input.options,
        'runtime-projection-staging-failed',
        null,
        stagingRootSlot,
        runtimeDependencyStageAuthorityV1(input.sharedDepsRoot)
      );
    } catch (disposeError) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Runtime dependency staging residue is preserved for recovery', {
        cause: error instanceof Error ? error.message : String(error),
        cleanup: disposeError instanceof Error ? disposeError.message : String(disposeError),
        stagingRoot
      });
    }
    throw error;
  }
}

async function publishRuntimeDependencyProjection(input: Readonly<{
  activeNodeModulesPath: string;
  binding: Readonly<RuntimeDependencyMaterializationBinding>;
  commitFence: CommitFence;
  compilerRoot: string;
  options: RuntimeDependencyOperationOptionsV1;
  sourceGeneration: Readonly<RuntimeDependencySourceGenerationV1>;
  stagingNodeModulesPath: string;
  stagingRoot: string;
}>): Promise<void> {
  const namespace = await ensureDependencyTransitionNamespaceV1(input.compilerRoot, input.options);
  const backupPath = path.join(
    namespace.backupRoot.path,
    `runtime-${input.sourceGeneration.epoch.slice('sha256:'.length, 'sha256:'.length + 24)}`
  );
  const publishOptions = runtimeDependencyOperationOptionsV1({
    ...input.options,
    beforeCommit: input.commitFence
  });
  let transition = await beginDependencyTransitionV1({
    kind: 'runtime-projection',
    ownerRoot: input.compilerRoot,
    destinationPath: input.activeNodeModulesPath,
    stagePath: input.stagingNodeModulesPath,
    stageRootPath: input.stagingRoot,
    backupPath,
    sourceGeneration: input.sourceGeneration,
    bindingDigest: generatedStateDigestV1(input.binding),
    options: publishOptions
  });
  let activeBackedUp = false;
  try {
    if (transition.preimage.kind !== 'absent') {
      if (transition.preimage.kind !== 'directory') {
        throw new CompilerError('RUNTIME-DEPS-004', 'Existing shared dependency target is foreign and preserved');
      }
      await renameCompilerDependencyDirectory(
        input.activeNodeModulesPath,
        backupPath,
        publishOptions
      );
      activeBackedUp = true;
      transition = await advanceDependencyTransitionV1(transition, {
        destination: transitionAbsentSlotV1(input.activeNodeModulesPath),
        backup: await observeDependencyTransitionSlotV1(backupPath),
        phase: 'backed-up',
        durability: 'known',
        failure: null
      }, publishOptions);
    }
    await renameCompilerDependencyDirectory(
      input.stagingNodeModulesPath,
      input.activeNodeModulesPath,
      publishOptions
    );
    transition = await advanceDependencyTransitionV1(transition, {
      destination: await observeDependencyTransitionSlotV1(
        input.activeNodeModulesPath,
        generatedStateDigestV1(input.binding)
      ),
      stage: transitionAbsentSlotV1(input.stagingNodeModulesPath),
      // `sourceGeneration` remains the immutable compiler/shared source. The
      // copied active projection is represented only by `destination`; never
      // rewrite sourcePath to the destination and conflate the two identities.
      phase: 'published',
      durability: 'known',
      failure: null
    }, publishOptions);
  } catch (error) {
    const active = await observeDependencyTransitionSlotV1(input.activeNodeModulesPath).catch(() => null);
    const backup = await observeDependencyTransitionSlotV1(backupPath).catch(() => null);
    const stage = await observeDependencyTransitionSlotV1(input.stagingNodeModulesPath).catch(() => null);
    const recoveryRequired = active !== null && backup !== null && stage !== null &&
      (active.kind === 'absent' || backup.kind === 'directory' || stage.kind === 'directory');
    if (recoveryRequired) {
      await markDependencyTransitionFailureV1(transition, error, publishOptions).catch(() => undefined);
    }
    throw new CompilerError('RUNTIME-DEPS-002', 'Runtime dependency projection publish failed', {
      cause: error instanceof Error ? error.message : String(error),
      recoveryRequired,
      transitionDigest: transition.recordDigest
    });
  }
  await input.commitFence();
  await disposeDependencyTransitionStageV1(
    input.compilerRoot,
    input.stagingRoot,
    publishOptions,
    'runtime-projection-published',
    transition.stage,
    transition.stageRoot,
    runtimeDependencyStageAuthorityV1(path.dirname(input.stagingRoot))
  );
  transition = await advanceDependencyTransitionV1(transition, {
    stageRoot: transitionAbsentSlotV1(input.stagingRoot),
    phase: 'complete',
    durability: 'known',
    failure: null
  }, publishOptions);
}

async function sharedDependencyManifestMatches(
  sharedPackagePath: string,
  manifest: unknown
): Promise<boolean> {
  try {
    return await readPhysicalControlText(sharedPackagePath) === formatJsonFile(manifest);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function sharedDependencyGenerationReady(input: Readonly<{
  binding?: Readonly<RuntimeDependencyMaterializationBinding>;
  compilerRoot: string;
  manifest: unknown;
  nodeModulesPath: string;
  options: RuntimeDependencyOperationOptionsV1;
  packagePath: string;
  root: string;
  spec: RuntimeDependencySpec;
  stampPath: string;
}>): Promise<RuntimeDepsStamp | null> {
  const stamp = await readRuntimeDepsStamp(input.stampPath);
  if (stamp === null || stamp.manifestHash !== input.spec.manifestHash) return null;
  const binding = input.binding ?? stamp.binding;
  if (stamp.binding.revision !== binding.revision ||
    !canonicalEquals(stamp.binding, binding)) return null;
  const [treeMatches, manifestMatches, residue] = await Promise.all([
    runtimeDependencyTreeMatchesBinding({
      expected: binding,
      nodeModulesPath: input.nodeModulesPath,
      root: input.compilerRoot,
      runtimeSpec: input.spec
    }),
    sharedDependencyManifestMatches(input.packagePath, input.manifest),
    sharedDependencyAuthorityResidue(input.root)
  ]);
  if (!treeMatches || !manifestMatches || residue.length !== 0) return null;
  let compilerGenerationPath: string | null;
  try {
    compilerGenerationPath = path.resolve(await fs.realpath(
      dependencyAuthorityPaths(path.resolve(input.compilerRoot)).compilerModulesRoot
    ));
  } catch (error) {
    if (isFileNotFoundError(error)) return null;
    throw error;
  }
  if (compilerGenerationPath === null) return null;
  const compilerGenerationOwnerRoot = path.dirname(compilerGenerationPath);
  if (!sameHostPath(stamp.sourceGeneration.sourcePath, compilerGenerationPath) ||
      !sameHostPath(stamp.sourceGeneration.ownerRoot, compilerGenerationOwnerRoot)) {
    // A stamp may describe content, but it may not nominate its own producer
    // topology.  The compiler generation owner derives the only admissible
    // source path for this shared projection.
    return null;
  }
  let sourceGeneration: RuntimeDependencySourceGenerationV1 | null;
  try {
    sourceGeneration = await runtimeDependencySourceGenerationV1({
      binding,
      options: input.options,
      ownerRoot: compilerGenerationOwnerRoot,
      sourcePath: compilerGenerationPath
    });
  } catch (error) {
    if (isFileNotFoundError(error)) return null;
    throw error;
  }
  const target = await runtimeDependencyTargetIdentityV1(input.nodeModulesPath);
  if (sourceGeneration === null || target === null ||
    sourceGeneration.epoch !== stamp.sourceGeneration.epoch ||
    !sameRuntimeDependencySourceGenerationContentV1(sourceGeneration, stamp.sourceGeneration) ||
    !sameGeneratedStateIdentityV1(sourceGeneration.physical, stamp.sourceGeneration.physical) ||
    !sameGeneratedStateIdentityV1(sourceGeneration.ownerRootPhysical, stamp.sourceGeneration.ownerRootPhysical) ||
    target.kind !== stamp.target.kind || target.linkTarget !== stamp.target.linkTarget ||
    !sameGeneratedStateIdentityV1(target.physical, stamp.target.physical)) return null;
  return stamp;
}

async function assertSharedDependencyMaterializationPostcondition(input: Readonly<{
  manifest: unknown;
  packagePath: string;
  root: string;
}>): Promise<void> {
  const [manifestMatches, residue] = await Promise.all([
    sharedDependencyManifestMatches(input.packagePath, input.manifest),
    sharedDependencyAuthorityResidue(input.root)
  ]);
  if (!manifestMatches || residue.length > 0) {
    throw new CompilerError(
      'RUNTIME-DEPS-002',
      'Shared dependency install attempted to publish competing package authority',
      { manifestMatches, residue }
    );
  }
}

function projectStampPath(projectRoot: string): string {
  return path.join(projectRoot, '.runtime-deps.stamp.json');
}

interface InstallLockOwner {
  createdAt: string;
  pid: number;
  token: string;
}

type NoFollowOwnedFileObservationV1 = Readonly<{
  parent: PhysicalDirectoryIdentityV1;
  name: string;
  device: string;
  inode: string;
  size: number;
}>;

function isInstallLockOwner(value: unknown): value is InstallLockOwner {
  const owner = value as Partial<InstallLockOwner> | null;
  return owner !== null && typeof owner === 'object' &&
    typeof owner.createdAt === 'string' && Number.isSafeInteger(owner.pid) && (owner.pid ?? 0) > 0 &&
    typeof owner.token === 'string' && owner.token.length > 0;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/**
 * Capture one ordinary file below a retained no-follow parent.  A lease
 * cleanup operation may only consume this observation; it never turns a
 * later path lookup into authority for deletion.
 */
function observeNoFollowOwnedFileV1(
  filePath: string,
  label: string
): NoFollowOwnedFileObservationV1 | null {
  const parent = inspectNoFollowDirectoryChainV1(path.dirname(filePath), `${label} parent`).target;
  const name = path.basename(filePath);
  const entry = inspectNoFollowOrdinaryFileEntryV1(parent, name);
  if (entry === null) return null;
  if (entry.kind !== 'file') {
    throw new CompilerError('RUNTIME-DEPS-003', `${label} is occupied by a non-file identity and is preserved`, {
      path: filePath,
      kind: entry.kind
    });
  }
  return Object.freeze({
    parent,
    name,
    device: entry.device,
    inode: entry.inode,
    size: entry.size
  });
}

function sameNoFollowOwnedFileObservationV1(
  left: NoFollowOwnedFileObservationV1,
  right: NoFollowOwnedFileObservationV1
): boolean {
  return left.parent.path === right.parent.path &&
    left.parent.device === right.parent.device &&
    left.parent.inode === right.parent.inode &&
    left.parent.objectId === right.parent.objectId &&
    left.name === right.name && left.device === right.device &&
    left.inode === right.inode && left.size === right.size;
}

function readNoFollowOwnedFileJsonV1(
  observation: NoFollowOwnedFileObservationV1,
  label: string
): unknown {
  const before = observeNoFollowOwnedFileV1(
    path.join(observation.parent.path, observation.name),
    `${label} read`
  );
  if (before === null || !sameNoFollowOwnedFileObservationV1(before, observation)) {
    throw new CompilerError('RUNTIME-DEPS-003', `${label} identity changed before read and is preserved`);
  }
  const bytes = readNoFollowOrdinaryFileV1(observation.parent, observation.name);
  if (bytes === null) {
    throw new CompilerError('RUNTIME-DEPS-003', `${label} disappeared during read and is preserved`);
  }
  const after = observeNoFollowOwnedFileV1(
    path.join(observation.parent.path, observation.name),
    `${label} readback`
  );
  if (after === null || !sameNoFollowOwnedFileObservationV1(after, observation)) {
    throw new CompilerError('RUNTIME-DEPS-003', `${label} identity changed during read and is preserved`);
  }
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

function deleteNoFollowOwnedFileV1(
  filePath: string,
  expected: NoFollowOwnedFileObservationV1,
  label: string
): void {
  const current = observeNoFollowOwnedFileV1(filePath, `${label} cleanup`);
  if (current === null) return;
  if (!sameNoFollowOwnedFileObservationV1(current, expected)) {
    throw new CompilerError('RUNTIME-DEPS-003', `${label} identity changed before exact cleanup and is preserved`, {
      path: filePath
    });
  }
  deleteRetainedNoFollowEntryV1({
    root: expected.parent,
    relativePath: expected.name,
    kind: 'file',
    device: expected.device,
    inode: expected.inode,
    ancestorDirectories: []
  });
}

function parseInstallLockOwnerV1(value: unknown): InstallLockOwner | null {
  return isInstallLockOwner(value) ? value : null;
}

async function reclaimOrphanInstallLock(lockPath: string): Promise<boolean> {
  const reclaimPath = `${lockPath}.reclaim`;
  let reclaimObservation: NoFollowOwnedFileObservationV1 | null = null;
  try {
    const reclaimParent = inspectNoFollowDirectoryChainV1(path.dirname(reclaimPath), 'Install lock reclaim marker parent').target;
    const reclaimToken = crypto.randomUUID();
    const reclaimBytes = Buffer.from(`${reclaimToken}\n`, 'utf8');
    try {
      publishExclusiveDurableCanonicalFileV1({
        parent: reclaimParent,
        name: path.basename(reclaimPath),
        bytes: reclaimBytes,
        validate: (bytes) => {
          if (Buffer.from(bytes).toString('utf8') !== reclaimBytes.toString('utf8')) {
            throw new Error('Install lock reclaim marker bytes differ.');
          }
        }
      });
    } catch (error) {
      if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED') {
        return false;
      }
      throw error;
    }
    reclaimObservation = observeNoFollowOwnedFileV1(reclaimPath, 'Install lock reclaim marker');
    if (reclaimObservation === null) {
      throw new CompilerError('RUNTIME-DEPS-003', 'Install lock reclaim marker disappeared after exclusive publication');
    }

    const lockObservation = observeNoFollowOwnedFileV1(lockPath, 'Install lock orphan candidate');
    if (lockObservation === null) return true;
    const owner = parseInstallLockOwnerV1(readNoFollowOwnedFileJsonV1(lockObservation, 'Install lock orphan candidate'));
    // Do not reopen the lock through a second path-based stat just to obtain
    // mtime/dev/ino.  The retained no-follow observation above is the only
    // deletion authority; owner.createdAt is the durable freshness field and
    // malformed records are preserved rather than guessed stale.
    if (owner === null) return false;
    if (processIsAlive(owner.pid)) return false;
    const createdAtMs = Date.parse(owner.createdAt);
    if (!Number.isFinite(createdAtMs) || Date.now() - createdAtMs < 5000) return false;

    // Delete the stale lock in place through the retained parent/name/identity
    // capability.  There is no path-only rename followed by a broad unlink,
    // so a replacement can only result in a typed preservation blocker.
    deleteNoFollowOwnedFileV1(lockPath, lockObservation, 'Install lock orphan candidate');
    return true;
  } finally {
    if (reclaimObservation !== null) {
      deleteNoFollowOwnedFileV1(reclaimPath, reclaimObservation, 'Install lock reclaim marker');
    }
  }
}

async function reclaimLockIsActive(reclaimPath: string): Promise<boolean> {
  return observeNoFollowOwnedFileV1(reclaimPath, 'Install lock reclaim marker') !== null;
}

function runtimeDependencyFailureEvidenceV1(error: unknown): Readonly<{
  code: string | null;
  message: string;
  name: string;
}> {
  const value = error instanceof Error ? error : new Error(String(error));
  const code = 'code' in value && typeof value.code === 'string' ? value.code : null;
  return Object.freeze({
    code,
    message: value.message.slice(0, 1_024),
    name: value.name
  });
}

function runtimeDependencyInstallLockSettlementFailureV1(input: Readonly<{
  callbackFailure?: unknown;
  cleanupFailure?: unknown;
  fenceFailure?: unknown;
  lockPath: string;
}>): CompilerError {
  return new CompilerError(
    'RUNTIME-DEPS-003',
    'Runtime dependency install lock settlement failed; exact failure evidence is preserved',
    {
      callbackFailure: input.callbackFailure === undefined
        ? null
        : runtimeDependencyFailureEvidenceV1(input.callbackFailure),
      cleanupFailure: input.cleanupFailure === undefined
        ? null
        : runtimeDependencyFailureEvidenceV1(input.cleanupFailure),
      fenceFailure: input.fenceFailure === undefined
        ? null
        : runtimeDependencyFailureEvidenceV1(input.fenceFailure),
      lockPath: input.lockPath
    }
  );
}

async function withInstallLock<T>(
  lockPath: string,
  options: RuntimeDependencyInstallOptions,
  callback: () => Promise<T>
): Promise<T> {
  const operationOptions = runtimeDependencyOperationOptionsV1(options);
  const context = runtimeDependencyOperationContextV1(operationOptions);
  const pollIntervalMs = context.pollIntervalMs;
  const sleep = operationOptions.sleep ?? sleepMs;
  let owner: InstallLockOwner | null = null;
  let ownerObservation: NoFollowOwnedFileObservationV1 | null = null;

  // Every caller admits the lock below an already-created owner namespace.
  // Reopening that namespace through the no-follow chain prevents a redirected
  // parent from becoming the lease's hidden second authority.
  runtimeDependencyOperationRemainingMsV1(operationOptions, 'Install lock parent admission');
  inspectNoFollowDirectoryChainV1(path.dirname(lockPath), 'Install lock parent');

  while (true) {
    runtimeDependencyOperationRemainingMsV1(operationOptions, 'Install lock admission');
    if (await reclaimLockIsActive(`${lockPath}.reclaim`)) {
      await waitForRuntimeDependencyOperationV1(
        operationOptions,
        pollIntervalMs,
        sleep,
        `Waiting for install lock reclaim marker ${lockPath}`
      );
      continue;
    }
    runtimeDependencyOperationRemainingMsV1(operationOptions, 'Install lock publication fence');
    await operationOptions.beforeCommit?.();
    runtimeDependencyOperationRemainingMsV1(operationOptions, 'Install lock publication');
    owner = {
      createdAt: (operationOptions.now ?? (() => new Date().toISOString()))(),
      pid: process.pid,
      token: crypto.randomUUID()
    };
    const parent = inspectNoFollowDirectoryChainV1(path.dirname(lockPath), 'Install lock parent').target;
    const ownerBytes = Buffer.from(formatJsonFile(owner), 'utf8');
    try {
      publishExclusiveDurableCanonicalFileV1({
        parent,
        name: path.basename(lockPath),
        bytes: ownerBytes,
        validate: (bytes) => {
          const value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
          if (!isInstallLockOwner(value)) throw new Error('Install lock owner record is malformed.');
        }
      });
      runtimeDependencyOperationRemainingMsV1(operationOptions, 'Install lock publication readback');
    } catch (error) {
      // A valid existing lease, or a recently-created malformed lease, is
      // contention rather than an invitation to replace its bytes.  The
      // exact reclaimer below decides whether an old identity may be
      // removed. Parent/reparse failures remain typed blockers.
      const contention = error instanceof PhysicalNoFollowError &&
        error.code === 'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED'
        ? observeNoFollowOwnedFileV1(lockPath, 'Install lock contention') !== null
        : (() => {
            const existing = observeNoFollowOwnedFileV1(lockPath, 'Install lock contention');
            return existing !== null;
          })();
      if (!contention) throw error;
    }
    const current = observeNoFollowOwnedFileV1(lockPath, 'Install lock owner');
    if (current !== null) {
      const currentOwner = parseInstallLockOwnerV1(readNoFollowOwnedFileJsonV1(current, 'Install lock owner'));
      if (currentOwner?.token === owner.token) {
        ownerObservation = current;
        break;
      }
    }
    owner = null;
    ownerObservation = null;
    runtimeDependencyOperationRemainingMsV1(operationOptions, 'Install lock orphan recovery');
    if (await reclaimOrphanInstallLock(lockPath)) {
      runtimeDependencyOperationRemainingMsV1(operationOptions, 'Install lock orphan recovery readback');
      continue;
    }
    await waitForRuntimeDependencyOperationV1(
      operationOptions,
      pollIntervalMs,
      sleep,
      `Waiting for install lock ${lockPath}`
    );
  }

  let callbackFailed = false;
  let callbackFailure: unknown;
  let callbackResult!: T;
  try {
    runtimeDependencyOperationRemainingMsV1(operationOptions, 'Install lock callback admission');
    callbackResult = await callback();
    runtimeDependencyOperationRemainingMsV1(operationOptions, 'Install lock callback settlement');
  } catch (error) {
    callbackFailed = true;
    callbackFailure = error;
  }

  // Settlement is deliberately outside the operation budget: once this
  // process owns the exact token, neither an exhausted deadline nor an abort
  // may strand it.  The caller fence is still observed, but its failure cannot
  // skip the retained identity/token CAS deletion below.
  let fenceFailure: unknown;
  try {
    await operationOptions.beforeCommit?.();
  } catch (error) {
    fenceFailure = error;
  }
  let cleanupFailure: unknown;
  try {
    if (owner !== null && ownerObservation !== null) {
      const current = observeNoFollowOwnedFileV1(lockPath, 'Install lock owner cleanup');
      if (current === null) {
        throw new CompilerError(
          'RUNTIME-DEPS-003',
          'Install lock owner disappeared before exact settlement',
          { lockPath, token: owner.token }
        );
      }
      const currentOwner = parseInstallLockOwnerV1(
        readNoFollowOwnedFileJsonV1(current, 'Install lock owner cleanup')
      );
      if (currentOwner?.token !== owner.token) {
        throw new CompilerError(
          'RUNTIME-DEPS-003',
          'Install lock owner changed before exact settlement; replacement is preserved',
          { lockPath, token: owner.token }
        );
      }
      deleteNoFollowOwnedFileV1(lockPath, ownerObservation, 'Install lock owner');
    }
  } catch (error) {
    cleanupFailure = error;
  }

  if (callbackFailed) {
    if (fenceFailure !== undefined || cleanupFailure !== undefined) {
      throw runtimeDependencyInstallLockSettlementFailureV1({
        callbackFailure,
        cleanupFailure,
        fenceFailure,
        lockPath
      });
    }
    throw callbackFailure;
  }
  if (fenceFailure !== undefined && cleanupFailure !== undefined) {
    throw runtimeDependencyInstallLockSettlementFailureV1({ cleanupFailure, fenceFailure, lockPath });
  }
  if (fenceFailure !== undefined) throw fenceFailure;
  if (cleanupFailure !== undefined) throw cleanupFailure;
  return callbackResult;
}

/**
 * One owner-local lease serializes every dependency transition that can
 * mutate a compiler generation or one of its projections.  It is deliberately
 * not an in-process "depth" cache: unrelated concurrent callers must wait for
 * the same physical lease instead of being mistaken for a re-entrant call and
 * racing lifecycle registration. Callers acquire this lease before any
 * shared/project lock so transition order is compiler-root -> projection-root
 * everywhere.
 */
async function withCompilerDependencyTransitionLeaseV1<T>(
  compilerDependencyRoot: string,
  options: RuntimeDependencyInstallOptions,
  callback: (operationOptions: RuntimeDependencyOperationOptionsV1) => Promise<T>
): Promise<T> {
  const operationOptions = runtimeDependencyOperationOptionsV1(options);
  const root = path.resolve(compilerDependencyRoot);
  // The compiler-root transition lease is the registry-owned compiler.lock;
  // do not create a second unregistered lock identity for the same owner.
  // Lease admission is the writer boundary, so it may materialize the
  // canonical lock namespace.  withInstallLock itself remains inspect-only;
  // this keeps every read/recovery path from creating directories while still
  // allowing a first compiler install to acquire its owner-local lease.
  runtimeDependencyOperationRemainingMsV1(operationOptions, 'Compiler dependency lease namespace admission');
  await operationOptions.beforeCommit?.();
  runtimeDependencyOperationRemainingMsV1(operationOptions, 'Compiler dependency lease namespace effect');
  const compilerRootIdentity = inspectNoFollowDirectoryChainV1(
    root,
    'Compiler dependency transition root'
  ).target;
  createNoFollowOrdinaryDirectoryChainV1(
    compilerRootIdentity,
    ['.tmp', 'dependency-installs']
  );
  await operationOptions.beforeCommit?.();
  runtimeDependencyOperationRemainingMsV1(operationOptions, 'Compiler dependency lease namespace readback');
  const leasePath = path.join(root, '.tmp', 'dependency-installs', 'compiler.lock');
  return withInstallLock(leasePath, operationOptions, async () => {
    // A rollover is the only journal operation that can leave the canonical
    // records root absent.  Recover it while the same compiler-root lease is
    // held, before any generation, locator, runtime, or project writer reads
    // the ledger.  This keeps recovery and normal publication on one owner
    // local transition writer.
    await recoverDependencyTransitionRolloverV1(root, operationOptions);
    const pending = await readDependencyTransitionV1(root, operationOptions);
    if (pending !== null && pending.phase !== 'complete' && pending.phase !== 'rolled-back' &&
        pending.kind === 'compiler-bridge') {
      await recoverCompilerDependencyBridgeTransitionV1(
        root,
        path.dirname(pending.destination.path),
        operationOptions
      );
    }
    return callback(operationOptions);
  });
}

/**
 * The compiler command shares the existing dependency-install lock budget.
 * Reserve the final tenth for process-tree termination/readback so a retained
 * command cannot turn a bounded install operation into an unbounded cleanup.
 */
function compilerDependencyCommandBoundsV1(options: RuntimeDependencyInstallOptions): Readonly<{
  maxStderrBytes: number;
  maxStdoutBytes: number;
  terminationDeadlineMs: number;
  terminationGraceMs: number;
  timeoutMs: number;
}> {
  const totalBudgetMs = Math.floor(runtimeDependencyOperationRemainingMsV1(
    options,
    'Compiler dependency command admission',
    2
  ));
  const terminationDeadlineMs = Math.max(1, Math.min(5_000, Math.floor(totalBudgetMs / 10)));
  const timeoutMs = totalBudgetMs - terminationDeadlineMs;
  const terminationGraceMs = Math.max(1, Math.min(1_000, Math.floor(terminationDeadlineMs / 2)));
  return Object.freeze({
    maxStderrBytes: DEPENDENCY_COMMAND_OUTPUT_BYTES_CAPACITY_V1,
    maxStdoutBytes: DEPENDENCY_COMMAND_OUTPUT_BYTES_CAPACITY_V1,
    terminationDeadlineMs,
    terminationGraceMs,
    timeoutMs
  });
}

async function runBunInstall(
  workingDirectory: string,
  options: RuntimeDependencyInstallOptions,
  bunArgs: string[],
  cacheDir?: string,
  expectedExecutable?: Readonly<RuntimeExecutableIdentity>,
  inputFence?: CommitFence
): Promise<{ packageManager: 'bun'; result: CommandResult }> {
  const commandRunner = options.commandRunner;
  const commandBounds = compilerDependencyCommandBoundsV1(options);
  const isolated = options.installMode === 'offline-copy-only';
  const isolatedWritableRoot = path.join(workingDirectory, '.isolated-process', 'dependency-install');
  if (isolated) await ensureIsolatedProcessDirectories(isolatedWritableRoot, options.beforeCommit);
  const isolatedConfigPath = path.join(isolatedWritableRoot, 'bunfig.toml');
  if (isolated) await writeText(isolatedConfigPath, '# isolated runtime\n', options.beforeCommit);
  await options.beforeCommit?.();
  const commandArgs = isolated
    ? ['--no-env-file', `--config=${isolatedConfigPath}`, ...bunArgs]
    : bunArgs;
  const runOptions = {
    beforeSpawn: async () => {
      runtimeDependencyOperationRemainingMsV1(options, 'Compiler dependency command pre-spawn');
      await options.beforeCommit?.();
      await inputFence?.();
      runtimeDependencyOperationRemainingMsV1(options, 'Compiler dependency command effect admission');
    },
    cwd: workingDirectory,
    env: buildEnv(cacheDir ? {
      BUN_INSTALL_CACHE_DIR: cacheDir,
      ...(isolated ? {
        [ISOLATED_VERIFICATION_ENV_KEY]: '1'
      } : {})
    } : {}, isolated ? isolatedWritableRoot : undefined),
    signal: options.signal,
    ...commandBounds,
    ...(isolated ? { envMode: 'replace' as const } : {})
  };
  let bunResult: CommandResult;
  if (commandRunner !== undefined) {
    // A caller-provided command runner is an explicit test/provider seam. It
    // remains path-compatible so existing deterministic fixtures can observe
    // the command without owning the production executable effect.
    bunResult = await commandRunner(process.execPath, commandArgs, runOptions);
  } else {
    const expected = expectedExecutable ?? await currentRuntimeExecutableIdentity(true);
    const executableParent = inspectNoFollowDirectoryChainV1(
      path.dirname(expected.path),
      'Bun executable retained parent'
    );
    const executable = retainNoFollowOrdinaryFileV1(
      executableParent,
      path.basename(expected.path),
      undefined,
      'Bun executable retained capability',
      RETAINED_EXECUTABLE_CHILD_DESCRIPTOR_V1,
      'executable'
    );
    const workingDirectoryChain = inspectNoFollowDirectoryChainV1(
      workingDirectory,
      'Bun retained working directory'
    );
    const retainedWorkingDirectory = retainNoFollowDirectoryForChildProcessV1(
      workingDirectoryChain,
      RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR_V1,
      'Bun retained working directory capability'
    );
    try {
      assertRetainedNoFollowCapabilityV1(executable, 'executable', 'Bun executable capability');
      assertRetainedNoFollowCapabilityV1(
        retainedWorkingDirectory,
        'working-directory',
        'Bun working directory capability'
      );
      const observed = executable.digest();
      if (!sameHostPath(executable.path, expected.path) || observed.byteDigest !== expected.sha256) {
        throw new CompilerError(
          'IMPORT-AUTHORITY-001',
          'Bun runtime executable changed before retained compiler spawn'
        );
      }
      const expectedExecutableSize = observed.size;
      const assertRetainedExecutableCurrent = (): void => {
        executable.assertCurrent();
        const current = executable.digest();
        // Metadata/identity fences catch ordinary replacement and timestamp
        // drift.  The same retained handle must also re-read the bytes so an
        // in-place same-size rewrite cannot pass by preserving metadata.
        if (current.size !== expectedExecutableSize || current.byteDigest !== expected.sha256) {
          throw new CompilerError(
            'IMPORT-AUTHORITY-001',
            'Bun runtime executable bytes changed during retained compiler spawn'
          );
        }
      };
      const { cwd: _workingDirectory, ...retainedRunOptions } = runOptions;
      bunResult = await runRetainedCommand({
        executable,
        workingDirectory: retainedWorkingDirectory
      }, commandArgs, {
        ...retainedRunOptions,
        ...commandBounds,
        beforeSpawn: async () => {
          await options.beforeCommit?.();
          await inputFence?.();
          assertRetainedExecutableCurrent();
          retainedWorkingDirectory.assertCurrent();
        }
      });
      assertRetainedExecutableCurrent();
      retainedWorkingDirectory.assertCurrent();
    } finally {
      retainedWorkingDirectory.dispose();
      executable.dispose();
    }
  }
  runtimeDependencyOperationRemainingMsV1(options, 'Compiler dependency command settlement');
  await options.beforeCommit?.();
  runtimeDependencyOperationRemainingMsV1(options, 'Compiler dependency command final fence');

  if (bunResult.code === 0) {
    return { packageManager: 'bun', result: bunResult };
  }

  throw new CompilerError('RUNTIME-DEPS-001', `Failed to install runtime dependencies in ${workingDirectory}`, {
    bunResult
  });
}

async function materializeIsolatedNodeModules(
  source: string,
  target: string,
  options: RuntimeDependencyOperationOptionsV1
): Promise<void> {
  await runtimeDependencyOperationEffectFenceV1(options, 'Isolated dependency materialization admission');
  if ((await observeDependencyTransitionSlotV1(target)).kind !== 'absent') {
    throw new CompilerError('RUNTIME-DEPS-004', 'Isolated dependency target must be absent before materialization');
  }
  await copyPhysicalTrees({
    options,
    invalidSource: (detail) => new CompilerError(
      'RUNTIME-DEPS-004',
      detail === 'changed'
        ? 'Preinstalled dependency tree changed during materialization'
        : `Preinstalled dependency tree contains a ${detail} entry`
    ),
    roots: [{ source, target }]
  });
}

async function dependencyBridgeTargets(
  bridgePath: string,
  expectedTarget: string
): Promise<boolean> {
  try {
    const metadata = await fs.lstat(bridgePath);
    if (!metadata.isSymbolicLink()) return false;
    return sameHostPath(await fs.realpath(bridgePath), await fs.realpath(expectedTarget));
  } catch (error) {
    if (isFileNotFoundError(error)) return false;
    throw error;
  }
}

type ProjectStampObservationV1 = Readonly<{
  present: boolean;
  stamp: RuntimeDepsStamp | null;
}>;

async function observeProjectStampV1(projectRoot: string): Promise<ProjectStampObservationV1> {
  const root = inspectNoFollowDirectoryChainV1(
    projectRoot,
    'Project dependency stamp root'
  ).target;
  const entry = inspectNoFollowOrdinaryFileEntryV1(root, path.basename(projectStampPath(projectRoot)));
  if (entry === null || entry.bytes === null) return Object.freeze({ present: false, stamp: null });
  const stamp = await readRuntimeDepsStamp(projectStampPath(projectRoot));
  return Object.freeze({ present: true, stamp });
}

function sameRuntimeDependencyTargetIdentityV1(
  left: Readonly<RuntimeDependencyTargetIdentityV1>,
  right: Readonly<RuntimeDependencyTargetIdentityV1>
): boolean {
  return left.kind === right.kind && left.linkTarget === right.linkTarget &&
    sameGeneratedStateIdentityV1(left.physical, right.physical);
}

async function assertProjectProjectionPreimageV1(input: Readonly<{
  current: DependencyTransitionSlotV1;
  expectedBinding: Readonly<RuntimeDependencyMaterializationBinding>;
  expectedLinkTarget: string | null;
  expectedSourceGeneration?: Readonly<RuntimeDependencySourceGenerationV1>;
  options: RuntimeDependencyOperationOptionsV1;
  projectRoot: string;
  runtimeSpec: RuntimeDependencySpec;
  targetPath: string;
}>): Promise<RuntimeDepsStamp | null> {
  const stampState = await observeProjectStampV1(input.projectRoot);
  if (input.current.kind === 'absent') {
    if (stampState.present) {
      throw new CompilerError(
        'RUNTIME-DEPS-004',
        'Project dependency stamp is stale while its target is absent; physical state is preserved'
      );
    }
    return null;
  }
  const stamp = stampState.stamp;
  if (stamp === null) {
    throw new CompilerError(
      'RUNTIME-DEPS-004',
      'Project dependency target has no valid v4 stamp; physical target is preserved'
    );
  }
  if (stamp.binding.revision !== input.expectedBinding.revision ||
      !canonicalEquals(stamp.binding, input.expectedBinding) ||
      stamp.sourceGeneration.bindingDigest !== generatedStateDigestV1(input.expectedBinding)) {
    throw new CompilerError(
      'RUNTIME-DEPS-004',
      'Project dependency target provenance does not match the requested binding; physical target is preserved'
    );
  }
  const expectedSourceGeneration = input.expectedSourceGeneration ?? stamp.sourceGeneration;
  let currentSource: RuntimeDependencySourceGenerationV1 | null;
  try {
    currentSource = await runtimeDependencySourceGenerationV1({
      binding: input.expectedBinding,
      options: input.options,
      ownerRoot: expectedSourceGeneration.ownerRoot,
      sourcePath: expectedSourceGeneration.sourcePath
    });
  } catch (error) {
    if (!isFileNotFoundError(error)) throw error;
    currentSource = null;
  }
  if (currentSource === null || currentSource.epoch !== expectedSourceGeneration.epoch ||
      !sameRuntimeDependencySourceGenerationContentV1(currentSource, expectedSourceGeneration) ||
      !sameGeneratedStateIdentityV1(currentSource.physical, expectedSourceGeneration.physical) ||
      currentSource.epoch !== stamp.sourceGeneration.epoch ||
      !sameRuntimeDependencySourceGenerationContentV1(currentSource, stamp.sourceGeneration) ||
      !sameGeneratedStateIdentityV1(currentSource.physical, stamp.sourceGeneration.physical) ||
      !sameGeneratedStateIdentityV1(currentSource.ownerRootPhysical, stamp.sourceGeneration.ownerRootPhysical)) {
    throw new CompilerError(
      'RUNTIME-DEPS-004',
      'Project dependency source generation changed before target retirement; physical target is preserved'
    );
  }
  const target = await runtimeDependencyTargetIdentityV1(input.targetPath);
  if (target === null || input.current.physical === null ||
      !sameRuntimeDependencyTargetIdentityV1(target, stamp.target) ||
      !sameGeneratedStateIdentityV1(target.physical, input.current.physical) ||
      (input.expectedLinkTarget === null
        ? target.kind !== 'directory'
        : target.kind !== 'link' || target.linkTarget === null ||
          !sameHostPath(target.linkTarget, input.expectedLinkTarget))) {
    throw new CompilerError(
      'RUNTIME-DEPS-004',
      'Project dependency target identity changed before exact retirement; physical target is preserved'
    );
  }
  // The runtime spec is intentionally part of the readback boundary. A valid
  // stamp with an otherwise incompatible closure must not be treated as
  // ownership merely because its digest happens to match one field.
  if (!await runtimeDependencyTreeMatchesBinding({
    expected: input.expectedBinding,
    nodeModulesPath: input.targetPath,
    root: path.resolve(compilerRoot),
    runtimeSpec: input.runtimeSpec
  }) && target.kind === 'directory') {
    throw new CompilerError(
      'RUNTIME-DEPS-004',
      'Project dependency target content no longer matches its stamped binding; physical target is preserved'
    );
  }
  return stamp;
}

type ProjectProjectionTransitionInputV1 = Readonly<{
  binding: Readonly<RuntimeDependencyMaterializationBinding>;
  compilerDependencyRoot: string;
  isolated: boolean;
  nodeModulesPath: string;
  options: RuntimeDependencyOperationOptionsV1;
  projectRootPath: string;
  runtimeSpec: RuntimeDependencySpec;
  sourceGeneration: Readonly<RuntimeDependencySourceGenerationV1>;
  sourceNodeModulesPath: string;
  stampPath: string;
}>;

async function assertProjectSourceGenerationCurrentV1(
  input: Pick<ProjectProjectionTransitionInputV1, 'binding' | 'options' | 'sourceGeneration'>
): Promise<RuntimeDependencySourceGenerationV1> {
  const current = await runtimeDependencySourceGenerationV1({
    binding: input.binding,
    options: input.options,
    ownerRoot: input.sourceGeneration.ownerRoot,
    sourcePath: input.sourceGeneration.sourcePath
  });
  if (current.epoch !== input.sourceGeneration.epoch ||
      !sameRuntimeDependencySourceGenerationContentV1(current, input.sourceGeneration) ||
      !sameGeneratedStateIdentityV1(current.physical, input.sourceGeneration.physical) ||
      !sameGeneratedStateIdentityV1(current.ownerRootPhysical, input.sourceGeneration.ownerRootPhysical)) {
    throw new CompilerError(
      'RUNTIME-DEPS-004',
      'Runtime dependency source generation changed before project projection effect'
    );
  }
  return current;
}

async function deleteExactDependencyLocatorV1(
  targetPath: string,
  expected: DependencyTransitionSlotV1,
  options: RuntimeDependencyOperationOptionsV1
): Promise<void> {
  if (expected.kind !== 'link' || expected.physical === null || expected.linkTarget === null) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Project dependency locator preimage is not an exact link');
  }
  const parent = inspectNoFollowDirectoryChainV1(
    path.dirname(path.resolve(targetPath)),
    'Project dependency locator cleanup parent'
  ).target;
  const entry = inspectNoFollowLinkEntryV1(parent, path.basename(path.resolve(targetPath)));
  if (entry === null || entry.kind !== 'link' || entry.linkTarget === null ||
      !sameHostPath(entry.linkTarget, expected.linkTarget) ||
      !sameGeneratedStateIdentityV1(Object.freeze({
        device: entry.device,
        inode: entry.inode,
        objectId: generatedStateDigestV1({ kind: 'link', target: entry.linkTarget })
      }), expected.physical)) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Project dependency locator changed before exact retirement');
  }
  await runtimeDependencyOperationEffectFenceV1(options, 'Project dependency locator retirement');
  deleteRetainedNoFollowEntryV1({
    root: parent,
    relativePath: path.basename(path.resolve(targetPath)),
    kind: 'link',
    device: entry.device,
    inode: entry.inode,
    expectedLinkTarget: entry.linkTarget,
    ancestorDirectories: Object.freeze([])
  });
  if ((await observeDependencyTransitionSlotV1(targetPath)).kind !== 'absent') {
    throw new CompilerError('RUNTIME-DEPS-004', 'Project dependency locator remains after exact retirement');
  }
}

async function invokeProjectProjectionHookV1(
  options: RuntimeDependencyInstallOptions,
  stage: 'prepared' | 'backed-up' | 'published' | 'binding-validated' | 'stamp-readback'
): Promise<void> {
  await options.testProjectProjectionHook?.(stage);
}

async function assertProjectProjectionPublishedV1(input: Readonly<{
  binding: Readonly<RuntimeDependencyMaterializationBinding>;
  compilerDependencyRoot: string;
  isolated: boolean;
  nodeModulesPath: string;
  options: RuntimeDependencyOperationOptionsV1;
  runtimeSpec: RuntimeDependencySpec;
  sourceGeneration: Readonly<RuntimeDependencySourceGenerationV1>;
  sourceNodeModulesPath: string;
}>): Promise<Readonly<{
  sourceGeneration: RuntimeDependencySourceGenerationV1;
  target: RuntimeDependencyTargetIdentityV1;
}>> {
  const sourceGeneration = await assertProjectSourceGenerationCurrentV1(input);
  const target = await runtimeDependencyTargetIdentityV1(input.nodeModulesPath);
  if (target === null || (input.isolated ? target.kind !== 'directory' : target.kind !== 'link')) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Project dependency projection published an unexpected target kind');
  }
  if (input.isolated) {
    if (!await runtimeDependencyTreeMatchesBinding({
      expected: input.binding,
      nodeModulesPath: input.nodeModulesPath,
      root: input.compilerDependencyRoot,
      runtimeSpec: input.runtimeSpec
    })) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Isolated dependency projection failed exact readback');
    }
  } else if (target.linkTarget === null ||
      !await dependencyBridgeTargets(input.nodeModulesPath, input.sourceNodeModulesPath)) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Project dependency bridge failed exact target readback');
  }
  return Object.freeze({ sourceGeneration, target });
}

async function publishProjectDependencyProjectionV1(
  input: ProjectProjectionTransitionInputV1
): Promise<void> {
  const {
    binding,
    compilerDependencyRoot,
    isolated,
    nodeModulesPath,
    options,
    projectRootPath,
    runtimeSpec,
    sourceGeneration,
    sourceNodeModulesPath,
    stampPath
  } = input;
  const projectRootIdentity = inspectNoFollowDirectoryChainV1(
    projectRootPath,
    'Project dependency projection root'
  ).target;
  await runtimeDependencyOperationEffectFenceV1(options, 'Project dependency staging namespace creation');
  const stagingParentIdentity = createNoFollowOrdinaryDirectoryChainV1(
    projectRootIdentity,
    ['.tmp']
  );
  await runtimeDependencyOperationEffectFenceV1(options, 'Project dependency staging-root creation');
  const stagingRoot = createExclusiveNoFollowRandomDirectoryV1(
    stagingParentIdentity,
    'project.staging-'
  ).path;
  const stagingNodeModulesPath = path.join(stagingRoot, 'node_modules');
  const stagingRootSlot = await observeDependencyTransitionSlotV1(stagingRoot);
  let stagingNodeModulesSlot: DependencyTransitionSlotV1 | null = null;
  let transition: DependencyTransitionJournalV1 | null = null;
  try {
    if (isolated) {
      await materializeIsolatedNodeModules(sourceNodeModulesPath, stagingNodeModulesPath, options);
    } else {
      await createCompilerDependencyLocatorV1(
        stagingNodeModulesPath,
        sourceNodeModulesPath,
        sourceGeneration.physical,
        options
      );
    }
    stagingNodeModulesSlot = await observeDependencyTransitionSlotV1(
      stagingNodeModulesPath,
      generatedStateDigestV1(binding)
    );
    if (stagingNodeModulesSlot.kind === 'absent') {
      throw new CompilerError('RUNTIME-DEPS-004', 'Project dependency stage disappeared before durable intent');
    }
    await assertProjectSourceGenerationCurrentV1({ binding, options, sourceGeneration });

    const currentBeforeIntent = await observeDependencyTransitionSlotV1(nodeModulesPath);
    await assertProjectProjectionPreimageV1({
      current: currentBeforeIntent,
      expectedBinding: binding,
      expectedLinkTarget: isolated ? null : sourceNodeModulesPath,
      expectedSourceGeneration: sourceGeneration,
      options,
      projectRoot: projectRootPath,
      runtimeSpec,
      targetPath: nodeModulesPath
    });
    const namespace = await ensureDependencyTransitionNamespaceV1(compilerDependencyRoot, options);
    const backupPath = currentBeforeIntent.kind === 'directory'
      ? path.join(
        namespace.backupRoot.path,
        `project-preimage-${generatedStateDigestV1({
          schema: 'sec-project-dependency-preimage-v1',
          projectRoot: projectRootPath,
          target: currentBeforeIntent,
          sourceGeneration
        }).slice('sha256:'.length, 'sha256:'.length + 32)}`
      )
      : null;
    transition = await beginDependencyTransitionV1({
      kind: 'project-projection',
      ownerRoot: compilerDependencyRoot,
      destinationPath: nodeModulesPath,
      stagePath: stagingNodeModulesPath,
      stageRootPath: stagingRoot,
      backupPath,
      sourceGeneration,
      bindingDigest: generatedStateDigestV1(binding),
      options
    });
    await invokeProjectProjectionHookV1(options, 'prepared');

    const currentPreimage = await observeDependencyTransitionSlotV1(nodeModulesPath);
    if (!transitionSlotMatchesV1(currentPreimage, transition.preimage)) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Project dependency preimage changed before backup; physical target is preserved');
    }
    await assertProjectProjectionPreimageV1({
      current: currentPreimage,
      expectedBinding: binding,
      expectedLinkTarget: isolated ? null : sourceNodeModulesPath,
      expectedSourceGeneration: sourceGeneration,
      options,
      projectRoot: projectRootPath,
      runtimeSpec,
      targetPath: nodeModulesPath
    });
    if (currentPreimage.kind === 'directory') {
      if (backupPath === null) throw new CompilerError('RUNTIME-DEPS-004', 'Project dependency directory has no owned backup path');
      await renameCompilerDependencyDirectory(nodeModulesPath, backupPath, options);
    } else if (currentPreimage.kind === 'link') {
      await deleteExactDependencyLocatorV1(nodeModulesPath, currentPreimage, options);
    }
    transition = await advanceDependencyTransitionV1(transition, {
      destination: transitionAbsentSlotV1(nodeModulesPath),
      backup: backupPath === null ? null : await observeDependencyTransitionSlotV1(backupPath),
      phase: 'backed-up',
      durability: 'known',
      failure: null
    }, options);
    await invokeProjectProjectionHookV1(options, 'backed-up');

    await assertProjectSourceGenerationCurrentV1({ binding, options, sourceGeneration });
    if (isolated) {
      await renameCompilerDependencyDirectory(stagingNodeModulesPath, nodeModulesPath, options);
    } else {
      await renameDependencyLocatorV1(
        stagingNodeModulesPath,
        nodeModulesPath,
        sourceNodeModulesPath,
        options
      );
    }
    transition = await advanceDependencyTransitionV1(transition, {
      destination: await observeDependencyTransitionSlotV1(nodeModulesPath, generatedStateDigestV1(binding)),
      stage: transitionAbsentSlotV1(stagingNodeModulesPath),
      phase: 'published',
      durability: 'known',
      failure: null
    }, options);
    await invokeProjectProjectionHookV1(options, 'published');

    const validated = await assertProjectProjectionPublishedV1({
      binding,
      compilerDependencyRoot,
      isolated,
      nodeModulesPath,
      options,
      runtimeSpec,
      sourceGeneration,
      sourceNodeModulesPath
    });
    transition = await advanceDependencyTransitionV1(transition, {
      destination: await observeDependencyTransitionSlotV1(nodeModulesPath, generatedStateDigestV1(binding)),
      phase: 'binding-validated',
      durability: 'known',
      failure: null
    }, options);
    await invokeProjectProjectionHookV1(options, 'binding-validated');

    await options.beforeCommit?.();
    const stamp = Object.freeze({
      binding,
      formatVersion: 'runtime-deps-stamp-v4' as const,
      manifestHash: runtimeSpec.manifestHash,
      packageManager: 'bun' as const,
      installedAt: (options.now ?? (() => new Date().toISOString()))(),
      sourceGeneration: validated.sourceGeneration,
      target: validated.target
    });
    await writeRuntimeDepsStamp(stampPath, stamp, options.beforeCommit);
    const stampReadback = await readRuntimeDepsStamp(stampPath);
    if (stampReadback === null || !canonicalEquals(stampReadback, stamp)) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Project dependency stamp failed exact readback; recovery is required');
    }
    transition = await advanceDependencyTransitionV1(transition, {
      destination: await observeDependencyTransitionSlotV1(nodeModulesPath, generatedStateDigestV1(binding)),
      sourceGeneration: validated.sourceGeneration,
      phase: 'stamp-readback',
      durability: 'known',
      failure: null
    }, options);
    await invokeProjectProjectionHookV1(options, 'stamp-readback');

    await disposeDependencyTransitionStageV1(
      compilerDependencyRoot,
      stagingRoot,
      runtimeDependencyOperationOptionsV1({ ...options, generatedStateLifecycle: undefined }),
      'project-projection-published',
      transition.stage,
      transition.stageRoot,
      projectDependencyStageAuthorityV1(projectRootPath)
    );
    transition = await advanceDependencyTransitionV1(transition, {
      destination: await observeDependencyTransitionSlotV1(nodeModulesPath, generatedStateDigestV1(binding)),
      stage: transitionAbsentSlotV1(stagingNodeModulesPath),
      stageRoot: transitionAbsentSlotV1(stagingRoot),
      backup: transition.backup,
      phase: 'complete',
      durability: 'known',
      failure: null
    }, options);
  } catch (error) {
    if (transition !== null) {
      await markDependencyTransitionFailureV1(transition, error, options).catch(() => undefined);
    } else {
      await disposeDependencyTransitionStageV1(
        compilerDependencyRoot,
        stagingRoot,
        runtimeDependencyOperationOptionsV1({ ...options, generatedStateLifecycle: undefined }),
        'project-projection-staging-failed',
        stagingNodeModulesSlot,
        stagingRootSlot,
        projectDependencyStageAuthorityV1(projectRootPath)
      ).catch(() => undefined);
    }
    const cause = error instanceof Error ? error.message : String(error);
    throw new CompilerError('RUNTIME-DEPS-004', `Project dependency projection requires recovery: ${cause}`, {
      cause,
      transitionDigest: transition?.recordDigest ?? null,
      recoveryRequired: transition !== null
    });
  }
}

function assertDirectStageRootSelectorV1(
  stageRoot: DependencyTransitionSlotV1,
  parent: string,
  prefix: string
): void {
  const stageRootPath = path.resolve(stageRoot.path);
  if (path.dirname(stageRootPath) !== path.resolve(parent) ||
      !path.basename(stageRootPath).startsWith(prefix)) {
    throw new CompilerError(
      'RUNTIME-DEPS-004',
      'Dependency transition stage root is outside its canonical operation selector',
      { stageRootPath, parent: path.resolve(parent), prefix }
    );
  }
  if (stageRoot.kind !== 'directory' && stageRoot.kind !== 'absent') {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition stage root is not an ordinary directory slot');
  }
}

function assertTransitionBackupSelectorV1(
  transition: DependencyTransitionJournalV1,
  expectedPath?: string
): void {
  if (transition.backup === null) return;
  const backupParent = path.join(
    transition.ownerRoot, '.tmp', 'dependency-installs', 'compiler-backups'
  );
  if (path.dirname(transition.backup.path) !== backupParent ||
      !/^(?:node_modules|locator-preimage|runtime|project-preimage)-[0-9a-f]{16,64}$/u.test(path.basename(transition.backup.path))) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition backup path is outside its canonical selector');
  }
  if (expectedPath !== undefined && path.resolve(transition.backup.path) !== path.resolve(expectedPath)) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency transition backup path is not the operation-derived slot');
  }
}

function compilerTransitionBackupPathV1(
  ownerRoot: string,
  prefix: 'node_modules' | 'locator-preimage' | 'runtime',
  sourceGeneration: RuntimeDependencySourceGenerationV1
): string {
  const namespace = dependencyTransitionNamespacePaths(path.resolve(ownerRoot));
  return path.join(
    namespace.backupRoot,
    `${prefix}-${sourceGeneration.epoch.slice('sha256:'.length, 'sha256:'.length + 24)}`
  );
}

function projectTransitionBackupPathV1(
  ownerRoot: string,
  projectRoot: string,
  preimage: DependencyTransitionSlotV1,
  sourceGeneration: RuntimeDependencySourceGenerationV1
): string {
  const namespace = dependencyTransitionNamespacePaths(path.resolve(ownerRoot));
  return path.join(
    namespace.backupRoot,
    `project-preimage-${generatedStateDigestV1({
      schema: 'sec-project-dependency-preimage-v1',
      projectRoot: path.resolve(projectRoot),
      target: preimage,
      sourceGeneration
    }).slice('sha256:'.length, 'sha256:'.length + 32)}`
  );
}

function assertTransitionOperationKeyV1(
  transition: DependencyTransitionJournalV1
): void {
  const expected = transitionOperationKeyV1({
    kind: transition.kind,
    ownerRoot: transition.ownerRoot,
    destinationPath: transition.destination.path,
    preimage: transition.preimage,
    stage: transition.stage,
    stageRoot: transition.stageRoot,
    backup: transition.backup,
    sourceGeneration: transition.sourceGeneration
  });
  if (expected !== transition.operationKey) {
    throw new CompilerError(
      'RUNTIME-DEPS-004',
      'Dependency transition operation identity is not bound to its canonical topology',
      {
        expectedOperationKey: expected,
        actualOperationKey: transition.operationKey,
        recordDigest: transition.recordDigest,
        kind: transition.kind,
        phase: transition.phase,
        attemptNonce: transition.attemptNonce,
        sequence: transition.sequence,
        previousRecordDigest: transition.previousRecordDigest,
        ownerRoot: transition.ownerRoot,
        destinationPath: transition.destination.path,
        preimage: transition.preimage,
        stagePath: transition.stage?.path ?? null,
        stageRootPath: transition.stageRoot?.path ?? null,
        backupPath: transition.backup?.path ?? null,
        sourceGeneration: transition.sourceGeneration
      }
    );
  }
}

function assertCompilerTransitionRecoveryTopologyV1(
  transition: DependencyTransitionJournalV1,
  root: string,
  nodeModulesPath: string
): void {
  const canonicalRoot = path.resolve(root);
  const canonicalDestination = path.resolve(nodeModulesPath);
  if (transition.ownerRoot !== canonicalRoot || transition.destination.path !== canonicalDestination ||
      transition.preimage.path !== canonicalDestination) {
    throw new CompilerError('IMPORT-AUTHORITY-004', 'Compiler transition journal targets a foreign canonical path');
  }
  assertTransitionOperationKeyV1(transition);
  const expectedBackupPath = transition.kind === 'compiler-generation'
    ? compilerTransitionBackupPathV1(canonicalRoot, 'node_modules', transition.sourceGeneration)
    : transition.kind === 'compiler-locator'
      ? compilerTransitionBackupPathV1(canonicalRoot, 'locator-preimage', transition.sourceGeneration)
      : transition.kind === 'runtime-projection'
        ? compilerTransitionBackupPathV1(canonicalRoot, 'runtime', transition.sourceGeneration)
        : undefined;
  assertTransitionBackupSelectorV1(transition, expectedBackupPath);
  if (transition.kind === 'compiler-generation') {
    if (transition.stage === null || transition.stageRoot === null) {
      throw new CompilerError('IMPORT-AUTHORITY-004', 'Compiler generation transition has no canonical staging slots');
    }
    assertDirectStageRootSelectorV1(
      transition.stageRoot,
      path.join(canonicalRoot, '.tmp', 'dependency-installs'),
      'c.staging-'
    );
    if (transition.stage.path !== path.join(transition.stageRoot.path, 'node_modules')) {
      throw new CompilerError('IMPORT-AUTHORITY-004', 'Compiler generation transition stage is not its exact node_modules child');
    }
    if (transition.sourceGeneration.ownerRoot !== canonicalRoot ||
        (transition.sourceGeneration.sourcePath !== transition.stage.path &&
          transition.sourceGeneration.sourcePath !== canonicalDestination)) {
      throw new CompilerError('IMPORT-AUTHORITY-004', 'Compiler generation transition source path is foreign');
    }
    return;
  }
  if (transition.kind === 'compiler-locator') {
    if (transition.stage !== null || transition.stageRoot !== null ||
        transition.sourceGeneration.sourcePath === canonicalDestination ||
        path.basename(transition.sourceGeneration.sourcePath) !== 'node_modules') {
      throw new CompilerError('IMPORT-AUTHORITY-004', 'Compiler locator transition topology is foreign');
    }
    return;
  }
  if (transition.kind === 'runtime-projection') {
    if (transition.stage === null || transition.stageRoot === null) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Runtime projection transition has no canonical staging slots');
    }
    const sharedRoot = dependencyAuthorityPaths(canonicalRoot).sharedDepsRoot;
    assertDirectStageRootSelectorV1(transition.stageRoot, sharedRoot, '.runtime-generation-');
    if (transition.stage.path !== path.join(transition.stageRoot.path, 'node_modules')) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Runtime projection stage is not its exact node_modules child');
    }
    return;
  }
  if (transition.kind === 'compiler-bridge') {
    throw new CompilerError(
      'RUNTIME-DEPS-004',
      'Compiler bridge recovery must use its project bridge owner boundary'
    );
  }
  throw new CompilerError('RUNTIME-DEPS-004', 'Compiler recovery cannot consume a project transition');
}

function assertProjectTransitionRecoveryTopologyV1(
  transition: DependencyTransitionJournalV1,
  input: ProjectProjectionTransitionInputV1
): void {
  const compilerRoot = path.resolve(input.compilerDependencyRoot);
  const target = path.resolve(input.nodeModulesPath);
  if (transition.ownerRoot !== compilerRoot || transition.destination.path !== target ||
      transition.preimage.path !== target || transition.kind !== 'project-projection') {
    throw new CompilerError('RUNTIME-DEPS-004', 'Project transition journal targets a foreign canonical path');
  }
  assertTransitionOperationKeyV1(transition);
  assertTransitionBackupSelectorV1(
    transition,
    transition.backup === null
      ? undefined
      : projectTransitionBackupPathV1(
        compilerRoot,
        input.projectRootPath,
        transition.preimage,
        transition.sourceGeneration
      )
  );
  if (transition.stage === null || transition.stageRoot === null) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Project transition has no canonical staging slots');
  }
  assertDirectStageRootSelectorV1(
    transition.stageRoot,
    path.join(path.resolve(input.projectRootPath), '.tmp'),
    'project.staging-'
  );
  if (transition.stage.path !== path.join(transition.stageRoot.path, 'node_modules')) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Project transition stage is not its exact node_modules child');
  }
  if (!sameHostPath(transition.sourceGeneration.sourcePath, input.sourceNodeModulesPath)) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Project transition source generation path is foreign');
  }
}

async function recoverProjectDependencyTransitionV1(
  input: ProjectProjectionTransitionInputV1
): Promise<void> {
  const initial = await readDependencyTransitionV1(input.compilerDependencyRoot, input.options);
  if (initial === null || initial.kind !== 'project-projection' ||
      initial.phase === 'complete' || initial.phase === 'rolled-back') return;
  let transition = initial;
  const failRecovery = async (error: unknown): Promise<never> => {
    await markDependencyTransitionFailureV1(transition, error, input.options).catch(() => undefined);
    const cause = error instanceof Error ? error.message : String(error);
    throw new CompilerError('RUNTIME-DEPS-004', `Project dependency transition requires owner recovery: ${cause}`, {
      cause,
      transitionDigest: transition.recordDigest,
      recoveryRequired: true
    });
  };
  try {
    assertProjectTransitionRecoveryTopologyV1(initial, input);
    const owner = inspectNoFollowDirectoryChainV1(
      input.compilerDependencyRoot,
      'Project dependency transition owner root recovery'
    ).target;
    if (!sameGeneratedStateIdentityV1(
      generatedStatePhysicalIdentityV1(owner),
      transition.ownerRootPhysical
    )) {
      return failRecovery(new CompilerError('RUNTIME-DEPS-004', 'Project dependency transition owner root identity changed'));
    }
    if (transition.sourceGeneration.bindingDigest !== generatedStateDigestV1(input.binding) ||
        transition.sourceGeneration.epoch !== input.sourceGeneration.epoch ||
        !sameRuntimeDependencySourceGenerationContentV1(transition.sourceGeneration, input.sourceGeneration) ||
        !sameGeneratedStateIdentityV1(transition.sourceGeneration.physical, input.sourceGeneration.physical) ||
        !sameGeneratedStateIdentityV1(transition.sourceGeneration.ownerRootPhysical, input.sourceGeneration.ownerRootPhysical)) {
      return failRecovery(new CompilerError('RUNTIME-DEPS-004', 'Project dependency transition source generation is foreign or stale'));
    }

    const stagePath = transition.stage?.path ?? null;
    const stageRootPath = transition.stageRoot?.path ?? null;
    const backupPath = transition.backup?.path ?? null;
    let active = await observeDependencyTransitionSlotV1(transition.destination.path);
    let stage = stagePath === null ? null : await observeDependencyTransitionSlotV1(stagePath);
    let stageRoot = stageRootPath === null ? null : await observeDependencyTransitionSlotV1(stageRootPath);
    let backup = backupPath === null ? null : await observeDependencyTransitionSlotV1(backupPath);

    if (transition.stageRoot !== null &&
        (stageRoot === null || !transitionSlotMatchesV1(stageRoot, transition.stageRoot))) {
      const alreadyDisposed = transition.stageRoot.kind === 'directory' &&
        transition.stage?.kind === 'absent' && stageRoot?.kind === 'absent' &&
        (transition.phase === 'published' || transition.phase === 'binding-validated' ||
          transition.phase === 'stamp-readback' || transition.phase === 'recovery-required');
      if (!alreadyDisposed) {
        return failRecovery(new CompilerError('RUNTIME-DEPS-004', 'Project dependency staging root identity changed and is preserved'));
      }
    }

    if (transition.backup !== null) {
      if (transition.backup.kind === 'absent') {
        if (backup === null || backup.kind !== 'absent') {
          return failRecovery(new CompilerError('RUNTIME-DEPS-004', 'Foreign project dependency backup is preserved'));
        }
      } else if (backup === null || !transitionSlotMatchesV1(backup, transition.backup)) {
        return failRecovery(new CompilerError('RUNTIME-DEPS-004', 'Project dependency backup identity changed and is preserved'));
      }
    }

    const expectedLinkTarget = input.isolated ? null : input.sourceNodeModulesPath;
    const preimageMatches = transitionSlotMatchesV1(active, transition.preimage);
    if (transition.phase === 'prepared' ||
        (transition.phase === 'recovery-required' && transition.destination.kind === transition.preimage.kind &&
          preimageMatches)) {
      if (!preimageMatches) {
        if (active.kind !== 'absent' || transition.preimage.kind === 'absent' ||
            backup === null || backup.kind !== 'directory' ||
            transition.backup === null || !transitionSlotMatchesV1(backup, transition.backup)) {
          return failRecovery(new CompilerError('RUNTIME-DEPS-004', 'Project dependency preimage topology is unknown and preserved'));
        }
      } else {
        await assertProjectProjectionPreimageV1({
          current: active,
          expectedBinding: input.binding,
          expectedLinkTarget,
          expectedSourceGeneration: input.sourceGeneration,
          options: input.options,
          projectRoot: input.projectRootPath,
          runtimeSpec: input.runtimeSpec,
          targetPath: input.nodeModulesPath
        });
        if (active.kind === 'directory') {
          if (backupPath === null) return failRecovery(new CompilerError('RUNTIME-DEPS-004', 'Project dependency preimage has no operation-owned backup'));
          await renameCompilerDependencyDirectory(input.nodeModulesPath, backupPath, input.options);
        } else if (active.kind === 'link') {
          await deleteExactDependencyLocatorV1(input.nodeModulesPath, active, input.options);
        }
        active = await observeDependencyTransitionSlotV1(input.nodeModulesPath);
        backup = backupPath === null ? null : await observeDependencyTransitionSlotV1(backupPath);
        transition = await advanceDependencyTransitionV1(transition, {
          destination: transitionAbsentSlotV1(input.nodeModulesPath),
          backup,
          phase: 'backed-up',
          durability: 'known',
          failure: null
        }, input.options);
      }
    }

    active = await observeDependencyTransitionSlotV1(input.nodeModulesPath);
    stage = stagePath === null ? null : await observeDependencyTransitionSlotV1(stagePath);
    if (transition.phase === 'backed-up' || transition.phase === 'recovery-required' ||
        transition.phase === 'prepared') {
      if (active.kind === 'absent' && stage !== null && stage.kind !== 'absent') {
        await assertProjectSourceGenerationCurrentV1({
          binding: input.binding,
          options: input.options,
          sourceGeneration: input.sourceGeneration
        });
        if (input.isolated) {
          if (stage.kind !== 'directory') return failRecovery(new CompilerError('RUNTIME-DEPS-004', 'Project dependency staged directory is foreign and preserved'));
          await renameCompilerDependencyDirectory(stagePath!, input.nodeModulesPath, input.options);
        } else {
          if (stage.kind !== 'link') return failRecovery(new CompilerError('RUNTIME-DEPS-004', 'Project dependency staged bridge is foreign and preserved'));
          await renameDependencyLocatorV1(stagePath!, input.nodeModulesPath, input.sourceNodeModulesPath, input.options);
        }
        active = await observeDependencyTransitionSlotV1(input.nodeModulesPath, generatedStateDigestV1(input.binding));
        stage = await observeDependencyTransitionSlotV1(stagePath!);
        transition = await advanceDependencyTransitionV1(transition, {
          destination: active,
          stage,
          stageRoot,
          phase: 'published',
          durability: 'known',
          failure: null
        }, input.options);
      } else if (active.kind !== 'absent') {
        if (transition.destination.kind !== 'absent' &&
            !transitionSlotMatchesV1(active, transition.destination)) {
          return failRecovery(new CompilerError('RUNTIME-DEPS-004', 'Project dependency published target identity is foreign and preserved'));
        }
        if (transition.destination.kind === 'absent' &&
            (transition.phase !== 'recovery-required' || stage === null || stage.kind === 'absent')) {
          return failRecovery(new CompilerError('RUNTIME-DEPS-004', 'Project dependency target appeared without a durable publish receipt'));
        }
      } else if (transition.phase !== 'recovery-required') {
        return failRecovery(new CompilerError('RUNTIME-DEPS-004', 'Project dependency transition has no staged or active target'));
      }
    }

    active = await observeDependencyTransitionSlotV1(input.nodeModulesPath, generatedStateDigestV1(input.binding));
    if (active.kind === 'absent') {
      return failRecovery(new CompilerError('RUNTIME-DEPS-004', 'Project dependency transition has no recoverable target'));
    }
    if (transition.destination.kind !== 'absent' && !transitionSlotMatchesV1(active, transition.destination)) {
      return failRecovery(new CompilerError('RUNTIME-DEPS-004', 'Project dependency destination identity changed and is preserved'));
    }
    const validated = await assertProjectProjectionPublishedV1({
      binding: input.binding,
      compilerDependencyRoot: input.compilerDependencyRoot,
      isolated: input.isolated,
      nodeModulesPath: input.nodeModulesPath,
      options: input.options,
      runtimeSpec: input.runtimeSpec,
      sourceGeneration: input.sourceGeneration,
      sourceNodeModulesPath: input.sourceNodeModulesPath
    });
    transition = await advanceDependencyTransitionV1(transition, {
      destination: await observeDependencyTransitionSlotV1(input.nodeModulesPath, generatedStateDigestV1(input.binding)),
      stage: stagePath === null ? null : await observeDependencyTransitionSlotV1(stagePath),
      stageRoot,
      phase: 'binding-validated',
      durability: 'known',
      failure: null
    }, input.options);

    const stampState = await observeProjectStampV1(input.projectRootPath);
    if (stampState.stamp !== null &&
        stampState.stamp.binding.revision !== input.binding.revision) {
      return failRecovery(new CompilerError('RUNTIME-DEPS-004', 'Foreign project dependency stamp is preserved'));
    }
    const stamp = Object.freeze({
      binding: input.binding,
      formatVersion: 'runtime-deps-stamp-v4' as const,
      manifestHash: input.runtimeSpec.manifestHash,
      packageManager: 'bun' as const,
      installedAt: stampState.stamp?.binding.revision === input.binding.revision
        ? stampState.stamp.installedAt
        : (input.options.now ?? (() => new Date().toISOString()))(),
      sourceGeneration: validated.sourceGeneration,
      target: validated.target
    });
    if (stampState.stamp === null || !canonicalEquals(stampState.stamp, stamp)) {
      await writeRuntimeDepsStamp(input.stampPath, stamp, input.options.beforeCommit);
    }
    const stampReadback = await readRuntimeDepsStamp(input.stampPath);
    if (stampReadback === null || !canonicalEquals(stampReadback, stamp)) {
      return failRecovery(new CompilerError('RUNTIME-DEPS-004', 'Recovered project dependency stamp failed exact readback'));
    }
    transition = await advanceDependencyTransitionV1(transition, {
      destination: await observeDependencyTransitionSlotV1(input.nodeModulesPath, generatedStateDigestV1(input.binding)),
      sourceGeneration: validated.sourceGeneration,
      phase: 'stamp-readback',
      durability: 'known',
      failure: null
    }, input.options);
    if (stagePath !== null) {
      await disposeDependencyTransitionStageV1(
        input.compilerDependencyRoot,
        path.dirname(stagePath),
        runtimeDependencyOperationOptionsV1({ ...input.options, generatedStateLifecycle: undefined }),
        'project-projection-recovered',
        transition.stage,
        transition.stageRoot,
        projectDependencyStageAuthorityV1(input.projectRootPath)
      );
    }
    await advanceDependencyTransitionV1(transition, {
      destination: await observeDependencyTransitionSlotV1(input.nodeModulesPath, generatedStateDigestV1(input.binding)),
      stage: stagePath === null ? null : transitionAbsentSlotV1(stagePath),
      stageRoot: stageRootPath === null ? null : transitionAbsentSlotV1(stageRootPath),
      backup: transition.backup,
      phase: 'complete',
      durability: 'known',
      failure: null
    }, input.options);
  } catch (error) {
    return failRecovery(error);
  }
}

async function resolveProjectDependencyBridgeTarget(): Promise<string> {
  const target = dependencyAuthorityPaths().compilerModulesRoot;
  return path.resolve(await fs.realpath(target));
}

type CompilerDependencyBridgeSourceObservationV1 = Readonly<{
  binding: Readonly<CompilerDepsBinding>;
  ownerRoot: string;
  sourceGeneration: Readonly<RuntimeDependencySourceGenerationV1>;
  sourcePath: string;
}>;

/**
 * Reconstructs bridge provenance from the canonical compiler generation.  A
 * bridge journal never treats its caller-supplied source path or a link's
 * current realpath as authority: the owner root, binding, tree digest and
 * source physical identity are all rebuilt before a bridge effect or
 * recovery effect is admitted.
 */
async function compilerDependencyBridgeSourceObservationV1(
  sourcePath: string,
  options: RuntimeDependencyOperationOptionsV1,
  expected?: Readonly<{
    bindingDigest: `sha256:${string}`;
    epoch: `sha256:${string}`;
    physical: GeneratedStatePhysicalIdentityV1;
    sourcePath: string;
    treeDigest: `sha256:${string}`;
    treeEntryCount: number;
  }>
): Promise<CompilerDependencyBridgeSourceObservationV1> {
  const absoluteSourcePath = path.resolve(sourcePath);
  if (path.basename(absoluteSourcePath).toLocaleLowerCase('en-US') !== 'node_modules') {
    throw new CompilerError(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency bridge source is outside the canonical node_modules generation'
    );
  }
  const ownerRoot = path.dirname(absoluteSourcePath);
  const ownerIdentity = await compilerDependencyIdentity(ownerRoot);
  const binding = await compilerDependencyGenerationBinding(
    ownerRoot,
    absoluteSourcePath,
    path.join(absoluteSourcePath, COMPILER_DEPS_BINDING_FILE),
    ownerIdentity
  );
  if (binding === null) {
    throw new CompilerError(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency bridge source has no current canonical generation binding'
    );
  }
  const sourceGeneration = await runtimeDependencySourceGenerationV1({
    binding,
    options,
    ownerRoot,
    sourcePath: absoluteSourcePath
  });
  if (expected !== undefined && (
    sourceGeneration.sourcePath !== path.resolve(expected.sourcePath) ||
    generatedStateDigestV1(binding) !== expected.bindingDigest ||
    sourceGeneration.epoch !== expected.epoch ||
    sourceGeneration.treeDigest !== expected.treeDigest ||
    sourceGeneration.treeEntryCount !== expected.treeEntryCount ||
    !sameGeneratedStateIdentityV1(sourceGeneration.physical, expected.physical)
  )) {
    throw new CompilerError(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency bridge source generation changed and is preserved'
    );
  }
  return Object.freeze({
    binding,
    ownerRoot,
    sourceGeneration,
    sourcePath: absoluteSourcePath
  });
}

function assertCompilerDependencyBridgeTransitionTopologyV1(
  transition: DependencyTransitionJournalV1,
  compilerDependencyRoot: string,
  bridgePath: string
): void {
  const ownerRoot = path.resolve(compilerDependencyRoot);
  const destination = path.resolve(bridgePath);
  if (transition.kind !== 'compiler-bridge' ||
      transition.ownerRoot !== ownerRoot ||
      transition.destination.path !== destination ||
      transition.preimage.path !== destination ||
      transition.preimage.kind !== 'absent' ||
      transition.stage !== null || transition.stageRoot !== null || transition.backup !== null ||
      transition.sourceGeneration.ownerRoot !== path.dirname(transition.sourceGeneration.sourcePath) ||
      path.basename(transition.sourceGeneration.sourcePath).toLocaleLowerCase('en-US') !== 'node_modules' ||
      path.resolve(destination) === path.resolve(transition.sourceGeneration.sourcePath)) {
    throw new CompilerError(
      'IMPORT-AUTHORITY-004',
      'Compiler bridge transition journal targets a foreign canonical topology'
    );
  }
  assertTransitionOperationKeyV1(transition);
}

function compilerDependencyBridgeLinkMatchesV1(
  bridgePath: string,
  source: CompilerDependencyBridgeSourceObservationV1,
  expected?: DependencyTransitionSlotV1
): boolean {
  const bridgeRoot = path.dirname(path.resolve(bridgePath));
  const bridgeName = path.basename(path.resolve(bridgePath));
  const bridge = inspectNoFollowLinkEntryV1(
    inspectNoFollowDirectoryChainV1(bridgeRoot, 'Compiler dependency bridge consumer root').target,
    bridgeName
  );
  if (bridge === null || bridge.kind !== 'link' || bridge.linkTarget === null ||
      !sameHostPath(bridge.linkTarget, source.sourcePath)) return false;
  if (expected !== undefined) {
    const observed = transitionSlotFromPhysicalV1({
      path: bridgePath,
      kind: 'link',
      physical: Object.freeze({
        device: bridge.device,
        inode: bridge.inode,
        objectId: generatedStateDigestV1({ kind: 'link', target: bridge.linkTarget })
      }),
      linkTarget: bridge.linkTarget,
      bindingDigest: expected.bindingDigest
    });
    if (!transitionSlotMatchesV1(observed, expected)) return false;
  }
  return true;
}

async function recoverCompilerDependencyBridgeTransitionV1(
  compilerDependencyRoot: string,
  bridgeConsumerRoot: string,
  options: RuntimeDependencyOperationOptionsV1
): Promise<void> {
  const ownerRoot = path.resolve(compilerDependencyRoot);
  const bridgePath = path.join(path.resolve(bridgeConsumerRoot), 'node_modules');
  const initial = await readDependencyTransitionV1(ownerRoot, options);
  if (initial === null || initial.phase === 'complete' || initial.phase === 'rolled-back') return;
  if (initial.kind !== 'compiler-bridge') {
    throw new CompilerError(
      'RUNTIME-DEPS-004',
      'Compiler bridge recovery found another active compiler transition; residue is preserved'
    );
  }
  let transition = initial;
  const failRecovery = async (error: unknown): Promise<never> => {
    await markDependencyTransitionFailureV1(transition, error, options).catch(() => undefined);
    throw new CompilerError('IMPORT-AUTHORITY-004', 'Compiler dependency bridge requires owner recovery', {
      cause: error instanceof Error ? error.message : String(error),
      transitionDigest: transition.recordDigest,
      recoveryRequired: true
    });
  };

  try {
    assertCompilerDependencyBridgeTransitionTopologyV1(transition, ownerRoot, bridgePath);
    const ownerIdentity = inspectNoFollowDirectoryChainV1(
      ownerRoot,
      'Compiler dependency bridge owner root recovery'
    ).target;
    if (!sameGeneratedStateIdentityV1(
      generatedStatePhysicalIdentityV1(ownerIdentity),
      transition.ownerRootPhysical
    )) {
      return failRecovery(new CompilerError(
        'IMPORT-AUTHORITY-004',
        'Compiler dependency bridge owner root identity changed'
      ));
    }
    const source = await compilerDependencyBridgeSourceObservationV1(
      transition.sourceGeneration.sourcePath,
      options,
      transition.sourceGeneration
    ).catch((error) => failRecovery(error));
    let bridge = await observeDependencyTransitionSlotV1(bridgePath, transition.sourceGeneration.bindingDigest);
    const bridgeMatches = (): boolean => compilerDependencyBridgeLinkMatchesV1(
      bridgePath,
      source,
      transition.phase === 'prepared' || transition.phase === 'recovery-required'
        ? undefined
        : transition.destination
    );

    if (transition.phase === 'prepared') {
      if (bridge.kind === 'absent') {
        transition = await advanceDependencyTransitionV1(transition, {
          destination: transitionAbsentSlotV1(bridgePath),
          phase: 'rolled-back',
          durability: 'known',
          failure: null
        }, options);
        return;
      }
      if (bridge.kind !== 'link' || !bridgeMatches()) {
        return failRecovery(new CompilerError(
          'IMPORT-AUTHORITY-004',
          'Compiler dependency bridge contains a foreign pre-effect target and is preserved'
        ));
      }
      bridge = await observeDependencyTransitionSlotV1(bridgePath, transition.sourceGeneration.bindingDigest);
      transition = await advanceDependencyTransitionV1(transition, {
        destination: bridge,
        phase: 'published',
        durability: 'known',
        failure: null
      }, options);
    }

    if (transition.phase !== 'published' && transition.phase !== 'recovery-required') {
      return failRecovery(new CompilerError(
        'IMPORT-AUTHORITY-004',
        `Compiler dependency bridge has unsupported recovery phase ${transition.phase}`
      ));
    }
    bridge = await observeDependencyTransitionSlotV1(bridgePath, transition.sourceGeneration.bindingDigest);
    if (bridge.kind === 'absent') {
      transition = await advanceDependencyTransitionV1(transition, {
        destination: transitionAbsentSlotV1(bridgePath),
        phase: 'rolled-back',
        durability: 'known',
        failure: null
      }, options);
      return;
    }
    if (bridge.kind !== 'link' || !bridgeMatches()) {
      return failRecovery(new CompilerError(
        'IMPORT-AUTHORITY-004',
        'Compiler dependency bridge recovery target is foreign and preserved'
      ));
    }
    const locator = compilerDependencyLocatorObservationV1(
      path.resolve(bridgeConsumerRoot),
      'node_modules'
    );
    if (locator === null) {
      return failRecovery(new CompilerError(
        'IMPORT-AUTHORITY-004',
        'Compiler dependency bridge locator disappeared before exact cleanup'
      ));
    }
    await deleteExactCompilerDependencyLocatorV1(path.resolve(bridgeConsumerRoot), locator, options);
    const after = await observeDependencyTransitionSlotV1(bridgePath);
    if (after.kind !== 'absent') {
      return failRecovery(new CompilerError(
        'IMPORT-AUTHORITY-004',
        'Compiler dependency bridge cleanup failed exact absence readback'
      ));
    }
    await options.beforeCommit?.();
    await advanceDependencyTransitionV1(transition, {
      destination: after,
      phase: 'rolled-back',
      durability: 'known',
      failure: null
    }, options);
  } catch (error) {
    return failRecovery(error);
  }
}

export async function withProjectDependencyBridge<T>(
  projectRoot: string,
  callback: () => Promise<T>,
  options: RuntimeDependencyInstallOptions = {}
): Promise<T> {
  const operationOptions = runtimeDependencyOperationOptionsV1(options);
  const consumerRoot = path.resolve(projectRoot);
  const bridgePath = path.join(consumerRoot, 'node_modules');
  const sourcePath = await resolveProjectDependencyBridgeTarget();
  // The bridge's source is allowed to be a physical projection outside this
  // worktree (for example, a junction-backed shared node_modules tree), but
  // its transition journal and lease belong to the canonical lexical
  // compiler root.  Using dirname(sourcePath) here would silently move the
  // owner into that physical projection and mutate a different repository's
  // .tmp/dependency-installs namespace.
  const compilerDependencyRoot = path.resolve(compilerRoot);
  return withCompilerDependencyTransitionLeaseV1(compilerDependencyRoot, operationOptions, async () => {
    // The lease admits recovery before this call observes the bridge.  A
    // prepared/published bridge left by a crashed process is therefore never
    // silently adopted by a later callback.
    await recoverCompilerDependencyBridgeTransitionV1(
      compilerDependencyRoot,
      consumerRoot,
      operationOptions
    );
    const source = await compilerDependencyBridgeSourceObservationV1(sourcePath, operationOptions);
    const existing = await observeDependencyTransitionSlotV1(
      bridgePath,
      generatedStateDigestV1(source.binding)
    );
    if (existing.kind !== 'absent') {
      if (existing.kind !== 'link' || !compilerDependencyBridgeLinkMatchesV1(bridgePath, source, existing)) {
        throw new CompilerError(
          'IMPORT-AUTHORITY-004',
          'Existing project dependency bridge is foreign and preserved'
        );
      }
      runtimeDependencyOperationRemainingMsV1(operationOptions, 'Project dependency bridge callback admission');
      const result = await callback();
      runtimeDependencyOperationRemainingMsV1(operationOptions, 'Project dependency bridge callback settlement');
      await compilerDependencyBridgeSourceObservationV1(source.sourcePath, operationOptions, source.sourceGeneration);
      const after = await observeDependencyTransitionSlotV1(bridgePath);
      if (after.kind !== 'link' || !compilerDependencyBridgeLinkMatchesV1(bridgePath, source, after)) {
        throw new CompilerError(
          'IMPORT-AUTHORITY-004',
          'Existing project dependency bridge changed during callback and is preserved'
        );
      }
      return result;
    }

    let transition = await beginDependencyTransitionV1({
      kind: 'compiler-bridge',
      ownerRoot: compilerDependencyRoot,
      destinationPath: bridgePath,
      stagePath: null,
      stageRootPath: null,
      backupPath: null,
      sourceGeneration: source.sourceGeneration,
      bindingDigest: generatedStateDigestV1(source.binding),
      options: operationOptions
    });
    try {
      await createCompilerDependencyLocatorV1(
        bridgePath,
        source.sourcePath,
        source.sourceGeneration.physical,
        operationOptions
      );
      const published = await observeDependencyTransitionSlotV1(
        bridgePath,
        generatedStateDigestV1(source.binding)
      );
      if (published.kind !== 'link' || !compilerDependencyBridgeLinkMatchesV1(bridgePath, source, published)) {
        throw new CompilerError(
          'IMPORT-AUTHORITY-004',
          'Compiler dependency bridge publication failed exact link readback'
        );
      }
      transition = await advanceDependencyTransitionV1(transition, {
        destination: published,
        phase: 'published',
        durability: 'known',
        failure: null
      }, operationOptions);
      runtimeDependencyOperationRemainingMsV1(operationOptions, 'Project dependency bridge callback admission');
      const result = await callback();
      runtimeDependencyOperationRemainingMsV1(operationOptions, 'Project dependency bridge callback settlement');
      await compilerDependencyBridgeSourceObservationV1(source.sourcePath, operationOptions, source.sourceGeneration);
      await removeCompilerDependencyBridgeV1(consumerRoot, source, transition, operationOptions);
      return result;
    } catch (error) {
      try {
        await removeCompilerDependencyBridgeV1(consumerRoot, source, transition, operationOptions);
      } catch (cleanupError) {
        throw new CompilerError('IMPORT-AUTHORITY-004', 'Compiler dependency bridge residue is preserved for recovery', {
          cause: error instanceof Error ? error.message : String(error),
          cleanup: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          transitionDigest: transition.recordDigest
        });
      }
      throw error;
    }
  });
}

async function removeCompilerDependencyBridgeV1(
  consumerRoot: string,
  source: CompilerDependencyBridgeSourceObservationV1,
  transition: DependencyTransitionJournalV1,
  options: RuntimeDependencyOperationOptionsV1
): Promise<void> {
  if (transition.phase === 'rolled-back' || transition.phase === 'complete') return;
  // A link is operation-owned only while the compiler generation it names is
  // the exact source generation admitted in the journal.  Re-prove that fact
  // before cleanup as well as before publication; otherwise a callback error
  // could turn a source-path drift into an implicit delete authority.
  await compilerDependencyBridgeSourceObservationV1(source.sourcePath, options, source.sourceGeneration);
  const bridgePath = path.join(path.resolve(consumerRoot), 'node_modules');
  const current = await observeDependencyTransitionSlotV1(bridgePath);
  if (current.kind === 'absent') {
    await advanceDependencyTransitionV1(transition, {
      destination: transitionAbsentSlotV1(bridgePath),
      phase: 'rolled-back',
      durability: 'known',
      failure: null
    }, options);
    return;
  }
  if (current.kind !== 'link' || !compilerDependencyBridgeLinkMatchesV1(bridgePath, source, transition.destination)) {
    throw new CompilerError('IMPORT-AUTHORITY-004', 'Compiler dependency bridge changed before exact cleanup and is preserved');
  }
  const locator = compilerDependencyLocatorObservationV1(path.resolve(consumerRoot), 'node_modules');
  if (locator === null) {
    throw new CompilerError('IMPORT-AUTHORITY-004', 'Compiler dependency bridge locator disappeared before exact cleanup');
  }
  await deleteExactCompilerDependencyLocatorV1(path.resolve(consumerRoot), locator, options);
  const after = await observeDependencyTransitionSlotV1(bridgePath);
  if (after.kind !== 'absent') {
    throw new CompilerError('IMPORT-AUTHORITY-004', 'Compiler dependency bridge cleanup failed exact absence readback');
  }
  await advanceDependencyTransitionV1(transition, {
    destination: after,
    phase: 'rolled-back',
    durability: 'known',
    failure: null
  }, options);
}

async function stageCompilerDependencyGeneration(
  root: string,
  identity: CompilerDependencyIdentity,
  options: RuntimeDependencyOperationOptionsV1
): Promise<{
  binding: CompilerDepsBinding;
  stagingRoot: string;
  stagingRootSlot: DependencyTransitionSlotV1;
}> {
  const stagingParent = path.join(root, '.tmp', 'dependency-installs');
  const compilerRootIdentity = inspectNoFollowDirectoryChainV1(
    root,
    'Compiler dependency staging root'
  ).target;
  await runtimeDependencyOperationEffectFenceV1(options, 'Compiler dependency staging namespace creation');
  createNoFollowOrdinaryDirectoryChainV1(
    compilerRootIdentity,
    ['.tmp', 'dependency-installs']
  );
  await runtimeDependencyOperationEffectFenceV1(options, 'Compiler dependency staging-root creation');
  const stagingParentIdentity = inspectNoFollowDirectoryChainV1(
    stagingParent,
    'Compiler dependency staging parent'
  ).target;
  const stagingRoot = createExclusiveNoFollowRandomDirectoryV1(
    stagingParentIdentity,
    'c.staging-'
  ).path;
  const stagingRootSlot = await observeDependencyTransitionSlotV1(stagingRoot);
  const stagingRelativePath = path.relative(root, stagingRoot).replaceAll('\\', '/');
  let lifecycleRegistered = false;
  let stagingNodeModulesSlot: DependencyTransitionSlotV1 | null = null;
  try {
    if (options.generatedStateLifecycle !== undefined) {
      await runtimeDependencyOperationEffectFenceV1(options, 'Compiler dependency staging lifecycle birth');
      await options.generatedStateLifecycle.born(
        stagingRelativePath,
        `compiler-dependency-generation:${identity.manifestHash}:${path.basename(stagingRoot)}`
      );
      lifecycleRegistered = true;
    }
    const sourceRootIdentity = inspectNoFollowDirectoryChainV1(
      root,
      'Compiler dependency source root'
    ).target;
    const stagedRootIdentity = inspectNoFollowDirectoryChainV1(
      stagingRoot,
      'Compiler dependency staging root readback'
    ).target;
    const stageCanonicalInput = async (name: 'package.json' | 'bun.lock' | 'bunfig.toml') => {
      const sourceEntry = inspectNoFollowOrdinaryFileEntryV1(sourceRootIdentity, name);
      if (sourceEntry === null) return null;
      if (sourceEntry.kind !== 'file' || sourceEntry.bytes === null) {
        throw new CompilerError(
          'IMPORT-AUTHORITY-001',
          `Compiler dependency input ${name} is not an ordinary no-follow file`
        );
      }
      // The source parent and the newly-created stage parent are both fenced
      // immediately around publication.  Publication itself is no-replace,
      // retained-parent and durable; a substituted source is therefore a
      // typed failure rather than a path-following copy.
      assertSameNoFollowDirectoryIdentityV1(sourceRootIdentity, 'Compiler dependency source root before stage input');
      assertSameNoFollowDirectoryIdentityV1(stagedRootIdentity, 'Compiler dependency staging root before stage input');
      const bytes = Buffer.from(sourceEntry.bytes);
      await runtimeDependencyOperationEffectFenceV1(options, `Compiler dependency staged ${name} publication`);
      publishExclusiveDurableCanonicalFileV1({
        parent: stagedRootIdentity,
        name,
        bytes,
        validate: (candidate) => {
          if (!Buffer.from(candidate).equals(bytes)) {
            throw new CompilerError('IMPORT-AUTHORITY-001', `Compiler dependency staged input ${name} bytes differ`);
          }
        }
      });
      assertSameNoFollowDirectoryIdentityV1(sourceRootIdentity, 'Compiler dependency source root after stage input');
      assertSameNoFollowDirectoryIdentityV1(stagedRootIdentity, 'Compiler dependency staging root after stage input');
      const stagedEntry = inspectNoFollowOrdinaryFileEntryV1(stagedRootIdentity, name);
      if (stagedEntry === null || stagedEntry.kind !== 'file' || stagedEntry.bytes === null ||
          !Buffer.from(stagedEntry.bytes).equals(bytes)) {
        throw new CompilerError('IMPORT-AUTHORITY-001', `Compiler dependency staged input ${name} failed exact readback`);
      }
      return bytes;
    };
    const sourcePackageBytes = await stageCanonicalInput('package.json');
    const sourceLockBytes = await stageCanonicalInput('bun.lock');
    if (sourcePackageBytes === null || sourceLockBytes === null ||
        digest(sourcePackageBytes) !== identity.packageSourceSha256 ||
        digest(sourceLockBytes) !== identity.lockSha256) {
      throw new CompilerError('IMPORT-AUTHORITY-001', 'Compiler dependency inputs changed before staging');
    }
    const installConfigBytes = await stageCanonicalInput('bunfig.toml');
    if (compilerInstallConfigSha256(installConfigBytes) !== identity.installConfigSha256) {
      throw new CompilerError('IMPORT-AUTHORITY-001', 'Compiler dependency install config changed before staging');
    }

    const cacheDir = path.join(root, '.shared-deps', '.bun-cache');
    const runtimeExecutable = await currentRuntimeExecutableIdentity(true);
    if (runtimeExecutable.path !== identity.bunExecutablePath ||
      runtimeExecutable.sha256 !== identity.bunExecutableSha256) {
      throw new CompilerError('IMPORT-AUTHORITY-001', 'Bun executable changed before dependency materialization');
    }
    const compilerInputFence = async (): Promise<void> => {
      assertCompilerDependencyInputsCurrentV1(root, identity);
    };
    await compilerInputFence();
    await runBunInstall(
      stagingRoot,
      options,
      ['install', '--frozen-lockfile', '--ignore-scripts'],
      cacheDir,
      runtimeExecutable,
      compilerInputFence
    );
    await compilerInputFence();
    const nodeModulesPath = path.join(stagingRoot, 'node_modules');
    const packages = await compilerDependencyPackageBindings(nodeModulesPath, identity);
    const runtimeMaterialization = await compilerRuntimeMaterializationBinding(root, nodeModulesPath, identity);
    const binding = {
      architecture: identity.architecture,
      bunExecutablePath: identity.bunExecutablePath,
      bunExecutableSha256: identity.bunExecutableSha256,
      bunVersion: identity.bunVersion,
      declaredBunVersion: identity.declaredBunVersion,
      dependencyManifestSha256: identity.dependencyManifestSha256,
      formatVersion: 'compiler-deps-binding-v5',
      installConfigSha256: identity.installConfigSha256,
      lockSha256: identity.lockSha256,
      manifestHash: identity.manifestHash,
      packages,
      platform: identity.platform,
      runtimeMaterialization
    } satisfies CompilerDepsBinding;
    const nodeModulesIdentity = inspectNoFollowDirectoryChainV1(
      nodeModulesPath,
      'Compiler dependency staged node_modules'
    ).target;
    const bindingBytes = Buffer.from(formatJsonFile(binding), 'utf8');
    await runtimeDependencyOperationEffectFenceV1(options, 'Compiler dependency staged binding publication');
    publishExclusiveDurableCanonicalFileV1({
      parent: nodeModulesIdentity,
      name: COMPILER_DEPS_BINDING_FILE,
      bytes: bindingBytes,
      validate: (candidate) => {
        if (!Buffer.from(candidate).equals(bindingBytes)) {
          throw new CompilerError('IMPORT-AUTHORITY-002', 'Compiler dependency staged binding bytes differ');
        }
      }
    });
    assertSameNoFollowDirectoryIdentityV1(nodeModulesIdentity, 'Compiler dependency staged node_modules readback');
    stagingNodeModulesSlot = await observeDependencyTransitionSlotV1(
      nodeModulesPath,
      generatedStateDigestV1(binding)
    );
    if (stagingNodeModulesSlot.kind === 'absent') {
      throw new CompilerError('IMPORT-AUTHORITY-002', 'Compiler dependency generation stage disappeared before publication');
    }
    return { binding, stagingRoot, stagingRootSlot };
  } catch (error) {
    try {
      await disposeDependencyTransitionStageV1(
        root,
        stagingRoot,
        options,
        lifecycleRegistered ? 'generation-aborted' : 'generation-aborted-before-registration',
        stagingNodeModulesSlot,
        stagingRootSlot,
        compilerDependencyStageAuthorityV1(root)
      );
    } catch (disposeError) {
      throw new CompilerError('IMPORT-AUTHORITY-004', 'Compiler dependency generation staging residue is preserved for recovery', {
        cause: error instanceof Error ? error.message : String(error),
        cleanup: disposeError instanceof Error ? disposeError.message : String(disposeError),
        stagingRoot
      });
    }
    if (error instanceof CompilerError && error.code.startsWith('IMPORT-AUTHORITY-')) throw error;
    const causeMessage = error instanceof CompilerError
      ? JSON.stringify(error.details).slice(-2000)
      : error instanceof Error ? error.message : String(error);
    throw new CompilerError(
      'IMPORT-AUTHORITY-002',
      `Compiler dependency generation could not be materialized: ${causeMessage}`,
      {
      cause: error instanceof CompilerError ? {
        code: error.code,
        details: error.details,
        message: error.message
      } : error instanceof Error ? error.message : String(error)
      }
    );
  }
}

type CompilerDependencyDirectoryIdentity = Readonly<{
  dev: string;
  ino: string;
  mode: string;
}>;

const COMPILER_DEPENDENCY_RENAME_MAX_ATTEMPTS = 8;
const COMPILER_DEPENDENCY_RENAME_INITIAL_DELAY_MS = 25;
const COMPILER_DEPENDENCY_RENAME_MAX_DELAY_MS = 200;
const WINDOWS_TRANSIENT_RENAME_CODES = new Set(['EACCES', 'EBUSY', 'EPERM']);

async function compilerDependencyDirectoryIdentity(
  directoryPath: string
): Promise<CompilerDependencyDirectoryIdentity | null> {
  try {
    const metadata = await fs.lstat(directoryPath, { bigint: true });
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error(`Compiler dependency generation is not a physical directory: ${directoryPath}`);
    }
    return Object.freeze({
      dev: String(metadata.dev),
      ino: String(metadata.ino),
      mode: String(metadata.mode)
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function sameCompilerDependencyDirectoryIdentity(
  left: CompilerDependencyDirectoryIdentity | null,
  right: CompilerDependencyDirectoryIdentity
): boolean {
  return left !== null && left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

async function renameCompilerDependencyDirectory(
  source: string,
  target: string,
  options: RuntimeDependencyOperationOptionsV1
): Promise<void> {
  // The test seam deliberately retains the historical retry surface so the
  // integration suite can inject a post-effect exception. Production never
  // uses fs.rename directly: the no-follow primitive owns both retained
  // parents, no-replace semantics, fsync and physical readback.
  if (options.testCompilerRename !== undefined) {
    const expectedSource = await compilerDependencyDirectoryIdentity(source);
    if (expectedSource === null) {
      throw new Error(`Compiler dependency generation source is unavailable: ${source}`);
    }
    if ((await compilerDependencyDirectoryIdentity(target)) !== null) {
      throw new Error(`Compiler dependency generation target already exists: ${target}`);
    }

    const hostPlatform = options.testCompilerPublishPlatform ?? process.platform;
    const sleep = options.sleep ?? sleepMs;
    for (let attempt = 1; attempt <= COMPILER_DEPENDENCY_RENAME_MAX_ATTEMPTS; attempt += 1) {
      await runtimeDependencyOperationEffectFenceV1(options, 'Compiler dependency test rename');
      const currentSource = await compilerDependencyDirectoryIdentity(source);
      const currentTarget = await compilerDependencyDirectoryIdentity(target);
      if (!sameCompilerDependencyDirectoryIdentity(currentSource, expectedSource) || currentTarget !== null) {
        throw new Error('Compiler dependency generation identity changed before publish');
      }
      try {
        await options.testCompilerRename(source, target);
        return;
      } catch (error) {
        const sourceAfterFailure = await compilerDependencyDirectoryIdentity(source);
        const targetAfterFailure = await compilerDependencyDirectoryIdentity(target);
        if (sourceAfterFailure === null &&
          sameCompilerDependencyDirectoryIdentity(targetAfterFailure, expectedSource)) {
          // The injected seam may have performed the rename and then thrown.
          // Topology is exact, so recovery can continue in the caller.
          return;
        }
        const code = (error as NodeJS.ErrnoException).code;
        const retryable = hostPlatform === 'win32' &&
          code !== undefined &&
          WINDOWS_TRANSIENT_RENAME_CODES.has(code) &&
          attempt < COMPILER_DEPENDENCY_RENAME_MAX_ATTEMPTS;
        if (!retryable) throw error;
        if (!sameCompilerDependencyDirectoryIdentity(sourceAfterFailure, expectedSource) ||
          targetAfterFailure !== null) {
          throw new Error('Compiler dependency generation identity changed after transient publish failure', {
            cause: error
          });
        }
        const delayMs = Math.min(
          COMPILER_DEPENDENCY_RENAME_INITIAL_DELAY_MS * (2 ** (attempt - 1)),
          COMPILER_DEPENDENCY_RENAME_MAX_DELAY_MS
        );
        await waitForRuntimeDependencyOperationV1(
          options,
          delayMs,
          sleep,
          'Compiler dependency transient rename retry'
        );
      }
    }
    return;
  }

  const expectedSource = inspectNoFollowDirectoryChainV1(
    source,
    'Compiler dependency generation source'
  ).target;
  const destinationParent = inspectNoFollowDirectoryChainV1(
    path.dirname(path.resolve(target)),
    'Compiler dependency generation destination parent'
  ).target;
  const currentTarget = await observeDependencyTransitionSlotV1(target);
  if (currentTarget.kind !== 'absent') {
    throw new CompilerError('IMPORT-AUTHORITY-004', 'Compiler dependency generation target is occupied and preserved');
  }
  await runtimeDependencyOperationEffectFenceV1(options, 'Compiler dependency retained directory relocation');
  try {
    relocateRetainedNoFollowDirectoryAcrossParentsV1({
      directory: expectedSource,
      destinationParent,
      tombstoneName: path.basename(path.resolve(target))
    });
  } catch (error) {
    const sourceAfter = inspectExactNoFollowDirectoryPresenceV1(source, 'Compiler dependency generation source');
    const targetAfter = await observeDependencyTransitionSlotV1(target);
    if (sourceAfter.state === 'absent' && targetAfter.kind === 'directory' &&
      targetAfter.physical !== null && sameGeneratedStateIdentityV1(
        targetAfter.physical,
        generatedStatePhysicalIdentityV1(expectedSource)
      )) {
      throw new CompilerError(
        'RUNTIME-DEPS-002',
        'Compiler dependency generation rename reached topology but durability is unknown; recovery is required',
        { cause: error instanceof Error ? error.message : String(error), source, target }
      );
    }
    throw error;
  }
}

/**
 * Moves an operation-owned locator without ever following its target.  A
 * project projection uses this for the staged bridge link so its journal has
 * the same prepared -> published topology as an isolated directory copy.
 */
async function renameDependencyLocatorV1(
  source: string,
  target: string,
  expectedLinkTarget: string,
  options: RuntimeDependencyOperationOptionsV1
): Promise<void> {
  const sourceParent = inspectNoFollowDirectoryChainV1(
    path.dirname(path.resolve(source)),
    'Dependency locator source parent'
  ).target;
  const targetParent = inspectNoFollowDirectoryChainV1(
    path.dirname(path.resolve(target)),
    'Dependency locator destination parent'
  ).target;
  const sourceEntry = inspectNoFollowLinkEntryV1(sourceParent, path.basename(path.resolve(source)));
  if (sourceEntry === null || sourceEntry.kind !== 'link' || sourceEntry.linkTarget === null ||
      (process.platform !== 'win32' && !sameHostPath(sourceEntry.linkTarget, expectedLinkTarget))) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency locator stage is not the expected physical link');
  }
  if ((await observeDependencyTransitionSlotV1(target)).kind !== 'absent') {
    throw new CompilerError('RUNTIME-DEPS-004', 'Dependency locator destination is occupied and preserved');
  }
  const expectedSource = inspectNoFollowDirectoryChainV1(
    expectedLinkTarget,
    'Dependency locator source target'
  ).target;
  await runtimeDependencyOperationEffectFenceV1(options, 'Dependency locator retained relocation');
  try {
    relocateRetainedNoFollowLinkAcrossParentsV1({
      sourceParent,
      destinationParent: targetParent,
      sourceName: path.basename(path.resolve(source)),
      destinationName: path.basename(path.resolve(target)),
      expectedSource,
      expectedTargetPath: expectedLinkTarget
    });
  } catch (error) {
    const sourceAfter = inspectNoFollowLinkEntryV1(sourceParent, path.basename(path.resolve(source)));
    const targetAfter = inspectNoFollowLinkEntryV1(targetParent, path.basename(path.resolve(target)));
    if (sourceAfter === null && targetAfter?.kind === 'link') {
      throw new CompilerError('RUNTIME-DEPS-002', 'Dependency locator rename reached topology but durability is unknown; recovery is required', {
        cause: error instanceof Error ? error.message : String(error),
        source,
        target
      });
    }
    throw error;
  }
  const sourceAfter = inspectNoFollowLinkEntryV1(sourceParent, path.basename(path.resolve(source)));
  const targetAfter = inspectNoFollowLinkEntryV1(targetParent, path.basename(path.resolve(target)));
  const targetIdentity = targetAfter === null || targetAfter.linkTarget === null
    ? null
    : Object.freeze({
      device: targetAfter.device,
      inode: targetAfter.inode,
      objectId: generatedStateDigestV1({ kind: 'link', target: targetAfter.linkTarget })
    });
  const expectedIdentity = Object.freeze({
    device: sourceEntry.device,
    inode: sourceEntry.inode,
    objectId: generatedStateDigestV1({ kind: 'link', target: sourceEntry.linkTarget })
  });
  if (sourceAfter !== null || targetAfter === null || targetAfter.kind !== 'link' ||
      targetAfter.linkTarget === null || targetIdentity === null ||
      !sameGeneratedStatePhysicalIdentityV1(targetIdentity, expectedIdentity) ||
       (process.platform !== 'win32' && !sameHostPath(targetAfter.linkTarget, expectedLinkTarget)) ||
      !sameGeneratedStateIdentityV1(
        generatedStatePhysicalIdentityV1(targetParent),
        generatedStatePhysicalIdentityV1(inspectNoFollowDirectoryChainV1(
          path.dirname(path.resolve(target)),
          'Dependency locator destination parent readback'
        ).target)
      )) {
    throw new CompilerError('RUNTIME-DEPS-002', 'Dependency locator rename failed exact no-follow readback; recovery is required', {
      source,
      target,
      targetAfter
    });
  }
}

async function publishCompilerDependencyGeneration(
  root: string,
  activeNodeModulesPath: string,
  stagingRoot: string,
  identity: CompilerDependencyIdentity,
  options: RuntimeDependencyOperationOptionsV1
): Promise<void> {
  const stagingNodeModulesPath = path.join(stagingRoot, 'node_modules');
  const namespace = await ensureDependencyTransitionNamespaceV1(root, options);
  const stagedBinding = await compilerDependencyGenerationBinding(
    root,
    stagingNodeModulesPath,
    path.join(stagingNodeModulesPath, COMPILER_DEPS_BINDING_FILE),
    identity
  );
  if (stagedBinding === null) {
    throw new CompilerError('IMPORT-AUTHORITY-002', 'Staged compiler dependency generation has no valid binding');
  }
  const bindingDigest = generatedStateDigestV1(stagedBinding);
  const sourceGeneration = await runtimeDependencySourceGenerationV1({
    binding: stagedBinding,
    options,
    ownerRoot: root,
    sourcePath: stagingNodeModulesPath
  });
  const backupPath = path.join(
    namespace.backupRoot.path,
    `node_modules-${sourceGeneration.epoch.slice('sha256:'.length, 'sha256:'.length + 24)}`
  );
  let transition = await beginDependencyTransitionV1({
    kind: 'compiler-generation',
    ownerRoot: root,
    destinationPath: activeNodeModulesPath,
    stagePath: stagingNodeModulesPath,
    stageRootPath: stagingRoot,
    backupPath,
    sourceGeneration,
    bindingDigest,
    options
  });
  let activeBackedUp = false;
  let published = false;
  let retiredPreimageRegistrationDigest: `sha256:${string}` | null = null;
  try {
    if (transition.preimage.kind !== 'absent') {
      if (transition.preimage.kind !== 'directory') {
        throw new CompilerError('IMPORT-AUTHORITY-004', 'Existing compiler dependency target is foreign and preserved');
      }
      await compilerDependencyGeneratedPreimageDigestV1(activeNodeModulesPath);
      retiredPreimageRegistrationDigest = await bindAndRetireCompilerDependencyPreimageV1(
        options,
        transition.preimage.physical!,
        'generation-superseded'
      );
      await renameCompilerDependencyDirectory(activeNodeModulesPath, backupPath, options);
      activeBackedUp = true;
      transition = await advanceDependencyTransitionV1(transition, {
        destination: transitionAbsentSlotV1(activeNodeModulesPath),
        backup: await observeDependencyTransitionSlotV1(backupPath, transition.preimage.bindingDigest),
        phase: 'backed-up',
        durability: 'known',
        failure: null
      }, options);
      await options.testCompilerPublishHook?.('active-backed-up');
    }
    await renameCompilerDependencyDirectory(stagingNodeModulesPath, activeNodeModulesPath, options);
    published = true;
    transition = await advanceDependencyTransitionV1(transition, {
      destination: await observeDependencyTransitionSlotV1(activeNodeModulesPath, bindingDigest),
      stage: transitionAbsentSlotV1(stagingNodeModulesPath),
      sourceGeneration: sourceGenerationWithPathV1(sourceGeneration, activeNodeModulesPath),
      phase: 'published',
      durability: 'known',
      failure: null
    }, options);
    if (options.generatedStateLifecycle !== undefined) {
      await runtimeDependencyOperationEffectFenceV1(options, 'Compiler dependency active lifecycle birth');
      await options.generatedStateLifecycle.born(
        'node_modules',
        `compiler-node-modules:${path.basename(stagingRoot)}`
      );
    }
    await disposeDependencyTransitionStageV1(
      root,
      stagingRoot,
      options,
      'generation-published',
      transition.stage,
      transition.stageRoot,
      compilerDependencyStageAuthorityV1(root)
    );
    transition = await advanceDependencyTransitionV1(transition, {
      stageRoot: transitionAbsentSlotV1(stagingRoot),
      phase: 'binding-validated',
      durability: 'known',
      failure: null
    }, options);
    const final = await observeDependencyTransitionSlotV1(activeNodeModulesPath, bindingDigest);
    if (!transitionSlotMatchesV1(final, transition.destination)) {
      throw new CompilerError('IMPORT-AUTHORITY-004', 'Published compiler dependency target identity changed');
    }
    await advanceDependencyTransitionV1(transition, {
      destination: final,
      stageRoot: transitionAbsentSlotV1(stagingRoot),
      phase: 'complete',
      durability: 'known',
      failure: null
    }, options);
  } catch (error) {
    let rollbackFailure: unknown;
    const activeNow = await observeDependencyTransitionSlotV1(activeNodeModulesPath).catch(() => null);
    const backupNow = await observeDependencyTransitionSlotV1(backupPath).catch(() => null);
    const stageNow = await observeDependencyTransitionSlotV1(stagingNodeModulesPath).catch(() => null);
    const topologyRequiresRecovery = activeNow !== null && backupNow !== null && stageNow !== null &&
      (activeNow.kind === 'absent' || backupNow.kind === 'directory' || stageNow.kind === 'directory');
    if (activeBackedUp && activeNow?.kind === 'absent' && backupNow?.kind === 'directory') {
      try {
        await renameCompilerDependencyDirectory(backupPath, activeNodeModulesPath, options);
        const lifecycle = options.generatedStateLifecycle;
        if (lifecycle?.restore === undefined || retiredPreimageRegistrationDigest === null) {
          throw new CompilerError(
            'IMPORT-AUTHORITY-004',
            'Compiler dependency rollback has no exact retired registration predecessor; recovery backup is preserved'
          );
        }
        const restoredTarget = await observeDependencyTransitionSlotV1(activeNodeModulesPath);
        if (restoredTarget.kind !== 'directory' || restoredTarget.physical === null ||
            transition.preimage.physical === null ||
            !sameGeneratedStateIdentityV1(restoredTarget.physical, transition.preimage.physical)) {
          throw new CompilerError(
            'IMPORT-AUTHORITY-004',
            'Compiler dependency rollback target identity changed before lifecycle restore'
          );
        }
        await runtimeDependencyOperationEffectFenceV1(options, 'Compiler dependency lifecycle restore');
        await lifecycle.restore(
          'node_modules',
          retiredPreimageRegistrationDigest,
          restoredTarget.physical,
          'compiler-dependency-preimage-restored'
        );
        await advanceDependencyTransitionV1(transition, {
          destination: restoredTarget,
          backup: transitionAbsentSlotV1(backupPath),
          phase: 'rolled-back',
          durability: 'known',
          failure: transitionFailureV1(error)
        }, options);
      } catch (rollbackError) {
        rollbackFailure = rollbackError;
      }
    } else if (topologyRequiresRecovery) {
      try {
        await markDependencyTransitionFailureV1(transition, error, options);
      } catch (journalError) {
        rollbackFailure = journalError;
      }
    }
    throw new CompilerError('IMPORT-AUTHORITY-004', 'Compiler dependency generation publish failed', {
      cause: error instanceof Error ? error.message : String(error),
      rollbackFailure: rollbackFailure instanceof Error ? rollbackFailure.message : rollbackFailure,
      recoveryRequired: topologyRequiresRecovery && rollbackFailure === undefined,
      transitionDigest: transition.recordDigest
    });
  } finally {
    if (!published) {
      // Only the operation-created staging tree may be converged here. The
      // exact no-follow inventory refuses a substituted/foreign tree and
      // reports a typed residue blocker instead of deleting a replacement.
      await disposeDependencyTransitionStageV1(
        root,
        stagingRoot,
        options,
        'generation-publish-failed',
        transition.stage,
        transition.stageRoot,
        compilerDependencyStageAuthorityV1(root)
      );
    }
  }
}

async function createCompilerDependencyLocatorV1(
  linkPath: string,
  sourcePath: string,
  expectedSource: Readonly<GeneratedStatePhysicalIdentityV1>,
  options: RuntimeDependencyOperationOptionsV1
): Promise<Readonly<{ source: GeneratedStatePhysicalIdentityV1; linkTarget: string }>> {
  const parent = inspectNoFollowDirectoryChainV1(
    path.dirname(linkPath),
    'Compiler dependency locator parent'
  ).target;
  const existing = await observeDependencyTransitionSlotV1(linkPath);
  if (existing.kind !== 'absent') {
    throw new CompilerError('IMPORT-AUTHORITY-004', 'Compiler dependency locator target is occupied and preserved');
  }
  const sourceIdentity = inspectNoFollowDirectoryChainV1(
    sourcePath,
    'Compiler dependency locator source'
  ).target;
  const source = generatedStatePhysicalIdentityV1(sourceIdentity);
  if (!sameGeneratedStateIdentityV1(source, expectedSource)) {
    throw new CompilerError('IMPORT-AUTHORITY-004', 'Compiler dependency locator publication failed exact readback', {
      expectedSource,
      source,
      sourcePath
    });
  }
  try {
    await runtimeDependencyOperationEffectFenceV1(options, 'Compiler dependency locator publication');
    assertSameNoFollowDirectoryIdentityV1(parent, 'Compiler dependency locator parent publication');
    assertSameNoFollowDirectoryIdentityV1(sourceIdentity, 'Compiler dependency locator source publication');
    const published = publishExclusiveNoFollowLinkV1({
      parent,
      name: path.basename(path.resolve(linkPath)),
      source: sourceIdentity,
      expectedTargetPath: sourcePath
    });
    return Object.freeze({
      source: generatedStatePhysicalIdentityV1(published.source),
      linkTarget: published.linkTarget
    });
  } catch (error) {
    throw new CompilerError('IMPORT-AUTHORITY-004', 'Compiler dependency locator publication failed exact readback', {
      expectedSource,
      source,
      sourcePath,
      cause: error instanceof Error ? error.message : String(error)
    });
  }
}

async function recoverCompilerDependencyTransitionV1(
  root: string,
  nodeModulesPath: string,
  identity: CompilerDependencyIdentity,
  options: RuntimeDependencyOperationOptionsV1
): Promise<void> {
  const initialTransition = await readDependencyTransitionV1(root, options);
  if (initialTransition === null || initialTransition.phase === 'complete' || initialTransition.phase === 'rolled-back') return;
  let transition: DependencyTransitionJournalV1 = initialTransition;

  const activePath = transition.destination.path;
  const stagePath = transition.stage?.path ?? null;
  const stageRootPath = transition.stageRoot?.path ?? null;
  const backupPath = transition.backup?.path ?? null;
  const expectedSourcePhysical = transition.sourceGeneration.physical;

  const failRecovery = async (error: unknown): Promise<never> => {
    try {
      transition = await markDependencyTransitionFailureV1(transition, error, options);
    } catch {
      // Preserve the original typed blocker if the journal itself is no longer
      // writable; no destructive fallback is safe at this boundary.
    }
    throw new CompilerError('IMPORT-AUTHORITY-004', 'Compiler dependency transition requires owner recovery', {
      cause: error instanceof Error ? error.message : String(error),
      causeDetails: error instanceof CompilerError ? error.details : null,
      transitionDigest: transition.recordDigest,
      phase: transition.phase
    });
  };

  const currentActive = () => observeDependencyTransitionSlotV1(activePath, transition.sourceGeneration.bindingDigest);
  const currentStage = () => stagePath === null
    ? Promise.resolve<DependencyTransitionSlotV1 | null>(null)
    : observeDependencyTransitionSlotV1(stagePath, transition.sourceGeneration.bindingDigest);
  const currentStageRoot = () => stageRootPath === null
    ? Promise.resolve<DependencyTransitionSlotV1 | null>(null)
    : observeDependencyTransitionSlotV1(stageRootPath, transition.sourceGeneration.bindingDigest);
  const currentBackup = () => backupPath === null
    ? Promise.resolve<DependencyTransitionSlotV1 | null>(null)
    : observeDependencyTransitionSlotV1(backupPath, transition.preimage.bindingDigest);

  try {
    assertCompilerTransitionRecoveryTopologyV1(initialTransition, root, nodeModulesPath);
    let active = await currentActive();
    let stage = await currentStage();
    let stageRoot = await currentStageRoot();
    let backup = await currentBackup();
    if (transition.stageRoot !== null &&
        (stageRoot === null || !transitionSlotMatchesV1(stageRoot, transition.stageRoot))) {
      // A crash can occur after the exact retained disposal effect and before
      // the journal's stageRoot=absent receipt.  Once the staged child is also
      // recorded absent, an absent live root is a safe already-disposed
      // topology; no new deletion authority is inferred from it.  Any
      // reappeared or substituted root remains a typed residue blocker.
      const alreadyDisposed = transition.stageRoot.kind === 'directory' &&
        transition.stage?.kind === 'absent' && stageRoot?.kind === 'absent' &&
        (transition.phase === 'published' || transition.phase === 'binding-validated' ||
          transition.phase === 'stamp-readback' || transition.phase === 'recovery-required');
      if (!alreadyDisposed) {
        return failRecovery(new CompilerError('IMPORT-AUTHORITY-004', 'Compiler dependency staging root identity changed and is preserved'));
      }
    }

    if (transition.kind === 'compiler-generation') {
      if (transition.preimage.kind !== 'absent' && transition.preimage.kind !== 'directory') {
        return failRecovery(new CompilerError('IMPORT-AUTHORITY-004', 'Foreign compiler dependency preimage is preserved'));
      }
      if (transition.preimage.kind === 'directory' && backupPath !== null &&
        transition.phase === 'prepared' && active.kind === 'directory' &&
        transition.preimage.physical !== null &&
        sameGeneratedStateIdentityV1(active.physical!, transition.preimage.physical) &&
        backup?.kind === 'absent') {
        await compilerDependencyGeneratedPreimageDigestV1(activePath);
        await bindAndRetireCompilerDependencyPreimageV1(
          options,
          transition.preimage.physical!,
          'generation-recovery-superseded'
        );
        await renameCompilerDependencyDirectory(activePath, backupPath, options);
        transition = await advanceDependencyTransitionV1(transition, {
          destination: transitionAbsentSlotV1(activePath),
          backup: await observeDependencyTransitionSlotV1(backupPath, transition.preimage.bindingDigest),
          phase: 'backed-up',
          durability: 'known',
          failure: null
        }, options);
        active = await currentActive();
        stage = await currentStage();
        stageRoot = await currentStageRoot();
        backup = await currentBackup();
      } else if (transition.phase === 'prepared' && active.kind === 'absent' &&
        backup?.kind === 'directory' && stage?.kind === 'directory' && stageRoot?.kind === 'directory') {
        transition = await advanceDependencyTransitionV1(transition, {
          destination: transitionAbsentSlotV1(activePath),
          stageRoot,
          backup,
          phase: 'backed-up',
          durability: 'known',
          failure: null
        }, options);
      }

      if ((transition.phase === 'prepared' || transition.phase === 'backed-up' || transition.phase === 'recovery-required') &&
        stagePath !== null && stage?.kind === 'directory' && stageRoot?.kind === 'directory') {
        if (active.kind !== 'absent') {
          if (transition.phase === 'recovery-required' && active.kind === 'directory' &&
            active.physical !== null && sameGeneratedStateIdentityV1(active.physical, expectedSourcePhysical)) {
            // The publish effect completed before the process lost its
            // receipt; continue with exact post-effect readback.
          } else {
            return failRecovery(new CompilerError('IMPORT-AUTHORITY-004', 'Compiler dependency transition active target is occupied by an unexpected identity'));
          }
        } else {
          await renameCompilerDependencyDirectory(stagePath, activePath, options);
        }
        active = await currentActive();
        stage = await currentStage();
        stageRoot = await currentStageRoot();
        if (active.kind !== 'directory' || active.physical === null ||
          !sameGeneratedStateIdentityV1(active.physical, expectedSourcePhysical)) {
          return failRecovery(new CompilerError('IMPORT-AUTHORITY-004', 'Compiler dependency transition active target failed identity readback'));
        }
        transition = await advanceDependencyTransitionV1(transition, {
          destination: active,
          stage: stage ?? transitionAbsentSlotV1(stagePath),
          stageRoot,
          phase: 'published',
          durability: 'known',
          failure: null
        }, options);
      }

      if (active.kind !== 'directory' || active.physical === null ||
        !sameGeneratedStateIdentityV1(active.physical, expectedSourcePhysical)) {
        return failRecovery(new CompilerError('IMPORT-AUTHORITY-004', 'Compiler dependency transition has no exact active generation'));
      }
      const binding = await compilerDependencyGenerationBinding(
        root,
        activePath,
        path.join(activePath, COMPILER_DEPS_BINDING_FILE),
        identity
      );
      if (binding === null || generatedStateDigestV1(binding) !== transition.sourceGeneration.bindingDigest) {
        return failRecovery(new CompilerError('IMPORT-AUTHORITY-004', 'Compiler dependency transition active binding drifted'));
      }
      if (options.generatedStateLifecycle !== undefined) {
        // A crash may land after the active generation rename and journal
        // publication but before the producer registration is durably born.
        // Recovery may not declare the transition complete until the exact
        // active physical generation is bound and read back by the lifecycle
        // owner under this same compiler-root lease.
        await bindExistingCompilerDependencyGenerationV1(options, active.physical);
      }
      stage = await currentStage();
      stageRoot = await currentStageRoot();
      if (stageRootPath !== null && stageRoot?.kind === 'directory') {
        await disposeDependencyTransitionStageV1(
          root,
          stageRootPath,
          options,
          'generation-recovered',
          transition.stage,
          transition.stageRoot,
          compilerDependencyStageAuthorityV1(root)
        );
      }
      active = await currentActive();
      stage = await currentStage();
      stageRoot = await currentStageRoot();
      backup = await currentBackup();
      transition = await advanceDependencyTransitionV1(transition, {
        destination: active,
        stage: stage ?? (stagePath === null ? null : transitionAbsentSlotV1(stagePath)),
        stageRoot: stageRoot ?? (stageRootPath === null ? null : transitionAbsentSlotV1(stageRootPath)),
        backup,
        sourceGeneration: sourceGenerationWithPathV1(transition.sourceGeneration, activePath),
        phase: 'complete',
        durability: 'known',
        failure: null
      }, options);
      return;
    }

    if (transition.kind === 'compiler-locator') {
      const sourcePath = transition.sourceGeneration.sourcePath;
      const sourceOwnerRoot = path.dirname(sourcePath);
      const sourceIdentity = await compilerDependencyIdentity(sourceOwnerRoot);
      const sourceBinding = await compilerDependencyGenerationBinding(
        sourceOwnerRoot,
        sourcePath,
        path.join(sourcePath, COMPILER_DEPS_BINDING_FILE),
        sourceIdentity
      );
      if (sourceBinding === null || generatedStateDigestV1(sourceBinding) !== transition.sourceGeneration.bindingDigest) {
        return failRecovery(new CompilerError('IMPORT-AUTHORITY-004', 'Linked compiler dependency source drifted and is preserved'));
      }
      const sourceGeneration = await runtimeDependencySourceGenerationV1({
        binding: sourceBinding,
        options,
        ownerRoot: sourceOwnerRoot,
        sourcePath
      });
      if (!sameGeneratedStateIdentityV1(sourceGeneration.physical, expectedSourcePhysical) ||
        sourceGeneration.epoch !== transition.sourceGeneration.epoch ||
        !sameRuntimeDependencySourceGenerationContentV1(sourceGeneration, transition.sourceGeneration)) {
        return failRecovery(new CompilerError('IMPORT-AUTHORITY-004', 'Linked compiler dependency source physical epoch drifted'));
      }
      if (transition.preimage.kind !== 'absent' && transition.preimage.kind !== 'directory') {
        return failRecovery(new CompilerError('IMPORT-AUTHORITY-004', 'Foreign linked compiler dependency target is preserved'));
      }
      if (transition.preimage.kind === 'directory' && backupPath !== null && transition.phase === 'prepared' &&
        active.kind === 'directory' && transition.preimage.physical !== null && active.physical !== null &&
        sameGeneratedStateIdentityV1(active.physical, transition.preimage.physical) && backup?.kind === 'absent') {
        await compilerDependencyGeneratedPreimageDigestV1(activePath);
        await bindAndRetireCompilerDependencyPreimageV1(
          options,
          transition.preimage.physical!,
          'locator-transition-superseded'
        );
        await renameCompilerDependencyDirectory(activePath, backupPath, options);
        transition = await advanceDependencyTransitionV1(transition, {
          destination: transitionAbsentSlotV1(activePath),
          stageRoot,
          backup: await currentBackup(),
          phase: 'backed-up',
          durability: 'known',
          failure: null
        }, options);
      }
      active = await currentActive();
      if (active.kind === 'absent') {
        await createCompilerDependencyLocatorV1(activePath, sourcePath, sourceGeneration.physical, options);
        active = await currentActive();
        transition = await advanceDependencyTransitionV1(transition, {
          destination: active,
          stageRoot,
          sourceGeneration,
          phase: 'published',
          durability: 'known',
          failure: null
        }, options);
      } else if (active.kind !== 'link' || active.linkTarget === null ||
        !sameHostPath(await fs.realpath(activePath).catch(() => ''), sourcePath)) {
        return failRecovery(new CompilerError('IMPORT-AUTHORITY-004', 'Linked compiler dependency target is foreign and preserved'));
      }
      const observedBinding = await compilerDependencyConsumerBridgeBinding(root, activePath, identity, options);
      if (observedBinding === null || generatedStateDigestV1(observedBinding) !== transition.sourceGeneration.bindingDigest) {
        return failRecovery(new CompilerError('IMPORT-AUTHORITY-004', 'Linked compiler dependency locator failed recovery binding'));
      }
      await bindExistingCompilerDependencyLocatorV1(root, identity, observedBinding, options);
      transition = await advanceDependencyTransitionV1(transition, {
        destination: active,
        backup: await currentBackup(),
        sourceGeneration,
        phase: 'complete',
        durability: 'known',
        failure: null
      }, options);
      return;
    }

    if (transition.kind === 'runtime-projection') {
      if (transition.preimage.kind !== 'absent' && transition.preimage.kind !== 'directory') {
        return failRecovery(new CompilerError('RUNTIME-DEPS-004', 'Foreign shared dependency preimage is preserved'));
      }
      // A runtime projection has two independent physical identities: the
      // immutable compiler/shared source generation and the copied active
      // destination.  Recovering the latter by comparing it to
      // sourceGeneration.physical would either reject a valid copy or, worse,
      // make a destination path look like source authority.  Reconstruct and
      // re-read the source binding/tree before any remaining publish effect.
      const sourcePath = transition.sourceGeneration.sourcePath;
      if (path.resolve(sourcePath) === path.resolve(activePath) ||
          path.basename(sourcePath).toLocaleLowerCase('en-US') !== 'node_modules') {
        return failRecovery(new CompilerError('RUNTIME-DEPS-004', 'Shared dependency source topology is foreign and preserved'));
      }
      const sourceOwnerRoot = path.resolve(transition.sourceGeneration.ownerRoot);
      const sourceCompilerIdentity = await compilerDependencyIdentity(sourceOwnerRoot);
      const sourceBinding = await compilerDependencyGenerationBinding(
        sourceOwnerRoot,
        sourcePath,
        path.join(sourcePath, COMPILER_DEPS_BINDING_FILE),
        sourceCompilerIdentity
      );
      const sourceRuntimeBinding = sourceBinding?.runtimeMaterialization ?? null;
      if (sourceRuntimeBinding === null ||
          generatedStateDigestV1(sourceRuntimeBinding) !== transition.sourceGeneration.bindingDigest) {
        return failRecovery(new CompilerError('RUNTIME-DEPS-004', 'Shared dependency source binding is missing or foreign and preserved'));
      }
      const currentSourceGeneration = await runtimeDependencySourceGenerationV1({
        binding: sourceRuntimeBinding,
        options,
        ownerRoot: sourceOwnerRoot,
        sourcePath
      });
      if (currentSourceGeneration.epoch !== transition.sourceGeneration.epoch ||
          !sameRuntimeDependencySourceGenerationContentV1(currentSourceGeneration, transition.sourceGeneration) ||
          !sameGeneratedStateIdentityV1(currentSourceGeneration.physical, transition.sourceGeneration.physical) ||
          !sameGeneratedStateIdentityV1(currentSourceGeneration.ownerRootPhysical, transition.sourceGeneration.ownerRootPhysical)) {
        return failRecovery(new CompilerError('RUNTIME-DEPS-004', 'Shared dependency source generation changed and is preserved'));
      }
      if (transition.preimage.kind === 'directory' && backupPath !== null &&
        transition.phase === 'prepared' && active.kind === 'directory' &&
        transition.preimage.physical !== null && active.physical !== null &&
        sameGeneratedStateIdentityV1(active.physical, transition.preimage.physical) &&
        backup?.kind === 'absent') {
        await renameCompilerDependencyDirectory(activePath, backupPath, options);
        transition = await advanceDependencyTransitionV1(transition, {
          destination: transitionAbsentSlotV1(activePath),
          stageRoot,
          backup: await currentBackup(),
          phase: 'backed-up',
          durability: 'known',
          failure: null
        }, options);
        active = await currentActive();
        stage = await currentStage();
      }
      if (stagePath !== null && stage?.kind === 'directory' && stageRoot?.kind === 'directory') {
        if (active.kind !== 'absent') {
          if (active.kind !== 'directory' || active.physical === null ||
            (transition.destination.kind === 'directory' && transition.destination.physical !== null &&
              !sameGeneratedStateIdentityV1(active.physical, transition.destination.physical)) &&
            !sameGeneratedStateIdentityV1(active.physical, stage.physical!)) {
            return failRecovery(new CompilerError('RUNTIME-DEPS-004', 'Shared dependency transition target is occupied by an unexpected identity'));
          }
        } else {
          await renameCompilerDependencyDirectory(stagePath, activePath, options);
        }
        active = await currentActive();
        stage = await currentStage();
        stageRoot = await currentStageRoot();
        if (active.kind !== 'directory' || active.physical === null ||
          (stage?.kind === 'directory' && stage.physical !== null
            ? !sameGeneratedStateIdentityV1(active.physical, stage.physical)
            : transition.destination.kind !== 'directory' || transition.destination.physical === null ||
              !sameGeneratedStateIdentityV1(active.physical, transition.destination.physical))) {
          return failRecovery(new CompilerError('RUNTIME-DEPS-004', 'Shared dependency transition active identity is invalid'));
        }
        transition = await advanceDependencyTransitionV1(transition, {
          destination: active,
          stage: stage ?? transitionAbsentSlotV1(stagePath),
          stageRoot,
          sourceGeneration: transition.sourceGeneration,
          phase: 'published',
          durability: 'known',
          failure: null
        }, options);
      } else if ((transition.phase === 'backed-up' || transition.phase === 'recovery-required') &&
          stagePath !== null && stage?.kind === 'absent' &&
          transition.stage?.kind === 'directory' && transition.stage.physical !== null &&
          active.kind === 'directory' && active.physical !== null &&
          sameGeneratedStateIdentityV1(active.physical, transition.stage.physical)) {
        // The stage-to-active rename may have completed just before a process
        // lost the `published` journal receipt.  The recorded stage identity
        // is the only acceptable proof for this uncertain topology; the
        // source generation identity is intentionally not reused as a target
        // identity.
        transition = await advanceDependencyTransitionV1(transition, {
          destination: active,
          stage: transitionAbsentSlotV1(stagePath),
          stageRoot,
          phase: 'published',
          durability: 'known',
          failure: null
        }, options);
      }
      if (active.kind !== 'directory' || active.physical === null ||
        transition.destination.kind !== 'directory' || transition.destination.physical === null ||
        !sameGeneratedStateIdentityV1(active.physical, transition.destination.physical)) {
        return failRecovery(new CompilerError('RUNTIME-DEPS-004', 'Shared dependency transition has no exact active projection'));
      }
      stage = await currentStage();
      stageRoot = await currentStageRoot();
      if (stageRootPath !== null && stageRoot?.kind === 'directory') {
        await disposeDependencyTransitionStageV1(
          root,
          stageRootPath,
          options,
          'runtime-projection-recovered',
          transition.stage,
          transition.stageRoot,
          runtimeDependencyStageAuthorityV1(path.dirname(stageRootPath))
        );
      }
      transition = await advanceDependencyTransitionV1(transition, {
        destination: await currentActive(),
        stage: stagePath === null ? null : transitionAbsentSlotV1(stagePath),
        stageRoot: stageRootPath === null ? null : transitionAbsentSlotV1(stageRootPath),
        backup: await currentBackup(),
        phase: 'complete',
        durability: 'known',
        failure: null
      }, options);
    }
  } catch (error) {
    return failRecovery(error);
  }
}

async function compilerDependencyConsumerBridgeBinding(
  consumerRoot: string,
  bridgePath: string,
  consumerIdentity: CompilerDependencyIdentity,
  options: RuntimeDependencyInstallOptions
): Promise<Readonly<CompilerDepsBinding> | null> {
  const bridgeMetadata = await fs.lstat(bridgePath, { bigint: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (bridgeMetadata === null || !bridgeMetadata.isSymbolicLink()) return null;

  try {
    const generationPath = path.resolve(await fs.realpath(bridgePath));
    const generationMetadata = await fs.lstat(generationPath, { bigint: true });
    const ownerRoot = path.dirname(generationPath);
    if (!generationMetadata.isDirectory() || generationMetadata.isSymbolicLink() ||
      path.basename(generationPath).toLocaleLowerCase('en-US') !== 'node_modules' ||
      sameHostPath(ownerRoot, consumerRoot)) {
      throw new Error('Dependency consumer bridge target is not one external physical generation.');
    }
    const ownerIdentity = await compilerDependencyIdentity(ownerRoot);
    if (ownerIdentity.manifestHash !== consumerIdentity.manifestHash) {
      throw new Error('Dependency consumer bridge owner has incompatible canonical inputs.');
    }
    const binding = await compilerDependencyGenerationBinding(
      ownerRoot,
      generationPath,
      path.join(generationPath, COMPILER_DEPS_BINDING_FILE),
      ownerIdentity
    );
    if (binding === null) {
      throw new Error('Dependency consumer bridge target has no valid owner binding.');
    }
    await options.testCompilerBridgeValidationHook?.('binding-observed');
    const finalOwnerIdentity = await compilerDependencyIdentity(ownerRoot);
    const finalConsumerIdentity = await compilerDependencyIdentity(consumerRoot);
    const finalBinding = await compilerDependencyGenerationBinding(
      ownerRoot,
      generationPath,
      path.join(generationPath, COMPILER_DEPS_BINDING_FILE),
      finalOwnerIdentity
    );
    await options.testCompilerBridgeValidationHook?.('final-binding-observed');
    // No asynchronous work may follow this fence: every mutable input and
    // physical bridge identity is observed in one final synchronous interval.
    const finalBridgeMetadata = lstatSync(bridgePath, { bigint: true });
    const finalGenerationPath = path.resolve(realpathSync(bridgePath));
    const finalGenerationMetadata = lstatSync(finalGenerationPath, { bigint: true });
    if (!finalBridgeMetadata.isSymbolicLink() ||
      finalBridgeMetadata.dev !== bridgeMetadata.dev ||
      finalBridgeMetadata.ino !== bridgeMetadata.ino ||
      finalBridgeMetadata.mode !== bridgeMetadata.mode ||
      !sameHostPath(finalGenerationPath, generationPath) ||
      !finalGenerationMetadata.isDirectory() || finalGenerationMetadata.isSymbolicLink() ||
      finalGenerationMetadata.dev !== generationMetadata.dev ||
      finalGenerationMetadata.ino !== generationMetadata.ino ||
      finalGenerationMetadata.mode !== generationMetadata.mode ||
      !compilerDependencyInputFenceMatchesV1(ownerRoot, finalOwnerIdentity) ||
      !compilerDependencyInputFenceMatchesV1(consumerRoot, finalConsumerIdentity)) {
      throw new Error('Dependency consumer bridge identity changed during validation.');
    }
    if (finalConsumerIdentity.manifestHash !== consumerIdentity.manifestHash ||
      finalOwnerIdentity.manifestHash !== finalConsumerIdentity.manifestHash ||
      finalBinding === null || !canonicalEquals(finalBinding, binding)) {
      throw new Error('Dependency consumer bridge binding changed during validation.');
    }
    return finalBinding;
  } catch (error) {
    throw new CompilerError(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency consumer bridge is incompatible',
      { cause: error instanceof Error ? error.message : String(error), bridgePath }
    );
  }
}

const COMPILER_DEPENDENCY_LOCATOR_PROVIDER_ID = 'compiler-dependency-locator' as const;
const COMPILER_DEPENDENCY_LOCATOR_PLAN_SCHEMA = 'sec-compiler-dependency-locator-retirement-plan-v1' as const;
const COMPILER_DEPENDENCY_LOCATOR_RECEIPT_SCHEMA = 'sec-compiler-dependency-locator-retirement-receipt-v1' as const;

interface CompilerDependencyLocatorRetirementPlanV1 {
  readonly schema: typeof COMPILER_DEPENDENCY_LOCATOR_PLAN_SCHEMA;
  readonly consumerRoot: string;
  readonly consumer: GeneratedStatePhysicalIdentityV1;
  readonly relativePath: 'node_modules';
  readonly source: GeneratedStatePhysicalIdentityV1;
  readonly linkTarget: string;
  readonly generationPath: string;
  readonly generation: Readonly<{ device: string; inode: string; mode: string }>;
  readonly ownerRoot: string;
  readonly consumerManifestHash: string;
  readonly ownerManifestHash: string;
  readonly binding: CompilerDepsBinding;
  readonly bindingDigest: `sha256:${string}`;
}

function canonicalProviderBytesV1(value: unknown): string {
  return JSON.stringify(canonicalJson(value));
}

function sameGeneratedStatePhysicalIdentityV1(
  left: GeneratedStatePhysicalIdentityV1,
  right: GeneratedStatePhysicalIdentityV1
): boolean {
  return left.device === right.device && left.inode === right.inode && left.objectId === right.objectId;
}

function compilerDependencyConsumerIdentityV1(consumerRoot: string): GeneratedStatePhysicalIdentityV1 {
  const consumer = inspectNoFollowDirectoryChainV1(
    consumerRoot,
    'Compiler dependency locator consumer root'
  ).target;
  return Object.freeze({ device: consumer.device, inode: consumer.inode, objectId: consumer.objectId });
}

function compilerDependencyLocatorObservationV1(
  consumerRoot: string,
  relativePath: string
): Readonly<{ source: GeneratedStatePhysicalIdentityV1; linkTarget: string }> | null {
  if (relativePath !== 'node_modules') {
    throw new Error('Compiler dependency locator provider only owns node_modules.');
  }
  const root = inspectNoFollowDirectoryChainV1(consumerRoot, 'Compiler dependency locator consumer root').target;
  const locator = inspectNoFollowLinkEntryV1(root, relativePath);
  if (locator === null || locator.kind !== 'link' || locator.linkTarget === null) return null;
  return Object.freeze({
    source: Object.freeze({
      device: locator.device,
      inode: locator.inode,
      objectId: generatedStateDigestV1({ kind: 'link', target: locator.linkTarget })
    }),
    linkTarget: locator.linkTarget
  });
}

async function compilerDependencyGenerationIdentityV1(
  generationPath: string
): Promise<Readonly<{ device: string; inode: string; mode: string }>> {
  const metadata = await fs.lstat(generationPath, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('Compiler dependency generation is not one ordinary directory.');
  }
  return Object.freeze({
    device: String(metadata.dev),
    inode: String(metadata.ino),
    mode: String(metadata.mode)
  });
}

/**
 * Parse only the canonical plan envelope and its structural fields.
 *
 * `bindingDigest` is produced from the dependency owner's reconstructed
 * binding.  Canonical plan encoding sorts nested object keys, so recomputing
 * that digest from the decoded projection can change the byte order without
 * changing the binding.  The effect path validates the digest against the
 * freshly reconstructed owner binding in
 * `validateCompilerDependencyLocatorPlanV1` before it mutates the locator.
 */
export function parseCompilerDependencyLocatorRetirementPlanV1(
  bytes: string
): CompilerDependencyLocatorRetirementPlanV1 {
  const candidate = JSON.parse(bytes) as Partial<CompilerDependencyLocatorRetirementPlanV1>;
  if (canonicalProviderBytesV1(candidate) !== bytes || candidate.schema !== COMPILER_DEPENDENCY_LOCATOR_PLAN_SCHEMA ||
      candidate.relativePath !== 'node_modules' || typeof candidate.consumerRoot !== 'string' ||
      typeof candidate.linkTarget !== 'string' || typeof candidate.generationPath !== 'string' ||
      typeof candidate.ownerRoot !== 'string' || typeof candidate.consumerManifestHash !== 'string' ||
      typeof candidate.ownerManifestHash !== 'string' || typeof candidate.bindingDigest !== 'string' ||
      candidate.source === undefined || candidate.consumer === undefined || candidate.generation === undefined ||
      candidate.binding === undefined ||
      !/^sha256:[0-9a-f]{64}$/u.test(candidate.bindingDigest)) {
    throw new Error('Compiler dependency locator provider plan is malformed.');
  }
  const expectedKeys = [
    'binding', 'bindingDigest', 'consumer', 'consumerManifestHash', 'consumerRoot', 'generation', 'generationPath',
    'linkTarget', 'ownerManifestHash', 'ownerRoot', 'relativePath', 'schema', 'source'
  ];
  if (Object.keys(candidate).sort(compareCodeUnits).join('\0') !== expectedKeys.join('\0') ||
      Object.keys(candidate.source).sort(compareCodeUnits).join('\0') !== ['device', 'inode', 'objectId'].join('\0') ||
      Object.keys(candidate.consumer).sort(compareCodeUnits).join('\0') !== ['device', 'inode', 'objectId'].join('\0') ||
      Object.keys(candidate.generation).sort(compareCodeUnits).join('\0') !== ['device', 'inode', 'mode'].join('\0') ||
      Object.values(candidate.source).some((value) => typeof value !== 'string') ||
      Object.values(candidate.consumer).some((value) => typeof value !== 'string') ||
      Object.values(candidate.generation).some((value) => typeof value !== 'string')) {
    throw new Error('Compiler dependency locator provider plan shape is invalid.');
  }
  return candidate as CompilerDependencyLocatorRetirementPlanV1;
}

async function validateCompilerDependencyLocatorPlanV1(
  plan: CompilerDependencyLocatorRetirementPlanV1,
  requireLocator: boolean,
  options: RuntimeDependencyInstallOptions
): Promise<Readonly<{
  consumer: ReturnType<typeof inspectNoFollowDirectoryChainV1>['target'];
  locator: ReturnType<typeof compilerDependencyLocatorObservationV1>;
}>> {
  const consumerRoot = path.resolve(plan.consumerRoot);
  const generationPath = path.resolve(plan.generationPath);
  const ownerRoot = path.resolve(plan.ownerRoot);
  if (consumerRoot !== plan.consumerRoot || generationPath !== plan.generationPath || ownerRoot !== plan.ownerRoot ||
      !sameHostPath(path.dirname(generationPath), ownerRoot) || sameHostPath(consumerRoot, ownerRoot)) {
    throw new Error('Compiler dependency locator provider plan paths are not canonical external-generation paths.');
  }
  const observedConsumer = compilerDependencyConsumerIdentityV1(consumerRoot);
  if (!sameGeneratedStatePhysicalIdentityV1(observedConsumer, plan.consumer)) {
    throw new Error('Compiler dependency locator provider consumer root identity changed.');
  }
  const [consumerIdentity, ownerIdentity, generation] = await Promise.all([
    compilerDependencyIdentity(consumerRoot),
    compilerDependencyIdentity(ownerRoot),
    compilerDependencyGenerationIdentityV1(generationPath)
  ]);
  if (consumerIdentity.manifestHash !== plan.consumerManifestHash ||
      ownerIdentity.manifestHash !== plan.ownerManifestHash ||
      ownerIdentity.manifestHash !== consumerIdentity.manifestHash ||
      !canonicalEquals(generation, plan.generation)) {
    throw new Error('Compiler dependency locator provider inputs or generation identity changed.');
  }
  const binding = await compilerDependencyGenerationBinding(
    ownerRoot,
    generationPath,
    path.join(generationPath, COMPILER_DEPS_BINDING_FILE),
    ownerIdentity
  );
  if (binding === null || !canonicalEquals(binding, plan.binding) ||
      generatedStateDigestV1(binding) !== plan.bindingDigest) {
    throw new Error('Compiler dependency locator provider generation binding changed.');
  }
  if (!requireLocator) {
    const finalConsumer = inspectNoFollowDirectoryChainV1(
      consumerRoot,
      'Compiler dependency locator final consumer root'
    ).target;
    if (!sameGeneratedStatePhysicalIdentityV1(
      { device: finalConsumer.device, inode: finalConsumer.inode, objectId: finalConsumer.objectId },
      plan.consumer
    )) {
      throw new Error('Compiler dependency locator provider consumer root changed during validation.');
    }
    return Object.freeze({ consumer: finalConsumer, locator: null });
  }
  const locator = compilerDependencyLocatorObservationV1(consumerRoot, plan.relativePath);
  const bridgeBinding = await compilerDependencyConsumerBridgeBinding(
    consumerRoot,
    path.join(consumerRoot, plan.relativePath),
    consumerIdentity,
    options
  );
  if (locator === null || !sameGeneratedStatePhysicalIdentityV1(locator.source, plan.source) ||
      locator.linkTarget !== plan.linkTarget || bridgeBinding === null || !canonicalEquals(bridgeBinding, plan.binding)) {
    throw new Error('Compiler dependency locator provider locator identity or target changed.');
  }
  const finalConsumer = inspectNoFollowDirectoryChainV1(
    consumerRoot,
    'Compiler dependency locator final consumer root'
  ).target;
  if (!sameGeneratedStatePhysicalIdentityV1(
    { device: finalConsumer.device, inode: finalConsumer.inode, objectId: finalConsumer.objectId },
    plan.consumer
  )) {
    throw new Error('Compiler dependency locator provider consumer root changed during validation.');
  }
  return Object.freeze({ consumer: finalConsumer, locator });
}

export const compilerDependencyLocatorWorktreeRetirementProviderV1:
GeneratedStateWorktreeRetirementProviderV1 = Object.freeze<GeneratedStateWorktreeRetirementProviderV1>({
  id: COMPILER_DEPENDENCY_LOCATOR_PROVIDER_ID,
  async plan(input) {
    if (input.relativePath !== 'node_modules' || input.registration.phase !== 'retired' ||
      !sameGeneratedStatePhysicalIdentityV1(input.registration.root, input.source)) {
      throw new Error('Compiler dependency locator provider requires one exact retired registration.');
    }
    const consumerRoot = path.resolve(input.workspaceRoot);
    const consumer = compilerDependencyConsumerIdentityV1(consumerRoot);
    if (!sameGeneratedStatePhysicalIdentityV1(consumer, input.registration.workspace)) {
      throw new Error('Compiler dependency locator provider registration targets another consumer root.');
    }
    const consumerIdentity = await compilerDependencyIdentity(consumerRoot);
    const locator = compilerDependencyLocatorObservationV1(consumerRoot, input.relativePath);
    if (locator === null || !sameGeneratedStatePhysicalIdentityV1(locator.source, input.source)) {
      throw new Error('Compiler dependency locator provider source changed before planning.');
    }
    const generationPath = path.resolve(await fs.realpath(path.join(consumerRoot, input.relativePath)));
    const ownerRoot = path.dirname(generationPath);
    const ownerIdentity = await compilerDependencyIdentity(ownerRoot);
    const binding = await compilerDependencyConsumerBridgeBinding(
      consumerRoot,
      path.join(consumerRoot, input.relativePath),
      consumerIdentity,
      {}
    );
    if (binding === null || ownerIdentity.manifestHash !== consumerIdentity.manifestHash) {
      throw new Error('Compiler dependency locator provider target is not one compatible external generation.');
    }
    const material: CompilerDependencyLocatorRetirementPlanV1 = Object.freeze({
      schema: COMPILER_DEPENDENCY_LOCATOR_PLAN_SCHEMA,
      consumerRoot,
      consumer,
      relativePath: 'node_modules',
      source: locator.source,
      linkTarget: locator.linkTarget,
      generationPath,
      generation: await compilerDependencyGenerationIdentityV1(generationPath),
      ownerRoot,
      consumerManifestHash: consumerIdentity.manifestHash,
      ownerManifestHash: ownerIdentity.manifestHash,
      binding,
      bindingDigest: generatedStateDigestV1(binding)
    });
    const bytes = canonicalProviderBytesV1(material);
    return Object.freeze({
      bytes,
      digest: generatedStateDomainProviderMaterialDigestV1(COMPILER_DEPENDENCY_LOCATOR_PROVIDER_ID, 'plan', bytes)
    });
  },
  async retire(input) {
    if (input.relativePath !== 'node_modules' || input.registration.phase !== 'retired' ||
        input.planDigest !== generatedStateDomainProviderMaterialDigestV1(
          COMPILER_DEPENDENCY_LOCATOR_PROVIDER_ID,
          'plan',
          input.planBytes
        )) {
      throw new Error('Compiler dependency locator provider retirement authority is invalid.');
    }
    const plan = parseCompilerDependencyLocatorRetirementPlanV1(input.planBytes);
    if (path.resolve(input.workspaceRoot) !== plan.consumerRoot ||
      !sameGeneratedStatePhysicalIdentityV1(input.source, plan.source) ||
      !sameGeneratedStatePhysicalIdentityV1(input.registration.root, plan.source) ||
      !sameGeneratedStatePhysicalIdentityV1(input.registration.workspace, plan.consumer)) {
      throw new Error('Compiler dependency locator provider retirement binding changed.');
    }
    const locator = compilerDependencyLocatorObservationV1(plan.consumerRoot, plan.relativePath);
    let outcome: 'removed' | 'resumed-absent';
    if (locator === null) {
      await validateCompilerDependencyLocatorPlanV1(plan, false, {});
      outcome = 'resumed-absent';
    } else {
      const validated = await validateCompilerDependencyLocatorPlanV1(plan, true, {});
      deleteRetainedNoFollowEntryV1({
        root: validated.consumer,
        relativePath: plan.relativePath,
        kind: 'link',
        device: locator.source.device,
        inode: locator.source.inode,
        expectedLinkTarget: locator.linkTarget,
        ancestorDirectories: Object.freeze([])
      });
      if (compilerDependencyLocatorObservationV1(plan.consumerRoot, plan.relativePath) !== null) {
        throw new Error('Compiler dependency locator provider locator remains after retirement.');
      }
      await validateCompilerDependencyLocatorPlanV1(plan, false, {});
      outcome = 'removed';
    }
    const bytes = canonicalProviderBytesV1(Object.freeze({
      schema: COMPILER_DEPENDENCY_LOCATOR_RECEIPT_SCHEMA,
      operationId: input.operationId,
      planDigest: input.planDigest,
      outcome,
      locator: plan.source,
      generation: plan.generation,
      bindingDigest: plan.bindingDigest
    }));
    return Object.freeze({
      bytes,
      digest: generatedStateDomainProviderMaterialDigestV1(COMPILER_DEPENDENCY_LOCATOR_PROVIDER_ID, 'receipt', bytes)
    });
  }
});

interface RetainedGitControlFileV1 {
  readonly capability: RetainedNoFollowOrdinaryFileV1;
  readonly value: string;
  assertCurrent(): void;
}

interface LinkedWorktreeDependencyOwnerAuthorityV1 {
  readonly consumerRoot: string;
  readonly ownerRoot: string;
  assertCurrent(): void;
  dispose(): void;
}

function samePhysicalDirectoryV1(
  left: PhysicalDirectoryIdentityV1,
  right: PhysicalDirectoryIdentityV1
): boolean {
  return left.device === right.device && left.inode === right.inode && left.objectId === right.objectId;
}

function retainGitControlFileV1(
  parent: PhysicalDirectoryChainV1,
  name: string,
  label: string,
  parse: (source: Uint8Array) => string
): RetainedGitControlFileV1 {
  const capability = retainNoFollowOrdinaryFileV1(parent, name, undefined, label);
  try {
    if (capability.size > 32_768) {
      throw new Error(`${label} exceeds the bounded Git control-file domain.`);
    }
    const before = capability.digest();
    const value = parse(capability.readBytes());
    const after = capability.digest();
    if (before.size !== after.size || before.byteDigest !== after.byteDigest) {
      throw new Error(`${label} changed during retained parsing.`);
    }
    return Object.freeze({
      capability,
      value,
      assertCurrent: () => {
        capability.assertCurrent();
        const current = capability.digest();
        if (current.size !== before.size || current.byteDigest !== before.byteDigest) {
          throw new Error(`${label} bytes changed after retained parsing.`);
        }
      }
    });
  } catch (error) {
    capability.dispose();
    throw error;
  }
}

function disposeRetainedGitControlFilesV1(files: readonly RetainedGitControlFileV1[]): void {
  let failure: unknown = null;
  for (const file of [...files].reverse()) {
    try {
      file.capability.dispose();
    } catch (error) {
      failure ??= error;
    }
  }
  if (failure !== null) throw failure;
}

/**
 * Derives the primary dependency owner from Git's physical linked-worktree
 * registry, without executing Git or trusting a caller/path projection.  The
 * root locator, admin `commondir`, and reciprocal `gitdir` back-reference are
 * retained for the whole dependency observation and content-fenced on every
 * readback.  A regular `.git` marker that is not one exact registry member is
 * therefore a typed authority failure, never a local-install fallback.
 */
function linkedWorktreeDependencyOwnerRootV1(
  consumerRoot: string
): LinkedWorktreeDependencyOwnerAuthorityV1 | null {
  const markerPath = path.join(consumerRoot, '.git');
  let markerMetadata: ReturnType<typeof lstatSync>;
  try {
    markerMetadata = lstatSync(markerPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (!markerMetadata.isFile() || markerMetadata.isSymbolicLink()) return null;

  const retained: RetainedGitControlFileV1[] = [];
  try {
    const consumer = inspectNoFollowDirectoryChainV1(consumerRoot, 'Linked worktree consumer root');
    const marker = retainGitControlFileV1(
      consumer,
      '.git',
      'Linked worktree .git locator',
      parseGitWorktreeAdminLocatorV1
    );
    retained.push(marker);
    const adminDirectory = path.resolve(consumerRoot, marker.value);
    const admin = inspectNoFollowDirectoryChainV1(adminDirectory, 'Linked worktree registry admin');
    const commonLocator = retainGitControlFileV1(
      admin,
      'commondir',
      'Linked worktree commondir locator',
      (source) => parseGitWorktreeAdminPathV1(source, 'linked-worktree commondir')
    );
    retained.push(commonLocator);
    const backReference = retainGitControlFileV1(
      admin,
      'gitdir',
      'Linked worktree gitdir back-reference',
      (source) => parseGitWorktreeAdminPathV1(source, 'linked-worktree gitdir')
    );
    retained.push(backReference);

    const commonDirectory = path.resolve(adminDirectory, commonLocator.value);
    const common = inspectNoFollowDirectoryChainV1(commonDirectory, 'Linked worktree common Git directory');
    const worktreesDirectory = path.join(commonDirectory, 'worktrees');
    const worktrees = inspectNoFollowDirectoryChainV1(
      worktreesDirectory,
      'Linked worktree registry namespace'
    );
    const adminName = path.basename(adminDirectory);
    if (adminName.length === 0 || adminName === '.' || adminName === '..' ||
        !sameHostPath(path.dirname(adminDirectory), worktreesDirectory)) {
      throw new Error('Linked worktree admin is not one direct registry member.');
    }
    const registeredAdmin = inspectNoFollowDirectoryChainV1(
      path.join(worktreesDirectory, adminName),
      'Linked worktree registered admin'
    );
    if (!samePhysicalDirectoryV1(admin.target, registeredAdmin.target)) {
      throw new Error('Linked worktree admin is not the registered physical directory.');
    }
    const registeredMarkerPath = path.resolve(adminDirectory, backReference.value);
    if (!sameHostPath(registeredMarkerPath, markerPath)) {
      throw new Error('Linked worktree registry back-reference does not bind this consumer.');
    }
    if (path.basename(commonDirectory).toLocaleLowerCase('en-US') !== '.git') {
      throw new Error('Linked worktree common directory is not an owner .git directory.');
    }
    const ownerRoot = path.dirname(commonDirectory);
    if (sameHostPath(ownerRoot, consumerRoot)) {
      throw new Error('Linked worktree dependency owner is not physically distinct.');
    }
    const owner = inspectNoFollowDirectoryChainV1(ownerRoot, 'Linked worktree dependency owner root');
    const ownerGit = inspectNoFollowDirectoryChainV1(
      path.join(ownerRoot, '.git'),
      'Linked worktree dependency owner Git directory'
    );
    if (!samePhysicalDirectoryV1(common.target, ownerGit.target)) {
      throw new Error('Linked worktree common directory is not the owner registry root.');
    }

    const assertCurrent = (): void => {
      assertSameNoFollowDirectoryIdentityV1(consumer.target, 'Linked worktree consumer root');
      assertSameNoFollowDirectoryIdentityV1(admin.target, 'Linked worktree registry admin');
      assertSameNoFollowDirectoryIdentityV1(common.target, 'Linked worktree common Git directory');
      assertSameNoFollowDirectoryIdentityV1(worktrees.target, 'Linked worktree registry namespace');
      assertSameNoFollowDirectoryIdentityV1(owner.target, 'Linked worktree dependency owner root');
      assertSameNoFollowDirectoryIdentityV1(ownerGit.target, 'Linked worktree dependency owner Git directory');
      for (const file of retained) file.assertCurrent();
    };
    assertCurrent();
    let disposed = false;
    return Object.freeze({
      consumerRoot,
      ownerRoot,
      assertCurrent: () => {
        if (disposed) throw new Error('Linked worktree registry authority is disposed.');
        assertCurrent();
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        disposeRetainedGitControlFilesV1(retained);
      }
    });
  } catch (error) {
    try {
      disposeRetainedGitControlFilesV1(retained);
    } catch (disposalError) {
      throw new CompilerError(
        'IMPORT-AUTHORITY-004',
        'Linked worktree registry authority cleanup failed',
        {
          cause: error instanceof Error ? error.message : String(error),
          disposalCause: disposalError instanceof Error ? disposalError.message : String(disposalError)
        }
      );
    }
    throw new CompilerError(
      'IMPORT-AUTHORITY-004',
      'Linked worktree registry authority is invalid',
      { cause: error instanceof Error ? error.message : String(error), markerPath }
    );
  }
}

async function resolveLinkedWorktreeDependencyGenerationV1(input: Readonly<{
  consumerRoot: string;
  consumerIdentity: CompilerDependencyIdentity;
  options: RuntimeDependencyOperationOptionsV1;
}>): Promise<Readonly<{
  binding: CompilerDepsBinding;
  nodeModulesPath: string;
  sourceGeneration: RuntimeDependencySourceGenerationV1;
}> | null> {
  const ownerAuthority = linkedWorktreeDependencyOwnerRootV1(input.consumerRoot);
  if (ownerAuthority === null) return null;
  try {
    const ownerRoot = ownerAuthority.ownerRoot;
    ownerAuthority.assertCurrent();
    const ownerIdentity = await compilerDependencyIdentity(ownerRoot);
    ownerAuthority.assertCurrent();
    if (ownerIdentity.manifestHash !== input.consumerIdentity.manifestHash) return null;
    const nodeModulesPath = dependencyAuthorityPaths(ownerRoot).compilerModulesRoot;
    const binding = await compilerDependencyGenerationBinding(
      ownerRoot,
      nodeModulesPath,
      path.join(nodeModulesPath, COMPILER_DEPS_BINDING_FILE),
      ownerIdentity
    );
    ownerAuthority.assertCurrent();
    if (binding === null) return null;
    const [finalOwnerIdentity, finalConsumerIdentity, finalBinding] = await Promise.all([
      compilerDependencyIdentity(ownerRoot),
      compilerDependencyIdentity(input.consumerRoot),
      compilerDependencyGenerationBinding(
        ownerRoot,
        nodeModulesPath,
        path.join(nodeModulesPath, COMPILER_DEPS_BINDING_FILE),
        ownerIdentity
      )
    ]);
    ownerAuthority.assertCurrent();
    if (finalOwnerIdentity.manifestHash !== input.consumerIdentity.manifestHash ||
        finalConsumerIdentity.manifestHash !== input.consumerIdentity.manifestHash ||
        finalBinding === null || !canonicalEquals(finalBinding, binding)) {
      throw new CompilerError(
        'IMPORT-AUTHORITY-004',
        'Linked worktree dependency generation changed during validation'
      );
    }
    const sourceGeneration = await runtimeDependencySourceGenerationV1({
      binding: finalBinding,
      options: input.options,
      ownerRoot,
      sourcePath: nodeModulesPath
    });
    ownerAuthority.assertCurrent();
    return Object.freeze({ binding: finalBinding, nodeModulesPath, sourceGeneration });
  } finally {
    ownerAuthority.dispose();
  }
}

async function bindExistingCompilerDependencyLocatorV1(
  root: string,
  identity: CompilerDependencyIdentity,
  binding: CompilerDepsBinding,
  options: RuntimeDependencyInstallOptions
): Promise<void> {
  if (options.generatedStateLifecycle === undefined) return;
  const locator = compilerDependencyLocatorObservationV1(root, 'node_modules');
  if (locator === null) {
    throw new CompilerError('IMPORT-AUTHORITY-004', 'Existing compiler dependency locator disappeared before provenance binding');
  }
  const bind = options.generatedStateLifecycle.bind;
  if (bind === undefined) {
    throw new CompilerError('IMPORT-AUTHORITY-004', 'Existing compiler dependency locator has no read-only provenance binding path');
  }
  await bind('node_modules', {
    owner: COMPILER_NODE_MODULES_LIFECYCLE_OWNER_V1,
    producer: COMPILER_NODE_MODULES_LIFECYCLE_PRODUCER_V1,
    ruleId: COMPILER_NODE_MODULES_LIFECYCLE_RULE_V1,
    physical: locator.source
  });
  const registrationBinding = await compilerDependencyConsumerBridgeBinding(
    root,
    path.join(root, 'node_modules'),
    identity,
    options
  );
  if (registrationBinding === null || !canonicalEquals(registrationBinding, binding)) {
    throw new CompilerError('IMPORT-AUTHORITY-004', 'Compiler dependency locator changed after provenance binding');
  }
}

/**
 * A locator created by this producer is the sole positive path allowed to
 * issue a fresh lifecycle registration.  Existing/fresh-process locators use
 * `bindExistingCompilerDependencyLocatorV1` above and can never self-sign.
 */
async function publishCompilerDependencyLocatorLifecycleV1(
  root: string,
  identity: CompilerDependencyIdentity,
  binding: CompilerDepsBinding,
  options: RuntimeDependencyInstallOptions
): Promise<void> {
  if (options.generatedStateLifecycle === undefined) return;
  const locator = compilerDependencyLocatorObservationV1(root, 'node_modules');
  if (locator === null) {
    throw new CompilerError('IMPORT-AUTHORITY-004', 'Published compiler dependency locator has no physical identity');
  }
  await options.generatedStateLifecycle.born(
    'node_modules',
    `compiler-dependency-bridge:${identity.manifestHash}:${generatedStateDigestV1(binding)}`
  );
  await options.generatedStateLifecycle.retired('node_modules', 'external-generation-bridge-ready');
  const registrationBinding = await compilerDependencyConsumerBridgeBinding(
    root,
    path.join(root, 'node_modules'),
    identity,
    options
  );
  if (registrationBinding === null || !canonicalEquals(registrationBinding, binding)) {
    throw new CompilerError('IMPORT-AUTHORITY-004', 'Compiler dependency locator changed after lifecycle publication');
  }
}

async function deleteExactCompilerDependencyLocatorV1(
  rootPath: string,
  expected: Readonly<{ source: GeneratedStatePhysicalIdentityV1; linkTarget: string }>,
  options: RuntimeDependencyOperationOptionsV1
): Promise<void> {
  const root = inspectNoFollowDirectoryChainV1(rootPath, 'Compiler dependency locator cleanup root').target;
  const locator = inspectNoFollowLinkEntryV1(root, 'node_modules');
  if (locator === null) {
    throw new Error('Compiler dependency locator disappeared before exact rollback.');
  }
  if (locator.linkTarget === null || locator.kind !== 'link') {
    throw new Error('Compiler dependency locator changed before exact rollback.');
  }
  const observedSource = Object.freeze({
    device: locator.device,
    inode: locator.inode,
    objectId: generatedStateDigestV1({ kind: 'link', target: locator.linkTarget })
  });
  if (!sameGeneratedStatePhysicalIdentityV1(observedSource, expected.source)
      || locator.linkTarget !== expected.linkTarget) {
    throw new Error('Compiler dependency locator changed before exact rollback.');
  }
  await runtimeDependencyOperationEffectFenceV1(options, 'Compiler dependency locator rollback');
  deleteRetainedNoFollowEntryV1({
    root,
    relativePath: 'node_modules',
    kind: 'link',
    device: locator.device,
    inode: locator.inode,
    expectedLinkTarget: locator.linkTarget,
    ancestorDirectories: Object.freeze([])
  });
  if (compilerDependencyLocatorObservationV1(rootPath, 'node_modules') !== null) {
    throw new Error('Compiler dependency locator remains after exact rollback.');
  }
}

const COMPILER_DEPS_BINDING_KEYS_V1 = Object.freeze([
  'architecture', 'bunExecutablePath', 'bunExecutableSha256', 'bunVersion',
  'declaredBunVersion', 'dependencyManifestSha256', 'formatVersion',
  'installConfigSha256', 'lockSha256', 'manifestHash', 'packages', 'platform',
  'runtimeMaterialization'
] as const);

const COMPILER_NODE_MODULES_LIFECYCLE_OWNER_V1 = 'compiler-dependency-runtime' as const;
const COMPILER_NODE_MODULES_LIFECYCLE_PRODUCER_V1 = 'ensure-compiler-deps-ready' as const;
const COMPILER_NODE_MODULES_LIFECYCLE_RULE_V1 = 'compiler-node-modules' as const;
const COMPILER_STAGING_LIFECYCLE_OWNER_V1 = 'compiler-dependency-runtime' as const;
const COMPILER_STAGING_LIFECYCLE_PRODUCER_V1 = 'stage-compiler-dependency-generation' as const;
const COMPILER_STAGING_LIFECYCLE_RULE_V1 = 'compiler-dependency-staging' as const;
const SHARED_DEPS_LIFECYCLE_OWNER_V1 = 'project-runtime' as const;
const SHARED_DEPS_LIFECYCLE_PRODUCER_V1 = 'ensure-shared-deps-ready' as const;
const SHARED_DEPS_LIFECYCLE_RULE_V1 = 'shared-dependency-cache' as const;

async function bindExistingCompilerDependencyGenerationV1(
  options: RuntimeDependencyInstallOptions,
  expectedPhysical: GeneratedStatePhysicalIdentityV1
): Promise<void> {
  const lifecycle = options.generatedStateLifecycle;
  if (lifecycle === undefined) {
    throw new CompilerError(
      'IMPORT-AUTHORITY-004',
      'Existing compiler dependency generation has no producer provenance registration and is preserved'
    );
  }
  const bind = lifecycle.bind;
  if (bind === undefined) {
    throw new CompilerError(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency generation adoption requires read-only producer provenance binding and is preserved'
    );
  }
  try {
    await bind('node_modules', {
      owner: COMPILER_NODE_MODULES_LIFECYCLE_OWNER_V1,
      producer: COMPILER_NODE_MODULES_LIFECYCLE_PRODUCER_V1,
      ruleId: COMPILER_NODE_MODULES_LIFECYCLE_RULE_V1,
      physical: expectedPhysical
    });
  } catch (error) {
    throw new CompilerError(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency generation producer provenance is missing, invalid, foreign, or stale; physical target is preserved',
      { cause: error instanceof Error ? error.message : String(error) }
    );
  }
}

async function bindExistingSharedDependencyRootV1(
  options: RuntimeDependencyInstallOptions,
  expected: PhysicalDirectoryIdentityV1
): Promise<void> {
  const lifecycle = options.generatedStateLifecycle;
  if (lifecycle === undefined) {
    throw new CompilerError(
      'IMPORT-AUTHORITY-004',
      'Existing shared dependency root has no producer provenance registration and is preserved'
    );
  }
  const bind = lifecycle.bind;
  if (bind === undefined) {
    throw new CompilerError(
      'IMPORT-AUTHORITY-004',
      'Shared dependency root adoption requires read-only producer provenance binding and is preserved'
    );
  }
  try {
    await bind('.shared-deps', {
      owner: SHARED_DEPS_LIFECYCLE_OWNER_V1,
      producer: SHARED_DEPS_LIFECYCLE_PRODUCER_V1,
      ruleId: SHARED_DEPS_LIFECYCLE_RULE_V1,
      physical: generatedStatePhysicalIdentityV1(expected)
    });
  } catch (error) {
    throw new CompilerError(
      'IMPORT-AUTHORITY-004',
      'Shared dependency root producer provenance is missing, invalid, foreign, or stale; physical root is preserved',
      { cause: error instanceof Error ? error.message : String(error) }
    );
  }
}

/**
 * A replacement operation never births provenance for the directory it is
 * about to move.  It must adopt the active registration issued when that
 * generation was published, then retire that exact registration digest.
 */
async function bindAndRetireCompilerDependencyPreimageV1(
  options: RuntimeDependencyInstallOptions,
  expectedPhysical: GeneratedStatePhysicalIdentityV1,
  outcome: string
): Promise<`sha256:${string}` | null> {
  const lifecycle = options.generatedStateLifecycle;
  if (lifecycle === undefined) {
    throw new CompilerError(
      'IMPORT-AUTHORITY-004',
      'Existing compiler dependency generation has no producer provenance registration and is preserved'
    );
  }
  const bind = lifecycle.bind;
  if (bind === undefined) {
    throw new CompilerError(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency preimage retirement requires read-only producer provenance binding and is preserved'
    );
  }
  try {
    await bind('node_modules', {
      owner: COMPILER_NODE_MODULES_LIFECYCLE_OWNER_V1,
      producer: COMPILER_NODE_MODULES_LIFECYCLE_PRODUCER_V1,
      ruleId: COMPILER_NODE_MODULES_LIFECYCLE_RULE_V1,
      physical: expectedPhysical
    });
    const retired = await lifecycle.retired('node_modules', outcome);
    return retired !== undefined && 'registrationDigest' in retired
      ? retired.registrationDigest
      : null;
  } catch (error) {
    if (error instanceof CompilerError && error.code === 'IMPORT-AUTHORITY-004') throw error;
    throw new CompilerError(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency preimage producer provenance is missing, invalid, foreign, or stale; physical target is preserved',
      { cause: error instanceof Error ? error.message : String(error) }
    );
  }
}

/**
 * Proves that an incompatible physical directory is an SEC-generated
 * dependency generation before it may be moved out of the active locator.
 * The binding is not required to match the new epoch, but its own package
 * manifests and immutable envelope must still match the physical preimage.
 */
async function compilerDependencyGeneratedPreimageDigestV1(
  nodeModulesPath: string
): Promise<`sha256:${string}`> {
  const bindingPath = path.join(nodeModulesPath, COMPILER_DEPS_BINDING_FILE);
  const bindingMetadata = await fs.lstat(bindingPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (bindingMetadata === null || !bindingMetadata.isFile() || bindingMetadata.isSymbolicLink()) {
    throw new CompilerError(
      'IMPORT-AUTHORITY-004',
      'Existing node_modules is not an owned compiler dependency generation and is preserved'
    );
  }
  const candidate = await readJson<unknown>(bindingPath).catch(() => null);
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)
      || Object.getPrototypeOf(candidate) !== Object.prototype) {
    throw new CompilerError('IMPORT-AUTHORITY-004', 'Compiler dependency preimage binding is malformed and preserved');
  }
  const binding = candidate as Record<string, unknown>;
  if (Object.keys(binding).sort(compareCodeUnits).join('\0')
      !== [...COMPILER_DEPS_BINDING_KEYS_V1].sort(compareCodeUnits).join('\0')
      || binding.formatVersion !== 'compiler-deps-binding-v5'
      || typeof binding.architecture !== 'string'
      || typeof binding.bunExecutablePath !== 'string'
      || typeof binding.bunExecutableSha256 !== 'string'
      || typeof binding.bunVersion !== 'string'
      || typeof binding.declaredBunVersion !== 'string'
      || typeof binding.dependencyManifestSha256 !== 'string'
      || !(binding.installConfigSha256 === null || typeof binding.installConfigSha256 === 'string')
      || typeof binding.lockSha256 !== 'string'
      || typeof binding.manifestHash !== 'string'
      || typeof binding.platform !== 'string'
      || !Array.isArray(binding.packages)
      || binding.packages.length === 0
      || binding.packages.length > 10_000
      || !(binding.runtimeMaterialization === null
        || isRuntimeDependencyMaterializationBinding(binding.runtimeMaterialization))) {
    throw new CompilerError('IMPORT-AUTHORITY-004', 'Compiler dependency preimage binding shape is invalid and preserved');
  }
  for (const value of [
    binding.bunExecutableSha256,
    binding.dependencyManifestSha256,
    binding.lockSha256,
    binding.manifestHash,
    ...(binding.installConfigSha256 === null ? [] : [binding.installConfigSha256])
  ]) {
    if (!/^[0-9a-f]{64}$/u.test(value as string)) {
      throw new CompilerError('IMPORT-AUTHORITY-004', 'Compiler dependency preimage digest is invalid and preserved');
    }
  }
  const packageNames = new Set<string>();
  for (const rawPackage of binding.packages) {
    if (rawPackage === null || typeof rawPackage !== 'object' || Array.isArray(rawPackage)
        || Object.getPrototypeOf(rawPackage) !== Object.prototype) {
      throw new CompilerError('IMPORT-AUTHORITY-004', 'Compiler dependency preimage package binding is invalid');
    }
    const packageBinding = rawPackage as Record<string, unknown>;
    const expectedKeys = packageBinding.entry === undefined
      ? ['manifestSha256', 'name', 'version']
      : ['entry', 'manifestSha256', 'name', 'version'];
    if (Object.keys(packageBinding).sort(compareCodeUnits).join('\0') !== expectedKeys.join('\0')
        || typeof packageBinding.name !== 'string'
        || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/u.test(packageBinding.name)
        || typeof packageBinding.version !== 'string'
        || packageBinding.version.length === 0
        || typeof packageBinding.manifestSha256 !== 'string'
        || !/^[0-9a-f]{64}$/u.test(packageBinding.manifestSha256)
        || packageNames.has(packageBinding.name)) {
      throw new CompilerError('IMPORT-AUTHORITY-004', 'Compiler dependency preimage package identity is invalid');
    }
    packageNames.add(packageBinding.name);
    if (packageBinding.entry !== undefined) {
      const entry = packageBinding.entry;
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry)
          || Object.getPrototypeOf(entry) !== Object.prototype
          || Object.keys(entry).sort(compareCodeUnits).join('\0') !== ['path', 'sha256'].join('\0')
          || typeof (entry as Record<string, unknown>).path !== 'string'
          || typeof (entry as Record<string, unknown>).sha256 !== 'string'
          || !/^[0-9a-f]{64}$/u.test((entry as Record<string, unknown>).sha256 as string)) {
        throw new CompilerError('IMPORT-AUTHORITY-004', 'Compiler dependency preimage entry identity is invalid');
      }
    }
    const packageManifestPath = path.join(
      nodeModulesPath,
      ...packageBinding.name.split('/'),
      'package.json'
    );
    const manifestMetadata = await fs.lstat(packageManifestPath).catch(() => null);
    if (manifestMetadata === null || !manifestMetadata.isFile() || manifestMetadata.isSymbolicLink()) {
      throw new CompilerError('IMPORT-AUTHORITY-004', 'Compiler dependency preimage package manifest is not physical');
    }
    const physicalManifestPath = await fs.realpath(packageManifestPath);
    if (!isPathInside(nodeModulesPath, physicalManifestPath)) {
      throw new CompilerError('IMPORT-AUTHORITY-004', 'Compiler dependency preimage package manifest escapes its generation');
    }
    const manifestBytes = await fs.readFile(packageManifestPath);
    const manifest = JSON.parse(manifestBytes.toString('utf8')) as Record<string, unknown>;
    if (digest(manifestBytes) !== packageBinding.manifestSha256
        || manifest.name !== packageBinding.name
        || manifest.version !== packageBinding.version) {
      throw new CompilerError('IMPORT-AUTHORITY-004', 'Compiler dependency preimage package manifest changed and is preserved');
    }
  }
  return generatedStateDigestV1(binding);
}

type RetiredCompilerDependencyPreimageV1 = Readonly<{
  backupPath: string;
  bindingDigest: `sha256:${string}`;
  identity: CompilerDependencyDirectoryIdentity;
  retiredRegistrationDigest: `sha256:${string}` | null;
}>;

async function retireIncompatibleCompilerDependencyTargetV1(
  root: string,
  nodeModulesPath: string,
  options: RuntimeDependencyOperationOptionsV1,
  requestedBackupPath?: string
): Promise<RetiredCompilerDependencyPreimageV1 | null> {
  const identity = await compilerDependencyDirectoryIdentity(nodeModulesPath);
  if (identity === null) return null;
  const bindingDigest = await compilerDependencyGeneratedPreimageDigestV1(nodeModulesPath);
  const backupsRoot = path.join(root, '.tmp', 'dependency-installs', 'compiler-backups');
  const backupPath = requestedBackupPath ?? path.join(
    backupsRoot,
    `locator-preimage-${bindingDigest.slice('sha256:'.length, 'sha256:'.length + 24)}`
  );
  const compilerRootIdentity = inspectNoFollowDirectoryChainV1(
    root,
    'Compiler dependency backup owner root'
  ).target;
  await runtimeDependencyOperationEffectFenceV1(options, 'Compiler dependency preimage backup namespace creation');
  createNoFollowOrdinaryDirectoryChainV1(
    compilerRootIdentity,
    ['.tmp', 'dependency-installs', 'compiler-backups']
  );
  await runtimeDependencyOperationEffectFenceV1(options, 'Compiler dependency preimage retirement');
  const observed = await observeDependencyTransitionSlotV1(nodeModulesPath, bindingDigest);
  if (observed.kind !== 'directory' || observed.physical === null) {
    throw new CompilerError(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency preimage changed before producer provenance binding and is preserved'
    );
  }
  const retiredRegistrationDigest = await bindAndRetireCompilerDependencyPreimageV1(
    options,
    Object.freeze({
      device: observed.physical.device,
      inode: observed.physical.inode,
      objectId: observed.physical.objectId
    }),
    'external-generation-locator-transition'
  );
  await renameCompilerDependencyDirectory(nodeModulesPath, backupPath, options);
  return Object.freeze({ backupPath, bindingDigest, identity, retiredRegistrationDigest });
}

async function restoreRetiredCompilerDependencyTargetV1(
  nodeModulesPath: string,
  retired: RetiredCompilerDependencyPreimageV1,
  options: RuntimeDependencyOperationOptionsV1
): Promise<void> {
  const lifecycle = options.generatedStateLifecycle;
  if (lifecycle?.restore === undefined || retired.retiredRegistrationDigest === null) {
    throw new CompilerError(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency rollback has no exact lifecycle restore predecessor; recovery backup is preserved'
    );
  }
  const currentTarget = await observeDependencyTransitionSlotV1(nodeModulesPath);
  if (currentTarget.kind !== 'absent') {
    throw new CompilerError(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency transition target is occupied; exact preimage remains in recovery backup'
    );
  }
  const backupSlot = await observeDependencyTransitionSlotV1(retired.backupPath);
  if (backupSlot.kind !== 'directory' || backupSlot.physical === null) {
    throw new CompilerError('IMPORT-AUTHORITY-004', 'Compiler dependency recovery backup is absent or foreign and preserved');
  }
  const backupIdentity = await compilerDependencyDirectoryIdentity(retired.backupPath);
  if (!sameCompilerDependencyDirectoryIdentity(backupIdentity, retired.identity)) {
    throw new CompilerError('IMPORT-AUTHORITY-004', 'Compiler dependency transition recovery preimage identity changed and is preserved');
  }
  await renameCompilerDependencyDirectory(retired.backupPath, nodeModulesPath, options);
  const restored = await observeDependencyTransitionSlotV1(nodeModulesPath, retired.bindingDigest);
  if (restored.kind !== 'directory' || restored.physical === null ||
      !sameGeneratedStateIdentityV1(restored.physical, backupSlot.physical)) {
    throw new CompilerError('IMPORT-AUTHORITY-004', 'Compiler dependency rollback target identity changed before lifecycle restore');
  }
  await runtimeDependencyOperationEffectFenceV1(options, 'Compiler dependency retired preimage lifecycle restore');
  await lifecycle.restore(
    'node_modules',
    retired.retiredRegistrationDigest,
    restored.physical,
    'compiler-dependency-preimage-restored'
  );
}

type CompilerDependencyTransitionKindV1 = 'none' | 'generation-published' | 'locator-published';

function createCompilerDepsReadyStateV1(input: Readonly<{
  binding: Readonly<CompilerDepsBinding>;
  identity: CompilerDependencyIdentity;
  kind: CompilerDependencyTransitionKindV1;
  nodeModulesPath: string;
  root: string;
  sourceGeneration: Readonly<RuntimeDependencySourceGenerationV1>;
  source: 'existing' | 'installed';
}>): CompilerDepsReadyState {
  const transitionDigest = generatedStateDigestV1(Object.freeze({
    schema: 'sec-compiler-dependency-transition-v1',
    kind: input.kind,
    root: input.root,
    nodeModulesPath: input.nodeModulesPath,
    manifestHash: input.identity.manifestHash,
    bindingDigest: generatedStateDigestV1(input.binding),
    sourceGeneration: input.sourceGeneration
  }));
  return Object.freeze({
    manifestHash: input.identity.manifestHash,
    nodeModulesPath: input.nodeModulesPath,
    packageManager: 'bun' as const,
    requiresFreshProcess: input.kind !== 'none',
    root: input.root,
    runtimeMaterialization: input.binding.runtimeMaterialization,
    sourceGeneration: input.sourceGeneration,
    source: input.source,
    transitionDigest
  });
}

type CompilerDependencyReadyObservationV1 = Readonly<{
  binding: Readonly<CompilerDepsBinding>;
  kind: 'external-bridge' | 'local-generation';
  nodeModulesPath: string;
  sourceGeneration: Readonly<RuntimeDependencySourceGenerationV1>;
}>;

/**
 * Reads the one admitted compiler dependency surface without publishing or
 * repairing it. A linked-worktree locator and a local physical generation are
 * two representations of the same readiness contract, so read-only consumers
 * must not reimplement the generation-only half of that contract.
 */
async function observeCompilerDependencyReadyV1(
  root: string,
  nodeModulesPath: string,
  identity: CompilerDependencyIdentity,
  options: RuntimeDependencyOperationOptionsV1
): Promise<CompilerDependencyReadyObservationV1 | null> {
  const bridgeBinding = await compilerDependencyConsumerBridgeBinding(
    root,
    nodeModulesPath,
    identity,
    options
  );
  if (bridgeBinding !== null) {
    const generationPath = path.resolve(await fs.realpath(nodeModulesPath));
    const ownerRoot = path.dirname(generationPath);
    const sourceGeneration = await runtimeDependencySourceGenerationV1({
      binding: bridgeBinding,
      options,
      ownerRoot,
      sourcePath: generationPath
    });
    return Object.freeze({
      binding: bridgeBinding,
      kind: 'external-bridge',
      nodeModulesPath,
      sourceGeneration
    });
  }
  const generationBinding = await compilerDependencyGenerationBinding(
    root,
    nodeModulesPath,
    path.join(nodeModulesPath, COMPILER_DEPS_BINDING_FILE),
    identity
  );
  if (generationBinding === null) return null;
  const sourceGeneration = await runtimeDependencySourceGenerationV1({
    binding: generationBinding,
    options,
    ownerRoot: root,
    sourcePath: nodeModulesPath
  });
  return Object.freeze({
    binding: generationBinding,
    kind: 'local-generation',
    nodeModulesPath,
    sourceGeneration
  });
}

async function ensureCompilerDepsReadyInternal(
  options: RuntimeDependencyInstallOptions = {},
  compilerDependencyRoot = compilerRoot
): Promise<CompilerDepsReadyState> {
  const operationOptions = runtimeDependencyOperationOptionsV1(options);
  const root = path.resolve(compilerDependencyRoot);
  const lifecycleOptions = await bindCanonicalGeneratedStateLifecycle(operationOptions, root);
  const nodeModulesPath = dependencyAuthorityPaths(root).compilerModulesRoot;
  const bindingPath = path.join(nodeModulesPath, COMPILER_DEPS_BINDING_FILE);

  const identity = await compilerDependencyIdentity(root);
  const activeRollover = await inspectActiveDependencyTransitionRolloverV1(root, lifecycleOptions);
  if (activeRollover !== null && activeRollover.active !== null) {
    // Admission is still read-only; the lease callback above is the only
    // place that may perform the retained-root recovery effect.
    await withCompilerDependencyTransitionLeaseV1(root, lifecycleOptions, async () => undefined);
  }
  const pendingTransition = await readDependencyTransitionV1(root, lifecycleOptions);
  if (pendingTransition !== null && pendingTransition.kind !== 'project-projection' &&
      pendingTransition.kind !== 'compiler-bridge' &&
      pendingTransition.phase !== 'complete' && pendingTransition.phase !== 'rolled-back') {
    await withCompilerDependencyTransitionLeaseV1(root, lifecycleOptions, async (lockedOptions) => {
      await recoverCompilerDependencyTransitionV1(root, nodeModulesPath, identity, lockedOptions);
    });
  }
  const observed = await observeCompilerDependencyReadyV1(
    root,
    nodeModulesPath,
    identity,
    lifecycleOptions
  );
  if (observed?.kind === 'external-bridge') {
    return withCompilerDependencyTransitionLeaseV1(root, lifecycleOptions, async () => {
      const current = await observeCompilerDependencyReadyV1(
        root,
        nodeModulesPath,
        identity,
        lifecycleOptions
      );
      if (current?.kind !== 'external-bridge'
          || !canonicalEquals(current.binding, observed.binding)) {
        throw new CompilerError('IMPORT-AUTHORITY-004', 'Compiler dependency locator changed before lifecycle binding');
      }
      await bindExistingCompilerDependencyLocatorV1(root, identity, current.binding, lifecycleOptions);
      return createCompilerDepsReadyStateV1({
        binding: current.binding,
        identity,
        kind: 'none',
        nodeModulesPath,
        root,
        sourceGeneration: current.sourceGeneration,
        source: 'existing'
      });
    });
  }
  if (observed !== null) {
    return withCompilerDependencyTransitionLeaseV1(root, lifecycleOptions, async () => {
      const current = await observeCompilerDependencyReadyV1(
        root,
        nodeModulesPath,
        identity,
        lifecycleOptions
      );
      if (current?.kind !== 'local-generation') {
        throw new CompilerError(
          'IMPORT-AUTHORITY-004',
          'Compiler dependency generation changed before lifecycle binding; current state is preserved'
        );
      }
      if (lifecycleOptions.generatedStateLifecycle !== undefined) {
        await bindExistingCompilerDependencyGenerationV1(
          lifecycleOptions,
          current.sourceGeneration.physical
        );
      }
      return createCompilerDepsReadyStateV1({
        binding: current.binding,
        identity,
        kind: 'none',
        nodeModulesPath,
        root,
        sourceGeneration: current.sourceGeneration,
        source: 'existing'
      });
    });
  }
  const ready = () => compilerDependencyGenerationBinding(
    root,
    nodeModulesPath,
    bindingPath,
    identity
  );

  return withCompilerDependencyTransitionLeaseV1(root, lifecycleOptions, async (lockedOptions) => {
    const lockedBridge = await compilerDependencyConsumerBridgeBinding(
      root,
      nodeModulesPath,
      identity,
      lockedOptions
    );
    if (lockedBridge !== null) {
      await bindExistingCompilerDependencyLocatorV1(root, identity, lockedBridge, lockedOptions);
      return createCompilerDepsReadyStateV1({
        binding: lockedBridge,
        identity,
        kind: 'none',
        nodeModulesPath,
        root,
        sourceGeneration: await runtimeDependencySourceGenerationV1({
          binding: lockedBridge,
          options: lockedOptions,
          ownerRoot: path.dirname(path.resolve(await fs.realpath(nodeModulesPath))),
          sourcePath: path.resolve(await fs.realpath(nodeModulesPath))
        }),
        source: 'existing'
      });
    }
    const lockedExisting = await ready();
    if (lockedExisting !== null) {
      const existingSourceGeneration = await runtimeDependencySourceGenerationV1({
        binding: lockedExisting,
        options: lockedOptions,
        ownerRoot: root,
        sourcePath: nodeModulesPath
      });
      if (lockedOptions.generatedStateLifecycle !== undefined) {
        await bindExistingCompilerDependencyGenerationV1(
          lockedOptions,
          existingSourceGeneration.physical
        );
      }
      const readyState = createCompilerDepsReadyStateV1({
        binding: lockedExisting,
        identity,
        kind: 'none',
        nodeModulesPath,
        root,
        sourceGeneration: existingSourceGeneration,
        source: 'existing'
      });
      return readyState;
    }

    const sharedWorktreeGeneration = await resolveLinkedWorktreeDependencyGenerationV1({
      consumerRoot: root,
      consumerIdentity: identity,
      options: lockedOptions
    });
    if (sharedWorktreeGeneration !== null) {
      let createdLocator = false;
      let createdLocatorIdentity: Readonly<{
        source: GeneratedStatePhysicalIdentityV1;
        linkTarget: string;
      }> | null = null;
      let lifecycleBindingAttempted = false;
      let retiredPreimage: RetiredCompilerDependencyPreimageV1 | null = null;
      const sourceGeneration = sharedWorktreeGeneration.sourceGeneration;
      const locatorBackupPath = path.join(
        (await ensureDependencyTransitionNamespaceV1(root, lockedOptions)).backupRoot.path,
        `locator-preimage-${sourceGeneration.epoch.slice('sha256:'.length, 'sha256:'.length + 24)}`
      );
      let transition: DependencyTransitionJournalV1 | null = null;
      try {
        const currentTarget = await observeDependencyTransitionSlotV1(nodeModulesPath);
        if (currentTarget.kind === 'directory') {
          await compilerDependencyGeneratedPreimageDigestV1(nodeModulesPath);
        } else if (currentTarget.kind !== 'absent') {
          throw new CompilerError('IMPORT-AUTHORITY-004', 'Foreign compiler dependency locator target is preserved');
        }
        transition = await beginDependencyTransitionV1({
          kind: 'compiler-locator',
          ownerRoot: root,
          destinationPath: nodeModulesPath,
          stagePath: null,
          backupPath: locatorBackupPath,
          sourceGeneration,
          bindingDigest: generatedStateDigestV1(sharedWorktreeGeneration.binding),
          options: lockedOptions
        });
        if (transition.preimage.kind === 'directory') {
          retiredPreimage = await retireIncompatibleCompilerDependencyTargetV1(
            root,
            nodeModulesPath,
            lockedOptions,
            locatorBackupPath
          );
          transition = await advanceDependencyTransitionV1(transition, {
            destination: transitionAbsentSlotV1(nodeModulesPath),
            backup: await observeDependencyTransitionSlotV1(locatorBackupPath),
            phase: 'backed-up',
            durability: 'known',
            failure: null
          }, lockedOptions);
        }
        await createCompilerDependencyLocatorV1(
          nodeModulesPath,
          sharedWorktreeGeneration.nodeModulesPath,
          sourceGeneration.physical,
          lockedOptions
        );
        createdLocator = true;
        createdLocatorIdentity = compilerDependencyLocatorObservationV1(root, 'node_modules');
        if (createdLocatorIdentity === null) {
          throw new CompilerError('IMPORT-AUTHORITY-004', 'Published compiler dependency locator has no physical identity');
        }
        transition = await advanceDependencyTransitionV1(transition, {
          destination: await observeDependencyTransitionSlotV1(nodeModulesPath),
          sourceGeneration,
          phase: 'published',
          durability: 'known',
          failure: null
        }, lockedOptions);
        const binding = await compilerDependencyConsumerBridgeBinding(
          root,
          nodeModulesPath,
          identity,
          lockedOptions
        );
        if (binding === null || !canonicalEquals(binding, sharedWorktreeGeneration.binding)) {
          throw new CompilerError('IMPORT-AUTHORITY-004', 'Published compiler dependency locator failed exact readback');
        }
        lifecycleBindingAttempted = true;
        await publishCompilerDependencyLocatorLifecycleV1(root, identity, binding, lockedOptions);
        await advanceDependencyTransitionV1(transition, {
          destination: await observeDependencyTransitionSlotV1(nodeModulesPath),
          backup: await observeDependencyTransitionSlotV1(locatorBackupPath),
          sourceGeneration,
          phase: 'complete',
          durability: 'known',
          failure: null
        }, lockedOptions);
        return createCompilerDepsReadyStateV1({
          binding,
          identity,
          kind: 'locator-published',
          nodeModulesPath,
          root,
          sourceGeneration,
          source: 'existing'
        });
      } catch (error) {
        // Before lifecycle ownership starts, this process still owns the exact
        // locator publication and may CAS-unlink it. Once lifecycle binding is
        // attempted, preserve the locator: the next invocation can adopt the
        // exact active registration and finish retirement without orphaning a
        // durable registration or touching the external generation.
        let rollbackFailure: unknown;
        if (createdLocator && !lifecycleBindingAttempted && createdLocatorIdentity !== null) {
          try {
            await deleteExactCompilerDependencyLocatorV1(root, createdLocatorIdentity, lockedOptions);
          } catch (rollbackError) {
            rollbackFailure = rollbackError;
          }
        }
        if (retiredPreimage !== null && !lifecycleBindingAttempted &&
          (await observeDependencyTransitionSlotV1(nodeModulesPath)).kind === 'absent') {
          try {
            await restoreRetiredCompilerDependencyTargetV1(
              nodeModulesPath,
              retiredPreimage,
              lockedOptions
            );
          } catch (rollbackError) {
            rollbackFailure ??= rollbackError;
          }
        }
        if (transition !== null) {
          if (rollbackFailure === undefined && !lifecycleBindingAttempted) {
            await advanceDependencyTransitionV1(transition, {
              destination: await observeDependencyTransitionSlotV1(nodeModulesPath),
              backup: await observeDependencyTransitionSlotV1(locatorBackupPath),
              phase: 'rolled-back',
              durability: 'known',
              failure: transitionFailureV1(error)
            }, lockedOptions).catch((journalError) => { rollbackFailure = journalError; });
          } else if (lifecycleBindingAttempted || rollbackFailure !== undefined) {
            await markDependencyTransitionFailureV1(transition, error, lockedOptions).catch((journalError) => {
              rollbackFailure ??= journalError;
            });
          }
        }
        if (rollbackFailure !== undefined) {
          throw new CompilerError(
            'IMPORT-AUTHORITY-004',
            'Compiler dependency locator transition failed and exact rollback requires recovery',
            {
              cause: error instanceof Error ? error.message : String(error),
              causeDetails: error instanceof CompilerError ? error.details : null,
              recoveryBackup: retiredPreimage?.backupPath ?? null,
              rollbackFailure: rollbackFailure instanceof Error
                ? rollbackFailure.message
                : String(rollbackFailure)
            }
          );
        }
        throw error;
      }
    }

    const staged = await stageCompilerDependencyGeneration(root, identity, lockedOptions);
    await publishCompilerDependencyGeneration(
      root,
      nodeModulesPath,
      staged.stagingRoot,
      identity,
      lockedOptions
    );
    const published = await ready();
    if (published === null) {
      throw new CompilerError('IMPORT-AUTHORITY-002', 'Published compiler dependency generation failed validation');
    }

    const readyState = createCompilerDepsReadyStateV1({
      binding: published,
      identity,
      kind: 'generation-published',
      nodeModulesPath,
      root,
      sourceGeneration: await runtimeDependencySourceGenerationV1({
        binding: published,
        options: lifecycleOptions,
        ownerRoot: root,
        sourcePath: nodeModulesPath
      }),
      source: 'installed'
    });
    return readyState;
  });
}

const dependencyInvocationFunctionIdsV1 = new WeakMap<Function, number>();
let dependencyInvocationFunctionSequenceV1 = 0;
function dependencyInvocationFunctionIdV1(value: Function | undefined): number {
  if (value === undefined) return 0;
  const existing = dependencyInvocationFunctionIdsV1.get(value);
  if (existing !== undefined) return existing;
  const next = ++dependencyInvocationFunctionSequenceV1;
  dependencyInvocationFunctionIdsV1.set(value, next);
  return next;
}

function compilerDependencyReadyInFlightKeyV1(
  options: RuntimeDependencyInstallOptions,
  root: string
): string | null {
  // Hooks, fences, lifecycle sessions and retry seams carry caller-local
  // effects; joining those calls would silently drop an owner's observation.
  if (options.beforeCommit !== undefined || options.generatedStateLifecycle !== undefined ||
      options.signal !== undefined || options.monotonicNowMs !== undefined || options.now !== undefined ||
      options.sleep !== undefined ||
      options.testCompilerPublishHook !== undefined || options.testCompilerBridgeValidationHook !== undefined ||
      options.testCompilerRename !== undefined) return null;
  return JSON.stringify([
    path.resolve(root),
    dependencyInvocationFunctionIdV1(options.commandRunner),
    options.installMode ?? 'allow',
    options.lockTimeoutMs ?? null,
    options.pollIntervalMs ?? null,
    options.skipSharedDepsWarmup ?? false,
    options.testCompilerPublishPlatform ?? null
  ]);
}

const compilerDependencyReadyInFlightV1 = new Map<string, Promise<CompilerDepsReadyState>>();

export async function ensureCompilerDepsReady(
  options: RuntimeDependencyInstallOptions = {},
  compilerDependencyRoot = compilerRoot
): Promise<CompilerDepsReadyState> {
  options = runtimeDependencyOperationOptionsV1(options);
  const key = compilerDependencyReadyInFlightKeyV1(options, compilerDependencyRoot);
  if (key === null) return ensureCompilerDepsReadyInternal(options, compilerDependencyRoot);
  const existing = compilerDependencyReadyInFlightV1.get(key);
  if (existing !== undefined) return existing;
  const pending = ensureCompilerDepsReadyInternal(options, compilerDependencyRoot);
  compilerDependencyReadyInFlightV1.set(key, pending);
  try {
    return await pending;
  } finally {
    if (compilerDependencyReadyInFlightV1.get(key) === pending) {
      compilerDependencyReadyInFlightV1.delete(key);
    }
  }
}

async function ensureSharedDepsReadyInternal(
  options: RuntimeDependencyInstallOptions = {}
): Promise<SharedDepsReadyState> {
  const operationOptions = runtimeDependencyOperationOptionsV1(options);
  const runtimeSpec = await loadRuntimeDependencySpec();
  const sharedDepsRoot = path.resolve(operationOptions.sharedDepsRoot ?? defaultSharedDepsRoot());
  const compilerDependencyRoot = path.resolve(compilerRoot);
  const lifecycleOptions = sameHostPath(sharedDepsRoot, defaultSharedDepsRoot())
    ? await bindCanonicalGeneratedStateLifecycle(operationOptions, compilerDependencyRoot)
    : operationOptions;
  const sharedPackagePath = path.join(sharedDepsRoot, 'package.json');
  const sharedNodeModulesPath = path.join(sharedDepsRoot, 'node_modules');
  const sharedStampPath = path.join(sharedDepsRoot, 'runtime-deps.stamp.json');
  const sharedLockPath = path.join(sharedDepsRoot, 'install.lock');
  const manifest = buildRuntimePackageManifest('shared-runtime-deps', runtimeSpec);

  const canonicalSharedRoot = sameHostPath(sharedDepsRoot, defaultSharedDepsRoot());
  const observedRoot = await physicalSharedDependencyDirectory(sharedDepsRoot, true);
  if (observedRoot !== null) {
    await assertNoSharedDependencyAuthorityResidue(sharedDepsRoot);
    await assertPhysicalControlEntries([sharedPackagePath, sharedStampPath, sharedLockPath]);
  }
  const observedGeneration = observedRoot === null ? null : await sharedDependencyGenerationReady({
    compilerRoot: compilerDependencyRoot,
    manifest,
    nodeModulesPath: sharedNodeModulesPath,
    options: lifecycleOptions,
    packagePath: sharedPackagePath,
    root: sharedDepsRoot,
    spec: runtimeSpec,
    stampPath: sharedStampPath
  });
  if (observedGeneration !== null) {
    return withCompilerDependencyTransitionLeaseV1(
      compilerDependencyRoot,
      lifecycleOptions,
      async (lockedOptions) => {
        const currentRoot = await physicalSharedDependencyDirectory(sharedDepsRoot, true);
        if (observedRoot === null || currentRoot === null || !sameGeneratedStateIdentityV1(
          generatedStatePhysicalIdentityV1(currentRoot),
          generatedStatePhysicalIdentityV1(observedRoot)
        )) {
          throw new CompilerError(
            'IMPORT-AUTHORITY-004',
            'Shared dependency root changed before lifecycle binding; current state is preserved'
          );
        }
        if (canonicalSharedRoot) await bindExistingSharedDependencyRootV1(lockedOptions, currentRoot);
        await assertNoSharedDependencyAuthorityResidue(sharedDepsRoot);
        await assertPhysicalControlEntries([sharedPackagePath, sharedStampPath, sharedLockPath]);
        const currentGeneration = await sharedDependencyGenerationReady({
          compilerRoot: compilerDependencyRoot,
          manifest,
          nodeModulesPath: sharedNodeModulesPath,
          options: lockedOptions,
          packagePath: sharedPackagePath,
          root: sharedDepsRoot,
          spec: runtimeSpec,
          stampPath: sharedStampPath
        });
        if (currentGeneration === null) {
          throw new CompilerError(
            'RUNTIME-DEPS-004',
            'Shared dependency generation changed before ready-state settlement'
          );
        }
        return {
          binding: currentGeneration.binding,
          packageManager: currentGeneration.packageManager,
          root: sharedDepsRoot,
          nodeModulesPath: sharedNodeModulesPath,
          manifestHash: runtimeSpec.manifestHash,
          sourceGeneration: currentGeneration.sourceGeneration
        };
      }
    );
  }

  const compilerReady = await ensureCompilerDepsReady(lifecycleOptions, compilerDependencyRoot);
  const binding = compilerReady.runtimeMaterialization;
  if (binding === null || binding === undefined || binding.manifestHash !== runtimeSpec.manifestHash) {
    throw new CompilerError('RUNTIME-DEPS-002', 'Compiler dependency generation has no runtime closure');
  }

  return withCompilerDependencyTransitionLeaseV1(
    compilerDependencyRoot,
    lifecycleOptions,
    async (leaseOptions) => {
    const ensuredRoot = await ensurePhysicalSharedDependencyRoot(sharedDepsRoot, leaseOptions.beforeCommit);
    const rootIdentity = ensuredRoot.identity;
    if (canonicalSharedRoot) {
      if (ensuredRoot.created) {
        await leaseOptions.generatedStateLifecycle?.born(
          '.shared-deps',
          `shared-dependencies:${runtimeSpec.manifestHash}`
        );
      } else {
        await bindExistingSharedDependencyRootV1(leaseOptions, rootIdentity);
      }
    }
    const rootFence = async (): Promise<void> => {
      await leaseOptions.beforeCommit?.();
      await assertSharedDependencyRootIdentity(rootIdentity);
    };
    const authorityFence = async (): Promise<void> => {
      await rootFence();
      await assertNoSharedDependencyAuthorityResidue(sharedDepsRoot);
    };
    const lockedOptions = runtimeDependencyOperationOptionsV1({ ...leaseOptions, beforeCommit: rootFence });

    return withInstallLock(sharedLockPath, lockedOptions, async () => {
    await authorityFence();
    await writeManifestIfChanged(sharedPackagePath, manifest, authorityFence);

    const lockedGeneration = await sharedDependencyGenerationReady({
      binding,
      compilerRoot: compilerDependencyRoot,
      manifest,
      nodeModulesPath: sharedNodeModulesPath,
      options: lockedOptions,
      packagePath: sharedPackagePath,
      root: sharedDepsRoot,
      spec: runtimeSpec,
      stampPath: sharedStampPath
    });
    if (lockedGeneration !== null) {
      return {
        binding: lockedGeneration.binding,
        packageManager: lockedGeneration.packageManager,
        root: sharedDepsRoot,
        nodeModulesPath: sharedNodeModulesPath,
        manifestHash: runtimeSpec.manifestHash,
        sourceGeneration: lockedGeneration.sourceGeneration
      };
    }

    const staged = await stageRuntimeDependencyProjection({
      binding,
      options: runtimeDependencyOperationOptionsV1({ ...lockedOptions, beforeCommit: authorityFence }),
      sharedDepsRoot,
      // A linked worktree exposes the compiler generation through a locator.
      // The bulk no-follow capability must receive the already-resolved
      // physical source identity, never the alias path.
      sourceNodeModulesPath: (compilerReady.sourceGeneration ?? {
        ownerRoot: compilerDependencyRoot,
        sourcePath: compilerReady.nodeModulesPath
      }).sourcePath
    });
    if (!await runtimeDependencyTreeMatchesBinding({
      expected: binding,
      nodeModulesPath: staged.nodeModulesPath,
      root: compilerDependencyRoot,
      runtimeSpec
    })) {
      const stagedNodeModules = await observeDependencyTransitionSlotV1(
        staged.nodeModulesPath,
        generatedStateDigestV1(binding)
      );
      await disposeDependencyTransitionStageV1(
        sharedDepsRoot,
        staged.root,
        runtimeDependencyOperationOptionsV1({ ...lockedOptions, generatedStateLifecycle: undefined }),
        'runtime-projection-staging-invalid',
        stagedNodeModules,
        staged.rootSlot,
        runtimeDependencyStageAuthorityV1(path.dirname(staged.root))
      );
      throw new CompilerError('RUNTIME-DEPS-002', 'Staged runtime dependency projection is incomplete');
    }
    const projectionSourceGeneration = await runtimeDependencySourceGenerationV1({
      binding,
      options: lockedOptions,
      ownerRoot: (compilerReady.sourceGeneration ?? {
        ownerRoot: compilerDependencyRoot,
        sourcePath: compilerReady.nodeModulesPath
      }).ownerRoot,
      sourcePath: (compilerReady.sourceGeneration ?? {
        ownerRoot: compilerDependencyRoot,
        sourcePath: compilerReady.nodeModulesPath
      }).sourcePath
    });
    await publishRuntimeDependencyProjection({
      activeNodeModulesPath: sharedNodeModulesPath,
      binding,
      commitFence: authorityFence,
      compilerRoot: compilerDependencyRoot,
      options: lockedOptions,
      sourceGeneration: projectionSourceGeneration,
      stagingNodeModulesPath: staged.nodeModulesPath,
      stagingRoot: staged.root
    });
    await assertSharedDependencyMaterializationPostcondition({
      manifest,
      packagePath: sharedPackagePath,
      root: sharedDepsRoot
    });
    const compilerSourceGeneration = compilerReady.sourceGeneration ?? await runtimeDependencySourceGenerationV1({
      binding,
      options: lockedOptions,
      ownerRoot: compilerDependencyRoot,
      sourcePath: compilerReady.nodeModulesPath
    });
    const sourceGeneration = await runtimeDependencySourceGenerationV1({
      binding,
      options: lockedOptions,
      ownerRoot: compilerSourceGeneration.ownerRoot,
      sourcePath: compilerSourceGeneration.sourcePath
    });
    const target = await runtimeDependencyTargetIdentityV1(sharedNodeModulesPath);
    if (target === null) {
      throw new CompilerError('RUNTIME-DEPS-002', 'Shared dependency projection has no physical target identity');
    }
    await writeRuntimeDepsStamp(sharedStampPath, {
      binding,
      formatVersion: 'runtime-deps-stamp-v4',
      manifestHash: runtimeSpec.manifestHash,
      packageManager: 'bun',
      installedAt: (lockedOptions.now ?? (() => new Date().toISOString()))(),
      sourceGeneration,
      target
    }, authorityFence);

    if (await sharedDependencyGenerationReady({
      binding,
      compilerRoot: compilerDependencyRoot,
      manifest,
      nodeModulesPath: sharedNodeModulesPath,
      options: lockedOptions,
      packagePath: sharedPackagePath,
      root: sharedDepsRoot,
      spec: runtimeSpec,
      stampPath: sharedStampPath
    }) === null) {
      throw new CompilerError(
        'RUNTIME-DEPS-002',
        'Shared dependency generation failed its exact readiness readback'
      );
    }

    return {
      binding,
      packageManager: 'bun',
      root: sharedDepsRoot,
      nodeModulesPath: sharedNodeModulesPath,
      manifestHash: runtimeSpec.manifestHash,
      sourceGeneration
    };
    });
    }
  );
}

function sharedDependencyReadyInFlightKeyV1(
  options: RuntimeDependencyInstallOptions,
  sharedDepsRoot: string
): string | null {
  if (options.beforeCommit !== undefined || options.generatedStateLifecycle !== undefined ||
      options.signal !== undefined || options.now !== undefined || options.sleep !== undefined ||
      options.testCompilerPublishHook !== undefined || options.testCompilerBridgeValidationHook !== undefined ||
      options.testCompilerRename !== undefined || options.testProjectProjectionHook !== undefined) return null;
  return JSON.stringify([
    path.resolve(sharedDepsRoot),
    dependencyInvocationFunctionIdV1(options.commandRunner),
    options.installMode ?? 'allow',
    options.lockTimeoutMs ?? null,
    options.pollIntervalMs ?? null,
    options.skipSharedDepsWarmup ?? false
  ]);
}

const sharedDependencyReadyInFlightV1 = new Map<string, Promise<SharedDepsReadyState>>();

export async function ensureSharedDepsReady(
  options: RuntimeDependencyInstallOptions = {}
): Promise<SharedDepsReadyState> {
  options = runtimeDependencyOperationOptionsV1(options);
  const sharedDepsRoot = options.sharedDepsRoot ?? defaultSharedDepsRoot();
  const key = sharedDependencyReadyInFlightKeyV1(options, sharedDepsRoot);
  if (key === null) return ensureSharedDepsReadyInternal(options);
  const existing = sharedDependencyReadyInFlightV1.get(key);
  if (existing !== undefined) return existing;
  const pending = ensureSharedDepsReadyInternal(options);
  sharedDependencyReadyInFlightV1.set(key, pending);
  try {
    return await pending;
  } finally {
    if (sharedDependencyReadyInFlightV1.get(key) === pending) {
      sharedDependencyReadyInFlightV1.delete(key);
    }
  }
}

export async function ensureProjectDependencies(
  projectRoot: string,
  options: RuntimeDependencyInstallOptions = {}
): Promise<void> {
  const operationOptions = runtimeDependencyOperationOptionsV1(options);
  options = operationOptions;
  const runtimeSpec = await loadRuntimeDependencySpec();
  const projectRootPath = path.resolve(projectRoot);
  const nodeModulesPath = path.join(projectRootPath, 'node_modules');
  if (operationOptions.installMode === 'prebound-only') {
    await runtimeDependencyOperationEffectFenceV1(operationOptions, 'Prebound dependency read admission');
    const [binding, installed] = await Promise.all([
      readJson<unknown>(path.join(nodeModulesPath, RUNTIME_DEPS_PREBOUND_BINDING_FILE))
        .catch(() => null),
      hasCompleteRuntimeDeps(nodeModulesPath, runtimeSpec)
    ]);
    await runtimeDependencyOperationEffectFenceV1(operationOptions, 'Prebound dependency readback');
    if (!installed || !isRuntimeDepsPreboundBinding(binding, runtimeSpec.manifestHash)) {
      throw new CompilerError(
        'RUNTIME-DEPS-004',
        'Plan-bound dependency tree is unavailable for isolated verification'
      );
    }
    return;
  }
  const isolated = operationOptions.installMode === 'offline-copy-only';
  const sharedDepsRoot = path.resolve(operationOptions.sharedDepsRoot ?? defaultSharedDepsRoot());
  const compilerDependencyRoot = path.resolve(compilerRoot);
  let sourceNodeModulesPath: string;
  let binding: Readonly<RuntimeDependencyMaterializationBinding>;
  let sourceGeneration: RuntimeDependencySourceGenerationV1;

  if (isolated) {
    const sharedStamp = await readRuntimeDepsStamp(path.join(sharedDepsRoot, 'runtime-deps.stamp.json'));
    sourceNodeModulesPath = path.join(sharedDepsRoot, 'node_modules');
    if (sharedStamp === null) {
      throw new CompilerError(
        'RUNTIME-DEPS-004',
        'Canonical shared dependency projection is unavailable for isolated verification'
      );
    }
    let observedSourceGeneration: RuntimeDependencySourceGenerationV1 | null;
    try {
      observedSourceGeneration = await runtimeDependencySourceGenerationV1({
        binding: sharedStamp.binding,
        options: operationOptions,
        ownerRoot: sharedStamp.sourceGeneration.ownerRoot,
        sourcePath: sharedStamp.sourceGeneration.sourcePath
      });
    } catch (error) {
      if (!isFileNotFoundError(error)) throw error;
      observedSourceGeneration = null;
    }
    if (observedSourceGeneration === null ||
      observedSourceGeneration.epoch !== sharedStamp.sourceGeneration.epoch ||
      !sameRuntimeDependencySourceGenerationContentV1(observedSourceGeneration, sharedStamp.sourceGeneration) ||
      !sameGeneratedStateIdentityV1(observedSourceGeneration.physical, sharedStamp.sourceGeneration.physical) ||
      !await runtimeDependencyTreeMatchesBinding({
        expected: sharedStamp.binding,
      nodeModulesPath: sourceNodeModulesPath,
      root: compilerDependencyRoot,
      runtimeSpec
      })) {
      throw new CompilerError(
        'RUNTIME-DEPS-004',
        'Canonical shared dependency projection is unavailable for isolated verification'
      );
    }
    binding = sharedStamp.binding;
    const actualSharedSourcePath = path.resolve(await fs.realpath(sourceNodeModulesPath));
    sourceGeneration = await runtimeDependencySourceGenerationV1({
      binding,
      options: operationOptions,
      ownerRoot: path.dirname(actualSharedSourcePath),
      sourcePath: actualSharedSourcePath
    });
  } else if (operationOptions.skipSharedDepsWarmup === true) {
    const compilerIdentity = await compilerDependencyIdentity(compilerDependencyRoot);
    sourceNodeModulesPath = dependencyAuthorityPaths(compilerDependencyRoot).compilerModulesRoot;
    const compilerReady = await observeCompilerDependencyReadyV1(
      compilerDependencyRoot,
      sourceNodeModulesPath,
      compilerIdentity,
      operationOptions
    );
    if (compilerReady === null || compilerReady.binding.runtimeMaterialization === null) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Canonical compiler dependency readiness is unavailable');
    }
    binding = compilerReady.binding.runtimeMaterialization;
    const compilerSourceGeneration = compilerReady.sourceGeneration ?? await runtimeDependencySourceGenerationV1({
      binding: compilerReady.binding,
      options: operationOptions,
      ownerRoot: compilerDependencyRoot,
      sourcePath: sourceNodeModulesPath
    });
    sourceGeneration = await runtimeDependencySourceGenerationV1({
      binding,
      options: operationOptions,
      ownerRoot: compilerSourceGeneration.ownerRoot,
      sourcePath: compilerSourceGeneration.sourcePath
    });
    sourceNodeModulesPath = sourceGeneration.sourcePath;
  } else {
    const sharedDeps = await ensureSharedDepsReady(operationOptions);
    sourceNodeModulesPath = sharedDeps.nodeModulesPath;
    binding = sharedDeps.binding;
    const actualSharedSourcePath = path.resolve(await fs.realpath(sourceNodeModulesPath));
    sourceGeneration = await runtimeDependencySourceGenerationV1({
      binding,
      options: operationOptions,
      ownerRoot: path.dirname(actualSharedSourcePath),
      sourcePath: actualSharedSourcePath
    });
  }

  const projectTransitionInput: ProjectProjectionTransitionInputV1 = Object.freeze({
    binding,
    compilerDependencyRoot,
    isolated,
    nodeModulesPath,
    options: operationOptions,
    projectRootPath,
    runtimeSpec,
    sourceGeneration,
    sourceNodeModulesPath,
    stampPath: projectStampPath(projectRootPath)
  });
  const stampPath = projectStampPath(projectRootPath);
  await withCompilerDependencyTransitionLeaseV1(
    compilerDependencyRoot,
    operationOptions,
    async (lockedOptions) => {
      const lockedTransitionInput: ProjectProjectionTransitionInputV1 = Object.freeze({
        ...projectTransitionInput,
        options: lockedOptions
      });
      await recoverProjectDependencyTransitionV1(lockedTransitionInput);
      await runtimeDependencyOperationEffectFenceV1(lockedOptions, 'Project dependency cache admission');
      const currentStamp = await readRuntimeDepsStamp(stampPath);
      const currentTarget = await runtimeDependencyTargetIdentityV1(nodeModulesPath);
      let sourceStillCurrent: boolean;
      try {
        const current = await runtimeDependencySourceGenerationV1({
          binding,
          options: lockedOptions,
          ownerRoot: sourceGeneration.ownerRoot,
          sourcePath: sourceGeneration.sourcePath
        });
        sourceStillCurrent = current.epoch === sourceGeneration.epoch &&
          sameRuntimeDependencySourceGenerationContentV1(current, sourceGeneration) &&
          sameGeneratedStateIdentityV1(current.physical, sourceGeneration.physical);
      } catch (error) {
        if (!isFileNotFoundError(error)) throw error;
        sourceStillCurrent = false;
      }
      const cacheReady = !lockedOptions.rematerialize &&
        sourceStillCurrent &&
        currentStamp?.binding.revision === binding.revision &&
        canonicalEquals(currentStamp.binding, binding) &&
        currentStamp.sourceGeneration.epoch === sourceGeneration.epoch &&
        sameRuntimeDependencySourceGenerationContentV1(currentStamp.sourceGeneration, sourceGeneration) &&
        sameGeneratedStateIdentityV1(currentStamp.sourceGeneration.physical, sourceGeneration.physical) &&
        currentTarget !== null &&
        currentTarget.kind === currentStamp.target.kind &&
        currentTarget.linkTarget === currentStamp.target.linkTarget &&
        sameGeneratedStateIdentityV1(currentTarget.physical, currentStamp.target.physical) &&
        (isolated
          ? await runtimeDependencyTreeMatchesBinding({
            expected: binding,
            nodeModulesPath,
            root: compilerDependencyRoot,
            runtimeSpec
          })
          : await dependencyBridgeTargets(nodeModulesPath, sourceNodeModulesPath));
      await runtimeDependencyOperationEffectFenceV1(lockedOptions, 'Project dependency ready-state settlement');
      if (cacheReady) return;
      await publishProjectDependencyProjectionV1(lockedTransitionInput);
    }
  );
}
