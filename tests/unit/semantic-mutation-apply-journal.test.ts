import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import {
  appendSemanticMutationRecoveryRecord,
  loadSemanticMutationRecoveryRecords
} from '../../src/adapters/mutation/mutation-recovery-record.ts';
import { semanticMutationTransactionRoot } from '../../src/adapters/mutation/transaction-identity.ts';
import {
  executePreparedSemanticMutationApply,
  prepareSemanticMutationApply,
  type ReadySemanticMutationApplyDerivation,
  type SemanticMutationApplyExecutionOperations
} from '../../src/application/semantic-mutation-apply.ts';
import type { SemanticMutationRecoveryRecordDraft } from '../../src/application/semantic-mutation-recovery.ts';
import type { SemanticMutationRecoveryRecord } from '../../src/semantics/mutation/transaction.ts';
import {
  acceptedResult,
  digest,
  readyTransactionFixture,
  recoveryDraft,
  rolledBackResult
} from '../helpers/semantic-mutation-recovery-fixture.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

const requestId = 'request:apply-journal-owner';
const fixture = readyTransactionFixture(requestId);
const expectedPrepared = recoveryDraft(requestId);
const preparation = prepareSemanticMutationApply({
  request: fixture.request,
  base: fixture.base,
  authorization: fixture.auth,
  expectedPlanRevision: fixture.plan.planRevision
});
if (preparation.status !== 'ready') throw new Error('Expected a valid apply request');
const prepared = preparation.prepared;

// This suite observes application decisions at the real journal writer. Source
// derivation, verification and live publication are injected observations; it
// does not claim to qualify those physical capabilities or the full pipeline.
function derivation(transactionRoot: string): ReadySemanticMutationApplyDerivation {
  const change = fixture.plan.sourceChanges[0]!;
  const pathEvidence = {
    formatRevision: 'semantic-mutation-source-path-evidence-v1' as const,
    relativePath: change.relativePath,
    workspaceIdentityDigest: digest('workspace'),
    transactionDirectoryIdentityDigest: digest('transaction'),
    parentIdentityDigest: digest('parent'),
    targetIdentityDigest: digest('target'),
    pathEvidenceRevision: digest('path-evidence')
  };
  const rollbackManifest = {
    formatRevision: 'semantic-mutation-rollback-manifest-v2' as const,
    ownerId: change.ownerId,
    adapterId: 'semantic-contract-yaml' as const,
    adapterRevision: 'semantic-contract-yaml-v1' as const,
    relativePath: change.relativePath,
    beforeByteDigest: change.beforeByteDigest,
    stagedByteDigest: change.stagedByteDigest,
    beforeByteLength: 8,
    stagedByteLength: 7,
    fileMode: 0o600,
    windowsFileAttributes: null,
    encoding: 'utf-8' as const,
    utf8Bom: false,
    lineEnding: 'none' as const,
    finalNewline: false,
    pathEvidenceRevision: pathEvidence.pathEvidenceRevision,
    rollbackManifestDigest: fixture.plan.rollbackManifestDigest
  };
  return {
    plan: fixture.plan,
    transactionRoot,
    stagingWorkspaceRoot: `${transactionRoot}/workspace`,
    editPlan: {
      formatRevision: 'semantic-mutation-source-edit-plan-v1',
      requestRevision: fixture.plan.requestRevision,
      authorizationRevision: fixture.plan.authorizationRevision,
      preflightRevision: digest('preflight'),
      operationRegistryRevision: 'semantic-mutation-operations-v1',
      sourceAdapterRegistryRevision: 'semantic-mutation-source-adapters-v1',
      sourceResolutionRevision: digest('source-resolution'),
      sourceRevision: digest('source'),
      sourceKind: 'workspace-authoring',
      ownerId: change.ownerId,
      adapterId: rollbackManifest.adapterId,
      adapterRevision: rollbackManifest.adapterRevision,
      namespace: 'item',
      contractId: 'item-core',
      relativePath: change.relativePath,
      pathEvidence,
      operations: fixture.request.operations,
      beforeByteDigest: change.beforeByteDigest,
      stagedByteDigest: change.stagedByteDigest,
      rollbackManifestDigest: rollbackManifest.rollbackManifestDigest,
      editPlanRevision: expectedPrepared.editPlanRevision
    },
    rollbackManifest,
    originalBytes: new TextEncoder().encode('"before"'),
    stagedBytes: new TextEncoder().encode('"after"'),
    staged: fixture.staged,
    verificationCapabilityPlan: {
      formatRevision: 'semantic-mutation-verification-capability-plan-v1',
      adapterId: 'semantic-mutation-local-verification',
      adapterRevision: 'semantic-mutation-local-verification-v2',
      snapshotInputRevision: fixture.staged.inputRevision,
      snapshotSemanticRevision: fixture.staged.semanticRevision,
      status: 'runnable',
      capabilities: [],
      blockedRequirementKeys: [],
      capabilityPlanRevision: digest('capability-plan')
    }
  };
}

