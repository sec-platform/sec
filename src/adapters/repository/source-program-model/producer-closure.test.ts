import { expect, test } from 'bun:test';

import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import { compileSecRepositoryModuleMembershipSnapshot } from '../architecture/contract.ts';
import {
  compileSourceProgramOperationProducerClosure,
  requireSourceProgramOperationProducerClosure
} from './producer-closure.ts';
import { compileVirtualRepositorySourceProgramCompilation } from './repository-compilation.ts';
import { compileVirtualWorkspaceSourceSnapshot } from './workspace-source-snapshot.ts';

const OPERATION = Object.freeze({ capability: 'fixture.normalize', operation: 'verify' });

function fixture(
  implementation: string,
  unrelated = 'export const unrelated = true;\n',
  runtime = "import { normalize } from './kernel.ts';\nexport const verify = normalize;\n",
  other = 'export const inspect = true;\n'
) {
  const descriptor = JSON.stringify({
    importGraph: 'runtime',
    externalEntrypoints: ['src/normalize/runtime.ts', 'src/normalize/other.ts'],
    capabilityProviders: [{ capability: OPERATION.capability, operations: [OPERATION.operation] }]
  });
  const sources = new Map([
    ['src/normalize/module.json', descriptor],
    ['src/normalize/runtime.ts', runtime],
    ['src/normalize/other.ts', other],
    ['src/normalize/kernel.ts', implementation],
    ['src/unrelated.ts', unrelated]
  ]);
  const files = [...sources].map(([path, source]) => Object.freeze({
    path,
    mode: '100644' as const,
    source,
    contentDigest: rawSha256(source)
  }));
  const membership = compileSecRepositoryModuleMembershipSnapshot({
    repositoryFiles: files.map(({ path }) => path),
    descriptorSources: [{
      descriptorPath: 'src/normalize/module.json',
      source: descriptor
    }]
  });
  const workspaceSnapshot = compileVirtualWorkspaceSourceSnapshot({
    subject: Object.freeze({
      kind: 'virtual-mutation',
      provenance: Object.freeze({
        kind: 'source-program-virtual-mutation',
        baseSnapshotDigest: sha256('base') as `sha256:${string}`,
        mutationDigest: sha256(
          files.map(({ path, contentDigest }) => ({ path, contentDigest }))
        ) as `sha256:${string}`
      })
    }),
    files,
    moduleMembership: membership
  });
  return compileVirtualRepositorySourceProgramCompilation({ workspaceSnapshot });
}

test('operation producer closure is the one descriptor-owned operation entrypoint and reachable graph', () => {
  const closure = compileSourceProgramOperationProducerClosure(
    fixture('export function normalize(): void {}\n'),
    OPERATION
  );
  expect(closure.authority).toBe('source-evidence-only');
  expect(closure.entrypoint.address).toBe(
    'module-entrypoint:src/normalize/module.json#normalize:src/normalize/runtime.ts'
  );
  expect(closure.entrypoint.source).toContain('export const verify = normalize');
  expect(closure.descriptor.path).toBe('src/normalize/module.json');
  expect(closure.implementationFiles.map(({ path }) => path)).toEqual([
    'src/normalize/kernel.ts',
    'src/normalize/runtime.ts'
  ]);
  expect(closure.implementationFiles.every(({ contentDigest, source }) => (
    rawSha256(source) === contentDigest
  ))).toBe(true);
  expect(requireSourceProgramOperationProducerClosure(closure)).toBe(closure);
  expect(() => requireSourceProgramOperationProducerClosure({ ...closure })).toThrow(
    'not Source Program compiler-issued'
  );

  const changed = compileSourceProgramOperationProducerClosure(
    fixture('export function normalize(): void { console.log("changed"); }\n'),
    OPERATION
  );
  expect(changed.closureDigest).not.toBe(closure.closureDigest);

  const unrelatedChanged = compileSourceProgramOperationProducerClosure(
    fixture('export function normalize(): void {}\n', 'export const unrelated = false;\n'),
    OPERATION
  );
  expect(unrelatedChanged.closureDigest).toBe(closure.closureDigest);
});

test('operation producer entrypoint follows TypeChecker aliases and re-exports', () => {
  const aliased = compileSourceProgramOperationProducerClosure(
    fixture(
      'export function normalize(): void {}\n',
      undefined,
      "export { normalize as verify } from './kernel.ts';\n"
    ),
    OPERATION
  );
  const star = compileSourceProgramOperationProducerClosure(
    fixture(
      'export function verify(): void {}\n',
      undefined,
      "export * from './kernel.ts';\n"
    ),
    OPERATION
  );
  const localList = compileSourceProgramOperationProducerClosure(
    fixture(
      'export function normalize(): void {}\n',
      undefined,
      "import { normalize } from './kernel.ts';\nconst verify = normalize;\nexport { verify };\n"
    ),
    OPERATION
  );

  for (const closure of [aliased, star, localList]) {
    expect(closure.entrypoint.address).toBe(
      'module-entrypoint:src/normalize/module.json#normalize:src/normalize/runtime.ts'
    );
    expect(closure.implementationFiles.map(({ path }) => path)
      .includes('src/normalize/kernel.ts')).toBe(true);
  }
});

