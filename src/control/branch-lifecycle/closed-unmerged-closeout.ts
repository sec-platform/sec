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

export const CLOSED_UNMERGED_CLOSEOUT_EVIDENCE_SCHEMA =
  'sec-closed-unmerged-closeout-evidence-v1' as const;
export const CLOSED_UNMERGED_CLOSEOUT_OPERATION_SCHEMA =
  'sec-closed-unmerged-closeout-operation-v1' as const;
export const CLOSED_UNMERGED_CLOSEOUT_EFFECT_START_SCHEMA =
  'sec-closed-unmerged-closeout-effect-start-v1' as const;

export type ClosedUnmergedCloseoutDisposition =
  | 'evidence-close'
  | 'closed-superseded';

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

export interface EvidenceCloseDispositionEvidence
  extends ClosedUnmergedCloseoutEvidenceBase {
  readonly disposition: 'evidence-close';
}

export interface ClosedSupersededDispositionEvidence
  extends ClosedUnmergedCloseoutEvidenceBase {
  readonly disposition: 'closed-superseded';
  readonly consumerClosureDigest: `sha256:${string}`;
}

export type ClosedUnmergedCloseoutEvidence =
  | EvidenceCloseDispositionEvidence
  | ClosedSupersededDispositionEvidence;

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

export type ClosedUnmergedProviderObservation<T> =
  | Readonly<{ status: 'observed'; value: T }>
  | Readonly<{ status: 'unavailable' | 'ambiguous'; detail: string }>;

export type ClosedUnmergedProviderMutation = Readonly<{
  status: 'applied' | 'already-applied' | 'unavailable' | 'ambiguous' | 'rejected';
  detail: string;
}>;

