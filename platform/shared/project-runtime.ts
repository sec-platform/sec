import crypto from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import fs from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import path from 'node:path';
import { loadCanonicalBunRuntimeVersion } from './bun-runtime-version.ts';
import {
  canonicalEquals,
  canonicalJson,
  compareCodeUnits,
  digest,
  sortedKeys,
  uniqueSorted
} from './canonical-primitives.ts';
import { CompilerError } from './errors.ts';
import {
  ensureDir,
  formatJsonFile,
  pathExists,
  readJson,
  writeJson,
  writeText,
  type CommitFence
} from './fs.ts';
import { compilerRoot, isPathInside } from './paths.ts';
import {
  buildIsolatedProcessEnvironment,
  ensureIsolatedProcessDirectories,
  ISOLATED_VERIFICATION_ENV_KEY,
  pathEnvKey,
  runCommand,
  type CommandResult
} from './process.ts';
import {
  buildExactPlaywrightPackageAuthority,
  buildRuntimeDependencyMaterializationBinding,
  buildRuntimePackageManifest,
  EXACT_PLAYWRIGHT_PACKAGE_NAMES,
  isRuntimeDependencyMaterializationBinding,
  isRuntimeDependencyPackageManifest,
  isRuntimeDependencyPackageName,
  isRuntimeDepsPreboundBinding,
  loadRuntimeDependencySpec,
  RUNTIME_DEPENDENCY_PACKAGE_NAMES,
  RUNTIME_DEPS_PREBOUND_BINDING_FILE,
  type ExactPlaywrightPackageAuthority,
  type ExactPlaywrightPackageName,
  type RootPackageJson,
  type RuntimeDependencyMaterializationBinding,
  type RuntimeDependencyResolutionEdge,
  type RuntimeDependencyResolvedPackage,
  type RuntimeDependencySpec,
  type RuntimeDependencyToolchainBinding
} from './runtime-dependency-spec.ts';

export interface RuntimeDepsStamp {
  binding: Readonly<RuntimeDependencyMaterializationBinding>;
  formatVersion: 'runtime-deps-stamp-v3';
  manifestHash: string;
  packageManager: 'bun';
  installedAt: string;
}

export interface SharedDepsReadyState {
  binding: Readonly<RuntimeDependencyMaterializationBinding>;
  packageManager: 'bun';
  root: string;
  nodeModulesPath: string;
  manifestHash: string;
}

export interface CompilerDepsReadyState {
  manifestHash: string;
  nodeModulesPath: string;
  packageManager: 'bun';
  root: string;
  readonly runtimeMaterialization?: Readonly<RuntimeDependencyMaterializationBinding> | null;
  source: 'existing' | 'installed';
}

export interface DependencyAuthorityPaths {
  readonly browserCache: string;
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
  readonly formatVersion: 'compiler-deps-binding-v4' | 'compiler-deps-binding-v5';
  readonly installConfigSha256: string | null;
  readonly lockSha256: string;
  readonly manifestHash: string;
  readonly packages: readonly CompilerDependencyPackageBinding[];
  readonly platform: NodeJS.Platform;
  readonly runtimeMaterialization: Readonly<RuntimeDependencyMaterializationBinding> | null;
}

const COMPILER_DEPS_BINDING_FILE = '.sec-compiler-deps-binding-v4.json' as const;

export interface RuntimeDependencyInstallOptions {
  beforeCommit?: CommitFence;
  commandRunner?: typeof runCommand;
  installMode?: 'allow' | 'offline-copy-only' | 'prebound-only';
  lockTimeoutMs?: number;
  now?: () => string;
  pollIntervalMs?: number;
  rematerialize?: boolean;
  sharedDepsRoot?: string;
  signal?: AbortSignal;
  skipSharedDepsWarmup?: boolean;
  sleep?: (ms: number) => Promise<void>;
  testCompilerPublishPlatform?: NodeJS.Platform;
  testCompilerPublishHook?: (stage: 'active-backed-up') => void | Promise<void>;
  testCompilerBridgeValidationHook?: (
    stage: 'binding-observed' | 'final-binding-observed'
  ) => void | Promise<void>;
  testCompilerRename?: (source: string, target: string) => Promise<void>;
}

export interface ExternalNodeRuntimeResolutionOptions {
  beforeCommit?: CommitFence;
  commandRunner?: typeof runCommand;
  environment?: NodeJS.ProcessEnv;
  nodeExecutablePath?: string;
  signal?: AbortSignal;
}

export interface ExternalNodeRuntimeAuthority {
  readonly executablePath: string;
  readonly version: string;
}

export interface PlaywrightBrowserCacheInstallOptions extends RuntimeDependencyInstallOptions {
  environment?: NodeJS.ProcessEnv;
  installTimeoutMs?: number;
  nodeExecutablePath?: string;
  playwrightProjectRoot?: string;
}

export type PlaywrightBrowserCacheMaterializationResult = Readonly<
  | {
    browserCachePath: string;
    browserExecutablePath: null;
    commandResult: CommandResult;
    source: null;
    status: 'failed';
  }
  | {
    browserCachePath: string;
    browserExecutablePath: string;
    browserExecutableRelativePath: string;
    commandResult: CommandResult;
    externalNode: Readonly<ExternalNodeRuntimeAuthority>;
    playwrightPackageClosure: Readonly<ExactPlaywrightPackageAuthority>;
    source: 'existing' | 'installed';
    status: 'ready';
  }
>;

export interface PlaywrightBrowserRuntimeAuthority {
  browserCachePath: string;
  browserExecutablePath: string;
  browserExecutableRelativePath: string;
  externalNode: Readonly<ExternalNodeRuntimeAuthority>;
  playwrightPackageClosure: Readonly<ExactPlaywrightPackageAuthority>;
}

export type PlaywrightBrowserCacheReadyState = Readonly<PlaywrightBrowserRuntimeAuthority>;

export const EXTERNAL_NODE_MINIMUM_MAJOR_VERSION = 22;
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
const PLAYWRIGHT_BROWSER_INSTALL_TIMEOUT_MS = 600_000;
const EXTERNAL_NODE_RUNTIME_PROBE = [
  "process.stdout.write(JSON.stringify({",
  "  bunVersion: process.versions.bun ?? null,",
  "  executablePath: process.execPath,",
  "  format: 'sec-external-node-runtime-v1',",
  "  releaseName: process.release?.name ?? null,",
  "  version: process.versions.node ?? null",
  '}));'
].join('\n');
const PLAYWRIGHT_BROWSER_EXECUTABLE_PROBE = [
  "const path = require('node:path');",
  "const { createRequire } = require('node:module');",
  'const projectRoot = process.argv[1];',
  "const requireFromProject = createRequire(path.join(projectRoot, 'package.json'));",
  "const { registry } = requireFromProject('playwright-core/lib/server');",
  "process.stdout.write(registry.findExecutable('chromium-headless-shell').executablePath());"
].join('\n');

