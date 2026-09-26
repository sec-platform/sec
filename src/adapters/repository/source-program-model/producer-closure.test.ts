import { expect, test } from 'bun:test';

import { rawSha256, sha256 } from '../../../contracts/canonical.ts';
import { compileRepositoryModuleMembershipSnapshot } from '../architecture/contract.ts';
import {
  compileProducerClosure,
  requireProducerClosure
} from './producer-closure.ts';
import { compileVirtualRepositorySourceProgramCompilation } from './repository-compilation.ts';
import { compileVirtualSnapshot } from './workspace-source-snapshot.ts';

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
  const workspaceSnapshot = compileVirtualSnapshot({
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
  const closure = compileProducerClosure(
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
  expect(requireProducerClosure(closure)).toBe(closure);
  expect(() => requireProducerClosure({ ...closure })).toThrow(
    'not Source Program compiler-issued'
  );

  const changed = compileProducerClosure(
    fixture('export function normalize(): void { console.log("changed"); }\n'),
    OPERATION
  );
  expect(changed.closureDigest).not.toBe(closure.closureDigest);

  const unrelatedChanged = compileProducerClosure(
    fixture('export function normalize(): void {}\n', 'export const unrelated = false;\n'),
    OPERATION
  );
  expect(unrelatedChanged.closureDigest).toBe(closure.closureDigest);
});

test('operation producer entrypoint follows TypeChecker aliases and re-exports', () => {
  const aliased = compileProducerClosure(
    fixture(
      'export function normalize(): void {}\n',
      undefined,
      "export { normalize as verify } from './kernel.ts';\n"
    ),
    OPERATION
  );
  const star = compileProducerClosure(
    fixture(
      'export function verify(): void {}\n',
      undefined,
      "export * from './kernel.ts';\n"
    ),
    OPERATION
  );
  const localList = compileProducerClosure(
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
  expect(() => compileProducerClosure(typeOnly, OPERATION)).toThrow(
    expect.objectContaining({
      code: 'entrypoint-export-unresolved'
    })
  );
  const syntaxInvalid = fixture(
    'export function normalize(): void {}\n',
    undefined,
    'export const verify = ;\n'
  );
  expect(() => compileProducerClosure(syntaxInvalid, OPERATION)).toThrow(
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
  expect(() => compileProducerClosure(duplicate, OPERATION)).toThrow(
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
  expect(() => compileProducerClosure(computedLoader, OPERATION)).toThrow(
    expect.objectContaining({ code: 'reachable-loader-resource-unresolved' })
  );

  const opaqueRuntime = fixture(
    'export function normalize(): void {}\n',
    undefined,
    "import { normalize } from './kernel.ts';\n"
      + 'export function verify() { normalize(); return eval("1"); }\n'
  );
  expect(() => compileProducerClosure(opaqueRuntime, OPERATION)).toThrow(
    expect.objectContaining({ code: 'reachable-loader-resource-unresolved' })
  );
});

test('operation producer rejects caller-cloned compilation receipts', () => {
  const compilation = fixture('export function normalize(): void {}\n');
  expect(() => compileProducerClosure(
    { ...compilation },
    OPERATION
  )).toThrow('compiler-issued compilation receipt');
});
