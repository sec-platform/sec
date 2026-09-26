import path from 'node:path';
import { canonicalEquals, canonicalJson, compareCodeUnits, deepFreeze, rawSha256Hex, sortedKeys } from '../../../../contracts/canonical.ts';
import { FailureError } from '../../../../contracts/failure.ts';
import { readOptionalRetainedJson } from '../../../runtime-state/physical/runtime/retained-file-read.ts';
import { compilerRoot } from "../../../workspace-context.ts";
import { generatedRuntimeDependencyCapabilityNames } from './dependency-capability-contract.ts';

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

const RUNTIME_DEPENDENCY_MATERIALIZATION_FORMAT =
  'sec-runtime-dependency-materialization-v3' as const;

const LEGACY_RUNTIME_DEPENDENCY_MATERIALIZATION_FORMAT =
  'sec-runtime-dependency-materialization-v2' as const;

/**
 * Frozen input grammar for the one-way v2 -> v3 dependency-generation
 * recovery.  It is intentionally not accepted by current readiness or by the
 * normal materialization builder.  Once the dependency owner replaces the
 * exact legacy generation, no production reader retains v2 compatibility.
 */
export interface LegacyRuntimeDependencyMaterializationBinding {
  readonly formatVersion: typeof LEGACY_RUNTIME_DEPENDENCY_MATERIALIZATION_FORMAT;
  readonly manifestHash: string;
  readonly packages: readonly Readonly<RuntimeDependencyResolvedPackage>[];
  readonly revision: `sha256:${string}`;
  readonly rootPackages: readonly Readonly<{ readonly name: string; readonly target: string }>[];
  readonly toolchain: Readonly<RuntimeDependencyToolchainBinding>;
}

type RuntimeDependencyResolutionEdgeKind = 'dependency' | 'optional' | 'peer';

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
  readonly dependencyManifestSha256: string;
  readonly installConfigSha256: string | null;
  readonly lockSha256: string;
  readonly platform: string;
}

export interface RuntimeDependencyMaterializationBinding {
  readonly formatVersion: typeof RUNTIME_DEPENDENCY_MATERIALIZATION_FORMAT;
  readonly manifestHash: string;
  readonly packages: readonly Readonly<RuntimeDependencyResolvedPackage>[];
  readonly revision: `sha256:${string}`;
  readonly rootPackages: readonly Readonly<{
    readonly name: string;
    readonly packageName: string;
    readonly target: string;
  }>[];
  readonly toolchain: Readonly<RuntimeDependencyToolchainBinding>;
}

export type RuntimeDependencyMaterializationBindingInput = Readonly<{
  manifestHash: string;
  packages: readonly Readonly<RuntimeDependencyResolvedPackage>[];
  rootPackages: readonly Readonly<{
    readonly name: string;
    readonly packageName: string;
    readonly target: string;
  }>[];
  toolchain: Readonly<RuntimeDependencyToolchainBinding>;
}>;

const RUNTIME_DEPS_PREBOUND_BINDING_FORMAT = 'runtime-deps-prebound-binding-v1' as const;
export const RUNTIME_DEPS_PREBOUND_BINDING_FILE = '.sec-runtime-deps-binding.json' as const;
export const LEGACY_RUNTIME_DEPS_PREBOUND_BINDING_FILE = '.sec-runtime-deps-binding-v1.json' as const;

export interface RuntimeDepsPreboundBinding {
  readonly formatVersion: typeof RUNTIME_DEPS_PREBOUND_BINDING_FORMAT;
  readonly manifestHash: string;
}

const runtimeDependencyKeys = generatedRuntimeDependencyCapabilityNames('dependency');
const runtimeDevDependencyKeys = generatedRuntimeDependencyCapabilityNames('devDependency');

// This is historical schema grammar, not the current dependency capability
// registry.  v2 was published before the aliased native TypeScript checker
// joined the runtime root set; deriving these names from the current registry
// would silently reinterpret immutable legacy bytes.
const legacyRuntimeDependencyPackageNames = Object.freeze([
  '@types/bun',
  '@types/node',
  'ts-morph',
  'typescript',
  'yaml'
] as const);

const exactNumericReleasePattern = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/u;
const exactNpmPackageNamePattern = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u;

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

