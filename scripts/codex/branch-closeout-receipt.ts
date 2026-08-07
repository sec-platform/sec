import {
  assertGitBranchName,
  assertGitSha,
  branchLifecycleDigest
} from './branch-lifecycle-audit.ts';
import {
  commandErrorText,
  commandText,
  runBranchCommand,
  type BranchLifecycleContext
} from './branch-lifecycle-command.ts';
import {
  BRANCH_CLOSEOUT_PUBLISHED_RECEIPT_SCHEMA_V1,
  type BranchCloseoutAttempt,
  type BranchCloseoutPublicationResult,
  type BranchCloseoutReceipt,
  type BranchCloseoutReceiptObservation,
  type BranchPublishedCloseoutReceiptV1,
  type BranchPullRequestObservation
} from './branch-lifecycle-types.ts';

export const BRANCH_CLOSEOUT_ENFORCEMENT_MARKER_PATH =
  'scripts/codex/branch-closeout-receipt.ts' as const;
export const BRANCH_CLOSEOUT_RECEIPT_COMMENT_MARKER =
  '<!-- sec-branch-closeout-receipt-v1 -->' as const;

const COMMENT_JSON_PREFIX = `${BRANCH_CLOSEOUT_RECEIPT_COMMENT_MARKER}\n` + '```json\n';
const COMMENT_JSON_SUFFIX = '\n```';
const PUBLISHED_RECEIPT_KEYS = [
  'schema',
  'repository',
  'pullRequest',
  'branch',
  'preparedHeadSha',
  'preparationDigest',
  'recoveryDigest',
  'disposition',
  'durableGoal',
  'authorization',
  'attempts',
  'readback',
  'closeoutStatus',
  'mainSha',
  'receiptDigest',
  'publicationDigest'
] as const;
const POTENTIALLY_TRUSTED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);
const ATTEMPT_OPERATIONS = new Set<BranchCloseoutAttempt['operation']>([
  'recovery-create',
  'recovery-verify',
  'remote-delete',
  'local-delete',
  'prune',
  'readback'
]);
const ATTEMPT_STATUSES = new Set<BranchCloseoutAttempt['status']>([
  'success',
  'skipped',
  'failed'
]);

type IssueCommentRecord = Readonly<{
  id: number;
  body: string;
  author: string;
  authorAssociation: string | null;
}>;

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${label} must contain exactly: ${wanted.join(', ')}.`);
  }
}

function repositoryValue(value: unknown): string {
  if (
    typeof value !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(value)
  ) {
    throw new Error('Published closeout receipt repository must be one owner/name identity.');
  }
  return value;
}

function pullRequestValue(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Published closeout receipt pullRequest must be null or a positive safe integer.');
  }
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function digestValue(value: unknown, label: string): `sha256:${string}` {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be a SHA-256 digest.`);
  }
  return value as `sha256:${string}`;
}

function nullableSha(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error(`${label} must be null or a Git SHA.`);
  assertGitSha(value, label);
  return value;
}

function dispositionValue(value: unknown): BranchPublishedCloseoutReceiptV1['disposition'] {
  if (value !== 'merged' && value !== 'closed-superseded' && value !== 'completed-spike') {
    throw new Error('Published closeout receipt disposition is invalid.');
  }
  return value;
}

function closeoutStatusValue(value: unknown): BranchPublishedCloseoutReceiptV1['closeoutStatus'] {
  if (
    value !== 'completed'
    && value !== 'protected-pending'
    && value !== 'residue'
    && value !== 'blocked'
  ) {
    throw new Error('Published closeout receipt closeoutStatus is invalid.');
  }
  return value;
}

