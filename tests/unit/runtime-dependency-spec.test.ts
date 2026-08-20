import { expect, test } from 'bun:test';
import path from 'node:path';

import { CompilerError } from '../../platform/shared/errors.ts';
import {
  buildExactPlaywrightPackageAuthority,
  buildExactPlaywrightPackageClosure,
  buildRuntimeDependencyMaterializationBinding,
  buildRuntimeDependencySpec,
  isExactPlaywrightPackageAuthority,
  isRuntimeDependencyMaterializationBinding,
  RUNTIME_DEPENDENCY_PACKAGE_NAMES,
  type RootPackageJson
} from '../../platform/shared/runtime-dependency-spec.ts';

function rootPackage(playwrightVersion: string): RootPackageJson {
  return {
    dependencies: {
      next: '16.2.4',
      react: '19.2.5',
      'react-dom': '19.2.5',
      yaml: '2.8.3'
    },
    devDependencies: {
      '@playwright/test': playwrightVersion,
      '@types/bun': '1.3.13',
      '@types/node': '25.6.0',
      '@types/react': '19.2.14',
      '@types/react-dom': '19.2.3',
      'ts-morph': '28.0.0',
      typescript: '6.0.3'
    }
  };
}

function materializationBinding(
  overrides: Partial<Parameters<typeof buildRuntimeDependencyMaterializationBinding>[0]['toolchain']> = {}
) {
  const packageNames = [...RUNTIME_DEPENDENCY_PACKAGE_NAMES].sort();
  const packages = packageNames.map((name, index) => ({
    edges: index === 0
      ? [{ kind: 'dependency' as const, name: 'transitive', target: 'transitive' }]
      : [],
    manifestSha256: String(index + 20).padStart(64, '0'),
    name,
    relativePath: name,
    version: '1.0.0'
  }));
  packages.push({
    edges: [],
    manifestSha256: 'b'.repeat(64),
    name: 'transitive',
    relativePath: 'transitive',
    version: '2.0.0'
  });
  return buildRuntimeDependencyMaterializationBinding({
    manifestHash: 'c'.repeat(64),
    packages,
    rootPackages: packageNames.map((name) => ({ name, target: name })),
    toolchain: {
      architecture: 'x64',
      bunExecutablePath: path.resolve('/toolchain/bun'),
      bunExecutableSha256: 'd'.repeat(64),
      bunVersion: '1.3.14',
      canonicalBunVersion: '1.3.14',
      compilerGenerationRevision: 'e'.repeat(64),
      declaredBunVersion: '1.3.14',
      dependencyManifestSha256: '1'.repeat(64),
      installConfigSha256: '9'.repeat(64),
      lockSha256: 'f'.repeat(64),
      platform: 'win32',
      ...overrides
    }
  });
}

test('runtime dependency spec preserves one exact Playwright release identity', () => {
  const spec = buildRuntimeDependencySpec(rootPackage('1.59.1'));

  expect(spec.dependencies).toEqual({
    next: '16.2.4',
    react: '19.2.5',
    'react-dom': '19.2.5',
    yaml: '2.8.3'
  });
  expect(spec.devDependencies['@playwright/test']).toBe('1.59.1');
  expect(spec.manifestHash).toMatch(/^[a-f0-9]{64}$/);
});

test('runtime dependency spec rejects a range for every direct runtime package', () => {
  const root = rootPackage('1.59.1');
  root.dependencies = { ...root.dependencies, react: '^19.2.5' };
  expect(() => buildRuntimeDependencySpec(root)).toThrow(
    'runtime dependency "react" to one exact numeric release'
  );
});

test('materialization binding owns the complete transitive closure and exact Bun provider', () => {
  const binding = materializationBinding();
  const executableDrift = materializationBinding({ bunExecutableSha256: '2'.repeat(64) });

  expect(binding.packages.some((entry) => entry.name === 'transitive')).toBe(true);
  expect(binding.revision).toMatch(/^sha256:[a-f0-9]{64}$/u);
  expect(executableDrift.revision).not.toBe(binding.revision);
  expect(isRuntimeDependencyMaterializationBinding(binding)).toBe(true);
  expect(isRuntimeDependencyMaterializationBinding({ ...binding, unexpected: true })).toBe(false);
  expect(isRuntimeDependencyMaterializationBinding({
    ...binding,
    packages: [...binding.packages].reverse()
  })).toBe(false);
});

test('materialization binding rejects incomplete edges and Bun identity disagreement', () => {
  const binding = materializationBinding();
  expect(() => buildRuntimeDependencyMaterializationBinding({
    manifestHash: binding.manifestHash,
    packages: binding.packages.filter((entry) => entry.name !== 'transitive'),
    rootPackages: binding.rootPackages,
    toolchain: binding.toolchain
  })).toThrow('edge target is absent');
  expect(() => materializationBinding({ bunVersion: '1.3.13' }))
    .toThrow('Bun identities must be exactly equal');
});

