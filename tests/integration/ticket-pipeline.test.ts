import { expect, test } from 'bun:test';

import type { VerificationReport } from '../../src/verification/contract/types.ts';
import { readJson } from '../../src/workspace/files.ts';
import { getWorkspacePaths } from '../../src/workspace/paths.ts';
import { prepareVerifiedWorkspace } from '../testkit/workspace.ts';

test('ticket project reaches a passing fast pipeline state', async () => {
  const workspaceRoot = await prepareVerifiedWorkspace({
    blockIds: ['ticket/basic'],
    prefix: 'engineering-compiler-ticket-pipeline-'
  });
  const { verificationReportPath } = getWorkspacePaths(workspaceRoot);
  const report = await readJson<VerificationReport>(verificationReportPath);

  expect(report.fast.status).toBe('passed');
  expect(report.summary.status).toBe('passed');
});
