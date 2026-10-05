import {
  parseExactRefRetirement,
  type ExactRefRetirement
} from '../branch-lifecycle/exact-ref-retirement-contract.ts';

export const REPOSITORY_MAINTENANCE_REQUEST_SCHEMA =
  'sec-repository-maintenance-request-v2' as const;
const LEGACY_REQUEST_SCHEMA = 'sec-repository-maintenance-request-v1' as const;
// Below GitHub's 65,535-character workflow_dispatch inputs ceiling, including envelope.
export const REPOSITORY_MAINTENANCE_MAX_REQUEST_BYTES = 60 * 1024;
export const REPOSITORY_MAINTENANCE_MAX_OPERATIONS = 64;
// Requested policy only; the provider-reported expires_at is the actual deadline.
export const REPOSITORY_MAINTENANCE_RECOVERY_RETENTION_DAYS = 30;

export const REPOSITORY_MAINTENANCE_ISSUE_NUMBER = 313 as const;

export type ExactCommentRetirement = Readonly<{
  issueNumber: number;
  commentId: number;
  expectedBodyDigest: `sha256:${string}`;
}>;

type MaintenanceOperation =
  | Readonly<{
      kind: 'exact-ref-retirement';
      retirement: ExactRefRetirement;
    }>
  | Readonly<{
      kind: 'exact-comment-retirement';
      retirement: ExactCommentRetirement;
    }>;

export type MaintenanceRequest = Readonly<{
  schema: typeof REPOSITORY_MAINTENANCE_REQUEST_SCHEMA | typeof LEGACY_REQUEST_SCHEMA;
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
  const issueNumber = positiveInteger(input.issueNumber, 'issueNumber');
  if (issueNumber !== REPOSITORY_MAINTENANCE_ISSUE_NUMBER) {
    throw new Error(
      `exact comment retirement is restricted to lifecycle issue #${REPOSITORY_MAINTENANCE_ISSUE_NUMBER}`
    );
  }
  return Object.freeze({
    issueNumber: REPOSITORY_MAINTENANCE_ISSUE_NUMBER,
    commentId: positiveInteger(input.commentId, 'commentId'),
    expectedBodyDigest: digest(input.expectedBodyDigest, 'expectedBodyDigest')
  });
}

function parseOperation(value: unknown): MaintenanceOperation {
  const input = record(value, 'maintenance operation');
  exactKeys(input, ['kind', 'retirement'], 'maintenance operation');
  if (input.kind === 'exact-ref-retirement') {
    const retirement = parseExactRefRetirement(input.retirement);
    if (retirement.classification === 'reviewed-superseded'
        && retirement.reviewIssueNumber !== REPOSITORY_MAINTENANCE_ISSUE_NUMBER) {
      throw new Error(
        `reviewed ref retirement is restricted to lifecycle issue #${REPOSITORY_MAINTENANCE_ISSUE_NUMBER}`
      );
    }
    return Object.freeze({
      kind: 'exact-ref-retirement',
      retirement
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
  if (input.schema !== REPOSITORY_MAINTENANCE_REQUEST_SCHEMA && input.schema !== LEGACY_REQUEST_SCHEMA) {
    throw new Error('repository maintenance request schema is invalid');
  }
  if (input.schema === REPOSITORY_MAINTENANCE_REQUEST_SCHEMA
      && Buffer.byteLength(source, 'utf8') > REPOSITORY_MAINTENANCE_MAX_REQUEST_BYTES) {
    throw new Error('repository maintenance request exceeds the bounded byte limit');
  }
  if (!Array.isArray(input.operations)
      || input.operations.length < 1
      || input.operations.length > REPOSITORY_MAINTENANCE_MAX_OPERATIONS) {
    throw new Error('repository maintenance request requires 1..64 operations');
  }
  const operations = input.operations.map(parseOperation);
  const refOperations = operations.filter((operation) =>
    operation.kind === 'exact-ref-retirement');
  if (input.schema === LEGACY_REQUEST_SCHEMA && refOperations.length > 0 && operations.length !== 1) {
    throw new Error('legacy exact ref retirement must remain one-operation-per-request');
  }
  if (input.schema === REPOSITORY_MAINTENANCE_REQUEST_SCHEMA && refOperations.length !== operations.length) {
    throw new Error('maintenance v2 accepts only an exact ref batch');
  }
  if (input.schema === REPOSITORY_MAINTENANCE_REQUEST_SCHEMA
      && refOperations.some((operation) => operation.retirement.classification === 'reviewed-superseded')) {
    throw new Error('v2 batches require inline maintainer plan reviews, not mutable comment reviews');
  }
  if (input.schema === LEGACY_REQUEST_SCHEMA
      && refOperations.some((operation) => operation.retirement.classification === 'reviewed-plan-superseded')) {
    throw new Error('inline maintainer plan reviews require a v2 batch');
  }
  const branches = new Set<string>();
  for (const operation of refOperations) {
    const branch = operation.retirement.branches[0];
    if (branches.has(branch)) throw new Error('exact ref batch contains duplicate branch identity');
    branches.add(branch);
  }
  const commentIds = new Set<string>();
  for (const operation of operations) {
    if (operation.kind !== 'exact-comment-retirement') continue;
    const key = `${operation.retirement.issueNumber}:${operation.retirement.commentId}`;
    if (commentIds.has(key)) {
      throw new Error('exact comment retirement request contains duplicate comment identity');
    }
    commentIds.add(key);
  }
  return Object.freeze({
    schema: input.schema,
    repository: repository(input.repository),
    expectedMainSha: sha(input.expectedMainSha, 'expectedMainSha'),
    operations: Object.freeze(operations)
  });
}

export type MaintenanceResumeReceipt = Readonly<{
  artifactId: string;
  artifactDigest: `sha256:${string}`;
  runId: string;
  runAttempt: number;
}>;

export function parseRepositoryMaintenanceResumeReceipt(source: string | undefined): MaintenanceResumeReceipt | undefined {
  if (source === undefined || source === '') return undefined;
  if (Buffer.byteLength(source, 'utf8') > 1024) throw new Error('resume receipt locator exceeds byte budget');
  const value = record(JSON.parse(source), 'resume receipt locator');
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(['artifactDigest', 'artifactId', 'runAttempt', 'runId'])
      || typeof value.artifactId !== 'string' || !/^[1-9][0-9]*$/u.test(value.artifactId)
      || typeof value.runId !== 'string' || !/^[1-9][0-9]*$/u.test(value.runId)
      || !Number.isSafeInteger(Number(value.artifactId)) || !Number.isSafeInteger(Number(value.runId))
      || !Number.isSafeInteger(value.runAttempt) || Number(value.runAttempt) < 1
      || typeof value.artifactDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value.artifactDigest)) {
    throw new Error('resume receipt locator is invalid');
  }
  return Object.freeze({ artifactId: value.artifactId, artifactDigest: value.artifactDigest as `sha256:${string}`,
    runId: value.runId, runAttempt: Number(value.runAttempt) });
}

