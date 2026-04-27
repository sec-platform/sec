import { buildErrorProtocol, type ErrorProtocol } from './error-protocol.ts';

export type ErrorProtocolExample = {
  id: string;
  input: {
    code?: string;
    message: string;
  };
  output: ErrorProtocol;
};

export type ErrorProtocolContract = {
  formatVersion: '1';
  status: 'active';
  command: string;
  exampleCount: number;
  examples: ErrorProtocolExample[];
  issueTypes: ErrorProtocol['issueType'][];
  suggestedActionCount: number;
};

const protocolExamples: Array<ErrorProtocolExample['input'] & { id: string }> = [
  {
    id: 'usage-error',
    code: 'UNEXPECTED',
    message: 'Usage: platform verify [--lane fast|runtime|all]'
  },
  {
    id: 'unexpected-error',
    message: 'Unexpected failure'
  },
  {
    id: 'verify-error',
    code: 'VERIFY-FAILED',
    message: 'Verification failed'
  },
  {
    id: 'repair-error',
    code: 'REPAIR-BLOCKED-001',
    message: 'Repair is blocked'
  },
  {
    id: 'upgrade-error',
    code: 'UPGRADE-CONFLICT-001',
    message: 'Upgrade conflict detected'
  },
  {
    id: 'kernel-error',
    code: 'KERNEL-FAILED',
    message: 'Kernel failure'
  }
];

export function buildErrorProtocolContract(): ErrorProtocolContract {
  const examples = protocolExamples.map((example) => ({
    id: example.id,
    input: {
      ...(example.code ? { code: example.code } : {}),
      message: example.message
    },
    output: buildErrorProtocol(example)
  }));
  const issueTypes = [...new Set(examples.map((example) => example.output.issueType))].sort(
    (left, right) => left.localeCompare(right)
  );
  const suggestedActions = new Set(examples.flatMap((example) => example.output.suggestedActions));

  return {
    formatVersion: '1',
    status: 'active',
    command: 'npm run platform -- contract errors --json',
    exampleCount: examples.length,
    examples,
    issueTypes,
    suggestedActionCount: suggestedActions.size
  };
}

export function formatErrorProtocolContract(contract: ErrorProtocolContract): string {
  return [
    `Error protocol ${contract.status}`,
    `Command: ${contract.command}`,
    `Examples: ${contract.exampleCount}`,
    `Issue types: ${contract.issueTypes.join(', ')}`,
    `Suggested actions: ${contract.suggestedActionCount}`,
    ...contract.examples.map((example) => [
      `Example ${example.id}`,
      `code=${example.output.code}`,
      `recoverable=${example.output.recoverable}`,
      `issueType=${example.output.issueType}`,
      `actions=${example.output.suggestedActions.join(', ')}`
    ].join('; '))
  ].join('\n');
}
