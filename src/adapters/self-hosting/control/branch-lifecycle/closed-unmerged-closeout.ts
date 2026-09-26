import {
  authorizeBranchCloseout,
  createBranchCloseoutReceipt
} from './branch-closeout-contract.ts';
import {
  createPublishedBranchCloseoutReceipt,
  parsePublishedBranchCloseoutReceipt
} from './branch-closeout-receipt.ts';
import {
  assertPreparedBranchCloseoutEnvelope,
  type PreparedBranchCloseoutEnvelope
} from './branch-closeout.ts';
import {
  assertDurableRecoveryAuthority,
  assertGitBranchName,
  assertGitSha,
  branchLifecycleDigest
} from './branch-lifecycle-audit.ts';
import {
  BRANCH_REF_CLOSEOUT_CAPABILITY,
  type BranchCloseoutAttempt,
  type BranchCloseoutAuthorization,
  type BranchLifecycleInventory,
  type BranchPublishedCloseoutReceipt,
  type BranchPullRequestObservation
} from './branch-lifecycle-types.ts';
import { verifyRecoveryAuthorityLive } from './branch-recovery.ts';
import {
  assertClosedSupersessionEvidence,
  type ClosedSupersessionEvidence
} from './closed-supersession-review.ts';
import { observeNativeMainAbsorption } from './branch-recovery.ts';

const CLOSED_UNMERGED_CLOSEOUT_EVIDENCE_SCHEMA =
  'sec-closed-unmerged-closeout-evidence-v1' as const;
const CLOSED_UNMERGED_CLOSEOUT_OPERATION_SCHEMA =
  'sec-closed-unmerged-closeout-operation-v1' as const;
const CLOSED_UNMERGED_CLOSEOUT_EFFECT_START_SCHEMA =
  'sec-closed-unmerged-closeout-effect-start-v1' as const;

type ClosedUnmergedCloseoutDisposition = 'closed-superseded';

interface ClosedUnmergedCloseoutEvidenceBase {
  readonly schema: typeof CLOSED_UNMERGED_CLOSEOUT_EVIDENCE_SCHEMA;
  readonly disposition: ClosedUnmergedCloseoutDisposition;
  readonly repository: string;
  readonly pullRequestNumber: number;
  readonly branch: string;
  readonly headSha: string;
  readonly headTreeSha: string;
  readonly baseBranch: string;
  readonly baseSha: string;
  readonly currentMainSha: string;
  readonly currentMainTreeSha: string;
  readonly durableGoal: Readonly<{
    kind: 'issue' | 'evidence';
    reference: string;
  }>;
  readonly evidenceDigest: `sha256:${string}`;
}

export interface ClosedSupersededDispositionEvidence
  extends ClosedUnmergedCloseoutEvidenceBase {
  readonly disposition: 'closed-superseded';
  readonly supersessionReviewDigest: `sha256:${string}`;
  readonly supersessionReference: string;
}

export interface ClosedNativeAbsorptionDispositionEvidence
  extends ClosedUnmergedCloseoutEvidenceBase {
  readonly disposition: 'closed-superseded';
  readonly retentionBasis: 'native-ancestor' | 'identical-tree';
  readonly recoveryDigest: `sha256:${string}`;
}

export type ClosedUnmergedCloseoutEvidence =
  | ClosedSupersededDispositionEvidence
  | ClosedNativeAbsorptionDispositionEvidence;

export interface ClosedUnmergedCloseoutOperation {
  readonly schema: typeof CLOSED_UNMERGED_CLOSEOUT_OPERATION_SCHEMA;
  readonly operationId: `sha256:${string}`;
  readonly prepared: PreparedBranchCloseoutEnvelope;
  readonly evidence: ClosedUnmergedCloseoutEvidence;
  readonly authorization: BranchCloseoutAuthorization;
}

export type ClosedUnmergedCloseoutCompileResult =
  | Readonly<{ status: 'ready'; operation: ClosedUnmergedCloseoutOperation }>
  | Readonly<{ status: 'blocked'; blockers: readonly string[] }>;

export interface ClosedUnmergedCloseoutEffectStartReceipt {
  readonly schema: typeof CLOSED_UNMERGED_CLOSEOUT_EFFECT_START_SCHEMA;
  readonly operationId: `sha256:${string}`;
  readonly repository: string;
  readonly pullRequestNumber: number;
  readonly branch: string;
  readonly headSha: string;
  readonly preparationDigest: `sha256:${string}`;
  readonly recoveryDigest: `sha256:${string}`;
  readonly evidenceDigest: `sha256:${string}`;
  readonly providerIdentity: string;
  readonly receiptDigest: `sha256:${string}`;
}

export interface ClosedUnmergedTerminal {
  readonly operationId: `sha256:${string}`;
  readonly evidenceDigest: `sha256:${string}`;
  readonly prepared: PreparedBranchCloseoutEnvelope;
  readonly receipt: BranchPublishedCloseoutReceipt;
}

type ClosedUnmergedProviderObservation<T> =
  | Readonly<{ status: 'observed'; value: T }>
  | Readonly<{ status: 'unavailable' | 'ambiguous'; detail: string }>;

export type ClosedUnmergedProviderMutation = Readonly<{
  status: 'applied' | 'already-applied' | 'unavailable' | 'ambiguous' | 'rejected';
  detail: string;
}>;

