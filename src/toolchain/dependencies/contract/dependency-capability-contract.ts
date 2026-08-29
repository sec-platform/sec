import { compareCodeUnits, deepFreeze } from '../../../system-architecture/foundation/runtime/canonical.ts';

export type DependencyManifestSection = 'dependencies' | 'devDependencies';
export type GeneratedRuntimeProjection = 'dependency' | 'devDependency' | 'none';

export interface DependencyCapabilitySpec {
  readonly name: string;
  readonly section: DependencyManifestSection;
  readonly generatedRuntime: GeneratedRuntimeProjection;
}

export interface DependencyCapabilityPackageManifest {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly trustedDependencies?: readonly string[];
}

export const DEPENDENCY_CAPABILITY_SPECS: readonly Readonly<DependencyCapabilitySpec>[] = deepFreeze([
  { name: 'commander', section: 'dependencies', generatedRuntime: 'none' },
  { name: 'diff', section: 'dependencies', generatedRuntime: 'none' },
  { name: 'ora', section: 'dependencies', generatedRuntime: 'none' },
  { name: 'p-limit', section: 'dependencies', generatedRuntime: 'none' },
  { name: 'picocolors', section: 'dependencies', generatedRuntime: 'none' },
  { name: 'semver', section: 'dependencies', generatedRuntime: 'none' },
  { name: 'yaml', section: 'dependencies', generatedRuntime: 'dependency' },
  { name: 'zod', section: 'dependencies', generatedRuntime: 'none' },
  { name: '@types/bun', section: 'devDependencies', generatedRuntime: 'devDependency' },
  { name: '@types/node', section: 'devDependencies', generatedRuntime: 'devDependency' },
  { name: '@types/semver', section: 'devDependencies', generatedRuntime: 'none' },
  { name: 'dependency-cruiser', section: 'devDependencies', generatedRuntime: 'none' },
  { name: 'jscpd', section: 'devDependencies', generatedRuntime: 'none' },
  { name: 'knip', section: 'devDependencies', generatedRuntime: 'none' },
  { name: 'prettier', section: 'devDependencies', generatedRuntime: 'none' },
  { name: 'ts-morph', section: 'devDependencies', generatedRuntime: 'devDependency' },
  { name: 'typescript', section: 'devDependencies', generatedRuntime: 'devDependency' }
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
  if ((manifest.trustedDependencies?.length ?? 0) > 0) {
    throw new Error('trustedDependencies must not grant install-script trust without one direct dependency owner');
  }
}
