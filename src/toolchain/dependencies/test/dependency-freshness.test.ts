import { describe, expect, test } from 'bun:test';

import { sha256 } from '../../../system-architecture/foundation/runtime/canonical.ts';
import type { TypeScriptCapabilityCoverageDecision } from '../../typescript/capability-coverage.ts';
import { DEPENDENCY_CAPABILITY_SPECS } from '../contract/dependency-capability-contract.ts';
import { parseRuntimeDependencyPackageReference } from '../contract/runtime-dependency-spec.ts';
import {
  assessDependencyFreshness,
  projectDependencyFreshnessManifest
} from '../runtime/dependency-freshness.ts';

function packageManifest(overrides: Readonly<Record<string, string>> = {}) {
  const dependencies: Record<string, string> = {};
  const devDependencies: Record<string, string> = {};
  for (const spec of DEPENDENCY_CAPABILITY_SPECS) {
    const version = overrides[spec.name] ?? '1.0.0';
    (spec.section === 'dependencies' ? dependencies : devDependencies)[spec.name] = version;
  }
  return {
    dependencies,
    devDependencies,
    packageManager: 'bun@1.4.0'
  } as const;
}

function scenario(overrides: Readonly<Record<string, string>> = {}) {
  const manifest = projectDependencyFreshnessManifest(
    packageManifest(overrides),
    sha256({ manifest: overrides }) as `sha256:${string}`
  );
  const lockEntries = manifest.entries.map((entry) => {
    const exact = parseRuntimeDependencyPackageReference(entry.declaredName, entry.declaredReference);
    if (!exact) throw new Error(`Test dependency must be exact: ${entry.declaredName}`);
    return {
      declaredName: entry.declaredName,
      packageName: exact.packageName,
      resolvedVersion: exact.version
    };
  });
  const registry = [...new Map(lockEntries.map((entry) => [entry.packageName, {
    latestVersion: entry.resolvedVersion,
    packageName: entry.packageName,
    provider: 'registry-test-provider',
    status: 'resolved' as const
  }])).values()];
  return {
    bunRuntimeVersion: '1.4.0',
    lock: {
      entries: lockEntries,
      lockDigest: sha256(lockEntries) as `sha256:${string}`
    },
    manifest,
    registry
  } as const;
}

describe('dependency freshness owner', () => {
  test('does not infer TypeScript authoring coverage from package versions or role labels', () => {
    const input = scenario({
      '@types/bun': '1.4.0',
      '@typescript/native': 'npm:typescript@7.0.2',
      typescript: '6.0.3'
    });
    const registry = input.registry.map((entry) => entry.packageName === 'typescript'
      ? { ...entry, latestVersion: '7.0.2' }
      : entry);
    const decision = assessDependencyFreshness({ ...input, registry });

    expect(decision.status).toBe('unresolved');
    expect(decision.packages.find(({ declaredName }) => declaredName === 'typescript')).toMatchObject({
      reason: 'newer-release-observed',
      roles: ['typescript-authoring-compiler-api'],
      status: 'unresolved'
    });
    expect(decision.packages.find(({ declaredName }) => declaredName === '@typescript/native')).toMatchObject({
      status: 'up-to-date'
    });
    expect(() => assessDependencyFreshness(input, {
      status: 'intentional-pair'
    } as TypeScriptCapabilityCoverageDecision)).toThrow('not TypeScript-owner issued');
  });

  test('requires an upgrade for an ordinary stale dependency', () => {
    const input = scenario({ '@types/bun': '1.4.0', yaml: '2.9.0' });
    const registry = input.registry.map((entry) => entry.packageName === 'yaml'
      ? { ...entry, latestVersion: '2.10.0' }
      : entry);
    const decision = assessDependencyFreshness({ ...input, registry });

    expect(decision.status).toBe('upgrade-required');
    expect(decision.packages.find(({ declaredName }) => declaredName === 'yaml')).toMatchObject({
      reason: 'newer-release-observed',
      status: 'upgrade-required'
    });
  });

  test('binds Bun type declarations to the observed and declared Bun runtime role', () => {
    const input = scenario({ '@types/bun': '1.4.0' });
    const registry = input.registry.map((entry) => entry.packageName === '@types/bun'
      ? { ...entry, latestVersion: '1.5.0' }
      : entry);
    const decision = assessDependencyFreshness({ ...input, registry });

    expect(decision.packages.find(({ declaredName }) => declaredName === '@types/bun')).toMatchObject({
      reason: 'runtime-version-role',
      roles: ['bun-runtime', 'bun-runtime-types'],
      status: 'intentional-pin'
    });
  });

  test('keeps presentation-only or unavailable registry facts unresolved with zero upgrade authority', () => {
    const input = scenario({ '@types/bun': '1.4.0' });
    const unavailableRegistry = input.registry.map(({ packageName }) => ({
      packageName,
      provider: 'registry-test-provider',
      reason: 'machine-interface-unavailable' as const,
      status: 'unavailable' as const
    }));
    const decision = assessDependencyFreshness({
      ...input,
      registry: unavailableRegistry
    });

    expect(decision.status).toBe('unresolved');
    expect(decision.packages.every(({ status }) => status === 'unresolved')).toBeTrue();
    expect(assessDependencyFreshness({
      ...input,
      registry: unavailableRegistry
    })).toEqual(decision);
  });

  test('treats missing registry facts and a Bun runtime mismatch as unresolved', () => {
    const input = scenario({ '@types/bun': '1.4.0' });
    const missing = assessDependencyFreshness({ ...input, registry: input.registry.slice(1) });
    const mismatchedRuntime = assessDependencyFreshness({ ...input, bunRuntimeVersion: '1.4.1' });

    expect(missing.status).toBe('unresolved');
    expect(missing.packages.some(({ reason }) => reason === 'registry-observation-missing')).toBeTrue();
    expect(mismatchedRuntime.status).toBe('unresolved');
    expect(mismatchedRuntime.packages.every(({ reason }) => reason === 'bun-runtime-mismatch')).toBeTrue();
  });

  test('cannot obtain an up-to-date decision by omitting the dependency owner inventory', () => {
    const input = scenario({ '@types/bun': '1.4.0' });
    expect(() => assessDependencyFreshness({
      ...input,
      lock: { ...input.lock, entries: [] },
      manifest: { ...input.manifest, entries: [] },
      registry: []
    })).toThrow('Dependency capability owner differs from package.json dependencies');
  });
});
