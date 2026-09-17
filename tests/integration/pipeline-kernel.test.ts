import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { readLockFile } from "../../src/adapters/workspace/lock.ts";
import { composeWorkspace, initWorkspace } from '../../src/application/engineering/cli.ts';
import {
  assertIsolatedVerificationCapability,
  mintIsolatedVerificationCapability
} from '../../src/application/engineering/isolated-verification-capability.ts';
import {
  commitPipelineTransaction,
  readPipelineJournal,
  recordPipelinePassStart,
  REFERENCE_PIPELINE_TRANSACTION_ID,
  startPipelineTransaction
} from '../../src/adapters/compilation/pipeline/journal.ts';
import { getWorkspacePaths } from "../../src/adapters/workspace-context.ts";
import { withTempWorkspace } from '../testkit/workspace.ts';

function legacyAdaptJournal(overrides?: Readonly<{
  status?: 'running' | 'failed';
  active?: boolean;
  includeAdapt?: boolean;
  extraField?: boolean;
}>): Record<string, unknown> {
  const startedAt = '2026-08-30T12:11:08.064Z';
  const completedAt = '2026-08-30T12:12:41.953Z';
  const status = overrides?.status ?? 'failed';
  const includeAdapt = overrides?.includeAdapt ?? true;
  return {
    formatVersion: '1',
    ...(overrides?.active ? { activeTransactionId: REFERENCE_PIPELINE_TRANSACTION_ID } : {}),
    transactions: [{
      id: REFERENCE_PIPELINE_TRANSACTION_ID,
      source: 'reference',
      requestedStages: includeAdapt
        ? ['resolve', 'semantic', 'compose', 'adapt', 'verify']
        : ['resolve', 'semantic', 'compose', 'verify'],
      status,
      startedAt,
      ...(status === 'running' ? {} : {
        completedAt,
        errorCode: 'VERIFY-ACCEPTANCE-003',
        message: 'Project verification failed'
      }),
      passRecords: status === 'running'
        ? [{ passId: 'resolve', status: 'running', startedAt }]
        : [
            { passId: 'resolve', status: 'succeeded', startedAt, completedAt },
            ...(includeAdapt
              ? [{ passId: 'adapt', status: 'succeeded', startedAt, completedAt }]
              : []),
            {
              passId: 'verify',
              status: 'failed',
              startedAt,
              completedAt,
              errorCode: 'VERIFY-ACCEPTANCE-003',
              message: 'Project verification failed'
            }
          ]
    }],
    ...(overrides?.extraField ? { futureOwner: 'foreign' } : {})
  };
}

async function preparePipelineJournalParent(workspaceRoot: string): Promise<void> {
  await fs.mkdir(getWorkspacePaths(workspaceRoot).secRoot, { recursive: true });
}

test('isolated Verification capability is opaque and bound to one exact workspace root', () => {
  const workspaceRoot = 'D:\\contract-workspaces\\isolated-a';
  const capability = mintIsolatedVerificationCapability(workspaceRoot);

  expect(() => assertIsolatedVerificationCapability(workspaceRoot, capability)).not.toThrow();
  expect(() => assertIsolatedVerificationCapability('D:\\contract-workspaces\\isolated-b', capability)).toThrow('exact workspace root');
  for (const forged of [{}, { ...capability }, { workspaceRoot }]) {
    expect(() => assertIsolatedVerificationCapability(workspaceRoot, forged)).toThrow('exact workspace root');
  }
});

test('blocked stage is persisted as blocked instead of a pass execution failure', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await initWorkspace(workspaceRoot);

    await expect(composeWorkspace(workspaceRoot)).rejects.toMatchObject({
      code: 'PIPELINE-BLOCKED-002'
    });

    const lock = await readLockFile(workspaceRoot);
    expect(lock.passStatus).toMatchObject({
      resolve: 'pending',
      compose: 'blocked',
      verify: 'blocked',
      repair: 'blocked',
      lock: 'blocked',
      emit: 'blocked'
    });

    const journal = await readPipelineJournal(workspaceRoot);
    const transaction = journal.transactions.at(-1);
    expect(transaction?.status).toBe('failed');
    expect(transaction?.passRecords).toEqual([
      expect.objectContaining({
        passId: 'build-ir',
        status: 'blocked',
        errorCode: 'PIPELINE-BLOCKED-002'
      })
    ]);
  }, 'engineering-compiler-pipeline-blocked-');
});

