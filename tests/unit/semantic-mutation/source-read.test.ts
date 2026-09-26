import { expect, test } from 'bun:test';
import { chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readSemanticMutationSource } from '../../../src/adapters/mutation/source-path-boundary.ts';
import { semanticMutationSourcePathEvidenceRevision } from '../../../src/compiler/semantic-mutation/source-edit-artifact.ts';

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-source-read-'));
  const transaction = path.join(root, 'transaction');
  const relativePath = 'source/model/item.yaml';
  const target = path.join(root, ...relativePath.split('/'));
  mkdirSync(transaction);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, 'item: before\n');
  return { root, transaction, relativePath, target };
}

const read = (f: ReturnType<typeof fixture>) => readSemanticMutationSource(f.root, f.transaction, f.relativePath);
const cleanup = (f: ReturnType<typeof fixture>) => rmSync(f.root, { recursive: true, force: true });

test('retained source reads preserve exact bytes, readonly modes and evidence encoding', async () => {
  const f = fixture();
  try {
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
  } finally { cleanup(f); }
});

test('retained source reads support empty ordinary files without inventing bytes', async () => {
  const f = fixture();
  try {
    writeFileSync(f.target, '');
    expect((await read(f)).bytes.byteLength).toBe(0);
  } finally { cleanup(f); }
});

test('retained source reads reject a sparse file above the byte ceiling', async () => {
  const f = fixture();
  try {
    truncateSync(f.target, 64 * 1024 * 1024 + 1);
    await expect(read(f)).rejects.toThrow('bounded');
  } finally { cleanup(f); }
});

test('retained source reads reject hard-link aliases', async () => {
  const f = fixture();
  try {
    const alias = path.join(f.root, 'alias');
    linkSync(f.target, alias);
    await expect(read(f)).rejects.toThrow('hard-link');
    expect(readFileSync(alias, 'utf8')).toBe('item: before\n');
  } finally { cleanup(f); }
});

test.skipIf(process.platform !== 'linux')('retained source reads reject case-fold collisions even when the requested spelling exists', async () => {
  const f = fixture();
  try {
    writeFileSync(path.join(path.dirname(f.target), 'ITEM.yaml'), 'foreign');
    await expect(read(f)).rejects.toThrow('case-fold');
    expect(readFileSync(f.target, 'utf8')).toBe('item: before\n');
  } finally { cleanup(f); }
});

test.skipIf(process.platform !== 'linux')('retained source reads do not follow a substituted source symlink', async () => {
  const f = fixture();
  try {
    const outside = path.join(f.root, 'outside');
    writeFileSync(outside, 'must not be consumed');
    rmSync(f.target);
    symlinkSync(outside, f.target);
    await expect(read(f)).rejects.toThrow();
    expect(readFileSync(outside, 'utf8')).toBe('must not be consumed');
  } finally { cleanup(f); }
});

test.skipIf(process.platform !== 'linux')('retained source reads do not follow a substituted ancestor or transaction directory', async () => {
  const f = fixture();
  try {
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
  } finally { cleanup(f); }
});

test('retained source admission rejects escapes and redacts native absolute-path errors', async () => {
  const f = fixture();
  try {
    await expect(readSemanticMutationSource(f.root, f.root, f.relativePath)).rejects.toThrow('inside');
    await expect(readSemanticMutationSource(f.root, f.transaction, '../escape.yaml')).rejects.toThrow();
    rmSync(f.target);
    let observed: unknown;
    try { await read(f); } catch (error) { observed = error; }
    expect(observed).toBeInstanceOf(Error);
    expect(String(observed)).not.toContain(f.root);
    expect(String(observed)).toContain('retained safely');
  } finally { cleanup(f); }
});
