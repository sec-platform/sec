import fs from 'node:fs/promises';
import path from 'node:path';
import { canonicalEquals, compareCodeUnits, digest, uniqueSorted } from '../../../../contracts/canonical.ts';
import { SecError } from '../../../../contracts/failure.ts';
import { isPathInside } from '../../../../contracts/relative-path.ts';
import { isFileNotFoundError, readJson } from '../../../filesystem/files.ts';
import { loadCanonicalBunRuntimeVersion } from '../../runtime.ts';
import type { DependencyFreshnessLockObservation } from '../contract/dependency-freshness.ts';
import {
  buildRuntimeDependencyMaterializationBinding,
  isRuntimeDependencyMaterializationBinding,
  isRuntimeDependencyPackageManifest,
  isRuntimeDependencyPackageName,
  loadRuntimeDependencySpec,
  parseRuntimeDependencyPackageReference,
  RUNTIME_DEPENDENCY_PACKAGE_NAMES,
  type RuntimeDependencyMaterializationBinding,
  type RuntimeDependencyResolutionEdge,
  type RuntimeDependencyResolvedPackage,
  type RuntimeDependencySpec,
  type RuntimeDependencyToolchainBinding
} from '../contract/runtime-dependency-spec.ts';
import {
  compilerDependencyManifestAuthority,
  compilerInstallConfigSha256,
  currentRuntimeExecutableIdentity,
  type CompilerDependencyIdentity
} from './compiler-materialization-input.ts';
import { sameHostPath } from './host-path.ts';

/**
 * Observe installed package content against the compiler/runtime binding.
 * This read-only boundary owns manifest validation and the runtime closure;
 * project-runtime retains installation, leases, publication and retirement.
 * A matching binding is evidence, never a capability to keep or mutate a path.
 *
 * Bun remains the installer/resolver. Its installed graph is observed here,
 * rather than introducing another resolution registry. Native module loading
 * cannot replace this walk: it may follow links or resolve outside the retained
 * generation and applies entrypoint/export rules rather than manifest custody.
 * Compiler-only siblings are deliberately outside the runtime closure.
 */
interface CompilerDependencyPackageBinding {
  entry?: {
    path: string;
    sha256: string;
  };
  manifestSha256: string;
  name: string;
  version: string;
}