test('new transaction marks an abandoned running transaction as interrupted', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await preparePipelineJournalParent(workspaceRoot);
    const commitFence = async (): Promise<void> => undefined;
    const firstTransactionId = await startPipelineTransaction(workspaceRoot, 'api', ['resolve'], commitFence);
    await recordPipelinePassStart(workspaceRoot, firstTransactionId, 'resolve', commitFence);

    const secondTransactionId = await startPipelineTransaction(workspaceRoot, 'ci', ['resolve'], commitFence);
    let journal = await readPipelineJournal(workspaceRoot);
    const interrupted = journal.transactions.find((entry) => entry.id === firstTransactionId);

    expect(interrupted).toMatchObject({
      status: 'failed',
      errorCode: 'PIPELINE-INTERRUPTED-001'
    });
    expect(interrupted?.passRecords[0]).toMatchObject({
      passId: 'resolve',
      status: 'failed',
      errorCode: 'PIPELINE-INTERRUPTED-001'
    });
    expect(journal.activeTransactionId).toBe(secondTransactionId);

    await commitPipelineTransaction(workspaceRoot, secondTransactionId, commitFence);
    journal = await readPipelineJournal(workspaceRoot);
    expect(journal.activeTransactionId).toBeUndefined();
    expect(journal.lastCommittedTransactionId).toBe(secondTransactionId);
  }, 'engineering-compiler-pipeline-interruption-');
});

test('reference transaction identity is stable and names the current journal execution', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await preparePipelineJournalParent(workspaceRoot);
    const commitFence = async (): Promise<void> => undefined;
    const firstTransactionId = await startPipelineTransaction(workspaceRoot, 'reference', ['resolve'], commitFence);
    await commitPipelineTransaction(workspaceRoot, firstTransactionId, commitFence);

    const secondTransactionId = await startPipelineTransaction(workspaceRoot, 'reference', ['resolve'], commitFence);
    let journal = await readPipelineJournal(workspaceRoot);

    expect(firstTransactionId).toBe(REFERENCE_PIPELINE_TRANSACTION_ID);
    expect(secondTransactionId).toBe(firstTransactionId);
    expect(journal.activeTransactionId).toBe(secondTransactionId);
    expect(journal.lastCommittedTransactionId).toBeUndefined();
    expect(journal.transactions.filter((entry) => entry.id === secondTransactionId)).toEqual([
      expect.objectContaining({
        source: 'reference',
        requestedStages: ['resolve'],
        status: 'running'
      })
    ]);

    await commitPipelineTransaction(workspaceRoot, secondTransactionId, commitFence);
    journal = await readPipelineJournal(workspaceRoot);
    expect(journal.activeTransactionId).toBeUndefined();
    expect(journal.lastCommittedTransactionId).toBe(secondTransactionId);
    expect(journal.transactions.filter((entry) => entry.id === secondTransactionId)).toHaveLength(1);
    expect(journal.transactions.find((entry) => entry.id === secondTransactionId)?.status).toBe('succeeded');
  }, 'engineering-compiler-reference-transaction-');
});

test('reference entry retires one exact terminal Adapt journal before opening the new transaction', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await preparePipelineJournalParent(workspaceRoot);
    const journalPath = path.join(getWorkspacePaths(workspaceRoot).secRoot, 'pipeline-journal.json');
    const legacyBytes = Buffer.from(`${JSON.stringify(legacyAdaptJournal(), null, 2)}\n`, 'utf8');
    await fs.writeFile(journalPath, legacyBytes);

    expect(() => readPipelineJournal(workspaceRoot)).toThrow('owner-issued Adapt retirement migration');
    const transactionId = await startPipelineTransaction(
      workspaceRoot,
      'reference',
      ['resolve'],
      async () => undefined
    );
    const migrated = readPipelineJournal(workspaceRoot);
    const retirement = migrated.retirements?.[0];
    expect(migrated.formatVersion).toBe('2');
    expect(retirement).toMatchObject({
      retiredStage: 'adapt',
      legacyJournalBytesDigest: `sha256:${createHash('sha256').update(legacyBytes).digest('hex')}`
    });
    expect(migrated.transactions).toEqual([
      expect.objectContaining({
        id: transactionId,
        status: 'running',
        requestedStages: ['resolve'],
        passRecords: []
      })
    ]);

    const evidencePath = path.join(getWorkspacePaths(workspaceRoot).secRoot, retirement!.evidenceFile);
    const receipt = JSON.parse(await fs.readFile(evidencePath, 'utf8')) as {
      source: { bytesBase64: string; parentPhysical: unknown; filePhysical: unknown };
      target: { formatVersion: string; bytesDigest: string };
    };
    expect(Buffer.from(receipt.source.bytesBase64, 'base64')).toEqual(legacyBytes);
    expect(receipt.source.parentPhysical).toEqual(expect.objectContaining({ device: expect.any(String), inode: expect.any(String) }));
    expect(receipt.source.filePhysical).toEqual(expect.objectContaining({ device: expect.any(String), inode: expect.any(String) }));
    expect(receipt.target).toEqual(expect.objectContaining({
      formatVersion: '2',
      bytesDigest: expect.stringMatching(/^sha256:[0-9a-f]{64}$/u)
    }));
    const preservedLegacy = JSON.parse(Buffer.from(receipt.source.bytesBase64, 'base64').toString('utf8')) as {
      transactions: Array<{ completedAt: string; errorCode: string; message: string }>;
    };
    expect(preservedLegacy.transactions[0]).toMatchObject({
      completedAt: '2026-08-30T12:12:41.953Z',
      errorCode: 'VERIFY-ACCEPTANCE-003',
      message: 'Project verification failed'
    });

    await commitPipelineTransaction(workspaceRoot, transactionId, async () => undefined);
    await startPipelineTransaction(workspaceRoot, 'reference', ['resolve'], async () => undefined);
    expect((await fs.readdir(getWorkspacePaths(workspaceRoot).secRoot)).filter(
      (name) => name === retirement!.evidenceFile
    )).toHaveLength(1);
    await fs.rm(evidencePath);
    expect(() => readPipelineJournal(workspaceRoot)).toThrow('retirement evidence is missing');
  }, 'engineering-compiler-pipeline-adapt-retirement-');
});

