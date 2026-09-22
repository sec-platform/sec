import type { CompilerErrorDetails } from '../compiler/errors.ts';
import { uniqueSorted } from '../contracts/canonical.ts';
import { srcRelativePath } from '../workspace/paths.ts';
import { buildErrorProtocol, type ErrorProtocol } from './error-protocol.ts';

const ERROR_PROTOCOL_CONTRACT_STATUS_ACTIVE = 'active' as const;

type ErrorProtocolExample = {
  id: string;
  input: {
    code?: string;
    message: string;
    details?: CompilerErrorDetails;
  };
  output: ErrorProtocol;
};

export type ErrorProtocolContract = {
  status: typeof ERROR_PROTOCOL_CONTRACT_STATUS_ACTIVE;
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
    code: 'CLI-USAGE-001',
    message: 'Usage: platform verify [--lane fast|runtime|all] [--json [--compact]]'
  },
  {
    id: 'unexpected-error',
    message: 'Unexpected failure'
  },
  {
    id: 'verify-blocked-error',
    code: 'VERIFY-BLOCKED-001',
    message: 'compose must succeed before verify'
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
    message: `file-replace target "${srcRelativePath}/installed/private/customer-normalizer.ts" is missing`,
    details: {
      migrationId: 'mig-customer-normalizer-file',
      migrationKind: 'file-replace',
      target: `${srcRelativePath}/installed/private/customer-normalizer.ts`,
      rollbackStatus: 'restored'
    }
  },
  {
    id: 'upgrade-conflict-error',
    code: 'UPGRADE-CONFLICT-001',
    message: 'Override "manual-auth-session-hotfix" conflicts with upgrade of "auth/basic-session"'
  },
  {
    id: 'drift-error',
    code: 'ERROR-DRIFT-001',
    message: `Reference drift detected: Read-only project file modified: ${srcRelativePath}/runtime/database.ts`
  },
  {
    id: 'kernel-error',
    code: 'KERNEL-FAILED',
    message: 'Kernel failure'
  }
];

export function buildErrorProtocolContract(command: string): ErrorProtocolContract {
  const examples = protocolExamples.map((example) => {
    // The catalog is private reusable data; only this result owns its copy.
    // Real thrown error details still pass through buildErrorProtocol unchanged.
    const input = {
      ...(example.code ? { code: example.code } : {}),
      message: example.message,
      ...(example.details ? { details: structuredClone(example.details) } : {})
    };
    return { id: example.id, input, output: buildErrorProtocol(input) };
  });
  const issueTypes = uniqueSorted(examples.map((example) => example.output.issueType));
  const suggestedActions = new Set(examples.flatMap((example) => example.output.suggestedActions));
  const artifactPaths = uniqueSorted(examples.flatMap((example) => example.output.artifactPaths));

  return {
    status: ERROR_PROTOCOL_CONTRACT_STATUS_ACTIVE,
    command,
    exampleCount: examples.length,
    examples,
    issueTypeCount: issueTypes.length,
    issueTypes,
    suggestedActionCount: suggestedActions.size,
    artifactPathCount: artifactPaths.length,
    artifactPaths
  };
}
