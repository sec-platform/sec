import { settleResources, type ResourceSettlementFailure } from '../../../../execution/resource-settlement.ts';
import { beforeEach, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { sha256 } from '../../../../contracts/canonical.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueProviderSettlementReceipt,
  issueRecoveredDomainReadbackReceipt,
  issueRecoveredOwnerTerminalJoinReceipt,
  issueRecoveredRetryAdmission,
  issueSemanticOperationAttemptContext,
  type BoundSemanticOperation
} from '../../../../execution/operation/semantic.ts';
import { inspectNoFollowDirectoryChain } from '../../physical/runtime/physical-no-follow.ts';
import { createRuntimeStateJournalFileSystem } from '../journal-filesystem.ts';
import { type DurableExecutionDigest } from './contract.ts';
import {
  createDurableExecutionStore,
  createDurableExecutionWriter,
  durableExecutionJournalIdentity,
  durableExecutionPredecessorAttemptReference,
  type DurableExecutionStoreLimits
} from './store.ts';

const digest = (value: string): DurableExecutionDigest =>
  `sha256:${value.padStart(64, '0')}` as DurableExecutionDigest;
let operationDeadlineAtUnixMs: number;

beforeEach(() => {
  operationDeadlineAtUnixMs = Date.now() + 30_000;
});

function boundOperation(
  run: string,
  input: Readonly<{
    authorityGrantDigest?: DurableExecutionDigest;
    resumeEpochDigest?: DurableExecutionDigest | null;
    deadlineAtUnixMs?: number;
  }> = {}
): BoundSemanticOperation {
  const contractDigest = sha256('durable execution contract') as DurableExecutionDigest;
  const plan = compileSemanticOperationPlan({
    operation: 'runtime.durable-execution-test',
    intentDigest: digest('50'),
    decisionDigest: digest('51'),
    deadlineAtUnixMs: input.deadlineAtUnixMs ?? operationDeadlineAtUnixMs,
    aggregateBudgets: [{ resource: 'records', maximum: 16 }],
    requirements: [{
      id: 'runtime.journal', contractDigest,
      effectKinds: ['persistent-state'], failureKinds: ['runtime.journal-failed']
    }],
    attempt: issueSemanticOperationAttemptContext({
      authorityGrantDigest: input.authorityGrantDigest ?? digest('52'),
      runIdDigest: sha256(run) as DurableExecutionDigest,
      resumeEpochDigest: input.resumeEpochDigest === undefined ? digest('53') : input.resumeEpochDigest
    })
  });
  return bindSemanticOperation(plan, [compileCapabilityBinding({
    requirementId: plan.execution.requirements[0]!.id,
    contractDigest,
    providerIdentityDigest: digest('54')
  })]);
}

function recoveryOperation(run: string): BoundSemanticOperation {
  return boundOperation(run, {
    authorityGrantDigest: digest('152'),
    resumeEpochDigest: digest('153')
  });
}

function limits(
  overrides: Partial<Omit<DurableExecutionStoreLimits, 'deadlineAtMonotonicMs'>> = {}
): DurableExecutionStoreLimits {
  return Object.freeze({
    deadlineAtMonotonicMs: performance.now() + 30_000,
    maximumRecords: 32,
    maximumStateBytes: 128 * 1024,
    maximumAttempts: 2,
    maximumProviderSettlementsPerAttempt: 2,
    ...overrides
  });
}

function fixture(
  overrides: Partial<Omit<DurableExecutionStoreLimits, 'deadlineAtMonotonicMs'>> = {}
) {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-durable-execution-'));
  const stateRoot = path.join(root, 'state');
  const journalRoot = path.join(stateRoot, 'durable-local-executions');
  mkdirSync(stateRoot, { recursive: true });
  const fileSystem = createRuntimeStateJournalFileSystem(
    inspectNoFollowDirectoryChain(stateRoot, 'Durable execution test state root').target
  );
  const storeLimits = limits(overrides);
  return {
    root,
    journalRoot,
    fileSystem,
    storeLimits,
    reader: createDurableExecutionStore({ fileSystem, journalRoot, limits: storeLimits }),
    store: createDurableExecutionWriter({ fileSystem, journalRoot, limits: storeLimits })
  };
}

