import { afterEach, expect, spyOn, test } from 'bun:test';
import { Command } from 'commander';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { captureManifestSelection, resolveCapturedManifestSelection, resolveGraph } from '../../src/adapters/workspace/resolve-graph.ts';
import { loadAllManifests, loadManifestById, loadManifestForResolvedBlock } from '../../src/adapters/workspace/sources/load-manifest.ts';
import { manifestCache } from '../../src/adapters/workspace/sources/manifest-cache.ts';
import { addBlockToPlan } from '../../src/application/add-block.ts';
import { resolveWorkspacePlan } from '../../src/application/resolve-workspace.ts';
import type { PlanFile, PlanRegistrySource } from '../../src/compiler/contract.ts';
import { requireLockFileSchema } from '../../src/compiler/contract/lock-schema.ts';
import { resolveManifestGraph } from '../../src/compiler/resolve/manifest-graph.ts';
import { prepareManifestResolution } from '../../src/compiler/resolve/resolve-plan.ts';
import { registerCoreWorkspaceCommands } from '../../src/entry/cli/register-core-workspace-commands.ts';
import { buildReviewLock } from '../helpers/review-fixtures.ts';

const roots: string[] = [];
afterEach(() => {
  manifestCache.clear();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const workspaceRoot = mkdtempSync(path.join(tmpdir(), 'sec-registry-shadow-'));
  roots.push(workspaceRoot);
  const registrySources: PlanRegistrySource[] = ['first', 'second', 'third'].map(id => ({
    id, kind: 'private', location: 'workspace', path: `registry-${id}`
  }));
  const manifest = (version: string) => ({ id: 'cache/probe', version, kind: 'capability',
    stackProfiles: ['typescript-library'], requires: [], provides: ['cache/probe'], conflicts: [],
    installs: [{ kind: 'copy', from: 'source.ts', to: 'src/probe.ts' }],
    pins: { inputs: [], outputs: [] }, acceptance: [], contracts: [], generators: [] });
  function write(index: number, version: string, overlay?: string, extra = {}) {
    const folder = path.join(workspaceRoot, registrySources[index]!.path, 'cache.probe',
      ...(overlay ? ['versions', overlay] : []));
    mkdirSync(folder, { recursive: true });
    const file = path.join(folder, 'block.manifest.yaml');
    writeFileSync(file, JSON.stringify({ ...manifest(version), ...extra }));
    return file;
  }
  write(0, '1.0.0'); write(1, '2.0.0'); write(2, '3.0.0');
  return { workspaceRoot, registrySources, write };
}

function shadow(version: string, source: string) {
  return { version, registrySourceId: source, registryKind: 'private' as const,
    registryLocation: 'workspace' as const, registryPath: `registry-${source}` };
}

test('source order explicitly chooses the same winner and ordered shadows for addressed and catalog loads', async () => {
  const f = fixture();
  for (const registrySources of [f.registrySources, [...f.registrySources].reverse()]) {
    const options = { workspaceRoot: f.workspaceRoot, registrySources };
    const addressed = loadManifestById('cache/probe', options);
    const catalog = await loadAllManifests(options);
    const reversed = registrySources[0]!.id === 'third';
    expect(addressed.registrySourceId).toBe(reversed ? 'third' : 'first');
    expect(addressed.manifest.version).toBe(reversed ? '3.0.0' : '1.0.0');
    expect(addressed.registryResolution).toEqual({ policy: 'source-order', shadowed: reversed
      ? [shadow('2.0.0', 'second'), shadow('1.0.0', 'first')]
      : [shadow('2.0.0', 'second'), shadow('3.0.0', 'third')] });
    expect(catalog).toEqual([addressed]);
    expect(Object.isFrozen(addressed.registryResolution!.shadowed[0])).toBe(true);
    expect(Object.isFrozen(catalog[0]!.registryResolution!.shadowed)).toBe(false);
  }
});

test('order and metadata changes rebuild only invocation diagnostics without contaminating the cached winner', async () => {
  const f = fixture();
  const single = { workspaceRoot: f.workspaceRoot, registrySources: [f.registrySources[0]!] };
  const original = loadManifestById('cache/probe', single);
  const first = loadManifestById('cache/probe', f);
  f.write(1, '2.1.0');
  const reordered = { ...f, registrySources: [f.registrySources[0]!, f.registrySources[2]!, f.registrySources[1]!] };
  const next = loadManifestById('cache/probe', reordered);
  expect(next.manifest).toBe(original.manifest);
  expect(first.registryResolution!.shadowed).toEqual([shadow('2.0.0', 'second'), shadow('3.0.0', 'third')]);
  expect(next.registryResolution!.shadowed).toEqual([shadow('3.0.0', 'third'), shadow('2.1.0', 'second')]);
  expect(loadManifestById('cache/probe', single)).toBe(original);
  expect(original.registryResolution).toBeUndefined();
  const catalog = await loadAllManifests(reordered);
  catalog[0]!.registryResolution!.shadowed[0]!.version = 'caller-only';
  expect(loadManifestById('cache/probe', reordered).registryResolution).toEqual(next.registryResolution);
});

test('cached winner never bypasses invalid lower-source schema or requested identity', async () => {
  const f = fixture();
  loadManifestById('cache/probe', f);
  f.write(1, '2.0.0', undefined, { unknownField: true });
  expect(() => loadManifestById('cache/probe', f)).toThrow(expect.objectContaining({ code: 'MANIFEST-SCHEMA-001' }));
  await expect(loadAllManifests(f)).rejects.toMatchObject({ code: 'MANIFEST-SCHEMA-001' });
  f.write(1, '2.0.0', undefined, { id: 'cache/other' });
  expect(() => loadManifestById('cache/probe', f)).toThrow(expect.objectContaining({ code: 'MANIFEST-SCHEMA-011' }));
  await expect(loadAllManifests(f)).rejects.toMatchObject({ code: 'MANIFEST-SCHEMA-012' });
});

test('version eligibility excludes mismatching roots and validates lower version overlays after cache hits', () => {
  const f = fixture();
  f.write(1, '4.0.0', '4.0.0'); f.write(2, '4.0.0');
  const options = { ...f, version: '4.0.0' };
  const entry = loadManifestById('cache/probe', options);
  expect(entry.registrySourceId).toBe('second');
  expect(entry.manifest.version).toBe('4.0.0');
  expect(entry.manifestPath).toContain('versions/4.0.0/block.manifest.yaml');
  expect(entry.registryResolution).toEqual({ policy: 'source-order', shadowed: [shadow('4.0.0', 'third')] });
  f.write(2, '3.0.0', '4.0.0');
  expect(() => loadManifestById('cache/probe', options)).toThrow(expect.objectContaining({ code: 'MANIFEST-SCHEMA-022' }));
});

test('disappearing lower sources clear diagnostics and pinned reload never expands to shadow sources', () => {
  const f = fixture();
  const first = loadManifestById('cache/probe', f);
  const block = prepareManifestResolution(f.workspaceRoot, [first], [first]).resolvedBlocks[0]!;
  f.write(1, '2.0.0', undefined, { unknownField: true });
  const pinned = loadManifestForResolvedBlock(f.workspaceRoot, block);
  expect(pinned.registrySourceId).toBe('first');
  expect(pinned.registryResolution).toBeUndefined();
  unlinkSync(path.join(f.workspaceRoot, 'registry-second', 'cache.probe', 'block.manifest.yaml'));
  unlinkSync(path.join(f.workspaceRoot, 'registry-third', 'cache.probe', 'block.manifest.yaml'));
  expect(loadManifestById('cache/probe', f).registryResolution).toBeUndefined();
  expect(first.registryResolution!.shadowed).toHaveLength(2);
});

test.serial('real add and resolve diagnostics display current addressed and dependency shadows without changing the persisted lock', async () => {
  const f = fixture();
  let plan: PlanFile = { app: { ...buildReviewLock().app, packageManager: 'npm', mode: 'single-tenant' },
    registry: { sources: f.registrySources }, blocks: [], acceptance: [] };
  const output: string[] = [];
  const log = spyOn(console, 'log').mockImplementation((value) => { output.push(String(value)); });
  let persisted = false;
  try {
    const program = new Command().name('sec').exitOverride();
    registerCoreWorkspaceCommands(program, {
      progress: async (_text, _options, execute) => execute(),
      init: async () => { throw new Error('Unexpected init'); },
      compose: async () => { throw new Error('Unexpected compose'); },
      verify: async () => { throw new Error('Unexpected verify'); },
      add: async (_root, id) => addBlockToPlan(id, {
        readPlan: () => plan,
        selectManifest: ({ blockId, version, registrySources }) => loadManifestById(blockId, {
          workspaceRoot: f.workspaceRoot, version, registrySources
        }),
        writePlan: (next) => { plan = next; }
      }),
      resolve: async () => resolveWorkspacePlan({
        readInput: async () => ({ plan, selection: captureManifestSelection(f.workspaceRoot, plan) }),
        align: () => {}, resolve: resolveCapturedManifestSelection,
        validateTemplates: async (lock) => { expect(lock.resolvedBlocks).toHaveLength(2); },
        persistLock: async (lock) => {
          requireLockFileSchema(JSON.parse(JSON.stringify(lock)), 'unchanged strict lock');
          expect(JSON.stringify(lock)).not.toContain('registryResolution');
          persisted = true;
        },
        runPass: async (_pass, execute) => execute()
      })
    });
    await program.parseAsync(['add', 'cache/probe'], { from: 'user' });
    expect(output.join('\n')).toContain('Registry cache/probe: first@1.0.0 selected by source-order; shadowed: second@2.0.0 (workspace:registry-second), third@3.0.0 (workspace:registry-third)');
    expect(plan.blocks).toEqual([{ id: 'cache/probe', version: '1.0.0' }]);

    // Request only the client: its provider is selected through catalog closure.
    const parentRoot = path.join(f.workspaceRoot, 'registry-first', 'client.app');
    mkdirSync(parentRoot);
    const parent = loadManifestById('cache/probe', f).manifest;
    writeFileSync(path.join(parentRoot, 'block.manifest.yaml'), JSON.stringify({ ...parent,
      id: 'client/app', provides: [], requires: ['cache/probe'],
      installs: [{ kind: 'copy', from: 'client.ts', to: 'src/client.ts' }] }));
    plan = { ...plan, blocks: [{ id: 'client/app' }] };
    f.write(1, '2.1.0');
    output.length = 0;
    await program.parseAsync(['resolve'], { from: 'user' });
    expect(persisted).toBe(true);
    expect(output.join('\n')).toContain('Resolved 2 blocks');
    expect(output.join('\n')).toContain('Registry cache/probe: first@1.0.0 selected by source-order; shadowed: second@2.1.0 (workspace:registry-second), third@3.0.0 (workspace:registry-third)');
    expect(output.join('\n')).not.toContain('second@2.0.0');
  } finally { log.mockRestore(); }
});

test('diagnostic changes remain outside public Lock results and do not mutate prior invocation observations', async () => {
  const f = fixture();
  const plan: PlanFile = { app: { ...buildReviewLock().app, packageManager: 'npm', mode: 'single-tenant' },
    registry: { sources: f.registrySources }, blocks: [{ id: 'cache/probe' }], acceptance: [] };
  const first = await resolveCapturedManifestSelection(captureManifestSelection(f.workspaceRoot, plan));
  f.write(1, '2.1.0');
  const nextPlan = { ...plan, registry: { sources: [f.registrySources[0]!, f.registrySources[2]!, f.registrySources[1]!] } };
  const next = await resolveCapturedManifestSelection(captureManifestSelection(f.workspaceRoot, nextPlan));
  expect(first.lock).toEqual(next.lock);
  expect(await resolveGraph(f.workspaceRoot, nextPlan)).toEqual(first.lock);
  expect(first.registryResolutions[0]!.resolution.shadowed).toEqual([shadow('2.0.0', 'second'), shadow('3.0.0', 'third')]);
  expect(next.registryResolutions[0]!.resolution.shadowed).toEqual([shadow('3.0.0', 'third'), shadow('2.1.0', 'second')]);
  next.registryResolutions[0]!.resolution.shadowed[0]!.version = 'caller-only';
  const fresh = await resolveCapturedManifestSelection(captureManifestSelection(f.workspaceRoot, nextPlan));
  expect(fresh.registryResolutions[0]!.resolution.shadowed[0]!.version).toBe('3.0.0');
  expect(JSON.stringify(fresh.lock)).not.toContain('registryResolution');
});

test('duplicate selected identity compares manifest authority rather than invocation diagnostics', () => {
  const f = fixture();
  const selected = loadManifestById('cache/probe', f);
  const reordered = loadManifestById('cache/probe', { ...f,
    registrySources: [f.registrySources[0]!, f.registrySources[2]!, f.registrySources[1]!] });
  expect(resolveManifestGraph([selected, reordered], []).entries).toEqual([selected]);
  const otherSource = { ...selected, registrySourceId: 'other-source' };
  const otherContent = { ...selected, manifest: { ...selected.manifest, provides: ['changed/capability'] } };
  for (const incompatible of [otherSource, otherContent]) {
    expect(() => resolveManifestGraph([selected, incompatible], []))
      .toThrow(expect.objectContaining({ code: 'RESOLVE-CONFLICT-004' }));
  }
  f.write(0, '1.0.1');
  const changed = loadManifestById('cache/probe', f);
  expect(() => resolveManifestGraph([selected, changed], [])).toThrow(expect.objectContaining({ code: 'RESOLVE-CONFLICT-004' }));
});

for (const warm of [false, true]) {
  for (const reversed of [false, true]) {
    test(`source-order diagnostics preserve same-version definition rejection (${warm ? 'warm' : 'cold'}, ${reversed ? 'reverse' : 'forward'})`, async () => {
      const f = fixture();
      f.write(1, '1.0.0');
      const registrySources = reversed ? [...f.registrySources].reverse() : f.registrySources;
      const options = { workspaceRoot: f.workspaceRoot, registrySources };
      if (warm) {
        const admitted = loadManifestById('cache/probe', options);
        expect(admitted.registryResolution!.shadowed).toHaveLength(2);
        await loadAllManifests(options);
      }
      // Even a shadowed, stack-incompatible body must be rejected when its
      // stable ID/version contradicts another source. Order is not authority.
      f.write(1, '1.0.0', undefined, { stackProfiles: ['other-stack'], provides: ['different/capability'] });
      expect(() => loadManifestById('cache/probe', options))
        .toThrow(expect.objectContaining({ code: 'RESOLVE-CONFLICT-004' }));
      await expect(loadAllManifests(options)).rejects.toMatchObject({ code: 'RESOLVE-CONFLICT-004' });
    });
  }
}