test('operation producer blocks unresolved and non-unique TypeChecker export projections', () => {
  const typeOnly = fixture(
    'export function normalize(): void {}\n',
    undefined,
    'export type verify = string;\n'
  );
  expect(() => compileSourceProgramOperationProducerClosure(typeOnly, OPERATION)).toThrow(
    expect.objectContaining({
      code: 'entrypoint-export-unresolved'
    })
  );
  const syntaxInvalid = fixture(
    'export function normalize(): void {}\n',
    undefined,
    'export const verify = ;\n'
  );
  expect(() => compileSourceProgramOperationProducerClosure(syntaxInvalid, OPERATION)).toThrow(
    expect.objectContaining({
      code: 'entrypoint-export-unresolved'
    })
  );

  const duplicate = fixture(
    'export function normalize(): void {}\n',
    undefined,
    "import { normalize } from './kernel.ts';\nexport const verify = normalize;\n",
    'export function verify(): void {}\n'
  );
  expect(() => compileSourceProgramOperationProducerClosure(duplicate, OPERATION)).toThrow(
    expect.objectContaining({
      code: 'entrypoint-not-unique'
    })
  );
});

test('operation producer rejects unresolved dynamic and runtime loader resources', () => {
  const computedLoader = fixture(
    'export function normalize(): void {}\n',
    undefined,
    "import { normalize } from './kernel.ts';\n"
      + 'export async function verify(specifier: string) {\n'
      + '  normalize();\n'
      + '  return import(specifier);\n'
      + '}\n'
  );
  expect(() => compileSourceProgramOperationProducerClosure(computedLoader, OPERATION)).toThrow(
    expect.objectContaining({ code: 'reachable-loader-resource-unresolved' })
  );

  const opaqueRuntime = fixture(
    'export function normalize(): void {}\n',
    undefined,
    "import { normalize } from './kernel.ts';\n"
      + 'export function verify() { normalize(); return eval("1"); }\n'
  );
  expect(() => compileSourceProgramOperationProducerClosure(opaqueRuntime, OPERATION)).toThrow(
    expect.objectContaining({ code: 'reachable-loader-resource-unresolved' })
  );
});

test('operation producer rejects caller-cloned compilation receipts', () => {
  const compilation = fixture('export function normalize(): void {}\n');
  expect(() => compileSourceProgramOperationProducerClosure(
    { ...compilation },
    OPERATION
  )).toThrow('compiler-issued compilation receipt');
});

for (const [name, kernel, runtime] of [
  ['type-only named re-export', 'export function normalize(): void {}\n', "export type { normalize as verify } from './kernel.ts';\n"],
  ['type-only star re-export', 'export function verify(): void {}\n', "export type * from './kernel.ts';\n"],
  ['ambient declared export', '', 'export declare function verify(): void;\n'],
  ['ambient declared variable', '', 'export declare const verify: () => void;\n'],
  ['invalid target syntax', 'export function normalize(): void { const x = ; }\n', "export { normalize as verify } from './kernel.ts';\n"]
] as const) test(`operation producer rejects ${name} as a runtime export`, () => {
  const compilation = fixture(kernel, undefined, runtime);
  expect(() => compileSourceProgramOperationProducerClosure(compilation, OPERATION)).toThrow(
    expect.objectContaining({ code: 'entrypoint-export-unresolved' })
  );
});

for (const runtime of [
  'export function verify(): void {}\n',
  'export class verify {}\n',
  'export const verify = () => undefined;\n',
  'export enum verify { Value = 1 }\n'
]) test(`operation producer retains executable value export: ${runtime.trim()}`, () => {
  const closure = compileSourceProgramOperationProducerClosure(fixture('', undefined, runtime), OPERATION);
  expect(closure.entrypoint.path).toBe('src/normalize/runtime.ts');
});

for (const [name, bridge] of [
  ['indirect type-only named export', "export type { normalize as verify } from './kernel.ts';\n"],
  ['indirect type-only star export', "export type * from './kernel.ts';\n"]
] as const) test(`operation producer rejects ${name} through a value re-export`, () => {
  const compilation = fixture('export function normalize(): void {}\nexport function verify(): void {}\n', undefined,
    "export { verify } from './other.ts';\n", bridge);
  expect(() => compileSourceProgramOperationProducerClosure(compilation, OPERATION)).toThrow(
    expect.objectContaining({ code: 'entrypoint-export-unresolved' })
  );
});

