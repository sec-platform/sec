import { expect, test } from 'bun:test';

import { projectReviewSummary } from '../../src/application/review-summary-inspect.ts';
import { formatReviewSummary } from '../../src/entry/cli/review-summary-inspect.ts';
import { formatReviewSummaryContract } from '../../src/bootstrap/cli/formatters.ts';
import { buildReviewSummaryFromInputs } from '../helpers/review-fixtures.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('review summary application projection and entry renderer preserve the existing contract text', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const summary = await buildReviewSummaryFromInputs(workspaceRoot);
    const view = projectReviewSummary(summary);

    expect(formatReviewSummary(view)).toBe(formatReviewSummaryContract(summary));
    expect(view.chain.stages).toEqual(
      summary.chainSummary.stageSummaries.map((stage) => ({ id: stage.id, status: stage.status }))
    );
    expect(view.impact.blockCount).toBe(summary.impactedBlocks.length);
  });
});
