import path from 'node:path';

import {
  assertSecBoundSemanticOperation,
  type SecBoundSemanticOperation
} from '../../../system-architecture/operation/semantic.ts';
import type { RuntimeStateJournalFileSystem } from '../journal-filesystem.ts';
import {
  SEC_DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
  encodeDurableExecutionRecord,
  observeDurableExecutionJournal,
  parseDurableExecutionJournal,
  sealDurableExecutionRecord,
  type SecDurableAttemptResolutionKind,
  type SecDurableExecutionAttemptStartRecord,
  type SecDurableExecutionDigest,
  type SecDurableExecutionJournalObservation,
  type SecDurableExecutionRecord
} from './contract.ts';

export type SecDurableExecutionStoreFailureKind = 'absent' | 'conflict' | 'identity-mismatch';

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
}>;

/**
 * Binds one physical worker to the exact live attempt. No durable record or
 * structural clone can be used as input because the semantic-operation issuer
 * check runs before any journal mutation.
 */
export function durableExecutionAttemptStartInput(
  operation: SecBoundSemanticOperation,
  workerIdentityDigest: SecDurableExecutionDigest
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
    executionPlanReferenceDigest: operation.plan.execution.executionPlanDigest
  });
}
type AppendCancelRequestInput = SecDurableExecutionJournalIdentity & Readonly<{
  attemptNonceDigest: SecDurableExecutionDigest;
  cancelRequestReferenceDigest: SecDurableExecutionDigest;
}>;
type AppendProviderSettlementInput = SecDurableExecutionJournalIdentity & Readonly<{
  attemptNonceDigest: SecDurableExecutionDigest;
  requirementId: string;
  providerBindingDigest: SecDurableExecutionDigest;
  providerSettlementReferenceDigest: SecDurableExecutionDigest;
}>;
type AppendDomainReadbackInput = SecDurableExecutionJournalIdentity & Readonly<{
  attemptNonceDigest: SecDurableExecutionDigest;
  readbackContractDigest: SecDurableExecutionDigest;
  domainReadbackReferenceDigest: SecDurableExecutionDigest;
}>;
type AppendAttemptResolutionInput = SecDurableExecutionJournalIdentity & Readonly<{
  attemptNonceDigest: SecDurableExecutionDigest;
  resolutionKind: SecDurableAttemptResolutionKind;
  resolutionReferenceDigest: SecDurableExecutionDigest;
}>;

export interface SecDurableExecutionStore {
  /** Reads durable observations. The result is never execution or replay authority. */
  read(identity: SecDurableExecutionJournalIdentity): SecDurableExecutionJournalObservation | null;
  createIntent(input: CreateIntentInput): SecDurableExecutionJournalObservation;
  appendAttemptStart(input: AppendAttemptStartInput): SecDurableExecutionJournalObservation;
  appendCancelRequest(input: AppendCancelRequestInput): SecDurableExecutionJournalObservation;
  appendProviderSettlementReference(input: AppendProviderSettlementInput): SecDurableExecutionJournalObservation;
  appendDomainReadbackReference(input: AppendDomainReadbackInput): SecDurableExecutionJournalObservation;
  appendAttemptResolution(input: AppendAttemptResolutionInput): SecDurableExecutionJournalObservation;
}

const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/u;

function canonicalDigest(value: string, label: string): SecDurableExecutionDigest {
  if (!DIGEST_PATTERN.test(value)) {
    throw new SecDurableExecutionStoreError('identity-mismatch', `${label} is not canonical.`);
  }
  return value as SecDurableExecutionDigest;
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
    && record.executionPlanReferenceDigest === input.executionPlanReferenceDigest;
}

