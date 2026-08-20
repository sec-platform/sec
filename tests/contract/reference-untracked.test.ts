import { expect, test } from 'bun:test';

import { compilerRoot } from '../../platform/shared/paths.ts';
import { buildReferenceCheckReport } from '../../platform/shared/reference-check.ts';

const newControlArtifactPath = 'control/evidence/semantic-summary.json';

test('reference check reports a new untracked control artifact as drift', async () => {
  const report = await buildReferenceCheckReport({
    root: compilerRoot,
    commandRunner: async () => ({ code: 0, stdout: '', stderr: '' }),
    gitCommandRunner: async (_command, args) => {
      if (args[0] === 'diff') {
        return { code: 0, stdout: new Uint8Array(), stderr: '' };
      }
      return {
        code: 0,
        stdout: new TextEncoder().encode(`${newControlArtifactPath}\0`),
        stderr: ''
      };
    }
  });

  expect(report).toMatchObject({
    status: 'drifted',
    diffExitCode: 1,
    trackedDiffExitCode: 0,
    untrackedScanExitCode: 0,
    changedPathCount: 1,
    changedPaths: [newControlArtifactPath]
  });
});
