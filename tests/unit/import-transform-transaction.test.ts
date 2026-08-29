import { expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  publishImportTransformTransaction,
  publishRepositoryModuleRelocationTransaction
} from '../../src/development/runner/import-transform-transaction.ts';
import { compileSecRepositoryModuleGraph, compileSecRepositoryModuleRelocationPlanEntry } from '../../src/system-architecture/repository-modules/contract.ts';

async function withWorkspace(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-import-transaction-'));
  try { await run(root); } finally { await rm(root, { recursive: true, force: true }); }
}

test('journal faults preserve physical rollback priority and ancestor aliases publish zero outside bytes', async () => {
  const outside = await mkdtemp(path.join(tmpdir(), 'sec-import-outside-'));
  try {
    await writeFile(path.join(outside, 'a.ts'), 'outside\n');
    await withWorkspace(async (root) => {
      const link = path.join(root, 'link');
      await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
      await expect(publishImportTransformTransaction(root, [{
        relativePath: 'link/a.ts', expectedBytes: Buffer.from('outside\n'), replacementBytes: Buffer.from('changed\n')
      }])).rejects.toThrow();
      expect(await readFile(path.join(outside, 'a.ts'), 'utf8')).toBe('outside\n');
    });
  } finally { await rm(outside, { recursive: true, force: true }); }

  const runRollback = async (hooks: Parameters<typeof publishImportTransformTransaction>[2]) => {
    let outcome: Awaited<ReturnType<typeof publishImportTransformTransaction>>;
    let first = '';
    await withWorkspace(async (root) => {
      const a = path.join(root, 'a.ts');
      await Promise.all([writeFile(a, 'a0\n'), writeFile(path.join(root, 'b.ts'), 'b0\n')]);
      outcome = await publishImportTransformTransaction(root, [
        { relativePath: 'a.ts', expectedBytes: Buffer.from('a0\n'), replacementBytes: Buffer.from('a1\n') },
        { relativePath: 'b.ts', expectedBytes: Buffer.from('b0\n'), replacementBytes: Buffer.from('b1\n') }
      ], { ...hooks, afterPublish: async (_file, index) => {
        if (index === 0) await writeFile(path.join(root, 'b.ts'), 'external\n');
      } });
      first = await readFile(a, 'utf8');
    });
    return { outcome: outcome!, first };
  };
  const journalFault = await runRollback({ beforeJournalAppend: (state) => {
    if (state === 'rolling-back') throw new Error('journal fault');
  } });
  expect(journalFault.outcome).toMatchObject({ status: 'recovery-required', reasonCode: 'journal-failed' });
  expect(journalFault.first).toBe('a0\n');
  const physicalFault = await runRollback({ beforeJournalAppend: (state) => {
    if (state === 'rolling-back' || state === 'recovery-required') throw new Error('journal fault');
  }, beforeRollback: () => { throw new Error('physical rollback fault'); } });
  expect(physicalFault.outcome).toMatchObject({ status: 'recovery-required', reasonCode: 'rollback-failed' });
  expect(physicalFault.first).toBe('a1\n');
  const terminalFault = await runRollback({ beforeJournalAppend: (state) => {
    if (state === 'rolled-back') throw new Error('terminal journal fault');
  } });
  expect(terminalFault.outcome).toMatchObject({ status: 'recovery-required', reasonCode: 'journal-failed' });
  expect(terminalFault.first).toBe('a0\n');
});

test('ancestor replacement after publication becomes a rollback conflict before any outside write', async () => {
  const outside = await mkdtemp(path.join(tmpdir(), 'sec-import-ancestor-outside-'));
  try {
    await writeFile(path.join(outside, 'a.ts'), 'outside\n');
    await withWorkspace(async (root) => {
      const link = path.join(root, 'link');
      await mkdir(link);
      await Promise.all([writeFile(path.join(link, 'a.ts'), 'a0\n'), writeFile(path.join(root, 'b.ts'), 'b0\n')]);
      const outcome = await publishImportTransformTransaction(root, [
        { relativePath: 'link/a.ts', expectedBytes: Buffer.from('a0\n'), replacementBytes: Buffer.from('a1\n') },
        { relativePath: 'b.ts', expectedBytes: Buffer.from('b0\n'), replacementBytes: Buffer.from('b1\n') }
      ], {
        afterPublish: async (_file, index) => {
          if (index !== 0) return;
          await rm(link, { recursive: true, force: true });
          await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
        }
      });
      expect(outcome).toMatchObject({ status: 'recovery-required', reasonCode: 'rollback-conflict' });
      expect(await readFile(path.join(outside, 'a.ts'), 'utf8')).toBe('outside\n');
    });
  } finally {
    await rm(outside, { recursive: true, force: true });
  }
});

