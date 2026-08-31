import { expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { sha256 } from '../../../system-architecture/foundation/runtime/canonical.ts';
import {
  bindSecSemanticOperation,
  compileSecCapabilityBinding,
  compileSecSemanticOperationPlan,
  issueSecSemanticOperationAttemptContext,
  type SecBoundSemanticOperation
} from '../../../system-architecture/operation/semantic.ts';
import { inspectNoFollowDirectoryChain } from '../../physical/runtime/physical-no-follow.ts';
import { createRuntimeStateJournalFileSystem } from '../journal-filesystem.ts';
import { type SecDurableExecutionDigest } from './contract.ts';
import {
  createDurableExecutionStore,
  durableExecutionAttemptStartInput,
  durableExecutionJournalIdentity
} from './store.ts';

const digest = (value: string): SecDurableExecutionDigest =>
  `sha256:${value.padStart(64, '0')}` as SecDurableExecutionDigest;

function boundOperation(): SecBoundSemanticOperation {
  const contractDigest = sha256('durable process contract') as SecDurableExecutionDigest;
  const plan = compileSecSemanticOperationPlan({
    operation: 'development.durable-test',
    intentDigest: sha256('durable intent') as SecDurableExecutionDigest,
    decisionDigest: sha256('durable decision') as SecDurableExecutionDigest,
    deadlineAtUnixMs: 1_900_000_000_000,
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: 10_000 },
      { resource: 'output-bytes', maximum: 1024 },
      { resource: 'processes', maximum: 1 }
    ],
    requirements: [{
      id: 'process.durable-test',
      contractDigest,
      effectKinds: ['process'],
      failureKinds: ['process.failed']
    }],
    attempt: issueSecSemanticOperationAttemptContext({
      authorityGrantDigest: sha256('durable grant') as SecDurableExecutionDigest,
      runIdDigest: sha256('durable run') as SecDurableExecutionDigest,
      resumeEpochDigest: sha256('durable epoch') as SecDurableExecutionDigest
    })
  });
  return bindSecSemanticOperation(plan, [compileSecCapabilityBinding({
    requirementId: 'process.durable-test',
    contractDigest,
    providerIdentityDigest: sha256('durable provider') as SecDurableExecutionDigest
  })]);
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-durable-execution-'));
  const stateRoot = path.join(root, 'state');
  const journalRoot = path.join(stateRoot, 'durable-local-executions', 'v1');
  mkdirSync(stateRoot, { recursive: true });
  const retained = inspectNoFollowDirectoryChain(stateRoot, 'Durable execution fixture').target;
  const fileSystem = createRuntimeStateJournalFileSystem(retained);
  const store = createDurableExecutionStore({ fileSystem, journalRoot });
  return { root, journalRoot, fileSystem, store };
}

