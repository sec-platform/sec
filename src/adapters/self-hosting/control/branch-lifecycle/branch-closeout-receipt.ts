import {
  executeGitHubApiOperation,
  withGitHubApiReadSession,
  type GitHubApiCapability
} from '../../../providers/github-api/operation-session.ts';
import { encodeVerificationActionData } from '../../../verification/platform/action/contract/action.ts';
import { CI_GITHUB_ACTIONS_IDENTITY_POLICY } from '../../../verification/platform/action/contract/provider.ts';
import {
  assertBranchCloseoutOperationBinding,
  parseBranchCloseoutOperationReceipt,
  type BranchCloseoutOperationBinding,
  type BranchCloseoutOperationReceipt
} from './branch-closeout-contract.ts';
import {
  assertGitBranchName,
  assertGitSha,
  branchLifecycleDigest
} from './branch-lifecycle-audit.ts';
import {
  BRANCH_CLOSEOUT_PUBLISHED_RECEIPT_SCHEMA,
  type BranchCloseoutAttempt,
  type BranchCloseoutDisposition,
  type BranchCloseoutReceipt,
  type BranchCloseoutReceiptObservation,
  type BranchCloseoutStatus,
  type BranchPublishedCloseoutReceipt,
  type BranchPullRequestObservation
} from './branch-lifecycle-types.ts';

export const BRANCH_CLOSEOUT_ENFORCEMENT_MARKER_PATH =
  'src/adapters/self-hosting/control/branch-lifecycle/branch-closeout-receipt.ts' as const;
export const BRANCH_CLOSEOUT_RECEIPT_COMMENT_MARKER =
  '<!-- sec-branch-closeout-receipt-v1 -->' as const;
const BRANCH_CLOSEOUT_OPERATION_PUBLICATION_SCHEMA =
  'sec-branch-closeout-operation-publication-v1' as const;
const BRANCH_CLOSEOUT_OPERATION_RECEIPT_COMMENT_MARKER =
  '<!-- sec-branch-closeout-operation-receipt-v1 -->' as const;
const BRANCH_CLOSEOUT_EFFECT_START_PUBLICATION_SCHEMA =
  'sec-branch-closeout-effect-start-publication-v1' as const;
const BRANCH_CLOSEOUT_EFFECT_START_COMMENT_MARKER =
  '<!-- sec-branch-closeout-effect-start-v1 -->' as const;
export const BRANCH_CLOSEOUT_MUTATION_PHASE_STEP_NAME =
  'Close out exact integrated branch' as const;
const HOSTED_WORKFLOW_COMMENT_PROVENANCE_SCHEMA =
  'sec-hosted-workflow-comment-provenance-v1' as const;

export interface HostedWorkflowCommentProvenance {
  schema: typeof HOSTED_WORKFLOW_COMMENT_PROVENANCE_SCHEMA;
  repositoryId: string;
  workflowPath: '.github/workflows/merge-gate.yml';
  workflowRef: string;
  workflowSha: string;
  runId: string;
  runAttempt: number;
  eventName: 'workflow_run';
  sourceRunId: string;
  sourceRunAttempt: number;
  actorLogin: string;
  actorNodeId: string;
  actorPermission: 'maintain' | 'admin';
  app: {
    id: number;
    nodeId: string;
    slug: string;
  };
  provenanceDigest: `sha256:${string}`;
}

export interface BranchCloseoutOperationPublication {
  schema: typeof BRANCH_CLOSEOUT_OPERATION_PUBLICATION_SCHEMA;
  closeoutOperationId: `sha256:${string}`;
  binding: BranchCloseoutOperationBinding;
  effectStart: BranchCloseoutEffectStartReference;
  receipt: BranchCloseoutStablePublishedReceipt;
  provenance: HostedWorkflowCommentProvenance;
  publicationDigest: `sha256:${string}`;
}

interface BranchCloseoutEffectStartReference {
  effectStartId: `sha256:${string}`;
  publicationDigest: `sha256:${string}`;
  commentId: number;
}

export interface BranchCloseoutEffectStartPublication {
  schema: typeof BRANCH_CLOSEOUT_EFFECT_START_PUBLICATION_SCHEMA;
  effectStartId: `sha256:${string}`;
  closeoutOperationId: `sha256:${string}`;
  binding: BranchCloseoutOperationBinding;
  authorizationPublication: {
    authorizationPublicationId: `sha256:${string}`;
    publicationDigest: `sha256:${string}`;
    commentId: number;
  };
  recoveryArtifact: {
    artifactId: string;
    artifactName: string;
    artifactDigest: `sha256:${string}`;
    runId: string;
    runAttempt: number;
  };
  phase: {
    runId: string;
    runAttempt: number;
    jobId: string;
    jobName: 'integrate';
    phase: 'closeoutMutation';
    stepName: typeof BRANCH_CLOSEOUT_MUTATION_PHASE_STEP_NAME;
    stepNumber: number;
    workflowSha: string;
  };
  provenance: HostedWorkflowCommentProvenance;
  publicationDigest: `sha256:${string}`;
}

interface BranchCloseoutStablePublishedReceipt {
  repository: string;
  pullRequest: number | null;
  branch: string;
  preparedHeadSha: string;
  preparationDigest: `sha256:${string}`;
  recoveryDigest: `sha256:${string}`;
  disposition: BranchCloseoutDisposition;
  durableGoal: { kind: 'main' | 'issue' | 'evidence'; reference: string };
  authorization: BranchPublishedCloseoutReceipt['authorization'];
  readback: BranchPublishedCloseoutReceipt['readback'];
  closeoutStatus: BranchCloseoutStatus;
  mainSha: string | null;
}

const COMMENT_JSON_PREFIX = `${BRANCH_CLOSEOUT_RECEIPT_COMMENT_MARKER}\n` + '```json\n';
const COMMENT_JSON_SUFFIX = '\n```';
const EFFECT_START_COMMENT_JSON_PREFIX =
  `${BRANCH_CLOSEOUT_EFFECT_START_COMMENT_MARKER}\n` + '```json\n';
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

export type IssueCommentRecord = Readonly<{
  id: number;
  body: string;
  author: string;
  authorId: number;
  authorNodeId: string;
  authorType: string;
  authorAssociation: string | null;
  app: { id: number; nodeId: string; slug: string } | null;
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

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value as number;
}