export interface CompilerDepsBinding {
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

export const COMPILER_DEPS_BINDING_FILE = '.sec-compiler-deps-binding-v5.json' as const;

function dependencyPackagePath(nodeModulesPath: string, packageName: string): string {
  return path.join(nodeModulesPath, ...packageName.split('/'), 'package.json');
}

const criticalCompilerDependencyEntries = new Set([
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

export async function compilerDependencyPackageBindings(
  nodeModulesPath: string,
  identity: CompilerDependencyIdentity
): Promise<readonly CompilerDependencyPackageBinding[]> {
  return Promise.all(uniqueSorted(identity.packageNames).map((packageName) => compilerDependencyPackageBinding(
    nodeModulesPath,
    packageName,
    identity.packageVersions[packageName] ?? '*'
  )));
}

export function compilerDependencyDirectRootResolution(
  binding: Readonly<CompilerDepsBinding>,
  identity: CompilerDependencyIdentity
): DependencyFreshnessLockObservation {
  const packageByDeclaredName = new Map(binding.packages.map((entry) => [entry.name, entry]));
  if (packageByDeclaredName.size !== identity.packageNames.length) {
    throw new SecError(
      'RUNTIME-DEPS-004',
      'Compiler dependency generation has no exact direct-root resolution'
    );
  }
  const entries = identity.packageNames.map((declaredName) => {
    const packageBinding = packageByDeclaredName.get(declaredName);
    const declaredReference = identity.packageVersions[declaredName];
    if (packageBinding === undefined || declaredReference === undefined) {
      throw new SecError(
        'RUNTIME-DEPS-004',
        `Compiler dependency direct root is absent from its binding: ${declaredName}`
      );
    }
    const expected = compilerDependencyManifestExpectation(declaredName, declaredReference);
    if (!isExactPackageVersion(packageBinding.version)) {
      throw new SecError(
        'RUNTIME-DEPS-004',
        `Compiler dependency direct root has no exact resolved version: ${declaredName}`
      );
    }
    return Object.freeze({
      declaredName,
      packageName: expected.name,
      resolvedVersion: packageBinding.version
    });
  });
  return Object.freeze({
    entries: Object.freeze(entries),
    lockDigest: `sha256:${binding.lockSha256}` as const
  });
}

export const COMPILER_DEPS_BINDING_KEYS = Object.freeze([
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

export async function readCompilerDepsBinding(bindingPath: string): Promise<CompilerDepsBinding | null> {
  let value: unknown;
  try {
    value = await readJson<unknown>(bindingPath);
  } catch (error) {
    if (isFileNotFoundError(error) || error instanceof SyntaxError) return null;
    throw error;
  }
  return isCompilerDepsBinding(value) ? value : null;
}

export function compilerDependencyBindingMatchesIdentity(
  binding: Readonly<CompilerDepsBinding>,
  identity: CompilerDependencyIdentity
): boolean {
  return binding.architecture === identity.architecture &&
    binding.bunExecutablePath === identity.bunExecutablePath &&
    binding.bunExecutableSha256 === identity.bunExecutableSha256 &&
    binding.bunVersion === identity.bunVersion &&
    binding.declaredBunVersion === identity.declaredBunVersion &&
    binding.dependencyManifestSha256 === identity.dependencyManifestSha256 &&
    binding.installConfigSha256 === identity.installConfigSha256 &&
    binding.lockSha256 === identity.lockSha256 &&
    binding.manifestHash === identity.manifestHash &&
    binding.platform === identity.platform;
}

export async function compilerDependencyGenerationBinding(
  root: string,
  nodeModulesPath: string,
  bindingPath: string,
  identity: CompilerDependencyIdentity
): Promise<Readonly<CompilerDepsBinding> | null> {
  const binding = await readCompilerDepsBinding(bindingPath);
  if (binding === null) return null;
  if (!compilerDependencyBindingMatchesIdentity(binding, identity)) return null;
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

export async function compilerRuntimeMaterializationBinding(
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

export async function hasCompleteRuntimeDeps(
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
  const handle = await fs.open(packageJsonPath, 'r');
  try {
    const opened = await handle.stat({ bigint: true });
    const metadata = await fs.lstat(packageJsonPath, { bigint: true });
    const physicalPath = await fs.realpath(packageJsonPath);
    if (!opened.isFile() || !metadata.isFile() || metadata.isSymbolicLink()
      || opened.dev !== metadata.dev || opened.ino !== metadata.ino
      || opened.mode !== metadata.mode
      || !sameHostPath(physicalPath, packageJsonPath)) {
      throw new SecError('RUNTIME-DEPS-002', 'Runtime dependency package manifest is not one stable physical file');
    }
    const bytes = await handle.readFile();
    const [afterHandle, afterPath] = await Promise.all([
      handle.stat({ bigint: true }),
      fs.lstat(packageJsonPath, { bigint: true })
    ]);
    if (opened.dev !== afterHandle.dev || opened.ino !== afterHandle.ino
      || opened.mode !== afterHandle.mode || opened.size !== afterHandle.size
      || opened.mtimeNs !== afterHandle.mtimeNs
      || afterPath.dev !== opened.dev || afterPath.ino !== opened.ino
      || afterPath.mode !== opened.mode || afterPath.size !== opened.size
      || afterPath.mtimeNs !== opened.mtimeNs) {
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
  } finally {
    await handle.close();
  }
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
    // An immutable compiler generation is itself the package container even
    // though its durable leaf is `generation-<epoch>` rather than
    // `node_modules`.  Package resolution must therefore derive the root
    // container from the retained authority, not from its presentation name.
    // Nested package containers still use their real `node_modules` leaf.
    const candidate = sameHostPath(cursor, modulesRoot) ||
      path.basename(cursor).toLocaleLowerCase('en-US') === 'node_modules'
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

export async function runtimeDependencyTreeMatchesBinding(input: Readonly<{
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
