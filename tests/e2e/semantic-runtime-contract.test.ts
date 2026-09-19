import { access, cp, mkdir, mkdtemp, readdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { loadWorkspaceEngineeringIRBuildInput } from '../../src/adapters/workspace/engineering-input.ts';
import { buildValidatedEngineeringIR } from '../../src/compiler/ir/validate-engineering-ir.ts';
import {
  applySemanticMutation,
  querySemanticMutationRequest,
  recoverSemanticMutationWorkspace
} from '../../src/bootstrap/engineering/cli.ts';
import { projectSemanticMutationRequestRecordView } from '../../src/application/semantic-mutation-query.ts';
import { projectArchitectureView } from '../../src/compiler/projection/project-architecture-view.ts';
import { projectScenarioView } from '../../src/compiler/projection/project-scenario-view.ts';
import { projectStateView } from '../../src/compiler/projection/project-state-view.ts';
import { sha256 } from '../../src/compiler/semantic-mutation/canonical.ts';
import {
  appendSemanticMutationRecoveryRecord,
  assertSemanticMutationRecoveryRecordInvariant,
  loadSemanticMutationRecoveryRecords,
  pruneSemanticMutationTerminalRecords,
  querySemanticMutationRequestRecord,
  semanticMutationRecoveryRecordRevision
} from '../../src/adapters/mutation/mutation-recovery-record.ts';
import {
  assertSemanticMutationRejectedTerminalRecordInvariant,
  readRejectedSemanticMutationTerminal,
  reserveSemanticMutationTerminalSequence,
  writeRejectedSemanticMutationTerminal,
  type SemanticMutationTerminalIoObservation,
  type SemanticMutationTerminalWriteTestHooks
} from '../../src/adapters/mutation/mutation-terminal-record.ts';
import {
  assertSemanticMutationTransactionRoot,
  semanticMutationRequestIdentityDigest,
  semanticMutationTransactionRoot
} from '../../src/adapters/mutation/transaction-identity.ts';
import { SEMANTIC_MUTATION_TERMINAL_RETENTION, type SemanticMutationRecoveryRecord } from '../../src/semantics/mutation/transaction.ts';
import { CI_ARTIFACT_FILES } from '../../src/assurance/verification/ci-artifacts/contract/manifest.ts';
import type { VerificationReport } from '../../src/assurance/verification/contract/types.ts';
import { readJson } from "../../src/adapters/filesystem/files.ts";
import { resolveWorkspaceArtifactPath } from "../../src/adapters/workspace-context.ts";
import {
  acceptedResult,
  digest,
  nextDraft,
  readyTransactionFixture,
  recoveryDraft,
  recoveryRequiredResult,
  rejectedResult,
  rolledBackResult
} from '../helpers/semantic-mutation-recovery-fixture.ts';
import { prepareTicketSemanticRuntime } from '../testkit/semantic-runtime.ts';
import { prepareVerifiedWorkspace, withTempWorkspace } from '../testkit/workspace.ts';

const allowCommit = async (): Promise<void> => undefined;

test('SM-3 transaction root binding rejects copied authority under another valid identity', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const sourceDraft = recoveryDraft('request:source-authority');
    const sourceRoot = semanticMutationTransactionRoot(workspaceRoot, sourceDraft.requestIdentityDigest);
    await appendSemanticMutationRecoveryRecord(sourceRoot, sourceDraft, allowCommit);

    const aliasDraft = recoveryDraft('request:copied-alias');
    const aliasRoot = semanticMutationTransactionRoot(workspaceRoot, aliasDraft.requestIdentityDigest);
    await cp(sourceRoot, aliasRoot, { recursive: true });
    const aliasIdentity = {
      graphId: aliasDraft.request.graphId,
      appId: aliasDraft.request.appId,
      requestId: aliasDraft.request.requestId
    } as const;

    await expect(loadSemanticMutationRecoveryRecords(aliasRoot)).rejects.toThrow('transaction root binding');
    await expect(querySemanticMutationRequestRecord(workspaceRoot, aliasIdentity))
      .rejects.toThrow('transaction root binding');
    await rm(sourceRoot, { recursive: true, force: true });
    await expect(recoverSemanticMutationWorkspace(workspaceRoot)).rejects.toThrow('transaction root binding');
    await expect(pruneSemanticMutationTerminalRecords(workspaceRoot, allowCommit))
      .rejects.toThrow('transaction root binding');
  }, 'engineering-compiler-sm3-transaction-root-alias-');
});

test('SM-3 transaction root binding rejects ancestor and transaction reparse aliases before writes', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const externalRoot = await mkdtemp(path.join(path.dirname(workspaceRoot), 'sm3-transaction-escape-'));
    try {
      await symlink(
        externalRoot,
        path.join(workspaceRoot, '.sec'),
        process.platform === 'win32' ? 'junction' : 'dir'
      );
      const requestIdentityDigest = digest('ancestor-junction');
      const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, requestIdentityDigest);
      await expect(assertSemanticMutationTransactionRoot(
        workspaceRoot,
        transactionRoot,
        requestIdentityDigest
      )).rejects.toThrow('transaction root binding');
      await expect(access(path.join(externalRoot, 'semantic-mutation')))
        .rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(externalRoot, { recursive: true, force: true });
    }
  }, 'engineering-compiler-sm3-transaction-ancestor-junction-');

  await withTempWorkspace(async (workspaceRoot) => {
    const sourceDigest = digest('root-junction-source');
    const aliasDigest = digest('root-junction-alias');
    const sourceRoot = semanticMutationTransactionRoot(workspaceRoot, sourceDigest);
    const aliasRoot = semanticMutationTransactionRoot(workspaceRoot, aliasDigest);
    await mkdir(sourceRoot, { recursive: true });
    await symlink(sourceRoot, aliasRoot, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(assertSemanticMutationTransactionRoot(workspaceRoot, aliasRoot, aliasDigest))
      .rejects.toThrow('transaction root binding');
  }, 'engineering-compiler-sm3-transaction-root-junction-');
});

