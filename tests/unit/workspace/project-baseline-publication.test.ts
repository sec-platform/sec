import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertProjectBaseline, currentReadOnlyProjectPaths, getProjectBaselinePath, readProjectBaseline, writeProjectBaseline } from '../../../src/adapters/workspace/project-baseline.ts';

// Native retained IO integration: run on a repository-supported Bun/host profile.
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-baseline-publication-'));
  await mkdir(path.join(root, 'src'));
  await writeFile(path.join(root, 'src/a.txt'), 'original');
  return { root, paths: { artifactPaths: ['src/a.txt'] }, target: path.join(root, 'src/a.txt') };
}

test('a changed artifact at the publication fence cannot create a stale baseline', async () => {
  const f = await fixture();
  try {
    await assert.rejects(writeProjectBaseline(f.root, f.paths, async () => { await writeFile(f.target, 'changed'); }), /drift/);
    assert.equal(readProjectBaseline(f.root), null);
  } finally { await rm(f.root, { recursive: true, force: true }); }
}, 30_000);

test('a concurrent different baseline is not overwritten by a stale publication', async () => {
  const f = await fixture();
  try {
    await writeProjectBaseline(f.root, f.paths);
    await writeFile(f.target, 'next');
    const external = '{"concurrent":true}\n';
    await assert.rejects(writeProjectBaseline(f.root, f.paths, async () => { await writeFile(getProjectBaselinePath(f.root), external); }), /preimage/);
    assert.equal(await readFile(getProjectBaselinePath(f.root), 'utf8'), external);
  } finally { await rm(f.root, { recursive: true, force: true }); }
}, 30_000);

test('baseline readback preserves ownership while equal output still validates final artifact observations', async () => {
  const f = await fixture();
  try {
    const baseline = await writeProjectBaseline(f.root, f.paths);
    assert.equal(baseline.formatVersion, '1');
    assert.deepEqual(baseline.artifacts.map(value => value.path), ['src/a.txt']);
    assert.deepEqual(readProjectBaseline(f.root), baseline);
    assertProjectBaseline(f.root, baseline, { expectedArtifactPaths: ['src/a.txt'] });

    await assert.rejects(writeProjectBaseline(f.root, f.paths, async () => { await writeFile(f.target, 'changed'); }), /drift/);
    assert.deepEqual(readProjectBaseline(f.root), baseline);
    assert.throws(() => assertProjectBaseline(f.root, baseline), /drift/);
    assertProjectBaseline(f.root, baseline, { allowedChangedPaths: ['src/a.txt'] });
  } finally { await rm(f.root, { recursive: true, force: true }); }
}, 30_000);

test('in-memory baseline type assertions cannot omit contract validation', () => {
  const root = path.resolve('unobserved-baseline-validation');
  assert.throws(() => assertProjectBaseline(root, { formatVersion: 'wrong', artifacts: [] } as never), /malformed/);
  assert.throws(() => currentReadOnlyProjectPaths({ artifactPaths: ['Src/a.txt', 'src/a.txt'] }), /invalid/);
  assert.throws(() => currentReadOnlyProjectPaths({ artifactPaths: new Array(1) }), /invalid/);
});