export interface ClosedUnmergedCloseoutEffectAdapter {
  readonly providerIdentity: string;
  readonly repository: string;
  readonly localRefDeleteCoordination: 'coordinated' | 'unavailable';
  observeInventory(): Promise<ClosedUnmergedProviderObservation<BranchLifecycleInventory>>;
  observeEffectStart(
    operationId: `sha256:${string}`
  ): Promise<ClosedUnmergedProviderObservation<ClosedUnmergedCloseoutEffectStartReceipt | null>>;
  publishEffectStart(
    receipt: ClosedUnmergedCloseoutEffectStartReceipt
  ): Promise<ClosedUnmergedProviderMutation>;
  deleteRemoteRefCas(input: Readonly<{
    operationId: `sha256:${string}`;
    repository: string;
    remote: string;
    branch: string;
    expectedOldSha: string;
  }>): Promise<ClosedUnmergedProviderMutation>;
  deleteLocalRefCas(input: Readonly<{
    operationId: `sha256:${string}`;
    repository: string;
    branch: string;
    expectedOldSha: string;
  }>): Promise<ClosedUnmergedProviderMutation>;
  pruneRemote(input: Readonly<{
    operationId: `sha256:${string}`;
    repository: string;
    remote: string;
    branch: string;
    expectedOldSha: string;
  }>): Promise<ClosedUnmergedProviderMutation>;
  observeTerminalReceipt(
    operationId: `sha256:${string}`
  ): Promise<ClosedUnmergedProviderObservation<ClosedUnmergedTerminal | null>>;
  publishTerminalReceipt(
    terminal: ClosedUnmergedTerminal
  ): Promise<ClosedUnmergedProviderMutation>;
}

export interface ClosedUnmergedCloseoutEffectProvider {
  readonly providerIdentity: string;
  readonly repository: string;
}

export type ClosedUnmergedCloseoutExecutionResult =
  | Readonly<{
      status: 'completed';
      operationId: `sha256:${string}`;
      receipt: BranchPublishedCloseoutReceipt;
    }>
  | Readonly<{
      status: 'blocked' | 'preserved';
      operationId: `sha256:${string}`;
      stage: string;
      reasons: readonly string[];
    }>;

const issuedEvidence = new WeakSet<object>();
const reviewedEvidenceByDisposition = new WeakMap<object, ClosedSupersessionEvidence>();
const issuedOperations = new WeakSet<object>();
const issuedCompletedSettlements = new WeakMap<object, Readonly<{
  operation: ClosedUnmergedCloseoutOperation;
  publicationDigest: `sha256:${string}`;
}>>();
const providerAdapters = new WeakMap<object, ClosedUnmergedCloseoutEffectAdapter>();

function boundedText(value: string, label: string): string {
  if (value.length === 0 || value.length > 512 || value.trim() !== value || /[\u0000-\u001f]/u.test(value)) {
    throw new Error(`${label} must be bounded canonical text.`);
  }
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function digest(value: string, label: string): `sha256:${string}` {
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw new Error(`${label} must be a SHA-256 digest.`);
  }
  return value as `sha256:${string}`;
}

function evidencePayload(input: Omit<
  ClosedUnmergedCloseoutEvidenceBase,
  'schema' | 'evidenceDigest'
> & {
  readonly supersessionReviewDigest?: `sha256:${string}`;
  readonly supersessionReference?: string;
  readonly retentionBasis?: 'native-ancestor' | 'identical-tree';
  readonly recoveryDigest?: `sha256:${string}`;
}): Record<string, unknown> {
  return {
    schema: CLOSED_UNMERGED_CLOSEOUT_EVIDENCE_SCHEMA,
    ...input,
    durableGoal: Object.freeze({ ...input.durableGoal })
  };
}

function assertIssuedEvidence(evidence: ClosedUnmergedCloseoutEvidence): void {
  if (!issuedEvidence.has(evidence)) {
    throw new Error('disposition evidence was not issued by the branch lifecycle owner');
  }
  const { evidenceDigest, ...payload } = evidence;
  if (branchLifecycleDigest(payload) !== evidenceDigest) {
    throw new Error('disposition evidence changed after issuance');
  }
}

function validateEvidenceInput(input: Omit<
  ClosedUnmergedCloseoutEvidenceBase,
  'schema' | 'disposition' | 'evidenceDigest'
>): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(input.repository)) {
    throw new Error('Closed-unmerged evidence repository is invalid.');
  }
  positiveInteger(input.pullRequestNumber, 'Closed-unmerged evidence pull request');
  assertGitBranchName(input.branch);
  assertGitSha(input.headSha, 'closed-unmerged evidence headSha');
  assertGitSha(input.headTreeSha, 'closed-unmerged evidence headTreeSha');
  assertGitBranchName(input.baseBranch);
  assertGitSha(input.baseSha, 'closed-unmerged evidence baseSha');
  assertGitSha(input.currentMainSha, 'closed-unmerged evidence currentMainSha');
  assertGitSha(input.currentMainTreeSha, 'closed-unmerged evidence currentMainTreeSha');
  if (input.durableGoal.kind !== 'issue' && input.durableGoal.kind !== 'evidence') {
    throw new Error('Closed-unmerged durable goal must be an Issue or canonical Evidence.');
  }
  boundedText(input.durableGoal.reference, 'Closed-unmerged durable goal reference');
}

export function createClosedSupersededDispositionEvidence(input: Omit<
  ClosedSupersededDispositionEvidence,
  'schema' | 'disposition' | 'evidenceDigest'
    | 'supersessionReviewDigest' | 'supersessionReference'
> & Readonly<{ supersession: ClosedSupersessionEvidence }>): ClosedSupersededDispositionEvidence {
  const { supersession, ...base } = input;
  validateEvidenceInput(base);
  assertClosedSupersessionEvidence(supersession);
  if (base.headTreeSha === base.currentMainTreeSha) {
    throw new Error('Closed-superseded requires a branch tree distinct from current main.');
  }
  const review = supersession.review;
  if (review.repository !== base.repository
    || review.pullRequestNumber !== base.pullRequestNumber
    || review.headSha !== base.headSha
    || review.headTreeSha !== base.headTreeSha
    || review.currentMainSha !== base.currentMainSha
    || review.currentMainTreeSha !== base.currentMainTreeSha) {
    throw new Error('Closed-superseded review identity differs from the disposition evidence.');
  }
  const supersessionReviewDigest = digest(
    supersession.receiptDigest,
    'Closed-superseded review digest'
  );
  const supersessionReference = boundedText(
    supersession.reference,
    'Closed-superseded review reference'
  );
  const payload = evidencePayload({
    ...base,
    disposition: 'closed-superseded',
    supersessionReviewDigest,
    supersessionReference
  });
  const evidence = Object.freeze({
    ...payload,
    evidenceDigest: branchLifecycleDigest(payload)
  }) as ClosedSupersededDispositionEvidence;
  issuedEvidence.add(evidence);
  reviewedEvidenceByDisposition.set(evidence, supersession);
  return evidence;
}