test('OperationKey address is shared across runs and an active attempt cannot be replayed', () => {
  const value = fixture();
  const first = boundOperation('first run');
  const second = boundOperation('second run');
  const identity = durableExecutionJournalIdentity(first);
  let fixtureFailure11: ResourceSettlementFailure | undefined;
  try {
    expect(identity).toEqual(durableExecutionJournalIdentity(second));
    value.store.createIntent(first);
    value.store.appendInitialAttemptStart(first, digest('55'));
    expect(() => value.store.appendInitialAttemptStart(second, digest('56'))).toThrow('active');
    expect(fdJournalCount(value.journalRoot)).toBe(1);
  } catch (error) {
    fixtureFailure11 = { label: 'fixture operation', error };
  } finally {
    settleResources({
      primary: fixtureFailure11,
      cleanup: [{ label: 'fixture cleanup', settle: () => { rmSync(value.root, { recursive: true, force: true }); } }]
    });
  }
});

function fdJournalCount(root: string): number {
  if (!existsSync(root)) return 0;
  return Array.from(new Bun.Glob('**/*.jsonl').scanSync({ cwd: root, onlyFiles: true })).length;
}

function journalPath(root: string, operationKeyDigest: DurableExecutionDigest): string {
  return path.join(root, `${operationKeyDigest.slice(7)}.jsonl`);
}

test('journal lineage derives from a foundation-compiled operation and rejects a foreign plan', () => {
  const value = fixture();
  const operation = boundOperation('owner-issued run');
  const identity = durableExecutionJournalIdentity(operation);
  let fixtureFailure10: ResourceSettlementFailure | undefined;
  try {
    value.store.createIntent(operation);
    const observation = value.store.appendInitialAttemptStart(operation, digest('57'));
    expect(identity).toEqual({ operationKeyDigest: operation.plan.identity.identityDigest });
    expect(observation.activeAttempt?.start).toMatchObject({
      runIdDigest: operation.plan.attempt.runIdDigest,
      resumeEpochDigest: operation.plan.attempt.resumeEpochDigest,
      attemptNonceDigest: operation.plan.attempt.attemptNonceDigest,
      boundAttemptDigest: operation.boundAttemptDigest,
      authorityGrantReferenceDigest: operation.plan.attempt.authorityGrantDigest,
      providerBindingSetReferenceDigest: operation.bindingSetIdentityDigest,
      executionPlanReferenceDigest: operation.plan.execution.executionPlanDigest,
      deadlineAtUnixMs: operation.plan.attempt.deadlineAtUnixMs,
      retryAdmissionReferenceDigest: null
    });
    expect(observation.state).toBe('running');
    expect(() => value.store.appendInitialAttemptStart({
      ...operation,
      plan: { ...operation.plan }
    } as BoundSemanticOperation, digest('58'))).toThrow('foundation-compiled operation plan');
  } catch (error) {
    fixtureFailure10 = { label: 'fixture operation', error };
  } finally {
    settleResources({
      primary: fixtureFailure10,
      cleanup: [{ label: 'fixture cleanup', settle: () => { rmSync(value.root, { recursive: true, force: true }); } }]
    });
  }
});

test('provider and domain observations require their exact issuer receipts', () => {
  const value = fixture();
  const operation = boundOperation('issuer-bound observations');
  const providerReceipt = issueProviderSettlementReceipt(operation, {
    requirementId: 'runtime.journal',
    physicalDisposition: 'settled',
    providerSettlementReferenceDigest: digest('87')
  });
  let fixtureFailure9: ResourceSettlementFailure | undefined;
  try {
    value.store.createIntent(operation);
    const started = value.store.appendInitialAttemptStart(operation, digest('92'));
    expect(value.store.appendProviderSettlement(operation, providerReceipt)
      .activeAttempt?.providerSettlements[0]).toMatchObject({
        requirementId: 'runtime.journal',
        providerReceiptDigest: providerReceipt.providerReceiptDigest
      });
    expect(() => value.store.appendProviderSettlement(operation, {
      ...providerReceipt,
      providerSettlementReferenceDigest: digest('999')
    })).toThrow('projection digest is invalid');

    const recovery = recoveryOperation('issuer-bound observation recovery');
    const readback = issueRecoveredDomainReadbackReceipt(recovery, {
      predecessor: durableExecutionPredecessorAttemptReference(started),
      durableObservationDigest: digest('88'),
      readbackContractDigest: digest('89'),
      readbackReferenceDigest: digest('90'),
      currentPhysicalEpochDigest: digest('91'),
      disposition: 'unknown'
    });
    expect(value.store.appendDomainReadback(recovery, readback).activeAttempt?.domainReadback)
      .toMatchObject({ domainReadbackReceiptDigest: readback.readbackReceiptDigest });
    expect(() => value.store.appendDomainReadback(recovery, {
      ...readback,
      readbackReferenceDigest: digest('998')
    })).toThrow('projection digest is invalid');
  } catch (error) {
    fixtureFailure9 = { label: 'fixture operation', error };
  } finally {
    settleResources({
      primary: fixtureFailure9,
      cleanup: [{ label: 'fixture cleanup', settle: () => { rmSync(value.root, { recursive: true, force: true }); } }]
    });
  }
});

