import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  buildRuntimeDependencyMaterializationBinding,
  buildRuntimeDependencySpec,
  isRuntimeDependencyMaterializationBinding,
  RUNTIME_DEPENDENCY_PACKAGE_NAMES,
  type RootPackageJson
} from '../../src/toolchain/dependencies/spec.ts';

function rootPackage(): RootPackageJson {
  return {
    dependencies: { yaml: '2.8.3' },
    devDependencies: {
      '@types/bun': '1.3.13',
      '@types/node': '25.6.0',
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

test('generated runtime dependency owner contains only the terminal TypeScript library toolchain', () => {
  const spec = buildRuntimeDependencySpec(rootPackage());
  expect(spec.dependencies).toEqual({ yaml: '2.8.3' });
  expect(spec.devDependencies).toEqual({
    '@types/bun': '1.3.13',
    '@types/node': '25.6.0',
    'ts-morph': '28.0.0',
    typescript: '6.0.3'
  });
  expect(RUNTIME_DEPENDENCY_PACKAGE_NAMES).toEqual([
    'yaml',
    '@types/bun',
    '@types/node',
    'ts-morph',
    'typescript'
  ]);
  expect(spec.manifestHash).toMatch(/^[a-f0-9]{64}$/u);
});

test('runtime dependency spec rejects ranges and missing terminal packages', () => {
  const ranged = rootPackage();
  ranged.dependencies = { yaml: '^2.8.3' };
  expect(() => buildRuntimeDependencySpec(ranged)).toThrow('one exact numeric release');
  const missing = rootPackage();
  delete missing.devDependencies?.typescript;
  expect(() => buildRuntimeDependencySpec(missing)).toThrow('missing runtime dependency');
});

test('materialization binding owns the complete transitive closure and exact Bun provider', () => {
  const binding = materializationBinding();
  expect(binding.packages.some((entry) => entry.name === 'transitive')).toBe(true);
  expect(binding.revision).toMatch(/^sha256:[a-f0-9]{64}$/u);
  expect(materializationBinding({ bunExecutableSha256: '2'.repeat(64) }).revision)
    .not.toBe(binding.revision);
  expect(isRuntimeDependencyMaterializationBinding(binding)).toBe(true);
  expect(isRuntimeDependencyMaterializationBinding({ ...binding, unexpected: true })).toBe(false);
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
