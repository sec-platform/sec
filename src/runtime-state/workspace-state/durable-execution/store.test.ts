import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { sha256 } from '../../../system-architecture/foundation/runtime/canonical.ts';
import {
  bindSecSemanticOperation,
  compileSecCapabilityBinding,
  compileSecSemanticOperationPlan,
  issueSecProviderSettlementReceipt,
  issueSecRecoveredDomainReadbackReceipt,
  issueSecRecoveredOwnerTerminalJoinReceipt,
  issueSecRecoveredRetryAdmission,
  issueSecSemanticOperationAttemptContext,
  type SecBoundSemanticOperation
} from '../../../system-architecture/operation/semantic.ts';
import { inspectNoFollowDirectoryChain } from '../../physical/runtime/physical-no-follow.ts';
import { createRuntimeStateJournalFileSystem } from '../journal-filesystem.ts';
import { type SecDurableExecutionDigest } from './contract.ts';
import {
  createDurableExecutionStore,
  createDurableExecutionWriter,
  durableExecutionJournalIdentity,
  type SecDurableExecutionStoreLimits
} from './store.ts';

const digest = (value: string): SecDurableExecutionDigest =>
  `sha256:${value.padStart(64, '0')}` as SecDurableExecutionDigest;

function boundOperation(run: string): SecBoundSemanticOperation {
  const contractDigest = sha256('durable execution contract') as SecDurableExecutionDigest;
  const plan = compileSecSemanticOperationPlan({
    operation: 'runtime.durable-execution-test',
    intentDigest: digest('50'),
    decisionDigest: digest('51'),
    deadlineAtUnixMs: Date.now() + 30_000,
    aggregateBudgets: [{ resource: 'records', maximum: 16 }],
    requirements: [{
      id: 'runtime.journal', contractDigest,
      effectKinds: ['persistent-state'], failureKinds: ['runtime.journal-failed']
    }],
    attempt: issueSecSemanticOperationAttemptContext({
      authorityGrantDigest: digest('52'),
      runIdDigest: sha256(run) as SecDurableExecutionDigest,
      resumeEpochDigest: digest('53')
    })
  });
  return bindSecSemanticOperation(plan, [compileSecCapabilityBinding({
    requirementId: plan.execution.requirements[0]!.id,
    contractDigest,
    providerIdentityDigest: digest('54')
  })]);
}

