import { settleResourcesAsync } from '../../../src/execution/resource-settlement.ts';
import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertProjectBaseline, getProjectBaselinePath, readProjectBaseline, writeProjectBaseline } from '../../../src/adapters/workspace/project-baseline.ts';

// Native retained IO integration: run on a repository-supported Bun/host profile.
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-baseline-publication-'));
  try {
    await mkdir(path.join(root, 'src'));
    await writeFile(path.join(root, 'src/a.txt'), 'original');
    return { root, paths: { artifactPaths: ['src/a.txt'] }, target: path.join(root, 'src/a.txt') };
  } catch (error) {
    await settleResourcesAsync({ primary: { label: 'workspace fixture construction', error },
      cleanup: [{ label: 'workspace fixture root', settle: () => rm(root, { recursive: true, force: true }) }] });
    throw error;
  }
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
    await assert.rejects(writeProjectBaseline(f.root, {
      artifactPaths: ['Src/a.txt', 'src/a.txt']
    }), /invalid/);
    const baseline = await writeProjectBaseline(f.root, { artifactPaths: [
      'src/a.txt', 'model/policies/policy.spec.yaml', '.sec/artifacts/evidence/report.json',
      'tsconfig.json', 'src/a.txt', 'model/patches/manual.ts', '.sec/cache/local.json'
    ] });
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