test('reference entry rejects nonterminal, foreign and structurally unknown legacy journals without mutation', async () => {
  const canonicalLegacySource = JSON.stringify(legacyAdaptJournal(), null, 2);
  const candidates = [
    JSON.stringify(legacyAdaptJournal({ status: 'running', active: true }), null, 2),
    JSON.stringify(legacyAdaptJournal({ includeAdapt: false }), null, 2),
    JSON.stringify(legacyAdaptJournal({ extraField: true }), null, 2),
    canonicalLegacySource.replace(
      '"formatVersion": "1"',
      '"formatVersion": "1",\n  "formatVersion": "1"'
    )
  ];
  for (const [index, candidateSource] of candidates.entries()) {
    await withTempWorkspace(async (workspaceRoot) => {
      await preparePipelineJournalParent(workspaceRoot);
      const secRoot = getWorkspacePaths(workspaceRoot).secRoot;
      const journalPath = path.join(secRoot, 'pipeline-journal.json');
      const legacyBytes = Buffer.from(`${candidateSource}\n`, 'utf8');
      await fs.writeFile(journalPath, legacyBytes);

      await expect(startPipelineTransaction(
        workspaceRoot,
        'reference',
        ['resolve'],
        async () => undefined
      )).rejects.toThrow(/Pipeline journal/);
      expect(await fs.readFile(journalPath)).toEqual(legacyBytes);
      expect((await fs.readdir(secRoot)).filter((name) => name !== 'pipeline-journal.json')).toEqual([]);
    }, `engineering-compiler-invalid-pipeline-retirement-${index}-`);
  }
});

test('reference retirement refuses an exact-byte physical replacement after evidence publication', async () => {
  await withTempWorkspace(async (workspaceRoot) => {
    await preparePipelineJournalParent(workspaceRoot);
    const secRoot = getWorkspacePaths(workspaceRoot).secRoot;
    const journalPath = path.join(secRoot, 'pipeline-journal.json');
    const legacyBytes = Buffer.from(`${JSON.stringify(legacyAdaptJournal(), null, 2)}\n`, 'utf8');
    await fs.writeFile(journalPath, legacyBytes);
    let replaced = false;

    await expect(startPipelineTransaction(
      workspaceRoot,
      'reference',
      ['resolve'],
      async () => {
        if (replaced || (await fs.readdir(secRoot)).filter((name) => name.endsWith('.json')).length === 1) {
          return;
        }
        const replacementPath = path.join(secRoot, 'replacement-journal.json');
        await fs.writeFile(replacementPath, legacyBytes);
        await fs.rm(journalPath);
        await fs.rename(replacementPath, journalPath);
        replaced = true;
      }
    )).rejects.toThrow('changed during Adapt retirement migration');
    expect(replaced).toBe(true);
    expect(await fs.readFile(journalPath)).toEqual(legacyBytes);
    expect(() => readPipelineJournal(workspaceRoot)).toThrow('owner-issued Adapt retirement migration');
  }, 'engineering-compiler-pipeline-adapt-physical-cas-');
});