function limits(
  overrides: Partial<Omit<SecDurableExecutionStoreLimits, 'deadlineAtMonotonicMs'>> = {}
): SecDurableExecutionStoreLimits {
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
  overrides: Partial<Omit<SecDurableExecutionStoreLimits, 'deadlineAtMonotonicMs'>> = {}
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
  try {
    expect(identity).toEqual(durableExecutionJournalIdentity(second));
    value.store.createIntent(first);
    value.store.appendInitialAttemptStart(first, digest('55'));
    expect(() => value.store.appendInitialAttemptStart(second, digest('56'))).toThrow('active');
    expect(fdJournalCount(value.journalRoot)).toBe(1);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

function fdJournalCount(root: string): number {
  if (!existsSync(root)) return 0;
  return Array.from(new Bun.Glob('**/*.jsonl').scanSync({ cwd: root, onlyFiles: true })).length;
}

function journalPath(root: string, operationKeyDigest: SecDurableExecutionDigest): string {
  return path.join(root, `${operationKeyDigest.slice(7)}.jsonl`);
}

test('journal lineage derives from a live bound operation and rejects structural clones', () => {
  const value = fixture();
  const operation = boundOperation('owner-issued run');
  const identity = durableExecutionJournalIdentity(operation);
  try {
    value.store.createIntent(operation);
    const observation = value.store.appendInitialAttemptStart(operation, digest('57'));
    expect(identity).toEqual({ operationKeyDigest: operation.plan.identity.identityDigest });
    expect(observation.activeAttempt?.start).toMatchObject({
      runIdDigest: operation.plan.attempt.runIdDigest,
      resumeEpochDigest: operation.plan.attempt.resumeEpochDigest,
      attemptNonceDigest: operation.plan.attempt.attemptNonceDigest,
      authorityGrantReferenceDigest: operation.plan.attempt.authorityGrantDigest,
      providerBindingSetReferenceDigest: operation.bindingSetIdentityDigest,
      executionPlanReferenceDigest: operation.plan.execution.executionPlanDigest,
      retryAdmissionReferenceDigest: null
    });
    expect(() => value.store.appendInitialAttemptStart({ ...operation }, digest('58')))
      .toThrow('owner-issued bound semantic operation');
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('provider and domain observations require their exact issuer receipts', () => {
  const value = fixture();
  const operation = boundOperation('issuer-bound observations');
  const providerReceipt = issueSecProviderSettlementReceipt(operation, {
    requirementId: 'runtime.journal',
    physicalDisposition: 'settled',
    providerSettlementReferenceDigest: digest('87')
  });
  try {
    value.store.createIntent(operation);
    value.store.appendInitialAttemptStart(operation, digest('92'));
    expect(value.store.appendProviderSettlement(operation, providerReceipt)
      .activeAttempt?.providerSettlements[0]).toMatchObject({
        requirementId: 'runtime.journal',
        providerReceiptDigest: providerReceipt.providerReceiptDigest
      });
    expect(() => value.store.appendProviderSettlement(operation, { ...providerReceipt }))
      .toThrow('not provider-issued');

    const readback = issueSecRecoveredDomainReadbackReceipt(operation, {
      durableObservationDigest: digest('88'),
      readbackContractDigest: digest('89'),
      readbackReferenceDigest: digest('90'),
      currentPhysicalEpochDigest: digest('91'),
      disposition: 'unknown'
    });
    expect(value.store.appendDomainReadback(operation, readback).activeAttempt?.domainReadback)
      .toMatchObject({ domainReadbackReceiptDigest: readback.readbackReceiptDigest });
    expect(() => value.store.appendDomainReadback(operation, { ...readback }))
      .toThrow('not domain-issued');
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('owner terminal resolution references only an exact owner-issued join receipt', () => {
  const value = fixture();
  const operation = boundOperation('owner terminal join');
  const recoveredReadback = issueSecRecoveredDomainReadbackReceipt(operation, {
    durableObservationDigest: digest('81'),
    readbackContractDigest: digest('82'),
    readbackReferenceDigest: digest('83'),
    currentPhysicalEpochDigest: digest('84'),
    disposition: 'applied'
  });
  const join = issueSecRecoveredOwnerTerminalJoinReceipt(operation, recoveredReadback, {
    ownerTerminalContractDigest: digest('85'),
    ownerTerminalReferenceDigest: digest('86')
  });
  try {
    value.store.createIntent(operation);
    value.store.appendInitialAttemptStart(operation, digest('92'));
    value.store.appendDomainReadback(operation, recoveredReadback);
    expect(value.store.appendOwnerTerminalResolution(operation, join).latestResolution)
      .toMatchObject({
        resolutionKind: 'owner-terminal-reference',
        resolutionReferenceDigest: join.joinReceiptDigest
      });
    expect(() => value.store.appendOwnerTerminalResolution(operation, { ...join }))
      .toThrow('not owner-issued');
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('constructing and reading an absent store performs zero filesystem writes', () => {
  const value = fixture();
  const identity = { operationKeyDigest: digest('58') } as const;
  try {
    expect(existsSync(value.journalRoot)).toBe(false);
    expect(value.reader.read(identity)).toBeNull();
    expect(existsSync(value.journalRoot)).toBe(false);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('expired monotonic admission is rejected before any journal path observation or write', () => {
  const value = fixture();
  try {
    expect(() => createDurableExecutionStore({
      fileSystem: value.fileSystem,
      journalRoot: value.journalRoot,
      limits: { ...value.storeLimits, deadlineAtMonotonicMs: performance.now() - 1 }
    })).toThrow('unexpired finite absolute monotonic deadline');
    expect(existsSync(value.journalRoot)).toBe(false);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('lost handle requires recovered readback and consumed owner admission before retry', () => {
  const value = fixture();
  const first = boundOperation('recoverable run');
  const next = boundOperation('retry run');
  try {
    value.store.createIntent(first);
    value.store.appendInitialAttemptStart(first, digest('59'));
    const providerReceipt = issueSecProviderSettlementReceipt(first, {
      requirementId: 'runtime.journal',
      physicalDisposition: 'unknown',
      providerSettlementReferenceDigest: digest('62')
    });
    value.store.appendLostHandle(first, providerReceipt);
    const recoveredReadback = issueSecRecoveredDomainReadbackReceipt(first, {
      durableObservationDigest: digest('63'),
      readbackContractDigest: digest('64'),
      readbackReferenceDigest: digest('65'),
      currentPhysicalEpochDigest: digest('66'),
      disposition: 'not-applied'
    });
    value.store.appendDomainReadback(first, recoveredReadback);
    const retryAdmission = issueSecRecoveredRetryAdmission(recoveredReadback);
    const admitted = value.store.appendRetryAdmissionResolution(first, retryAdmission);
    expect(admitted.latestResolution?.resolutionKind).toBe('retry-admission-reference');
    expect(() => value.store.appendRetryAttemptStart(next, digest('66'), retryAdmission))
      .not.toThrow();
    expect(Object.keys(admitted)).not.toContain('effectAuthority');
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('attempt boundary plus one is rejected before CAS and preserves exact journal bytes', () => {
  const value = fixture({
    maximumRecords: 8,
    maximumAttempts: 1,
    maximumProviderSettlementsPerAttempt: 0
  });
  const first = boundOperation('bounded first run');
  const next = boundOperation('bounded retry run');
  const identity = durableExecutionJournalIdentity(first);
  const filePath = journalPath(value.journalRoot, identity.operationKeyDigest);
  try {
    value.store.createIntent(first);
    value.store.appendInitialAttemptStart(first, digest('70'));
    const recoveredReadback = issueSecRecoveredDomainReadbackReceipt(first, {
      durableObservationDigest: digest('72'),
      readbackContractDigest: digest('73'),
      readbackReferenceDigest: digest('74'),
      currentPhysicalEpochDigest: digest('75'),
      disposition: 'not-applied'
    });
    value.store.appendDomainReadback(first, recoveredReadback);
    const retryAdmission = issueSecRecoveredRetryAdmission(recoveredReadback);
    value.store.appendRetryAdmissionResolution(first, retryAdmission);
    const before = readFileSync(filePath);
    expect(() => value.store.appendRetryAttemptStart(next, digest('76'), retryAdmission))
      .toThrow('complete bounded attempt-settlement closure');
    expect(readFileSync(filePath)).toEqual(before);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
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
  try {
    value.store.createIntent(operation);
    const before = readFileSync(filePath);
    expect(() => value.store.appendInitialAttemptStart(operation, digest('77')))
      .toThrow('complete bounded attempt-settlement closure');
    expect(readFileSync(filePath)).toEqual(before);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('retained reader rejects an existing oversized journal before parsing or allocating it', () => {
  const value = fixture({ maximumStateBytes: 1_024 });
  const identity = { operationKeyDigest: digest('78') } as const;
  const filePath = journalPath(value.journalRoot, identity.operationKeyDigest);
  try {
    mkdirSync(value.journalRoot, { recursive: true });
    writeFileSync(filePath, 'x'.repeat(1_025), 'utf8');
    expect(() => value.reader.read(identity)).toThrow('exceeds maximumBytes 1024');
    expect(readFileSync(filePath).byteLength).toBe(1_025);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('failed CAS append is conflict-only and leaves the preimage byte-exact', () => {
  const value = fixture({ maximumProviderSettlementsPerAttempt: 0 });
  const operation = boundOperation('cas conflict');
  const identity = durableExecutionJournalIdentity(operation);
  const filePath = journalPath(value.journalRoot, identity.operationKeyDigest);
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
      .toThrow('changed during CAS append');
    expect(readFileSync(filePath)).toEqual(before);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});
