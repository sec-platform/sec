import {
  parseExactRefRetirement,
  type ExactRefRetirement
} from '../branch-lifecycle/exact-ref-retirement-contract.ts';

export const REPOSITORY_MAINTENANCE_REQUEST_SCHEMA =
  'sec-repository-maintenance-request-v1' as const;

export type ExactCommentRetirement = Readonly<{
  issueNumber: number;
  commentId: number;
  expectedBodyDigest: `sha256:${string}`;
}>;

export type MaintenanceOperation =
  | Readonly<{
      kind: 'exact-ref-retirement';
      retirement: ExactRefRetirement;
    }>
  | Readonly<{
      kind: 'exact-comment-retirement';
      retirement: ExactCommentRetirement;
    }>;

export type MaintenanceRequest = Readonly<{
  schema: typeof REPOSITORY_MAINTENANCE_REQUEST_SCHEMA;
  repository: string;
  expectedMainSha: string;
  operations: readonly MaintenanceOperation[];
}>;

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be one object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  if (actual.length !== sorted.length || actual.some((key, index) => key !== sorted[index])) {
    throw new Error(`${label} fields are invalid`);
  }
}

function repository(value: unknown): string {
  if (typeof value !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(value)) {
    throw new Error('repository must be one bounded owner/name identity');
  }
  return value;
}

function sha(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) {
    throw new Error(`${label} must be one Git SHA`);
  }
  return value;
}

function digest(value: unknown, label: string): `sha256:${string}` {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be one SHA-256 digest`);
  }
  return value as `sha256:${string}`;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new Error(`${label} must be one positive integer`);
  }
  return Number(value);
}

function parseExactCommentRetirement(value: unknown): ExactCommentRetirement {
  const input = record(value, 'exact comment retirement');
  exactKeys(
    input,
    ['issueNumber', 'commentId', 'expectedBodyDigest'],
    'exact comment retirement'
  );
  return Object.freeze({
    issueNumber: positiveInteger(input.issueNumber, 'issueNumber'),
    commentId: positiveInteger(input.commentId, 'commentId'),
    expectedBodyDigest: digest(input.expectedBodyDigest, 'expectedBodyDigest')
  });
}

function parseOperation(value: unknown): MaintenanceOperation {
  const input = record(value, 'maintenance operation');
  exactKeys(input, ['kind', 'retirement'], 'maintenance operation');
  if (input.kind === 'exact-ref-retirement') {
    return Object.freeze({
      kind: 'exact-ref-retirement',
      retirement: parseExactRefRetirement(input.retirement)
    });
  }
  if (input.kind === 'exact-comment-retirement') {
    return Object.freeze({
      kind: 'exact-comment-retirement',
      retirement: parseExactCommentRetirement(input.retirement)
    });
  }
  throw new Error('maintenance operation kind is unknown');
}

export function parseRepositoryMaintenanceRequest(source: string): MaintenanceRequest {
  if (Buffer.byteLength(source, 'utf8') > 131_072) {
    throw new Error('repository maintenance request exceeds the bounded byte limit');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(source); }
  catch { throw new Error('repository maintenance request is not JSON'); }
  const input = record(parsed, 'repository maintenance request');
  exactKeys(input, ['schema', 'repository', 'expectedMainSha', 'operations'],
    'repository maintenance request');
  if (input.schema !== REPOSITORY_MAINTENANCE_REQUEST_SCHEMA) {
    throw new Error('repository maintenance request schema is invalid');
  }
  if (!Array.isArray(input.operations) || input.operations.length !== 1) {
    throw new Error('repository maintenance request requires exactly one operation');
  }
  return Object.freeze({
    schema: REPOSITORY_MAINTENANCE_REQUEST_SCHEMA,
    repository: repository(input.repository),
    expectedMainSha: sha(input.expectedMainSha, 'expectedMainSha'),
    operations: Object.freeze(input.operations.map(parseOperation))
  });
}
