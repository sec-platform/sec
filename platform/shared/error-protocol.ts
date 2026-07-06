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
  { prefix: 'PIPELINE-USAGE-', recoverable: true, issueType: 'usage', suggestedActions: ['retry-with-supported-pipeline-arguments'], artifactPaths: [] },
  { prefix: 'PIPELINE-BLOCKED-', recoverable: true, issueType: 'composition', suggestedActions: ['inspect-pipeline-journal', 'run-required-upstream-stage', 'retry-pipeline'], artifactPaths: [] },
  { prefix: 'PIPELINE-INTERRUPTED-', recoverable: true, issueType: 'composition', suggestedActions: ['inspect-pipeline-journal', 'retry-pipeline'], artifactPaths: [] },
  { prefix: 'PIPELINE-', recoverable: false, issueType: 'kernel', suggestedActions: ['inspect-pipeline-journal', 'collect-error-output', 'report-bug'], artifactPaths: [] },
  { prefix: 'RESOLVE-CONFLICT-', recoverable: true, issueType: 'composition', suggestedActions: ['remove-conflicting-block', 'choose-alternative-block', 'run-platform-resolve'], artifactPaths: [CI_ARTIFACT_FILES.blockUsageMap] },
  { prefix: 'RESOLVE-MISSING-', recoverable: true, issueType: 'composition', suggestedActions: ['add-required-block', 'run-platform-add', 'run-platform-resolve'], artifactPaths: [CI_ARTIFACT_FILES.blockUsageMap] },
  { prefix: 'RESOLVE-CYCLE-', recoverable: false, issueType: 'composition', suggestedActions: ['resolve-dependency-cycle', 'inspect-block-manifests'], artifactPaths: [CI_ARTIFACT_FILES.blockUsageMap] },
  { prefix: 'RESOLVE-INTERNAL-', recoverable: false, issueType: 'kernel', suggestedActions: ['collect-error-output', 'report-bug'], artifactPaths: [] },
  { prefix: 'RESOLVE-', recoverable: true, issueType: 'composition', suggestedActions: ['run-platform-resolve', 'inspect-graph-lock'], artifactPaths: [CI_ARTIFACT_FILES.blockUsageMap] },
  { prefix: 'ALIGN-SLOT-', recoverable: true, issueType: 'composition', suggestedActions: ['fix-slot-configuration', 'inspect-block-manifest'], artifactPaths: [CI_ARTIFACT_FILES.blockUsageMap] },
  { prefix: 'ALIGN-STACK-', recoverable: false, issueType: 'composition', suggestedActions: ['choose-compatible-block', 'change-project-stack'], artifactPaths: [] },
  { prefix: 'ALIGN-', recoverable: true, issueType: 'composition', suggestedActions: ['run-platform-resolve', 'inspect-graph-lock'], artifactPaths: [] },
  { prefix: 'COMPOSE-BLOCKED-', recoverable: true, issueType: 'composition', suggestedActions: ['run-platform-resolve', 'retry-platform-compose'], artifactPaths: [] },
  { prefix: 'COMPOSE-PATH-', recoverable: false, issueType: 'composition', suggestedActions: ['inspect-block-manifest', 'report-bug'], artifactPaths: [CI_ARTIFACT_FILES.installManifest] },
  { prefix: 'COMPOSE-PRISMA-', recoverable: true, issueType: 'composition', suggestedActions: ['inspect-prisma-schema', 'fix-prisma-template'], artifactPaths: [] },
  { prefix: 'COMPOSE-', recoverable: true, issueType: 'composition', suggestedActions: ['run-platform-compose', 'inspect-install-manifest'], artifactPaths: [CI_ARTIFACT_FILES.installManifest] },
  { prefix: 'SLOT-WRITE-', recoverable: true, issueType: 'slot', suggestedActions: ['run-platform-compose', 'retry-platform-adapt'], artifactPaths: [] },
  { prefix: 'SLOT-SECURITY-', recoverable: false, issueType: 'slot', suggestedActions: ['review-slot-code', 'remove-forbidden-imports', 'inspect-slot-security-report'], artifactPaths: ['source/code/slots'] },
  { prefix: 'SLOT-', recoverable: true, issueType: 'slot', suggestedActions: ['inspect-slot-tasks', 'run-platform-adapt'], artifactPaths: [] },
  { prefix: 'OVERRIDE-SCHEMA-', recoverable: true, issueType: 'spec', suggestedActions: ['fix-override-manifest', 'inspect-override-rules'], artifactPaths: ['source/patches/override-manifest.yaml'] },
  { prefix: 'OVERRIDE-APPLY-', recoverable: true, issueType: 'spec', suggestedActions: ['fix-override-source', 'inspect-override-manifest'], artifactPaths: ['source/patches/override-manifest.yaml'] },
  { prefix: 'OVERRIDE-', recoverable: true, issueType: 'spec', suggestedActions: ['inspect-override-manifest'], artifactPaths: ['source/patches/override-manifest.yaml'] },
  { prefix: 'PARSE-', recoverable: true, issueType: 'spec', suggestedActions: ['fix-plan-file', 'inspect-app-yaml'], artifactPaths: ['source/app.yaml'] },
  { prefix: 'VERIFY-BLOCKED-', recoverable: true, issueType: 'composition', suggestedActions: ['run-platform-resolve', 'run-platform-compose', 'run-platform-adapt', 'retry-platform-verify'], artifactPaths: [] },
  { prefix: 'VERIFY-', recoverable: false, issueType: 'spec', suggestedActions: ['inspect-verification-report', 'run-platform-explain'], artifactPaths: [CI_ARTIFACT_FILES.verificationReport, CI_ARTIFACT_FILES.reviewSummary] },
  { prefix: 'REPAIR-BLOCKED-002', recoverable: true, issueType: 'composition', suggestedActions: ['run-platform-verify', 'retry-platform-repair-dry-run'], artifactPaths: [CI_ARTIFACT_FILES.verificationReport] },
  { prefix: 'REPAIR-', recoverable: true, issueType: 'slot', suggestedActions: ['inspect-repair-plan', 'run-platform-repair-dry-run'], artifactPaths: [CI_ARTIFACT_FILES.repairPlan, CI_ARTIFACT_FILES.reviewSummary] },
  { prefix: 'UPGRADE-NOOP-', recoverable: true, issueType: 'composition', suggestedActions: ['choose-different-upgrade-target'], artifactPaths: [] },
  { prefix: 'UPGRADE-BLOCKED-', recoverable: true, issueType: 'composition', suggestedActions: ['choose-compatible-upgrade-target', 'run-platform-upgrade-dry-run'], artifactPaths: [CI_ARTIFACT_FILES.upgradeDiagnostics] },
  { prefix: 'UPGRADE-MIGRATION-', recoverable: true, issueType: 'composition', suggestedActions: ['inspect-upgrade-diagnostics', 'fix-upgrade-migration'], artifactPaths: [CI_ARTIFACT_FILES.upgradeDiagnostics, CI_ARTIFACT_FILES.upgradePlan] },
  { prefix: 'UPGRADE-', recoverable: true, issueType: 'composition', suggestedActions: ['run-platform-upgrade-dry-run', 'inspect-upgrade-diagnostics'], artifactPaths: [CI_ARTIFACT_FILES.upgradeDiagnostics, CI_ARTIFACT_FILES.upgradePlan] },
  { prefix: 'WORKBENCH-MUTATION-', recoverable: true, issueType: 'spec', suggestedActions: ['inspect-workbench-mutations', 'run-platform-workbench-mutations-apply'], artifactPaths: ['source/views/mutations', CI_ARTIFACT_FILES.viewMutationReport] },
  { prefix: 'ERROR-DRIFT-', recoverable: false, issueType: 'spec', suggestedActions: ['run-platform-compose', 'run-platform-adapt', 'revert-local-project-changes'], artifactPaths: [CI_ARTIFACT_FILES.provenance] }
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
