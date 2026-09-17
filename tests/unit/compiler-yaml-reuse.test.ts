import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { SUPPORTED_STACK } from '../../src/compiler/contract.ts';
import { loadManifestById, MANIFEST_YAML_MAX_INPUT_BYTES } from '../../src/compiler/parse/load-manifest.ts';
import { loadOverrideManifest, OVERRIDE_YAML_MAX_INPUT_BYTES } from '../../src/compiler/parse/load-override-manifest.ts';
import { loadPlan, PLAN_YAML_MAX_INPUT_BYTES } from '../../src/compiler/parse/load-plan.ts';
import { manifestCache } from '../../src/compiler/parse/manifest-cache.ts';
import { parseYamlDocument, parseYamlValue, YamlInputLimitError, YamlSyntaxError } from '../../src/adapters/formats/yaml.ts';
import { getWorkspacePaths } from '../../src/workspace/runtime/paths.ts';

// These tests deliberately retain the real yaml/Zod and retained readers. They
// must not be marked passed by substituting JSON.parse or a structural stub.
const admission = { label: 'contract test', maximumInputBytes: 1024, maximumAliasCount: 100 };
const typedYamlFailure = (code: string) => (error: unknown): boolean => {
  const candidate = error as { code?: unknown; cause?: unknown };
  return candidate.code === code && (candidate.cause instanceof YamlSyntaxError || candidate.cause instanceof YamlInputLimitError);
};

test('string-key profile uses the existing library and rejects duplicate decoded key identities', () => {
  const parsed = parseYamlValue('name: value\nitems: [a, b]\n', { ...admission, stringKeys: true });
  assert.deepEqual(parsed, { name: 'value', items: ['a', 'b'] });
  assert.throws(() => parseYamlValue('name: a\n"name": b\n', { ...admission, stringKeys: true }), YamlSyntaxError);
  assert.throws(() => parseYamlValue('? [a, b]\n: value\n', { ...admission, stringKeys: true }), YamlSyntaxError);
  assert.throws(() => parseYamlValue('name: a', { ...admission, stringKeys: 'yes' as never }), TypeError);
});

test('the default AST profile remains available for its existing non-DTO consumers', () => {
  const document = parseYamlDocument('key: &text value\nother: *text\n', admission);
  assert.ok((document.contents as unknown as { srcToken?: unknown }).srcToken);
  assert.deepEqual(document.toJS({ maxAliasCount: 100 }), { key: 'value', other: 'value' });
  assert.deepEqual(parseYamlValue('key: &text value\nother: *text\n', { ...admission, stringKeys: true }), { key: 'value', other: 'value' });
});

for (const source of ['a: 1\na: 2\n', 'a: !unresolved value\n', 'a: 1\n---\na: 2\n']) {
  test(`strict library policy rejects ambiguous YAML ${JSON.stringify(source)}`, () => {
    assert.throws(() => parseYamlValue(source, { ...admission, stringKeys: true }), YamlSyntaxError);
  });
}

test('UTF-8 byte budget is checked before parsing, not character count or alias expansion', () => {
  assert.deepEqual(parseYamlValue('x: 好', { ...admission, maximumInputBytes: 6 }), { x: '好' });
  assert.throws(() => parseYamlValue('x: 好', { ...admission, maximumInputBytes: 5 }), YamlInputLimitError);
  assert.throws(() => parseYamlValue('a: &x [one]\nb: *x\n', { ...admission, maximumAliasCount: 0 }), YamlSyntaxError);
});

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-yaml-reuse-'));
  const planPath = path.join(root, 'plan.yaml');
  const registry = path.join(root, 'registry', 'block.example'); mkdirSync(registry, { recursive: true });
  const manifestPath = path.join(registry, 'block.manifest.yaml');
  const overrides = getWorkspacePaths(root).overridesRoot; mkdirSync(overrides, { recursive: true });
  const overridePath = path.join(overrides, 'override-manifest.yaml');
  const options = { workspaceRoot: root, registrySources: [{ id: 'test', kind: 'private' as const, location: 'workspace' as const, path: 'registry' }] };
  const manifest = { id: 'block/example', version: '1.0.0', kind: 'capability', stackProfiles: [SUPPORTED_STACK],
    requires: [], provides: ['example'], conflicts: [], installs: [{ kind: 'copy', from: 'source.ts', to: 'src/example.ts' }],
    pins: { inputs: [], outputs: [] }, acceptance: [], contracts: [], generators: [] };
  return { root, planPath, manifestPath, overridePath, options, manifest,
    cleanup() { manifestCache.clearWorkspace(root); rmSync(root, { recursive: true, force: true }); } };
}

test('Plan loader admits ordinary YAML aliases and preserves existing defaults', () => {
  const f = fixture(); try {
    writeFileSync(f.planPath, `app:\n  id: &id app\n  name: *id\n  stack: ${JSON.stringify(SUPPORTED_STACK)}\nregistry:\n  sources: []\n`);
    const plan = loadPlan(f.planPath);
    assert.deepEqual(plan.app, { id: 'app', name: 'app', stack: SUPPORTED_STACK, packageManager: 'pnpm', mode: 'single-tenant' });
    assert.deepEqual(plan.blocks, []); assert.deepEqual(plan.acceptance, []);
  } finally { f.cleanup(); }
});

