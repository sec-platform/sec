import { compareCodeUnits, deepFreeze } from '../../../foundation/canonical.ts';

export type DependencyManifestSection = 'dependencies' | 'devDependencies';
export type DependencyCapabilityRole =
  | 'boundary-audit'
  | 'cli'
  | 'concurrency'
  | 'duplication-audit'
  | 'filesystem-discovery'
  | 'formatting'
  | 'logging'
  | 'reachability-audit'
  | 'schema-validation'
  | 'serialization'
  | 'terminal-formatting'
  | 'text-diff'
  | 'type-system'
  | 'version-policy';
export type GeneratedRuntimeProjection = 'dependency' | 'devDependency' | 'none';

export interface DependencyCapabilitySpec {
  readonly name: string;
  readonly section: DependencyManifestSection;
  readonly role: DependencyCapabilityRole;
  readonly generatedRuntime: GeneratedRuntimeProjection;
}

export interface DependencyCapabilityPackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly trustedDependencies?: readonly string[];
}

export const RETIRED_CORE_DEPENDENCIES = Object.freeze([
  '@playwright/test',
  '@types/ejs',
  '@types/react',
  '@types/react-dom',
  'ejs',
  'next',
  'playwright',
  'react',
  'react-dom'
] as const);

export const DEPENDENCY_CAPABILITY_SPECS: readonly Readonly<DependencyCapabilitySpec>[] = deepFreeze([
  { name: 'commander', section: 'dependencies', role: 'cli', generatedRuntime: 'none' },
  { name: 'diff', section: 'dependencies', role: 'text-diff', generatedRuntime: 'none' },
  { name: 'globby', section: 'dependencies', role: 'filesystem-discovery', generatedRuntime: 'none' },
  { name: 'ora', section: 'dependencies', role: 'cli', generatedRuntime: 'none' },
  { name: 'p-limit', section: 'dependencies', role: 'concurrency', generatedRuntime: 'none' },
  { name: 'picocolors', section: 'dependencies', role: 'terminal-formatting', generatedRuntime: 'none' },
  { name: 'pino', section: 'dependencies', role: 'logging', generatedRuntime: 'none' },
  { name: 'semver', section: 'dependencies', role: 'version-policy', generatedRuntime: 'none' },
  { name: 'yaml', section: 'dependencies', role: 'serialization', generatedRuntime: 'dependency' },
  { name: 'zod', section: 'dependencies', role: 'schema-validation', generatedRuntime: 'none' },
  { name: '@types/bun', section: 'devDependencies', role: 'type-system', generatedRuntime: 'devDependency' },
  { name: '@types/node', section: 'devDependencies', role: 'type-system', generatedRuntime: 'devDependency' },
  { name: '@types/semver', section: 'devDependencies', role: 'type-system', generatedRuntime: 'none' },
  { name: 'dependency-cruiser', section: 'devDependencies', role: 'boundary-audit', generatedRuntime: 'none' },
  { name: 'jscpd', section: 'devDependencies', role: 'duplication-audit', generatedRuntime: 'none' },
  { name: 'knip', section: 'devDependencies', role: 'reachability-audit', generatedRuntime: 'none' },
  { name: 'prettier', section: 'devDependencies', role: 'formatting', generatedRuntime: 'none' },
  { name: 'ts-morph', section: 'devDependencies', role: 'type-system', generatedRuntime: 'devDependency' },
  { name: 'typescript', section: 'devDependencies', role: 'type-system', generatedRuntime: 'devDependency' }
]);

function sorted(values: Iterable<string>): string[] {
  return [...values].sort(compareCodeUnits);
}

export function dependencyCapabilityNamesForSection(
  section: DependencyManifestSection
): readonly string[] {
  return Object.freeze(DEPENDENCY_CAPABILITY_SPECS
    .filter((spec) => spec.section === section)
    .map((spec) => spec.name)
    .sort(compareCodeUnits));
}

export function generatedRuntimeDependencyCapabilityNames(
  projection: Exclude<GeneratedRuntimeProjection, 'none'>
): readonly string[] {
  return Object.freeze(DEPENDENCY_CAPABILITY_SPECS
    .filter((spec) => spec.generatedRuntime === projection)
    .map((spec) => spec.name)
    .sort(compareCodeUnits));
}

export function assertDependencyCapabilityClosure(
  manifest: DependencyCapabilityPackageManifest
): void {
  const names = DEPENDENCY_CAPABILITY_SPECS.map((spec) => spec.name);
  if (new Set(names).size !== names.length) {
    throw new Error('Dependency capability specs contain duplicate package owners');
  }
  for (const section of ['dependencies', 'devDependencies'] as const) {
    const declared = sorted(Object.keys(manifest[section] ?? {}));
    const owned = [...dependencyCapabilityNamesForSection(section)];
    if (JSON.stringify(declared) !== JSON.stringify(owned)) {
      throw new Error(`Dependency capability owner differs from package.json ${section}`);
    }
  }
  const declaredNames = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.devDependencies ?? {})
  ]);
  for (const retired of RETIRED_CORE_DEPENDENCIES) {
    if (declaredNames.has(retired)) {
      throw new Error(`Retired core dependency must remain absent: ${retired}`);
    }
  }
  if ((manifest.trustedDependencies?.length ?? 0) > 0) {
    throw new Error('trustedDependencies must not grant install-script trust without one direct dependency owner');
  }
}
