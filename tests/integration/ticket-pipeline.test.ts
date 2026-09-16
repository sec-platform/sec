import { expect, test } from 'bun:test';

import { CI_ARTIFACT_FILES } from '../../src/verification/ci-artifacts/contract/manifest.ts';
import type { VerificationReport } from '../../src/verification/contract/types.ts';
import { readJson } from '../../src/workspace/files.ts';
import { resolveWorkspaceArtifactPath } from '../../src/workspace/runtime/paths.ts';
import { prepareVerifiedWorkspace } from '../testkit/workspace.ts';

test('ticket project reaches a passing fast pipeline state', async () => {
  const workspaceRoot = await prepareVerifiedWorkspace({
    blockIds: ['ticket/basic'],
    prefix: 'engineering-compiler-ticket-pipeline-'
  });
  const verificationReportPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.verificationReport);
  const report = await readJson<VerificationReport>(verificationReportPath);

  expect(report.fast.status).toBe('passed');
  expect(report.summary.status).toBe('passed');
});