test('owner terminal resolution references only an exact owner-issued join receipt', () => {
  const value = fixture();
  const operation = boundOperation('owner terminal join');
  let fixtureFailure8: ResourceSettlementFailure | undefined;
  try {
    value.store.createIntent(operation);
    const started = value.store.appendInitialAttemptStart(operation, digest('92'));
    const recovery = recoveryOperation('owner terminal recovery');
    const recoveredReadback = issueRecoveredDomainReadbackReceipt(recovery, {
      predecessor: durableExecutionPredecessorAttemptReference(started),
      durableObservationDigest: digest('81'),
      readbackContractDigest: digest('82'),
      readbackReferenceDigest: digest('83'),
      currentPhysicalEpochDigest: digest('84'),
      disposition: 'applied'
    });
    const join = issueRecoveredOwnerTerminalJoinReceipt(recovery, recoveredReadback, {
      ownerTerminalContractDigest: digest('85'),
      ownerTerminalReferenceDigest: digest('86')
    });
    value.store.appendDomainReadback(recovery, recoveredReadback);
    expect(value.store.appendOwnerTerminalResolution(recovery, join).latestResolution)
      .toMatchObject({
        resolutionKind: 'owner-terminal-reference',
        resolutionReferenceDigest: join.joinReceiptDigest
      });
    expect(value.store.read(durableExecutionJournalIdentity(operation))).toMatchObject({
      state: 'settled', activeAttempt: null
    });
    expect(() => value.store.appendInitialAttemptStart(boundOperation('post-terminal run'), digest('93')))
      .toThrow('owner-terminal');
    expect(() => value.store.appendOwnerTerminalResolution(recovery, {
      ...join,
      ownerTerminalReferenceDigest: digest('997')
    })).toThrow('projection digest is invalid');
  } catch (error) {
    fixtureFailure8 = { label: 'fixture operation', error };
  } finally {
    settleResources({
      primary: fixtureFailure8,
      cleanup: [{ label: 'fixture cleanup', settle: () => { rmSync(value.root, { recursive: true, force: true }); } }]
    });
  }
});

test('store construction, expired admission and absent reads do not create the journal directory', () => {
  const value = fixture();
  const identity = { operationKeyDigest: digest('58') } as const;
  let fixtureFailure7: ResourceSettlementFailure | undefined;
  try {
    expect(existsSync(value.journalRoot)).toBe(false);
    expect(() => createDurableExecutionStore({
      fileSystem: value.fileSystem,
      journalRoot: value.journalRoot,
      limits: { ...value.storeLimits, deadlineAtMonotonicMs: performance.now() - 1 }
    })).toThrow(expect.objectContaining({ kind: 'deadline-exhausted' }));
    expect(existsSync(value.journalRoot)).toBe(false);
    expect(value.reader.read(identity)).toBeNull();
    expect(existsSync(value.journalRoot)).toBe(false);
  } catch (error) {
    fixtureFailure7 = { label: 'fixture operation', error };
  } finally {
    settleResources({
      primary: fixtureFailure7,
      cleanup: [{ label: 'fixture cleanup', settle: () => { rmSync(value.root, { recursive: true, force: true }); } }]
    });
  }
});

