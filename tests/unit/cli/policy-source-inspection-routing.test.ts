import { expect, test } from 'bun:test';
import { expectRecord, recordFields } from '../../helpers/assertion-helpers.ts';
import { writeJson } from '../../../src/adapters/filesystem/files.ts';

import { resolveWorkspaceArtifactPath } from '../../../src/adapters/workspace-context.ts';
import { projectPolicySources } from '../../../src/application/policy-source-inspection.ts';
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { expectCliJson, expectCliSuccess } from '../../testkit/cli.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

// Fixed semantic oracle for both the direct projection and real CLI JSON.
// Never compute a route's expected result with its own production projection.
const EXPECTED_POLICY_SOURCES = {
  status: 'passed',
  sourceCount: 3,
  policyCount: 4,
  sources: [
    { scope: 'official', path: 'a', policyCount: 2, policyIds: ['official:a', 'official:b'] },
    { scope: 'official', path: 'z', policyCount: 1, policyIds: ['official:z'] },
    { scope: 'project', path: 'b', policyCount: 1, policyIds: ['project:b'] }
  ]
};

test('policy sources routes retained policy evidence through application and entry', async () => {
  // Direct projection protects detachment and ordering; real CLI checks rendering below.
  {
    const source = {
      status: 'passed',
      official: {
        sources: [
          { path: 'z', policyIds: ['official:z'] },
          { path: 'a', policyIds: ['official:a', 'official:b'] }
        ]
      },
      project: {
        sources: [{ path: 'b', policyIds: ['project:b'] }]
      }
    };
    const originalOfficial = source.official.sources.map((entry) => entry.path);

    const view = projectPolicySources(source);

    source.official.sources[0]!.policyIds.push('later');
    source.project.sources[0]!.policyIds.length = 0;
    expect(view).toEqual(EXPECTED_POLICY_SOURCES);
    expect(source.official.sources.map((entry) => entry.path)).toEqual(originalOfficial);
    view.sources[1]!.policyIds.push('projection-only');
    expect(source.official.sources[0]!.policyIds).toEqual(['official:z', 'later']);
  }
  await withTempWorkspace(async (workspaceRoot) => {
    const report = {
      status: 'passed',
      official: {
        sources: [
          { path: 'z', policyIds: ['official:z'] },
          { path: 'a', policyIds: ['official:a', 'official:b'] }
        ]
      },
      project: {
        sources: [{ path: 'b', policyIds: ['project:b'] }]
      }
    };
    const reportPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.policyReport);
    await writeJson(reportPath, report);

    const { stdout } = await expectCliSuccess(workspaceRoot, ['policy', 'sources']);
    const lines = stdout.trimEnd().split(/\r?\n/u);
    expect(lines).toHaveLength(5);
    const header = lines.find(line => line.startsWith('Policy sources '));
    expectRecord(header, ['Policy sources passed']);
    const counts = lines.find(line => recordFields(line).includes('sources=3'));
    expectRecord(counts, ['sources=3', 'policies=4']);
    const rows = lines.filter(line => line.startsWith('Source '));
    const expected = [
      ['official', 'a', ['official:a', 'official:b']],
      ['official', 'z', ['official:z']],
      ['project', 'b', ['project:b']]
    ] as const;
    expect(rows).toHaveLength(expected.length);
    for (const [scope, sourcePath, policyIds] of expected) {
      const matches = rows.filter(line => recordFields(line).includes(`Source ${scope}`) && recordFields(line).includes(`path=${sourcePath}`));
      expect(matches).toHaveLength(1);
      expectRecord(matches[0], [`Source ${scope}`, `path=${sourcePath}`, `policies=${policyIds.join(', ')}`]);
    }

    const json = await expectCliJson(workspaceRoot, ['policy', 'sources', '--json']);
    expect(json).toEqual(EXPECTED_POLICY_SOURCES);
  });
});
