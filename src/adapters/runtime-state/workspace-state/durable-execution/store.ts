import path from 'node:path';

import {
  assertDomainReadbackReceipt,
  assertOwnerTerminalJoinReceipt,
  assertProviderSettlementReceipt,
  assertRecoveredRetryAdmission,
  assertRecoveredRetryAdmissionForSuccessor,
  assertSemanticOperationProjection,
  consumeRecoveredRetryAdmission,
  type BoundSemanticOperation,
  type DomainReadbackReceipt,
  type OwnerTerminalJoinReceipt,
  type ProviderSettlementReceipt,
  type RecoveredPredecessorAttemptReference,
  type RecoveredRetryAdmission
} from '../../../../execution/operation/semantic.ts';
import {
  RuntimeStateJournalReadError,
  type RuntimeStateJournalFileSystem
} from '../journal-filesystem.ts';
import {
  DURABLE_EXECUTION_MAXIMUM_RECORD_BYTES,
  DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
  encodeDurableExecutionRecord,
  observeDurableExecutionJournal,
  parseDurableExecutionJournal,
  sealDurableExecutionRecordForInternalWriter,
  type DurableAttemptResolutionKind,
  type DurableExecutionAttemptStartRecord,
  type DurableExecutionDigest,
  type DurableExecutionJournalObservation,
  type DurableExecutionRecord
} from './contract.ts';

type DurableExecutionStoreFailureKind =
  | 'absent'
  | 'conflict'
  | 'identity-mismatch'
  | 'deadline-exhausted'
  | 'resource-exhausted';

class DurableExecutionStoreError extends Error {
  readonly kind: DurableExecutionStoreFailureKind;

  constructor(kind: DurableExecutionStoreFailureKind, message: string) {
    super(`Durable local execution store ${message}`);
    this.name = 'DurableExecutionStoreError';
    this.kind = kind;
  }
}

export interface DurableExecutionJournalIdentity {
  readonly operationKeyDigest: DurableExecutionDigest;
}

export interface DurableExecutionStoreLimits {
  readonly deadlineAtMonotonicMs: number;
  readonly maximumRecords: number;
  readonly maximumStateBytes: number;
  readonly maximumAttempts: number;
  readonly maximumProviderSettlementsPerAttempt: number;
}

const LIMIT_CEILINGS = Object.freeze({
  maximumRecords: 4_096,
  maximumStateBytes: 8 * 1024 * 1024,
  maximumAttempts: 128,
  maximumProviderSettlementsPerAttempt: 32
});

/**
 * Projects the stable journal address from one live owner-issued operation.
 * The parsed journal remains observation-only; this projection merely prevents
 * domain callers from copying or recomputing OperationKey/run lineage fields.
 */
export function durableExecutionJournalIdentity(
  operation: BoundSemanticOperation
): DurableExecutionJournalIdentity {
  assertSemanticOperationProjection(operation);
  return Object.freeze({
    operationKeyDigest: operation.plan.identity.identityDigest
  });
}

/**
 * Projects only the predecessor coordinates needed by the domain recovery
 * authority. Runtime State neither reconstructs an old live operation nor
 * decides the domain outcome represented by a later readback.
 */
export function durableExecutionPredecessorAttemptReference(
  observation: DurableExecutionJournalObservation
): RecoveredPredecessorAttemptReference {
  const attempt = observation.activeAttempt;
  if (attempt === null) {
    throw new DurableExecutionStoreError(
      'conflict', 'predecessor projection requires one unresolved active attempt.'
    );
  }
  return Object.freeze({
    operationIdentityDigest: observation.intent.operationKeyDigest,
    executionPlanDigest: attempt.start.executionPlanReferenceDigest,
    bindingSetIdentityDigest: attempt.start.providerBindingSetReferenceDigest,
    boundAttemptDigest: attempt.start.boundAttemptDigest,
    attemptNonceDigest: attempt.start.attemptNonceDigest,
    authorityGrantDigest: attempt.start.authorityGrantReferenceDigest,
    resumeEpochDigest: attempt.start.resumeEpochDigest,
    deadlineAtUnixMs: attempt.start.deadlineAtUnixMs
  });
}

export function createDurableExecutionStore(input: Readonly<{
  fileSystem: RuntimeStateJournalFileSystem;
  journalRoot: string;
  limits: DurableExecutionStoreLimits;
}>): DurableExecutionStore {
  const writer = createStoreCore(input);
  return Object.freeze({ read: writer.read });
}