for (const source of ['app: {}\napp: {}\n', 'app: !unknown {}\n', 'app: {}\n---\napp: {}\n']) {
  test(`Plan syntax rejection keeps its domain error and original library cause ${JSON.stringify(source)}`, () => {
    const f = fixture(); try { writeFileSync(f.planPath, source); assert.throws(() => loadPlan(f.planPath), typedYamlFailure('PLAN-VALIDATION-022')); }
    finally { f.cleanup(); }
  });
}

test('Manifest root and version overlay use strict YAML without changing resolved version or frozen cache results', () => {
  const f = fixture(); try {
    writeFileSync(f.manifestPath, JSON.stringify(f.manifest));
    const base = loadManifestById('block/example', f.options); assert.equal(base.manifest.version, '1.0.0');
    assert.equal(loadManifestById('block/example', f.options), base);
    const overlay = path.join(path.dirname(f.manifestPath), 'versions', '2.0.0'); mkdirSync(overlay, { recursive: true });
    writeFileSync(path.join(overlay, 'block.manifest.yaml'), 'version: 2.0.0\nprovides: [new]\n');
    const next = loadManifestById('block/example', { ...f.options, version: '2.0.0' });
    assert.equal(next.manifest.version, '2.0.0'); assert.deepEqual(next.manifest.provides, ['new']);
    assert.ok(Object.isFrozen(next.manifest)); assert.equal(base.manifest.version, '1.0.0');
  } finally { f.cleanup(); }
});

for (const source of ['id: block/example\nid: block/other\n', 'id: !unknown block/example\n', 'id: block/example\n---\nid: block/other\n']) {
  test(`Manifest syntax rejection is a typed boundary failure ${JSON.stringify(source)}`, () => {
    const f = fixture(); try { writeFileSync(f.manifestPath, source); assert.throws(() => loadManifestById('block/example', f.options), typedYamlFailure('MANIFEST-SCHEMA-001')); }
    finally { f.cleanup(); }
  });
}

test('Override file and direct structural contract preserve defaults and reject duplicate YAML keys', async () => {
  const f = fixture(); try {
    writeFileSync(f.overridePath, 'overrides:\n  - id: change\n    entry: patches/change.ts\n    target: src/change.ts\n    reason: "  justified  "\n');
    assert.deepEqual((await loadOverrideManifest(f.root)).overrides[0], { id: 'change', entry: 'patches/change.ts', target: 'src/change.ts', reason: 'justified', source: 'manual', conflictsWith: [] });
    writeFileSync(f.overridePath, 'overrides: []\noverrides: []\n');
    await assert.rejects(loadOverrideManifest(f.root), typedYamlFailure('OVERRIDE-SCHEMA-001'));
    writeFileSync(f.overridePath, ''); assert.deepEqual(await loadOverrideManifest(f.root), { overrides: [] });
  } finally { f.cleanup(); }
});

test('each loader enforces its own explicit parser byte policy before syntax recovery or schema', async () => {
  const f = fixture(); try {
    writeFileSync(f.planPath, ' '.repeat(PLAN_YAML_MAX_INPUT_BYTES + 1));
    assert.throws(() => loadPlan(f.planPath), typedYamlFailure('PLAN-VALIDATION-022'));
    writeFileSync(f.manifestPath, ' '.repeat(MANIFEST_YAML_MAX_INPUT_BYTES + 1));
    assert.throws(() => loadManifestById('block/example', f.options), typedYamlFailure('MANIFEST-SCHEMA-001'));
    writeFileSync(f.overridePath, ' '.repeat(OVERRIDE_YAML_MAX_INPUT_BYTES + 1));
    await assert.rejects(loadOverrideManifest(f.root), typedYamlFailure('OVERRIDE-SCHEMA-001'));
  } finally { f.cleanup(); }
});


test('Plan UTF-8 BOM handling retains the existing decoded-input contract', () => {
  const f = fixture(); try {
    const source = JSON.stringify({ app: { id: 'app', name: 'App', stack: SUPPORTED_STACK } });
    writeFileSync(f.planPath, source); const ordinary = loadPlan(f.planPath);
    writeFileSync(f.planPath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(source)]));
    assert.deepEqual(loadPlan(f.planPath), ordinary);
  } finally { f.cleanup(); }
});

test('invalid Plan UTF-8 remains a decoding failure with its original cause, not a YAML default', () => {
  const f = fixture(); try {
    writeFileSync(f.planPath, Buffer.from([0xff]));
    assert.throws(() => loadPlan(f.planPath), error => {
      const value = error as { code?: unknown; cause?: unknown };
      return value.code === 'PLAN-VALIDATION-023' && value.cause instanceof Error;
    });
  } finally { f.cleanup(); }
});
