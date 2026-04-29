import { uniqueSorted } from './collections.ts';
import type { CompilerErrorDetails } from './errors.ts';
import { buildErrorProtocol, type ErrorProtocol } from './error-protocol.ts';

export type ErrorProtocolExample = {
  id: string;
  input: {
    code?: string;
    message: string;
    details?: CompilerErrorDetails;
  };
  output: ErrorProtocol;
};

export type ErrorProtocolContract = {
  formatVersion: '1';
  status: 'active';
  command: string;
  exampleCount: number;
  examples: ErrorProtocolExample[];
  issueTypeCount: number;
  issueTypes: ErrorProtocol['issueType'][];
  suggestedActionCount: number;
  artifactPathCount: number;
  artifactPaths: string[];
};

const protocolExamples: Array<ErrorProtocolExample['input'] & { id: string }> = [
  {
    id: 'usage-error',
    code: 'UNEXPECTED',
    message: 'Usage: platform verify [--lane fast|runtime|all] [--json [--compact]]'
  },
  {
    id: 'unexpected-error',
    message: 'Unexpected failure'
  },
  {
    id: 'verify-blocked-error',
    code: 'VERIFY-BLOCKED-001',
    message: 'adapt must succeed before verify'
  },
  {
    id: 'verify-acceptance-error',
    code: 'VERIFY-ACCEPTANCE-003',
    message: 'Project verification failed'
  },
  {
    id: 'repair-preflight-error',
    code: 'REPAIR-BLOCKED-002',
    message: 'verify must run before repair'
  },
  {
    id: 'repair-plan-error',
    code: 'REPAIR-BLOCKED-001',
    message: 'Repair is blocked for current verification failure'
  },
  {
    id: 'upgrade-noop-error',
    code: 'UPGRADE-NOOP-001',
    message: 'Block is already at version "0.2.0"'
  },
  {
    id: 'upgrade-blocked-error',
    code: 'UPGRADE-BLOCKED-002',
    message: 'Target version "0.2.0" does not accept upgrade from "0.1.0"'
  },
  {
    id: 'upgrade-migration-error',
    code: 'UPGRADE-MIGRATION-004',
    message: 'Migration path "../outside-project.md" escapes project root'
  },
  {
    id: 'upgrade-rollback-error',
    code: 'UPGRADE-MIGRATION-016',
    message: 'slot-contract-update target "custom/customer_normalizer.ts" is missing',
    details: {
      migrationId: 'mig-customer-normalizer-contract',
      migrationKind: 'slot-contract-update',
      target: 'custom/customer_normalizer.ts',
      rollbackStatus: 'restored'
    }
  },
  {
    id: 'upgrade-conflict-error',
    code: 'UPGRADE-CONFLICT-001',
    message: 'Override "manual-auth-session-hotfix" conflicts with upgrade of "auth/basic-session"'
  },
  {
    id: 'workbench-mutation-error',
    code: 'WORKBENCH-MUTATION-002',
    message: 'rename.sourcePath must stay under source/code/slots/**'
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
      message: example.message,
      ...(example.details ? { details: example.details } : {})
    },
    output: buildErrorProtocol(example)
  }));
  const issueTypes = uniqueSorted(examples.map((example) => example.output.issueType));
  const suggestedActions = new Set(examples.flatMap((example) => example.output.suggestedActions));
  const artifactPaths = uniqueSorted(examples.flatMap((example) => example.output.artifactPaths));

  return {
    formatVersion: '1',
    status: 'active',
    command: 'npm run platform -- contract errors --json',
    exampleCount: examples.length,
    examples,
    issueTypeCount: issueTypes.length,
    issueTypes,
    suggestedActionCount: suggestedActions.size,
    artifactPathCount: artifactPaths.length,
    artifactPaths
  };
}

export function formatErrorProtocolContract(contract: ErrorProtocolContract): string {
  return [
    `Error protocol ${contract.status}`,
    `Command: ${contract.command}`,
    `Examples: ${contract.exampleCount}`,
    `Issue type count: ${contract.issueTypeCount}`,
    `Issue types: ${contract.issueTypes.join(', ')}`,
    `Suggested actions: ${contract.suggestedActionCount}`,
    `Artifact paths: ${contract.artifactPathCount}`,
    `Artifact path list: ${contract.artifactPaths.join(', ')}`,
    ...contract.examples.map((example) => [
      `Example ${example.id}`,
      `code=${example.output.code}`,
      `recoverable=${example.output.recoverable}`,
      `issueType=${example.output.issueType}`,
      `actions=${example.output.suggestedActions.join(', ')}`
    ].join('; '))
  ].join('\n');
}