test('a crash after durable publication and before published progress is reconciled before the next transaction', async () => {
  await withWorkspace(async (root) => {
    const transactionRoot = path.join(root, '.sec', 'import-transform-transactions', 'crash-before-progress');
    await mkdir(transactionRoot, { recursive: true });
    await Promise.all([writeFile(path.join(root, 'a.ts'), 'a1\n'), writeFile(path.join(root, 'b.ts'), 'b0\n')]);
    const expected = Buffer.from('a0\n');
    const replacement = Buffer.from('a1\n');
    const { digest } = await import('../../src/system-architecture/foundation/runtime/canonical.ts');
    const stem = digest('a.ts');
    await chmod(path.join(root, 'a.ts'), 0o644);
    const targetMode = (await stat(path.join(root, 'a.ts'))).mode & 0o777;
    await Promise.all([
      writeFile(path.join(transactionRoot, `${stem}.preimage`), expected),
      writeFile(path.join(transactionRoot, `${stem}.replacement`), replacement),
      writeFile(path.join(transactionRoot, 'binding.json'), `${JSON.stringify({
        formatVersion: 'sec-import-transform-transaction-v2', transactionId: 'crash-before-progress', workspaceRoot: root,
        writes: [{ relativePath: 'a.ts',
          preimageCandidateRelativePath: 'a.ts.imports-transform-crash-before-progress.preimage.candidate',
          replacementCandidateRelativePath: 'a.ts.imports-transform-crash-before-progress.replacement.candidate',
          expectedDigest: digest(expected), replacementDigest: digest(replacement), mode: targetMode }]
      })}\n`),
      writeFile(path.join(transactionRoot, 'journal.jsonl'), `${JSON.stringify({
        formatVersion: 'sec-import-transform-journal-entry-v2', transactionId: 'crash-before-progress', state: 'prepared',
        files: [{ relativePath: 'a.ts', expectedDigest: digest(expected), replacementDigest: digest(replacement) }],
        published: [], outstanding: [], publicationReasonCode: null, recoveryReasonCode: null
      })}\n${JSON.stringify({
        formatVersion: 'sec-import-transform-journal-entry-v2', transactionId: 'crash-before-progress', state: 'publishing',
        files: [{ relativePath: 'a.ts', expectedDigest: digest(expected), replacementDigest: digest(replacement) }],
        published: [], outstanding: [], publicationReasonCode: null, recoveryReasonCode: null
      })}\n`)
    ]);
    const outcome = await publishImportTransformTransaction(root, [
      { relativePath: 'b.ts', expectedBytes: Buffer.from('b0\n'), replacementBytes: Buffer.from('b1\n') }
    ]);
    expect(outcome.status).toBe('accepted');
    expect(await readFile(path.join(root, 'a.ts'), 'utf8')).toBe('a0\n');
    expect(await readFile(path.join(root, 'b.ts'), 'utf8')).toBe('b1\n');
    expect(await readFile(path.join(transactionRoot, 'journal.jsonl'), 'utf8')).toContain('"state":"rolled-back"');
  });
});

