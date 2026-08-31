import crypto from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { generatedStateDigest, generatedStateDomainProviderMaterialDigest, type GeneratedStateCleanupProfile, type GeneratedStateInventory, type GeneratedStatePhysicalIdentity, type GeneratedStateRegistration } from '../../../runtime-state/generated-state/contract.ts';
import type { GeneratedStateWorktreeRetirementProvider } from '../../../runtime-state/generated-state/lifecycle.ts';
import { assertRetainedNoFollowCapability, assertSameNoFollowDirectoryIdentity, copyNoFollowDirectoryTreesBulk, createExclusiveNoFollowDirectory, createExclusiveNoFollowRandomDirectory, createNoFollowOrdinaryDirectoryChain, deleteRetainedNoFollowEntry, inspectExactNoFollowDirectoryPresence, inspectExactNoFollowLinkEntry, inspectNoFollowDirectoryChain, inspectNoFollowDirectoryChild, inspectNoFollowLinkEntry, inspectNoFollowOrdinaryFileEntry, PhysicalNoFollowError, publishExclusiveDurableCanonicalFile, publishExclusiveNoFollowLink, readNoFollowOrdinaryFile, relocateRetainedNoFollowDirectoryAcrossParents, relocateRetainedNoFollowLinkAcrossParents, replaceDurableCanonicalFile, retainNoFollowDirectoryForChildProcess, retainNoFollowOrdinaryFile, scanNoFollowDirectoryTree, scanNoFollowDirectoryTreeInventory, scanNoFollowDirectoryTreeMetadata, type PhysicalDirectoryChain, type PhysicalDirectoryIdentity, type RetainedNoFollowOrdinaryFile } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { buildIsolatedProcessEnvironment, ensureIsolatedProcessDirectories, ISOLATED_VERIFICATION_ENV_KEY, pathEnvKey, RETAINED_EXECUTABLE_CHILD_DESCRIPTOR, RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR, runCommand, runRetainedCommand, type CommandResult } from '../../../runtime-state/physical/runtime/process.ts';
import {
  parseGitWorktreeAdminLocator,
  parseGitWorktreeAdminPath
} from '../../../runtime-state/worktree-closeout-contract.ts';
import { SecError } from '../../../system-architecture/foundation/contract/failure.ts';
import { canonicalEquals, canonicalJson, compareCodeUnits, digest, sortedKeys, uniqueSorted } from '../../../system-architecture/foundation/runtime/canonical.ts';
import { ensureDir, formatJsonFile, isFileNotFoundError, pathExists, readJson, writeJson, writeText, type CommitFence } from '../../../workspace/files.ts';
import { compilerRoot, isPathInside } from '../../../workspace/runtime/paths.ts';
import { loadCanonicalBunRuntimeVersion } from '../../runtime.ts';
import {
  buildRuntimeDependencyMaterializationBinding,
  buildRuntimePackageManifest,
  isRuntimeDependencyMaterializationBinding,
  isRuntimeDependencyPackageManifest,
  isRuntimeDependencyPackageName,
  isRuntimeDepsPreboundBinding,
  loadRuntimeDependencySpec,
  parseLegacyRuntimeDependencyMaterializationV2ForRecovery,
  parseRuntimeDependencyPackageReference,
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
  sourceGeneration: Readonly<RuntimeDependencySourceGeneration>;
  target: Readonly<RuntimeDependencyTargetIdentity>;
}

export interface RuntimeDependencySourceGeneration {
  readonly schema: 'sec-runtime-dependency-source-generation-v1';
  readonly ownerRoot: string;
  readonly ownerRootPhysical: Readonly<GeneratedStatePhysicalIdentity>;
  readonly sourcePath: string;
  readonly physical: Readonly<GeneratedStatePhysicalIdentity>;
  readonly bindingDigest: `sha256:${string}`;
  /** Digest of every no-follow source-tree entry, including content bytes. */
  readonly treeDigest: `sha256:${string}`;
  /** Number of entries covered by treeDigest; part of the bounded contract. */
  readonly treeEntryCount: number;
  readonly epoch: `sha256:${string}`;
}

export interface RuntimeDependencyTargetIdentity {
  readonly schema: 'sec-runtime-dependency-target-identity-v1';
  readonly kind: 'directory' | 'link';
  readonly physical: Readonly<GeneratedStatePhysicalIdentity>;
  readonly linkTarget: string | null;
}

export interface SharedDepsReadyState {
  binding: Readonly<RuntimeDependencyMaterializationBinding>;
  packageManager: 'bun';
  root: string;
  nodeModulesPath: string;
  manifestHash: string;
  readonly sourceGeneration: Readonly<RuntimeDependencySourceGeneration>;
}

export interface CompilerDepsReadyState {
  manifestHash: string;
  nodeModulesPath: string;
  packageManager: 'bun';
  readonly requiresFreshProcess: boolean;
  root: string;
  readonly runtimeMaterialization?: Readonly<RuntimeDependencyMaterializationBinding> | null;
  readonly sourceGeneration?: Readonly<RuntimeDependencySourceGeneration>;
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
const RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES = 100_000;
const RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES = 2 * 1024 * 1024 * 1024;
const RUNTIME_DEPENDENCY_OPERATION_CONTEXT = Symbol('sec-runtime-dependency-operation-context-v1');

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
  /** Package-local fault injection for the Windows lock-file settlement owner. */
  testInstallLockDelete?: (filePath: string, attempt: number) => void | Promise<void>;
  testInstallLockDeletePlatform?: NodeJS.Platform;
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
        physical?: GeneratedStatePhysicalIdentity;
      }>
    ) => Promise<GeneratedStateRegistration>;
    /** Re-activate one exact retired predecessor after owner-local rollback. */
    restore?: (
      relativePath: string,
      expectedRegistrationDigest: `sha256:${string}`,
      expectedPhysical: GeneratedStatePhysicalIdentity,
      outcome: string
    ) => Promise<GeneratedStateRegistration>;
    retired(relativePath: string, outcome: string): Promise<GeneratedStateRegistration | void>;
    settleRetired?: (
      relativePath: string,
      expected?: Readonly<{
        owner?: string;
        producer?: string;
        ruleId?: string;
        physical?: GeneratedStatePhysicalIdentity;
      }>
    ) => Promise<boolean>;
    /** Terminalize one exact active registration after its physical root is already absent. */
    settleAbsent?: (
      relativePath: string,
      expected: Readonly<{
        owner: string;
        producer: string;
        ruleId: string;
        physical: GeneratedStatePhysicalIdentity;
      }>,
      outcome: string
    ) => Promise<Readonly<{
      schema: 'sec-generated-state-absent-registration-settlement-v1';
      relativePath: string;
      registrationDigest: `sha256:${string}`;
      retirementRef: `sha256:${string}`;
      physical: GeneratedStatePhysicalIdentity;
      outcome: string;
      terminal: 'disposed';
      receiptDigest: `sha256:${string}`;
    }>>;
    disposed(relativePath: string, outcome: string): Promise<void>;
  }>;
}

type RuntimeDependencyOperationContext = Readonly<{
  deadlineAtMonotonicMs: number;
  initialBudgetMs: number;
  monotonicNowMs: () => number;
  operationId: string;
  pollIntervalMs: number;
  signal: AbortSignal | undefined;
  startedAtMonotonicMs: number;
}>;

type RuntimeDependencyOperationOptions<T extends RuntimeDependencyInstallOptions = RuntimeDependencyInstallOptions> =
  T & Readonly<{
    [RUNTIME_DEPENDENCY_OPERATION_CONTEXT]: RuntimeDependencyOperationContext;
  }>;

async function bindCanonicalGeneratedStateLifecycle(
  options: RuntimeDependencyOperationOptions,
  root: string
): Promise<RuntimeDependencyOperationOptions> {
  if (!sameHostPath(root, compilerRoot)) return options;
  const { generatedStateProducerHooks: generatedStateProducerHooksV1 } = await import('../../../runtime-state/generated-state/lifecycle.ts');
  return Object.freeze({
    ...options,
    generatedStateLifecycle: generatedStateProducerHooksV1(
      { repositoryRoot: root },
      { worktreeRetirementProviders: [compilerDependencyLocatorWorktreeRetirementProvider] }
    )
  }) as RuntimeDependencyOperationOptions;
}

export async function disposeCanonicalSharedDependencies(
  options: RuntimeDependencyInstallOptions = {},
  outcome = 'maintainer-clean-requested'
): Promise<boolean> {
  const operationOptions = runtimeDependencyOperationOptions(options);
  const sharedDepsRoot = defaultSharedDepsRoot();
  const observedRoot = await physicalSharedDependencyDirectory(sharedDepsRoot, true);
  if (observedRoot === null) return false;
  const lifecycleOptions = await bindCanonicalGeneratedStateLifecycle(operationOptions, compilerRoot);
  const lifecycle = lifecycleOptions.generatedStateLifecycle;
  if (lifecycle === undefined) {
    throw new Error('Canonical shared dependencies have no generated-state lifecycle owner.');
  }
  return withCompilerDependencyTransitionLease(compilerRoot, lifecycleOptions, async () => {
    const current = await physicalSharedDependencyDirectory(sharedDepsRoot, true);
    if (current === null || !sameGeneratedStateIdentity(
      generatedStatePhysicalIdentity(current),
      generatedStatePhysicalIdentity(observedRoot)
    )) {
      throw new SecError(
        'IMPORT-AUTHORITY-004',
        'Canonical shared dependency root changed before lifecycle disposal; current state is preserved'
      );
    }
    await bindExistingSharedDependencyRoot(lifecycleOptions, current);
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
let runtimeExecutableIdentityInFlight: Promise<RuntimeExecutableIdentity> | null = null;

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
    throw new SecError('IMPORT-AUTHORITY-001', 'Root packageManager must pin one Bun version exactly');
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
  if (!refresh && runtimeExecutableIdentityInFlight !== null) {
    return runtimeExecutableIdentityInFlight;
  }
  const observation = (async (): Promise<RuntimeExecutableIdentity> => {
    const executablePath = await fs.realpath(process.execPath);
    const metadata = await fs.lstat(executablePath, { bigint: true });
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      throw new SecError('IMPORT-AUTHORITY-001', 'Bun runtime executable must be one physical file');
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
      throw new SecError('IMPORT-AUTHORITY-001', 'Bun runtime executable changed during observation');
    }
    return Object.freeze({
      path: executablePath,
      sha256: digest(executableBytes),
      signature
    });
  })();
  if (refresh) return observation;
  runtimeExecutableIdentityInFlight = observation;
  try {
    return await observation;
  } finally {
    if (runtimeExecutableIdentityInFlight === observation) {
      runtimeExecutableIdentityInFlight = null;
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
    throw new SecError('IMPORT-AUTHORITY-001', 'Compiler dependency bootstrap must run under Bun');
  }
  if (runtime.declaredBunVersion !== canonicalBunVersion || runtime.bunVersion !== canonicalBunVersion) {
    throw new SecError(
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
function assertCompilerDependencyInputsCurrent(
  root: string,
  expected: CompilerDependencyIdentity
): void {
  const sourceRoot = inspectNoFollowDirectoryChain(
    root,
    'Compiler dependency input source root fence'
  ).target;
  const readInput = (name: 'package.json' | 'bun.lock' | 'bunfig.toml'): Uint8Array | null => {
    const entry = inspectNoFollowOrdinaryFileEntry(sourceRoot, name);
    if (entry === null) return null;
    if (entry.kind !== 'file' || entry.bytes === null) {
      throw new SecError(
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
    throw new SecError(
      'IMPORT-AUTHORITY-001',
      'Compiler dependency source inputs changed around materialization'
    );
  }
  const versionPath = path.join(sourceRoot.path, '.bun-version');
  let version: string;
  try {
    const versionBytes = readNoFollowOrdinaryFile(sourceRoot, '.bun-version');
    version = versionBytes === null ? '' : Buffer.from(versionBytes).toString('utf8').trim();
  } catch (error) {
    throw new SecError(
      'IMPORT-AUTHORITY-001',
      'Compiler dependency version marker is not an ordinary no-follow file',
      { versionPath, cause: error instanceof Error ? error.message : String(error) }
    );
  }
  if (version !== expected.bunVersion) {
    throw new SecError(
      'IMPORT-AUTHORITY-001',
      'Compiler dependency Bun version marker changed around materialization'
    );
  }
  assertSameNoFollowDirectoryIdentity(sourceRoot, 'Compiler dependency input source root readback');
}

function compilerDependencyInputFenceMatches(
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

function compilerDependencyManifestExpectation(
  packageName: string,
  request: string
): Readonly<{ name: string; version: string }> {
  if (!request.startsWith('npm:')) return Object.freeze({ name: packageName, version: request });
  const alias = /^npm:(@[^/\s]+\/[^@\s]+|[^@\s]+)@(.+)$/u.exec(request);
  if (alias === null || alias[1] === undefined || alias[2] === undefined || !isExactPackageVersion(alias[2])) {
    throw new SecError('IMPORT-AUTHORITY-002', `Compiler dependency npm alias is invalid: ${packageName}`);
  }
  return Object.freeze({ name: alias[1], version: alias[2] });
}

async function compilerDependencyPackageBinding(
  nodeModulesPath: string,
  packageName: string,
  requestedVersion: string
): Promise<CompilerDependencyPackageBinding> {
  const expected = compilerDependencyManifestExpectation(packageName, requestedVersion);
  const packageRoot = path.dirname(dependencyPackagePath(nodeModulesPath, packageName));
  const packageJsonPath = path.join(packageRoot, 'package.json');
  const packageJsonBytes = await fs.readFile(packageJsonPath);
  const manifest = JSON.parse(packageJsonBytes.toString('utf8')) as {
    main?: unknown;
    name?: unknown;
    version?: unknown;
  };
  if (manifest.name !== expected.name || typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new SecError('IMPORT-AUTHORITY-002', `Compiler dependency manifest is invalid: ${packageName}`);
  }
  if (isExactPackageVersion(expected.version) && manifest.version !== expected.version) {
    throw new SecError(
      'IMPORT-AUTHORITY-002',
      `Compiler dependency version mismatch: ${packageName}@${manifest.version} != ${expected.version}`
    );
  }

  let entry: CompilerDependencyPackageBinding['entry'];
  if (criticalCompilerDependencyEntries.has(packageName)) {
    if (typeof manifest.main !== 'string' || manifest.main.length === 0) {
      throw new SecError('IMPORT-AUTHORITY-002', `Critical compiler dependency has no main entry: ${packageName}`);
    }
    const entryPath = manifest.main.replace(/^\.\//u, '').replace(/\\/gu, '/');
    const absoluteEntry = path.resolve(packageRoot, ...entryPath.split('/'));
    const relativeEntry = path.relative(packageRoot, absoluteEntry);
    if (relativeEntry.startsWith('..') || path.isAbsolute(relativeEntry)) {
      throw new SecError('IMPORT-AUTHORITY-002', `Critical compiler dependency entry escapes its package: ${packageName}`);
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

const COMPILER_DEPS_BINDING_KEYS = Object.freeze([
  'architecture', 'bunExecutablePath', 'bunExecutableSha256', 'bunVersion',
  'declaredBunVersion', 'dependencyManifestSha256', 'formatVersion',
  'installConfigSha256', 'lockSha256', 'manifestHash', 'packages', 'platform',
  'runtimeMaterialization'
]);

function isCompilerDepsBinding(value: unknown): value is CompilerDepsBinding {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<CompilerDepsBinding>;
  if (Object.keys(candidate).sort(compareCodeUnits).join('\0') !== COMPILER_DEPS_BINDING_KEYS.join('\0') ||
      candidate.formatVersion !== 'compiler-deps-binding-v5' ||
      !Array.isArray(candidate.packages) ||
      (candidate.runtimeMaterialization !== null &&
        !isRuntimeDependencyMaterializationBinding(candidate.runtimeMaterialization))) return false;
  for (const field of [
    'architecture', 'bunExecutablePath', 'bunExecutableSha256', 'bunVersion',
    'declaredBunVersion', 'dependencyManifestSha256', 'lockSha256', 'manifestHash', 'platform'
  ] as const) {
    if (typeof candidate[field] !== 'string') return false;
  }
  if (candidate.installConfigSha256 !== null && typeof candidate.installConfigSha256 !== 'string') return false;
  return candidate.packages.every((entry) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const keys = Object.keys(entry).sort(compareCodeUnits);
    const expectedKeys = entry.entry === undefined
      ? ['manifestSha256', 'name', 'version']
      : ['entry', 'manifestSha256', 'name', 'version'];
    return keys.join('\0') === expectedKeys.join('\0') &&
      typeof entry.manifestSha256 === 'string' && typeof entry.name === 'string' &&
      typeof entry.version === 'string' &&
      (entry.entry === undefined || (
        entry.entry !== null && typeof entry.entry === 'object' && !Array.isArray(entry.entry) &&
        Object.keys(entry.entry).sort(compareCodeUnits).join('\0') === ['path', 'sha256'].join('\0') &&
        typeof entry.entry.path === 'string' && typeof entry.entry.sha256 === 'string'
      ));
  });
}

async function readCompilerDepsBinding(bindingPath: string): Promise<CompilerDepsBinding | null> {
  let value: unknown;
  try {
    value = await readJson<unknown>(bindingPath);
  } catch (error) {
    if (isFileNotFoundError(error) || error instanceof SyntaxError) return null;
    throw error;
  }
  return isCompilerDepsBinding(value) ? value : null;
}

async function compilerDependencyGenerationBinding(
  root: string,
  nodeModulesPath: string,
  bindingPath: string,
  identity: CompilerDependencyIdentity
): Promise<Readonly<CompilerDepsBinding> | null> {
  const binding = await readCompilerDepsBinding(bindingPath);
  if (binding === null) return null;
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
      (error instanceof SecError && error.code === 'IMPORT-AUTHORITY-002')) return null;
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

function runtimeDependencyPositiveBoundedInteger(
  field: 'lockTimeoutMs' | 'pollIntervalMs',
  configured: number | undefined,
  fallback: number,
  maximum: number
): number {
  const value = configured ?? fallback;
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new SecError(
      'RUNTIME-DEPS-003',
      `Runtime dependency ${field} must be a positive safe integer within its canonical ceiling`,
      { field, maximum, value }
    );
  }
  return value;
}

function defaultRuntimeDependencyMonotonicNowMs(): number {
  return performance.now();
}

/**
 * Capture one monotonic source for an operation.  The wrapper is the operation
 * ledger: nested helpers reuse it, and a broken injected source cannot silently
 * move an absolute deadline backwards.
 */
function createRuntimeDependencyMonotonicLedger(
  source: () => number
): () => number {
  let previous = Number.NEGATIVE_INFINITY;
  return () => {
    const observed = source();
    if (!Number.isFinite(observed) || observed < previous) {
      throw new SecError(
        'RUNTIME-DEPS-003',
        'Runtime dependency operation monotonic clock is invalid or moved backwards',
        { observed, previous }
      );
    }
    previous = observed;
    return observed;
  };
}

function runtimeDependencyOperationOptions<T extends RuntimeDependencyInstallOptions>(
  options: T
): RuntimeDependencyOperationOptions<T> {
  const initialBudgetMs = runtimeDependencyPositiveBoundedInteger(
    'lockTimeoutMs',
    options.lockTimeoutMs,
    DEFAULT_DEPENDENCY_LOCK_TIMEOUT_MS,
    MAX_DEPENDENCY_OPERATION_TIMEOUT_MS
  );
  const pollIntervalMs = runtimeDependencyPositiveBoundedInteger(
    'pollIntervalMs',
    options.pollIntervalMs,
    DEFAULT_DEPENDENCY_LOCK_POLL_INTERVAL_MS,
    MAX_DEPENDENCY_LOCK_POLL_INTERVAL_MS
  );
  const existing = (options as unknown as Partial<RuntimeDependencyOperationOptions<T>>)
    [RUNTIME_DEPENDENCY_OPERATION_CONTEXT];
  const monotonicNowMs = existing?.monotonicNowMs ?? createRuntimeDependencyMonotonicLedger(
    options.monotonicNowMs ?? defaultRuntimeDependencyMonotonicNowMs
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
    [RUNTIME_DEPENDENCY_OPERATION_CONTEXT]: context
  };
}

function runtimeDependencyOperationContext(
  options: RuntimeDependencyInstallOptions
): RuntimeDependencyOperationContext {
  return (options as Partial<RuntimeDependencyOperationOptions>)[RUNTIME_DEPENDENCY_OPERATION_CONTEXT] ??
    runtimeDependencyOperationOptions(options)[RUNTIME_DEPENDENCY_OPERATION_CONTEXT];
}

function runtimeDependencyOperationRemainingMs(
  options: RuntimeDependencyInstallOptions,
  label: string,
  minimumMs = 1
): number {
  const context = runtimeDependencyOperationContext(options);
  context.signal?.throwIfAborted();
  const observedAtMonotonicMs = context.monotonicNowMs();
  const remainingMs = context.deadlineAtMonotonicMs - observedAtMonotonicMs;
  if (!Number.isFinite(remainingMs) || remainingMs < minimumMs) {
    throw new SecError('RUNTIME-DEPS-003', `${label} exceeded the runtime dependency operation deadline`, {
      initialBudgetMs: context.initialBudgetMs,
      minimumMs,
      observedAtMonotonicMs,
      remainingMs: Math.max(0, Math.floor(remainingMs))
    });
  }
  return remainingMs;
}

async function waitForRuntimeDependencyOperation(
  options: RuntimeDependencyInstallOptions,
  requestedDelayMs: number,
  sleep: (ms: number) => Promise<void>,
  label: string
): Promise<void> {
  const context = runtimeDependencyOperationContext(options);
  const remainingMs = runtimeDependencyOperationRemainingMs(options, label);
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
    deadlineTimer = setTimeout(() => reject(new SecError(
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
  runtimeDependencyOperationRemainingMs(options, label);
}

async function runtimeDependencyOperationEffectFence(
  options: RuntimeDependencyOperationOptions,
  label: string
): Promise<void> {
  runtimeDependencyOperationRemainingMs(options, `${label} admission`);
  await options.beforeCommit?.();
  runtimeDependencyOperationRemainingMs(options, `${label} effect`);
}

function runtimeDependencyOperationDeadlineAt(
  options: RuntimeDependencyOperationOptions,
  label: string
): number {
  runtimeDependencyOperationRemainingMs(options, label);
  return runtimeDependencyOperationContext(options).deadlineAtMonotonicMs;
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
      const expected = parseRuntimeDependencyPackageReference(
        packageName,
        exactVersions[packageName]!
      );
      return expected !== null && isRuntimeDependencyPackageManifest(manifest, expected.packageName) &&
        manifest.version === expected.version;
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
    throw new SecError('RUNTIME-DEPS-002', `${label} must be one dependency record`);
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => compareCodeUnits(left, right));
  if (entries.some(([name, version]) => !isRuntimeDependencyPackageName(name) ||
    typeof version !== 'string' || !version)) {
    throw new SecError('RUNTIME-DEPS-002', `${label} contains an invalid dependency`);
  }
  return Object.freeze(Object.fromEntries(entries) as Record<string, string>);
}

function optionalPeerNames(value: unknown): ReadonlySet<string> {
  if (value === undefined) return new Set<string>();
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SecError('RUNTIME-DEPS-002', 'Runtime dependency peer metadata is invalid');
  }
  const optional = new Set<string>();
  for (const [name, metadata] of Object.entries(value as Record<string, unknown>)) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw new SecError('RUNTIME-DEPS-002', 'Runtime dependency peer metadata is invalid');
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
    throw new SecError('RUNTIME-DEPS-002', 'Runtime dependency package manifest is not one physical file');
  }
  const bytes = await fs.readFile(packageJsonPath);
  const after = await fs.lstat(packageJsonPath, { bigint: true });
  if (metadata.dev !== after.dev || metadata.ino !== after.ino || metadata.mode !== after.mode) {
    throw new SecError('RUNTIME-DEPS-002', 'Runtime dependency package manifest changed during observation');
  }
  const parsed = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) ||
    !isRuntimeDependencyPackageName(parsed.name) ||
    typeof parsed.version !== 'string' || !parsed.version) {
    throw new SecError('RUNTIME-DEPS-002', 'Runtime dependency package manifest is invalid');
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
    throw new SecError('RUNTIME-DEPS-002', 'Runtime dependency package escapes node_modules');
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
      throw new SecError('RUNTIME-DEPS-002', 'Runtime dependency closure contains a reparse entry');
    }
    const physical = await fs.realpath(absolute);
    if (!sameHostPath(physical, absolute) || !isPathInside(nodeModulesPath, physical)) {
      throw new SecError('RUNTIME-DEPS-002', 'Runtime dependency package is not physically contained');
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
    throw new SecError('RUNTIME-DEPS-002', 'Runtime dependency authority changed during observation');
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
        throw new SecError(
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
  const rootPackages: { name: string; packageName: string; target: string }[] = [];
  for (const packageName of [...RUNTIME_DEPENDENCY_PACKAGE_NAMES].sort(compareCodeUnits)) {
    const packageRoot = await resolveRuntimePackageRoot(input.nodeModulesPath, null, packageName);
    if (packageRoot === null) {
      throw new SecError('RUNTIME-DEPS-002', `Runtime dependency root package is absent: ${packageName}`);
    }
    const target = await visit(packageRoot, packageName);
    const observed = packages.get(target)!;
    const expected = parseRuntimeDependencyPackageReference(
      packageName,
      exactVersions[packageName]!
    );
    if (expected === null || observed.name !== expected.packageName || observed.version !== expected.version) {
      throw new SecError('RUNTIME-DEPS-002', `Runtime dependency root package drifted: ${packageName}`);
    }
    rootPackages.push(Object.freeze({
      name: packageName,
      packageName: expected.packageName,
      target
    }));
  }

  return buildRuntimeDependencyMaterializationBinding({
    manifestHash: input.runtimeSpec.manifestHash,
    packages: [...packages.values()] as RuntimeDependencyResolvedPackage[],
    rootPackages,
    toolchain: input.toolchain
  });
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
    throw new SecError('RUNTIME-DEPS-002', `Runtime dependency control file is not physical: ${filePath}`);
  }
  return physicalControlFileIdentity(metadata);
}

async function readPhysicalControlText(filePath: string): Promise<string> {
  const before = await observePhysicalControlFile(filePath);
  const handle = await fs.open(filePath, 'r');
  try {
    const opened = physicalControlFileIdentity(await handle.stat({ bigint: true }));
    if (!samePhysicalControlFileIdentity(before, opened)) {
      throw new SecError('RUNTIME-DEPS-002', `Runtime dependency control file changed: ${filePath}`);
    }
    const text = await handle.readFile('utf8');
    const after = physicalControlFileIdentity(await handle.stat({ bigint: true }));
    const current = await observePhysicalControlFile(filePath);
    if (!samePhysicalControlFileIdentity(opened, after) ||
      !samePhysicalControlFileIdentity(after, current)) {
      throw new SecError('RUNTIME-DEPS-002', `Runtime dependency control file changed: ${filePath}`);
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
  const parent = inspectNoFollowDirectoryChain(
    path.dirname(absolute),
    'Runtime dependency control file parent'
  ).target;
  const name = path.basename(absolute);
  const bytes = Buffer.from(text, 'utf8');
  const validate = (candidate: Uint8Array): void => {
    if (!Buffer.from(candidate).equals(bytes)) {
      throw new SecError('RUNTIME-DEPS-002', `Runtime dependency control file bytes changed: ${filePath}`);
    }
  };
  if (observed === null) {
    publishExclusiveDurableCanonicalFile({
      parent,
      name,
      bytes,
      validate
    });
  } else {
    replaceDurableCanonicalFile({
      parent,
      name,
      bytes,
      expectedExisting: { device: observed.dev, inode: observed.ino },
      validate
    });
  }
  const publishedText = await readPhysicalControlText(absolute);
  if (publishedText !== text) {
    throw new SecError('RUNTIME-DEPS-002', 'Runtime dependency control file bytes failed exact readback');
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

function generatedStatePhysicalIdentity(
  identity: Readonly<Pick<PhysicalDirectoryIdentity, 'device' | 'inode' | 'objectId'>>
): GeneratedStatePhysicalIdentity {
  return Object.freeze({
    device: identity.device,
    inode: identity.inode,
    objectId: identity.objectId
  });
}

function isGeneratedStatePhysicalIdentity(value: unknown): value is GeneratedStatePhysicalIdentity {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const identity = value as Partial<GeneratedStatePhysicalIdentity>;
  return typeof identity.device === 'string' && identity.device.length > 0 &&
    typeof identity.inode === 'string' && identity.inode.length > 0 &&
    typeof identity.objectId === 'string' && identity.objectId.length > 0;
}

function isSha256Digest(value: unknown): value is `sha256:${string}` {
  return typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function sameGeneratedStateIdentity(
  left: Readonly<GeneratedStatePhysicalIdentity>,
  right: Readonly<GeneratedStatePhysicalIdentity>
): boolean {
  return left.device === right.device && left.inode === right.inode && left.objectId === right.objectId;
}

type RuntimeDependencySourceGenerationInput = Readonly<{
  binding: unknown;
  options: RuntimeDependencyOperationOptions;
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
const runtimeDependencySourceGenerationInFlight = new Map<
  string,
  Promise<RuntimeDependencySourceGeneration>
>();

function runtimeDependencySourceGenerationKey(
  input: RuntimeDependencySourceGenerationInput
): string {
  return JSON.stringify([
    path.resolve(input.ownerRoot),
    path.resolve(input.sourcePath),
    generatedStateDigest(input.binding),
    runtimeDependencyOperationContext(input.options).operationId
  ]);
}

async function runtimeDependencySourceGenerationInternal(
  input: RuntimeDependencySourceGenerationInput
): Promise<RuntimeDependencySourceGeneration> {
  const options = runtimeDependencyOperationOptions(input.options);
  const context = runtimeDependencyOperationContext(options);
  runtimeDependencyOperationRemainingMs(options, 'Runtime dependency source generation admission');
  const owner = inspectNoFollowDirectoryChain(
    input.ownerRoot,
    'Runtime dependency source owner root'
  ).target;
  const source = inspectNoFollowDirectoryChain(
    input.sourcePath,
    'Runtime dependency source generation'
  ).target;
  const ownerRootPhysical = generatedStatePhysicalIdentity(owner);
  const physical = generatedStatePhysicalIdentity(source);
  const bindingDigest = generatedStateDigest(input.binding);
  const treeInventory = scanNoFollowDirectoryTreeInventory(source, {
    deadlineAtMs: context.deadlineAtMonotonicMs,
    maximumBytes: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES,
    maximumEntries: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES,
    signal: context.signal
  });
  runtimeDependencyOperationRemainingMs(options, 'Runtime dependency source generation readback');
  const currentOwner = assertSameNoFollowDirectoryIdentity(
    owner,
    'Runtime dependency source owner root readback'
  ).target;
  const currentSource = assertSameNoFollowDirectoryIdentity(
    source,
    'Runtime dependency source generation readback'
  ).target;
  if (!sameGeneratedStateIdentity(
    generatedStatePhysicalIdentity(currentOwner),
    ownerRootPhysical
  ) || !sameGeneratedStateIdentity(
    generatedStatePhysicalIdentity(currentSource),
    physical
  )) {
    throw new SecError(
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
  const treeDigest = generatedStateDigest(Object.freeze({
    schema: 'sec-runtime-dependency-source-tree-v1',
    entries: treeEntries
  }));
  const treeEntryCount = treeEntries.length;
  const epoch = generatedStateDigest(Object.freeze({
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

async function runtimeDependencySourceGeneration(
  input: RuntimeDependencySourceGenerationInput
): Promise<RuntimeDependencySourceGeneration> {
  const key = runtimeDependencySourceGenerationKey(input);
  const existing = runtimeDependencySourceGenerationInFlight.get(key);
  if (existing !== undefined) return existing;
  const pending = runtimeDependencySourceGenerationInternal(input);
  runtimeDependencySourceGenerationInFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    if (runtimeDependencySourceGenerationInFlight.get(key) === pending) {
      runtimeDependencySourceGenerationInFlight.delete(key);
    }
  }
}

function sameRuntimeDependencySourceGenerationContent(
  left: RuntimeDependencySourceGeneration,
  right: RuntimeDependencySourceGeneration
): boolean {
  return left.treeDigest === right.treeDigest && left.treeEntryCount === right.treeEntryCount;
}

async function runtimeDependencyTargetIdentity(
  targetPath: string
): Promise<RuntimeDependencyTargetIdentity | null> {
  const absoluteTarget = path.resolve(targetPath);
  const parent = inspectNoFollowDirectoryChain(
    path.dirname(absoluteTarget),
    'Runtime dependency target parent'
  ).target;
  const name = path.basename(absoluteTarget);
  let link: ReturnType<typeof inspectNoFollowLinkEntry>;
  try {
    link = inspectNoFollowLinkEntry(parent, name);
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
      throw new SecError('RUNTIME-DEPS-004', 'Runtime dependency target is not a valid physical link');
    }
    return Object.freeze({
      schema: 'sec-runtime-dependency-target-identity-v1' as const,
      kind: 'link' as const,
      physical: Object.freeze({
        device: link.device,
        inode: link.inode,
        objectId: generatedStateDigest({ kind: 'link', target: link.linkTarget })
      }),
      linkTarget: link.linkTarget
    });
  }
  const directory = inspectExactNoFollowDirectoryPresence(
    absoluteTarget,
    'Runtime dependency target directory'
  );
  if (directory.state === 'absent') return null;
  return Object.freeze({
    schema: 'sec-runtime-dependency-target-identity-v1' as const,
    kind: 'directory' as const,
    physical: generatedStatePhysicalIdentity(directory.directory.target),
    linkTarget: null
  });
}

function isRuntimeDependencySourceGeneration(
  value: unknown
): value is RuntimeDependencySourceGeneration {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const source = value as Partial<RuntimeDependencySourceGeneration>;
  return source.schema === 'sec-runtime-dependency-source-generation-v1' &&
    typeof source.ownerRoot === 'string' && path.isAbsolute(source.ownerRoot) &&
    typeof source.sourcePath === 'string' && path.isAbsolute(source.sourcePath) &&
    isGeneratedStatePhysicalIdentity(source.ownerRootPhysical) &&
    isGeneratedStatePhysicalIdentity(source.physical) &&
    isSha256Digest(source.bindingDigest) &&
    isSha256Digest(source.treeDigest) &&
    typeof source.treeEntryCount === 'number' && Number.isSafeInteger(source.treeEntryCount) && source.treeEntryCount >= 0 &&
    isSha256Digest(source.epoch);
}

function isRuntimeDependencyTargetIdentity(
  value: unknown
): value is RuntimeDependencyTargetIdentity {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const target = value as Partial<RuntimeDependencyTargetIdentity>;
  return target.schema === 'sec-runtime-dependency-target-identity-v1' &&
    (target.kind === 'directory' || target.kind === 'link') &&
    isGeneratedStatePhysicalIdentity(target.physical) &&
    (target.linkTarget === null || typeof target.linkTarget === 'string');
}

type DependencyTransitionKind =
  | 'compiler-generation'
  | 'compiler-locator'
  | 'compiler-bridge'
  | 'runtime-projection'
  | 'project-projection';

type DependencyTransitionPhase =
  | 'prepared'
  | 'backed-up'
  | 'published'
  | 'binding-validated'
  | 'stamp-readback'
  | 'complete'
  | 'rolled-back'
  | 'recovery-required';

type DependencyTransitionSlot = Readonly<{
  readonly path: string;
  readonly kind: 'absent' | 'directory' | 'link';
  readonly physical: Readonly<GeneratedStatePhysicalIdentity> | null;
  readonly linkTarget: string | null;
  readonly bindingDigest: `sha256:${string}` | null;
}>;

interface DependencyTransitionJournal {
  readonly schema: 'sec-dependency-transition-journal-v2';
  readonly recordDigest: `sha256:${string}`;
  readonly previousRecordDigest: `sha256:${string}` | null;
  readonly sequence: number;
  readonly operationKey: `sha256:${string}`;
  readonly attemptNonce: string;
  readonly kind: DependencyTransitionKind;
  readonly ownerRoot: string;
  readonly ownerRootPhysical: Readonly<GeneratedStatePhysicalIdentity>;
  readonly destination: DependencyTransitionSlot;
  readonly preimage: DependencyTransitionSlot;
  readonly stage: DependencyTransitionSlot | null;
  /**
   * The operation-created staging container is a separate authority from the
   * staged `node_modules` child.  Recovery must retain both identities before
   * it can dispose anything; a path/name alone is never a cleanup authority.
   */
  readonly stageRoot: DependencyTransitionSlot | null;
  readonly backup: DependencyTransitionSlot | null;
  readonly sourceGeneration: Readonly<RuntimeDependencySourceGeneration>;
  readonly phase: DependencyTransitionPhase;
  readonly durability: 'known' | 'unknown';
  readonly failure: Readonly<{ code: string; message: string }> | null;
}

type DependencyTransitionUnsigned = Omit<DependencyTransitionJournal, 'recordDigest'>;

/**
 * The pre-v2 journal grammar is intentionally kept private to migration.  It
 * is not assignable to the normal reader's record type and is never returned
 * by a production readiness/read path.
 */
type LegacyRuntimeDependencySourceGeneration = Omit<
  RuntimeDependencySourceGeneration,
  'treeDigest' | 'treeEntryCount'
> & Partial<Pick<RuntimeDependencySourceGeneration, 'treeDigest' | 'treeEntryCount'>>;

type LegacyDependencyTransitionJournal = Omit<
  DependencyTransitionJournal,
  'schema' | 'sourceGeneration' | 'stageRoot'
> & {
  readonly schema: typeof DEPENDENCY_TRANSITION_LEGACY_SCHEMA;
  readonly sourceGeneration: Readonly<LegacyRuntimeDependencySourceGeneration>;
};

const DEPENDENCY_TRANSITION_SCHEMA = 'sec-dependency-transition-journal-v2' as const;
const DEPENDENCY_TRANSITION_LEGACY_SCHEMA = 'sec-dependency-transition-journal-v1' as const;
const DEPENDENCY_TRANSITION_POINTER_SCHEMA = 'sec-dependency-transition-pointer-v2' as const;
const DEPENDENCY_TRANSITION_MIGRATION_SCHEMA = 'sec-dependency-transition-migration-v1' as const;

interface DependencyTransitionNamespace {
  readonly ownerRoot: PhysicalDirectoryIdentity;
  readonly backupRoot: PhysicalDirectoryIdentity;
  readonly journalRoot: PhysicalDirectoryIdentity;
  readonly recordsRoot: PhysicalDirectoryIdentity;
  readonly rolloversRoot: PhysicalDirectoryIdentity | null;
}

interface DependencyTransitionMigrationIntent {
  readonly schema: typeof DEPENDENCY_TRANSITION_MIGRATION_SCHEMA;
  readonly intentDigest: `sha256:${string}`;
  readonly previousIntentDigest: `sha256:${string}` | null;
  readonly phase: 'prepared' | 'complete';
  readonly ownerRoot: string;
  readonly ownerRootPhysical: Readonly<GeneratedStatePhysicalIdentity>;
  readonly sourceSchema: typeof DEPENDENCY_TRANSITION_LEGACY_SCHEMA;
  readonly sourceJournalRootPath: string;
  readonly sourceJournalRootPhysical: Readonly<GeneratedStatePhysicalIdentity>;
  readonly sourceRecordsRootPath: string;
  readonly sourceRecordsRootPhysical: Readonly<GeneratedStatePhysicalIdentity>;
  readonly sourceLedgerDigest: `sha256:${string}`;
  readonly sourceRecordCount: number;
  readonly targetSchema: typeof DEPENDENCY_TRANSITION_SCHEMA;
  readonly targetJournalRootPath: string;
  readonly targetJournalRootPhysical: Readonly<GeneratedStatePhysicalIdentity>;
  readonly targetRecordsRootPath: string;
  readonly targetRecordsRootPhysical: Readonly<GeneratedStatePhysicalIdentity>;
  readonly targetLedgerDigest: `sha256:${string}`;
  readonly targetRecordCount: number;
}

/**
 * The mutable `current.json` file is only a best-effort locator.  It is not a
 * transition authority: a caller must derive the one maximal tip from the
 * immutable record ledger before it can inspect or perform recovery effects.
 * Keeping this distinction explicit prevents a concurrent/external pointer
 * writer from making an older or foreign record appear authoritative.
 */
interface DependencyTransitionLedger {
  readonly namespace: DependencyTransitionNamespace;
  readonly records: ReadonlyMap<`sha256:${string}`, DependencyTransitionJournal>;
  readonly ledgerDigest: `sha256:${string}`;
  readonly tip: DependencyTransitionJournal | null;
}

const DEPENDENCY_TRANSITION_RECORD_CAPACITY = 10_000;
// Transition records are small canonical journal envelopes.  Reading their
// bounded bytes in one retained no-follow census avoids reopening every leaf
// after a metadata scan (O(records x phase writes)) while keeping the ledger
// memory/deadline contract explicit.  Dependency trees use the streaming
// inventory path and never enter this budget.
const DEPENDENCY_TRANSITION_RECORD_BYTES_CAPACITY = 64 * 1024 * 1024;
const DEPENDENCY_COMMAND_OUTPUT_BYTES_CAPACITY = DEPENDENCY_TRANSITION_RECORD_BYTES_CAPACITY;
const DEPENDENCY_TRANSITION_ROLLOVER_TRIGGER = 9_000;
const DEPENDENCY_TRANSITION_ROLLOVER_NAMESPACE_CAPACITY = 4_096;
const DEPENDENCY_TRANSITION_ROLLOVER_SCHEMA = 'sec-dependency-transition-rollover-v1' as const;

type DependencyTransitionRolloverPhase =
  | 'prepared'
  | 'staged'
  | 'backed-up'
  | 'published'
  | 'retiring'
  | 'retired'
  | 'complete';

interface DependencyTransitionRolloverIntent {
  readonly schema: typeof DEPENDENCY_TRANSITION_ROLLOVER_SCHEMA;
  readonly intentDigest: `sha256:${string}`;
  readonly previousIntentDigest: `sha256:${string}` | null;
  readonly sequence: number;
  readonly phase: DependencyTransitionRolloverPhase;
  readonly ownerRoot: string;
  readonly ownerRootPhysical: Readonly<GeneratedStatePhysicalIdentity>;
  readonly recordsRootPath: string;
  readonly sourceRecordsRootPhysical: Readonly<GeneratedStatePhysicalIdentity>;
  readonly retiredRecordsPath: string;
  readonly retiredRecordsPhysical: Readonly<GeneratedStatePhysicalIdentity> | null;
  readonly retiredRecordsDisposed: boolean;
  readonly nextRecordsPath: string;
  readonly nextRecordsPhysical: Readonly<GeneratedStatePhysicalIdentity> | null;
  readonly publishedRecordsRootPhysical: Readonly<GeneratedStatePhysicalIdentity> | null;
  readonly terminalRecordDigest: `sha256:${string}`;
  readonly ledgerDigest: `sha256:${string}`;
  readonly recordCount: number;
  readonly checkpoint: DependencyTransitionJournal;
}

function dependencyTransitionNamespacePaths(ownerRoot: string): Readonly<{
  backupRoot: string;
  journalRoot: string;
  recordsRoot: string;
  rolloversRoot: string;
}> {
  const backupRoot = path.join(ownerRoot, '.tmp', 'dependency-installs', 'compiler-backups');
  const journalRoot = path.join(backupRoot, '.dependency-transition-v2');
  return Object.freeze({
    backupRoot,
    journalRoot,
    recordsRoot: path.join(journalRoot, 'records'),
    rolloversRoot: path.join(journalRoot, 'rollovers')
  });
}

function dependencyTransitionLegacyNamespacePaths(ownerRoot: string): Readonly<{
  backupRoot: string;
  journalRoot: string;
  recordsRoot: string;
}> {
  const backupRoot = path.join(ownerRoot, '.tmp', 'dependency-installs', 'compiler-backups');
  const journalRoot = path.join(backupRoot, '.dependency-transition-v1');
  return Object.freeze({
    backupRoot,
    journalRoot,
    recordsRoot: path.join(journalRoot, 'records')
  });
}

function dependencyTransitionDigestWithoutRecord(
  record: DependencyTransitionUnsigned
): `sha256:${string}` {
  return generatedStateDigest(canonicalJson(record));
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
function dependencyTransitionTerminalCheckpoint(
  terminal: DependencyTransitionJournal,
  ledgerDigest: `sha256:${string}`
): DependencyTransitionJournal {
  if (terminal.phase !== 'complete' && terminal.phase !== 'rolled-back') {
    throw new SecError('RUNTIME-DEPS-004', 'Only a terminal dependency transition can seed a rollover checkpoint');
  }
  const unsigned: DependencyTransitionUnsigned = Object.freeze({
    schema: DEPENDENCY_TRANSITION_SCHEMA,
    previousRecordDigest: null,
    sequence: 1,
    operationKey: generatedStateDigest(Object.freeze({
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
  }) as DependencyTransitionJournal;
}

function dependencyTransitionRecordBytes(record: DependencyTransitionJournal): Buffer {
  // Journal records are immutable evidence.  Their digest is over canonical
  // JSON and the bytes published under the digest-named path must use that
  // same canonical ordering; a merely parseable pretty-printed variant is a
  // collision, not a record we may adopt.
  return Buffer.from(formatJsonFile(canonicalJson(record)), 'utf8');
}

const DEPENDENCY_TRANSITION_RECORD_KEYS = Object.freeze([
  'attemptNonce', 'backup', 'destination', 'durability', 'failure',
  'kind', 'operationKey', 'ownerRoot', 'ownerRootPhysical', 'phase',
  'preimage', 'previousRecordDigest', 'recordDigest', 'schema',
  'sequence', 'sourceGeneration', 'stage', 'stageRoot'
]);
const DEPENDENCY_TRANSITION_LEGACY_RECORD_KEYS = Object.freeze([
  'attemptNonce', 'backup', 'destination', 'durability', 'failure',
  'kind', 'operationKey', 'ownerRoot', 'ownerRootPhysical', 'phase',
  'preimage', 'previousRecordDigest', 'recordDigest', 'schema',
  'sequence', 'sourceGeneration', 'stage'
]);
const DEPENDENCY_TRANSITION_POINTER_KEYS = Object.freeze(['recordDigest', 'schema']);
const DEPENDENCY_TRANSITION_MIGRATION_KEYS = Object.freeze([
  'intentDigest', 'ownerRoot', 'ownerRootPhysical', 'phase',
  'previousIntentDigest', 'schema', 'sourceJournalRootPath',
  'sourceJournalRootPhysical', 'sourceLedgerDigest', 'sourceRecordCount',
  'sourceRecordsRootPath', 'sourceRecordsRootPhysical', 'targetJournalRootPath', 'targetJournalRootPhysical',
  'targetLedgerDigest', 'targetRecordCount', 'targetRecordsRootPath',
  'targetRecordsRootPhysical', 'targetSchema', 'sourceSchema'
]);
const DEPENDENCY_TRANSITION_ROLLOVER_KEYS = Object.freeze([
  'checkpoint', 'intentDigest', 'nextRecordsPath', 'nextRecordsPhysical',
  'previousIntentDigest', 'sequence',
  'ownerRoot', 'ownerRootPhysical', 'phase', 'publishedRecordsRootPhysical',
  'recordCount', 'recordsRootPath', 'retiredRecordsPath', 'retiredRecordsPhysical',
  'retiredRecordsDisposed', 'ledgerDigest',
  'schema', 'sourceRecordsRootPhysical', 'terminalRecordDigest'
]);
const DEPENDENCY_TRANSITION_SLOT_KEYS = Object.freeze([
  'bindingDigest', 'kind', 'linkTarget', 'path', 'physical'
]);
const RUNTIME_SOURCE_GENERATION_KEYS = Object.freeze([
  'bindingDigest', 'epoch', 'ownerRoot', 'ownerRootPhysical', 'physical',
  'sourcePath', 'treeDigest', 'treeEntryCount', 'schema'
]);
const LEGACY_RUNTIME_SOURCE_GENERATION_KEYS = Object.freeze([
  'bindingDigest', 'epoch', 'ownerRoot', 'ownerRootPhysical', 'physical',
  'sourcePath', 'schema'
]);
const GENERATED_STATE_PHYSICAL_IDENTITY_KEYS = Object.freeze(['device', 'inode', 'objectId']);

function hasExactObjectKeys(
  value: unknown,
  keys: readonly string[]
): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return false;
  return Object.keys(value).sort(compareCodeUnits).join('\0') ===
    [...keys].sort(compareCodeUnits).join('\0');
}

function isCanonicalAbsolutePath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0') &&
    path.isAbsolute(value) && path.resolve(value) === value;
}

function isCanonicalGeneratedStatePhysicalIdentity(value: unknown): value is GeneratedStatePhysicalIdentity {
  return hasExactObjectKeys(value, GENERATED_STATE_PHYSICAL_IDENTITY_KEYS) &&
    typeof value.device === 'string' && value.device.length > 0 &&
    typeof value.inode === 'string' && value.inode.length > 0 &&
    typeof value.objectId === 'string' && value.objectId.length > 0;
}

function isCanonicalDependencyTransitionSlot(value: unknown): value is DependencyTransitionSlot {
  if (!hasExactObjectKeys(value, DEPENDENCY_TRANSITION_SLOT_KEYS) ||
      !isCanonicalAbsolutePath(value.path) ||
      !(['absent', 'directory', 'link'] as readonly string[]).includes(value.kind as string) ||
      (value.bindingDigest !== null && !isSha256Digest(value.bindingDigest)) ||
      (value.linkTarget !== null && typeof value.linkTarget !== 'string')) return false;
  if (value.kind === 'absent') {
    return value.physical === null && value.linkTarget === null && value.bindingDigest === null;
  }
  if (!isCanonicalGeneratedStatePhysicalIdentity(value.physical)) return false;
  return value.kind === 'link' ? value.linkTarget !== null : value.linkTarget === null;
}

function isCanonicalRuntimeDependencySourceGeneration(
  value: unknown
): value is RuntimeDependencySourceGeneration {
  if (!hasExactObjectKeys(value, RUNTIME_SOURCE_GENERATION_KEYS) ||
      value.schema !== 'sec-runtime-dependency-source-generation-v1' ||
      !isCanonicalAbsolutePath(value.ownerRoot) ||
      !isCanonicalAbsolutePath(value.sourcePath) ||
      !isCanonicalGeneratedStatePhysicalIdentity(value.ownerRootPhysical) ||
      !isCanonicalGeneratedStatePhysicalIdentity(value.physical) ||
      !isSha256Digest(value.bindingDigest) || !isSha256Digest(value.treeDigest) ||
      !Number.isSafeInteger(value.treeEntryCount) || (value.treeEntryCount as number) < 0 ||
      !isSha256Digest(value.epoch)) return false;
  return true;
}

function isCanonicalLegacyRuntimeDependencySourceGeneration(
  value: unknown
): value is LegacyRuntimeDependencySourceGeneration {
  if (hasExactObjectKeys(value, RUNTIME_SOURCE_GENERATION_KEYS)) {
    return isCanonicalRuntimeDependencySourceGeneration(value);
  }
  if (!hasExactObjectKeys(value, LEGACY_RUNTIME_SOURCE_GENERATION_KEYS) ||
      value.schema !== 'sec-runtime-dependency-source-generation-v1' ||
      !isCanonicalAbsolutePath(value.ownerRoot) ||
      !isCanonicalAbsolutePath(value.sourcePath) ||
      !isCanonicalGeneratedStatePhysicalIdentity(value.ownerRootPhysical) ||
      !isCanonicalGeneratedStatePhysicalIdentity(value.physical) ||
      !isSha256Digest(value.bindingDigest) || !isSha256Digest(value.epoch)) return false;
  return true;
}

function parseDependencyTransitionRecord(
  bytes: Uint8Array,
  expectedName?: string
): DependencyTransitionJournal {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch (error) {
    throw new SecError('RUNTIME-DEPS-002', 'Dependency transition journal record is not JSON', {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  if (!hasExactObjectKeys(value, DEPENDENCY_TRANSITION_RECORD_KEYS)) {
    throw new SecError('RUNTIME-DEPS-002', 'Dependency transition journal record has noncanonical keys');
  }
  const record = value as unknown as DependencyTransitionJournal;
  if (record.schema !== DEPENDENCY_TRANSITION_SCHEMA || !isSha256Digest(record.recordDigest) ||
      !isSha256Digest(record.previousRecordDigest) && record.previousRecordDigest !== null ||
      !Number.isSafeInteger(record.sequence) || record.sequence < 1 ||
      !isSha256Digest(record.operationKey) || typeof record.attemptNonce !== 'string' ||
      record.attemptNonce.length === 0 || !(['compiler-generation', 'compiler-locator', 'compiler-bridge', 'runtime-projection', 'project-projection'] as readonly string[]).includes(record.kind) ||
      !isCanonicalAbsolutePath(record.ownerRoot) ||
      !isCanonicalGeneratedStatePhysicalIdentity(record.ownerRootPhysical) ||
      !isCanonicalDependencyTransitionSlot(record.destination) ||
      !isCanonicalDependencyTransitionSlot(record.preimage) ||
      (record.stage !== null && !isCanonicalDependencyTransitionSlot(record.stage)) ||
      (record.stageRoot !== null && !isCanonicalDependencyTransitionSlot(record.stageRoot)) ||
      (record.backup !== null && !isCanonicalDependencyTransitionSlot(record.backup)) ||
      !isCanonicalRuntimeDependencySourceGeneration(record.sourceGeneration) ||
      !(['prepared', 'backed-up', 'published', 'binding-validated', 'stamp-readback', 'complete', 'rolled-back', 'recovery-required'] as readonly string[]).includes(record.phase) ||
      !(['known', 'unknown'] as readonly string[]).includes(record.durability) ||
      (record.failure !== null && (!hasExactObjectKeys(record.failure, ['code', 'message']) ||
        typeof record.failure.code !== 'string' || record.failure.code.length === 0 ||
        typeof record.failure.message !== 'string' || record.failure.message.length === 0))) {
    throw new SecError('RUNTIME-DEPS-002', 'Dependency transition journal record fields are invalid');
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
    throw new SecError('RUNTIME-DEPS-002', 'Dependency transition journal topology is noncanonical');
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
    throw new SecError('RUNTIME-DEPS-002', 'Compiler bridge transition journal topology is noncanonical');
  }
  if (expectedName !== undefined && expectedName !== transitionRecordName(record.recordDigest)) {
    throw new SecError('RUNTIME-DEPS-002', 'Dependency transition journal filename does not match its digest');
  }
  const { recordDigest: _recordDigest, ...unsigned } = record;
  if (dependencyTransitionDigestWithoutRecord(unsigned) !== record.recordDigest) {
    throw new SecError('RUNTIME-DEPS-002', 'Dependency transition journal record digest is invalid');
  }
  if (formatJsonFile(canonicalJson(record)) !== Buffer.from(bytes).toString('utf8')) {
    throw new SecError('RUNTIME-DEPS-002', 'Dependency transition journal record bytes are not canonical');
  }
  return Object.freeze(record);
}

function assertDependencyTransitionRecordBytes(bytes: Uint8Array): void {
  parseDependencyTransitionRecord(bytes);
}

/**
 * Parse the pre-stageRoot journal grammar only while performing the one-way
 * v1 -> v2 migration.  This deliberately uses the old insertion-order digest
 * and byte representation; accepting those bytes from the normal reader would
 * turn a schema migration into an accidental dual-read compatibility path.
 */
function parseLegacyDependencyTransitionRecord(
  bytes: Uint8Array,
  expectedName?: string
): LegacyDependencyTransitionJournal {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch (error) {
    throw new SecError('RUNTIME-DEPS-002', 'Legacy dependency transition journal record is not JSON', {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  if (!hasExactObjectKeys(value, DEPENDENCY_TRANSITION_LEGACY_RECORD_KEYS)) {
    throw new SecError('RUNTIME-DEPS-002', 'Legacy dependency transition journal record has noncanonical keys');
  }
  const record = value as unknown as LegacyDependencyTransitionJournal;
  if (record.schema !== DEPENDENCY_TRANSITION_LEGACY_SCHEMA || !isSha256Digest(record.recordDigest) ||
      (!isSha256Digest(record.previousRecordDigest) && record.previousRecordDigest !== null) ||
      !Number.isSafeInteger(record.sequence) || record.sequence < 1 ||
      !isSha256Digest(record.operationKey) || typeof record.attemptNonce !== 'string' ||
      record.attemptNonce.length === 0 ||
      !(['compiler-generation', 'compiler-locator', 'compiler-bridge', 'runtime-projection', 'project-projection'] as readonly string[]).includes(record.kind) ||
      !isCanonicalAbsolutePath(record.ownerRoot) ||
      !isCanonicalGeneratedStatePhysicalIdentity(record.ownerRootPhysical) ||
      !isCanonicalDependencyTransitionSlot(record.destination) ||
      !isCanonicalDependencyTransitionSlot(record.preimage) ||
      (record.stage !== null && !isCanonicalDependencyTransitionSlot(record.stage)) ||
      (record.backup !== null && !isCanonicalDependencyTransitionSlot(record.backup)) ||
      !isCanonicalLegacyRuntimeDependencySourceGeneration(record.sourceGeneration) ||
      !(['prepared', 'backed-up', 'published', 'binding-validated', 'stamp-readback', 'complete', 'rolled-back', 'recovery-required'] as readonly string[]).includes(record.phase) ||
      !(['known', 'unknown'] as readonly string[]).includes(record.durability) ||
      (record.failure !== null && (!hasExactObjectKeys(record.failure, ['code', 'message']) ||
        typeof record.failure.code !== 'string' || record.failure.code.length === 0 ||
        typeof record.failure.message !== 'string' || record.failure.message.length === 0))) {
    throw new SecError('RUNTIME-DEPS-002', 'Legacy dependency transition journal record fields are invalid');
  }
  if (record.destination.path !== record.preimage.path ||
      (record.backup !== null && path.dirname(record.backup.path) !==
        path.join(record.ownerRoot, '.tmp', 'dependency-installs', 'compiler-backups')) ||
      (record.kind === 'compiler-bridge' && (
        record.preimage.kind !== 'absent' ||
        record.stage !== null ||
        record.backup !== null ||
        record.sourceGeneration.ownerRoot !== path.dirname(record.sourceGeneration.sourcePath) ||
        path.basename(record.sourceGeneration.sourcePath).toLocaleLowerCase('en-US') !== 'node_modules' ||
        path.resolve(record.destination.path) === path.resolve(record.sourceGeneration.sourcePath)
      ))) {
    throw new SecError('RUNTIME-DEPS-002', 'Legacy dependency transition journal topology is noncanonical');
  }
  if (expectedName !== undefined && expectedName !== transitionRecordName(record.recordDigest)) {
    throw new SecError('RUNTIME-DEPS-002', 'Legacy dependency transition journal filename does not match its digest');
  }
  const { recordDigest: _recordDigest, ...unsigned } = record;
  if (generatedStateDigest(unsigned) !== record.recordDigest) {
    throw new SecError('RUNTIME-DEPS-002', 'Legacy dependency transition journal record digest is invalid');
  }
  if (formatJsonFile(record) !== Buffer.from(bytes).toString('utf8')) {
    throw new SecError('RUNTIME-DEPS-002', 'Legacy dependency transition journal record bytes are not canonical');
  }
  return Object.freeze(record);
}

function assertDependencyTransitionPointerBytes(bytes: Uint8Array): void {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch (error) {
    throw new SecError('RUNTIME-DEPS-002', 'Dependency transition pointer is not JSON', {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  if (!hasExactObjectKeys(value, DEPENDENCY_TRANSITION_POINTER_KEYS)) {
    throw new SecError('RUNTIME-DEPS-002', 'Dependency transition pointer has noncanonical keys');
  }
  const pointer = value as { schema: string; recordDigest: string };
  if (pointer.schema !== DEPENDENCY_TRANSITION_POINTER_SCHEMA || !isSha256Digest(pointer.recordDigest) ||
      formatJsonFile(canonicalJson(value)) !== Buffer.from(bytes).toString('utf8')) {
    throw new SecError('RUNTIME-DEPS-002', 'Dependency transition pointer schema is invalid');
  }
}

function dependencyTransitionMigrationIntentStableDigest(
  intent: Omit<DependencyTransitionMigrationIntent, 'intentDigest' | 'schema'>
): `sha256:${string}` {
  return generatedStateDigest(canonicalJson(Object.freeze({
    schema: DEPENDENCY_TRANSITION_MIGRATION_SCHEMA,
    previousIntentDigest: intent.previousIntentDigest,
    phase: intent.phase,
    ownerRoot: intent.ownerRoot,
    ownerRootPhysical: intent.ownerRootPhysical,
    sourceSchema: intent.sourceSchema,
    sourceJournalRootPath: intent.sourceJournalRootPath,
    sourceJournalRootPhysical: intent.sourceJournalRootPhysical,
    sourceRecordsRootPath: intent.sourceRecordsRootPath,
    sourceRecordsRootPhysical: intent.sourceRecordsRootPhysical,
    sourceLedgerDigest: intent.sourceLedgerDigest,
    sourceRecordCount: intent.sourceRecordCount,
    targetSchema: intent.targetSchema,
    targetJournalRootPath: intent.targetJournalRootPath,
    targetJournalRootPhysical: intent.targetJournalRootPhysical,
    targetRecordsRootPath: intent.targetRecordsRootPath,
    targetRecordsRootPhysical: intent.targetRecordsRootPhysical,
    targetLedgerDigest: intent.targetLedgerDigest,
    targetRecordCount: intent.targetRecordCount
  })));
}

function dependencyTransitionMigrationIntentFileName(
  intentDigest: `sha256:${string}`,
  phase: 'prepared' | 'complete'
): string {
  return `migration-${intentDigest.slice('sha256:'.length)}-${phase}.json`;
}

function dependencyTransitionMigrationIntentBytes(
  intent: DependencyTransitionMigrationIntent
): Buffer {
  return Buffer.from(formatJsonFile(canonicalJson(intent)), 'utf8');
}

function parseDependencyTransitionMigrationIntent(
  bytes: Uint8Array,
  expectedName?: string
): DependencyTransitionMigrationIntent {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch (error) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition migration intent is not JSON', {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  if (!hasExactObjectKeys(value, DEPENDENCY_TRANSITION_MIGRATION_KEYS)) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition migration intent has noncanonical keys');
  }
  const intent = value as unknown as DependencyTransitionMigrationIntent;
  if (intent.schema !== DEPENDENCY_TRANSITION_MIGRATION_SCHEMA ||
      !isSha256Digest(intent.intentDigest) ||
      (intent.previousIntentDigest !== null && !isSha256Digest(intent.previousIntentDigest)) ||
      !(['prepared', 'complete'] as readonly string[]).includes(intent.phase) ||
      !isCanonicalAbsolutePath(intent.ownerRoot) ||
      !isCanonicalGeneratedStatePhysicalIdentity(intent.ownerRootPhysical) ||
      intent.sourceSchema !== DEPENDENCY_TRANSITION_LEGACY_SCHEMA ||
      !isCanonicalAbsolutePath(intent.sourceJournalRootPath) ||
      !isCanonicalGeneratedStatePhysicalIdentity(intent.sourceJournalRootPhysical) ||
      !isCanonicalAbsolutePath(intent.sourceRecordsRootPath) ||
      !isCanonicalGeneratedStatePhysicalIdentity(intent.sourceRecordsRootPhysical) ||
      !isSha256Digest(intent.sourceLedgerDigest) ||
      !Number.isSafeInteger(intent.sourceRecordCount) || intent.sourceRecordCount < 1 ||
      intent.sourceRecordCount > DEPENDENCY_TRANSITION_RECORD_CAPACITY ||
      intent.targetSchema !== DEPENDENCY_TRANSITION_SCHEMA ||
      !isCanonicalAbsolutePath(intent.targetJournalRootPath) ||
      !isCanonicalGeneratedStatePhysicalIdentity(intent.targetJournalRootPhysical) ||
      !isCanonicalAbsolutePath(intent.targetRecordsRootPath) ||
      !isCanonicalGeneratedStatePhysicalIdentity(intent.targetRecordsRootPhysical) ||
      !isSha256Digest(intent.targetLedgerDigest) ||
      !Number.isSafeInteger(intent.targetRecordCount) || intent.targetRecordCount < 0 ||
      intent.targetRecordCount > DEPENDENCY_TRANSITION_RECORD_CAPACITY ||
      (intent.phase === 'prepared' && intent.previousIntentDigest !== null) ||
      (intent.phase === 'complete' && intent.previousIntentDigest === null) ||
      dependencyTransitionMigrationIntentStableDigest(intent) !== intent.intentDigest) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition migration intent fields are invalid');
  }
  const legacyPaths = dependencyTransitionLegacyNamespacePaths(intent.ownerRoot);
  const targetPaths = dependencyTransitionNamespacePaths(intent.ownerRoot);
  if (path.resolve(intent.sourceJournalRootPath) !== path.resolve(legacyPaths.journalRoot) ||
      path.resolve(intent.sourceRecordsRootPath) !== path.resolve(legacyPaths.recordsRoot) ||
      path.dirname(intent.sourceRecordsRootPath) !== intent.sourceJournalRootPath ||
      path.resolve(intent.targetJournalRootPath) !== path.resolve(targetPaths.journalRoot) ||
      path.resolve(intent.targetRecordsRootPath) !== path.resolve(targetPaths.recordsRoot) ||
      path.dirname(intent.targetRecordsRootPath) !== intent.targetJournalRootPath ||
      expectedName !== undefined && expectedName !== dependencyTransitionMigrationIntentFileName(
        intent.intentDigest,
        intent.phase
      )) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition migration intent topology is noncanonical');
  }
  if (formatJsonFile(canonicalJson(intent)) !== Buffer.from(bytes).toString('utf8')) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition migration intent bytes are not canonical');
  }
  return Object.freeze(intent);
}

function assertDependencyTransitionMigrationIntentBytes(bytes: Uint8Array): void {
  parseDependencyTransitionMigrationIntent(bytes);
}

function rolloverIntentStableDigest(
  intent: Pick<DependencyTransitionRolloverIntent,
    'previousIntentDigest' | 'sequence' | 'ownerRoot' | 'ownerRootPhysical' |
    'recordsRootPath' | 'sourceRecordsRootPhysical' |
    'retiredRecordsPath' | 'nextRecordsPath' | 'terminalRecordDigest' | 'ledgerDigest' |
    'recordCount' | 'checkpoint'>
): `sha256:${string}` {
  return generatedStateDigest(Object.freeze({
    schema: DEPENDENCY_TRANSITION_ROLLOVER_SCHEMA,
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

function rolloverIntentFileName(
  intentDigest: `sha256:${string}`,
  phase: DependencyTransitionRolloverPhase
): string {
  return `rollover-${intentDigest.slice('sha256:'.length)}-${phase}.json`;
}

function rolloverResidueStem(
  intent: Pick<DependencyTransitionRolloverIntent,
    'previousIntentDigest' | 'sequence' | 'ownerRoot' | 'terminalRecordDigest' |
    'ledgerDigest' | 'recordCount' | 'checkpoint'>
): string {
  return generatedStateDigest(Object.freeze({
    schema: DEPENDENCY_TRANSITION_ROLLOVER_SCHEMA,
    previousIntentDigest: intent.previousIntentDigest,
    sequence: intent.sequence,
    ownerRoot: path.resolve(intent.ownerRoot),
    terminalRecordDigest: intent.terminalRecordDigest,
    ledgerDigest: intent.ledgerDigest,
    recordCount: intent.recordCount,
    checkpointDigest: intent.checkpoint.recordDigest
  })).slice('sha256:'.length, 'sha256:'.length + 48);
}

function parseDependencyTransitionRolloverIntent(
  bytes: Uint8Array,
  expectedName?: string
): DependencyTransitionRolloverIntent {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch (error) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover intent is not JSON', {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  if (!hasExactObjectKeys(value, DEPENDENCY_TRANSITION_ROLLOVER_KEYS)) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover intent has noncanonical keys');
  }
  const intent = value as unknown as DependencyTransitionRolloverIntent;
  if (intent.schema !== DEPENDENCY_TRANSITION_ROLLOVER_SCHEMA ||
      !isSha256Digest(intent.intentDigest) ||
      (intent.previousIntentDigest !== null && !isSha256Digest(intent.previousIntentDigest)) ||
      !Number.isSafeInteger(intent.sequence) || intent.sequence < 1 ||
      !(['prepared', 'staged', 'backed-up', 'published', 'retiring', 'retired', 'complete'] as readonly string[]).includes(intent.phase) ||
      !isCanonicalAbsolutePath(intent.ownerRoot) ||
      !isCanonicalGeneratedStatePhysicalIdentity(intent.ownerRootPhysical) ||
      !isCanonicalAbsolutePath(intent.recordsRootPath) ||
      !isCanonicalGeneratedStatePhysicalIdentity(intent.sourceRecordsRootPhysical) ||
      !isCanonicalAbsolutePath(intent.retiredRecordsPath) ||
      !isCanonicalAbsolutePath(intent.nextRecordsPath) ||
      (intent.retiredRecordsPhysical !== null &&
        !isCanonicalGeneratedStatePhysicalIdentity(intent.retiredRecordsPhysical)) ||
      (intent.nextRecordsPhysical !== null &&
        !isCanonicalGeneratedStatePhysicalIdentity(intent.nextRecordsPhysical)) ||
      (intent.publishedRecordsRootPhysical !== null &&
        !isCanonicalGeneratedStatePhysicalIdentity(intent.publishedRecordsRootPhysical)) ||
      !isSha256Digest(intent.terminalRecordDigest) ||
      !isSha256Digest(intent.ledgerDigest) ||
      !Number.isSafeInteger(intent.recordCount) || intent.recordCount < 1 ||
      intent.recordCount > DEPENDENCY_TRANSITION_RECORD_CAPACITY ||
      typeof intent.retiredRecordsDisposed !== 'boolean' ||
      parseDependencyTransitionRecord(
        Buffer.from(formatJsonFile(canonicalJson(intent.checkpoint)), 'utf8')
      ).recordDigest !== intent.checkpoint.recordDigest) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover intent fields are invalid');
  }
  const journalRoot = path.dirname(intent.recordsRootPath);
  const rolloversRoot = path.join(journalRoot, 'rollovers');
  const residueStem = rolloverResidueStem(intent);
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
      rolloverIntentStableDigest(intent) !== intent.intentDigest) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover intent topology or digest is invalid');
  }
  if (expectedName !== undefined && expectedName !== rolloverIntentFileName(intent.intentDigest, intent.phase)) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover intent filename does not match its digest');
  }
  if (formatJsonFile(canonicalJson(intent)) !== Buffer.from(bytes).toString('utf8')) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover intent bytes are not canonical');
  }
  return Object.freeze(intent);
}

function assertDependencyTransitionRolloverIntentBytes(bytes: Uint8Array): void {
  parseDependencyTransitionRolloverIntent(bytes);
}

function writeDurableTransitionFile(
  parent: PhysicalDirectoryIdentity,
  name: string,
  bytes: Uint8Array,
  validate: (candidate: Uint8Array) => void,
  immutable = false,
  expectedExisting?: Readonly<{ device: string; inode: string }> | null
): void {
  const existing = inspectNoFollowOrdinaryFileEntry(parent, name);
  if (immutable && existing !== null) {
    const current = readNoFollowOrdinaryFile(parent, name);
    if (current === null) {
      throw new SecError('RUNTIME-DEPS-002', 'Immutable dependency transition record disappeared before reuse');
    }
    validate(current);
    if (!Buffer.from(current).equals(Buffer.from(bytes))) {
      throw new SecError('RUNTIME-DEPS-002', 'Immutable dependency transition record collides with different canonical bytes', {
        path: path.join(parent.path, name)
      });
    }
    return;
  }
  if (expectedExisting !== undefined) {
    replaceDurableCanonicalFile({ parent, name, bytes, validate, expectedExisting });
    return;
  }
  if (existing === null) {
    publishExclusiveDurableCanonicalFile({ parent, name, bytes, validate });
  } else {
    replaceDurableCanonicalFile({ parent, name, bytes, validate });
  }
}

function transitionRecordName(digestValue: `sha256:${string}`): string {
  return `record-${digestValue.slice('sha256:'.length)}.json`;
}

async function ensureDependencyTransitionNamespace(
  ownerRoot: string,
  options: RuntimeDependencyOperationOptions
): Promise<DependencyTransitionNamespace> {
  await runtimeDependencyOperationEffectFence(options, 'Dependency transition namespace creation');
  const owner = inspectNoFollowDirectoryChain(ownerRoot, 'Dependency transition owner root').target;
  const paths = dependencyTransitionNamespacePaths(owner.path);
  // This is the only namespace creation route. Existing names are reopened
  // without following links, so a foreign/reparse path fails closed.
  const backupRoot = createNoFollowOrdinaryDirectoryChain(owner, [
    '.tmp', 'dependency-installs', 'compiler-backups'
  ]);
  const journalRoot = createNoFollowOrdinaryDirectoryChain(backupRoot, [
    '.dependency-transition-v2'
  ]);
  const recordsRoot = createNoFollowOrdinaryDirectoryChain(journalRoot, ['records']);
  const rolloversRoot = createNoFollowOrdinaryDirectoryChain(journalRoot, ['rollovers']);
  if (paths.backupRoot !== backupRoot.path || paths.journalRoot !== journalRoot.path ||
    paths.recordsRoot !== recordsRoot.path || paths.rolloversRoot !== rolloversRoot.path) {
    throw new SecError('RUNTIME-DEPS-002', 'Dependency transition namespace path normalization changed');
  }
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition namespace creation readback');
  return Object.freeze({ ownerRoot: owner, backupRoot, journalRoot, recordsRoot, rolloversRoot });
}

function inspectDependencyTransitionNamespace(
  ownerRoot: string
): DependencyTransitionNamespace | null {
  try {
    const owner = inspectNoFollowDirectoryChain(ownerRoot, 'Dependency transition owner root').target;
    const paths = dependencyTransitionNamespacePaths(owner.path);
    const backupRoot = inspectNoFollowDirectoryChain(paths.backupRoot, 'Dependency transition backup root').target;
    const journalRoot = inspectNoFollowDirectoryChain(paths.journalRoot, 'Dependency transition journal root').target;
    const recordsRoot = inspectNoFollowDirectoryChain(paths.recordsRoot, 'Dependency transition records root').target;
    let rolloversRoot: PhysicalDirectoryIdentity | null;
    try {
      rolloversRoot = inspectNoFollowDirectoryChain(paths.rolloversRoot, 'Dependency transition rollovers root').target;
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
      throw new SecError('RUNTIME-DEPS-002', 'Dependency transition namespace path normalization changed');
    }
    return Object.freeze({ ownerRoot: owner, backupRoot, journalRoot, recordsRoot, rolloversRoot });
  } catch (error) {
    if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') return null;
    throw error;
  }
}

/**
 * Inspect the retired v1 namespace without creating any directory and without
 * treating its records as current authority.  The migration owner uses this
 * physical snapshot as its source preimage; every normal reader ignores this
 * namespace except to report that an explicit migration is required.
 */
function inspectLegacyDependencyTransitionNamespace(
  ownerRoot: string
): DependencyTransitionNamespace | null {
  try {
    const owner = inspectNoFollowDirectoryChain(ownerRoot, 'Legacy dependency transition owner root').target;
    const paths = dependencyTransitionLegacyNamespacePaths(owner.path);
    const backupRoot = inspectNoFollowDirectoryChain(
      paths.backupRoot,
      'Legacy dependency transition backup root'
    ).target;
    const journalRoot = inspectNoFollowDirectoryChain(
      paths.journalRoot,
      'Legacy dependency transition journal root'
    ).target;
    const recordsRoot = inspectNoFollowDirectoryChain(
      paths.recordsRoot,
      'Legacy dependency transition records root'
    ).target;
    if (paths.backupRoot !== backupRoot.path || paths.journalRoot !== journalRoot.path ||
        paths.recordsRoot !== recordsRoot.path) {
      throw new SecError('RUNTIME-DEPS-002', 'Legacy dependency transition namespace path normalization changed');
    }
    return Object.freeze({
      ownerRoot: owner,
      backupRoot,
      journalRoot,
      recordsRoot,
      rolloversRoot: null
    });
  } catch (error) {
    if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') return null;
    throw error;
  }
}

type DependencyTransitionRolloverNamespace = Readonly<{
  ownerRoot: PhysicalDirectoryIdentity;
  journalRoot: PhysicalDirectoryIdentity;
  rolloversRoot: PhysicalDirectoryIdentity;
  recordsRootPath: string;
}>;

function inspectDependencyTransitionRolloverNamespace(
  ownerRoot: string
): DependencyTransitionRolloverNamespace | null {
  try {
    const owner = inspectNoFollowDirectoryChain(ownerRoot, 'Dependency transition rollover owner root').target;
    const paths = dependencyTransitionNamespacePaths(owner.path);
    const backupRoot = inspectNoFollowDirectoryChain(
      paths.backupRoot,
      'Dependency transition rollover backup root'
    ).target;
    const journalRoot = inspectNoFollowDirectoryChain(
      paths.journalRoot,
      'Dependency transition rollover journal root'
    ).target;
    const rolloversRoot = inspectNoFollowDirectoryChain(
      paths.rolloversRoot,
      'Dependency transition rollover namespace'
    ).target;
    if (paths.backupRoot !== backupRoot.path || paths.journalRoot !== journalRoot.path ||
        paths.rolloversRoot !== rolloversRoot.path) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover namespace path normalization changed');
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

async function readNoFollowDirectNames(
  directory: PhysicalDirectoryIdentity,
  label: string,
  maximumEntries: number,
  options: RuntimeDependencyOperationOptions
): Promise<readonly string[]> {
  runtimeDependencyOperationRemainingMs(options, `${label} admission`);
  const before = assertSameNoFollowDirectoryIdentity(directory, `${label} before read`).target;
  const names = await fs.readdir(before.path, 'utf8');
  runtimeDependencyOperationRemainingMs(options, `${label} readback`);
  if (names.length > maximumEntries) {
    throw new SecError('RUNTIME-DEPS-004', `${label} entry capacity exceeded`, {
      maximumEntries,
      observedEntries: names.length
    });
  }
  const after = assertSameNoFollowDirectoryIdentity(directory, `${label} after read`).target;
  if (!sameGeneratedStateIdentity(
    generatedStatePhysicalIdentity(before),
    generatedStatePhysicalIdentity(after)
  )) {
    throw new SecError('RUNTIME-DEPS-004', `${label} identity changed during direct read`);
  }
  return Object.freeze(names.sort(compareCodeUnits));
}

function dependencyTransitionLedgerDigest(
  records: ReadonlyMap<`sha256:${string}`, Readonly<{ recordDigest: `sha256:${string}` }>>
): `sha256:${string}` {
  // Each immutable record digest already binds its canonical bytes.  The
  // ordered digest set therefore forms a compact, content-addressed ledger
  // receipt without rereading every record when a rollover phase advances.
  return generatedStateDigest(Object.freeze({
    schema: 'sec-dependency-transition-ledger-v1',
    recordDigests: Object.freeze([...records.keys()].sort(compareCodeUnits))
  }));
}

function inspectOptionalNoFollowDirectoryChild(
  parent: PhysicalDirectoryIdentity,
  name: string,
  label: string
): PhysicalDirectoryIdentity | null {
  try {
    return inspectNoFollowDirectoryChild(parent, name, label);
  } catch (error) {
    if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') return null;
    throw error;
  }
}

function makeDependencyTransitionRolloverIntent(input: Readonly<{
  readonly namespace: DependencyTransitionNamespace;
  readonly terminal: DependencyTransitionJournal;
  readonly previousIntentDigest: `sha256:${string}` | null;
  readonly sequence: number;
  readonly ledgerDigest: `sha256:${string}`;
  readonly recordCount: number;
  readonly checkpoint: DependencyTransitionJournal;
  readonly nextRecordsPhysical: Readonly<GeneratedStatePhysicalIdentity> | null;
}>): DependencyTransitionRolloverIntent {
  if (input.namespace.rolloversRoot === null) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover namespace is unavailable');
  }
  const stem = rolloverResidueStem({
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
    ownerRootPhysical: generatedStatePhysicalIdentity(input.namespace.ownerRoot),
    recordsRootPath: input.namespace.recordsRoot.path,
    sourceRecordsRootPhysical: generatedStatePhysicalIdentity(input.namespace.recordsRoot),
    retiredRecordsPath,
    nextRecordsPath,
    terminalRecordDigest: input.terminal.recordDigest,
    ledgerDigest: input.ledgerDigest,
    recordCount: input.recordCount,
    checkpoint: input.checkpoint
  });
  const intentDigest = rolloverIntentStableDigest(stableInput);
  return Object.freeze({
    schema: DEPENDENCY_TRANSITION_ROLLOVER_SCHEMA,
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

function advanceDependencyTransitionRolloverIntent(
  previous: DependencyTransitionRolloverIntent,
  phase: DependencyTransitionRolloverPhase,
  patch: Readonly<Partial<Pick<DependencyTransitionRolloverIntent,
    'retiredRecordsPhysical' | 'retiredRecordsDisposed' | 'nextRecordsPhysical' |
    'publishedRecordsRootPhysical'>>>
): DependencyTransitionRolloverIntent {
  const next = Object.freeze({ ...previous, phase, ...patch });
  if (rolloverIntentStableDigest(next) !== previous.intentDigest) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover identity changed between phases');
  }
  return next;
}

async function assertDependencyTransitionRolloverCheckpoint(
  recordsRoot: PhysicalDirectoryIdentity,
  intent: DependencyTransitionRolloverIntent,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  const expectedName = transitionRecordName(intent.checkpoint.recordDigest);
  const names = await readNoFollowDirectNames(
    recordsRoot,
    'Dependency transition rollover checkpoint records',
    2,
    options
  );
  if (names.length !== 1 || names[0] !== expectedName) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover checkpoint directory contains unknown residue', {
      expectedName,
      names
    });
  }
  const entry = inspectNoFollowOrdinaryFileEntry(recordsRoot, expectedName);
  if (entry === null || entry.bytes === null) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover checkpoint disappeared');
  }
  const checkpoint = parseDependencyTransitionRecord(entry.bytes, expectedName);
  if (checkpoint.recordDigest !== intent.checkpoint.recordDigest ||
      !Buffer.from(entry.bytes).equals(dependencyTransitionRecordBytes(intent.checkpoint))) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover checkpoint bytes differ');
  }
}

function assertDependencyTransitionRolloverCheckpointDerived(
  intent: DependencyTransitionRolloverIntent,
  terminal: DependencyTransitionJournal
): void {
  const expected = dependencyTransitionTerminalCheckpoint(terminal, intent.ledgerDigest);
  if (!Buffer.from(dependencyTransitionRecordBytes(expected)).equals(
    dependencyTransitionRecordBytes(intent.checkpoint)
  )) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover checkpoint is not derived from its authenticated terminal ledger tip');
  }
}

function assertDependencyTransitionRolloverOwner(
  namespace: DependencyTransitionRolloverNamespace,
  intent: DependencyTransitionRolloverIntent
): void {
  if (intent.ownerRoot !== namespace.ownerRoot.path ||
      intent.recordsRootPath !== namespace.recordsRootPath ||
      !sameGeneratedStateIdentity(
        generatedStatePhysicalIdentity(namespace.ownerRoot),
        intent.ownerRootPhysical
      )) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover intent belongs to a foreign owner root');
  }
}

function assertDependencyTransitionRolloverDirectory(
  actual: PhysicalDirectoryIdentity | null,
  expected: Readonly<GeneratedStatePhysicalIdentity> | null,
  label: string
): PhysicalDirectoryIdentity {
  if (actual === null || expected === null ||
      !sameGeneratedStateIdentity(generatedStatePhysicalIdentity(actual), expected)) {
    throw new SecError('RUNTIME-DEPS-004', `${label} is absent or has a foreign physical identity`, {
      expected,
      actual: actual === null ? null : generatedStatePhysicalIdentity(actual)
    });
  }
  return actual;
}

function assertDependencyTransitionTerminalRolloverReady(
  terminal: DependencyTransitionJournal,
  namespace: DependencyTransitionNamespace
): void {
  if (terminal.phase !== 'complete' && terminal.phase !== 'rolled-back') {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition ledger reached capacity before a terminal receipt');
  }
  if (terminal.stage !== null && terminal.stage.kind !== 'absent' ||
      terminal.stageRoot !== null && terminal.stageRoot.kind !== 'absent' ||
      terminal.backup !== null && terminal.backup.kind !== 'absent') {
    throw new SecError('RUNTIME-DEPS-004', 'Terminal dependency transition retains an unknown stage or backup residue');
  }
  if (terminal.destination.kind !== 'absent' && terminal.destination.physical === null) {
    throw new SecError('RUNTIME-DEPS-004', 'Terminal dependency transition destination has no physical identity');
  }
  if (terminal.ownerRoot !== namespace.ownerRoot.path ||
      !sameGeneratedStateIdentity(terminal.ownerRootPhysical, generatedStatePhysicalIdentity(namespace.ownerRoot))) {
    throw new SecError('RUNTIME-DEPS-004', 'Terminal dependency transition owner identity changed');
  }
}

type DependencyTransitionRolloverArchiveEntry = Readonly<{
  readonly relativePath: string;
  readonly device: string;
  readonly inode: string;
  readonly recordDigest: `sha256:${string}`;
  readonly bytesDigest: `sha256:${string}`;
}>;

const DEPENDENCY_TRANSITION_ROLLOVER_DISPOSAL_INVENTORY_SCHEMA =
  'sec-dependency-transition-rollover-disposal-inventory-v1' as const;
const DEPENDENCY_TRANSITION_ROLLOVER_DISPOSAL_INVENTORY_KEYS = Object.freeze([
  'archivePhysical', 'entries', 'intentDigest', 'inventoryDigest', 'ledgerDigest',
  'recordCount', 'schema'
]);
const DEPENDENCY_TRANSITION_ROLLOVER_DISPOSAL_INVENTORY_ENTRY_KEYS = Object.freeze([
  'bytesDigest', 'device', 'inode', 'recordDigest', 'relativePath'
]);

interface DependencyTransitionRolloverDisposalInventory {
  readonly schema: typeof DEPENDENCY_TRANSITION_ROLLOVER_DISPOSAL_INVENTORY_SCHEMA;
  readonly inventoryDigest: `sha256:${string}`;
  readonly intentDigest: `sha256:${string}`;
  readonly archivePhysical: Readonly<GeneratedStatePhysicalIdentity>;
  readonly ledgerDigest: `sha256:${string}`;
  readonly recordCount: number;
  readonly entries: readonly DependencyTransitionRolloverArchiveEntry[];
}

function rolloverDisposalInventoryName(
  intent: DependencyTransitionRolloverIntent
): string {
  return `disposal-inventory-${intent.intentDigest.slice('sha256:'.length)}.json`;
}

function rolloverDisposalInventoryBytesDigest(bytes: Uint8Array): `sha256:${string}` {
  return generatedStateDigest(Object.freeze({
    encoding: 'base64',
    bytes: Buffer.from(bytes).toString('base64')
  }));
}

function rolloverDisposalInventoryStableDigest(
  inventory: Omit<DependencyTransitionRolloverDisposalInventory, 'inventoryDigest'>
): `sha256:${string}` {
  return generatedStateDigest(Object.freeze({
    schema: inventory.schema,
    intentDigest: inventory.intentDigest,
    archivePhysical: inventory.archivePhysical,
    ledgerDigest: inventory.ledgerDigest,
    recordCount: inventory.recordCount,
    entries: inventory.entries
  }));
}

function parseDependencyTransitionRolloverDisposalInventory(
  bytes: Uint8Array,
  expectedName: string,
  intent: DependencyTransitionRolloverIntent,
  archivePhysical: Readonly<GeneratedStatePhysicalIdentity>
): DependencyTransitionRolloverDisposalInventory {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch (error) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory is not JSON', {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  if (!hasExactObjectKeys(value, DEPENDENCY_TRANSITION_ROLLOVER_DISPOSAL_INVENTORY_KEYS)) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory has noncanonical keys');
  }
  const inventory = value as unknown as DependencyTransitionRolloverDisposalInventory;
  if (inventory.schema !== DEPENDENCY_TRANSITION_ROLLOVER_DISPOSAL_INVENTORY_SCHEMA ||
      !isSha256Digest(inventory.inventoryDigest) ||
      !isSha256Digest(inventory.intentDigest) ||
      !isCanonicalGeneratedStatePhysicalIdentity(inventory.archivePhysical) ||
      !isSha256Digest(inventory.ledgerDigest) ||
      !Number.isSafeInteger(inventory.recordCount) || inventory.recordCount < 1 ||
      inventory.recordCount > DEPENDENCY_TRANSITION_RECORD_CAPACITY ||
      !Array.isArray(inventory.entries) || inventory.entries.length !== inventory.recordCount ||
      inventory.entries.some((entry) => !hasExactObjectKeys(entry, DEPENDENCY_TRANSITION_ROLLOVER_DISPOSAL_INVENTORY_ENTRY_KEYS) ||
        typeof entry.relativePath !== 'string' || !/^record-[0-9a-f]{64}\.json$/u.test(entry.relativePath) ||
        typeof entry.device !== 'string' || entry.device.length === 0 ||
        typeof entry.inode !== 'string' || entry.inode.length === 0 ||
        !isSha256Digest(entry.recordDigest) || !isSha256Digest(entry.bytesDigest))) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory fields are invalid');
  }
  const entries = [...inventory.entries].sort((left, right) => compareCodeUnits(left.relativePath, right.relativePath));
  if (entries.some((entry, index) => entry !== inventory.entries[index])) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory entries are not canonicalized');
  }
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index - 1]!.relativePath === entries[index]!.relativePath) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory contains duplicate record names');
    }
  }
  if (inventory.intentDigest !== intent.intentDigest ||
      !sameGeneratedStateIdentity(inventory.archivePhysical, archivePhysical) ||
      inventory.recordCount !== intent.recordCount || inventory.ledgerDigest !== intent.ledgerDigest ||
      rolloverDisposalInventoryStableDigest(inventory) !== inventory.inventoryDigest ||
      expectedName !== rolloverDisposalInventoryName(intent) ||
      formatJsonFile(canonicalJson(inventory)) !== Buffer.from(bytes).toString('utf8')) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory binding is invalid');
  }
  return Object.freeze({ ...inventory, entries: Object.freeze(entries) });
}

async function inspectDependencyTransitionRolloverArchive(
  archive: PhysicalDirectoryIdentity,
  intent: DependencyTransitionRolloverIntent,
  options: RuntimeDependencyOperationOptions
): Promise<readonly DependencyTransitionRolloverArchiveEntry[]> {
  const names = await readNoFollowDirectNames(
    archive,
    'Dependency transition retired records archive',
    intent.recordCount + 2,
    options
  );
  const records = new Map<`sha256:${string}`, DependencyTransitionJournal>();
  const entries: DependencyTransitionRolloverArchiveEntry[] = [];
  const inventoryName = rolloverDisposalInventoryName(intent);
  let inventory: DependencyTransitionRolloverDisposalInventory | null = null;
  for (const name of names) {
    if (name === inventoryName) {
      const inventoryEntry = inspectNoFollowOrdinaryFileEntry(archive, name);
      if (inventoryEntry === null || inventoryEntry.bytes === null || inventoryEntry.kind !== 'file') {
        throw new SecError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory disappeared or is not an ordinary file');
      }
      if (inventory !== null) {
        throw new SecError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory is duplicated');
      }
      inventory = parseDependencyTransitionRolloverDisposalInventory(
        inventoryEntry.bytes,
        name,
        intent,
        generatedStatePhysicalIdentity(archive)
      );
      continue;
    }
    if (!/^record-[0-9a-f]{64}\.json$/u.test(name)) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition retired records contain unknown residue', { name });
    }
    const entry = inspectNoFollowOrdinaryFileEntry(archive, name);
    if (entry === null || entry.bytes === null || entry.kind !== 'file') {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition retired record disappeared or is not an ordinary file', { name });
    }
    const record = parseDependencyTransitionRecord(entry.bytes, name);
    if (records.has(record.recordDigest)) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition retired records contain a duplicate digest', { name });
    }
    records.set(record.recordDigest, record);
    entries.push(Object.freeze({
      relativePath: name,
      device: entry.device,
      inode: entry.inode,
      recordDigest: record.recordDigest,
      bytesDigest: rolloverDisposalInventoryBytesDigest(entry.bytes)
    }));
  }
  if (records.size !== intent.recordCount ||
      dependencyTransitionLedgerDigest(records) !== intent.ledgerDigest ||
      !records.has(intent.terminalRecordDigest)) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition retired records ledger digest differs and is preserved', {
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
    throw new SecError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory does not match its untouched archive');
  }
  return Object.freeze(entries.sort((left, right) => compareCodeUnits(left.relativePath, right.relativePath)));
}

async function ensureDependencyTransitionRolloverDisposalInventory(
  archive: PhysicalDirectoryIdentity,
  intent: DependencyTransitionRolloverIntent,
  options: RuntimeDependencyOperationOptions
): Promise<DependencyTransitionRolloverDisposalInventory> {
  const inventoryName = rolloverDisposalInventoryName(intent);
  const existing = inspectNoFollowOrdinaryFileEntry(archive, inventoryName);
  if (existing !== null) {
    if (existing.bytes === null || existing.kind !== 'file') {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory is foreign and preserved');
    }
    const inventory = parseDependencyTransitionRolloverDisposalInventory(
      existing.bytes,
      inventoryName,
      intent,
      generatedStatePhysicalIdentity(archive)
    );
    // A crash may have removed any prefix of the inventoried records before
    // the disposal receipt advanced.  The immutable inventory is the
    // closed-world authority for that effect: validate only the exact
    // remaining subset, preserving missing entries as already-disposed
    // evidence.  Requiring the full archive here would make a crash after the
    // first leaf permanently unrecoverable.
    await assertDependencyTransitionRolloverArchiveSubset(archive, inventory, inventoryName, options);
    return inventory;
  }
  const entries = await inspectDependencyTransitionRolloverArchive(archive, intent, options);
  const inventoryUnsigned: Omit<DependencyTransitionRolloverDisposalInventory, 'inventoryDigest'> = Object.freeze({
    schema: DEPENDENCY_TRANSITION_ROLLOVER_DISPOSAL_INVENTORY_SCHEMA,
    intentDigest: intent.intentDigest,
    archivePhysical: generatedStatePhysicalIdentity(archive),
    ledgerDigest: intent.ledgerDigest,
    recordCount: intent.recordCount,
    entries
  });
  const inventory = Object.freeze({
    ...inventoryUnsigned,
    inventoryDigest: rolloverDisposalInventoryStableDigest(inventoryUnsigned)
  });
  const bytes = Buffer.from(formatJsonFile(canonicalJson(inventory)), 'utf8');
  await runtimeDependencyOperationEffectFence(options, 'Dependency rollover disposal inventory publication');
  writeDurableTransitionFile(
    archive,
    inventoryName,
    bytes,
    (candidate) => parseDependencyTransitionRolloverDisposalInventory(
      candidate,
      inventoryName,
      intent,
      generatedStatePhysicalIdentity(archive)
    ),
    true
  );
  const readback = inspectNoFollowOrdinaryFileEntry(archive, inventoryName);
  if (readback === null || readback.bytes === null) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory disappeared after publication');
  }
  return parseDependencyTransitionRolloverDisposalInventory(
    readback.bytes,
    inventoryName,
    intent,
    generatedStatePhysicalIdentity(archive)
  );
}

async function assertDependencyTransitionRolloverArchiveSubset(
  archive: PhysicalDirectoryIdentity,
  inventory: DependencyTransitionRolloverDisposalInventory,
  inventoryName: string,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  const names = await readNoFollowDirectNames(
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
      throw new SecError(
        'RUNTIME-DEPS-004',
        'Dependency transition retired records contain foreign residue outside the disposal inventory',
        { name }
      );
    }
    const entry = inspectNoFollowOrdinaryFileEntry(archive, name);
    if (entry === null || entry.kind !== 'file' || entry.bytes === null ||
        entry.device !== expected.device || entry.inode !== expected.inode ||
        rolloverDisposalInventoryBytesDigest(entry.bytes) !== expected.bytesDigest) {
      throw new SecError(
        'RUNTIME-DEPS-004',
        'Dependency transition retired record changed after disposal inventory publication',
        { name }
      );
    }
    const record = parseDependencyTransitionRecord(entry.bytes, name);
    if (record.recordDigest !== expected.recordDigest) {
      throw new SecError(
        'RUNTIME-DEPS-004',
        'Dependency transition retired record digest differs from disposal inventory',
        { name }
      );
    }
  }
}

async function disposeDependencyTransitionRolloverArchive(
  namespace: DependencyTransitionRolloverNamespace,
  intent: DependencyTransitionRolloverIntent,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  const archiveName = path.basename(intent.retiredRecordsPath);
  const archive = inspectOptionalNoFollowDirectoryChild(
    namespace.rolloversRoot,
    archiveName,
    'Dependency transition retired records archive'
  );
  if (archive === null) return;
  if (intent.retiredRecordsPhysical === null ||
      !sameGeneratedStateIdentity(generatedStatePhysicalIdentity(archive), intent.retiredRecordsPhysical)) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition retired records archive identity changed and is preserved');
  }
  const inventoryName = rolloverDisposalInventoryName(intent);
  const inventoryEntry = inspectNoFollowOrdinaryFileEntry(archive, inventoryName);
  if (inventoryEntry === null || inventoryEntry.bytes === null || inventoryEntry.kind !== 'file') {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory is absent; archive is preserved');
  }
  const inventory = parseDependencyTransitionRolloverDisposalInventory(
    inventoryEntry.bytes,
    inventoryName,
    intent,
    generatedStatePhysicalIdentity(archive)
  );
  const names = await readNoFollowDirectNames(
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
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition retired records contain foreign residue during disposal', { name });
    }
    const entry = inspectNoFollowOrdinaryFileEntry(archive, name);
    if (entry === null || entry.bytes === null || entry.kind !== 'file' ||
        entry.device !== expected.device || entry.inode !== expected.inode ||
        rolloverDisposalInventoryBytesDigest(entry.bytes) !== expected.bytesDigest) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition retired record changed after disposal inventory publication', { name });
    }
    await runtimeDependencyOperationEffectFence(options, 'Dependency transition retired record disposal');
    deleteRetainedNoFollowEntry({
      root: archive,
      relativePath: name,
      kind: 'file',
      device: expected.device,
      inode: expected.inode,
      ancestorDirectories: Object.freeze([])
    });
  }
  const remainingNames = await readNoFollowDirectNames(
    archive,
    'Dependency transition retired records archive disposal readback',
    intent.recordCount + 2,
    options
  );
  if (remainingNames.length !== 1 || remainingNames[0] !== inventoryName) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition retired archive contains unexpected residue after record disposal', {
      remainingNames
    });
  }
  const inventoryAfter = inspectNoFollowOrdinaryFileEntry(archive, inventoryName);
  if (inventoryAfter === null || inventoryAfter.bytes === null || inventoryAfter.kind !== 'file' ||
      !Buffer.from(inventoryAfter.bytes).equals(Buffer.from(inventoryEntry.bytes))) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency rollover disposal inventory changed before archive retirement');
  }
  await runtimeDependencyOperationEffectFence(options, 'Dependency transition rollover inventory disposal');
  deleteRetainedNoFollowEntry({
    root: archive,
    relativePath: inventoryName,
    kind: 'file',
    device: inventoryEntry.device,
    inode: inventoryEntry.inode,
    ancestorDirectories: Object.freeze([])
  });
  const archiveAfter = inspectOptionalNoFollowDirectoryChild(
    namespace.rolloversRoot,
    archiveName,
    'Dependency transition retired records archive after descendant disposal'
  );
  if (archiveAfter === null || !sameGeneratedStateIdentity(
    generatedStatePhysicalIdentity(archiveAfter),
    intent.retiredRecordsPhysical
  )) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition retired records archive disappeared before root disposal');
  }
  await runtimeDependencyOperationEffectFence(options, 'Dependency transition rollover archive disposal');
  deleteRetainedNoFollowEntry({
    root: namespace.rolloversRoot,
    relativePath: archiveName,
    kind: 'directory',
    device: intent.retiredRecordsPhysical.device,
    inode: intent.retiredRecordsPhysical.inode,
    ancestorDirectories: Object.freeze([])
  });
  if (inspectOptionalNoFollowDirectoryChild(
    namespace.rolloversRoot,
    archiveName,
    'Dependency transition retired records archive final readback'
  ) !== null) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition retired records archive remains after disposal');
  }
}

async function assertDependencyTransitionTerminalReadback(
  terminal: DependencyTransitionJournal,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition terminal readback admission');
  const destination = await observeDependencyTransitionSlot(
    terminal.destination.path,
    terminal.destination.bindingDigest
  );
  if (!transitionSlotMatches(destination, terminal.destination)) {
    throw new SecError('RUNTIME-DEPS-004', 'Terminal dependency transition destination or binding readback drifted');
  }
  const source = await observeDependencyTransitionSlot(terminal.sourceGeneration.sourcePath);
  if (source.kind !== 'directory' || source.physical === null ||
      !sameGeneratedStateIdentity(source.physical, terminal.sourceGeneration.physical)) {
    throw new SecError('RUNTIME-DEPS-004', 'Terminal dependency transition source generation readback drifted');
  }
}

async function writeDependencyTransitionRolloverIntentPhase(
  namespace: DependencyTransitionRolloverNamespace,
  intent: DependencyTransitionRolloverIntent,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  await runtimeDependencyOperationEffectFence(options, `Dependency transition rollover ${intent.phase} receipt publication`);
  const bytes = Buffer.from(formatJsonFile(canonicalJson(intent)), 'utf8');
  writeDurableTransitionFile(
    namespace.rolloversRoot,
    rolloverIntentFileName(intent.intentDigest, intent.phase),
    bytes,
    assertDependencyTransitionRolloverIntentBytes,
    true
  );
  runtimeDependencyOperationRemainingMs(options, `Dependency transition rollover ${intent.phase} receipt readback`);
}

type DependencyTransitionRolloverObservation = Readonly<{
  namespace: DependencyTransitionRolloverNamespace;
  active: DependencyTransitionRolloverIntent | null;
  latestComplete: DependencyTransitionRolloverIntent | null;
}>;

const DEPENDENCY_TRANSITION_ROLLOVER_PHASE_ORDER: Readonly<Record<DependencyTransitionRolloverPhase, number>> =
  Object.freeze({
    prepared: 0,
    staged: 1,
    'backed-up': 2,
    published: 3,
    retiring: 4,
    retired: 5,
    complete: 6
  });

async function inspectActiveDependencyTransitionRollover(
  ownerRoot: string,
  options: RuntimeDependencyOperationOptions
): Promise<DependencyTransitionRolloverObservation | null> {
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition rollover census admission');
  const namespace = inspectDependencyTransitionRolloverNamespace(ownerRoot);
  if (namespace === null) return null;
  const names = await readNoFollowDirectNames(
    namespace.rolloversRoot,
    'Dependency transition rollover namespace',
    DEPENDENCY_TRANSITION_ROLLOVER_NAMESPACE_CAPACITY,
    options
  );
  const phasePattern = /^rollover-[0-9a-f]{64}-(prepared|staged|backed-up|published|retiring|retired|complete)\.json$/u;
  const residuePattern = /^records-(?:retired|next)-[0-9a-f]{48}$/u;
  const grouped = new Map<string, Map<DependencyTransitionRolloverPhase, DependencyTransitionRolloverIntent>>();
  const referencedResidue = new Set<string>();
  for (const name of names) {
    if (residuePattern.test(name)) {
      referencedResidue.add(name);
      continue;
    }
    if (!phasePattern.test(name)) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover namespace contains unknown residue', {
        name
      });
    }
    const entry = inspectNoFollowOrdinaryFileEntry(namespace.rolloversRoot, name);
    if (entry === null || entry.bytes === null) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover intent disappeared during census', { name });
    }
    const intent = parseDependencyTransitionRolloverIntent(entry.bytes, name);
    if (intent.ownerRoot !== namespace.ownerRoot.path || intent.recordsRootPath !== namespace.recordsRootPath) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover intent belongs to a foreign topology', { name });
    }
    const phases = grouped.get(intent.intentDigest) ?? new Map<DependencyTransitionRolloverPhase, DependencyTransitionRolloverIntent>();
    if (phases.has(intent.phase)) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover phase is duplicated', {
        intentDigest: intent.intentDigest,
        phase: intent.phase
      });
    }
    phases.set(intent.phase, intent);
    grouped.set(intent.intentDigest, phases);
  }

  let active: DependencyTransitionRolloverIntent | null = null;
  const latestIntents: DependencyTransitionRolloverIntent[] = [];
  const referencedNames = new Set<string>();
  for (const phases of grouped.values()) {
    const ordered = [...phases.values()].sort((left, right) =>
      DEPENDENCY_TRANSITION_ROLLOVER_PHASE_ORDER[left.phase] -
      DEPENDENCY_TRANSITION_ROLLOVER_PHASE_ORDER[right.phase]
    );
    if (ordered[0]?.phase !== 'prepared') {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover chain has no prepared phase');
    }
    for (let index = 0; index < ordered.length; index += 1) {
      if (DEPENDENCY_TRANSITION_ROLLOVER_PHASE_ORDER[ordered[index]!.phase] !== index) {
        throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover chain skips a phase');
      }
      if (index > 0 && ordered[index]!.intentDigest !== ordered[index - 1]!.intentDigest) {
        throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover chain changed intent identity');
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
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover residue is foreign and preserved', { name });
    }
  }
  if (latestIntents.length === 0) {
    return Object.freeze({ namespace, active: null, latestComplete: null });
  }
  const intentByDigest = new Map(latestIntents.map((intent) => [intent.intentDigest, intent]));
  const childByPredecessor = new Map<`sha256:${string}`, `sha256:${string}`>();
  const roots: DependencyTransitionRolloverIntent[] = [];
  for (const intent of latestIntents) {
    if (intent.previousIntentDigest === null) {
      if (intent.sequence !== 1) {
        throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover root sequence is not one');
      }
      roots.push(intent);
      continue;
    }
    const predecessor = intentByDigest.get(intent.previousIntentDigest);
    if (predecessor === undefined || predecessor.sequence !== intent.sequence - 1) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover predecessor is missing or has an invalid sequence');
    }
    const existingChild = childByPredecessor.get(intent.previousIntentDigest);
    if (existingChild !== undefined && existingChild !== intent.intentDigest) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover predecessor has a forked child');
    }
    childByPredecessor.set(intent.previousIntentDigest, intent.intentDigest);
  }
  if (roots.length !== 1) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover receipts contain multiple roots');
  }
  const visited = new Set<`sha256:${string}`>();
  let cursor: DependencyTransitionRolloverIntent | undefined = roots[0];
  while (cursor !== undefined) {
    if (visited.has(cursor.intentDigest)) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover receipts contain a cycle');
    }
    visited.add(cursor.intentDigest);
    const childDigest = childByPredecessor.get(cursor.intentDigest);
    cursor = childDigest === undefined ? undefined : intentByDigest.get(childDigest);
    if (childDigest !== undefined && cursor === undefined) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover child disappeared during census');
    }
  }
  if (visited.size !== latestIntents.length) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover receipts contain a disconnected epoch');
  }
  const tips = latestIntents.filter((intent) => !childByPredecessor.has(intent.intentDigest));
  if (tips.length !== 1) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover receipts do not have one maximal tip');
  }
  const tip = tips[0]!;
  if (tip.phase !== 'complete') {
    active = tip;
  }
  for (const intent of latestIntents) {
    if (intent.phase !== 'complete' && intent.intentDigest !== tip.intentDigest) {
      throw new SecError('RUNTIME-DEPS-004', 'Multiple incomplete dependency transition rollovers require owner recovery');
    }
  }
  const completeIntents = latestIntents.filter((intent) => intent.phase === 'complete');
  let latestComplete: DependencyTransitionRolloverIntent | null = null;
  for (const intent of completeIntents) {
    if (latestComplete !== null && latestComplete.sequence === intent.sequence) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover complete receipts fork at one sequence');
    }
    if (latestComplete === null || intent.sequence > latestComplete.sequence) latestComplete = intent;
  }
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition rollover census readback');
  return Object.freeze({ namespace, active, latestComplete });
}

async function recoverDependencyTransitionRollover(
  ownerRoot: string,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition rollover recovery admission');
  const observation = await inspectActiveDependencyTransitionRollover(ownerRoot, options);
  if (observation === null || observation.active === null) return;
  const { namespace } = observation;
  let intent = observation.active;
  assertDependencyTransitionRolloverOwner(namespace, intent);
  const journalRoot = assertSameNoFollowDirectoryIdentity(
    namespace.journalRoot,
    'Dependency transition rollover journal root recovery'
  ).target;
  const rolloversRoot = assertSameNoFollowDirectoryIdentity(
    namespace.rolloversRoot,
    'Dependency transition rollover namespace recovery'
  ).target;
  if (!sameGeneratedStateIdentity(
    generatedStatePhysicalIdentity(journalRoot),
    generatedStatePhysicalIdentity(namespace.journalRoot)
  ) || !sameGeneratedStateIdentity(
    generatedStatePhysicalIdentity(rolloversRoot),
    generatedStatePhysicalIdentity(namespace.rolloversRoot)
  )) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover namespace identity changed before recovery');
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
    const source = inspectOptionalNoFollowDirectoryChild(
      journalRoot,
      path.basename(namespace.recordsRootPath),
      'Dependency transition rollover prepared source records'
    );
    const retainedSource = assertDependencyTransitionRolloverDirectory(
      source,
      sourceRecordsPhysical,
      'Dependency transition rollover prepared source records'
    );
    const sourceLedger = readDependencyTransitionRecordSet(
      retainedSource,
      namespace.ownerRoot.path,
      runtimeDependencyOperationContext(options),
      'Dependency transition rollover prepared source ledger'
    );
    assertDependencyTransitionRolloverLedgerBinding(
      sourceLedger,
      intent,
      'Dependency transition rollover prepared source ledger'
    );
  }

  if (intent.phase === 'prepared') {
    let next = inspectOptionalNoFollowDirectoryChild(
      rolloversRoot,
      nextName,
      'Dependency transition rollover next records'
    );
    if (next !== null) {
      const names = await readNoFollowDirectNames(
        next,
        'Dependency transition rollover next records pre-staged contents',
        2,
        options
      );
      const expectedCheckpointName = transitionRecordName(intent.checkpoint.recordDigest);
      if (names.length > 1 || names.length === 1 && names[0] !== expectedCheckpointName) {
        throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover next records contain unknown pre-staged residue');
      }
    }
    if (expectedNextPhysical !== null) {
      throw new SecError('RUNTIME-DEPS-004', 'Prepared dependency transition rollover unexpectedly contains a next-root identity');
    }
    if (next === null) {
      await runtimeDependencyOperationEffectFence(options, 'Dependency transition rollover recovery next-root creation');
    }
    const stagedNext = next ?? createExclusiveNoFollowDirectory(rolloversRoot, nextName);
    const staged = advanceDependencyTransitionRolloverIntent(intent, 'staged', {
      retiredRecordsPhysical: null,
      retiredRecordsDisposed: false,
      nextRecordsPhysical: generatedStatePhysicalIdentity(stagedNext),
      publishedRecordsRootPhysical: null
    });
    await writeDependencyTransitionRolloverIntentPhase(namespace, staged, options);
    intent = staged;
  }

  if (intent.phase === 'staged') {
    const next = assertDependencyTransitionRolloverDirectory(
      inspectOptionalNoFollowDirectoryChild(
        rolloversRoot,
        nextName,
        'Dependency transition rollover next records'
      ),
      intent.nextRecordsPhysical,
      'Dependency transition rollover next records'
    );
    const checkpointName = transitionRecordName(intent.checkpoint.recordDigest);
    const checkpointEntry = inspectNoFollowOrdinaryFileEntry(next, checkpointName);
    if (checkpointEntry === null) {
      await runtimeDependencyOperationEffectFence(options, 'Dependency transition rollover recovery checkpoint publication');
      writeDurableTransitionFile(
        next,
        checkpointName,
        dependencyTransitionRecordBytes(intent.checkpoint),
        assertDependencyTransitionRecordBytes,
        true
      );
    }
    await assertDependencyTransitionRolloverCheckpoint(next, intent, options);
    // Re-read the source/archive immediately before the move.  If a previous
    // process already completed that effect, the operation-owned retired root
    // is the only acceptable evidence; a missing/foreign root is preserved.
    const sourceBeforeMove = inspectOptionalNoFollowDirectoryChild(
      journalRoot,
      path.basename(namespace.recordsRootPath),
      'Dependency transition rollover source records before archive move'
    );
    if (sourceBeforeMove !== null) {
      const retainedSourceBeforeMove = assertDependencyTransitionRolloverDirectory(
        sourceBeforeMove,
        sourceRecordsPhysical,
        'Dependency transition rollover source records before archive move'
      );
      const sourceLedgerBeforeMove = readDependencyTransitionRecordSet(
        retainedSourceBeforeMove,
        namespace.ownerRoot.path,
        runtimeDependencyOperationContext(options),
        'Dependency transition rollover source ledger before archive move'
      );
      assertDependencyTransitionRolloverLedgerBinding(
        sourceLedgerBeforeMove,
        intent,
        'Dependency transition rollover source ledger before archive move'
      );
    }
    const retired = inspectOptionalNoFollowDirectoryChild(
      rolloversRoot,
      retiredName,
      'Dependency transition rollover retired records'
    );
    if (retired === null) {
      const source = sourceBeforeMove;
      const retainedSource = assertDependencyTransitionRolloverDirectory(
        source,
        sourceRecordsPhysical,
        'Dependency transition rollover source records'
      );
      await runtimeDependencyOperationEffectFence(options, 'Dependency transition rollover archive move');
      const moved = relocateRetainedNoFollowDirectoryAcrossParents({
        directory: retainedSource,
        destinationParent: rolloversRoot,
        tombstoneName: retiredName
      });
      if (!sameGeneratedStateIdentity(generatedStatePhysicalIdentity(moved), sourceRecordsPhysical)) {
        throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover retired records identity changed during move');
      }
    } else if (!sameGeneratedStateIdentity(
      generatedStatePhysicalIdentity(retired),
      sourceRecordsPhysical
    )) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover retired records are foreign and preserved');
    }
    if (retired !== null) {
      const archivedLedger = readDependencyTransitionRecordSet(
        retired,
        namespace.ownerRoot.path,
        runtimeDependencyOperationContext(options),
        'Dependency transition rollover retired ledger'
      );
      assertDependencyTransitionRolloverLedgerBinding(
        archivedLedger,
        intent,
        'Dependency transition rollover retired ledger'
      );
    }
    const sourceAfter = inspectOptionalNoFollowDirectoryChild(
      journalRoot,
      path.basename(namespace.recordsRootPath),
      'Dependency transition rollover source records readback'
    );
    if (sourceAfter !== null) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover source records remain after archive move');
    }
    const retiredAfter = inspectOptionalNoFollowDirectoryChild(
      rolloversRoot,
      retiredName,
      'Dependency transition rollover retired records readback'
    );
    const nextAfter = inspectOptionalNoFollowDirectoryChild(
      rolloversRoot,
      nextName,
      'Dependency transition rollover next records readback'
    );
    const updated = advanceDependencyTransitionRolloverIntent(intent, 'backed-up', {
      retiredRecordsPhysical: retiredAfter === null
        ? null
        : generatedStatePhysicalIdentity(retiredAfter),
      retiredRecordsDisposed: false,
      nextRecordsPhysical: nextAfter === null
        ? null
        : generatedStatePhysicalIdentity(nextAfter),
      publishedRecordsRootPhysical: null
    });
    if (updated.retiredRecordsPhysical === null || updated.nextRecordsPhysical === null) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover archive readback is incomplete');
    }
    await writeDependencyTransitionRolloverIntentPhase(namespace, updated, options);
    intent = updated;
  }

  if (intent.phase === 'backed-up') {
    const retired = inspectOptionalNoFollowDirectoryChild(
      rolloversRoot,
      retiredName,
      'Dependency transition rollover retired records'
    );
    assertDependencyTransitionRolloverDirectory(
      retired,
      intent.retiredRecordsPhysical,
      'Dependency transition rollover retired records'
    );
    const next = inspectOptionalNoFollowDirectoryChild(
      rolloversRoot,
      nextName,
      'Dependency transition rollover next records'
    );
    const canonical = inspectOptionalNoFollowDirectoryChild(
      journalRoot,
      path.basename(namespace.recordsRootPath),
      'Dependency transition rollover canonical records'
    );
    let published: PhysicalDirectoryIdentity;
    if (canonical === null) {
      const retainedNext = assertDependencyTransitionRolloverDirectory(
        next,
        intent.nextRecordsPhysical,
        'Dependency transition rollover next records'
      );
      await assertDependencyTransitionRolloverCheckpoint(retainedNext, intent, options);
      await runtimeDependencyOperationEffectFence(options, 'Dependency transition rollover canonical records publication');
      published = relocateRetainedNoFollowDirectoryAcrossParents({
        directory: retainedNext,
        destinationParent: journalRoot,
        tombstoneName: path.basename(namespace.recordsRootPath)
      });
    } else {
      if (next !== null) {
        throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover has both next and canonical records roots');
      }
      published = assertDependencyTransitionRolloverDirectory(
        canonical,
        intent.nextRecordsPhysical,
        'Dependency transition rollover canonical records'
      );
      await assertDependencyTransitionRolloverCheckpoint(published, intent, options);
    }
    const canonicalAfter = inspectOptionalNoFollowDirectoryChild(
      journalRoot,
      path.basename(namespace.recordsRootPath),
      'Dependency transition rollover canonical records readback'
    );
    if (canonicalAfter === null || !sameGeneratedStateIdentity(
      generatedStatePhysicalIdentity(canonicalAfter),
      generatedStatePhysicalIdentity(published)
    )) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover canonical records identity changed during publish');
    }
    const nextAfter = inspectOptionalNoFollowDirectoryChild(
      rolloversRoot,
      nextName,
      'Dependency transition rollover next records readback'
    );
    if (nextAfter !== null) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover next records remain after publish');
    }
    const updated = advanceDependencyTransitionRolloverIntent(intent, 'published', {
      retiredRecordsPhysical: intent.retiredRecordsPhysical,
      retiredRecordsDisposed: false,
      nextRecordsPhysical: null,
      publishedRecordsRootPhysical: generatedStatePhysicalIdentity(canonicalAfter)
    });
    await writeDependencyTransitionRolloverIntentPhase(namespace, updated, options);
    intent = updated;
  }

  if (intent.phase === 'published') {
    const retired = inspectOptionalNoFollowDirectoryChild(
      rolloversRoot,
      retiredName,
      'Dependency transition rollover retired records'
    );
    assertDependencyTransitionRolloverDirectory(
      retired,
      intent.retiredRecordsPhysical,
      'Dependency transition rollover retired records'
    );
    const canonical = inspectOptionalNoFollowDirectoryChild(
      journalRoot,
      path.basename(namespace.recordsRootPath),
      'Dependency transition rollover canonical records'
    );
    const retainedCanonical = assertDependencyTransitionRolloverDirectory(
      canonical,
      intent.publishedRecordsRootPhysical,
      'Dependency transition rollover canonical records'
    );
    await assertDependencyTransitionRolloverCheckpoint(retainedCanonical, intent, options);
    if (inspectOptionalNoFollowDirectoryChild(
      rolloversRoot,
      nextName,
      'Dependency transition rollover next records final readback'
    ) !== null) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover next records unexpectedly reappeared');
    }
    // Publish/read back a closed-world disposal inventory before touching any
    // archived record.  It binds every expected name, canonical bytes digest,
    // and physical identity, so a crash after any individual delete can resume
    // from the exact remaining subset without broad recursive cleanup.
    await ensureDependencyTransitionRolloverDisposalInventory(retired!, intent, options);
    const updated = advanceDependencyTransitionRolloverIntent(intent, 'retiring', {
      retiredRecordsPhysical: intent.retiredRecordsPhysical,
      retiredRecordsDisposed: false,
      nextRecordsPhysical: null,
      publishedRecordsRootPhysical: intent.publishedRecordsRootPhysical
    });
    await writeDependencyTransitionRolloverIntentPhase(namespace, updated, options);
    intent = updated;
  }

  if (intent.phase === 'retiring') {
    const retired = inspectOptionalNoFollowDirectoryChild(
      rolloversRoot,
      retiredName,
      'Dependency transition retiring records archive'
    );
    if (retired !== null) {
      assertDependencyTransitionRolloverDirectory(
        retired,
        intent.retiredRecordsPhysical,
        'Dependency transition retiring records archive'
      );
      await disposeDependencyTransitionRolloverArchive(namespace, intent, options);
    }
    if (inspectOptionalNoFollowDirectoryChild(
      rolloversRoot,
      retiredName,
      'Dependency transition retired records archive readback'
    ) !== null) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition retired records archive remains after retiring effect');
    }
    const canonical = inspectOptionalNoFollowDirectoryChild(
      journalRoot,
      path.basename(namespace.recordsRootPath),
      'Dependency transition retired canonical records'
    );
    const published = assertDependencyTransitionRolloverDirectory(
      canonical,
      intent.publishedRecordsRootPhysical,
      'Dependency transition retired canonical records'
    );
    await assertDependencyTransitionRolloverCheckpoint(published, intent, options);
    const updated = advanceDependencyTransitionRolloverIntent(intent, 'retired', {
      retiredRecordsPhysical: null,
      retiredRecordsDisposed: true,
      nextRecordsPhysical: null,
      publishedRecordsRootPhysical: intent.publishedRecordsRootPhysical
    });
    await writeDependencyTransitionRolloverIntentPhase(namespace, updated, options);
    intent = updated;
  }

  if (intent.phase === 'retired') {
    if (inspectOptionalNoFollowDirectoryChild(
      rolloversRoot,
      retiredName,
      'Dependency transition retired records final archive readback'
    ) !== null) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition retired records archive reappeared');
    }
    const canonical = inspectOptionalNoFollowDirectoryChild(
      journalRoot,
      path.basename(namespace.recordsRootPath),
      'Dependency transition completed canonical records'
    );
    const published = assertDependencyTransitionRolloverDirectory(
      canonical,
      intent.publishedRecordsRootPhysical,
      'Dependency transition completed canonical records'
    );
    await assertDependencyTransitionRolloverCheckpoint(published, intent, options);
    const updated = advanceDependencyTransitionRolloverIntent(intent, 'complete', {
      retiredRecordsPhysical: null,
      retiredRecordsDisposed: true,
      nextRecordsPhysical: null,
      publishedRecordsRootPhysical: intent.publishedRecordsRootPhysical
    });
    await writeDependencyTransitionRolloverIntentPhase(namespace, updated, options);
  }
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition rollover recovery readback');
}

type DependencyTransitionRecordSet = Readonly<{
  readonly records: ReadonlyMap<`sha256:${string}`, DependencyTransitionJournal>;
  readonly ledgerDigest: `sha256:${string}`;
  readonly tip: DependencyTransitionJournal | null;
}>;

/**
 * Read and validate one immutable records root under one fixed deadline.  This
 * helper is also used by rollover recovery while the old root is still the
 * source of truth; recovery must not call the normal reader because that
 * reader intentionally blocks whenever an active rollover exists.
 */
function readDependencyTransitionRecordSet(
  recordsRoot: PhysicalDirectoryIdentity,
  ownerRoot: string,
  operation: RuntimeDependencyOperationContext,
  label: string
): DependencyTransitionRecordSet {
  const before = assertSameNoFollowDirectoryIdentity(recordsRoot, `${label} before census`).target;
  // Records are bounded canonical control bytes.  Keep one retained
  // no-follow traversal and parse the bytes it already read instead of doing
  // a second path lookup for every record.  The aggregate byte ceiling is
  // part of admission, so a forged large/unknown record cannot turn this
  // optimization into an unbounded read.
  const census = scanNoFollowDirectoryTree(before, {
    deadlineAtMs: operation.deadlineAtMonotonicMs,
    maximumEntries: DEPENDENCY_TRANSITION_RECORD_CAPACITY,
    maximumBytes: DEPENDENCY_TRANSITION_RECORD_BYTES_CAPACITY
  });
  const records = new Map<`sha256:${string}`, DependencyTransitionJournal>();
  for (const entry of census) {
    if (operation.monotonicNowMs() > operation.deadlineAtMonotonicMs) {
      throw new SecError('RUNTIME-DEPS-004', `${label} exceeded its read deadline`, {
        deadlineAtMs: operation.deadlineAtMonotonicMs,
        observedEntries: records.size
      });
    }
    if (entry.kind !== 'file' || !/^record-[0-9a-f]{64}\.json$/u.test(entry.relativePath)) {
      throw new SecError('RUNTIME-DEPS-002', `${label} contains an unknown physical entry`);
    }
    if (entry.bytes === null) {
      throw new SecError('RUNTIME-DEPS-002', `${label} record disappeared during census`);
    }
    const record = parseDependencyTransitionRecord(entry.bytes, entry.relativePath);
    if (record.ownerRoot !== ownerRoot) {
      throw new SecError('RUNTIME-DEPS-002', `${label} record belongs to a foreign owner root`);
    }
    if (records.has(record.recordDigest)) {
      throw new SecError('RUNTIME-DEPS-002', `${label} record digest is duplicated`);
    }
    records.set(record.recordDigest, record);
  }
  if (operation.monotonicNowMs() > operation.deadlineAtMonotonicMs) {
    throw new SecError('RUNTIME-DEPS-004', `${label} exceeded its read deadline after record validation`, {
      deadlineAtMs: operation.deadlineAtMonotonicMs,
      observedEntries: records.size
    });
  }
  const after = assertSameNoFollowDirectoryIdentity(recordsRoot, `${label} after census`).target;
  if (!sameGeneratedStateIdentity(
    generatedStatePhysicalIdentity(before),
    generatedStatePhysicalIdentity(after)
  )) {
    throw new SecError('RUNTIME-DEPS-002', `${label} identity changed during census`);
  }
  if (records.size === 0) {
    return Object.freeze({
      records,
      ledgerDigest: dependencyTransitionLedgerDigest(records),
      tip: null
    });
  }

  // The immutable ledger is a single predecessor chain.  A mutable pointer
  // is never consulted to select either the root or the maximal tip.
  const children = new Map<`sha256:${string}`, `sha256:${string}`>();
  const roots: DependencyTransitionJournal[] = [];
  for (const record of records.values()) {
    if (operation.monotonicNowMs() > operation.deadlineAtMonotonicMs) {
      throw new SecError('RUNTIME-DEPS-004', `${label} exceeded its graph-validation deadline`, {
        deadlineAtMs: operation.deadlineAtMonotonicMs,
        observedEntries: records.size
      });
    }
    if (record.previousRecordDigest === null) {
      if (record.sequence !== 1) {
        throw new SecError('RUNTIME-DEPS-002', `${label} root record sequence is not one`);
      }
      roots.push(record);
      continue;
    }
    const predecessor = records.get(record.previousRecordDigest);
    if (predecessor === undefined || predecessor.sequence !== record.sequence - 1) {
      throw new SecError('RUNTIME-DEPS-002', `${label} predecessor is missing or has an invalid sequence`);
    }
    const previousChild = children.get(record.previousRecordDigest);
    if (previousChild !== undefined && previousChild !== record.recordDigest) {
      throw new SecError('RUNTIME-DEPS-002', `${label} predecessor has a forked child chain`);
    }
    children.set(record.previousRecordDigest, record.recordDigest);
  }
  if (roots.length !== 1) {
    throw new SecError('RUNTIME-DEPS-002', `${label} contains multiple immutable epochs`);
  }
  const visited = new Set<`sha256:${string}`>();
  let cursor: DependencyTransitionJournal | undefined = roots[0];
  while (cursor !== undefined) {
    if (operation.monotonicNowMs() > operation.deadlineAtMonotonicMs) {
      throw new SecError('RUNTIME-DEPS-004', `${label} exceeded its chain-validation deadline`, {
        deadlineAtMs: operation.deadlineAtMonotonicMs,
        observedEntries: records.size
      });
    }
    if (visited.has(cursor.recordDigest)) {
      throw new SecError('RUNTIME-DEPS-002', `${label} chain contains a cycle`);
    }
    visited.add(cursor.recordDigest);
    const childDigest = children.get(cursor.recordDigest);
    cursor = childDigest === undefined ? undefined : records.get(childDigest);
    if (childDigest !== undefined && cursor === undefined) {
      throw new SecError('RUNTIME-DEPS-002', `${label} child disappeared during immutable census`);
    }
  }
  if (visited.size !== records.size) {
    throw new SecError('RUNTIME-DEPS-002', `${label} contains a disconnected or foreign fork`);
  }
  const tips = [...records.values()].filter(({ recordDigest }) => !children.has(recordDigest));
  if (tips.length !== 1) {
    throw new SecError('RUNTIME-DEPS-002', `${label} does not have one maximal immutable tip`);
  }
  if (operation.monotonicNowMs() > operation.deadlineAtMonotonicMs) {
    throw new SecError('RUNTIME-DEPS-004', `${label} exceeded its final read deadline`, {
      deadlineAtMs: operation.deadlineAtMonotonicMs,
      observedEntries: records.size
    });
  }
  return Object.freeze({
    records,
    ledgerDigest: dependencyTransitionLedgerDigest(records),
    tip: tips[0]!
  });
}

type LegacyDependencyTransitionRecordSet = Readonly<{
  records: ReadonlyMap<`sha256:${string}`, LegacyDependencyTransitionJournal>;
  ledgerDigest: `sha256:${string}`;
  recordsRootPhysical: Readonly<GeneratedStatePhysicalIdentity>;
  chains: readonly (readonly LegacyDependencyTransitionJournal[])[];
}>;

/**
 * Validate one legacy records root as a forest of operation-local chains.  The
 * old writer allowed several completed operation chains to share one root;
 * migration canonicalizes that forest into one v2 predecessor chain.  A
 * missing predecessor, duplicate sequence, fork, foreign owner, or digest
 * mismatch is a source-authority failure and therefore happens before any v2
 * namespace effect.
 */
function readLegacyDependencyTransitionRecordSet(
  recordsRoot: PhysicalDirectoryIdentity,
  ownerRoot: string,
  ownerRootPhysical: Readonly<GeneratedStatePhysicalIdentity>,
  operation: RuntimeDependencyOperationContext,
  label: string
): LegacyDependencyTransitionRecordSet {
  const before = assertSameNoFollowDirectoryIdentity(recordsRoot, `${label} before census`).target;
  const census = scanNoFollowDirectoryTree(before, {
    deadlineAtMs: operation.deadlineAtMonotonicMs,
    maximumEntries: DEPENDENCY_TRANSITION_RECORD_CAPACITY,
    maximumBytes: DEPENDENCY_TRANSITION_RECORD_BYTES_CAPACITY
  });
  const records = new Map<`sha256:${string}`, LegacyDependencyTransitionJournal>();
  for (const entry of census) {
    if (operation.monotonicNowMs() > operation.deadlineAtMonotonicMs) {
      throw new SecError('RUNTIME-DEPS-004', `${label} exceeded its read deadline`, {
        deadlineAtMs: operation.deadlineAtMonotonicMs,
        observedEntries: records.size
      });
    }
    if (entry.kind !== 'file' || !/^record-[0-9a-f]{64}\.json$/u.test(entry.relativePath)) {
      throw new SecError('RUNTIME-DEPS-002', `${label} contains an unknown physical entry`);
    }
    if (entry.bytes === null) {
      throw new SecError('RUNTIME-DEPS-002', `${label} record disappeared during census`);
    }
    const record = parseLegacyDependencyTransitionRecord(entry.bytes, entry.relativePath);
    if (record.ownerRoot !== ownerRoot ||
        !sameGeneratedStateIdentity(record.ownerRootPhysical, ownerRootPhysical)) {
      throw new SecError('RUNTIME-DEPS-002', `${label} record belongs to a foreign owner root or physical epoch`);
    }
    if (records.has(record.recordDigest)) {
      throw new SecError('RUNTIME-DEPS-002', `${label} record digest is duplicated`);
    }
    records.set(record.recordDigest, record);
  }
  const after = assertSameNoFollowDirectoryIdentity(recordsRoot, `${label} after census`).target;
  if (!sameGeneratedStateIdentity(
    generatedStatePhysicalIdentity(before),
    generatedStatePhysicalIdentity(after)
  )) {
    throw new SecError('RUNTIME-DEPS-002', `${label} identity changed during census`);
  }
  if (records.size === 0) {
    throw new SecError('RUNTIME-DEPS-004', `${label} has no legacy records to migrate`);
  }

  const grouped = new Map<`sha256:${string}`, LegacyDependencyTransitionJournal[]>();
  const children = new Map<`sha256:${string}`, `sha256:${string}`>();
  for (const record of records.values()) {
    const chain = grouped.get(record.operationKey);
    if (chain === undefined) grouped.set(record.operationKey, [record]);
    else chain.push(record);
    if (record.previousRecordDigest !== null) {
      const previousChild = children.get(record.previousRecordDigest);
      if (previousChild !== undefined && previousChild !== record.recordDigest) {
        throw new SecError('RUNTIME-DEPS-002', `${label} contains a forked legacy predecessor`);
      }
      children.set(record.previousRecordDigest, record.recordDigest);
    }
  }

  const chains = [...grouped.values()].map((chain) => {
    chain.sort((left, right) => left.sequence - right.sequence ||
      compareCodeUnits(left.recordDigest, right.recordDigest));
    let previous: LegacyDependencyTransitionJournal | undefined;
    for (const record of chain) {
      if (previous === undefined) {
        if (record.sequence !== 1 || record.previousRecordDigest !== null) {
          throw new SecError('RUNTIME-DEPS-002', `${label} legacy chain has an invalid root`);
        }
      } else if (record.sequence !== previous.sequence + 1 ||
          record.previousRecordDigest !== previous.recordDigest) {
        throw new SecError('RUNTIME-DEPS-002', `${label} legacy chain has a missing or forked predecessor`);
      }
      previous = record;
    }
    return Object.freeze(chain.slice()) as readonly LegacyDependencyTransitionJournal[];
  });
  chains.sort((left, right) => compareCodeUnits(left[0]!.operationKey, right[0]!.operationKey));
  if (chains.length === 0) {
    throw new SecError('RUNTIME-DEPS-004', `${label} has no complete legacy chain`);
  }
  operation.signal?.throwIfAborted();
  const graphReadbackNow = operation.monotonicNowMs();
  if (graphReadbackNow > operation.deadlineAtMonotonicMs) {
    throw new SecError('RUNTIME-DEPS-004', `${label} exceeded its graph-validation deadline`, {
      deadlineAtMs: operation.deadlineAtMonotonicMs,
      observedEntries: records.size
    });
  }
  return Object.freeze({
    records,
    ledgerDigest: dependencyTransitionLedgerDigest(records),
    recordsRootPhysical: generatedStatePhysicalIdentity(after),
    chains: Object.freeze(chains)
  });
}

type MigratedDependencyTransitionRecords = Readonly<{
  records: ReadonlyMap<`sha256:${string}`, DependencyTransitionJournal>;
  ordered: readonly DependencyTransitionJournal[];
  ledgerDigest: `sha256:${string}`;
}>;

async function buildMigratedDependencyTransitionRecords(
  source: LegacyDependencyTransitionRecordSet
): Promise<MigratedDependencyTransitionRecords> {
  const records = new Map<`sha256:${string}`, DependencyTransitionJournal>();
  for (const chain of source.chains) {
    const terminal = chain.at(-1);
    if (terminal === undefined || (terminal.phase !== 'complete' && terminal.phase !== 'rolled-back')) {
      throw new SecError(
        'RUNTIME-DEPS-004',
        'Legacy dependency transition migration requires every chain to be terminal',
        {
          operationKey: terminal?.operationKey ?? null,
          phase: terminal?.phase ?? null
        }
      );
    }
  }
  if (source.chains.length === 0) {
    throw new SecError('RUNTIME-DEPS-004', 'Legacy dependency transition migration has no records');
  }
  // Legacy source-generation receipts predate the bounded source-tree digest.
  // Translating them into v2 operation records would manufacture proof that
  // never existed.  The immutable v1 root remains the historical evidence;
  // the v2 migration intent binds that complete terminal ledger and starts a
  // fresh, empty v2 operation ledger for future transitions.
  const ordered = Object.freeze([]) as readonly DependencyTransitionJournal[];
  return Object.freeze({
    records,
    ordered,
    ledgerDigest: dependencyTransitionLedgerDigest(records)
  });
}

type DependencyTransitionMigrationIntents = Readonly<{
  prepared: DependencyTransitionMigrationIntent | null;
  complete: DependencyTransitionMigrationIntent | null;
}>;

async function readDependencyTransitionMigrationIntents(
  namespace: DependencyTransitionNamespace,
  options: RuntimeDependencyOperationOptions
): Promise<DependencyTransitionMigrationIntents> {
  const names = await readNoFollowDirectNames(
    namespace.journalRoot,
    'Dependency transition migration intent namespace',
    64,
    options
  );
  for (const name of names) {
    if (name === 'current.json' || name === 'records' || name === 'rollovers' ||
        /^migration-[0-9a-f]{64}-(?:prepared|complete)\.json$/u.test(name)) {
      continue;
    }
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition migration namespace contains unknown residue', { name });
  }
  let prepared: DependencyTransitionMigrationIntent | null = null;
  let complete: DependencyTransitionMigrationIntent | null = null;
  for (const name of names) {
    if (!name.startsWith('migration-')) continue;
    const entry = inspectNoFollowOrdinaryFileEntry(namespace.journalRoot, name);
    if (entry === null || entry.bytes === null) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition migration intent disappeared during census', { name });
    }
    const intent = parseDependencyTransitionMigrationIntent(entry.bytes, name);
    if (path.resolve(intent.ownerRoot) !== namespace.ownerRoot.path ||
        path.resolve(intent.targetJournalRootPath) !== namespace.journalRoot.path ||
        path.resolve(intent.targetRecordsRootPath) !== namespace.recordsRoot.path ||
        !sameGeneratedStateIdentity(
          intent.ownerRootPhysical,
          generatedStatePhysicalIdentity(namespace.ownerRoot)
        ) ||
        !sameGeneratedStateIdentity(
          intent.targetJournalRootPhysical,
          generatedStatePhysicalIdentity(namespace.journalRoot)
        ) ||
        !sameGeneratedStateIdentity(
          intent.targetRecordsRootPhysical,
          generatedStatePhysicalIdentity(namespace.recordsRoot)
        )) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition migration intent is foreign to its target namespace', { name });
    }
    if (intent.phase === 'prepared') {
      if (prepared !== null) {
        throw new SecError('RUNTIME-DEPS-004', 'Dependency transition migration has duplicate prepared intents');
      }
      prepared = intent;
    } else {
      if (complete !== null) {
        throw new SecError('RUNTIME-DEPS-004', 'Dependency transition migration has duplicate complete intents');
      }
      complete = intent;
    }
  }
  if (complete !== null && (prepared === null || complete.previousIntentDigest !== prepared.intentDigest)) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition migration complete intent has no prepared predecessor');
  }
  return Object.freeze({ prepared, complete });
}

function assertDependencyTransitionMigrationSourceBinding(
  intent: DependencyTransitionMigrationIntent,
  source: DependencyTransitionNamespace,
  sourceLedger: LegacyDependencyTransitionRecordSet
): void {
  if (path.resolve(intent.ownerRoot) !== source.ownerRoot.path ||
      path.resolve(intent.sourceJournalRootPath) !== source.journalRoot.path ||
      path.resolve(intent.sourceRecordsRootPath) !== source.recordsRoot.path ||
      !sameGeneratedStateIdentity(
        intent.ownerRootPhysical,
        generatedStatePhysicalIdentity(source.ownerRoot)
      ) ||
      !sameGeneratedStateIdentity(
        intent.sourceJournalRootPhysical,
        generatedStatePhysicalIdentity(source.journalRoot)
      ) ||
      !sameGeneratedStateIdentity(
        intent.sourceRecordsRootPhysical,
        sourceLedger.recordsRootPhysical
      ) ||
      intent.sourceLedgerDigest !== sourceLedger.ledgerDigest ||
      intent.sourceRecordCount !== sourceLedger.records.size) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition migration source changed and is preserved');
  }
}

/**
 * The normal v2 reader may retain the old namespace as recovery evidence, but
 * it must not parse the retired v1 grammar.  Once the one-way migration is
 * complete, the immutable intent is the only source-side receipt the normal
 * reader needs; this check therefore binds only the retained namespace paths
 * and physical identities.  Full v1 record validation belongs exclusively to
 * `migrateLegacyDependencyTransitionUnderLease`.
 */
function assertDependencyTransitionMigrationSourceNamespaceBinding(
  intent: DependencyTransitionMigrationIntent,
  source: DependencyTransitionNamespace
): void {
  if (path.resolve(intent.ownerRoot) !== source.ownerRoot.path ||
      path.resolve(intent.sourceJournalRootPath) !== source.journalRoot.path ||
      path.resolve(intent.sourceRecordsRootPath) !== source.recordsRoot.path ||
      !sameGeneratedStateIdentity(
        intent.ownerRootPhysical,
        generatedStatePhysicalIdentity(source.ownerRoot)
      ) ||
      !sameGeneratedStateIdentity(
        intent.sourceJournalRootPhysical,
        generatedStatePhysicalIdentity(source.journalRoot)
      ) ||
      !sameGeneratedStateIdentity(
        intent.sourceRecordsRootPhysical,
        generatedStatePhysicalIdentity(source.recordsRoot)
      )) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition migration source namespace changed and is preserved');
  }
}

function assertDependencyTransitionMigrationTargetBinding(
  intent: DependencyTransitionMigrationIntent,
  target: DependencyTransitionNamespace
): void {
  if (path.resolve(intent.targetJournalRootPath) !== target.journalRoot.path ||
      path.resolve(intent.targetRecordsRootPath) !== target.recordsRoot.path ||
      !sameGeneratedStateIdentity(
        intent.targetJournalRootPhysical,
        generatedStatePhysicalIdentity(target.journalRoot)
      ) ||
      !sameGeneratedStateIdentity(
        intent.targetRecordsRootPhysical,
        generatedStatePhysicalIdentity(target.recordsRoot)
      )) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition migration target changed and is preserved');
  }
}

async function writeDependencyTransitionMigrationIntent(
  namespace: DependencyTransitionNamespace,
  intent: DependencyTransitionMigrationIntent,
  options: RuntimeDependencyOperationOptions,
  verifySourceBeforeWrite?: () => Promise<void>
): Promise<void> {
  await runtimeDependencyOperationEffectFence(
    options,
    `Dependency transition migration ${intent.phase} intent publication`
  );
  const name = dependencyTransitionMigrationIntentFileName(intent.intentDigest, intent.phase);
  const bytes = dependencyTransitionMigrationIntentBytes(intent);
  await verifySourceBeforeWrite?.();
  // Source verification can itself perform a bounded census.  Re-admit the
  // actual durable publication after that readback so an expired/aborted
  // operation cannot turn the migration evidence into a late filesystem
  // effect, and so the caller's final commit fence is observed immediately
  // before the immutable write.
  await runtimeDependencyOperationEffectFence(
    options,
    `Dependency transition migration ${intent.phase} intent effect`
  );
  writeDurableTransitionFile(
    namespace.journalRoot,
    name,
    bytes,
    assertDependencyTransitionMigrationIntentBytes,
    true
  );
  const readback = inspectNoFollowOrdinaryFileEntry(namespace.journalRoot, name);
  if (readback === null || readback.bytes === null || !Buffer.from(readback.bytes).equals(bytes)) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition migration intent disappeared after publication', { name });
  }
  parseDependencyTransitionMigrationIntent(readback.bytes, name);
}

function dependencyTransitionMigrationIntent(
  input: Readonly<Omit<DependencyTransitionMigrationIntent, 'intentDigest' | 'schema'>>
): DependencyTransitionMigrationIntent {
  return Object.freeze({
    ...input,
    schema: DEPENDENCY_TRANSITION_MIGRATION_SCHEMA,
    intentDigest: dependencyTransitionMigrationIntentStableDigest(input)
  });
}

async function assertLegacyDependencyTransitionUnchanged(
  source: DependencyTransitionNamespace,
  expected: LegacyDependencyTransitionRecordSet,
  options: RuntimeDependencyOperationOptions,
  label: string
): Promise<LegacyDependencyTransitionRecordSet> {
  await runtimeDependencyOperationRemainingMs(options, `${label} admission`);
  const currentNamespace = inspectLegacyDependencyTransitionNamespace(source.ownerRoot.path);
  if (currentNamespace === null ||
      !sameGeneratedStateIdentity(
        generatedStatePhysicalIdentity(currentNamespace.journalRoot),
        generatedStatePhysicalIdentity(source.journalRoot)
      ) ||
      !sameGeneratedStateIdentity(
        generatedStatePhysicalIdentity(currentNamespace.recordsRoot),
        expected.recordsRootPhysical
      )) {
    throw new SecError('RUNTIME-DEPS-004', `${label} namespace physical identity changed and is preserved`);
  }
  const current = readLegacyDependencyTransitionRecordSet(
    currentNamespace.recordsRoot,
    currentNamespace.ownerRoot.path,
    generatedStatePhysicalIdentity(currentNamespace.ownerRoot),
    runtimeDependencyOperationContext(options),
    label
  );
  if (current.records.size !== expected.records.size || current.ledgerDigest !== expected.ledgerDigest) {
    throw new SecError('RUNTIME-DEPS-004', `${label} immutable records changed and are preserved`, {
      expectedLedgerDigest: expected.ledgerDigest,
      observedLedgerDigest: current.ledgerDigest,
      expectedRecordCount: expected.records.size,
      observedRecordCount: current.records.size
    });
  }
  return current;
}

async function publishMigratedDependencyTransitionRecords(
  namespace: DependencyTransitionNamespace,
  expected: MigratedDependencyTransitionRecords,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  const current = readDependencyTransitionRecordSet(
    namespace.recordsRoot,
    namespace.ownerRoot.path,
    runtimeDependencyOperationContext(options),
    'Dependency transition v2 migration target records'
  );
  if (current.records.size > expected.ordered.length) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition migration target contains extra records');
  }
  let publishedCount = current.records.size;
  for (let index = 0; index < expected.ordered.length; index += 1) {
    const record = expected.ordered[index]!;
    const existing = current.records.get(record.recordDigest);
    if (existing !== undefined) {
      if (!Buffer.from(dependencyTransitionRecordBytes(existing)).equals(
        dependencyTransitionRecordBytes(record)
      )) {
        throw new SecError('RUNTIME-DEPS-004', 'Dependency transition migration target record collides with different bytes', {
          recordDigest: record.recordDigest
        });
      }
      continue;
    }
    if (index !== publishedCount) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition migration target has a non-prefix partial chain', {
        expectedIndex: index,
        observedRecordCount: publishedCount
      });
    }
    await runtimeDependencyOperationEffectFence(
      options,
      'Dependency transition v2 migration record publication'
    );
    writeDurableTransitionFile(
      namespace.recordsRoot,
      transitionRecordName(record.recordDigest),
      dependencyTransitionRecordBytes(record),
      assertDependencyTransitionRecordBytes,
      true
    );
    publishedCount += 1;
  }
  const final = readDependencyTransitionRecordSet(
    namespace.recordsRoot,
    namespace.ownerRoot.path,
    runtimeDependencyOperationContext(options),
    'Dependency transition v2 migration target readback'
  );
  if (final.records.size !== expected.records.size || final.ledgerDigest !== expected.ledgerDigest ||
      final.tip?.recordDigest !== expected.ordered.at(-1)?.recordDigest) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition v2 migration target readback is incomplete');
  }
}

async function migrateLegacyDependencyTransitionUnderLease(
  ownerRoot: string,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  const legacyNamespace = inspectLegacyDependencyTransitionNamespace(ownerRoot);
  const targetNamespace = inspectDependencyTransitionNamespace(ownerRoot);
  if (legacyNamespace === null) {
    if (targetNamespace !== null) {
      // A new installation may legitimately have created an empty v2 root
      // before any transition was recorded.  There is no legacy source to
      // migrate, and normal v2 readers remain the sole authority.
      const intents = await readDependencyTransitionMigrationIntents(targetNamespace, options);
      if (intents.prepared !== null || intents.complete !== null) {
        throw new SecError('RUNTIME-DEPS-004', 'Dependency transition migration source evidence is missing and is preserved', {
          preparedIntentDigest: intents.prepared?.intentDigest ?? null,
          completeIntentDigest: intents.complete?.intentDigest ?? null
        });
      }
      return;
    }
    return;
  }
  const legacyNames = await readNoFollowDirectNames(
    legacyNamespace.journalRoot,
    'Legacy dependency transition namespace',
    64,
    options
  );
  for (const name of legacyNames) {
    if (name !== 'current.json' && name !== 'records') {
      throw new SecError('RUNTIME-DEPS-004', 'Legacy dependency transition namespace contains unknown residue', { name });
    }
  }
  const source = readLegacyDependencyTransitionRecordSet(
    legacyNamespace.recordsRoot,
    legacyNamespace.ownerRoot.path,
    generatedStatePhysicalIdentity(legacyNamespace.ownerRoot),
    runtimeDependencyOperationContext(options),
    'Legacy dependency transition migration source'
  );
  const migrated = await buildMigratedDependencyTransitionRecords(source);

  if (targetNamespace !== null) {
    const intents = await readDependencyTransitionMigrationIntents(targetNamespace, options);
    if (intents.complete !== null) {
      assertDependencyTransitionMigrationSourceBinding(intents.complete, legacyNamespace, source);
      // A completed migration binds the target namespace and the initial
      // migration derivation, not the target ledger's permanent terminal
      // contents.  Normal v2 operations append immutable records after this
      // receipt is published; their single-chain parser owns that later
      // integrity.  Requiring the live ledger to remain byte-for-byte equal
      // to the migration-time empty ledger would make the first legitimate
      // post-migration transition poison every future admission.
      readDependencyTransitionRecordSet(
        targetNamespace.recordsRoot,
        targetNamespace.ownerRoot.path,
        runtimeDependencyOperationContext(options),
        'Dependency transition v2 migration completed target'
      );
      assertDependencyTransitionMigrationTargetBinding(intents.complete, targetNamespace);
      if (intents.complete.targetLedgerDigest !== migrated.ledgerDigest ||
          intents.complete.targetRecordCount !== migrated.records.size) {
        throw new SecError('RUNTIME-DEPS-004', 'Dependency transition migration completed target is not derived from its source');
      }
      return;
    }
    if (intents.prepared === null) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition v2 namespace exists without a migration intent; target is preserved');
    }
    assertDependencyTransitionMigrationSourceBinding(intents.prepared, legacyNamespace, source);
    if (intents.prepared.targetLedgerDigest !== migrated.ledgerDigest ||
        intents.prepared.targetRecordCount !== migrated.records.size) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition migration target derivation changed');
    }
    await publishMigratedDependencyTransitionRecords(targetNamespace, migrated, options);
    const sourceAfter = await assertLegacyDependencyTransitionUnchanged(
      legacyNamespace,
      source,
      options,
      'Dependency transition migration source readback'
    );
    assertDependencyTransitionMigrationSourceBinding(intents.prepared, legacyNamespace, sourceAfter);
    const complete = dependencyTransitionMigrationIntent({
      ...intents.prepared,
      phase: 'complete',
      previousIntentDigest: intents.prepared.intentDigest
    });
    await writeDependencyTransitionMigrationIntent(
      targetNamespace,
      complete,
      options,
      async () => {
        await assertLegacyDependencyTransitionUnchanged(
          legacyNamespace,
          sourceAfter,
          options,
          'Dependency transition migration final source fence'
        );
      }
    );
    const terminal = migrated.ordered.at(-1);
    if (terminal !== undefined) {
      writeDependencyTransitionPointerCache(targetNamespace, terminal.recordDigest);
    }
    return;
  }

  // Source validation and transformation complete before the first v2
  // namespace effect.  The second source census after the fence closes the
  // physical/digest CAS window without touching the retained v1 evidence.
  await runtimeDependencyOperationEffectFence(options, 'Dependency transition v2 migration namespace admission');
  const sourceAtEffect = await assertLegacyDependencyTransitionUnchanged(
    legacyNamespace,
    source,
    options,
    'Dependency transition migration source effect preimage'
  );
  const namespace = await ensureDependencyTransitionNamespace(ownerRoot, options);
  const targetBefore = readDependencyTransitionRecordSet(
    namespace.recordsRoot,
    namespace.ownerRoot.path,
    runtimeDependencyOperationContext(options),
    'Dependency transition v2 migration target preflight'
  );
  if (targetBefore.records.size !== 0) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition v2 target appeared during migration');
  }
  const prepared = dependencyTransitionMigrationIntent({
    previousIntentDigest: null,
    phase: 'prepared',
    ownerRoot: namespace.ownerRoot.path,
    ownerRootPhysical: generatedStatePhysicalIdentity(namespace.ownerRoot),
    sourceSchema: DEPENDENCY_TRANSITION_LEGACY_SCHEMA,
    sourceJournalRootPath: legacyNamespace.journalRoot.path,
    sourceJournalRootPhysical: generatedStatePhysicalIdentity(legacyNamespace.journalRoot),
    sourceRecordsRootPath: legacyNamespace.recordsRoot.path,
    sourceRecordsRootPhysical: sourceAtEffect.recordsRootPhysical,
    sourceLedgerDigest: sourceAtEffect.ledgerDigest,
    sourceRecordCount: sourceAtEffect.records.size,
    targetSchema: DEPENDENCY_TRANSITION_SCHEMA,
    targetJournalRootPath: namespace.journalRoot.path,
    targetJournalRootPhysical: generatedStatePhysicalIdentity(namespace.journalRoot),
    targetRecordsRootPath: namespace.recordsRoot.path,
    targetRecordsRootPhysical: generatedStatePhysicalIdentity(namespace.recordsRoot),
    targetLedgerDigest: migrated.ledgerDigest,
    targetRecordCount: migrated.records.size
  });
  await writeDependencyTransitionMigrationIntent(
    namespace,
    prepared,
    options,
    async () => {
      await assertLegacyDependencyTransitionUnchanged(
        legacyNamespace,
        sourceAtEffect,
        options,
        'Dependency transition migration source prepared fence'
      );
    }
  );
  await publishMigratedDependencyTransitionRecords(namespace, migrated, options);
  const sourceAfter = await assertLegacyDependencyTransitionUnchanged(
    legacyNamespace,
    sourceAtEffect,
    options,
    'Dependency transition migration source final readback'
  );
  assertDependencyTransitionMigrationSourceBinding(prepared, legacyNamespace, sourceAfter);
  const complete = dependencyTransitionMigrationIntent({
    ...prepared,
    phase: 'complete',
    previousIntentDigest: prepared.intentDigest
  });
  await writeDependencyTransitionMigrationIntent(
    namespace,
    complete,
    options,
    async () => {
      await assertLegacyDependencyTransitionUnchanged(
        legacyNamespace,
        sourceAfter,
        options,
        'Dependency transition migration final source fence'
      );
    }
  );
  const terminal = migrated.ordered.at(-1);
  if (terminal !== undefined) {
    writeDependencyTransitionPointerCache(namespace, terminal.recordDigest);
  }
}

function assertDependencyTransitionRolloverLedgerBinding(
  observed: DependencyTransitionRecordSet,
  intent: DependencyTransitionRolloverIntent,
  label: string
): DependencyTransitionJournal {
  if (observed.records.size !== intent.recordCount || observed.ledgerDigest !== intent.ledgerDigest ||
      observed.tip === null || observed.tip.recordDigest !== intent.terminalRecordDigest) {
    throw new SecError('RUNTIME-DEPS-004', `${label} does not match the rollover terminal ledger receipt`, {
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
    throw new SecError('RUNTIME-DEPS-004', `${label} terminal record is missing or nonterminal`);
  }
  assertDependencyTransitionRolloverCheckpointDerived(intent, terminal);
  return terminal;
}

async function readDependencyTransitionLedger(
  ownerRoot: string,
  options: RuntimeDependencyOperationOptions
): Promise<DependencyTransitionLedger | null> {
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition ledger admission');
  // Read-only admission must not create `.tmp/dependency-installs` or a
  // journal namespace. The writer/recovery effect boundary is the only route
  // allowed to create those directories.
  const activeRollover = await inspectActiveDependencyTransitionRollover(ownerRoot, options);
  if (activeRollover !== null && activeRollover.active !== null) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition ledger rollover requires owner recovery', {
      intentDigest: activeRollover.active.intentDigest,
      phase: activeRollover.active.phase,
      terminalRecordDigest: activeRollover.active.terminalRecordDigest
    });
  }
  const namespace = inspectDependencyTransitionNamespace(ownerRoot);
  const legacyNamespace = inspectLegacyDependencyTransitionNamespace(ownerRoot);
  let completedMigration: DependencyTransitionMigrationIntent | null = null;
  if (namespace === null) {
    if (legacyNamespace !== null) {
      throw new SecError('RUNTIME-DEPS-004', 'Legacy dependency transition journal requires an owner migration before it can be read', {
        schema: DEPENDENCY_TRANSITION_LEGACY_SCHEMA,
        namespace: legacyNamespace.journalRoot.path
      });
    }
    return null;
  }
  const migrationIntents = await readDependencyTransitionMigrationIntents(namespace, options);
  if (legacyNamespace !== null) {
    if (migrationIntents.complete === null) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition schema migration is incomplete; target is preserved', {
        namespace: namespace.journalRoot.path,
        preparedIntentDigest: migrationIntents.prepared?.intentDigest ?? null
      });
    }
    // The v2 reader does not dual-read the retired grammar.  It only verifies
    // that the retained source namespace still has the physical identity
    // recorded by the completed migration intent; the migration entry alone
    // is allowed to parse and digest v1 records.
    assertDependencyTransitionMigrationSourceNamespaceBinding(migrationIntents.complete, legacyNamespace);
    completedMigration = migrationIntents.complete;
  } else if (migrationIntents.prepared !== null || migrationIntents.complete !== null) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition migration source evidence is missing and is preserved', {
      preparedIntentDigest: migrationIntents.prepared?.intentDigest ?? null,
      completeIntentDigest: migrationIntents.complete?.intentDigest ?? null
    });
  }
  const latestCompleteRollover = activeRollover?.latestComplete ?? null;
  if (latestCompleteRollover !== null && !sameGeneratedStateIdentity(
    generatedStatePhysicalIdentity(namespace.recordsRoot),
    latestCompleteRollover.publishedRecordsRootPhysical!
  )) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition records root is not the latest complete rollover publication');
  }
  const observed = readDependencyTransitionRecordSet(
    namespace.recordsRoot,
    namespace.ownerRoot.path,
    runtimeDependencyOperationContext(options),
    'Dependency transition records'
  );
  const { records, tip } = observed;
  if (completedMigration !== null) {
    assertDependencyTransitionMigrationTargetBinding(completedMigration, namespace);
  }
  if (records.size === 0 && latestCompleteRollover !== null) {
    throw new SecError('RUNTIME-DEPS-004', 'Latest complete dependency transition rollover has no checkpoint in its published records root');
  }
  if (latestCompleteRollover !== null) {
    const checkpoint = records.get(latestCompleteRollover.checkpoint.recordDigest);
    if (checkpoint === undefined ||
        !Buffer.from(dependencyTransitionRecordBytes(checkpoint)).equals(
          dependencyTransitionRecordBytes(latestCompleteRollover.checkpoint)
        ) ||
        checkpoint.previousRecordDigest !== null || checkpoint.sequence !== 1) {
      throw new SecError('RUNTIME-DEPS-004', 'Published dependency transition records root does not contain the latest complete rollover checkpoint');
    }
  }
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition ledger readback');
  return Object.freeze({ namespace, records, ledgerDigest: observed.ledgerDigest, tip });
}

async function readDependencyTransition(
  ownerRoot: string,
  options: RuntimeDependencyOperationOptions
): Promise<DependencyTransitionJournal | null> {
  return (await readDependencyTransitionLedger(ownerRoot, options))?.tip ?? null;
}

function writeDependencyTransitionPointerCache(
  namespace: DependencyTransitionNamespace,
  recordDigest: `sha256:${string}`
): void {
  // `current.json` is intentionally not replaced.  It is a disposable
  // locator/cache and may have been written by an external process between
  // our immutable-record publication and this best-effort hint.  Replacing it
  // would turn a check-then-replace race into an apparent authority race.  The
  // immutable census remains the only source of the transition tip.
  const pointer = Object.freeze({
    schema: DEPENDENCY_TRANSITION_POINTER_SCHEMA,
    recordDigest
  });
  const pointerBytes = Buffer.from(formatJsonFile(canonicalJson(pointer)), 'utf8');
  let existing: ReturnType<typeof inspectNoFollowOrdinaryFileEntry>;
  try {
    existing = inspectNoFollowOrdinaryFileEntry(namespace.journalRoot, 'current.json');
  } catch {
    // A foreign/reparse cache entry is preserved.  It cannot affect recovery.
    return;
  }
  if (existing === null) {
    try {
      publishExclusiveDurableCanonicalFile({
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

async function rolloverDependencyTransitionLedger(
  ownerRoot: string,
  ledger: DependencyTransitionLedger,
  terminal: DependencyTransitionJournal,
  options: RuntimeDependencyOperationOptions
): Promise<DependencyTransitionJournal> {
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition rollover admission');
  assertDependencyTransitionTerminalRolloverReady(terminal, ledger.namespace);
  if (ledger.tip?.recordDigest !== terminal.recordDigest ||
      ledger.records.size < DEPENDENCY_TRANSITION_ROLLOVER_TRIGGER ||
      ledger.records.size > DEPENDENCY_TRANSITION_RECORD_CAPACITY ||
      ledger.ledgerDigest !== dependencyTransitionLedgerDigest(ledger.records)) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition ledger rollover predecessor receipt is invalid');
  }
  // The new root is a receipt for the already authenticated terminal ledger,
  // never a caller-supplied prepared operation.  This derivation must happen
  // before the durable intent so a crash cannot turn arbitrary caller fields
  // into recovery authority.
  const checkpoint = dependencyTransitionTerminalCheckpoint(
    terminal,
    ledger.ledgerDigest
  );
  await assertDependencyTransitionTerminalReadback(terminal, options);
  for (const slot of [terminal.stage, terminal.stageRoot, terminal.backup]) {
    if (slot === null) continue;
    const current = await observeDependencyTransitionSlot(slot.path, slot.bindingDigest);
    if (!transitionSlotMatches(current, slot)) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition terminal residue changed before ledger rollover');
    }
  }
  const namespace = await ensureDependencyTransitionNamespace(ownerRoot, options);
  if (namespace.rolloversRoot === null ||
      !sameGeneratedStateIdentity(
        generatedStatePhysicalIdentity(namespace.ownerRoot),
        terminal.ownerRootPhysical
      ) ||
      !sameGeneratedStateIdentity(
        generatedStatePhysicalIdentity(namespace.recordsRoot),
        generatedStatePhysicalIdentity(ledger.namespace.recordsRoot)
      )) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition ledger namespace changed before rollover');
  }
  const priorRollover = await inspectActiveDependencyTransitionRollover(ownerRoot, options);
  if (priorRollover?.active !== null) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover already has an active recovery intent');
  }
  const previousIntentDigest = priorRollover?.latestComplete?.intentDigest ?? null;
  const sequence = (priorRollover?.latestComplete?.sequence ?? 0) + 1;
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover sequence exhausted');
  }
  const stem = rolloverResidueStem({
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
  const existingNext = inspectOptionalNoFollowDirectoryChild(
    namespace.rolloversRoot,
    nextName,
    'Dependency transition rollover next records preflight'
  );
  const existingRetired = inspectOptionalNoFollowDirectoryChild(
    namespace.rolloversRoot,
    retiredName,
    'Dependency transition rollover retired records preflight'
  );
  if (existingNext !== null || existingRetired !== null) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition rollover residue is foreign or belongs to an unresolved prior operation', {
      nextName,
      retiredName
    });
  }
  const intent = makeDependencyTransitionRolloverIntent({
    namespace,
    terminal,
    previousIntentDigest,
    sequence,
    ledgerDigest: ledger.ledgerDigest,
    recordCount: ledger.records.size,
    checkpoint,
    nextRecordsPhysical: null
  });
  await writeDependencyTransitionRolloverIntentPhase(
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
  await runtimeDependencyOperationEffectFence(options, 'Dependency transition rollover next-root creation');
  const next = createExclusiveNoFollowDirectory(namespace.rolloversRoot, nextName);
  const staged = advanceDependencyTransitionRolloverIntent(intent, 'staged', {
    retiredRecordsPhysical: null,
    retiredRecordsDisposed: false,
    nextRecordsPhysical: generatedStatePhysicalIdentity(next),
    publishedRecordsRootPhysical: null
  });
  await writeDependencyTransitionRolloverIntentPhase(
    Object.freeze({
      ownerRoot: namespace.ownerRoot,
      journalRoot: namespace.journalRoot,
      rolloversRoot: namespace.rolloversRoot,
      recordsRootPath: namespace.recordsRoot.path
    }),
    staged,
    options
  );
  await runtimeDependencyOperationEffectFence(options, 'Dependency transition rollover checkpoint publication');
  writeDurableTransitionFile(
    next,
    transitionRecordName(checkpoint.recordDigest),
    dependencyTransitionRecordBytes(checkpoint),
    assertDependencyTransitionRecordBytes,
    true
  );
  await assertDependencyTransitionRolloverCheckpoint(next, staged, options);
  await recoverDependencyTransitionRollover(ownerRoot, options);
  const after = await readDependencyTransitionLedger(ownerRoot, options);
  if (after === null || after.tip === null || after.tip.recordDigest !== checkpoint.recordDigest) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition ledger rollover did not publish its checkpoint');
  }
  return after.tip;
}

async function writeDependencyTransition(
  ownerRoot: string,
  unsigned: DependencyTransitionUnsigned,
  options: RuntimeDependencyOperationOptions,
  expectedCurrentRecordDigest: `sha256:${string}` | null = null
): Promise<DependencyTransitionJournal> {
  const namespace = await ensureDependencyTransitionNamespace(ownerRoot, options);
  const currentLedger = await readDependencyTransitionLedger(ownerRoot, options);
  if (expectedCurrentRecordDigest === null) {
    // A new immutable epoch may only start from an empty ledger.  The
    // immutable census, rather than current.json, is the expected-current CAS
    // preimage for this root publication.
    if (currentLedger?.tip !== null && currentLedger?.tip !== undefined) {
      throw new SecError('RUNTIME-DEPS-002', 'Dependency transition immutable ledger already has a predecessor', {
        expectedCurrentRecordDigest,
        currentRecordDigest: currentLedger.tip.recordDigest,
        ownerRoot: namespace.ownerRoot.path
      });
    }
  } else {
    if (currentLedger?.tip === null || currentLedger === null ||
        currentLedger.tip.recordDigest !== expectedCurrentRecordDigest) {
      throw new SecError('RUNTIME-DEPS-002', 'Dependency transition expected-current record digest does not match the immutable ledger tip', {
        expectedCurrentRecordDigest,
        currentRecordDigest: currentLedger?.tip?.recordDigest ?? null,
        ownerRoot: namespace.ownerRoot.path
      });
    }
    if (currentLedger.records.size >= DEPENDENCY_TRANSITION_ROLLOVER_TRIGGER) {
      if (unsigned.phase !== 'prepared') {
        throw new SecError('RUNTIME-DEPS-004', 'Dependency transition ledger is at rollover capacity during an active operation', {
          recordCount: currentLedger.records.size,
          capacity: DEPENDENCY_TRANSITION_RECORD_CAPACITY
        });
      }
      const checkpoint = await rolloverDependencyTransitionLedger(
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
      return writeDependencyTransition(
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
    const predecessorEntry = inspectNoFollowOrdinaryFileEntry(namespace.recordsRoot, predecessorName);
    if (predecessorEntry === null || predecessorEntry.bytes === null) {
      throw new SecError('RUNTIME-DEPS-002', 'Dependency transition expected immutable predecessor is missing', {
        expectedCurrentRecordDigest,
        ownerRoot: namespace.ownerRoot.path
      });
    }
    const predecessor = parseDependencyTransitionRecord(predecessorEntry.bytes, predecessorName);
    if (predecessor.recordDigest !== expectedCurrentRecordDigest ||
        currentLedger.records.get(expectedCurrentRecordDigest)?.recordDigest !== predecessor.recordDigest) {
      throw new SecError('RUNTIME-DEPS-002', 'Dependency transition expected immutable predecessor digest changed', {
        expectedCurrentRecordDigest,
        currentRecordDigest: predecessor.recordDigest,
        ownerRoot: namespace.ownerRoot.path
      });
    }
  }
  const recordDigest = dependencyTransitionDigestWithoutRecord(unsigned);
  const record = Object.freeze({ ...unsigned, recordDigest }) as DependencyTransitionJournal;
  const recordBytes = dependencyTransitionRecordBytes(record);
  await runtimeDependencyOperationEffectFence(options, 'Dependency transition immutable record publication');
  writeDurableTransitionFile(
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
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition immutable record readback');
  writeDependencyTransitionPointerCache(namespace, recordDigest);
  return record;
}

function transitionSlotFromPhysical(input: Readonly<{
  path: string;
  kind: 'directory' | 'link';
  physical: Readonly<GeneratedStatePhysicalIdentity>;
  linkTarget?: string | null;
  bindingDigest?: `sha256:${string}` | null;
}>): DependencyTransitionSlot {
  return Object.freeze({
    path: path.resolve(input.path),
    kind: input.kind,
    physical: input.physical,
    linkTarget: input.linkTarget ?? null,
    bindingDigest: input.bindingDigest ?? null
  });
}

function transitionAbsentSlot(pathValue: string): DependencyTransitionSlot {
  return Object.freeze({
    path: path.resolve(pathValue),
    kind: 'absent' as const,
    physical: null,
    linkTarget: null,
    bindingDigest: null
  });
}

async function observeDependencyTransitionSlot(
  targetPath: string,
  expectedBindingDigest?: `sha256:${string}` | null
): Promise<DependencyTransitionSlot> {
  const absolute = path.resolve(targetPath);
  try {
    const parent = inspectNoFollowDirectoryChain(
      path.dirname(absolute),
      'Dependency transition slot parent'
    ).target;
    const name = path.basename(absolute);
    let link: ReturnType<typeof inspectNoFollowLinkEntry>;
    try {
      link = inspectNoFollowLinkEntry(parent, name);
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
        throw new SecError('RUNTIME-DEPS-004', 'Dependency transition slot is an invalid link');
      }
      return transitionSlotFromPhysical({
        path: absolute,
        kind: 'link',
        physical: Object.freeze({
          device: link.device,
          inode: link.inode,
          objectId: generatedStateDigest({ kind: 'link', target: link.linkTarget })
        }),
        linkTarget: link.linkTarget,
        bindingDigest: expectedBindingDigest ?? null
      });
    }
    const directory = inspectExactNoFollowDirectoryPresence(
      absolute,
      'Dependency transition slot'
    );
    if (directory.state === 'absent') return transitionAbsentSlot(absolute);
    return transitionSlotFromPhysical({
      path: absolute,
      kind: 'directory',
      physical: generatedStatePhysicalIdentity(directory.directory.target),
      bindingDigest: expectedBindingDigest ?? null
    });
  } catch (error) {
    if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') {
      return transitionAbsentSlot(absolute);
    }
    throw error;
  }
}

function transitionSlotMatches(
  actual: DependencyTransitionSlot,
  expected: DependencyTransitionSlot
): boolean {
  if (actual.kind !== expected.kind || path.resolve(actual.path) !== path.resolve(expected.path)) return false;
  if (actual.kind === 'absent') return true;
  return expected.physical !== null && actual.physical !== null &&
    sameGeneratedStateIdentity(actual.physical, expected.physical) &&
    (expected.kind !== 'link' || actual.linkTarget === expected.linkTarget);
}

function sourceGenerationWithPath(
  source: RuntimeDependencySourceGeneration,
  sourcePath: string
): RuntimeDependencySourceGeneration {
  return Object.freeze({ ...source, sourcePath: path.resolve(sourcePath) });
}

function transitionFailure(error: unknown): Readonly<{ code: string; message: string }> {
  return Object.freeze({
    code: error instanceof SecError ? error.code :
      error instanceof PhysicalNoFollowError ? error.code :
        (error as NodeJS.ErrnoException).code ?? 'UNKNOWN',
    message: error instanceof Error ? error.message : String(error)
  });
}

function transitionOperationKey(input: Readonly<{
  kind: DependencyTransitionKind;
  ownerRoot: string;
  destinationPath: string;
  preimage: DependencyTransitionSlot;
  stage: DependencyTransitionSlot | null;
  stageRoot: DependencyTransitionSlot | null;
  backup: DependencyTransitionSlot | null;
  sourceGeneration: RuntimeDependencySourceGeneration;
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
  return generatedStateDigest(canonicalJson(Object.freeze({
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

async function beginDependencyTransition(input: Readonly<{
  kind: DependencyTransitionKind;
  ownerRoot: string;
  destinationPath: string;
  stagePath: string | null;
  stageRootPath?: string | null;
  backupPath: string | null;
  sourceGeneration: RuntimeDependencySourceGeneration;
  bindingDigest: `sha256:${string}` | null;
  options: RuntimeDependencyOperationOptions;
}>): Promise<DependencyTransitionJournal> {
  runtimeDependencyOperationRemainingMs(input.options, 'Dependency transition begin admission');
  const ownerRoot = inspectNoFollowDirectoryChain(
    input.ownerRoot,
    'Dependency transition owner root'
  ).target;
  const destination = await observeDependencyTransitionSlot(input.destinationPath, input.bindingDigest);
  const preimage = destination;
  const stage = input.stagePath === null
    ? null
    : await observeDependencyTransitionSlot(input.stagePath, input.bindingDigest);
  const stageRoot = input.stageRootPath === undefined || input.stageRootPath === null
    ? null
    : await observeDependencyTransitionSlot(input.stageRootPath, input.bindingDigest);
  const backup = input.backupPath === null
    ? null
    : await observeDependencyTransitionSlot(input.backupPath, input.bindingDigest);
  if (input.backupPath !== null) {
    const expectedBackupPath = input.kind === 'compiler-generation'
      ? compilerTransitionBackupPath(ownerRoot.path, 'node_modules', input.sourceGeneration)
      : input.kind === 'compiler-locator'
        ? compilerTransitionBackupPath(ownerRoot.path, 'locator-preimage', input.sourceGeneration)
        : input.kind === 'runtime-projection'
          ? compilerTransitionBackupPath(ownerRoot.path, 'runtime', input.sourceGeneration)
          : input.stageRootPath === null || input.stageRootPath === undefined
            ? null
            : projectTransitionBackupPath(
              ownerRoot.path,
              path.dirname(path.dirname(path.resolve(input.stageRootPath))),
              preimage,
              input.sourceGeneration
            );
    if (expectedBackupPath === null || path.resolve(input.backupPath) !== path.resolve(expectedBackupPath)) {
      throw new SecError('RUNTIME-DEPS-004', 'Dependency transition backup path is not derived from canonical operation inputs');
    }
  }
  if (backup !== null && backup.kind !== 'absent') {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition backup path is occupied by a foreign identity and is preserved', {
      backupPath: backup.path,
      backupKind: backup.kind
    });
  }
  if (stage !== null && stage.kind === 'absent') {
    throw new SecError('RUNTIME-DEPS-002', 'Dependency transition stage disappeared before durable intent');
  }
  if (stageRoot !== null && stageRoot.kind === 'absent') {
    throw new SecError('RUNTIME-DEPS-002', 'Dependency transition staging root disappeared before durable intent');
  }
  if (stage !== null && stageRoot !== null && stage.kind !== 'absent' && stageRoot.kind !== 'absent') {
    const relativeStage = path.relative(stageRoot.path, stage.path);
    if (relativeStage.startsWith('..') || path.isAbsolute(relativeStage) || relativeStage.length === 0) {
      throw new SecError('RUNTIME-DEPS-002', 'Dependency transition stage is not contained by its recorded staging root');
    }
  }
  const current = await readDependencyTransition(ownerRoot.path, input.options);
  if (current !== null && current.phase !== 'complete' && current.phase !== 'rolled-back') {
    throw new SecError('RUNTIME-DEPS-002', 'Dependency transition already has an active owner-local operation', {
      currentRecordDigest: current.recordDigest,
      currentPhase: current.phase,
      ownerRoot: ownerRoot.path
    });
  }
  const operationKey = transitionOperationKey({
    kind: input.kind,
    ownerRoot: ownerRoot.path,
    destinationPath: input.destinationPath,
    preimage,
    stage,
    stageRoot,
    backup,
    sourceGeneration: input.sourceGeneration
  });
  return writeDependencyTransition(ownerRoot.path, {
    schema: DEPENDENCY_TRANSITION_SCHEMA,
    previousRecordDigest: current?.recordDigest ?? null,
    sequence: (current?.sequence ?? 0) + 1,
    operationKey,
    attemptNonce: crypto.randomUUID(),
    kind: input.kind,
    ownerRoot: ownerRoot.path,
    ownerRootPhysical: generatedStatePhysicalIdentity(ownerRoot),
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

async function advanceDependencyTransition(
  previous: DependencyTransitionJournal,
  patch: Readonly<Partial<Pick<DependencyTransitionJournal, 'destination' | 'stage' | 'stageRoot' | 'backup' | 'sourceGeneration' | 'phase' | 'durability' | 'failure'>>>,
  options: RuntimeDependencyOperationOptions
): Promise<DependencyTransitionJournal> {
  // A malformed or foreign predecessor must never be allowed to publish a
  // successor and thereby postpone the topology failure until recovery.
  assertTransitionOperationKey(previous);
  const { recordDigest: _recordDigest, ...withoutDigest } = previous;
  const successor = Object.freeze({
    ...withoutDigest,
    previousRecordDigest: previous.recordDigest,
    sequence: previous.sequence + 1,
    ...patch
  });
  const successorOperationKey = transitionOperationKey({
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
    throw new SecError(
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
  return writeDependencyTransition(previous.ownerRoot, successor, options, previous.recordDigest);
}

async function markDependencyTransitionFailure(
  record: DependencyTransitionJournal,
  error: unknown,
  options: RuntimeDependencyOperationOptions,
  phase: DependencyTransitionPhase = 'recovery-required'
): Promise<DependencyTransitionJournal> {
  return advanceDependencyTransition(record, {
    phase,
    durability: 'unknown',
    failure: transitionFailure(error)
  }, options);
}

type DependencyTransitionStageAuthority = Readonly<{
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

const COMPILER_DEPENDENCY_STAGE_INTENT_SCHEMA =
  'sec-compiler-dependency-stage-intent-v1' as const;
const COMPILER_DEPENDENCY_STAGE_INTENT_DIRECTORY =
  '.compiler-stage-intents-v1' as const;
const COMPILER_DEPENDENCY_STAGE_INTENT_CAPACITY = 10_000;

type CompilerDependencyStageIntentPhase = 'prepared' | 'disposing' | 'settled';

type CompilerDependencyStageIntent = Readonly<{
  schema: typeof COMPILER_DEPENDENCY_STAGE_INTENT_SCHEMA;
  intentDigest: `sha256:${string}`;
  previousIntentDigest: `sha256:${string}` | null;
  phase: CompilerDependencyStageIntentPhase;
  operationKey: `sha256:${string}`;
  operationId: string;
  operationInitialBudgetMs: number;
  ownerRoot: string;
  ownerRootPhysical: Readonly<GeneratedStatePhysicalIdentity>;
  stageRootPath: string;
  stageRootPhysical: Readonly<GeneratedStatePhysicalIdentity>;
  relativeStagePath: string;
  allowedDirectChildren: readonly string[];
  lifecycle: Readonly<{ owner: string; producer: string; ruleId: string }>;
  outcome: string | null;
}>;

type CompilerDependencyStageIntentUnsigned = Omit<CompilerDependencyStageIntent, 'intentDigest'>;

const COMPILER_DEPENDENCY_STAGE_INTENT_KEYS = Object.freeze([
  'allowedDirectChildren', 'intentDigest', 'lifecycle', 'operationId',
  'operationInitialBudgetMs', 'operationKey', 'outcome', 'ownerRoot',
  'ownerRootPhysical', 'phase', 'previousIntentDigest', 'relativeStagePath',
  'schema', 'stageRootPath', 'stageRootPhysical'
] as const);

function compilerDependencyStageIntent(
  input: CompilerDependencyStageIntentUnsigned
): CompilerDependencyStageIntent {
  const unsigned = Object.freeze({ ...input });
  return Object.freeze({
    ...unsigned,
    intentDigest: generatedStateDigest(canonicalJson(unsigned))
  });
}

function preparedCompilerDependencyStageIntent(input: Readonly<{
  operationId: string;
  operationInitialBudgetMs: number;
  ownerRoot: PhysicalDirectoryIdentity;
  stageRoot: DependencyTransitionSlot;
}>): CompilerDependencyStageIntent {
  const authority = compilerDependencyStageAuthority(input.ownerRoot.path);
  if (input.stageRoot.kind !== 'directory' || input.stageRoot.physical === null || authority.lifecycle === undefined) {
    throw new SecError('RUNTIME-DEPS-004', 'Compiler dependency staging root has no durable intent identity');
  }
  return compilerDependencyStageIntent({
    schema: COMPILER_DEPENDENCY_STAGE_INTENT_SCHEMA,
    previousIntentDigest: null,
    phase: 'prepared',
    operationKey: generatedStateDigest(Object.freeze({
      schema: 'sec-compiler-dependency-stage-operation-v1',
      operationId: input.operationId,
      ownerRoot: input.ownerRoot.path,
      ownerRootPhysical: generatedStatePhysicalIdentity(input.ownerRoot),
      stageRootPath: input.stageRoot.path,
      stageRootPhysical: input.stageRoot.physical
    })),
    operationId: input.operationId,
    operationInitialBudgetMs: input.operationInitialBudgetMs,
    ownerRoot: input.ownerRoot.path,
    ownerRootPhysical: generatedStatePhysicalIdentity(input.ownerRoot),
    stageRootPath: input.stageRoot.path,
    stageRootPhysical: input.stageRoot.physical,
    relativeStagePath: path.relative(input.ownerRoot.path, input.stageRoot.path).replaceAll('\\', '/'),
    allowedDirectChildren: authority.allowedDirectChildren,
    lifecycle: authority.lifecycle,
    outcome: null
  });
}

function compilerDependencyStageIntentBytes(intent: CompilerDependencyStageIntent): Buffer {
  return Buffer.from(formatJsonFile(canonicalJson(intent)), 'utf8');
}

function compilerDependencyStageIntentName(intent: CompilerDependencyStageIntent): string {
  return `stage-${intent.operationKey.slice('sha256:'.length)}-${intent.phase}.json`;
}

function parseCompilerDependencyStageIntent(
  bytes: Uint8Array,
  expectedName?: string
): CompilerDependencyStageIntent {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch {
    throw new SecError('RUNTIME-DEPS-002', 'Compiler dependency stage intent is not canonical JSON');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      !canonicalEquals(sortedKeys(value as Record<string, unknown>), COMPILER_DEPENDENCY_STAGE_INTENT_KEYS)) {
    throw new SecError('RUNTIME-DEPS-002', 'Compiler dependency stage intent has noncanonical keys');
  }
  const intent = value as CompilerDependencyStageIntent;
  const authority = compilerDependencyStageAuthority(intent.ownerRoot);
  const expectedRelativePath = path.relative(intent.ownerRoot, intent.stageRootPath).replaceAll('\\', '/');
  const expectedOperationKey = generatedStateDigest(Object.freeze({
    schema: 'sec-compiler-dependency-stage-operation-v1',
    operationId: intent.operationId,
    ownerRoot: path.resolve(intent.ownerRoot),
    ownerRootPhysical: intent.ownerRootPhysical,
    stageRootPath: path.resolve(intent.stageRootPath),
    stageRootPhysical: intent.stageRootPhysical
  }));
  if (intent.schema !== COMPILER_DEPENDENCY_STAGE_INTENT_SCHEMA ||
      !isSha256Digest(intent.intentDigest) ||
      (intent.previousIntentDigest !== null && !isSha256Digest(intent.previousIntentDigest)) ||
      !['prepared', 'disposing', 'settled'].includes(intent.phase) ||
      !isSha256Digest(intent.operationKey) ||
      intent.operationKey !== expectedOperationKey ||
      typeof intent.operationId !== 'string' || intent.operationId.length === 0 ||
      !Number.isSafeInteger(intent.operationInitialBudgetMs) || intent.operationInitialBudgetMs < 1 ||
      typeof intent.ownerRoot !== 'string' || !path.isAbsolute(intent.ownerRoot) ||
      !isGeneratedStatePhysicalIdentity(intent.ownerRootPhysical) ||
      typeof intent.stageRootPath !== 'string' || !path.isAbsolute(intent.stageRootPath) ||
      !isGeneratedStatePhysicalIdentity(intent.stageRootPhysical) ||
      typeof intent.relativeStagePath !== 'string' || intent.relativeStagePath !== expectedRelativePath ||
      path.dirname(path.resolve(intent.stageRootPath)) !== path.resolve(authority.parent) ||
      !path.basename(intent.stageRootPath).startsWith(authority.prefix) ||
      !Array.isArray(intent.allowedDirectChildren) ||
      !canonicalEquals(intent.allowedDirectChildren, authority.allowedDirectChildren) ||
      intent.lifecycle === null || typeof intent.lifecycle !== 'object' ||
      !canonicalEquals(sortedKeys(intent.lifecycle as unknown as Record<string, unknown>), ['owner', 'producer', 'ruleId']) ||
      intent.lifecycle.owner !== authority.lifecycle?.owner ||
      intent.lifecycle.producer !== authority.lifecycle?.producer ||
      intent.lifecycle.ruleId !== authority.lifecycle?.ruleId ||
      (intent.phase === 'settled' ? typeof intent.outcome !== 'string' || intent.outcome.length === 0 : intent.outcome !== null)) {
    throw new SecError('RUNTIME-DEPS-002', 'Compiler dependency stage intent is invalid or foreign');
  }
  const { intentDigest: _intentDigest, ...unsigned } = intent;
  if (compilerDependencyStageIntent(unsigned).intentDigest !== intent.intentDigest ||
      formatJsonFile(canonicalJson(intent)) !== Buffer.from(bytes).toString('utf8') ||
      (expectedName !== undefined && compilerDependencyStageIntentName(intent) !== expectedName)) {
    throw new SecError('RUNTIME-DEPS-002', 'Compiler dependency stage intent digest or bytes changed');
  }
  return Object.freeze(intent);
}

function assertCompilerDependencyStageIntentBytes(bytes: Uint8Array): void {
  parseCompilerDependencyStageIntent(bytes);
}

async function compilerDependencyStageIntentRoot(
  root: string,
  options: RuntimeDependencyOperationOptions,
  create: boolean
): Promise<PhysicalDirectoryIdentity | null> {
  const parentPath = path.join(path.resolve(root), '.tmp', 'dependency-installs');
  let parent: PhysicalDirectoryIdentity;
  try {
    parent = inspectNoFollowDirectoryChain(parentPath, 'Compiler dependency stage intent parent').target;
  } catch (error) {
    if (!create && error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') return null;
    throw error;
  }
  if (!create) {
    try {
      return inspectNoFollowDirectoryChain(
        path.join(parent.path, COMPILER_DEPENDENCY_STAGE_INTENT_DIRECTORY),
        'Compiler dependency stage intent root'
      ).target;
    } catch (error) {
      if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') return null;
      throw error;
    }
  }
  await runtimeDependencyOperationEffectFence(options, 'Compiler dependency stage intent namespace creation');
  return createNoFollowOrdinaryDirectoryChain(parent, [COMPILER_DEPENDENCY_STAGE_INTENT_DIRECTORY]);
}

async function writeCompilerDependencyStageIntent(
  root: string,
  intent: CompilerDependencyStageIntent,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  const intentRoot = await compilerDependencyStageIntentRoot(root, options, true);
  const name = compilerDependencyStageIntentName(intent);
  const bytes = compilerDependencyStageIntentBytes(intent);
  await runtimeDependencyOperationEffectFence(options, `Compiler dependency stage intent ${intent.phase} publication`);
  writeDurableTransitionFile(intentRoot!, name, bytes, assertCompilerDependencyStageIntentBytes, true);
  const readback = inspectNoFollowOrdinaryFileEntry(intentRoot!, name);
  if (readback === null || readback.bytes === null) {
    throw new SecError('RUNTIME-DEPS-002', 'Compiler dependency stage intent disappeared after publication');
  }
  parseCompilerDependencyStageIntent(readback.bytes, name);
}

async function advanceCompilerDependencyStageIntent(
  root: string,
  previous: CompilerDependencyStageIntent,
  phase: Exclude<CompilerDependencyStageIntentPhase, 'prepared'>,
  outcome: string | null,
  options: RuntimeDependencyOperationOptions
): Promise<CompilerDependencyStageIntent> {
  const { intentDigest: _intentDigest, ...priorUnsigned } = previous;
  const next = compilerDependencyStageIntent({
    ...priorUnsigned,
    previousIntentDigest: previous.intentDigest,
    phase,
    outcome
  });
  await writeCompilerDependencyStageIntent(root, next, options);
  return next;
}

async function readCompilerDependencyStageIntents(
  root: string,
  options: RuntimeDependencyOperationOptions
): Promise<Readonly<{
  active: readonly CompilerDependencyStageIntent[];
  representedStagePaths: ReadonlySet<string>;
}>> {
  const intentRoot = await compilerDependencyStageIntentRoot(root, options, false);
  if (intentRoot === null) {
    return Object.freeze({ active: Object.freeze([]), representedStagePaths: new Set<string>() });
  }
  const names = await readNoFollowDirectNames(
    intentRoot,
    'Compiler dependency stage intent census',
    COMPILER_DEPENDENCY_STAGE_INTENT_CAPACITY,
    options
  );
  const byOperation = new Map<string, Map<CompilerDependencyStageIntentPhase, CompilerDependencyStageIntent>>();
  const representedStagePaths = new Set<string>();
  for (const name of names) {
    if (!/^stage-[0-9a-f]{64}-(?:prepared|disposing|settled)\.json$/u.test(name)) {
      throw new SecError('RUNTIME-DEPS-004', 'Compiler dependency stage intent namespace contains unknown residue', { name });
    }
    const entry = inspectNoFollowOrdinaryFileEntry(intentRoot, name);
    if (entry === null || entry.bytes === null) {
      throw new SecError('RUNTIME-DEPS-004', 'Compiler dependency stage intent disappeared during census', { name });
    }
    const intent = parseCompilerDependencyStageIntent(entry.bytes, name);
    representedStagePaths.add(path.resolve(intent.stageRootPath));
    const phases = byOperation.get(intent.operationKey) ?? new Map();
    if (phases.has(intent.phase)) {
      throw new SecError('RUNTIME-DEPS-004', 'Compiler dependency stage intent has duplicate operation phase', {
        operationKey: intent.operationKey,
        phase: intent.phase
      });
    }
    phases.set(intent.phase, intent);
    byOperation.set(intent.operationKey, phases);
  }
  const active: CompilerDependencyStageIntent[] = [];
  for (const [operationKey, phases] of byOperation) {
    const prepared = phases.get('prepared');
    const disposing = phases.get('disposing');
    const settled = phases.get('settled');
    if (prepared === undefined ||
        (disposing !== undefined && disposing.previousIntentDigest !== prepared.intentDigest) ||
        (settled !== undefined && settled.previousIntentDigest !== disposing?.intentDigest) ||
        (settled !== undefined && disposing === undefined)) {
      throw new SecError('RUNTIME-DEPS-004', 'Compiler dependency stage intent chain is partial or foreign', { operationKey });
    }
    if (settled === undefined) active.push(disposing ?? prepared);
  }
  active.sort((left, right) => compareCodeUnits(left.operationKey, right.operationKey));
  return Object.freeze({ active: Object.freeze(active), representedStagePaths });
}

async function settleCompilerDependencyStageIntent(
  root: string,
  current: CompilerDependencyStageIntent,
  outcome: string,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  let disposing = current;
  if (disposing.phase === 'prepared') {
    disposing = await advanceCompilerDependencyStageIntent(root, disposing, 'disposing', null, options);
  }
  if (disposing.phase !== 'disposing') {
    throw new SecError('RUNTIME-DEPS-004', 'Compiler dependency stage intent is not disposal-authorized');
  }
  const stageRoot = await observeDependencyTransitionSlot(disposing.stageRootPath);
  if (stageRoot.kind === 'absent') {
    const lifecycle = options.generatedStateLifecycle;
    const settleAbsent = lifecycle?.settleAbsent;
    if (lifecycle === undefined || settleAbsent === undefined) {
      throw new SecError('RUNTIME-DEPS-004', 'Compiler dependency stage disappeared without lifecycle settlement authority');
    }
    await runtimeDependencyOperationEffectFence(options, 'Compiler dependency absent stage lifecycle settlement');
    const expected = Object.freeze({
      owner: disposing.lifecycle.owner,
      producer: disposing.lifecycle.producer,
      ruleId: disposing.lifecycle.ruleId,
      physical: disposing.stageRootPhysical
    });
    // A prior process may have durably retired the registration before it
    // failed to remove the pointer.  Close that already-authorized state
    // first; otherwise terminalize the exact active registration and prove
    // the resulting receipt.  Neither route grants generic cleanup authority.
    const settledRetired = await lifecycle.settleRetired?.(
      disposing.relativeStagePath,
      expected
    ) ?? false;
    if (!settledRetired) {
      const receipt = await settleAbsent(disposing.relativeStagePath, expected, outcome);
      if (receipt.schema !== 'sec-generated-state-absent-registration-settlement-v1' ||
          receipt.relativePath !== disposing.relativeStagePath ||
          receipt.outcome !== outcome || receipt.terminal !== 'disposed' ||
          !sameGeneratedStateIdentity(receipt.physical, disposing.stageRootPhysical)) {
        throw new SecError('RUNTIME-DEPS-004', 'Compiler dependency absent stage lifecycle receipt differs');
      }
    }
  } else {
    if (stageRoot.kind !== 'directory' || stageRoot.physical === null ||
        !sameGeneratedStateIdentity(stageRoot.physical, disposing.stageRootPhysical)) {
      throw new SecError('RUNTIME-DEPS-004', 'Compiler dependency stage intent root identity changed; residue is preserved', {
        stageRootPath: disposing.stageRootPath
      });
    }
    const nodeModulesPath = path.join(disposing.stageRootPath, 'node_modules');
    const nodeModules = await observeDependencyTransitionSlot(nodeModulesPath);
    await disposeDependencyTransitionStage(
      root,
      disposing.stageRootPath,
      options,
      outcome,
      nodeModules,
      stageRoot,
      compilerDependencyStageAuthority(root)
    );
  }
  const after = await observeDependencyTransitionSlot(disposing.stageRootPath);
  if (after.kind !== 'absent') {
    throw new SecError('RUNTIME-DEPS-004', 'Compiler dependency stage remained after intent settlement', {
      stageRootPath: disposing.stageRootPath,
      observed: after
    });
  }
  await advanceCompilerDependencyStageIntent(root, disposing, 'settled', outcome, options);
}

async function migrateRegisteredLegacyCompilerDependencyStages(
  root: string,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  const stageAuthority = compilerDependencyStageAuthority(root);
  if (stageAuthority.lifecycle === undefined) return;
  let parent: PhysicalDirectoryIdentity;
  try {
    parent = inspectNoFollowDirectoryChain(
      stageAuthority.parent,
      'Legacy compiler dependency stage parent'
    ).target;
  } catch (error) {
    if (error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_ABSENT') return;
    throw error;
  }
  const { representedStagePaths } = await readCompilerDependencyStageIntents(root, options);
  const directNames = await readNoFollowDirectNames(
    parent,
    'Legacy compiler dependency stage namespace census',
    COMPILER_DEPENDENCY_STAGE_INTENT_CAPACITY,
    options
  );
  const candidates = directNames
    .filter((name) => name.startsWith(stageAuthority.prefix))
    .map((name) => path.join(parent.path, name))
    .filter((stagePath) => !representedStagePaths.has(path.resolve(stagePath)));
  if (candidates.length === 0) return;
  if (options.generatedStateLifecycle?.bind === undefined) {
    throw new SecError('RUNTIME-DEPS-004', 'Legacy compiler dependency stages have no registration binding authority');
  }

  const { inspectGeneratedState } = await import('../../../runtime-state/generated-state/lifecycle.ts');
  const validated: Array<Readonly<{
    relativePath: string;
    stageRoot: DependencyTransitionSlot;
    registration: GeneratedStateRegistration;
  }>> = [];
  // Complete every selected physical and generated-state read before the
  // first durable migration intent. Direct siblings outside the registered
  // stage selector remain unclassified and untouched: their basename cannot
  // grant this owner either adoption or retirement authority, and they do not
  // invalidate an exact active registration for a disjoint physical root.
  for (const stagePath of candidates) {
    const stageRoot = await observeDependencyTransitionSlot(stagePath);
    if (stageRoot.kind !== 'directory' || stageRoot.physical === null) {
      throw new SecError('RUNTIME-DEPS-004', 'Legacy compiler dependency stage disappeared during census', { stagePath });
    }
    const stageIdentity = inspectNoFollowDirectoryChain(stagePath, 'Legacy compiler dependency stage').target;
    if (!sameGeneratedStateIdentity(generatedStatePhysicalIdentity(stageIdentity), stageRoot.physical)) {
      throw new SecError('RUNTIME-DEPS-004', 'Legacy compiler dependency stage physical identity changed during census');
    }
    const directChildren = scanNoFollowDirectoryTreeMetadata(stageIdentity, {
      deadlineAtMs: runtimeDependencyOperationDeadlineAt(options, 'Legacy compiler dependency stage closed-world census'),
      maximumEntries: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES,
      signal: runtimeDependencyOperationContext(options).signal
    }).filter((child) => !child.relativePath.includes('/'));
    const allowedChildren = new Set(stageAuthority.allowedDirectChildren);
    const unknownChildren = directChildren.filter(({ relativePath }) => !allowedChildren.has(relativePath));
    const invalidOwnedChildren = directChildren.filter(({ relativePath, kind }) =>
      (relativePath === 'node_modules' && kind !== 'directory') ||
      (relativePath !== 'node_modules' && kind !== 'file'));
    if (unknownChildren.length > 0 || invalidOwnedChildren.length > 0) {
      throw new SecError('RUNTIME-DEPS-004', 'Legacy compiler dependency stage has foreign or malformed descendants', {
        stagePath,
        unknownChildren: unknownChildren.map(({ relativePath }) => relativePath),
        invalidOwnedChildren: invalidOwnedChildren.map(({ relativePath, kind }) => ({ relativePath, kind }))
      });
    }
    const relativePath = path.relative(root, stagePath).replaceAll('\\', '/');
    runtimeDependencyOperationRemainingMs(options, 'Legacy compiler dependency registration inventory admission');
    const inventory = await inspectGeneratedState({
      repositoryRoot: root,
      workspaceRoot: root,
      relativePaths: [relativePath]
    });
    runtimeDependencyOperationRemainingMs(options, 'Legacy compiler dependency registration inventory readback');
    const observed = inventory.entries[0];
    if (inventory.entries.length !== 1 || observed === undefined ||
        observed.relativePath !== relativePath || observed.kind !== 'directory' ||
        observed.ruleId !== stageAuthority.lifecycle.ruleId ||
        observed.owner !== stageAuthority.lifecycle.owner ||
        observed.registrationState !== 'active' || observed.registrationDigest === null ||
        observed.physicalIdentity === null ||
        !sameGeneratedStateIdentity(observed.physicalIdentity, stageRoot.physical) ||
        !canonicalEquals(uniqueSorted(observed.blockers), ['owner-active'])) {
      throw new SecError('RUNTIME-DEPS-004', 'Legacy compiler dependency stage has no exact active registration receipt', {
        relativePath,
        observed: observed === undefined ? null : {
          blockers: observed.blockers,
          kind: observed.kind,
          owner: observed.owner,
          physicalIdentity: observed.physicalIdentity,
          registrationDigest: observed.registrationDigest,
          registrationState: observed.registrationState,
          ruleId: observed.ruleId
        }
      });
    }
    runtimeDependencyOperationRemainingMs(options, 'Legacy compiler dependency registration binding admission');
    const registration = await options.generatedStateLifecycle.bind(relativePath, {
      owner: stageAuthority.lifecycle.owner,
      producer: stageAuthority.lifecycle.producer,
      ruleId: stageAuthority.lifecycle.ruleId,
      physical: stageRoot.physical
    });
    runtimeDependencyOperationRemainingMs(options, 'Legacy compiler dependency registration binding readback');
    if (registration.phase !== 'active' || registration.relativePath !== relativePath ||
        registration.registrationDigest !== observed.registrationDigest ||
        !sameGeneratedStateIdentity(registration.root, stageRoot.physical)) {
      throw new SecError('RUNTIME-DEPS-004', 'Legacy compiler dependency registration changed after inventory');
    }
    validated.push(Object.freeze({ relativePath, stageRoot, registration }));
  }

  const ownerRoot = inspectNoFollowDirectoryChain(root, 'Legacy compiler dependency stage migration owner').target;
  for (const candidate of validated) {
    await runtimeDependencyOperationEffectFence(options, 'Legacy compiler dependency stage migration admission');
    const current = await observeDependencyTransitionSlot(candidate.stageRoot.path);
    if (!transitionSlotMatches(current, candidate.stageRoot)) {
      throw new SecError('RUNTIME-DEPS-004', 'Legacy compiler dependency stage changed before migration intent');
    }
    const prepared = preparedCompilerDependencyStageIntent({
      operationId: candidate.registration.operationId,
      operationInitialBudgetMs: runtimeDependencyOperationContext(options).initialBudgetMs,
      ownerRoot,
      stageRoot: candidate.stageRoot
    });
    await writeCompilerDependencyStageIntent(root, prepared, options);
    await settleCompilerDependencyStageIntent(
      root,
      prepared,
      'legacy-generation-staging-retired',
      options
    );
  }
}

async function recoverCompilerDependencyStageIntents(
  root: string,
  options: RuntimeDependencyOperationOptions,
  pendingTransition: DependencyTransitionJournal | null = null
): Promise<void> {
  const { active } = await readCompilerDependencyStageIntents(root, options);
  for (const intent of active) {
    const owner = inspectNoFollowDirectoryChain(root, 'Compiler dependency stage recovery owner').target;
    if (path.resolve(intent.ownerRoot) !== owner.path ||
        !sameGeneratedStateIdentity(generatedStatePhysicalIdentity(owner), intent.ownerRootPhysical)) {
      throw new SecError('RUNTIME-DEPS-004', 'Compiler dependency stage intent owner epoch changed; residue is preserved');
    }
    const transitionStageRoot = pendingTransition?.kind === 'compiler-generation' &&
        pendingTransition.phase !== 'complete' && pendingTransition.phase !== 'rolled-back'
      ? pendingTransition.stageRoot
      : null;
    if (intent.phase === 'prepared' && transitionStageRoot?.kind === 'directory' &&
        transitionStageRoot.physical !== null &&
        path.resolve(intent.stageRootPath) === path.resolve(transitionStageRoot.path) &&
        sameGeneratedStateIdentity(intent.stageRootPhysical, transitionStageRoot.physical)) {
      // Publication recovery owns this exact stage.  Settling its birth intent
      // first would delete the only durable source generation and turn a
      // recoverable v2 -> v3 transition into an endless reinstall loop.
      continue;
    }
    // The intent itself is the durable owner authorization.  Settlement must
    // also terminalize a stage that is already absent: the physical deletion
    // may have completed before the disposing record or lifecycle receipt was
    // durably published.  settleCompilerDependencyStageIntent advances the
    // intent first, disposes the exact lifecycle registration, proves absence,
    // and only then publishes the terminal record.
    await settleCompilerDependencyStageIntent(root, intent, 'generation-staging-recovered', options);
  }
}

function compilerDependencyStageAuthority(root: string): DependencyTransitionStageAuthority {
  return Object.freeze({
    parent: path.join(path.resolve(root), '.tmp', 'dependency-installs'),
    prefix: 'c.staging-',
    allowedDirectChildren: Object.freeze(['bun.lock', 'bunfig.toml', 'node_modules', 'package.json']),
    lifecycle: Object.freeze({
      owner: COMPILER_STAGING_LIFECYCLE_OWNER,
      producer: COMPILER_STAGING_LIFECYCLE_PRODUCER,
      ruleId: COMPILER_STAGING_LIFECYCLE_RULE
    })
  });
}

function runtimeDependencyStageAuthority(sharedDepsRoot: string): DependencyTransitionStageAuthority {
  return Object.freeze({
    parent: path.resolve(sharedDepsRoot),
    prefix: '.runtime-generation-',
    allowedDirectChildren: Object.freeze(['node_modules'])
  });
}

function projectDependencyStageAuthority(projectRoot: string): DependencyTransitionStageAuthority {
  return Object.freeze({
    parent: path.join(path.resolve(projectRoot), '.tmp'),
    prefix: 'project.staging-',
    allowedDirectChildren: Object.freeze(['node_modules'])
  });
}

async function disposeDependencyTransitionStage(
  root: string,
  stageRootPath: string,
  options: RuntimeDependencyOperationOptions,
  outcome: string,
  expectedStage: DependencyTransitionSlot | null,
  expectedStageRoot: DependencyTransitionSlot | null,
  authority: DependencyTransitionStageAuthority
): Promise<void> {
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition stage disposal admission');
  if (expectedStageRoot === null || expectedStageRoot.kind !== 'directory' ||
      expectedStageRoot.physical === null || path.resolve(expectedStageRoot.path) !== path.resolve(stageRootPath)) {
    throw new SecError(
      'RUNTIME-DEPS-004',
      'Dependency transition staging root has no operation-owned physical identity; residue is preserved',
      { stageRootPath, expectedStageRoot }
    );
  }
  const stageRootParent = path.resolve(authority.parent);
  const normalizedStageRootPath = path.resolve(stageRootPath);
  if (path.dirname(normalizedStageRootPath) !== stageRootParent ||
      !path.basename(normalizedStageRootPath).startsWith(authority.prefix)) {
    throw new SecError(
      'RUNTIME-DEPS-004',
      'Dependency transition staging root is outside its registered operation selector; residue is preserved',
      { stageRootPath, stageRootParent, prefix: authority.prefix }
    );
  }
  const stageRoot = await observeDependencyTransitionSlot(stageRootPath);
  if (stageRoot.kind === 'absent') return;
  if (!transitionSlotMatches(stageRoot, expectedStageRoot)) {
    throw new SecError(
      'RUNTIME-DEPS-004',
      'Dependency transition staging root identity changed; residue is preserved',
      { stageRootPath, expectedStageRoot, observedStageRoot: stageRoot }
    );
  }
  const stagePath = expectedStage?.path ?? null;
  if (stagePath !== null && (
      path.dirname(path.resolve(stagePath)) !== path.resolve(stageRootPath) ||
      path.basename(path.resolve(stagePath)) !== 'node_modules')) {
    throw new SecError(
      'RUNTIME-DEPS-004',
      'Dependency transition stage is not the recorded child of its staging root; residue is preserved',
      { stagePath, stageRootPath }
    );
  }
  const stage = stagePath === null ? null : await observeDependencyTransitionSlot(stagePath);
  if (expectedStage !== null) {
    if (!transitionSlotMatches(stage!, expectedStage)) {
      throw new SecError(
        'RUNTIME-DEPS-004',
        'Dependency transition stage identity changed; residue is preserved',
        { stagePath, expectedStage, observedStage: stage }
      );
    }
  } else if (stage !== null && stage.kind !== 'absent') {
    throw new SecError(
      'RUNTIME-DEPS-004',
      'Dependency transition staging root contains an unrecorded child; residue is preserved',
      { stageRootPath, observedStage: stage }
    );
  }
  if (expectedStage === null) {
    const unrecorded = scanNoFollowDirectoryTreeMetadata(
      inspectNoFollowDirectoryChain(stageRootPath, 'Dependency transition empty staging root').target,
      {
        deadlineAtMs: runtimeDependencyOperationDeadlineAt(options, 'Dependency transition empty staging root census'),
        maximumEntries: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES,
        signal: runtimeDependencyOperationContext(options).signal
      }
    );
    if (unrecorded.length > 0) {
      throw new SecError(
        'RUNTIME-DEPS-004',
        'Dependency transition staging root has unrecorded residue; it is preserved',
        { stageRootPath, entryCount: unrecorded.length }
      );
    }
  }
  // The generated-state lifecycle is itself an Effect owner and may remove
  // the complete root.  Establish the closed-world physical preimage before
  // invoking it; otherwise a foreign child could be swept by that owner and
  // disappear before the retained inventory below observes it.
  const preLifecycleRoot = inspectNoFollowDirectoryChain(
    stageRootPath,
    'Dependency transition staging lifecycle preimage'
  ).target;
  if (!sameGeneratedStateIdentity(
    generatedStatePhysicalIdentity(preLifecycleRoot),
    expectedStageRoot.physical
  )) {
    throw new SecError(
      'RUNTIME-DEPS-004',
      'Dependency transition staging root changed before lifecycle settlement; residue is preserved'
    );
  }
  const preLifecycleDirectChildren = scanNoFollowDirectoryTreeMetadata(preLifecycleRoot, {
    deadlineAtMs: runtimeDependencyOperationDeadlineAt(options, 'Dependency transition staging lifecycle preimage census'),
    maximumEntries: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES,
    signal: runtimeDependencyOperationContext(options).signal
  }).filter((entry) => !entry.relativePath.includes('/'));
  const declaredChildren = new Set(authority.allowedDirectChildren);
  const foreignPreimageChildren = preLifecycleDirectChildren
    .filter(({ relativePath }) => !declaredChildren.has(relativePath));
  if (foreignPreimageChildren.length > 0) {
    throw new SecError(
      'RUNTIME-DEPS-004',
      'Dependency transition staging root contains unknown operation descendants; residue is preserved',
      { stageRootPath, unknownDirectChildren: foreignPreimageChildren.map(({ relativePath }) => relativePath) }
    );
  }
  const relativeStagePath = path.relative(root, stageRootPath).replaceAll('\\', '/');
  if (options.generatedStateLifecycle !== undefined) {
    if (authority.lifecycle !== undefined) {
      const bind = options.generatedStateLifecycle.bind;
      if (bind === undefined) {
        throw new SecError(
          'RUNTIME-DEPS-004',
          'Dependency transition staging root has no read-only lifecycle binding path; residue is preserved',
          { stageRootPath }
        );
      }
      await runtimeDependencyOperationEffectFence(options, 'Dependency transition staging lifecycle bind');
      await bind(relativeStagePath, {
        owner: authority.lifecycle.owner,
        producer: authority.lifecycle.producer,
        ruleId: authority.lifecycle.ruleId,
        physical: generatedStatePhysicalIdentity(expectedStageRoot.physical)
      });
    }
    // Lifecycle disposal is an authority-bearing operation.  A missing,
    // foreign, or stale registration must block and preserve the stage; the
    // physical inventory below is only the second half of a successful
    // operation-owned disposal, never a provenance fallback.  Swallowing the
    // lifecycle error would let a forged journal turn an arbitrary directory
    // into deletion authority after the validation interval.
    await runtimeDependencyOperationEffectFence(options, 'Dependency transition staging lifecycle disposal');
    await options.generatedStateLifecycle.disposed(relativeStagePath, outcome);
    runtimeDependencyOperationRemainingMs(options, 'Dependency transition staging lifecycle disposal readback');
    const afterLifecycleRoot = await observeDependencyTransitionSlot(stageRootPath);
    if (afterLifecycleRoot.kind === 'absent') return;
    if (!transitionSlotMatches(afterLifecycleRoot, expectedStageRoot)) {
      throw new SecError(
        'RUNTIME-DEPS-004',
        'Dependency transition staging root changed during lifecycle disposal; residue is preserved',
        { stageRootPath, expectedStageRoot, observedStageRoot: afterLifecycleRoot }
      );
    }
    if (expectedStage !== null) {
      const afterLifecycleStage = await observeDependencyTransitionSlot(stagePath!);
      if (!transitionSlotMatches(afterLifecycleStage, expectedStage)) {
        throw new SecError(
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
  const stageRootIdentity = inspectNoFollowDirectoryChain(
    stageRootPath,
    'Dependency transition staging root cleanup'
  ).target;
  if (!sameGeneratedStateIdentity(
    generatedStatePhysicalIdentity(stageRootIdentity),
    expectedStageRoot.physical
  )) {
    throw new SecError(
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
  const directChildren = scanNoFollowDirectoryTreeMetadata(stageRootIdentity, {
    deadlineAtMs: runtimeDependencyOperationDeadlineAt(options, 'Dependency transition staging direct-child census'),
    maximumEntries: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES,
    signal: runtimeDependencyOperationContext(options).signal
  }).filter((entry) => !entry.relativePath.includes('/'));
  const allowedDirectChildren = new Set(authority.allowedDirectChildren);
  const unknownDirectChildren = directChildren.filter(({ relativePath }) => !allowedDirectChildren.has(relativePath));
  if (unknownDirectChildren.length > 0) {
    throw new SecError(
      'RUNTIME-DEPS-004',
      'Dependency transition staging root contains unknown operation descendants; residue is preserved',
      { stageRootPath, unknownDirectChildren: unknownDirectChildren.map(({ relativePath }) => relativePath) }
    );
  }
  const inventory = scanNoFollowDirectoryTreeMetadata(stageRootIdentity, {
    deadlineAtMs: runtimeDependencyOperationDeadlineAt(options, 'Dependency transition staging disposal inventory'),
    maximumEntries: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_ENTRIES,
    signal: runtimeDependencyOperationContext(options).signal
  });
  const byPath = new Map(inventory.map((entry) => [entry.relativePath, entry]));
  const ordered = [...inventory].sort((left, right) => {
    const depth = (value: string): number => value.split('/').length;
    return depth(right.relativePath) - depth(left.relativePath) || compareCodeUnits(right.relativePath, left.relativePath);
  });
  for (const entry of ordered) {
    await runtimeDependencyOperationEffectFence(options, 'Dependency transition staging descendant disposal');
    const parts = entry.relativePath.split('/');
    parts.pop();
    const ancestors = parts.map((_, index) => parts.slice(0, index + 1).join('/'))
      .map((relativePath) => {
        const ancestor = byPath.get(relativePath);
        if (ancestor === undefined || ancestor.kind !== 'directory') {
          throw new SecError('RUNTIME-DEPS-002', 'Dependency transition stage inventory has an incomplete ancestor chain');
        }
        return Object.freeze({
          relativePath,
          device: ancestor.device,
          inode: ancestor.inode
        });
      });
    deleteRetainedNoFollowEntry({
      root: stageRootIdentity,
      relativePath: entry.relativePath,
      kind: entry.kind,
      device: entry.device,
      inode: entry.inode,
      expectedLinkTarget: entry.linkTarget ?? undefined,
      ancestorDirectories: ancestors
    });
  }
  const currentStageRoot = await observeDependencyTransitionSlot(stageRootPath);
  if (!transitionSlotMatches(currentStageRoot, expectedStageRoot)) {
    throw new SecError(
      'RUNTIME-DEPS-004',
      'Dependency transition staging root changed before final disposal; residue is preserved',
      { stageRootPath, expectedStageRoot, observedStageRoot: currentStageRoot }
    );
  }
  const parent = inspectNoFollowDirectoryChain(path.dirname(stageRootPath), 'Dependency transition staging root parent').target;
  await runtimeDependencyOperationEffectFence(options, 'Dependency transition staging root disposal');
  deleteRetainedNoFollowEntry({
    root: parent,
    relativePath: path.basename(stageRootPath),
    kind: 'directory',
    device: expectedStageRoot.physical.device,
    inode: expectedStageRoot.physical.inode,
    ancestorDirectories: Object.freeze([])
  });
  runtimeDependencyOperationRemainingMs(options, 'Dependency transition staging root disposal readback');
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
      !isRuntimeDependencySourceGeneration(stamp.sourceGeneration) ||
      !isRuntimeDependencyTargetIdentity(stamp.target) ||
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
    !isRuntimeDependencySourceGeneration(stamp.sourceGeneration) ||
    !isRuntimeDependencyTargetIdentity(stamp.target) ||
    Number.isNaN(Date.parse(stamp.installedAt)) ||
    new Date(stamp.installedAt).toISOString() !== stamp.installedAt ||
    !canonicalEquals(stamp, canonical)) {
    throw new SecError('RUNTIME-DEPS-002', 'Runtime dependency stamp is non-canonical');
  }
  const parent = inspectNoFollowDirectoryChain(
    path.dirname(path.resolve(stampPath)),
    'Runtime dependency stamp parent'
  ).target;
  const name = path.basename(stampPath);
  const bytes = Buffer.from(formatJsonFile(canonical), 'utf8');
  const validate = (candidate: Uint8Array): void => {
    if (!Buffer.from(candidate).equals(bytes)) {
      throw new SecError('RUNTIME-DEPS-002', 'Runtime dependency stamp canonical bytes changed');
    }
  };
  await commitFence?.();
  const existing = inspectNoFollowOrdinaryFileEntry(parent, name);
  if (existing === null) {
    publishExclusiveDurableCanonicalFile({ parent, name, bytes, validate });
  } else {
    replaceDurableCanonicalFile({
      parent,
      name,
      bytes,
      expectedExisting: { device: existing.device, inode: existing.inode },
      validate
    });
  }
  await commitFence?.();
  const readback = readNoFollowOrdinaryFile(parent, name);
  if (readback === null || !Buffer.from(readback).equals(bytes)) {
    throw new SecError(
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
  try {
    // The runtime binding owns its resolved package closure, not every sibling
    // package in the compiler's shared node_modules generation. Exact closure
    // observation already binds every root, edge, target and manifest; a
    // full-directory equality check incorrectly rejects legitimate compiler
    // providers such as an aliased native TypeScript checker.
    const observed = await observeRuntimeDependencyMaterializationBinding({
      nodeModulesPath: input.nodeModulesPath,
      root: input.root,
      runtimeSpec: input.runtimeSpec,
      toolchain: input.expected.toolchain
    });
    return canonicalEquals(observed, input.expected);
  } catch (error) {
    if (isFileNotFoundError(error)) return false;
    throw error;
  }
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
): PhysicalDirectoryIdentity | null {
  const presence = inspectExactNoFollowDirectoryPresence(
    path.resolve(directoryPath),
    'Shared dependency authority root'
  );
  if (presence.state === 'absent') {
    if (allowMissing) return null;
    throw new SecError('RUNTIME-DEPS-002', 'Shared dependency authority root is absent');
  }
  return presence.directory.target;
}

async function ensurePhysicalSharedDependencyRoot(
  sharedDepsRoot: string,
  commitFence?: CommitFence
): Promise<Readonly<{ identity: PhysicalDirectoryIdentity; created: boolean }>> {
  const existing = physicalSharedDependencyDirectory(sharedDepsRoot, true);
  if (existing !== null) return Object.freeze({ identity: existing, created: false });
  const parentPath = path.dirname(path.resolve(sharedDepsRoot));
  const parent = physicalSharedDependencyDirectory(parentPath, false);
  if (parent === null) {
    throw new SecError('RUNTIME-DEPS-002', 'Shared dependency authority parent is unavailable');
  }
  await commitFence?.();
  const currentParent = physicalSharedDependencyDirectory(parentPath, false);
  if (currentParent === null || !sameGeneratedStateIdentity(
    generatedStatePhysicalIdentity(currentParent),
    generatedStatePhysicalIdentity(parent)
  )) {
    throw new SecError('RUNTIME-DEPS-002', 'Shared dependency authority parent changed before creation');
  }
  const name = path.basename(path.resolve(sharedDepsRoot));
  try {
    const created = createExclusiveNoFollowDirectory(parent, name);
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
    if (currentParent === null || !sameGeneratedStateIdentity(
      generatedStatePhysicalIdentity(currentParent),
      generatedStatePhysicalIdentity(parent)
    )) {
      throw error;
    }
    const current = physicalSharedDependencyDirectory(sharedDepsRoot, true);
    if (current === null) throw error;
    return Object.freeze({ identity: current, created: false });
  }
}

async function assertSharedDependencyRootIdentity(
  expected: PhysicalDirectoryIdentity
): Promise<void> {
  const current = physicalSharedDependencyDirectory(expected.path, false);
  if (current === null || !sameGeneratedStateIdentity(
    generatedStatePhysicalIdentity(current),
    generatedStatePhysicalIdentity(expected)
  )) {
    throw new SecError('RUNTIME-DEPS-002', 'Shared dependency authority identity changed');
  }
}

async function assertNoSharedDependencyAuthorityResidue(sharedDepsRoot: string): Promise<void> {
  const residue = await sharedDependencyAuthorityResidue(sharedDepsRoot);
  if (residue.length > 0) {
    throw new SecError(
      'RUNTIME-DEPS-002',
      `Shared dependency root contains competing authority files: ${residue.join(', ')}`,
      { residue }
    );
  }
}

async function copyPhysicalTrees(input: Readonly<{
  options: RuntimeDependencyOperationOptions;
  includeRelativePaths?: readonly string[];
  invalidSource: (detail: 'changed' | 'reparse' | 'special') => Error;
  maximumEntries?: number;
  roots: readonly Readonly<{ source: string; target: string }>[];
  skipNestedNodeModules?: boolean;
}>): Promise<void> {
  try {
    await copyNoFollowDirectoryTreesBulk(
      input.roots.map((root) => Object.freeze({
        source: inspectNoFollowDirectoryChain(root.source, 'Physical tree bulk source').target,
        target: root.target
      })),
      {
        assertCurrent: async () => runtimeDependencyOperationEffectFence(
          input.options,
          'Runtime dependency bulk copy'
        ),
        deadlineAtMs: runtimeDependencyOperationDeadlineAt(
          input.options,
          'Runtime dependency bulk copy deadline'
        ),
        includeRelativePaths: input.includeRelativePaths,
        maximumEntries: input.maximumEntries,
        maximumBytes: RUNTIME_DEPENDENCY_SOURCE_MAXIMUM_BYTES,
        signal: runtimeDependencyOperationContext(input.options).signal,
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
  options: RuntimeDependencyOperationOptions;
  sharedDepsRoot: string;
  sourceNodeModulesPath: string;
}>): Promise<{
  nodeModulesPath: string;
  root: string;
  rootSlot: DependencyTransitionSlot;
  }> {
  await runtimeDependencyOperationEffectFence(input.options, 'Runtime dependency staging-root creation');
  const sharedDepsRoot = inspectNoFollowDirectoryChain(
    input.sharedDepsRoot,
    'Runtime dependency staging parent'
  ).target;
  const stagingRoot = createExclusiveNoFollowRandomDirectory(
    sharedDepsRoot,
    '.runtime-generation-'
  ).path;
  const nodeModulesPath = path.join(stagingRoot, 'node_modules');
  const stagingRootSlot = await observeDependencyTransitionSlot(stagingRoot);
  try {
    await copyPhysicalTrees({
      options: input.options,
      invalidSource: (detail) => new SecError(
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
      await disposeDependencyTransitionStage(
        input.sharedDepsRoot,
        stagingRoot,
        input.options,
        'runtime-projection-staging-failed',
        null,
        stagingRootSlot,
        runtimeDependencyStageAuthority(input.sharedDepsRoot)
      );
    } catch (disposeError) {
      throw new SecError('RUNTIME-DEPS-004', 'Runtime dependency staging residue is preserved for recovery', {
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
  options: RuntimeDependencyOperationOptions;
  sourceGeneration: Readonly<RuntimeDependencySourceGeneration>;
  stagingNodeModulesPath: string;
  stagingRoot: string;
}>): Promise<void> {
  const namespace = await ensureDependencyTransitionNamespace(input.compilerRoot, input.options);
  const backupPath = path.join(
    namespace.backupRoot.path,
    `runtime-${input.sourceGeneration.epoch.slice('sha256:'.length, 'sha256:'.length + 24)}`
  );
  const publishOptions = runtimeDependencyOperationOptions({
    ...input.options,
    beforeCommit: input.commitFence
  });
  let transition = await beginDependencyTransition({
    kind: 'runtime-projection',
    ownerRoot: input.compilerRoot,
    destinationPath: input.activeNodeModulesPath,
    stagePath: input.stagingNodeModulesPath,
    stageRootPath: input.stagingRoot,
    backupPath,
    sourceGeneration: input.sourceGeneration,
    bindingDigest: generatedStateDigest(input.binding),
    options: publishOptions
  });
  let activeBackedUp = false;
  try {
    if (transition.preimage.kind !== 'absent') {
      if (transition.preimage.kind !== 'directory') {
        throw new SecError('RUNTIME-DEPS-004', 'Existing shared dependency target is foreign and preserved');
      }
      await renameCompilerDependencyDirectory(
        input.activeNodeModulesPath,
        backupPath,
        publishOptions
      );
      activeBackedUp = true;
      transition = await advanceDependencyTransition(transition, {
        destination: transitionAbsentSlot(input.activeNodeModulesPath),
        backup: await observeDependencyTransitionSlot(backupPath),
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
    transition = await advanceDependencyTransition(transition, {
      destination: await observeDependencyTransitionSlot(
        input.activeNodeModulesPath,
        generatedStateDigest(input.binding)
      ),
      stage: transitionAbsentSlot(input.stagingNodeModulesPath),
      // `sourceGeneration` remains the immutable compiler/shared source. The
      // copied active projection is represented only by `destination`; never
      // rewrite sourcePath to the destination and conflate the two identities.
      phase: 'published',
      durability: 'known',
      failure: null
    }, publishOptions);
  } catch (error) {
    const active = await observeDependencyTransitionSlot(input.activeNodeModulesPath).catch(() => null);
    const backup = await observeDependencyTransitionSlot(backupPath).catch(() => null);
    const stage = await observeDependencyTransitionSlot(input.stagingNodeModulesPath).catch(() => null);
    const recoveryRequired = active !== null && backup !== null && stage !== null &&
      (active.kind === 'absent' || backup.kind === 'directory' || stage.kind === 'directory');
    if (recoveryRequired) {
      await markDependencyTransitionFailure(transition, error, publishOptions).catch(() => undefined);
    }
    throw new SecError('RUNTIME-DEPS-002', 'Runtime dependency projection publish failed', {
      cause: error instanceof Error ? error.message : String(error),
      recoveryRequired,
      transitionDigest: transition.recordDigest
    });
  }
  await input.commitFence();
  await disposeDependencyTransitionStage(
    input.compilerRoot,
    input.stagingRoot,
    publishOptions,
    'runtime-projection-published',
    transition.stage,
    transition.stageRoot,
    runtimeDependencyStageAuthority(path.dirname(input.stagingRoot))
  );
  transition = await advanceDependencyTransition(transition, {
    stageRoot: transitionAbsentSlot(input.stagingRoot),
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
  options: RuntimeDependencyOperationOptions;
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
  let sourceGeneration: RuntimeDependencySourceGeneration | null;
  try {
    sourceGeneration = await runtimeDependencySourceGeneration({
      binding,
      options: input.options,
      ownerRoot: compilerGenerationOwnerRoot,
      sourcePath: compilerGenerationPath
    });
  } catch (error) {
    if (isFileNotFoundError(error)) return null;
    throw error;
  }
  const target = await runtimeDependencyTargetIdentity(input.nodeModulesPath);
  if (sourceGeneration === null || target === null ||
    sourceGeneration.epoch !== stamp.sourceGeneration.epoch ||
    !sameRuntimeDependencySourceGenerationContent(sourceGeneration, stamp.sourceGeneration) ||
    !sameGeneratedStateIdentity(sourceGeneration.physical, stamp.sourceGeneration.physical) ||
    !sameGeneratedStateIdentity(sourceGeneration.ownerRootPhysical, stamp.sourceGeneration.ownerRootPhysical) ||
    target.kind !== stamp.target.kind || target.linkTarget !== stamp.target.linkTarget ||
    !sameGeneratedStateIdentity(target.physical, stamp.target.physical)) return null;
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
    throw new SecError(
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

type NoFollowOwnedFileObservation = Readonly<{
  parent: PhysicalDirectoryIdentity;
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
function observeNoFollowOwnedFile(
  filePath: string,
  label: string
): NoFollowOwnedFileObservation | null {
  const parent = inspectNoFollowDirectoryChain(path.dirname(filePath), `${label} parent`).target;
  const name = path.basename(filePath);
  const entry = inspectNoFollowOrdinaryFileEntry(parent, name);
  if (entry === null) return null;
  if (entry.kind !== 'file') {
    throw new SecError('RUNTIME-DEPS-003', `${label} is occupied by a non-file identity and is preserved`, {
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

function sameNoFollowOwnedFileObservation(
  left: NoFollowOwnedFileObservation,
  right: NoFollowOwnedFileObservation
): boolean {
  return left.parent.path === right.parent.path &&
    left.parent.device === right.parent.device &&
    left.parent.inode === right.parent.inode &&
    left.parent.objectId === right.parent.objectId &&
    left.name === right.name && left.device === right.device &&
    left.inode === right.inode && left.size === right.size;
}

function readNoFollowOwnedFileJson(
  observation: NoFollowOwnedFileObservation,
  label: string
): unknown {
  const before = observeNoFollowOwnedFile(
    path.join(observation.parent.path, observation.name),
    `${label} read`
  );
  if (before === null || !sameNoFollowOwnedFileObservation(before, observation)) {
    throw new SecError('RUNTIME-DEPS-003', `${label} identity changed before read and is preserved`);
  }
  const bytes = readNoFollowOrdinaryFile(observation.parent, observation.name);
  if (bytes === null) {
    throw new SecError('RUNTIME-DEPS-003', `${label} disappeared during read and is preserved`);
  }
  const after = observeNoFollowOwnedFile(
    path.join(observation.parent.path, observation.name),
    `${label} readback`
  );
  if (after === null || !sameNoFollowOwnedFileObservation(after, observation)) {
    throw new SecError('RUNTIME-DEPS-003', `${label} identity changed during read and is preserved`);
  }
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

function deleteNoFollowOwnedFile(
  filePath: string,
  expected: NoFollowOwnedFileObservation,
  label: string
): void {
  const current = observeNoFollowOwnedFile(filePath, `${label} cleanup`);
  if (current === null) return;
  if (!sameNoFollowOwnedFileObservation(current, expected)) {
    throw new SecError('RUNTIME-DEPS-003', `${label} identity changed before exact cleanup and is preserved`, {
      path: filePath
    });
  }
  deleteRetainedNoFollowEntry({
    root: expected.parent,
    relativePath: expected.name,
    kind: 'file',
    device: expected.device,
    inode: expected.inode,
    ancestorDirectories: []
  });
}

const INSTALL_LOCK_DELETE_MAX_ATTEMPTS = 8;
const WINDOWS_TRANSIENT_DELETE_CODES = new Set(['EACCES', 'EBUSY', 'EPERM']);

/**
 * Windows may transiently reject deletion of an ordinary lock file even
 * while its retained identity remains unchanged.  The dependency owner owns
 * that retry policy; the generic physical primitive remains one strict
 * retained-identity effect.  Every retry re-observes both physical identity
 * and owner bytes, consumes the original operation deadline/signal/poll
 * ledger, and treats absence as the only successful terminal readback.
 */
async function settleInstallLockOwnedFileDeletion(input: Readonly<{
  assertExpected(observation: NoFollowOwnedFileObservation): void;
  expected: NoFollowOwnedFileObservation;
  filePath: string;
  label: string;
  options: RuntimeDependencyOperationOptions;
}>): Promise<'absent' | 'deleted'> {
  const hostPlatform = input.options.testInstallLockDeletePlatform ?? process.platform;
  const sleep = input.options.sleep ?? sleepMs;
  for (let attempt = 1; attempt <= INSTALL_LOCK_DELETE_MAX_ATTEMPTS; attempt += 1) {
    const current = observeNoFollowOwnedFile(input.filePath, `${input.label} settlement`);
    if (current === null) return 'absent';
    if (!sameNoFollowOwnedFileObservation(current, input.expected)) {
      throw new SecError(
        'RUNTIME-DEPS-003',
        `${input.label} identity changed during deletion settlement; replacement is preserved`,
        { attempt, filePath: input.filePath, outcome: 'preserved-replacement' }
      );
    }
    input.assertExpected(current);
    try {
      await input.options.testInstallLockDelete?.(input.filePath, attempt);
      deleteNoFollowOwnedFile(input.filePath, input.expected, input.label);
      if (observeNoFollowOwnedFile(input.filePath, `${input.label} absence readback`) === null) {
        return 'deleted';
      }
      throw Object.assign(new Error(`${input.label} remained after exact deletion`), { code: 'EBUSY' });
    } catch (error) {
      const afterFailure = observeNoFollowOwnedFile(input.filePath, `${input.label} retry readback`);
      if (afterFailure === null) return 'deleted';
      if (!sameNoFollowOwnedFileObservation(afterFailure, input.expected)) {
        throw new SecError(
          'RUNTIME-DEPS-003',
          `${input.label} was replaced after deletion failure and is preserved`,
          {
            attempt,
            deleteFailure: runtimeDependencyFailureEvidence(error),
            filePath: input.filePath,
            outcome: 'preserved-replacement'
          }
        );
      }
      input.assertExpected(afterFailure);
      const code = (error as NodeJS.ErrnoException).code;
      if (hostPlatform !== 'win32' || code === undefined ||
          !WINDOWS_TRANSIENT_DELETE_CODES.has(code)) throw error;
      if (attempt === INSTALL_LOCK_DELETE_MAX_ATTEMPTS) {
        throw new SecError(
          'RUNTIME-DEPS-003',
          `${input.label} deletion settlement remained unknown after bounded Windows retries`,
          {
            attempt,
            deleteFailure: runtimeDependencyFailureEvidence(error),
            filePath: input.filePath,
            outcome: 'unknown'
          }
        );
      }
      try {
        runtimeDependencyOperationRemainingMs(input.options, `${input.label} deletion retry`);
        await waitForRuntimeDependencyOperation(
          input.options,
          runtimeDependencyOperationContext(input.options).pollIntervalMs,
          sleep,
          `${input.label} Windows deletion retry`
        );
      } catch (deadlineOrAbort) {
        throw new SecError(
          'RUNTIME-DEPS-003',
          `${input.label} deletion settlement deadline or cancellation left an unknown exact identity`,
          {
            attempt,
            deleteFailure: runtimeDependencyFailureEvidence(error),
            filePath: input.filePath,
            outcome: 'unknown',
            settlementFailure: runtimeDependencyFailureEvidence(deadlineOrAbort)
          }
        );
      }
    }
  }
  throw new Error('Unreachable install lock deletion settlement state.');
}

function parseInstallLockOwner(value: unknown): InstallLockOwner | null {
  return isInstallLockOwner(value) ? value : null;
}

async function reclaimOrphanInstallLock(
  lockPath: string,
  options: RuntimeDependencyOperationOptions
): Promise<boolean> {
  const reclaimPath = `${lockPath}.reclaim`;
  let reclaimMarker: Readonly<{
    bytes: Buffer;
    observation: NoFollowOwnedFileObservation;
  }> | null = null;
  try {
    const reclaimParent = inspectNoFollowDirectoryChain(path.dirname(reclaimPath), 'Install lock reclaim marker parent').target;
    const reclaimToken = crypto.randomUUID();
    const reclaimBytes = Buffer.from(`${reclaimToken}\n`, 'utf8');
    try {
      publishExclusiveDurableCanonicalFile({
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
    const reclaimObservation = observeNoFollowOwnedFile(reclaimPath, 'Install lock reclaim marker');
    if (reclaimObservation === null) {
      throw new SecError('RUNTIME-DEPS-003', 'Install lock reclaim marker disappeared after exclusive publication');
    }
    reclaimMarker = Object.freeze({ bytes: reclaimBytes, observation: reclaimObservation });

    const lockObservation = observeNoFollowOwnedFile(lockPath, 'Install lock orphan candidate');
    if (lockObservation === null) return true;
    const owner = parseInstallLockOwner(readNoFollowOwnedFileJson(lockObservation, 'Install lock orphan candidate'));
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
    await settleInstallLockOwnedFileDeletion({
      assertExpected: (current) => {
        const currentOwner = parseInstallLockOwner(
          readNoFollowOwnedFileJson(current, 'Install lock orphan candidate retry')
        );
        if (currentOwner?.token !== owner.token) {
          throw new SecError(
            'RUNTIME-DEPS-003',
            'Install lock orphan candidate bytes changed during deletion settlement; current owner is preserved'
          );
        }
      },
      expected: lockObservation,
      filePath: lockPath,
      label: 'Install lock orphan candidate',
      options
    });
    return true;
  } finally {
    if (reclaimMarker !== null) {
      const { bytes: reclaimBytes, observation: reclaimObservation } = reclaimMarker;
      await settleInstallLockOwnedFileDeletion({
        assertExpected: (current) => {
          const bytes = readNoFollowOrdinaryFile(current.parent, current.name);
          if (bytes === null || !Buffer.from(bytes).equals(reclaimBytes)) {
            throw new SecError(
              'RUNTIME-DEPS-003',
              'Install lock reclaim marker bytes changed during deletion settlement; residue is preserved'
            );
          }
        },
        expected: reclaimObservation,
        filePath: reclaimPath,
        label: 'Install lock reclaim marker',
        options
      });
    }
  }
}

async function reclaimLockIsActive(reclaimPath: string): Promise<boolean> {
  return observeNoFollowOwnedFile(reclaimPath, 'Install lock reclaim marker') !== null;
}

function runtimeDependencyFailureEvidence(error: unknown): Readonly<{
  code: string | null;
  details: unknown;
  message: string;
  name: string;
}> {
  const value = error instanceof Error ? error : new Error(String(error));
  const code = 'code' in value && typeof value.code === 'string' ? value.code : null;
  return Object.freeze({
    code,
    details: value instanceof SecError ? value.details : null,
    message: value.message.slice(0, 1_024),
    name: value.name
  });
}

function runtimeDependencyInstallLockSettlementFailure(input: Readonly<{
  callbackFailure?: unknown;
  cleanupFailure?: unknown;
  fenceFailure?: unknown;
  lockPath: string;
}>): SecError {
  return new SecError(
    'RUNTIME-DEPS-003',
    'Runtime dependency install lock settlement failed; exact failure evidence is preserved',
    {
      failureOrder: Object.freeze(['primary', 'fence', 'cleanup']),
      callbackFailure: input.callbackFailure === undefined
        ? null
        : runtimeDependencyFailureEvidence(input.callbackFailure),
      fenceFailure: input.fenceFailure === undefined
        ? null
        : runtimeDependencyFailureEvidence(input.fenceFailure),
      cleanupFailure: input.cleanupFailure === undefined
        ? null
        : runtimeDependencyFailureEvidence(input.cleanupFailure),
      lockPath: input.lockPath
    }
  );
}

async function withInstallLock<T>(
  lockPath: string,
  options: RuntimeDependencyInstallOptions,
  callback: () => Promise<T>
): Promise<T> {
  const operationOptions = runtimeDependencyOperationOptions(options);
  const context = runtimeDependencyOperationContext(operationOptions);
  const pollIntervalMs = context.pollIntervalMs;
  const sleep = operationOptions.sleep ?? sleepMs;
  let owner: InstallLockOwner | null = null;
  let ownerObservation: NoFollowOwnedFileObservation | null = null;

  // Every caller admits the lock below an already-created owner namespace.
  // Reopening that namespace through the no-follow chain prevents a redirected
  // parent from becoming the lease's hidden second authority.
  runtimeDependencyOperationRemainingMs(operationOptions, 'Install lock parent admission');
  inspectNoFollowDirectoryChain(path.dirname(lockPath), 'Install lock parent');

  while (true) {
    runtimeDependencyOperationRemainingMs(operationOptions, 'Install lock admission');
    if (await reclaimLockIsActive(`${lockPath}.reclaim`)) {
      await waitForRuntimeDependencyOperation(
        operationOptions,
        pollIntervalMs,
        sleep,
        `Waiting for install lock reclaim marker ${lockPath}`
      );
      continue;
    }
    runtimeDependencyOperationRemainingMs(operationOptions, 'Install lock publication fence');
    await operationOptions.beforeCommit?.();
    runtimeDependencyOperationRemainingMs(operationOptions, 'Install lock publication');
    owner = {
      createdAt: (operationOptions.now ?? (() => new Date().toISOString()))(),
      pid: process.pid,
      token: crypto.randomUUID()
    };
    const parent = inspectNoFollowDirectoryChain(path.dirname(lockPath), 'Install lock parent').target;
    const ownerBytes = Buffer.from(formatJsonFile(owner), 'utf8');
    try {
      publishExclusiveDurableCanonicalFile({
        parent,
        name: path.basename(lockPath),
        bytes: ownerBytes,
        validate: (bytes) => {
          const value = JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
          if (!isInstallLockOwner(value)) throw new Error('Install lock owner record is malformed.');
        }
      });
      runtimeDependencyOperationRemainingMs(operationOptions, 'Install lock publication readback');
    } catch (error) {
      // A valid existing lease, or a recently-created malformed lease, is
      // contention rather than an invitation to replace its bytes.  The
      // exact reclaimer below decides whether an old identity may be
      // removed. Parent/reparse failures remain typed blockers.
      const contention = error instanceof PhysicalNoFollowError &&
        error.code === 'PHYSICAL_NO_FOLLOW_DURABILITY_FAILED'
        ? observeNoFollowOwnedFile(lockPath, 'Install lock contention') !== null
        : (() => {
            const existing = observeNoFollowOwnedFile(lockPath, 'Install lock contention');
            return existing !== null;
          })();
      if (!contention) throw error;
    }
    const current = observeNoFollowOwnedFile(lockPath, 'Install lock owner');
    if (current !== null) {
      const currentOwner = parseInstallLockOwner(readNoFollowOwnedFileJson(current, 'Install lock owner'));
      if (currentOwner?.token === owner.token) {
        ownerObservation = current;
        break;
      }
    }
    owner = null;
    ownerObservation = null;
    runtimeDependencyOperationRemainingMs(operationOptions, 'Install lock orphan recovery');
    if (await reclaimOrphanInstallLock(lockPath, operationOptions)) {
      runtimeDependencyOperationRemainingMs(operationOptions, 'Install lock orphan recovery readback');
      continue;
    }
    await waitForRuntimeDependencyOperation(
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
    runtimeDependencyOperationRemainingMs(operationOptions, 'Install lock callback admission');
    callbackResult = await callback();
    runtimeDependencyOperationRemainingMs(operationOptions, 'Install lock callback settlement');
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
      const current = observeNoFollowOwnedFile(lockPath, 'Install lock owner cleanup');
      if (current === null) {
        throw new SecError(
          'RUNTIME-DEPS-003',
          'Install lock owner disappeared before exact settlement',
          { lockPath, token: owner.token }
        );
      }
      const currentOwner = parseInstallLockOwner(
        readNoFollowOwnedFileJson(current, 'Install lock owner cleanup')
      );
      if (currentOwner?.token !== owner.token) {
        throw new SecError(
          'RUNTIME-DEPS-003',
          'Install lock owner changed before exact settlement; replacement is preserved',
          { lockPath, token: owner.token }
        );
      }
      await settleInstallLockOwnedFileDeletion({
        assertExpected: (observation) => {
          const currentOwner = parseInstallLockOwner(
            readNoFollowOwnedFileJson(observation, 'Install lock owner cleanup retry')
          );
          if (currentOwner?.token !== owner!.token) {
            throw new SecError(
              'RUNTIME-DEPS-003',
              'Install lock owner bytes changed during deletion settlement; replacement is preserved'
            );
          }
        },
        expected: ownerObservation,
        filePath: lockPath,
        label: 'Install lock owner',
        options: operationOptions
      });
    }
  } catch (error) {
    cleanupFailure = error;
  }

  if (callbackFailed) {
    if (fenceFailure !== undefined || cleanupFailure !== undefined) {
      throw runtimeDependencyInstallLockSettlementFailure({
        callbackFailure,
        cleanupFailure,
        fenceFailure,
        lockPath
      });
    }
    throw callbackFailure;
  }
  if (fenceFailure !== undefined && cleanupFailure !== undefined) {
    throw runtimeDependencyInstallLockSettlementFailure({ cleanupFailure, fenceFailure, lockPath });
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
async function withCompilerDependencyTransitionLease<T>(
  compilerDependencyRoot: string,
  options: RuntimeDependencyInstallOptions,
  callback: (operationOptions: RuntimeDependencyOperationOptions) => Promise<T>
): Promise<T> {
  const operationOptions = runtimeDependencyOperationOptions(options);
  const root = path.resolve(compilerDependencyRoot);
  // The compiler-root transition lease is the registry-owned compiler.lock;
  // do not create a second unregistered lock identity for the same owner.
  // Lease admission is the writer boundary, so it may materialize the
  // canonical lock namespace.  withInstallLock itself remains inspect-only;
  // this keeps every read/recovery path from creating directories while still
  // allowing a first compiler install to acquire its owner-local lease.
  runtimeDependencyOperationRemainingMs(operationOptions, 'Compiler dependency lease namespace admission');
  await operationOptions.beforeCommit?.();
  runtimeDependencyOperationRemainingMs(operationOptions, 'Compiler dependency lease namespace effect');
  const compilerRootIdentity = inspectNoFollowDirectoryChain(
    root,
    'Compiler dependency transition root'
  ).target;
  createNoFollowOrdinaryDirectoryChain(
    compilerRootIdentity,
    ['.tmp', 'dependency-installs']
  );
  await operationOptions.beforeCommit?.();
  runtimeDependencyOperationRemainingMs(operationOptions, 'Compiler dependency lease namespace readback');
  const leasePath = path.join(root, '.tmp', 'dependency-installs', 'compiler.lock');
  return withInstallLock(leasePath, operationOptions, async () => {
    // Compiler staging is born before package installation and therefore has
    // its own durable recovery intent. Recover that owner-local effect before
    // reading publication transitions; the latter deliberately begins only
    // after a valid staged binding/source generation exists.
    await migrateLegacyDependencyTransitionUnderLease(root, operationOptions);
    // A rollover is the only journal operation that can leave the canonical
    // records root absent.  Recover it while the same compiler-root lease is
    // held, before any generation, locator, runtime, or project writer reads
    // the ledger.  This keeps recovery and normal publication on one owner
    // local transition writer.
    await recoverDependencyTransitionRollover(root, operationOptions);
    const pending = await readDependencyTransition(root, operationOptions);
    await recoverCompilerDependencyStageIntents(root, operationOptions, pending);
    if (pending !== null && pending.phase !== 'complete' && pending.phase !== 'rolled-back') {
      if (pending.kind === 'compiler-generation' || pending.kind === 'compiler-locator') {
        await recoverCompilerDependencyTransition(
          root,
          dependencyAuthorityPaths(root).compilerModulesRoot,
          await compilerDependencyIdentity(root),
          operationOptions
        );
      } else if (pending.kind === 'compiler-bridge') {
        await recoverCompilerDependencyBridgeTransition(
          root,
          path.dirname(pending.destination.path),
          operationOptions
        );
      }
    }
    // Only after every durable stage intent and active publication journal is
    // terminal may an unrepresented registered staging root be classified as
    // legacy. Reversing this order can retire a live journal input or let an
    // unrelated unknown sibling prevent the journal's zero-effect rollback.
    await migrateRegisteredLegacyCompilerDependencyStages(root, operationOptions);
    return callback(operationOptions);
  });
}

/**
 * Perform the sole durable v1-to-v2 journal migration entry.  The caller can
 * provide only the owner root and bounded operation options; source records,
 * target records, and the migration intent are derived and authenticated by
 * this owner while holding the compiler-root lease.
 */
export async function migrateDependencyTransitionJournal(
  ownerRoot: string,
  options: RuntimeDependencyInstallOptions = {}
): Promise<void> {
  const operationOptions = await bindCanonicalGeneratedStateLifecycle(
    runtimeDependencyOperationOptions(options),
    ownerRoot
  );
  await withCompilerDependencyTransitionLease(
    ownerRoot,
    operationOptions,
    async () => undefined
  );
}

const COMPILER_DEPENDENCY_GENERATED_STATE_PLAN_SCHEMA =
  'sec-compiler-dependency-generated-state-settlement-plan-v1' as const;
const COMPILER_DEPENDENCY_GENERATED_STATE_RECEIPT_SCHEMA =
  'sec-compiler-dependency-generated-state-settlement-receipt-v1' as const;

export interface CompilerDependencyGeneratedStateSettlementPlan {
  readonly schema: typeof COMPILER_DEPENDENCY_GENERATED_STATE_PLAN_SCHEMA;
  readonly owner: 'compiler-dependency-runtime';
  readonly repositoryRoot: string;
  readonly workspaceRoot: string;
  readonly workspace: GeneratedStatePhysicalIdentity;
  readonly profile: GeneratedStateCleanupProfile;
  readonly inventoryDigest: `sha256:${string}`;
  readonly selected: readonly Readonly<{
    readonly relativePath: string;
    readonly physicalIdentity: GeneratedStatePhysicalIdentity;
    readonly registrationDigest: `sha256:${string}`;
  }>[];
  readonly planDigest: `sha256:${string}`;
}

export interface CompilerDependencyGeneratedStateSettlementReceipt {
  readonly schema: typeof COMPILER_DEPENDENCY_GENERATED_STATE_RECEIPT_SCHEMA;
  readonly owner: 'compiler-dependency-runtime';
  readonly planDigest: `sha256:${string}`;
  readonly beforeInventoryDigest: `sha256:${string}`;
  readonly afterInventoryDigest: `sha256:${string}`;
  readonly outcomes: readonly Readonly<{
    readonly relativePath: string;
    readonly outcome: 'absent' | 'preserved-replacement' | 'residue';
  }>[];
  readonly terminal: 'completed' | 'partial-residue';
  readonly receiptDigest: `sha256:${string}`;
}

/** Dependency-owned projection; generated-state never infers active cleanup authority. */
export function planCompilerDependencyGeneratedStateSettlement(input: Readonly<{
  repositoryRoot: string;
  workspaceRoot: string;
  inventory: GeneratedStateInventory;
  profile: GeneratedStateCleanupProfile;
}>): CompilerDependencyGeneratedStateSettlementPlan {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const workspaceRoot = path.resolve(input.workspaceRoot);
  if (input.inventory.repositoryRoot !== repositoryRoot) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency generated-state inventory belongs to another repository');
  }
  const workspace = inspectNoFollowDirectoryChain(
    workspaceRoot,
    'Dependency generated-state settlement workspace'
  ).target;
  const workspaceIdentity = generatedStatePhysicalIdentity(workspace);
  if (!sameGeneratedStateIdentity(workspaceIdentity, input.inventory.workspace)) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency generated-state workspace identity changed before planning');
  }
  const selected = Object.freeze(input.inventory.entries
    .filter((entry) => entry.ruleId === COMPILER_STAGING_LIFECYCLE_RULE &&
      entry.owner === COMPILER_STAGING_LIFECYCLE_OWNER && entry.kind === 'directory' &&
      entry.registrationState === 'active' && entry.registrationDigest !== null &&
      entry.physicalIdentity !== null && entry.cleanupProfiles.includes(input.profile))
    .map((entry) => Object.freeze({
      relativePath: entry.relativePath,
      physicalIdentity: entry.physicalIdentity!,
      registrationDigest: entry.registrationDigest!
    }))
    .sort((left, right) => compareCodeUnits(left.relativePath, right.relativePath)));
  const material = Object.freeze({
    schema: COMPILER_DEPENDENCY_GENERATED_STATE_PLAN_SCHEMA,
    owner: COMPILER_STAGING_LIFECYCLE_OWNER,
    repositoryRoot,
    workspaceRoot,
    workspace: workspaceIdentity,
    profile: input.profile,
    inventoryDigest: input.inventory.inventoryDigest,
    selected
  });
  return Object.freeze({ ...material, planDigest: generatedStateDigest(material) });
}

/**
 * Consume one exact dependency-owned plan.  The same compiler-root lease
 * recovers journal/stage registrations and the owner performs its own final
 * inventory readback before issuing a receipt.
 */
export async function settleCompilerDependencyGeneratedState(
  plan: CompilerDependencyGeneratedStateSettlementPlan,
  options: RuntimeDependencyInstallOptions = {}
): Promise<CompilerDependencyGeneratedStateSettlementReceipt> {
  const { inspectGeneratedState } = await import('../../../runtime-state/generated-state/lifecycle.ts');
  const before = await inspectGeneratedState({
    repositoryRoot: plan.repositoryRoot,
    workspaceRoot: plan.workspaceRoot
  });
  const currentPlan = planCompilerDependencyGeneratedStateSettlement({
    repositoryRoot: plan.repositoryRoot,
    workspaceRoot: plan.workspaceRoot,
    inventory: before,
    profile: plan.profile
  });
  if (!canonicalEquals(currentPlan, plan)) {
    throw new SecError(
      'RUNTIME-DEPS-004',
      'Dependency generated-state settlement plan is stale, malformed, or foreign; current state is preserved',
      { currentPlanDigest: currentPlan.planDigest, planDigest: plan.planDigest }
    );
  }
  await migrateDependencyTransitionJournal(plan.workspaceRoot, options);
  const after = await inspectGeneratedState({
    repositoryRoot: plan.repositoryRoot,
    workspaceRoot: plan.workspaceRoot
  });
  const outcomes = Object.freeze(plan.selected.map((selected) => {
    const current = after.entries.find(({ relativePath }) => relativePath === selected.relativePath);
    const outcome = current === undefined || current.kind === 'missing'
      ? 'absent' as const
      : current.physicalIdentity !== null &&
          sameGeneratedStateIdentity(current.physicalIdentity, selected.physicalIdentity)
        ? 'residue' as const
        : 'preserved-replacement' as const;
    return Object.freeze({ relativePath: selected.relativePath, outcome });
  }));
  const terminal = outcomes.every(({ outcome }) => outcome === 'absent')
    ? 'completed' as const
    : 'partial-residue' as const;
  const material = Object.freeze({
    schema: COMPILER_DEPENDENCY_GENERATED_STATE_RECEIPT_SCHEMA,
    owner: COMPILER_STAGING_LIFECYCLE_OWNER,
    planDigest: plan.planDigest,
    beforeInventoryDigest: before.inventoryDigest,
    afterInventoryDigest: after.inventoryDigest,
    outcomes,
    terminal
  });
  return Object.freeze({ ...material, receiptDigest: generatedStateDigest(material) });
}

/**
 * The compiler command shares the existing dependency-install lock budget.
 * Reserve the final tenth for process-tree termination/readback so a retained
 * command cannot turn a bounded install operation into an unbounded cleanup.
 */
function compilerDependencyCommandBounds(options: RuntimeDependencyInstallOptions): Readonly<{
  maxStderrBytes: number;
  maxStdoutBytes: number;
  terminationDeadlineMs: number;
  terminationGraceMs: number;
  timeoutMs: number;
}> {
  const totalBudgetMs = Math.floor(runtimeDependencyOperationRemainingMs(
    options,
    'Compiler dependency command admission',
    2
  ));
  const terminationDeadlineMs = Math.max(1, Math.min(5_000, Math.floor(totalBudgetMs / 10)));
  const timeoutMs = totalBudgetMs - terminationDeadlineMs;
  const terminationGraceMs = Math.max(1, Math.min(1_000, Math.floor(terminationDeadlineMs / 2)));
  return Object.freeze({
    maxStderrBytes: DEPENDENCY_COMMAND_OUTPUT_BYTES_CAPACITY,
    maxStdoutBytes: DEPENDENCY_COMMAND_OUTPUT_BYTES_CAPACITY,
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
  const commandBounds = compilerDependencyCommandBounds(options);
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
      runtimeDependencyOperationRemainingMs(options, 'Compiler dependency command pre-spawn');
      await options.beforeCommit?.();
      await inputFence?.();
      runtimeDependencyOperationRemainingMs(options, 'Compiler dependency command effect admission');
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
    const executableParent = inspectNoFollowDirectoryChain(
      path.dirname(expected.path),
      'Bun executable retained parent'
    );
    const executable = retainNoFollowOrdinaryFile(
      executableParent,
      path.basename(expected.path),
      undefined,
      'Bun executable retained capability',
      RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
      'executable'
    );
    const workingDirectoryChain = inspectNoFollowDirectoryChain(
      workingDirectory,
      'Bun retained working directory'
    );
    const retainedWorkingDirectory = retainNoFollowDirectoryForChildProcess(
      workingDirectoryChain,
      RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
      'Bun retained working directory capability'
    );
    try {
      assertRetainedNoFollowCapability(executable, 'executable', 'Bun executable capability');
      assertRetainedNoFollowCapability(
        retainedWorkingDirectory,
        'working-directory',
        'Bun working directory capability'
      );
      const observed = executable.digest();
      if (!sameHostPath(executable.path, expected.path) || observed.byteDigest !== `sha256:${expected.sha256}`) {
        throw new SecError(
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
        if (current.size !== expectedExecutableSize || current.byteDigest !== `sha256:${expected.sha256}`) {
          throw new SecError(
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
  runtimeDependencyOperationRemainingMs(options, 'Compiler dependency command settlement');
  await options.beforeCommit?.();
  runtimeDependencyOperationRemainingMs(options, 'Compiler dependency command final fence');

  if (bunResult.code === 0) {
    return { packageManager: 'bun', result: bunResult };
  }

  throw new SecError('RUNTIME-DEPS-001', `Failed to install runtime dependencies in ${workingDirectory}`, {
    bunResult
  });
}

async function materializeIsolatedNodeModules(
  source: string,
  target: string,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  await runtimeDependencyOperationEffectFence(options, 'Isolated dependency materialization admission');
  if ((await observeDependencyTransitionSlot(target)).kind !== 'absent') {
    throw new SecError('RUNTIME-DEPS-004', 'Isolated dependency target must be absent before materialization');
  }
  await copyPhysicalTrees({
    options,
    invalidSource: (detail) => new SecError(
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

type ProjectStampObservation = Readonly<{
  present: boolean;
  stamp: RuntimeDepsStamp | null;
}>;

async function observeProjectStamp(projectRoot: string): Promise<ProjectStampObservation> {
  const root = inspectNoFollowDirectoryChain(
    projectRoot,
    'Project dependency stamp root'
  ).target;
  const entry = inspectNoFollowOrdinaryFileEntry(root, path.basename(projectStampPath(projectRoot)));
  if (entry === null || entry.bytes === null) return Object.freeze({ present: false, stamp: null });
  const stamp = await readRuntimeDepsStamp(projectStampPath(projectRoot));
  return Object.freeze({ present: true, stamp });
}

function sameRuntimeDependencyTargetIdentity(
  left: Readonly<RuntimeDependencyTargetIdentity>,
  right: Readonly<RuntimeDependencyTargetIdentity>
): boolean {
  return left.kind === right.kind && left.linkTarget === right.linkTarget &&
    sameGeneratedStateIdentity(left.physical, right.physical);
}

async function assertProjectProjectionPreimage(input: Readonly<{
  current: DependencyTransitionSlot;
  expectedBinding: Readonly<RuntimeDependencyMaterializationBinding>;
  expectedLinkTarget: string | null;
  expectedSourceGeneration?: Readonly<RuntimeDependencySourceGeneration>;
  options: RuntimeDependencyOperationOptions;
  projectRoot: string;
  runtimeSpec: RuntimeDependencySpec;
  targetPath: string;
}>): Promise<RuntimeDepsStamp | null> {
  const stampState = await observeProjectStamp(input.projectRoot);
  if (input.current.kind === 'absent') {
    if (stampState.present) {
      throw new SecError(
        'RUNTIME-DEPS-004',
        'Project dependency stamp is stale while its target is absent; physical state is preserved'
      );
    }
    return null;
  }
  const stamp = stampState.stamp;
  if (stamp === null) {
    throw new SecError(
      'RUNTIME-DEPS-004',
      'Project dependency target has no valid v4 stamp; physical target is preserved'
    );
  }
  if (stamp.binding.revision !== input.expectedBinding.revision ||
      !canonicalEquals(stamp.binding, input.expectedBinding) ||
      stamp.sourceGeneration.bindingDigest !== generatedStateDigest(input.expectedBinding)) {
    throw new SecError(
      'RUNTIME-DEPS-004',
      'Project dependency target provenance does not match the requested binding; physical target is preserved'
    );
  }
  const expectedSourceGeneration = input.expectedSourceGeneration ?? stamp.sourceGeneration;
  let currentSource: RuntimeDependencySourceGeneration | null;
  try {
    currentSource = await runtimeDependencySourceGeneration({
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
      !sameRuntimeDependencySourceGenerationContent(currentSource, expectedSourceGeneration) ||
      !sameGeneratedStateIdentity(currentSource.physical, expectedSourceGeneration.physical) ||
      currentSource.epoch !== stamp.sourceGeneration.epoch ||
      !sameRuntimeDependencySourceGenerationContent(currentSource, stamp.sourceGeneration) ||
      !sameGeneratedStateIdentity(currentSource.physical, stamp.sourceGeneration.physical) ||
      !sameGeneratedStateIdentity(currentSource.ownerRootPhysical, stamp.sourceGeneration.ownerRootPhysical)) {
    throw new SecError(
      'RUNTIME-DEPS-004',
      'Project dependency source generation changed before target retirement; physical target is preserved'
    );
  }
  const target = await runtimeDependencyTargetIdentity(input.targetPath);
  const exactLink = input.expectedLinkTarget === null
    ? null
    : inspectExactNoFollowLinkEntry(
        inspectNoFollowDirectoryChain(
          path.dirname(path.resolve(input.targetPath)),
          'Project dependency locator parent'
        ).target,
        path.basename(path.resolve(input.targetPath)),
        input.expectedLinkTarget
      );
  if (target === null || input.current.physical === null ||
      !sameRuntimeDependencyTargetIdentity(target, stamp.target) ||
      !sameGeneratedStateIdentity(target.physical, input.current.physical) ||
      (input.expectedLinkTarget === null
        ? target.kind !== 'directory'
        : target.kind !== 'link' || target.linkTarget === null || exactLink === null ||
          target.linkTarget !== exactLink.linkTarget)) {
    throw new SecError(
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
    throw new SecError(
      'RUNTIME-DEPS-004',
      'Project dependency target content no longer matches its stamped binding; physical target is preserved'
    );
  }
  return stamp;
}

type ProjectProjectionTransitionInput = Readonly<{
  binding: Readonly<RuntimeDependencyMaterializationBinding>;
  compilerDependencyRoot: string;
  isolated: boolean;
  nodeModulesPath: string;
  options: RuntimeDependencyOperationOptions;
  projectRootPath: string;
  runtimeSpec: RuntimeDependencySpec;
  sourceGeneration: Readonly<RuntimeDependencySourceGeneration>;
  sourceNodeModulesPath: string;
  stampPath: string;
}>;

async function assertProjectSourceGenerationCurrent(
  input: Pick<ProjectProjectionTransitionInput, 'binding' | 'options' | 'sourceGeneration'>
): Promise<RuntimeDependencySourceGeneration> {
  const current = await runtimeDependencySourceGeneration({
    binding: input.binding,
    options: input.options,
    ownerRoot: input.sourceGeneration.ownerRoot,
    sourcePath: input.sourceGeneration.sourcePath
  });
  if (current.epoch !== input.sourceGeneration.epoch ||
      !sameRuntimeDependencySourceGenerationContent(current, input.sourceGeneration) ||
      !sameGeneratedStateIdentity(current.physical, input.sourceGeneration.physical) ||
      !sameGeneratedStateIdentity(current.ownerRootPhysical, input.sourceGeneration.ownerRootPhysical)) {
    throw new SecError(
      'RUNTIME-DEPS-004',
      'Runtime dependency source generation changed before project projection effect'
    );
  }
  return current;
}

async function deleteExactDependencyLocator(
  targetPath: string,
  expected: DependencyTransitionSlot,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  if (expected.kind !== 'link' || expected.physical === null || expected.linkTarget === null) {
    throw new SecError('RUNTIME-DEPS-004', 'Project dependency locator preimage is not an exact link');
  }
  const parent = inspectNoFollowDirectoryChain(
    path.dirname(path.resolve(targetPath)),
    'Project dependency locator cleanup parent'
  ).target;
  const entry = inspectNoFollowLinkEntry(parent, path.basename(path.resolve(targetPath)));
  if (entry === null || entry.kind !== 'link' || entry.linkTarget === null ||
      entry.linkTarget !== expected.linkTarget ||
      !sameGeneratedStateIdentity(Object.freeze({
        device: entry.device,
        inode: entry.inode,
        objectId: generatedStateDigest({ kind: 'link', target: entry.linkTarget })
      }), expected.physical)) {
    throw new SecError('RUNTIME-DEPS-004', 'Project dependency locator changed before exact retirement');
  }
  await runtimeDependencyOperationEffectFence(options, 'Project dependency locator retirement');
  deleteRetainedNoFollowEntry({
    root: parent,
    relativePath: path.basename(path.resolve(targetPath)),
    kind: 'link',
    device: entry.device,
    inode: entry.inode,
    expectedLinkTarget: entry.linkTarget,
    ancestorDirectories: Object.freeze([])
  });
  if ((await observeDependencyTransitionSlot(targetPath)).kind !== 'absent') {
    throw new SecError('RUNTIME-DEPS-004', 'Project dependency locator remains after exact retirement');
  }
}

async function invokeProjectProjectionHook(
  options: RuntimeDependencyInstallOptions,
  stage: 'prepared' | 'backed-up' | 'published' | 'binding-validated' | 'stamp-readback'
): Promise<void> {
  await options.testProjectProjectionHook?.(stage);
}

async function assertProjectProjectionPublished(input: Readonly<{
  binding: Readonly<RuntimeDependencyMaterializationBinding>;
  compilerDependencyRoot: string;
  isolated: boolean;
  nodeModulesPath: string;
  options: RuntimeDependencyOperationOptions;
  runtimeSpec: RuntimeDependencySpec;
  sourceGeneration: Readonly<RuntimeDependencySourceGeneration>;
  sourceNodeModulesPath: string;
}>): Promise<Readonly<{
  sourceGeneration: RuntimeDependencySourceGeneration;
  target: RuntimeDependencyTargetIdentity;
}>> {
  const sourceGeneration = await assertProjectSourceGenerationCurrent(input);
  const target = await runtimeDependencyTargetIdentity(input.nodeModulesPath);
  if (target === null || (input.isolated ? target.kind !== 'directory' : target.kind !== 'link')) {
    throw new SecError('RUNTIME-DEPS-004', 'Project dependency projection published an unexpected target kind');
  }
  if (input.isolated) {
    if (!await runtimeDependencyTreeMatchesBinding({
      expected: input.binding,
      nodeModulesPath: input.nodeModulesPath,
      root: input.compilerDependencyRoot,
      runtimeSpec: input.runtimeSpec
    })) {
      throw new SecError('RUNTIME-DEPS-004', 'Isolated dependency projection failed exact readback');
    }
  } else if (target.linkTarget === null ||
      !await dependencyBridgeTargets(input.nodeModulesPath, input.sourceNodeModulesPath)) {
    throw new SecError('RUNTIME-DEPS-004', 'Project dependency bridge failed exact target readback');
  }
  return Object.freeze({ sourceGeneration, target });
}

async function publishProjectDependencyProjection(
  input: ProjectProjectionTransitionInput
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
  const projectRootIdentity = inspectNoFollowDirectoryChain(
    projectRootPath,
    'Project dependency projection root'
  ).target;
  await runtimeDependencyOperationEffectFence(options, 'Project dependency staging namespace creation');
  const stagingParentIdentity = createNoFollowOrdinaryDirectoryChain(
    projectRootIdentity,
    ['.tmp']
  );
  await runtimeDependencyOperationEffectFence(options, 'Project dependency staging-root creation');
  const stagingRoot = createExclusiveNoFollowRandomDirectory(
    stagingParentIdentity,
    'project.staging-'
  ).path;
  const stagingNodeModulesPath = path.join(stagingRoot, 'node_modules');
  const stagingRootSlot = await observeDependencyTransitionSlot(stagingRoot);
  let stagingNodeModulesSlot: DependencyTransitionSlot | null = null;
  let transition: DependencyTransitionJournal | null = null;
  try {
    if (isolated) {
      await materializeIsolatedNodeModules(sourceNodeModulesPath, stagingNodeModulesPath, options);
    } else {
      await createCompilerDependencyLocator(
        stagingNodeModulesPath,
        sourceNodeModulesPath,
        sourceGeneration.physical,
        options
      );
    }
    stagingNodeModulesSlot = await observeDependencyTransitionSlot(
      stagingNodeModulesPath,
      generatedStateDigest(binding)
    );
    if (stagingNodeModulesSlot.kind === 'absent') {
      throw new SecError('RUNTIME-DEPS-004', 'Project dependency stage disappeared before durable intent');
    }
    await assertProjectSourceGenerationCurrent({ binding, options, sourceGeneration });

    const currentBeforeIntent = await observeDependencyTransitionSlot(nodeModulesPath);
    await assertProjectProjectionPreimage({
      current: currentBeforeIntent,
      expectedBinding: binding,
      expectedLinkTarget: isolated ? null : sourceNodeModulesPath,
      expectedSourceGeneration: sourceGeneration,
      options,
      projectRoot: projectRootPath,
      runtimeSpec,
      targetPath: nodeModulesPath
    });
    const namespace = await ensureDependencyTransitionNamespace(compilerDependencyRoot, options);
    const backupPath = currentBeforeIntent.kind === 'directory'
      ? path.join(
        namespace.backupRoot.path,
        `project-preimage-${generatedStateDigest({
          schema: 'sec-project-dependency-preimage-v1',
          projectRoot: projectRootPath,
          target: currentBeforeIntent,
          sourceGeneration
        }).slice('sha256:'.length, 'sha256:'.length + 32)}`
      )
      : null;
    transition = await beginDependencyTransition({
      kind: 'project-projection',
      ownerRoot: compilerDependencyRoot,
      destinationPath: nodeModulesPath,
      stagePath: stagingNodeModulesPath,
      stageRootPath: stagingRoot,
      backupPath,
      sourceGeneration,
      bindingDigest: generatedStateDigest(binding),
      options
    });
    await invokeProjectProjectionHook(options, 'prepared');

    const currentPreimage = await observeDependencyTransitionSlot(nodeModulesPath);
    if (!transitionSlotMatches(currentPreimage, transition.preimage)) {
      throw new SecError('RUNTIME-DEPS-004', 'Project dependency preimage changed before backup; physical target is preserved');
    }
    await assertProjectProjectionPreimage({
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
      if (backupPath === null) throw new SecError('RUNTIME-DEPS-004', 'Project dependency directory has no owned backup path');
      await renameCompilerDependencyDirectory(nodeModulesPath, backupPath, options);
    } else if (currentPreimage.kind === 'link') {
      await deleteExactDependencyLocator(nodeModulesPath, currentPreimage, options);
    }
    transition = await advanceDependencyTransition(transition, {
      destination: transitionAbsentSlot(nodeModulesPath),
      backup: backupPath === null ? null : await observeDependencyTransitionSlot(backupPath),
      phase: 'backed-up',
      durability: 'known',
      failure: null
    }, options);
    await invokeProjectProjectionHook(options, 'backed-up');

    await assertProjectSourceGenerationCurrent({ binding, options, sourceGeneration });
    if (isolated) {
      await renameCompilerDependencyDirectory(stagingNodeModulesPath, nodeModulesPath, options);
    } else {
      await renameDependencyLocator(
        stagingNodeModulesPath,
        nodeModulesPath,
        sourceNodeModulesPath,
        options
      );
    }
    transition = await advanceDependencyTransition(transition, {
      destination: await observeDependencyTransitionSlot(nodeModulesPath, generatedStateDigest(binding)),
      stage: transitionAbsentSlot(stagingNodeModulesPath),
      phase: 'published',
      durability: 'known',
      failure: null
    }, options);
    await invokeProjectProjectionHook(options, 'published');

    const validated = await assertProjectProjectionPublished({
      binding,
      compilerDependencyRoot,
      isolated,
      nodeModulesPath,
      options,
      runtimeSpec,
      sourceGeneration,
      sourceNodeModulesPath
    });
    transition = await advanceDependencyTransition(transition, {
      destination: await observeDependencyTransitionSlot(nodeModulesPath, generatedStateDigest(binding)),
      phase: 'binding-validated',
      durability: 'known',
      failure: null
    }, options);
    await invokeProjectProjectionHook(options, 'binding-validated');

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
      throw new SecError('RUNTIME-DEPS-004', 'Project dependency stamp failed exact readback; recovery is required');
    }
    transition = await advanceDependencyTransition(transition, {
      destination: await observeDependencyTransitionSlot(nodeModulesPath, generatedStateDigest(binding)),
      sourceGeneration: validated.sourceGeneration,
      phase: 'stamp-readback',
      durability: 'known',
      failure: null
    }, options);
    await invokeProjectProjectionHook(options, 'stamp-readback');

    await disposeDependencyTransitionStage(
      compilerDependencyRoot,
      stagingRoot,
      runtimeDependencyOperationOptions({ ...options, generatedStateLifecycle: undefined }),
      'project-projection-published',
      transition.stage,
      transition.stageRoot,
      projectDependencyStageAuthority(projectRootPath)
    );
    transition = await advanceDependencyTransition(transition, {
      destination: await observeDependencyTransitionSlot(nodeModulesPath, generatedStateDigest(binding)),
      stage: transitionAbsentSlot(stagingNodeModulesPath),
      stageRoot: transitionAbsentSlot(stagingRoot),
      backup: transition.backup,
      phase: 'complete',
      durability: 'known',
      failure: null
    }, options);
  } catch (error) {
    if (transition !== null) {
      await markDependencyTransitionFailure(transition, error, options).catch(() => undefined);
    } else {
      await disposeDependencyTransitionStage(
        compilerDependencyRoot,
        stagingRoot,
        runtimeDependencyOperationOptions({ ...options, generatedStateLifecycle: undefined }),
        'project-projection-staging-failed',
        stagingNodeModulesSlot,
        stagingRootSlot,
        projectDependencyStageAuthority(projectRootPath)
      ).catch(() => undefined);
    }
    const cause = error instanceof Error ? error.message : String(error);
    throw new SecError('RUNTIME-DEPS-004', `Project dependency projection requires recovery: ${cause}`, {
      cause,
      transitionDigest: transition?.recordDigest ?? null,
      recoveryRequired: transition !== null
    });
  }
}

function assertDirectStageRootSelector(
  stageRoot: DependencyTransitionSlot,
  parent: string,
  prefix: string
): void {
  const stageRootPath = path.resolve(stageRoot.path);
  if (path.dirname(stageRootPath) !== path.resolve(parent) ||
      !path.basename(stageRootPath).startsWith(prefix)) {
    throw new SecError(
      'RUNTIME-DEPS-004',
      'Dependency transition stage root is outside its canonical operation selector',
      { stageRootPath, parent: path.resolve(parent), prefix }
    );
  }
  if (stageRoot.kind !== 'directory' && stageRoot.kind !== 'absent') {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition stage root is not an ordinary directory slot');
  }
}

function assertTransitionBackupSelector(
  transition: DependencyTransitionJournal,
  expectedPath?: string
): void {
  if (transition.backup === null) return;
  const backupParent = path.join(
    transition.ownerRoot, '.tmp', 'dependency-installs', 'compiler-backups'
  );
  if (path.dirname(transition.backup.path) !== backupParent ||
      !/^(?:node_modules|locator-preimage|runtime|project-preimage)-[0-9a-f]{16,64}$/u.test(path.basename(transition.backup.path))) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition backup path is outside its canonical selector');
  }
  if (expectedPath !== undefined && path.resolve(transition.backup.path) !== path.resolve(expectedPath)) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency transition backup path is not the operation-derived slot');
  }
}

function compilerTransitionBackupPath(
  ownerRoot: string,
  prefix: 'node_modules' | 'locator-preimage' | 'runtime',
  sourceGeneration: RuntimeDependencySourceGeneration
): string {
  const namespace = dependencyTransitionNamespacePaths(path.resolve(ownerRoot));
  return path.join(
    namespace.backupRoot,
    `${prefix}-${sourceGeneration.epoch.slice('sha256:'.length, 'sha256:'.length + 24)}`
  );
}

function projectTransitionBackupPath(
  ownerRoot: string,
  projectRoot: string,
  preimage: DependencyTransitionSlot,
  sourceGeneration: RuntimeDependencySourceGeneration
): string {
  const namespace = dependencyTransitionNamespacePaths(path.resolve(ownerRoot));
  return path.join(
    namespace.backupRoot,
    `project-preimage-${generatedStateDigest({
      schema: 'sec-project-dependency-preimage-v1',
      projectRoot: path.resolve(projectRoot),
      target: preimage,
      sourceGeneration
    }).slice('sha256:'.length, 'sha256:'.length + 32)}`
  );
}

function assertTransitionOperationKey(
  transition: DependencyTransitionJournal
): void {
  const expected = transitionOperationKey({
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
    throw new SecError(
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

function assertCompilerTransitionRecoveryTopology(
  transition: DependencyTransitionJournal,
  root: string,
  nodeModulesPath: string
): void {
  const canonicalRoot = path.resolve(root);
  const canonicalDestination = path.resolve(nodeModulesPath);
  if (transition.ownerRoot !== canonicalRoot || transition.destination.path !== canonicalDestination ||
      transition.preimage.path !== canonicalDestination) {
    throw new SecError('IMPORT-AUTHORITY-004', 'Compiler transition journal targets a foreign canonical path');
  }
  assertTransitionOperationKey(transition);
  const expectedBackupPath = transition.kind === 'compiler-generation'
    ? compilerTransitionBackupPath(canonicalRoot, 'node_modules', transition.sourceGeneration)
    : transition.kind === 'compiler-locator'
      ? compilerTransitionBackupPath(canonicalRoot, 'locator-preimage', transition.sourceGeneration)
      : transition.kind === 'runtime-projection'
        ? compilerTransitionBackupPath(canonicalRoot, 'runtime', transition.sourceGeneration)
        : undefined;
  assertTransitionBackupSelector(transition, expectedBackupPath);
  if (transition.kind === 'compiler-generation') {
    if (transition.stage === null || transition.stageRoot === null) {
      throw new SecError('IMPORT-AUTHORITY-004', 'Compiler generation transition has no canonical staging slots');
    }
    assertDirectStageRootSelector(
      transition.stageRoot,
      path.join(canonicalRoot, '.tmp', 'dependency-installs'),
      'c.staging-'
    );
    if (transition.stage.path !== path.join(transition.stageRoot.path, 'node_modules')) {
      throw new SecError('IMPORT-AUTHORITY-004', 'Compiler generation transition stage is not its exact node_modules child');
    }
    if (transition.sourceGeneration.ownerRoot !== canonicalRoot ||
        (transition.sourceGeneration.sourcePath !== transition.stage.path &&
          transition.sourceGeneration.sourcePath !== canonicalDestination)) {
      throw new SecError('IMPORT-AUTHORITY-004', 'Compiler generation transition source path is foreign');
    }
    return;
  }
  if (transition.kind === 'compiler-locator') {
    if (transition.stage !== null || transition.stageRoot !== null ||
        transition.sourceGeneration.sourcePath === canonicalDestination ||
        path.basename(transition.sourceGeneration.sourcePath) !== 'node_modules') {
      throw new SecError('IMPORT-AUTHORITY-004', 'Compiler locator transition topology is foreign');
    }
    return;
  }
  if (transition.kind === 'runtime-projection') {
    if (transition.stage === null || transition.stageRoot === null) {
      throw new SecError('RUNTIME-DEPS-004', 'Runtime projection transition has no canonical staging slots');
    }
    const sharedRoot = dependencyAuthorityPaths(canonicalRoot).sharedDepsRoot;
    assertDirectStageRootSelector(transition.stageRoot, sharedRoot, '.runtime-generation-');
    if (transition.stage.path !== path.join(transition.stageRoot.path, 'node_modules')) {
      throw new SecError('RUNTIME-DEPS-004', 'Runtime projection stage is not its exact node_modules child');
    }
    return;
  }
  if (transition.kind === 'compiler-bridge') {
    throw new SecError(
      'RUNTIME-DEPS-004',
      'Compiler bridge recovery must use its project bridge owner boundary'
    );
  }
  throw new SecError('RUNTIME-DEPS-004', 'Compiler recovery cannot consume a project transition');
}

function assertProjectTransitionRecoveryTopology(
  transition: DependencyTransitionJournal,
  input: ProjectProjectionTransitionInput
): void {
  const compilerRoot = path.resolve(input.compilerDependencyRoot);
  const target = path.resolve(input.nodeModulesPath);
  if (transition.ownerRoot !== compilerRoot || transition.destination.path !== target ||
      transition.preimage.path !== target || transition.kind !== 'project-projection') {
    throw new SecError('RUNTIME-DEPS-004', 'Project transition journal targets a foreign canonical path');
  }
  assertTransitionOperationKey(transition);
  assertTransitionBackupSelector(
    transition,
    transition.backup === null
      ? undefined
      : projectTransitionBackupPath(
        compilerRoot,
        input.projectRootPath,
        transition.preimage,
        transition.sourceGeneration
      )
  );
  if (transition.stage === null || transition.stageRoot === null) {
    throw new SecError('RUNTIME-DEPS-004', 'Project transition has no canonical staging slots');
  }
  assertDirectStageRootSelector(
    transition.stageRoot,
    path.join(path.resolve(input.projectRootPath), '.tmp'),
    'project.staging-'
  );
  if (transition.stage.path !== path.join(transition.stageRoot.path, 'node_modules')) {
    throw new SecError('RUNTIME-DEPS-004', 'Project transition stage is not its exact node_modules child');
  }
  if (!sameHostPath(transition.sourceGeneration.sourcePath, input.sourceNodeModulesPath)) {
    throw new SecError('RUNTIME-DEPS-004', 'Project transition source generation path is foreign');
  }
}

async function recoverProjectDependencyTransition(
  input: ProjectProjectionTransitionInput
): Promise<void> {
  const initial = await readDependencyTransition(input.compilerDependencyRoot, input.options);
  if (initial === null || initial.kind !== 'project-projection' ||
      initial.phase === 'complete' || initial.phase === 'rolled-back') return;
  let transition = initial;
  const failRecovery = async (error: unknown): Promise<never> => {
    await markDependencyTransitionFailure(transition, error, input.options).catch(() => undefined);
    const cause = error instanceof Error ? error.message : String(error);
    throw new SecError('RUNTIME-DEPS-004', `Project dependency transition requires owner recovery: ${cause}`, {
      cause,
      transitionDigest: transition.recordDigest,
      recoveryRequired: true
    });
  };
  try {
    assertProjectTransitionRecoveryTopology(initial, input);
    const owner = inspectNoFollowDirectoryChain(
      input.compilerDependencyRoot,
      'Project dependency transition owner root recovery'
    ).target;
    if (!sameGeneratedStateIdentity(
      generatedStatePhysicalIdentity(owner),
      transition.ownerRootPhysical
    )) {
      return failRecovery(new SecError('RUNTIME-DEPS-004', 'Project dependency transition owner root identity changed'));
    }
    if (transition.sourceGeneration.bindingDigest !== generatedStateDigest(input.binding) ||
        transition.sourceGeneration.epoch !== input.sourceGeneration.epoch ||
        !sameRuntimeDependencySourceGenerationContent(transition.sourceGeneration, input.sourceGeneration) ||
        !sameGeneratedStateIdentity(transition.sourceGeneration.physical, input.sourceGeneration.physical) ||
        !sameGeneratedStateIdentity(transition.sourceGeneration.ownerRootPhysical, input.sourceGeneration.ownerRootPhysical)) {
      return failRecovery(new SecError('RUNTIME-DEPS-004', 'Project dependency transition source generation is foreign or stale'));
    }

    const stagePath = transition.stage?.path ?? null;
    const stageRootPath = transition.stageRoot?.path ?? null;
    const backupPath = transition.backup?.path ?? null;
    let active = await observeDependencyTransitionSlot(transition.destination.path);
    let stage = stagePath === null ? null : await observeDependencyTransitionSlot(stagePath);
    let stageRoot = stageRootPath === null ? null : await observeDependencyTransitionSlot(stageRootPath);
    let backup = backupPath === null ? null : await observeDependencyTransitionSlot(backupPath);

    if (transition.stageRoot !== null &&
        (stageRoot === null || !transitionSlotMatches(stageRoot, transition.stageRoot))) {
      const alreadyDisposed = transition.stageRoot.kind === 'directory' &&
        transition.stage?.kind === 'absent' && stageRoot?.kind === 'absent' &&
        (transition.phase === 'published' || transition.phase === 'binding-validated' ||
          transition.phase === 'stamp-readback' || transition.phase === 'recovery-required');
      if (!alreadyDisposed) {
        return failRecovery(new SecError('RUNTIME-DEPS-004', 'Project dependency staging root identity changed and is preserved'));
      }
    }

    if (transition.backup !== null) {
      if (transition.backup.kind === 'absent') {
        if (backup === null || backup.kind !== 'absent') {
          return failRecovery(new SecError('RUNTIME-DEPS-004', 'Foreign project dependency backup is preserved'));
        }
      } else if (backup === null || !transitionSlotMatches(backup, transition.backup)) {
        return failRecovery(new SecError('RUNTIME-DEPS-004', 'Project dependency backup identity changed and is preserved'));
      }
    }

    const expectedLinkTarget = input.isolated ? null : input.sourceNodeModulesPath;
    const preimageMatches = transitionSlotMatches(active, transition.preimage);
    if (transition.phase === 'prepared' ||
        (transition.phase === 'recovery-required' && transition.destination.kind === transition.preimage.kind &&
          preimageMatches)) {
      if (!preimageMatches) {
        if (active.kind !== 'absent' || transition.preimage.kind === 'absent' ||
            backup === null || backup.kind !== 'directory' ||
            transition.backup === null || !transitionSlotMatches(backup, transition.backup)) {
          return failRecovery(new SecError('RUNTIME-DEPS-004', 'Project dependency preimage topology is unknown and preserved'));
        }
      } else {
        await assertProjectProjectionPreimage({
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
          if (backupPath === null) return failRecovery(new SecError('RUNTIME-DEPS-004', 'Project dependency preimage has no operation-owned backup'));
          await renameCompilerDependencyDirectory(input.nodeModulesPath, backupPath, input.options);
        } else if (active.kind === 'link') {
          await deleteExactDependencyLocator(input.nodeModulesPath, active, input.options);
        }
        active = await observeDependencyTransitionSlot(input.nodeModulesPath);
        backup = backupPath === null ? null : await observeDependencyTransitionSlot(backupPath);
        transition = await advanceDependencyTransition(transition, {
          destination: transitionAbsentSlot(input.nodeModulesPath),
          backup,
          phase: 'backed-up',
          durability: 'known',
          failure: null
        }, input.options);
      }
    }

    active = await observeDependencyTransitionSlot(input.nodeModulesPath);
    stage = stagePath === null ? null : await observeDependencyTransitionSlot(stagePath);
    if (transition.phase === 'backed-up' || transition.phase === 'recovery-required' ||
        transition.phase === 'prepared') {
      if (active.kind === 'absent' && stage !== null && stage.kind !== 'absent') {
        await assertProjectSourceGenerationCurrent({
          binding: input.binding,
          options: input.options,
          sourceGeneration: input.sourceGeneration
        });
        if (input.isolated) {
          if (stage.kind !== 'directory') return failRecovery(new SecError('RUNTIME-DEPS-004', 'Project dependency staged directory is foreign and preserved'));
          await renameCompilerDependencyDirectory(stagePath!, input.nodeModulesPath, input.options);
        } else {
          if (stage.kind !== 'link') return failRecovery(new SecError('RUNTIME-DEPS-004', 'Project dependency staged bridge is foreign and preserved'));
          await renameDependencyLocator(stagePath!, input.nodeModulesPath, input.sourceNodeModulesPath, input.options);
        }
        active = await observeDependencyTransitionSlot(input.nodeModulesPath, generatedStateDigest(input.binding));
        stage = await observeDependencyTransitionSlot(stagePath!);
        transition = await advanceDependencyTransition(transition, {
          destination: active,
          stage,
          stageRoot,
          phase: 'published',
          durability: 'known',
          failure: null
        }, input.options);
      } else if (active.kind !== 'absent') {
        if (transition.destination.kind !== 'absent' &&
            !transitionSlotMatches(active, transition.destination)) {
          return failRecovery(new SecError('RUNTIME-DEPS-004', 'Project dependency published target identity is foreign and preserved'));
        }
        if (transition.destination.kind === 'absent' &&
            (transition.phase !== 'recovery-required' || stage === null || stage.kind === 'absent')) {
          return failRecovery(new SecError('RUNTIME-DEPS-004', 'Project dependency target appeared without a durable publish receipt'));
        }
      } else if (transition.phase !== 'recovery-required') {
        return failRecovery(new SecError('RUNTIME-DEPS-004', 'Project dependency transition has no staged or active target'));
      }
    }

    active = await observeDependencyTransitionSlot(input.nodeModulesPath, generatedStateDigest(input.binding));
    if (active.kind === 'absent') {
      return failRecovery(new SecError('RUNTIME-DEPS-004', 'Project dependency transition has no recoverable target'));
    }
    if (transition.destination.kind !== 'absent' && !transitionSlotMatches(active, transition.destination)) {
      return failRecovery(new SecError('RUNTIME-DEPS-004', 'Project dependency destination identity changed and is preserved'));
    }
    const validated = await assertProjectProjectionPublished({
      binding: input.binding,
      compilerDependencyRoot: input.compilerDependencyRoot,
      isolated: input.isolated,
      nodeModulesPath: input.nodeModulesPath,
      options: input.options,
      runtimeSpec: input.runtimeSpec,
      sourceGeneration: input.sourceGeneration,
      sourceNodeModulesPath: input.sourceNodeModulesPath
    });
    transition = await advanceDependencyTransition(transition, {
      destination: await observeDependencyTransitionSlot(input.nodeModulesPath, generatedStateDigest(input.binding)),
      stage: stagePath === null ? null : await observeDependencyTransitionSlot(stagePath),
      stageRoot,
      phase: 'binding-validated',
      durability: 'known',
      failure: null
    }, input.options);

    const stampState = await observeProjectStamp(input.projectRootPath);
    if (stampState.stamp !== null &&
        stampState.stamp.binding.revision !== input.binding.revision) {
      return failRecovery(new SecError('RUNTIME-DEPS-004', 'Foreign project dependency stamp is preserved'));
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
      return failRecovery(new SecError('RUNTIME-DEPS-004', 'Recovered project dependency stamp failed exact readback'));
    }
    transition = await advanceDependencyTransition(transition, {
      destination: await observeDependencyTransitionSlot(input.nodeModulesPath, generatedStateDigest(input.binding)),
      sourceGeneration: validated.sourceGeneration,
      phase: 'stamp-readback',
      durability: 'known',
      failure: null
    }, input.options);
    if (stagePath !== null) {
      await disposeDependencyTransitionStage(
        input.compilerDependencyRoot,
        path.dirname(stagePath),
        runtimeDependencyOperationOptions({ ...input.options, generatedStateLifecycle: undefined }),
        'project-projection-recovered',
        transition.stage,
        transition.stageRoot,
        projectDependencyStageAuthority(input.projectRootPath)
      );
    }
    await advanceDependencyTransition(transition, {
      destination: await observeDependencyTransitionSlot(input.nodeModulesPath, generatedStateDigest(input.binding)),
      stage: stagePath === null ? null : transitionAbsentSlot(stagePath),
      stageRoot: stageRootPath === null ? null : transitionAbsentSlot(stageRootPath),
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

type CompilerDependencyBridgeSourceObservation = Readonly<{
  binding: Readonly<CompilerDepsBinding>;
  ownerRoot: string;
  sourceGeneration: Readonly<RuntimeDependencySourceGeneration>;
  sourcePath: string;
}>;

/**
 * Reconstructs bridge provenance from the canonical compiler generation.  A
 * bridge journal never treats its caller-supplied source path or a link's
 * current realpath as authority: the owner root, binding, tree digest and
 * source physical identity are all rebuilt before a bridge effect or
 * recovery effect is admitted.
 */
async function compilerDependencyBridgeSourceObservation(
  sourcePath: string,
  options: RuntimeDependencyOperationOptions,
  expected?: Readonly<{
    bindingDigest: `sha256:${string}`;
    epoch: `sha256:${string}`;
    physical: GeneratedStatePhysicalIdentity;
    sourcePath: string;
    treeDigest: `sha256:${string}`;
    treeEntryCount: number;
  }>
): Promise<CompilerDependencyBridgeSourceObservation> {
  const absoluteSourcePath = path.resolve(sourcePath);
  if (path.basename(absoluteSourcePath).toLocaleLowerCase('en-US') !== 'node_modules') {
    throw new SecError(
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
    throw new SecError(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency bridge source has no current canonical generation binding'
    );
  }
  const sourceGeneration = await runtimeDependencySourceGeneration({
    binding,
    options,
    ownerRoot,
    sourcePath: absoluteSourcePath
  });
  if (expected !== undefined && (
    sourceGeneration.sourcePath !== path.resolve(expected.sourcePath) ||
    generatedStateDigest(binding) !== expected.bindingDigest ||
    sourceGeneration.epoch !== expected.epoch ||
    sourceGeneration.treeDigest !== expected.treeDigest ||
    sourceGeneration.treeEntryCount !== expected.treeEntryCount ||
    !sameGeneratedStateIdentity(sourceGeneration.physical, expected.physical)
  )) {
    throw new SecError(
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

function assertCompilerDependencyBridgeTransitionTopology(
  transition: DependencyTransitionJournal,
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
    throw new SecError(
      'IMPORT-AUTHORITY-004',
      'Compiler bridge transition journal targets a foreign canonical topology'
    );
  }
  assertTransitionOperationKey(transition);
}

function compilerDependencyBridgeLinkMatches(
  bridgePath: string,
  source: CompilerDependencyBridgeSourceObservation,
  expected?: DependencyTransitionSlot
): boolean {
  const bridgeRoot = path.dirname(path.resolve(bridgePath));
  const bridgeName = path.basename(path.resolve(bridgePath));
  const bridge = inspectExactNoFollowLinkEntry(
    inspectNoFollowDirectoryChain(bridgeRoot, 'Compiler dependency bridge consumer root').target,
    bridgeName,
    source.sourcePath
  );
  if (bridge === null || bridge.kind !== 'link' || bridge.linkTarget === null) return false;
  if (expected !== undefined) {
    const observed = transitionSlotFromPhysical({
      path: bridgePath,
      kind: 'link',
      physical: Object.freeze({
        device: bridge.device,
        inode: bridge.inode,
        objectId: generatedStateDigest({ kind: 'link', target: bridge.linkTarget })
      }),
      linkTarget: bridge.linkTarget,
      bindingDigest: expected.bindingDigest
    });
    if (!transitionSlotMatches(observed, expected)) return false;
  }
  return true;
}

async function recoverCompilerDependencyBridgeTransition(
  compilerDependencyRoot: string,
  bridgeConsumerRoot: string,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  const ownerRoot = path.resolve(compilerDependencyRoot);
  const bridgePath = path.join(path.resolve(bridgeConsumerRoot), 'node_modules');
  const initial = await readDependencyTransition(ownerRoot, options);
  if (initial === null || initial.phase === 'complete' || initial.phase === 'rolled-back') return;
  if (initial.kind !== 'compiler-bridge') {
    throw new SecError(
      'RUNTIME-DEPS-004',
      'Compiler bridge recovery found another active compiler transition; residue is preserved'
    );
  }
  let transition = initial;
  const failRecovery = async (error: unknown): Promise<never> => {
    await markDependencyTransitionFailure(transition, error, options).catch(() => undefined);
    throw new SecError('IMPORT-AUTHORITY-004', 'Compiler dependency bridge requires owner recovery', {
      cause: error instanceof Error ? error.message : String(error),
      transitionDigest: transition.recordDigest,
      recoveryRequired: true
    });
  };

  try {
    assertCompilerDependencyBridgeTransitionTopology(transition, ownerRoot, bridgePath);
    const ownerIdentity = inspectNoFollowDirectoryChain(
      ownerRoot,
      'Compiler dependency bridge owner root recovery'
    ).target;
    if (!sameGeneratedStateIdentity(
      generatedStatePhysicalIdentity(ownerIdentity),
      transition.ownerRootPhysical
    )) {
      return failRecovery(new SecError(
        'IMPORT-AUTHORITY-004',
        'Compiler dependency bridge owner root identity changed'
      ));
    }
    const source = await compilerDependencyBridgeSourceObservation(
      transition.sourceGeneration.sourcePath,
      options,
      transition.sourceGeneration
    ).catch((error) => failRecovery(error));
    let bridge = await observeDependencyTransitionSlot(bridgePath, transition.sourceGeneration.bindingDigest);
    const bridgeMatches = (): boolean => compilerDependencyBridgeLinkMatches(
      bridgePath,
      source,
      transition.phase === 'prepared' || transition.phase === 'recovery-required'
        ? undefined
        : transition.destination
    );

    if (transition.phase === 'prepared') {
      if (bridge.kind === 'absent') {
        transition = await advanceDependencyTransition(transition, {
          destination: transitionAbsentSlot(bridgePath),
          phase: 'rolled-back',
          durability: 'known',
          failure: null
        }, options);
        return;
      }
      if (bridge.kind !== 'link' || !bridgeMatches()) {
        return failRecovery(new SecError(
          'IMPORT-AUTHORITY-004',
          'Compiler dependency bridge contains a foreign pre-effect target and is preserved'
        ));
      }
      bridge = await observeDependencyTransitionSlot(bridgePath, transition.sourceGeneration.bindingDigest);
      transition = await advanceDependencyTransition(transition, {
        destination: bridge,
        phase: 'published',
        durability: 'known',
        failure: null
      }, options);
    }

    if (transition.phase !== 'published' && transition.phase !== 'recovery-required') {
      return failRecovery(new SecError(
        'IMPORT-AUTHORITY-004',
        `Compiler dependency bridge has unsupported recovery phase ${transition.phase}`
      ));
    }
    bridge = await observeDependencyTransitionSlot(bridgePath, transition.sourceGeneration.bindingDigest);
    if (bridge.kind === 'absent') {
      transition = await advanceDependencyTransition(transition, {
        destination: transitionAbsentSlot(bridgePath),
        phase: 'rolled-back',
        durability: 'known',
        failure: null
      }, options);
      return;
    }
    if (bridge.kind !== 'link' || !bridgeMatches()) {
      return failRecovery(new SecError(
        'IMPORT-AUTHORITY-004',
        'Compiler dependency bridge recovery target is foreign and preserved'
      ));
    }
    const locator = compilerDependencyLocatorObservation(
      path.resolve(bridgeConsumerRoot),
      'node_modules'
    );
    if (locator === null) {
      return failRecovery(new SecError(
        'IMPORT-AUTHORITY-004',
        'Compiler dependency bridge locator disappeared before exact cleanup'
      ));
    }
    await deleteExactCompilerDependencyLocator(path.resolve(bridgeConsumerRoot), locator, options);
    const after = await observeDependencyTransitionSlot(bridgePath);
    if (after.kind !== 'absent') {
      return failRecovery(new SecError(
        'IMPORT-AUTHORITY-004',
        'Compiler dependency bridge cleanup failed exact absence readback'
      ));
    }
    await options.beforeCommit?.();
    await advanceDependencyTransition(transition, {
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
  const operationOptions = runtimeDependencyOperationOptions(options);
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
  return withCompilerDependencyTransitionLease(compilerDependencyRoot, operationOptions, async () => {
    // The lease admits recovery before this call observes the bridge.  A
    // prepared/published bridge left by a crashed process is therefore never
    // silently adopted by a later callback.
    await recoverCompilerDependencyBridgeTransition(
      compilerDependencyRoot,
      consumerRoot,
      operationOptions
    );
    const source = await compilerDependencyBridgeSourceObservation(sourcePath, operationOptions);
    const existing = await observeDependencyTransitionSlot(
      bridgePath,
      generatedStateDigest(source.binding)
    );
    if (existing.kind !== 'absent') {
      if (existing.kind !== 'link' || !compilerDependencyBridgeLinkMatches(bridgePath, source, existing)) {
        throw new SecError(
          'IMPORT-AUTHORITY-004',
          'Existing project dependency bridge is foreign and preserved'
        );
      }
      runtimeDependencyOperationRemainingMs(operationOptions, 'Project dependency bridge callback admission');
      const result = await callback();
      runtimeDependencyOperationRemainingMs(operationOptions, 'Project dependency bridge callback settlement');
      await compilerDependencyBridgeSourceObservation(source.sourcePath, operationOptions, source.sourceGeneration);
      const after = await observeDependencyTransitionSlot(bridgePath);
      if (after.kind !== 'link' || !compilerDependencyBridgeLinkMatches(bridgePath, source, after)) {
        throw new SecError(
          'IMPORT-AUTHORITY-004',
          'Existing project dependency bridge changed during callback and is preserved'
        );
      }
      return result;
    }

    let transition = await beginDependencyTransition({
      kind: 'compiler-bridge',
      ownerRoot: compilerDependencyRoot,
      destinationPath: bridgePath,
      stagePath: null,
      stageRootPath: null,
      backupPath: null,
      sourceGeneration: source.sourceGeneration,
      bindingDigest: generatedStateDigest(source.binding),
      options: operationOptions
    });
    try {
      await createCompilerDependencyLocator(
        bridgePath,
        source.sourcePath,
        source.sourceGeneration.physical,
        operationOptions
      );
      const published = await observeDependencyTransitionSlot(
        bridgePath,
        generatedStateDigest(source.binding)
      );
      if (published.kind !== 'link' || !compilerDependencyBridgeLinkMatches(bridgePath, source, published)) {
        throw new SecError(
          'IMPORT-AUTHORITY-004',
          'Compiler dependency bridge publication failed exact link readback'
        );
      }
      transition = await advanceDependencyTransition(transition, {
        destination: published,
        phase: 'published',
        durability: 'known',
        failure: null
      }, operationOptions);
      runtimeDependencyOperationRemainingMs(operationOptions, 'Project dependency bridge callback admission');
      const result = await callback();
      runtimeDependencyOperationRemainingMs(operationOptions, 'Project dependency bridge callback settlement');
      await compilerDependencyBridgeSourceObservation(source.sourcePath, operationOptions, source.sourceGeneration);
      await removeCompilerDependencyBridge(consumerRoot, source, transition, operationOptions);
      return result;
    } catch (error) {
      try {
        await removeCompilerDependencyBridge(consumerRoot, source, transition, operationOptions);
      } catch (cleanupError) {
        throw new SecError('IMPORT-AUTHORITY-004', 'Compiler dependency bridge residue is preserved for recovery', {
          cause: error instanceof Error ? error.message : String(error),
          cleanup: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          transitionDigest: transition.recordDigest
        });
      }
      throw error;
    }
  });
}

async function removeCompilerDependencyBridge(
  consumerRoot: string,
  source: CompilerDependencyBridgeSourceObservation,
  transition: DependencyTransitionJournal,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  if (transition.phase === 'rolled-back' || transition.phase === 'complete') return;
  // A link is operation-owned only while the compiler generation it names is
  // the exact source generation admitted in the journal.  Re-prove that fact
  // before cleanup as well as before publication; otherwise a callback error
  // could turn a source-path drift into an implicit delete authority.
  await compilerDependencyBridgeSourceObservation(source.sourcePath, options, source.sourceGeneration);
  const bridgePath = path.join(path.resolve(consumerRoot), 'node_modules');
  const current = await observeDependencyTransitionSlot(bridgePath);
  if (current.kind === 'absent') {
    await advanceDependencyTransition(transition, {
      destination: transitionAbsentSlot(bridgePath),
      phase: 'rolled-back',
      durability: 'known',
      failure: null
    }, options);
    return;
  }
  if (current.kind !== 'link' || !compilerDependencyBridgeLinkMatches(bridgePath, source, transition.destination)) {
    throw new SecError('IMPORT-AUTHORITY-004', 'Compiler dependency bridge changed before exact cleanup and is preserved');
  }
  const locator = compilerDependencyLocatorObservation(path.resolve(consumerRoot), 'node_modules');
  if (locator === null) {
    throw new SecError('IMPORT-AUTHORITY-004', 'Compiler dependency bridge locator disappeared before exact cleanup');
  }
  await deleteExactCompilerDependencyLocator(path.resolve(consumerRoot), locator, options);
  const after = await observeDependencyTransitionSlot(bridgePath);
  if (after.kind !== 'absent') {
    throw new SecError('IMPORT-AUTHORITY-004', 'Compiler dependency bridge cleanup failed exact absence readback');
  }
  await advanceDependencyTransition(transition, {
    destination: after,
    phase: 'rolled-back',
    durability: 'known',
    failure: null
  }, options);
}

async function stageCompilerDependencyGeneration(
  root: string,
  identity: CompilerDependencyIdentity,
  options: RuntimeDependencyOperationOptions
): Promise<{
  binding: CompilerDepsBinding;
  stageIntent: CompilerDependencyStageIntent;
  stagingRoot: string;
  stagingRootSlot: DependencyTransitionSlot;
}> {
  const stagingParent = path.join(root, '.tmp', 'dependency-installs');
  const compilerRootIdentity = inspectNoFollowDirectoryChain(
    root,
    'Compiler dependency staging root'
  ).target;
  await runtimeDependencyOperationEffectFence(options, 'Compiler dependency staging namespace creation');
  createNoFollowOrdinaryDirectoryChain(
    compilerRootIdentity,
    ['.tmp', 'dependency-installs']
  );
  await runtimeDependencyOperationEffectFence(options, 'Compiler dependency staging-root creation');
  const stagingParentIdentity = inspectNoFollowDirectoryChain(
    stagingParent,
    'Compiler dependency staging parent'
  ).target;
  const stagingRoot = createExclusiveNoFollowRandomDirectory(
    stagingParentIdentity,
    'c.staging-'
  ).path;
  const stagingRootSlot = await observeDependencyTransitionSlot(stagingRoot);
  const stagingRelativePath = path.relative(root, stagingRoot).replaceAll('\\', '/');
  let lifecycleRegistered = false;
  let stageIntent: CompilerDependencyStageIntent | null = null;
  let stagingNodeModulesSlot: DependencyTransitionSlot | null = null;
  try {
    if (options.generatedStateLifecycle !== undefined) {
      await runtimeDependencyOperationEffectFence(options, 'Compiler dependency staging lifecycle birth');
      await options.generatedStateLifecycle.born(
        stagingRelativePath,
        `compiler-dependency-generation:${identity.manifestHash}:${path.basename(stagingRoot)}`
      );
      lifecycleRegistered = true;
    }
    const operationContext = runtimeDependencyOperationContext(options);
    const preparedStageIntent = preparedCompilerDependencyStageIntent({
      operationId: operationContext.operationId,
      operationInitialBudgetMs: operationContext.initialBudgetMs,
      ownerRoot: compilerRootIdentity,
      stageRoot: stagingRootSlot
    });
    await writeCompilerDependencyStageIntent(root, preparedStageIntent, options);
    stageIntent = preparedStageIntent;
    const sourceRootIdentity = inspectNoFollowDirectoryChain(
      root,
      'Compiler dependency source root'
    ).target;
    const stagedRootIdentity = inspectNoFollowDirectoryChain(
      stagingRoot,
      'Compiler dependency staging root readback'
    ).target;
    const stageCanonicalInput = async (name: 'package.json' | 'bun.lock' | 'bunfig.toml') => {
      const sourceEntry = inspectNoFollowOrdinaryFileEntry(sourceRootIdentity, name);
      if (sourceEntry === null) return null;
      if (sourceEntry.kind !== 'file' || sourceEntry.bytes === null) {
        throw new SecError(
          'IMPORT-AUTHORITY-001',
          `Compiler dependency input ${name} is not an ordinary no-follow file`
        );
      }
      // The source parent and the newly-created stage parent are both fenced
      // immediately around publication.  Publication itself is no-replace,
      // retained-parent and durable; a substituted source is therefore a
      // typed failure rather than a path-following copy.
      assertSameNoFollowDirectoryIdentity(sourceRootIdentity, 'Compiler dependency source root before stage input');
      assertSameNoFollowDirectoryIdentity(stagedRootIdentity, 'Compiler dependency staging root before stage input');
      const bytes = Buffer.from(sourceEntry.bytes);
      await runtimeDependencyOperationEffectFence(options, `Compiler dependency staged ${name} publication`);
      publishExclusiveDurableCanonicalFile({
        parent: stagedRootIdentity,
        name,
        bytes,
        validate: (candidate) => {
          if (!Buffer.from(candidate).equals(bytes)) {
            throw new SecError('IMPORT-AUTHORITY-001', `Compiler dependency staged input ${name} bytes differ`);
          }
        }
      });
      assertSameNoFollowDirectoryIdentity(sourceRootIdentity, 'Compiler dependency source root after stage input');
      assertSameNoFollowDirectoryIdentity(stagedRootIdentity, 'Compiler dependency staging root after stage input');
      const stagedEntry = inspectNoFollowOrdinaryFileEntry(stagedRootIdentity, name);
      if (stagedEntry === null || stagedEntry.kind !== 'file' || stagedEntry.bytes === null ||
          !Buffer.from(stagedEntry.bytes).equals(bytes)) {
        throw new SecError('IMPORT-AUTHORITY-001', `Compiler dependency staged input ${name} failed exact readback`);
      }
      return bytes;
    };
    const sourcePackageBytes = await stageCanonicalInput('package.json');
    const sourceLockBytes = await stageCanonicalInput('bun.lock');
    if (sourcePackageBytes === null || sourceLockBytes === null ||
        digest(sourcePackageBytes) !== identity.packageSourceSha256 ||
        digest(sourceLockBytes) !== identity.lockSha256) {
      throw new SecError('IMPORT-AUTHORITY-001', 'Compiler dependency inputs changed before staging');
    }
    const installConfigBytes = await stageCanonicalInput('bunfig.toml');
    if (compilerInstallConfigSha256(installConfigBytes) !== identity.installConfigSha256) {
      throw new SecError('IMPORT-AUTHORITY-001', 'Compiler dependency install config changed before staging');
    }

    const cacheDir = path.join(root, '.shared-deps', '.bun-cache');
    const runtimeExecutable = await currentRuntimeExecutableIdentity(true);
    if (runtimeExecutable.path !== identity.bunExecutablePath ||
      runtimeExecutable.sha256 !== identity.bunExecutableSha256) {
      throw new SecError('IMPORT-AUTHORITY-001', 'Bun executable changed before dependency materialization');
    }
    const compilerInputFence = async (): Promise<void> => {
      assertCompilerDependencyInputsCurrent(root, identity);
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
    const nodeModulesIdentity = inspectNoFollowDirectoryChain(
      nodeModulesPath,
      'Compiler dependency staged node_modules'
    ).target;
    const bindingBytes = Buffer.from(formatJsonFile(binding), 'utf8');
    await runtimeDependencyOperationEffectFence(options, 'Compiler dependency staged binding publication');
    publishExclusiveDurableCanonicalFile({
      parent: nodeModulesIdentity,
      name: COMPILER_DEPS_BINDING_FILE,
      bytes: bindingBytes,
      validate: (candidate) => {
        if (!Buffer.from(candidate).equals(bindingBytes)) {
          throw new SecError('IMPORT-AUTHORITY-002', 'Compiler dependency staged binding bytes differ');
        }
      }
    });
    assertSameNoFollowDirectoryIdentity(nodeModulesIdentity, 'Compiler dependency staged node_modules readback');
    stagingNodeModulesSlot = await observeDependencyTransitionSlot(
      nodeModulesPath,
      generatedStateDigest(binding)
    );
    if (stagingNodeModulesSlot.kind === 'absent') {
      throw new SecError('IMPORT-AUTHORITY-002', 'Compiler dependency generation stage disappeared before publication');
    }
    return { binding, stageIntent, stagingRoot, stagingRootSlot };
  } catch (error) {
    try {
      if (stageIntent !== null) {
        await settleCompilerDependencyStageIntent(
          root,
          stageIntent,
          lifecycleRegistered ? 'generation-aborted' : 'generation-aborted-before-registration',
          options
        );
      } else {
        await disposeDependencyTransitionStage(
          root,
          stagingRoot,
          options,
          lifecycleRegistered ? 'generation-aborted' : 'generation-aborted-before-registration',
          stagingNodeModulesSlot,
          stagingRootSlot,
          compilerDependencyStageAuthority(root)
        );
      }
    } catch (disposeError) {
      throw new SecError('IMPORT-AUTHORITY-004', 'Compiler dependency generation staging residue is preserved for recovery', {
        cause: error instanceof Error ? error.message : String(error),
        cleanup: disposeError instanceof Error ? disposeError.message : String(disposeError),
        stagingRoot
      });
    }
    if (error instanceof SecError && error.code.startsWith('IMPORT-AUTHORITY-')) throw error;
    const causeMessage = error instanceof SecError
      ? JSON.stringify(error.details).slice(-2000)
      : error instanceof Error ? error.message : String(error);
    throw new SecError(
      'IMPORT-AUTHORITY-002',
      `Compiler dependency generation could not be materialized: ${causeMessage}`,
      {
      cause: error instanceof SecError ? {
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
  options: RuntimeDependencyOperationOptions
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
      await runtimeDependencyOperationEffectFence(options, 'Compiler dependency test rename');
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
        await waitForRuntimeDependencyOperation(
          options,
          delayMs,
          sleep,
          'Compiler dependency transient rename retry'
        );
      }
    }
    return;
  }

  const expectedSource = inspectNoFollowDirectoryChain(
    source,
    'Compiler dependency generation source'
  ).target;
  const destinationParent = inspectNoFollowDirectoryChain(
    path.dirname(path.resolve(target)),
    'Compiler dependency generation destination parent'
  ).target;
  const currentTarget = await observeDependencyTransitionSlot(target);
  if (currentTarget.kind !== 'absent') {
    throw new SecError('IMPORT-AUTHORITY-004', 'Compiler dependency generation target is occupied and preserved');
  }
  await runtimeDependencyOperationEffectFence(options, 'Compiler dependency retained directory relocation');
  try {
    relocateRetainedNoFollowDirectoryAcrossParents({
      directory: expectedSource,
      destinationParent,
      tombstoneName: path.basename(path.resolve(target))
    });
  } catch (error) {
    const sourceAfter = inspectExactNoFollowDirectoryPresence(source, 'Compiler dependency generation source');
    const targetAfter = await observeDependencyTransitionSlot(target);
    if (sourceAfter.state === 'absent' && targetAfter.kind === 'directory' &&
      targetAfter.physical !== null && sameGeneratedStateIdentity(
        targetAfter.physical,
        generatedStatePhysicalIdentity(expectedSource)
      )) {
      throw new SecError(
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
async function renameDependencyLocator(
  source: string,
  target: string,
  expectedLinkTarget: string,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  const sourceParent = inspectNoFollowDirectoryChain(
    path.dirname(path.resolve(source)),
    'Dependency locator source parent'
  ).target;
  const targetParent = inspectNoFollowDirectoryChain(
    path.dirname(path.resolve(target)),
    'Dependency locator destination parent'
  ).target;
  const sourceEntry = inspectExactNoFollowLinkEntry(
    sourceParent,
    path.basename(path.resolve(source)),
    expectedLinkTarget
  );
  if (sourceEntry === null || sourceEntry.kind !== 'link' || sourceEntry.linkTarget === null) {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency locator stage is not the expected physical link');
  }
  if ((await observeDependencyTransitionSlot(target)).kind !== 'absent') {
    throw new SecError('RUNTIME-DEPS-004', 'Dependency locator destination is occupied and preserved');
  }
  const expectedSource = inspectNoFollowDirectoryChain(
    expectedLinkTarget,
    'Dependency locator source target'
  ).target;
  await runtimeDependencyOperationEffectFence(options, 'Dependency locator retained relocation');
  try {
    relocateRetainedNoFollowLinkAcrossParents({
      sourceParent,
      destinationParent: targetParent,
      sourceName: path.basename(path.resolve(source)),
      destinationName: path.basename(path.resolve(target)),
      expectedSource,
      expectedTargetPath: expectedLinkTarget
    });
  } catch (error) {
    const sourceAfter = inspectNoFollowLinkEntry(sourceParent, path.basename(path.resolve(source)));
    const targetAfter = inspectExactNoFollowLinkEntry(
      targetParent,
      path.basename(path.resolve(target)),
      expectedLinkTarget
    );
    if (sourceAfter === null && targetAfter?.kind === 'link') {
      throw new SecError('RUNTIME-DEPS-002', 'Dependency locator rename reached topology but durability is unknown; recovery is required', {
        cause: error instanceof Error ? error.message : String(error),
        source,
        target
      });
    }
    throw error;
  }
  const sourceAfter = inspectNoFollowLinkEntry(sourceParent, path.basename(path.resolve(source)));
  const targetAfter = inspectExactNoFollowLinkEntry(
    targetParent,
    path.basename(path.resolve(target)),
    expectedLinkTarget
  );
  const targetIdentity = targetAfter === null || targetAfter.linkTarget === null
    ? null
    : Object.freeze({
      device: targetAfter.device,
      inode: targetAfter.inode,
      objectId: generatedStateDigest({ kind: 'link', target: targetAfter.linkTarget })
    });
  const expectedIdentity = Object.freeze({
    device: sourceEntry.device,
    inode: sourceEntry.inode,
    objectId: generatedStateDigest({ kind: 'link', target: sourceEntry.linkTarget })
  });
  if (sourceAfter !== null || targetAfter === null || targetAfter.kind !== 'link' ||
      targetAfter.linkTarget === null || targetIdentity === null ||
      !sameGeneratedStatePhysicalIdentity(targetIdentity, expectedIdentity) ||
      !sameGeneratedStateIdentity(
        generatedStatePhysicalIdentity(targetParent),
        generatedStatePhysicalIdentity(inspectNoFollowDirectoryChain(
          path.dirname(path.resolve(target)),
          'Dependency locator destination parent readback'
        ).target)
      )) {
    throw new SecError('RUNTIME-DEPS-002', 'Dependency locator rename failed exact no-follow readback; recovery is required', {
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
  stageIntent: CompilerDependencyStageIntent,
  identity: CompilerDependencyIdentity,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  const stagingNodeModulesPath = path.join(stagingRoot, 'node_modules');
  const namespace = await ensureDependencyTransitionNamespace(root, options);
  const stagedBinding = await compilerDependencyGenerationBinding(
    root,
    stagingNodeModulesPath,
    path.join(stagingNodeModulesPath, COMPILER_DEPS_BINDING_FILE),
    identity
  );
  if (stagedBinding === null) {
    throw new SecError('IMPORT-AUTHORITY-002', 'Staged compiler dependency generation has no valid binding');
  }
  const bindingDigest = generatedStateDigest(stagedBinding);
  const sourceGeneration = await runtimeDependencySourceGeneration({
    binding: stagedBinding,
    options,
    ownerRoot: root,
    sourcePath: stagingNodeModulesPath
  });
  const backupPath = path.join(
    namespace.backupRoot.path,
    `node_modules-${sourceGeneration.epoch.slice('sha256:'.length, 'sha256:'.length + 24)}`
  );
  let transition = await beginDependencyTransition({
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
  let preserveStageForRecovery = false;
  let retiredPreimageRegistrationDigest: `sha256:${string}` | null = null;
  try {
    if (transition.preimage.kind !== 'absent') {
      if (transition.preimage.kind !== 'directory') {
        throw new SecError('IMPORT-AUTHORITY-004', 'Existing compiler dependency target is foreign and preserved');
      }
      await compilerDependencyGeneratedPreimageDigest(activeNodeModulesPath);
      retiredPreimageRegistrationDigest = await bindAndRetireCompilerDependencyPreimage(
        options,
        transition.preimage.physical!,
        'generation-superseded'
      );
      await renameCompilerDependencyDirectory(activeNodeModulesPath, backupPath, options);
      activeBackedUp = true;
      transition = await advanceDependencyTransition(transition, {
        destination: transitionAbsentSlot(activeNodeModulesPath),
        backup: await observeDependencyTransitionSlot(backupPath, transition.preimage.bindingDigest),
        phase: 'backed-up',
        durability: 'known',
        failure: null
      }, options);
      await options.testCompilerPublishHook?.('active-backed-up');
    }
    await settleRetiredCompilerDependencyGeneration(
      options,
      transition.preimage.kind === 'directory'
        ? transition.preimage.physical ?? undefined
        : undefined
    );
    await renameCompilerDependencyDirectory(stagingNodeModulesPath, activeNodeModulesPath, options);
    published = true;
    transition = await advanceDependencyTransition(transition, {
      destination: await observeDependencyTransitionSlot(activeNodeModulesPath, bindingDigest),
      stage: transitionAbsentSlot(stagingNodeModulesPath),
      sourceGeneration: sourceGenerationWithPath(sourceGeneration, activeNodeModulesPath),
      phase: 'published',
      durability: 'known',
      failure: null
    }, options);
    if (transition.destination.physical === null) {
      throw new SecError(
        'IMPORT-AUTHORITY-004',
        'Published compiler dependency target has no physical lifecycle identity'
      );
    }
    await birthAndBindCompilerDependencyGeneration(
      options,
      stagingRoot,
      transition.destination.physical
    );
    await settleCompilerDependencyStageIntent(root, stageIntent, 'generation-published', options);
    transition = await advanceDependencyTransition(transition, {
      stageRoot: transitionAbsentSlot(stagingRoot),
      phase: 'binding-validated',
      durability: 'known',
      failure: null
    }, options);
    const final = await observeDependencyTransitionSlot(activeNodeModulesPath, bindingDigest);
    if (!transitionSlotMatches(final, transition.destination)) {
      throw new SecError('IMPORT-AUTHORITY-004', 'Published compiler dependency target identity changed');
    }
    await advanceDependencyTransition(transition, {
      destination: final,
      stageRoot: transitionAbsentSlot(stagingRoot),
      phase: 'complete',
      durability: 'known',
      failure: null
    }, options);
  } catch (error) {
    let rollbackFailure: unknown;
    const activeNow = await observeDependencyTransitionSlot(activeNodeModulesPath).catch(() => null);
    const backupNow = await observeDependencyTransitionSlot(backupPath).catch(() => null);
    const stageNow = await observeDependencyTransitionSlot(stagingNodeModulesPath).catch(() => null);
    const topologyRequiresRecovery = activeNow !== null && backupNow !== null && stageNow !== null &&
      (activeNow.kind === 'absent' || backupNow.kind === 'directory' || stageNow.kind === 'directory');
    if (activeBackedUp && activeNow?.kind === 'absent' && backupNow?.kind === 'directory') {
      try {
        await renameCompilerDependencyDirectory(backupPath, activeNodeModulesPath, options);
        const lifecycle = options.generatedStateLifecycle;
        if (lifecycle?.restore === undefined || retiredPreimageRegistrationDigest === null) {
          throw new SecError(
            'IMPORT-AUTHORITY-004',
            'Compiler dependency rollback has no exact retired registration predecessor; recovery backup is preserved'
          );
        }
        const restoredTarget = await observeDependencyTransitionSlot(activeNodeModulesPath);
        if (restoredTarget.kind !== 'directory' || restoredTarget.physical === null ||
            transition.preimage.physical === null ||
            !sameGeneratedStateIdentity(restoredTarget.physical, transition.preimage.physical)) {
          throw new SecError(
            'IMPORT-AUTHORITY-004',
            'Compiler dependency rollback target identity changed before lifecycle restore'
          );
        }
        await runtimeDependencyOperationEffectFence(options, 'Compiler dependency lifecycle restore');
        await lifecycle.restore(
          'node_modules',
          retiredPreimageRegistrationDigest,
          restoredTarget.physical,
          'compiler-dependency-preimage-restored'
        );
        await advanceDependencyTransition(transition, {
          destination: restoredTarget,
          backup: transitionAbsentSlot(backupPath),
          phase: 'rolled-back',
          durability: 'known',
          failure: transitionFailure(error)
        }, options);
      } catch (rollbackError) {
        rollbackFailure = rollbackError;
      }
    } else if (topologyRequiresRecovery) {
      try {
        await markDependencyTransitionFailure(transition, error, options);
        preserveStageForRecovery = true;
      } catch (journalError) {
        rollbackFailure = journalError;
      }
    }
    throw new SecError('IMPORT-AUTHORITY-004', 'Compiler dependency generation publish failed', {
      cause: error instanceof Error ? error.message : String(error),
      rollbackFailure: rollbackFailure instanceof Error ? rollbackFailure.message : rollbackFailure,
      recoveryRequired: topologyRequiresRecovery && rollbackFailure === undefined,
      transitionDigest: transition.recordDigest
    });
  } finally {
    if (!published && !preserveStageForRecovery) {
      // Only the operation-created staging tree may be converged here. The
      // exact no-follow inventory refuses a substituted/foreign tree and
      // reports a typed residue blocker instead of deleting a replacement.
      await settleCompilerDependencyStageIntent(root, stageIntent, 'generation-publish-failed', options);
    }
  }
}

async function createCompilerDependencyLocator(
  linkPath: string,
  sourcePath: string,
  expectedSource: Readonly<GeneratedStatePhysicalIdentity>,
  options: RuntimeDependencyOperationOptions
): Promise<Readonly<{ source: GeneratedStatePhysicalIdentity; linkTarget: string }>> {
  const parent = inspectNoFollowDirectoryChain(
    path.dirname(linkPath),
    'Compiler dependency locator parent'
  ).target;
  const existing = await observeDependencyTransitionSlot(linkPath);
  if (existing.kind !== 'absent') {
    throw new SecError('IMPORT-AUTHORITY-004', 'Compiler dependency locator target is occupied and preserved');
  }
  const sourceIdentity = inspectNoFollowDirectoryChain(
    sourcePath,
    'Compiler dependency locator source'
  ).target;
  const source = generatedStatePhysicalIdentity(sourceIdentity);
  if (!sameGeneratedStateIdentity(source, expectedSource)) {
    throw new SecError('IMPORT-AUTHORITY-004', 'Compiler dependency locator publication failed exact readback', {
      expectedSource,
      source,
      sourcePath
    });
  }
  try {
    await runtimeDependencyOperationEffectFence(options, 'Compiler dependency locator publication');
    assertSameNoFollowDirectoryIdentity(parent, 'Compiler dependency locator parent publication');
    assertSameNoFollowDirectoryIdentity(sourceIdentity, 'Compiler dependency locator source publication');
    publishExclusiveNoFollowLink({
      parent,
      name: path.basename(path.resolve(linkPath)),
      source: sourceIdentity,
      expectedTargetPath: sourcePath
    });
    const published = inspectExactNoFollowLinkEntry(
      parent,
      path.basename(path.resolve(linkPath)),
      sourcePath
    );
    if (published === null || published.kind !== 'link' || published.linkTarget === null) {
      throw new SecError('IMPORT-AUTHORITY-004', 'Compiler dependency locator disappeared after publication');
    }
    return Object.freeze({
      source: Object.freeze({
        device: published.device,
        inode: published.inode,
        objectId: generatedStateDigest({ kind: 'link', target: published.linkTarget })
      }),
      linkTarget: published.linkTarget
    });
  } catch (error) {
    throw new SecError('IMPORT-AUTHORITY-004', 'Compiler dependency locator publication failed exact readback', {
      expectedSource,
      source,
      sourcePath,
      cause: error instanceof Error ? error.message : String(error)
    });
  }
}

async function recoverCompilerDependencyTransition(
  root: string,
  nodeModulesPath: string,
  identity: CompilerDependencyIdentity,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  const initialTransition = await readDependencyTransition(root, options);
  if (initialTransition === null || initialTransition.phase === 'complete' || initialTransition.phase === 'rolled-back') return;
  let transition: DependencyTransitionJournal = initialTransition;

  const activePath = transition.destination.path;
  const stagePath = transition.stage?.path ?? null;
  const stageRootPath = transition.stageRoot?.path ?? null;
  const backupPath = transition.backup?.path ?? null;
  const expectedSourcePhysical = transition.sourceGeneration.physical;

  const failRecovery = async (error: unknown): Promise<never> => {
    try {
      transition = await markDependencyTransitionFailure(transition, error, options);
    } catch {
      // Preserve the original typed blocker if the journal itself is no longer
      // writable; no destructive fallback is safe at this boundary.
    }
    throw new SecError('IMPORT-AUTHORITY-004', 'Compiler dependency transition requires owner recovery', {
      cause: error instanceof Error ? error.message : String(error),
      causeDetails: error instanceof SecError ? error.details : null,
      transitionDigest: transition.recordDigest,
      phase: transition.phase
    });
  };

  const currentActive = () => observeDependencyTransitionSlot(activePath, transition.sourceGeneration.bindingDigest);
  const currentStage = () => stagePath === null
    ? Promise.resolve<DependencyTransitionSlot | null>(null)
    : observeDependencyTransitionSlot(stagePath, transition.sourceGeneration.bindingDigest);
  const currentStageRoot = () => stageRootPath === null
    ? Promise.resolve<DependencyTransitionSlot | null>(null)
    : observeDependencyTransitionSlot(stageRootPath, transition.sourceGeneration.bindingDigest);
  const currentBackup = () => backupPath === null
    ? Promise.resolve<DependencyTransitionSlot | null>(null)
    : observeDependencyTransitionSlot(backupPath, transition.preimage.bindingDigest);

  try {
    assertCompilerTransitionRecoveryTopology(initialTransition, root, nodeModulesPath);
    let active = await currentActive();
    let stage = await currentStage();
    let stageRoot = await currentStageRoot();
    let backup = await currentBackup();

    if (transition.kind === 'compiler-generation' &&
        (transition.phase === 'prepared' || transition.phase === 'recovery-required') &&
        transition.preimage.kind === 'directory' && transition.preimage.physical !== null &&
        transition.destination.kind === 'directory' && transition.destination.physical !== null &&
        transition.stage?.kind === 'directory' && transition.stage.physical !== null &&
        transition.stageRoot?.kind === 'directory' && transition.stageRoot.physical !== null &&
        active.kind === 'directory' && active.physical !== null &&
        sameGeneratedStateIdentity(active.physical, transition.preimage.physical) &&
        sameGeneratedStateIdentity(active.physical, transition.destination.physical) &&
        stage?.kind === 'absent' && stageRoot?.kind === 'absent' && backup?.kind === 'absent') {
      const stageIntents = await readCompilerDependencyStageIntents(root, options);
      if (stageRootPath !== null &&
          !stageIntents.active.some((intent) =>
            path.resolve(intent.stageRootPath) === path.resolve(stageRootPath))) {
        // The journal was durably prepared while the exact preimage still
        // occupied the destination, but its unpublished staging generation
        // disappeared before the preimage move.  The immutable record binds
        // both physical epochs and the absence of stage, stage root, backup,
        // and any competing stage-intent owner.  Recovery therefore has one
        // zero-install outcome: record the unchanged preimage as rolled back.
        // Do not re-parse, retire, move, or otherwise adopt the preimage.
        transition = await advanceDependencyTransition(transition, {
          destination: active,
          stage: transitionAbsentSlot(stagePath!),
          stageRoot: transitionAbsentSlot(stageRootPath),
          backup,
          phase: 'rolled-back',
          durability: 'known',
          failure: null
        }, options);
        return;
      }
    }
    if (transition.stageRoot !== null &&
        (stageRoot === null || !transitionSlotMatches(stageRoot, transition.stageRoot))) {
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
        return failRecovery(new SecError('IMPORT-AUTHORITY-004', 'Compiler dependency staging root identity changed and is preserved'));
      }
    }

    if (transition.kind === 'compiler-generation') {
      if (transition.preimage.kind !== 'absent' && transition.preimage.kind !== 'directory') {
        return failRecovery(new SecError('IMPORT-AUTHORITY-004', 'Foreign compiler dependency preimage is preserved'));
      }
      if (transition.preimage.kind === 'directory' && backupPath !== null &&
        (transition.phase === 'prepared' || transition.phase === 'recovery-required') &&
        active.kind === 'directory' &&
        transition.preimage.physical !== null &&
        sameGeneratedStateIdentity(active.physical!, transition.preimage.physical) &&
        backup?.kind === 'absent') {
        await compilerDependencyGeneratedPreimageDigest(activePath, {
          // v2 is never a ready generation.  It is consumed only by this
          // durable recovery branch after the current v3 stage, exact
          // preimage physical epoch, backup absence and transition identity
          // have all been read back under the compiler-root lease.
          allowLegacyRuntimeMaterializationV2: transition.phase === 'recovery-required'
        });
        await bindAndRetireCompilerDependencyPreimage(
          options,
          transition.preimage.physical!,
          'generation-recovery-superseded'
        );
        await renameCompilerDependencyDirectory(activePath, backupPath, options);
        transition = await advanceDependencyTransition(transition, {
          destination: transitionAbsentSlot(activePath),
          backup: await observeDependencyTransitionSlot(backupPath, transition.preimage.bindingDigest),
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
        transition = await advanceDependencyTransition(transition, {
          destination: transitionAbsentSlot(activePath),
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
            active.physical !== null && sameGeneratedStateIdentity(active.physical, expectedSourcePhysical)) {
            // The publish effect completed before the process lost its
            // receipt; continue with exact post-effect readback.
          } else {
            return failRecovery(new SecError('IMPORT-AUTHORITY-004', 'Compiler dependency transition active target is occupied by an unexpected identity'));
          }
        } else {
          await renameCompilerDependencyDirectory(stagePath, activePath, options);
        }
        active = await currentActive();
        stage = await currentStage();
        stageRoot = await currentStageRoot();
        if (active.kind !== 'directory' || active.physical === null ||
          !sameGeneratedStateIdentity(active.physical, expectedSourcePhysical)) {
          return failRecovery(new SecError('IMPORT-AUTHORITY-004', 'Compiler dependency transition active target failed identity readback'));
        }
        transition = await advanceDependencyTransition(transition, {
          destination: active,
          stage: stage ?? transitionAbsentSlot(stagePath),
          stageRoot,
          phase: 'published',
          durability: 'known',
          failure: null
        }, options);
      } else if ((transition.phase === 'prepared' || transition.phase === 'backed-up' ||
          transition.phase === 'recovery-required') && stagePath !== null &&
          stage?.kind === 'absent' && transition.stage?.kind === 'directory' &&
          transition.stage.physical !== null && active.kind === 'directory' &&
          active.physical !== null &&
          sameGeneratedStateIdentity(active.physical, transition.stage.physical)) {
        // The stage-to-active rename completed before its journal receipt.
        // The recorded stage identity, the now-absent exact child and the
        // active target identity together prove that exact move; no path or
        // source-generation identity is inferred independently.
        transition = await advanceDependencyTransition(transition, {
          destination: active,
          stage: transitionAbsentSlot(stagePath),
          stageRoot,
          sourceGeneration: sourceGenerationWithPath(transition.sourceGeneration, activePath),
          phase: 'published',
          durability: 'known',
          failure: null
        }, options);
      }

      if (active.kind !== 'directory' || active.physical === null ||
        !sameGeneratedStateIdentity(active.physical, expectedSourcePhysical)) {
        return failRecovery(new SecError('IMPORT-AUTHORITY-004', 'Compiler dependency transition has no exact active generation'));
      }
      const binding = await compilerDependencyGenerationBinding(
        root,
        activePath,
        path.join(activePath, COMPILER_DEPS_BINDING_FILE),
        identity
      );
      if (binding === null || generatedStateDigest(binding) !== transition.sourceGeneration.bindingDigest) {
        return failRecovery(new SecError('IMPORT-AUTHORITY-004', 'Compiler dependency transition active binding drifted'));
      }
      if (options.generatedStateLifecycle !== undefined) {
        // A crash may land after the active generation rename and journal
        // publication but before the producer registration is durably born.
        // Recovery may not declare the transition complete until the exact
        // active physical generation is bound and read back by the lifecycle
        // owner under this same compiler-root lease.
        await recoverCompilerDependencyGenerationLifecycle({
          active,
          options,
          root,
          stage,
          stagePath,
          stageRoot,
          stageRootPath,
          stagingRoot: transition.stageRoot?.path ?? path.dirname(stagePath ?? activePath),
          transition
        });
      }
      stage = await currentStage();
      stageRoot = await currentStageRoot();
      if (stageRootPath !== null && stageRoot?.kind === 'directory') {
        await disposeDependencyTransitionStage(
          root,
          stageRootPath,
          options,
          'generation-recovered',
          transition.stage,
          transition.stageRoot,
          compilerDependencyStageAuthority(root)
        );
      }
      active = await currentActive();
      stage = await currentStage();
      stageRoot = await currentStageRoot();
      backup = await currentBackup();
      transition = await advanceDependencyTransition(transition, {
        destination: active,
        stage: stage ?? (stagePath === null ? null : transitionAbsentSlot(stagePath)),
        stageRoot: stageRoot ?? (stageRootPath === null ? null : transitionAbsentSlot(stageRootPath)),
        backup,
        sourceGeneration: sourceGenerationWithPath(transition.sourceGeneration, activePath),
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
      if (sourceBinding === null || generatedStateDigest(sourceBinding) !== transition.sourceGeneration.bindingDigest) {
        return failRecovery(new SecError('IMPORT-AUTHORITY-004', 'Linked compiler dependency source drifted and is preserved'));
      }
      const sourceGeneration = await runtimeDependencySourceGeneration({
        binding: sourceBinding,
        options,
        ownerRoot: sourceOwnerRoot,
        sourcePath
      });
      if (!sameGeneratedStateIdentity(sourceGeneration.physical, expectedSourcePhysical) ||
        sourceGeneration.epoch !== transition.sourceGeneration.epoch ||
        !sameRuntimeDependencySourceGenerationContent(sourceGeneration, transition.sourceGeneration)) {
        return failRecovery(new SecError('IMPORT-AUTHORITY-004', 'Linked compiler dependency source physical epoch drifted'));
      }
      if (transition.preimage.kind !== 'absent' && transition.preimage.kind !== 'directory') {
        return failRecovery(new SecError('IMPORT-AUTHORITY-004', 'Foreign linked compiler dependency target is preserved'));
      }
      if (transition.preimage.kind === 'directory' && backupPath !== null && transition.phase === 'prepared' &&
        active.kind === 'directory' && transition.preimage.physical !== null && active.physical !== null &&
        sameGeneratedStateIdentity(active.physical, transition.preimage.physical) && backup?.kind === 'absent') {
        await compilerDependencyGeneratedPreimageDigest(activePath);
        await bindAndRetireCompilerDependencyPreimage(
          options,
          transition.preimage.physical!,
          'locator-transition-superseded'
        );
        await renameCompilerDependencyDirectory(activePath, backupPath, options);
        transition = await advanceDependencyTransition(transition, {
          destination: transitionAbsentSlot(activePath),
          stageRoot,
          backup: await currentBackup(),
          phase: 'backed-up',
          durability: 'known',
          failure: null
        }, options);
      }
      active = await currentActive();
      if (active.kind === 'absent') {
        await createCompilerDependencyLocator(activePath, sourcePath, sourceGeneration.physical, options);
        active = await currentActive();
        transition = await advanceDependencyTransition(transition, {
          destination: active,
          stageRoot,
          sourceGeneration,
          phase: 'published',
          durability: 'known',
          failure: null
        }, options);
      } else if (active.kind !== 'link' || active.linkTarget === null ||
        !sameHostPath(await fs.realpath(activePath).catch(() => ''), sourcePath)) {
        return failRecovery(new SecError('IMPORT-AUTHORITY-004', 'Linked compiler dependency target is foreign and preserved'));
      }
      const observedBinding = await compilerDependencyConsumerBridgeBinding(root, activePath, identity, options);
      if (observedBinding === null || generatedStateDigest(observedBinding) !== transition.sourceGeneration.bindingDigest) {
        return failRecovery(new SecError('IMPORT-AUTHORITY-004', 'Linked compiler dependency locator failed recovery binding'));
      }
      await bindExistingCompilerDependencyLocator(root, identity, observedBinding, options);
      transition = await advanceDependencyTransition(transition, {
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
        return failRecovery(new SecError('RUNTIME-DEPS-004', 'Foreign shared dependency preimage is preserved'));
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
        return failRecovery(new SecError('RUNTIME-DEPS-004', 'Shared dependency source topology is foreign and preserved'));
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
          generatedStateDigest(sourceRuntimeBinding) !== transition.sourceGeneration.bindingDigest) {
        return failRecovery(new SecError('RUNTIME-DEPS-004', 'Shared dependency source binding is missing or foreign and preserved'));
      }
      const currentSourceGeneration = await runtimeDependencySourceGeneration({
        binding: sourceRuntimeBinding,
        options,
        ownerRoot: sourceOwnerRoot,
        sourcePath
      });
      if (currentSourceGeneration.epoch !== transition.sourceGeneration.epoch ||
          !sameRuntimeDependencySourceGenerationContent(currentSourceGeneration, transition.sourceGeneration) ||
          !sameGeneratedStateIdentity(currentSourceGeneration.physical, transition.sourceGeneration.physical) ||
          !sameGeneratedStateIdentity(currentSourceGeneration.ownerRootPhysical, transition.sourceGeneration.ownerRootPhysical)) {
        return failRecovery(new SecError('RUNTIME-DEPS-004', 'Shared dependency source generation changed and is preserved'));
      }
      if (transition.preimage.kind === 'directory' && backupPath !== null &&
        transition.phase === 'prepared' && active.kind === 'directory' &&
        transition.preimage.physical !== null && active.physical !== null &&
        sameGeneratedStateIdentity(active.physical, transition.preimage.physical) &&
        backup?.kind === 'absent') {
        await renameCompilerDependencyDirectory(activePath, backupPath, options);
        transition = await advanceDependencyTransition(transition, {
          destination: transitionAbsentSlot(activePath),
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
              !sameGeneratedStateIdentity(active.physical, transition.destination.physical)) &&
            !sameGeneratedStateIdentity(active.physical, stage.physical!)) {
            return failRecovery(new SecError('RUNTIME-DEPS-004', 'Shared dependency transition target is occupied by an unexpected identity'));
          }
        } else {
          await renameCompilerDependencyDirectory(stagePath, activePath, options);
        }
        active = await currentActive();
        stage = await currentStage();
        stageRoot = await currentStageRoot();
        if (active.kind !== 'directory' || active.physical === null ||
          (stage?.kind === 'directory' && stage.physical !== null
            ? !sameGeneratedStateIdentity(active.physical, stage.physical)
            : transition.destination.kind !== 'directory' || transition.destination.physical === null ||
              !sameGeneratedStateIdentity(active.physical, transition.destination.physical))) {
          return failRecovery(new SecError('RUNTIME-DEPS-004', 'Shared dependency transition active identity is invalid'));
        }
        transition = await advanceDependencyTransition(transition, {
          destination: active,
          stage: stage ?? transitionAbsentSlot(stagePath),
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
          sameGeneratedStateIdentity(active.physical, transition.stage.physical)) {
        // The stage-to-active rename may have completed just before a process
        // lost the `published` journal receipt.  The recorded stage identity
        // is the only acceptable proof for this uncertain topology; the
        // source generation identity is intentionally not reused as a target
        // identity.
        transition = await advanceDependencyTransition(transition, {
          destination: active,
          stage: transitionAbsentSlot(stagePath),
          stageRoot,
          phase: 'published',
          durability: 'known',
          failure: null
        }, options);
      }
      if (active.kind !== 'directory' || active.physical === null ||
        transition.destination.kind !== 'directory' || transition.destination.physical === null ||
        !sameGeneratedStateIdentity(active.physical, transition.destination.physical)) {
        return failRecovery(new SecError('RUNTIME-DEPS-004', 'Shared dependency transition has no exact active projection'));
      }
      stage = await currentStage();
      stageRoot = await currentStageRoot();
      if (stageRootPath !== null && stageRoot?.kind === 'directory') {
        await disposeDependencyTransitionStage(
          root,
          stageRootPath,
          options,
          'runtime-projection-recovered',
          transition.stage,
          transition.stageRoot,
          runtimeDependencyStageAuthority(path.dirname(stageRootPath))
        );
      }
      transition = await advanceDependencyTransition(transition, {
        destination: await currentActive(),
        stage: stagePath === null ? null : transitionAbsentSlot(stagePath),
        stageRoot: stageRootPath === null ? null : transitionAbsentSlot(stageRootPath),
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

class CompilerDependencyBridgeIncompatibleError extends SecError {
  constructor(readonly bridgePath: string) {
    super(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency consumer bridge has incompatible canonical inputs',
      { bridgePath }
    );
    this.name = 'CompilerDependencyBridgeIncompatibleError';
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
      throw new CompilerDependencyBridgeIncompatibleError(bridgePath);
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
      !compilerDependencyInputFenceMatches(ownerRoot, finalOwnerIdentity) ||
      !compilerDependencyInputFenceMatches(consumerRoot, finalConsumerIdentity)) {
      throw new Error('Dependency consumer bridge identity changed during validation.');
    }
    if (finalConsumerIdentity.manifestHash !== consumerIdentity.manifestHash ||
      finalOwnerIdentity.manifestHash !== finalConsumerIdentity.manifestHash ||
      finalBinding === null || !canonicalEquals(finalBinding, binding)) {
      throw new Error('Dependency consumer bridge binding changed during validation.');
    }
    return finalBinding;
  } catch (error) {
    if (error instanceof CompilerDependencyBridgeIncompatibleError) throw error;
    throw new SecError(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency consumer bridge is incompatible',
      { cause: error instanceof Error ? error.message : String(error), bridgePath }
    );
  }
}

type CompilerDependencyBridgeObservation =
  | Readonly<{ status: 'absent'; binding: null }>
  | Readonly<{ status: 'incompatible'; binding: null }>
  | Readonly<{ status: 'ready'; binding: Readonly<CompilerDepsBinding> }>;

async function observeCompilerDependencyBridge(
  consumerRoot: string,
  bridgePath: string,
  consumerIdentity: CompilerDependencyIdentity,
  options: RuntimeDependencyInstallOptions
): Promise<CompilerDependencyBridgeObservation> {
  try {
    const binding = await compilerDependencyConsumerBridgeBinding(
      consumerRoot,
      bridgePath,
      consumerIdentity,
      options
    );
    return binding === null
      ? Object.freeze({ status: 'absent', binding: null })
      : Object.freeze({ status: 'ready', binding });
  } catch (error) {
    if (error instanceof CompilerDependencyBridgeIncompatibleError) {
      return Object.freeze({ status: 'incompatible', binding: null });
    }
    throw error;
  }
}

const COMPILER_DEPENDENCY_LOCATOR_PROVIDER_ID = 'compiler-dependency-locator' as const;
const COMPILER_DEPENDENCY_LOCATOR_PLAN_SCHEMA = 'sec-compiler-dependency-locator-retirement-plan' as const;
const COMPILER_DEPENDENCY_LOCATOR_RECEIPT_SCHEMA = 'sec-compiler-dependency-locator-retirement-receipt' as const;

interface CompilerDependencyLocatorRetirementPlan {
  readonly schema: typeof COMPILER_DEPENDENCY_LOCATOR_PLAN_SCHEMA;
  readonly consumerRoot: string;
  readonly consumer: GeneratedStatePhysicalIdentity;
  readonly relativePath: 'node_modules';
  readonly source: GeneratedStatePhysicalIdentity;
  readonly linkTarget: string;
  readonly generationPath: string;
  readonly generation: Readonly<{ device: string; inode: string; mode: string }>;
}

function canonicalProviderBytes(value: unknown): string {
  return JSON.stringify(canonicalJson(value));
}

function sameGeneratedStatePhysicalIdentity(
  left: GeneratedStatePhysicalIdentity,
  right: GeneratedStatePhysicalIdentity
): boolean {
  return left.device === right.device && left.inode === right.inode && left.objectId === right.objectId;
}

function compilerDependencyConsumerIdentity(consumerRoot: string): GeneratedStatePhysicalIdentity {
  const consumer = inspectNoFollowDirectoryChain(
    consumerRoot,
    'Compiler dependency locator consumer root'
  ).target;
  return Object.freeze({ device: consumer.device, inode: consumer.inode, objectId: consumer.objectId });
}

function compilerDependencyLocatorObservation(
  consumerRoot: string,
  relativePath: string
): Readonly<{ source: GeneratedStatePhysicalIdentity; linkTarget: string }> | null {
  if (relativePath !== 'node_modules') {
    throw new Error('Compiler dependency locator provider only owns node_modules.');
  }
  const root = inspectNoFollowDirectoryChain(consumerRoot, 'Compiler dependency locator consumer root').target;
  try {
    const ordinaryDirectory = inspectExactNoFollowDirectoryPresence(
      path.join(root.path, relativePath),
      'Compiler dependency ordinary node_modules'
    );
    if (ordinaryDirectory.state === 'present') {
      assertSameNoFollowDirectoryIdentity(root, 'Compiler dependency locator consumer root readback');
      return null;
    }
  } catch (error) {
    // A retained reparse/symlink leaf is intentionally rejected by the
    // ordinary-directory observer and must then be observed by the exact link
    // capability below. Other kinds and physical failures remain blockers.
    if (!(error instanceof PhysicalNoFollowError && error.code === 'PHYSICAL_NO_FOLLOW_UNSAFE_PATH')) {
      throw error;
    }
  }
  const locator = inspectNoFollowLinkEntry(root, relativePath);
  if (locator === null || locator.kind !== 'link' || locator.linkTarget === null) return null;
  return Object.freeze({
    source: Object.freeze({
      device: locator.device,
      inode: locator.inode,
      objectId: generatedStateDigest({ kind: 'link', target: locator.linkTarget })
    }),
    linkTarget: locator.linkTarget
  });
}

async function compilerDependencyGenerationIdentity(
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

function parseCompilerDependencyLocatorRetirementPlan(
  bytes: string
): CompilerDependencyLocatorRetirementPlan {
  const candidate = JSON.parse(bytes) as Partial<CompilerDependencyLocatorRetirementPlan>;
  if (canonicalProviderBytes(candidate) !== bytes || candidate.schema !== COMPILER_DEPENDENCY_LOCATOR_PLAN_SCHEMA ||
      candidate.relativePath !== 'node_modules' || typeof candidate.consumerRoot !== 'string' ||
      typeof candidate.linkTarget !== 'string' || typeof candidate.generationPath !== 'string' ||
      candidate.source === undefined || candidate.consumer === undefined || candidate.generation === undefined) {
    throw new Error('Compiler dependency locator provider plan is malformed.');
  }
  const expectedKeys = [
    'consumer', 'consumerRoot', 'generation', 'generationPath', 'linkTarget', 'relativePath', 'schema', 'source'
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
  return candidate as CompilerDependencyLocatorRetirementPlan;
}

async function validateCompilerDependencyLocatorPlan(
  plan: CompilerDependencyLocatorRetirementPlan,
  requireLocator: boolean
): Promise<Readonly<{
  consumer: ReturnType<typeof inspectNoFollowDirectoryChain>['target'];
  locator: ReturnType<typeof compilerDependencyLocatorObservation>;
}>> {
  const consumerRoot = path.resolve(plan.consumerRoot);
  const generationPath = path.resolve(plan.generationPath);
  const relativeGeneration = path.relative(consumerRoot, generationPath);
  const generationIsExternal = relativeGeneration === '..' || relativeGeneration.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeGeneration);
  if (consumerRoot !== plan.consumerRoot || generationPath !== plan.generationPath || !generationIsExternal) {
    throw new Error('Compiler dependency locator provider plan paths are not canonical external-generation paths.');
  }
  const observedConsumer = compilerDependencyConsumerIdentity(consumerRoot);
  if (!sameGeneratedStatePhysicalIdentity(observedConsumer, plan.consumer)) {
    throw new Error('Compiler dependency locator provider consumer root identity changed.');
  }
  const generation = await compilerDependencyGenerationIdentity(generationPath);
  if (!canonicalEquals(generation, plan.generation)) {
    throw new Error('Compiler dependency locator provider inputs or generation identity changed.');
  }
  if (!requireLocator) {
    const finalConsumer = inspectNoFollowDirectoryChain(
      consumerRoot,
      'Compiler dependency locator final consumer root'
    ).target;
    const finalGeneration = await compilerDependencyGenerationIdentity(generationPath);
    if (!sameGeneratedStatePhysicalIdentity(
      { device: finalConsumer.device, inode: finalConsumer.inode, objectId: finalConsumer.objectId },
      plan.consumer
    ) || !canonicalEquals(finalGeneration, plan.generation)) {
      throw new Error('Compiler dependency locator provider inputs changed during final validation.');
    }
    return Object.freeze({ consumer: finalConsumer, locator: null });
  }
  const locator = compilerDependencyLocatorObservation(consumerRoot, plan.relativePath);
  if (locator === null || !sameGeneratedStatePhysicalIdentity(locator.source, plan.source) ||
      locator.linkTarget !== plan.linkTarget ||
      !sameHostPath(path.resolve(await fs.realpath(path.join(consumerRoot, plan.relativePath))), generationPath)) {
    throw new Error('Compiler dependency locator provider locator identity or target changed.');
  }
  const finalGeneration = await compilerDependencyGenerationIdentity(generationPath);
  const finalConsumer = inspectNoFollowDirectoryChain(
    consumerRoot,
    'Compiler dependency locator final consumer root'
  ).target;
  if (!sameGeneratedStatePhysicalIdentity(
    { device: finalConsumer.device, inode: finalConsumer.inode, objectId: finalConsumer.objectId },
      plan.consumer
  ) || !canonicalEquals(finalGeneration, plan.generation)) {
    throw new Error('Compiler dependency locator provider inputs changed during final validation.');
  }
  return Object.freeze({ consumer: finalConsumer, locator });
}

export const compilerDependencyLocatorWorktreeRetirementProvider:
GeneratedStateWorktreeRetirementProvider = Object.freeze<GeneratedStateWorktreeRetirementProvider>({
  id: COMPILER_DEPENDENCY_LOCATOR_PROVIDER_ID,
  async plan(input) {
    if (input.relativePath !== 'node_modules' || input.registration.phase !== 'retired' ||
      !sameGeneratedStatePhysicalIdentity(input.registration.root, input.source)) {
      throw new Error('Compiler dependency locator provider requires one exact retired registration.');
    }
    const consumerRoot = path.resolve(input.workspaceRoot);
    const consumer = compilerDependencyConsumerIdentity(consumerRoot);
    if (!sameGeneratedStatePhysicalIdentity(consumer, input.registration.workspace)) {
      throw new Error('Compiler dependency locator provider registration targets another consumer root.');
    }
    const locator = compilerDependencyLocatorObservation(consumerRoot, input.relativePath);
    if (locator === null || !sameGeneratedStatePhysicalIdentity(locator.source, input.source)) {
      throw new Error('Compiler dependency locator provider source changed before planning.');
    }
    const generationPath = path.resolve(await fs.realpath(path.join(consumerRoot, input.relativePath)));
    const material: CompilerDependencyLocatorRetirementPlan = Object.freeze({
      schema: COMPILER_DEPENDENCY_LOCATOR_PLAN_SCHEMA,
      consumerRoot,
      consumer,
      relativePath: 'node_modules',
      source: locator.source,
      linkTarget: locator.linkTarget,
      generationPath,
      generation: await compilerDependencyGenerationIdentity(generationPath)
    });
    const bytes = canonicalProviderBytes(material);
    return Object.freeze({
      bytes,
      digest: generatedStateDomainProviderMaterialDigest(COMPILER_DEPENDENCY_LOCATOR_PROVIDER_ID, 'plan', bytes)
    });
  },
  async retire(input) {
    if (input.relativePath !== 'node_modules' || input.registration.phase !== 'retired' ||
        input.planDigest !== generatedStateDomainProviderMaterialDigest(
          COMPILER_DEPENDENCY_LOCATOR_PROVIDER_ID,
          'plan',
          input.planBytes
        )) {
      throw new Error('Compiler dependency locator provider retirement authority is invalid.');
    }
    const plan = parseCompilerDependencyLocatorRetirementPlan(input.planBytes);
    if (path.resolve(input.workspaceRoot) !== plan.consumerRoot ||
      !sameGeneratedStatePhysicalIdentity(input.source, plan.source) ||
      !sameGeneratedStatePhysicalIdentity(input.registration.root, plan.source) ||
      !sameGeneratedStatePhysicalIdentity(input.registration.workspace, plan.consumer)) {
      throw new Error('Compiler dependency locator provider retirement binding changed.');
    }
    const validateRetirementPlan = async (requireLocator: boolean) => {
      try {
        return await validateCompilerDependencyLocatorPlan(plan, requireLocator);
      } catch (error) {
        if (error instanceof SecError) throw error;
        const cause = error instanceof Error ? error.message : String(error);
        throw new SecError(
          'IMPORT-AUTHORITY-004',
          `Compiler dependency locator retirement validation failed: ${cause}`,
          { cause, consumerRoot: plan.consumerRoot }
        );
      }
    };
    const locator = compilerDependencyLocatorObservation(plan.consumerRoot, plan.relativePath);
    let outcome: 'removed' | 'resumed-absent';
    if (locator === null) {
      await validateRetirementPlan(false);
      outcome = 'resumed-absent';
    } else {
      const validated = await validateRetirementPlan(true);
      deleteRetainedNoFollowEntry({
        root: validated.consumer,
        relativePath: plan.relativePath,
        kind: 'link',
        device: locator.source.device,
        inode: locator.source.inode,
        expectedLinkTarget: locator.linkTarget,
        ancestorDirectories: Object.freeze([])
      });
      if (compilerDependencyLocatorObservation(plan.consumerRoot, plan.relativePath) !== null) {
        throw new Error('Compiler dependency locator provider locator remains after retirement.');
      }
      await validateRetirementPlan(false);
      outcome = 'removed';
    }
    const bytes = canonicalProviderBytes(Object.freeze({
      schema: COMPILER_DEPENDENCY_LOCATOR_RECEIPT_SCHEMA,
      operationId: input.operationId,
      planDigest: input.planDigest,
      outcome,
      locator: plan.source,
      generation: plan.generation
    }));
    return Object.freeze({
      bytes,
      digest: generatedStateDomainProviderMaterialDigest(COMPILER_DEPENDENCY_LOCATOR_PROVIDER_ID, 'receipt', bytes)
    });
  }
});

interface RetainedGitControlFile {
  readonly capability: RetainedNoFollowOrdinaryFile;
  readonly value: string;
  assertCurrent(): void;
}

interface LinkedWorktreeDependencyOwnerAuthority {
  readonly consumerRoot: string;
  readonly ownerRoot: string;
  assertCurrent(): void;
  dispose(): void;
}

function samePhysicalDirectory(
  left: PhysicalDirectoryIdentity,
  right: PhysicalDirectoryIdentity
): boolean {
  return left.device === right.device && left.inode === right.inode && left.objectId === right.objectId;
}

function retainGitControlFile(
  parent: PhysicalDirectoryChain,
  name: string,
  label: string,
  parse: (source: Uint8Array) => string
): RetainedGitControlFile {
  const capability = retainNoFollowOrdinaryFile(parent, name, undefined, label);
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

function disposeRetainedGitControlFiles(files: readonly RetainedGitControlFile[]): void {
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
function linkedWorktreeDependencyOwnerRoot(
  consumerRoot: string
): LinkedWorktreeDependencyOwnerAuthority | null {
  const markerPath = path.join(consumerRoot, '.git');
  let markerMetadata: ReturnType<typeof lstatSync>;
  try {
    markerMetadata = lstatSync(markerPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (!markerMetadata.isFile() || markerMetadata.isSymbolicLink()) return null;

  const retained: RetainedGitControlFile[] = [];
  try {
    const consumer = inspectNoFollowDirectoryChain(consumerRoot, 'Linked worktree consumer root');
    const marker = retainGitControlFile(
      consumer,
      '.git',
      'Linked worktree .git locator',
      parseGitWorktreeAdminLocator
    );
    retained.push(marker);
    const adminDirectory = path.resolve(consumerRoot, marker.value);
    const admin = inspectNoFollowDirectoryChain(adminDirectory, 'Linked worktree registry admin');
    const commonLocator = retainGitControlFile(
      admin,
      'commondir',
      'Linked worktree commondir locator',
      (source) => parseGitWorktreeAdminPath(source, 'linked-worktree commondir')
    );
    retained.push(commonLocator);
    const backReference = retainGitControlFile(
      admin,
      'gitdir',
      'Linked worktree gitdir back-reference',
      (source) => parseGitWorktreeAdminPath(source, 'linked-worktree gitdir')
    );
    retained.push(backReference);

    const commonDirectory = path.resolve(adminDirectory, commonLocator.value);
    const common = inspectNoFollowDirectoryChain(commonDirectory, 'Linked worktree common Git directory');
    const worktreesDirectory = path.join(commonDirectory, 'worktrees');
    const worktrees = inspectNoFollowDirectoryChain(
      worktreesDirectory,
      'Linked worktree registry namespace'
    );
    const adminName = path.basename(adminDirectory);
    if (adminName.length === 0 || adminName === '.' || adminName === '..' ||
        !sameHostPath(path.dirname(adminDirectory), worktreesDirectory)) {
      throw new Error('Linked worktree admin is not one direct registry member.');
    }
    const registeredAdmin = inspectNoFollowDirectoryChain(
      path.join(worktreesDirectory, adminName),
      'Linked worktree registered admin'
    );
    if (!samePhysicalDirectory(admin.target, registeredAdmin.target)) {
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
    const owner = inspectNoFollowDirectoryChain(ownerRoot, 'Linked worktree dependency owner root');
    const ownerGit = inspectNoFollowDirectoryChain(
      path.join(ownerRoot, '.git'),
      'Linked worktree dependency owner Git directory'
    );
    if (!samePhysicalDirectory(common.target, ownerGit.target)) {
      throw new Error('Linked worktree common directory is not the owner registry root.');
    }

    const assertCurrent = (): void => {
      assertSameNoFollowDirectoryIdentity(consumer.target, 'Linked worktree consumer root');
      assertSameNoFollowDirectoryIdentity(admin.target, 'Linked worktree registry admin');
      assertSameNoFollowDirectoryIdentity(common.target, 'Linked worktree common Git directory');
      assertSameNoFollowDirectoryIdentity(worktrees.target, 'Linked worktree registry namespace');
      assertSameNoFollowDirectoryIdentity(owner.target, 'Linked worktree dependency owner root');
      assertSameNoFollowDirectoryIdentity(ownerGit.target, 'Linked worktree dependency owner Git directory');
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
        disposeRetainedGitControlFiles(retained);
      }
    });
  } catch (error) {
    try {
      disposeRetainedGitControlFiles(retained);
    } catch (disposalError) {
      throw new SecError(
        'IMPORT-AUTHORITY-004',
        'Linked worktree registry authority cleanup failed',
        {
          cause: error instanceof Error ? error.message : String(error),
          disposalCause: disposalError instanceof Error ? disposalError.message : String(disposalError)
        }
      );
    }
    throw new SecError(
      'IMPORT-AUTHORITY-004',
      'Linked worktree registry authority is invalid',
      { cause: error instanceof Error ? error.message : String(error), markerPath }
    );
  }
}

async function resolveLinkedWorktreeDependencyGeneration(input: Readonly<{
  consumerRoot: string;
  consumerIdentity: CompilerDependencyIdentity;
  options: RuntimeDependencyOperationOptions;
}>): Promise<Readonly<{
  binding: CompilerDepsBinding;
  nodeModulesPath: string;
  sourceGeneration: RuntimeDependencySourceGeneration;
}> | null> {
  const ownerAuthority = linkedWorktreeDependencyOwnerRoot(input.consumerRoot);
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
      throw new SecError(
        'IMPORT-AUTHORITY-004',
        'Linked worktree dependency generation changed during validation'
      );
    }
    const sourceGeneration = await runtimeDependencySourceGeneration({
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

async function bindExistingCompilerDependencyLocator(
  root: string,
  identity: CompilerDependencyIdentity,
  binding: CompilerDepsBinding,
  options: RuntimeDependencyInstallOptions
): Promise<void> {
  if (options.generatedStateLifecycle === undefined) return;
  const locator = compilerDependencyLocatorObservation(root, 'node_modules');
  if (locator === null) {
    throw new SecError('IMPORT-AUTHORITY-004', 'Existing compiler dependency locator disappeared before provenance binding');
  }
  const bind = options.generatedStateLifecycle.bind;
  if (bind === undefined) {
    throw new SecError('IMPORT-AUTHORITY-004', 'Existing compiler dependency locator has no read-only provenance binding path');
  }
  await bind('node_modules', {
    owner: COMPILER_NODE_MODULES_LIFECYCLE_OWNER,
    producer: COMPILER_NODE_MODULES_LIFECYCLE_PRODUCER,
    ruleId: COMPILER_NODE_MODULES_LIFECYCLE_RULE,
    physical: locator.source
  });
  const registrationBinding = await compilerDependencyConsumerBridgeBinding(
    root,
    path.join(root, 'node_modules'),
    identity,
    options
  );
  if (registrationBinding === null || !canonicalEquals(registrationBinding, binding)) {
    throw new SecError('IMPORT-AUTHORITY-004', 'Compiler dependency locator changed after provenance binding');
  }
}

async function disposeIncompatibleCompilerDependencyLocator(
  root: string,
  options: RuntimeDependencyInstallOptions
): Promise<boolean> {
  const locator = compilerDependencyLocatorObservation(root, 'node_modules');
  if (locator === null) return false;
  const lifecycle = options.generatedStateLifecycle;
  if (lifecycle?.bind === undefined || lifecycle.settleRetired === undefined) {
    throw new SecError(
      'IMPORT-AUTHORITY-004',
      'Incompatible compiler dependency locator has no lifecycle disposal authority'
    );
  }
  const expected = Object.freeze({
    owner: COMPILER_NODE_MODULES_LIFECYCLE_OWNER,
    producer: COMPILER_NODE_MODULES_LIFECYCLE_PRODUCER,
    ruleId: COMPILER_NODE_MODULES_LIFECYCLE_RULE,
    physical: locator.source
  });
  if (await lifecycle.settleRetired('node_modules', expected)) return true;
  await lifecycle.bind('node_modules', expected);
  await lifecycle.retired('node_modules', 'incompatible-compiler-dependency-locator');
  await lifecycle.disposed('node_modules', 'incompatible-compiler-dependency-locator');
  if (compilerDependencyLocatorObservation(root, 'node_modules') !== null) {
    throw new SecError(
      'IMPORT-AUTHORITY-004',
      'Incompatible compiler dependency locator remains after lifecycle disposal'
    );
  }
  return true;
}

/**
 * A locator created by this producer is the sole positive path allowed to
 * issue a fresh lifecycle registration.  Existing/fresh-process locators use
 * `bindExistingCompilerDependencyLocator` above and can never self-sign.
 */
async function publishCompilerDependencyLocatorLifecycle(
  root: string,
  identity: CompilerDependencyIdentity,
  binding: CompilerDepsBinding,
  options: RuntimeDependencyInstallOptions
): Promise<void> {
  if (options.generatedStateLifecycle === undefined) return;
  const locator = compilerDependencyLocatorObservation(root, 'node_modules');
  if (locator === null) {
    throw new SecError('IMPORT-AUTHORITY-004', 'Published compiler dependency locator has no physical identity');
  }
  await options.generatedStateLifecycle.born(
    'node_modules',
    `compiler-dependency-bridge:${identity.manifestHash}:${generatedStateDigest(binding)}`
  );
  const registrationBinding = await compilerDependencyConsumerBridgeBinding(
    root,
    path.join(root, 'node_modules'),
    identity,
    options
  );
  if (registrationBinding === null || !canonicalEquals(registrationBinding, binding)) {
    throw new SecError('IMPORT-AUTHORITY-004', 'Compiler dependency locator changed after lifecycle publication');
  }
}

async function deleteExactCompilerDependencyLocator(
  rootPath: string,
  expected: Readonly<{ source: GeneratedStatePhysicalIdentity; linkTarget: string }>,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  const root = inspectNoFollowDirectoryChain(rootPath, 'Compiler dependency locator cleanup root').target;
  const locator = inspectNoFollowLinkEntry(root, 'node_modules');
  if (locator === null) {
    throw new Error('Compiler dependency locator disappeared before exact rollback.');
  }
  if (locator.linkTarget === null || locator.kind !== 'link') {
    throw new Error('Compiler dependency locator changed before exact rollback.');
  }
  const observedSource = Object.freeze({
    device: locator.device,
    inode: locator.inode,
    objectId: generatedStateDigest({ kind: 'link', target: locator.linkTarget })
  });
  if (!sameGeneratedStatePhysicalIdentity(observedSource, expected.source)
      || locator.linkTarget !== expected.linkTarget) {
    throw new Error('Compiler dependency locator changed before exact rollback.');
  }
  await runtimeDependencyOperationEffectFence(options, 'Compiler dependency locator rollback');
  deleteRetainedNoFollowEntry({
    root,
    relativePath: 'node_modules',
    kind: 'link',
    device: locator.device,
    inode: locator.inode,
    expectedLinkTarget: locator.linkTarget,
    ancestorDirectories: Object.freeze([])
  });
  if (compilerDependencyLocatorObservation(rootPath, 'node_modules') !== null) {
    throw new Error('Compiler dependency locator remains after exact rollback.');
  }
}

const COMPILER_NODE_MODULES_LIFECYCLE_OWNER = 'compiler-dependency-runtime' as const;
const COMPILER_NODE_MODULES_LIFECYCLE_PRODUCER = 'ensure-compiler-deps-ready' as const;
const COMPILER_NODE_MODULES_LIFECYCLE_RULE = 'compiler-node-modules' as const;
const COMPILER_STAGING_LIFECYCLE_OWNER = 'compiler-dependency-runtime' as const;
const COMPILER_STAGING_LIFECYCLE_PRODUCER = 'stage-compiler-dependency-generation' as const;
const COMPILER_STAGING_LIFECYCLE_RULE = 'compiler-dependency-staging' as const;
const SHARED_DEPS_LIFECYCLE_OWNER = 'project-runtime' as const;
const SHARED_DEPS_LIFECYCLE_PRODUCER = 'ensure-shared-deps-ready' as const;
const SHARED_DEPS_LIFECYCLE_RULE = 'shared-dependency-cache' as const;

function compilerDependencyGenerationLifecycleExpectation(
  physical?: GeneratedStatePhysicalIdentity
): Readonly<{
  owner: typeof COMPILER_NODE_MODULES_LIFECYCLE_OWNER;
  producer: typeof COMPILER_NODE_MODULES_LIFECYCLE_PRODUCER;
  ruleId: typeof COMPILER_NODE_MODULES_LIFECYCLE_RULE;
  physical?: GeneratedStatePhysicalIdentity;
}> {
  return Object.freeze({
    owner: COMPILER_NODE_MODULES_LIFECYCLE_OWNER,
    producer: COMPILER_NODE_MODULES_LIFECYCLE_PRODUCER,
    ruleId: COMPILER_NODE_MODULES_LIFECYCLE_RULE,
    ...(physical === undefined ? {} : { physical })
  });
}

function compilerDependencyStagingLifecycleExpectation(
  physical: GeneratedStatePhysicalIdentity
): Readonly<{
  owner: typeof COMPILER_STAGING_LIFECYCLE_OWNER;
  producer: typeof COMPILER_STAGING_LIFECYCLE_PRODUCER;
  ruleId: typeof COMPILER_STAGING_LIFECYCLE_RULE;
  physical: GeneratedStatePhysicalIdentity;
}> {
  return Object.freeze({
    owner: COMPILER_STAGING_LIFECYCLE_OWNER,
    producer: COMPILER_STAGING_LIFECYCLE_PRODUCER,
    ruleId: COMPILER_STAGING_LIFECYCLE_RULE,
    physical
  });
}

async function settleRetiredCompilerDependencyGeneration(
  options: RuntimeDependencyOperationOptions,
  expectedPhysical?: GeneratedStatePhysicalIdentity
): Promise<void> {
  const lifecycle = options.generatedStateLifecycle;
  if (lifecycle === undefined || lifecycle.settleRetired === undefined) return;
  await runtimeDependencyOperationEffectFence(
    options,
    'Compiler dependency retired lifecycle settlement'
  );
  await lifecycle.settleRetired(
    'node_modules',
    compilerDependencyGenerationLifecycleExpectation(expectedPhysical)
  );
}

async function birthAndBindCompilerDependencyGeneration(
  options: RuntimeDependencyOperationOptions,
  stagingRoot: string,
  expectedPhysical: GeneratedStatePhysicalIdentity
): Promise<void> {
  const lifecycle = options.generatedStateLifecycle;
  if (lifecycle === undefined) return;
  await runtimeDependencyOperationEffectFence(options, 'Compiler dependency active lifecycle birth');
  await lifecycle.born(
    'node_modules',
    `compiler-node-modules:${path.basename(stagingRoot)}`
  );
  const bind = lifecycle.bind;
  if (bind === undefined) {
    throw new SecError(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency active lifecycle birth has no exact readback binding'
    );
  }
  await bind(
    'node_modules',
    compilerDependencyGenerationLifecycleExpectation(expectedPhysical)
  );
}

async function recoverCompilerDependencyGenerationLifecycle(input: Readonly<{
  active: DependencyTransitionSlot;
  options: RuntimeDependencyOperationOptions;
  root: string;
  stage: DependencyTransitionSlot | null;
  stagePath: string | null;
  stageRoot: DependencyTransitionSlot | null;
  stageRootPath: string | null;
  stagingRoot: string;
  transition: DependencyTransitionJournal;
}>): Promise<void> {
  if (input.active.kind !== 'directory' || input.active.physical === null) {
    throw new SecError(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency lifecycle recovery has no exact active generation'
    );
  }
  try {
    await bindExistingCompilerDependencyGeneration(input.options, input.active.physical);
    return;
  } catch (bindingError) {
    const lifecycle = input.options.generatedStateLifecycle;
    const stageRegistrationPhysical = input.transition.stageRoot?.physical;
    if (lifecycle?.bind === undefined || input.stagePath === null || input.stageRootPath === null ||
        input.stage?.kind !== 'absent' || input.stageRoot?.kind !== 'directory' ||
        input.stageRoot.physical === null || stageRegistrationPhysical === undefined ||
        stageRegistrationPhysical === null ||
        !sameGeneratedStateIdentity(input.stageRoot.physical, stageRegistrationPhysical) ||
        !sameGeneratedStateIdentity(input.active.physical, input.transition.sourceGeneration.physical)) {
      throw bindingError;
    }

    const relativeStageRoot = path.relative(input.root, input.stageRootPath).replaceAll('\\', '/');
    await lifecycle.bind(
      relativeStageRoot,
      compilerDependencyStagingLifecycleExpectation(input.stageRoot.physical)
    );

    // The only recoverable missing-birth window is:
    //   staged registration active -> physical rename -> active birth absent.
    // Move the same retained directory back to its recorded empty stage slot,
    // settle the prior retired target registration while the target is absent,
    // then replay the original rename and issuer birth.  Every interruption of
    // this sequence remains recognizable from the immutable transition record.
    await renameCompilerDependencyDirectory(input.active.path, input.stagePath, input.options);
    let activeRestored = false;
    try {
      await settleRetiredCompilerDependencyGeneration(
        input.options,
        input.transition.preimage.kind === 'directory'
          ? input.transition.preimage.physical ?? undefined
          : undefined
      );
      await renameCompilerDependencyDirectory(input.stagePath, input.active.path, input.options);
      activeRestored = true;
      const restored = await observeDependencyTransitionSlot(
        input.active.path,
        input.transition.sourceGeneration.bindingDigest
      );
      if (restored.kind !== 'directory' || restored.physical === null ||
          !sameGeneratedStateIdentity(restored.physical, input.active.physical)) {
        throw new SecError(
          'IMPORT-AUTHORITY-004',
          'Compiler dependency lifecycle recovery changed the active physical generation'
        );
      }
      await birthAndBindCompilerDependencyGeneration(
        input.options,
        input.stagingRoot,
        restored.physical
      );
    } catch (error) {
      if (!activeRestored) {
        const currentStage = await observeDependencyTransitionSlot(input.stagePath).catch(() => null);
        const currentActive = await observeDependencyTransitionSlot(input.active.path).catch(() => null);
        if (currentStage?.kind === 'directory' && currentStage.physical !== null &&
            sameGeneratedStateIdentity(currentStage.physical, input.active.physical) &&
            currentActive?.kind === 'absent') {
          await renameCompilerDependencyDirectory(input.stagePath, input.active.path, input.options);
        }
      }
      throw error;
    }
  }
}

async function bindExistingCompilerDependencyGeneration(
  options: RuntimeDependencyInstallOptions,
  expectedPhysical: GeneratedStatePhysicalIdentity
): Promise<void> {
  const lifecycle = options.generatedStateLifecycle;
  if (lifecycle === undefined) {
    throw new SecError(
      'IMPORT-AUTHORITY-004',
      'Existing compiler dependency generation has no producer provenance registration and is preserved'
    );
  }
  const bind = lifecycle.bind;
  if (bind === undefined) {
    throw new SecError(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency generation adoption requires read-only producer provenance binding and is preserved'
    );
  }
  try {
    await bind('node_modules', {
      owner: COMPILER_NODE_MODULES_LIFECYCLE_OWNER,
      producer: COMPILER_NODE_MODULES_LIFECYCLE_PRODUCER,
      ruleId: COMPILER_NODE_MODULES_LIFECYCLE_RULE,
      physical: expectedPhysical
    });
  } catch (error) {
    throw new SecError(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency generation producer provenance is missing, invalid, foreign, or stale; physical target is preserved',
      { cause: error instanceof Error ? error.message : String(error) }
    );
  }
}

async function bindExistingSharedDependencyRoot(
  options: RuntimeDependencyInstallOptions,
  expected: PhysicalDirectoryIdentity
): Promise<void> {
  const lifecycle = options.generatedStateLifecycle;
  if (lifecycle === undefined) {
    throw new SecError(
      'IMPORT-AUTHORITY-004',
      'Existing shared dependency root has no producer provenance registration and is preserved'
    );
  }
  const bind = lifecycle.bind;
  if (bind === undefined) {
    throw new SecError(
      'IMPORT-AUTHORITY-004',
      'Shared dependency root adoption requires read-only producer provenance binding and is preserved'
    );
  }
  try {
    await bind('.shared-deps', {
      owner: SHARED_DEPS_LIFECYCLE_OWNER,
      producer: SHARED_DEPS_LIFECYCLE_PRODUCER,
      ruleId: SHARED_DEPS_LIFECYCLE_RULE,
      physical: generatedStatePhysicalIdentity(expected)
    });
  } catch (error) {
    throw new SecError(
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
async function bindAndRetireCompilerDependencyPreimage(
  options: RuntimeDependencyInstallOptions,
  expectedPhysical: GeneratedStatePhysicalIdentity,
  outcome: string
): Promise<`sha256:${string}` | null> {
  const lifecycle = options.generatedStateLifecycle;
  if (lifecycle === undefined) {
    throw new SecError(
      'IMPORT-AUTHORITY-004',
      'Existing compiler dependency generation has no producer provenance registration and is preserved'
    );
  }
  const bind = lifecycle.bind;
  if (bind === undefined) {
    throw new SecError(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency preimage retirement requires read-only producer provenance binding and is preserved'
    );
  }
  try {
    await bind('node_modules', {
      owner: COMPILER_NODE_MODULES_LIFECYCLE_OWNER,
      producer: COMPILER_NODE_MODULES_LIFECYCLE_PRODUCER,
      ruleId: COMPILER_NODE_MODULES_LIFECYCLE_RULE,
      physical: expectedPhysical
    });
    const retired = await lifecycle.retired('node_modules', outcome);
    return retired !== undefined && 'registrationDigest' in retired
      ? retired.registrationDigest
      : null;
  } catch (error) {
    if (error instanceof SecError && error.code === 'IMPORT-AUTHORITY-004') throw error;
    throw new SecError(
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
async function compilerDependencyGeneratedPreimageDigest(
  nodeModulesPath: string,
  recovery: Readonly<{ allowLegacyRuntimeMaterializationV2: boolean }> = Object.freeze({
    allowLegacyRuntimeMaterializationV2: false
  })
): Promise<`sha256:${string}`> {
  const bindingPath = path.join(nodeModulesPath, COMPILER_DEPS_BINDING_FILE);
  const bindingMetadata = await fs.lstat(bindingPath).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (bindingMetadata === null || !bindingMetadata.isFile() || bindingMetadata.isSymbolicLink()) {
    throw new SecError(
      'IMPORT-AUTHORITY-004',
      'Existing node_modules is not an owned compiler dependency generation and is preserved'
    );
  }
  const candidate = await readJson<unknown>(bindingPath).catch(() => null);
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)
      || Object.getPrototypeOf(candidate) !== Object.prototype) {
    throw new SecError('IMPORT-AUTHORITY-004', 'Compiler dependency preimage binding is malformed and preserved');
  }
  const binding = candidate as Record<string, unknown>;
  if (Object.keys(binding).sort(compareCodeUnits).join('\0')
      !== [...COMPILER_DEPS_BINDING_KEYS].sort(compareCodeUnits).join('\0')
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
        || isRuntimeDependencyMaterializationBinding(binding.runtimeMaterialization)
        || (recovery.allowLegacyRuntimeMaterializationV2 &&
          parseLegacyRuntimeDependencyMaterializationV2ForRecovery(
            binding.runtimeMaterialization
          ) !== null))) {
    throw new SecError('IMPORT-AUTHORITY-004', 'Compiler dependency preimage binding shape is invalid and preserved');
  }
  for (const value of [
    binding.bunExecutableSha256,
    binding.dependencyManifestSha256,
    binding.lockSha256,
    binding.manifestHash,
    ...(binding.installConfigSha256 === null ? [] : [binding.installConfigSha256])
  ]) {
    if (!/^[0-9a-f]{64}$/u.test(value as string)) {
      throw new SecError('IMPORT-AUTHORITY-004', 'Compiler dependency preimage digest is invalid and preserved');
    }
  }
  const packageNames = new Set<string>();
  for (const rawPackage of binding.packages) {
    if (rawPackage === null || typeof rawPackage !== 'object' || Array.isArray(rawPackage)
        || Object.getPrototypeOf(rawPackage) !== Object.prototype) {
      throw new SecError('IMPORT-AUTHORITY-004', 'Compiler dependency preimage package binding is invalid');
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
      throw new SecError('IMPORT-AUTHORITY-004', 'Compiler dependency preimage package identity is invalid');
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
        throw new SecError('IMPORT-AUTHORITY-004', 'Compiler dependency preimage entry identity is invalid');
      }
    }
    const packageManifestPath = path.join(
      nodeModulesPath,
      ...packageBinding.name.split('/'),
      'package.json'
    );
    const manifestMetadata = await fs.lstat(packageManifestPath).catch(() => null);
    if (manifestMetadata === null || !manifestMetadata.isFile() || manifestMetadata.isSymbolicLink()) {
      throw new SecError('IMPORT-AUTHORITY-004', 'Compiler dependency preimage package manifest is not physical');
    }
    const physicalManifestPath = await fs.realpath(packageManifestPath);
    if (!isPathInside(nodeModulesPath, physicalManifestPath)) {
      throw new SecError('IMPORT-AUTHORITY-004', 'Compiler dependency preimage package manifest escapes its generation');
    }
    const manifestBytes = await fs.readFile(packageManifestPath);
    const manifest = JSON.parse(manifestBytes.toString('utf8')) as Record<string, unknown>;
    // `packageBinding.name` is the dependency locator under node_modules, not
    // necessarily the package's declared name: npm aliases deliberately make
    // those identities differ (for example `@typescript/native` resolves to
    // the `typescript` package).  The exact manifest digest binds the declared
    // package name without conflating it with the locator identity.
    if (digest(manifestBytes) !== packageBinding.manifestSha256
        || typeof manifest.name !== 'string'
        || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/u.test(manifest.name)
        || manifest.version !== packageBinding.version) {
      throw new SecError('IMPORT-AUTHORITY-004', 'Compiler dependency preimage package manifest changed and is preserved');
    }
  }
  return generatedStateDigest(binding);
}

type RetiredCompilerDependencyPreimage = Readonly<{
  backupPath: string;
  bindingDigest: `sha256:${string}`;
  identity: CompilerDependencyDirectoryIdentity;
  retiredRegistrationDigest: `sha256:${string}` | null;
}>;

async function retireIncompatibleCompilerDependencyTarget(
  root: string,
  nodeModulesPath: string,
  options: RuntimeDependencyOperationOptions,
  requestedBackupPath?: string
): Promise<RetiredCompilerDependencyPreimage | null> {
  const identity = await compilerDependencyDirectoryIdentity(nodeModulesPath);
  if (identity === null) return null;
  const bindingDigest = await compilerDependencyGeneratedPreimageDigest(nodeModulesPath);
  const backupsRoot = path.join(root, '.tmp', 'dependency-installs', 'compiler-backups');
  const backupPath = requestedBackupPath ?? path.join(
    backupsRoot,
    `locator-preimage-${bindingDigest.slice('sha256:'.length, 'sha256:'.length + 24)}`
  );
  const compilerRootIdentity = inspectNoFollowDirectoryChain(
    root,
    'Compiler dependency backup owner root'
  ).target;
  await runtimeDependencyOperationEffectFence(options, 'Compiler dependency preimage backup namespace creation');
  createNoFollowOrdinaryDirectoryChain(
    compilerRootIdentity,
    ['.tmp', 'dependency-installs', 'compiler-backups']
  );
  await runtimeDependencyOperationEffectFence(options, 'Compiler dependency preimage retirement');
  const observed = await observeDependencyTransitionSlot(nodeModulesPath, bindingDigest);
  if (observed.kind !== 'directory' || observed.physical === null) {
    throw new SecError(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency preimage changed before producer provenance binding and is preserved'
    );
  }
  const retiredRegistrationDigest = await bindAndRetireCompilerDependencyPreimage(
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

async function restoreRetiredCompilerDependencyTarget(
  nodeModulesPath: string,
  retired: RetiredCompilerDependencyPreimage,
  options: RuntimeDependencyOperationOptions
): Promise<void> {
  const lifecycle = options.generatedStateLifecycle;
  if (lifecycle?.restore === undefined || retired.retiredRegistrationDigest === null) {
    throw new SecError(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency rollback has no exact lifecycle restore predecessor; recovery backup is preserved'
    );
  }
  const currentTarget = await observeDependencyTransitionSlot(nodeModulesPath);
  if (currentTarget.kind !== 'absent') {
    throw new SecError(
      'IMPORT-AUTHORITY-004',
      'Compiler dependency transition target is occupied; exact preimage remains in recovery backup'
    );
  }
  const backupSlot = await observeDependencyTransitionSlot(retired.backupPath);
  if (backupSlot.kind !== 'directory' || backupSlot.physical === null) {
    throw new SecError('IMPORT-AUTHORITY-004', 'Compiler dependency recovery backup is absent or foreign and preserved');
  }
  const backupIdentity = await compilerDependencyDirectoryIdentity(retired.backupPath);
  if (!sameCompilerDependencyDirectoryIdentity(backupIdentity, retired.identity)) {
    throw new SecError('IMPORT-AUTHORITY-004', 'Compiler dependency transition recovery preimage identity changed and is preserved');
  }
  await renameCompilerDependencyDirectory(retired.backupPath, nodeModulesPath, options);
  const restored = await observeDependencyTransitionSlot(nodeModulesPath, retired.bindingDigest);
  if (restored.kind !== 'directory' || restored.physical === null ||
      !sameGeneratedStateIdentity(restored.physical, backupSlot.physical)) {
    throw new SecError('IMPORT-AUTHORITY-004', 'Compiler dependency rollback target identity changed before lifecycle restore');
  }
  await runtimeDependencyOperationEffectFence(options, 'Compiler dependency retired preimage lifecycle restore');
  await lifecycle.restore(
    'node_modules',
    retired.retiredRegistrationDigest,
    restored.physical,
    'compiler-dependency-preimage-restored'
  );
}

type CompilerDependencyTransitionKind = 'none' | 'generation-published' | 'locator-published';

function createCompilerDepsReadyState(input: Readonly<{
  binding: Readonly<CompilerDepsBinding>;
  identity: CompilerDependencyIdentity;
  kind: CompilerDependencyTransitionKind;
  nodeModulesPath: string;
  root: string;
  sourceGeneration: Readonly<RuntimeDependencySourceGeneration>;
  source: 'existing' | 'installed';
}>): CompilerDepsReadyState {
  const transitionDigest = generatedStateDigest(Object.freeze({
    schema: 'sec-compiler-dependency-transition-v1',
    kind: input.kind,
    root: input.root,
    nodeModulesPath: input.nodeModulesPath,
    manifestHash: input.identity.manifestHash,
    bindingDigest: generatedStateDigest(input.binding),
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

type CompilerDependencyReadyObservation =
  | Readonly<{
      binding: Readonly<CompilerDepsBinding>;
      kind: 'external-bridge' | 'local-generation';
      nodeModulesPath: string;
      sourceGeneration: Readonly<RuntimeDependencySourceGeneration>;
    }>
  | Readonly<{
      kind: 'incompatible-bridge';
      nodeModulesPath: string;
    }>;

/**
 * Reads the one admitted compiler dependency surface without publishing or
 * repairing it. A linked-worktree locator and a local physical generation are
 * two representations of the same readiness contract, so read-only consumers
 * must not reimplement the generation-only half of that contract.
 */
async function observeCompilerDependencyReady(
  root: string,
  nodeModulesPath: string,
  identity: CompilerDependencyIdentity,
  options: RuntimeDependencyOperationOptions
): Promise<CompilerDependencyReadyObservation | null> {
  const bridge = await observeCompilerDependencyBridge(
    root,
    nodeModulesPath,
    identity,
    options
  );
  if (bridge.status === 'incompatible') {
    return Object.freeze({ kind: 'incompatible-bridge', nodeModulesPath });
  }
  if (bridge.status === 'ready') {
    const bridgeBinding = bridge.binding;
    const generationPath = path.resolve(await fs.realpath(nodeModulesPath));
    const ownerRoot = path.dirname(generationPath);
    const sourceGeneration = await runtimeDependencySourceGeneration({
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
  const sourceGeneration = await runtimeDependencySourceGeneration({
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
  const operationOptions = runtimeDependencyOperationOptions(options);
  const root = path.resolve(compilerDependencyRoot);
  const lifecycleOptions = await bindCanonicalGeneratedStateLifecycle(operationOptions, root);
  const nodeModulesPath = dependencyAuthorityPaths(root).compilerModulesRoot;
  const bindingPath = path.join(nodeModulesPath, COMPILER_DEPS_BINDING_FILE);

  // A legacy v1 root is evidence requiring the owner migration before any
  // readiness read can classify it as absent.  Route that one-way conversion
  // through the compiler-root lease; do not let the normal reader dual-read
  // or fall through to a fresh install.
  if (inspectLegacyDependencyTransitionNamespace(root) !== null) {
    await withCompilerDependencyTransitionLease(root, lifecycleOptions, async () => undefined);
  }

  const identity = await compilerDependencyIdentity(root);
  const activeRollover = await inspectActiveDependencyTransitionRollover(root, lifecycleOptions);
  if (activeRollover !== null && activeRollover.active !== null) {
    // Admission is still read-only; the lease callback above is the only
    // place that may perform the retained-root recovery effect.
    await withCompilerDependencyTransitionLease(root, lifecycleOptions, async () => undefined);
  }
  const pendingTransition = await readDependencyTransition(root, lifecycleOptions);
  if (pendingTransition !== null && pendingTransition.kind !== 'project-projection' &&
      pendingTransition.kind !== 'compiler-bridge' &&
      pendingTransition.phase !== 'complete' && pendingTransition.phase !== 'rolled-back') {
    await withCompilerDependencyTransitionLease(root, lifecycleOptions, async (lockedOptions) => {
      await recoverCompilerDependencyTransition(root, nodeModulesPath, identity, lockedOptions);
    });
  }
  const observed = await observeCompilerDependencyReady(
    root,
    nodeModulesPath,
    identity,
    lifecycleOptions
  );
  if (observed?.kind === 'incompatible-bridge') {
    await withCompilerDependencyTransitionLease(root, lifecycleOptions, async (lockedOptions) => {
      const current = await observeCompilerDependencyReady(
        root,
        nodeModulesPath,
        identity,
        lockedOptions
      );
      if (current?.kind !== 'incompatible-bridge') {
        throw new SecError(
          'IMPORT-AUTHORITY-004',
          'Compiler dependency locator changed before incompatible-state retirement'
        );
      }
      if (!await disposeIncompatibleCompilerDependencyLocator(root, lockedOptions)) {
        throw new SecError(
          'IMPORT-AUTHORITY-004',
          'Incompatible compiler dependency locator disappeared before lifecycle disposal'
        );
      }
    });
  }
  if (observed?.kind === 'external-bridge') {
    return withCompilerDependencyTransitionLease(root, lifecycleOptions, async () => {
      const current = await observeCompilerDependencyReady(
        root,
        nodeModulesPath,
        identity,
        lifecycleOptions
      );
      if (current?.kind !== 'external-bridge'
          || !canonicalEquals(current.binding, observed.binding)) {
        throw new SecError('IMPORT-AUTHORITY-004', 'Compiler dependency locator changed before lifecycle binding');
      }
      await bindExistingCompilerDependencyLocator(root, identity, current.binding, lifecycleOptions);
      return createCompilerDepsReadyState({
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
  if (observed?.kind === 'local-generation') {
    return withCompilerDependencyTransitionLease(root, lifecycleOptions, async () => {
      const current = await observeCompilerDependencyReady(
        root,
        nodeModulesPath,
        identity,
        lifecycleOptions
      );
      if (current?.kind !== 'local-generation') {
        throw new SecError(
          'IMPORT-AUTHORITY-004',
          'Compiler dependency generation changed before lifecycle binding; current state is preserved'
        );
      }
      if (lifecycleOptions.generatedStateLifecycle !== undefined) {
        await bindExistingCompilerDependencyGeneration(
          lifecycleOptions,
          current.sourceGeneration.physical
        );
      }
      return createCompilerDepsReadyState({
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

  return withCompilerDependencyTransitionLease(root, lifecycleOptions, async (lockedOptions) => {
    const lockedBridge = await compilerDependencyConsumerBridgeBinding(
      root,
      nodeModulesPath,
      identity,
      lockedOptions
    );
    if (lockedBridge !== null) {
      await bindExistingCompilerDependencyLocator(root, identity, lockedBridge, lockedOptions);
      return createCompilerDepsReadyState({
        binding: lockedBridge,
        identity,
        kind: 'none',
        nodeModulesPath,
        root,
        sourceGeneration: await runtimeDependencySourceGeneration({
          binding: lockedBridge,
          options: lockedOptions,
          ownerRoot: path.dirname(path.resolve(await fs.realpath(nodeModulesPath))),
          sourcePath: path.resolve(await fs.realpath(nodeModulesPath))
        }),
        source: 'existing'
      });
    }
    await disposeIncompatibleCompilerDependencyLocator(root, lockedOptions);
    const lockedExisting = await ready();
    if (lockedExisting !== null) {
      const existingSourceGeneration = await runtimeDependencySourceGeneration({
        binding: lockedExisting,
        options: lockedOptions,
        ownerRoot: root,
        sourcePath: nodeModulesPath
      });
      if (lockedOptions.generatedStateLifecycle !== undefined) {
        await bindExistingCompilerDependencyGeneration(
          lockedOptions,
          existingSourceGeneration.physical
        );
      }
      const readyState = createCompilerDepsReadyState({
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

    const sharedWorktreeGeneration = await resolveLinkedWorktreeDependencyGeneration({
      consumerRoot: root,
      consumerIdentity: identity,
      options: lockedOptions
    });
    if (sharedWorktreeGeneration !== null) {
      let createdLocator = false;
      let createdLocatorIdentity: Readonly<{
        source: GeneratedStatePhysicalIdentity;
        linkTarget: string;
      }> | null = null;
      let lifecycleBindingAttempted = false;
      let retiredPreimage: RetiredCompilerDependencyPreimage | null = null;
      const sourceGeneration = sharedWorktreeGeneration.sourceGeneration;
      const locatorBackupPath = path.join(
        (await ensureDependencyTransitionNamespace(root, lockedOptions)).backupRoot.path,
        `locator-preimage-${sourceGeneration.epoch.slice('sha256:'.length, 'sha256:'.length + 24)}`
      );
      let transition: DependencyTransitionJournal | null = null;
      try {
        const currentTarget = await observeDependencyTransitionSlot(nodeModulesPath);
        if (currentTarget.kind === 'directory') {
          await compilerDependencyGeneratedPreimageDigest(nodeModulesPath);
        } else if (currentTarget.kind !== 'absent') {
          throw new SecError('IMPORT-AUTHORITY-004', 'Foreign compiler dependency locator target is preserved');
        }
        transition = await beginDependencyTransition({
          kind: 'compiler-locator',
          ownerRoot: root,
          destinationPath: nodeModulesPath,
          stagePath: null,
          backupPath: locatorBackupPath,
          sourceGeneration,
          bindingDigest: generatedStateDigest(sharedWorktreeGeneration.binding),
          options: lockedOptions
        });
        if (transition.preimage.kind === 'directory') {
          retiredPreimage = await retireIncompatibleCompilerDependencyTarget(
            root,
            nodeModulesPath,
            lockedOptions,
            locatorBackupPath
          );
          transition = await advanceDependencyTransition(transition, {
            destination: transitionAbsentSlot(nodeModulesPath),
            backup: await observeDependencyTransitionSlot(locatorBackupPath),
            phase: 'backed-up',
            durability: 'known',
            failure: null
          }, lockedOptions);
        }
        await createCompilerDependencyLocator(
          nodeModulesPath,
          sharedWorktreeGeneration.nodeModulesPath,
          sourceGeneration.physical,
          lockedOptions
        );
        createdLocator = true;
        createdLocatorIdentity = compilerDependencyLocatorObservation(root, 'node_modules');
        if (createdLocatorIdentity === null) {
          throw new SecError('IMPORT-AUTHORITY-004', 'Published compiler dependency locator has no physical identity');
        }
        transition = await advanceDependencyTransition(transition, {
          destination: await observeDependencyTransitionSlot(nodeModulesPath),
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
          throw new SecError('IMPORT-AUTHORITY-004', 'Published compiler dependency locator failed exact readback');
        }
        lifecycleBindingAttempted = true;
        await publishCompilerDependencyLocatorLifecycle(root, identity, binding, lockedOptions);
        await advanceDependencyTransition(transition, {
          destination: await observeDependencyTransitionSlot(nodeModulesPath),
          backup: await observeDependencyTransitionSlot(locatorBackupPath),
          sourceGeneration,
          phase: 'complete',
          durability: 'known',
          failure: null
        }, lockedOptions);
        return createCompilerDepsReadyState({
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
            await deleteExactCompilerDependencyLocator(root, createdLocatorIdentity, lockedOptions);
          } catch (rollbackError) {
            rollbackFailure = rollbackError;
          }
        }
        if (retiredPreimage !== null && !lifecycleBindingAttempted &&
          (await observeDependencyTransitionSlot(nodeModulesPath)).kind === 'absent') {
          try {
            await restoreRetiredCompilerDependencyTarget(
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
            await advanceDependencyTransition(transition, {
              destination: await observeDependencyTransitionSlot(nodeModulesPath),
              backup: await observeDependencyTransitionSlot(locatorBackupPath),
              phase: 'rolled-back',
              durability: 'known',
              failure: transitionFailure(error)
            }, lockedOptions).catch((journalError) => { rollbackFailure = journalError; });
          } else if (lifecycleBindingAttempted || rollbackFailure !== undefined) {
            await markDependencyTransitionFailure(transition, error, lockedOptions).catch((journalError) => {
              rollbackFailure ??= journalError;
            });
          }
        }
        if (rollbackFailure !== undefined) {
          throw new SecError(
            'IMPORT-AUTHORITY-004',
            'Compiler dependency locator transition failed and exact rollback requires recovery',
            {
              cause: error instanceof Error ? error.message : String(error),
              causeDetails: error instanceof SecError ? error.details : null,
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
      staged.stageIntent,
      identity,
      lockedOptions
    );
    const published = await ready();
    if (published === null) {
      throw new SecError('IMPORT-AUTHORITY-002', 'Published compiler dependency generation failed validation');
    }

    const readyState = createCompilerDepsReadyState({
      binding: published,
      identity,
      kind: 'generation-published',
      nodeModulesPath,
      root,
      sourceGeneration: await runtimeDependencySourceGeneration({
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

const dependencyInvocationFunctionIds = new WeakMap<Function, number>();
let dependencyInvocationFunctionSequence = 0;
function dependencyInvocationFunctionId(value: Function | undefined): number {
  if (value === undefined) return 0;
  const existing = dependencyInvocationFunctionIds.get(value);
  if (existing !== undefined) return existing;
  const next = ++dependencyInvocationFunctionSequence;
  dependencyInvocationFunctionIds.set(value, next);
  return next;
}

function compilerDependencyReadyInFlightKey(
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
    dependencyInvocationFunctionId(options.commandRunner),
    options.installMode ?? 'allow',
    options.lockTimeoutMs ?? null,
    options.pollIntervalMs ?? null,
    options.skipSharedDepsWarmup ?? false,
    options.testCompilerPublishPlatform ?? null
  ]);
}

const compilerDependencyReadyInFlight = new Map<string, Promise<CompilerDepsReadyState>>();

export async function ensureCompilerDepsReady(
  options: RuntimeDependencyInstallOptions = {},
  compilerDependencyRoot = compilerRoot
): Promise<CompilerDepsReadyState> {
  options = runtimeDependencyOperationOptions(options);
  const key = compilerDependencyReadyInFlightKey(options, compilerDependencyRoot);
  if (key === null) return ensureCompilerDepsReadyInternal(options, compilerDependencyRoot);
  const existing = compilerDependencyReadyInFlight.get(key);
  if (existing !== undefined) return existing;
  const pending = ensureCompilerDepsReadyInternal(options, compilerDependencyRoot);
  compilerDependencyReadyInFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    if (compilerDependencyReadyInFlight.get(key) === pending) {
      compilerDependencyReadyInFlight.delete(key);
    }
  }
}

async function ensureSharedDepsReadyInternal(
  options: RuntimeDependencyInstallOptions = {}
): Promise<SharedDepsReadyState> {
  const operationOptions = runtimeDependencyOperationOptions(options);
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
    return withCompilerDependencyTransitionLease(
      compilerDependencyRoot,
      lifecycleOptions,
      async (lockedOptions) => {
        const currentRoot = await physicalSharedDependencyDirectory(sharedDepsRoot, true);
        if (observedRoot === null || currentRoot === null || !sameGeneratedStateIdentity(
          generatedStatePhysicalIdentity(currentRoot),
          generatedStatePhysicalIdentity(observedRoot)
        )) {
          throw new SecError(
            'IMPORT-AUTHORITY-004',
            'Shared dependency root changed before lifecycle binding; current state is preserved'
          );
        }
        if (canonicalSharedRoot) await bindExistingSharedDependencyRoot(lockedOptions, currentRoot);
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
          throw new SecError(
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
    throw new SecError('RUNTIME-DEPS-002', 'Compiler dependency generation has no runtime closure');
  }

  return withCompilerDependencyTransitionLease(
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
        await bindExistingSharedDependencyRoot(leaseOptions, rootIdentity);
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
    const lockedOptions = runtimeDependencyOperationOptions({ ...leaseOptions, beforeCommit: rootFence });

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
      options: runtimeDependencyOperationOptions({ ...lockedOptions, beforeCommit: authorityFence }),
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
      const stagedNodeModules = await observeDependencyTransitionSlot(
        staged.nodeModulesPath,
        generatedStateDigest(binding)
      );
      await disposeDependencyTransitionStage(
        sharedDepsRoot,
        staged.root,
        runtimeDependencyOperationOptions({ ...lockedOptions, generatedStateLifecycle: undefined }),
        'runtime-projection-staging-invalid',
        stagedNodeModules,
        staged.rootSlot,
        runtimeDependencyStageAuthority(path.dirname(staged.root))
      );
      throw new SecError('RUNTIME-DEPS-002', 'Staged runtime dependency projection is incomplete');
    }
    const projectionSourceGeneration = await runtimeDependencySourceGeneration({
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
    const compilerSourceGeneration = compilerReady.sourceGeneration ?? await runtimeDependencySourceGeneration({
      binding,
      options: lockedOptions,
      ownerRoot: compilerDependencyRoot,
      sourcePath: compilerReady.nodeModulesPath
    });
    const sourceGeneration = await runtimeDependencySourceGeneration({
      binding,
      options: lockedOptions,
      ownerRoot: compilerSourceGeneration.ownerRoot,
      sourcePath: compilerSourceGeneration.sourcePath
    });
    const target = await runtimeDependencyTargetIdentity(sharedNodeModulesPath);
    if (target === null) {
      throw new SecError('RUNTIME-DEPS-002', 'Shared dependency projection has no physical target identity');
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
      throw new SecError(
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

function sharedDependencyReadyInFlightKey(
  options: RuntimeDependencyInstallOptions,
  sharedDepsRoot: string
): string | null {
  if (options.beforeCommit !== undefined || options.generatedStateLifecycle !== undefined ||
      options.signal !== undefined || options.now !== undefined || options.sleep !== undefined ||
      options.testCompilerPublishHook !== undefined || options.testCompilerBridgeValidationHook !== undefined ||
      options.testCompilerRename !== undefined || options.testProjectProjectionHook !== undefined) return null;
  return JSON.stringify([
    path.resolve(sharedDepsRoot),
    dependencyInvocationFunctionId(options.commandRunner),
    options.installMode ?? 'allow',
    options.lockTimeoutMs ?? null,
    options.pollIntervalMs ?? null,
    options.skipSharedDepsWarmup ?? false
  ]);
}

const sharedDependencyReadyInFlight = new Map<string, Promise<SharedDepsReadyState>>();

export async function ensureSharedDepsReady(
  options: RuntimeDependencyInstallOptions = {}
): Promise<SharedDepsReadyState> {
  options = runtimeDependencyOperationOptions(options);
  const sharedDepsRoot = options.sharedDepsRoot ?? defaultSharedDepsRoot();
  const key = sharedDependencyReadyInFlightKey(options, sharedDepsRoot);
  if (key === null) return ensureSharedDepsReadyInternal(options);
  const existing = sharedDependencyReadyInFlight.get(key);
  if (existing !== undefined) return existing;
  const pending = ensureSharedDepsReadyInternal(options);
  sharedDependencyReadyInFlight.set(key, pending);
  try {
    return await pending;
  } finally {
    if (sharedDependencyReadyInFlight.get(key) === pending) {
      sharedDependencyReadyInFlight.delete(key);
    }
  }
}

export async function ensureProjectDependencies(
  projectRoot: string,
  options: RuntimeDependencyInstallOptions = {}
): Promise<void> {
  const operationOptions = runtimeDependencyOperationOptions(options);
  options = operationOptions;
  const runtimeSpec = await loadRuntimeDependencySpec();
  const projectRootPath = path.resolve(projectRoot);
  const nodeModulesPath = path.join(projectRootPath, 'node_modules');
  if (operationOptions.installMode === 'prebound-only') {
    await runtimeDependencyOperationEffectFence(operationOptions, 'Prebound dependency read admission');
    const [binding, installed] = await Promise.all([
      readJson<unknown>(path.join(nodeModulesPath, RUNTIME_DEPS_PREBOUND_BINDING_FILE))
        .catch(() => null),
      hasCompleteRuntimeDeps(nodeModulesPath, runtimeSpec)
    ]);
    await runtimeDependencyOperationEffectFence(operationOptions, 'Prebound dependency readback');
    if (!installed || !isRuntimeDepsPreboundBinding(binding, runtimeSpec.manifestHash)) {
      throw new SecError(
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
  let sourceGeneration: RuntimeDependencySourceGeneration;

  if (isolated) {
    const sharedStamp = await readRuntimeDepsStamp(path.join(sharedDepsRoot, 'runtime-deps.stamp.json'));
    sourceNodeModulesPath = path.join(sharedDepsRoot, 'node_modules');
    if (sharedStamp === null) {
      throw new SecError(
        'RUNTIME-DEPS-004',
        'Canonical shared dependency projection is unavailable for isolated verification'
      );
    }
    let observedSourceGeneration: RuntimeDependencySourceGeneration | null;
    try {
      observedSourceGeneration = await runtimeDependencySourceGeneration({
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
      !sameRuntimeDependencySourceGenerationContent(observedSourceGeneration, sharedStamp.sourceGeneration) ||
      !sameGeneratedStateIdentity(observedSourceGeneration.physical, sharedStamp.sourceGeneration.physical) ||
      !await runtimeDependencyTreeMatchesBinding({
        expected: sharedStamp.binding,
      nodeModulesPath: sourceNodeModulesPath,
      root: compilerDependencyRoot,
      runtimeSpec
      })) {
      throw new SecError(
        'RUNTIME-DEPS-004',
        'Canonical shared dependency projection is unavailable for isolated verification'
      );
    }
    binding = sharedStamp.binding;
    const actualSharedSourcePath = path.resolve(await fs.realpath(sourceNodeModulesPath));
    sourceGeneration = await runtimeDependencySourceGeneration({
      binding,
      options: operationOptions,
      ownerRoot: path.dirname(actualSharedSourcePath),
      sourcePath: actualSharedSourcePath
    });
  } else if (operationOptions.skipSharedDepsWarmup === true) {
    const compilerIdentity = await compilerDependencyIdentity(compilerDependencyRoot);
    sourceNodeModulesPath = dependencyAuthorityPaths(compilerDependencyRoot).compilerModulesRoot;
    const compilerReady = await observeCompilerDependencyReady(
      compilerDependencyRoot,
      sourceNodeModulesPath,
      compilerIdentity,
      operationOptions
    );
    if (compilerReady === null || compilerReady.kind === 'incompatible-bridge' ||
        compilerReady.binding.runtimeMaterialization === null) {
      throw new SecError('RUNTIME-DEPS-004', 'Canonical compiler dependency readiness is unavailable');
    }
    binding = compilerReady.binding.runtimeMaterialization;
    const compilerSourceGeneration = compilerReady.sourceGeneration ?? await runtimeDependencySourceGeneration({
      binding: compilerReady.binding,
      options: operationOptions,
      ownerRoot: compilerDependencyRoot,
      sourcePath: sourceNodeModulesPath
    });
    sourceGeneration = await runtimeDependencySourceGeneration({
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
    sourceGeneration = await runtimeDependencySourceGeneration({
      binding,
      options: operationOptions,
      ownerRoot: path.dirname(actualSharedSourcePath),
      sourcePath: actualSharedSourcePath
    });
  }

  const projectTransitionInput: ProjectProjectionTransitionInput = Object.freeze({
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
  await withCompilerDependencyTransitionLease(
    compilerDependencyRoot,
    operationOptions,
    async (lockedOptions) => {
      const lockedTransitionInput: ProjectProjectionTransitionInput = Object.freeze({
        ...projectTransitionInput,
        options: lockedOptions
      });
      await recoverProjectDependencyTransition(lockedTransitionInput);
      await runtimeDependencyOperationEffectFence(lockedOptions, 'Project dependency cache admission');
      const currentStamp = await readRuntimeDepsStamp(stampPath);
      const currentTarget = await runtimeDependencyTargetIdentity(nodeModulesPath);
      let sourceStillCurrent: boolean;
      try {
        const current = await runtimeDependencySourceGeneration({
          binding,
          options: lockedOptions,
          ownerRoot: sourceGeneration.ownerRoot,
          sourcePath: sourceGeneration.sourcePath
        });
        sourceStillCurrent = current.epoch === sourceGeneration.epoch &&
          sameRuntimeDependencySourceGenerationContent(current, sourceGeneration) &&
          sameGeneratedStateIdentity(current.physical, sourceGeneration.physical);
      } catch (error) {
        if (!isFileNotFoundError(error)) throw error;
        sourceStillCurrent = false;
      }
      const cacheReady = !lockedOptions.rematerialize &&
        sourceStillCurrent &&
        currentStamp?.binding.revision === binding.revision &&
        canonicalEquals(currentStamp.binding, binding) &&
        currentStamp.sourceGeneration.epoch === sourceGeneration.epoch &&
        sameRuntimeDependencySourceGenerationContent(currentStamp.sourceGeneration, sourceGeneration) &&
        sameGeneratedStateIdentity(currentStamp.sourceGeneration.physical, sourceGeneration.physical) &&
        currentTarget !== null &&
        currentTarget.kind === currentStamp.target.kind &&
        currentTarget.linkTarget === currentStamp.target.linkTarget &&
        sameGeneratedStateIdentity(currentTarget.physical, currentStamp.target.physical) &&
        (isolated
          ? await runtimeDependencyTreeMatchesBinding({
            expected: binding,
            nodeModulesPath,
            root: compilerDependencyRoot,
            runtimeSpec
          })
          : await dependencyBridgeTargets(nodeModulesPath, sourceNodeModulesPath));
      await runtimeDependencyOperationEffectFence(lockedOptions, 'Project dependency ready-state settlement');
      if (cacheReady) return;
      await publishProjectDependencyProjection(lockedTransitionInput);
    }
  );
}
