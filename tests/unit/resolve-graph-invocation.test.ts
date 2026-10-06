import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { captureManifestSelection, resolveCapturedManifestSelection, resolveGraph } from '../../src/adapters/workspace/resolve-graph.ts';
import type { ManifestEntry, PlanFile } from '../../src/compiler/contract/plan-manifest.ts';
import { prepareManifestResolution } from '../../src/compiler/resolve/resolve-plan.ts';

// Native runs use the real retained YAML loader and registry sources. Local
// replay substitutes the declared loader/path imports, not resolveGraph or
// the manifest graph. Those runs are not native registry/authority evidence.
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-resolver-graph-'));
  mkdirSync(path.join(root, 'registry'));
  const plan: PlanFile = { app: { id: 'app', name: 'original', mode: 'single-tenant', stack: 'typescript-library', packageManager: 'npm' },
    registry: { sources: [{ id: 'local', kind: 'private', location: 'workspace', path: 'registry' }] },
    blocks: [], acceptance: [] };
  const manifest = (id: string, requires: string[] = [], provides: string[] = [id], version = '1.0.0', to = `src/${id.replaceAll('/', '-')}.ts`) => {
    const source = { id, version, kind: 'capability', stackProfiles: ['typescript-library'], requires, provides, conflicts: [],
      installs: [{ kind: 'copy', from: 'source.ts', to }], pins: { inputs: [], outputs: [] }, acceptance: [], contracts: [], generators: [] };
    const folder = path.join(root, 'registry', id.replaceAll('/', '.')); mkdirSync(folder, { recursive: true });
    writeFileSync(path.join(folder, 'block.manifest.yaml'), JSON.stringify(source)); writeFileSync(path.join(folder, 'source.ts'), 'export {};');
    return { folder, source };
  };
  return { root, plan, manifest, cleanup() { rmSync(root, { recursive: true, force: true }); } };
}

test('real resolver preserves provider-before-consumer order and stable global install step IDs', async () => {
  const f = fixture(); try {
    f.manifest('block/app', ['cap/base']); f.manifest('block/base', [], ['cap/base']); f.plan.blocks = [{ id: 'block/app' }];
    const incompatible = f.manifest('block/a', [], ['cap/base']);
    writeFileSync(path.join(incompatible.folder, 'block.manifest.yaml'), JSON.stringify({
      ...incompatible.source, stackProfiles: ['other-stack'],
      installs: [{ kind: 'copy', from: 'absent-resource.ts', to: 'src/unused.ts' }]
    }));
    const lock = await resolveGraph(f.root, f.plan);
    assert.deepEqual(lock.resolvedBlocks.map(b => b.id), ['block/base', 'block/app']);
    assert.deepEqual(lock.installPlan.map(step => step.stepId), ['block/base:1', 'block/app:2']);
    assert.deepEqual(lock.resolvedCapabilities, ['block/app', 'cap/base']);
    assert.equal(lock.passStatus.resolve, 'succeeded');
    assert.deepEqual(lock.resolvedBlocks.map(block => block.registrySourceId), ['local', 'local']);
    assert.equal(lock.resolvedBlocks[0]!.manifestPath, 'registry/block.base/block.manifest.yaml');
    assert.equal(existsSync(path.join(f.root, 'src')), false);
  } finally { f.cleanup(); }
});

test('original plan edits after invocation cannot change catalog sources or the returned app identity', async () => {
  const f = fixture(); try {
    f.manifest('block/app'); f.plan.blocks = [{ id: 'block/app' }];
    const pending = resolveGraph(f.root, f.plan);
    f.plan.app.name = 'replaced'; f.plan.registry.sources[0]!.path = 'missing-registry';
    f.plan.blocks.length = 0;
    const lock = await pending; assert.equal(lock.app.name, 'original'); assert.equal(lock.resolvedBlocks.length, 1);
  } finally { f.cleanup(); }
});

test('relative root is fixed before asynchronous catalog observation', async () => {
  const f = fixture(), cwd = process.cwd(); try {
    f.manifest('block/app'); f.plan.blocks = [{ id: 'block/app' }]; process.chdir(f.root);
    const pending = resolveGraph('.', f.plan); process.chdir(tmpdir());
    const lock = await pending; assert.equal(lock.resolvedBlocks[0]!.manifestPath, 'registry/block.app/block.manifest.yaml');
  } finally { process.chdir(cwd); f.cleanup(); }
});

