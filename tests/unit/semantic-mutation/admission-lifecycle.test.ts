import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  executePreparedSemanticMutationApply,
  executeSemanticMutationApplyAdmission,
  prepareSemanticMutationApply,
  rejectSemanticMutationWorkspaceWriterAdmission,
  type SemanticMutationApplyAdmissionOperations,
  type SemanticMutationApplyExecutionOperations
} from '../../../src/application/semantic-mutation/apply.ts';
import { ResourceCompositeSettlementError } from '../../../src/execution/resource-settlement.ts';
import { readyTransactionFixture } from '../../helpers/semantic-mutation/recovery-fixture.ts';

const fixture = readyTransactionFixture('request:admission-lifecycle');
const input = {
  request: fixture.request,
  base: fixture.base,
  authorization: fixture.auth,
  expectedPlanRevision: fixture.plan.planRevision
};
const preparation = prepareSemanticMutationApply(input);
assert.equal(preparation.status, 'ready');
if (preparation.status !== 'ready') throw new Error('Expected valid admission fixture');
const outcome = rejectSemanticMutationWorkspaceWriterAdmission(preparation.prepared);

async function rejectsWith(promise: Promise<unknown>, reason: unknown): Promise<void> {
  let rejected = false;
  try { await promise; } catch (actual) { rejected = true; assert.equal(actual, reason); }
  assert.equal(rejected, true);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}

test('invalid requests never acquire a writer or execute effects', async () => {
  const result = await executeSemanticMutationApplyAdmission({
    ...input, request: { ...input.request, requestId: '' }
  }, {
    acquire: async () => assert.fail('writer must not be acquired'),
    isWriterAdmissionFailure: () => assert.fail('classification must not run'),
    execute: async () => assert.fail('effects must not execute')
  });
  assert.equal(result.status, 'request-rejected');
});

test('physical writer refusals retain the application diagnostic without executing effects', async () => {
  const reason = Object.freeze({ busy: true });
  const result = await executeSemanticMutationApplyAdmission(input, {
    acquire: async () => { throw reason; },
    isWriterAdmissionFailure(error) { assert.equal(error, reason); return true; },
    execute: async () => assert.fail('effects must not execute')
  });
  assert.deepEqual(result, outcome);
});

test('unclassified acquisition failures preserve their identity without attempting release', async () => {
  await rejectsWith(executeSemanticMutationApplyAdmission(input, {
    acquire: async () => { throw undefined; },
    isWriterAdmissionFailure: () => false,
    execute: async () => assert.fail('effects must not execute')
  }), undefined);
});