export function createDurableExecutionWriter(input: Readonly<{
  fileSystem: RuntimeStateJournalFileSystem;
  journalRoot: string;
  limits: DurableExecutionStoreLimits;
}>): DurableExecutionWriter {
  const core = createStoreCore(input);
  return Object.freeze({
    read: core.read,
    createIntent(operation: BoundSemanticOperation) {
      return core.createIntent({
        ...durableExecutionJournalIdentity(operation),
        intentReferenceDigest: operation.plan.identity.intentDigest,
        executionPlanReferenceDigest: operation.plan.execution.executionPlanDigest,
        deadlineAtUnixMs: operation.plan.attempt.deadlineAtUnixMs
      });
    },
    appendInitialAttemptStart(
      operation: BoundSemanticOperation,
      workerIdentityDigest: DurableExecutionDigest
    ) {
      return core.appendAttemptStart(
        initialAttemptStartInput(operation, workerIdentityDigest)
      );
    },
    appendRecoveredRetryAttemptStart(
      recoveryOperation: BoundSemanticOperation,
      successorOperation: BoundSemanticOperation,
      workerIdentityDigest: DurableExecutionDigest,
      retryAdmission: RecoveredRetryAdmission,
      currentPhysicalEpochDigest: DurableExecutionDigest
    ) {
      const start = recoveredRetryAttemptStartInput(
        successorOperation,
        workerIdentityDigest,
        retryAdmission,
        currentPhysicalEpochDigest
      );
      const observation = core.appendRecoveredRetryAttemptStart(
        retryAdmissionResolutionInput(recoveryOperation, retryAdmission),
        start
      );
      consumeRecoveredRetryAdmission(
        retryAdmission,
        successorOperation,
        currentPhysicalEpochDigest
      );
      return observation;
    },
    appendProviderSettlement(
      operation: BoundSemanticOperation,
      receipt: ProviderSettlementReceipt
    ) {
      return core.appendProviderSettlementReference(
        providerSettlementReferenceInput(operation, receipt)
      );
    },
    appendLostHandle(
      operation: BoundSemanticOperation,
      receipt: ProviderSettlementReceipt
    ) {
      return core.appendLostHandleReference(lostHandleReferenceInput(operation, receipt));
    },
    appendDomainReadback(
      operation: BoundSemanticOperation,
      receipt: DomainReadbackReceipt
    ) {
      if (receipt.recoveryMode === 'recovered') {
        const current = core.read(durableExecutionJournalIdentity(operation));
        assertRecoveredPredecessorCoordinates(current, {
          operationIdentityDigest: receipt.operationIdentityDigest,
          executionPlanDigest: receipt.predecessorExecutionPlanDigest,
          bindingSetIdentityDigest: receipt.predecessorBindingSetIdentityDigest,
          boundAttemptDigest: receipt.predecessorBoundAttemptDigest,
          attemptNonceDigest: receipt.predecessorAttemptNonceDigest,
          authorityGrantDigest: receipt.predecessorAuthorityGrantDigest,
          resumeEpochDigest: receipt.predecessorResumeEpochDigest,
          deadlineAtUnixMs: receipt.predecessorDeadlineAtUnixMs
        });
      }
      return core.appendDomainReadbackReference(domainReadbackReferenceInput(operation, receipt));
    },
    appendOwnerTerminalResolution(
      operation: BoundSemanticOperation,
      receipt: OwnerTerminalJoinReceipt
    ) {
      assertOwnerTerminalJoinReceipt(receipt);
      const current = core.read(durableExecutionJournalIdentity(operation));
      if (current?.activeAttempt === null || current?.activeAttempt === undefined) {
        throw new DurableExecutionStoreError(
          'conflict', 'owner terminal resolution requires one active predecessor attempt.'
        );
      }
      return core.appendAttemptResolution(ownerTerminalResolutionInput(
        operation,
        receipt,
        current.activeAttempt.start.attemptNonceDigest
      ));
    }
  });
}

function assertRecoveredPredecessorCoordinates(
  observation: DurableExecutionJournalObservation | null,
  expected: RecoveredPredecessorAttemptReference,
  comparePredecessorAuthority = true
): void {
  if (observation === null) {
    throw new DurableExecutionStoreError('absent', 'recovered predecessor journal is absent.');
  }
  const actual = durableExecutionPredecessorAttemptReference(observation);
  const sameAuthority = !comparePredecessorAuthority
    || (actual.authorityGrantDigest === expected.authorityGrantDigest
      && actual.resumeEpochDigest === expected.resumeEpochDigest);
  if (actual.operationIdentityDigest !== expected.operationIdentityDigest
      || actual.executionPlanDigest !== expected.executionPlanDigest
      || actual.bindingSetIdentityDigest !== expected.bindingSetIdentityDigest
      || actual.boundAttemptDigest !== expected.boundAttemptDigest
      || actual.attemptNonceDigest !== expected.attemptNonceDigest
      || actual.deadlineAtUnixMs !== expected.deadlineAtUnixMs
      || !sameAuthority) {
    throw new DurableExecutionStoreError(
      'identity-mismatch', 'recovery authority does not bind the exact durable predecessor attempt.'
    );
  }
}

type CreateIntentInput = DurableExecutionJournalIdentity & Readonly<{
  intentReferenceDigest: DurableExecutionDigest;
  executionPlanReferenceDigest: DurableExecutionDigest;
  deadlineAtUnixMs: number;
}>;
type AppendAttemptStartInput = DurableExecutionJournalIdentity & Readonly<{
  runIdDigest: DurableExecutionDigest | null;
  resumeEpochDigest: DurableExecutionDigest | null;
  attemptNonceDigest: DurableExecutionDigest;
  boundAttemptDigest: DurableExecutionDigest;
  workerIdentityDigest: DurableExecutionDigest;
  authorityGrantReferenceDigest: DurableExecutionDigest;
  providerBindingSetReferenceDigest: DurableExecutionDigest;
  executionPlanReferenceDigest: DurableExecutionDigest;
  deadlineAtUnixMs: number;
  retryAdmissionReferenceDigest: DurableExecutionDigest | null;
}>;

/**
 * Binds one physical worker to the exact live attempt. No durable record or
 * structural clone can be used as input because the semantic-operation issuer
 * check runs before any journal mutation.
 */
