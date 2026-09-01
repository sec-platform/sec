import { expect, test } from 'bun:test';

import { rawSha256, sha256 } from '../../system-architecture/foundation/runtime/canonical.ts';
import { compileSecRepositoryModuleMembershipSnapshot } from '../../system-architecture/repository-modules/contract.ts';
import {
  compileSourceProgramOperationProducerClosure,
  requireSourceProgramOperationProducerClosure
} from './repository.ts';
import { compileVirtualWorkspaceSourceSnapshot } from './workspace-source-snapshot.ts';

const OPERATION = Object.freeze({ capability: 'fixture.normalize', operation: 'verify' });

function fixture(implementation: string) {
  const descriptor = JSON.stringify({
    importGraph: 'runtime',
    externalEntrypoints: ['src/normalize/runtime.ts'],
    capabilityProviders: [{ capability: OPERATION.capability, operations: [OPERATION.operation] }]
  });
  const sources = new Map([
    ['src/normalize/sec.module.json', descriptor],
    ['src/normalize/runtime.ts', "import { normalize } from './kernel.ts';\nexport const verify = normalize;\n"],
    ['src/normalize/kernel.ts', implementation],
    ['src/unrelated.ts', 'export const unrelated = true;\n']
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
      descriptorPath: 'src/normalize/sec.module.json',
      source: descriptor
    }]
  });
  return compileVirtualWorkspaceSourceSnapshot({
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
}

test('operation producer closure is the descriptor-owned entrypoint union and reachable graph', () => {
  const closure = compileSourceProgramOperationProducerClosure(
    fixture('export function normalize(): void {}\n'),
    OPERATION
  );
  expect(closure.entrypointAddresses).toEqual([
    'module-entrypoint:src/normalize/sec.module.json#normalize:src/normalize/runtime.ts'
  ]);
  expect(closure.files.map(({ path }) => path)).toEqual([
    'src/normalize/kernel.ts',
    'src/normalize/runtime.ts',
    'src/normalize/sec.module.json'
  ]);
  expect(requireSourceProgramOperationProducerClosure(closure)).toBe(closure);
  expect(() => requireSourceProgramOperationProducerClosure({ ...closure })).toThrow(
    'not Source Program compiler-issued'
  );

  const changed = compileSourceProgramOperationProducerClosure(
    fixture('export function normalize(): void { console.log("changed"); }\n'),
    OPERATION
  );
  expect(changed.closureDigest).not.toBe(closure.closureDigest);
});
