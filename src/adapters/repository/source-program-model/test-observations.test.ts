import { expect, test } from 'bun:test';

import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import { compileRepositoryModuleMembershipSnapshot } from '../architecture/contract.ts';
import { createSourceProgramCompilationOperation } from './compilation-operation.ts';
import {
  compileTestObservations,
  observeTestContractCensus
} from './test-observations.ts';
import { compileTypeScriptModel } from './typescript.ts';

function compileFixture(
  testSources: Readonly<Record<string, string>>,
  operation?: ReturnType<typeof createSourceProgramCompilationOperation>
) {
  const productionSources = Object.freeze({
    'src/example/operation.ts': [
      'export function execute(value: number): number { return value + 1; }',
      'export async function runOperation(subject: string): Promise<string> { return subject; }',
      ''
    ].join('\n')
  });
  const descriptorPath = 'src/example/module.json';
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
  const membership = compileRepositoryModuleMembershipSnapshot({
    repositoryFiles: [...exactFiles.map(({ path }) => path), descriptorPath],
    descriptorSources: [{ descriptorPath, source: descriptorSource }]
  });
  const sourceRevision = sha256(exactFiles.map(({ path, contentDigest }) => ({
    path,
    contentDigest
  })));
  const productionModel = compileTypeScriptModel({
    sourceRevision,
    files: exactFiles,
    moduleMembership: membership
  });
  return compileTestObservations({
    productionModel,
    files: exactFiles,
    moduleMembership: membership,
    ...(operation === undefined ? {} : { operation })
  });
}

test('test observation indexing consumes the enclosing compilation cancellation', () => {
  const controller = new AbortController();
  controller.abort();
  const operation = createSourceProgramCompilationOperation({
    deadlineAtUnixMs: Date.now() + 60_000,
    signal: controller.signal
  });

  expect(() => compileFixture({
    'tests/cancelled.test.ts': [
      "import { test } from 'bun:test';",
      "test('cancelled', () => {});",
      ''
    ].join('\n')
  }, operation)).toThrow('source-program-compilation-cancelled:test-observations');
});

test('baseline contract census requires two exact compiler generations', () => {
  const baselineSource = [
    "import { test } from 'bun:test';",
    "import { value } from '../src/example.ts';",
    "test('value', () => value);",
    ''
  ].join('\n');
  const candidateSource = 'export const value = 1;\n';
  const baselineFiles = [Object.freeze({
    path: 'tests/example.test.ts',
    source: baselineSource,
    contentDigest: rawSha256(baselineSource)
  })];
  const candidateFiles = [Object.freeze({
    path: 'src/example.ts',
    source: candidateSource,
    contentDigest: rawSha256(candidateSource)
  })];
  const membership = Object.freeze({
    descriptors: Object.freeze([]),
    graphRoots: Object.freeze([]),
    moduleRoots: Object.freeze([]),
    moduleForPath: () => null
  });
  const compile = (files: typeof baselineFiles | typeof candidateFiles) =>
    compileTypeScriptModel({
      sourceRevision: sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest }))),
      files,
      moduleMembership: membership
    });
  const baselineModel = compile(baselineFiles);
  const candidateModel = compile(candidateFiles);

  expect(observeTestContractCensus(
    baselineModel,
    candidateModel,
    'tests/example.test.ts'
  )).toEqual(expect.objectContaining({
    status: 'resolved',
    census: { producerCount: 0, consumerCount: 1, externalContractCount: 0 }
  }));
  expect(observeTestContractCensus(
    { ...baselineModel },
    candidateModel,
    'tests/example.test.ts'
  )).toEqual(expect.objectContaining({
    status: 'unresolved',
    reason: 'baseline-exact-generation-unavailable'
  }));
  expect(observeTestContractCensus(
    baselineModel,
    { ...candidateModel },
    'tests/example.test.ts'
  )).toEqual(expect.objectContaining({
    status: 'unresolved',
    reason: 'candidate-exact-generation-unavailable'
  }));
});

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
    name: 'run',
    moduleSpecifier: '../src/example/operation.ts',
    targetPath: 'src/example/operation.ts',
    observationClass: 'derived',
    sourceRelation: 'declaration'
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
  expect(projection.unknowns).not.toContainEqual(expect.objectContaining({
    code: 'test-production-binding-unresolved'
  }));
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
    observationClass: 'derived',
    sourceRelation: 'declaration'
  }));
  expect(projection.unknowns).not.toContainEqual(expect.objectContaining({
    code: 'test-production-binding-unresolved'
  }));
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

