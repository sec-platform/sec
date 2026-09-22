import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  REFERENCE_DEMO_MODES,
  runReferenceDemo,
  type ReferenceDemoOperations
} from '../../src/application/reference-demo.ts';
import { ResourceCompositeSettlementError } from '../../src/execution/resource-settlement.ts';

function operations(events: string[]): ReferenceDemoOperations {
  return {
    async createWorkspace() { events.push('create'); return '/owned/demo'; },
    announceWorkspace(root) { assert.equal(root, '/owned/demo'); events.push('announce'); },
    async initializeWorkspace() { events.push('initialize'); },
    async compileWorkspace(_root, through) { events.push(`compile:${through}`); },
    async verifyAll() { events.push('verify'); },
    async listGovernanceArtifacts() { events.push('artifacts'); },
    async explainCompactJson() { events.push('explain'); },
    async removeWorkspace(root) { assert.equal(root, '/owned/demo'); events.push('remove'); }
  };
}

async function rejectsWith(promise: Promise<unknown>, reason: unknown): Promise<void> {
  let rejected = false;
  try { await promise; } catch (actual) { rejected = true; assert.equal(actual, reason); }
  assert.equal(rejected, true);
}

for (const mode of REFERENCE_DEMO_MODES) {
  test(`${mode} preserves its operation sequence and removes only its acquired workspace`, async () => {
    const events: string[] = [];
    await runReferenceDemo(mode, operations(events));
    assert.deepEqual(events, [
      'create', 'announce', 'initialize', mode === 'closed-loop' ? 'compile:full' : 'compile:compose',
      ...(mode === 'closed-loop' ? ['verify'] : []),
      ...(mode !== 'quickstart' ? ['artifacts'] : []),
      ...(mode === 'closed-loop' ? ['explain'] : []),
      'remove'
    ]);
  });
}

test('failed acquisition never invokes cleanup on an unowned workspace', async () => {
  const events: string[] = [], ops = operations(events);
  ops.createWorkspace = async () => { throw undefined; };
  await rejectsWith(runReferenceDemo('quickstart', ops), undefined);
  assert.deepEqual(events, []);
});

for (const primary of [undefined, new Error('compile')]) {
  test(`a ${typeof primary} body error and cleanup error both survive demo closeout`, async () => {
    const events: string[] = [], ops = operations(events), cleanup = new Error('remove');
    ops.compileWorkspace = async () => { events.push('compile'); throw primary; };
    ops.removeWorkspace = async () => { events.push('remove'); throw cleanup; };
    await assert.rejects(runReferenceDemo('closed-loop', ops), error => {
      assert.ok(error instanceof ResourceCompositeSettlementError);
      assert.deepEqual(error.failures, [
        { label: 'reference-demo', error: primary },
        { label: 'reference-demo-workspace', error: cleanup }
      ]);
      return true;
    });
    assert.deepEqual(events, ['create', 'announce', 'initialize', 'compile', 'remove']);
  });
}

test('synchronous announcement failure also settles the acquired workspace exactly once', async () => {
  const events: string[] = [], ops = operations(events), primary = Object.freeze({ announce: true });
  ops.announceWorkspace = () => { throw primary; };
  await rejectsWith(runReferenceDemo('quickstart', ops), primary);
  assert.deepEqual(events, ['create', 'remove']);
});

test('cleanup-only failure preserves its identity without repeating removal', async () => {
  const events: string[] = [], ops = operations(events), cleanup = Object.freeze({ cleanup: true });
  ops.removeWorkspace = async () => { events.push('remove'); throw cleanup; };
  await rejectsWith(runReferenceDemo('quickstart', ops), cleanup);
  assert.deepEqual(events, ['create', 'announce', 'initialize', 'compile:compose', 'remove']);
});

test('demo methods and cleanup are captured before asynchronous workspace acquisition', async () => {
  const events: string[] = [], ops = operations(events);
  ops.createWorkspace = async () => {
    events.push('create');
    ops.initializeWorkspace = async () => { events.push('replacement-initialize'); };
    ops.removeWorkspace = async () => { events.push('replacement-remove'); };
    return '/owned/demo';
  };
  await runReferenceDemo('quickstart', ops);
  assert.deepEqual(events, ['create', 'announce', 'initialize', 'compile:compose', 'remove']);
});

test('a quickstart does not inspect unused mode-specific operations', async () => {
  const events: string[] = [], ops = operations(events);
  for (const key of ['verifyAll', 'listGovernanceArtifacts', 'explainCompactJson']) {
    Object.defineProperty(ops, key, { get() { throw new Error('Unused operation was inspected'); } });
  }
  await runReferenceDemo('quickstart', ops);
  assert.deepEqual(events, ['create', 'announce', 'initialize', 'compile:compose', 'remove']);
});