export function createClosedNativeAbsorptionDispositionEvidence(input: Omit<
  ClosedNativeAbsorptionDispositionEvidence,
  'schema' | 'disposition' | 'evidenceDigest' | 'retentionBasis' | 'recoveryDigest'
> & Readonly<{ prepared: PreparedBranchCloseoutEnvelope }>): ClosedNativeAbsorptionDispositionEvidence {
  const { prepared, ...base } = input;
  validateEvidenceInput(base);
  assertPreparedBranchCloseoutEnvelope(prepared);
  const recovery = prepared.preparation.recovery;
  if (recovery.kind !== 'main-absorption'
      || (recovery.basis !== 'native-ancestor' && recovery.basis !== 'identical-tree')
      || recovery.sourceSha !== base.headSha || recovery.sourceTreeSha !== base.headTreeSha
      || recovery.mainSha !== base.currentMainSha || recovery.mainTreeSha !== base.currentMainTreeSha
      || prepared.preparation.branch !== base.branch
      || prepared.preparation.expectedRemoteSha !== base.headSha) {
    throw new Error('Closed-native disposition does not bind the exact issued main-absorption recovery.');
  }
  const payload = evidencePayload({ ...base, disposition: 'closed-superseded',
    retentionBasis: recovery.basis, recoveryDigest: recovery.sha256 });
  const evidence = Object.freeze({ ...payload,
    evidenceDigest: branchLifecycleDigest(payload) }) as ClosedNativeAbsorptionDispositionEvidence;
  issuedEvidence.add(evidence);
  return evidence;
}

/**
 * Observe deterministic native main absorption and issue its exact disposition
 * before any recovery or preparation artifact is written. This is the retry
 * lookup lane for already-completed operations.
 */
export async function tryCreateClosedNativeAbsorptionDispositionEvidence(input: Readonly<{
  repositoryRoot: string;
  repository: string;
  pullRequestNumber: number;
  branch: string;
  headSha: string;
  baseBranch: string;
  baseSha: string;
  currentMainSha: string;
}>): Promise<ClosedNativeAbsorptionDispositionEvidence | null> {
  const observed = await observeNativeMainAbsorption({
    repositoryRoot: input.repositoryRoot,
    sourceSha: input.headSha,
    mainSha: input.currentMainSha
  });
  if (observed === null) return null;
  const base = {
    repository: input.repository,
    pullRequestNumber: input.pullRequestNumber,
    branch: input.branch,
    headSha: input.headSha,
    headTreeSha: observed.sourceTreeSha,
    baseBranch: input.baseBranch,
    baseSha: input.baseSha,
    currentMainSha: input.currentMainSha,
    currentMainTreeSha: observed.mainTreeSha,
    durableGoal: {
      kind: 'evidence' as const,
      reference: `main-absorption:${observed.recoveryDigest}`
    }
  };
  validateEvidenceInput(base);
  const payload = evidencePayload({
    ...base,
    disposition: 'closed-superseded',
    retentionBasis: observed.basis,
    recoveryDigest: observed.recoveryDigest
  });
  const evidence = Object.freeze({
    ...payload,
    evidenceDigest: branchLifecycleDigest(payload)
  }) as ClosedNativeAbsorptionDispositionEvidence;
  issuedEvidence.add(evidence);
  return evidence;
}

function exactPullRequest(
  inventory: BranchLifecycleInventory,
  evidence: ClosedUnmergedCloseoutEvidence
): BranchPullRequestObservation | undefined {
  return inventory.pullRequests.find(({ number }) => number === evidence.pullRequestNumber);
}

function closeoutRequest(evidence: ClosedUnmergedCloseoutEvidence) {
  return Object.freeze({
    capability: BRANCH_REF_CLOSEOUT_CAPABILITY,
    disposition: 'closed-superseded' as const,
    durableGoal: { ...evidence.durableGoal }
  });
}

