import { expect, test } from 'bun:test';

import { compilerRoot } from '../../platform/workspace/paths.ts';
import {
  SEC_MODULE_SCHEMA_V1,
  assertSecRepositoryModuleImportBoundariesV1,
  compileSecRepositoryModuleGraphV1,
  compileSecRepositoryModuleMembershipV1,
  parseSecModuleDescriptorV1
} from '../../platform/architecture/repository-modules/contract.ts';

test('repository module descriptors resolve unique physical roots and external entrypoints', () => {
  const membership = compileSecRepositoryModuleMembershipV1(compilerRoot);

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

test('repository module descriptor parser rejects caller-created schema surface', () => {
  const descriptor = {
    schema: SEC_MODULE_SCHEMA_V1,
    moduleId: 'example.module',
    importGraph: 'runtime',
    externalEntrypoints: []
  } as const;
  const descriptorPath = 'platform/example/sec.module.json';

  expect(parseSecModuleDescriptorV1(descriptor, descriptorPath).root).toBe('platform/example');
  expect(() => parseSecModuleDescriptorV1({ ...descriptor, covered: true }, descriptorPath))
    .toThrow('unknown field');
  expect(() => parseSecModuleDescriptorV1({
    ...descriptor,
    externalEntrypoints: ['platform/dev-runner.ts', 'platform/dev-runner.ts']
  }, descriptorPath))
    .toThrow('entries must be unique');
  expect(() => parseSecModuleDescriptorV1(descriptor, '../sec.module.json'))
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

  expect(() => compileSecRepositoryModuleGraphV1({
    files,
    readSource: (file) => sources.get(file) ?? null
  })).toThrow('production repository module imports test-only module');
});

test('repository module compiler prevents cross-package implementation imports', () => {
  const files = [
    'platform/consumer/index.ts',
    'platform/provider/runtime/effect.ts'
  ];
  const sources = new Map([
    ['platform/consumer/index.ts', "export { effect } from '../provider/runtime/effect.ts';"],
    ['platform/provider/runtime/effect.ts', 'export const effect = true;']
  ]);
  const graph = compileSecRepositoryModuleGraphV1({
    files,
    readSource: (file) => sources.get(file) ?? null
  });
  const descriptor = (
    root: string,
    moduleId: string
  ): ReturnType<typeof parseSecModuleDescriptorV1> => parseSecModuleDescriptorV1({
    schema: SEC_MODULE_SCHEMA_V1,
    moduleId,
    importGraph: 'runtime',
    externalEntrypoints: []
  }, `${root}/sec.module.json`);
  const consumer = descriptor('platform/consumer', 'example.consumer');
  const provider = descriptor('platform/provider', 'example.provider');

  expect(() => assertSecRepositoryModuleImportBoundariesV1(graph, {
    descriptors: [consumer, provider],
    graphRoots: ['platform/consumer', 'platform/provider'],
    moduleRoots: ['platform/consumer', 'platform/provider'],
    moduleForPath: (file) => file.startsWith('platform/consumer/') ? consumer : provider
  })).toThrow('cross-package import bypasses public facade through runtime');
});

test('pre-dependency entrypoints cannot import an unavailable package', () => {
  const descriptor = parseSecModuleDescriptorV1({
    schema: SEC_MODULE_SCHEMA_V1,
    moduleId: 'example.bootstrap',
    importGraph: 'runtime',
    externalEntrypoints: ['platform/bootstrap/index.ts'],
    preDependencyBootstrap: true
  }, 'platform/bootstrap/sec.module.json');
  const graph = compileSecRepositoryModuleGraphV1({
    files: ['platform/bootstrap/index.ts'],
    readSource: () => "import 'unmaterialized-package';"
  });
  expect(() => assertSecRepositoryModuleImportBoundariesV1(graph, {
    descriptors: [descriptor],
    graphRoots: ['platform/bootstrap'],
    moduleRoots: ['platform/bootstrap'],
    moduleForPath: () => descriptor
  })).toThrow('pre-dependency bootstrap imports unavailable package');

  const postBootstrapGraph = compileSecRepositoryModuleGraphV1({
    files: ['platform/bootstrap/index.ts'],
    readSource: () => "void import('materialized-after-bootstrap');"
  });
  expect(() => assertSecRepositoryModuleImportBoundariesV1(postBootstrapGraph, {
    descriptors: [descriptor],
    graphRoots: ['platform/bootstrap'],
    moduleRoots: ['platform/bootstrap'],
    moduleForPath: () => descriptor
  })).not.toThrow();
});
