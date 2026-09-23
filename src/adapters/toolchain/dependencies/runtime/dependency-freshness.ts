import { compareCodeUnits, deepFreeze, sha256 } from '../../../../contracts/canonical.ts';
import {
  assertTypeScriptCapabilityCoverageDecision,
  type TypeScriptCapabilityCoverageDecision
} from '../../typescript/capability-coverage.ts';
import {
  DEPENDENCY_CAPABILITY_SPECS,
  assertDependencyCapabilityClosure,
  type DependencyCapabilityPackageManifest
} from '../contract/dependency-capability-contract.ts';
import {
  parseDependencyFreshnessInput,
  type DependencyFreshnessDecision,
  type DependencyFreshnessInput,
  type DependencyFreshnessLockObservation,
  type DependencyFreshnessManifestObservation,
  type DependencyFreshnessPackageDecision,
  type DependencyFreshnessStatus
} from '../contract/dependency-freshness.ts';
import { parseRuntimeDependencyPackageReference } from '../contract/runtime-dependency-spec.ts';

type PackageJsonFreshnessInput = DependencyCapabilityPackageManifest & Readonly<{
  packageManager: string;
}>;

function exactBunPackageManagerVersion(packageManager: string): string {
  const match = /^bun@((?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?)$/u
    .exec(packageManager);
  if (!match) throw new Error('Dependency freshness requires one exact bun packageManager release');
  return match[1]!;
}

function uniqueBy<T>(values: readonly T[], keyOf: (value: T) => string, label: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const key = keyOf(value);
    if (result.has(key)) throw new Error(`Dependency freshness ${label} contains duplicate ${key}`);
    result.set(key, value);
  }
  return result;
}

function assertFreshnessManifestCapabilityClosure(
  manifest: DependencyFreshnessManifestObservation
): void {
  const dependencies: Record<string, string> = {};
  const devDependencies: Record<string, string> = {};
  for (const entry of manifest.entries) {
    const section = entry.section === 'dependencies' ? dependencies : devDependencies;
    if (Object.hasOwn(section, entry.declaredName)) {
      throw new Error(`Dependency freshness manifest contains duplicate ${entry.declaredName}`);
    }
    section[entry.declaredName] = entry.declaredReference;
  }
  assertDependencyCapabilityClosure({ dependencies, devDependencies });
}

export function projectDependencyFreshnessManifest(
  manifest: PackageJsonFreshnessInput,
  manifestDigest: `sha256:${string}`
): DependencyFreshnessManifestObservation {
  assertDependencyCapabilityClosure(manifest);
  const entries = DEPENDENCY_CAPABILITY_SPECS
    .map((spec) => Object.freeze({
      declaredName: spec.name,
      declaredReference: manifest[spec.section]?.[spec.name]!,
      section: spec.section
    }))
    .sort((left, right) => compareCodeUnits(left.declaredName, right.declaredName));
  return deepFreeze({
    bunPackageManagerVersion: exactBunPackageManagerVersion(manifest.packageManager),
    entries,
    manifestDigest
  });
}

function statusRank(status: DependencyFreshnessStatus): number {
  switch (status) {
    case 'unresolved': return 3;
    case 'upgrade-required': return 2;
    case 'intentional-pin': return 1;
    case 'up-to-date': return 0;
  }
}

function unresolved(
  declaredName: string,
  reason: DependencyFreshnessPackageDecision['reason'],
  input: Partial<DependencyFreshnessPackageDecision> = {}
): DependencyFreshnessPackageDecision {
  return Object.freeze({
    declaredName,
    latestVersion: input.latestVersion ?? null,
    packageName: input.packageName ?? null,
    reason,
    resolvedVersion: input.resolvedVersion ?? null,
    roles: Object.freeze(input.roles ? [...input.roles] : []),
    status: 'unresolved'
  });
}

function intentionalRole(
  declaredName: string,
  packageName: string,
  resolvedVersion: string,
  latestVersion: string,
  input: DependencyFreshnessInput,
  lockByDeclaredName: ReadonlyMap<string, DependencyFreshnessLockObservation['entries'][number]>,
  typeScriptCoverage: TypeScriptCapabilityCoverageDecision | undefined
): Pick<DependencyFreshnessPackageDecision, 'reason' | 'roles'> | null {
  const spec = DEPENDENCY_CAPABILITY_SPECS.find((candidate) => candidate.name === declaredName);
  if (spec?.consumerRole === undefined || spec.freshness === undefined) return null;
  const freshness = spec.freshness;
  if (freshness.kind === 'runtime-version'
      && freshness.runtime === 'bun'
      && resolvedVersion === input.bunRuntimeVersion
      && input.manifest.bunPackageManagerVersion === input.bunRuntimeVersion) {
    return {
      reason: 'runtime-version-role',
      roles: Object.freeze([`${freshness.runtime}-runtime`, spec.consumerRole])
    };
  }

  if (freshness.kind !== 'typescript-capability-coverage'
      || typeScriptCoverage?.status !== 'intentional-pair') return null;
  const companionSpec = DEPENDENCY_CAPABILITY_SPECS.find(
    (candidate) => candidate.name === freshness.companion
  );
  const companion = lockByDeclaredName.get(freshness.companion);
  if (!companion || companionSpec?.consumerRole === undefined
      || typeScriptCoverage.authoringDependency.declaredName !== declaredName
      || typeScriptCoverage.authoringDependency.packageName !== packageName
      || typeScriptCoverage.authoringDependency.resolvedVersion !== resolvedVersion
      || typeScriptCoverage.nativeDependency.declaredName !== companion.declaredName
      || typeScriptCoverage.nativeDependency.packageName !== companion.packageName
      || typeScriptCoverage.nativeDependency.resolvedVersion !== companion.resolvedVersion) return null;
  if (Bun.semver.order(latestVersion, resolvedVersion) <= 0) return null;
  return {
    reason: 'paired-provider-roles',
    roles: Object.freeze([spec.consumerRole, companionSpec.consumerRole])
  };
}