test('SM-3 recovery records reject a pre-existing reparse directory without writing through it', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const externalRoot = await mkdtemp(path.join(path.dirname(workspaceRoot), 'sm3-records-escape-'));
    try {
      const draft = recoveryDraft('request:records-junction');
      const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, draft.requestIdentityDigest);
      await mkdir(transactionRoot, { recursive: true });
      await symlink(
        externalRoot,
        path.join(transactionRoot, 'records'),
        process.platform === 'win32' ? 'junction' : 'dir'
      );

      await expect(appendSemanticMutationRecoveryRecord(transactionRoot, draft, allowCommit))
        .rejects.toThrow('journal directory binding');
      await expect(loadSemanticMutationRecoveryRecords(transactionRoot))
        .rejects.toThrow('journal directory binding');
      expect(await readdir(externalRoot)).toEqual([]);
    } finally {
      await rm(externalRoot, { recursive: true, force: true });
    }
  }, 'engineering-compiler-sm3-records-junction-');
});

test('SM-3 terminal receipts reject a pre-existing reparse directory without writing through it', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const externalRoot = await mkdtemp(path.join(path.dirname(workspaceRoot), 'sm3-terminal-order-escape-'));
    try {
      const journalRoot = path.join(workspaceRoot, '.sec', 'semantic-mutation', 'v1');
      await mkdir(journalRoot, { recursive: true });
      await symlink(
        externalRoot,
        path.join(journalRoot, 'terminal-order'),
        process.platform === 'win32' ? 'junction' : 'dir'
      );
      const draft = recoveryDraft('request:terminal-order-junction');
      const result = rejectedResult(draft);
      if (result.status !== 'rejected') throw new Error('Expected rejected result');
      const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, draft.requestIdentityDigest);

      await expect(writeRejectedSemanticMutationTerminal(
        transactionRoot,
        draft.requestIdentityDigest,
        result.requestRevision,
        result.planRevision,
        result,
        allowCommit
      )).rejects.toThrow('journal directory binding');
      await expect(reserveSemanticMutationTerminalSequence(
        transactionRoot,
        draft.requestIdentityDigest,
        'rejected',
        allowCommit
      )).rejects.toThrow('journal directory binding');
      expect(await readdir(externalRoot)).toEqual([]);
    } finally {
      await rm(externalRoot, { recursive: true, force: true });
    }
  }, 'engineering-compiler-sm3-terminal-order-junction-');
});

test('SM-3 recovery record revalidates containment after the open fence', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const externalRoot = await mkdtemp(path.join(path.dirname(workspaceRoot), 'sm3-records-pre-open-'));
    try {
      const draft = recoveryDraft('request:records-pre-open-junction');
      const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, draft.requestIdentityDigest);
      const records = path.join(transactionRoot, 'records');
      const parkedRecords = path.join(transactionRoot, 'records-after-fence');
      let swapped = false;

      await expect(appendSemanticMutationRecoveryRecord(
        transactionRoot,
        draft,
        allowCommit,
        {
          beforeTempOpenAfterFence: async () => {
            await rename(records, parkedRecords);
            await symlink(externalRoot, records, process.platform === 'win32' ? 'junction' : 'dir');
            swapped = true;
          }
        }
      )).rejects.toThrow('journal directory binding');

      expect(swapped).toBe(true);
      expect(await readdir(parkedRecords)).toEqual([]);
      expect(await readdir(externalRoot)).toEqual([]);
    } finally {
      await rm(externalRoot, { recursive: true, force: true });
    }
  }, 'engineering-compiler-sm3-records-pre-open-junction-');
});

test('SM-3 terminal completion revalidates containment after the open fence', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const externalRoot = await mkdtemp(path.join(path.dirname(workspaceRoot), 'sm3-completion-pre-open-'));
    try {
      const draft = recoveryDraft('request:completion-pre-open-junction');
      const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, draft.requestIdentityDigest);
      const journalRoot = path.join(workspaceRoot, '.sec', 'semantic-mutation', 'v1');
      const terminalOrder = path.join(journalRoot, 'terminal-order');
      const parkedTerminalOrder = path.join(journalRoot, 'terminal-order-after-fence');
      let swapped = false;

      await expect(reserveSemanticMutationTerminalSequence(
        transactionRoot,
        draft.requestIdentityDigest,
        'rejected',
        allowCommit,
        {
          beforeCompletionTempOpenAfterFence: async () => {
            await rename(terminalOrder, parkedTerminalOrder);
            await symlink(
              externalRoot,
              terminalOrder,
              process.platform === 'win32' ? 'junction' : 'dir'
            );
            swapped = true;
          }
        }
      )).rejects.toThrow('journal directory binding');

      expect(swapped).toBe(true);
      expect(await readdir(parkedTerminalOrder)).toEqual([]);
      expect(await readdir(externalRoot)).toEqual([]);
    } finally {
      await rm(externalRoot, { recursive: true, force: true });
    }
  }, 'engineering-compiler-sm3-completion-pre-open-junction-');
});

test('SM-3 rejected terminal revalidates containment after the open fence', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const externalRoot = await mkdtemp(path.join(path.dirname(workspaceRoot), 'sm3-rejected-pre-open-'));
    try {
      const draft = recoveryDraft('request:rejected-pre-open-junction');
      const result = rejectedResult(draft);
      if (result.status !== 'rejected') throw new Error('Expected rejected result');
      const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, draft.requestIdentityDigest);
      const parkedTransaction = path.join(
        path.dirname(transactionRoot),
        `.${path.basename(transactionRoot)}-after-fence`
      );
      let swapped = false;

      await expect(writeRejectedSemanticMutationTerminal(
        transactionRoot,
        draft.requestIdentityDigest,
        result.requestRevision,
        result.planRevision,
        result,
        allowCommit,
        {
          beforeRejectedTempOpenAfterFence: async () => {
            await rename(transactionRoot, parkedTransaction);
            await symlink(
              externalRoot,
              transactionRoot,
              process.platform === 'win32' ? 'junction' : 'dir'
            );
            swapped = true;
          }
        }
      )).rejects.toThrow('transaction root binding');

      expect(swapped).toBe(true);
      expect(await readdir(parkedTransaction)).toEqual([]);
      expect(await readdir(externalRoot)).toEqual([]);
    } finally {
      await rm(externalRoot, { recursive: true, force: true });
    }
  }, 'engineering-compiler-sm3-rejected-pre-open-junction-');
});