async function withJournal(
  use: (input: {
    operations: SemanticMutationApplyExecutionOperations;
    events: string[];
    drafts: SemanticMutationRecoveryRecordDraft[];
    records(): Promise<readonly SemanticMutationRecoveryRecord[]>;
  }) => Promise<void>
): Promise<void> {
  await withTempWorkspace(async workspaceRoot => {
    const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, prepared.requestIdentityDigest);
    await mkdir(transactionRoot, { recursive: true });
    const derived = derivation(transactionRoot);
    const events: string[] = [];
    const drafts: SemanticMutationRecoveryRecordDraft[] = [];
    const operations: SemanticMutationApplyExecutionOperations = {
      async recover() { events.push('recover'); return { status: 'clean' }; },
      async readRetained() { events.push('read'); return null; },
      async derive() { events.push('derive'); return derived; },
      async publishRejected() { assert.fail('Unexpected rejection publication'); },
      async verify() { events.push('verify'); return { verification: fixture.verification }; },
      issueTransactionId() { events.push('identity'); return 'tx:live'; },
      async writeTransactionArtifacts() { events.push('artifacts'); },
      async appendDraft(draft) {
        assert.equal(this, operations);
        events.push(`append:${draft.state}`);
        drafts.push(draft);
        return appendSemanticMutationRecoveryRecord(transactionRoot, draft, async () => undefined);
      },
      async publishSource() { events.push('publish'); },
      async observeCurrentDigest() { events.push('observe'); return derived.editPlan.stagedByteDigest; },
      async markRecoveryRequired() { assert.fail('Unexpected recovery-required outcome'); },
      async rollbackCommitted(record) {
        events.push('rollback');
        assert.equal(record.state, 'authoring-committed');
        assert.equal(record.sequence, 2);
        return { status: 'terminal', result: rolledBackResult(expectedPrepared) };
      },
      async completeCommitted(record) {
        events.push('complete');
        assert.equal(record.state, 'authoring-committed');
        assert.equal(record.sequence, 2);
        return { status: 'terminal', result: acceptedResult(expectedPrepared) };
      },
      async prune() { events.push('prune'); },
      isExecutionBoundaryFailure() { return false; }
    };
    await use({
      operations, events, drafts,
      records: () => loadSemanticMutationRecoveryRecords(transactionRoot)
    });
  }, 'sm-apply-journal-owner-');
}

const beforePrepared = ['recover', 'read', 'derive', 'verify', 'identity', 'artifacts'];

test('apply owns exact prepared and committed drafts before the physical journal appends them', async () => {
  await withJournal(async ({ operations, events, drafts, records }) => {
    const result = await executePreparedSemanticMutationApply(prepared, operations);
    assert.equal(result.status, 'terminal');
    assert.deepEqual(events, [...beforePrepared, 'append:prepared', 'publish', 'append:authoring-committed', 'complete', 'prune']);
    // Independent literal fixture, not the application's draft builder.
    assert.deepEqual(drafts, [expectedPrepared, { ...expectedPrepared, state: 'authoring-committed' }]);
    const retained = await records();
    assert.deepEqual(retained.map(record => record.state), ['prepared', 'authoring-committed']);
    assert.equal(retained[1]!.previousRecordRevision, retained[0]!.recordRevision);
    assert.equal(retained[1]!.requestIdentityDigest, prepared.requestIdentityDigest);
    assert.deepEqual(retained[1]!.verification, fixture.verification);
  });
});

