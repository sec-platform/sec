import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { resolveWorkspaceArtifactPath } from '../../src/adapters/workspace-context.ts';
import { projectReviewSummary } from '../../src/application/review-summary-inspect.ts';
import { formatReviewSummary } from '../../src/entry/cli/review-summary-inspect.ts';
import { buildReviewSummaryFromInputs } from '../helpers/review-fixtures.ts';
import { expectCliJson, expectCliSuccess } from '../testkit/cli.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('review default inspection routes retained summary through application and entry while preserving JSON', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const summary = await buildReviewSummaryFromInputs(workspaceRoot);
    const summaryPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.reviewSummary);
    await fs.mkdir(path.dirname(summaryPath), { recursive: true });
    await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

    await expectCliSuccess(
      workspaceRoot,
      ['review'],
      `${formatReviewSummary(projectReviewSummary(summary))}\n`
    );

    const json = await expectCliJson(workspaceRoot, ['review', '--json']);
    expect(json).toEqual(summary);
  });
});