test('only an exact binding-owned candidate residue is removed during recovery', async () => {
  const run = async (candidateBytes: string) => {
    let result!: Awaited<ReturnType<typeof publishImportTransformTransaction>>;
    let files: string[] = [];
    await withWorkspace(async (root) => {
      const transactionId = 'candidate-residue';
      const transactionRoot = path.join(root, '.sec', 'import-transform-transactions', transactionId);
      const target = path.join(root, 'a.ts');
      const candidate = `${target}.imports-transform-${transactionId}.replacement.candidate`;
      const expected = Buffer.from('a0\n');
      const replacement = Buffer.from('a1\n');
      const { digest } = await import('../../src/system-architecture/foundation/runtime/canonical.ts');
      const stem = digest('a.ts');
      await mkdir(transactionRoot, { recursive: true });
      await Promise.all([
        writeFile(target, expected),
        writeFile(path.join(root, 'b.ts'), 'b0\n'),
        writeFile(candidate, candidateBytes)
      ]);
      await Promise.all([chmod(target, 0o644), chmod(candidate, 0o644)]);
      const targetMode = (await stat(target)).mode & 0o777;
      await Promise.all([
        writeFile(path.join(transactionRoot, `${stem}.preimage`), expected),
        writeFile(path.join(transactionRoot, `${stem}.replacement`), replacement),
        writeFile(path.join(transactionRoot, 'binding.json'), `${JSON.stringify({
          formatVersion: 'sec-import-transform-transaction-v2', transactionId, workspaceRoot: root,
          writes: [{ relativePath: 'a.ts',
            preimageCandidateRelativePath: `a.ts.imports-transform-${transactionId}.preimage.candidate`,
            replacementCandidateRelativePath: `a.ts.imports-transform-${transactionId}.replacement.candidate`,
            expectedDigest: digest(expected), replacementDigest: digest(replacement), mode: targetMode }]
        })}\n`),
        writeFile(path.join(transactionRoot, 'journal.jsonl'), `${JSON.stringify({
          formatVersion: 'sec-import-transform-journal-entry-v2', transactionId, state: 'prepared',
          files: [{ relativePath: 'a.ts', expectedDigest: digest(expected), replacementDigest: digest(replacement) }],
          published: [], outstanding: [], publicationReasonCode: null, recoveryReasonCode: null
        })}\n`)
      ]);
      result = await publishImportTransformTransaction(root, [{
        relativePath: 'b.ts', expectedBytes: Buffer.from('b0\n'), replacementBytes: Buffer.from('b1\n')
      }]);
      files = await readdir(root);
    });
    return { result, files };
  };
  const exact = await run('a1\n');
  expect(exact.result.status).toBe('accepted');
  expect(exact.files.some((name) => name.endsWith('.candidate'))).toBe(false);
  const drifted = await run('unknown\n');
  expect(drifted.result).toMatchObject({ status: 'recovery-required', reasonCode: 'rollback-conflict' });
  expect(drifted.files.some((name) => name.endsWith('.candidate'))).toBe(true);
});

test('candidate rename CAS preserves an external target write made after candidate sync', async () => {
  await withWorkspace(async (root) => {
    const target = path.join(root, 'a.ts');
    await writeFile(target, 'a0\n');
    const outcome = await publishImportTransformTransaction(root, [{
      relativePath: 'a.ts', expectedBytes: Buffer.from('a0\n'), replacementBytes: Buffer.from('a1\n')
    }], {
      beforeCandidateSync: async () => { await writeFile(target, 'external\n'); }
    });
    expect(outcome).toMatchObject({ status: 'rolled-back', reasonCode: 'preimage-conflict' });
    expect(await readFile(target, 'utf8')).toBe('external\n');
  });
});

test('post-rename ambiguity journals exactly one conservative in-flight publication edge', async () => {
  await withWorkspace(async (root) => {
    const target = path.join(root, 'a.ts');
    await writeFile(target, 'a0\n');
    const outcome = await publishImportTransformTransaction(root, [{
      relativePath: 'a.ts', expectedBytes: Buffer.from('a0\n'), replacementBytes: Buffer.from('a1\n')
    }], {
      afterCandidateRename: async (targetPath) => {
        await writeFile(targetPath, 'external\n');
        throw new Error('post-rename durability fault');
      }
    });
    expect(outcome).toMatchObject({
      status: 'recovery-required', reasonCode: 'rollback-conflict', files: ['a.ts']
    });
    const entries = (await readFile(outcome.journalPath, 'utf8')).trim().split('\n').map(
      (line) => JSON.parse(line) as Record<string, unknown>
    );
    expect(entries.at(-1)).toMatchObject({
      state: 'recovery-required',
      published: ['a.ts'],
      outstanding: ['a.ts'],
      recoveryReasonCode: 'rollback-conflict'
    });
    expect(await readFile(target, 'utf8')).toBe('external\n');
  });
});

