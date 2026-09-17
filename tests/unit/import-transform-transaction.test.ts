import { expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  publishImportTransformTransaction
} from '../../src/adapters/self-hosting/development/runner/import-transform-transaction.ts';

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

test('a legacy journal is read-only evidence and blocks a new transaction until migration', async () => {
  await withWorkspace(async (root) => {
    const transactionRoot = path.join(root, '.sec', 'import-transform-transactions', 'crash-before-progress');
    await mkdir(transactionRoot, { recursive: true });
    await Promise.all([writeFile(path.join(root, 'a.ts'), 'a1\n'), writeFile(path.join(root, 'b.ts'), 'b0\n')]);
    const expected = Buffer.from('a0\n');
    const replacement = Buffer.from('a1\n');
    const { digest } = await import('../../src/contracts/canonical.ts');
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
    const legacyJournal = await readFile(path.join(transactionRoot, 'journal.jsonl'), 'utf8');
    const outcome = await publishImportTransformTransaction(root, [
      { relativePath: 'b.ts', expectedBytes: Buffer.from('b0\n'), replacementBytes: Buffer.from('b1\n') }
    ]);
    expect(outcome).toMatchObject({ status: 'recovery-required', reasonCode: 'journal-failed' });
    expect(await readFile(path.join(root, 'a.ts'), 'utf8')).toBe('a1\n');
    expect(await readFile(path.join(root, 'b.ts'), 'utf8')).toBe('b0\n');
    expect(await readFile(path.join(transactionRoot, 'journal.jsonl'), 'utf8')).toBe(legacyJournal);
  });
});