function projectAttemptStartInput(
  operation: BoundSemanticOperation,
  workerIdentityDigest: DurableExecutionDigest,
  retryAdmissionReferenceDigest: DurableExecutionDigest | null
): AppendAttemptStartInput {
  const identity = durableExecutionJournalIdentity(operation);
  if (operation.plan.attempt.deadlineAtUnixMs <= Date.now()) {
    throw new DurableExecutionStoreError(
      'deadline-exhausted',
      'attempt deadline is exhausted before durable single-flight claim.'
    );
  }
  const runIdDigest = operation.plan.attempt.runIdDigest;
  const resumeEpochDigest = operation.plan.attempt.resumeEpochDigest;
  return Object.freeze({
    ...identity,
    runIdDigest,
    resumeEpochDigest,
    attemptNonceDigest: operation.plan.attempt.attemptNonceDigest,
    boundAttemptDigest: operation.boundAttemptDigest,
    workerIdentityDigest: canonicalDigest(workerIdentityDigest, 'workerIdentityDigest'),
    authorityGrantReferenceDigest: operation.plan.attempt.authorityGrantDigest,
    providerBindingSetReferenceDigest: operation.bindingSetIdentityDigest,
    executionPlanReferenceDigest: operation.plan.execution.executionPlanDigest,
    deadlineAtUnixMs: operation.plan.attempt.deadlineAtUnixMs,
    retryAdmissionReferenceDigest
  });
}

function initialAttemptStartInput(
  operation: BoundSemanticOperation,
  workerIdentityDigest: DurableExecutionDigest
): AppendAttemptStartInput {
  return projectAttemptStartInput(operation, workerIdentityDigest, null);
}

function recoveredRetryAttemptStartInput(
  operation: BoundSemanticOperation,
  workerIdentityDigest: DurableExecutionDigest,
  retryAdmission: RecoveredRetryAdmission,
  currentPhysicalEpochDigest: DurableExecutionDigest
): AppendAttemptStartInput {
  assertRecoveredRetryAdmission(retryAdmission);
  assertRecoveredRetryAdmissionForSuccessor(
    retryAdmission,
    operation,
    currentPhysicalEpochDigest
  );
  return projectAttemptStartInput(
    operation,
    workerIdentityDigest,
    retryAdmission.retryAdmissionDigest
  );
}
type AppendProviderSettlementInput = DurableExecutionJournalIdentity & Readonly<{
  attemptNonceDigest: DurableExecutionDigest;
  requirementId: string;
  providerBindingDigest: DurableExecutionDigest;
  providerReceiptDigest: DurableExecutionDigest;
}>;
type AppendDomainReadbackInput = DurableExecutionJournalIdentity & Readonly<{
  attemptNonceDigest: DurableExecutionDigest;
  readbackContractDigest: DurableExecutionDigest;
  domainReadbackReceiptDigest: DurableExecutionDigest;
}>;
type AppendLostHandleInput = DurableExecutionJournalIdentity & Readonly<{
  attemptNonceDigest: DurableExecutionDigest;
  lostHandleReferenceDigest: DurableExecutionDigest;
}>;
type AppendAttemptResolutionInput = DurableExecutionJournalIdentity & Readonly<{
  attemptNonceDigest: DurableExecutionDigest;
  resolutionKind: DurableAttemptResolutionKind;
  resolutionReferenceDigest: DurableExecutionDigest;
  domainReadbackReceiptDigest: DurableExecutionDigest;
}>;

function ownerTerminalResolutionInput(
  operation: BoundSemanticOperation,
  receipt: OwnerTerminalJoinReceipt,
  activeAttemptNonceDigest: DurableExecutionDigest
): AppendAttemptResolutionInput {
  const identity = durableExecutionJournalIdentity(operation);
  assertOwnerTerminalJoinReceipt(receipt);
  if (receipt.operationIdentityDigest !== identity.operationKeyDigest
      || receipt.executionPlanDigest !== operation.plan.execution.executionPlanDigest
      || receipt.bindingSetIdentityDigest !== operation.bindingSetIdentityDigest
      || receipt.boundAttemptDigest !== operation.boundAttemptDigest) {
    throw new DurableExecutionStoreError(
      'identity-mismatch',
      'owner terminal receipt does not bind the exact operation attempt.'
    );
  }
  return Object.freeze({
    ...identity,
    attemptNonceDigest: activeAttemptNonceDigest,
    resolutionKind: 'owner-terminal-reference',
    resolutionReferenceDigest: receipt.joinReceiptDigest,
    domainReadbackReceiptDigest: receipt.readbackReceiptDigest
  });
}

function providerSettlementReferenceInput(
  operation: BoundSemanticOperation,
  receipt: ProviderSettlementReceipt
): AppendProviderSettlementInput {
  const identity = durableExecutionJournalIdentity(operation);
  assertProviderSettlementReceipt(receipt);
  if (receipt.operationIdentityDigest !== identity.operationKeyDigest
      || receipt.executionPlanDigest !== operation.plan.execution.executionPlanDigest
      || receipt.boundAttemptDigest !== operation.boundAttemptDigest) {
    throw new DurableExecutionStoreError(
      'identity-mismatch',
      'provider settlement receipt does not bind the exact operation attempt.'
    );
  }
  return Object.freeze({
    ...identity,
    attemptNonceDigest: operation.plan.attempt.attemptNonceDigest,
    requirementId: receipt.requirementId,
    providerBindingDigest: receipt.bindingDigest,
    providerReceiptDigest: receipt.providerReceiptDigest
  });
}

