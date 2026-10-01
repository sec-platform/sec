import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getWorkspacePaths } from '../../src/adapters/workspace-context.ts';
import { loadWorkspaceEngineeringIRBuildInput } from '../../src/adapters/workspace/engineering-input.ts';
import { saveLock } from '../../src/adapters/workspace/lock.ts';
import { loadAllManifests, loadManifestById, loadManifestForResolvedBlock } from '../../src/adapters/workspace/sources/load-manifest.ts';
import { manifestCache } from '../../src/adapters/workspace/sources/manifest-cache.ts';
import { projectExplainGraphInspect } from '../../src/application/explain-graph-inspect.ts';
import { buildExplainGraphFromEvidence } from '../../src/assurance/verification/review/explain-graph.ts';
import type { PlanRegistrySource } from '../../src/compiler/contract.ts';
import { requireLockFileSchema } from '../../src/compiler/contract/lock-schema.ts';
import { inputRevisionPayload } from '../../src/compiler/ir/ir-revision.ts';
import { prepareManifestResolution } from '../../src/compiler/resolve/resolve-plan.ts';
import { formatExplainGraphInspect } from '../../src/entry/cli/explain-graph-inspect.ts';
import { buildPassingReviewCoverage, buildReviewLock, buildReviewProvenance } from '../helpers/review-fixtures.ts';
import { buildSemanticViewFixture } from '../helpers/semantic-view-fixtures.ts';

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
    stackProfiles: ['typescript-library'], requires: [], provides: [], conflicts: [],
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

test('persisted shadow provenance reaches real explain text while remaining outside selected semantic identity', async () => {
  const f = fixture();
  const entries = await loadAllManifests(f);
  const resolved = prepareManifestResolution(f.workspaceRoot, entries, entries);
  const original = buildReviewLock({ resolvedBlocks: resolved.resolvedBlocks, semanticViews: buildSemanticViewFixture() });
  const lock = requireLockFileSchema(JSON.parse(JSON.stringify(original)), 'registry test');
  const graph = buildExplainGraphFromEvidence(lock, buildReviewProvenance(), buildPassingReviewCoverage(), null, []);
  expect(graph.overlays.registryResolutions).toEqual([{
    blockId: 'cache/probe', selected: shadow('1.0.0', 'first'),
    resolution: { policy: 'source-order', shadowed: [shadow('2.0.0', 'second'), shadow('3.0.0', 'third')] }
  }]);
  const text = formatExplainGraphInspect(projectExplainGraphInspect(graph));
  expect(text).toContain('Registry cache/probe: first@1.0.0 selected by source-order; shadowed: second@2.0.0 (workspace:registry-second), third@3.0.0 (workspace:registry-third)');
  const revisionInput = { app: lock.app, resolvedBlocks: lock.resolvedBlocks, manifests: [],
    acceptanceIds: [], policyDeclarations: [] };
  const before = inputRevisionPayload(revisionInput);
  lock.resolvedBlocks[0]!.registryResolution!.shadowed.reverse();
  lock.resolvedBlocks[0]!.registryResolution!.shadowed[0]!.version = '9.0.0';
  expect(inputRevisionPayload(revisionInput)).toEqual(before);
  expect(graph.overlays.registryResolutions![0]!.resolution.shadowed[0]!.version).toBe('2.0.0');
  lock.resolvedBlocks[0]!.version = '9.0.0';
  expect(inputRevisionPayload(revisionInput)).not.toEqual(before);
  lock.resolvedBlocks[0]!.registryResolution!.policy = 'last-source' as 'source-order';
  expect(() => requireLockFileSchema(lock, 'invalid resolution')).toThrow();
});

test('workspace pinned input accepts retained shadow observations without re-resolving or granting lower-source access', async () => {
  const f = fixture();
  const entry = loadManifestById('cache/probe', f);
  const resolved = prepareManifestResolution(f.workspaceRoot, [entry], [entry]);
  const lock = buildReviewLock({ resolvedBlocks: resolved.resolvedBlocks });
  const planPath = getWorkspacePaths(f.workspaceRoot).workspaceConfigPath;
  mkdirSync(path.join(f.workspaceRoot, '.sec'), { recursive: true });
  mkdirSync(path.dirname(planPath), { recursive: true });
  writeFileSync(planPath, JSON.stringify({ app: lock.app, registry: { sources: f.registrySources },
    blocks: [{ id: 'cache/probe' }], acceptance: [] }));
  await saveLock(f.workspaceRoot, lock);
  f.write(1, '2.0.0', undefined, { unknownField: true });
  const input = await loadWorkspaceEngineeringIRBuildInput(f.workspaceRoot);
  expect(input.sourceLock.resolvedBlocks[0]!.registryResolution).toEqual(entry.registryResolution);
  expect(input.engineeringIRInput.resolvedBlocks[0]!.version).toBe('1.0.0');
  lock.resolvedBlocks[0]!.registrySourceId = 'third';
  await saveLock(f.workspaceRoot, lock);
  await expect(loadWorkspaceEngineeringIRBuildInput(f.workspaceRoot))
    .rejects.toThrow('resolved block cache/probe has a stale registry source');
});
