import { expect, test } from 'bun:test';

import { compilerRoot } from '../../platform/shared/paths.ts';
import { buildReferenceCheckReport } from '../../platform/shared/reference-check.ts';

const runtimeContractPath = 'project/src/installed/ticket/ticket-semantic-contract.ts';

test('reference check reports a new canonical workspace file as drift', async () => {
  const report = await buildReferenceCheckReport({
    root: compilerRoot,
    commandRunner: async (command, args) => {
      if (command === 'bun') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'diff') return { code: 0, stdout: '', stderr: '' };
      return { code: 0, stdout: `${runtimeContractPath}\n`, stderr: '' };
    }
  });

  expect(report).toMatchObject({
    status: 'drifted',
    diffExitCode: 1,
    trackedDiffExitCode: 0,
    untrackedScanExitCode: 0,
    changedPathCount: 1,
    changedPaths: [runtimeContractPath]
  });
});
