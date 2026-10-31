import { test } from 'bun:test';
import { compileOperationDemandGraph } from '../../../src/adapters/self-hosting/control/operation/demand.ts';
import { admitImportCompilerCapability } from '../../../src/adapters/self-hosting/development/runner/cli.ts';

test('import admission uses the real locked compiler API without any materialization composition', async () => {
  await admitImportCompilerCapability(compileOperationDemandGraph({ operation: 'imports-check', terminalWorkIds: [] }));
});
