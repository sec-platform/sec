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

/**
 * Non-authoritative source/provider observation. Diagnostics may guide review
 * or a stronger verifier, but they cannot directly support or deny a semantic
 * Policy claim unless the evaluator also carries semantic assurance.
 */
export interface PolicyDiagnostic extends PolicyViolation {
  evidenceClass: 'source-structure';
}

/**
 * States what the evaluator actually proved. Structural/source evidence may
 * produce diagnostics, but it cannot support a semantic PASS or FAIL when the
 * canonical Engineering IR has no active fact producer for a required
 * predicate such as FLOWS_TO.
 */
export interface PolicyEvaluationAssurance {
  providerId: string;
  providerRevision: string;
  assurance: 'source-structure' | 'semantic';
  requiredSemanticPredicates: string[];
  unsupportedSemanticPredicates: string[];
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
  diagnostics?: PolicyDiagnostic[];
  /**
   * Optional only for migration from older writers. Absence never authorizes
   * a semantic Policy Verification PASS or FAIL for a required policy claim.
   */
  evaluation?: PolicyEvaluationAssurance;
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
