import { describe, expect, test } from 'bun:test';

import { projectPolicyReportInspect } from '../../src/application/policy-report-inspection.ts';
import { formatPolicyReport } from '../../src/entry/cli/policy-report-inspection.ts';

describe('policy report inspection presentation boundary', () => {
  test('application owns finite summary projection and severity ordering while entry only renders', () => {
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
    expect(formatPolicyReport(view)).toBe([
      'Policy report attention; official=2; project=1; merged=3; violations=2',
      'Sources: 4',
      'Severity: error=1, warning=1',
      'Policy p1; scope=official; source=a; targets=z, a',
      'Policy p2; scope=project; source=b; targets=b',
      'Policy p3; scope=official; source=c; targets=none',
      'Violation v1; severity=warning; files=b.ts; warn',
      'Violation v2; severity=error; files=a.ts; fail',
      'Violation v3; severity=error; files=ignored.ts; ignored'
    ].join('\n'));
  });
});
