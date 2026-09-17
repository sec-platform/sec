import { compareCodeUnits, deepFreeze } from '../../../contracts/canonical.ts';

export type DependencyManifestSection = 'dependencies' | 'devDependencies';
export type GeneratedRuntimeProjection = 'dependency' | 'devDependency' | 'none';

export type DependencyFreshnessPolicy = Readonly<
  | {
    readonly kind: 'typescript-capability-coverage';
    readonly companion: string;
  }
  | {
    readonly kind: 'runtime-version';
    readonly runtime: 'bun';
  }
>;

export interface DependencyCapabilitySpec {
  readonly consumerRole?: string;
  readonly freshness?: DependencyFreshnessPolicy;
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
  { name: 'yaml', section: 'dependencies', generatedRuntime: 'dependency' },
  { name: 'zod', section: 'dependencies', generatedRuntime: 'none' },
  {
    name: '@typescript/native',
    section: 'devDependencies',
    generatedRuntime: 'devDependency',
    consumerRole: 'typescript-native-project-check'
  },
  {
    name: '@types/bun',
    section: 'devDependencies',
    generatedRuntime: 'devDependency',
    consumerRole: 'bun-runtime-types',
    freshness: { kind: 'runtime-version', runtime: 'bun' }
  },
  { name: '@types/node', section: 'devDependencies', generatedRuntime: 'devDependency' },
  { name: 'jscpd', section: 'devDependencies', generatedRuntime: 'none' },
  { name: 'knip', section: 'devDependencies', generatedRuntime: 'none' },
  { name: 'prettier', section: 'devDependencies', generatedRuntime: 'none' },
  {
    name: 'typescript',
    section: 'devDependencies',
    generatedRuntime: 'devDependency',
    consumerRole: 'typescript-authoring-compiler-api',
    freshness: { kind: 'typescript-capability-coverage', companion: '@typescript/native' }
  }
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
  const byName = new Map(DEPENDENCY_CAPABILITY_SPECS.map((spec) => [spec.name, spec]));
  const roles = DEPENDENCY_CAPABILITY_SPECS
    .map((spec) => spec.consumerRole)
    .filter((role): role is string => role !== undefined);
  if (new Set(roles).size !== roles.length) {
    throw new Error('Dependency capability specs contain duplicate consumer roles');
  }
  for (const spec of DEPENDENCY_CAPABILITY_SPECS) {
    if (spec.freshness !== undefined && spec.consumerRole === undefined) {
      throw new Error(`Dependency freshness policy requires one consumer role: ${spec.name}`);
    }
    if (spec.freshness?.kind === 'typescript-capability-coverage') {
      const companion = byName.get(spec.freshness.companion);
      if (companion?.consumerRole === undefined) {
        throw new Error(`Dependency freshness companion requires one consumer role: ${spec.name}`);
      }
    }
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
