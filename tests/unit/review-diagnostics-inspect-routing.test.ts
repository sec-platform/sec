import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { resolveWorkspaceArtifactPath } from '../../src/adapters/workspace-context.ts';
import { projectReviewDiagnostics } from '../../src/application/review-diagnostics-inspect.ts';
import { formatReviewDiagnostics } from '../../src/entry/cli/review-diagnostics-inspect.ts';
import { buildReviewSummaryFromInputs } from '../helpers/review-fixtures.ts';
import { expectCliJson, expectCliSuccess } from '../testkit/cli.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('review diagnostics routes retained review summary through application and entry', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const summary = await buildReviewSummaryFromInputs(workspaceRoot);
    const summaryPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.reviewSummary);
    await fs.mkdir(path.dirname(summaryPath), { recursive: true });
    await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

    const projected = projectReviewDiagnostics(summary);
    await expectCliSuccess(
      workspaceRoot,
      ['review', 'diagnostics'],
      `${formatReviewDiagnostics(projected)}\n`
    );

    const json = await expectCliJson(workspaceRoot, ['review', 'diagnostics', '--json']);
    expect(json).toEqual(projected);
  });
});