function durableGoalValue(value: unknown): BranchPublishedCloseoutReceiptV1['durableGoal'] {
  assertRecord(value, 'Published closeout receipt durableGoal');
  assertExactKeys(value, ['kind', 'reference'], 'Published closeout receipt durableGoal');
  if (value.kind !== 'main' && value.kind !== 'issue' && value.kind !== 'evidence') {
    throw new Error('Published closeout receipt durableGoal.kind is invalid.');
  }
  if (
    typeof value.reference !== 'string'
    || value.reference.trim() !== value.reference
    || value.reference.length === 0
    || value.reference.length > 512
  ) {
    throw new Error('Published closeout receipt durableGoal.reference is invalid.');
  }
  return { kind: value.kind, reference: value.reference };
}

function authorizationValue(
  value: unknown
): BranchPublishedCloseoutReceiptV1['authorization'] {
  assertRecord(value, 'Published closeout receipt authorization');
  assertExactKeys(value, ['remoteAction', 'localAction'], 'Published closeout receipt authorization');
  if (
    value.remoteAction !== 'delete-cas'
    && value.remoteAction !== 'already-absent'
    && value.remoteAction !== 'blocked'
  ) {
    throw new Error('Published closeout receipt authorization.remoteAction is invalid.');
  }
  if (
    value.localAction !== 'delete-exact'
    && value.localAction !== 'already-absent'
    && value.localAction !== 'protect-local'
    && value.localAction !== 'blocked'
  ) {
    throw new Error('Published closeout receipt authorization.localAction is invalid.');
  }
  return { remoteAction: value.remoteAction, localAction: value.localAction };
}

function attemptsValue(value: unknown): BranchPublishedCloseoutReceiptV1['attempts'] {
  if (!Array.isArray(value)) throw new Error('Published closeout receipt attempts must be an array.');
  return value.map((entry, index) => {
    assertRecord(entry, `Published closeout receipt attempt ${index}`);
    assertExactKeys(
      entry,
      ['operation', 'status', 'detailDigest'],
      `Published closeout receipt attempt ${index}`
    );
    if (
      typeof entry.operation !== 'string'
      || !ATTEMPT_OPERATIONS.has(entry.operation as BranchCloseoutAttempt['operation'])
    ) {
      throw new Error(`Published closeout receipt attempt ${index}.operation is invalid.`);
    }
    if (
      typeof entry.status !== 'string'
      || !ATTEMPT_STATUSES.has(entry.status as BranchCloseoutAttempt['status'])
    ) {
      throw new Error(`Published closeout receipt attempt ${index}.status is invalid.`);
    }
    return {
      operation: entry.operation as BranchCloseoutAttempt['operation'],
      status: entry.status as BranchCloseoutAttempt['status'],
      detailDigest: digestValue(
        entry.detailDigest,
        `Published closeout receipt attempt ${index}.detailDigest`
      )
    };
  });
}

function readbackValue(value: unknown): BranchPublishedCloseoutReceiptV1['readback'] {
  assertRecord(value, 'Published closeout receipt readback');
  assertExactKeys(
    value,
    ['mainRemoteSha', 'remoteBranchSha', 'localBranchSha', 'boundWorktreeCount', 'unknownCount'],
    'Published closeout receipt readback'
  );
  return {
    mainRemoteSha: nullableSha(value.mainRemoteSha, 'Published closeout receipt readback.mainRemoteSha'),
    remoteBranchSha: nullableSha(
      value.remoteBranchSha,
      'Published closeout receipt readback.remoteBranchSha'
    ),
    localBranchSha: nullableSha(
      value.localBranchSha,
      'Published closeout receipt readback.localBranchSha'
    ),
    boundWorktreeCount: nonNegativeInteger(
      value.boundWorktreeCount,
      'Published closeout receipt readback.boundWorktreeCount'
    ),
    unknownCount: nonNegativeInteger(
      value.unknownCount,
      'Published closeout receipt readback.unknownCount'
    )
  };
}

function expectedMainSha(
  durableGoal: BranchPublishedCloseoutReceiptV1['durableGoal']
): string | null {
  if (durableGoal.kind !== 'main') return null;
  const match = /^main@([0-9a-f]{40})$/u.exec(durableGoal.reference);
  if (!match) {
    throw new Error('A main closeout receipt durable goal must use main@<40-char-sha>.');
  }
  return match[1]!;
}

