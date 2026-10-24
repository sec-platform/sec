import { test } from 'bun:test';
import { Command } from 'commander';
import assert from 'node:assert/strict';
import { CI_ARTIFACT_KINDS } from '../../../src/assurance/verification/ci-artifacts/contract/types.ts';
import { parseArtifactCommandInput } from '../../../src/entry/cli/artifact-command-input.ts';
import { registerAdvancedWorkspaceCommands } from '../../../src/entry/cli/register-advanced-workspace-commands.ts';

const usage = (error: unknown) => (error as { code: string }).code === 'CLI-USAGE-001';

// Independent public filter vocabulary: deleting a production kind must not
// silently delete its admission case too.
// The fixed 'test' filter is admitted by the capture-once case below.
for (const filter of [undefined, 'governance', 'contract'] as const) {
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
  assert.ok(Object.isFrozen(captured)); assert.ok(Object.isFrozen(captured.output));
  assert.equal('request' in captured, false);
});

test('inherited selection flags retain the old own-enumerable input boundary', () => {
  const input = Object.create({ paths: true, kind: 'test' });
  assert.equal(parseArtifactCommandInput(undefined, input).kind, 'generate');
  Object.defineProperty(input, 'paths', { value: true, enumerable: false });
  assert.equal(parseArtifactCommandInput(undefined, input).kind, 'generate');
});

test('canonical kinds resist mutation and public artifact flags select the requested view', async () => {
  assert.ok(Object.isFrozen(CI_ARTIFACT_KINDS));
  assert.equal(Reflect.set(CI_ARTIFACT_KINDS, '0', 'other'), false);
  const program = new Command().name('sec').exitOverride();
  const selections: unknown[] = [];
  registerAdvancedWorkspaceCommands(program, {
    repair: async () => assert.fail('repair selected'),
    upgrade: async () => assert.fail('upgrade selected'),
    view: async () => assert.fail('workspace view selected'),
    artifacts: async ({ input }) => { selections.push(input); }
  });
  await program.parseAsync(['artifacts', '--paths', '--kind', 'test', '--json', '--compact'], { from: 'user' });
  assert.deepEqual(selections, [{ kind: 'paths', filter: 'test', output: { json: true, compact: true } }]);
});

test('artifact filter arguments reject invalid text before invoking any handler', async () => {
  for (const filter of ['', 'unknown', 'constructor', '__proto__']) {
    const root = new Command().name('sec').exitOverride().configureOutput({ writeOut() {}, writeErr() {} });
    let calls = 0;
    const unexpected = async () => { calls += 1; assert.fail('invalid filter selected a handler'); };
    registerAdvancedWorkspaceCommands(root, {
      repair: unexpected, upgrade: unexpected, view: unexpected, artifacts: unexpected
    });
    await assert.rejects(root.parseAsync(['artifacts', '--paths', '--kind', filter], { from: 'user' }), usage);
    assert.equal(calls, 0);
  }
});