test('pre-rename durability faults preserve original bytes and mode', async () => {
  await withWorkspace(async (root) => {
    const target = path.join(root, 'a.ts');
    await writeFile(target, 'a0\n');
    await chmod(target, 0o600);
    const originalMode = (await stat(target)).mode & 0o777;
    let temporaryPath = '';
    const outcome = await publishImportTransformTransaction(root, [
      { relativePath: 'a.ts', expectedBytes: Buffer.from('a0\n'), replacementBytes: Buffer.from('a1\n') }
    ], {
      beforeCandidateSync: (candidate) => {
        temporaryPath = candidate;
        throw new Error('candidate durability fault');
      }
    });
    expect(outcome.status).toBe('rolled-back');
    if (outcome.status !== 'rolled-back') throw new Error('expected rolled-back outcome');
    expect(outcome.reasonCode).toBe('publication-failed');
    expect(await readFile(target, 'utf8')).toBe('a0\n');
    expect((await stat(target)).mode & 0o777).toBe(originalMode);
    expect(temporaryPath).not.toBe('');
    expect(await readdir(root)).not.toContain(path.basename(temporaryPath));
  });
});

test('candidate publication restores the captured target mode despite creation defaults', async () => {
  await withWorkspace(async (root) => {
    const target = path.join(root, 'a.ts');
    await writeFile(target, 'a0\n');
    await chmod(target, 0o755);
    const originalMode = (await stat(target)).mode & 0o777;
    const outcome = await publishImportTransformTransaction(root, [
      { relativePath: 'a.ts', expectedBytes: Buffer.from('a0\n'), replacementBytes: Buffer.from('a1\n') }
    ]);
    expect(outcome.status).toBe('accepted');
    expect((await stat(target)).mode & 0o777).toBe(originalMode);
  });
});

test('complete import write set is accepted under one durable transaction', async () => {
  await withWorkspace(async (root) => {
    await Promise.all([writeFile(path.join(root, 'a.ts'), 'a0\n'), writeFile(path.join(root, 'b.ts'), 'b0\n')]);
    const outcome = await publishImportTransformTransaction(root, [
      { relativePath: 'a.ts', expectedBytes: Buffer.from('a0\n'), replacementBytes: Buffer.from('a1\n') },
      { relativePath: 'b.ts', expectedBytes: Buffer.from('b0\n'), replacementBytes: Buffer.from('b1\n') }
    ]);
    expect(outcome.status).toBe('accepted');
    expect(await readFile(path.join(root, 'a.ts'), 'utf8')).toBe('a1\n');
    expect(await readFile(path.join(root, 'b.ts'), 'utf8')).toBe('b1\n');
    expect(await readFile(outcome.journalPath, 'utf8')).toContain('"state":"accepted"');
  });
});

test('concurrent preimage drift rolls back every already-published file', async () => {
  await withWorkspace(async (root) => {
    await Promise.all([writeFile(path.join(root, 'a.ts'), 'a0\n'), writeFile(path.join(root, 'b.ts'), 'b0\n')]);
    const outcome = await publishImportTransformTransaction(root, [
      { relativePath: 'a.ts', expectedBytes: Buffer.from('a0\n'), replacementBytes: Buffer.from('a1\n') },
      { relativePath: 'b.ts', expectedBytes: Buffer.from('b0\n'), replacementBytes: Buffer.from('b1\n') }
    ], {
      afterPublish: async (_relativePath, index) => {
        if (index === 0) await writeFile(path.join(root, 'b.ts'), 'external\n');
      }
    });
    expect(outcome.status).toBe('rolled-back');
    expect(await readFile(path.join(root, 'a.ts'), 'utf8')).toBe('a0\n');
    expect(await readFile(path.join(root, 'b.ts'), 'utf8')).toBe('external\n');
    expect(await readFile(outcome.journalPath, 'utf8')).toContain('"state":"rolled-back"');
  });
});

