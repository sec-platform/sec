import { expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createSemanticMutationPathProofDirectory,
  createSemanticMutationRecoveryRecordsDirectory,
  createSemanticMutationTerminalOrderDirectory,
  createSemanticMutationTransactionDirectory,
  retireSemanticMutationStagingWorkspace
} from '../../../src/adapters/mutation/transaction-directories.ts';
import { semanticMutationTransactionRoot } from '../../../src/adapters/mutation/transaction-identity.ts';
import { sha256 } from '../../../src/compiler/semantic-mutation/canonical.ts';

const fence = async (): Promise<void> => {};
function fixture() {
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'sec-staging-directory-'));
  const transactionRoot = semanticMutationTransactionRoot(workspace, sha256('staging-directory-fixture'));
  return { workspace, transactionRoot, stage: path.join(transactionRoot, 'workspace') };
}
const create = (f: ReturnType<typeof fixture>) => createSemanticMutationTransactionDirectory(f.workspace, f.transactionRoot, fence);
const cleanup = (f: ReturnType<typeof fixture>) => rmSync(f.workspace, { recursive: true, force: true });

test('mutation directory allocation is no-follow, reusable and keeps a distinct path-proof child', async () => {
  const f = fixture();
  try {
    const transaction = await create(f);
    const proof = await createSemanticMutationPathProofDirectory(transaction, fence);
    expect(transaction.path).toBe(f.transactionRoot);
    expect(proof.path).toBe(path.join(f.transactionRoot, 'path-proof'));
    expect((await create(f)).objectId).toBe(transaction.objectId);
    expect((await createSemanticMutationPathProofDirectory(transaction, fence)).objectId).toBe(proof.objectId);
    await retireSemanticMutationStagingWorkspace(transaction, fence);
    expect(readdirSync(f.transactionRoot)).toEqual(['path-proof']);
  } finally { cleanup(f); }
});


test('journal directory allocation uses the retained no-follow owner and is reusable', async () => {
  const f = fixture();
  const requestIdentityDigest = path.basename(f.transactionRoot);
  try {
    const records = await createSemanticMutationRecoveryRecordsDirectory(
      f.transactionRoot,
      `sha256:${requestIdentityDigest}`,
      fence
    );
    const terminalOrder = await createSemanticMutationTerminalOrderDirectory(
      f.transactionRoot,
      `sha256:${requestIdentityDigest}`,
      fence
    );
    expect(records.path).toBe(path.join(f.transactionRoot, 'records'));
    expect(terminalOrder.path).toBe(
      path.join(f.workspace, '.sec', 'semantic-mutation', 'journal', 'terminal-order')
    );
    expect((await createSemanticMutationRecoveryRecordsDirectory(
      f.transactionRoot,
      `sha256:${requestIdentityDigest}`,
      fence
    )).objectId).toBe(records.objectId);
    expect((await createSemanticMutationTerminalOrderDirectory(
      f.transactionRoot,
      `sha256:${requestIdentityDigest}`,
      fence
    )).objectId).toBe(terminalOrder.objectId);
  } finally { cleanup(f); }
});

test.skipIf(process.platform !== 'linux')(
  'journal directory allocation never follows a substituted namespace ancestor',
  async () => {
    const f = fixture();
    const outside = mkdtempSync(path.join(os.tmpdir(), 'sec-journal-outside-'));
    const requestIdentityDigest = `sha256:${path.basename(f.transactionRoot)}`;
    try {
      mkdirSync(path.join(f.workspace, '.sec'));
      symlinkSync(outside, path.join(f.workspace, '.sec', 'semantic-mutation'));
      await expect(createSemanticMutationRecoveryRecordsDirectory(
        f.transactionRoot,
        requestIdentityDigest,
        fence
      )).rejects.toThrow();
      await expect(createSemanticMutationTerminalOrderDirectory(
        f.transactionRoot,
        requestIdentityDigest,
        fence
      )).rejects.toThrow();
      expect(readdirSync(outside)).toEqual([]);
    } finally {
      cleanup(f);
      rmSync(outside, { recursive: true, force: true });
    }
  }
);

