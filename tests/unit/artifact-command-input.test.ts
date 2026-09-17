import { test } from 'bun:test';
import { Command } from 'commander';
import assert from 'node:assert/strict';
import { ARTIFACT_KIND_OPTION, ARTIFACT_PATHS_OPTION, parseArtifactCommandInput } from '../../src/bootstrap/cli/artifact-command-input.ts';
import { registerWorkspaceCommands } from '../../src/bootstrap/cli/register-workspace-commands.ts';
import { CI_ARTIFACT_KINDS, isCiArtifactKind } from '../../src/assurance/verification/ci-artifacts/contract/types.ts';

const usage = (error: unknown) => (error as { code: string }).code === 'CLI-USAGE-001';

for (const filter of [undefined, ...CI_ARTIFACT_KINDS]) {
  test(`path selection binds canonical filter ${filter} and output without a write request`, () => {
    const input = parseArtifactCommandInput(undefined, { paths: true, kind: filter, json: true, compact: true });
    assert.deepEqual(input, { kind: 'paths', filter, output: { json: true, compact: true } });
    assert.ok(Object.isFrozen(input)); assert.ok(Object.isFrozen(input.output));
    assert.equal('request' in input, false);
  });
}

test('manifest inspection does not inspect paths, filter or unrelated fields', () => {
  const input = new Proxy({ json: false, compact: false,
    get paths() { assert.fail('paths read'); throw new Error('unreachable'); }, get kind() { assert.fail('filter read'); throw new Error('unreachable'); } }, {
    ownKeys() { assert.fail('whole options read'); }
  });
  assert.deepEqual(parseArtifactCommandInput('manifest', input), { kind: 'manifest', output: { json: false, compact: false } });
});

test('generation preserves ignored-filter semantics without reading unused getters', () => {
  for (const paths of [undefined, false]) {
    const input = { paths, get kind() { assert.fail('unused filter read'); throw new Error('unreachable'); } };
    assert.deepEqual(parseArtifactCommandInput(undefined, input), { kind: 'generate', output: { json: false, compact: false } });
  }
});

test('invalid selected booleans cannot choose a read or write path by truthiness', () => {
  for (const paths of [null, 0, 1, '', 'false', [], {}, new Boolean(true), Symbol('paths')]) {
    assert.throws(() => parseArtifactCommandInput(undefined, { paths, get kind() { assert.fail('filter read'); throw new Error('unreachable'); } }), usage);
  }
});

test('invalid selected filters reject without conversion or an empty false-success view', () => {
  for (const filter of [null, 0, {}, [], '', 'unknown', 'constructor', '__proto__', new String('test'), Symbol('test')]) {
    assert.equal(isCiArtifactKind(filter), false);
    assert.throws(() => parseArtifactCommandInput(undefined, { paths: true, kind: filter }), usage);
  }
  const filter = { [Symbol.toPrimitive]() { assert.fail('conversion'); } };
  assert.throws(() => parseArtifactCommandInput(undefined, { paths: true, kind: filter }), usage);
});

test('unsupported inspection modes cannot fall through into manifest generation', () => {
  for (const mode of ['unknown', 'constructor', null, 1, {}]) {
    assert.throws(() => parseArtifactCommandInput(mode, { get paths() { assert.fail('route selected flags read'); throw new Error('unreachable'); } }), usage);
  }
});

test('path and filter getters are captured once; later changes cannot alter the admitted selection', () => {
  const reads: Record<string, number> = {};
  const raw = { paths: true, kind: 'test', json: true, compact: false };
  const captured = parseArtifactCommandInput(undefined, new Proxy(raw, {
    ownKeys() { assert.fail('whole options enumerated'); },
    get(target, key) { reads[String(key)] = (reads[String(key)] ?? 0) + 1; return Reflect.get(target, key); }
  }));
  raw.paths = false; raw.kind = 'contract'; raw.json = false;
  assert.deepEqual(reads, { json: 1, compact: 1, paths: 1, kind: 1 });
  assert.deepEqual(captured, { kind: 'paths', filter: 'test', output: { json: true, compact: false } });
});

test('inherited selection flags retain the old own-enumerable input boundary', () => {
  const input = Object.create({ paths: true, kind: 'test' });
  assert.equal(parseArtifactCommandInput(undefined, input).kind, 'generate');
  Object.defineProperty(input, 'paths', { value: true, enumerable: false });
  assert.equal(parseArtifactCommandInput(undefined, input).kind, 'generate');
});

test('canonical kinds and actual CLI flag metadata cannot drift through mutation', () => {
  assert.ok(Object.isFrozen(CI_ARTIFACT_KINDS));
  assert.equal(Reflect.set(CI_ARTIFACT_KINDS, '0', 'other'), false);
  const program = new Command(); registerWorkspaceCommands(program);
  const command = program.commands.find((c) => c.name() === 'artifacts')!;
  for (const definition of [ARTIFACT_KIND_OPTION, ARTIFACT_PATHS_OPTION]) {
    const option = command.options.find((o) => o.flags === definition.flags)!;
    assert.equal(option.description, definition.description);
    assert.equal(option.attributeName(), definition.name);
  }
});

test('real artifact action rejects selected invalid input before loading its execution module', async () => {
  for (const flags of [{ paths: 'false' }, { paths: true, kind: 'invalid' }]) {
    const root = new Command().name('sec').exitOverride().configureOutput({ writeOut() {}, writeErr() {} });
    registerWorkspaceCommands(root);
    const command = root.commands.find((c) => c.name() === 'artifacts')!;
    for (const [name, value] of Object.entries(flags)) command.setOptionValue(name, value);
    await assert.rejects(root.parseAsync(['artifacts'], { from: 'user' }), usage);
  }
});
