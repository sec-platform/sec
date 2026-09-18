import type { PolicySourceInspect } from '../../application/policy-source-inspection.ts';
import { formatFields, formatList } from './format-utils.ts';

export function formatPolicySources(report: PolicySourceInspect): string {
  const lines = [
    `Policy sources ${report.status}`,
    formatFields([`sources=${report.sourceCount}`, `policies=${report.policyCount}`])
  ];
  for (const source of report.sources.slice(0, 5)) {
    lines.push(
      formatFields([
        `Source ${source.scope}`,
        `path=${source.path}`,
        `policies=${formatList(source.policyIds)}`
      ])
    );
  }
  return lines.join('\n');
}