test('lost handle requires recovered readback and consumed owner admission before retry', () => {
  const value = fixture();
  const first = boundOperation('recoverable run');
  const recovery = recoveryOperation('recoverable readback run');
  let fixtureFailure6: ResourceSettlementFailure | undefined;
  try {
    value.store.createIntent(first);
    const started = value.store.appendInitialAttemptStart(first, digest('59'));
    const providerReceipt = issueProviderSettlementReceipt(first, {
      requirementId: 'runtime.journal',
      physicalDisposition: 'unknown',
      providerSettlementReferenceDigest: digest('62')
    });
    expect(value.store.appendLostHandle(first, providerReceipt).state).toBe('lost-handle');
    expect(() => value.store.appendInitialAttemptStart(boundOperation('premature retry run'), digest('60')))
      .toThrow('active');
    const recoveredReadback = issueRecoveredDomainReadbackReceipt(recovery, {
      predecessor: durableExecutionPredecessorAttemptReference(started),
      durableObservationDigest: digest('63'),
      readbackContractDigest: digest('64'),
      readbackReferenceDigest: digest('65'),
      currentPhysicalEpochDigest: digest('66'),
      disposition: 'not-applied'
    });
    value.store.appendDomainReadback(recovery, recoveredReadback);
    const retryAdmission = issueRecoveredRetryAdmission(recovery, recoveredReadback);
    const successor = boundOperation('retry run', {
      authorityGrantDigest: recovery.plan.attempt.authorityGrantDigest,
      resumeEpochDigest: recovery.plan.attempt.resumeEpochDigest
    });
    const admitted = value.store.appendRecoveredRetryAttemptStart(
      recovery,
      successor,
      digest('66'),
      retryAdmission,
      recoveredReadback.currentPhysicalEpochDigest
    );
    expect(admitted.latestResolution?.resolutionKind).toBe('retry-admission-reference');
    expect(admitted.state).toBe('running');
    expect(admitted.activeAttempt?.start.runIdDigest).toBe(successor.plan.attempt.runIdDigest);
    expect(admitted.activeAttempt?.start.attemptNonceDigest)
      .toBe(successor.plan.attempt.attemptNonceDigest);
    expect(() => value.store.appendRecoveredRetryAttemptStart(
      recovery,
      successor,
      digest('66'),
      retryAdmission,
      recoveredReadback.currentPhysicalEpochDigest
    )).toThrow('already consumed');
    expect(Object.keys(admitted)).not.toContain('effectAuthority');
  } catch (error) {
    fixtureFailure6 = { label: 'fixture operation', error };
  } finally {
    settleResources({
      primary: fixtureFailure6,
      cleanup: [{ label: 'fixture cleanup', settle: () => { rmSync(value.root, { recursive: true, force: true }); } }]
    });
  }
});

test('a restarted writer recovers from durable predecessor coordinates without reconstructing the old operation', () => {
  const value = fixture();
  const first = boundOperation('process-before-crash');
  const identity = durableExecutionJournalIdentity(first);
  let fixtureFailure5: ResourceSettlementFailure | undefined;
  try {
    value.store.createIntent(first);
    value.store.appendInitialAttemptStart(first, digest('160'));
    const lost = issueProviderSettlementReceipt(first, {
      requirementId: 'runtime.journal',
      physicalDisposition: 'unknown',
      providerSettlementReferenceDigest: digest('161')
    });
    value.store.appendLostHandle(first, lost);

    const restartedReader = createDurableExecutionStore({
      fileSystem: value.fileSystem,
      journalRoot: value.journalRoot,
      limits: value.storeLimits
    });
    const durableObservation = restartedReader.read(identity);
    expect(durableObservation?.state).toBe('lost-handle');
    const predecessor = durableExecutionPredecessorAttemptReference(durableObservation!);
    const recovery = recoveryOperation('process-after-crash');
    const readback = issueRecoveredDomainReadbackReceipt(recovery, {
      predecessor,
      durableObservationDigest: durableObservation!.journalDigest,
      readbackContractDigest: digest('162'),
      readbackReferenceDigest: digest('163'),
      currentPhysicalEpochDigest: digest('164'),
      disposition: 'applied'
    });
    const restartedWriter = createDurableExecutionWriter({
      fileSystem: value.fileSystem,
      journalRoot: value.journalRoot,
      limits: value.storeLimits
    });
    restartedWriter.appendDomainReadback(recovery, readback);
    const terminal = issueRecoveredOwnerTerminalJoinReceipt(recovery, readback, {
      ownerTerminalContractDigest: digest('165'),
      ownerTerminalReferenceDigest: digest('166')
    });
    expect(restartedWriter.appendOwnerTerminalResolution(recovery, terminal).state).toBe('settled');
  } catch (error) {
    fixtureFailure5 = { label: 'fixture operation', error };
  } finally {
    settleResources({
      primary: fixtureFailure5,
      cleanup: [{ label: 'fixture cleanup', settle: () => { rmSync(value.root, { recursive: true, force: true }); } }]
    });
  }
});

