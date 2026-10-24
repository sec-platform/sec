import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { resolveWorkspaceArtifactPath } from '../../../src/adapters/workspace-context.ts';
import { projectPolicySources } from '../../../src/application/policy-source-inspection.ts';
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { expectCliJson, expectCliSuccess } from '../../testkit/cli.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

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
    expect(view).toEqual({
      status: 'passed',
      sourceCount: 3,
      policyCount: 4,
      sources: [
        { scope: 'official', path: 'a', policyCount: 2, policyIds: ['official:a', 'official:b'] },
        { scope: 'official', path: 'z', policyCount: 1, policyIds: ['official:z'] },
        { scope: 'project', path: 'b', policyCount: 1, policyIds: ['project:b'] }
      ]
    });
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
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    const projected = projectPolicySources(report);
    const { stdout } = await expectCliSuccess(workspaceRoot, ['policy', 'sources']);
    const lines = stdout.split(/\r?\n/u);
    const header = lines.find(line => line.startsWith('Policy sources '));
    expect(header).toContain('Policy sources passed');
    const counts = lines.find(line => line.includes('sources=3'));
    expect(counts).toContain('policies=4');
    const rows = lines.filter(line => line.startsWith('Source '));
    const expected = [
      ['official', 'a', ['official:a', 'official:b']],
      ['official', 'z', ['official:z']],
      ['project', 'b', ['project:b']]
    ] as const;
    expect(rows).toHaveLength(expected.length);
    for (const [scope, sourcePath, policyIds] of expected) {
      const matches = rows.filter(line => line.startsWith(`Source ${scope};`) && line.includes(`path=${sourcePath};`));
      expect(matches).toHaveLength(1);
      for (const policy of policyIds) expect(matches[0]).toContain(policy);
    }

    const json = await expectCliJson(workspaceRoot, ['policy', 'sources', '--json']);
    expect(json).toEqual(projected);
  });
});
