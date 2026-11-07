import { expect, test } from 'bun:test';

import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import { compileRepositoryModuleMembershipSnapshot } from '../architecture/contract.ts';
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
  const membership = compileRepositoryModuleMembershipSnapshot({
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
  const compilation = fixture('export function normalize(): void {}\n');
  const closure = compileSourceProgramOperationProducerClosure(compilation, OPERATION);
  expect(() => compileSourceProgramOperationProducerClosure(
    { ...compilation },
    OPERATION
  )).toThrow('compiler-issued compilation receipt');
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


test('operation producer rejects independent invalid exports and reachable loaders', () => {
  // Each operation owns one descriptor and an independent lexical source tree.
  // Check its own failure identity; another module cannot supply the expected error.
  const cases: readonly {
    name: string;
    runtime: string;
    code: 'entrypoint-export-unresolved' | 'entrypoint-not-unique' | 'reachable-loader-resource-unresolved';
    kernel?: string;
    other?: string;
    unrelated?: string;
  }[] = [
  {
    "name": "type-only local export",
    "runtime": "export type verify = string;\n",
    "code": "entrypoint-export-unresolved"
  },
  {
    "name": "invalid entrypoint syntax",
    "runtime": "export const verify = ;\n",
    "code": "entrypoint-export-unresolved"
  },
  {
    "name": "two runtime entrypoints",
    "runtime": "import { normalize } from './kernel.ts';\nexport const verify = normalize;\n",
    "other": "export function verify(): void {}\n",
    "code": "entrypoint-not-unique"
  },
  {
    "name": "computed dynamic loader",
    "runtime": "import { normalize } from './kernel.ts';\nexport async function verify(specifier: string) {\n  normalize();\n  return import(specifier);\n}\n",
    "code": "reachable-loader-resource-unresolved"
  },
  {
    "name": "opaque eval loader",
    "runtime": "import { normalize } from './kernel.ts';\nexport function verify() { normalize(); return eval(\"1\"); }\n",
    "code": "reachable-loader-resource-unresolved"
  },
  {
    "name": "ambient declared variable",
    "kernel": "",
    "runtime": "export declare const verify: () => void;\n",
    "code": "entrypoint-export-unresolved"
  },
  {
    "name": "invalid target syntax",
    "kernel": "export function normalize(): void { const x = ; }\n",
    "runtime": "export { normalize as verify } from './kernel.ts';\n",
    "code": "entrypoint-export-unresolved"
  },
  {
    "name": "indirect type-only named export",
    "kernel": "export function normalize(): void {}\nexport function verify(): void {}\n",
    "runtime": "export { verify } from './other.ts';\n",
    "other": "export type { normalize as verify } from './kernel.ts';\n",
    "code": "entrypoint-export-unresolved"
  },
  {
    "name": "indirect type-only star export",
    "kernel": "export function normalize(): void {}\nexport function verify(): void {}\n",
    "runtime": "export { verify } from './other.ts';\n",
    "other": "export type * from './kernel.ts';\n",
    "code": "entrypoint-export-unresolved"
  },
  {
    "name": "type-only import exported through a local list",
    "runtime": "import type { normalize as verify } from './kernel.ts';\nexport { verify };\n",
    "code": "entrypoint-export-unresolved"
  },
  {
    "name": "unrelated reachable runtime cannot rescue type-only star",
    "kernel": "export function verify(): void {}\n",
    "runtime": "import './kernel.ts';\nexport { verify } from './other.ts';\n",
    "other": "export type * from './kernel.ts';\n",
    "code": "entrypoint-export-unresolved"
  },
  {
    "name": "locally re-exported type-only import",
    "kernel": "export function verify(): void {}\n",
    "runtime": "import { verify } from './other.ts';\nexport { verify };\n",
    "other": "export type * from './kernel.ts';\n",
    "code": "entrypoint-export-unresolved"
  },
  {
    "name": "renamed locally re-exported type-only import",
    "kernel": "export function verify(): void {}\n",
    "runtime": "import './kernel.ts';\nimport { verify as local } from './other.ts';\nexport { local as verify };\n",
    "other": "export type * from './kernel.ts';\n",
    "code": "entrypoint-export-unresolved"
  },
  {
    "name": "identifier default alias fed by a type-only star",
    "kernel": "export function verify(): void {}\n",
    "runtime": "export { default as verify } from './other.ts';\n",
    "other": "import { verify } from '../unrelated.ts';\nexport default verify;\n",
    "unrelated": "export type * from './normalize/kernel.ts';\n",
    "code": "entrypoint-export-unresolved"
  }
];
  const sources = new Map<string, string>();
  const descriptorSources: { descriptorPath: string; source: string }[] = [];
  for (const [index, item] of cases.entries()) {
    const scope = 'src/producer-case-' + index;
    const root = scope + '/normalize';
    const descriptorPath = root + '/module.json';
    const descriptor = JSON.stringify({
      importGraph: 'runtime',
      externalEntrypoints: [root + '/runtime.ts', root + '/other.ts'],
      capabilityProviders: [{ capability: 'fixture.producer-case-' + index, operations: ['verify'] }]
    });
    descriptorSources.push({ descriptorPath, source: descriptor });
    sources.set(descriptorPath, descriptor);
    sources.set(root + '/runtime.ts', item.runtime);
    sources.set(root + '/other.ts', item.other ?? 'export const inspect = true;\n');
    sources.set(root + '/kernel.ts', item.kernel ?? 'export function normalize(): void {}\n');
    sources.set(scope + '/unrelated.ts', item.unrelated ?? 'export const unrelated = true;\n');
  }
  const files = [...sources].map(([filePath, source]) => Object.freeze({
    path: filePath, mode: '100644' as const, source, contentDigest: rawSha256(source)
  }));
  const membership = compileRepositoryModuleMembershipSnapshot({
    repositoryFiles: files.map(({ path: filePath }) => filePath),
    descriptorSources
  });
  const workspaceSnapshot = compileVirtualWorkspaceSourceSnapshot({
    subject: Object.freeze({
      kind: 'virtual-mutation',
      provenance: Object.freeze({
        kind: 'source-program-virtual-mutation',
        baseSnapshotDigest: sha256('base') as `sha256:${string}`,
        mutationDigest: sha256(files.map(({ path: filePath, contentDigest }) => ({
          path: filePath, contentDigest
        }))) as `sha256:${string}`
      })
    }),
    files,
    moduleMembership: membership
  });
  const compilation = compileVirtualRepositorySourceProgramCompilation({ workspaceSnapshot });
  for (const [index, item] of cases.entries()) {
    const casePath = 'producer-case-' + index;
    expect(() => compileSourceProgramOperationProducerClosure(compilation, {
      capability: 'fixture.producer-case-' + index, operation: 'verify'
    })).toThrow(expect.objectContaining({
      code: item.code,
      message: expect.stringContaining(casePath)
    }));
  }
});

for (const runtime of [
  'export class verify {}\n',
  'export enum verify { Value = 1 }\n'
]) test(`operation producer retains executable value export: ${runtime.trim()}`, () => {
  const closure = compileSourceProgramOperationProducerClosure(fixture('', undefined, runtime), OPERATION);
  expect(closure.entrypoint.path).toBe('src/normalize/runtime.ts');
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
