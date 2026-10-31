import { expect, test } from 'bun:test';
import { expectRecord } from '../../helpers/assertion-helpers.ts';
import { writeJson } from '../../../src/adapters/filesystem/files.ts';

import { resolveWorkspaceArtifactPath } from '../../../src/adapters/workspace-context.ts';
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { buildReviewSummaryFromInputs } from '../../helpers/review-fixtures.ts';
import { expectCliJson, expectCliSuccess } from '../../testkit/cli.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

test('review matrix routes adapter result through application and entry while preserving JSON shape', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const summary = await buildReviewSummaryFromInputs(workspaceRoot);
    const summaryPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.reviewSummary);
    await writeJson(summaryPath, summary);

    const { stdout } = await expectCliSuccess(workspaceRoot, ['review', 'matrix']);
    const lines = stdout.trimEnd().split(/\r?\n/u);
    // Both public outputs use independent stage/evidence expectations; JSON
    // additionally preserves each persisted source detail without a builder echo.
    const expectedStages = [
      { stage: 'verification', status: 'passed', detail: ['lane=fast', 'failed=none'], evidence: ['ci=passed', 'failures=0'] },
      { stage: 'coverage', status: 'passed', detail: ['blocks=0/0'], evidence: ['blocks=0/0'] },
      { stage: 'artifacts', status: 'attention', detail: ['total=0', 'missing=0'], evidence: ['artifacts=missing'] },
      { stage: 'review', status: 'passed', detail: ['review-summary=generated'], evidence: ['review-summary=generated'] }
    ] as const;
    expect(lines).toHaveLength(expectedStages.length + 1);
    expectRecord(lines[0], ['E2E matrix attention', 'rows=4']);
    for (const [index, expected] of expectedStages.entries()) {
      expectRecord(lines[index + 1], [
        `${expected.stage}: ${expected.status}`, ...expected.detail,
        `evidence=${expected.evidence.join(', ')}`
      ]);
    }

    const json = await expectCliJson(workspaceRoot, ['review', 'matrix', '--json']);
    expect(json).toEqual({
      status: 'attention', rowCount: 4,
      rows: expectedStages.map((expected, index) => ({
        stage: expected.stage, status: expected.status,
        detail: summary.chainSummary.stageSummaries[index]!.detail,
        evidenceCount: expected.evidence.length, evidence: [...expected.evidence]
      }))
    });
  });
});