test('mode drift is a preimage conflict before a transform can restore a stale mode', async () => {
  await withWorkspace(async (root) => {
    const target = path.join(root, 'a.ts');
    await writeFile(target, 'a0\n');
    await chmod(target, 0o600);
    let concurrentMode = 0;
    const outcome = await publishImportTransformTransaction(root, [
      { relativePath: 'a.ts', expectedBytes: Buffer.from('a0\n'), replacementBytes: Buffer.from('a1\n') }
    ], {
      beforePublish: async () => {
        await chmod(target, 0o400);
        concurrentMode = (await stat(target)).mode & 0o777;
      }
    });
    expect(outcome.status).toBe('rolled-back');
    if (outcome.status !== 'rolled-back') throw new Error('expected rolled-back outcome');
    expect(outcome.reasonCode).toBe('preimage-conflict');
    expect(await readFile(target, 'utf8')).toBe('a0\n');
    expect((await stat(target)).mode & 0o777).toBe(concurrentMode);
  });
});

test('rollback conflict preserves recovery material and returns recovery-required', async () => {
  await withWorkspace(async (root) => {
    await Promise.all([writeFile(path.join(root, 'a.ts'), 'a0\n'), writeFile(path.join(root, 'b.ts'), 'b0\n')]);
    const outcome = await publishImportTransformTransaction(root, [
      { relativePath: 'a.ts', expectedBytes: Buffer.from('a0\n'), replacementBytes: Buffer.from('a1\n') },
      { relativePath: 'b.ts', expectedBytes: Buffer.from('b0\n'), replacementBytes: Buffer.from('b1\n') }
    ], {
      afterPublish: async (_relativePath, index) => {
        if (index === 0) {
          await writeFile(path.join(root, 'a.ts'), 'external-a\n');
          await writeFile(path.join(root, 'b.ts'), 'external-b\n');
        }
      }
    });
    expect(outcome.status).toBe('recovery-required');
    if (outcome.status !== 'recovery-required') throw new Error('expected recovery-required outcome');
    expect(outcome.reasonCode).toBe('rollback-conflict');
    expect(await readFile(path.join(root, 'a.ts'), 'utf8')).toBe('external-a\n');
    expect(await readFile(outcome.journalPath, 'utf8')).toContain('"state":"recovery-required"');
  });
});

test('rollback preserves a concurrent mode change even when replacement bytes still match', async () => {
  await withWorkspace(async (root) => {
    const target = path.join(root, 'a.ts');
    await writeFile(target, 'a0\n');
    await writeFile(path.join(root, 'b.ts'), 'b0\n');
    await chmod(target, 0o600);
    let concurrentMode = 0;
    const outcome = await publishImportTransformTransaction(root, [
      { relativePath: 'a.ts', expectedBytes: Buffer.from('a0\n'), replacementBytes: Buffer.from('a1\n') },
      { relativePath: 'b.ts', expectedBytes: Buffer.from('b0\n'), replacementBytes: Buffer.from('b1\n') }
    ], {
      afterPublish: async (_file, index) => {
        if (index === 0) await writeFile(path.join(root, 'b.ts'), 'external\n');
      },
      beforeRollback: async () => {
        await chmod(target, 0o400);
        concurrentMode = (await stat(target)).mode & 0o777;
      }
    });
    expect(outcome.status).toBe('recovery-required');
    if (outcome.status !== 'recovery-required') throw new Error('expected recovery-required outcome');
    expect(outcome.reasonCode).toBe('rollback-conflict');
    expect(await readFile(target, 'utf8')).toBe('a1\n');
    expect((await stat(target)).mode & 0o777).toBe(concurrentMode);
  });
});

