import { expect, test } from 'bun:test';
import { expectRecord, recordFields } from '../../helpers/assertion-helpers.ts';
import { writeJson } from '../../../src/adapters/filesystem/files.ts';

import { resolveWorkspaceArtifactPath } from '../../../src/adapters/workspace-context.ts';
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { expectCliJson, expectCliSuccess } from '../../testkit/cli.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

test('acceptance inspection routes retained coverage through application and entry while preserving JSON', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const report = {
      formatVersion: '1',
      status: 'passed',
      acceptancePassed: ['acceptance:a', 'acceptance:b'],
      blocks: [
        {
          id: 'alpha',
          declaredAcceptance: ['declared:a'],
          coveredBy: ['acceptance:a'],
          uncovered: false
        },
        {
          id: 'beta',
          declaredAcceptance: ['declared:b', 'declared:c'],
          coveredBy: [],
          uncovered: true
        }
      ],
      uncoveredBlocks: ['beta']
    };
    const reportPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.acceptanceCoverage);
    await writeJson(reportPath, report);

    const coverageText = await expectCliSuccess(workspaceRoot, ['acceptance']);
    const targetsText = await expectCliSuccess(workspaceRoot, ['acceptance', 'blocks']);
    expect(coverageText.stdout.trimEnd().split(/\r?\n/u)).toHaveLength(4);
    expect(targetsText.stdout.trimEnd().split(/\r?\n/u)).toHaveLength(5);
    function expectFields(stdout: string, fields: readonly string[]) {
      const rows = stdout.trimEnd().split(/\r?\n/u).filter(line => recordFields(line).includes(fields[0]!));
      expect(rows).toHaveLength(1);
      expectRecord(rows[0], fields);
    }
    expectFields(coverageText.stdout, [
      'Acceptance coverage passed', 'acceptancePassed=2', 'blocks=1/2', 'uncoveredBlocks=1'
    ]);
    expectFields(coverageText.stdout, ['Uncovered blocks: beta']);
    expectFields(coverageText.stdout, ['Block alpha', 'declared=1', 'coveredBy=acceptance:a', 'uncovered=false']);
    expectFields(coverageText.stdout, ['Block beta', 'declared=2', 'coveredBy=none', 'uncovered=true']);
    expectFields(targetsText.stdout, ['Acceptance coverage blocks passed']);
    expectFields(targetsText.stdout, ['targets=2', 'covered=1', 'uncovered=1']);
    expectFields(targetsText.stdout, ['Uncovered: beta']);
    expectFields(targetsText.stdout, ['Target alpha', 'declared=1', 'coveredBy=acceptance:a', 'uncovered=false']);
    expectFields(targetsText.stdout, ['Target beta', 'declared=2', 'coveredBy=none', 'uncovered=true']);

    expect(await expectCliJson(workspaceRoot, ['acceptance', 'blocks', '--json'])).toEqual({
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

    const json = await expectCliJson(workspaceRoot, ['acceptance', 'coverage', '--json']);
    expect(json).toEqual(report);
  });
});
