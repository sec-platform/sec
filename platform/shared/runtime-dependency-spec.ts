import path from 'node:path';
import {
  canonicalEquals,
  canonicalJson,
  compareCodeUnits,
  deepFreeze,
  digest,
  sortedKeys
} from './canonical-primitives.ts';
import { CompilerError } from './errors.ts';
import { readJson } from './fs.ts';
import { compilerRoot } from './paths.ts';

export interface RootPackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export interface RuntimeDependencySpec {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  manifestHash: string;
}

export interface RuntimePackageManifest {
  name: string;
  private: true;
  type: 'module';
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
}

export const RUNTIME_DEPENDENCY_MATERIALIZATION_FORMAT =
  'sec-runtime-dependency-materialization-v1' as const;

export type RuntimeDependencyResolutionEdgeKind = 'dependency' | 'optional' | 'peer';

export interface RuntimeDependencyResolutionEdge {
  readonly kind: RuntimeDependencyResolutionEdgeKind;
  readonly name: string;
  readonly target: string;
}

export interface RuntimeDependencyResolvedPackage {
  readonly edges: readonly Readonly<RuntimeDependencyResolutionEdge>[];
  readonly manifestSha256: string;
  readonly name: string;
  readonly relativePath: string;
  readonly version: string;
}

export interface RuntimeDependencyToolchainBinding {
  readonly architecture: string;
  readonly bunExecutablePath: string;
  readonly bunExecutableSha256: string;
  readonly bunVersion: string;
  readonly canonicalBunVersion: string;
  readonly compilerGenerationRevision: string;
  readonly declaredBunVersion: string;
  readonly installConfigSha256: string | null;
  readonly lockSha256: string;
  readonly packageManifestSha256: string;
  readonly platform: string;
}

export interface RuntimeDependencyMaterializationBinding {
  readonly formatVersion: typeof RUNTIME_DEPENDENCY_MATERIALIZATION_FORMAT;
  readonly manifestHash: string;
  readonly packages: readonly Readonly<RuntimeDependencyResolvedPackage>[];
  readonly revision: `sha256:${string}`;
  readonly rootPackages: readonly Readonly<{ readonly name: string; readonly target: string }>[];
  readonly toolchain: Readonly<RuntimeDependencyToolchainBinding>;
}

export type RuntimeDependencyMaterializationBindingInput = Readonly<{
  manifestHash: string;
  packages: readonly Readonly<RuntimeDependencyResolvedPackage>[];
  rootPackages: readonly Readonly<{ readonly name: string; readonly target: string }>[];
  toolchain: Readonly<RuntimeDependencyToolchainBinding>;
}>;

export const RUNTIME_DEPS_PREBOUND_BINDING_FORMAT = 'runtime-deps-prebound-binding-v1' as const;
export const RUNTIME_DEPS_PREBOUND_BINDING_FILE = '.sec-runtime-deps-binding-v1.json' as const;

export interface RuntimeDepsPreboundBinding {
  readonly formatVersion: typeof RUNTIME_DEPS_PREBOUND_BINDING_FORMAT;
  readonly manifestHash: string;
}

const runtimeDependencyKeys = ['next', 'react', 'react-dom', 'yaml'] as const;
const runtimeDevDependencyKeys = [
  '@playwright/test',
  '@types/bun',
  '@types/node',
  '@types/react',
  '@types/react-dom',
  'ts-morph',
  'typescript'
] as const;

const exactNumericReleasePattern = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;

export const EXACT_PLAYWRIGHT_PACKAGE_NAMES = Object.freeze([
  '@playwright/test',
  'playwright',
  'playwright-core'
] as const);

export type ExactPlaywrightPackageName = (typeof EXACT_PLAYWRIGHT_PACKAGE_NAMES)[number];

export interface ExactPlaywrightPackageClosure {
  readonly packages: readonly Readonly<{
    readonly name: ExactPlaywrightPackageName;
    readonly version: string;
  }>[];
  readonly release: string;
}

