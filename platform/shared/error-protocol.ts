import type { CompilerErrorDetails } from './errors.ts';

export type ErrorProtocol = {
  code: string;
  message: string;
  recoverable: boolean;
  issueType: 'usage' | 'spec' | 'composition' | 'slot' | 'kernel';
  suggestedActions: string[];
  details?: CompilerErrorDetails;
};

export function buildErrorProtocol(error: {
  code?: string;
  message?: string;
  details?: CompilerErrorDetails;
}): ErrorProtocol {
  const code = error.code ?? 'UNEXPECTED';
  const message = error.message ?? 'Unexpected failure';

  if (code === 'UNEXPECTED') {
    return {
      code,
      message,
      recoverable: false,
      issueType: 'kernel',
      suggestedActions: ['inspect-cli-stack', 'collect-error-output']
    };
  }

  if (message.startsWith('Usage: platform')) {
    return {
      code,
      message,
      recoverable: true,
      issueType: 'usage',
      suggestedActions: ['retry-with-supported-arguments']
    };
  }

  if (code.startsWith('VERIFY-')) {
    return {
      code,
      message,
      recoverable: false,
      issueType: 'spec',
      suggestedActions: ['inspect-verification-report', 'run-platform-explain'],
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
      details: error.details
    };
  }

  return {
    code,
    message,
    recoverable: false,
    issueType: 'kernel',
    suggestedActions: ['collect-error-output'],
    details: error.details
  };
}
