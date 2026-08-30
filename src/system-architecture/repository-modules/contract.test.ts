import { expect, test } from 'bun:test';

import { compilerRoot } from '../../workspace/paths.ts';
import {
  assertSecRepositoryModuleImportBoundaries,
  collectSecRepositoryModuleBoundaryViolations,
  compileSecRepositoryModuleGraph,
  compileSecRepositoryModuleMembership,
  parseSecModuleDescriptor
} from './contract.ts';

function repositoryModuleTestDescriptor(
  root: string
): ReturnType<typeof parseSecModuleDescriptor> {
  return parseSecModuleDescriptor({
    importGraph: 'runtime',
    externalEntrypoints: []
  }, `${root}/sec.module.json`);
}

test('repository module descriptors resolve unique physical roots and external entrypoints', () => {
  const membership = compileSecRepositoryModuleMembership(compilerRoot);

  expect(new Set(membership.descriptors.map(({ moduleId }) => moduleId)).size)
    .toBe(membership.descriptors.length);
  for (const descriptor of membership.descriptors) {
    expect(membership.moduleForPath(descriptor.root)?.moduleId, descriptor.root)
      .toBe(descriptor.moduleId);
    for (const entrypoint of descriptor.externalEntrypoints) {
      expect(membership.moduleForPath(entrypoint)?.moduleId, entrypoint)
        .toBe(descriptor.moduleId);
    }
  }
});

test('repository module descriptor parser rejects unknown fields and invalid paths', () => {
  const descriptor = {
    importGraph: 'runtime',
    externalEntrypoints: []
  } as const;
  const descriptorPath = 'src/example/sec.module.json';

  expect(parseSecModuleDescriptor(descriptor, descriptorPath).root).toBe('src/example');
  expect(() => parseSecModuleDescriptor({ ...descriptor, covered: true }, descriptorPath))
    .toThrow('unknown field');
  expect(() => parseSecModuleDescriptor({
    ...descriptor,
    externalEntrypoints: ['src/development/runner/cli.ts', 'src/development/runner/cli.ts']
  }, descriptorPath))
    .toThrow('entries must be unique');
  expect(() => parseSecModuleDescriptor(descriptor, '../sec.module.json'))
    .toThrow('descriptorPath');
});

test('repository module compiler prevents production from importing test authority', () => {
  const files = [
    'platform/example/index.ts',
    'platform/example/test/provider.ts'
  ];
  const sources = new Map([
    ['platform/example/index.ts', "export { provider } from './test/provider.ts';"],
    ['platform/example/test/provider.ts', 'export const provider = true;']
  ]);

  expect(() => compileSecRepositoryModuleGraph({
    files,
    readSource: (file) => sources.get(file) ?? null
  })).toThrow('production repository module imports test-only module');
});

test('repository module compiler does not infer visibility from directory names', () => {
  const files = [
    'src/consumer/index.ts',
    'src/provider/runtime/effect.ts'
  ];
  const sources = new Map([
    ['src/consumer/index.ts', "export { effect } from '../provider/runtime/effect.ts';"],
    ['src/provider/runtime/effect.ts', 'export const effect = true;']
  ]);
  const graph = compileSecRepositoryModuleGraph({
    files,
    readSource: (file) => sources.get(file) ?? null
  });
  const consumer = repositoryModuleTestDescriptor('src/consumer');
  const provider = repositoryModuleTestDescriptor('src/provider');

  expect(() => assertSecRepositoryModuleImportBoundaries(graph, {
    descriptors: [consumer, provider],
    graphRoots: ['src/consumer', 'src/provider'],
    moduleRoots: ['src/consumer', 'src/provider'],
    moduleForPath: (file) => file.startsWith('src/consumer/') ? consumer : provider
  })).not.toThrow();
});

test('src capabilities reject aggregate barrels while direct declaration owners remain addressable', () => {
  const files = [
    'src/consumer/index.ts',
    'src/provider/index.ts',
    'src/provider/contract.ts',
    'src/provider/runtime/effect.ts'
  ];
  const consumer = repositoryModuleTestDescriptor('src/consumer');
  const provider = repositoryModuleTestDescriptor('src/provider');
  const membership = {
    descriptors: [consumer, provider],
    graphRoots: ['src'],
    moduleRoots: ['src/consumer', 'src/provider'],
    moduleForPath: (file: string) => file.startsWith('src/consumer/') ? consumer : provider
  };

  const publicGraph = compileSecRepositoryModuleGraph({
    files,
    readSource: (file) => file === 'src/consumer/index.ts'
      ? "export type { Contract } from '../provider/contract.ts';"
      : file === 'src/provider/contract.ts'
        ? 'export interface Contract { readonly value: string; }'
        : 'export const effect = true;'
  });
  expect(() => assertSecRepositoryModuleImportBoundaries(publicGraph, membership)).not.toThrow();

  const aggregateGraph = compileSecRepositoryModuleGraph({
    files,
    readSource: (file) => file === 'src/consumer/index.ts'
      ? "export type { Contract } from '../provider/index.ts';"
      : file === 'src/provider/contract.ts'
        ? 'export interface Contract { readonly value: string; }'
        : 'export type { Contract } from \'./contract.ts\';'
  });
  expect(() => assertSecRepositoryModuleImportBoundaries(aggregateGraph, membership))
    .toThrow('[cross-package-aggregate-surface]');

  const implementationGraph = compileSecRepositoryModuleGraph({
    files,
    readSource: (file) => file === 'src/consumer/index.ts'
      ? "export { effect } from '../provider/runtime/effect.ts';"
      : file === 'src/provider/contract.ts'
        ? 'export interface Contract { readonly value: string; }'
        : 'export const effect = true;'
  });
  expect(() => assertSecRepositoryModuleImportBoundaries(implementationGraph, membership))
    .not.toThrow();
});

