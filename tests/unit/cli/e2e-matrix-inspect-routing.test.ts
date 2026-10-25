import { expect, test } from 'bun:test';
import { expectRecord } from '../../helpers/assertion-helpers.ts';
import { writeJson } from '../../../src/adapters/filesystem/files.ts';

import { resolveWorkspaceArtifactPath } from '../../../src/adapters/workspace-context.ts';
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { buildE2eMatrix } from '../../../src/assurance/verification/review/matrix.ts';
import { buildReviewSummaryFromInputs } from '../../helpers/review-fixtures.ts';
import { expectCliJson, expectCliSuccess } from '../../testkit/cli.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

test('review matrix routes adapter result through application and entry while preserving JSON shape', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const summary = await buildReviewSummaryFromInputs(workspaceRoot);
    const summaryPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.reviewSummary);
    await writeJson(summaryPath, summary);

    const matrix = buildE2eMatrix(summary);

    const { stdout } = await expectCliSuccess(workspaceRoot, ['review', 'matrix']);
    const lines = stdout.trimEnd().split(/\r?\n/u);
    // The production matrix builder is used by the CLI too; checking its
    // projection against itself is a wiring test, not an independent oracle.
    const expectedStages = [
      { stage: 'verification', status: 'passed', detail: ['lane=fast', 'failed=none'], evidence: ['ci=passed', 'failures=0'] },
      { stage: 'coverage', status: 'passed', detail: ['blocks=0/0'], evidence: ['blocks=0/0'] },
      { stage: 'artifacts', status: 'attention', detail: ['total=0', 'missing=0'], evidence: ['artifacts=missing'] },
      { stage: 'review', status: 'passed', detail: ['review-summary=generated'], evidence: ['review-summary=generated'] }
    ] as const;
    expect(matrix.status).toBe('attention');
    expect(matrix.rowCount).toBe(expectedStages.length);
    expect(matrix.rows.map(({ stage, status }) => ({ stage, status })))
      .toEqual(expectedStages.map(({ stage, status }) => ({ stage, status })));
    expect(lines).toHaveLength(expectedStages.length + 1);
    expectRecord(lines[0], ['E2E matrix attention', 'rows=4']);
    for (const [index, expected] of expectedStages.entries()) {
      expectRecord(lines[index + 1], [
        `${expected.stage}: ${expected.status}`, ...expected.detail,
        `evidence=${expected.evidence.join(', ')}`
      ]);
      expectRecord(matrix.rows[index]!.detail, expected.detail);
      expect(matrix.rows[index]!.evidence).toEqual([...expected.evidence]);
    }

    const json = await expectCliJson(workspaceRoot, ['review', 'matrix', '--json']);
    expect(json).toEqual(matrix);
  });
});
