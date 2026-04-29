import type { PolicySeverity, PolicySourceScope } from './policy-types.ts';

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
