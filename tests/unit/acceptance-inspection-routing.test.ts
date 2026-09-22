import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { resolveWorkspaceArtifactPath } from '../../src/adapters/workspace-context.ts';
import {
  projectAcceptanceCoverage,
  projectAcceptanceTargets
} from '../../src/application/acceptance-inspection.ts';
import {
  formatAcceptanceCoverage,
  formatAcceptanceTargets
} from '../../src/entry/cli/acceptance-inspection.ts';
import { expectCliJson, expectCliSuccess } from '../testkit/cli.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('acceptance inspection routes retained coverage through application and entry while preserving JSON', async () => {
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