test('SM-3 recovery record post-open directory swap preserves containment failure without external cleanup', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const externalRoot = await mkdtemp(path.join(path.dirname(workspaceRoot), 'sm3-records-post-open-'));
    try {
      const draft = recoveryDraft('request:records-post-open-junction');
      const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, draft.requestIdentityDigest);
      const records = path.join(transactionRoot, 'records');
      const parkedRecords = path.join(transactionRoot, 'records-before-junction');
      let swapped = false;
      let externalDecoy = '';

      await expect(appendSemanticMutationRecoveryRecord(
        transactionRoot,
        draft,
        allowCommit,
        {
          afterTempFileClosed: async () => {
            const tempName = (await readdir(records)).find((name) => name.startsWith('.record-'));
            if (!tempName) throw new Error('Recovery temp was not opened before the swap hook');
            await rename(records, parkedRecords);
            await symlink(externalRoot, records, process.platform === 'win32' ? 'junction' : 'dir');
            externalDecoy = path.join(externalRoot, tempName);
            await writeFile(externalDecoy, 'attacker-owned', 'utf8');
            swapped = true;
            throw new Error('injected recovery post-open failure');
          }
        }
      )).rejects.toThrow('injected recovery post-open failure');

      expect(swapped).toBe(true);
      expect(await readFile(externalDecoy, 'utf8')).toBe('attacker-owned');
      await rm(externalDecoy);
      expect(await readdir(externalRoot)).toEqual([]);
    } finally {
      await rm(externalRoot, { recursive: true, force: true });
    }
  }, 'engineering-compiler-sm3-records-post-open-junction-');
});

test('SM-3 terminal completion post-open directory swap preserves containment failure without external cleanup', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const externalRoot = await mkdtemp(path.join(path.dirname(workspaceRoot), 'sm3-completion-post-open-'));
    try {
      const draft = recoveryDraft('request:completion-post-open-junction');
      const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, draft.requestIdentityDigest);
      const journalRoot = path.join(workspaceRoot, '.sec', 'semantic-mutation', 'v1');
      const terminalOrder = path.join(journalRoot, 'terminal-order');
      const parkedTerminalOrder = path.join(journalRoot, 'terminal-order-before-junction');
      let swapped = false;
      let externalDecoy = '';

      await expect(reserveSemanticMutationTerminalSequence(
        transactionRoot,
        draft.requestIdentityDigest,
        'rejected',
        allowCommit,
        {
          afterCompletionTempFileClosed: async () => {
            const tempName = (await readdir(terminalOrder))
              .find((name) => name.startsWith('.completion-'));
            if (!tempName) throw new Error('Completion temp was not opened before the swap hook');
            await rename(terminalOrder, parkedTerminalOrder);
            await symlink(
              externalRoot,
              terminalOrder,
              process.platform === 'win32' ? 'junction' : 'dir'
            );
            externalDecoy = path.join(externalRoot, tempName);
            await writeFile(externalDecoy, 'attacker-owned', 'utf8');
            swapped = true;
            throw new Error('injected terminal completion post-open failure');
          }
        }
      )).rejects.toThrow('injected terminal completion post-open failure');

      expect(swapped).toBe(true);
      expect(await readFile(externalDecoy, 'utf8')).toBe('attacker-owned');
      await rm(externalDecoy);
      expect(await readdir(externalRoot)).toEqual([]);
    } finally {
      await rm(externalRoot, { recursive: true, force: true });
    }
  }, 'engineering-compiler-sm3-completion-post-open-junction-');
});

test('SM-3 rejected terminal post-open directory swap preserves root failure without external cleanup', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const externalRoot = await mkdtemp(path.join(path.dirname(workspaceRoot), 'sm3-rejected-post-open-'));
    try {
      const draft = recoveryDraft('request:rejected-post-open-junction');
      const result = rejectedResult(draft);
      if (result.status !== 'rejected') throw new Error('Expected rejected result');
      const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, draft.requestIdentityDigest);
      const parkedTransaction = path.join(
        path.dirname(transactionRoot),
        `.${path.basename(transactionRoot)}-before-junction`
      );
      let swapped = false;
      let externalDecoy = '';

      await expect(writeRejectedSemanticMutationTerminal(
        transactionRoot,
        draft.requestIdentityDigest,
        result.requestRevision,
        result.planRevision,
        result,
        allowCommit,
        {
          afterRejectedTempFileClosed: async () => {
            const tempName = (await readdir(transactionRoot)).find((name) => name.startsWith('.terminal-'));
            if (!tempName) throw new Error('Rejected terminal temp was not opened before the swap hook');
            await rename(transactionRoot, parkedTransaction);
            await symlink(
              externalRoot,
              transactionRoot,
              process.platform === 'win32' ? 'junction' : 'dir'
            );
            externalDecoy = path.join(externalRoot, tempName);
            await writeFile(externalDecoy, 'attacker-owned', 'utf8');
            swapped = true;
            throw new Error('injected rejected terminal post-open failure');
          }
        }
      )).rejects.toThrow('injected rejected terminal post-open failure');

      expect(swapped).toBe(true);
      expect(await readFile(externalDecoy, 'utf8')).toBe('attacker-owned');
      await rm(externalDecoy);
      expect(await readdir(externalRoot)).toEqual([]);
    } finally {
      await rm(externalRoot, { recursive: true, force: true });
    }
  }, 'engineering-compiler-sm3-rejected-post-open-junction-');
});