function exactCurrentBlockers(input: {
  prepared: PreparedBranchCloseoutEnvelope;
  evidence: ClosedUnmergedCloseoutEvidence;
  inventory: BranchLifecycleInventory;
  allowedPrStates: readonly BranchPullRequestObservation['state'][];
}): string[] {
  const { preparation } = input.prepared;
  const { evidence, inventory } = input;
  const blockers: string[] = [];
  const pullRequest = exactPullRequest(inventory, evidence);
  const remote = inventory.remoteBranches.find(({ branch }) => branch === evidence.branch);
  if (inventory.repository.fullName !== evidence.repository
    || inventory.repository.fullName !== preparation.repository.fullName) {
    blockers.push('repository identity changed');
  }
  if (inventory.main.remoteSha !== evidence.currentMainSha) {
    blockers.push('current main SHA changed');
  }
  if (inventory.activeWorkPackage.state !== 'none') {
    blockers.push('active Work Package state is not none');
  }
  if (inventory.unknowns.length > 0) blockers.push('inventory contains unresolved facts');
  if (!pullRequest) blockers.push('exact pull request is absent');
  else {
    if (!input.allowedPrStates.includes(pullRequest.state)) {
      blockers.push(`pull request state changed to ${pullRequest.state}`);
    }
    if (pullRequest.headBranch !== evidence.branch || pullRequest.headSha !== evidence.headSha) {
      blockers.push('pull request head identity changed');
    }
    if (pullRequest.baseBranch !== evidence.baseBranch || pullRequest.baseSha !== evidence.baseSha) {
      blockers.push('pull request base identity changed');
    }
  }
  if (remote !== undefined && remote.sha !== evidence.headSha) {
    blockers.push('remote branch SHA changed');
  }
  if (remote === undefined && pullRequest?.state === 'open') {
    blockers.push('remote branch is absent while the exact PR remains open');
  }
  try {
    assertDurableRecoveryAuthority(preparation.recovery, inventory);
    if (preparation.recovery.kind === 'main-absorption') {
      const recovery = preparation.recovery;
      if (recovery.basis === 'reviewed-supersession') {
        if (!('supersessionReviewDigest' in evidence)
            || evidence.supersessionReviewDigest !== recovery.reviewReceiptDigest
            || evidence.supersessionReference !== recovery.reviewReference) {
          throw new Error('Reviewed disposition does not bind the exact main-absorption recovery.');
        }
      } else if (!('retentionBasis' in evidence)
          || evidence.retentionBasis !== recovery.basis
          || evidence.recoveryDigest !== recovery.sha256) {
        throw new Error('Native disposition does not bind the exact main-absorption recovery.');
      }
    } else {
      const review = reviewedEvidenceByDisposition.get(evidence);
      if (!('supersessionReviewDigest' in evidence) || review === undefined
          || evidence.supersessionReviewDigest !== review.receiptDigest
          || evidence.supersessionReference !== review.reference) {
        throw new Error('Bundle recovery requires its exact owner-issued reviewed disposition.');
      }
    }
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
  }
  return [...new Set(blockers)].sort((left, right) => left.localeCompare(right));
}

export function compileClosedUnmergedCloseoutOperation(input: {
  prepared: PreparedBranchCloseoutEnvelope;
  evidence: ClosedUnmergedCloseoutEvidence;
}): ClosedUnmergedCloseoutCompileResult {
  try {
    assertPreparedBranchCloseoutEnvelope(input.prepared);
  } catch (error) {
    return Object.freeze({ status: 'blocked', blockers: [
      error instanceof Error ? error.message : String(error)
    ] });
  }
  try {
    assertIssuedEvidence(input.evidence);
  } catch (error) {
    return Object.freeze({ status: 'blocked', blockers: [
      error instanceof Error ? error.message : String(error)
    ] });
  }
  const { preparation } = input.prepared;
  const evidence = input.evidence;
  const blockers = exactCurrentBlockers({
    prepared: input.prepared,
    evidence,
    inventory: input.prepared.before,
    allowedPrStates: ['closed']
  });
  if (preparation.pullRequestStateAtPreparation !== 'closed'
    || (preparation.refState !== 'present' && preparation.refState !== 'absent')
    || preparation.pullRequestNumber !== evidence.pullRequestNumber
    || preparation.branch !== evidence.branch
    || preparation.expectedHeadSha !== evidence.headSha
    || preparation.expectedRemoteSha !== evidence.headSha
    || (preparation.refState === 'absent'
      && preparation.expectedPrHeadSha !== evidence.headSha)) {
    blockers.push('preparation does not bind a supported exact closed-unmerged PR/ref lane');
  }
  if (preparation.preparationDigest !== input.prepared.preparation.preparationDigest) {
    blockers.push('preparation digest changed');
  }
  const authorization = authorizeBranchCloseout({
    preparation,
    request: closeoutRequest(evidence),
    before: input.prepared.before,
    current: input.prepared.before,
    expectedHeadTreeSha: evidence.headTreeSha
  });
  blockers.push(...authorization.blockers);
  const uniqueBlockers = [...new Set(blockers)].sort((left, right) => left.localeCompare(right));
  if (uniqueBlockers.length > 0) {
    return Object.freeze({ status: 'blocked', blockers: Object.freeze(uniqueBlockers) });
  }
  const identity = closedUnmergedOperationIdentity(input.prepared, evidence);
  const operation = Object.freeze({
    schema: CLOSED_UNMERGED_CLOSEOUT_OPERATION_SCHEMA,
    operationId: branchLifecycleDigest(identity),
    prepared: input.prepared,
    evidence,
    authorization
  });
  issuedOperations.add(operation);
  return Object.freeze({ status: 'ready', operation });
}

function closedUnmergedOperationIdentity(
  prepared: PreparedBranchCloseoutEnvelope,
  evidence: ClosedUnmergedCloseoutEvidence
): object {
  return {
    schema: CLOSED_UNMERGED_CLOSEOUT_OPERATION_SCHEMA,
    repository: evidence.repository,
    pullRequestNumber: evidence.pullRequestNumber,
    branch: evidence.branch,
    headSha: evidence.headSha,
    baseBranch: evidence.baseBranch,
    baseSha: evidence.baseSha,
    currentMainSha: evidence.currentMainSha,
    preparationDigest: prepared.preparation.preparationDigest,
    recoveryDigest: prepared.preparation.recovery.sha256,
    evidenceDigest: evidence.evidenceDigest
  };
}

function createEffectStartReceipt(
  operation: ClosedUnmergedCloseoutOperation,
  providerIdentity: string
): ClosedUnmergedCloseoutEffectStartReceipt {
  const payload = {
    schema: CLOSED_UNMERGED_CLOSEOUT_EFFECT_START_SCHEMA,
    operationId: operation.operationId,
    repository: operation.evidence.repository,
    pullRequestNumber: operation.evidence.pullRequestNumber,
    branch: operation.evidence.branch,
    headSha: operation.evidence.headSha,
    preparationDigest: operation.prepared.preparation.preparationDigest,
    recoveryDigest: operation.prepared.preparation.recovery.sha256,
    evidenceDigest: operation.evidence.evidenceDigest,
    providerIdentity: boundedText(providerIdentity, 'Closed-unmerged provider identity')
  };
  return Object.freeze({ ...payload, receiptDigest: branchLifecycleDigest(payload) });
}

