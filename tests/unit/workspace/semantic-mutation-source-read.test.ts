import { settleWorkspaceCallback } from '../../testkit/workspace-cleanup.ts';
import { expect, test } from 'bun:test';
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readSemanticMutationSource } from '../../../src/adapters/mutation/source-path-boundary.ts';
import { semanticMutationSourcePathEvidenceRevision } from '../../../src/compiler/semantic-mutation/source-edit-artifact.ts';

type SourceReadFixture = { root: string; transaction: string; relativePath: string; target: string };

async function fixture(run: (f: SourceReadFixture) => Promise<void>) {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-source-read-'));
  await settleWorkspaceCallback(async () => {
    const transaction = path.join(root, 'transaction');
    const relativePath = 'source/model/item.yaml';
    const target = path.join(root, ...relativePath.split('/'));
    mkdirSync(transaction);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, 'item: before\n');
    await run({ root, transaction, relativePath, target });
  }, async () => { rmSync(root, { recursive: true, force: true }); });
}

const read = (f: SourceReadFixture) => readSemanticMutationSource(f.root, f.transaction, f.relativePath);

test('retained source reads preserve readonly and empty bytes, evidence encoding, and release writer exclusion', async () => {
  await fixture(async f => {
    const bytes = Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('item: before\r\n', 'utf8')]);
    writeFileSync(f.target, bytes);
    chmodSync(f.target, 0o444);
    const result = await read(f);
    expect(Buffer.from(result.bytes)).toEqual(bytes);
    if (process.platform === 'linux') expect(result.fileMode).toBe(0o444);
    const { pathEvidenceRevision, ...body } = result.pathEvidence;
    expect(pathEvidenceRevision).toBe(semanticMutationSourcePathEvidenceRevision(body));
    expect(result.pathEvidence.relativePath).toBe(f.relativePath);
    expect(Object.isFrozen(result.pathEvidence)).toBe(true);
    // Disposal must release the writer exclusion before the next operation.
    chmodSync(f.target, 0o600);
    writeFileSync(f.target, 'item: after\n');
    expect(Buffer.from((await read(f)).bytes).toString('utf8')).toBe('item: after\n');
    writeFileSync(f.target, '');
    expect((await read(f)).bytes.byteLength).toBe(0);
  });
});

test('retained source reads reject a sparse file above the byte ceiling', async () => {
  await fixture(async f => {
    truncateSync(f.target, 64 * 1024 * 1024 + 1);
    await expect(read(f)).rejects.toThrow('bounded');
  });
});

test('retained source reads reject hard-link aliases', async () => {
  await fixture(async f => {
    const alias = path.join(f.root, 'alias');
    linkSync(f.target, alias);
    await expect(read(f)).rejects.toMatchObject({
      message: expect.stringContaining('hard-link'),
      diagnostic: { code: 'SEMANTIC-MUTATION-005', stage: 'path' }
    });
    expect(readFileSync(alias, 'utf8')).toBe('item: before\n');
  });
});

test.skipIf(process.platform !== 'linux')('retained source reads reject case-fold collisions even when the requested spelling exists', async () => {
  await fixture(async f => {
    writeFileSync(path.join(path.dirname(f.target), 'ITEM.yaml'), 'foreign');
    await expect(read(f)).rejects.toThrow('case-fold');
    expect(readFileSync(f.target, 'utf8')).toBe('item: before\n');
  });
});

test.skipIf(process.platform !== 'linux')('retained source reads do not follow a substituted source symlink', async () => {
  await fixture(async f => {
    const outside = path.join(f.root, 'outside');
    writeFileSync(outside, 'must not be consumed');
    rmSync(f.target);
    symlinkSync(outside, f.target);
    await expect(read(f)).rejects.toThrow();
    expect(readFileSync(outside, 'utf8')).toBe('must not be consumed');
  });
});

test.skipIf(process.platform !== 'linux')('retained source reads do not follow a substituted ancestor or transaction directory', async () => {
  await fixture(async f => {
    const real = path.join(f.root, 'real-model');
    mkdirSync(real);
    writeFileSync(path.join(real, 'item.yaml'), 'foreign');
    rmSync(path.dirname(f.target), { recursive: true });
    symlinkSync(real, path.dirname(f.target));
    await expect(read(f)).rejects.toThrow();
    rmSync(path.dirname(f.target));
    mkdirSync(path.dirname(f.target));
    writeFileSync(f.target, 'item: before\n');
    rmSync(f.transaction, { recursive: true });
    symlinkSync(real, f.transaction);
    await expect(read(f)).rejects.toThrow();
  });
});

test('retained source admission rejects escapes and redacts native absolute-path errors', async () => {
  await fixture(async f => {
    await expect(readSemanticMutationSource(f.root, f.root, f.relativePath)).rejects.toThrow('inside');
    await expect(readSemanticMutationSource(f.root, f.transaction, '../escape.yaml')).rejects.toThrow();
    rmSync(f.target);
    let observed: unknown;
    try { await read(f); } catch (error) { observed = error; }
    expect(observed).toBeInstanceOf(Error);
    expect(String(observed)).not.toContain(f.root);
    expect(String(observed)).toContain('retained safely');
  });
});