test('staging retirement removes only its exact child and preserves artifacts and path proof', async () => {
  const f = fixture();
  try {
    const transaction = await create(f);
    await createSemanticMutationPathProofDirectory(transaction, fence);
    writeFileSync(path.join(f.transactionRoot, 'original.backup'), 'retained backup');
    mkdirSync(path.join(f.stage, 'nested'), { recursive: true });
    writeFileSync(path.join(f.stage, 'nested', 'source.yaml'), 'source: before');
    await retireSemanticMutationStagingWorkspace(transaction, fence);
    expect(existsSync(f.stage)).toBe(false);
    expect(readFileSync(path.join(f.transactionRoot, 'original.backup'), 'utf8')).toBe('retained backup');
    expect(existsSync(path.join(f.transactionRoot, 'path-proof'))).toBe(true);
  } finally { cleanup(f); }
});

test('staging retirement does not read or hash large sparse source leaves', async () => {
  const f = fixture();
  try {
    const transaction = await create(f);
    mkdirSync(f.stage);
    const large = path.join(f.stage, 'large.bin');
    writeFileSync(large, '');
    truncateSync(large, 128 * 1024 * 1024);
    await retireSemanticMutationStagingWorkspace(transaction, fence);
    expect(existsSync(f.stage)).toBe(false);
  } finally { cleanup(f); }
});

test('a failed staging retirement fence preserves the admitted tree', async () => {
  const f = fixture();
  try {
    const transaction = await create(f);
    mkdirSync(f.stage);
    writeFileSync(path.join(f.stage, 'source.yaml'), 'preserve');
    const failure = new Error('write lease rejected');
    await expect(retireSemanticMutationStagingWorkspace(transaction, async () => { throw failure; })).rejects.toBe(failure);
    expect(readFileSync(path.join(f.stage, 'source.yaml'), 'utf8')).toBe('preserve');
  } finally { cleanup(f); }
});

test('a staging directory that appears across an absence fence is not adopted for cleanup', async () => {
  const f = fixture();
  try {
    const transaction = await create(f);
    await expect(retireSemanticMutationStagingWorkspace(transaction, async () => {
      mkdirSync(f.stage);
      writeFileSync(path.join(f.stage, 'foreign'), 'keep');
    })).rejects.toThrow('appeared');
    expect(readFileSync(path.join(f.stage, 'foreign'), 'utf8')).toBe('keep');
  } finally { cleanup(f); }
});

test.skipIf(process.platform !== 'linux')('staging retirement rejects a replaced root across an awaited fence', async () => {
  const f = fixture();
  try {
    const transaction = await create(f);
    mkdirSync(f.stage);
    writeFileSync(path.join(f.stage, 'original'), 'original');
    await expect(retireSemanticMutationStagingWorkspace(transaction, async () => {
      renameSync(f.stage, `${f.stage}-displaced`);
      mkdirSync(f.stage);
      writeFileSync(path.join(f.stage, 'foreign'), 'foreign');
    })).rejects.toThrow();
    expect(readFileSync(path.join(f.stage, 'foreign'), 'utf8')).toBe('foreign');
    expect(readFileSync(path.join(`${f.stage}-displaced`, 'original'), 'utf8')).toBe('original');
  } finally { cleanup(f); }
});

test.skipIf(process.platform !== 'linux')('staging retirement unlinks descendant aliases but never traverses them', async () => {
  const f = fixture();
  try {
    const transaction = await create(f);
    const outside = path.join(f.workspace, 'outside');
    mkdirSync(outside);
    writeFileSync(path.join(outside, 'keep'), 'outside');
    mkdirSync(f.stage);
    symlinkSync(outside, path.join(f.stage, 'alias'));
    await retireSemanticMutationStagingWorkspace(transaction, fence);
    expect(readFileSync(path.join(outside, 'keep'), 'utf8')).toBe('outside');
    expect(existsSync(f.stage)).toBe(false);
    symlinkSync(outside, f.stage);
    await expect(retireSemanticMutationStagingWorkspace(transaction, fence)).rejects.toThrow();
    expect(readFileSync(path.join(outside, 'keep'), 'utf8')).toBe('outside');
  } finally { cleanup(f); }
});

test.skipIf(process.platform !== 'linux')('staging retirement restores only owned directory permissions required for deletion', async () => {
  const f = fixture();
  try {
    const transaction = await create(f);
    const nested = path.join(f.stage, 'nested');
    mkdirSync(nested, { recursive: true });
    writeFileSync(path.join(nested, 'readonly.yaml'), 'source');
    chmodSync(path.join(nested, 'readonly.yaml'), 0o444);
    chmodSync(nested, 0o555);
    await retireSemanticMutationStagingWorkspace(transaction, fence);
    expect(existsSync(f.stage)).toBe(false);
  } finally { cleanup(f); }
});