export function assessDependencyFreshness(
  rawInput: unknown,
  typeScriptCoverage?: TypeScriptCapabilityCoverageDecision
): DependencyFreshnessDecision {
  if (typeScriptCoverage !== undefined) {
    assertTypeScriptCapabilityCoverageDecision(typeScriptCoverage);
  }
  const input = parseDependencyFreshnessInput(rawInput);
  assertFreshnessManifestCapabilityClosure(input.manifest);
  const manifestByName = uniqueBy(input.manifest.entries, (entry) => entry.declaredName, 'manifest');
  const lockByDeclaredName = uniqueBy(input.lock.entries, (entry) => entry.declaredName, 'lock');
  const registryByPackageName = uniqueBy(input.registry, (entry) => entry.packageName, 'registry');
  const decisions: DependencyFreshnessPackageDecision[] = [];

  if (input.bunRuntimeVersion !== input.manifest.bunPackageManagerVersion) {
    for (const entry of input.manifest.entries) {
      decisions.push(unresolved(entry.declaredName, 'bun-runtime-mismatch'));
    }
  } else {
    for (const entry of input.manifest.entries) {
      const locked = lockByDeclaredName.get(entry.declaredName);
      if (!locked) {
        decisions.push(unresolved(entry.declaredName, 'lock-entry-missing'));
        continue;
      }
      const exactReference = parseRuntimeDependencyPackageReference(
        entry.declaredName,
        entry.declaredReference
      );
      if (exactReference && (exactReference.packageName !== locked.packageName
          || exactReference.version !== locked.resolvedVersion)) {
        decisions.push(unresolved(entry.declaredName, 'lock-package-identity-mismatch', locked));
        continue;
      }
      const observation = registryByPackageName.get(locked.packageName);
      if (!observation) {
        decisions.push(unresolved(entry.declaredName, 'registry-observation-missing', locked));
        continue;
      }
      if (observation.status === 'unavailable') {
        decisions.push(unresolved(entry.declaredName, 'registry-observation-unavailable', locked));
        continue;
      }
      const comparison = Bun.semver.order(locked.resolvedVersion, observation.latestVersion);
      if (comparison > 0) {
        decisions.push(unresolved(entry.declaredName, 'registry-observation-behind-lock', {
          ...locked,
          latestVersion: observation.latestVersion
        }));
        continue;
      }
      if (comparison === 0) {
        decisions.push(Object.freeze({
          declaredName: entry.declaredName,
          latestVersion: observation.latestVersion,
          packageName: locked.packageName,
          reason: 'current-release',
          resolvedVersion: locked.resolvedVersion,
          roles: Object.freeze([]),
          status: 'up-to-date'
        }));
        continue;
      }
      const role = intentionalRole(
        entry.declaredName,
        locked.packageName,
        locked.resolvedVersion,
        observation.latestVersion,
        input,
        lockByDeclaredName,
        typeScriptCoverage
      );
      const spec = DEPENDENCY_CAPABILITY_SPECS.find(
        (candidate) => candidate.name === entry.declaredName
      );
      if (role === null && spec?.freshness?.kind === 'typescript-capability-coverage') {
        decisions.push(unresolved(entry.declaredName, 'newer-release-observed', {
          ...locked,
          latestVersion: observation.latestVersion,
          roles: spec.consumerRole === undefined ? [] : [spec.consumerRole]
        }));
        continue;
      }
      decisions.push(Object.freeze({
        declaredName: entry.declaredName,
        latestVersion: observation.latestVersion,
        packageName: locked.packageName,
        reason: role?.reason ?? 'newer-release-observed',
        resolvedVersion: locked.resolvedVersion,
        roles: role?.roles ?? Object.freeze([]),
        status: role ? 'intentional-pin' : 'upgrade-required'
      }));
    }

    for (const locked of input.lock.entries) {
      if (!manifestByName.has(locked.declaredName)) {
        decisions.push(unresolved(locked.declaredName, 'lock-entry-unexpected', locked));
      }
    }
  }

  decisions.sort((left, right) => compareCodeUnits(left.declaredName, right.declaredName));
  const status = decisions.reduce<DependencyFreshnessStatus>(
    (current, decision) => statusRank(decision.status) > statusRank(current)
      ? decision.status
      : current,
    'up-to-date'
  );
  const lockDigest: `sha256:${string}` =
    `sha256:${input.lock.lockDigest.slice('sha256:'.length)}`;
  const manifestDigest: `sha256:${string}` =
    `sha256:${input.manifest.manifestDigest.slice('sha256:'.length)}`;
  const inputDigest: `sha256:${string}` = `sha256:${sha256({
    input,
    typeScriptCoverageDigest: typeScriptCoverage?.coverageDigest ?? null
  }).slice('sha256:'.length)}`;
  const result = deepFreeze({
    inputDigest,
    lockDigest,
    manifestDigest,
    packages: decisions,
    status
  });
  return result;
}