export interface ExactPlaywrightPackageAuthority {
  readonly packages: readonly Readonly<{
    readonly manifestSha256: string;
    readonly name: ExactPlaywrightPackageName;
    readonly version: string;
  }>[];
  readonly release: string;
  readonly revision: string;
}

export const RUNTIME_DEPENDENCY_PACKAGE_NAMES: readonly string[] = Object.freeze([
  ...runtimeDependencyKeys,
  ...runtimeDevDependencyKeys
]);

const sha256DigestPattern = /^[a-f0-9]{64}$/u;
const packageNamePattern = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/iu;

export function isRuntimeDependencyPackageName(value: unknown): value is string {
  if (typeof value !== 'string' || !packageNamePattern.test(value)) return false;
  return value.split('/').every((segment) => segment !== '.' && segment !== '..');
}

function materializationBindingError(message: string): never {
  throw new CompilerError('RUNTIME-DEPS-000', message);
}

function canonicalPackagePath(value: string, label: string): string {
  const slashPath = value.replaceAll('\\', '/');
  const normalized = path.posix.normalize(slashPath);
  if (!value || normalized === '.' || normalized === '..' || normalized.startsWith('../') ||
    path.posix.isAbsolute(normalized) || normalized.includes('\0') || normalized !== slashPath) {
    materializationBindingError(`${label} must be one canonical relative package path`);
  }
  return normalized;
}

function canonicalPackageName(value: string, label: string): string {
  if (!isRuntimeDependencyPackageName(value)) {
    materializationBindingError(`${label} must be one canonical package name`);
  }
  return value;
}

function canonicalDigest(value: string, label: string): string {
  if (!sha256DigestPattern.test(value)) {
    materializationBindingError(`${label} must be one raw SHA-256 digest`);
  }
  return value;
}

function canonicalNonEmpty(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) {
    materializationBindingError(`${label} must be one non-empty canonical string`);
  }
  return value;
}

function canonicalRuntimeToolchainBinding(
  input: RuntimeDependencyToolchainBinding
): Readonly<RuntimeDependencyToolchainBinding> {
  const bunExecutablePath = path.normalize(canonicalNonEmpty(
    input.bunExecutablePath,
    'Runtime dependency Bun executable path'
  ));
  if (!path.isAbsolute(bunExecutablePath)) {
    materializationBindingError('Runtime dependency Bun executable path must be absolute');
  }
  const bunVersion = canonicalNonEmpty(input.bunVersion, 'Runtime dependency Bun version');
  const canonicalBunVersion = canonicalNonEmpty(
    input.canonicalBunVersion,
    'Runtime dependency canonical Bun version'
  );
  const declaredBunVersion = canonicalNonEmpty(
    input.declaredBunVersion,
    'Runtime dependency declared Bun version'
  );
  if (!exactNumericReleasePattern.test(canonicalBunVersion)) {
    materializationBindingError('Runtime dependency Bun version must be one exact numeric release');
  }
  if (bunVersion !== canonicalBunVersion || declaredBunVersion !== canonicalBunVersion) {
    materializationBindingError('Runtime dependency Bun identities must be exactly equal');
  }
  return Object.freeze({
    architecture: canonicalNonEmpty(input.architecture, 'Runtime dependency architecture'),
    bunExecutablePath,
    bunExecutableSha256: canonicalDigest(
      input.bunExecutableSha256,
      'Runtime dependency Bun executable digest'
    ),
    bunVersion,
    canonicalBunVersion,
    compilerGenerationRevision: canonicalDigest(
      input.compilerGenerationRevision,
      'Runtime dependency compiler generation revision'
    ),
    declaredBunVersion,
    installConfigSha256: input.installConfigSha256 === null
      ? null
      : canonicalDigest(input.installConfigSha256, 'Runtime dependency install config digest'),
    lockSha256: canonicalDigest(input.lockSha256, 'Runtime dependency lock digest'),
    packageManifestSha256: canonicalDigest(
      input.packageManifestSha256,
      'Runtime dependency package manifest digest'
    ),
    platform: canonicalNonEmpty(input.platform, 'Runtime dependency platform')
  });
}

