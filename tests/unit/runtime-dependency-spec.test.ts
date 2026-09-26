import path from 'node:path';

import { expect, test } from 'bun:test';

import { parseLegacyRuntimeDependencyMaterializationForRecovery } from '../../src/adapters/toolchain/dependencies/contract/runtime-dependency-spec.ts';
import { canonicalJson, rawSha256Hex } from '../../src/contracts/canonical.ts';

import {
  buildRuntimeDependencyMaterializationBinding,
  buildRuntimeDependencySpec,
  isRuntimeDependencyMaterializationBinding,
  RUNTIME_DEPENDENCY_PACKAGE_NAMES,
  type RootPackageJson
} from '../../src/adapters/toolchain/dependencies/contract/runtime-dependency-spec.ts';

function rootPackage(): RootPackageJson {
  return {
    dependencies: { yaml: '2.8.3' },
    devDependencies: {
      '@typescript/native': 'npm:typescript@7.0.2',
      '@types/bun': '1.3.13',
      '@types/node': '25.6.0',
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
    rootPackages: packageNames.map((name) => ({ name, packageName: name, target: name })),
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
    '@typescript/native': 'npm:typescript@7.0.2',
    '@types/bun': '1.3.13',
    '@types/node': '25.6.0',
    typescript: '6.0.3'
  });
  expect(RUNTIME_DEPENDENCY_PACKAGE_NAMES).toEqual([
    'yaml',
    '@types/bun',
    '@types/node',
    '@typescript/native',
    'typescript'
  ]);
  expect(spec.manifestHash).toMatch(/^[a-f0-9]{64}$/u);
});

test('runtime dependency spec rejects ranges and missing terminal packages', () => {
  const ranged = rootPackage();
  ranged.dependencies = { yaml: '^2.8.3' };
  expect(() => buildRuntimeDependencySpec(ranged)).toThrow('one exact numeric release or exact npm alias');
  const rangedAlias = rootPackage();
  rangedAlias.devDependencies = {
    ...rangedAlias.devDependencies,
    '@typescript/native': 'npm:typescript@^7.0.2'
  };
  expect(() => buildRuntimeDependencySpec(rangedAlias)).toThrow('one exact numeric release or exact npm alias');
  const missing = rootPackage();
  delete missing.devDependencies?.typescript;
  expect(() => buildRuntimeDependencySpec(missing)).toThrow(
    'Root package.json is missing required runtime dependency "typescript"'
  );
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

test('durable materialization grammar survives a later current-root retirement', () => {
  const current = materializationBinding();
  const retiredRoot = Object.freeze({
    edges: Object.freeze([]),
    manifestSha256: '8'.repeat(64),
    name: 'retired-tool',
    relativePath: 'retired-tool',
    version: '1.0.0'
  });
  const content = Object.freeze({
    formatVersion: current.formatVersion,
    manifestHash: current.manifestHash,
    packages: Object.freeze([...current.packages, retiredRoot]
      .sort((left, right) => left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0)),
    rootPackages: Object.freeze([...current.rootPackages, Object.freeze({
      name: retiredRoot.name,
      packageName: retiredRoot.name,
      target: retiredRoot.relativePath
    })].sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0)),
    toolchain: current.toolchain
  });
  const historical = Object.freeze({
    ...content,
    revision: `sha256:${rawSha256Hex(JSON.stringify(canonicalJson(content)))}` as const
  });

  expect(isRuntimeDependencyMaterializationBinding(historical)).toBe(true);
  expect(() => buildRuntimeDependencyMaterializationBinding(historical))
    .toThrow('root package closure is incomplete');
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

test('legacy materialization grammar is exact recovery input and never current readiness', () => {
  const current = materializationBinding();
  const legacyNames = ['@types/bun', '@types/node', 'ts-morph', 'typescript', 'yaml'];
  const legacyPackages = [
    ...current.packages.filter(({ name }) => legacyNames.includes(name) || name === 'transitive'),
    {
      edges: [],
      manifestSha256: 'a'.repeat(64),
      name: 'ts-morph',
      relativePath: 'ts-morph',
      version: '1.0.0'
    }
  ].sort((left, right) => left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0);
  const content = Object.freeze({
    formatVersion: 'sec-runtime-dependency-materialization-v2' as const,
    manifestHash: current.manifestHash,
    packages: Object.freeze(legacyPackages),
    rootPackages: Object.freeze(legacyNames.map((name) => Object.freeze({ name, target: name }))),
    toolchain: current.toolchain
  });
  const legacy = Object.freeze({
    ...content,
    revision: `sha256:${rawSha256Hex(JSON.stringify(canonicalJson(content)))}` as const
  });

  expect(parseLegacyRuntimeDependencyMaterializationForRecovery(legacy)).toEqual(legacy);
  expect(isRuntimeDependencyMaterializationBinding(legacy)).toBe(false);
  expect(parseLegacyRuntimeDependencyMaterializationForRecovery({
    ...legacy,
    rootPackages: legacy.rootPackages.slice(1)
  })).toBeNull();
  expect(parseLegacyRuntimeDependencyMaterializationForRecovery({
    ...legacy,
    unexpected: true
  })).toBeNull();
});