test('attempt boundary plus one is rejected before CAS and preserves exact journal bytes', () => {
  const value = fixture({
    maximumRecords: 8,
    maximumAttempts: 1,
    maximumProviderSettlementsPerAttempt: 0
  });
  const first = boundOperation('bounded first run');
  const recovery = recoveryOperation('bounded recovery run');
  const identity = durableExecutionJournalIdentity(first);
  const filePath = journalPath(value.journalRoot, identity.operationKeyDigest);
  let fixtureFailure4: ResourceSettlementFailure | undefined;
  try {
    value.store.createIntent(first);
    const started = value.store.appendInitialAttemptStart(first, digest('70'));
    const recoveredReadback = issueRecoveredDomainReadbackReceipt(recovery, {
      predecessor: durableExecutionPredecessorAttemptReference(started),
      durableObservationDigest: digest('72'),
      readbackContractDigest: digest('73'),
      readbackReferenceDigest: digest('74'),
      currentPhysicalEpochDigest: digest('75'),
      disposition: 'not-applied'
    });
    value.store.appendDomainReadback(recovery, recoveredReadback);
    const retryAdmission = issueRecoveredRetryAdmission(recovery, recoveredReadback);
    const before = readFileSync(filePath);
    expect(() => value.store.appendRecoveredRetryAttemptStart(
      recovery,
      boundOperation('bounded retry run', {
        authorityGrantDigest: recovery.plan.attempt.authorityGrantDigest,
        resumeEpochDigest: recovery.plan.attempt.resumeEpochDigest
      }), digest('76'), retryAdmission, recoveredReadback.currentPhysicalEpochDigest
    ))
      .toThrow('complete bounded attempt-settlement closure');
    expect(readFileSync(filePath)).toEqual(before);
  } catch (error) {
    fixtureFailure4 = { label: 'fixture operation', error };
  } finally {
    settleResources({
      primary: fixtureFailure4,
      cleanup: [{ label: 'fixture cleanup', settle: () => { rmSync(value.root, { recursive: true, force: true }); } }]
    });
  }
});

test('attempt start reserves its worst settlement closure before changing bytes', () => {
  const value = fixture({
    maximumRecords: 16,
    maximumStateBytes: 8 * 1024,
    maximumAttempts: 1,
    maximumProviderSettlementsPerAttempt: 2
  });
  const operation = boundOperation('oversize reservation');
  const identity = durableExecutionJournalIdentity(operation);
  const filePath = journalPath(value.journalRoot, identity.operationKeyDigest);
  let fixtureFailure3: ResourceSettlementFailure | undefined;
  try {
    value.store.createIntent(operation);
    const before = readFileSync(filePath);
    expect(() => value.store.appendInitialAttemptStart(operation, digest('77')))
      .toThrow('complete bounded attempt-settlement closure');
    expect(readFileSync(filePath)).toEqual(before);
  } catch (error) {
    fixtureFailure3 = { label: 'fixture operation', error };
  } finally {
    settleResources({
      primary: fixtureFailure3,
      cleanup: [{ label: 'fixture cleanup', settle: () => { rmSync(value.root, { recursive: true, force: true }); } }]
    });
  }
});

test('retained reader rejects an existing oversized journal and preserves its size', () => {
  const value = fixture({ maximumStateBytes: 1_024 });
  const identity = { operationKeyDigest: digest('78') } as const;
  const filePath = journalPath(value.journalRoot, identity.operationKeyDigest);
  let fixtureFailure2: ResourceSettlementFailure | undefined;
  try {
    mkdirSync(value.journalRoot, { recursive: true });
    writeFileSync(filePath, 'x'.repeat(1_025), 'utf8');
    expect(() => value.reader.read(identity)).toThrow('exceeds maximumBytes 1024');
    expect(readFileSync(filePath).byteLength).toBe(1_025);
  } catch (error) {
    fixtureFailure2 = { label: 'fixture operation', error };
  } finally {
    settleResources({
      primary: fixtureFailure2,
      cleanup: [{ label: 'fixture cleanup', settle: () => { rmSync(value.root, { recursive: true, force: true }); } }]
    });
  }
});

test('failed CAS append is conflict-only and leaves the preimage byte-exact', () => {
  const value = fixture({ maximumProviderSettlementsPerAttempt: 0 });
  const operation = boundOperation('cas conflict');
  const identity = durableExecutionJournalIdentity(operation);
  const filePath = journalPath(value.journalRoot, identity.operationKeyDigest);
  let fixtureFailure1: ResourceSettlementFailure | undefined;
  try {
    value.store.createIntent(operation);
    const before = readFileSync(filePath);
    const conflicting = createDurableExecutionWriter({
      fileSystem: Object.freeze({
        ...value.fileSystem,
        appendFsyncCas: () => false
      }),
      journalRoot: value.journalRoot,
      limits: value.storeLimits
    });
    expect(() => conflicting.appendInitialAttemptStart(operation, digest('80')))
      .toThrow(expect.objectContaining({ kind: 'conflict' }));
    expect(readFileSync(filePath)).toEqual(before);
  } catch (error) {
    fixtureFailure1 = { label: 'fixture operation', error };
  } finally {
    settleResources({
      primary: fixtureFailure1,
      cleanup: [{ label: 'fixture cleanup', settle: () => { rmSync(value.root, { recursive: true, force: true }); } }]
    });
  }
});