test('a pinned version missing a required capability cannot borrow it from its root manifest', async () => {
  const f = fixture(); try {
    f.manifest('block/app', ['cap/new']); const runtime = f.manifest('block/runtime', [], ['cap/old', 'cap/new'], '2.0.0');
    const old = path.join(runtime.folder, 'versions', '1.0.0'); mkdirSync(old, { recursive: true });
    writeFileSync(path.join(old, 'block.manifest.yaml'), JSON.stringify({ ...runtime.source, version: '1.0.0', provides: ['cap/old'] }));
    f.plan.blocks = [{ id: 'block/app' }, { id: 'block/runtime', version: '1.0.0' }];
    await assert.rejects(resolveGraph(f.root, f.plan), /does not provide required capability/);
  } finally { f.cleanup(); }
});

test('two explicit versions are rejected instead of silently keeping only the last one', async () => {
  const f = fixture(); try {
    const runtime = f.manifest('block/runtime', [], ['cap/runtime'], '2.0.0');
    const old = path.join(runtime.folder, 'versions', '1.0.0'); mkdirSync(old, { recursive: true });
    writeFileSync(path.join(old, 'block.manifest.yaml'), JSON.stringify({ ...runtime.source, version: '1.0.0' }));
    f.plan.blocks = [{ id: 'block/runtime', version: '1.0.0' }, { id: 'block/runtime', version: '2.0.0' }];
    await assert.rejects(resolveGraph(f.root, f.plan), /Conflicting explicit/);
  } finally { f.cleanup(); }
});

test('duplicate provider declarations do not create artificial ambiguity', async () => {
  const f = fixture(); try {
    f.manifest('block/app', ['cap/base']); f.manifest('block/base', [], ['cap/base', 'cap/base']); f.plan.blocks = [{ id: 'block/app' }];
    assert.deepEqual((await resolveGraph(f.root, f.plan)).resolvedBlocks.map(b => b.id), ['block/base', 'block/app']);
  } finally { f.cleanup(); }
});

test('install ownership conflict still rejects a resolve result', async () => {
  const f = fixture(); try {
    f.manifest('block/a', [], ['cap/a'], '1.0.0', 'src/shared.ts'); f.manifest('block/b', [], ['cap/b'], '1.0.0', 'src/shared.ts');
    f.plan.blocks = [{ id: 'block/a' }, { id: 'block/b' }];
    await assert.rejects(resolveGraph(f.root, f.plan), e => (e as {code?: string}).code === 'RESOLVE-CONFLICT-006');
  } finally { f.cleanup(); }
});

test('an exclusively incompatible catalog reports missing before resource lookup', async () => {
  const f = fixture(); try {
    f.manifest('block/app', ['cap/base']);
    const provider = f.manifest('block/base', [], ['cap/base']);
    writeFileSync(path.join(provider.folder, 'block.manifest.yaml'), JSON.stringify({
      ...provider.source, stackProfiles: ['other-stack'],
      installs: [{ kind: 'copy', from: 'absent-resource.ts', to: 'src/base.ts' }]
    }));
    f.plan.blocks = [{ id: 'block/app' }];
    await assert.rejects(resolveGraph(f.root, f.plan), error => {
      assert.equal((error as { code?: string }).code, 'RESOLVE-MISSING-001');
      assert.match((error as Error).message, /cap\/base/);
      return true;
    });
    assert.equal(existsSync(path.join(f.root, 'src')), false);
  } finally { f.cleanup(); }
});

test('an explicit incompatible choice retains ALIGN rejection before closure and resources', async () => {
  const f = fixture(); try {
    const provider = f.manifest('block/base', ['cap/absent']);
    writeFileSync(path.join(provider.folder, 'block.manifest.yaml'), JSON.stringify({
      ...provider.source, stackProfiles: ['other-stack'],
      installs: [{ kind: 'copy', from: 'absent-resource.ts', to: 'src/base.ts' }]
    }));
    f.plan.blocks = [{ id: 'block/base' }];
    await assert.rejects(resolveGraph(f.root, f.plan), error => {
      assert.equal((error as { code?: string }).code, 'ALIGN-STACK-001');
      return true;
    });
    assert.equal(existsSync(path.join(f.root, 'src')), false);
  } finally { f.cleanup(); }
});