test('SM-3 recovery journal freezes cross-bindings and keeps retained terminals immutable', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const draft = recoveryDraft();
    const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, draft.requestIdentityDigest);
    await mkdir(transactionRoot, { recursive: true });
    const prepared = await appendSemanticMutationRecoveryRecord(transactionRoot, draft, allowCommit);

    await expect(appendSemanticMutationRecoveryRecord(transactionRoot, {
      ...draft,
      state: 'verified',
      result: acceptedResult(draft)
    }, allowCommit)).rejects.toThrow('state transition');

    const committed = await appendSemanticMutationRecoveryRecord(
      transactionRoot,
      nextDraft(prepared, 'authoring-committed'),
      allowCommit
    );
    const accepted = acceptedResult(draft);
    const verified = await appendSemanticMutationRecoveryRecord(
      transactionRoot,
      nextDraft(committed, 'verified', { result: accepted }),
      allowCommit
    );
    expect(verified.terminalSequence).toBe(1);

    const recoveryResult = recoveryRequiredResult(draft);
    await expect(appendSemanticMutationRecoveryRecord(
      transactionRoot,
      nextDraft(verified, 'recovery-required', {
        result: recoveryResult,
        recoveryState: 'concurrent-write',
        diagnostics: recoveryResult.diagnostics
      }),
      allowCommit
    )).rejects.toThrow('state transition');
    expect((await loadSemanticMutationRecoveryRecords(transactionRoot)).map(({ state }) => state))
      .toEqual(['prepared', 'authoring-committed', 'verified']);

    const forged = structuredClone(committed) as unknown as Record<string, unknown>;
    forged.requestRevision = digest('forged-request');
    const { recordRevision: _oldRevision, ...forgedDraft } = forged;
    forged.recordRevision = semanticMutationRecoveryRecordRevision(
      forgedDraft as unknown as Omit<SemanticMutationRecoveryRecord, 'recordRevision'>
    );
    expect(() => assertSemanticMutationRecoveryRecordInvariant(
      forged as unknown as SemanticMutationRecoveryRecord,
      prepared
    )).toThrow(
      'identity/revision/source bindings'
    );
  }, 'engineering-compiler-sm3-recovery-transitions-');
});

test('SM-3 rejected terminals are immutable, ordered, non-destructive, and project to a redacted view', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const transaction = readyTransactionFixture();
    const identity = {
      graphId: transaction.request.graphId,
      appId: transaction.request.appId,
      requestId: transaction.request.requestId
    } as const;
    const requestIdentityDigest = semanticMutationRequestIdentityDigest(identity);
    const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, requestIdentityDigest);
    const prepared = await appendSemanticMutationRecoveryRecord(
      transactionRoot,
      recoveryDraft(),
      allowCommit
    );
    expect(await querySemanticMutationRequestRecord(workspaceRoot, identity)).toEqual(prepared);
    await writeFile(`${transactionRoot}/original.backup`, 'original', 'utf8');
    const result = rejectedResult(recoveryDraft());
    if (result.status !== 'rejected') throw new Error('Expected rejected result');
    const terminal = await writeRejectedSemanticMutationTerminal(
      transactionRoot,
      requestIdentityDigest,
      result.requestRevision,
      result.planRevision,
      result,
      allowCommit
    );

    expect(terminal.terminalSequence).toBe(1);
    expect(await readRejectedSemanticMutationTerminal(transactionRoot)).toEqual(terminal);
    expect(await writeRejectedSemanticMutationTerminal(
      transactionRoot,
      requestIdentityDigest,
      result.requestRevision,
      result.planRevision,
      result,
      allowCommit
    )).toEqual(terminal);
    expect(() => assertSemanticMutationRejectedTerminalRecordInvariant(terminal)).not.toThrow();
    await expect(access(`${transactionRoot}/records/000001-prepared.json`)).resolves.toBeNull();
    await expect(access(`${transactionRoot}/original.backup`)).resolves.toBeNull();

    const pollutedIdentity = { ...identity, injected: 'must-not-escape' };
    const rejectedView = projectSemanticMutationRequestRecordView(terminal, pollutedIdentity);
    expect(rejectedView).toMatchObject({
      recordKind: 'rejected-terminal',
      state: 'rejected',
      identity,
      terminalSequence: 1
    });
    expect(Object.keys(rejectedView)).not.toContain('request');
    expect(Object.keys(rejectedView)).not.toContain('authorization');
    expect(Object.keys(rejectedView)).not.toContain('plan');
    expect(Object.keys(rejectedView.identity)).toEqual(['graphId', 'appId', 'requestId']);
    expect(JSON.stringify(rejectedView)).not.toContain('must-not-escape');
    const activeView = projectSemanticMutationRequestRecordView(prepared);
    expect(activeView.recordKind).toBe('transaction');
    expect(Object.keys(activeView)).not.toContain('relativePath');
    expect(Object.keys(activeView)).not.toContain('beforeByteDigest');
    expect(Object.keys(activeView)).not.toContain('committedByteDigest');
    expect(Object.isFrozen(rejectedView)).toBe(true);
    expect(Object.isFrozen(rejectedView.identity)).toBe(true);
    expect(await querySemanticMutationRequest(workspaceRoot, pollutedIdentity)).toEqual(rejectedView);

    const exactReplay = await applySemanticMutation(workspaceRoot, {
      request: transaction.request,
      base: transaction.base,
      authorization: transaction.auth,
      expectedPlanRevision: transaction.plan.planRevision
    });
    expect(exactReplay).toEqual({ status: 'terminal', result: terminal.result });
    const collision = await applySemanticMutation(workspaceRoot, {
      request: {
        ...transaction.request,
        additionalVerification: [{ kind: 'pass', passId: 'verify' }]
      },
      base: transaction.base,
      authorization: transaction.auth,
      expectedPlanRevision: transaction.plan.planRevision
    });
    expect(collision.status).toBe('request-rejected');
    if (collision.status !== 'request-rejected') throw new Error(JSON.stringify(collision));
    expect(collision.diagnostics).toContainEqual(expect.objectContaining({
      code: 'SEMANTIC-MUTATION-001',
      stage: 'request'
    }));
    expect(await querySemanticMutationRequest(workspaceRoot, identity)).toEqual(rejectedView);

    const forged = structuredClone(terminal) as unknown as Record<string, unknown>;
    forged.requestRevision = digest('forged-request');
    expect(() => assertSemanticMutationRejectedTerminalRecordInvariant(
      forged as unknown as typeof terminal
    )).toThrow();
  }, 'engineering-compiler-sm3-rejected-terminal-');
});