function assertEffectStartReceipt(
  receipt: ClosedUnmergedCloseoutEffectStartReceipt,
  expected: ClosedUnmergedCloseoutEffectStartReceipt
): void {
  if (receipt.schema !== CLOSED_UNMERGED_CLOSEOUT_EFFECT_START_SCHEMA
    || receipt.receiptDigest !== branchLifecycleDigest({
      schema: receipt.schema,
      operationId: receipt.operationId,
      repository: receipt.repository,
      pullRequestNumber: receipt.pullRequestNumber,
      branch: receipt.branch,
      headSha: receipt.headSha,
      preparationDigest: receipt.preparationDigest,
      recoveryDigest: receipt.recoveryDigest,
      evidenceDigest: receipt.evidenceDigest,
      providerIdentity: receipt.providerIdentity
    })
    || receipt.receiptDigest !== expected.receiptDigest) {
    throw new Error('effect-start readback differs from the exact closeout operation');
  }
}

export function issueClosedUnmergedCloseoutEffectProvider(
  adapter: ClosedUnmergedCloseoutEffectAdapter
): ClosedUnmergedCloseoutEffectProvider {
  boundedText(adapter.providerIdentity, 'Closed-unmerged provider identity');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/u.test(adapter.repository)) {
    throw new Error('Closed-unmerged provider repository is invalid.');
  }
  if (adapter.localRefDeleteCoordination !== 'coordinated' && adapter.localRefDeleteCoordination !== 'unavailable') {
    throw new Error('Closed-unmerged provider local-ref delete atomicity is invalid.');
  }
  const provider = Object.freeze({
    providerIdentity: adapter.providerIdentity,
    repository: adapter.repository
  });
  providerAdapters.set(provider, adapter);
  return provider;
}

function preserve(
  operation: ClosedUnmergedCloseoutOperation,
  stage: string,
  ...reasons: string[]
): ClosedUnmergedCloseoutExecutionResult {
  return Object.freeze({ status: 'preserved', operationId: operation.operationId,
    stage, reasons: Object.freeze(reasons) });
}

function blocked(
  operation: ClosedUnmergedCloseoutOperation,
  stage: string,
  reasons: readonly string[]
): ClosedUnmergedCloseoutExecutionResult {
  return Object.freeze({ status: 'blocked', operationId: operation.operationId,
    stage, reasons: Object.freeze([...new Set(reasons)].sort((left, right) => left.localeCompare(right))) });
}

function issueCompletedSettlement(
  operation: ClosedUnmergedCloseoutOperation,
  receipt: BranchPublishedCloseoutReceipt
): Extract<ClosedUnmergedCloseoutExecutionResult, { status: 'completed' }> {
  if (!terminalMatches(operation, {
    operationId: operation.operationId,
    evidenceDigest: operation.evidence.evidenceDigest,
    prepared: operation.prepared,
    receipt
  })) {
    throw new Error('Closed-unmerged completed settlement receipt differs from the exact operation.');
  }
  const result = Object.freeze({
    status: 'completed' as const,
    operationId: operation.operationId,
    receipt
  });
  issuedCompletedSettlements.set(result, Object.freeze({
    operation,
    publicationDigest: receipt.publicationDigest
  }));
  return result;
}

/** Exact in-process settlement capability for destructive recovery retirement. */
export function assertClosedUnmergedCloseoutCompletedSettlement(
  operation: ClosedUnmergedCloseoutOperation,
  result: ClosedUnmergedCloseoutExecutionResult
): asserts result is Extract<ClosedUnmergedCloseoutExecutionResult, { status: 'completed' }> {
  const issued = issuedCompletedSettlements.get(result);
  if (!issuedOperations.has(operation)
    || result.status !== 'completed'
    || issued?.operation !== operation
    || result.operationId !== operation.operationId
    || result.receipt.publicationDigest !== issued.publicationDigest
    || !terminalMatches(operation, {
      operationId: operation.operationId,
      evidenceDigest: operation.evidence.evidenceDigest,
      prepared: operation.prepared,
      receipt: result.receipt
    })) {
    throw new Error('Closed-unmerged recovery retirement requires an exact owner-issued completed settlement.');
  }
}

