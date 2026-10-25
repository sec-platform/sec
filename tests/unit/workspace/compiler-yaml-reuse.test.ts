import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseYamlDocument, parseYamlValue, YamlInputLimitError, YamlSyntaxError } from '../../../src/adapters/formats/yaml.ts';
import { getWorkspacePaths } from "../../../src/adapters/workspace-context.ts";
import { loadManifestById, MANIFEST_YAML_MAX_INPUT_BYTES } from '../../../src/adapters/workspace/sources/load-manifest.ts';
import { loadOverrideManifest, OVERRIDE_YAML_MAX_INPUT_BYTES } from '../../../src/adapters/workspace/sources/load-override-manifest.ts';
import { loadPlan, PLAN_YAML_MAX_INPUT_BYTES } from '../../../src/adapters/workspace/sources/load-plan.ts';
import { manifestCache } from '../../../src/adapters/workspace/sources/manifest-cache.ts';
import { SUPPORTED_STACK } from '../../../src/compiler/contract.ts';

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
  assert.throws(() => parseYamlValue('name: a\n"name": b\n', { ...admission, stringKeys: true }), (error: unknown) => {
    assert.ok(error instanceof YamlSyntaxError);
    assert.equal(error.code, 'YAML-SYNTAX-001');
    assert.equal(error.kind, 'duplicate-key');
    assert.equal(error.yamlErrorCode, 'DUPLICATE_KEY');
    return true;
  });
  assert.throws(() => parseYamlValue('? [a, b]\n: value\n', { ...admission, stringKeys: true }), YamlSyntaxError);
  assert.throws(() => parseYamlValue('name: a', { ...admission, stringKeys: 'yes' as never }), TypeError);
});

test('the default AST profile remains available for its existing non-DTO consumers', () => {
  const document = parseYamlDocument('key: &text value\nother: *text\n', admission);
  assert.ok((document.contents as unknown as { srcToken?: unknown }).srcToken);
  assert.deepEqual(document.toJS({ maxAliasCount: 100 }), { key: 'value', other: 'value' });
  assert.deepEqual(parseYamlValue('key: &text value\nother: *text\n', { ...admission, stringKeys: true }), { key: 'value', other: 'value' });
});

test('strict library policy rejects unresolved tag warnings', () => {
  assert.throws(() => parseYamlValue('a: !unresolved value\n', { ...admission, stringKeys: true }), YamlSyntaxError);
});

test('UTF-8 byte budget is checked before parsing, not character count or alias expansion', () => {
  assert.deepEqual(parseYamlValue('x: 好', { ...admission, maximumInputBytes: 6 }), { x: '好' });
  assert.throws(() => parseYamlValue('x: 好', { ...admission, maximumInputBytes: 5 }), (error: unknown) => {
    assert.ok(error instanceof YamlInputLimitError);
    assert.equal(error.code, 'YAML-INPUT-001');
    assert.equal(error.actualInputBytes, 6);
    assert.equal(error.maximumInputBytes, 5);
    return true;
  });
  assert.throws(() => parseYamlValue('a: &x [one]\nb: *x\n', { ...admission, maximumAliasCount: 0 }), YamlSyntaxError);
});

