import { expect, test } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';

import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { resolveWorkspaceArtifactPath } from '../../src/adapters/workspace-context.ts';
import { projectPolicyReportInspection } from '../../src/application/policy-report-inspection.ts';
import { formatPolicyReport } from '../../src/entry/cli/policy-report-inspection.ts';
import { expectCliJson, expectCliSuccess } from '../testkit/cli.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

test('policy inspection routes retained report through application summary projection and entry rendering while preserving JSON', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const report = {
      status: 'passed',
      official: {
        policies: ['policy:one'],
        sources: [{ path: 'official/policy-one.yaml', policyIds: ['policy:one'] }],
        violations: []
      },
      project: {
        policies: [],
        sources: [],
        violations: []
      },
      merged: {
        policies: [{
          id: 'policy:one',
          sourceScope: 'official',
          sourcePath: 'official/policy-one.yaml',
          targets: ['src/**']
        }]
      },
      violations: [],
      diagnostics: [],
      evaluation: {
        providerId: 'fixture',
        providerRevision: '1',
        assurance: 'semantic',
        requiredSemanticPredicates: [],
        unsupportedSemanticPredicates: []
      }
    } as const;

    const reportPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.policyReport);
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

    const projected = projectPolicyReportInspection(report);
    await expectCliSuccess(
      workspaceRoot,
      ['policy'],
      `${formatPolicyReport(projected)}\n`
    );

    const json = await expectCliJson(workspaceRoot, ['policy', '--json']);
    expect(json).toEqual(report);
  });
});
