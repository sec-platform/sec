import type { PolicyReportInspectView } from '../../application/policy-report-inspection.ts';
import { formatFields, formatList } from './format-utils.ts';

export function formatPolicyReport(view: PolicyReportInspectView): string {
  const lines = [
    formatFields([
      `Policy report ${view.status}`,
      `official=${view.officialPolicyCount}`,
      `project=${view.projectPolicyCount}`,
      `merged=${view.mergedPolicyCount}`,
      `violations=${view.violationCount}`
    ]),
    `Sources: ${view.sourceCount}`,
    `Severity: ${formatList([...view.severityEntries])}`
  ];

  for (const policy of view.policies) {
    lines.push(
      formatFields([
        `Policy ${policy.id}`,
        `scope=${policy.sourceScope}`,
        `source=${policy.sourcePath}`,
        `targets=${formatList([...policy.targets])}`
      ])
    );
  }

  for (const violation of view.violations) {
    lines.push(
      formatFields([
        `Violation ${violation.id}`,
        `severity=${violation.severity}`,
        `files=${formatList([...violation.files])}`,
        violation.message
      ])
    );
  }

  return lines.join('\n');
}
