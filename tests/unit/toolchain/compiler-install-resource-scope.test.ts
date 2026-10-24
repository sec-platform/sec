import { test } from 'bun:test';
import assert from 'node:assert/strict';
import type { RetainedNoFollowChildProcessDirectory, RetainedNoFollowOrdinaryFile } from '../../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import { openProcessResourceSession, type ProcessResourceSession } from '../../../src/adapters/runtime-state/physical/runtime/process-resource-session.ts';
import { CompilerInstallSettlementFailure, withCompilerInstallResources } from '../../../src/adapters/toolchain/dependencies/runtime/install-resource-scope.ts';
import { sha256 } from '../../../src/contracts/canonical.ts';
import { issueOperationRequirementBindingContext } from '../../../src/execution/operation/requirement-binding-context.ts';
import {
  bindSemanticOperation, compileCapabilityBinding, compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext, type OperationDigest
} from '../../../src/execution/operation/semantic.ts';

// Mechanical resources here prove order and failure preservation, not physical
// retention. A successful session receipt comes from the real process owner;
// plain objects are used only in tests that expect close or receipt rejection.
const executable = (dispose: () => void) => ({ dispose }) as RetainedNoFollowOrdinaryFile;
const directory = (dispose: () => void) => ({ dispose }) as RetainedNoFollowChildProcessDirectory;
const fixtureDigest = sha256({ fixture: 'compiler-install-resource-settlement' }) as OperationDigest;
const expectation = () => ({ operationIdentityDigest: fixtureDigest, boundAttemptDigest: fixtureDigest, requirementId: 'test.install' });
function ownedSession(absoluteDeadlineAtUnixMs?: number) {
  const budgets = [
    { resource: 'duration-ms' as const, maximum: 5000 }, { resource: 'input-bytes' as const, maximum: 0 },
    { resource: 'output-bytes' as const, maximum: 1 }, { resource: 'processes' as const, maximum: 1 }
  ];
  const plan = compileSemanticOperationPlan({ operation: 'test.compiler-install-settlement', intentDigest: fixtureDigest,
    decisionDigest: fixtureDigest, deadlineAtUnixMs: Date.now() + 5000,
    attempt: issueSemanticOperationAttemptContext({ authorityGrantDigest: fixtureDigest }),
    aggregateBudgets: budgets, requirements: [{ id: 'test.install', contractDigest: fixtureDigest,
      effectKinds: ['process'], failureKinds: ['process.unavailable'] }] });
  const operation = bindSemanticOperation(plan, [compileCapabilityBinding({ requirementId: 'test.install',
    contractDigest: fixtureDigest, providerIdentityDigest: fixtureDigest })]);
  const session = openProcessResourceSession({ operation, requirementBindingContext: issueOperationRequirementBindingContext({
    operation, requirementId: 'test.install', resourceCeilings: budgets,
    ...(absoluteDeadlineAtUnixMs === undefined ? {} : { absoluteDeadlineAtUnixMs }) }) });
  return { session, expected: { operationIdentityDigest: operation.plan.identity.identityDigest,
    boundAttemptDigest: operation.boundAttemptDigest, requirementId: 'test.install' } };
}

test('an absolute child deadline narrows the operation without renewal at session admission', () => {
  const absoluteDeadlineAtUnixMs = Date.now() + 2_000;
  const { session } = ownedSession(absoluteDeadlineAtUnixMs);
  assert.ok(session.deadlineAtUnixMs <= absoluteDeadlineAtUnixMs);
  session.close();
});

for (const count of [0, 1, 2, 3]) {
  test(`partial acquisition releases exactly the ${count} already acquired resources`, async () => {
    const events: string[] = [], primary = Object.freeze({ acquisition: count });
    let session: ProcessResourceSession | undefined;
    await assert.rejects(withCompilerInstallResources(async resources => {
      if (count >= 1) resources.executable(executable(() => { events.push('executable'); }));
      if (count >= 2) resources.workingDirectory(directory(() => { events.push('working-directory'); }));
      if (count === 3) {
        const owned = ownedSession(); session = owned.session;
        resources.processSession(session, owned.expected);
      }
      throw primary;
    }), reason => reason === primary);
    assert.deepEqual(events, count < 2 ? count === 1 ? ['executable'] : [] : ['working-directory', 'executable']);
    if (session !== undefined) assert.equal(session.signal.aborted, true);
  });
}

for (const primary of [undefined, null, false, 0, 'execution failure']) {
  test(`cleanup preserves ${String(primary)} as a present execution failure`, async () => {
    const closeFailure = new Error('close'), disposeFailure = new Error('dispose'), order: string[] = [];
    await assert.rejects(withCompilerInstallResources(async resources => {
      resources.executable(executable(() => { order.push('exe'); throw disposeFailure; }));
      resources.workingDirectory(directory(() => { order.push('cwd'); }));
      // @ts-expect-error Deliberately malformed session exercises settlement failure preservation.
      resources.processSession({ close() { order.push('session'); throw closeFailure; } }, expectation());
      throw primary;
    }), error => {
      assert.ok(error instanceof CompilerInstallSettlementFailure);
      assert.equal(error.primaryFailed, true); assert.equal(error.cause, primary);
      assert.deepEqual(error.resourceFailures.map(f => f.reason), [closeFailure, disposeFailure]);
      assert.deepEqual(error.resourceFailures.map(f => f.resource), ['process-session', 'executable']);
      assert.ok(Object.isFrozen(error.resourceFailures)); assert.ok(error.resourceFailures.every(Object.isFrozen));
      return true;
    });
    assert.deepEqual(order, ['session', 'cwd', 'exe']);
  });
}

test('successful execution with failed settlement is not returned as success', async () => {
  await assert.rejects(withCompilerInstallResources(async resources => {
    resources.executable(executable(() => { throw undefined; })); return 7;
  }), error => {
    assert.ok(error instanceof CompilerInstallSettlementFailure); assert.equal(error.primaryFailed, false);
    assert.equal(Object.hasOwn(error, 'cause'), false);
    assert.deepEqual(error.resourceFailures, [{ resource: 'executable', reason: undefined }]); return true;
  });
});

test('successful cleanup preserves its result and releases directory then executable without yielding', async () => {
  const order: string[] = [];
  const result = { value: 7 };
  assert.equal(await withCompilerInstallResources(async resources => {
    resources.executable(executable(() => { order.push('exe'); }));
    resources.workingDirectory(directory(() => { order.push('cwd'); queueMicrotask(() => order.push('later')); }));
    return result;
  }), result);
  assert.deepEqual(order, ['cwd', 'exe', 'later']);
});

test('settlement does not stringify hostile thrown values', async () => {
  const value = { toString() { assert.fail('coerced'); } };
  const { proxy, revoke } = Proxy.revocable({}, {}); revoke();
  await assert.rejects(withCompilerInstallResources(async resources => {
    resources.executable(executable(() => { throw proxy; })); throw value;
  }), error => {
    assert.ok(error instanceof CompilerInstallSettlementFailure);
    assert.equal(error.cause, value); assert.equal(error.resourceFailures[0]?.reason, proxy); return true;
  });
});