function withoutPublicationDigest(
  receipt: BranchPublishedCloseoutReceiptV1
): Omit<BranchPublishedCloseoutReceiptV1, 'publicationDigest'> {
  const { publicationDigest: _publicationDigest, ...payload } = receipt;
  return payload;
}

function attemptDetailDigest(detail: string): `sha256:${string}` {
  return branchLifecycleDigest({ detail });
}

function assertPublishedTerminal(
  receipt: BranchPublishedCloseoutReceiptV1
): void {
  if (receipt.mainSha !== expectedMainSha(receipt.durableGoal)) {
    throw new Error('Published closeout receipt mainSha does not match its durable goal.');
  }
  if (receipt.mainSha !== null && receipt.readback.mainRemoteSha !== receipt.mainSha) {
    throw new Error('Published closeout receipt main readback does not match its durable goal.');
  }
  if (
    (receipt.closeoutStatus === 'completed' || receipt.closeoutStatus === 'protected-pending')
    && !receipt.attempts.some(({ operation, status }) => (
      operation === 'readback' && status === 'success'
    ))
  ) {
    throw new Error('Published terminal closeout receipt requires a successful readback attempt.');
  }
  if (
    (receipt.closeoutStatus === 'completed' || receipt.closeoutStatus === 'protected-pending')
    && receipt.readback.unknownCount !== 0
  ) {
    throw new Error('Published terminal closeout receipt cannot retain unknown readback facts.');
  }
  if (receipt.closeoutStatus === 'completed') {
    if (
      receipt.authorization.remoteAction === 'blocked'
      || receipt.authorization.localAction === 'blocked'
      || receipt.authorization.localAction === 'protect-local'
      || receipt.readback.remoteBranchSha !== null
      || receipt.readback.localBranchSha !== null
      || receipt.readback.boundWorktreeCount !== 0
    ) {
      throw new Error('Published completed closeout receipt contains unresolved branch state.');
    }
  }
  if (receipt.closeoutStatus === 'protected-pending') {
    if (
      receipt.authorization.localAction !== 'protect-local'
      || receipt.readback.remoteBranchSha !== null
      || receipt.readback.localBranchSha === null
    ) {
      throw new Error('Published protected-pending receipt does not bind its protected local ref.');
    }
  }
}

export function createPublishedBranchCloseoutReceipt(
  receipt: BranchCloseoutReceipt
): BranchPublishedCloseoutReceiptV1 {
  const remoteBranchSha = receipt.after.remoteBranches.find(({ branch }) => (
    branch === receipt.preparation.branch
  ))?.sha ?? null;
  const localBranchSha = receipt.after.localBranches.find(({ branch }) => (
    branch === receipt.preparation.branch
  ))?.sha ?? null;
  const mainSha = expectedMainSha(receipt.request.durableGoal);
  const payload: Omit<BranchPublishedCloseoutReceiptV1, 'publicationDigest'> = {
    schema: BRANCH_CLOSEOUT_PUBLISHED_RECEIPT_SCHEMA_V1,
    repository: receipt.preparation.repository.fullName,
    pullRequest: receipt.preparation.pullRequestNumber,
    branch: receipt.preparation.branch,
    preparedHeadSha: receipt.preparation.expectedHeadSha,
    preparationDigest: receipt.preparation.preparationDigest,
    recoveryDigest: receipt.preparation.recovery.sha256,
    disposition: receipt.request.disposition,
    durableGoal: { ...receipt.request.durableGoal },
    authorization: {
      remoteAction: receipt.authorization.remoteAction,
      localAction: receipt.authorization.localAction
    },
    attempts: receipt.attempts.map(({ operation, status, detail }) => ({
      operation,
      status,
      detailDigest: attemptDetailDigest(detail)
    })),
    readback: {
      mainRemoteSha: receipt.after.main.remoteSha,
      remoteBranchSha,
      localBranchSha,
      boundWorktreeCount: receipt.after.worktrees.filter(({ branch }) => (
        branch === receipt.preparation.branch
      )).length,
      unknownCount: receipt.after.unknowns.length
    },
    closeoutStatus: receipt.status,
    mainSha,
    receiptDigest: receipt.receiptDigest
  };
  const published = {
    ...payload,
    publicationDigest: branchLifecycleDigest(payload)
  };
  assertPublishedTerminal(published);
  return published;
}