function canonicalResolutionEdge(
  input: RuntimeDependencyResolutionEdge
): Readonly<RuntimeDependencyResolutionEdge> {
  if (!['dependency', 'optional', 'peer'].includes(input.kind)) {
    materializationBindingError('Runtime dependency edge kind is unsupported');
  }
  return Object.freeze({
    kind: input.kind,
    name: canonicalPackageName(input.name, 'Runtime dependency edge name'),
    target: canonicalPackagePath(input.target, 'Runtime dependency edge target')
  });
}

function edgeKey(edge: RuntimeDependencyResolutionEdge): string {
  return `${edge.name}\0${edge.kind}\0${edge.target}`;
}

function canonicalResolvedPackage(
  input: RuntimeDependencyResolvedPackage
): Readonly<RuntimeDependencyResolvedPackage> {
  const edges = input.edges.map(canonicalResolutionEdge)
    .sort((left, right) => compareCodeUnits(edgeKey(left), edgeKey(right)));
  for (let index = 1; index < edges.length; index += 1) {
    if (edges[index - 1]!.name === edges[index]!.name) {
      materializationBindingError('Runtime dependency package edge names must be unique');
    }
  }
  return Object.freeze({
    edges: Object.freeze(edges),
    manifestSha256: canonicalDigest(
      input.manifestSha256,
      'Runtime dependency package manifest digest'
    ),
    name: canonicalPackageName(input.name, 'Runtime dependency package name'),
    relativePath: canonicalPackagePath(
      input.relativePath,
      'Runtime dependency package location'
    ),
    version: canonicalNonEmpty(input.version, 'Runtime dependency package version')
  });
}

export function buildRuntimeDependencyMaterializationBinding(
  input: RuntimeDependencyMaterializationBindingInput
): Readonly<RuntimeDependencyMaterializationBinding> {
  const manifestHash = canonicalDigest(input.manifestHash, 'Runtime dependency manifest digest');
  const packages = input.packages.map(canonicalResolvedPackage)
    .sort((left, right) => compareCodeUnits(left.relativePath, right.relativePath));
  const packagesByPath = new Map<string, Readonly<RuntimeDependencyResolvedPackage>>();
  for (const packageIdentity of packages) {
    if (packagesByPath.has(packageIdentity.relativePath)) {
      materializationBindingError('Runtime dependency package locations must be unique');
    }
    packagesByPath.set(packageIdentity.relativePath, packageIdentity);
  }
  const rootPackages = input.rootPackages.map((entry) => Object.freeze({
    name: canonicalPackageName(entry.name, 'Runtime dependency root package name'),
    target: canonicalPackagePath(entry.target, 'Runtime dependency root package target')
  })).sort((left, right) => compareCodeUnits(left.name, right.name));
  const expectedRoots = [...RUNTIME_DEPENDENCY_PACKAGE_NAMES].sort(compareCodeUnits);
  if (rootPackages.length !== expectedRoots.length ||
    rootPackages.some((entry, index) => entry.name !== expectedRoots[index])) {
    materializationBindingError('Runtime dependency root package closure is incomplete');
  }
  for (const rootPackage of rootPackages) {
    if (packagesByPath.get(rootPackage.target)?.name !== rootPackage.name) {
      materializationBindingError('Runtime dependency root package target is invalid');
    }
  }
  for (const packageIdentity of packages) {
    for (const edge of packageIdentity.edges) {
      if (!packagesByPath.has(edge.target)) {
        materializationBindingError('Runtime dependency edge target is absent from the closure');
      }
    }
  }
  const reachable = new Set<string>();
  const visit = (target: string): void => {
    if (reachable.has(target)) return;
    reachable.add(target);
    for (const edge of packagesByPath.get(target)?.edges ?? []) visit(edge.target);
  };
  for (const rootPackage of rootPackages) visit(rootPackage.target);
  if (reachable.size !== packages.length) {
    materializationBindingError('Runtime dependency closure contains an unreachable package');
  }
  const toolchain = canonicalRuntimeToolchainBinding(input.toolchain);
  const content = {
    formatVersion: RUNTIME_DEPENDENCY_MATERIALIZATION_FORMAT,
    manifestHash,
    packages: Object.freeze(packages),
    rootPackages: Object.freeze(rootPackages),
    toolchain
  } as const;
  return deepFreeze({
    ...content,
    revision: `sha256:${digest(JSON.stringify(canonicalJson(content)))}` as const
  });
}

