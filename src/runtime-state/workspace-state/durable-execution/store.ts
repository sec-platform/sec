import path from 'node:path';

import {
  assertSecBoundSemanticOperation,
  assertSecDomainReadbackReceipt,
  assertSecOwnerTerminalJoinReceipt,
  assertSecProviderSettlementReceipt,
  assertSecRecoveredRetryAdmission,
  consumeSecRecoveredRetryAdmission,
  type SecBoundSemanticOperation,
  type SecDomainReadbackReceipt,
  type SecOwnerTerminalJoinReceipt,
  type SecProviderSettlementReceipt,
  type SecRecoveredRetryAdmission
} from '../../../system-architecture/operation/semantic.ts';
import {
  RuntimeStateJournalReadError,
  type RuntimeStateJournalFileSystem
} from '../journal-filesystem.ts';
import {
  SEC_DURABLE_EXECUTION_MAXIMUM_RECORD_BYTES,
  SEC_DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
  encodeDurableExecutionRecord,
  observeDurableExecutionJournal,
  parseDurableExecutionJournal,
  sealDurableExecutionRecordForInternalWriter,
  type SecDurableAttemptResolutionKind,
  type SecDurableExecutionAttemptStartRecord,
  type SecDurableExecutionDigest,
  type SecDurableExecutionJournalObservation,
  type SecDurableExecutionRecord
} from './contract.ts';

export type SecDurableExecutionStoreFailureKind =
  | 'absent'
  | 'conflict'
  | 'identity-mismatch'
  | 'deadline-exhausted'
  | 'resource-exhausted';

export class SecDurableExecutionStoreError extends Error {
  readonly kind: SecDurableExecutionStoreFailureKind;

  constructor(kind: SecDurableExecutionStoreFailureKind, message: string) {
    super(`Durable local execution store ${message}`);
    this.name = 'SecDurableExecutionStoreError';
    this.kind = kind;
  }
}

export interface SecDurableExecutionJournalIdentity {
  readonly operationKeyDigest: SecDurableExecutionDigest;
}

export interface SecDurableExecutionStoreLimits {
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
  operation: SecBoundSemanticOperation
): SecDurableExecutionJournalIdentity {
  assertSecBoundSemanticOperation(operation);
  return Object.freeze({
    operationKeyDigest: operation.plan.identity.identityDigest
  });
}

export function createDurableExecutionStore(input: Readonly<{
  fileSystem: RuntimeStateJournalFileSystem;
  journalRoot: string;
  limits: SecDurableExecutionStoreLimits;
}>): SecDurableExecutionStore {
  const writer = createStoreCore(input);
  return Object.freeze({ read: writer.read });
}

export function createDurableExecutionWriter(input: Readonly<{
  fileSystem: RuntimeStateJournalFileSystem;
  journalRoot: string;
  limits: SecDurableExecutionStoreLimits;
}>): SecDurableExecutionWriter {
  const core = createStoreCore(input);
  return Object.freeze({
    read: core.read,
    createIntent(operation: SecBoundSemanticOperation) {
      return core.createIntent({
        ...durableExecutionJournalIdentity(operation),
        intentReferenceDigest: operation.plan.identity.intentDigest
      });
    },
    appendInitialAttemptStart(
      operation: SecBoundSemanticOperation,
      workerIdentityDigest: SecDurableExecutionDigest
    ) {
      return core.appendAttemptStart(
        initialAttemptStartInput(operation, workerIdentityDigest)
      );
    },
    appendRetryAttemptStart(
      operation: SecBoundSemanticOperation,
      workerIdentityDigest: SecDurableExecutionDigest,
      retryAdmission: SecRecoveredRetryAdmission
    ) {
      return core.appendAttemptStart(
        consumeRetryAttemptStartInput(operation, workerIdentityDigest, retryAdmission)
      );
    },
    appendProviderSettlement(
      operation: SecBoundSemanticOperation,
      receipt: SecProviderSettlementReceipt
    ) {
      return core.appendProviderSettlementReference(
        providerSettlementReferenceInput(operation, receipt)
      );
    },
    appendLostHandle(
      operation: SecBoundSemanticOperation,
      receipt: SecProviderSettlementReceipt
    ) {
      return core.appendLostHandleReference(lostHandleReferenceInput(operation, receipt));
    },
    appendDomainReadback(
      operation: SecBoundSemanticOperation,
      receipt: SecDomainReadbackReceipt
    ) {
      return core.appendDomainReadbackReference(domainReadbackReferenceInput(operation, receipt));
    },
    appendOwnerTerminalResolution(
      operation: SecBoundSemanticOperation,
      receipt: SecOwnerTerminalJoinReceipt
    ) {
      return core.appendAttemptResolution(ownerTerminalResolutionInput(operation, receipt));
    },
    appendRetryAdmissionResolution(
      operation: SecBoundSemanticOperation,
      admission: SecRecoveredRetryAdmission
    ) {
      return core.appendAttemptResolution(retryAdmissionResolutionInput(operation, admission));
    }
  });
}

