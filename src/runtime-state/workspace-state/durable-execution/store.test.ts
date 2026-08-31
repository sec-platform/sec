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

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-durable-execution-'));
  const stateRoot = path.join(root, 'state');
  const journalRoot = path.join(stateRoot, 'durable-local-executions');
  mkdirSync(stateRoot, { recursive: true });
  const fileSystem = createRuntimeStateJournalFileSystem(
    inspectNoFollowDirectoryChain(stateRoot, 'Durable execution test state root').target
  );
  return {
    root,
    journalRoot,
    fileSystem,
    store: createDurableExecutionStore({ fileSystem, journalRoot })
  };
}

test('OperationKey address is shared across runs and an active attempt cannot be replayed', () => {
  const value = fixture();
  const first = boundOperation('first run');
  const second = boundOperation('second run');
  const identity = durableExecutionJournalIdentity(first);
  try {
    expect(identity).toEqual(durableExecutionJournalIdentity(second));
    value.store.createIntent({
      ...identity,
      intentReferenceDigest: first.plan.identity.intentDigest
    });
    value.store.appendAttemptStart(durableExecutionAttemptStartInput(first, digest('55')));
    expect(() => value.store.appendAttemptStart(
      durableExecutionAttemptStartInput(second, digest('56'))
    )).toThrow('active');
    expect(fdJournalCount(value.journalRoot)).toBe(1);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

function fdJournalCount(root: string): number {
  if (!existsSync(root)) return 0;
  return Array.from(new Bun.Glob('**/*.jsonl').scanSync({ cwd: root, onlyFiles: true })).length;
}

test('journal lineage derives from a live bound operation and rejects structural clones', () => {
  const operation = boundOperation('owner-issued run');
  const identity = durableExecutionJournalIdentity(operation);
  const start = durableExecutionAttemptStartInput(operation, digest('57'));

  expect(identity).toEqual({ operationKeyDigest: operation.plan.identity.identityDigest });
  expect(start).toMatchObject({
    runIdDigest: operation.plan.attempt.runIdDigest,
    resumeEpochDigest: operation.plan.attempt.resumeEpochDigest,
    attemptNonceDigest: operation.plan.attempt.attemptNonceDigest,
    authorityGrantReferenceDigest: operation.plan.attempt.authorityGrantDigest,
    providerBindingSetReferenceDigest: operation.bindingSetIdentityDigest,
    executionPlanReferenceDigest: operation.plan.execution.executionPlanDigest
  });
  expect(() => durableExecutionJournalIdentity({ ...operation }))
    .toThrow('owner-issued bound semantic operation');
});

test('constructing and reading an absent store performs zero filesystem writes', () => {
  const value = fixture();
  const identity = { operationKeyDigest: digest('58') } as const;
  try {
    expect(existsSync(value.journalRoot)).toBe(false);
    expect(value.store.read(identity)).toBeNull();
    expect(existsSync(value.journalRoot)).toBe(false);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});

test('store persists only opaque owner references and retry admission is the sole replay path', () => {
  const value = fixture();
  const first = boundOperation('recoverable run');
  const next = boundOperation('retry run');
  const identity = durableExecutionJournalIdentity(first);
  const attempt = durableExecutionAttemptStartInput(first, digest('59'));
  try {
    value.store.createIntent({ ...identity, intentReferenceDigest: digest('60') });
    value.store.appendAttemptStart(attempt);
    value.store.appendProviderSettlementReference({
      ...identity,
      attemptNonceDigest: attempt.attemptNonceDigest,
      requirementId: 'process.compiler',
      providerBindingDigest: digest('61'),
      providerSettlementReferenceDigest: digest('62')
    });
    value.store.appendDomainReadbackReference({
      ...identity,
      attemptNonceDigest: attempt.attemptNonceDigest,
      readbackContractDigest: digest('63'),
      domainReadbackReferenceDigest: digest('64')
    });
    const admitted = value.store.appendAttemptResolution({
      ...identity,
      attemptNonceDigest: attempt.attemptNonceDigest,
      resolutionKind: 'retry-admission-reference',
      resolutionReferenceDigest: digest('65')
    });
    expect(admitted.latestResolution?.resolutionKind).toBe('retry-admission-reference');
    expect(() => value.store.appendAttemptStart(
      durableExecutionAttemptStartInput(next, digest('66'))
    )).not.toThrow();
    expect(Object.keys(admitted)).not.toContain('effectAuthority');
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
});
