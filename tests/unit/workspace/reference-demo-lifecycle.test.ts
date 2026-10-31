import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  runReferenceDemo,
  type ReferenceDemoOperations
} from '../../../src/application/reference-demo.ts';
import { ResourceCompositeSettlementError } from '../../../src/execution/resource-settlement.ts';

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

for (const mode of ['quickstart', 'governance', 'closed-loop'] as const) {
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

test('body and cleanup errors both survive demo closeout', async () => {
  const primary = new Error('compile');
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