type CreateIntentInput = SecDurableExecutionJournalIdentity & Readonly<{
  intentReferenceDigest: SecDurableExecutionDigest;
}>;
type AppendAttemptStartInput = SecDurableExecutionJournalIdentity & Readonly<{
  runIdDigest: SecDurableExecutionDigest | null;
  resumeEpochDigest: SecDurableExecutionDigest | null;
  attemptNonceDigest: SecDurableExecutionDigest;
  workerIdentityDigest: SecDurableExecutionDigest;
  authorityGrantReferenceDigest: SecDurableExecutionDigest;
  providerBindingSetReferenceDigest: SecDurableExecutionDigest;
  executionPlanReferenceDigest: SecDurableExecutionDigest;
  retryAdmissionReferenceDigest: SecDurableExecutionDigest | null;
}>;

/**
 * Binds one physical worker to the exact live attempt. No durable record or
 * structural clone can be used as input because the semantic-operation issuer
 * check runs before any journal mutation.
 */
function projectAttemptStartInput(
  operation: SecBoundSemanticOperation,
  workerIdentityDigest: SecDurableExecutionDigest,
  retryAdmissionReferenceDigest: SecDurableExecutionDigest | null
): AppendAttemptStartInput {
  const identity = durableExecutionJournalIdentity(operation);
  const runIdDigest = operation.plan.attempt.runIdDigest;
  const resumeEpochDigest = operation.plan.attempt.resumeEpochDigest;
  return Object.freeze({
    ...identity,
    runIdDigest,
    resumeEpochDigest,
    attemptNonceDigest: operation.plan.attempt.attemptNonceDigest,
    workerIdentityDigest: canonicalDigest(workerIdentityDigest, 'workerIdentityDigest'),
    authorityGrantReferenceDigest: operation.plan.attempt.authorityGrantDigest,
    providerBindingSetReferenceDigest: operation.bindingSetIdentityDigest,
    executionPlanReferenceDigest: operation.plan.execution.executionPlanDigest,
    retryAdmissionReferenceDigest
  });
}

function initialAttemptStartInput(
  operation: SecBoundSemanticOperation,
  workerIdentityDigest: SecDurableExecutionDigest
): AppendAttemptStartInput {
  return projectAttemptStartInput(operation, workerIdentityDigest, null);
}

function consumeRetryAttemptStartInput(
  operation: SecBoundSemanticOperation,
  workerIdentityDigest: SecDurableExecutionDigest,
  retryAdmission: SecRecoveredRetryAdmission
): AppendAttemptStartInput {
  assertSecRecoveredRetryAdmission(retryAdmission);
  consumeSecRecoveredRetryAdmission(retryAdmission, operation);
  return projectAttemptStartInput(
    operation,
    workerIdentityDigest,
    retryAdmission.retryAdmissionDigest
  );
}
type AppendProviderSettlementInput = SecDurableExecutionJournalIdentity & Readonly<{
  attemptNonceDigest: SecDurableExecutionDigest;
  requirementId: string;
  providerBindingDigest: SecDurableExecutionDigest;
  providerReceiptDigest: SecDurableExecutionDigest;
}>;
type AppendDomainReadbackInput = SecDurableExecutionJournalIdentity & Readonly<{
  attemptNonceDigest: SecDurableExecutionDigest;
  readbackContractDigest: SecDurableExecutionDigest;
  domainReadbackReceiptDigest: SecDurableExecutionDigest;
}>;
type AppendLostHandleInput = SecDurableExecutionJournalIdentity & Readonly<{
  attemptNonceDigest: SecDurableExecutionDigest;
  lostHandleReferenceDigest: SecDurableExecutionDigest;
}>;
type AppendAttemptResolutionInput = SecDurableExecutionJournalIdentity & Readonly<{
  attemptNonceDigest: SecDurableExecutionDigest;
  resolutionKind: SecDurableAttemptResolutionKind;
  resolutionReferenceDigest: SecDurableExecutionDigest;
  domainReadbackReceiptDigest: SecDurableExecutionDigest;
}>;