test('compiler observations bind current-Bun local TypeScript program argv', () => {
  const projection = compileFixture({
    'tests/local-program.test.ts': [
      "import { spawnSync as launch } from 'node:child_process';",
      "import process from 'node:process';",
      "import * as Bun from 'bun';",
      "import path from 'node:path';",
      "const program = path.resolve(process.cwd(), 'src/example/operation.ts');",
      "const helper = path.resolve(process.cwd(), 'tests/helper-program.ts');",
      "launch(process.execPath, [program, '--check']);",
      "launch(process.execPath, [helper]);",
      "Bun.spawnSync([process.execPath, helper]);",
      "Bun.spawn({ cmd: [process.execPath, '--no-env-file', program], stdout: 'pipe' });"
    ].join('\n'),
    'tests/helper-program.ts': 'export const helper = true;',
    'tests/unit/ambient-program.test.ts': [
      "import { spawnSync } from 'node:child_process';",
      "import path from 'node:path';",
      "import { test } from 'bun:test';",
      "const unusedFactory = test.skipIf(false);",
      "test.skipIf(process.platform !== 'win32')('ambient program', () => {",
      "  const program = path.resolve(import.meta.dir, '../../src/example/operation.ts');",
      "  spawnSync(process.execPath, [program]);",
      "  Bun.spawnSync([process.execPath, program]);",
      "});"
    ].join('\n')
  });

  expect(projection.localProgramInvocations.map(({ path, target }) => ({ path, target })))
    .toEqual([
      { path: 'tests/local-program.test.ts', target: 'src/example/operation.ts' },
      { path: 'tests/local-program.test.ts', target: 'tests/helper-program.ts' },
      { path: 'tests/local-program.test.ts', target: 'tests/helper-program.ts' },
      { path: 'tests/local-program.test.ts', target: 'src/example/operation.ts' },
      { path: 'tests/unit/ambient-program.test.ts', target: 'src/example/operation.ts' },
      { path: 'tests/unit/ambient-program.test.ts', target: 'src/example/operation.ts' }
    ]);
  expect(projection.unknowns).not.toContainEqual(expect.objectContaining({
    code: 'test-local-program-invocation-unresolved'
  }));
  expect(projection.registrations.filter(({ path }) => path === 'tests/unit/ambient-program.test.ts'))
    .toEqual([expect.objectContaining({ kind: 'test.skipIf', title: 'ambient program' })]);
});

test('conditional, table and fixture factories register only their returned cases', () => {
  const projection = compileFixture({
    'tests/modifiers.test.ts': [
      "import { test, it, expect } from 'vitest';",
      "test.runIf(true)('conditional', () => { expect(1).toBe(1); });",
      "it.for([[1]])('table', ([value]) => { expect(value).toBe(1); });",
      "test.each([[1]])('each', (value) => { expect(value).toBe(1); });",
      "test.extend({ value: 1 })('fixture', ({ value }) => { expect(value).toBe(1); });",
      "const conditionalFactory = test.runIf(false);",
      "const tableFactory = test.for([[1]]);",
      "const fixtureFactory = test.extend({ value: 1 });",
      "test.override({ value: 2 });",
      "test.scoped({ value: 2 });",
      "test.skip('skipped', () => {});",
      "test.todo('todo');"
    ].join('\n')
  });
  expect(projection.registrations.map(({ kind, title }) => ({ kind, title }))).toEqual([
    { kind: 'test.runIf', title: 'conditional' },
    { kind: 'it.for', title: 'table' },
    { kind: 'test.each', title: 'each' },
    { kind: 'test.extend', title: 'fixture' },
    { kind: 'test.skip', title: 'skipped' },
    { kind: 'test.todo', title: 'todo' }
  ]);
});