export function parsePublishedBranchCloseoutReceipt(
  value: unknown
): BranchPublishedCloseoutReceiptV1 {
  assertRecord(value, 'Published closeout receipt');
  assertExactKeys(value, PUBLISHED_RECEIPT_KEYS, 'Published closeout receipt');
  if (value.schema !== BRANCH_CLOSEOUT_PUBLISHED_RECEIPT_SCHEMA_V1) {
    throw new Error(
      `Published closeout receipt schema must be ${BRANCH_CLOSEOUT_PUBLISHED_RECEIPT_SCHEMA_V1}.`
    );
  }
  const repository = repositoryValue(value.repository);
  const pullRequest = pullRequestValue(value.pullRequest);
  if (typeof value.branch !== 'string') {
    throw new Error('Published closeout receipt branch must be a string.');
  }
  assertGitBranchName(value.branch, 'published closeout branch');
  if (typeof value.preparedHeadSha !== 'string') {
    throw new Error('Published closeout receipt preparedHeadSha must be a string.');
  }
  assertGitSha(value.preparedHeadSha, 'published closeout prepared head');
  const receipt: BranchPublishedCloseoutReceiptV1 = {
    schema: BRANCH_CLOSEOUT_PUBLISHED_RECEIPT_SCHEMA_V1,
    repository,
    pullRequest,
    branch: value.branch,
    preparedHeadSha: value.preparedHeadSha,
    preparationDigest: digestValue(
      value.preparationDigest,
      'Published closeout receipt preparationDigest'
    ),
    recoveryDigest: digestValue(
      value.recoveryDigest,
      'Published closeout receipt recoveryDigest'
    ),
    disposition: dispositionValue(value.disposition),
    durableGoal: durableGoalValue(value.durableGoal),
    authorization: authorizationValue(value.authorization),
    attempts: attemptsValue(value.attempts),
    readback: readbackValue(value.readback),
    closeoutStatus: closeoutStatusValue(value.closeoutStatus),
    mainSha: nullableSha(value.mainSha, 'Published closeout receipt mainSha'),
    receiptDigest: digestValue(value.receiptDigest, 'Published closeout receipt receiptDigest'),
    publicationDigest: digestValue(
      value.publicationDigest,
      'Published closeout receipt publicationDigest'
    )
  };
  if (branchLifecycleDigest(withoutPublicationDigest(receipt)) !== receipt.publicationDigest) {
    throw new Error('Published closeout receipt publicationDigest mismatch.');
  }
  assertPublishedTerminal(receipt);
  return receipt;
}

export function renderPublishedBranchCloseoutReceiptComment(
  receipt: BranchPublishedCloseoutReceiptV1
): string {
  return `${COMMENT_JSON_PREFIX}${JSON.stringify(
    parsePublishedBranchCloseoutReceipt(receipt),
    null,
    2
  )}${COMMENT_JSON_SUFFIX}`;
}

export function parsePublishedBranchCloseoutReceiptComment(
  source: string
): BranchPublishedCloseoutReceiptV1 | null {
  if (!source.includes(BRANCH_CLOSEOUT_RECEIPT_COMMENT_MARKER)) return null;
  if (!source.startsWith(COMMENT_JSON_PREFIX) || !source.endsWith(COMMENT_JSON_SUFFIX)) {
    throw new Error('Branch closeout receipt comment shape is invalid.');
  }
  const jsonSource = source.slice(COMMENT_JSON_PREFIX.length, -COMMENT_JSON_SUFFIX.length);
  if (jsonSource.length === 0 || jsonSource.trim() !== jsonSource) {
    throw new Error('Branch closeout receipt JSON payload is empty or not byte-exact.');
  }
  return parsePublishedBranchCloseoutReceipt(JSON.parse(jsonSource));
}