test('SM-3 terminal allocator requires and advances one durable constant-I/O head', async () => {
  const completionPath = (workspaceRoot: string, sequence: number): string => path.join(
    workspaceRoot,
    '.sec',
    'semantic-mutation',
    'v1',
    'terminal-order',
    `${sequence.toString().padStart(12, '0')}.json`
  );
  const headPath = (workspaceRoot: string): string => path.join(
    workspaceRoot,
    '.sec',
    'semantic-mutation',
    'v1',
    'terminal-order',
    '.sequence-head.json'
  );
  const writeRejected = async (
    workspaceRoot: string,
    label: string,
    testHooks: SemanticMutationTerminalWriteTestHooks = {}
  ): Promise<void> => {
    const draft = recoveryDraft(`request:${label}`);
    const result = rejectedResult(draft);
    if (result.status !== 'rejected') throw new Error('Expected rejected result');
    const requestIdentityDigest = draft.requestIdentityDigest;
    await writeRejectedSemanticMutationTerminal(
      semanticMutationTransactionRoot(workspaceRoot, requestIdentityDigest),
      requestIdentityDigest,
      result.requestRevision,
      result.planRevision,
      result,
      allowCommit,
      testHooks
    );
  };

  await withTempWorkspace(async (workspaceRoot) => {
    const draft = recoveryDraft('request:terminal-sequence-exhausted');
    const terminalSequence = 999_999_999_999;
    const completion = {
      formatRevision: 'semantic-mutation-terminal-completion-v1' as const,
      terminalSequence,
      requestIdentityDigest: draft.requestIdentityDigest,
      state: 'rejected' as const
    };
    const receipt = {
      ...completion,
      completionRevision: sha256({
        domain: 'semantic-mutation-terminal-completion-v1',
        ...completion
      })
    };
    const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, draft.requestIdentityDigest);
    const receiptPath = completionPath(workspaceRoot, terminalSequence);
    await mkdir(path.dirname(receiptPath), { recursive: true });
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
    await expect(reserveSemanticMutationTerminalSequence(
      transactionRoot,
      draft.requestIdentityDigest,
      'rejected',
      allowCommit
    )).rejects.toThrow('terminal completion sequence is exhausted');
  }, 'engineering-compiler-sm3-terminal-order-exhausted-');

  await withTempWorkspace(async (workspaceRoot) => {
    const events: SemanticMutationTerminalIoObservation[] = [];
    const testHooks = { observeIo: (event: SemanticMutationTerminalIoObservation) => events.push(event) };
    await writeRejected(workspaceRoot, 'indexed-zero', testHooks);
    events.length = 0;
    for (let index = 1; index <= 8; index += 1) {
      await writeRejected(workspaceRoot, `indexed-${index}`, testHooks);
    }
    expect(events.filter(({ kind }) => kind === 'terminal-order-scan')).toHaveLength(0);
    expect(events.filter(({ kind }) => kind === 'completion-probe')).toEqual(
      Array.from({ length: 8 }, (_, index) => ({
        kind: 'completion-probe',
        reason: 'head-catch-up',
        terminalSequence: index + 2,
        status: 'missing'
      }))
    );
    expect(events.filter(({ kind }) => kind === 'sequence-head-read')).toHaveLength(8);
    expect(events.filter(({ kind }) => kind === 'sequence-head-write')).toHaveLength(8);
    expect(events.filter(({ kind }) => kind === 'completion-publish')).toHaveLength(8);
  }, 'engineering-compiler-sm3-terminal-order-indexed-');

  await withTempWorkspace(async (workspaceRoot) => {
    await writeRejected(workspaceRoot, 'head-create');
    await writeRejected(workspaceRoot, 'head-replace');
    const canonicalHead = JSON.parse(await readFile(headPath(workspaceRoot), 'utf8')) as Record<string, unknown>;
    expect(canonicalHead).toEqual({
      formatRevision: 'semantic-mutation-terminal-sequence-head-v1',
      highestReservedSequence: 2,
      headRevision: sha256({
        domain: 'semantic-mutation-terminal-sequence-head-v1',
        formatRevision: 'semantic-mutation-terminal-sequence-head-v1',
        highestReservedSequence: 2
      })
    });
    canonicalHead.headRevision = digest('corrupt-sequence-head');
    await writeFile(headPath(workspaceRoot), `${JSON.stringify(canonicalHead, null, 2)}\n`, 'utf8');
    await expect(writeRejected(workspaceRoot, 'head-corruption-must-not-publish'))
      .rejects.toThrow('sequence head content is invalid');
    await expect(access(completionPath(workspaceRoot, 3))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 'engineering-compiler-sm3-terminal-order-head-trust-');

  await withTempWorkspace(async (workspaceRoot) => {
    const firstDigest = digest('identity:reserved-first');
    const firstRoot = semanticMutationTransactionRoot(workspaceRoot, firstDigest);
    expect(await reserveSemanticMutationTerminalSequence(
      firstRoot,
      firstDigest,
      'rejected',
      allowCommit
    )).toBe(1);

    const interruptedDigest = digest('identity:reserved-interrupted');
    const interruptedRoot = semanticMutationTransactionRoot(workspaceRoot, interruptedDigest);
    await expect(reserveSemanticMutationTerminalSequence(
      interruptedRoot,
      interruptedDigest,
      'verified',
      allowCommit,
      { afterCompletionPublishedBeforeHeadWrite: async () => { throw new Error('simulated-crash'); } }
    )).rejects.toThrow('simulated-crash');

    const resumedDigest = digest('identity:reserved-resumed');
    const resumedRoot = semanticMutationTransactionRoot(workspaceRoot, resumedDigest);
    const events: SemanticMutationTerminalIoObservation[] = [];
    expect(await reserveSemanticMutationTerminalSequence(
      resumedRoot,
      resumedDigest,
      'rolled-back',
      allowCommit,
      { observeIo: (event) => events.push(event) }
    )).toBe(3);
    expect(events).toContainEqual({
      kind: 'completion-probe',
      reason: 'head-catch-up',
      terminalSequence: 2,
      status: 'valid'
    });
    const interrupted = JSON.parse(await readFile(completionPath(workspaceRoot, 2), 'utf8'));
    expect(interrupted).toMatchObject({
      terminalSequence: 2,
      requestIdentityDigest: interruptedDigest,
      state: 'verified'
    });
  }, 'engineering-compiler-sm3-terminal-order-gap-');

  await withTempWorkspace(async (workspaceRoot) => {
    const requestIdentityDigest = digest('identity:collision');
    const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, requestIdentityDigest);
    const collisionPath = completionPath(workspaceRoot, 1);
    await expect(reserveSemanticMutationTerminalSequence(
      transactionRoot,
      requestIdentityDigest,
      'rejected',
      allowCommit,
      {
        afterCompletionTempFileClosed: async () => {
          await writeFile(collisionPath, 'collision-sentinel', { encoding: 'utf8', flag: 'wx' });
        }
      }
    )).rejects.toMatchObject({ code: 'EEXIST' });
    expect(await readFile(collisionPath, 'utf8')).toBe('collision-sentinel');
    await expect(reserveSemanticMutationTerminalSequence(
      transactionRoot,
      requestIdentityDigest,
      'rejected',
      allowCommit
    )).rejects.toThrow();
    expect(await readFile(collisionPath, 'utf8')).toBe('collision-sentinel');
  }, 'engineering-compiler-sm3-terminal-order-collision-');
});