function boundedIdentity(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 || value.trim() !== value) {
    throw new Error(`${label} must be bounded canonical text.`);
  }
  return value;
}

function hostedWorkflowCommentProvenancePayload(input: Omit<
  HostedWorkflowCommentProvenance,
  'schema' | 'provenanceDigest'
>): Omit<HostedWorkflowCommentProvenance, 'provenanceDigest'> {
  return { schema: HOSTED_WORKFLOW_COMMENT_PROVENANCE_SCHEMA, ...input };
}

export function createHostedWorkflowCommentProvenance(input: Omit<
  HostedWorkflowCommentProvenance,
  'schema' | 'provenanceDigest'
>): HostedWorkflowCommentProvenance {
  if (!/^[1-9][0-9]*$/u.test(input.repositoryId)
    || !/^[1-9][0-9]*$/u.test(input.runId)
    || !/^[1-9][0-9]*$/u.test(input.sourceRunId)) {
    throw new Error('Hosted comment repository/run identities must be positive decimal strings.');
  }
  assertGitSha(input.workflowSha, 'hosted comment workflow SHA');
  if (input.workflowPath !== '.github/workflows/merge-gate.yml'
    || input.workflowRef !== `${input.workflowPath}@${input.workflowSha}`
    || input.eventName !== 'workflow_run') {
    throw new Error('Hosted comment workflow provenance is not the canonical merge workflow exact ref.');
  }
  positiveInteger(input.runAttempt, 'Hosted comment runAttempt');
  positiveInteger(input.sourceRunAttempt, 'Hosted comment sourceRunAttempt');
  boundedIdentity(input.actorLogin, 'Hosted comment actorLogin');
  boundedIdentity(input.actorNodeId, 'Hosted comment actorNodeId');
  if (input.actorPermission !== 'maintain' && input.actorPermission !== 'admin') {
    throw new Error('Hosted comment actor lacks maintain/admin permission.');
  }
  if (input.app.id !== CI_GITHUB_ACTIONS_IDENTITY_POLICY.app.id
    || input.app.nodeId !== CI_GITHUB_ACTIONS_IDENTITY_POLICY.app.nodeId
    || input.app.slug !== CI_GITHUB_ACTIONS_IDENTITY_POLICY.app.slug) {
    throw new Error('Hosted comment app is not the canonical GitHub Actions app.');
  }
  const payload = hostedWorkflowCommentProvenancePayload(input);
  return Object.freeze({ ...payload, provenanceDigest: branchLifecycleDigest(payload) });
}

export function parseHostedWorkflowCommentProvenance(
  value: unknown
): HostedWorkflowCommentProvenance {
  assertRecord(value, 'Hosted workflow comment provenance');
  assertExactKeys(value, [
    'schema', 'repositoryId', 'workflowPath', 'workflowRef', 'workflowSha', 'runId',
    'runAttempt', 'eventName', 'sourceRunId', 'sourceRunAttempt', 'actorLogin',
    'actorNodeId', 'actorPermission', 'app', 'provenanceDigest'
  ], 'Hosted workflow comment provenance');
  assertRecord(value.app, 'Hosted workflow comment app');
  assertExactKeys(value.app, ['id', 'nodeId', 'slug'], 'Hosted workflow comment app');
  const provenance = createHostedWorkflowCommentProvenance({
    repositoryId: boundedIdentity(value.repositoryId, 'Hosted comment repositoryId'),
    workflowPath: value.workflowPath as '.github/workflows/merge-gate.yml',
    workflowRef: boundedIdentity(value.workflowRef, 'Hosted comment workflowRef'),
    workflowSha: boundedIdentity(value.workflowSha, 'Hosted comment workflowSha'),
    runId: boundedIdentity(value.runId, 'Hosted comment runId'),
    runAttempt: positiveInteger(value.runAttempt, 'Hosted comment runAttempt'),
    eventName: value.eventName as 'workflow_run',
    sourceRunId: boundedIdentity(value.sourceRunId, 'Hosted comment sourceRunId'),
    sourceRunAttempt: positiveInteger(value.sourceRunAttempt, 'Hosted comment sourceRunAttempt'),
    actorLogin: boundedIdentity(value.actorLogin, 'Hosted comment actorLogin'),
    actorNodeId: boundedIdentity(value.actorNodeId, 'Hosted comment actorNodeId'),
    actorPermission: value.actorPermission as 'maintain' | 'admin',
    app: { id: positiveInteger(value.app.id, 'Hosted comment app id'),
      nodeId: boundedIdentity(value.app.nodeId, 'Hosted comment app nodeId'),
      slug: boundedIdentity(value.app.slug, 'Hosted comment app slug') }
  });
  if (value.provenanceDigest !== provenance.provenanceDigest) {
    throw new Error('Hosted workflow comment provenance digest mismatch.');
  }
  return provenance;
}

function branchCloseoutEffectStartId(closeoutOperationId: `sha256:${string}`): `sha256:${string}` {
  return branchLifecycleDigest({ schema: 'sec-branch-closeout-effect-start-id-v1', closeoutOperationId });
}

function effectStartPublicationPayload(input: Omit<
  BranchCloseoutEffectStartPublication,
  'schema' | 'effectStartId' | 'publicationDigest'
>): Omit<BranchCloseoutEffectStartPublication, 'publicationDigest'> {
  const effectStartId = branchCloseoutEffectStartId(input.closeoutOperationId);
  return { schema: BRANCH_CLOSEOUT_EFFECT_START_PUBLICATION_SCHEMA,
    effectStartId, ...input };
}

