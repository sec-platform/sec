import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveWorkspaceArtifactPath } from '../../../src/adapters/workspace-context.ts';
import {
  projectAcceptanceCoverage,
  projectAcceptanceTargets
} from '../../../src/application/acceptance-inspection.ts';
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { expectCliJson, expectCliSuccess } from '../../testkit/cli.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

// Compare complete semantic fields and list members, not prose spacing or
// substrings shared by a different key, record, or evidence field.
function recordFields(line: string | undefined): string[] {
  expect(line).toBeDefined();
  return line!.split(';').map(field => field.trim().replace(/\s*,\s*/gu, ','));
}

function expectRecord(line: string | undefined, fields: readonly string[]): void {
  expect(recordFields(line).sort()).toEqual(
    fields.map(field => field.trim().replace(/\s*,\s*/gu, ',')).sort()
  );
}

test('acceptance inspection routes retained coverage through application and entry while preserving JSON', async () => {
  // Direct projection checks own input isolation; CLI checks below own rendered values.
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

    source.blocks[0]!.declaredAcceptance.push('later-declaration');
    source.blocks[0]!.coveredBy.push('later');
    source.uncoveredBlocks.length = 0;
    source.blocks.push({ ...source.blocks[0]!, id: 'later' });

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

    targets.targets[0]!.declaredAcceptance.push('projection-only');
    targets.targets[0]!.coveredBy.push('projection-only');
    targets.uncoveredIds.push('projection-only');
    expect(source.blocks[0]!.declaredAcceptance).toEqual(['declared:a', 'later-declaration']);
    expect(source.blocks[0]!.coveredBy).toEqual(['acceptance:a', 'later']);
    expect(source.uncoveredBlocks).toEqual([]);
  }
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
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

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

    const json = await expectCliJson(workspaceRoot, ['acceptance', '--json']);
    expect(json).toEqual(report);
  });
});