async function providerCall<T>(
  operation: ClosedUnmergedCloseoutOperation,
  stage: string,
  call: () => Promise<T>
): Promise<T | ClosedUnmergedCloseoutExecutionResult> {
  try {
    return await call();
  } catch (error) {
    return preserve(operation, stage,
      `provider threw: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function terminalMatches(
  operation: ClosedUnmergedCloseoutOperation,
  value: ClosedUnmergedTerminal
): boolean {
  try {
    if (value.operationId !== operation.operationId
      || value.evidenceDigest !== operation.evidence.evidenceDigest) return false;
    assertPreparedBranchCloseoutEnvelope(value.prepared);
    if (value.prepared.envelopeDigest !== operation.prepared.envelopeDigest) return false;
    const receipt = parsePublishedBranchCloseoutReceipt(value.receipt);
    return receipt.repository === operation.evidence.repository
      && receipt.pullRequest === operation.evidence.pullRequestNumber
      && receipt.branch === operation.evidence.branch
      && receipt.preparedHeadSha === operation.evidence.headSha
      && receipt.preparationDigest === operation.prepared.preparation.preparationDigest
      && receipt.recoveryDigest === operation.prepared.preparation.recovery.sha256
      && receipt.disposition === 'closed-superseded'
      && receipt.durableGoal.kind === operation.evidence.durableGoal.kind
      && receipt.durableGoal.reference === operation.evidence.durableGoal.reference
      && (receipt.closeoutStatus === 'completed' || receipt.closeoutStatus === 'protected-pending');
  } catch {
    return false;
  }
}

function isExecutionResult(value: unknown): value is ClosedUnmergedCloseoutExecutionResult {
  return !!value && typeof value === 'object' && 'operationId' in value && 'status' in value;
}

async function observeExactInventory(
  operation: ClosedUnmergedCloseoutOperation,
  adapter: ClosedUnmergedCloseoutEffectAdapter,
  stage: string,
  allowedPrStates: readonly BranchPullRequestObservation['state'][]
): Promise<BranchLifecycleInventory | ClosedUnmergedCloseoutExecutionResult> {
  const observation = await providerCall(operation, stage, () => adapter.observeInventory());
  if (isExecutionResult(observation)) return observation;
  if (observation.status !== 'observed') return preserve(operation, stage, observation.detail);
  const blockers = exactCurrentBlockers({ prepared: operation.prepared,
    evidence: operation.evidence, inventory: observation.value, allowedPrStates });
  if (blockers.length > 0) return blocked(operation, stage, blockers);
  const recovery = operation.prepared.preparation.recovery;
  const live = await verifyRecoveryAuthorityLive({ inventory: observation.value, recovery,
    ...(recovery.kind === 'main-absorption' && recovery.basis === 'reviewed-supersession'
      ? { reviewEvidence: reviewedEvidenceByDisposition.get(operation.evidence) }
      : {}) });
  return live.status === 'success'
    ? observation.value : blocked(operation, stage, [live.detail]);
}

function currentAuthorization(
  operation: ClosedUnmergedCloseoutOperation,
  inventory: BranchLifecycleInventory
): BranchCloseoutAuthorization {
  return authorizeBranchCloseout({ preparation: operation.prepared.preparation,
    request: closeoutRequest(operation.evidence), before: operation.prepared.before,
    current: inventory, expectedHeadTreeSha: operation.evidence.headTreeSha });
}

function localRefDeleteCapabilityBlocker(
  adapter: ClosedUnmergedCloseoutEffectAdapter,
  authorization: BranchCloseoutAuthorization
): string | null {
  return authorization.localAction === 'delete-exact' && adapter.localRefDeleteCoordination !== 'coordinated'
    ? 'Git local ref exact delete is unavailable before further branch effects'
    : null;
}

function terminalConvergenceBlockers(input: Readonly<{
  operation: ClosedUnmergedCloseoutOperation;
  inventory: BranchLifecycleInventory;
}>): Readonly<{ blockers: readonly string[]; residue: readonly string[] }> {
  const { operation, inventory } = input;
  const { preparation } = operation.prepared;
  const { evidence } = operation;
  const blockers: string[] = [];
  const residue: string[] = [];
  if (inventory.repository.root !== preparation.repository.root
      || inventory.repository.commonDir !== preparation.repository.commonDir
      || inventory.repository.fullName !== preparation.repository.fullName
      || inventory.repository.fullName !== evidence.repository
      || inventory.repository.remote !== preparation.repository.remote
      || inventory.repository.defaultBranch !== preparation.repository.defaultBranch) {
    blockers.push('terminal repository identity differs from the prepared repository');
  }
  const currentMain = inventory.remoteBranches.find(
    ({ branch }) => branch === inventory.repository.defaultBranch
  );
  if (inventory.main.remoteSha === null || currentMain?.sha !== inventory.main.remoteSha) {
    blockers.push('terminal current main identity is unresolved');
  }
  if (inventory.unknowns.length > 0) blockers.push('inventory contains unresolved facts');
  if (inventory.activeWorkPackage.state === 'invalid'
      || inventory.activeWorkPackage.state === 'unresolved') {
    blockers.push('active Work Package readback is invalid or unresolved');
  } else if (inventory.activeWorkPackage.state === 'active'
      && inventory.activeWorkPackage.branch === evidence.branch) {
    residue.push('active Work Package still selects the terminal branch');
  }
  const pullRequest = exactPullRequest(inventory, evidence);
  if (pullRequest === undefined) blockers.push('exact pull request is absent');
  else {
    if (pullRequest.state !== 'closed') blockers.push(`pull request state changed to ${pullRequest.state}`);
    if (pullRequest.headBranch !== evidence.branch || pullRequest.headSha !== evidence.headSha) {
      blockers.push('pull request head identity changed');
    }
    if (pullRequest.baseBranch !== evidence.baseBranch || pullRequest.baseSha !== evidence.baseSha) {
      blockers.push('pull request base identity changed');
    }
  }
  try {
    assertDurableRecoveryAuthority(preparation.recovery, inventory);
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
  }
  if (inventory.remoteBranches.some(({ branch }) => branch === evidence.branch)) {
    residue.push('remote branch exists after the terminal receipt');
  }
  if (inventory.localBranches.some(({ branch }) => branch === evidence.branch)) {
    residue.push('local branch exists after the terminal receipt');
  }
  if (inventory.worktrees.some(({ branch }) => branch === evidence.branch)) {
    residue.push('registered worktree still binds the terminal branch');
  }
  return Object.freeze({
    blockers: Object.freeze([...new Set(blockers)].sort((left, right) => left.localeCompare(right))),
    residue: Object.freeze([...new Set(residue)].sort((left, right) => left.localeCompare(right)))
  });
}

async function settleClosedUnmergedTerminal(
  operation: ClosedUnmergedCloseoutOperation,
  adapter: ClosedUnmergedCloseoutEffectAdapter,
  terminal: ClosedUnmergedTerminal,
  expectedPublicationDigest?: `sha256:${string}`
): Promise<ClosedUnmergedCloseoutExecutionResult> {
  if (!terminalMatches(operation, terminal)
    || (expectedPublicationDigest !== undefined
      && terminal.receipt.publicationDigest !== expectedPublicationDigest)) {
    return blocked(operation, 'terminal-readback', [
      expectedPublicationDigest === undefined
        ? 'terminal receipt conflicts with the exact operation'
        : 'terminal receipt differs from the exact published receipt'
    ]);
  }
  const inventoryObservation = await providerCall(operation, 'terminal-live-readback', () => (
    adapter.observeInventory()
  ));
  if (isExecutionResult(inventoryObservation)) return inventoryObservation;
  if (inventoryObservation.status !== 'observed') {
    return preserve(operation, 'terminal-live-readback', inventoryObservation.detail);
  }
  const convergence = terminalConvergenceBlockers({
    operation,
    inventory: inventoryObservation.value
  });
  if (convergence.blockers.length > 0) {
    return blocked(operation, 'terminal-live-readback', convergence.blockers);
  }
  return convergence.residue.length > 0
    ? preserve(operation, 'terminal-live-readback', ...convergence.residue)
    : issueCompletedSettlement(operation, terminal.receipt);
}

export async function executeClosedUnmergedCloseoutOperation(input: {
  operation: ClosedUnmergedCloseoutOperation;
  provider: ClosedUnmergedCloseoutEffectProvider;
}): Promise<ClosedUnmergedCloseoutExecutionResult> {
  const operation = input.operation;
  if (!issuedOperations.has(operation)) {
    return blocked(operation, 'admission', ['operation was not issued by the branch lifecycle owner']);
  }
  try {
    assertPreparedBranchCloseoutEnvelope(operation.prepared);
    assertIssuedEvidence(operation.evidence);
    if (operation.operationId !== branchLifecycleDigest(
      closedUnmergedOperationIdentity(operation.prepared, operation.evidence)
    )) {
      throw new Error('operation identity changed after issuance');
    }
  } catch (error) {
    return blocked(operation, 'admission', [
      error instanceof Error ? error.message : String(error)
    ]);
  }
  const adapter = providerAdapters.get(input.provider);
  if (!adapter || adapter.repository !== operation.evidence.repository) {
    return blocked(operation, 'admission', ['opaque Effect provider is missing or repository-mismatched']);
  }

  const terminalObservation = await providerCall(operation, 'terminal-readback', () => (
    adapter.observeTerminalReceipt(operation.operationId)
  ));
  if (isExecutionResult(terminalObservation)) return terminalObservation;
  if (terminalObservation.status !== 'observed') {
    return preserve(operation, 'terminal-readback', terminalObservation.detail);
  }
  if (terminalObservation.value !== null) {
    return settleClosedUnmergedTerminal(operation, adapter, terminalObservation.value);
  }

  const expectedEffectStart = createEffectStartReceipt(operation, adapter.providerIdentity);
  const startObservation = await providerCall(operation, 'effect-start-readback', () => (
    adapter.observeEffectStart(operation.operationId)
  ));
  if (isExecutionResult(startObservation)) return startObservation;
  if (startObservation.status !== 'observed') {
    return preserve(operation, 'effect-start-readback', startObservation.detail);
  }
  let effectStart = startObservation.value;

  const attempts: BranchCloseoutAttempt[] = [...operation.prepared.attempts];
  if (effectStart === null) {
    const beforeStart = await observeExactInventory(operation, adapter,
      'effect-start-precondition', ['closed']);
    if (isExecutionResult(beforeStart)) return beforeStart;
    const startAuthorization = currentAuthorization(operation, beforeStart);
    if (startAuthorization.blockers.length > 0) {
      return blocked(operation, 'effect-start-precondition', startAuthorization.blockers);
    }
    const startCapabilityBlocker = localRefDeleteCapabilityBlocker(adapter, startAuthorization);
    if (startCapabilityBlocker !== null) return blocked(operation, 'effect-start-precondition', [startCapabilityBlocker]);
    const publication = await providerCall(operation, 'effect-start-publication', () => (
      adapter.publishEffectStart(expectedEffectStart)
    ));
    if (isExecutionResult(publication)) return publication;
    if (publication.status !== 'applied' && publication.status !== 'already-applied') {
      return preserve(operation, 'effect-start-publication', publication.detail);
    }
    const readback = await providerCall(operation, 'effect-start-readback', () => (
      adapter.observeEffectStart(operation.operationId)
    ));
    if (isExecutionResult(readback)) return readback;
    if (readback.status !== 'observed' || readback.value === null) {
      return preserve(operation, 'effect-start-readback',
        readback.status === 'observed' ? 'effect-start is absent after publication' : readback.detail);
    }
    effectStart = readback.value;
  }
  try {
    assertEffectStartReceipt(effectStart, expectedEffectStart);
  } catch (error) {
    return blocked(operation, 'effect-start-readback', [
      error instanceof Error ? error.message : String(error)
    ]);
  }

  let inventory = await observeExactInventory(operation, adapter,
    'remote-delete-precondition', ['closed']);
  if (isExecutionResult(inventory)) return inventory;
  let authorization = currentAuthorization(operation, inventory);
  if (authorization.blockers.length > 0) {
    return blocked(operation, 'remote-delete-authorization', authorization.blockers);
  }
  let capabilityBlocker = localRefDeleteCapabilityBlocker(adapter, authorization);
  if (capabilityBlocker !== null) return blocked(operation, 'remote-delete-authorization', [capabilityBlocker]);

  if (authorization.remoteAction === 'delete-cas') {
    const deletion = await providerCall(operation, 'remote-delete', () => (
      adapter.deleteRemoteRefCas({ operationId: operation.operationId,
        repository: operation.evidence.repository,
        remote: operation.prepared.preparation.repository.remote,
        branch: operation.evidence.branch,
        expectedOldSha: operation.evidence.headSha })
    ));
    if (isExecutionResult(deletion)) return deletion;
    if (deletion.status === 'ambiguous') {
      await providerCall(operation, 'remote-delete-readback', () => adapter.observeInventory());
      return preserve(operation, 'remote-delete', deletion.detail);
    }
    if (deletion.status !== 'applied' && deletion.status !== 'already-applied') {
      return preserve(operation, 'remote-delete', deletion.detail);
    }
    attempts.push({ operation: 'remote-delete', status: 'success', detail: deletion.detail });
  } else if (authorization.remoteAction === 'already-absent') {
    attempts.push({ operation: 'remote-delete', status: 'skipped', detail: 'exact remote branch is already absent' });
  } else {
    return blocked(operation, 'remote-delete-authorization', ['remote delete is not authorized']);
  }

  inventory = await observeExactInventory(operation, adapter, 'prune-precondition', ['closed']);
  if (isExecutionResult(inventory)) return inventory;
  authorization = currentAuthorization(operation, inventory);
  if (authorization.blockers.length > 0) {
    return blocked(operation, 'prune-authorization', authorization.blockers);
  }
  capabilityBlocker = localRefDeleteCapabilityBlocker(adapter, authorization);
  if (capabilityBlocker !== null) return blocked(operation, 'prune-authorization', [capabilityBlocker]);
  if (inventory.remoteBranches.some(({ branch }) => branch === operation.evidence.branch)) {
    return preserve(operation, 'remote-delete-readback', 'remote branch remains after exact CAS deletion');
  }
  const prune = await providerCall(operation, 'prune', () => adapter.pruneRemote({
    operationId: operation.operationId,
    repository: operation.evidence.repository,
    remote: operation.prepared.preparation.repository.remote,
    branch: operation.evidence.branch,
    expectedOldSha: operation.evidence.headSha
  }));
  if (isExecutionResult(prune)) return prune;
  if (prune.status !== 'applied' && prune.status !== 'already-applied') {
    return preserve(operation, 'prune', prune.detail);
  }
  attempts.push({ operation: 'prune', status: 'success', detail: prune.detail });

  inventory = await observeExactInventory(operation, adapter, 'local-delete-precondition', ['closed']);
  if (isExecutionResult(inventory)) return inventory;
  authorization = currentAuthorization(operation, inventory);
  if (authorization.blockers.length > 0) {
    return blocked(operation, 'local-delete-authorization', authorization.blockers);
  }
  capabilityBlocker = localRefDeleteCapabilityBlocker(adapter, authorization);
  if (capabilityBlocker !== null) return blocked(operation, 'local-delete-authorization', [capabilityBlocker]);
  if (authorization.localAction === 'delete-exact') {
    const deletion = await providerCall(operation, 'local-delete', () => adapter.deleteLocalRefCas({
      operationId: operation.operationId,
      repository: operation.evidence.repository,
      branch: operation.evidence.branch,
      expectedOldSha: operation.prepared.preparation.expectedLocalSha!
    }));
    if (isExecutionResult(deletion)) return deletion;
    if (deletion.status === 'ambiguous') {
      await providerCall(operation, 'local-delete-readback', () => adapter.observeInventory());
      return preserve(operation, 'local-delete', deletion.detail);
    }
    if (deletion.status !== 'applied' && deletion.status !== 'already-applied') {
      return preserve(operation, 'local-delete', deletion.detail);
    }
    attempts.push({ operation: 'local-delete', status: 'success', detail: deletion.detail });
  } else if (authorization.localAction === 'already-absent') {
    attempts.push({ operation: 'local-delete', status: 'skipped', detail: 'exact local branch is already absent' });
  } else if (authorization.localAction === 'protect-local') {
    attempts.push({ operation: 'local-delete', status: 'skipped',
      detail: 'divergent or worktree-bound local branch remains protected for independent closeout' });
  } else {
    return blocked(operation, 'local-delete-authorization', [
      ...authorization.blockers,
      ...authorization.protections,
      'local delete is not authorized'
    ]);
  }

  const finalInventory = await observeExactInventory(operation, adapter, 'readback', ['closed']);
  if (isExecutionResult(finalInventory)) return finalInventory;
  if (finalInventory.remoteBranches.some(({ branch }) => branch === operation.evidence.branch)) {
    return preserve(operation, 'readback', 'remote branch remains after exact CAS deletion');
  }
  if (authorization.localAction !== 'protect-local'
      && finalInventory.localBranches.some(({ branch }) => branch === operation.evidence.branch)) {
    return preserve(operation, 'readback', 'local branch remains after exact CAS deletion');
  }
  const terminalAuthorization = currentAuthorization(operation, finalInventory);
  if (terminalAuthorization.blockers.length > 0) {
    return blocked(operation, 'terminal-publication-authorization', terminalAuthorization.blockers);
  }
  attempts.push({ operation: 'readback', status: 'success',
    detail: authorization.localAction === 'protect-local'
      ? 'exact PR closed and remote branch absent; divergent local branch remains protected'
      : 'exact PR closed and remote/local branches absent' });
  const receipt = createBranchCloseoutReceipt({ generatedAt: new Date().toISOString(),
    preparation: operation.prepared.preparation, request: closeoutRequest(operation.evidence),
    authorization, attempts, before: operation.prepared.before, after: finalInventory });
  if (receipt.status !== 'completed' && receipt.status !== 'protected-pending') {
    return preserve(operation, 'terminal-compilation', ...receipt.residue);
  }
  const published = createPublishedBranchCloseoutReceipt(receipt);
  const terminal = Object.freeze({ operationId: operation.operationId,
    evidenceDigest: operation.evidence.evidenceDigest,
    prepared: operation.prepared,
    receipt: published });
  const terminalPublication = await providerCall(operation, 'terminal-publication', () => (
    adapter.publishTerminalReceipt(terminal)
  ));
  if (isExecutionResult(terminalPublication)) return terminalPublication;
  if (terminalPublication.status !== 'applied' && terminalPublication.status !== 'already-applied') {
    return preserve(operation, 'terminal-publication', terminalPublication.detail);
  }
  const terminalReadback = await providerCall(operation, 'terminal-readback', () => (
    adapter.observeTerminalReceipt(operation.operationId)
  ));
  if (isExecutionResult(terminalReadback)) return terminalReadback;
  if (terminalReadback.status !== 'observed' || terminalReadback.value === null) {
    return preserve(operation, 'terminal-readback',
      terminalReadback.status === 'observed' ? 'terminal receipt is absent after publication' : terminalReadback.detail);
  }
  return settleClosedUnmergedTerminal(
    operation,
    adapter,
    terminalReadback.value,
    published.publicationDigest
  );
}