function domainReadbackReferenceInput(
  operation: BoundSemanticOperation,
  receipt: DomainReadbackReceipt
): AppendDomainReadbackInput {
  const identity = durableExecutionJournalIdentity(operation);
  assertDomainReadbackReceipt(receipt);
  if (receipt.operationIdentityDigest !== identity.operationKeyDigest
      || receipt.executionPlanDigest !== operation.plan.execution.executionPlanDigest
      || receipt.bindingSetIdentityDigest !== operation.bindingSetIdentityDigest
      || receipt.boundAttemptDigest !== operation.boundAttemptDigest) {
    throw new DurableExecutionStoreError(
      'identity-mismatch',
      'domain readback receipt does not bind the exact operation attempt.'
    );
  }
  return Object.freeze({
    ...identity,
    attemptNonceDigest: receipt.recoveryMode === 'recovered'
      ? receipt.predecessorAttemptNonceDigest
      : operation.plan.attempt.attemptNonceDigest,
    readbackContractDigest: receipt.readbackContractDigest,
    domainReadbackReceiptDigest: receipt.readbackReceiptDigest
  });
}

function lostHandleReferenceInput(
  operation: BoundSemanticOperation,
  receipt: ProviderSettlementReceipt
): AppendLostHandleInput {
  const settlement = providerSettlementReferenceInput(operation, receipt);
  if (receipt.physicalDisposition !== 'unknown') {
    throw new DurableExecutionStoreError(
      'identity-mismatch',
      'lost handle requires an exact provider-issued unknown physical settlement.'
    );
  }
  return Object.freeze({
    operationKeyDigest: settlement.operationKeyDigest,
    attemptNonceDigest: settlement.attemptNonceDigest,
    lostHandleReferenceDigest: settlement.providerReceiptDigest
  });
}

function retryAdmissionResolutionInput(
  operation: BoundSemanticOperation,
  admission: RecoveredRetryAdmission
): AppendAttemptResolutionInput {
  const identity = durableExecutionJournalIdentity(operation);
  assertRecoveredRetryAdmission(admission);
  if (admission.operationIdentityDigest !== identity.operationKeyDigest
      || admission.previousExecutionPlanDigest !== operation.plan.execution.executionPlanDigest
      || admission.previousBindingSetIdentityDigest !== operation.bindingSetIdentityDigest
      || admission.recoveryBoundAttemptDigest !== operation.boundAttemptDigest
      || admission.recoveryAuthorityGrantDigest !== operation.plan.attempt.authorityGrantDigest
      || admission.recoveryResumeEpochDigest !== operation.plan.attempt.resumeEpochDigest) {
    throw new DurableExecutionStoreError(
      'identity-mismatch',
      'retry admission does not bind the exact recovered operation attempt.'
    );
  }
  return Object.freeze({
    ...identity,
    attemptNonceDigest: admission.previousAttemptNonceDigest,
    resolutionKind: 'retry-admission-reference',
    resolutionReferenceDigest: admission.retryAdmissionDigest,
    domainReadbackReceiptDigest: admission.recoveredReadbackReceiptDigest
  });
}

export interface DurableExecutionStore {
  /** Reads durable observations. The result is never execution or replay authority. */
  read(identity: DurableExecutionJournalIdentity): DurableExecutionJournalObservation | null;
}

export interface DurableExecutionWriter extends DurableExecutionStore {
  createIntent(operation: BoundSemanticOperation): DurableExecutionJournalObservation;
  appendInitialAttemptStart(
    operation: BoundSemanticOperation,
    workerIdentityDigest: DurableExecutionDigest
  ): DurableExecutionJournalObservation;
  appendRecoveredRetryAttemptStart(
    recoveryOperation: BoundSemanticOperation,
    successorOperation: BoundSemanticOperation,
    workerIdentityDigest: DurableExecutionDigest,
    retryAdmission: RecoveredRetryAdmission,
    currentPhysicalEpochDigest: DurableExecutionDigest
  ): DurableExecutionJournalObservation;
  appendProviderSettlement(
    operation: BoundSemanticOperation,
    receipt: ProviderSettlementReceipt
  ): DurableExecutionJournalObservation;
  appendLostHandle(
    operation: BoundSemanticOperation,
    receipt: ProviderSettlementReceipt
  ): DurableExecutionJournalObservation;
  appendDomainReadback(
    operation: BoundSemanticOperation,
    receipt: DomainReadbackReceipt
  ): DurableExecutionJournalObservation;
  appendOwnerTerminalResolution(
    operation: BoundSemanticOperation,
    receipt: OwnerTerminalJoinReceipt
  ): DurableExecutionJournalObservation;
}

interface DurableExecutionStoreCore extends DurableExecutionStore {
  createIntent(input: CreateIntentInput): DurableExecutionJournalObservation;
  appendAttemptStart(input: AppendAttemptStartInput): DurableExecutionJournalObservation;
  appendRecoveredRetryAttemptStart(
    resolution: AppendAttemptResolutionInput,
    start: AppendAttemptStartInput
  ): DurableExecutionJournalObservation;
  appendProviderSettlementReference(input: AppendProviderSettlementInput): DurableExecutionJournalObservation;
  appendDomainReadbackReference(input: AppendDomainReadbackInput): DurableExecutionJournalObservation;
  appendLostHandleReference(input: AppendLostHandleInput): DurableExecutionJournalObservation;
  appendAttemptResolution(input: AppendAttemptResolutionInput): DurableExecutionJournalObservation;
}

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

