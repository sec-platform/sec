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

export function buildErrorProtocol(error: {
  code?: string;
  message?: string;
  details?: CompilerErrorDetails;
}): ErrorProtocol {
  const code = error.code ?? 'UNEXPECTED';
  const message = error.message ?? 'Unexpected failure';

  if (message.startsWith('Usage: platform')) {
    return {
      code,
      message,
      recoverable: true,
      issueType: 'usage',
      suggestedActions: ['retry-with-supported-arguments'],
      artifactPaths: []
    };
  }

  if (code === 'UNEXPECTED') {
    return {
      code,
      message,
      recoverable: false,
      issueType: 'kernel',
      suggestedActions: ['inspect-cli-stack', 'collect-error-output'],
      artifactPaths: []
    };
  }

  if (code.startsWith('VERIFY-BLOCKED-')) {
    return {
      code,
      message,
      recoverable: true,
      issueType: 'composition',
      suggestedActions: ['run-platform-resolve', 'run-platform-compose', 'run-platform-adapt', 'retry-platform-verify'],
      artifactPaths: [],
      details: error.details
    };
  }

  if (code.startsWith('VERIFY-')) {
    return {
      code,
      message,
      recoverable: false,
      issueType: 'spec',
      suggestedActions: ['inspect-verification-report', 'run-platform-explain'],
      artifactPaths: [CI_ARTIFACT_FILES.verificationReport, CI_ARTIFACT_FILES.reviewSummary],
      details: error.details
    };
  }

  if (code === 'REPAIR-BLOCKED-002') {
    return {
      code,
      message,
      recoverable: true,
      issueType: 'composition',
      suggestedActions: ['run-platform-verify', 'retry-platform-repair-dry-run'],
      artifactPaths: [CI_ARTIFACT_FILES.verificationReport],
      details: error.details
    };
  }

  if (code.startsWith('REPAIR-')) {
    return {
      code,
      message,
      recoverable: true,
      issueType: 'slot',
      suggestedActions: ['inspect-repair-plan', 'run-platform-repair-dry-run'],
      artifactPaths: [CI_ARTIFACT_FILES.repairPlan, CI_ARTIFACT_FILES.reviewSummary],
      details: error.details
    };
  }

  if (code.startsWith('UPGRADE-NOOP-')) {
    return {
      code,
      message,
      recoverable: true,
      issueType: 'composition',
      suggestedActions: ['choose-different-upgrade-target'],
      artifactPaths: [],
      details: error.details
    };
  }

  if (code.startsWith('UPGRADE-BLOCKED-')) {
    return {
      code,
      message,
      recoverable: true,
      issueType: 'composition',
      suggestedActions: ['choose-compatible-upgrade-target', 'run-platform-upgrade-dry-run'],
      artifactPaths: [CI_ARTIFACT_FILES.upgradeDiagnostics],
      details: error.details
    };
  }

  if (code.startsWith('UPGRADE-MIGRATION-')) {
    return {
      code,
      message,
      recoverable: true,
      issueType: 'composition',
      suggestedActions: ['inspect-upgrade-diagnostics', 'fix-upgrade-migration'],
      artifactPaths: [CI_ARTIFACT_FILES.upgradeDiagnostics, CI_ARTIFACT_FILES.upgradePlan],
      details: error.details
    };
  }

  if (code.startsWith('UPGRADE-')) {
    return {
      code,
      message,
      recoverable: true,
      issueType: 'composition',
      suggestedActions: ['run-platform-upgrade-dry-run', 'inspect-upgrade-diagnostics'],
      artifactPaths: [CI_ARTIFACT_FILES.upgradeDiagnostics, CI_ARTIFACT_FILES.upgradePlan],
      details: error.details
    };
  }

  if (code.startsWith('WORKBENCH-MUTATION-')) {
    return {
      code,
      message,
      recoverable: true,
      issueType: 'spec',
      suggestedActions: ['inspect-workbench-mutations', 'run-platform-workbench-mutations-apply'],
      artifactPaths: ['source/views/mutations', CI_ARTIFACT_FILES.viewMutationReport],
      details: error.details
    };
  }

  return {
    code,
    message,
    recoverable: false,
    issueType: 'kernel',
    suggestedActions: ['collect-error-output'],
    artifactPaths: [],
    details: error.details
  };
}
