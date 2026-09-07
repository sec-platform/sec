import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { withAuthorityGitReadOperation, withAuthorityGitReadSession } from '../../src/external-capabilities/git-read/authority.ts';
import { resolveGitReadSessionBudget } from '../../src/external-capabilities/git-read/runtime/session.ts';
import { DEFAULT_TEST_TIMEOUT_MS } from '../../src/development/runner/test-execution-policy.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

// Real production session issuance and physical closure are required here.
// These cases cannot be certified by replacing the Git/session/receipt owner.
// No repository mutation, Git child command, network or installation is needed:
// the lifecycle itself must close correctly around a supplied caller operation.
test('native Git session closure preserves every actual caller rejection value', () => withTempWorkspace(async root => {
  for (const reason of [undefined, null, false, 0, NaN, new Error('caller')]) {
    let entered = false, failed = false;
    try {
      await withAuthorityGitReadSession({ cwd: root }, async () => { entered = true; throw reason; });
    } catch (error) {
      failed = true;
      assert.equal(entered, true, 'The real provider must have admitted the callback');
      assert.ok(Object.is(error, reason));
    }
    assert.equal(failed, true);
  }
}, 'sec-git-caller-rejection-'), DEFAULT_TEST_TIMEOUT_MS);

test('native Git session closure keeps successful undefined distinct from rejected undefined', () => withTempWorkspace(async root => {
  assert.equal(await withAuthorityGitReadSession({ cwd: root }, async () => undefined), undefined);
  const value = { result: 'preserved' };
  assert.equal(await withAuthorityGitReadSession({ cwd: root }, async () => value), value);
}, 'sec-git-caller-result-'), DEFAULT_TEST_TIMEOUT_MS);

test('native multi-phase scope cannot erase its outer null or undefined failure', () => withTempWorkspace(async root => {
  for (const reason of [undefined, null]) {
    const budget = resolveGitReadSessionBudget(undefined);
    let entered = false, failed = false;
    try {
      await withAuthorityGitReadOperation({ cwd: root, budget, deadlineAtUnixMs: Date.now() + budget.deadlineMs }, async () => {
        entered = true; throw reason;
      });
    } catch (error) {
      failed = true; assert.equal(entered, true); assert.ok(Object.is(error, reason));
    }
    assert.equal(failed, true);
  }
}, 'sec-git-scope-rejection-'), DEFAULT_TEST_TIMEOUT_MS);

test('caught phase rejection still prevents native scope success after the phase has settled', () => withTempWorkspace(async root => {
  const budget = resolveGitReadSessionBudget(undefined);
  let entered = false;
  await assert.rejects(withAuthorityGitReadOperation({ cwd: root, budget,
    deadlineAtUnixMs: Date.now() + budget.deadlineMs }, async scope => {
    try { await scope.runPhase('read-only-test-phase', async () => { entered = true; throw undefined; }); }
    catch (error) { assert.equal(entered, true); assert.equal(error, undefined); }
    return 'a caught failure is not a healthy operation';
  }), error => {
    assert.equal(entered, true);
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [undefined]);
    return true;
  });
}, 'sec-git-phase-rejection-'), DEFAULT_TEST_TIMEOUT_MS);

// These cases require the real provider, whose close increments its settlement
// count after joining its admitted commands. No child Git command is necessary.
test('native phase closure is charged to the parent settlement budget', () => withTempWorkspace(async root => {
  const budget = resolveGitReadSessionBudget({ maxSettlementAttempts: 1 });
  let callbacks = 0;
  await assert.rejects(withAuthorityGitReadOperation({ cwd: root, budget,
    deadlineAtUnixMs: Date.now() + budget.deadlineMs }, async scope => {
    await scope.runPhase('first', async () => { callbacks++; });
    await scope.runPhase('second', async () => { callbacks++; });
  }));
  assert.equal(callbacks, 1, 'The second provider must not be opened after the one permitted close');
}, 'sec-git-close-budget-'), DEFAULT_TEST_TIMEOUT_MS);

test('caught native phase failure cannot admit another phase', () => withTempWorkspace(async root => {
  const budget = resolveGitReadSessionBudget(undefined), reason = new Error('first phase');
  let callbacks = 0;
  await assert.rejects(withAuthorityGitReadOperation({ cwd: root, budget,
    deadlineAtUnixMs: Date.now() + budget.deadlineMs }, async scope => {
    try { await scope.runPhase('first', async () => { callbacks++; throw reason; }); }
    catch (error) { assert.equal(error, reason); }
    await scope.runPhase('second', async () => { callbacks++; });
  }), error => error === reason);
  assert.equal(callbacks, 1);
}, 'sec-git-failed-phase-'), DEFAULT_TEST_TIMEOUT_MS);