test('multiple compatible automatic providers still reject as ambiguous before resources', async () => {
  const f = fixture(); try {
    f.manifest('block/app', ['cap/base']);
    for (const id of ['block/a', 'block/z']) {
      const provider = f.manifest(id, [], ['cap/base']);
      writeFileSync(path.join(provider.folder, 'block.manifest.yaml'), JSON.stringify({
        ...provider.source, installs: [{ kind: 'copy', from: 'absent-resource.ts', to: `src/${id.slice(6)}.ts` }]
      }));
    }
    f.plan.blocks = [{ id: 'block/app' }];
    await assert.rejects(resolveGraph(f.root, f.plan), error => {
      assert.equal((error as { code?: string }).code, 'RESOLVE-CONFLICT-004');
      assert.match((error as Error).message, /Ambiguous providers/);
      return true;
    });
    assert.equal(existsSync(path.join(f.root, 'src')), false);
  } finally { f.cleanup(); }
});

test('prepare rejects conflicting unselected definitions before stack filtering', () => {
  const root = path.resolve('unobserved-registry');
  const entry = (sourceId: string, provides: string[]): ManifestEntry => ({
    manifest: { id: 'block/unused', version: '1.0.0', kind: 'capability', stackProfiles: ['other-stack'],
      requires: [], provides, conflicts: [], installs: [{ kind: 'copy', from: 'absent.ts', to: 'src/unused.ts' }],
      pins: { inputs: [], outputs: [] }, acceptance: [], contracts: [], generators: [] },
    manifestPath: path.join(root, sourceId, 'block.manifest.yaml'), manifestRoot: path.join(root, sourceId),
    resourceRoots: [path.join(root, sourceId)], registryRoot: root, registrySourceId: sourceId,
    registryKind: 'private', registryLocation: 'workspace', registryPath: 'registry'
  });
  assert.throws(() => prepareManifestResolution(root, [], [entry('first', ['cap/a']), entry('second', ['cap/b'])]), error => {
    assert.equal((error as { code?: string }).code, 'RESOLVE-CONFLICT-004');
    assert.match((error as Error).message, /Conflicting manifest definitions/);
    assert.deepEqual((error as { details?: unknown }).details, {
      selectedSource: 'first', requestedSource: 'second',
      selectedManifestPath: path.join(root, 'first', 'block.manifest.yaml'),
      requestedManifestPath: path.join(root, 'second', 'block.manifest.yaml')
    });
    return true;
  });
});


for (const conflicting of [false, true]) {
  test(`catalog shadows retain captured definition consistency (conflicting=${conflicting})`, async () => {
    const f = fixture(); try {
      const selected = f.manifest('block/a');
      mkdirSync(path.join(f.root, 'shadow'));
      f.plan.registry.sources.push({ id: 'shadow', kind: 'private', location: 'workspace', path: 'shadow' });
      f.plan.blocks = [{ id: 'block/a' }];
      const captured = captureManifestSelection(f.root, f.plan);
      writeFileSync(path.join(selected.folder, 'block.manifest.yaml'), JSON.stringify({
        ...selected.source, version: '2.0.0'
      }));
      const hidden = path.join(f.root, 'shadow', 'block.a'); mkdirSync(hidden);
      writeFileSync(path.join(hidden, 'block.manifest.yaml'), JSON.stringify({
        ...selected.source,
        ...(conflicting ? { provides: ['different/service'], stackProfiles: ['other-stack'] } : {})
      }));
      if (conflicting) {
        await assert.rejects(resolveCapturedManifestSelection(captured), error => {
          assert.equal((error as { code?: string }).code, 'RESOLVE-CONFLICT-004');
          assert.match((error as Error).message, /Conflicting manifest definitions/);
          return true;
        });
      } else {
        const lock = await resolveCapturedManifestSelection(captured);
        assert.equal(lock.resolvedBlocks[0]!.version, '1.0.0');
        assert.equal(lock.resolvedBlocks[0]!.registrySourceId, 'local');
        assert.equal(lock.resolvedBlocks[0]!.manifestPath, 'registry/block.a/block.manifest.yaml');
        assert.equal(lock.installPlan[0]!.registrySourceId, 'local');
        assert.equal(lock.installPlan[0]!.sourceRoot, 'block.a');
      }
    } finally { f.cleanup(); }
  });
}
