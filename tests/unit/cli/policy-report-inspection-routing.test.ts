import { expect, test } from 'bun:test';
import { expectRecord } from '../../helpers/assertion-helpers.ts';
import { writeJson } from '../../../src/adapters/filesystem/files.ts';

import { resolveWorkspaceArtifactPath } from '../../../src/adapters/workspace-context.ts';
import { projectPolicyReportInspect } from '../../../src/application/policy-report-inspection.ts';
import { CI_ARTIFACT_FILES } from '../../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import { formatPolicyReport } from '../../../src/entry/cli/policy-report-inspection.ts';
import type { PolicyReport } from '../../../src/semantics/policies/types.ts';
import { expectCliJson, expectCliSuccess, runCliInProcess } from '../../testkit/cli.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

test('policy inspection routes retained report through application summary projection and entry rendering while preserving JSON', async () => {
  // Keep the independently fixed non-CLI state projections formerly registered in tests/unit/policy-report-inspection-presentation.test.ts.
  {
    const source = {
      status: 'attention',
      officialPolicyCount: 2,
      projectPolicyCount: 1,
      mergedPolicyCount: 3,
      violationCount: 2,
      sourceCount: 4,
      severityCounts: { warning: 1, error: 1 },
      mergedSummaries: [
        { id: 'p1', sourceScope: 'official', sourcePath: 'a', targets: ['z', 'a'] },
        { id: 'p2', sourceScope: 'project', sourcePath: 'b', targets: ['b'] },
        { id: 'p3', sourceScope: 'official', sourcePath: 'c', targets: [] },
        { id: 'p4', sourceScope: 'official', sourcePath: 'd', targets: ['ignored'] }
      ],
      violationSummaries: [
        { id: 'v1', severity: 'warning', files: ['b.ts'], message: 'warn' },
        { id: 'v2', severity: 'error', files: ['a.ts'], message: 'fail' },
        { id: 'v3', severity: 'error', files: ['ignored.ts'], message: 'ignored' },
        { id: 'v4', severity: 'warning', files: [], message: 'ignored' }
      ]
    };

    const view = projectPolicyReportInspect(source);

    source.mergedSummaries[0]!.targets.push('later');
    source.violationSummaries[0]!.files.push('later.ts');

    expect(view.severityEntries).toEqual(['error=1', 'warning=1']);
    expect(view.policies).toHaveLength(3);
    expect(view.violations).toHaveLength(3);
    expect(view.policies[0]!.targets).toEqual(['z', 'a']);
    expect(view.violations[0]!.files).toEqual(['b.ts']);
    const rendered = formatPolicyReport(view).split('\n');
    expect(rendered).toHaveLength(9);
    const header = rendered.find(line => line.startsWith('Policy report '));
    expectRecord(header, ['Policy report attention', 'official=2', 'project=1', 'merged=3', 'violations=2']);
    expectRecord(rendered.find(line => line.startsWith('Sources:')), ['Sources: 4']);
    expectRecord(rendered.find(line => line.startsWith('Severity:')), ['Severity: error=1, warning=1']);
    const expectedRows = [
      ['Policy p1', ['scope=official', 'source=a', 'targets=z, a']],
      ['Policy p2', ['scope=project', 'source=b', 'targets=b']],
      ['Policy p3', ['scope=official', 'source=c', 'targets=none']],
      ['Violation v1', ['severity=warning', 'files=b.ts', 'warn']],
      ['Violation v2', ['severity=error', 'files=a.ts', 'fail']],
      ['Violation v3', ['severity=error', 'files=ignored.ts', 'ignored']]
    ] as const;
    const emittedRows = rendered.filter(line => /^(Policy p|Violation v)/u.test(line));
    expect(emittedRows).toHaveLength(expectedRows.length);
    for (const [label, fields] of expectedRows) {
      const row = emittedRows.find(line => line.startsWith(`${label};`));
      expectRecord(row, [label, ...fields]);
    }
  }
  await withTempWorkspace(async (workspaceRoot) => {
    const missing = await runCliInProcess(workspaceRoot, ['policy']);
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain('not found');
    expect(missing.stderr).not.toContain('commander.');

    const report: PolicyReport = {
      status: 'skipped',
      official: { policies: [], sources: [], violations: [] },
      project: { policies: [], sources: [], violations: [] },
      merged: { policies: [] },
      violations: [],
      diagnostics: []
    };

    const reportPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.policyReport);
    await writeJson(reportPath, report);

    // Projector/formatter meaning was independently verified with the
    // nonempty fixture above. The skipped report's real CLI output is a
    // separate source-backed witness, not a second formatter echo.
    const { stdout } = await expectCliSuccess(workspaceRoot, ['policy']);
    const lines = stdout.trimEnd().split(/\r?\n/u);
    expect(lines).toHaveLength(3);
    const header = lines.find(line => line.startsWith('Policy report '));
    expectRecord(header, ['Policy report skipped', 'official=0', 'project=0', 'merged=0', 'violations=0']);
    expectRecord(lines.find(line => line.startsWith('Sources:')), ['Sources: 0']);
    expectRecord(lines.find(line => line.startsWith('Severity:')), ['Severity: none']);

    const json = await expectCliJson(workspaceRoot, ['policy', 'report', '--json']);
    expect(json).toEqual(report);
  });
});
