import { test } from 'bun:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { issueGitReadAuthorityOperation } from '../../src/adapters/providers/git-read/authority.ts';
import { createAuthorityGitReadSession } from '../../src/adapters/providers/git-read/runtime/session.ts';
import { assertProcessResourceSessionReceipt, openProcessResourceSession } from '../../src/adapters/runtime-state/physical/runtime/process-resource-session.ts';
import { DEFAULT_TEST_TIMEOUT_MS } from '../../src/adapters/self-hosting/development/runner/test-execution-policy.ts';
import { issueOperationRequirementBindingContext } from '../../src/execution/operation/requirement-binding-context.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

// Native execution only: these tests borrow an actual owner-issued process
// session. No close monkey-patch or structural stand-in can establish ownership.
function parent(root: string) {
  const operation = issueGitReadAuthorityOperation({ cwd: root, budget: {} });
  const requirement = operation.plan.execution.requirements.find(value => value.effectKinds.includes('process'))!;
  const session = openProcessResourceSession({ operation, requirementBindingContext: issueOperationRequirementBindingContext({
    operation, requirementId: requirement.id,
    resourceCeilings: operation.plan.execution.aggregateBudgets.filter(({ resource }) =>
      resource === 'duration-ms' || resource === 'processes' || resource === 'input-bytes' || resource === 'output-bytes')
  }) });
  return { operation, session };
}

for (const cause of ['missing-root', 'cancelled', 'executable-budget'] as const) {
  test(`Git ${cause} admission refuses without closing the borrowed parent`, () => withTempWorkspace(async root => {
    const owner = parent(root);
    try {
      const resolution = createAuthorityGitReadSession({
        cwd: cause === 'missing-root' ? path.join(root, 'missing') : root,
        operation: owner.operation, processSession: owner.session,
        budget: cause === 'executable-budget' ? { maxExecutableBytes: 1 } : {},
        ...(cause === 'cancelled' ? { signal: AbortSignal.abort() } : {})
      });
      assert.equal(resolution.status, 'unavailable');
      assert.equal(owner.session.signal.aborted, false);
      assert.ok(Number.isSafeInteger(owner.session.cooperativeDeadlineAtUnixMs()));
    } finally { assertProcessResourceSessionReceipt(owner.session.close()); }
  }, 'sec-git-borrowed-'), DEFAULT_TEST_TIMEOUT_MS);
}

test('an owned Git session retains its process count after the real child and session close', () => withTempWorkspace(async root => {
  const operation = issueGitReadAuthorityOperation({ cwd: root, budget: {} });
  const resolution = createAuthorityGitReadSession({ cwd: root, operation, budget: {} });
  assert.equal(resolution.status, 'ready');
  if (resolution.status !== 'ready') throw new Error('Native Git admission is required for this test');
  const session = resolution.session;
  try { assert.equal((await session.run(['--version'])).kind, 'completed'); }
  finally {
    const receipt = await session.close!();
    assert.equal(receipt.processCount, 1); assert.equal(session.processCount, receipt.processCount);
    assert.equal(await session.close!(), receipt);
  }
}, 'sec-git-closed-count-'), DEFAULT_TEST_TIMEOUT_MS);
