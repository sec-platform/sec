import { mkdir, rename, symlink } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { semanticMutationStagedRebuildDiagnostic } from '../../../src/adapters/mutation/derive-staged-mutation.ts';
import {
  appendSemanticMutationRecoveryRecord,
  loadSemanticMutationRecoveryRecords,
} from '../../../src/adapters/mutation/mutation-recovery-record.ts';
import {
  writeRejectedSemanticMutationTerminal
} from '../../../src/adapters/mutation/mutation-terminal-record.ts';
import {
  semanticMutationTransactionRoot
} from '../../../src/adapters/mutation/transaction-identity.ts';
import {
  querySemanticMutationRequest
} from '../../../src/bootstrap/engineering/cli.ts';
import { semanticMutationRequestIdentityDigest, semanticMutationStagedTransactionId } from '../../../src/compiler/semantic-mutation/identity.ts';
import { assertSemanticMutationRecoveryRecordInvariant, semanticMutationRecoveryRecordRevision } from '../../../src/compiler/semantic-mutation/recovery-record.ts';
import { type SemanticMutationRecoveryRecord } from '../../../src/semantics/mutation/transaction.ts';
import {
  digest,
  recoveryDraft,
  rejectedResult
} from '../../helpers/semantic-mutation/recovery-fixture.ts';
import { withTempWorkspace } from '../../testkit/workspace.ts';

const allowCommit = async (): Promise<void> => undefined;

test('staged rebuild diagnostics redact native absolute paths from apply and query projections', async () => {
  const secretPath = 'C:\\Users\\secret\\workspace\\.sec\\semantic-mutation\\v1\\transactions\\private';
  const error = Object.assign(new Error(`ENOENT: no such file or directory, open '${secretPath}'`), {
    code: 'ENOENT'
  });
  const diagnostic = semanticMutationStagedRebuildDiagnostic(error);

  expect(diagnostic).toEqual({
    origin: 'semantic-mutation',
    code: 'SEMANTIC-MUTATION-008',
    stage: 'staged-rebuild',
    message: 'Isolated staged semantic rebuild failed',
    details: { errorCode: 'ENOENT' }
  });
  expect(JSON.stringify(diagnostic)).not.toContain(secretPath);
  expect(semanticMutationStagedRebuildDiagnostic({ code: secretPath }).details).toEqual({
    errorCode: 'UNKNOWN'
  });

  await withTempWorkspace(async (workspaceRoot) => {
    const draft = recoveryDraft('request:path-redaction');
    const result = rejectedResult(draft, [diagnostic]);
    if (result.status !== 'rejected') throw new Error('Expected rejected result');
    const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, draft.requestIdentityDigest);
    await writeRejectedSemanticMutationTerminal(
      transactionRoot,
      draft.requestIdentityDigest,
      result.requestRevision,
      result.planRevision,
      result,
      allowCommit
    );
    const identity = {
      graphId: draft.request.graphId,
      appId: draft.request.appId,
      requestId: draft.request.requestId
    } as const;
    const applyProjection = { status: 'terminal' as const, result };
    const queryProjection = await querySemanticMutationRequest(workspaceRoot, identity);
    expect(JSON.stringify(applyProjection)).not.toContain(secretPath);
    expect(JSON.stringify(queryProjection)).not.toContain(secretPath);
  }, 'engineering-compiler-sm3-diagnostic-redaction-');
});

test('SM-3 request identity and staged transaction IDs use hand-reproducible frozen domains', () => {
  const identity = { graphId: 'graph:1', appId: 'app:1', requestId: 'request:1' } as const;
  expect(semanticMutationRequestIdentityDigest(identity)).toBe(digest({
    domain: 'semantic-mutation-request-identity-v1',
    ...identity
  }));
  const stagedInput = {
    requestRevision: digest('request'),
    authorizationRevision: digest('authorization'),
    base: {
      transactionId: 'tx:base',
      inputRevision: digest('input'),
      semanticRevision: digest('semantic')
    },
    sourceEditPlanRevision: digest('edit-plan')
  };
  expect(semanticMutationStagedTransactionId(stagedInput)).toBe(
    `tx:semantic-mutation-stage:${digest({
      domain: 'semantic-mutation-staged-transaction-v1',
      ...stagedInput
    }).slice('sha256:'.length)}`
  );
});

test('SM-3 recovery generations are immutable, chained, digest-bound, and fail closed on tampering', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const draft = recoveryDraft();
    const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, draft.requestIdentityDigest);
    await mkdir(transactionRoot, { recursive: true });
    const prepared = await appendSemanticMutationRecoveryRecord(transactionRoot, draft, allowCommit);
    const committed = await appendSemanticMutationRecoveryRecord(transactionRoot, {
      ...draft,
      state: 'authoring-committed'
    }, allowCommit);
    expect(prepared.sequence).toBe(1);
    expect(committed.sequence).toBe(2);
    expect(committed.previousRecordRevision).toBe(prepared.recordRevision);
    expect(await loadSemanticMutationRecoveryRecords(transactionRoot)).toEqual([prepared, committed]);
    expect(Object.isFrozen(committed)).toBe(true);

    const forged = structuredClone(committed) as unknown as Record<string, unknown>;
    forged.committedByteDigest = digest('forged');
    expect(() => assertSemanticMutationRecoveryRecordInvariant(
      forged as unknown as SemanticMutationRecoveryRecord,
      prepared
    )).toThrow(
      'revision chain or content is invalid'
    );
    const { recordRevision: _revision, ...withoutRevision } = committed;
    expect(semanticMutationRecoveryRecordRevision(withoutRevision)).toBe(committed.recordRevision);
  });
});


test.skipIf(process.platform === 'win32')(
  'SM-3 recovery reader rejects a symlink-substituted generation leaf',
  async () => {
    await withTempWorkspace(async (workspaceRoot) => {
      const draft = recoveryDraft('request:recovery-leaf-substitution');
      const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, draft.requestIdentityDigest);
      await mkdir(transactionRoot, { recursive: true });
      await appendSemanticMutationRecoveryRecord(transactionRoot, draft, allowCommit);

      const generation = path.join(transactionRoot, 'records', '000001-prepared.json');
      const displaced = path.join(transactionRoot, 'records', 'displaced-prepared.json');
      await rename(generation, displaced);
      await symlink(displaced, generation, 'file');

      await expect(loadSemanticMutationRecoveryRecords(transactionRoot))
        .rejects.toThrow('recovery generation is not an ordinary file');
    }, 'engineering-compiler-sm3-recovery-leaf-substitution-');
  }
);