test('final write-set drift cannot be accepted after every target was published', async () => {
  await withWorkspace(async (root) => {
    await Promise.all([writeFile(path.join(root, 'a.ts'), 'a0\n'), writeFile(path.join(root, 'b.ts'), 'b0\n')]);
    const outcome = await publishImportTransformTransaction(root, [
      { relativePath: 'a.ts', expectedBytes: Buffer.from('a0\n'), replacementBytes: Buffer.from('a1\n') },
      { relativePath: 'b.ts', expectedBytes: Buffer.from('b0\n'), replacementBytes: Buffer.from('b1\n') }
    ], {
      afterPublish: async (_relativePath, index) => {
        if (index === 1) await writeFile(path.join(root, 'a.ts'), 'external-a\n');
      }
    });
    expect(outcome.status).toBe('recovery-required');
    expect(await readFile(path.join(root, 'a.ts'), 'utf8')).toBe('external-a\n');
    expect(await readFile(outcome.journalPath, 'utf8')).not.toContain('"state":"accepted"');
  });
});

test('unresolved repository-module references stop relocation before any physical effect', async () => {
  await withWorkspace(async (root) => {
    const sourceDirectory = path.join(root, 'src');
    await mkdir(sourceDirectory);
    const source = path.join(sourceDirectory, 'a.ts');
    await writeFile(source, "import './missing.ts';\nexport const value = 1;\n");
    const graph = compileSecRepositoryModuleGraph({
      files: ['src/a.ts'],
      readSource: () => "import './missing.ts';\nexport const value = 1;\n"
    });
    const entry = compileSecRepositoryModuleRelocationPlanEntry(graph, 'src/a.ts', 'src/moved.ts');
    const outcome = await publishRepositoryModuleRelocationTransaction(root, [{
      entry,
      expectedSourceBytes: await readFile(source),
      target: { state: 'absent' }
    }]);
    expect(outcome).toMatchObject({ status: 'unresolved', files: ['src/a.ts'] });
    if (outcome.status !== 'unresolved') throw new Error('expected unresolved relocation');
    expect(outcome.unresolvedReferences.some((reference) => reference.includes('unresolved-target'))).toBe(true);
    expect(await readFile(source, 'utf8')).toContain('export const value');
    expect(await readdir(root)).toEqual(['src']);
  });
});

test('resolved TypeScript relocation publishes target without replacing a target and journals final readback', async () => {
  await withWorkspace(async (root) => {
    const sourceDirectory = path.join(root, 'src');
    await mkdir(sourceDirectory);
    const source = path.join(sourceDirectory, 'a.ts');
    const target = path.join(sourceDirectory, 'moved.ts');
    const sourceBytes = Buffer.from('export const value = 1;\n');
    await writeFile(source, sourceBytes);
    const graph = compileSecRepositoryModuleGraph({
      files: ['src/a.ts'],
      readSource: () => sourceBytes.toString('utf8')
    });
    const entry = compileSecRepositoryModuleRelocationPlanEntry(graph, 'src/a.ts', 'src/moved.ts');
    const outcome = await publishRepositoryModuleRelocationTransaction(root, [{
      entry,
      expectedSourceBytes: sourceBytes,
      target: { state: 'absent' }
    }]);
    expect(outcome.status).toBe('accepted');
    if (outcome.status !== 'accepted') throw new Error('expected accepted relocation');
    expect(await readFile(target, 'utf8')).toBe(sourceBytes.toString('utf8'));
    await expect(readFile(source)).rejects.toMatchObject({ code: 'ENOENT' });
    const journal = await readFile(outcome.journalPath, 'utf8');
    expect(journal).toContain('"state":"accepted"');
    expect(journal).toContain('"targetPublished"');
    expect(journal).toContain('"sourceDeleted"');
  });
});