test('successful execution releases the exact handle once and preserves provider receivers and result identity', async () => {
  const lease = Object.freeze({ owned: true });
  class Handle {
    readonly lease = lease;
    #releases = 0;
    async release() { this.#releases++; }
    get releases() { return this.#releases; }
  }
  const handle = new Handle();
  const operations: SemanticMutationApplyAdmissionOperations<typeof lease> = {
    async acquire() { assert.equal(this, operations); return handle; },
    isWriterAdmissionFailure: () => false,
    async execute(prepared, actualLease) {
      assert.equal(this, operations);
      assert.equal(actualLease, lease);
      assert.deepEqual(prepared.input, input);
      assert.notEqual(prepared.input, input);
      assert.equal(handle.releases, 0);
      return outcome;
    }
  };
  assert.equal(await executeSemanticMutationApplyAdmission(input, operations), outcome);
  assert.equal(handle.releases, 1);
});

for (const reason of [undefined, null, false, 0, new Error('body'), Object.freeze({ body: true })]) {
  test(`execution failure of type ${typeof reason} is preserved after successful release`, async () => {
    let releases = 0;
    await rejectsWith(executeSemanticMutationApplyAdmission(input, {
      acquire: async () => ({ lease: 7, async release() { releases++; } }),
      isWriterAdmissionFailure: () => false,
      execute: async () => { throw reason; }
    }), reason);
    assert.equal(releases, 1);
  });
}

for (const primary of [undefined, new Error('body')]) {
  test(`a ${typeof primary} body failure and release failure are both retained in occurrence order`, async () => {
    const cleanup = new Error('release');
    let releases = 0;
    await assert.rejects(executeSemanticMutationApplyAdmission(input, {
      acquire: async () => ({ lease: 7, async release() { releases++; throw cleanup; } }),
      isWriterAdmissionFailure: () => false,
      execute: async () => { throw primary; }
    }), error => {
      assert.ok(error instanceof ResourceCompositeSettlementError);
      assert.deepEqual(error.failures, [
        { label: 'semantic-mutation-apply', error: primary },
        { label: 'workspace-writer-lease', error: cleanup }
      ]);
      assert.deepEqual(error.errors, [primary, cleanup]);
      return true;
    });
    assert.equal(releases, 1);
  });
}

test('release-only failure retains its existing identity and cannot publish normal completion', async () => {
  const reason = Object.freeze({ release: true });
  let releases = 0;
  await rejectsWith(executeSemanticMutationApplyAdmission(input, {
    acquire: async () => ({ lease: 7, async release() { releases++; throw reason; } }),
    isWriterAdmissionFailure: () => false,
    execute: async () => outcome
  }), reason);
  assert.equal(releases, 1);
});

test('normal completion waits for the admitted writer release to settle', async () => {
  const started = deferred(), held = deferred();
  let returned = false;
  const run = executeSemanticMutationApplyAdmission(input, {
    acquire: async () => ({ lease: 7, async release() { started.resolve(); await held.promise; } }),
    isWriterAdmissionFailure: () => false,
    execute: async () => outcome
  }).then(result => { returned = true; return result; });
  try { await started.promise; assert.equal(returned, false); }
  finally { held.resolve(); }
  assert.equal(await run, outcome);
});

test('admission captures execution and failure classification before acquisition suspends', async () => {
  const acquired = deferred(), continueAcquisition = deferred();
  let releases = 0;
  const operations: SemanticMutationApplyAdmissionOperations<number> = {
    async acquire() {
      acquired.resolve();
      await continueAcquisition.promise;
      return { lease: 7, async release() { releases++; } };
    },
    isWriterAdmissionFailure: () => false,
    execute: async () => outcome
  };
  const run = executeSemanticMutationApplyAdmission(input, operations);
  try {
    await acquired.promise;
    operations.execute = async () => assert.fail('replacement execution must not run');
    operations.isWriterAdmissionFailure = () => assert.fail('replacement classifier must not run');
  } finally { continueAcquisition.resolve(); }
  assert.equal(await run, outcome);
  assert.equal(releases, 1);
});

test('an executing consumer cannot replace its admitted release operation', async () => {
  let releases = 0;
  const handle = { lease: 7, async release() { releases++; } };
  assert.equal(await executeSemanticMutationApplyAdmission(input, {
    acquire: async () => handle,
    isWriterAdmissionFailure: () => false,
    async execute() {
      handle.release = async () => assert.fail('replacement release must not run');
      return outcome;
    }
  }), outcome);
  assert.equal(releases, 1);
});

test('lease value access failure still closes the captured release port', async () => {
  let releases = 0;
  await rejectsWith(executeSemanticMutationApplyAdmission(input, {
    acquire: async () => ({
      get lease(): number { throw undefined; },
      async release() { releases++; }
    }),
    isWriterAdmissionFailure: () => false,
    execute: async () => assert.fail('an unreadable lease cannot execute')
  }), undefined);
  assert.equal(releases, 1);
});

test('preparation owns request, authorization and endpoint coordinates without copying the IR', () => {
  const supplied = {
    ...input,
    request: { ...input.request },
    authorization: { ...input.authorization, allowedTargetEntityIds: [...input.authorization.allowedTargetEntityIds] },
    base: { ...input.base }
  };
  const selected = prepareSemanticMutationApply(supplied);
  assert.equal(selected.status, 'ready');
  if (selected.status !== 'ready') throw new Error('Expected captured request');
  supplied.request.requestId = 'request:replacement';
  supplied.expectedPlanRevision = 'replacement';
  supplied.base.inputRevision = 'replacement';
  supplied.authorization.allowedTargetEntityIds.length = 0;
  assert.deepEqual(selected.prepared.input, input);
  assert.equal(selected.prepared.input.base.snapshot, input.base.snapshot);
  assert.ok(Object.isFrozen(selected.prepared.input));
  assert.ok(Object.isFrozen(selected.prepared.input.request));
  assert.ok(Object.isFrozen(selected.prepared.input.authorization.allowedTargetEntityIds));
});

function unusedExecutionPorts(): SemanticMutationApplyExecutionOperations {
  const unused = (): never => assert.fail('unexpected execution port');
  return {
    recover: unused, readRetained: unused, derive: unused, publishRejected: unused,
    verify: unused, issueTransactionId: unused, writeTransactionArtifacts: unused,
    persistPrepared: unused, publishSource: unused, observeCurrentDigest: unused,
    appendAuthoringCommitted: unused, markRecoveryRequired: unused,
    rollbackCommitted: unused, completeCommitted: unused, prune: unused,
    isExecutionBoundaryFailure: unused
  };
}

test('recovery cannot redirect a later transaction operation', async () => {
  const marker = Object.freeze({ original: true });
  const operations = unusedExecutionPorts();
  operations.recover = async () => {
    operations.readRetained = async () => assert.fail('recovery replaced a captured port');
    return { status: 'clean' };
  };
  operations.readRetained = async function() { assert.equal(this, operations); throw marker; };
  await rejectsWith(executePreparedSemanticMutationApply(preparation.prepared, operations), marker);
});

test('optional port access is observed once and invocation ignores Function.call overrides', async () => {
  const marker = Object.freeze({ recovery: true });
  const operations = unusedExecutionPorts();
  let reads = 0;
  operations.recover = async function() { assert.equal(this, operations); throw marker; };
  Object.defineProperty(operations.recover, 'call', {
    value: () => assert.fail('caller-owned Function.call must not be invoked')
  });
  Object.defineProperty(operations, 'afterPrepared', {
    get() { reads++; return () => assert.fail('unreached post-prepare hook'); }
  });
  await rejectsWith(executePreparedSemanticMutationApply(preparation.prepared, operations), marker);
  assert.equal(reads, 1);
});

test('invalid requests do not evaluate authorization or base getters', async () => {
  let reads = 0;
  await executeSemanticMutationApplyAdmission({
    ...input,
    request: { ...input.request, requestId: '' },
    get authorization(): never { reads++; throw new Error('not an admitted request'); },
    get base(): never { reads++; throw new Error('not an admitted request'); }
  }, {
    acquire: async () => assert.fail('invalid request cannot acquire'),
    isWriterAdmissionFailure: () => false,
    execute: async () => assert.fail('invalid request cannot execute')
  });
  assert.equal(reads, 0);
});
