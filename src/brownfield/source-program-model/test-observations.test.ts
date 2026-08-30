import { expect, test } from 'bun:test';

import { rawSha256, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import { compileSecRepositoryModuleMembershipSnapshot } from '../../system-architecture/repository-modules/contract.ts';
import { compileSourceProgramTestObservations } from './test-observations.ts';
import { compileTypeScriptSourceProgramModel } from './typescript.ts';

function compileFixture(testSources: Readonly<Record<string, string>>) {
  const productionSources = Object.freeze({
    'src/example/operation.ts': [
      'export function execute(value: number): number { return value + 1; }',
      'export async function runOperation(subject: string): Promise<string> { return subject; }',
      ''
    ].join('\n')
  });
  const descriptorPath = 'src/example/sec.module.json';
  const descriptorSource = JSON.stringify({
    importGraph: 'runtime',
    externalEntrypoints: [],
    capabilityProviders: [{
      capability: 'example.operation',
      operations: ['runOperation']
    }],
    preDependencyBootstrap: false
  });
  const exactSources = Object.freeze({ ...productionSources, ...testSources });
  const exactFiles = Object.entries(exactSources)
    .sort(([left], [right]) => left.localeCompare(right, 'en-US'))
    .map(([path, source]) => Object.freeze({ path, source, contentDigest: rawSha256(source) }));
  const productionFiles = exactFiles.filter(({ path }) => path.startsWith('src/'));
  const membership = compileSecRepositoryModuleMembershipSnapshot({
    repositoryFiles: [...exactFiles.map(({ path }) => path), descriptorPath],
    descriptorSources: [{ descriptorPath, source: descriptorSource }]
  });
  const sourceRevision = sha256(exactFiles.map(({ path, contentDigest }) => ({
    path,
    contentDigest
  })));
  const productionModel = compileTypeScriptSourceProgramModel({
    sourceRevision,
    files: productionFiles,
    moduleMembership: membership
  });
  return compileSourceProgramTestObservations({
    productionModel,
    files: exactFiles,
    moduleMembership: membership
  });
}

test('lightweight test observations bind aliased imports to signed production declarations', () => {
  const projection = compileFixture({
    'tests/alias.test.ts': [
      "import { expect, test } from 'bun:test';",
      "import { execute as run } from '../src/example/operation.ts';",
      "test('alias', () => expect(run(1)).toBe(2));",
      ''
    ].join('\n')
  });

  expect(projection.references).toContainEqual(expect.objectContaining({
    kind: 'call',
    name: 'execute',
    moduleSpecifier: '../src/example/operation.ts',
    targetPath: 'src/example/operation.ts',
    observationClass: 'observed'
  }));
  expect(projection.registrations).toEqual([
    expect.objectContaining({
      path: 'tests/alias.test.ts',
      index: 0,
      kind: 'test',
      title: 'alias',
      semanticClasses: ['behavior'],
      observedProductionPaths: ['src/example/operation.ts'],
      capabilityOperations: [],
      assertions: [expect.objectContaining({
        matcher: 'toBe',
        versionIdentityOnly: false,
        importedFunctionArity: false,
        productionPathLayoutTarget: null
      })]
    })
  ]);
  expect(projection.unknowns).toEqual([]);
  expect(projection.observationDigest).toMatch(/^sha256:[0-9a-f]{64}$/u);
});

test('lightweight test observations resolve namespace calls without a second TypeChecker', () => {
  const projection = compileFixture({
    'tests/namespace.test.ts': [
      "import { expect, test } from 'bun:test';",
      "import * as operation from '../src/example/operation.ts';",
      "test('namespace', () => expect(operation.execute(1)).toBe(2));",
      ''
    ].join('\n')
  });

  expect(projection.references).toContainEqual(expect.objectContaining({
    kind: 'call',
    name: 'execute',
    targetPath: 'src/example/operation.ts',
    observationClass: 'observed'
  }));
  expect(projection.unknowns).toEqual([]);
});

test('lightweight test observations retain filesystem and repository-provider effects', () => {
  const projection = compileFixture({
    'tests/effect.test.ts': [
      "import { test } from 'bun:test';",
      "import { readFile } from 'node:fs/promises';",
      "import { runOperation } from '../src/example/operation.ts';",
      "test('effect', async () => { await readFile('state.json'); await runOperation('subject'); await fetch('https://example.invalid'); });",
      ''
    ].join('\n')
  });

  expect(projection.capabilities).toContainEqual(expect.objectContaining({
    capability: 'filesystem',
    operation: 'readFile',
    transport: 'runtime-built-in-api',
    moduleSpecifier: 'node:fs/promises'
  }));
  expect(projection.capabilities).toContainEqual(expect.objectContaining({
    capability: 'provider',
    operation: 'runOperation',
    transport: 'repository-provider',
    providerCapability: 'example.operation',
    providerModuleId: 'example'
  }));
  expect(projection.capabilities).toContainEqual(expect.objectContaining({
    capability: 'network',
    operation: 'fetch',
    transport: 'runtime-built-in-api'
  }));
});

test('lightweight test observations bind reexports through the canonical module graph', () => {
  const projection = compileFixture({
    'tests/reexport.test.ts': "export { execute as publicExecute } from '../src/example/operation.ts';\n"
  });

  expect(projection.references).toContainEqual(expect.objectContaining({
    kind: 'reexport',
    name: 'execute',
    moduleSpecifier: '../src/example/operation.ts',
    targetPath: 'src/example/operation.ts',
    observationClass: 'observed'
  }));
});

test('lightweight test observations preserve dynamic imports as typed unknowns', () => {
  const source = [
    "import { test } from 'bun:test';",
    "test('dynamic', async () => { const specifier = '../src/example/operation.ts'; await import(specifier); });",
    ''
  ].join('\n');
  const first = compileFixture({ 'tests/dynamic.test.ts': source });
  const replay = compileFixture({ 'tests/dynamic.test.ts': source });

  expect(first.unknowns).toContainEqual(expect.objectContaining({
    code: 'test-dynamic-module-unresolved',
    path: 'tests/dynamic.test.ts'
  }));
  expect(replay).toEqual(first);
});