function fixture(consumer: 'plan' | 'manifest' | 'override' | 'all') {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-yaml-reuse-'));
  try {
    const planPath = path.join(root, 'plan.yaml');
    const registry = path.join(root, 'registry', 'block.example');
    if (consumer === 'manifest' || consumer === 'all') mkdirSync(registry, { recursive: true });
    const manifestPath = path.join(registry, 'block.manifest.yaml');
    const overrides = getWorkspacePaths(root).overridesRoot;
    if (consumer === 'override' || consumer === 'all') mkdirSync(overrides, { recursive: true });
    const overridePath = path.join(overrides, 'override-manifest.yaml');
    const options = { workspaceRoot: root, registrySources: [{ id: 'test', kind: 'private' as const, location: 'workspace' as const, path: 'registry' }] };
    const manifest = { id: 'block/example', version: '1.0.0', kind: 'capability', stackProfiles: [SUPPORTED_STACK],
      requires: [], provides: ['example'], conflicts: [], installs: [{ kind: 'copy', from: 'source.ts', to: 'src/example.ts' }],
      pins: { inputs: [], outputs: [] }, acceptance: [], contracts: [], generators: [] };
    return { root, planPath, manifestPath, overridePath, options, manifest,
      cleanup() { manifestCache.clearWorkspace(root); rmSync(root, { recursive: true, force: true }); } };
  } catch (error) {
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

test('Plan loader admits ordinary YAML aliases and preserves existing defaults', () => {
  const f = fixture('plan'); try {
    writeFileSync(f.planPath, `app:\n  id: &id app\n  name: *id\n  stack: ${JSON.stringify(SUPPORTED_STACK)}\nregistry:\n  sources: []\n`);
    const plan = loadPlan(f.planPath);
    assert.deepEqual(plan.app, { id: 'app', name: 'app', stack: SUPPORTED_STACK, packageManager: 'pnpm', mode: 'single-tenant' });
    assert.deepEqual(plan.blocks, []); assert.deepEqual(plan.acceptance, []);
  } finally { f.cleanup(); }
});

test('Plan syntax rejection keeps its domain error and original library cause', () => {
  const f = fixture('plan'); try { writeFileSync(f.planPath, 'app: {}\napp: {}\n'); assert.throws(() => loadPlan(f.planPath), typedYamlFailure('PLAN-VALIDATION-022')); }
  finally { f.cleanup(); }
});

test('Manifest root and version overlay preserve resolved values without cache pollution', () => {
  const f = fixture('manifest'); try {
    writeFileSync(f.manifestPath, JSON.stringify(f.manifest));
    const base = loadManifestById('block/example', f.options); assert.equal(base.manifest.version, '1.0.0');
    const overlay = path.join(path.dirname(f.manifestPath), 'versions', '2.0.0'); mkdirSync(overlay, { recursive: true });
    writeFileSync(path.join(overlay, 'block.manifest.yaml'), 'version: 2.0.0\nprovides: [new]\n');
    const next = loadManifestById('block/example', { ...f.options, version: '2.0.0' });
    assert.equal(next.manifest.version, '2.0.0'); assert.deepEqual(next.manifest.provides, ['new']);
    Reflect.set(next.manifest, 'version', 'forged');
    Reflect.set(next.manifest.provides, '0', 'forged');
    const reloaded = loadManifestById('block/example', { ...f.options, version: '2.0.0' });
    assert.equal(reloaded.manifest.version, '2.0.0'); assert.deepEqual(reloaded.manifest.provides, ['new']);
    assert.equal(base.manifest.version, '1.0.0');
  } finally { f.cleanup(); }
});

test('Manifest syntax rejection is a typed boundary failure', () => {
  const f = fixture('manifest'); try { writeFileSync(f.manifestPath, 'id: block/example\nid: block/other\n'); assert.throws(() => loadManifestById('block/example', f.options), typedYamlFailure('MANIFEST-SCHEMA-001')); }
  finally { f.cleanup(); }
});

test('Override file and direct structural contract preserve defaults and reject duplicate YAML keys', async () => {
  const f = fixture('override'); try {
    writeFileSync(f.overridePath, 'overrides:\n  - id: change\n    entry: patches/change.ts\n    target: src/change.ts\n    reason: "  justified  "\n');
    assert.deepEqual((await loadOverrideManifest(f.root)).overrides[0], { id: 'change', entry: 'patches/change.ts', target: 'src/change.ts', reason: 'justified', source: 'manual', conflictsWith: [] });
    writeFileSync(f.overridePath, 'overrides: []\noverrides: []\n');
    await assert.rejects(loadOverrideManifest(f.root), typedYamlFailure('OVERRIDE-SCHEMA-001'));
    writeFileSync(f.overridePath, ''); assert.deepEqual(await loadOverrideManifest(f.root), { overrides: [] });
  } finally { f.cleanup(); }
});

test('each loader enforces its own explicit parser byte policy before syntax recovery or schema', async () => {
  const f = fixture('all'); try {
    writeFileSync(f.planPath, ' '.repeat(PLAN_YAML_MAX_INPUT_BYTES + 1));
    assert.throws(() => loadPlan(f.planPath), typedYamlFailure('PLAN-VALIDATION-022'));
    writeFileSync(f.manifestPath, ' '.repeat(MANIFEST_YAML_MAX_INPUT_BYTES + 1));
    assert.throws(() => loadManifestById('block/example', f.options), typedYamlFailure('MANIFEST-SCHEMA-001'));
    writeFileSync(f.overridePath, ' '.repeat(OVERRIDE_YAML_MAX_INPUT_BYTES + 1));
    await assert.rejects(loadOverrideManifest(f.root), typedYamlFailure('OVERRIDE-SCHEMA-001'));
  } finally { f.cleanup(); }
});


test('Plan UTF-8 BOM handling retains the existing decoded-input contract', () => {
  const f = fixture('plan'); try {
    const source = JSON.stringify({ app: { id: 'app', name: 'App', stack: SUPPORTED_STACK } });
    writeFileSync(f.planPath, source); const ordinary = loadPlan(f.planPath);
    writeFileSync(f.planPath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(source)]));
    assert.deepEqual(loadPlan(f.planPath), ordinary);
  } finally { f.cleanup(); }
});

test('invalid Plan UTF-8 remains a decoding failure with its original cause, not a YAML default', () => {
  const f = fixture('plan'); try {
    writeFileSync(f.planPath, Buffer.from([0xff]));
    assert.throws(() => loadPlan(f.planPath), error => {
      const value = error as { code?: unknown; cause?: unknown };
      return value.code === 'PLAN-VALIDATION-023' && value.cause instanceof Error;
    });
  } finally { f.cleanup(); }
});