test('pre-dependency entrypoints cannot import an unavailable package', () => {
  const descriptor = parseSecModuleDescriptor({
    importGraph: 'runtime',
    externalEntrypoints: ['src/bootstrap/cli.ts'],
    preDependencyBootstrap: true
  }, 'src/bootstrap/sec.module.json');
  const graph = compileSecRepositoryModuleGraph({
    files: ['src/bootstrap/cli.ts'],
    readSource: () => "import 'unmaterialized-package';"
  });
  expect(() => assertSecRepositoryModuleImportBoundaries(graph, {
    descriptors: [descriptor],
    graphRoots: ['src/bootstrap'],
    moduleRoots: ['src/bootstrap'],
    moduleForPath: () => descriptor
  })).toThrow('[pre-dependency-bootstrap-unavailable-package]');

  const postBootstrapGraph = compileSecRepositoryModuleGraph({
    files: ['src/bootstrap/cli.ts'],
    readSource: () => "void import('materialized-after-bootstrap');"
  });
  expect(() => assertSecRepositoryModuleImportBoundaries(postBootstrapGraph, {
    descriptors: [descriptor],
    graphRoots: ['src/bootstrap'],
    moduleRoots: ['src/bootstrap'],
    moduleForPath: () => descriptor
  })).not.toThrow();
});

test('repository module admission rejects retired src/apps and src/modules roots', () => {
  for (const retiredRoot of ['src/apps', 'src/modules']) {
    expect(() => compileSecRepositoryModuleGraph({
      files: [`${retiredRoot}/legacy.ts`],
      readSource: () => 'export {};'
    })).toThrow('retired repository root');

    expect(() => parseSecModuleDescriptor({
      importGraph: 'runtime',
      externalEntrypoints: []
    }, `${retiredRoot}/sec.module.json`)).toThrow('retired repository root');
  }
});

test('repository module boundary compiler does not turn internal path spelling into policy', () => {
  const consumer = repositoryModuleTestDescriptor('src/consumer');
  const provider = repositoryModuleTestDescriptor('src/provider');
  const graph = compileSecRepositoryModuleGraph({
    files: [
      'src/consumer/index.ts',
      'src/provider/index.ts',
      'src/provider/internal/private.ts',
      'src/provider/operation.ts'
    ],
    readSource: (file) => file === 'src/consumer/index.ts'
      ? [
        "import '../provider/internal/private.ts';",
        "import '../provider/operation.ts';"
      ].join('\n')
      : 'export {};'
  });
  const violations = collectSecRepositoryModuleBoundaryViolations(graph, {
    descriptors: [consumer, provider],
    graphRoots: ['src'],
    moduleRoots: [consumer.root, provider.root],
    moduleForPath: (file) => file.startsWith('src/consumer/') ? consumer : provider
  });

  expect(violations).toEqual([]);
});

test('repository module dependency cycles exclude test observation edges', () => {
  const first = repositoryModuleTestDescriptor('src/first');
  const second = repositoryModuleTestDescriptor('src/second');
  const tests = repositoryModuleTestDescriptor('tests');
  const membership = {
    descriptors: [first, second, tests],
    graphRoots: ['src', 'tests'],
    moduleRoots: [first.root, second.root, tests.root],
    moduleForPath: (file: string) => file.startsWith('src/first/')
      ? first
      : file.startsWith('src/second/') ? second : tests
  };
  const observationGraph = compileSecRepositoryModuleGraph({
    files: ['src/first/index.ts', 'src/second/index.ts', 'tests/observation.test.ts'],
    readSource: (file) => file === 'src/first/index.ts'
      ? "import '../second/index.ts';"
      : file === 'tests/observation.test.ts'
        ? "import '../src/first/index.ts';"
        : 'export {};'
  });
  expect(collectSecRepositoryModuleBoundaryViolations(observationGraph, membership)
    .some(({ code }) => code === 'module-dependency-cycle')).toBe(false);

  const productionCycleGraph = compileSecRepositoryModuleGraph({
    files: ['src/first/index.ts', 'src/second/index.ts'],
    readSource: (file) => file === 'src/first/index.ts'
      ? "import '../second/index.ts';"
      : "import '../first/index.ts';"
  });
  expect(collectSecRepositoryModuleBoundaryViolations(productionCycleGraph, membership)
    .filter(({ code }) => code === 'module-dependency-cycle')).toHaveLength(1);
});
