import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveWorkspaceArtifactPath } from '../../src/adapters/workspace-context.ts';
import {
  projectAcceptanceCoverage,
  projectAcceptanceTargets
} from '../../src/application/acceptance-inspection.ts';
import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import {
  formatAcceptanceCoverage,
  formatAcceptanceTargets
} from '../../src/entry/cli/acceptance-inspection.ts';
import { expectCliJson, expectCliSuccess } from '../testkit/cli.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('acceptance inspection routes retained coverage through application and entry while preserving JSON', async () => {
  // Preserve independent projection/text fixture from tests/unit/acceptance-inspection-presentation.test.ts.
  {
   const source = {
      status: 'passed',
      acceptancePassed: ['acceptance:a', 'acceptance:b'],
      blocks: [
        {
          coveredBy: ['acceptance:a'],
          id: 'alpha',
          declaredAcceptance: ['declared:a'],
          uncovered: false
        },
        {
          coveredBy: [],
          id: 'beta',
          declaredAcceptance: ['declared:b', 'declared:c'],
          uncovered: true
        }
      ],
      uncoveredBlocks: ['beta']
    };
    const targets = projectAcceptanceTargets(source);
    const coverage = projectAcceptanceCoverage(source);

    source.blocks[0]!.coveredBy.push('later');
    source.uncoveredBlocks.length = 0;

    expect(targets).toEqual({
      status: 'passed',
      targetKind: 'blocks',
      targetCount: 2,
      coveredCount: 1,
      uncoveredCount: 1,
      uncoveredIds: ['beta'],
      targets: [
        {
          coveredBy: ['acceptance:a'],
          id: 'alpha',
          declaredAcceptance: ['declared:a'],
          uncovered: false,
          declaredAcceptanceCount: 1,
          coveredByCount: 1
        },
        {
          coveredBy: [],
          id: 'beta',
          declaredAcceptance: ['declared:b', 'declared:c'],
          uncovered: true,
          declaredAcceptanceCount: 2,
          coveredByCount: 0
        }
      ]
    });
    expect(coverage.acceptancePassedCount).toBe(2);
    expect(coverage.blockTargets).toEqual(targets);

    expect(formatAcceptanceCoverage(coverage)).toBe([
      'Acceptance coverage passed; acceptancePassed=2; blocks=1/2; uncoveredBlocks=1',
      'Uncovered blocks: beta',
      'Block alpha; declared=1; coveredBy=acceptance:a; uncovered=false',
      'Block beta; declared=2; coveredBy=none; uncovered=true'
    ].join('\n'));

    expect(formatAcceptanceTargets(targets)).toBe([
      'Acceptance coverage blocks passed',
      'targets=2; covered=1; uncovered=1',
      'Uncovered: beta',
      'Target alpha; declared=1; coveredBy=acceptance:a; uncovered=false',
      'Target beta; declared=2; coveredBy=none; uncovered=true'
    ].join('\n'));
  }
  await withTempWorkspace(async (workspaceRoot) => {
    const report = {
      formatVersion: '1',
      status: 'passed',
      acceptancePassed: ['acceptance:a'],
      blocks: [
        {
          id: 'alpha',
          declaredAcceptance: ['declared:a'],
          coveredBy: ['acceptance:a'],
          uncovered: false
        },
        {
          id: 'beta',
          declaredAcceptance: ['declared:b'],
          coveredBy: [],
          uncovered: true
        }
      ],
      uncoveredBlocks: ['beta']
    };
    const reportPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.acceptanceCoverage);
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    await expectCliSuccess(
      workspaceRoot,
      ['acceptance'],
      `${formatAcceptanceCoverage(projectAcceptanceCoverage(report))}\n`
    );
    await expectCliSuccess(
      workspaceRoot,
      ['acceptance', 'blocks'],
      `${formatAcceptanceTargets(projectAcceptanceTargets(report))}\n`
    );

    const json = await expectCliJson(workspaceRoot, ['acceptance', '--json']);
    expect(json).toEqual(report);
  });
});