export function createBranchCloseoutEffectStartPublication(input: {
  binding: BranchCloseoutOperationBinding;
  authorizationPublication: BranchCloseoutEffectStartPublication['authorizationPublication'];
  recoveryArtifact: BranchCloseoutEffectStartPublication['recoveryArtifact'];
  phase: BranchCloseoutEffectStartPublication['phase'];
  provenance: HostedWorkflowCommentProvenance;
}): BranchCloseoutEffectStartPublication {
  assertBranchCloseoutOperationBinding(input.binding);
  const authorizationPublication = Object.freeze({
    authorizationPublicationId: digestValue(input.authorizationPublication.authorizationPublicationId,
      'Closeout effect start authorizationPublicationId'),
    publicationDigest: digestValue(input.authorizationPublication.publicationDigest,
      'Closeout effect start authorization publicationDigest'),
    commentId: positiveInteger(input.authorizationPublication.commentId,
      'Closeout effect start authorization commentId')
  });
  const recoveryArtifact = Object.freeze({
    artifactId: boundedIdentity(input.recoveryArtifact.artifactId,
      'Closeout effect start recovery artifactId'),
    artifactName: boundedIdentity(input.recoveryArtifact.artifactName,
      'Closeout effect start recovery artifactName'),
    artifactDigest: digestValue(input.recoveryArtifact.artifactDigest,
      'Closeout effect start recovery artifactDigest'),
    runId: boundedIdentity(input.recoveryArtifact.runId,
      'Closeout effect start recovery runId'),
    runAttempt: positiveInteger(input.recoveryArtifact.runAttempt,
      'Closeout effect start recovery runAttempt')
  });
  if (!/^[1-9][0-9]*$/u.test(recoveryArtifact.artifactId)
    || !/^[1-9][0-9]*$/u.test(recoveryArtifact.runId)) {
    throw new Error('Closeout effect start recovery provider identities must be positive decimals.');
  }
  const provenance = parseHostedWorkflowCommentProvenance(input.provenance);
  const phase = Object.freeze({
    runId: boundedIdentity(input.phase.runId, 'Closeout effect start phase runId'),
    runAttempt: positiveInteger(input.phase.runAttempt, 'Closeout effect start phase runAttempt'),
    jobId: boundedIdentity(input.phase.jobId, 'Closeout effect start phase jobId'),
    jobName: input.phase.jobName,
    phase: input.phase.phase,
    stepName: input.phase.stepName,
    stepNumber: positiveInteger(input.phase.stepNumber, 'Closeout effect start phase stepNumber'),
    workflowSha: input.phase.workflowSha
  });
  if (!/^[1-9][0-9]*$/u.test(phase.runId) || !/^[1-9][0-9]*$/u.test(phase.jobId)
    || phase.jobName !== 'integrate' || phase.phase !== 'closeoutMutation'
    || phase.stepName !== BRANCH_CLOSEOUT_MUTATION_PHASE_STEP_NAME) {
    throw new Error('Closeout effect start phase is not the canonical hosted mutation step.');
  }
  assertGitSha(phase.workflowSha, 'Closeout effect start workflow SHA');
  if (phase.runId !== provenance.runId || phase.runAttempt !== provenance.runAttempt
    || phase.workflowSha !== provenance.workflowSha) {
    throw new Error('Closeout effect start phase differs from hosted workflow provenance.');
  }
  const payload = effectStartPublicationPayload({
    closeoutOperationId: input.binding.closeoutOperationId,
    binding: input.binding,
    authorizationPublication,
    recoveryArtifact,
    phase,
    provenance
  });
  return Object.freeze({ ...payload, publicationDigest: branchLifecycleDigest(payload) });
}

function parseBranchCloseoutEffectStartPublication(
  value: unknown
): BranchCloseoutEffectStartPublication {
  assertRecord(value, 'Branch closeout effect start publication');
  assertExactKeys(value, [
    'schema', 'effectStartId', 'closeoutOperationId', 'binding', 'authorizationPublication',
    'recoveryArtifact', 'phase', 'provenance', 'publicationDigest'
  ], 'Branch closeout effect start publication');
  if (value.schema !== BRANCH_CLOSEOUT_EFFECT_START_PUBLICATION_SCHEMA) {
    throw new Error('Branch closeout effect start publication schema mismatch.');
  }
  assertRecord(value.authorizationPublication, 'Closeout effect start authorization publication');
  assertExactKeys(value.authorizationPublication,
    ['authorizationPublicationId', 'publicationDigest', 'commentId'],
    'Closeout effect start authorization publication');
  assertRecord(value.recoveryArtifact, 'Closeout effect start recovery artifact');
  assertExactKeys(value.recoveryArtifact,
    ['artifactId', 'artifactName', 'artifactDigest', 'runId', 'runAttempt'],
    'Closeout effect start recovery artifact');
  assertRecord(value.phase, 'Closeout effect start phase');
  assertExactKeys(value.phase,
    ['runId', 'runAttempt', 'jobId', 'jobName', 'phase', 'stepName', 'stepNumber', 'workflowSha'],
    'Closeout effect start phase');
  const binding = value.binding as BranchCloseoutOperationBinding;
  assertBranchCloseoutOperationBinding(binding);
  const rebuilt = createBranchCloseoutEffectStartPublication({ binding,
    authorizationPublication: {
      authorizationPublicationId: value.authorizationPublication.authorizationPublicationId as `sha256:${string}`,
      publicationDigest: value.authorizationPublication.publicationDigest as `sha256:${string}`,
      commentId: value.authorizationPublication.commentId as number
    },
    recoveryArtifact: {
      artifactId: value.recoveryArtifact.artifactId as string,
      artifactName: value.recoveryArtifact.artifactName as string,
      artifactDigest: value.recoveryArtifact.artifactDigest as `sha256:${string}`,
      runId: value.recoveryArtifact.runId as string,
      runAttempt: value.recoveryArtifact.runAttempt as number
    },
    phase: {
      runId: value.phase.runId as string,
      runAttempt: value.phase.runAttempt as number,
      jobId: value.phase.jobId as string,
      jobName: value.phase.jobName as 'integrate',
      phase: value.phase.phase as 'closeoutMutation',
      stepName: value.phase.stepName as typeof BRANCH_CLOSEOUT_MUTATION_PHASE_STEP_NAME,
      stepNumber: value.phase.stepNumber as number,
      workflowSha: value.phase.workflowSha as string
    },
    provenance: value.provenance as HostedWorkflowCommentProvenance
  });
  if (value.effectStartId !== rebuilt.effectStartId
    || value.closeoutOperationId !== rebuilt.closeoutOperationId
    || value.publicationDigest !== rebuilt.publicationDigest) {
    throw new Error('Branch closeout effect start identity or digest mismatch.');
  }
  return rebuilt;
}