test('SM-3 query and pruning require the terminal record completion receipt', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const draft = recoveryDraft('request:receipt-binding');
    const result = rejectedResult(draft);
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
    const events: SemanticMutationTerminalIoObservation[] = [];
    expect(await querySemanticMutationRequestRecord(workspaceRoot, identity, {
      observeIo: (event) => events.push(event)
    })).not.toBeNull();
    expect(events.filter(({ kind }) => kind === 'terminal-order-scan')).toHaveLength(0);
    expect(events.filter(({ kind }) => kind === 'completion-probe')).toEqual([{
      kind: 'completion-probe',
      reason: 'exact',
      terminalSequence: 1,
      status: 'valid'
    }]);
    await rm(path.join(
      workspaceRoot,
      '.sec',
      'semantic-mutation',
      'v1',
      'terminal-order',
      '000000000001.json'
    ));
    events.length = 0;
    await expect(readRejectedSemanticMutationTerminal(transactionRoot))
      .rejects.toThrow('completion receipt');
    await expect(querySemanticMutationRequestRecord(workspaceRoot, identity, {
      observeIo: (event) => events.push(event)
    }))
      .rejects.toThrow('completion receipt');
    await expect(pruneSemanticMutationTerminalRecords(workspaceRoot, allowCommit, {
      observeIo: (event) => events.push(event)
    }))
      .rejects.toThrow('completion receipt');
    expect(events.filter(({ kind }) => kind === 'terminal-order-scan')).toHaveLength(0);
  }, 'engineering-compiler-sm3-terminal-receipt-binding-');
});

test('SM-3 public workspace recovery redacts its durable recovery-required record', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const draft = recoveryDraft();
    const transactionRoot = semanticMutationTransactionRoot(workspaceRoot, draft.requestIdentityDigest);
    const prepared = await appendSemanticMutationRecoveryRecord(transactionRoot, draft, allowCommit);
    const result = recoveryRequiredResult(draft);
    await appendSemanticMutationRecoveryRecord(
      transactionRoot,
      nextDraft(prepared, 'recovery-required', {
        result,
        recoveryState: 'concurrent-write',
        diagnostics: result.diagnostics
      }),
      allowCommit
    );

    const outcome = await recoverSemanticMutationWorkspace(workspaceRoot);
    expect(outcome.status).toBe('recovery-required');
    if (outcome.status !== 'recovery-required') throw new Error(JSON.stringify(outcome));
    expect(outcome.record).toMatchObject({
      formatRevision: 'semantic-mutation-request-record-view-v1',
      recordKind: 'transaction',
      state: 'recovery-required',
      result: { status: 'recovery-required' }
    });
    expect(Object.keys(outcome.record)).not.toContain('request');
    expect(Object.keys(outcome.record)).not.toContain('authorization');
    expect(Object.keys(outcome.record)).not.toContain('plan');
    expect(Object.keys(outcome.record)).not.toContain('relativePath');
    expect(Object.keys(outcome.record)).not.toContain('beforeByteDigest');
    expect(Object.keys(outcome.record)).not.toContain('committedByteDigest');
    expect(JSON.stringify(outcome.record)).not.toContain('snapshot');
    expect(Object.isFrozen(outcome.record)).toBe(true);
  }, 'engineering-compiler-sm3-public-recovery-view-');
});

test('SM-3 recovery fails closed before mutating either of multiple unfinished transactions', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const first = recoveryDraft('request:unfinished-first');
    const second = recoveryDraft('request:unfinished-second');
    const firstRoot = semanticMutationTransactionRoot(workspaceRoot, first.requestIdentityDigest);
    const secondRoot = semanticMutationTransactionRoot(workspaceRoot, second.requestIdentityDigest);
    await appendSemanticMutationRecoveryRecord(firstRoot, first, allowCommit);
    await appendSemanticMutationRecoveryRecord(secondRoot, second, allowCommit);

    await expect(recoverSemanticMutationWorkspace(workspaceRoot))
      .rejects.toThrow('multiple unfinished transactions');
    expect((await loadSemanticMutationRecoveryRecords(firstRoot)).map(({ state }) => state))
      .toEqual(['prepared']);
    expect((await loadSemanticMutationRecoveryRecords(secondRoot)).map(({ state }) => state))
      .toEqual(['prepared']);
  }, 'engineering-compiler-sm3-multiple-unfinished-');
});