function ownerTerminalResolutionInput(
  operation: SecBoundSemanticOperation,
  receipt: SecOwnerTerminalJoinReceipt
): AppendAttemptResolutionInput {
  const identity = durableExecutionJournalIdentity(operation);
  assertSecOwnerTerminalJoinReceipt(receipt);
  if (receipt.operationIdentityDigest !== identity.operationKeyDigest
      || receipt.executionPlanDigest !== operation.plan.execution.executionPlanDigest
      || receipt.bindingSetIdentityDigest !== operation.bindingSetIdentityDigest
      || receipt.boundAttemptDigest !== operation.boundAttemptDigest) {
    throw new SecDurableExecutionStoreError(
      'identity-mismatch',
      'owner terminal receipt does not bind the exact operation attempt.'
    );
  }
  return Object.freeze({
    ...identity,
    attemptNonceDigest: operation.plan.attempt.attemptNonceDigest,
    resolutionKind: 'owner-terminal-reference',
    resolutionReferenceDigest: receipt.joinReceiptDigest,
    domainReadbackReceiptDigest: receipt.readbackReceiptDigest
  });
}

function providerSettlementReferenceInput(
  operation: SecBoundSemanticOperation,
  receipt: SecProviderSettlementReceipt
): AppendProviderSettlementInput {
  const identity = durableExecutionJournalIdentity(operation);
  assertSecProviderSettlementReceipt(receipt);
  if (receipt.operationIdentityDigest !== identity.operationKeyDigest
      || receipt.executionPlanDigest !== operation.plan.execution.executionPlanDigest
      || receipt.boundAttemptDigest !== operation.boundAttemptDigest) {
    throw new SecDurableExecutionStoreError(
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
  operation: SecBoundSemanticOperation,
  receipt: SecDomainReadbackReceipt
): AppendDomainReadbackInput {
  const identity = durableExecutionJournalIdentity(operation);
  assertSecDomainReadbackReceipt(receipt);
  if (receipt.operationIdentityDigest !== identity.operationKeyDigest
      || receipt.executionPlanDigest !== operation.plan.execution.executionPlanDigest
      || receipt.bindingSetIdentityDigest !== operation.bindingSetIdentityDigest
      || receipt.boundAttemptDigest !== operation.boundAttemptDigest) {
    throw new SecDurableExecutionStoreError(
      'identity-mismatch',
      'domain readback receipt does not bind the exact operation attempt.'
    );
  }
  return Object.freeze({
    ...identity,
    attemptNonceDigest: operation.plan.attempt.attemptNonceDigest,
    readbackContractDigest: receipt.readbackContractDigest,
    domainReadbackReceiptDigest: receipt.readbackReceiptDigest
  });
}

function lostHandleReferenceInput(
  operation: SecBoundSemanticOperation,
  receipt: SecProviderSettlementReceipt
): AppendLostHandleInput {
  const settlement = providerSettlementReferenceInput(operation, receipt);
  if (receipt.physicalDisposition !== 'unknown') {
    throw new SecDurableExecutionStoreError(
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
  operation: SecBoundSemanticOperation,
  admission: SecRecoveredRetryAdmission
): AppendAttemptResolutionInput {
  const identity = durableExecutionJournalIdentity(operation);
  assertSecRecoveredRetryAdmission(admission);
  if (admission.operationIdentityDigest !== identity.operationKeyDigest
      || admission.previousExecutionPlanDigest !== operation.plan.execution.executionPlanDigest
      || admission.previousBindingSetIdentityDigest !== operation.bindingSetIdentityDigest
      || admission.previousBoundAttemptDigest !== operation.boundAttemptDigest) {
    throw new SecDurableExecutionStoreError(
      'identity-mismatch',
      'retry admission does not bind the exact recovered operation attempt.'
    );
  }
  return Object.freeze({
    ...identity,
    attemptNonceDigest: operation.plan.attempt.attemptNonceDigest,
    resolutionKind: 'retry-admission-reference',
    resolutionReferenceDigest: admission.retryAdmissionDigest,
    domainReadbackReceiptDigest: admission.recoveredReadbackReceiptDigest
  });
}

export interface SecDurableExecutionStore {
  /** Reads durable observations. The result is never execution or replay authority. */
  read(identity: SecDurableExecutionJournalIdentity): SecDurableExecutionJournalObservation | null;
}

export interface SecDurableExecutionWriter extends SecDurableExecutionStore {
  createIntent(operation: SecBoundSemanticOperation): SecDurableExecutionJournalObservation;
  appendInitialAttemptStart(
    operation: SecBoundSemanticOperation,
    workerIdentityDigest: SecDurableExecutionDigest
  ): SecDurableExecutionJournalObservation;
  appendRetryAttemptStart(
    operation: SecBoundSemanticOperation,
    workerIdentityDigest: SecDurableExecutionDigest,
    retryAdmission: SecRecoveredRetryAdmission
  ): SecDurableExecutionJournalObservation;
  appendProviderSettlement(
    operation: SecBoundSemanticOperation,
    receipt: SecProviderSettlementReceipt
  ): SecDurableExecutionJournalObservation;
  appendLostHandle(
    operation: SecBoundSemanticOperation,
    receipt: SecProviderSettlementReceipt
  ): SecDurableExecutionJournalObservation;
  appendDomainReadback(
    operation: SecBoundSemanticOperation,
    receipt: SecDomainReadbackReceipt
  ): SecDurableExecutionJournalObservation;
  appendOwnerTerminalResolution(
    operation: SecBoundSemanticOperation,
    receipt: SecOwnerTerminalJoinReceipt
  ): SecDurableExecutionJournalObservation;
  appendRetryAdmissionResolution(
    operation: SecBoundSemanticOperation,
    admission: SecRecoveredRetryAdmission
  ): SecDurableExecutionJournalObservation;
}

interface DurableExecutionStoreCore extends SecDurableExecutionStore {
  createIntent(input: CreateIntentInput): SecDurableExecutionJournalObservation;
  appendAttemptStart(input: AppendAttemptStartInput): SecDurableExecutionJournalObservation;
  appendProviderSettlementReference(input: AppendProviderSettlementInput): SecDurableExecutionJournalObservation;
  appendDomainReadbackReference(input: AppendDomainReadbackInput): SecDurableExecutionJournalObservation;
  appendLostHandleReference(input: AppendLostHandleInput): SecDurableExecutionJournalObservation;
  appendAttemptResolution(input: AppendAttemptResolutionInput): SecDurableExecutionJournalObservation;
}

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

function canonicalDigest(value: string, label: string): SecDurableExecutionDigest {
  if (!DIGEST_PATTERN.test(value)) {
    throw new SecDurableExecutionStoreError('identity-mismatch', `${label} is not canonical.`);
  }
  return value as SecDurableExecutionDigest;
}

function normalizeLimits(input: SecDurableExecutionStoreLimits): SecDurableExecutionStoreLimits {
  if (!Number.isFinite(input.deadlineAtMonotonicMs) || input.deadlineAtMonotonicMs <= performance.now()) {
    throw new SecDurableExecutionStoreError(
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
      throw new SecDurableExecutionStoreError(
        'resource-exhausted',
        `${key} must be a safe integer within its canonical ceiling ${LIMIT_CEILINGS[key]}.`
      );
    }
  }
  return Object.freeze({ ...input });
}

function assertDeadline(limits: SecDurableExecutionStoreLimits): void {
  if (performance.now() >= limits.deadlineAtMonotonicMs) {
    throw new SecDurableExecutionStoreError('deadline-exhausted', 'operation deadline is exhausted.');
  }
}

function attemptCount(observation: SecDurableExecutionJournalObservation): number {
  return observation.records.filter(({ kind }) => kind === 'attempt-start').length;
}

function limitsMatchIntent(
  observation: SecDurableExecutionJournalObservation,
  limits: SecDurableExecutionStoreLimits
): boolean {
  const intent = observation.intent;
  return intent.maximumRecords === limits.maximumRecords
    && intent.maximumStateBytes === limits.maximumStateBytes
    && intent.maximumAttempts === limits.maximumAttempts
    && intent.maximumProviderSettlementsPerAttempt === limits.maximumProviderSettlementsPerAttempt;
}

function reservedClosureRecords(
  observation: SecDurableExecutionJournalObservation,
  limits: SecDurableExecutionStoreLimits
): number {
  const active = observation.activeAttempt;
  if (active === null) return 0;
  const remainingProviders = active.lostHandle === null
    ? limits.maximumProviderSettlementsPerAttempt - active.providerSettlements.length
    : 0;
  if (remainingProviders < 0) {
    throw new SecDurableExecutionStoreError(
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
  observation: SecDurableExecutionJournalObservation,
  limits: SecDurableExecutionStoreLimits,
  exactStateBytes: number,
  reserveSettlementClosure: boolean
): void {
  assertDeadline(limits);
  const reservedRecords = reserveSettlementClosure
    ? reservedClosureRecords(observation, limits)
    : 0;
  const recordsWithReservation = observation.records.length + reservedRecords;
  const bytesWithReservation = exactStateBytes
    + reservedRecords * (SEC_DURABLE_EXECUTION_MAXIMUM_RECORD_BYTES + 1);
  if (recordsWithReservation > limits.maximumRecords
      || bytesWithReservation > limits.maximumStateBytes
      || attemptCount(observation) > limits.maximumAttempts) {
    throw new SecDurableExecutionStoreError(
      'resource-exhausted',
      'journal cannot reserve its complete bounded attempt-settlement closure.'
    );
  }
}

function identityPath(
  journalRoot: string,
  identity: SecDurableExecutionJournalIdentity
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
  observation: SecDurableExecutionJournalObservation,
  identity: SecDurableExecutionJournalIdentity
): boolean {
  return observation.intent.operationKeyDigest === identity.operationKeyDigest;
}

function commonRecord<Kind extends Exclude<SecDurableExecutionRecord['kind'], 'intent'>>(
  observation: SecDurableExecutionJournalObservation,
  kind: Kind
) {
  const previous = observation.records.at(-1)!;
  return {
    schema: SEC_DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
    kind,
    sequence: observation.records.length,
    operationKeyDigest: observation.intent.operationKeyDigest,
    previousRecordDigest: previous.recordDigest
  } as const;
}

function sameAttemptStart(
  record: SecDurableExecutionAttemptStartRecord,
  input: AppendAttemptStartInput
): boolean {
  return record.attemptNonceDigest === input.attemptNonceDigest
    && record.runIdDigest === input.runIdDigest
    && record.resumeEpochDigest === input.resumeEpochDigest
    && record.workerIdentityDigest === input.workerIdentityDigest
    && record.authorityGrantReferenceDigest === input.authorityGrantReferenceDigest
    && record.providerBindingSetReferenceDigest === input.providerBindingSetReferenceDigest
    && record.executionPlanReferenceDigest === input.executionPlanReferenceDigest
    && record.retryAdmissionReferenceDigest === input.retryAdmissionReferenceDigest;
}

function createStoreCore(input: Readonly<{
  fileSystem: RuntimeStateJournalFileSystem;
  journalRoot: string;
  limits: SecDurableExecutionStoreLimits;
}>): DurableExecutionStoreCore {
  const journalRoot = path.resolve(input.journalRoot);
  const limits = normalizeLimits(input.limits);
  if (!path.isAbsolute(input.journalRoot) || !pathInside(journalRoot, input.fileSystem.rootPath)) {
    throw new SecDurableExecutionStoreError(
      'identity-mismatch',
      'journal root must be an absolute descendant of the retained Runtime State root.'
    );
  }
  const readState = (
    identity: SecDurableExecutionJournalIdentity
  ): Readonly<{
    observation: SecDurableExecutionJournalObservation;
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
        throw new SecDurableExecutionStoreError(
          error.kind === 'deadline-exhausted' ? 'deadline-exhausted' : 'resource-exhausted',
          error.message
        );
      }
      throw error;
    }
    if (source === null) return null;
    const observation = parseDurableExecutionJournal(source);
    if (!sameIdentity(observation, identity)) {
      throw new SecDurableExecutionStoreError(
        'identity-mismatch',
        'journal bytes do not match their OperationKey address.'
      );
    }
    if (!limitsMatchIntent(observation, limits)) {
      throw new SecDurableExecutionStoreError(
        'identity-mismatch',
        'journal limits differ from their immutable operation intent.'
      );
    }
    assertCumulativeLimits(observation, limits, Buffer.byteLength(source, 'utf8'), true);
    return Object.freeze({ observation, source });
  };

  const read = (
    identity: SecDurableExecutionJournalIdentity
  ): SecDurableExecutionJournalObservation | null => readState(identity)?.observation ?? null;

  const required = (
    identity: SecDurableExecutionJournalIdentity
  ): SecDurableExecutionJournalObservation => {
    const state = readState(identity);
    if (state === null) {
      throw new SecDurableExecutionStoreError('absent', 'journal intent is absent.');
    }
    return state.observation;
  };

  const append = (
    identity: SecDurableExecutionJournalIdentity,
    build: (current: SecDurableExecutionJournalObservation) => SecDurableExecutionRecord,
    equivalent: (record: SecDurableExecutionRecord) => boolean
  ): SecDurableExecutionJournalObservation => {
    assertDeadline(limits);
    const currentState = readState(identity);
    if (currentState === null) {
      throw new SecDurableExecutionStoreError('absent', 'journal intent is absent.');
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
    throw new SecDurableExecutionStoreError('conflict', 'journal changed during CAS append.');
  };

  return Object.freeze({
    read,
    createIntent(intentInput: CreateIntentInput): SecDurableExecutionJournalObservation {
      const journalPath = identityPath(journalRoot, intentInput);
      assertDeadline(limits);
      const intent = sealDurableExecutionRecordForInternalWriter({
        schema: SEC_DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
        kind: 'intent',
        sequence: 0,
        operationKeyDigest: canonicalDigest(intentInput.operationKeyDigest, 'operationKeyDigest'),
        intentReferenceDigest: canonicalDigest(intentInput.intentReferenceDigest, 'intentReferenceDigest'),
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
      throw new SecDurableExecutionStoreError('conflict', 'OperationKey already binds another intent.');
    },
    appendAttemptStart(attemptInput: AppendAttemptStartInput): SecDurableExecutionJournalObservation {
      return append(attemptInput, (current) => sealDurableExecutionRecordForInternalWriter({
        ...commonRecord(current, 'attempt-start'),
        runIdDigest: attemptInput.runIdDigest === null
          ? null
          : canonicalDigest(attemptInput.runIdDigest, 'runIdDigest'),
        resumeEpochDigest: attemptInput.resumeEpochDigest === null
          ? null
          : canonicalDigest(attemptInput.resumeEpochDigest, 'resumeEpochDigest'),
        attemptNonceDigest: canonicalDigest(attemptInput.attemptNonceDigest, 'attemptNonceDigest'),
        workerIdentityDigest: canonicalDigest(attemptInput.workerIdentityDigest, 'workerIdentityDigest'),
        authorityGrantReferenceDigest: canonicalDigest(attemptInput.authorityGrantReferenceDigest,
          'authorityGrantReferenceDigest'),
        providerBindingSetReferenceDigest: canonicalDigest(attemptInput.providerBindingSetReferenceDigest,
          'providerBindingSetReferenceDigest'),
        executionPlanReferenceDigest: canonicalDigest(attemptInput.executionPlanReferenceDigest,
          'executionPlanReferenceDigest'),
        retryAdmissionReferenceDigest: attemptInput.retryAdmissionReferenceDigest === null
          ? null
          : canonicalDigest(attemptInput.retryAdmissionReferenceDigest,
            'retryAdmissionReferenceDigest')
      }), (record) => record.kind === 'attempt-start'
        && sameAttemptStart(record, attemptInput));
    },
    appendProviderSettlementReference(
      settlementInput: AppendProviderSettlementInput
    ): SecDurableExecutionJournalObservation {
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
    ): SecDurableExecutionJournalObservation {
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
    ): SecDurableExecutionJournalObservation {
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
    ): SecDurableExecutionJournalObservation {
      return append(resolutionInput, (current) => {
        const attempt = current.activeAttempt;
        if (attempt === null
            || attempt.start.attemptNonceDigest !== resolutionInput.attemptNonceDigest) {
          throw new SecDurableExecutionStoreError(
            'conflict', 'attempt resolution does not target the active attempt.');
        }
        if (attempt.domainReadback?.domainReadbackReceiptDigest
            !== resolutionInput.domainReadbackReceiptDigest) {
          throw new SecDurableExecutionStoreError(
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