test('durable store resumes by OperationKey and runId after the client loses its live handle', () => {
  const value = fixture();
  const identity = { operationKeyDigest: digest('1'), runIdDigest: digest('2') } as const;
  try {
    value.store.createIntent({ ...identity, intentReferenceDigest: digest('3') });
    value.store.appendAttemptStart({
      ...identity,
      resumeEpochDigest: digest('4'),
      attemptNonceDigest: digest('5'),
      workerIdentityDigest: digest('6'),
      authorityGrantReferenceDigest: digest('7'),
      providerBindingSetReferenceDigest: digest('8'),
      executionPlanReferenceDigest: digest('9')
    });
    value.store.appendDomainReadbackReference({
      ...identity,
      attemptNonceDigest: digest('5'),
      readbackClass: 'succeeded',
      domainReadbackReferenceDigest: digest('a')
    });

    const resumed = createDurableExecutionStore({
      fileSystem: value.fileSystem,
      journalRoot: value.journalRoot
    });
    const terminal = resumed.appendTerminal({
      ...identity,
      attemptNonceDigest: digest('5'),
      terminalClass: 'succeeded',
      terminalReferenceDigest: digest('b')
    });
    expect(terminal.latestTerminal).toMatchObject({
      terminalClass: 'succeeded',
      providerSettlementRecordDigest: null
    });
    expect(resumed.read(identity)?.journalDigest).toBe(terminal.journalDigest);
    expect(Object.keys(terminal)).not.toContain('effectAuthority');
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('journal and attempt lineage derive only from one live bound semantic operation', () => {
  const operation = boundOperation();
  const identity = durableExecutionJournalIdentity(operation);
  const start = durableExecutionAttemptStartInput(operation, digest('60'));

  expect(identity).toEqual({
    operationKeyDigest: operation.plan.identity.identityDigest,
    runIdDigest: operation.plan.attempt.runIdDigest
  });
  expect(start).toMatchObject({
    ...identity,
    resumeEpochDigest: operation.plan.attempt.resumeEpochDigest,
    attemptNonceDigest: operation.plan.attempt.attemptNonceDigest,
    authorityGrantReferenceDigest: operation.plan.attempt.authorityGrantDigest,
    providerBindingSetReferenceDigest: operation.bindingSetIdentityDigest,
    executionPlanReferenceDigest: operation.plan.execution.executionPlanDigest
  });
  expect(() => durableExecutionAttemptStartInput(
    structuredClone(operation) as SecBoundSemanticOperation,
    digest('61')
  )).toThrow('owner-issued bound semantic operation');
});

test('constructing and reading an absent store performs zero filesystem writes', () => {
  const value = fixture();
  const identity = { operationKeyDigest: digest('55'), runIdDigest: digest('56') } as const;
  try {
    expect(existsSync(value.journalRoot)).toBe(false);
    expect(value.store.read(identity)).toBeNull();
    expect(existsSync(value.journalRoot)).toBe(false);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('intent and lifecycle appends are idempotent but conflicting intent and false success fail closed', () => {
  const value = fixture();
  const identity = { operationKeyDigest: digest('11'), runIdDigest: digest('12') } as const;
  const attempt = {
    ...identity,
    resumeEpochDigest: digest('13'),
    attemptNonceDigest: digest('14'),
    workerIdentityDigest: digest('15'),
    authorityGrantReferenceDigest: digest('16'),
    providerBindingSetReferenceDigest: digest('17'),
    executionPlanReferenceDigest: digest('18')
  } as const;
  try {
    const created = value.store.createIntent({ ...identity, intentReferenceDigest: digest('19') });
    expect(value.store.createIntent({ ...identity, intentReferenceDigest: digest('19') }).journalDigest)
      .toBe(created.journalDigest);
    expect(() => value.store.createIntent({ ...identity, intentReferenceDigest: digest('20') }))
      .toThrow('already bind another intent');
    const started = value.store.appendAttemptStart(attempt);
    expect(value.store.appendAttemptStart(attempt).journalDigest).toBe(started.journalDigest);
    expect(() => value.store.appendTerminal({
      ...identity,
      attemptNonceDigest: attempt.attemptNonceDigest,
      terminalClass: 'succeeded',
      terminalReferenceDigest: digest('21')
    })).toThrow('requires conclusive succeeded domain readback');
    expect(value.store.read(identity)?.records).toHaveLength(2);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('recovery-required records unresolved execution without manufacturing provider settlement', () => {
  const value = fixture();
  const identity = { operationKeyDigest: digest('22'), runIdDigest: digest('23') } as const;
  try {
    value.store.createIntent({ ...identity, intentReferenceDigest: digest('24') });
    value.store.appendAttemptStart({
      ...identity,
      resumeEpochDigest: digest('25'),
      attemptNonceDigest: digest('26'),
      workerIdentityDigest: digest('27'),
      authorityGrantReferenceDigest: digest('28'),
      providerBindingSetReferenceDigest: digest('29'),
      executionPlanReferenceDigest: digest('30')
    });
    const observation = value.store.appendTerminal({
      ...identity,
      attemptNonceDigest: digest('26'),
      terminalClass: 'recovery-required',
      terminalReferenceDigest: digest('31')
    });
    expect(observation.latestTerminal).toMatchObject({
      terminalClass: 'recovery-required',
      providerSettlementRecordDigest: null,
      domainReadbackRecordDigest: null
    });
    expect(() => value.store.appendAttemptStart({
      ...identity,
      resumeEpochDigest: digest('54'),
      attemptNonceDigest: digest('55'),
      workerIdentityDigest: digest('27'),
      authorityGrantReferenceDigest: digest('28'),
      providerBindingSetReferenceDigest: digest('29'),
      executionPlanReferenceDigest: digest('30')
    })).toThrow('unresolved execution');
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('cancelled terminal requires one cancel request, provider settlement and not-applied readback', () => {
  const value = fixture();
  const identity = { operationKeyDigest: digest('32'), runIdDigest: digest('33') } as const;
  const attemptNonceDigest = digest('34');
  try {
    value.store.createIntent({ ...identity, intentReferenceDigest: digest('35') });
    value.store.appendAttemptStart({
      ...identity,
      resumeEpochDigest: digest('36'),
      attemptNonceDigest,
      workerIdentityDigest: digest('37'),
      authorityGrantReferenceDigest: digest('38'),
      providerBindingSetReferenceDigest: digest('39'),
      executionPlanReferenceDigest: digest('40')
    });
    value.store.appendCancelRequest({
      ...identity, attemptNonceDigest, cancelRequestReferenceDigest: digest('41')
    });
    value.store.appendProviderSettlementReference({
      ...identity, attemptNonceDigest, settlementClass: 'cancelled',
      providerSettlementReferenceDigest: digest('42')
    });
    value.store.appendDomainReadbackReference({
      ...identity, attemptNonceDigest, readbackClass: 'not-applied',
      domainReadbackReferenceDigest: digest('43')
    });
    expect(value.store.appendTerminal({
      ...identity, attemptNonceDigest, terminalClass: 'cancelled',
      terminalReferenceDigest: digest('44')
    }).latestTerminal?.terminalClass).toBe('cancelled');
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('a failed journal CAS is a typed conflict and never replays the event', () => {
  const value = fixture();
  const identity = { operationKeyDigest: digest('45'), runIdDigest: digest('46') } as const;
  try {
    value.store.createIntent({ ...identity, intentReferenceDigest: digest('47') });
    const contended = createDurableExecutionStore({
      journalRoot: value.journalRoot,
      fileSystem: Object.freeze({
        ...value.fileSystem,
        appendFsyncCas: () => false
      })
    });
    expect(() => contended.appendAttemptStart({
      ...identity,
      resumeEpochDigest: digest('48'),
      attemptNonceDigest: digest('49'),
      workerIdentityDigest: digest('50'),
      authorityGrantReferenceDigest: digest('51'),
      providerBindingSetReferenceDigest: digest('52'),
      executionPlanReferenceDigest: digest('53')
    })).toThrow('journal changed during CAS append');
    expect(value.store.read(identity)?.records).toHaveLength(1);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});