export function dependencyAuthorityPaths(
  dependencyRoot = compilerRoot
): Readonly<DependencyAuthorityPaths> {
  const root = path.resolve(dependencyRoot);
  const sharedDepsRoot = path.join(root, '.shared-deps');
  return Object.freeze({
    browserCache: path.join(sharedDepsRoot, '.playwright-browsers'),
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
  legacyInstallConfigSha256: string | null;
  legacyManifestHash: string;
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

let runtimeExecutableIdentityCache: RuntimeExecutableIdentity | null = null;

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
  if (!refresh && runtimeExecutableIdentityCache?.signature === signature) {
    return runtimeExecutableIdentityCache;
  }
  const executableBytes = await fs.readFile(executablePath);
  const after = await fs.lstat(executablePath, { bigint: true });
  if (metadata.dev !== after.dev || metadata.ino !== after.ino || metadata.mode !== after.mode ||
    metadata.size !== after.size || metadata.mtimeNs !== after.mtimeNs ||
    !sameHostPath(await fs.realpath(process.execPath), executablePath)) {
    throw new CompilerError('IMPORT-AUTHORITY-001', 'Bun runtime executable changed during observation');
  }
  const identity = Object.freeze({
    path: executablePath,
    sha256: digest(executableBytes),
    signature
  });
  runtimeExecutableIdentityCache = identity;
  return identity;
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
  const legacyInstallConfigSha256 = installConfigBytes === null ? null : digest(installConfigBytes);
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
    legacyInstallConfigSha256,
    legacyManifestHash: digest(manifestContent(legacyInstallConfigSha256)),
    lockSha256,
    manifestHash: digest(manifestContent(installConfigSha256)),
    packageNames: sortedKeys(packageVersions),
    packageSourceSha256: digest(packageJsonBytes),
    packageVersions
  };
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

async function exactPlaywrightPackageClosure(
  nodeModulesPath: string
): Promise<Readonly<ExactPlaywrightPackageAuthority>> {
  const runtimeSpec = await loadRuntimeDependencySpec();
  const expectedRelease = runtimeSpec.devDependencies['@playwright/test'];
  try {
    const bindings = await Promise.all(EXACT_PLAYWRIGHT_PACKAGE_NAMES.map((name) =>
      compilerDependencyPackageBinding(nodeModulesPath, name, expectedRelease!)
    ));
    return buildExactPlaywrightPackageAuthority(
      bindings.map((binding) => ({
        manifestSha256: binding.manifestSha256,
        name: binding.name as ExactPlaywrightPackageName,
        version: binding.version
      })),
      expectedRelease!
    );
  } catch {
    throw new CompilerError(
      'RUNTIME-DEPS-000',
      `Playwright packages must exactly match release ${expectedRelease}`
    );
  }
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
  const binding = await readJson<CompilerDepsBinding>(bindingPath).catch(() => null);
  if (binding === null ||
    (binding.formatVersion !== 'compiler-deps-binding-v4' &&
      binding.formatVersion !== 'compiler-deps-binding-v5')) return null;
  const legacy = binding.formatVersion === 'compiler-deps-binding-v4';
  const bindingInstallConfigSha256 = legacy
    ? identity.legacyInstallConfigSha256
    : identity.installConfigSha256;
  const bindingManifestHash = legacy ? identity.legacyManifestHash : identity.manifestHash;
  if (
    binding.architecture !== identity.architecture ||
    binding.bunExecutablePath !== identity.bunExecutablePath ||
    binding.bunExecutableSha256 !== identity.bunExecutableSha256 ||
    binding.bunVersion !== identity.bunVersion ||
    binding.declaredBunVersion !== identity.declaredBunVersion ||
    binding.dependencyManifestSha256 !== identity.dependencyManifestSha256 ||
    binding.installConfigSha256 !== bindingInstallConfigSha256 ||
    binding.lockSha256 !== identity.lockSha256 ||
    binding.manifestHash !== bindingManifestHash ||
    binding.platform !== identity.platform) return null;
  const packages = await compilerDependencyPackageBindings(nodeModulesPath, identity).catch(() => null);
  if (packages === null || !canonicalEquals(binding.packages, packages)) return null;
  const bindingIdentity = {
    ...identity,
    installConfigSha256: bindingInstallConfigSha256,
    manifestHash: bindingManifestHash
  };
  const runtimeMaterialization = await compilerRuntimeMaterializationBinding(
    root,
    nodeModulesPath,
    bindingIdentity
  ).catch(() => undefined);
  if (runtimeMaterialization === undefined) return null;
  const expected = {
    architecture: identity.architecture,
    bunExecutablePath: identity.bunExecutablePath,
    bunExecutableSha256: identity.bunExecutableSha256,
    bunVersion: identity.bunVersion,
    declaredBunVersion: identity.declaredBunVersion,
    dependencyManifestSha256: identity.dependencyManifestSha256,
    formatVersion: binding.formatVersion,
    installConfigSha256: bindingInstallConfigSha256,
    lockSha256: identity.lockSha256,
    manifestHash: bindingManifestHash,
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
    await exactPlaywrightPackageClosure(nodeModulesPath);
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
  let observed: PhysicalControlFileIdentity | null;
  try {
    observed = await observePhysicalControlFile(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    observed = null;
  }
  await commitFence?.();
  let handle: FileHandle | null = null;
  try {
    handle = await fs.open(filePath, observed === null ? 'wx+' : 'r+');
    const opened = physicalControlFileIdentity(await handle.stat({ bigint: true }));
    if (observed !== null && !samePhysicalControlFileIdentity(opened, observed)) {
      throw new CompilerError('RUNTIME-DEPS-002', 'Runtime dependency control file identity changed before write');
    }
    const current = await observePhysicalControlFile(filePath);
    if (!samePhysicalControlFileIdentity(opened, current)) {
      throw new CompilerError('RUNTIME-DEPS-002', 'Runtime dependency control file name changed before write');
    }
    await commitFence?.();
    await handle.truncate(0);
    await handle.writeFile(text, 'utf8');
    await handle.sync();
    const after = physicalControlFileIdentity(await handle.stat({ bigint: true }));
    const published = await observePhysicalControlFile(filePath);
    if (!samePhysicalControlFileIdentity(opened, after) ||
      !samePhysicalControlFileIdentity(after, published)) {
      throw new CompilerError('RUNTIME-DEPS-002', 'Runtime dependency control file identity changed during write');
    }
  } finally {
    await handle?.close().catch(() => undefined);
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
    if (stamp.formatVersion !== 'runtime-deps-stamp-v3' ||
      stamp.packageManager !== 'bun' ||
      typeof stamp.manifestHash !== 'string' ||
      typeof stamp.installedAt !== 'string' ||
      Number.isNaN(Date.parse(stamp.installedAt)) ||
      new Date(stamp.installedAt).toISOString() !== stamp.installedAt ||
      !isRuntimeDependencyMaterializationBinding(stamp.binding) ||
      stamp.binding.manifestHash !== stamp.manifestHash) return null;
    const binding = buildRuntimeDependencyMaterializationBinding({
      manifestHash: stamp.binding.manifestHash,
      packages: stamp.binding.packages,
      rootPackages: stamp.binding.rootPackages,
      toolchain: stamp.binding.toolchain
    });
    const canonical: RuntimeDepsStamp = {
      binding,
      formatVersion: 'runtime-deps-stamp-v3',
      installedAt: stamp.installedAt,
      manifestHash: stamp.manifestHash,
      packageManager: 'bun'
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
    formatVersion: 'runtime-deps-stamp-v3',
    installedAt: stamp.installedAt,
    manifestHash: stamp.manifestHash,
    packageManager: 'bun'
  };
  if (stamp.formatVersion !== 'runtime-deps-stamp-v3' ||
    stamp.packageManager !== 'bun' ||
    stamp.binding.manifestHash !== stamp.manifestHash ||
    !isRuntimeDependencyMaterializationBinding(stamp.binding) ||
    Number.isNaN(Date.parse(stamp.installedAt)) ||
    new Date(stamp.installedAt).toISOString() !== stamp.installedAt ||
    !canonicalEquals(stamp, canonical)) {
    throw new CompilerError('RUNTIME-DEPS-002', 'Runtime dependency stamp is non-canonical');
  }
  await writePhysicalControlText(stampPath, formatJsonFile(canonical), commitFence);
}

async function runtimeDependencyTreeMatchesBinding(input: Readonly<{
  expected: Readonly<RuntimeDependencyMaterializationBinding>;
  nodeModulesPath: string;
  root: string;
  runtimeSpec: RuntimeDependencySpec;
}>): Promise<boolean> {
  try {
    const [observed, installedPaths] = await Promise.all([
      observeRuntimeDependencyMaterializationBinding({
        nodeModulesPath: input.nodeModulesPath,
        root: input.root,
        runtimeSpec: input.runtimeSpec,
        toolchain: input.expected.toolchain
      }),
      installedRuntimePackagePaths(input.nodeModulesPath)
    ]);
    return canonicalEquals(observed, input.expected) &&
      canonicalEquals(
        installedPaths,
        input.expected.packages.map((entry) => entry.relativePath).sort(compareCodeUnits)
      );
  } catch {
    return false;
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

type SharedDependencyRootIdentity = Readonly<{
  dev: string;
  ino: string;
  mode: string;
  rootPath: string;
}>;

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

async function physicalSharedDependencyDirectory(
  directoryPath: string,
  allowMissing: boolean
): Promise<SharedDependencyRootIdentity | null> {
  const rootPath = path.resolve(directoryPath);
  try {
    const metadata = await fs.lstat(rootPath, { bigint: true });
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new CompilerError(
        'RUNTIME-DEPS-002',
        `Shared dependency authority must be a physical directory: ${rootPath}`
      );
    }
    const physicalPath = await fs.realpath(rootPath);
    if (!sameHostPath(physicalPath, rootPath)) {
      throw new CompilerError(
        'RUNTIME-DEPS-002',
        `Shared dependency authority must not traverse an alias: ${rootPath}`
      );
    }
    return Object.freeze({
      dev: String(metadata.dev),
      ino: String(metadata.ino),
      mode: String(metadata.mode),
      rootPath
    });
  } catch (error) {
    if (allowMissing && (error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

function sameSharedDependencyRootIdentity(
  left: SharedDependencyRootIdentity,
  right: SharedDependencyRootIdentity
): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode &&
    sameHostPath(left.rootPath, right.rootPath);
}

async function ensurePhysicalSharedDependencyRoot(
  sharedDepsRoot: string,
  commitFence?: CommitFence
): Promise<SharedDependencyRootIdentity> {
  const existing = await physicalSharedDependencyDirectory(sharedDepsRoot, true);
  if (existing !== null) return existing;
  const parentPath = path.dirname(path.resolve(sharedDepsRoot));
  const parent = await physicalSharedDependencyDirectory(parentPath, false);
  if (parent === null) {
    throw new CompilerError('RUNTIME-DEPS-002', 'Shared dependency authority parent is unavailable');
  }
  await commitFence?.();
  const currentParent = await physicalSharedDependencyDirectory(parentPath, false);
  if (currentParent === null || !sameSharedDependencyRootIdentity(currentParent, parent)) {
    throw new CompilerError('RUNTIME-DEPS-002', 'Shared dependency authority parent changed before creation');
  }
  try {
    await fs.mkdir(path.resolve(sharedDepsRoot));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const created = await physicalSharedDependencyDirectory(sharedDepsRoot, false);
  if (created === null) {
    throw new CompilerError('RUNTIME-DEPS-002', 'Shared dependency authority was not created');
  }
  return created;
}

async function assertSharedDependencyRootIdentity(
  expected: SharedDependencyRootIdentity
): Promise<void> {
  const current = await physicalSharedDependencyDirectory(expected.rootPath, false);
  if (current === null || !sameSharedDependencyRootIdentity(current, expected)) {
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

type PhysicalTreeCopyRoot = Readonly<{ source: string; target: string }>;
type PhysicalTreeEntryIdentity = Readonly<{
  dev: string;
  ino: string;
  mode: string;
  mtimeNs: string;
  size: string;
}>;
type PhysicalTreeDirectorySnapshot = Readonly<
  PhysicalTreeCopyRoot & { identity: PhysicalTreeEntryIdentity; names: readonly string[] }
>;
type PhysicalTreeFileSnapshot = Readonly<PhysicalTreeCopyRoot & { identity: PhysicalTreeEntryIdentity }>;

function physicalTreeEntryIdentity(
  metadata: Awaited<ReturnType<typeof fs.lstat>>
): PhysicalTreeEntryIdentity {
  const value = metadata as unknown as {
    dev: bigint;
    ino: bigint;
    mode: bigint;
    mtimeNs: bigint;
    size: bigint;
  };
  return Object.freeze({
    dev: String(value.dev),
    ino: String(value.ino),
    mode: String(value.mode),
    mtimeNs: String(value.mtimeNs),
    size: String(value.size)
  });
}

function samePhysicalTreeEntryIdentity(
  left: PhysicalTreeEntryIdentity,
  right: PhysicalTreeEntryIdentity
): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode &&
    left.mtimeNs === right.mtimeNs && left.size === right.size;
}

async function settleBoundedPhysicalTreeTasks(
  tasks: readonly (() => Promise<void>)[]
): Promise<void> {
  const { createConcurrencyLimit } = await import('./concurrency.ts');
  const limit = createConcurrencyLimit(Math.max(1, Math.min(availableParallelism(), 16)));
  const settled = await Promise.allSettled(tasks.map((task) => limit(task)));
  const rejected = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
  if (rejected !== undefined) throw rejected.reason;
}

async function copyPhysicalTrees(input: Readonly<{
  commitFence?: CommitFence;
  invalidSource: (detail: 'changed' | 'reparse' | 'special') => Error;
  roots: readonly PhysicalTreeCopyRoot[];
  skipNestedNodeModules?: boolean;
}>): Promise<void> {
  const directories: PhysicalTreeDirectorySnapshot[] = [];
  const files: PhysicalTreeFileSnapshot[] = [];
  const visit = async (root: PhysicalTreeCopyRoot): Promise<void> => {
    const metadata = await fs.lstat(root.source, { bigint: true });
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) throw input.invalidSource('reparse');
    const names = (await fs.readdir(root.source)).sort(compareCodeUnits);
    directories.push(Object.freeze({
      ...root,
      identity: physicalTreeEntryIdentity(metadata),
      names: Object.freeze(names)
    }));
    for (const name of names) {
      if (input.skipNestedNodeModules === true && name === 'node_modules') continue;
      const child = {
        source: path.join(root.source, name),
        target: path.join(root.target, name)
      };
      const childMetadata = await fs.lstat(child.source, { bigint: true });
      if (childMetadata.isSymbolicLink()) throw input.invalidSource('reparse');
      if (childMetadata.isDirectory()) {
        await visit(child);
      } else if (childMetadata.isFile()) {
        files.push(Object.freeze({
          ...child,
          identity: physicalTreeEntryIdentity(childMetadata)
        }));
      } else {
        throw input.invalidSource('special');
      }
    }
  };

  for (const root of input.roots) await visit(root);
  await settleBoundedPhysicalTreeTasks(directories.map((directory) => async () => {
    await ensureDir(directory.target, input.commitFence);
    const target = await fs.lstat(directory.target);
    if (!target.isDirectory() || target.isSymbolicLink()) throw input.invalidSource('reparse');
  }));
  await settleBoundedPhysicalTreeTasks(files.map((file) => async () => {
    await input.commitFence?.();
    const before = await fs.lstat(file.source, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() ||
      !samePhysicalTreeEntryIdentity(file.identity, physicalTreeEntryIdentity(before))) {
      throw input.invalidSource('changed');
    }
    await fs.copyFile(file.source, file.target);
    const [after, target] = await Promise.all([
      fs.lstat(file.source, { bigint: true }),
      fs.lstat(file.target, { bigint: true })
    ]);
    if (!after.isFile() || after.isSymbolicLink() || !target.isFile() || target.isSymbolicLink() ||
      !samePhysicalTreeEntryIdentity(file.identity, physicalTreeEntryIdentity(after)) ||
      after.size !== target.size) {
      throw input.invalidSource('changed');
    }
  }));
  await settleBoundedPhysicalTreeTasks(directories.map((directory) => async () => {
    const [after, namesAfter] = await Promise.all([
      fs.lstat(directory.source, { bigint: true }),
      fs.readdir(directory.source).then((names) => names.sort(compareCodeUnits))
    ]);
    if (!after.isDirectory() || after.isSymbolicLink() ||
      !samePhysicalTreeEntryIdentity(directory.identity, physicalTreeEntryIdentity(after)) ||
      JSON.stringify(namesAfter) !== JSON.stringify(directory.names)) {
      throw input.invalidSource('changed');
    }
  }));
}

async function stageRuntimeDependencyProjection(input: Readonly<{
  binding: Readonly<RuntimeDependencyMaterializationBinding>;
  commitFence: CommitFence;
  sharedDepsRoot: string;
  sourceNodeModulesPath: string;
}>): Promise<{ nodeModulesPath: string; root: string }> {
  await input.commitFence();
  const stagingRoot = await fs.mkdtemp(path.join(input.sharedDepsRoot, '.runtime-generation-'));
  const nodeModulesPath = path.join(stagingRoot, 'node_modules');
  try {
    await ensureDir(nodeModulesPath, input.commitFence);
    await copyPhysicalTrees({
      commitFence: input.commitFence,
      invalidSource: (detail) => new CompilerError(
        'RUNTIME-DEPS-002',
        detail === 'changed'
          ? 'Runtime dependency source changed during projection'
          : `Runtime dependency source contains a ${detail} entry`
      ),
      roots: input.binding.packages.map((packageIdentity) => ({
        source: path.join(input.sourceNodeModulesPath, ...packageIdentity.relativePath.split('/')),
        target: path.join(nodeModulesPath, ...packageIdentity.relativePath.split('/'))
      })),
      skipNestedNodeModules: true
    });
    return { nodeModulesPath, root: stagingRoot };
  } catch (error) {
    await fs.rm(stagingRoot, { force: true, recursive: true }).catch(() => undefined);
    throw error;
  }
}

async function publishRuntimeDependencyProjection(input: Readonly<{
  activeNodeModulesPath: string;
  commitFence: CommitFence;
  options: RuntimeDependencyInstallOptions;
  stagingNodeModulesPath: string;
  stagingRoot: string;
}>): Promise<void> {
  const backupPath = path.join(input.stagingRoot, 'previous-node-modules');
  const publishOptions: RuntimeDependencyInstallOptions = {
    ...input.options,
    beforeCommit: input.commitFence
  };
  let activeBackedUp = false;
  try {
    if (await pathExists(input.activeNodeModulesPath)) {
      await renameCompilerDependencyDirectory(
        input.activeNodeModulesPath,
        backupPath,
        publishOptions
      );
      activeBackedUp = true;
    }
    await renameCompilerDependencyDirectory(
      input.stagingNodeModulesPath,
      input.activeNodeModulesPath,
      publishOptions
    );
  } catch (error) {
    if (activeBackedUp && !(await pathExists(input.activeNodeModulesPath))) {
      await renameCompilerDependencyDirectory(
        backupPath,
        input.activeNodeModulesPath,
        publishOptions
      ).catch(() => undefined);
    }
    throw new CompilerError('RUNTIME-DEPS-002', 'Runtime dependency projection publish failed', {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  await input.commitFence();
  await fs.rm(input.stagingRoot, { force: true, recursive: true });
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
  return treeMatches && manifestMatches && residue.length === 0 ? stamp : null;
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

async function reclaimOrphanInstallLock(lockPath: string): Promise<boolean> {
  const reclaimPath = `${lockPath}.reclaim`;
  let reclaimHandle: FileHandle | null = null;
  try {
    try {
      reclaimHandle = await fs.open(reclaimPath, 'wx');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'EEXIST' ||
          (process.platform === 'win32' && (code === 'EACCES' || code === 'EPERM'))) {
        return false;
      }
      throw error;
    }

    const metadata = await fs.stat(lockPath).catch(() => null);
    if (metadata === null) return true;
    const owner = await readJson<unknown>(lockPath).catch(() => null);
    if (isInstallLockOwner(owner) && processIsAlive(owner.pid)) return false;
    if (!isInstallLockOwner(owner) && Date.now() - metadata.mtimeMs < 5000) return false;

    const orphanPath = `${lockPath}.orphan-${crypto.randomUUID()}`;
    try {
      await fs.rename(lockPath, orphanPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
      throw error;
    }
    await fs.rm(orphanPath, { force: true });
    return true;
  } finally {
    await reclaimHandle?.close().catch(() => undefined);
    if (reclaimHandle !== null) await fs.rm(reclaimPath, { force: true }).catch(() => undefined);
  }
}

async function reclaimLockIsActive(reclaimPath: string): Promise<boolean> {
  try {
    await fs.lstat(reclaimPath);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return false;
    if (process.platform === 'win32' && (code === 'EACCES' || code === 'EPERM')) {
      return true;
    }
    throw error;
  }
}

async function withInstallLock<T>(
  lockPath: string,
  options: RuntimeDependencyInstallOptions,
  callback: () => Promise<T>
): Promise<T> {
  const pollIntervalMs = options.pollIntervalMs ?? 50;
  const lockTimeoutMs = options.lockTimeoutMs ?? 300000;
  const sleep = options.sleep ?? sleepMs;
  const startTime = Date.now();
  let owner: InstallLockOwner | null = null;

  await ensureDir(path.dirname(lockPath), options.beforeCommit);

  while (true) {
    let handle: FileHandle | null = null;

    try {
      if (await reclaimLockIsActive(`${lockPath}.reclaim`)) {
        await sleep(pollIntervalMs);
        continue;
      }
      await options.beforeCommit?.();
      handle = await fs.open(lockPath, 'wx');
      owner = {
        createdAt: (options.now ?? (() => new Date().toISOString()))(),
        pid: process.pid,
        token: crypto.randomUUID()
      };
      await options.beforeCommit?.();
      await handle.writeFile(formatJsonFile(owner), 'utf8');
      break;
    } catch (error) {
      const failure = error as NodeJS.ErrnoException;
      if (failure.code !== 'EEXIST') {
        throw error;
      }

      if (await reclaimOrphanInstallLock(lockPath)) continue;

      if (Date.now() - startTime > lockTimeoutMs) {
        throw new CompilerError('RUNTIME-DEPS-003', `Timed out waiting for install lock ${lockPath}`);
      }

      await sleep(pollIntervalMs);
    } finally {
      if (handle) {
        await handle.close();
      }
    }
  }

  try {
    return await callback();
  } finally {
    await options.beforeCommit?.();
    const currentOwner = await readJson<unknown>(lockPath).catch(() => null);
    if (owner !== null && isInstallLockOwner(currentOwner) && currentOwner.token === owner.token) {
      await fs.rm(lockPath, { force: true });
    }
  }
}

async function runBunInstall(
  workingDirectory: string,
  options: RuntimeDependencyInstallOptions,
  bunArgs: string[],
  cacheDir?: string
): Promise<{ packageManager: 'bun'; result: CommandResult }> {
  const commandRunner = options.commandRunner ?? runCommand;
  const isolated = options.installMode === 'offline-copy-only';
  const isolatedWritableRoot = path.join(workingDirectory, '.isolated-process', 'dependency-install');
  if (isolated) await ensureIsolatedProcessDirectories(isolatedWritableRoot, options.beforeCommit);
  const isolatedConfigPath = path.join(isolatedWritableRoot, 'bunfig.toml');
  if (isolated) await writeText(isolatedConfigPath, '# isolated runtime\n', options.beforeCommit);
  await options.beforeCommit?.();
  const commandArgs = isolated
    ? ['--no-env-file', `--config=${isolatedConfigPath}`, ...bunArgs]
    : bunArgs;
  const bunResult = await commandRunner(process.execPath, commandArgs, {
    beforeSpawn: options.beforeCommit,
    cwd: workingDirectory,
    env: buildEnv(cacheDir ? {
      BUN_INSTALL_CACHE_DIR: cacheDir,
      ...(isolated ? {
        [ISOLATED_VERIFICATION_ENV_KEY]: '1',
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1'
      } : {})
    } : {}, isolated ? isolatedWritableRoot : undefined),
    signal: options.signal,
    ...(isolated ? { envMode: 'replace' as const } : {})
  });
  await options.beforeCommit?.();

  if (bunResult.code === 0) {
    return { packageManager: 'bun', result: bunResult };
  }

  throw new CompilerError('RUNTIME-DEPS-001', `Failed to install runtime dependencies in ${workingDirectory}`, {
    bunResult
  });
}

function playwrightBrowserInstallFailure(
  message: string,
  details: Record<string, unknown> = {}
): CompilerError {
  return new CompilerError('RUNTIME-DEPS-005', message, details);
}

function playwrightBrowserInstallTimeoutMs(configured: number | undefined): number {
  const timeoutMs = configured ?? PLAYWRIGHT_BROWSER_INSTALL_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw playwrightBrowserInstallFailure(
      'Playwright browser installer timeout must be a positive safe integer',
      { timeoutMs }
    );
  }
  return timeoutMs;
}

async function assertPlaywrightCli(playwrightProjectRoot: string): Promise<string> {
  const playwrightCli = path.join(playwrightProjectRoot, 'node_modules', 'playwright', 'cli.js');
  const metadata = await fs.lstat(playwrightCli).catch(() => null);
  if (!metadata?.isFile() || metadata.isSymbolicLink()) {
    throw playwrightBrowserInstallFailure('Canonical Playwright installer entry is unavailable', {
      playwrightCli
    });
  }
  return playwrightCli;
}

async function physicalExecutablePath(candidatePath: string): Promise<string | null> {
  const physicalPath = await fs.realpath(candidatePath).catch(() => null);
  if (physicalPath === null) return null;
  const metadata = await fs.lstat(physicalPath).catch(() => null);
  return metadata?.isFile() === true ? physicalPath : null;
}

function sameExecutablePath(left: string, right: string): boolean {
  return sameHostPath(left, right);
}

function externalNodeEnvironment(environment: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  return {
    ...environment,
    NODE_OPTIONS: undefined,
    NODE_PATH: undefined
  };
}

function pathEnvironmentValue(environment: NodeJS.ProcessEnv): string {
  return Object.entries(environment)
    .find(([key]) => key.toLocaleLowerCase('en-US') === 'path')?.[1] ?? '';
}

type ExternalNodeRuntimeProbe = Readonly<{
  bunVersion: string | null;
  executablePath: string;
  format: 'sec-external-node-runtime-v1';
  releaseName: string;
  version: string;
}>;

function parseExternalNodeRuntimeProbe(stdout: string): ExternalNodeRuntimeProbe | null {
  let value: unknown;
  try {
    value = JSON.parse(stdout.trim());
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const probe = value as Record<string, unknown>;
  if (probe.format !== 'sec-external-node-runtime-v1' ||
    probe.bunVersion !== null ||
    typeof probe.executablePath !== 'string' ||
    !path.isAbsolute(probe.executablePath) ||
    probe.releaseName !== 'node' ||
    typeof probe.version !== 'string') {
    return null;
  }
  const versionMatch = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/u.exec(probe.version);
  if (!versionMatch ||
    Number.parseInt(versionMatch[1]!, 10) < EXTERNAL_NODE_MINIMUM_MAJOR_VERSION) return null;
  return Object.freeze({
    bunVersion: null,
    executablePath: probe.executablePath,
    format: 'sec-external-node-runtime-v1',
    releaseName: 'node',
    version: probe.version
  });
}

async function validateExternalNodeRuntime(
  executablePath: string,
  options: ExternalNodeRuntimeResolutionOptions,
  workingDirectory: string
): Promise<Readonly<ExternalNodeRuntimeAuthority>> {
  const commandRunner = options.commandRunner ?? runCommand;
  let commandResult: CommandResult;
  try {
    commandResult = await commandRunner(executablePath, ['-e', EXTERNAL_NODE_RUNTIME_PROBE], {
      beforeSpawn: options.beforeCommit,
      cwd: workingDirectory,
      env: externalNodeEnvironment(options.environment),
      signal: options.signal
    });
  } catch (error) {
    throw playwrightBrowserInstallFailure('Configured Node.js runtime cannot be executed', {
      cause: error instanceof Error ? error.message : String(error),
      nodeExecutablePath: executablePath
    });
  }
  const probe = commandResult.code === 0
    ? parseExternalNodeRuntimeProbe(commandResult.stdout)
    : null;
  const reportedPhysicalPath = probe
    ? await physicalExecutablePath(probe.executablePath)
    : null;
  if (!probe || reportedPhysicalPath === null || !sameExecutablePath(executablePath, reportedPhysicalPath)) {
    throw playwrightBrowserInstallFailure(
      `Configured runtime is not the required external Node.js ${EXTERNAL_NODE_MINIMUM_MAJOR_VERSION}+ authority`,
      {
        commandResult,
        nodeExecutablePath: executablePath,
        reportedExecutablePath: probe?.executablePath ?? null,
        reportedVersion: probe?.version ?? null
      }
    );
  }
  return Object.freeze({ executablePath, version: probe.version });
}

export async function resolveExternalNodeRuntimeAuthority(
  options: ExternalNodeRuntimeResolutionOptions = {},
  workingDirectory = compilerRoot
): Promise<Readonly<ExternalNodeRuntimeAuthority>> {
  options.signal?.throwIfAborted();
  const environment = options.environment ?? process.env;
  const candidates: string[] = [];
  if (options.nodeExecutablePath) {
    candidates.push(path.resolve(options.nodeExecutablePath));
  } else {
    if (/^node(?:\.exe)?$/iu.test(path.basename(process.execPath))) {
      candidates.push(process.execPath);
    }
    const executableNames = process.platform === 'win32' ? ['node.exe', 'node'] : ['node'];
    const pathEntries = pathEnvironmentValue(environment)
      .split(path.delimiter)
      .map((entry) => entry.trim().replace(/^"|"$/gu, ''))
      .filter((entry) => entry.length > 0);
    for (const pathEntry of pathEntries) {
      for (const executableName of executableNames) {
        candidates.push(path.join(pathEntry, executableName));
      }
    }
  }

  const visited = new Set<string>();
  for (const candidate of candidates) {
    const physicalPath = await physicalExecutablePath(candidate);
    if (physicalPath === null) continue;
    const identity = process.platform === 'win32'
      ? physicalPath.toLocaleLowerCase('en-US')
      : physicalPath;
    if (visited.has(identity)) continue;
    visited.add(identity);
    return validateExternalNodeRuntime(physicalPath, options, path.resolve(workingDirectory));
  }
  throw playwrightBrowserInstallFailure(
    `Canonical external Node.js ${EXTERNAL_NODE_MINIMUM_MAJOR_VERSION}+ runtime is unavailable for Playwright installation`,
    { nodeExecutablePath: options.nodeExecutablePath ? path.resolve(options.nodeExecutablePath) : null }
  );
}

type PlaywrightBrowserCacheProbe = Readonly<{
  browserExecutablePath: string;
  commandResult: CommandResult;
}>;

function playwrightBrowserEnvironment(
  environment: NodeJS.ProcessEnv | undefined,
  browserCachePath: string
): NodeJS.ProcessEnv {
  return {
    ...environment,
    NODE_OPTIONS: undefined,
    NODE_PATH: undefined,
    PLAYWRIGHT_BROWSERS_PATH: browserCachePath,
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: undefined
  };
}

async function probePlaywrightBrowserCache(
  commandRunner: typeof runCommand,
  nodeExecutablePath: string,
  playwrightProjectRoot: string,
  browserCachePath: string,
  options: PlaywrightBrowserCacheInstallOptions
): Promise<PlaywrightBrowserCacheProbe> {
  options.signal?.throwIfAborted();
  let commandResult: CommandResult;
  try {
    commandResult = await commandRunner(
      nodeExecutablePath,
      ['-e', PLAYWRIGHT_BROWSER_EXECUTABLE_PROBE, playwrightProjectRoot],
      {
        beforeSpawn: options.beforeCommit,
        cwd: playwrightProjectRoot,
        env: playwrightBrowserEnvironment(options.environment, browserCachePath),
        signal: options.signal
      }
    );
  } catch (error) {
    throw playwrightBrowserInstallFailure('Project-local Playwright registry probe could not execute', {
      browserCachePath,
      cause: error instanceof Error ? error.message : String(error),
      nodeExecutablePath
    });
  }
  if (commandResult.code !== 0) {
    throw playwrightBrowserInstallFailure('Project-local Playwright registry probe failed', {
      browserCachePath,
      commandResult,
      nodeExecutablePath
    });
  }

  const executableLines = commandResult.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (executableLines.length !== 1 || !path.isAbsolute(executableLines[0]!)) {
    throw playwrightBrowserInstallFailure('Project-local Playwright registry returned an invalid executable path', {
      browserCachePath,
      commandResult,
      nodeExecutablePath
    });
  }

  const browserExecutablePath = path.resolve(executableLines[0]!);
  if (!isPathInside(browserCachePath, browserExecutablePath) ||
    path.resolve(browserCachePath) === browserExecutablePath) {
    throw playwrightBrowserInstallFailure('Project-local Playwright registry escaped the canonical browser cache', {
      browserCachePath,
      browserExecutablePath,
      commandResult,
      nodeExecutablePath
    });
  }
  return Object.freeze({ browserExecutablePath, commandResult });
}

async function optionalMetadata(targetPath: string): Promise<Awaited<ReturnType<typeof fs.lstat>> | null> {
  try {
    return await fs.lstat(targetPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw playwrightBrowserInstallFailure('Playwright browser cache metadata cannot be inspected', {
      cause: error instanceof Error ? error.message : String(error),
      targetPath
    });
  }
}

async function inspectPlaywrightBrowserCache(
  dependencyRoot: string,
  browserCachePath: string,
  browserExecutablePath: string
): Promise<'missing' | 'ready'> {
  const resolvedRoot = path.resolve(dependencyRoot);
  const resolvedCachePath = path.resolve(browserCachePath);
  const resolvedExecutablePath = path.resolve(browserExecutablePath);
  if (!isPathInside(resolvedRoot, resolvedCachePath) ||
    sameExecutablePath(resolvedRoot, resolvedCachePath) ||
    !isPathInside(resolvedCachePath, resolvedExecutablePath) ||
    sameExecutablePath(resolvedCachePath, resolvedExecutablePath)) {
    throw playwrightBrowserInstallFailure('Canonical Playwright browser path escaped its lexical dependency authority', {
      browserCachePath: resolvedCachePath,
      browserExecutablePath: resolvedExecutablePath,
      dependencyRoot: resolvedRoot
    });
  }

  const rootMetadata = await optionalMetadata(resolvedRoot);
  const physicalRoot = await fs.realpath(resolvedRoot).catch(() => null);
  if (rootMetadata === null || !rootMetadata.isDirectory() || rootMetadata.isSymbolicLink() || physicalRoot === null) {
    throw playwrightBrowserInstallFailure('Playwright dependency root is not a physical directory', {
      dependencyRoot: resolvedRoot,
      physicalRoot
    });
  }

  let currentPath = resolvedRoot;
  let expectedPhysicalPath = physicalRoot;
  const relativeExecutablePath = path.relative(resolvedRoot, resolvedExecutablePath);
  for (const segment of relativeExecutablePath.split(path.sep)) {
    currentPath = path.join(currentPath, segment);
    expectedPhysicalPath = path.join(expectedPhysicalPath, segment);
    const metadata = await optionalMetadata(currentPath);
    if (metadata === null) return 'missing';

    const isExecutable = sameExecutablePath(currentPath, resolvedExecutablePath);
    if (metadata.isSymbolicLink() ||
      (isExecutable ? !metadata.isFile() : !metadata.isDirectory())) {
      throw playwrightBrowserInstallFailure(
        isExecutable
          ? 'Canonical Playwright browser executable is not a physical file'
          : 'Canonical Playwright browser path contains a non-physical directory',
        {
          browserCachePath: resolvedCachePath,
          browserExecutablePath: resolvedExecutablePath,
          targetPath: currentPath
        }
      );
    }

    const physicalPath = await fs.realpath(currentPath).catch(() => null);
    if (physicalPath === null ||
      !sameExecutablePath(physicalPath, expectedPhysicalPath) ||
      !isPathInside(physicalRoot, physicalPath)) {
      throw playwrightBrowserInstallFailure('Canonical Playwright browser path escaped physical dependency containment', {
        browserCachePath: resolvedCachePath,
        browserExecutablePath: resolvedExecutablePath,
        dependencyRoot: resolvedRoot,
        expectedPhysicalPath,
        physicalPath,
        targetPath: currentPath
      });
    }
  }
  return 'ready';
}

function playwrightBrowserRuntimeAuthority(
  browserCachePath: string,
  browserExecutablePath: string,
  externalNode: Readonly<ExternalNodeRuntimeAuthority>,
  playwrightPackageClosure: Readonly<ExactPlaywrightPackageAuthority>
): Readonly<PlaywrightBrowserRuntimeAuthority> {
  const relativePath = path.relative(browserCachePath, browserExecutablePath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw playwrightBrowserInstallFailure(
      'Playwright browser executable has no canonical cache-relative identity',
      { browserCachePath, browserExecutablePath }
    );
  }
  return Object.freeze({
    browserCachePath: path.resolve(browserCachePath),
    browserExecutablePath: path.resolve(browserExecutablePath),
    browserExecutableRelativePath: relativePath.split(path.sep).join('/'),
    externalNode,
    playwrightPackageClosure
  });
}

async function waitWithAbort(
  delayMs: number,
  sleep: (ms: number) => Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  if (!signal) {
    await sleep(delayMs);
    return;
  }
  signal.throwIfAborted();
  let abortListener: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    abortListener = () => reject(signal.reason ?? new Error('Playwright browser cache bootstrap was aborted'));
    signal.addEventListener('abort', abortListener, { once: true });
  });
  try {
    await Promise.race([sleep(delayMs), aborted]);
  } finally {
    if (abortListener) signal.removeEventListener('abort', abortListener);
  }
}

export async function materializePlaywrightBrowserCache(
  options: PlaywrightBrowserCacheInstallOptions = {},
  dependencyRoot = compilerRoot
): Promise<PlaywrightBrowserCacheMaterializationResult> {
  const root = path.resolve(dependencyRoot);
  const authority = dependencyAuthorityPaths(root);
  const playwrightProjectRoot = path.resolve(options.playwrightProjectRoot ?? root);
  const installTimeoutMs = playwrightBrowserInstallTimeoutMs(options.installTimeoutMs);
  options.signal?.throwIfAborted();
  const commandRunner = options.commandRunner ?? runCommand;
  const nodeRuntime = await resolveExternalNodeRuntimeAuthority({
    beforeCommit: options.beforeCommit,
    commandRunner,
    environment: options.environment,
    nodeExecutablePath: options.nodeExecutablePath,
    signal: options.signal
  }, playwrightProjectRoot);
  const playwrightCli = await assertPlaywrightCli(playwrightProjectRoot);
  const initialPlaywrightPackageClosure = await exactPlaywrightPackageClosure(
    path.join(playwrightProjectRoot, 'node_modules')
  );
  const initialRegistryProbe = await probePlaywrightBrowserCache(
    commandRunner,
    nodeRuntime.executablePath,
    playwrightProjectRoot,
    authority.browserCache,
    options
  );
  const currentBrowserRuntime = async (
    browserExecutablePath: string
  ): Promise<Readonly<PlaywrightBrowserRuntimeAuthority>> => {
    const currentPlaywrightPackageClosure = await exactPlaywrightPackageClosure(
      path.join(playwrightProjectRoot, 'node_modules')
    );
    if (JSON.stringify(currentPlaywrightPackageClosure) !==
      JSON.stringify(initialPlaywrightPackageClosure)) {
      throw playwrightBrowserInstallFailure(
        'Playwright package authority changed during browser materialization',
        { playwrightProjectRoot }
      );
    }
    return playwrightBrowserRuntimeAuthority(
      authority.browserCache,
      browserExecutablePath,
      nodeRuntime,
      currentPlaywrightPackageClosure
    );
  };
  const lockPath = path.join(authority.sharedDepsRoot, 'playwright-browser-install.lock');
  const sleep = options.sleep ?? sleepMs;
  await inspectPlaywrightBrowserCache(
    root,
    authority.browserCache,
    initialRegistryProbe.browserExecutablePath
  );

  return withInstallLock(lockPath, {
    ...options,
    sleep: (delayMs) => waitWithAbort(delayMs, sleep, options.signal)
  }, async () => {
    options.signal?.throwIfAborted();
    if (await inspectPlaywrightBrowserCache(
      root,
      authority.browserCache,
      initialRegistryProbe.browserExecutablePath
    ) === 'ready') {
      return Object.freeze({
        ...await currentBrowserRuntime(initialRegistryProbe.browserExecutablePath),
        commandResult: { code: 0, stdout: '', stderr: '' },
        source: 'existing' as const,
        status: 'ready' as const
      });
    }

    await options.beforeCommit?.();
    options.signal?.throwIfAborted();
    if (await inspectPlaywrightBrowserCache(
      root,
      authority.browserCache,
      initialRegistryProbe.browserExecutablePath
    ) === 'ready') {
      return Object.freeze({
        ...await currentBrowserRuntime(initialRegistryProbe.browserExecutablePath),
        commandResult: { code: 0, stdout: '', stderr: '' },
        source: 'existing' as const,
        status: 'ready' as const
      });
    }
    let commandResult: CommandResult;
    try {
      commandResult = await commandRunner(nodeRuntime.executablePath, [playwrightCli, 'install', 'chromium'], {
        beforeSpawn: async () => {
          await options.beforeCommit?.();
          options.signal?.throwIfAborted();
          await currentBrowserRuntime(initialRegistryProbe.browserExecutablePath);
          if (await inspectPlaywrightBrowserCache(
            root,
            authority.browserCache,
            initialRegistryProbe.browserExecutablePath
          ) === 'ready') {
            throw playwrightBrowserInstallFailure(
              'Playwright browser cache identity changed before installer execution',
              {
                browserCachePath: authority.browserCache,
                browserExecutablePath: initialRegistryProbe.browserExecutablePath
              }
            );
          }
        },
        cwd: playwrightProjectRoot,
        env: playwrightBrowserEnvironment(options.environment, authority.browserCache),
        signal: options.signal,
        timeoutMs: installTimeoutMs
      });
    } catch (error) {
      throw playwrightBrowserInstallFailure('Canonical Playwright installer could not execute', {
        browserCachePath: authority.browserCache,
        cause: error instanceof Error ? error.message : String(error),
        nodeExecutablePath: nodeRuntime.executablePath,
        playwrightCli
      });
    }
    await options.beforeCommit?.();
    options.signal?.throwIfAborted();

    if (commandResult.code !== 0) {
      return Object.freeze({
        browserCachePath: authority.browserCache,
        browserExecutablePath: null,
        commandResult,
        source: null,
        status: 'failed' as const
      });
    }

    const finalProbe = await probePlaywrightBrowserCache(
      commandRunner,
      nodeRuntime.executablePath,
      playwrightProjectRoot,
      authority.browserCache,
      options
    );
    if (!sameExecutablePath(
      initialRegistryProbe.browserExecutablePath,
      finalProbe.browserExecutablePath
    ) || await inspectPlaywrightBrowserCache(
      root,
      authority.browserCache,
      finalProbe.browserExecutablePath
    ) !== 'ready') {
      throw playwrightBrowserInstallFailure(
        'Playwright browser cache materialization has no current executable postcondition',
        {
          browserCachePath: authority.browserCache,
          commandResult,
          initialBrowserExecutablePath: initialRegistryProbe.browserExecutablePath,
          readinessProbe: finalProbe.commandResult
        }
      );
    }
    return Object.freeze({
      ...await currentBrowserRuntime(finalProbe.browserExecutablePath),
      commandResult,
      source: 'installed' as const,
      status: 'ready' as const
    });
  });
}

export async function ensurePlaywrightBrowserCacheReady(
  options: PlaywrightBrowserCacheInstallOptions = {},
  dependencyRoot = compilerRoot
): Promise<PlaywrightBrowserCacheReadyState> {
  const result = await materializePlaywrightBrowserCache(options, dependencyRoot);
  if (result.status !== 'ready' || result.browserExecutablePath === null) {
    throw playwrightBrowserInstallFailure('Failed to materialize the canonical Playwright browser cache', {
      browserCachePath: result.browserCachePath,
      commandResult: result.commandResult
    });
  }
  return Object.freeze({
    browserCachePath: result.browserCachePath,
    browserExecutablePath: result.browserExecutablePath,
    browserExecutableRelativePath: result.browserExecutableRelativePath,
    externalNode: result.externalNode,
    playwrightPackageClosure: result.playwrightPackageClosure
  });
}

async function materializeIsolatedNodeModules(
  source: string,
  target: string,
  commitFence?: CommitFence
): Promise<void> {
  await commitFence?.();
  await fs.rm(target, { recursive: true, force: true });
  await copyPhysicalTrees({
    commitFence,
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
  } catch {
    return false;
  }
}

async function resolveProjectDependencyBridgeTarget(): Promise<string> {
  return dependencyAuthorityPaths().compilerModulesRoot;
}

export async function withProjectDependencyBridge<T>(projectRoot: string, callback: () => Promise<T>): Promise<T> {
  const bridgePath = path.join(projectRoot, 'node_modules');
  let createdBridge = false;

  if (!(await pathExists(bridgePath))) {
    await fs.symlink(await resolveProjectDependencyBridgeTarget(), bridgePath, 'junction');
    createdBridge = true;
  }

  try {
    return await callback();
  } finally {
    if (createdBridge) {
      await fs.rm(bridgePath, { recursive: true, force: true });
    }
  }
}

async function stageCompilerDependencyGeneration(
  root: string,
  identity: CompilerDependencyIdentity,
  options: RuntimeDependencyInstallOptions
): Promise<{ binding: CompilerDepsBinding; stagingRoot: string }> {
  const stagingParent = path.join(root, '.tmp', 'dependency-installs');
  await ensureDir(stagingParent, options.beforeCommit);
  await options.beforeCommit?.();
  const stagingRoot = await fs.mkdtemp(path.join(stagingParent, 'c.staging-'));
  try {
    const sourcePackagePath = path.join(root, 'package.json');
    const sourceLockPath = path.join(root, 'bun.lock');
    const stagedPackagePath = path.join(stagingRoot, 'package.json');
    const stagedLockPath = path.join(stagingRoot, 'bun.lock');
    const sourceInstallConfigPath = path.join(root, 'bunfig.toml');
    const stagedInstallConfigPath = path.join(stagingRoot, 'bunfig.toml');
    await options.beforeCommit?.();
    await Promise.all([
      fs.copyFile(sourcePackagePath, stagedPackagePath),
      fs.copyFile(sourceLockPath, stagedLockPath)
    ]);
    const [sourcePackageBytes, sourceLockBytes, stagedPackageBytes, stagedLockBytes] = await Promise.all([
      fs.readFile(sourcePackagePath),
      fs.readFile(sourceLockPath),
      fs.readFile(stagedPackagePath),
      fs.readFile(stagedLockPath)
    ]);
    if (digest(sourcePackageBytes) !== identity.packageSourceSha256 ||
      digest(sourceLockBytes) !== identity.lockSha256 ||
      digest(stagedPackageBytes) !== identity.packageSourceSha256 ||
      digest(stagedLockBytes) !== identity.lockSha256) {
      throw new CompilerError('IMPORT-AUTHORITY-001', 'Compiler dependency inputs changed before staging');
    }
    const installConfigBytes = await fs.readFile(sourceInstallConfigPath)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
    if (compilerInstallConfigSha256(installConfigBytes) !== identity.installConfigSha256) {
      throw new CompilerError('IMPORT-AUTHORITY-001', 'Compiler dependency install config changed before staging');
    }
    if (installConfigBytes !== null) {
      await options.beforeCommit?.();
      await fs.writeFile(stagedInstallConfigPath, installConfigBytes);
      if (compilerInstallConfigSha256(await fs.readFile(stagedInstallConfigPath)) !==
        identity.installConfigSha256) {
        throw new CompilerError('IMPORT-AUTHORITY-001', 'Compiler dependency install config staging failed');
      }
    }

    const cacheDir = path.join(root, '.shared-deps', '.bun-cache');
    const runtimeExecutable = await currentRuntimeExecutableIdentity(true);
    if (runtimeExecutable.path !== identity.bunExecutablePath ||
      runtimeExecutable.sha256 !== identity.bunExecutableSha256) {
      throw new CompilerError('IMPORT-AUTHORITY-001', 'Bun executable changed before dependency materialization');
    }
    await runBunInstall(stagingRoot, options, ['install', '--frozen-lockfile', '--ignore-scripts'], cacheDir);
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
    await writeJson(
      path.join(nodeModulesPath, COMPILER_DEPS_BINDING_FILE),
      binding,
      options.beforeCommit
    );
    return { binding, stagingRoot };
  } catch (error) {
    await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
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

async function retainOnlyLatestCompilerDependencyBackup(backupsRoot: string, retainedPath: string): Promise<void> {
  const entries = await fs.readdir(backupsRoot, { withFileTypes: true }).catch(() => []);
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && path.join(backupsRoot, entry.name) !== retainedPath)
    .map((entry) => fs.rm(path.join(backupsRoot, entry.name), { recursive: true, force: true }).catch(() => undefined)));
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
  options: RuntimeDependencyInstallOptions
): Promise<void> {
  const expectedSource = await compilerDependencyDirectoryIdentity(source);
  if (expectedSource === null) {
    throw new Error(`Compiler dependency generation source is unavailable: ${source}`);
  }
  if ((await compilerDependencyDirectoryIdentity(target)) !== null) {
    throw new Error(`Compiler dependency generation target already exists: ${target}`);
  }

  const rename = options.testCompilerRename ?? fs.rename;
  const hostPlatform = options.testCompilerPublishPlatform ?? process.platform;
  const sleep = options.sleep ?? sleepMs;
  for (let attempt = 1; attempt <= COMPILER_DEPENDENCY_RENAME_MAX_ATTEMPTS; attempt += 1) {
    await options.beforeCommit?.();
    const currentSource = await compilerDependencyDirectoryIdentity(source);
    const currentTarget = await compilerDependencyDirectoryIdentity(target);
    if (!sameCompilerDependencyDirectoryIdentity(currentSource, expectedSource) || currentTarget !== null) {
      throw new Error('Compiler dependency generation identity changed before publish');
    }
    try {
      await rename(source, target);
      return;
    } catch (error) {
      const sourceAfterFailure = await compilerDependencyDirectoryIdentity(source);
      const targetAfterFailure = await compilerDependencyDirectoryIdentity(target);
      if (sourceAfterFailure === null &&
        sameCompilerDependencyDirectoryIdentity(targetAfterFailure, expectedSource)) {
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
      await sleep(delayMs);
    }
  }
}

async function publishCompilerDependencyGeneration(
  root: string,
  activeNodeModulesPath: string,
  stagingRoot: string,
  options: RuntimeDependencyInstallOptions
): Promise<void> {
  const stagingNodeModulesPath = path.join(stagingRoot, 'node_modules');
  const backupsRoot = path.join(root, '.tmp', 'dependency-installs', 'compiler-backups');
  const backupPath = path.join(backupsRoot, `node_modules-${Date.now()}-${crypto.randomUUID()}`);
  let activeBackedUp = false;
  let published = false;
  await ensureDir(backupsRoot, options.beforeCommit);
  try {
    if (await pathExists(activeNodeModulesPath)) {
      await renameCompilerDependencyDirectory(activeNodeModulesPath, backupPath, options);
      activeBackedUp = true;
      await options.testCompilerPublishHook?.('active-backed-up');
    }
    await renameCompilerDependencyDirectory(stagingNodeModulesPath, activeNodeModulesPath, options);
    published = true;
  } catch (error) {
    let rollbackFailure: unknown;
    if (activeBackedUp && !(await pathExists(activeNodeModulesPath))) {
      try {
        await renameCompilerDependencyDirectory(backupPath, activeNodeModulesPath, options);
      } catch (rollbackError) {
        rollbackFailure = rollbackError;
      }
    }
    throw new CompilerError('IMPORT-AUTHORITY-004', 'Compiler dependency generation publish failed', {
      cause: error instanceof Error ? error.message : String(error),
      rollbackFailure: rollbackFailure instanceof Error ? rollbackFailure.message : rollbackFailure
    });
  } finally {
    await fs.rm(stagingRoot, { recursive: true, force: true }).catch(() => undefined);
  }
  if (published && activeBackedUp) {
    await retainOnlyLatestCompilerDependencyBackup(backupsRoot, backupPath);
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

export async function ensureCompilerDepsReady(
  options: RuntimeDependencyInstallOptions = {},
  compilerDependencyRoot = compilerRoot
): Promise<CompilerDepsReadyState> {
  const root = path.resolve(compilerDependencyRoot);
  const nodeModulesPath = dependencyAuthorityPaths(root).compilerModulesRoot;
  const bindingPath = path.join(nodeModulesPath, COMPILER_DEPS_BINDING_FILE);
  const installLockPath = path.join(root, '.tmp', 'dependency-installs', 'compiler.lock');

  const identity = await compilerDependencyIdentity(root);
  const bridgeBinding = await compilerDependencyConsumerBridgeBinding(
    root,
    nodeModulesPath,
    identity,
    options
  );
  if (bridgeBinding !== null) {
    return {
      manifestHash: identity.manifestHash,
      nodeModulesPath,
      packageManager: 'bun',
      root,
      runtimeMaterialization: bridgeBinding.runtimeMaterialization,
      source: 'existing'
    };
  }
  const ready = () => compilerDependencyGenerationBinding(
    root,
    nodeModulesPath,
    bindingPath,
    identity
  );

  const existing = await ready();
  if (existing !== null) {
    const readyState: CompilerDepsReadyState = {
      manifestHash: identity.manifestHash,
      nodeModulesPath,
      packageManager: 'bun',
      root,
      runtimeMaterialization: existing.runtimeMaterialization,
      source: 'existing'
    };
    return readyState;
  }

  return withInstallLock(installLockPath, options, async () => {
    const lockedExisting = await ready();
    if (lockedExisting !== null) {
      const readyState: CompilerDepsReadyState = {
        manifestHash: identity.manifestHash,
        nodeModulesPath,
        packageManager: 'bun' as const,
        root,
        runtimeMaterialization: lockedExisting.runtimeMaterialization,
        source: 'existing' as const
      };
      return readyState;
    }

    const staged = await stageCompilerDependencyGeneration(root, identity, options);
    await publishCompilerDependencyGeneration(root, nodeModulesPath, staged.stagingRoot, options);
    const published = await ready();
    if (published === null) {
      throw new CompilerError('IMPORT-AUTHORITY-002', 'Published compiler dependency generation failed validation');
    }

    const readyState: CompilerDepsReadyState = {
      manifestHash: identity.manifestHash,
      nodeModulesPath,
      packageManager: 'bun',
      root,
      runtimeMaterialization: published.runtimeMaterialization,
      source: 'installed'
    };
    return readyState;
  });
}

export async function ensureSharedDepsReady(
  options: RuntimeDependencyInstallOptions = {}
): Promise<SharedDepsReadyState> {
  const runtimeSpec = await loadRuntimeDependencySpec();
  const sharedDepsRoot = path.resolve(options.sharedDepsRoot ?? defaultSharedDepsRoot());
  const compilerDependencyRoot = path.resolve(compilerRoot);
  const sharedPackagePath = path.join(sharedDepsRoot, 'package.json');
  const sharedNodeModulesPath = path.join(sharedDepsRoot, 'node_modules');
  const sharedStampPath = path.join(sharedDepsRoot, 'runtime-deps.stamp.json');
  const sharedLockPath = path.join(sharedDepsRoot, 'install.lock');
  const manifest = buildRuntimePackageManifest('shared-runtime-deps', runtimeSpec);

  const observedRoot = await physicalSharedDependencyDirectory(sharedDepsRoot, true);
  if (observedRoot !== null) {
    await assertNoSharedDependencyAuthorityResidue(sharedDepsRoot);
    await assertPhysicalControlEntries([sharedPackagePath, sharedStampPath, sharedLockPath]);
  }
  const observedGeneration = observedRoot === null ? null : await sharedDependencyGenerationReady({
    compilerRoot: compilerDependencyRoot,
    manifest,
    nodeModulesPath: sharedNodeModulesPath,
    packagePath: sharedPackagePath,
    root: sharedDepsRoot,
    spec: runtimeSpec,
    stampPath: sharedStampPath
  });
  if (observedGeneration !== null) {
    return {
      binding: observedGeneration.binding,
      packageManager: observedGeneration.packageManager,
      root: sharedDepsRoot,
      nodeModulesPath: sharedNodeModulesPath,
      manifestHash: runtimeSpec.manifestHash
    };
  }

  const compilerReady = await ensureCompilerDepsReady(options, compilerDependencyRoot);
  const binding = compilerReady.runtimeMaterialization;
  if (binding === null || binding === undefined || binding.manifestHash !== runtimeSpec.manifestHash) {
    throw new CompilerError('RUNTIME-DEPS-002', 'Compiler dependency generation has no runtime closure');
  }

  const rootIdentity = await ensurePhysicalSharedDependencyRoot(sharedDepsRoot, options.beforeCommit);
  const rootFence = async (): Promise<void> => {
    await options.beforeCommit?.();
    await assertSharedDependencyRootIdentity(rootIdentity);
  };
  const authorityFence = async (): Promise<void> => {
    await rootFence();
    await assertNoSharedDependencyAuthorityResidue(sharedDepsRoot);
  };
  const lockedOptions: RuntimeDependencyInstallOptions = { ...options, beforeCommit: rootFence };

  return withInstallLock(sharedLockPath, lockedOptions, async () => {
    await authorityFence();
    await writeManifestIfChanged(sharedPackagePath, manifest, authorityFence);

    const lockedGeneration = await sharedDependencyGenerationReady({
      binding,
      compilerRoot: compilerDependencyRoot,
      manifest,
      nodeModulesPath: sharedNodeModulesPath,
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
        manifestHash: runtimeSpec.manifestHash
      };
    }

    const staged = await stageRuntimeDependencyProjection({
      binding,
      commitFence: authorityFence,
      sharedDepsRoot,
      sourceNodeModulesPath: compilerReady.nodeModulesPath
    });
    if (!await runtimeDependencyTreeMatchesBinding({
      expected: binding,
      nodeModulesPath: staged.nodeModulesPath,
      root: compilerDependencyRoot,
      runtimeSpec
    })) {
      await fs.rm(staged.root, { force: true, recursive: true }).catch(() => undefined);
      throw new CompilerError('RUNTIME-DEPS-002', 'Staged runtime dependency projection is incomplete');
    }
    await publishRuntimeDependencyProjection({
      activeNodeModulesPath: sharedNodeModulesPath,
      commitFence: authorityFence,
      options,
      stagingNodeModulesPath: staged.nodeModulesPath,
      stagingRoot: staged.root
    });
    await assertSharedDependencyMaterializationPostcondition({
      manifest,
      packagePath: sharedPackagePath,
      root: sharedDepsRoot
    });
    await writeRuntimeDepsStamp(sharedStampPath, {
      binding,
      formatVersion: 'runtime-deps-stamp-v3',
      manifestHash: runtimeSpec.manifestHash,
      packageManager: 'bun',
      installedAt: (options.now ?? (() => new Date().toISOString()))()
    }, authorityFence);

    if (await sharedDependencyGenerationReady({
      binding,
      compilerRoot: compilerDependencyRoot,
      manifest,
      nodeModulesPath: sharedNodeModulesPath,
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
      manifestHash: runtimeSpec.manifestHash
    };
  });
}

export async function ensureProjectDependencies(
  projectRoot: string,
  options: RuntimeDependencyInstallOptions = {}
): Promise<void> {
  const runtimeSpec = await loadRuntimeDependencySpec();
  const nodeModulesPath = path.join(projectRoot, 'node_modules');
  if (options.installMode === 'prebound-only') {
    await options.beforeCommit?.();
    const [binding, installed] = await Promise.all([
      readJson<unknown>(path.join(nodeModulesPath, RUNTIME_DEPS_PREBOUND_BINDING_FILE))
        .catch(() => null),
      hasCompleteRuntimeDeps(nodeModulesPath, runtimeSpec)
    ]);
    await options.beforeCommit?.();
    if (!installed || !isRuntimeDepsPreboundBinding(binding, runtimeSpec.manifestHash)) {
      throw new CompilerError(
        'RUNTIME-DEPS-004',
        'Plan-bound dependency tree is unavailable for isolated verification'
      );
    }
    return;
  }
  const isolated = options.installMode === 'offline-copy-only';
  const sharedDepsRoot = path.resolve(options.sharedDepsRoot ?? defaultSharedDepsRoot());
  const compilerDependencyRoot = path.resolve(compilerRoot);
  let sourceNodeModulesPath: string;
  let binding: Readonly<RuntimeDependencyMaterializationBinding>;

  if (isolated) {
    const sharedStamp = await readRuntimeDepsStamp(path.join(sharedDepsRoot, 'runtime-deps.stamp.json'));
    sourceNodeModulesPath = path.join(sharedDepsRoot, 'node_modules');
    if (sharedStamp === null || !await runtimeDependencyTreeMatchesBinding({
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
  } else if (options.skipSharedDepsWarmup === true) {
    const compilerIdentity = await compilerDependencyIdentity(compilerDependencyRoot);
    sourceNodeModulesPath = dependencyAuthorityPaths(compilerDependencyRoot).compilerModulesRoot;
    const compilerBindingPath = path.join(sourceNodeModulesPath, COMPILER_DEPS_BINDING_FILE);
    const compilerBinding = await compilerDependencyGenerationBinding(
      compilerDependencyRoot,
      sourceNodeModulesPath,
      compilerBindingPath,
      compilerIdentity
    );
    if (compilerBinding === null || compilerBinding.runtimeMaterialization === null) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Canonical compiler dependency generation is unavailable');
    }
    binding = compilerBinding.runtimeMaterialization;
  } else {
    const sharedDeps = await ensureSharedDepsReady(options);
    sourceNodeModulesPath = sharedDeps.nodeModulesPath;
    binding = sharedDeps.binding;
  }

  const stampPath = projectStampPath(projectRoot);
  await options.beforeCommit?.();
  const currentStamp = await readRuntimeDepsStamp(stampPath);
  const cacheReady = !options.rematerialize &&
    currentStamp?.binding.revision === binding.revision &&
    canonicalEquals(currentStamp.binding, binding) &&
    (isolated
      ? await runtimeDependencyTreeMatchesBinding({
        expected: binding,
        nodeModulesPath,
        root: compilerDependencyRoot,
        runtimeSpec
      })
      : await dependencyBridgeTargets(nodeModulesPath, sourceNodeModulesPath));
  await options.beforeCommit?.();
  if (cacheReady) {
    return;
  }

  // Minimal workspace templates intentionally defer the project scaffold; the
  // dependency bridge is still a physical surface this operation owns, so its
  // parent directory must exist before materialization.
  await ensureDir(projectRoot, options.beforeCommit);
  if (await pathExists(nodeModulesPath)) {
    await options.beforeCommit?.();
    await fs.rm(nodeModulesPath, { recursive: true, force: true });
  }

  if (isolated) {
    await materializeIsolatedNodeModules(sourceNodeModulesPath, nodeModulesPath, options.beforeCommit);
    if (!await runtimeDependencyTreeMatchesBinding({
      expected: binding,
      nodeModulesPath,
      root: compilerDependencyRoot,
      runtimeSpec
    })) {
      throw new CompilerError('RUNTIME-DEPS-004', 'Isolated dependency projection failed exact readback');
    }
    await writeRuntimeDepsStamp(stampPath, {
      binding,
      formatVersion: 'runtime-deps-stamp-v3',
      manifestHash: runtimeSpec.manifestHash,
      packageManager: 'bun',
      installedAt: (options.now ?? (() => new Date().toISOString()))()
    }, options.beforeCommit);
    return;
  }

  await options.beforeCommit?.();
  await fs.symlink(sourceNodeModulesPath, nodeModulesPath, 'junction');
  if (!await dependencyBridgeTargets(nodeModulesPath, sourceNodeModulesPath)) {
    throw new CompilerError('RUNTIME-DEPS-004', 'Project dependency bridge failed exact target readback');
  }
  await writeRuntimeDepsStamp(stampPath, {
    binding,
    formatVersion: 'runtime-deps-stamp-v3',
    manifestHash: runtimeSpec.manifestHash,
    packageManager: 'bun',
    installedAt: (options.now ?? (() => new Date().toISOString()))()
  }, options.beforeCommit);
}
