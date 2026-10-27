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
    assert.equal('request' in input, false);
  });
}

// The only production caller admits Commander argv options. Invalid ignored
// filter text is reachable; accessor counts and arbitrary Proxy traps are not.
test('manifest inspection ignores path and filter selections', () => {
  assert.deepEqual(parseArtifactCommandInput('manifest', {
    json: false, compact: false, paths: true, kind: 'not-a-kind'
  }), { kind: 'manifest', output: { json: false, compact: false } });
});

test('generation ignores a filter without path selection', () => {
  assert.deepEqual(parseArtifactCommandInput(undefined, { kind: 'not-a-kind' }), {
    kind: 'generate', output: { json: false, compact: false }
  });
});

test('later caller mutation cannot alter the admitted path and filter selection', () => {
  const raw = { paths: true, kind: 'test', json: true, compact: false };
  const captured = parseArtifactCommandInput(undefined, raw);
  raw.paths = false; raw.kind = 'contract'; raw.json = false;
  assert.deepEqual(captured, { kind: 'paths', filter: 'test', output: { json: true, compact: false } });
  assert.equal('request' in captured, false);
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
  for (const filter of ['', 'constructor']) {
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
