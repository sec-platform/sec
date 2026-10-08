import { expect, test } from 'bun:test';
import { assertTypeScriptCompilerIdentity, typeScriptCompilerIdentity } from '../../src/adapters/repository/source-program-model/typescript-profile.ts';
import { compileOperationDemandGraph } from '../../src/adapters/self-hosting/control/operation/demand.ts';
import { admitImportCompilerCapability } from '../../src/adapters/self-hosting/development/runner/cli.ts';

test('import admission uses the real locked compiler API without any materialization composition', async () => {
  for (const operation of ['imports-apply', 'imports-check', 'imports-freeze'] as const) {
    await admitImportCompilerCapability(compileOperationDemandGraph({ operation, terminalWorkIds: [] }));
  }
  const identity = typeScriptCompilerIdentity();
  assertTypeScriptCompilerIdentity(identity);
  expect(identity.provider.id).toBe('typescript-compiler-api');
});

test('a materialization graph or forged import graph cannot acquire import capability admission', async () => {
  await expect(admitImportCompilerCapability(compileOperationDemandGraph({ operation: 'typecheck', terminalWorkIds: [] })))
    .rejects.toThrow('read-only TypeScript compiler API demand');
  const graph = compileOperationDemandGraph({ operation: 'imports-freeze', terminalWorkIds: [] });
  await expect(admitImportCompilerCapability({ ...graph, capabilityDemands: ['compiler-dependency-tree'] }))
    .rejects.toThrow('differs from the canonical compiler output');
});

test('caller compiler metadata cannot replace the original compiler capability issuer', () => {
  const identity = typeScriptCompilerIdentity();
  expect(() => assertTypeScriptCompilerIdentity({ ...identity })).toThrow('not owner-issued');
  expect(() => assertTypeScriptCompilerIdentity({ ...identity, provider: { id: 'typescript-compiler-api', revision: 'caller version' } }))
    .toThrow('not owner-issued');
});