test('local program observations reject shadowed, dynamic, external, and foreign executables', () => {
  const projection = compileFixture({
    'tests/local-program-negative.test.ts': [
      "import { spawnSync as runChild } from 'node:child_process';",
      "import { exec as spawnSync } from 'node:child_process';",
      "import process from 'node:process';",
      "import * as Bun from 'bun';",
      "const dynamicProgram = process.env.SEC_DYNAMIC_PROGRAM;",
      "runChild(process.execPath, [dynamicProgram]);",
      "runChild(process.execPath, ['../outside.ts']);",
      "runChild('bun', ['src/example/operation.ts']);",
      "spawnSync(process.execPath, ['src/example/operation.ts']);",
      "function shadowProcess(process: { execPath: string }) {",
      "  runChild(process.execPath, ['src/example/operation.ts']);",
      "}",
      "function shadowBun(Bun: { spawnSync(command: string[]): void }) {",
      "  Bun.spawnSync([process.execPath, 'src/example/operation.ts']);",
      "}",
      "const options = { cmd: [process.execPath, 'src/example/operation.ts'] };",
      "Bun.spawnSync({ cmd: [process.execPath, 'src/example/operation.ts'], ...options });",
      "Bun.spawnSync({ cmd: [process.execPath, 'src/example/operation.ts'], cmd: [process.execPath, 'src/example/operation.ts'] });",
      "void shadowProcess; void shadowBun;"
    ].join('\n'),
    'tests/local-shadow.test.ts': [
      "import { spawnSync } from 'node:child_process';",
      "const process = { execPath: '/foreign/runtime' };",
      "const Bun = { spawnSync(command: string[]) {} };",
      "spawnSync(process.execPath, ['src/example/operation.ts']);",
      "Bun.spawnSync([process.execPath, 'src/example/operation.ts']);"
    ].join('\n'),
    'tests/declared-shadow.test.ts': [
      "import { spawnSync } from 'node:child_process';",
      "declare const process: { execPath: string };",
      "declare const Bun: { spawnSync(command: string[]): void };",
      "spawnSync(process.execPath, ['src/example/operation.ts']);",
      "Bun.spawnSync([process.execPath, 'src/example/operation.ts']);"
    ].join('\n')
  });

  expect(projection.localProgramInvocations).toEqual([]);
  expect(projection.unknowns.filter(({ code }) => (
    code === 'test-local-program-invocation-unresolved'
  ))).toHaveLength(4);
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
    observationClass: 'derived'
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

test('compiler provenance binds registrar wrappers, reachable Effects, terminals and pure siblings', () => {
  const sources = Object.freeze({
    'src/runtime/operations.ts': [
      "import { readFile } from 'node:fs/promises';",
      'export function compilePolicy(): void {}',
      'export function issueTerminal(): void {}',
      'export function readback(): void {}',
      "export async function performEffect(): Promise<void> { await readFile('state.json'); }",
      ''
    ].join('\n'),
    'tests/helpers/wrapper.ts': [
      "import { compilePolicy, issueTerminal, readback } from '../../src/runtime/operations.ts';",
      'export function registerEffect(register: (title: string, run: () => Promise<void>) => void, title: string, run: () => Promise<void>): void {',
      '  compilePolicy();',
      '  register(title, async () => { await run(); issueTerminal(); readback(); });',
      '}',
      'export function registerUnsettled(register: (title: string, run: () => Promise<void>) => void, title: string, run: () => Promise<void>): void {',
      '  compilePolicy();',
      '  register(title, run);',
      '}',
      ''
    ].join('\n'),
    'tests/provenance.test.ts': [
      "import { expect, test } from 'bun:test';",
      "import { performEffect } from '../src/runtime/operations.ts';",
      "import { registerEffect, registerUnsettled } from './helpers/wrapper.ts';",
      "registerEffect(test, 'effect', async () => { await performEffect(); });",
      "registerUnsettled(test, 'unsettled', async () => { await performEffect(); });",
      "test('pure sibling', () => expect(1).toBe(1));",
      "test('dynamic unknown', async () => { const target = './helpers/wrapper.ts'; await import(target); });",
      ''
    ].join('\n')
  });
  const files = Object.entries(sources).map(([path, source]) => Object.freeze({
    path,
    source,
    contentDigest: rawSha256(source)
  }));
  const descriptors = [{
    descriptorPath: 'src/runtime/module.json',
    source: JSON.stringify({
      importGraph: 'runtime',
      externalEntrypoints: [],
      capabilityProviders: [{
        capability: 'verification.effectful-test-runtime',
        operations: ['compilePolicy', 'issueTerminal', 'readback', 'performEffect'],
        effectKinds: [],
        operationRoles: [
          { operation: 'compilePolicy', role: 'domain-owner', semanticOperation: 'verification.effectful-test', requirementId: null, recovery: null },
          { operation: 'issueTerminal', role: 'terminal-issuer', semanticOperation: 'verification.effectful-test', requirementId: null, recovery: null },
          { operation: 'readback', role: 'readback-issuer', semanticOperation: 'verification.effectful-test', requirementId: 'verification.effectful-test-runtime', recovery: null }
        ]
      }],
      preDependencyBootstrap: false
    })
  }, {
    descriptorPath: 'tests/module.json',
    source: JSON.stringify({
      importGraph: 'runtime',
      externalEntrypoints: [],
      capabilityProviders: [{
        capability: 'verification.test-registration',
        operations: ['registerEffect', 'registerUnsettled'],
        effectKinds: [],
        operationRoles: [{
          operation: 'registerEffect',
          role: 'registration-issuer',
          semanticOperation: 'verification.effectful-test',
          requirementId: null,
          recovery: null
        }, {
          operation: 'registerUnsettled',
          role: 'registration-issuer',
          semanticOperation: 'verification.effectful-test-unsettled',
          requirementId: null,
          recovery: null
        }]
      }],
      preDependencyBootstrap: false
    })
  }];
  const membership = compileRepositoryModuleMembershipSnapshot({
    repositoryFiles: [...files.map(({ path }) => path), ...descriptors.map(({ descriptorPath }) => descriptorPath)],
    descriptorSources: descriptors
  });
  const sourceRevision = sha256(files.map(({ path, contentDigest }) => ({ path, contentDigest })));
  const model = compileTypeScriptModel({ sourceRevision, files, moduleMembership: membership });
  const projection = compileTestObservations({
    productionModel: model,
    files,
    moduleMembership: membership
  });

  const effect = projection.registrations.find(({ kind }) => kind === 'registerEffect');
  expect(effect).toBeDefined();
  expect(effect?.registrationProvenance.map(({ operation }) => operation)).toEqual(['registerEffect']);
  expect(effect?.supervisorPolicyProvenance.map(({ operation }) => operation)).toContain('compilePolicy');
  expect(effect?.terminalProvenance.map(({ operation }) => operation)).toContain('issueTerminal');
  expect(effect?.readbackProvenance.map(({ operation }) => operation)).toContain('readback');
  expect(effect?.capabilityObservationIds.length).toBeGreaterThan(0);
  expect(effect?.semanticClasses).toContain('effect');

  const unsettled = projection.registrations.find(({ kind }) => kind === 'registerUnsettled');
  expect(unsettled?.supervisorPolicyProvenance).toEqual([]);
  expect(unsettled?.terminalProvenance).toEqual([]);
  expect(unsettled?.readbackProvenance).toEqual([]);
  expect(unsettled?.unknowns).toEqual([
    'test-readback-provenance-unresolved',
    'test-supervisor-policy-provenance-unresolved',
    'test-terminal-provenance-unresolved'
  ]);

  const pure = projection.registrations.find(({ title }) => title === 'pure sibling');
  expect(pure?.capabilityObservationIds).toEqual([]);
  expect(pure?.semanticClasses).not.toContain('effect');

  const dynamic = projection.registrations.find(({ title }) => title === 'dynamic unknown');
  expect(dynamic?.unknownEdges.some((edge) => edge.startsWith('dynamic-module-unresolved:'))).toBe(true);
});
