import crypto from 'node:crypto';
import path from 'node:path';
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
    return JSON.stringify(value) === JSON.stringify(canonical);
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
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
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
  const keys = Object.keys(record).sort((left, right) => left.localeCompare(right));
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