test('Playwright package closure requires all three packages at the root exact release', () => {
  const closure = buildExactPlaywrightPackageClosure({
    '@playwright/test': { name: '@playwright/test', version: '1.59.1' },
    playwright: { name: 'playwright', version: '1.59.1' },
    'playwright-core': { name: 'playwright-core', version: '1.59.1' }
  }, '1.59.1');

  expect(closure).toEqual({
    packages: [
      { name: '@playwright/test', version: '1.59.1' },
      { name: 'playwright', version: '1.59.1' },
      { name: 'playwright-core', version: '1.59.1' }
    ],
    release: '1.59.1'
  });
  expect(Object.isFrozen(closure)).toBe(true);
  expect(Object.isFrozen(closure.packages)).toBe(true);
});

test('Playwright package authority has one canonical order and revision owner', () => {
  const identities = [
    { manifestSha256: 'c'.repeat(64), name: 'playwright-core' as const, version: '1.59.1' },
    { manifestSha256: 'a'.repeat(64), name: '@playwright/test' as const, version: '1.59.1' },
    { manifestSha256: 'b'.repeat(64), name: 'playwright' as const, version: '1.59.1' }
  ];
  const authority = buildExactPlaywrightPackageAuthority(identities, '1.59.1');

  expect(authority.packages.map(({ name }) => name)).toEqual([
    '@playwright/test',
    'playwright',
    'playwright-core'
  ]);
  expect(authority.revision).toMatch(/^sha256:[a-f0-9]{64}$/u);
  expect(buildExactPlaywrightPackageAuthority([...identities].reverse(), '1.59.1')).toEqual(authority);
  expect(isExactPlaywrightPackageAuthority(authority)).toBe(true);
  expect(isExactPlaywrightPackageAuthority({ ...authority, revision: `sha256:${'0'.repeat(64)}` })).toBe(false);
  expect(isExactPlaywrightPackageAuthority({ ...authority, extra: true })).toBe(false);
  expect(isExactPlaywrightPackageAuthority({
    ...authority,
    packages: [...authority.packages].reverse()
  })).toBe(false);
  expect(Object.isFrozen(authority)).toBe(true);
  expect(Object.isFrozen(authority.packages)).toBe(true);
});

test('Playwright package authority rejects duplicate, missing, and malformed identities', () => {
  const valid = [
    { manifestSha256: 'a'.repeat(64), name: '@playwright/test' as const, version: '1.59.1' },
    { manifestSha256: 'b'.repeat(64), name: 'playwright' as const, version: '1.59.1' },
    { manifestSha256: 'c'.repeat(64), name: 'playwright-core' as const, version: '1.59.1' }
  ];

  expect(() => buildExactPlaywrightPackageAuthority(valid.slice(0, 2), '1.59.1')).toThrow(
    'Playwright package authority is incomplete'
  );
  expect(() => buildExactPlaywrightPackageAuthority(
    [valid[0]!, valid[0]!, valid[2]!],
    '1.59.1'
  )).toThrow('Playwright package authority is non-canonical');
  expect(() => buildExactPlaywrightPackageAuthority(
    [{ ...valid[0]!, manifestSha256: 'invalid' }, valid[1]!, valid[2]!],
    '1.59.1'
  )).toThrow('Playwright package authority is non-canonical');
});

for (const mismatch of ['@playwright/test', 'playwright', 'playwright-core'] as const) {
  test(`Playwright package closure rejects ${mismatch} release drift`, () => {
    expect(() => buildExactPlaywrightPackageClosure({
      '@playwright/test': {
        name: '@playwright/test',
        version: mismatch === '@playwright/test' ? '1.59.0' : '1.59.1'
      },
      playwright: {
        name: 'playwright',
        version: mismatch === 'playwright' ? '1.59.0' : '1.59.1'
      },
      'playwright-core': {
        name: 'playwright-core',
        version: mismatch === 'playwright-core' ? '1.59.0' : '1.59.1'
      }
    }, '1.59.1')).toThrow(`Playwright package "${mismatch}" must exactly match release 1.59.1`);
  });
}

for (const version of [
  '^1.59.1',
  '~1.59.1',
  '>=1.59.1',
  '1.59.x',
  'latest',
  'npm:@playwright/test@1.59.1',
  '1.59.1-next.1',
  '1.59.1+local',
  '01.59.1',
  '1.059.1',
  '1.59.01'
]) {
  test(`runtime dependency spec rejects non-exact Playwright identity ${version}`, () => {
    try {
      buildRuntimeDependencySpec(rootPackage(version));
      throw new Error('expected buildRuntimeDependencySpec to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(CompilerError);
      expect((error as CompilerError).code).toBe('RUNTIME-DEPS-000');
      expect((error as Error).message).toContain('one exact numeric release');
    }
  });
}
