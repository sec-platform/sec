import type { PolicyReport } from '../../../semantics/policies/types.ts';
import { validatePolicyReport } from "../../../assurance/policies/report.ts";
import { compareCodeUnits, uniqueSorted } from '../../../contracts/canonical.ts';
import type { ReviewPolicySourceSummary, ReviewPolicySummary, ReviewPolicyViolationSummary } from './types.ts';

function policySourceSummaryKey(summary: ReviewPolicySourceSummary): string {
  return `${summary.scope}:${summary.path}`;
}

function policyViolationSummaryKey(summary: ReviewPolicyViolationSummary): string {
  return `${summary.id}:${summary.rule}:${summary.message}`;
}

function reviewPolicyStatus(policyReport: PolicyReport): ReviewPolicySummary['status'] {
  if (policyReport.status === 'skipped') return 'skipped';
  const evaluation = policyReport.evaluation;
  if (
    evaluation?.assurance !== 'semantic'
    || evaluation.unsupportedSemanticPredicates.length > 0
  ) {
    return 'attention';
  }
  return policyReport.status;
}

export function buildReviewPolicySummary(input: PolicyReport): ReviewPolicySummary {
  const policyReport = validatePolicyReport(input);
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
  ].sort((left, right) => compareCodeUnits(policySourceSummaryKey(left), policySourceSummaryKey(right)));
  const severityCounts = policyReport.violations.reduce<ReviewPolicySummary['severityCounts']>(
    (counts, violation) => {
      counts[violation.severity] = (counts[violation.severity] ?? 0) + 1;
      return counts;
    },
    {}
  );
  const evaluation = policyReport.evaluation;

  return {
    status: reviewPolicyStatus(policyReport),
    sourceReportStatus: policyReport.status,
    assurance: evaluation?.assurance ?? 'unknown',
    evaluatorProviderId: evaluation?.providerId ?? null,
    evaluatorProviderRevision: evaluation?.providerRevision ?? null,
    unsupportedSemanticPredicates: uniqueSorted(evaluation?.unsupportedSemanticPredicates ?? []),
    diagnosticCount: policyReport.diagnostics?.length ?? 0,
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
      .sort((left, right) => compareCodeUnits(left.id, right.id)),
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
      .sort((left, right) => compareCodeUnits(policyViolationSummaryKey(left), policyViolationSummaryKey(right)))
  };
}
