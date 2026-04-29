import { uniqueSorted } from './collections.ts';
import type { PolicyReport, PolicySeverity, PolicySourceScope } from './policy-types.ts';

export interface ReviewPolicySourceSummary {
  scope: PolicySourceScope;
  path: string;
  policyIds: string[];
}

export interface ReviewPolicyMergedSummary {
  id: string;
  sourceScope: PolicySourceScope;
  sourcePath: string;
  targetCount: number;
  targets: string[];
}

export interface ReviewPolicyViolationSummary {
  id: string;
  severity: PolicySeverity;
  rule: string;
  fileCount: number;
  files: string[];
  appliesTo: string[];
  message: string;
  sourceScope: PolicySourceScope;
  sourcePath: string;
}

export interface ReviewPolicySummary {
  status: 'passed' | 'failed' | 'skipped';
  officialPolicyCount: number;
  projectPolicyCount: number;
  mergedPolicyCount: number;
  sourceCount: number;
  violationCount: number;
  severityCounts: Partial<Record<PolicySeverity, number>>;
  sourceSummaries: ReviewPolicySourceSummary[];
  mergedSummaries: ReviewPolicyMergedSummary[];
  violationSummaries: ReviewPolicyViolationSummary[];
}

function policySourceSummaryKey(summary: ReviewPolicySourceSummary): string {
  return `${summary.scope}:${summary.path}`;
}

function policyViolationSummaryKey(summary: ReviewPolicyViolationSummary): string {
  return `${summary.id}:${summary.rule}:${summary.message}`;
}

export function buildReviewPolicySummary(policyReport: PolicyReport): ReviewPolicySummary {
  const sourceSummaries = [
    ...policyReport.official.sources.map((source) => ({
      scope: 'official' as const,
      path: source.path,
      policyIds: uniqueSorted(source.policyIds)
    })),
    ...policyReport.project.sources.map((source) => ({
      scope: 'project' as const,
      path: source.path,
      policyIds: uniqueSorted(source.policyIds)
    }))
  ].sort((left, right) => policySourceSummaryKey(left).localeCompare(policySourceSummaryKey(right)));
  const severityCounts = policyReport.violations.reduce<ReviewPolicySummary['severityCounts']>(
    (counts, violation) => {
      counts[violation.severity] = (counts[violation.severity] ?? 0) + 1;
      return counts;
    },
    {}
  );

  return {
    status: policyReport.status,
    officialPolicyCount: policyReport.official.policies.length,
    projectPolicyCount: policyReport.project.policies.length,
    mergedPolicyCount: policyReport.merged.policies.length,
    sourceCount: sourceSummaries.length,
    violationCount: policyReport.violations.length,
    severityCounts,
    sourceSummaries,
    mergedSummaries: policyReport.merged.policies
      .map((policy) => ({
        id: policy.id,
        sourceScope: policy.sourceScope,
        sourcePath: policy.sourcePath,
        targetCount: policy.targets.length,
        targets: uniqueSorted(policy.targets)
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    violationSummaries: policyReport.violations
      .map((violation) => ({
        id: violation.id,
        severity: violation.severity,
        rule: violation.rule,
        fileCount: violation.files.length,
        files: uniqueSorted(violation.files),
        appliesTo: uniqueSorted(violation.appliesTo),
        message: violation.message,
        sourceScope: violation.sourceScope,
        sourcePath: violation.sourcePath
      }))
      .sort((left, right) => policyViolationSummaryKey(left).localeCompare(policyViolationSummaryKey(right)))
  };
}