test('SM-3 retention uses durable completion sequence across all retained terminal kinds', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const rejected = rejectedResult(recoveryDraft());
    if (rejected.status !== 'rejected') throw new Error('Expected rejected result');
    const terminalEvents: SemanticMutationTerminalIoObservation[] = [];
    const terminalTestHooks: SemanticMutationTerminalWriteTestHooks = {
      observeIo: (event) => terminalEvents.push(event)
    };

    const oldestRejectedDigest = digest('identity:oldest-rejected');
    const oldestRejectedRoot = semanticMutationTransactionRoot(workspaceRoot, oldestRejectedDigest);
    await writeRejectedSemanticMutationTerminal(
      oldestRejectedRoot,
      oldestRejectedDigest,
      rejected.requestRevision,
      rejected.planRevision,
      rejected,
      allowCommit,
      terminalTestHooks
    );

    const oldestDraft = recoveryDraft('request:oldest-verified');
    const oldestVerifiedRoot = semanticMutationTransactionRoot(workspaceRoot, oldestDraft.requestIdentityDigest);
    const oldestPrepared = await appendSemanticMutationRecoveryRecord(
      oldestVerifiedRoot,
      oldestDraft,
      allowCommit
    );
    const oldestCommitted = await appendSemanticMutationRecoveryRecord(
      oldestVerifiedRoot,
      nextDraft(oldestPrepared, 'authoring-committed'),
      allowCommit
    );
    await appendSemanticMutationRecoveryRecord(
      oldestVerifiedRoot,
      nextDraft(oldestCommitted, 'verified', { result: acceptedResult(oldestDraft) }),
      allowCommit,
      { terminal: terminalTestHooks }
    );

    for (let index = 0; index < SEMANTIC_MUTATION_TERMINAL_RETENTION - 2; index += 1) {
      const middleDigest = digest(`identity:middle:${index}`);
      await writeRejectedSemanticMutationTerminal(
        semanticMutationTransactionRoot(workspaceRoot, middleDigest),
        middleDigest,
        rejected.requestRevision,
        rejected.planRevision,
        rejected,
        allowCommit,
        terminalTestHooks
      );
    }

    const rolledDraft = recoveryDraft('request:newest-rolled-back');
    const newestRolledBackRoot = semanticMutationTransactionRoot(workspaceRoot, rolledDraft.requestIdentityDigest);
    const rolledPrepared = await appendSemanticMutationRecoveryRecord(
      newestRolledBackRoot,
      rolledDraft,
      allowCommit
    );
    const rolledCommitted = await appendSemanticMutationRecoveryRecord(
      newestRolledBackRoot,
      nextDraft(rolledPrepared, 'authoring-committed'),
      allowCommit
    );
    const rolledResult = rolledBackResult(rolledDraft);
    await appendSemanticMutationRecoveryRecord(
      newestRolledBackRoot,
      nextDraft(rolledCommitted, 'rolled-back', {
        result: rolledResult,
        diagnostics: rolledResult.diagnostics
      }),
      allowCommit,
      { terminal: terminalTestHooks }
    );

    const newestDraft = recoveryDraft('request:newest-verified');
    const newestVerifiedRoot = semanticMutationTransactionRoot(workspaceRoot, newestDraft.requestIdentityDigest);
    const newestPrepared = await appendSemanticMutationRecoveryRecord(
      newestVerifiedRoot,
      newestDraft,
      allowCommit
    );
    const newestCommitted = await appendSemanticMutationRecoveryRecord(
      newestVerifiedRoot,
      nextDraft(newestPrepared, 'authoring-committed'),
      allowCommit
    );
    await appendSemanticMutationRecoveryRecord(
      newestVerifiedRoot,
      nextDraft(newestCommitted, 'verified', { result: acceptedResult(newestDraft) }),
      allowCommit,
      { terminal: terminalTestHooks }
    );

    const activeDraft = recoveryDraft('request:active');
    const activeRoot = semanticMutationTransactionRoot(workspaceRoot, activeDraft.requestIdentityDigest);
    await appendSemanticMutationRecoveryRecord(activeRoot, activeDraft, allowCommit);
    const recoveryDraftValue = recoveryDraft('request:recovery-required');
    const recoveryRoot = semanticMutationTransactionRoot(workspaceRoot, recoveryDraftValue.requestIdentityDigest);
    const recoveryPrepared = await appendSemanticMutationRecoveryRecord(
      recoveryRoot,
      recoveryDraftValue,
      allowCommit
    );
    const recoveryResult = recoveryRequiredResult(recoveryDraftValue);
    await appendSemanticMutationRecoveryRecord(
      recoveryRoot,
      nextDraft(recoveryPrepared, 'recovery-required', {
        result: recoveryResult,
        recoveryState: 'concurrent-write',
        diagnostics: recoveryResult.diagnostics
      }),
      allowCommit
    );

    expect(terminalEvents.filter(({ kind }) => kind === 'terminal-order-scan')).toHaveLength(1);
    expect(terminalEvents.filter(({ kind }) => kind === 'completion-publish'))
      .toHaveLength(SEMANTIC_MUTATION_TERMINAL_RETENTION + 2);
    expect(terminalEvents.filter(({ kind }) => kind === 'sequence-head-write'))
      .toHaveLength(SEMANTIC_MUTATION_TERMINAL_RETENTION + 2);
    const constructionProbes = terminalEvents.filter(({ kind }) => kind === 'completion-probe');
    expect(constructionProbes).toHaveLength(SEMANTIC_MUTATION_TERMINAL_RETENTION + 2);
    expect(constructionProbes.every((event) => event.kind === 'completion-probe' &&
      event.reason === 'head-catch-up' && event.status === 'missing')).toBe(true);
    const beforePrune = terminalEvents.length;

    await pruneSemanticMutationTerminalRecords(workspaceRoot, allowCommit, terminalTestHooks);

    const pruneEvents = terminalEvents.slice(beforePrune);
    expect(pruneEvents.filter(({ kind }) => kind === 'terminal-order-scan')).toHaveLength(0);
    expect(pruneEvents.filter(({ kind }) => kind === 'transactions-scan')).toHaveLength(1);
    const pruneProbes = pruneEvents.filter(({ kind }) => kind === 'completion-probe');
    expect(pruneProbes)
      .toHaveLength(SEMANTIC_MUTATION_TERMINAL_RETENTION + 2);
    expect(pruneProbes.every((event) => event.kind === 'completion-probe' &&
      event.reason === 'exact' && event.status === 'valid')).toBe(true);

    await expect(access(oldestRejectedRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(oldestVerifiedRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(access(newestRolledBackRoot)).resolves.toBeNull();
    await expect(access(newestVerifiedRoot)).resolves.toBeNull();
    await expect(access(activeRoot)).resolves.toBeNull();
    await expect(access(recoveryRoot)).resolves.toBeNull();
  }, 'engineering-compiler-sm3-terminal-retention-');
}, 180_000);

function expectTransition(source: string, from: string, to: string): void {
  expect(source).toMatch(new RegExp(`["']?${from}["']?:\\s*["']${to}["']`));
}