function canonicalDigest(value: string, label: string): DurableExecutionDigest {
  if (!DIGEST_PATTERN.test(value)) {
    throw new DurableExecutionStoreError('identity-mismatch', `${label} is not canonical.`);
  }
  return value as DurableExecutionDigest;
}

function normalizeLimits(input: DurableExecutionStoreLimits): DurableExecutionStoreLimits {
  if (!Number.isFinite(input.deadlineAtMonotonicMs) || input.deadlineAtMonotonicMs <= performance.now()) {
    throw new DurableExecutionStoreError(
      'deadline-exhausted',
      'deadlineAtMonotonicMs must be one unexpired finite absolute monotonic deadline.'
    );
  }
  for (const key of [
    'maximumRecords',
    'maximumStateBytes',
    'maximumAttempts',
    'maximumProviderSettlementsPerAttempt'
  ] as const) {
    const value = input[key];
    const minimum = key === 'maximumProviderSettlementsPerAttempt' ? 0 : 1;
    if (!Number.isSafeInteger(value) || value < minimum || value > LIMIT_CEILINGS[key]) {
      throw new DurableExecutionStoreError(
        'resource-exhausted',
        `${key} must be a safe integer within its canonical ceiling ${LIMIT_CEILINGS[key]}.`
      );
    }
  }
  return Object.freeze({ ...input });
}

function assertDeadline(limits: DurableExecutionStoreLimits): void {
  if (performance.now() >= limits.deadlineAtMonotonicMs) {
    throw new DurableExecutionStoreError('deadline-exhausted', 'operation deadline is exhausted.');
  }
}

function attemptCount(observation: DurableExecutionJournalObservation): number {
  return observation.records.filter(({ kind }) => kind === 'attempt-start').length;
}

function limitsMatchIntent(
  observation: DurableExecutionJournalObservation,
  limits: DurableExecutionStoreLimits
): boolean {
  const intent = observation.intent;
  return intent.maximumRecords === limits.maximumRecords
    && intent.maximumStateBytes === limits.maximumStateBytes
    && intent.maximumAttempts === limits.maximumAttempts
    && intent.maximumProviderSettlementsPerAttempt === limits.maximumProviderSettlementsPerAttempt;
}

function reservedClosureRecords(
  observation: DurableExecutionJournalObservation,
  limits: DurableExecutionStoreLimits
): number {
  const active = observation.activeAttempt;
  if (active === null) return 0;
  const remainingProviders = active.lostHandle === null
    ? limits.maximumProviderSettlementsPerAttempt - active.providerSettlements.length
    : 0;
  if (remainingProviders < 0) {
    throw new DurableExecutionStoreError(
      'resource-exhausted',
      'active attempt exceeds its provider settlement reservation.'
    );
  }
  return remainingProviders
    + (active.lostHandle === null ? 1 : 0)
    + (active.domainReadback === null ? 1 : 0)
    + 1;
}

function assertCumulativeLimits(
  observation: DurableExecutionJournalObservation,
  limits: DurableExecutionStoreLimits,
  exactStateBytes: number,
  reserveSettlementClosure: boolean
): void {
  assertDeadline(limits);
  const reservedRecords = reserveSettlementClosure
    ? reservedClosureRecords(observation, limits)
    : 0;
  const recordsWithReservation = observation.records.length + reservedRecords;
  const bytesWithReservation = exactStateBytes
    + reservedRecords * (DURABLE_EXECUTION_MAXIMUM_RECORD_BYTES + 1);
  if (recordsWithReservation > limits.maximumRecords
      || bytesWithReservation > limits.maximumStateBytes
      || attemptCount(observation) > limits.maximumAttempts) {
    throw new DurableExecutionStoreError(
      'resource-exhausted',
      'journal cannot reserve its complete bounded attempt-settlement closure.'
    );
  }
}

function identityPath(
  journalRoot: string,
  identity: DurableExecutionJournalIdentity
): string {
  const operationKey = canonicalDigest(identity.operationKeyDigest, 'operationKeyDigest').slice(7);
  return path.join(journalRoot, `${operationKey}.jsonl`);
}