export function renderBranchCloseoutEffectStartPublicationComment(
  publication: BranchCloseoutEffectStartPublication
): string {
  const validated = parseBranchCloseoutEffectStartPublication(publication);
  return `${EFFECT_START_COMMENT_JSON_PREFIX}${encodeVerificationActionData(validated)}${COMMENT_JSON_SUFFIX}`;
}

export function parseBranchCloseoutEffectStartPublicationComment(
  source: string
): BranchCloseoutEffectStartPublication | null {
  if (!source.includes(BRANCH_CLOSEOUT_EFFECT_START_COMMENT_MARKER)) return null;
  if (!source.startsWith(EFFECT_START_COMMENT_JSON_PREFIX) || !source.endsWith(COMMENT_JSON_SUFFIX)) {
    throw new Error('Branch closeout effect start comment shape is invalid.');
  }
  const json = source.slice(EFFECT_START_COMMENT_JSON_PREFIX.length, -COMMENT_JSON_SUFFIX.length);
  if (json.length === 0 || json.trim() !== json) {
    throw new Error('Branch closeout effect start comment JSON is not byte-exact.');
  }
  const publication = parseBranchCloseoutEffectStartPublication(JSON.parse(json));
  if (source !== renderBranchCloseoutEffectStartPublicationComment(publication)) {
    throw new Error('Branch closeout effect start comment bytes are not canonical.');
  }
  return publication;
}

function parseBranchCloseoutEffectStartReference(
  value: unknown
): BranchCloseoutEffectStartReference {
  assertRecord(value, 'Branch closeout effect start reference');
  assertExactKeys(value, ['effectStartId', 'publicationDigest', 'commentId'],
    'Branch closeout effect start reference');
  return Object.freeze({
    effectStartId: digestValue(value.effectStartId, 'Closeout effect start reference id'),
    publicationDigest: digestValue(value.publicationDigest,
      'Closeout effect start reference publicationDigest'),
    commentId: positiveInteger(value.commentId, 'Closeout effect start reference commentId')
  });
}

function nullableSha(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new Error(`${label} must be null or a Git SHA.`);
  assertGitSha(value, label);
  return value;
}

function dispositionValue(value: unknown): BranchPublishedCloseoutReceipt['disposition'] {
  if (value !== 'merged' && value !== 'closed-superseded' && value !== 'completed-spike') {
    throw new Error('Published closeout receipt disposition is invalid.');
  }
  return value;
}