test('ticket semantic contract lowers into the runtime transition contract', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    const fixture = await prepareTicketSemanticRuntime(workspaceRoot);
    const semanticContext = fixture.compilation.semanticContext!;

    expect(fixture.resolvedLock.semanticLoweringTasks).toBeUndefined();
    expect(Object.isFrozen(semanticContext.snapshot)).toBe(true);
    expect(Object.isFrozen(semanticContext.snapshot.ir)).toBe(true);
    expect(semanticContext.snapshot.ir.facts.some((fact) =>
      fact.subject === 'responsibility:ticket:TicketQuery' &&
      fact.predicate === 'DEPENDS_ON' &&
      fact.object.kind === 'entity' &&
      fact.object.entityId === 'responsibility:tenant:TenantScopeGuard'
    )).toBe(true);
    expect(semanticContext.generatorPlan.tasks[0]).toMatchObject({
      contractId: 'ticket-core',
      stateId: 'ticket-status',
      target: fixture.runtimeTarget,
      generatorEntityId: 'generator:ticket/basic:ticket-status-runtime-contract',
      artifactEntityId: `artifact:${fixture.runtimeTarget}`
    });
    expect(semanticContext.generatorPlan).toMatchObject({
      inputRevision: semanticContext.snapshot.ir.inputRevision,
      semanticRevision: semanticContext.snapshot.ir.semanticRevision
    });
    expect(semanticContext.semanticViews).toMatchObject({
      inputRevision: semanticContext.snapshot.ir.inputRevision,
      semanticRevision: semanticContext.snapshot.ir.semanticRevision
    });
    expect(Object.isFrozen(semanticContext.semanticViews)).toBe(true);
    expect(new Set(semanticContext.semanticViews.views.map((view) => view.viewKind))).toEqual(
      new Set(['architecture', 'scenario', 'state'])
    );
    const sharedFactId = semanticContext.snapshot.ir.facts.find((fact) =>
      fact.subject === 'operation:ticket:transitionTicketStatus' &&
      fact.predicate === 'MUTATES' &&
      fact.object.kind === 'entity' &&
      fact.object.entityId === 'state:ticket:ticket-status'
    )!.id;
    for (const view of [
      semanticContext.semanticViews.views.find((candidate) => candidate.viewKind === 'architecture')!,
      semanticContext.semanticViews.views.find((candidate) => candidate.subject === 'scenario:ticket:transition-ticket-status')!,
      semanticContext.semanticViews.views.find((candidate) => candidate.subject === 'state:ticket:ticket-status')!
    ]) {
      expect(view.nodes.some((node) => node.references.some((reference) => (
        reference.kind === 'fact' && reference.ref === sharedFactId
      )))).toBe(true);
    }
    expect(fixture.composedLock.semanticLoweringTasks?.[0]?.status).toBe('generated');
    expect(fixture.composedLock.generatedPaths).toContain(fixture.runtimeTarget);
    expect(fixture.runtimeContract).toContain('export const TICKET_STATUS_VALUES');
    expect(fixture.runtimeContract).toContain('export const TICKET_STATUS_TRANSITIONS');
    expect(fixture.runtimeContract).toContain('export const NEXT_TICKET_STATUS');
    expect(fixture.runtimeContract).toContain('satisfies Record<TicketStatus, TicketStatus>');
    expectTransition(fixture.runtimeContract, 'closed', 'open');
    expectTransition(fixture.runtimeContract, 'in_progress', 'closed');
    expectTransition(fixture.runtimeContract, 'open', 'in_progress');
    expect(fixture.ticketService).toContain("import { NEXT_TICKET_STATUS } from './ticket-semantic-contract.ts'");
    expect(fixture.ticketService).toContain('Invalid ticket status transition');
    expect(fixture.runtimeContractProvenance).toMatchObject({
      originType: 'generated',
      originId: 'generator:ticket/basic:ticket-status-runtime-contract',
      sourceBlock: 'ticket/basic',
      sourcePath: 'catalog/registry/official/ticket.basic/contracts/ticket.yaml',
      runtimeTarget: fixture.runtimeTarget,
      generatedByPass: 'compose',
      generatorTaskId: 'generator:ticket/basic:ticket-status-runtime-contract',
      generatorEntityId: 'generator:ticket/basic:ticket-status-runtime-contract',
      artifactEntityId: `artifact:${fixture.runtimeTarget}`,
      semanticRevision: semanticContext.semanticRevision,
      compilationTransactionId: fixture.compilation.transactionId,
      overrideStatus: 'none'
    });
    expect(fixture.runtimeContractProvenance?.hash).toBeDefined();
  }, 'engineering-compiler-semantic-runtime-contract-');
}, 120000);

test('ticket semantic core closes the verified pipeline and three canonical projections', async () => {
  const workspaceRoot = await prepareVerifiedWorkspace({
    blockIds: ['ticket/basic'],
    prefix: 'engineering-compiler-semantic-core-vertical-'
  });
  const verificationReportPath = resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.verificationReport);

  const verificationReport = await readJson<VerificationReport>(verificationReportPath);
  const ticketSnapshot = buildValidatedEngineeringIR(
    (await loadWorkspaceEngineeringIRBuildInput(workspaceRoot)).engineeringIRInput
  );
  expect(verificationReport.fast.status).toBe('passed');
  expect(verificationReport.fast.unit.status).toBe('passed');
  expect(verificationReport.fast.acceptance.status).toBe('passed');
  expect(verificationReport.runtime.unit.status).toBe('passed');
  expect(verificationReport.summary.status).toBe('passed');

  const architecture = projectArchitectureView(ticketSnapshot, 'responsibility:ticket:TicketLifecycle');
  expect(architecture.subject).toBe('responsibility:ticket:TicketLifecycle');
  expect(architecture.nodes.some((node) => node.entityId === 'responsibility:ticket:TicketLifecycle')).toBe(true);

  const scenario = projectScenarioView(ticketSnapshot, 'scenario:ticket:create-ticket');
  expect(scenario.subject).toBe('scenario:ticket:create-ticket');
  expect(scenario.nodes.some((node) => node.id === 'scenario:ticket:create-ticket#step:create')).toBe(true);

  const state = projectStateView(ticketSnapshot, 'state:ticket:ticket-status');
  expect(state.subject).toBe('state:ticket:ticket-status');
  expect(state.edges.filter((edge) => edge.relation === 'TRANSITIONS_TO')).toHaveLength(3);
}, 120_000);