export function createDurableExecutionStore(input: Readonly<{
  fileSystem: RuntimeStateJournalFileSystem;
  journalRoot: string;
}>): SecDurableExecutionStore {
  const journalRoot = path.resolve(input.journalRoot);
  if (!path.isAbsolute(input.journalRoot) || !pathInside(journalRoot, input.fileSystem.rootPath)) {
    throw new SecDurableExecutionStoreError(
      'identity-mismatch',
      'journal root must be an absolute descendant of the retained Runtime State root.'
    );
  }
  const read = (
    identity: SecDurableExecutionJournalIdentity
  ): SecDurableExecutionJournalObservation | null => {
    const journalPath = identityPath(journalRoot, identity);
    if (!input.fileSystem.exists(journalPath)) return null;
    const observation = parseDurableExecutionJournal(input.fileSystem.readText(journalPath));
    if (!sameIdentity(observation, identity)) {
      throw new SecDurableExecutionStoreError(
        'identity-mismatch',
        'journal bytes do not match their OperationKey address.'
      );
    }
    return observation;
  };

  const required = (
    identity: SecDurableExecutionJournalIdentity
  ): SecDurableExecutionJournalObservation => {
    const observation = read(identity);
    if (observation === null) {
      throw new SecDurableExecutionStoreError('absent', 'journal intent is absent.');
    }
    return observation;
  };

  const append = (
    identity: SecDurableExecutionJournalIdentity,
    build: (current: SecDurableExecutionJournalObservation) => SecDurableExecutionRecord,
    equivalent: (record: SecDurableExecutionRecord) => boolean
  ): SecDurableExecutionJournalObservation => {
    const current = required(identity);
    const existing = current.records.find(equivalent);
    if (existing !== undefined) return current;
    const record = build(current);
    const next = observeDurableExecutionJournal([...current.records, record]);
    const journalPath = identityPath(journalRoot, identity);
    const expected = current.records.map((entry) => `${encodeDurableExecutionRecord(entry)}\n`).join('');
    const appended = `${encodeDurableExecutionRecord(record)}\n`;
    if (input.fileSystem.appendFsyncCas(journalPath, expected, appended)) return next;
    const concurrent = required(identity);
    if (concurrent.records.some(equivalent)) return concurrent;
    throw new SecDurableExecutionStoreError('conflict', 'journal changed during CAS append.');
  };

  return Object.freeze({
    read,
    createIntent(intentInput: CreateIntentInput): SecDurableExecutionJournalObservation {
      const journalPath = identityPath(journalRoot, intentInput);
      const intent = sealDurableExecutionRecord({
        schema: SEC_DURABLE_LOCAL_EXECUTION_RECORD_SCHEMA,
        kind: 'intent',
        sequence: 0,
        operationKeyDigest: canonicalDigest(intentInput.operationKeyDigest, 'operationKeyDigest'),
        intentReferenceDigest: canonicalDigest(intentInput.intentReferenceDigest, 'intentReferenceDigest'),
        previousRecordDigest: null
      });
      const source = `${encodeDurableExecutionRecord(intent)}\n`;
      if (input.fileSystem.createExclusiveFsync(journalPath, source)) {
        return observeDurableExecutionJournal([intent]);
      }
      const current = required(intentInput);
      if (current.intent.recordDigest === intent.recordDigest) return current;
      throw new SecDurableExecutionStoreError('conflict', 'OperationKey already binds another intent.');
    },
    appendAttemptStart(attemptInput: AppendAttemptStartInput): SecDurableExecutionJournalObservation {
      return append(attemptInput, (current) => sealDurableExecutionRecord({
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
          'executionPlanReferenceDigest')
      }), (record) => record.kind === 'attempt-start'
        && sameAttemptStart(record, attemptInput));
    },
    appendCancelRequest(cancelInput: AppendCancelRequestInput): SecDurableExecutionJournalObservation {
      return append(cancelInput, (current) => sealDurableExecutionRecord({
        ...commonRecord(current, 'cancel-request'),
        attemptNonceDigest: canonicalDigest(cancelInput.attemptNonceDigest, 'attemptNonceDigest'),
        cancelRequestReferenceDigest: canonicalDigest(cancelInput.cancelRequestReferenceDigest,
          'cancelRequestReferenceDigest')
      }), (record) => record.kind === 'cancel-request'
        && record.attemptNonceDigest === cancelInput.attemptNonceDigest
        && record.cancelRequestReferenceDigest === cancelInput.cancelRequestReferenceDigest);
    },
    appendProviderSettlementReference(
      settlementInput: AppendProviderSettlementInput
    ): SecDurableExecutionJournalObservation {
      return append(settlementInput, (current) => sealDurableExecutionRecord({
        ...commonRecord(current, 'provider-settlement-reference'),
        attemptNonceDigest: canonicalDigest(settlementInput.attemptNonceDigest, 'attemptNonceDigest'),
        requirementId: settlementInput.requirementId,
        providerBindingDigest: canonicalDigest(
          settlementInput.providerBindingDigest, 'providerBindingDigest'),
        providerSettlementReferenceDigest: canonicalDigest(
          settlementInput.providerSettlementReferenceDigest, 'providerSettlementReferenceDigest')
      }), (record) => record.kind === 'provider-settlement-reference'
        && record.attemptNonceDigest === settlementInput.attemptNonceDigest
        && record.requirementId === settlementInput.requirementId
        && record.providerBindingDigest === settlementInput.providerBindingDigest
        && record.providerSettlementReferenceDigest === settlementInput.providerSettlementReferenceDigest);
    },
    appendDomainReadbackReference(
      readbackInput: AppendDomainReadbackInput
    ): SecDurableExecutionJournalObservation {
      return append(readbackInput, (current) => sealDurableExecutionRecord({
        ...commonRecord(current, 'domain-readback-reference'),
        attemptNonceDigest: canonicalDigest(readbackInput.attemptNonceDigest, 'attemptNonceDigest'),
        readbackContractDigest: canonicalDigest(
          readbackInput.readbackContractDigest, 'readbackContractDigest'),
        domainReadbackReferenceDigest: canonicalDigest(readbackInput.domainReadbackReferenceDigest,
          'domainReadbackReferenceDigest')
      }), (record) => record.kind === 'domain-readback-reference'
        && record.attemptNonceDigest === readbackInput.attemptNonceDigest
        && record.readbackContractDigest === readbackInput.readbackContractDigest
        && record.domainReadbackReferenceDigest === readbackInput.domainReadbackReferenceDigest);
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
        return sealDurableExecutionRecord({
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
