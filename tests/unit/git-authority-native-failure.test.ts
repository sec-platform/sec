import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { withAuthorityGitReadOperation, withAuthorityGitReadSession } from '../../src/adapters/providers/git-read/authority.ts';
import { isolatedGitReadEnvironment, resolveGitReadSessionBudget, type GitReadSession } from '../../src/adapters/providers/git-read/runtime/session.ts';
import { resolveExecutableLocator } from '../../src/adapters/runtime-state/physical/runtime/process.ts';
import { DEFAULT_TEST_TIMEOUT_MS } from '../../src/adapters/self-hosting/development/runner/test-execution-policy.ts';
import { withTempWorkspace } from '../testkit/workspace.ts';

// Real production session issuance and physical closure are required here.
// These cases cannot be certified by replacing the Git/session/receipt owner.
// The callback-only cases need no Git child command or repository mutation:
// the lifecycle itself must close correctly around a supplied caller operation.
test('native Git session closure preserves every actual caller rejection value', () => withTempWorkspace(async root => {
  for (const reason of [undefined, null, false, 0, NaN, new Error('caller')]) {
    let entered = false, failed = false;
    try {
      await withAuthorityGitReadSession({ cwd: root, budget: {} }, async () => { entered = true; throw reason; });
    } catch (error) {
      failed = true;
      assert.equal(entered, true, 'The real provider must have admitted the callback');
      assert.ok(Object.is(error, reason));
    }
    assert.equal(failed, true);
  }
}, 'sec-git-caller-rejection-'), DEFAULT_TEST_TIMEOUT_MS);

test('native Git session closure keeps successful undefined distinct from rejected undefined', () => withTempWorkspace(async root => {
  assert.equal(await withAuthorityGitReadSession({ cwd: root, budget: {} }, async () => undefined), undefined);
  const value = { result: 'preserved' };
  assert.equal(await withAuthorityGitReadSession({ cwd: root, budget: {} }, async () => value), value);
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
  const budget = resolveGitReadSessionBudget({ maxSettlementAttempts: 2 });
  // One phase fence and the final physical close are distinct attempted actions.
  await withAuthorityGitReadOperation({ cwd: root, budget,
    deadlineAtUnixMs: Date.now() + budget.deadlineMs }, scope => scope.runPhase('only', async () => undefined));
  let callbacks = 0;
  await assert.rejects(withAuthorityGitReadOperation({ cwd: root, budget,
    deadlineAtUnixMs: Date.now() + budget.deadlineMs }, async scope => {
    await scope.runPhase('first', async () => { callbacks++; });
    await scope.runPhase('second', async () => { callbacks++; });
  }));
  assert.equal(callbacks, 1, 'The second phase cannot consume the reserved physical close attempt');
  await assert.rejects(withAuthorityGitReadOperation({ cwd: root,
    budget: { ...budget, maxSettlementAttempts: 1 },
    deadlineAtUnixMs: Date.now() + budget.deadlineMs }, scope => scope.runPhase('unaffordable', async () => { callbacks++; })));
  assert.equal(callbacks, 1, 'The first provider cannot open without both settlement attempts');
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

// The exact native image size leaves no unused executable admission bytes.
// Reopening/recharging the executable in phase two is therefore distinguishable
// even on hosts whose installed Git is much smaller than the 64 MiB ceiling.
test('native phases retain one executable reservation through exact-size budget exhaustion', () => withTempWorkspace(async root => {
  const source = { ...process.env };
  const environment = isolatedGitReadEnvironment({}, source);
  const executable = resolveExecutableLocator('git', { pathValue: environment.PATH ?? '', cwd: root });
  assert.notEqual(executable, null);
  const size = statSync(executable!).size;
  const budget = resolveGitReadSessionBudget({ maxExecutableBytes: size });
  const sessions: GitReadSession[] = [];
  const result = await withAuthorityGitReadOperation({ cwd: root, source, budget,
    deadlineAtUnixMs: Date.now() + budget.deadlineMs }, async scope => {
    for (let phase = 0; phase < 5; phase++) {
      await scope.runPhase(`native-${phase}`, async session => {
        sessions.push(session);
        assert.equal(session.executableBytes, phase === 0 ? size : 0);
        assert.equal(session.gitExecutable, executable);
        assert.deepEqual(session.env, environment);
        assert.equal(session.verifyExecutable(), true);
        assert.equal((await session.run(['--version'])).kind, 'completed');
      });
      // Caller-owned source mutation cannot switch the retained provider.
      source.PATH = '';
    }
    return 'all phases settled';
  });
  assert.equal(result, 'all phases settled');
  assert.equal(sessions.reduce((sum, session) => sum + session.executableBytes!, 0), size);
  assert.equal(sessions.reduce((sum, session) => sum + session.processCount, 0), 5);
  for (const session of sessions) {
    assert.equal(session.verifyExecutable(), false);
    const receipt = await session.close!();
    assert.equal(receipt.processCount, 1);
    assert.equal(receipt.processSessionOwnership, 'borrowed');
  }
}, 'sec-git-retained-operation-'), DEFAULT_TEST_TIMEOUT_MS);