function closeoutStatusValue(value: unknown): BranchPublishedCloseoutReceipt['closeoutStatus'] {
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

function durableGoalValue(value: unknown): BranchPublishedCloseoutReceipt['durableGoal'] {
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
): BranchPublishedCloseoutReceipt['authorization'] {
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

function attemptsValue(value: unknown): BranchPublishedCloseoutReceipt['attempts'] {
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

function readbackValue(value: unknown): BranchPublishedCloseoutReceipt['readback'] {
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
  durableGoal: BranchPublishedCloseoutReceipt['durableGoal']
): string | null {
  if (durableGoal.kind !== 'main') return null;
  const match = /^main@([0-9a-f]{40})$/u.exec(durableGoal.reference);
  if (!match) {
    throw new Error('A main closeout receipt durable goal must use main@<40-char-sha>.');
  }
  return match[1]!;
}

function withoutPublicationDigest(
  receipt: BranchPublishedCloseoutReceipt
): Omit<BranchPublishedCloseoutReceipt, 'publicationDigest'> {
  const { publicationDigest: _publicationDigest, ...payload } = receipt;
  return payload;
}

function attemptDetailDigest(detail: string): `sha256:${string}` {
  return branchLifecycleDigest({ detail });
}

function assertPublishedTerminal(
  receipt: BranchPublishedCloseoutReceipt
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
): BranchPublishedCloseoutReceipt {
  const remoteBranchSha = receipt.after.remoteBranches.find(({ branch }) => (
    branch === receipt.preparation.branch
  ))?.sha ?? null;
  const localBranchSha = receipt.after.localBranches.find(({ branch }) => (
    branch === receipt.preparation.branch
  ))?.sha ?? null;
  const mainSha = expectedMainSha(receipt.request.durableGoal);
  const payload: Omit<BranchPublishedCloseoutReceipt, 'publicationDigest'> = {
    schema: BRANCH_CLOSEOUT_PUBLISHED_RECEIPT_SCHEMA,
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
): BranchPublishedCloseoutReceipt {
  assertRecord(value, 'Published closeout receipt');
  assertExactKeys(value, PUBLISHED_RECEIPT_KEYS, 'Published closeout receipt');
  if (value.schema !== BRANCH_CLOSEOUT_PUBLISHED_RECEIPT_SCHEMA) {
    throw new Error(
      `Published closeout receipt schema must be ${BRANCH_CLOSEOUT_PUBLISHED_RECEIPT_SCHEMA}.`
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
  const receipt: BranchPublishedCloseoutReceipt = {
    schema: BRANCH_CLOSEOUT_PUBLISHED_RECEIPT_SCHEMA,
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
  receipt: BranchPublishedCloseoutReceipt
): string {
  return `${COMMENT_JSON_PREFIX}${JSON.stringify(
    parsePublishedBranchCloseoutReceipt(receipt),
    null,
    2
  )}${COMMENT_JSON_SUFFIX}`;
}

export function parsePublishedBranchCloseoutReceiptComment(
  source: string
): BranchPublishedCloseoutReceipt | null {
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
): { receipts: BranchPublishedCloseoutReceipt[]; invalid: string[] } {
  const receipts: BranchPublishedCloseoutReceipt[] = [];
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
  disposition: BranchPublishedCloseoutReceipt['disposition']
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

function githubLogin(value: unknown, authorType: string, label: string): string {
  const login = boundedIdentity(value, label);
  const ordinaryLogin = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(login);
  const appBotLogin = authorType === 'Bot'
    && /^[A-Za-z0-9](?:[A-Za-z0-9-]*)\[bot\]$/u.test(login);
  if (!ordinaryLogin && !appBotLogin) {
    throw new Error(`${label} must be a GitHub login.`);
  }
  return login;
}

export function issueCommentRecord(value: unknown, label: string): IssueCommentRecord {
  assertRecord(value, label);
  if (typeof value.id !== 'number' || !Number.isSafeInteger(value.id) || value.id <= 0) {
    throw new Error(`${label}.id must be a positive safe integer.`);
  }
  if (typeof value.body !== 'string') throw new Error(`${label}.body must be a string.`);
  assertRecord(value.user, `${label}.user`);
  let app: IssueCommentRecord['app'] = null;
  if (value.performed_via_github_app !== null && value.performed_via_github_app !== undefined) {
    assertRecord(value.performed_via_github_app, `${label}.performed_via_github_app`);
    app = {
      id: positiveInteger(value.performed_via_github_app.id, `${label}.app.id`),
      nodeId: boundedIdentity(value.performed_via_github_app.node_id, `${label}.app.node_id`),
      slug: boundedIdentity(value.performed_via_github_app.slug, `${label}.app.slug`)
    };
  }
  const authorType = boundedIdentity(value.user.type, `${label}.user.type`);
  return {
    id: value.id,
    body: value.body,
    author: githubLogin(value.user.login, authorType, `${label}.user.login`),
    authorId: positiveInteger(value.user.id, `${label}.user.id`),
    authorNodeId: boundedIdentity(value.user.node_id, `${label}.user.node_id`),
    authorType,
    authorAssociation: typeof value.author_association === 'string'
      ? value.author_association
      : null,
    app
  };
}

function issueCommentRecordsPage(value: unknown, label: string): IssueCommentRecord[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`);
  return value.map((entry, index) => issueCommentRecord(entry, `${label} comment ${index}`));
}

async function collaboratorCanPublishReceipt(
  capability: GitHubApiCapability,
  author: string
): Promise<{ trusted: boolean; reason: string | null }> {
  try {
    const value = await executeGitHubApiOperation(capability, {
      kind: 'collaborator-permission', login: author
    });
    assertRecord(value, `collaborator permission for ${author}`);
    const rawRole = value.role_name ?? value.permission;
    const role = typeof rawRole === 'string' ? rawRole.toLowerCase() : '';
    return {
      trusted: role === 'admin' || role === 'maintain',
      reason: role === 'admin' || role === 'maintain'
        ? null
        : `collaborator ${author} has insufficient role ${role || '<missing>'}`
    };
  } catch (error) {
    return {
      trusted: false,
      reason: `collaborator permission for ${author} failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

/**
 * Complete issue-comment inventory through the active canonical GitHub read
 * capability. Pagination remains fail-closed: provider request/byte budgets
 * bound the inventory instead of silently truncating it.
 */
export async function listIssueComments(
  capability: GitHubApiCapability,
  issueNumber: number
): Promise<{ comments: IssueCommentRecord[] | null; detail: string | null }> {
  const comments: IssueCommentRecord[] = [];
  try {
    for (let page = 1; ; page += 1) {
      const value = await executeGitHubApiOperation(capability, {
        kind: 'issue-comments', issueNumber, page
      });
      const current = issueCommentRecordsPage(value, `GitHub issue comments page ${page}`);
      comments.push(...current);
      if (current.length < 100) break;
    }
    return { comments, detail: null };
  } catch (error) {
    return {
      comments: null,
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

export function hostedPublisherMatches(comment: IssueCommentRecord): boolean {
  const bot = CI_GITHUB_ACTIONS_IDENTITY_POLICY.bot;
  if (comment.author !== bot.login || comment.authorId !== bot.id
    || comment.authorNodeId !== bot.nodeId || comment.authorType !== bot.type) return false;
  return comment.app !== null && (comment.app.id === CI_GITHUB_ACTIONS_IDENTITY_POLICY.app.id
    && comment.app.nodeId === CI_GITHUB_ACTIONS_IDENTITY_POLICY.app.nodeId
    && comment.app.slug === CI_GITHUB_ACTIONS_IDENTITY_POLICY.app.slug);
}

async function githubApiRecord(
  capability: GitHubApiCapability,
  operation: Parameters<typeof executeGitHubApiOperation>[1],
  label: string
): Promise<Record<string, unknown>> {
  const value = await executeGitHubApiOperation(capability, operation);
  assertRecord(value, label);
  return value;
}

export async function assertHostedCommentProvenanceLiveWithCapability(
  capability: GitHubApiCapability,
  repository: string,
  comment: IssueCommentRecord,
  provenance: HostedWorkflowCommentProvenance
): Promise<void> {
  if (!hostedPublisherMatches(comment)) {
    throw new Error(`comment ${comment.id} was not performed by the canonical GitHub Actions app`);
  }
  const repo = await githubApiRecord(capability, { kind: 'repository' },
    'hosted comment repository readback');
  if (String(repo.id ?? '') !== provenance.repositoryId || repo.full_name !== repository
    || repo.default_branch !== 'main') {
    throw new Error('hosted comment repository identity drifted');
  }
  const run = await githubApiRecord(capability, {
    kind: 'workflow-run-attempt', runId: provenance.runId, runAttempt: provenance.runAttempt
  }, 'hosted comment workflow run attempt readback');
  assertRecord(run.actor, 'hosted comment workflow actor');
  assertRecord(run.repository, 'hosted comment workflow repository');
  if (String(run.id ?? '') !== provenance.runId || run.run_attempt !== provenance.runAttempt
    || run.event !== provenance.eventName || run.path !== provenance.workflowPath
    || run.head_sha !== provenance.workflowSha
    || String(run.repository.id ?? '') !== provenance.repositoryId) {
    throw new Error('hosted comment workflow run provenance drifted');
  }
  const source = await githubApiRecord(capability, {
    kind: 'workflow-run-attempt', runId: provenance.sourceRunId,
    runAttempt: provenance.sourceRunAttempt
  }, 'hosted comment source workflow run attempt readback');
  assertRecord(source.triggering_actor, 'hosted comment source triggering actor');
  if (String(source.id ?? '') !== provenance.sourceRunId
    || source.run_attempt !== provenance.sourceRunAttempt
    || source.event !== 'repository_dispatch'
    || source.path !== '.github/workflows/compiler-pr-validation.yml'
    || source.head_sha !== provenance.workflowSha
    || source.triggering_actor?.login !== provenance.actorLogin
    || source.triggering_actor?.node_id !== provenance.actorNodeId) {
    throw new Error('hosted comment source workflow provenance drifted');
  }
  const permission = await collaboratorCanPublishReceipt(capability, provenance.actorLogin);
  if (!permission.trusted) {
    throw new Error(permission.reason ?? 'hosted comment actor permission is not trusted');
  }
}

export async function assertHostedCommentProvenanceLive(
  repositoryRoot: string,
  repository: string,
  comment: IssueCommentRecord,
  provenance: HostedWorkflowCommentProvenance
): Promise<void> {
  await withGitHubApiReadSession({
    repositoryRoot,
    repository,
    operation: async (capability) => {
      await assertHostedCommentProvenanceLiveWithCapability(
        capability, repository, comment, provenance
      );
    }
  });
}

async function effectStartPublicationsInComments(
  capability: GitHubApiCapability,
  repository: string,
  pullRequestNumber: number,
  comments: readonly IssueCommentRecord[]
): Promise<readonly Readonly<{
  publication: BranchCloseoutEffectStartPublication;
  commentId: number;
}>[]> {
  const publications: Array<{
    publication: BranchCloseoutEffectStartPublication;
    commentId: number;
  }> = [];
  for (const comment of comments) {
    if (!comment.body.includes(BRANCH_CLOSEOUT_EFFECT_START_COMMENT_MARKER)) continue;
    if (!hostedPublisherMatches(comment)) {
      throw new Error(`Closeout effect start comment ${comment.id} has the wrong App provenance.`);
    }
    let publication: BranchCloseoutEffectStartPublication;
    try {
      const parsed = parseBranchCloseoutEffectStartPublicationComment(comment.body);
      if (parsed === null) throw new Error('effect start marker did not parse');
      publication = parsed;
    } catch (error) {
      throw new Error(`Closeout effect start comment ${comment.id} is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
    await assertHostedCommentProvenanceLiveWithCapability(capability, repository, comment, publication.provenance);
    if (publication.binding.repository !== repository
      || publication.binding.pullRequestNumber !== pullRequestNumber) {
      throw new Error(`Closeout effect start comment ${comment.id} targets a different PR.`);
    }
    publications.push({ publication, commentId: comment.id });
  }
  const commentIds = new Set<number>();
  const operationIds = new Set<string>();
  for (const entry of publications) {
    if (commentIds.has(entry.commentId)) {
      throw new Error('Closeout effect start inventory contains a duplicate comment id.');
    }
    commentIds.add(entry.commentId);
    if (operationIds.has(entry.publication.closeoutOperationId)) {
      throw new Error('Duplicate closeout effect start markers exist for one operation.');
    }
    operationIds.add(entry.publication.closeoutOperationId);
  }
  return Object.freeze(publications.map((entry) => Object.freeze(entry)));
}

export function assertBranchCloseoutEffectStartMatches(input: {
  publication: BranchCloseoutEffectStartPublication;
  binding: BranchCloseoutOperationBinding;
  authorizationPublication: BranchCloseoutEffectStartPublication['authorizationPublication'];
  recoveryArtifact: BranchCloseoutEffectStartPublication['recoveryArtifact'];
}): void {
  const publication = parseBranchCloseoutEffectStartPublication(input.publication);
  assertBranchCloseoutOperationBinding(input.binding);
  if (encodeVerificationActionData(publication.binding)
    !== encodeVerificationActionData(input.binding)) {
    throw new Error('Closeout effect start binding differs from the exact merged operation.');
  }
  const expectedAuthorization = {
    authorizationPublicationId: digestValue(input.authorizationPublication.authorizationPublicationId,
      'Expected closeout authorization publication id'),
    publicationDigest: digestValue(input.authorizationPublication.publicationDigest,
      'Expected closeout authorization publication digest'),
    commentId: positiveInteger(input.authorizationPublication.commentId,
      'Expected closeout authorization publication comment id')
  };
  const expectedRecovery = {
    artifactId: boundedIdentity(input.recoveryArtifact.artifactId,
      'Expected closeout recovery artifact id'),
    artifactName: boundedIdentity(input.recoveryArtifact.artifactName,
      'Expected closeout recovery artifact name'),
    artifactDigest: digestValue(input.recoveryArtifact.artifactDigest,
      'Expected closeout recovery artifact digest'),
    runId: boundedIdentity(input.recoveryArtifact.runId,
      'Expected closeout recovery run id'),
    runAttempt: positiveInteger(input.recoveryArtifact.runAttempt,
      'Expected closeout recovery run attempt')
  };
  if (encodeVerificationActionData(publication.authorizationPublication)
      !== encodeVerificationActionData(expectedAuthorization)
    || encodeVerificationActionData(publication.recoveryArtifact)
      !== encodeVerificationActionData(expectedRecovery)) {
    throw new Error('Closeout effect start authority or recovery artifact differs from the exact merged operation.');
  }
}

export async function observeBranchCloseoutEffectStartPublication(
  repositoryRoot: string,
  input: { repository: string; pullRequestNumber: number; closeoutOperationId: `sha256:${string}` }
): Promise<Readonly<{
  publication: BranchCloseoutEffectStartPublication;
  commentId: number;
}> | null> {
  return await withGitHubApiReadSession({
    repositoryRoot,
    repository: input.repository,
    operation: async (capability) => {
      const inventory = await listIssueComments(capability, input.pullRequestNumber);
      if (inventory.comments === null) {
        throw new Error(`Closeout effect start inventory failed: ${inventory.detail}`);
      }
      const matching = (await effectStartPublicationsInComments(capability, input.repository,
        input.pullRequestNumber, inventory.comments)).filter(({ publication }) => (
        publication.closeoutOperationId === input.closeoutOperationId
      ));
      if (matching.length > 1) {
        throw new Error('Duplicate closeout effect start markers exist for one operation.');
      }
      return matching[0] ?? null;
    }
  });
}

const OPERATION_COMMENT_JSON_PREFIX =
  `${BRANCH_CLOSEOUT_OPERATION_RECEIPT_COMMENT_MARKER}\n` + '```json\n';

function operationPublicationPayload(input: {
  closeoutOperationId: `sha256:${string}`;
  binding: BranchCloseoutOperationBinding;
  effectStart: BranchCloseoutEffectStartReference;
  receipt: BranchCloseoutStablePublishedReceipt;
  provenance: HostedWorkflowCommentProvenance;
}): Omit<BranchCloseoutOperationPublication, 'publicationDigest'> {
  return {
    schema: BRANCH_CLOSEOUT_OPERATION_PUBLICATION_SCHEMA,
    closeoutOperationId: input.closeoutOperationId,
    binding: input.binding,
    effectStart: input.effectStart,
    receipt: input.receipt,
    provenance: input.provenance
  };
}

function stablePublishedReceipt(
  operationReceipt: BranchCloseoutOperationReceipt
): BranchCloseoutStablePublishedReceipt {
  const published = createPublishedBranchCloseoutReceipt(operationReceipt.receipt);
  return {
    repository: published.repository,
    pullRequest: published.pullRequest,
    branch: published.branch,
    preparedHeadSha: published.preparedHeadSha,
    preparationDigest: published.preparationDigest,
    recoveryDigest: published.recoveryDigest,
    disposition: published.disposition,
    durableGoal: published.durableGoal,
    authorization: published.authorization,
    readback: published.readback,
    closeoutStatus: published.closeoutStatus,
    mainSha: published.mainSha
  };
}

function parseStablePublishedReceipt(value: unknown): BranchCloseoutStablePublishedReceipt {
  assertRecord(value, 'Stable closeout publication receipt');
  assertExactKeys(value, [
    'repository', 'pullRequest', 'branch', 'preparedHeadSha', 'preparationDigest',
    'recoveryDigest', 'disposition', 'durableGoal', 'authorization', 'readback',
    'closeoutStatus', 'mainSha'
  ], 'Stable closeout publication receipt');
  const repository = repositoryValue(value.repository);
  const pullRequest = pullRequestValue(value.pullRequest);
  if (typeof value.branch !== 'string') throw new Error('Stable closeout branch must be a string.');
  assertGitBranchName(value.branch, 'stable closeout branch');
  if (typeof value.preparedHeadSha !== 'string') throw new Error('Stable closeout preparedHeadSha must be a string.');
  assertGitSha(value.preparedHeadSha, 'stable closeout prepared head');
  const receipt: BranchCloseoutStablePublishedReceipt = {
    repository,
    pullRequest,
    branch: value.branch,
    preparedHeadSha: value.preparedHeadSha,
    preparationDigest: digestValue(value.preparationDigest, 'stable closeout preparationDigest'),
    recoveryDigest: digestValue(value.recoveryDigest, 'stable closeout recoveryDigest'),
    disposition: dispositionValue(value.disposition),
    durableGoal: durableGoalValue(value.durableGoal),
    authorization: authorizationValue(value.authorization),
    readback: readbackValue(value.readback),
    closeoutStatus: closeoutStatusValue(value.closeoutStatus),
    mainSha: nullableSha(value.mainSha, 'stable closeout mainSha')
  };
  if (receipt.mainSha !== expectedMainSha(receipt.durableGoal)
    || (receipt.mainSha !== null && receipt.readback.mainRemoteSha !== receipt.mainSha)) {
    throw new Error('Stable closeout publication main readback differs from its durable goal.');
  }
  if ((receipt.closeoutStatus === 'completed' || receipt.closeoutStatus === 'protected-pending')
    && receipt.readback.unknownCount !== 0) {
    throw new Error('Stable terminal closeout publication cannot retain unknown facts.');
  }
  if (receipt.closeoutStatus === 'completed' && (receipt.authorization.remoteAction === 'blocked'
    || receipt.authorization.localAction === 'blocked' || receipt.authorization.localAction === 'protect-local'
    || receipt.readback.remoteBranchSha !== null || receipt.readback.localBranchSha !== null
    || receipt.readback.boundWorktreeCount !== 0)) {
    throw new Error('Stable completed closeout publication contains unresolved branch state.');
  }
  if (receipt.closeoutStatus === 'protected-pending' && (receipt.authorization.localAction !== 'protect-local'
    || receipt.readback.remoteBranchSha !== null || receipt.readback.localBranchSha === null)) {
    throw new Error('Stable protected closeout publication does not bind its protected local ref.');
  }
  return receipt;
}

export function createBranchCloseoutOperationPublication(
  operationReceipt: BranchCloseoutOperationReceipt,
  provenanceInput: HostedWorkflowCommentProvenance,
  effectStartInput: {
    publication: BranchCloseoutEffectStartPublication;
    commentId: number;
  }
): BranchCloseoutOperationPublication {
  const validated = parseBranchCloseoutOperationReceipt(
    `${JSON.stringify(operationReceipt, null, 2)}\n`
  );
  const effectStartPublication = parseBranchCloseoutEffectStartPublication(
    effectStartInput.publication);
  if (encodeVerificationActionData(effectStartPublication.binding)
    !== encodeVerificationActionData(validated.binding)) {
    throw new Error('Terminal closeout publication effect start belongs to another operation.');
  }
  const effectStart = parseBranchCloseoutEffectStartReference({
    effectStartId: effectStartPublication.effectStartId,
    publicationDigest: effectStartPublication.publicationDigest,
    commentId: effectStartInput.commentId
  });
  const payload = operationPublicationPayload({
    closeoutOperationId: validated.binding.closeoutOperationId,
    binding: validated.binding,
    effectStart,
    receipt: stablePublishedReceipt(validated),
    provenance: parseHostedWorkflowCommentProvenance(provenanceInput)
  });
  return { ...payload, publicationDigest: branchLifecycleDigest(payload) };
}

function parseBranchCloseoutOperationPublication(
  value: unknown
): BranchCloseoutOperationPublication {
  assertRecord(value, 'Branch closeout operation publication');
  assertExactKeys(
    value,
    ['schema', 'closeoutOperationId', 'binding', 'effectStart', 'receipt', 'provenance', 'publicationDigest'],
    'Branch closeout operation publication'
  );
  if (value.schema !== BRANCH_CLOSEOUT_OPERATION_PUBLICATION_SCHEMA) {
    throw new Error('Branch closeout operation publication schema mismatch.');
  }
  const closeoutOperationId = digestValue(
    value.closeoutOperationId,
    'Branch closeout operation publication closeoutOperationId'
  );
  const binding = value.binding as BranchCloseoutOperationBinding;
  assertBranchCloseoutOperationBinding(binding);
  if (binding.closeoutOperationId !== closeoutOperationId) {
    throw new Error('Branch closeout publication binding operation identity mismatch.');
  }
  const effectStart = parseBranchCloseoutEffectStartReference(value.effectStart);
  if (effectStart.effectStartId !== branchCloseoutEffectStartId(closeoutOperationId)) {
    throw new Error('Branch closeout publication effect start operation identity mismatch.');
  }
  const receipt = parseStablePublishedReceipt(value.receipt);
  const provenance = parseHostedWorkflowCommentProvenance(value.provenance);
  if (receipt.repository !== binding.repository || receipt.pullRequest !== binding.pullRequestNumber
    || receipt.branch.length === 0 || receipt.preparedHeadSha !== binding.headSha
    || receipt.preparationDigest !== binding.preparationDigest || receipt.recoveryDigest !== binding.recoveryDigest
    || receipt.mainSha !== binding.newMainSha) {
    throw new Error('Branch closeout publication stable receipt differs from its operation binding.');
  }
  const publicationDigest = digestValue(
    value.publicationDigest,
    'Branch closeout operation publication publicationDigest'
  );
  const payload = operationPublicationPayload({ closeoutOperationId, binding, effectStart,
    receipt, provenance });
  if (branchLifecycleDigest(payload) !== publicationDigest) {
    throw new Error('Branch closeout operation publication digest mismatch.');
  }
  return { ...payload, publicationDigest };
}

export function renderBranchCloseoutOperationPublicationComment(
  publication: BranchCloseoutOperationPublication
): string {
  const validated = parseBranchCloseoutOperationPublication(publication);
  return `${OPERATION_COMMENT_JSON_PREFIX}${encodeVerificationActionData(validated)}${COMMENT_JSON_SUFFIX}`;
}

export function parseBranchCloseoutOperationPublicationComment(
  source: string
): BranchCloseoutOperationPublication | null {
  if (!source.includes(BRANCH_CLOSEOUT_OPERATION_RECEIPT_COMMENT_MARKER)) return null;
  if (!source.startsWith(OPERATION_COMMENT_JSON_PREFIX) || !source.endsWith(COMMENT_JSON_SUFFIX)) {
    throw new Error('Branch closeout operation publication comment shape is invalid.');
  }
  const json = source.slice(OPERATION_COMMENT_JSON_PREFIX.length, -COMMENT_JSON_SUFFIX.length);
  if (json.length === 0 || json.trim() !== json) {
    throw new Error('Branch closeout operation publication JSON is not byte-exact.');
  }
  const publication = parseBranchCloseoutOperationPublication(JSON.parse(json));
  if (source !== renderBranchCloseoutOperationPublicationComment(publication)) {
    throw new Error('Branch closeout operation publication bytes are not canonical.');
  }
  return publication;
}

async function assertEffectStartReferenceInComments(
  capability: GitHubApiCapability,
  repository: string,
  comments: readonly IssueCommentRecord[],
  terminal: BranchCloseoutOperationPublication
): Promise<void> {
  const matching = (await effectStartPublicationsInComments(capability, repository,
    terminal.binding.pullRequestNumber, comments)).filter(({ publication }) => (
    publication.closeoutOperationId === terminal.closeoutOperationId
  ));
  if (matching.length !== 1) {
    throw new Error('Terminal closeout publication requires exactly one App-authenticated effect start marker.');
  }
  const [start] = matching;
  if (start!.commentId !== terminal.effectStart.commentId
    || start!.publication.effectStartId !== terminal.effectStart.effectStartId
    || start!.publication.publicationDigest !== terminal.effectStart.publicationDigest
    || encodeVerificationActionData(start!.publication.binding)
      !== encodeVerificationActionData(terminal.binding)) {
    throw new Error('Terminal closeout publication effect start marker identity or binding differs.');
  }
}

export async function observeBranchCloseoutOperationPublication(
  repositoryRoot: string,
  input: { repository: string; pullRequestNumber: number; closeoutOperationId: `sha256:${string}` }
): Promise<Readonly<{ publication: BranchCloseoutOperationPublication; commentId: number }> | null> {
  return await withGitHubApiReadSession({
    repositoryRoot,
    repository: input.repository,
    operation: async (capability) => {
      const inventory = await listIssueComments(capability, input.pullRequestNumber);
      if (inventory.comments === null) {
        throw new Error(`Closeout publication inventory failed: ${inventory.detail}`);
      }
      const matching: Array<{ publication: BranchCloseoutOperationPublication; commentId: number }> = [];
      for (const comment of inventory.comments) {
        if (!comment.body.includes(BRANCH_CLOSEOUT_OPERATION_RECEIPT_COMMENT_MARKER)) continue;
        if (!hostedPublisherMatches(comment)) {
          throw new Error(`Closeout publication comment ${comment.id} has the wrong publisher provenance.`);
        }
        let publication: BranchCloseoutOperationPublication;
        try {
          const parsed = parseBranchCloseoutOperationPublicationComment(comment.body);
          if (parsed === null) throw new Error('closeout marker did not parse');
          publication = parsed;
        } catch (error) {
          throw new Error(`Closeout publication comment ${comment.id} is invalid: ${error instanceof Error ? error.message : String(error)}`);
        }
        await assertHostedCommentProvenanceLiveWithCapability(
          capability,
          input.repository,
          comment,
          publication.provenance
        );
        if (publication.receipt.repository !== input.repository
          || publication.receipt.pullRequest !== input.pullRequestNumber) {
          throw new Error(`Closeout publication comment ${comment.id} targets a different PR.`);
        }
        if (publication.closeoutOperationId === input.closeoutOperationId) {
          matching.push({ publication, commentId: comment.id });
        }
      }
      if (matching.length > 1) throw new Error('Duplicate comments exist for one closeout operation.');
      if (matching[0] !== undefined) {
        await assertEffectStartReferenceInComments(capability, input.repository, inventory.comments,
          matching[0].publication);
      }
      return matching[0] === undefined ? null : Object.freeze(matching[0]);
    }
  });
}
