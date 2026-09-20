import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { resolveWorkspaceArtifactPath } from '../../src/adapters/workspace-context.ts';
import { projectPolicySources } from '../../src/application/policy-source-inspection.ts';
import { formatPolicySources } from '../../src/entry/cli/policy-source-inspection.ts';
import { expectCliJson, expectCliSuccess } from '../testkit/cli.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('policy sources routes retained policy evidence through application and entry', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const report = {
      status: 'passed',
      official: {
        sources: [
          { path: 'official/z', policyIds: ['official:z'] },
          { path: 'official/a', policyIds: ['official:a'] }
        ]
      },
      project: {
        sources: [{ path: 'project/b', policyIds: ['project:b', 'project:c'] }]
      }
    };
    const reportPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.policyReport);
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    const projected = projectPolicySources(report);
    await expectCliSuccess(
      workspaceRoot,
      ['policy', 'sources'],
      `${formatPolicySources(projected)}\n`
    );
    const json = await expectCliJson(workspaceRoot, ['policy', 'sources', '--json']);
    expect(json).toEqual(projected);
  });
});