test('a terminal legacy journal settles once into a digest-bound compact receipt', async () => {
  await withWorkspace(async (root) => {
    const transactionId = 'legacy-accepted';
    const transactionRoot = path.join(root, '.sec', 'import-transform-transactions', transactionId);
    const target = path.join(root, 'a.ts');
    const expected = Buffer.from('a0\n');
    const replacement = Buffer.from('a1\n');
    const { digest } = await import('../../src/contracts/canonical.ts');
    const stem = digest('a.ts');
    await mkdir(transactionRoot, { recursive: true });
    await Promise.all([
      writeFile(target, replacement),
      writeFile(path.join(root, 'b.ts'), 'b0\n'),
      writeFile(path.join(root, 'c.ts'), 'c0\n')
    ]);
    await chmod(target, 0o644);
    const targetMode = (await stat(target)).mode & 0o777;
    const fileIdentity = Object.freeze({
      relativePath: 'a.ts', expectedDigest: digest(expected), replacementDigest: digest(replacement)
    });
    const entry = (state: 'prepared' | 'publishing' | 'accepted', published: readonly string[]) => JSON.stringify({
      formatVersion: 'sec-import-transform-journal-entry-v2', transactionId, state,
      files: [fileIdentity], published, outstanding: [], publicationReasonCode: null, recoveryReasonCode: null
    });
    const journalPath = path.join(transactionRoot, 'journal.jsonl');
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
      writeFile(journalPath, `${entry('prepared', [])}\n${entry('publishing', [])}\n`
        + `${entry('publishing', ['a.ts'])}\n${entry('accepted', ['a.ts'])}\n`)
    ]);

    const accepted = await publishImportTransformTransaction(root, [{
      relativePath: 'b.ts', expectedBytes: Buffer.from('b0\n'), replacementBytes: Buffer.from('b1\n')
    }]);
    expect(accepted.status).toBe('accepted');
    const receiptPath = path.join(transactionRoot, 'terminal-receipt.json');
    expect(await readFile(receiptPath, 'utf8')).toContain('sec-import-transform-terminal-receipt-v1');

    const journal = await readFile(journalPath, 'utf8');
    await writeFile(journalPath, journal.replaceAll(transactionId, 'legacy-accepteX'));
    const blocked = await publishImportTransformTransaction(root, [{
      relativePath: 'c.ts', expectedBytes: Buffer.from('c0\n'), replacementBytes: Buffer.from('c1\n')
    }]);
    expect(blocked).toMatchObject({ status: 'recovery-required', reasonCode: 'journal-failed' });
    expect(await readFile(path.join(root, 'c.ts'), 'utf8')).toBe('c0\n');
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
      const { digest } = await import('../../src/contracts/canonical.ts');
      const stem = digest('a.ts');
      await mkdir(transactionRoot, { recursive: true });
      await Promise.all([
        writeFile(target, expected),
        writeFile(path.join(root, 'b.ts'), 'b0\n'),
        writeFile(candidate, candidateBytes)
      ]);
      await Promise.all([chmod(target, 0o644), chmod(candidate, 0o644)]);
      const targetMode = (await stat(target)).mode & 0o777;
      const bindingSource = `${JSON.stringify({
        formatVersion: 'sec-import-transform-transaction-v2', transactionId, workspaceRoot: root,
        writes: [{ relativePath: 'a.ts',
          preimageCandidateRelativePath: `a.ts.imports-transform-${transactionId}.preimage.candidate`,
          replacementCandidateRelativePath: `a.ts.imports-transform-${transactionId}.replacement.candidate`,
          expectedDigest: digest(expected), replacementDigest: digest(replacement), mode: targetMode }]
      })}\n`;
      await Promise.all([
        writeFile(path.join(transactionRoot, `${stem}.preimage`), expected),
        writeFile(path.join(transactionRoot, `${stem}.replacement`), replacement),
        writeFile(path.join(transactionRoot, 'binding.json'), bindingSource),
        writeFile(path.join(transactionRoot, 'journal.jsonl'), `${JSON.stringify({
          formatVersion: 'sec-import-transform-journal-entry-v3', transactionId,
          bindingDigest: digest(bindingSource), state: 'prepared', publishedCount: 0, outstandingCount: 0,
          publicationReasonCode: null, recoveryReasonCode: null
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

test('post-rename ambiguity preserves a conservative recovery-required journal edge', async () => {
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
    expect(await readFile(outcome.journalPath, 'utf8')).toContain('"state":"recovery-required"');
    expect(await readFile(outcome.journalPath, 'utf8')).toContain('"recoveryReasonCode":"rollback-conflict"');
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

test('durable journal progress does not copy transform payloads into every record', async () => {
  await withWorkspace(async (root) => {
    const writes = Array.from({ length: 8 }, (_, index) => ({
      relativePath: `file-${index}.ts`,
      expectedBytes: Buffer.from(`before-${index}\n`),
      replacementBytes: Buffer.from(`after-${index}\n`)
    }));
    await Promise.all(writes.map(({ relativePath, expectedBytes }) => writeFile(
      path.join(root, relativePath), expectedBytes
    )));
    const outcome = await publishImportTransformTransaction(root, writes);
    expect(outcome.status).toBe('accepted');
    const journal = await readFile(outcome.journalPath, 'utf8');
    expect(journal).not.toContain('before-0');
    expect(journal).not.toContain('after-0');
    expect(journal).toContain('"state":"accepted"');

    const largerWrites = Array.from({ length: 16 }, (_, index) => ({
      relativePath: `larger-${index}.ts`,
      expectedBytes: Buffer.from(`before-${index}-${'x'.repeat(256)}\n`),
      replacementBytes: Buffer.from(`after-${index}-${'y'.repeat(256)}\n`)
    }));
    await Promise.all(largerWrites.map(({ relativePath, expectedBytes }) => writeFile(
      path.join(root, relativePath), expectedBytes
    )));
    const larger = await publishImportTransformTransaction(root, largerWrites);
    expect(larger.status).toBe('accepted');
    const largerJournal = await readFile(larger.journalPath, 'utf8');
    expect(Buffer.byteLength(largerJournal)).toBeLessThan(Buffer.byteLength(journal) * 8);
    expect(largerJournal).not.toContain('before-0-' + 'x'.repeat(256));
    expect(largerJournal).not.toContain('after-0-' + 'y'.repeat(256));
  });
});

test('recovery derives one in-flight publication from durable progress', async () => {
  await withWorkspace(async (root) => {
    await Promise.all([
      writeFile(path.join(root, 'a.ts'), 'a0\n'),
      writeFile(path.join(root, 'b.ts'), 'b0\n'),
      writeFile(path.join(root, 'c.ts'), 'c0\n')
    ]);
    const first = await publishImportTransformTransaction(root, [{
      relativePath: 'a.ts', expectedBytes: Buffer.from('a0\n'), replacementBytes: Buffer.from('a1\n')
    }, {
      relativePath: 'b.ts', expectedBytes: Buffer.from('b0\n'), replacementBytes: Buffer.from('b1\n')
    }, {
      relativePath: 'c.ts', expectedBytes: Buffer.from('c0\n'), replacementBytes: Buffer.from('c1\n')
    }], {
      afterPublish: (_file, index) => {
        if (index === 1) throw new Error('simulated interruption after physical publication');
      },
      beforeRollback: () => { throw new Error('simulated unavailable rollback'); },
      beforeJournalAppend: (state) => {
        if (state === 'rolling-back' || state === 'recovery-required') {
          throw new Error('simulated journal interruption');
        }
      }
    });
    expect(first).toMatchObject({ status: 'recovery-required', reasonCode: 'rollback-failed' });
    expect(await readFile(first.journalPath, 'utf8')).toContain('"state":"publishing"');
    expect(await readFile(path.join(root, 'a.ts'), 'utf8')).toBe('a1\n');
    expect(await readFile(path.join(root, 'b.ts'), 'utf8')).toBe('b1\n');
    await writeFile(path.join(root, 'd.ts'), 'd0\n');
    const second = await publishImportTransformTransaction(root, [{
      relativePath: 'd.ts', expectedBytes: Buffer.from('d0\n'), replacementBytes: Buffer.from('d1\n')
    }]);
    expect(second.status).toBe('accepted');
    expect(await readFile(path.join(root, 'a.ts'), 'utf8')).toBe('a0\n');
    expect(await readFile(path.join(root, 'b.ts'), 'utf8')).toBe('b0\n');
    expect(await readFile(path.join(root, 'c.ts'), 'utf8')).toBe('c0\n');
  });
});

test('missing, empty, or torn journal is repaired into deterministic recovery', async () => {
  const run = async (residue: string | null) => withWorkspace(async (root) => {
    await writeFile(path.join(root, 'a.ts'), 'a0\n');
    const first = await publishImportTransformTransaction(root, [{
      relativePath: 'a.ts', expectedBytes: Buffer.from('a0\n'), replacementBytes: Buffer.from('a1\n')
    }], {
      beforeJournalAppend: (state) => {
        if (state === 'prepared') throw new Error('interrupted before prepared became durable');
      }
    });
    expect(first).toMatchObject({ status: 'recovery-required', reasonCode: 'journal-failed' });
    if (first.status !== 'recovery-required') throw new Error('expected recovery-required outcome');
    if (residue !== null) await writeFile(first.journalPath, residue);
    await writeFile(path.join(root, 'b.ts'), 'b0\n');
    const second = await publishImportTransformTransaction(root, [{
      relativePath: 'b.ts', expectedBytes: Buffer.from('b0\n'), replacementBytes: Buffer.from('b1\n')
    }]);
    expect(second.status).toBe('accepted');
    expect(await readFile(path.join(root, 'a.ts'), 'utf8')).toBe('a0\n');
    expect(await readFile(first.journalPath, 'utf8')).toContain('"state":"rolled-back"');
  });
  await run(null);
  await run('');
  await run('{"formatVersion":"sec-import-transform-journal-entry-v3"');
});

test('orphaned terminal evidence cannot bypass a missing durable journal', async () => {
  await withWorkspace(async (root) => {
    const retiredTarget = path.join(root, 'retired.ts');
    await writeFile(retiredTarget, 'before\n');
    const accepted = await publishImportTransformTransaction(root, [{
      relativePath: 'retired.ts',
      expectedBytes: Buffer.from('before\n'),
      replacementBytes: Buffer.from('after\n')
    }]);
    expect(accepted.status).toBe('accepted');
    const acceptedRoot = path.dirname(accepted.journalPath);
    await Promise.all([rm(path.join(acceptedRoot, 'binding.json')), rm(accepted.journalPath)]);

    await rm(retiredTarget);
    await writeFile(path.join(root, 'current.ts'), 'current-before\n');
    const current = await publishImportTransformTransaction(root, [{
      relativePath: 'current.ts',
      expectedBytes: Buffer.from('current-before\n'),
      replacementBytes: Buffer.from('current-after\n')
    }]);

    expect(current).toMatchObject({ status: 'recovery-required', reasonCode: 'journal-failed' });
    expect(await readFile(path.join(root, 'current.ts'), 'utf8')).toBe('current-before\n');
  });
});

test('duplicate keys in durable journal evidence block recovery before a new effect', async () => {
  await withWorkspace(async (root) => {
    await writeFile(path.join(root, 'a.ts'), 'a0\n');
    const accepted = await publishImportTransformTransaction(root, [{
      relativePath: 'a.ts', expectedBytes: Buffer.from('a0\n'), replacementBytes: Buffer.from('a1\n')
    }]);
    expect(accepted.status).toBe('accepted');
    const journal = await readFile(accepted.journalPath, 'utf8');
    await writeFile(accepted.journalPath, journal.replace('"state":"prepared"',
      '"state":"prepared","state":"prepared"'));

    await writeFile(path.join(root, 'b.ts'), 'b0\n');
    const blocked = await publishImportTransformTransaction(root, [{
      relativePath: 'b.ts', expectedBytes: Buffer.from('b0\n'), replacementBytes: Buffer.from('b1\n')
    }]);
    expect(blocked).toMatchObject({ status: 'recovery-required', reasonCode: 'journal-failed' });
    expect(await readFile(path.join(root, 'b.ts'), 'utf8')).toBe('b0\n');
  });
});

test('unknown transaction residue blocks recovery instead of acting as terminal evidence', async () => {
  await withWorkspace(async (root) => {
    await writeFile(path.join(root, 'a.ts'), 'a0\n');
    const accepted = await publishImportTransformTransaction(root, [{
      relativePath: 'a.ts', expectedBytes: Buffer.from('a0\n'), replacementBytes: Buffer.from('a1\n')
    }]);
    expect(accepted.status).toBe('accepted');
    await writeFile(path.join(path.dirname(accepted.journalPath), 'orphan.json'), '{}');

    await writeFile(path.join(root, 'b.ts'), 'b0\n');
    const blocked = await publishImportTransformTransaction(root, [{
      relativePath: 'b.ts', expectedBytes: Buffer.from('b0\n'), replacementBytes: Buffer.from('b1\n')
    }]);
    expect(blocked).toMatchObject({ status: 'recovery-required', reasonCode: 'journal-failed' });
    expect(await readFile(path.join(root, 'b.ts'), 'utf8')).toBe('b0\n');
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
