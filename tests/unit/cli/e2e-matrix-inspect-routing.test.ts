import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveWorkspaceArtifactPath } from '../../../src/adapters/workspace-context.ts';
import { projectE2eMatrix } from '../../../src/application/e2e-matrix-inspect.ts';
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { buildE2eMatrix } from '../../../src/assurance/verification/review/matrix.ts';
import { formatE2eMatrix } from '../../../src/entry/cli/e2e-matrix-inspect.ts';
import { buildReviewSummaryFromInputs } from '../../helpers/review-fixtures.ts';
import { expectCliJson, expectCliSuccess } from '../../testkit/cli.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

test('review matrix routes adapter result through application and entry while preserving JSON shape', async () => {
  // Independent fixed projection and text oracle retained from tests/unit/e2e-matrix-inspect-presentation.test.ts.
  {
  const source = {
    status: 'attention',
    rowCount: 2,
    rows: [
      { stage: 'verification', status: 'passed', detail: 'lane=fast', evidenceCount: 2, evidence: ['ci=passed', 'failures=0'] },
      { stage: 'artifacts', status: 'attention', detail: 'missing=1', evidenceCount: 1, evidence: ['missing=1'] }
    ]
  };

  const view = projectE2eMatrix(source);
  expect(view).toEqual(source);
  source.rows[0]!.evidence.push('later');
  expect(view.rows[0]!.evidence).toEqual(['ci=passed', 'failures=0']);

  const rendered = formatE2eMatrix(view).split('\n');
  expect(rendered).toHaveLength(3);
  for (const field of ['E2E matrix attention', 'rows=2']) expect(rendered[0]).toContain(field);
  for (const field of ['verification: passed', 'lane=fast', 'ci=passed', 'failures=0']) {
    expect(rendered[1]).toContain(field);
  }
  for (const field of ['artifacts: attention', 'missing=1', 'evidence=missing=1']) {
    expect(rendered[2]).toContain(field);
  }
  }
  await withTempWorkspace(async (workspaceRoot) => {
    const summary = await buildReviewSummaryFromInputs(workspaceRoot);
    const summaryPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.reviewSummary);
    await fs.mkdir(path.dirname(summaryPath), { recursive: true });
    await fs.writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');

    const matrix = buildE2eMatrix(summary);

    const { stdout } = await expectCliSuccess(workspaceRoot, ['review', 'matrix']);
    const lines = stdout.trimEnd().split(/\r?\n/u);
    const stages = ['verification', 'coverage', 'artifacts', 'review'] as const;
    expect(matrix.rowCount).toBe(stages.length);
    expect(matrix.rows.map(row => row.stage)).toEqual([...stages]);
    expect(lines).toHaveLength(stages.length + 1);
    expect(lines[0]).toContain(`E2E matrix ${matrix.status}`);
    expect(lines[0]).toContain('rows=4');
    expect(lines[1]).toContain('verification: passed');
    expect(lines[1]).toContain('ci=passed');
    expect(lines[1]).toContain('failures=0');
    expect(lines[2]).toContain('coverage: passed');
    for (const [index, row] of matrix.rows.entries()) {
      const line = lines[index + 1]!;
      expect(line).toContain(`${row.stage}: ${row.status}`);
      expect(line).toContain(row.detail);
      for (const evidence of row.evidence) expect(line).toContain(evidence);
    }

    const json = await expectCliJson(workspaceRoot, ['review', 'matrix', '--json']);
    expect(json).toEqual(matrix);
  });
});
