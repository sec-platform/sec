import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { buildE2eMatrix } from '../../src/adapters/verification/platform/review/runtime/matrix.ts';
import { resolveWorkspaceArtifactPath } from '../../src/adapters/workspace-context.ts';
import { projectE2eMatrix } from '../../src/application/e2e-matrix-inspect.ts';
import { formatE2eMatrix } from '../../src/entry/cli/e2e-matrix-inspect.ts';
import { buildReviewSummaryFromInputs } from '../helpers/review-fixtures.ts';
import { expectCliJson, expectCliSuccess } from '../testkit/cli.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('review matrix routes adapter result through application and entry while preserving JSON shape', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const summary = await buildReviewSummaryFromInputs(workspaceRoot);
    const summaryPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.reviewSummary);
    await fs.mkdir(path.dirname(summaryPath), { recursive: true });
    await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

    const matrix = buildE2eMatrix(summary);
    const projected = projectE2eMatrix(matrix);

    await expectCliSuccess(
      workspaceRoot,
      ['review', 'matrix'],
      `${formatE2eMatrix(projected)}\n`
    );

    const json = await expectCliJson(workspaceRoot, ['review', 'matrix', '--json']);
    expect(json).toEqual(matrix);
  });
});
