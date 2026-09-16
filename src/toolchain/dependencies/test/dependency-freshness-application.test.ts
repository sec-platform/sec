import { expect, test } from 'bun:test';

import { ANONYMOUS_PACKAGE_REGISTRY_PROFILE } from '../../../external-capabilities/package-registry/contract/anonymous-registry.ts';
import {
  issueAnonymousPackageRegistryTestCapability,
  queryAnonymousPackageRegistryLatestVersionsForTests
} from '../../../external-capabilities/package-registry/runtime/anonymous-registry.ts';
import { compileDependencyFreshnessFromOwnerFacts } from '../application/dependency-freshness.ts';
import { DEPENDENCY_CAPABILITY_SPECS } from '../contract/dependency-capability-contract.ts';
import { parseRuntimeDependencyPackageReference } from '../contract/runtime-dependency-spec.ts';

test('application consumer cannot promote a TypeScript pin without Source Program coverage', async () => {
  const dependencies: Record<string, string> = {};
  const devDependencies: Record<string, string> = {};
  for (const spec of DEPENDENCY_CAPABILITY_SPECS) {
    const reference = spec.name === 'typescript'
      ? '6.0.3'
      : spec.name === '@typescript/native'
        ? 'npm:typescript@7.0.2'
        : spec.name === '@types/bun'
          ? '1.4.0'
          : '1.0.0';
    (spec.section === 'dependencies' ? dependencies : devDependencies)[spec.name] = reference;
  }
  const rootManifest = { dependencies, devDependencies, packageManager: 'bun@1.4.0' } as const;
  const lockEntries = DEPENDENCY_CAPABILITY_SPECS.map((spec) => {
    const reference = rootManifest[spec.section][spec.name]!;
    const resolved = parseRuntimeDependencyPackageReference(spec.name, reference)!;
    return Object.freeze({
      declaredName: spec.name,
      packageName: resolved.packageName,
      resolvedVersion: resolved.version
    });
  });
  const latestByPackage = new Map<string, string>();
  for (const entry of lockEntries) {
    const previous = latestByPackage.get(entry.packageName);
    if (previous === undefined || Bun.semver.order(previous, entry.resolvedVersion) < 0) {
      latestByPackage.set(entry.packageName, entry.resolvedVersion);
    }
  }
  let requestCount = 0;
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      requestCount += 1;
      const encoded = new URL(request.url).pathname
        .slice(11, -10);
      const packageName = decodeURIComponent(encoded);
      return Response.json({ latest: latestByPackage.get(packageName) });
    }
  });
  try {
    const capability = issueAnonymousPackageRegistryTestCapability({
      ...ANONYMOUS_PACKAGE_REGISTRY_PROFILE,
      origin: `http://127.0.0.1:${server.port}`
    });
    const registry = await queryAnonymousPackageRegistryLatestVersionsForTests(
      capability,
      [...latestByPackage.keys()],
      { deadlineAtUnixMs: Date.now() + 2_000 }
    );
    const decision = compileDependencyFreshnessFromOwnerFacts({
      bunRuntimeVersion: '1.4.0',
      lock: Object.freeze({
        entries: Object.freeze(lockEntries),
        lockDigest: `sha256:${'e'.repeat(64)}` as `sha256:${string}`
      }),
      registry,
      rootManifest
    });

    expect(requestCount).toBe(latestByPackage.size);
    expect(decision.status).toBe('unresolved');
    expect(decision.packages.find(({ declaredName }) => declaredName === 'typescript')).toMatchObject({
      reason: 'newer-release-observed',
      status: 'unresolved'
    });
    expect(decision.packages.some(({ status }) => status === 'upgrade-required')).toBeFalse();
    expect(decision.packages.some(({ reason }) => reason === 'lock-entry-missing')).toBeFalse();
    expect(decision.packages).toHaveLength(DEPENDENCY_CAPABILITY_SPECS.length);
  } finally {
    server.stop(true);
  }
});
