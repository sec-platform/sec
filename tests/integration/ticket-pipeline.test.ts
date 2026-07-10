import { expect, test } from 'bun:test';

import { readJson } from '../../platform/shared/fs.ts';
import { getWorkspacePaths } from '../../platform/shared/paths.ts';
import type { VerificationReport } from '../../platform/shared/verification-types.ts';
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
}, 15_000);
