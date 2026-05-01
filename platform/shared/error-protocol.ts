import { CI_ARTIFACT_FILES } from './ci-artifact-contract.ts';
import type { CompilerErrorDetails } from './errors.ts';

export type ErrorProtocol = {
  code: string;
  message: string;
  recoverable: boolean;
  issueType: 'usage' | 'spec' | 'composition' | 'slot' | 'kernel';
  suggestedActions: string[];
  artifactPaths: string[];
  details?: CompilerErrorDetails;
};

type ErrorProtocolRule = {
  prefix: string;
  recoverable: boolean;
  issueType: ErrorProtocol['issueType'];
  suggestedActions: string[];
  artifactPaths: string[];
};

const ERROR_PROTOCOL_RULES: ErrorProtocolRule[] = [
  { prefix: 'VERIFY-BLOCKED-', recoverable: true, issueType: 'composition', suggestedActions: ['run-platform-resolve', 'run-platform-compose', 'run-platform-adapt', 'retry-platform-verify'], artifactPaths: [] },
  { prefix: 'VERIFY-', recoverable: false, issueType: 'spec', suggestedActions: ['inspect-verification-report', 'run-platform-explain'], artifactPaths: [CI_ARTIFACT_FILES.verificationReport, CI_ARTIFACT_FILES.reviewSummary] },
  { prefix: 'REPAIR-BLOCKED-002', recoverable: true, issueType: 'composition', suggestedActions: ['run-platform-verify', 'retry-platform-repair-dry-run'], artifactPaths: [CI_ARTIFACT_FILES.verificationReport] },
  { prefix: 'REPAIR-', recoverable: true, issueType: 'slot', suggestedActions: ['inspect-repair-plan', 'run-platform-repair-dry-run'], artifactPaths: [CI_ARTIFACT_FILES.repairPlan, CI_ARTIFACT_FILES.reviewSummary] },
  { prefix: 'UPGRADE-NOOP-', recoverable: true, issueType: 'composition', suggestedActions: ['choose-different-upgrade-target'], artifactPaths: [] },
  { prefix: 'UPGRADE-BLOCKED-', recoverable: true, issueType: 'composition', suggestedActions: ['choose-compatible-upgrade-target', 'run-platform-upgrade-dry-run'], artifactPaths: [CI_ARTIFACT_FILES.upgradeDiagnostics] },
  { prefix: 'UPGRADE-MIGRATION-', recoverable: true, issueType: 'composition', suggestedActions: ['inspect-upgrade-diagnostics', 'fix-upgrade-migration'], artifactPaths: [CI_ARTIFACT_FILES.upgradeDiagnostics, CI_ARTIFACT_FILES.upgradePlan] },
  { prefix: 'UPGRADE-', recoverable: true, issueType: 'composition', suggestedActions: ['run-platform-upgrade-dry-run', 'inspect-upgrade-diagnostics'], artifactPaths: [CI_ARTIFACT_FILES.upgradeDiagnostics, CI_ARTIFACT_FILES.upgradePlan] },
  { prefix: 'WORKBENCH-MUTATION-', recoverable: true, issueType: 'spec', suggestedActions: ['inspect-workbench-mutations', 'run-platform-workbench-mutations-apply'], artifactPaths: ['source/views/mutations', CI_ARTIFACT_FILES.viewMutationReport] }
];

export function buildErrorProtocol(error: {
  code?: string;
  message?: string;
  details?: CompilerErrorDetails;
}): ErrorProtocol {
  const code = error.code ?? 'UNEXPECTED';
  const message = error.message ?? 'Unexpected failure';

  if (message.startsWith('Usage: platform')) {
    return { code, message, recoverable: true, issueType: 'usage', suggestedActions: ['retry-with-supported-arguments'], artifactPaths: [] };
  }

  if (code === 'UNEXPECTED') {
    return { code, message, recoverable: false, issueType: 'kernel', suggestedActions: ['inspect-cli-stack', 'collect-error-output'], artifactPaths: [] };
  }

  const rule = ERROR_PROTOCOL_RULES.find((r) => code.startsWith(r.prefix));
  if (rule) {
    return { code, message, recoverable: rule.recoverable, issueType: rule.issueType, suggestedActions: rule.suggestedActions, artifactPaths: rule.artifactPaths, details: error.details };
  }

  return { code, message, recoverable: false, issueType: 'kernel', suggestedActions: ['collect-error-output'], artifactPaths: [], details: error.details };
}