export function isRuntimeDependencyMaterializationBinding(
  value: unknown
): value is Readonly<RuntimeDependencyMaterializationBinding> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<RuntimeDependencyMaterializationBinding>;
  if (candidate.formatVersion !== RUNTIME_DEPENDENCY_MATERIALIZATION_FORMAT ||
    typeof candidate.manifestHash !== 'string' ||
    !Array.isArray(candidate.packages) ||
    !Array.isArray(candidate.rootPackages) ||
    !candidate.toolchain || typeof candidate.toolchain !== 'object' ||
    typeof candidate.revision !== 'string') return false;
  try {
    const canonical = buildRuntimeDependencyMaterializationBinding({
      manifestHash: candidate.manifestHash,
      packages: candidate.packages as RuntimeDependencyResolvedPackage[],
      rootPackages: candidate.rootPackages as { name: string; target: string }[],
      toolchain: candidate.toolchain as RuntimeDependencyToolchainBinding
    });
    return canonicalEquals(value, canonical);
  } catch {
    return false;
  }
}

export function isRuntimeDependencyPackageManifest(
  value: unknown,
  expectedName: string
): value is Readonly<{ readonly name: string; readonly version: string }> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const manifest = value as { readonly name?: unknown; readonly version?: unknown };
  return manifest.name === expectedName && typeof manifest.version === 'string' &&
    manifest.version.length > 0;
}

export function buildExactPlaywrightPackageClosure(
  manifests: Readonly<Partial<Record<ExactPlaywrightPackageName, unknown>>>,
  expectedRelease: string
): Readonly<ExactPlaywrightPackageClosure> {
  if (!exactNumericReleasePattern.test(expectedRelease)) {
    throw new CompilerError(
      'RUNTIME-DEPS-000',
      'Playwright package closure requires one exact numeric release'
    );
  }
  const packages = EXACT_PLAYWRIGHT_PACKAGE_NAMES.map((name) => {
    const manifest = manifests[name];
    if (!isRuntimeDependencyPackageManifest(manifest, name) ||
      manifest.version !== expectedRelease) {
      throw new CompilerError(
        'RUNTIME-DEPS-000',
        `Playwright package "${name}" must exactly match release ${expectedRelease}`
      );
    }
    return Object.freeze({ name, version: manifest.version });
  });
  return Object.freeze({
    packages: Object.freeze(packages),
    release: expectedRelease
  });
}

export function buildExactPlaywrightPackageAuthority(
  identities: readonly Readonly<{
    readonly manifestSha256: string;
    readonly name: ExactPlaywrightPackageName;
    readonly version: string;
  }>[],
  expectedRelease: string
): Readonly<ExactPlaywrightPackageAuthority> {
  if (!Array.isArray(identities) || identities.length !== EXACT_PLAYWRIGHT_PACKAGE_NAMES.length) {
    throw new CompilerError('RUNTIME-DEPS-000', 'Playwright package authority is incomplete');
  }
  const byName = new Map<ExactPlaywrightPackageName, (typeof identities)[number]>();
  for (const identity of identities) {
    if (!identity || typeof identity !== 'object' ||
      !EXACT_PLAYWRIGHT_PACKAGE_NAMES.includes(identity.name) ||
      byName.has(identity.name) ||
      typeof identity.manifestSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(identity.manifestSha256)) {
      throw new CompilerError('RUNTIME-DEPS-000', 'Playwright package authority is non-canonical');
    }
    byName.set(identity.name, identity);
  }
  const closure = buildExactPlaywrightPackageClosure(
    Object.fromEntries([...byName].map(([name, identity]) => [name, identity])),
    expectedRelease
  );
  const packages = Object.freeze(closure.packages.map((identity) => {
    const authorityIdentity = byName.get(identity.name)!;
    return Object.freeze({
      manifestSha256: authorityIdentity.manifestSha256,
      name: identity.name,
      version: identity.version
    });
  }));
  const release = closure.release;
  return Object.freeze({
    packages,
    release,
    revision: `sha256:${stableHash({
      domain: 'playwright-package-authority-v1',
      packages,
      release
    })}`
  });
}

