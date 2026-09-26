import {
  parseExactRefRetirement,
  type ExactRefRetirement
} from '../branch-lifecycle/exact-ref-retirement-contract.ts';
import {
  parseExactCommentRetirement,
  type ExactCommentRetirement
} from './comment-retirement-contract.ts';

export const REPOSITORY_MAINTENANCE_REQUEST_SCHEMA = 'sec-repository-maintenance-request-v1' as const;

export type MaintenanceOperation =
  | Readonly<{
      kind: 'exact-ref-retirement';
      retirement: ExactRefRetirement;
    }>
  | Readonly<{
      kind: 'closed-pr-retirement';
      pullRequestNumber: number;
      reviewCommentId: number | null;
    }>
  | Readonly<{
      kind: 'closed-conversation-comment-retirement';
      issueNumber: number;
      comments: readonly ExactCommentRetirement[];
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

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) throw new Error(`${label} must be one positive integer`);
  return Number(value);
}

function repository(value: unknown): string {
  if (typeof value !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[-A-Za-z0-9._]{1,100}$/u.test(value)) {
    throw new Error('repository must be one bounded owner/name identity');
  }
  return value;
}

function sha(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/u.test(value)) throw new Error(`${label} must be one Git SHA`);
  return value;
}

function parseOperation(value: unknown): MaintenanceOperation {
  const input = record(value, 'maintenance operation');
  if (input.kind === 'exact-ref-retirement') {
    exactKeys(input, ['kind', 'retirement'], 'exact-ref-retirement');
    return Object.freeze({ kind: 'exact-ref-retirement', retirement: parseExactRefRetirement(input.retirement) });
  }
  if (input.kind === 'closed-pr-retirement') {
    exactKeys(input, ['kind', 'pullRequestNumber', 'reviewCommentId'], 'closed-pr-retirement');
    const reviewCommentId = input.reviewCommentId === null
      ? null : positiveInteger(input.reviewCommentId, 'reviewCommentId');
    return Object.freeze({
      kind: 'closed-pr-retirement',
      pullRequestNumber: positiveInteger(input.pullRequestNumber, 'pullRequestNumber'),
      reviewCommentId
    });
  }
  if (input.kind === 'closed-conversation-comment-retirement') {
    exactKeys(input, ['kind', 'issueNumber', 'comments'], 'closed-conversation-comment-retirement');
    if (!Array.isArray(input.comments) || input.comments.length < 1 || input.comments.length > 100) {
      throw new Error('closed conversation comment retirement requires 1..100 comments');
    }
    const comments = input.comments.map(parseExactCommentRetirement);
    if (new Set(comments.map(({ commentId }) => commentId)).size !== comments.length) {
      throw new Error('comment retirement request contains duplicate comment ids');
    }
    return Object.freeze({
      kind: 'closed-conversation-comment-retirement',
      issueNumber: positiveInteger(input.issueNumber, 'issueNumber'),
      comments: Object.freeze(comments)
    });
  }
  throw new Error('maintenance operation kind is unknown');
}

export function parseRepositoryMaintenanceRequest(source: string): MaintenanceRequest {
  let parsed: unknown;
  try { parsed = JSON.parse(source); }
  catch { throw new Error('repository maintenance request is not JSON'); }
  const input = record(parsed, 'repository maintenance request');
  exactKeys(input, ['schema', 'repository', 'expectedMainSha', 'operations'], 'repository maintenance request');
  if (input.schema !== REPOSITORY_MAINTENANCE_REQUEST_SCHEMA) {
    throw new Error('repository maintenance request schema is invalid');
  }
  if (!Array.isArray(input.operations) || input.operations.length < 1 || input.operations.length > 128) {
    throw new Error('repository maintenance request requires 1..128 operations');
  }
  return Object.freeze({
    schema: REPOSITORY_MAINTENANCE_REQUEST_SCHEMA,
    repository: repository(input.repository),
    expectedMainSha: sha(input.expectedMainSha, 'expectedMainSha'),
    operations: Object.freeze(input.operations.map(parseOperation))
  });
}
