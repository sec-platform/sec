import type { VerificationReportInspectView } from '../../application/verification-report-inspect.ts';
import { formatFields, formatList } from './format-utils.ts';

export function formatVerificationReport(view: VerificationReportInspectView): string {
  return [
    formatFields([
      `Verification report ${view.status}`,
      `requestedLane=${view.requestedLane}`,
      `failedLanes=${formatList([...view.failedLanes])}`
    ]),
    formatFields([
      `Fast: ${view.fast.status}`,
      `build=${view.fast.buildStatus}`,
      `unit=${view.fast.unitStatus}`,
      `acceptance=${view.fast.acceptanceStatus}`,
      `policy=${view.fast.policyStatus}`
    ]),
    formatFields([
      `Runtime: ${view.runtime.status}`,
      `build=${view.runtime.buildStatus}`,
      `unit=${view.runtime.unitStatus}`,
      `acceptance=${view.runtime.acceptanceStatus}`
    ])
  ].join('\n');
}