test('relocation target CAS rejects a foreign target created after preflight', async () => {
  await withWorkspace(async (root) => {
    const sourceDirectory = path.join(root, 'src');
    await mkdir(sourceDirectory);
    const source = path.join(sourceDirectory, 'a.ts');
    const target = path.join(sourceDirectory, 'moved.ts');
    const sourceBytes = Buffer.from('export const value = 1;\n');
    await writeFile(source, sourceBytes);
    const graph = compileSecRepositoryModuleGraph({
      files: ['src/a.ts'],
      readSource: () => sourceBytes.toString('utf8')
    });
    const entry = compileSecRepositoryModuleRelocationPlanEntry(graph, 'src/a.ts', 'src/moved.ts');
    const outcome = await publishRepositoryModuleRelocationTransaction(root, [{
      entry,
      expectedSourceBytes: sourceBytes,
      target: { state: 'absent' }
    }], {
      beforeTargetPublish: async () => { await writeFile(target, 'foreign\n'); }
    });
    expect(outcome).toMatchObject({ status: 'rolled-back', reasonCode: 'preimage-conflict' });
    expect(await readFile(source, 'utf8')).toBe(sourceBytes.toString('utf8'));
    expect(await readFile(target, 'utf8')).toBe('foreign\n');
  });
});

test('existing relocation target requires its captured physical identity and is never replaced', async () => {
  await withWorkspace(async (root) => {
    const sourceDirectory = path.join(root, 'src');
    await mkdir(sourceDirectory);
    const source = path.join(sourceDirectory, 'a.ts');
    const target = path.join(sourceDirectory, 'moved.ts');
    const sourceBytes = Buffer.from('export const value = 1;\n');
    const targetBytes = Buffer.from('export const value = 1;\n');
    await writeFile(source, sourceBytes);
    await writeFile(target, targetBytes);
    const targetStats = await stat(target);
    const graph = compileSecRepositoryModuleGraph({
      files: ['src/a.ts'],
      readSource: () => sourceBytes.toString('utf8')
    });
    const entry = compileSecRepositoryModuleRelocationPlanEntry(graph, 'src/a.ts', 'src/moved.ts');
    const outcome = await publishRepositoryModuleRelocationTransaction(root, [{
      entry,
      expectedSourceBytes: sourceBytes,
      target: {
        state: 'existing',
        expectedBytes: targetBytes,
        expectedMode: targetStats.mode & 0o777,
        expectedIdentity: { device: String(targetStats.dev), inode: String(targetStats.ino) }
      }
    }]);
    expect(outcome.status).toBe('accepted');
    expect(await readFile(target, 'utf8')).toBe(targetBytes.toString('utf8'));
    await expect(readFile(source)).rejects.toMatchObject({ code: 'ENOENT' });
    const afterStats = await stat(target);
    expect(String(afterStats.dev)).toBe(String(targetStats.dev));
    expect(String(afterStats.ino)).toBe(String(targetStats.ino));
  });
});

test('relocation journal retains a recovery-required record when target changes after publication', async () => {
  await withWorkspace(async (root) => {
    const sourceDirectory = path.join(root, 'src');
    await mkdir(sourceDirectory);
    const source = path.join(sourceDirectory, 'a.ts');
    const target = path.join(sourceDirectory, 'moved.ts');
    const sourceBytes = Buffer.from('export const value = 1;\n');
    await writeFile(source, sourceBytes);
    const graph = compileSecRepositoryModuleGraph({
      files: ['src/a.ts'],
      readSource: () => sourceBytes.toString('utf8')
    });
    const entry = compileSecRepositoryModuleRelocationPlanEntry(graph, 'src/a.ts', 'src/moved.ts');
    const outcome = await publishRepositoryModuleRelocationTransaction(root, [{
      entry,
      expectedSourceBytes: sourceBytes,
      target: { state: 'absent' }
    }], {
      afterTargetPublish: async () => {
        await writeFile(target, 'foreign-after-publish\n');
        throw new Error('simulated crash after target publication');
      },
      beforeJournalAppend: (state) => {
        if (state === 'rolling-back') throw new Error('simulated journal interruption');
      }
    });
    expect(outcome).toMatchObject({ status: 'recovery-required', reasonCode: 'rollback-failed' });
    expect(await readFile(source, 'utf8')).toBe(sourceBytes.toString('utf8'));
    expect(await readFile(target, 'utf8')).toBe('foreign-after-publish\n');
    if (outcome.status === 'unresolved') throw new Error('expected a physical recovery outcome');
    expect(await readFile(outcome.journalPath, 'utf8')).toContain('"state":"publishing"');
  });
});