export function parseRuntimeDependencyPackageReference(
  declaredName: string,
  reference: string
): Readonly<{ packageName: string; version: string }> | null {
  if (!isRuntimeDependencyPackageName(declaredName)) return null;
  if (exactNumericReleasePattern.test(reference)) {
    return Object.freeze({ packageName: declaredName, version: reference });
  }
  if (!reference.startsWith('npm:')) return null;
  const target = reference.slice(4);
  const versionSeparator = target.lastIndexOf('@');
  if (versionSeparator <= 0) return null;
  const packageName = target.slice(0, versionSeparator);
  const version = target.slice(versionSeparator + 1);
  if (!exactNpmPackageNamePattern.test(packageName) || !exactNumericReleasePattern.test(version)) {
    return null;
  }
  return Object.freeze({ packageName, version });
}

function materializationBindingError(message: string): never {
  throw new FailureError('RUNTIME-DEPS-000', message);
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
    dependencyManifestSha256: canonicalDigest(
      input.dependencyManifestSha256,
      'Runtime dependency manifest authority digest'
    ),
    installConfigSha256: input.installConfigSha256 === null
      ? null
      : canonicalDigest(input.installConfigSha256, 'Runtime dependency install config digest'),
    lockSha256: canonicalDigest(input.lockSha256, 'Runtime dependency lock digest'),
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

function canonicalRuntimeDependencyMaterializationBinding(
  input: RuntimeDependencyMaterializationBindingInput,
  expectedRootNames: readonly string[] | null
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
    packageName: canonicalPackageName(
      entry.packageName,
      'Runtime dependency resolved root package name'
    ),
    target: canonicalPackagePath(entry.target, 'Runtime dependency root package target')
  })).sort((left, right) => compareCodeUnits(left.name, right.name));
  if (rootPackages.length === 0 || rootPackages.length > 10_000 ||
      rootPackages.some((entry, index) => index > 0 && entry.name === rootPackages[index - 1]!.name)) {
    materializationBindingError('Runtime dependency root package identities must be non-empty and unique');
  }
  if (expectedRootNames !== null) {
    const expectedRoots = [...expectedRootNames].sort(compareCodeUnits);
    if (rootPackages.length !== expectedRoots.length ||
      rootPackages.some((entry, index) => entry.name !== expectedRoots[index])) {
      materializationBindingError('Runtime dependency root package closure is incomplete');
    }
  }
  if (packages.length === 0 || packages.length > 100_000) {
    materializationBindingError('Runtime dependency root package closure is incomplete');
  }
  for (const rootPackage of rootPackages) {
    if (packagesByPath.get(rootPackage.target)?.name !== rootPackage.packageName) {
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
    revision: `sha256:${rawSha256Hex(JSON.stringify(canonicalJson(content)))}` as const
  });
}

/**
 * The writer owns the current runtime root selection. Durable v3 bytes do not:
 * a later capability retirement must not silently change the grammar of an
 * already-published binding. Current readiness is checked separately against
 * the current RuntimeDependencySpec and exact observed tree.
 */
export function buildRuntimeDependencyMaterializationBinding(
  input: RuntimeDependencyMaterializationBindingInput
): Readonly<RuntimeDependencyMaterializationBinding> {
  return canonicalRuntimeDependencyMaterializationBinding(
    input,
    RUNTIME_DEPENDENCY_PACKAGE_NAMES
  );
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
    const canonical = canonicalRuntimeDependencyMaterializationBinding({
      manifestHash: candidate.manifestHash,
      packages: candidate.packages as RuntimeDependencyResolvedPackage[],
      rootPackages: candidate.rootPackages as { name: string; packageName: string; target: string }[],
      toolchain: candidate.toolchain as RuntimeDependencyToolchainBinding
    }, null);
    return canonicalEquals(value, canonical);
  } catch {
    return false;
  }
}

/**
 * Parse exactly one immutable v2 materialization binding for dependency-owner
 * recovery.  Returning null is a typed grammar mismatch; callers must preserve
 * the physical generation.  Normal readiness must continue to call only
 * isRuntimeDependencyMaterializationBinding(), which is v3-only.
 */