function pathInside(candidate: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!path.isAbsolute(relative)
    && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function sameIdentity(
  observation: DurableExecutionJournalObservation,
  identity: DurableExecutionJournalIdentity
): boolean {
  return observation.intent.operationKeyDigest === identity.operationKeyDigest;
}

function commonRecord<Kind extends Exclude<DurableExecutionRecord['kind'], 'intent'>>(
  observation: DurableExecutionJournalObservation,
  kind: Kind
) {
  const previous = observation.records.at(-1)!;
  return {
    schema: DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
    kind,
    sequence: observation.records.length,
    operationKeyDigest: observation.intent.operationKeyDigest,
    previousRecordDigest: previous.recordDigest
  } as const;
}

function sameAttemptStart(
  record: DurableExecutionAttemptStartRecord,
  input: AppendAttemptStartInput
): boolean {
  return record.attemptNonceDigest === input.attemptNonceDigest
    && record.boundAttemptDigest === input.boundAttemptDigest
    && record.runIdDigest === input.runIdDigest
    && record.resumeEpochDigest === input.resumeEpochDigest
    && record.workerIdentityDigest === input.workerIdentityDigest
    && record.authorityGrantReferenceDigest === input.authorityGrantReferenceDigest
    && record.providerBindingSetReferenceDigest === input.providerBindingSetReferenceDigest
    && record.executionPlanReferenceDigest === input.executionPlanReferenceDigest
    && record.deadlineAtUnixMs === input.deadlineAtUnixMs
    && record.retryAdmissionReferenceDigest === input.retryAdmissionReferenceDigest;
}

function createStoreCore(input: Readonly<{
  fileSystem: RuntimeStateJournalFileSystem;
  journalRoot: string;
  limits: DurableExecutionStoreLimits;
}>): DurableExecutionStoreCore {
  const journalRoot = path.resolve(input.journalRoot);
  const limits = normalizeLimits(input.limits);
  if (!path.isAbsolute(input.journalRoot) || !pathInside(journalRoot, input.fileSystem.rootPath)) {
    throw new DurableExecutionStoreError(
      'identity-mismatch',
      'journal root must be an absolute descendant of the retained Runtime State root.'
    );
  }
  const readState = (
    identity: DurableExecutionJournalIdentity
  ): Readonly<{
    observation: DurableExecutionJournalObservation;
    source: string;
  }> | null => {
    assertDeadline(limits);
    const journalPath = identityPath(journalRoot, identity);
    let source: string | null;
    try {
      source = input.fileSystem.readTextRetained(journalPath, {
        deadlineAtMonotonicMs: limits.deadlineAtMonotonicMs,
        maximumBytes: limits.maximumStateBytes
      });
    } catch (error) {
      if (error instanceof RuntimeStateJournalReadError) {
        throw new DurableExecutionStoreError(
          error.kind === 'deadline-exhausted' ? 'deadline-exhausted' : 'resource-exhausted',
          error.message
        );
      }
      throw error;
    }
    if (source === null) return null;
    const observation = parseDurableExecutionJournal(source);
    if (!sameIdentity(observation, identity)) {
      throw new DurableExecutionStoreError(
        'identity-mismatch',
        'journal bytes do not match their OperationKey address.'
      );
    }
    if (!limitsMatchIntent(observation, limits)) {
      throw new DurableExecutionStoreError(
        'identity-mismatch',
        'journal limits differ from their immutable operation intent.'
      );
    }
    assertCumulativeLimits(observation, limits, Buffer.byteLength(source, 'utf8'), true);
    return Object.freeze({ observation, source });
  };

  const read = (
    identity: DurableExecutionJournalIdentity
  ): DurableExecutionJournalObservation | null => readState(identity)?.observation ?? null;

  const required = (
    identity: DurableExecutionJournalIdentity
  ): DurableExecutionJournalObservation => {
    const state = readState(identity);
    if (state === null) {
      throw new DurableExecutionStoreError('absent', 'journal intent is absent.');
    }
    return state.observation;
  };

  const append = (
    identity: DurableExecutionJournalIdentity,
    build: (current: DurableExecutionJournalObservation) => DurableExecutionRecord,
    equivalent: (record: DurableExecutionRecord) => boolean
  ): DurableExecutionJournalObservation => {
    assertDeadline(limits);
    const currentState = readState(identity);
    if (currentState === null) {
      throw new DurableExecutionStoreError('absent', 'journal intent is absent.');
    }
    const current = currentState.observation;
    const existing = current.records.find(equivalent);
    if (existing !== undefined) return current;
    const record = build(current);
    const next = observeDurableExecutionJournal([...current.records, record]);
    const appended = `${encodeDurableExecutionRecord(record)}\n`;
    assertCumulativeLimits(
      next,
      limits,
      Buffer.byteLength(currentState.source, 'utf8') + Buffer.byteLength(appended, 'utf8'),
      true
    );
    const journalPath = identityPath(journalRoot, identity);
    assertDeadline(limits);
    if (input.fileSystem.appendFsyncCas(journalPath, currentState.source, appended)) return next;
    const concurrent = required(identity);
    if (concurrent.records.some(equivalent)) return concurrent;
    throw new DurableExecutionStoreError('conflict', 'journal changed during CAS append.');
  };

  return Object.freeze({
    read,
    createIntent(intentInput: CreateIntentInput): DurableExecutionJournalObservation {
      const journalPath = identityPath(journalRoot, intentInput);
      assertDeadline(limits);
      const intent = sealDurableExecutionRecordForInternalWriter({
        schema: DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
        kind: 'intent',
        sequence: 0,
        operationKeyDigest: canonicalDigest(intentInput.operationKeyDigest, 'operationKeyDigest'),
        intentReferenceDigest: canonicalDigest(intentInput.intentReferenceDigest, 'intentReferenceDigest'),
        executionPlanReferenceDigest: canonicalDigest(
          intentInput.executionPlanReferenceDigest, 'executionPlanReferenceDigest'),
        deadlineAtUnixMs: intentInput.deadlineAtUnixMs,
        maximumRecords: limits.maximumRecords,
        maximumStateBytes: limits.maximumStateBytes,
        maximumAttempts: limits.maximumAttempts,
        maximumProviderSettlementsPerAttempt: limits.maximumProviderSettlementsPerAttempt,
        previousRecordDigest: null
      });
      const source = `${encodeDurableExecutionRecord(intent)}\n`;
      assertCumulativeLimits(
        observeDurableExecutionJournal([intent]),
        limits,
        Buffer.byteLength(source, 'utf8'),
        false
      );
      assertDeadline(limits);
      if (input.fileSystem.createExclusiveFsync(journalPath, source)) {
        return observeDurableExecutionJournal([intent]);
      }
      const current = required(intentInput);
      if (current.intent.recordDigest === intent.recordDigest) return current;
      throw new DurableExecutionStoreError('conflict', 'OperationKey already binds another intent.');
    },
    appendAttemptStart(attemptInput: AppendAttemptStartInput): DurableExecutionJournalObservation {
      return append(attemptInput, (current) => sealDurableExecutionRecordForInternalWriter({
        ...commonRecord(current, 'attempt-start'),
        runIdDigest: attemptInput.runIdDigest === null
          ? null
          : canonicalDigest(attemptInput.runIdDigest, 'runIdDigest'),
        resumeEpochDigest: attemptInput.resumeEpochDigest === null
          ? null
          : canonicalDigest(attemptInput.resumeEpochDigest, 'resumeEpochDigest'),
        attemptNonceDigest: canonicalDigest(attemptInput.attemptNonceDigest, 'attemptNonceDigest'),
        boundAttemptDigest: canonicalDigest(attemptInput.boundAttemptDigest, 'boundAttemptDigest'),
        workerIdentityDigest: canonicalDigest(attemptInput.workerIdentityDigest, 'workerIdentityDigest'),
        authorityGrantReferenceDigest: canonicalDigest(attemptInput.authorityGrantReferenceDigest,
          'authorityGrantReferenceDigest'),
        providerBindingSetReferenceDigest: canonicalDigest(attemptInput.providerBindingSetReferenceDigest,
          'providerBindingSetReferenceDigest'),
        executionPlanReferenceDigest: canonicalDigest(attemptInput.executionPlanReferenceDigest,
          'executionPlanReferenceDigest'),
        deadlineAtUnixMs: attemptInput.deadlineAtUnixMs,
        retryAdmissionReferenceDigest: attemptInput.retryAdmissionReferenceDigest === null
          ? null
          : canonicalDigest(attemptInput.retryAdmissionReferenceDigest,
            'retryAdmissionReferenceDigest')
      }), (record) => record.kind === 'attempt-start'
        && sameAttemptStart(record, attemptInput));
    },
    appendRecoveredRetryAttemptStart(
      resolutionInput: AppendAttemptResolutionInput,
      attemptInput: AppendAttemptStartInput
    ): DurableExecutionJournalObservation {
      assertDeadline(limits);
      const currentState = readState(resolutionInput);
      if (currentState === null) {
        throw new DurableExecutionStoreError('absent', 'journal intent is absent.');
      }
      const current = currentState.observation;
      const activeAttempt = current.activeAttempt;
      if (activeAttempt === null
          || activeAttempt.start.attemptNonceDigest !== resolutionInput.attemptNonceDigest
          || activeAttempt.domainReadback?.domainReadbackReceiptDigest
            !== resolutionInput.domainReadbackReceiptDigest
          || attemptInput.operationKeyDigest !== resolutionInput.operationKeyDigest) {
        throw new DurableExecutionStoreError(
          'identity-mismatch',
          'atomic retry transition does not bind the active predecessor and exact readback.'
        );
      }
      const resolution = sealDurableExecutionRecordForInternalWriter({
        ...commonRecord(current, 'attempt-resolution'),
        attemptNonceDigest: canonicalDigest(
          resolutionInput.attemptNonceDigest, 'attemptNonceDigest'),
        resolutionKind: 'retry-admission-reference' as const,
        resolutionReferenceDigest: canonicalDigest(
          resolutionInput.resolutionReferenceDigest, 'resolutionReferenceDigest'),
        providerSettlementRecordDigests: activeAttempt.providerSettlements
          .map(({ recordDigest }) => recordDigest)
          .sort(),
        domainReadbackRecordDigest: activeAttempt.domainReadback.recordDigest
      });
      const admitted = observeDurableExecutionJournal([...current.records, resolution]);
      const start = sealDurableExecutionRecordForInternalWriter({
        ...commonRecord(admitted, 'attempt-start'),
        runIdDigest: attemptInput.runIdDigest === null
          ? null
          : canonicalDigest(attemptInput.runIdDigest, 'runIdDigest'),
        resumeEpochDigest: attemptInput.resumeEpochDigest === null
          ? null
          : canonicalDigest(attemptInput.resumeEpochDigest, 'resumeEpochDigest'),
        attemptNonceDigest: canonicalDigest(attemptInput.attemptNonceDigest, 'attemptNonceDigest'),
        boundAttemptDigest: canonicalDigest(attemptInput.boundAttemptDigest, 'boundAttemptDigest'),
        workerIdentityDigest: canonicalDigest(attemptInput.workerIdentityDigest, 'workerIdentityDigest'),
        authorityGrantReferenceDigest: canonicalDigest(
          attemptInput.authorityGrantReferenceDigest, 'authorityGrantReferenceDigest'),
        providerBindingSetReferenceDigest: canonicalDigest(
          attemptInput.providerBindingSetReferenceDigest, 'providerBindingSetReferenceDigest'),
        executionPlanReferenceDigest: canonicalDigest(
          attemptInput.executionPlanReferenceDigest, 'executionPlanReferenceDigest'),
        deadlineAtUnixMs: attemptInput.deadlineAtUnixMs,
        retryAdmissionReferenceDigest: canonicalDigest(
          resolutionInput.resolutionReferenceDigest, 'retryAdmissionReferenceDigest')
      });
      const next = observeDurableExecutionJournal([...admitted.records, start]);
      const appended = `${encodeDurableExecutionRecord(resolution)}\n${encodeDurableExecutionRecord(start)}\n`;
      assertCumulativeLimits(
        next,
        limits,
        Buffer.byteLength(currentState.source, 'utf8') + Buffer.byteLength(appended, 'utf8'),
        true
      );
      const journalPath = identityPath(journalRoot, resolutionInput);
      assertDeadline(limits);
      if (input.fileSystem.appendFsyncCas(journalPath, currentState.source, appended)) return next;
      const concurrent = required(resolutionInput);
      if (concurrent.activeAttempt?.start.attemptNonceDigest === attemptInput.attemptNonceDigest
          && concurrent.latestResolution?.resolutionReferenceDigest
            === resolutionInput.resolutionReferenceDigest) {
        return concurrent;
      }
      throw new DurableExecutionStoreError(
        'conflict', 'journal changed during atomic retry transition.'
      );
    },
    appendProviderSettlementReference(
      settlementInput: AppendProviderSettlementInput
    ): DurableExecutionJournalObservation {
      return append(settlementInput, (current) => sealDurableExecutionRecordForInternalWriter({
        ...commonRecord(current, 'provider-settlement-reference'),
        attemptNonceDigest: canonicalDigest(settlementInput.attemptNonceDigest, 'attemptNonceDigest'),
        requirementId: settlementInput.requirementId,
        providerBindingDigest: canonicalDigest(
          settlementInput.providerBindingDigest, 'providerBindingDigest'),
        providerReceiptDigest: canonicalDigest(
          settlementInput.providerReceiptDigest, 'providerReceiptDigest')
      }), (record) => record.kind === 'provider-settlement-reference'
        && record.attemptNonceDigest === settlementInput.attemptNonceDigest
        && record.requirementId === settlementInput.requirementId
        && record.providerBindingDigest === settlementInput.providerBindingDigest
        && record.providerReceiptDigest === settlementInput.providerReceiptDigest);
    },
    appendDomainReadbackReference(
      readbackInput: AppendDomainReadbackInput
    ): DurableExecutionJournalObservation {
      return append(readbackInput, (current) => sealDurableExecutionRecordForInternalWriter({
        ...commonRecord(current, 'domain-readback-reference'),
        attemptNonceDigest: canonicalDigest(readbackInput.attemptNonceDigest, 'attemptNonceDigest'),
        readbackContractDigest: canonicalDigest(
          readbackInput.readbackContractDigest, 'readbackContractDigest'),
        domainReadbackReceiptDigest: canonicalDigest(readbackInput.domainReadbackReceiptDigest,
          'domainReadbackReceiptDigest')
      }), (record) => record.kind === 'domain-readback-reference'
        && record.attemptNonceDigest === readbackInput.attemptNonceDigest
        && record.readbackContractDigest === readbackInput.readbackContractDigest
        && record.domainReadbackReceiptDigest === readbackInput.domainReadbackReceiptDigest);
    },
    appendLostHandleReference(
      lostHandleInput: AppendLostHandleInput
    ): DurableExecutionJournalObservation {
      return append(lostHandleInput, (current) => sealDurableExecutionRecordForInternalWriter({
        ...commonRecord(current, 'lost-handle-reference'),
        attemptNonceDigest: canonicalDigest(
          lostHandleInput.attemptNonceDigest, 'attemptNonceDigest'),
        lostHandleReferenceDigest: canonicalDigest(
          lostHandleInput.lostHandleReferenceDigest, 'lostHandleReferenceDigest')
      }), (record) => record.kind === 'lost-handle-reference'
        && record.attemptNonceDigest === lostHandleInput.attemptNonceDigest
        && record.lostHandleReferenceDigest === lostHandleInput.lostHandleReferenceDigest);
    },
    appendAttemptResolution(
      resolutionInput: AppendAttemptResolutionInput
    ): DurableExecutionJournalObservation {
      return append(resolutionInput, (current) => {
        const attempt = current.activeAttempt;
        if (attempt === null
            || attempt.start.attemptNonceDigest !== resolutionInput.attemptNonceDigest) {
          throw new DurableExecutionStoreError(
            'conflict', 'attempt resolution does not target the active attempt.');
        }
        if (attempt.domainReadback?.domainReadbackReceiptDigest
            !== resolutionInput.domainReadbackReceiptDigest) {
          throw new DurableExecutionStoreError(
            'identity-mismatch',
            'attempt resolution does not bind the exact observed domain readback receipt.'
          );
        }
        return sealDurableExecutionRecordForInternalWriter({
          ...commonRecord(current, 'attempt-resolution'),
          attemptNonceDigest: canonicalDigest(
            resolutionInput.attemptNonceDigest, 'attemptNonceDigest'),
          resolutionKind: resolutionInput.resolutionKind,
          resolutionReferenceDigest: canonicalDigest(
            resolutionInput.resolutionReferenceDigest, 'resolutionReferenceDigest'),
          providerSettlementRecordDigests: attempt.providerSettlements
            .map(({ recordDigest }) => recordDigest)
            .sort(),
          domainReadbackRecordDigest: attempt.domainReadback?.recordDigest ?? null
        });
      }, (record) => record.kind === 'attempt-resolution'
        && record.attemptNonceDigest === resolutionInput.attemptNonceDigest
        && record.resolutionKind === resolutionInput.resolutionKind
        && record.resolutionReferenceDigest === resolutionInput.resolutionReferenceDigest);
    }
  });
}