for (const runtime of [
  "export type * from './kernel.ts';\nexport function verify(): void {}\n",
  "export function verify(): void {}\nexport type * from './kernel.ts';\n"
]) test('explicit runtime exports supersede type-only stars in either source order', () => {
  const closure = compileSourceProgramOperationProducerClosure(
    fixture('export function verify(): void {}\n', undefined, runtime), OPERATION
  );
  expect(closure.entrypoint.path).toBe('src/normalize/runtime.ts');
});

test('type-only imports cannot become runtime exports through a local export list', () => {
  const compilation = fixture('export function normalize(): void {}\n', undefined,
    "import type { normalize as verify } from './kernel.ts';\nexport { verify };\n");
  expect(() => compileSourceProgramOperationProducerClosure(compilation, OPERATION)).toThrow(
    expect.objectContaining({ code: 'entrypoint-export-unresolved' })
  );
});

test('unrelated runtime reachability cannot rescue an indirect type-only export', () => {
  const compilation = fixture('export function verify(): void {}\n', undefined,
    "import './kernel.ts';\nexport { verify } from './other.ts';\n", "export type * from './kernel.ts';\n");
  expect(() => compileSourceProgramOperationProducerClosure(compilation, OPERATION)).toThrow(
    expect.objectContaining({ code: 'entrypoint-export-unresolved' })
  );
});

import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { TYPESCRIPT_WORKSPACE_COMPILER_OPTIONS } from './typescript-profile.ts';

for (const runtime of [
  'export const enum verify { Value = 1 }\n',
  'export namespace verify { export const Value = 1; }\n'
]) test(`review regression: emitted runtime value remains a producer: ${runtime.trim()}`, async () => {
  const output = ts.transpileModule(runtime, {
    compilerOptions: { ...TYPESCRIPT_WORKSPACE_COMPILER_OPTIONS, noEmit: false },
    fileName: 'runtime.mts'
  }).outputText;
  expect(output).toContain('export var verify;');
  const emitted = { verify: undefined as undefined | { Value: number } };
  runInNewContext(output.replace('export var verify;', 'var verify;'), emitted);
  expect(emitted.verify?.Value).toBe(1);
  const closure = compileSourceProgramOperationProducerClosure(fixture('', undefined, runtime), OPERATION);
  expect(closure.entrypoint.path).toBe('src/normalize/runtime.ts');
});

for (const sideEffect of ['', "import './kernel.ts';\n"]) {
  for (const binding of [
    "import { verify } from './other.ts';\nexport { verify };\n",
    "import { verify as local } from './other.ts';\nexport { local as verify };\n"
  ]) test('review regression: local value import/export cannot bypass an intermediate type-only star', () => {
    const compilation = fixture('export function verify(): void {}\n', undefined,
      sideEffect + binding, "export type * from './kernel.ts';\n");
    expect(() => compileSourceProgramOperationProducerClosure(compilation, OPERATION)).toThrow(
      expect.objectContaining({ code: 'entrypoint-export-unresolved' })
    );
  });
}

for (const bridge of [
  "export type * from './kernel.ts';\nexport default function real() { return 1; }\n",
  "export default function real() { return 1; }\nexport type * from './kernel.ts';\n"
]) test('review regression: explicit default remains available beside a type-only star', async () => {
  const output = ts.transpileModule(bridge, {
    compilerOptions: { ...TYPESCRIPT_WORKSPACE_COMPILER_OPTIONS, noEmit: false },
    fileName: 'other.mts'
  }).outputText;
  expect(output).toContain('export default function real');
  const emitted = { real: undefined as undefined | (() => number) };
  runInNewContext(output.replace('export default function real', 'function real'), emitted);
  expect(emitted.real?.()).toBe(1);
  const compilation = fixture('export default function ignored() {}\n', undefined,
    "export { default as verify } from './other.ts';\n", bridge);
  expect(compileSourceProgramOperationProducerClosure(compilation, OPERATION).entrypoint.path)
    .toBe('src/normalize/runtime.ts');
});


test('default alias regression: identifier assignment cannot hide an imported type-only star', () => {
  const compilation = fixture('export function verify(): void {}\n',
    "export type * from './normalize/kernel.ts';\n",
    "export { default as verify } from './other.ts';\n",
    "import { verify } from '../unrelated.ts';\nexport default verify;\n");
  expect(() => compileSourceProgramOperationProducerClosure(compilation, OPERATION)).toThrow(
    expect.objectContaining({ code: 'entrypoint-export-unresolved' })
  );
});

test('default alias regression: value imports and identifier default assignments remain runtime producers', () => {
  const compilation = fixture('export function verify(): void {}\n',
    "export { verify } from './normalize/kernel.ts';\n",
    "import verify from './other.ts';\nexport { verify };\n",
    "import { verify } from '../unrelated.ts';\nexport default verify;\n");
  const closure = compileSourceProgramOperationProducerClosure(compilation, OPERATION);
  expect(closure.implementationFiles.map(({ path }) => path)).toEqual([
    'src/normalize/kernel.ts', 'src/normalize/other.ts', 'src/normalize/runtime.ts', 'src/unrelated.ts'
  ]);
});
