import { formatFields, formatList } from './format-utils.ts';

export type VerificationReportInspectionSource = Readonly<{
  summary: Readonly<{
    status: string;
    requestedLane: string;
    failedLanes: readonly string[];
  }>;
  fast: Readonly<{
    status: string;
    build: Readonly<{ status: string }>;
    unit: Readonly<{ status: string }>;
    acceptance: Readonly<{ status: string }>;
    policy: Readonly<{ status: string }>;
  }>;
  runtime: Readonly<{
    status: string;
    build: Readonly<{ status: string }>;
    unit: Readonly<{ status: string }>;
    acceptance: Readonly<{ status: string }>;
  }>;
}>;

export function formatVerificationReport(view: VerificationReportInspectionSource): string {
  return [
    formatFields([
      `Verification report ${view.summary.status}`,
      `requestedLane=${view.summary.requestedLane}`,
      `failedLanes=${formatList(view.summary.failedLanes)}`
    ]),
    formatFields([
      `Fast: ${view.fast.status}`,
      `build=${view.fast.build.status}`,
      `unit=${view.fast.unit.status}`,
      `acceptance=${view.fast.acceptance.status}`,
      `policy=${view.fast.policy.status}`
    ]),
    formatFields([
      `Runtime: ${view.runtime.status}`,
      `build=${view.runtime.build.status}`,
      `unit=${view.runtime.unit.status}`,
      `acceptance=${view.runtime.acceptance.status}`
    ])
  ].join('\n');
}