export function parseLegacyRuntimeDependencyMaterializationForRecovery(
  value: unknown
): Readonly<LegacyRuntimeDependencyMaterializationBinding> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return null;
  const candidate = value as Partial<LegacyRuntimeDependencyMaterializationBinding>;
  if (candidate.formatVersion !== LEGACY_RUNTIME_DEPENDENCY_MATERIALIZATION_FORMAT ||
      typeof candidate.manifestHash !== 'string' || !Array.isArray(candidate.packages) ||
      !Array.isArray(candidate.rootPackages) || candidate.toolchain === null ||
      typeof candidate.toolchain !== 'object' || typeof candidate.revision !== 'string') return null;
  try {
    const manifestHash = canonicalDigest(candidate.manifestHash, 'Legacy runtime dependency manifest digest');
    const packages = candidate.packages.map(canonicalResolvedPackage)
      .sort((left, right) => compareCodeUnits(left.relativePath, right.relativePath));
    const packagesByPath = new Map<string, Readonly<RuntimeDependencyResolvedPackage>>();
    for (const packageIdentity of packages) {
      if (packagesByPath.has(packageIdentity.relativePath)) return null;
      packagesByPath.set(packageIdentity.relativePath, packageIdentity);
    }
    const rootPackages = candidate.rootPackages.map((entry) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry) ||
          Object.getPrototypeOf(entry) !== Object.prototype ||
          Object.keys(entry).sort(compareCodeUnits).join('\0') !== ['name', 'target'].join('\0')) {
        materializationBindingError('Legacy runtime dependency root package is malformed');
      }
      return Object.freeze({
        name: canonicalPackageName(entry.name, 'Legacy runtime dependency root package name'),
        target: canonicalPackagePath(entry.target, 'Legacy runtime dependency root package target')
      });
    }).sort((left, right) => compareCodeUnits(left.name, right.name));
    if (rootPackages.length !== legacyRuntimeDependencyPackageNames.length ||
        rootPackages.some((entry, index) => entry.name !== legacyRuntimeDependencyPackageNames[index])) {
      return null;
    }
    for (const rootPackage of rootPackages) {
      if (packagesByPath.get(rootPackage.target)?.name !== rootPackage.name) return null;
    }
    for (const packageIdentity of packages) {
      for (const edge of packageIdentity.edges) {
        if (!packagesByPath.has(edge.target)) return null;
      }
    }
    const reachable = new Set<string>();
    const visit = (target: string): void => {
      if (reachable.has(target)) return;
      const packageIdentity = packagesByPath.get(target);
      if (packageIdentity === undefined) materializationBindingError('Legacy runtime dependency root target is absent');
      reachable.add(target);
      for (const edge of packageIdentity.edges) visit(edge.target);
    };
    for (const rootPackage of rootPackages) visit(rootPackage.target);
    if (reachable.size !== packages.length) return null;
    const content = Object.freeze({
      formatVersion: LEGACY_RUNTIME_DEPENDENCY_MATERIALIZATION_FORMAT,
      manifestHash,
      packages: Object.freeze(packages),
      rootPackages: Object.freeze(rootPackages),
      toolchain: canonicalRuntimeToolchainBinding(candidate.toolchain as RuntimeDependencyToolchainBinding)
    });
    const canonical = deepFreeze({
      ...content,
      revision: `sha256:${rawSha256Hex(JSON.stringify(canonicalJson(content)))}` as const
    });
    return canonicalEquals(value, canonical) ? canonical : null;
  } catch {
    return null;
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

function resolveVersion(rootPackage: RootPackageJson, dependencyName: string): string {
  const version = rootPackage.dependencies?.[dependencyName] ?? rootPackage.devDependencies?.[dependencyName];
  if (!version) {
    throw new FailureError(
      'RUNTIME-DEPS-000',
      `Root package.json is missing required runtime dependency "${dependencyName}"`
    );
  }
  if (parseRuntimeDependencyPackageReference(dependencyName, version) === null) {
    throw new FailureError(
      'RUNTIME-DEPS-000',
      `Root package.json must pin runtime dependency "${dependencyName}" to one exact numeric release or exact npm alias`
    );
  }
  return version;
}

function stableHash(value: unknown): string {
  return rawSha256Hex(JSON.stringify(value));
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

/**
 * Runtime dependency selection is synchronous because the canonical package
 * manifest is observed through the synchronous retained no-follow reader. Do
 * not wrap this API in Promise fanout and claim filesystem parallelism.
 */
export function loadRuntimeDependencySpec(
  packageJsonPath = path.join(compilerRoot, 'package.json')
): RuntimeDependencySpec {
  const rootPackage = readOptionalRetainedJson<RootPackageJson>(
    packageJsonPath,
    'Runtime dependency root package manifest'
  );
  if (rootPackage === null) {
    throw new FailureError(
      'RUNTIME-DEPS-000',
      `Root package.json is missing: ${packageJsonPath}`
    );
  }
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