test('publish rejection after an observed write records its diagnostic before rollback', async () => {
  await withJournal(async ({ operations, events, drafts, records }) => {
    operations.publishSource = async () => { events.push('publish'); throw new Error('Effect followed by failure'); };
    const result = await executePreparedSemanticMutationApply(prepared, operations);
    assert.equal(result.status, 'terminal');
    if (result.status !== 'terminal') assert.fail('Expected terminal rollback');
    assert.equal(result.result.status, 'rolled-back');
    assert.deepEqual(events, [...beforePrepared, 'append:prepared', 'publish', 'observe', 'append:authoring-committed', 'rollback', 'prune']);
    assert.deepEqual(drafts[0], expectedPrepared);
    const diagnostics = [{ origin: 'semantic-mutation', code: 'SEMANTIC-MUTATION-011', stage: 'publish', message: 'Atomic source publish failed' }];
    assert.deepEqual(drafts[1], { ...expectedPrepared, state: 'authoring-committed', diagnostics });
    assert.deepEqual((await records())[1]!.diagnostics, diagnostics);
  });
});

for (const failurePoint of ['artifacts', 'prepared'] as const) {
  test(`${failurePoint} failure keeps the original failure and never starts live publication`, async () => {
    await withJournal(async ({ operations, events, records }) => {
      const primary = Object.freeze({ failurePoint });
      if (failurePoint === 'artifacts') {
        operations.writeTransactionArtifacts = async () => { events.push('artifacts'); throw primary; };
      } else {
        operations.appendDraft = async draft => { events.push(`append:${draft.state}`); throw primary; };
      }
      await assert.rejects(executePreparedSemanticMutationApply(prepared, operations), error => error === primary);
      assert.deepEqual(events, [...beforePrepared, ...(failurePoint === 'prepared' ? ['append:prepared'] : [])]);
      assert.deepEqual(await records(), []);
    });
  });
}

test('commit journal failure after publication preserves the prepared record for recovery', async () => {
  await withJournal(async ({ operations, events, records }) => {
    const append = operations.appendDraft;
    const primary = Object.freeze({ committed: false });
    const recovery = Object.freeze({ recoveryRequested: true });
    operations.appendDraft = async function(draft) {
      if (draft.state === 'authoring-committed') { events.push(`append:${draft.state}`); throw primary; }
      return Reflect.apply(append, this, [draft]);
    };
    operations.markRecoveryRequired = async (record, state, diagnostic) => {
      events.push('recovery');
      assert.equal(record.state, 'prepared');
      assert.equal(record.sequence, 1);
      assert.equal(state, 'rebuild-failed');
      assert.equal(diagnostic.code, 'SEMANTIC-MUTATION-012');
      assert.equal(diagnostic.message, 'Published source could not durably record its authoring commit');
      throw recovery;
    };
    await assert.rejects(executePreparedSemanticMutationApply(prepared, operations), error => error === recovery);
    assert.deepEqual(events, [...beforePrepared, 'append:prepared', 'publish', 'append:authoring-committed', 'recovery']);
    assert.deepEqual((await records()).map(record => record.state), ['prepared']);
  });
});

test('the selected journal writer remains fixed through publication and keeps its provider receiver', async () => {
  await withJournal(async ({ operations, drafts }) => {
    operations.publishSource = async () => {
      operations.appendDraft = async () => assert.fail('Replacement journal writer was invoked');
    };
    await executePreparedSemanticMutationApply(prepared, operations);
    assert.deepEqual(drafts.map(draft => draft.state), ['prepared', 'authoring-committed']);
  });
});
