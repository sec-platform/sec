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
    const text = await expectCliSuccess(workspaceRoot, ['policy', 'sources']);
    for (const line of [
      'Policy sources passed',
      'sources=3; policies=4',
      'Source official; path=a; policies=official:a, official:b',
      'Source official; path=z; policies=official:z',
      'Source project; path=b; policies=project:b'
    ]) expect(text.stdout.split(/\r?\n/u)).toContain(line);
    const json = await expectCliJson(workspaceRoot, ['policy', 'sources', '--json']);
    expect(json).toEqual(projected);
  });
});