export function isExactPlaywrightPackageAuthority(
  value: unknown
): value is Readonly<ExactPlaywrightPackageAuthority> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Partial<ExactPlaywrightPackageAuthority>;
  if (!Array.isArray(candidate.packages) ||
    typeof candidate.release !== 'string' ||
    typeof candidate.revision !== 'string') return false;
  try {
    const canonical = buildExactPlaywrightPackageAuthority(
      candidate.packages as ExactPlaywrightPackageAuthority['packages'],
      candidate.release
    );
    return canonicalEquals(value, canonical);
  } catch {
    return false;
  }
}

function resolveVersion(rootPackage: RootPackageJson, dependencyName: string): string {
  const version = rootPackage.dependencies?.[dependencyName] ?? rootPackage.devDependencies?.[dependencyName];
  if (!version) {
    throw new CompilerError(
      'RUNTIME-DEPS-000',
      `Root package.json is missing required runtime dependency "${dependencyName}"`
    );
  }
  if (!exactNumericReleasePattern.test(version)) {
    throw new CompilerError(
      'RUNTIME-DEPS-000',
      `Root package.json must pin runtime dependency "${dependencyName}" to one exact numeric release`
    );
  }
  return version;
}

function stableHash(value: unknown): string {
  return digest(JSON.stringify(value));
}

export function buildRuntimeDependencySpec(rootPackage: RootPackageJson): RuntimeDependencySpec {
  const dependencies = Object.fromEntries(
    runtimeDependencyKeys.map((dependencyName) => [dependencyName, resolveVersion(rootPackage, dependencyName)])
  );
  const devDependencies = Object.fromEntries(
    runtimeDevDependencyKeys.map((dependencyName) => {
      const version = resolveVersion(rootPackage, dependencyName);
      return [dependencyName, version];
    })
  );

  return {
    dependencies,
    devDependencies,
    manifestHash: stableHash({ dependencies, devDependencies })
  };
}

export function buildRuntimeDepsPreboundBinding(
  spec: RuntimeDependencySpec
): RuntimeDepsPreboundBinding {
  return Object.freeze({
    formatVersion: RUNTIME_DEPS_PREBOUND_BINDING_FORMAT,
    manifestHash: spec.manifestHash
  });
}

export function encodeRuntimeDepsPreboundBinding(spec: RuntimeDependencySpec): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(buildRuntimeDepsPreboundBinding(spec))}\n`);
}

export function isRuntimeDepsPreboundBinding(
  value: unknown,
  expectedManifestHash: string
): value is RuntimeDepsPreboundBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = sortedKeys(record);
  return keys.length === 2 && keys[0] === 'formatVersion' && keys[1] === 'manifestHash' &&
    record.formatVersion === RUNTIME_DEPS_PREBOUND_BINDING_FORMAT &&
    record.manifestHash === expectedManifestHash;
}

export async function loadRuntimeDependencySpec(
  packageJsonPath = path.join(compilerRoot, 'package.json')
): Promise<RuntimeDependencySpec> {
  const rootPackage = await readJson<RootPackageJson>(packageJsonPath);
  return buildRuntimeDependencySpec(rootPackage);
}

export function buildRuntimePackageManifest(
  name: string,
  spec: RuntimeDependencySpec
): RuntimePackageManifest {
  return {
    name,
    private: true,
    type: 'module',
    dependencies: { ...spec.dependencies },
    devDependencies: { ...spec.devDependencies }
  };
}
