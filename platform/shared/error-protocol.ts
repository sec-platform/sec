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
      artifactPaths: ['control/evidence/verification-report.json', 'control/evidence/review-summary.json'],
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
      artifactPaths: ['control/evidence/verification-report.json'],
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
      artifactPaths: ['control/workflow/repair-plan.json', 'control/evidence/review-summary.json'],
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
      artifactPaths: ['control/workflow/upgrade-diagnostics.json'],
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
      artifactPaths: ['control/workflow/upgrade-diagnostics.json', 'control/workflow/upgrade-plan.json'],
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
      artifactPaths: ['control/workflow/upgrade-diagnostics.json', 'control/workflow/upgrade-plan.json'],
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
      artifactPaths: ['source/views/mutations', 'control/workflow/view-mutation-report.json'],
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