export function parsePublishedBranchCloseoutReceiptComments(
  sources: readonly string[]
): { receipts: BranchPublishedCloseoutReceiptV1[]; invalid: string[] } {
  const receipts: BranchPublishedCloseoutReceiptV1[] = [];
  const invalid: string[] = [];
  for (const [index, source] of sources.entries()) {
    if (!source.includes(BRANCH_CLOSEOUT_RECEIPT_COMMENT_MARKER)) continue;
    try {
      const receipt = parsePublishedBranchCloseoutReceiptComment(source);
      if (receipt) receipts.push(receipt);
    } catch (error) {
      invalid.push(`comment[${index}]: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { receipts, invalid };
}

function allowedDisposition(
  state: BranchPullRequestObservation['state'],
  disposition: BranchPublishedCloseoutReceiptV1['disposition']
): boolean {
  if (state === 'merged') return disposition === 'merged';
  return state === 'closed'
    && (disposition === 'closed-superseded' || disposition === 'completed-spike');
}

export function resolveBranchCloseoutReceiptObservation(input: {
  repository: string;
  pullRequest: BranchPullRequestObservation;
  requirement: BranchCloseoutReceiptObservation['requirement'];
}): BranchCloseoutReceiptObservation {
  if (input.requirement === 'not-required') {
    return { requirement: 'not-required', status: 'not-required', receipt: null, reason: null };
  }
  if (input.requirement === 'unknown') {
    return {
      requirement: 'unknown',
      status: 'unknown',
      receipt: null,
      reason: 'receipt enforcement marker applicability could not be determined'
    };
  }
  const invalid = input.pullRequest.invalidCloseoutReceiptComments ?? [];
  if (invalid.length > 0) {
    return {
      requirement: 'required',
      status: 'invalid',
      receipt: null,
      reason: invalid.join(' | ')
    };
  }
  const matching = (input.pullRequest.publishedCloseoutReceipts ?? []).filter((receipt) => (
    receipt.repository === input.repository
    && receipt.pullRequest === input.pullRequest.number
    && receipt.branch === input.pullRequest.headBranch
    && receipt.preparedHeadSha === input.pullRequest.headSha
    && allowedDisposition(input.pullRequest.state, receipt.disposition)
  ));
  const unique = new Map(matching.map((receipt) => [receipt.publicationDigest, receipt]));
  if (unique.size === 0) {
    return {
      requirement: 'required',
      status: 'missing',
      receipt: null,
      reason: 'no exact published closeout receipt binds this PR head and disposition'
    };
  }
  if (unique.size > 1) {
    return {
      requirement: 'required',
      status: 'conflicted',
      receipt: null,
      reason: 'multiple distinct published closeout receipts bind this PR head'
    };
  }
  return {
    requirement: 'required',
    status: 'present',
    receipt: [...unique.values()][0]!,
    reason: null
  };
}

function issueNumberFromReference(reference: string): number | null {
  const match = /(?:^|\/issues\/|#|issue[-: ]+)([1-9]\d*)$/iu.exec(reference);
  if (!match) return null;
  const parsed = Number.parseInt(match[1]!, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function publicationTarget(
  receipt: BranchPublishedCloseoutReceiptV1
): BranchCloseoutPublicationResult['target'] {
  if (receipt.pullRequest !== null) {
    return { kind: 'pull-request', number: receipt.pullRequest };
  }
  if (receipt.durableGoal.kind === 'issue') {
    const number = issueNumberFromReference(receipt.durableGoal.reference);
    if (number !== null) return { kind: 'issue', number };
  }
  return null;
}

function githubLogin(value: unknown, label: string): string {
  if (
    typeof value !== 'string'
    || !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(value)
  ) {
    throw new Error(`${label} must be a GitHub login.`);
  }
  return value;
}

function issueCommentRecord(value: unknown, label: string): IssueCommentRecord {
  assertRecord(value, label);
  if (typeof value.id !== 'number' || !Number.isSafeInteger(value.id) || value.id <= 0) {
    throw new Error(`${label}.id must be a positive safe integer.`);
  }
  if (typeof value.body !== 'string') throw new Error(`${label}.body must be a string.`);
  assertRecord(value.user, `${label}.user`);
  return {
    id: value.id,
    body: value.body,
    author: githubLogin(value.user.login, `${label}.user.login`),
    authorAssociation: typeof value.author_association === 'string'
      ? value.author_association
      : null
  };
}

function issueCommentRecords(source: string): IssueCommentRecord[] {
  const parsed: unknown = JSON.parse(source);
  if (!Array.isArray(parsed)) throw new Error('GitHub issue comments response must be an array.');
  const comments: unknown[] = parsed.every(Array.isArray) ? parsed.flat() : parsed;
  return comments.map((value, index) => issueCommentRecord(value, `GitHub issue comment ${index}`));
}

function collaboratorCanPublishReceipt(
  ctx: BranchLifecycleContext,
  repository: string,
  author: string
): { trusted: boolean; reason: string | null } {
  const result = runBranchCommand(ctx, 'gh', [
    'api',
    `/repos/${repository}/collaborators/${author}/permission`,
    '--jq',
    '.role_name // .permission'
  ]);
  if (result.status !== 0) {
    return {
      trusted: false,
      reason: `collaborator permission for ${author} failed: ${commandErrorText(result)}`
    };
  }
  const role = commandText(result).toLowerCase();
  return {
    trusted: role === 'admin' || role === 'maintain',
    reason: role === 'admin' || role === 'maintain'
      ? null
      : `collaborator ${author} has insufficient role ${role}`
  };
}

function trustedPublishedReceipts(
  ctx: BranchLifecycleContext,
  repository: string,
  comments: readonly IssueCommentRecord[]
): { receipts: BranchPublishedCloseoutReceiptV1[]; failures: string[] } {
  const receipts: BranchPublishedCloseoutReceiptV1[] = [];
  const failures: string[] = [];
  const permissionCache = new Map<string, { trusted: boolean; reason: string | null }>();
  for (const comment of comments) {
    if (!comment.body.includes(BRANCH_CLOSEOUT_RECEIPT_COMMENT_MARKER)) continue;
    if (
      comment.authorAssociation === null
      || !POTENTIALLY_TRUSTED_ASSOCIATIONS.has(comment.authorAssociation)
    ) {
      continue;
    }
    let permission = permissionCache.get(comment.author);
    if (!permission) {
      permission = collaboratorCanPublishReceipt(ctx, repository, comment.author);
      permissionCache.set(comment.author, permission);
    }
    if (!permission.trusted) {
      if (permission.reason?.includes('failed:')) failures.push(permission.reason);
      continue;
    }
    try {
      const receipt = parsePublishedBranchCloseoutReceiptComment(comment.body);
      if (receipt) receipts.push(receipt);
    } catch (error) {
      failures.push(
        `trusted comment ${comment.id} is invalid: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return { receipts, failures };
}

function listIssueComments(
  ctx: BranchLifecycleContext,
  endpoint: string
): { comments: IssueCommentRecord[] | null; detail: string | null } {
  const result = runBranchCommand(ctx, 'gh', [
    'api',
    '--paginate',
    '--slurp',
    `${endpoint}?per_page=100`
  ]);
  if (result.status !== 0) {
    return { comments: null, detail: commandErrorText(result) };
  }
  try {
    return { comments: issueCommentRecords(commandText(result)), detail: null };
  } catch (error) {
    return {
      comments: null,
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

function exactTrustedReceipt(
  ctx: BranchLifecycleContext,
  published: BranchPublishedCloseoutReceiptV1,
  comments: readonly IssueCommentRecord[]
): { receipt: BranchPublishedCloseoutReceiptV1 | null; failure: string | null } {
  const trusted = trustedPublishedReceipts(ctx, published.repository, comments);
  if (trusted.failures.length > 0) {
    return { receipt: null, failure: trusted.failures.join(' | ') };
  }
  const exact = trusted.receipts.filter(({ publicationDigest }) => (
    publicationDigest === published.publicationDigest
  ));
  return { receipt: exact[0] ?? null, failure: null };
}

export function publishAndReadBackBranchCloseoutReceipt(
  ctx: BranchLifecycleContext,
  receipt: BranchCloseoutReceipt
): BranchCloseoutPublicationResult {
  const published = createPublishedBranchCloseoutReceipt(receipt);
  const target = publicationTarget(published);
  if (!target) {
    return {
      target: null,
      publish: 'unsupported',
      readback: 'unsupported',
      receipt: null,
      detail: 'closeout receipt has no PR or issue publication target'
    };
  }
  const endpoint = `/repos/${published.repository}/issues/${target.number}/comments`;
  const existing = listIssueComments(ctx, endpoint);
  if (existing.comments !== null) {
    const reused = exactTrustedReceipt(ctx, published, existing.comments);
    if (reused.failure !== null) {
      return {
        target,
        publish: 'failed',
        readback: 'failed',
        receipt: null,
        detail: `existing receipt inspection failed: ${reused.failure}`
      };
    }
    if (reused.receipt !== null) {
      return {
        target,
        publish: 'success',
        readback: 'success',
        receipt: reused.receipt,
        detail: `reused existing ${published.publicationDigest}`
      };
    }
  }

  const expectedBody = renderPublishedBranchCloseoutReceiptComment(published);
  const publish = runBranchCommand(ctx, 'gh', [
    'api',
    '-X',
    'POST',
    endpoint,
    '-f',
    `body=${expectedBody}`
  ]);
  if (publish.status !== 0) {
    return {
      target,
      publish: 'failed',
      readback: 'unsupported',
      receipt: null,
      detail: `receipt publication failed: ${commandErrorText(publish)}`
    };
  }

  let created: IssueCommentRecord;
  try {
    created = issueCommentRecord(JSON.parse(commandText(publish)), 'created issue comment');
  } catch (error) {
    return {
      target,
      publish: 'success',
      readback: 'failed',
      receipt: null,
      detail: `created receipt response is invalid: ${error instanceof Error ? error.message : String(error)}`
    };
  }
  if (created.body !== expectedBody) {
    return {
      target,
      publish: 'success',
      readback: 'failed',
      receipt: null,
      detail: 'created receipt comment body does not match the requested bytes'
    };
  }
  const permission = collaboratorCanPublishReceipt(ctx, published.repository, created.author);
  if (!permission.trusted) {
    return {
      target,
      publish: 'success',
      readback: 'failed',
      receipt: null,
      detail: permission.reason ?? 'created receipt author is not trusted'
    };
  }

  const exactEndpoint = `/repos/${published.repository}/issues/comments/${created.id}`;
  const readback = runBranchCommand(ctx, 'gh', ['api', exactEndpoint]);
  if (readback.status !== 0) {
    return {
      target,
      publish: 'success',
      readback: 'failed',
      receipt: null,
      detail: `receipt readback failed: ${commandErrorText(readback)}`
    };
  }
  try {
    const observed = issueCommentRecord(JSON.parse(commandText(readback)), 'read-back issue comment');
    if (
      observed.id !== created.id
      || observed.author !== created.author
      || observed.body !== expectedBody
    ) {
      throw new Error('read-back comment identity or bytes do not match the created receipt');
    }
    const parsed = parsePublishedBranchCloseoutReceiptComment(observed.body);
    if (parsed === null || parsed.publicationDigest !== published.publicationDigest) {
      throw new Error('read-back receipt digest does not match the published receipt');
    }
    return {
      target,
      publish: 'success',
      readback: 'success',
      receipt: parsed,
      detail: `published and read back ${published.publicationDigest}`
    };
  } catch (error) {
    return {
      target,
      publish: 'success',
      readback: 'failed',
      receipt: null,
      detail: `receipt readback parse failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}
