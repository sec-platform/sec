export type PolicySeverity = 'info' | 'warn' | 'error' | 'blocker';
export type PolicySourceScope = 'official' | 'project';

export interface PolicySourceFileReport {
  path: string;
  policyIds: string[];
}

export interface MergedPolicyReportEntry {
  id: string;
  sourceScope: PolicySourceScope;
  sourcePath: string;
  targets: string[];
}

export interface PolicyViolation {
  id: string;
  severity: PolicySeverity;
  appliesTo: string[];
  rule: string;
  files: string[];
  message: string;
  sourceScope: PolicySourceScope;
  sourcePath: string;
}

export interface PolicyReport {
  status: 'passed' | 'failed' | 'skipped';
  official: {
    policies: string[];
    sources: PolicySourceFileReport[];
    violations: PolicyViolation[];
  };
  project: {
    policies: string[];
    sources: PolicySourceFileReport[];
    violations: PolicyViolation[];
  };
  merged: {
    policies: MergedPolicyReportEntry[];
  };
  violations: PolicyViolation[];
}

export interface PolicyRule {
  id: string;
  severity: PolicySeverity;
  appliesTo: string[];
  rule: string;
}

export interface PolicySpec {
  policies: PolicyRule[];
}