export interface ClosedUnmergedCloseoutEffectAdapter {
  readonly providerIdentity: string;
  readonly repository: string;
  observeInventory(): Promise<ClosedUnmergedProviderObservation<BranchLifecycleInventory>>;
  observeEffectStart(
    operationId: `sha256:${string}`
  ): Promise<ClosedUnmergedProviderObservation<ClosedUnmergedCloseoutEffectStartReceipt | null>>;
  publishEffectStart(
    receipt: ClosedUnmergedCloseoutEffectStartReceipt
  ): Promise<ClosedUnmergedProviderMutation>;
  closePullRequest(input: Readonly<{
    operationId: `sha256:${string}`;
    repository: string;
    pullRequestNumber: number;
    expectedHeadBranch: string;
    expectedHeadSha: string;
    expectedBaseBranch: string;
    expectedBaseSha: string;
  }>): Promise<ClosedUnmergedProviderMutation>;
  deleteRemoteRefCas(input: Readonly<{
    operationId: `sha256:${string}`;
    repository: string;
    remote: string;
    branch: string;
    expectedOldSha: string;
  }>): Promise<ClosedUnmergedProviderMutation>;
  pruneRemote(input: Readonly<{
    operationId: `sha256:${string}`;
    repository: string;
    remote: string;
  }>): Promise<ClosedUnmergedProviderMutation>;
  observeTerminalReceipt(
    operationId: `sha256:${string}`
  ): Promise<ClosedUnmergedProviderObservation<BranchPublishedCloseoutReceipt | null>>;
  publishTerminalReceipt(
    operationId: `sha256:${string}`,
    receipt: BranchPublishedCloseoutReceipt
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
const issuedOperations = new WeakSet<object>();
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
> & { readonly consumerClosureDigest?: `sha256:${string}` }): Record<string, unknown> {
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

export function createEvidenceCloseDispositionEvidence(input: Omit<
  EvidenceCloseDispositionEvidence,
  'schema' | 'disposition' | 'evidenceDigest'
>): EvidenceCloseDispositionEvidence {
  validateEvidenceInput(input);
  if (input.headTreeSha !== input.currentMainTreeSha) {
    throw new Error('Evidence-close requires exact branch/main tree parity.');
  }
  if (input.durableGoal.kind !== 'evidence') {
    throw new Error('Evidence-close must retain a canonical Evidence goal.');
  }
  const payload = evidencePayload({ ...input, disposition: 'evidence-close' });
  const evidence = Object.freeze({
    ...payload,
    evidenceDigest: branchLifecycleDigest(payload)
  }) as EvidenceCloseDispositionEvidence;
  issuedEvidence.add(evidence);
  return evidence;
}

export function createClosedSupersededDispositionEvidence(input: Omit<
  ClosedSupersededDispositionEvidence,
  'schema' | 'disposition' | 'evidenceDigest'
>): ClosedSupersededDispositionEvidence {
  validateEvidenceInput(input);
  if (input.headTreeSha === input.currentMainTreeSha) {
    throw new Error('Closed-superseded requires a branch tree distinct from current main.');
  }
  digest(input.consumerClosureDigest, 'Closed-superseded consumer closure');
  const payload = evidencePayload({ ...input, disposition: 'closed-superseded' });
  const evidence = Object.freeze({
    ...payload,
    evidenceDigest: branchLifecycleDigest(payload)
  }) as ClosedSupersededDispositionEvidence;
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

function projectedClosedInventory(
  inventory: BranchLifecycleInventory,
  evidence: ClosedUnmergedCloseoutEvidence
): BranchLifecycleInventory {
  return {
    ...inventory,
    pullRequests: inventory.pullRequests.map((pullRequest) => (
      pullRequest.number === evidence.pullRequestNumber
        ? { ...pullRequest, state: 'closed' as const }
        : pullRequest
    ))
  };
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
    allowedPrStates: ['open']
  });
  if (preparation.refState !== 'present'
    || preparation.pullRequestStateAtPreparation !== 'open'
    || preparation.pullRequestNumber !== evidence.pullRequestNumber
    || preparation.branch !== evidence.branch
    || preparation.expectedHeadSha !== evidence.headSha
    || preparation.expectedRemoteSha !== evidence.headSha) {
    blockers.push('preparation does not bind the exact open PR and remote head');
  }
  if (preparation.preparationDigest !== input.prepared.preparation.preparationDigest) {
    blockers.push('preparation digest changed');
  }
  const projected = projectedClosedInventory(input.prepared.before, evidence);
  const authorization = authorizeBranchCloseout({
    preparation,
    request: closeoutRequest(evidence),
    before: input.prepared.before,
    current: projected,
    expectedHeadTreeSha: evidence.headTreeSha
  });
  blockers.push(...authorization.blockers);
  if (authorization.localAction === 'delete-exact') {
    blockers.push('closed-unmerged operation does not mutate local refs');
  }
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
  value: BranchPublishedCloseoutReceipt
): boolean {
  try {
    const receipt = parsePublishedBranchCloseoutReceipt(value);
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
    if (!terminalMatches(operation, terminalObservation.value)) {
      return blocked(operation, 'terminal-readback', ['terminal receipt conflicts with the exact operation']);
    }
    return Object.freeze({ status: 'completed', operationId: operation.operationId,
      receipt: terminalObservation.value });
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

  const initialObservation = await providerCall(operation, 'initial-observation', () => (
    adapter.observeInventory()
  ));
  if (isExecutionResult(initialObservation)) return initialObservation;
  if (initialObservation.status !== 'observed') {
    return preserve(operation, 'initial-observation', initialObservation.detail);
  }
  const initialBlockers = exactCurrentBlockers({ prepared: operation.prepared,
    evidence: operation.evidence, inventory: initialObservation.value,
    allowedPrStates: effectStart === null ? ['open'] : ['open', 'closed'] });
  if (initialBlockers.length > 0) return blocked(operation, 'initial-observation', initialBlockers);

  const projectedAuthorization = authorizeBranchCloseout({
    preparation: operation.prepared.preparation,
    request: closeoutRequest(operation.evidence),
    before: operation.prepared.before,
    current: projectedClosedInventory(initialObservation.value, operation.evidence),
    expectedHeadTreeSha: operation.evidence.headTreeSha
  });
  if (projectedAuthorization.blockers.length > 0 || projectedAuthorization.localAction === 'delete-exact') {
    return blocked(operation, 'pre-effect-authorization', [
      ...projectedAuthorization.blockers,
      ...(projectedAuthorization.localAction === 'delete-exact'
        ? ['closed-unmerged operation does not mutate local refs']
        : [])
    ]);
  }

  const attempts: BranchCloseoutAttempt[] = [...operation.prepared.attempts];
  if (effectStart === null) {
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

  let inventory = initialObservation.value;
  const beforeClosePr = exactPullRequest(inventory, operation.evidence)!;
  if (beforeClosePr.state === 'open') {
    const close = await providerCall(operation, 'pull-request-close', () => (
      adapter.closePullRequest({ operationId: operation.operationId,
        repository: operation.evidence.repository,
        pullRequestNumber: operation.evidence.pullRequestNumber,
        expectedHeadBranch: operation.evidence.branch,
        expectedHeadSha: operation.evidence.headSha,
        expectedBaseBranch: operation.evidence.baseBranch,
        expectedBaseSha: operation.evidence.baseSha })
    ));
    if (isExecutionResult(close)) return close;
    if (close.status === 'ambiguous') {
      await providerCall(operation, 'pull-request-close-readback', () => adapter.observeInventory());
      return preserve(operation, 'pull-request-close', close.detail);
    }
    if (close.status !== 'applied' && close.status !== 'already-applied') {
      return preserve(operation, 'pull-request-close', close.detail);
    }
    const afterClose = await providerCall(operation, 'pull-request-close-readback', () => (
      adapter.observeInventory()
    ));
    if (isExecutionResult(afterClose)) return afterClose;
    if (afterClose.status !== 'observed') {
      return preserve(operation, 'pull-request-close-readback', afterClose.detail);
    }
    inventory = afterClose.value;
  }

  const closedBlockers = exactCurrentBlockers({ prepared: operation.prepared,
    evidence: operation.evidence, inventory, allowedPrStates: ['closed'] });
  if (closedBlockers.length > 0) return blocked(operation, 'pull-request-close-readback', closedBlockers);
  const authorization = authorizeBranchCloseout({ preparation: operation.prepared.preparation,
    request: closeoutRequest(operation.evidence), before: operation.prepared.before,
    current: inventory, expectedHeadTreeSha: operation.evidence.headTreeSha });
  if (authorization.blockers.length > 0 || authorization.localAction === 'delete-exact') {
    return blocked(operation, 'remote-delete-authorization', [
      ...authorization.blockers,
      ...(authorization.localAction === 'delete-exact'
        ? ['closed-unmerged operation does not mutate local refs']
        : [])
    ]);
  }

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

  const prune = await providerCall(operation, 'prune', () => adapter.pruneRemote({
    operationId: operation.operationId,
    repository: operation.evidence.repository,
    remote: operation.prepared.preparation.repository.remote
  }));
  if (isExecutionResult(prune)) return prune;
  if (prune.status !== 'applied' && prune.status !== 'already-applied') {
    return preserve(operation, 'prune', prune.detail);
  }
  attempts.push({ operation: 'prune', status: 'success', detail: prune.detail });

  const finalObservation = await providerCall(operation, 'readback', () => adapter.observeInventory());
  if (isExecutionResult(finalObservation)) return finalObservation;
  if (finalObservation.status !== 'observed') return preserve(operation, 'readback', finalObservation.detail);
  const finalBlockers = exactCurrentBlockers({ prepared: operation.prepared,
    evidence: operation.evidence, inventory: finalObservation.value, allowedPrStates: ['closed'] });
  if (finalBlockers.length > 0) return blocked(operation, 'readback', finalBlockers);
  if (finalObservation.value.remoteBranches.some(({ branch }) => branch === operation.evidence.branch)) {
    return preserve(operation, 'readback', 'remote branch remains after exact CAS deletion');
  }
  attempts.push({ operation: 'local-delete', status: 'skipped', detail: 'local ref effects are outside this operation' });
  attempts.push({ operation: 'readback', status: 'success', detail: 'exact PR closed and remote branch absent' });
  const receipt = createBranchCloseoutReceipt({ generatedAt: new Date().toISOString(),
    preparation: operation.prepared.preparation, request: closeoutRequest(operation.evidence),
    authorization, attempts, before: operation.prepared.before, after: finalObservation.value });
  if (receipt.status !== 'completed' && receipt.status !== 'protected-pending') {
    return preserve(operation, 'terminal-compilation', ...receipt.residue);
  }
  const published = createPublishedBranchCloseoutReceipt(receipt);
  const terminalPublication = await providerCall(operation, 'terminal-publication', () => (
    adapter.publishTerminalReceipt(operation.operationId, published)
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
  if (!terminalMatches(operation, terminalReadback.value)
    || terminalReadback.value.publicationDigest !== published.publicationDigest) {
    return blocked(operation, 'terminal-readback', ['terminal receipt differs from the exact published receipt']);
  }
  return Object.freeze({ status: 'completed', operationId: operation.operationId,
    receipt: terminalReadback.value });
}
