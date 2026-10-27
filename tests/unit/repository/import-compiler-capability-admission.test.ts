import { expect, test } from 'bun:test';
import { assertTypeScriptCompilerIdentity, typeScriptCompilerIdentity } from '../../../src/adapters/repository/source-program-model/typescript-profile.ts';
import { compileOperationDemandGraph } from '../../../src/adapters/self-hosting/control/operation/demand.ts';
import { admitImportCompilerCapability } from '../../../src/adapters/self-hosting/development/runner/cli.ts';

test('import admission uses the real locked compiler API without any materialization composition', async () => {
  await admitImportCompilerCapability(compileOperationDemandGraph({ operation: 'imports-check', terminalWorkIds: [] }));
  const identity = typeScriptCompilerIdentity();
  assertTypeScriptCompilerIdentity(identity);
  expect(identity.provider.id).toBe('typescript-compiler-api');
});
