import { expect, test } from 'bun:test';

import { compilerRoot } from '../../platform/shared/paths.ts';
import { buildReferenceCheckReport } from '../../platform/shared/reference-check.ts';

const newControlArtifactPath = 'control/evidence/semantic-summary.json';

test('reference check reports a new untracked control artifact as drift', async () => {
  const report = await buildReferenceCheckReport({
    root: compilerRoot,
    commandRunner: async (command, args) => {
      if (command === 'bun') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'diff') return { code: 0, stdout: '', stderr: '' };
      return { code: 0, stdout: `${newControlArtifactPath}\n`, stderr: '' };
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
