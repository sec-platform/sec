import type { PolicyReport } from '../semantics/policies/types.ts';

export type PolicyReportProjectionSource = PolicyReport;
import { buildReviewPolicySummary } from '../assurance/verification/review/contract/policy.ts';
import { compareCodeUnits } from '../contracts/canonical.ts';

export type PolicyReportInspectionSource = Readonly<{
  status: string;
  officialPolicyCount: number;
  projectPolicyCount: number;
  mergedPolicyCount: number;
  violationCount: number;
  sourceCount: number;
  severityCounts: Readonly<Record<string, number>>;
  mergedSummaries: readonly Readonly<{
    id: string;
    sourceScope: string;
    sourcePath: string;
    targets: readonly string[];
  }>[];
  violationSummaries: readonly Readonly<{
    id: string;
    severity: string;
    files: readonly string[];
    message: string;
  }>[];
}>;

export type PolicyReportInspectView = Readonly<{
  status: string;
  officialPolicyCount: number;
  projectPolicyCount: number;
  mergedPolicyCount: number;
  violationCount: number;
  sourceCount: number;
  severityEntries: readonly string[];
  policies: readonly Readonly<{
    id: string;
    sourceScope: string;
    sourcePath: string;
    targets: readonly string[];
  }>[];
  violations: readonly Readonly<{
    id: string;
    severity: string;
    files: readonly string[];
    message: string;
  }>[];
}>;

export function projectPolicyReportInspect(source: PolicyReportInspectionSource): PolicyReportInspectView {
  const severityEntries = Object.entries(source.severityCounts)
    .sort(([left], [right]) => compareCodeUnits(left, right))
    .map(([level, count]) => `${level}=${count}`);

  return {
    status: source.status,
    officialPolicyCount: source.officialPolicyCount,
    projectPolicyCount: source.projectPolicyCount,
    mergedPolicyCount: source.mergedPolicyCount,
    violationCount: source.violationCount,
    sourceCount: source.sourceCount,
    severityEntries,
    policies: source.mergedSummaries.slice(0, 3).map((policy) => ({
      id: policy.id,
      sourceScope: policy.sourceScope,
      sourcePath: policy.sourcePath,
      targets: [...policy.targets]
    })),
    violations: source.violationSummaries.slice(0, 3).map((violation) => ({
      id: violation.id,
      severity: violation.severity,
      files: [...violation.files],
      message: violation.message
    }))
  };
}

export function projectPolicyReportInspection(report: PolicyReport): PolicyReportInspectView {
  return projectPolicyReportInspect(buildReviewPolicySummary(report));
}
