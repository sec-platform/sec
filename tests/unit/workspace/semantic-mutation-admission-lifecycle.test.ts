import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  executeSemanticMutationApplyAdmission,
  prepareSemanticMutationApply,
  rejectSemanticMutationWorkspaceWriterAdmission,
  type SemanticMutationApplyAdmissionOperations
} from '../../../src/application/semantic-mutation-apply.ts';
import { ResourceCompositeSettlementError } from '../../../src/execution/resource-settlement.ts';
import { readyTransactionFixture } from '../../helpers/semantic-mutation-recovery-fixture.ts';

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

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}

test('invalid requests never read authorization or base, acquire a writer, or execute effects', async () => {
  let reads = 0;
  const result = await executeSemanticMutationApplyAdmission({
    ...input, request: { ...input.request, requestId: '' },
    get authorization(): never { reads++; throw new Error('not an admitted request'); },
    get base(): never { reads++; throw new Error('not an admitted request'); }
  }, {
    acquire: async () => assert.fail('writer must not be acquired'),
    isWriterAdmissionFailure: () => assert.fail('classification must not run'),
    execute: async () => assert.fail('effects must not execute')
  });
  assert.equal(result.status, 'request-rejected');
  assert.equal(reads, 0);
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

test('body and writer-release failures retain both exact reasons in occurrence order', async () => {
  const primary = undefined;
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

test('normal completion preserves the exact admitted lease and result while awaiting release', async () => {
  const started = deferred(), held = deferred();
  const lease = Object.freeze({ owned: true });
  let releases = 0;
  let returned = false;
  const handle = { lease, async release() { releases++; started.resolve(); await held.promise; } };
  const operations: SemanticMutationApplyAdmissionOperations<typeof lease> = {
    acquire: async () => handle,
    isWriterAdmissionFailure: () => false,
    execute: async (prepared, actualLease) => {
      assert.equal(actualLease, lease);
      assert.deepEqual(prepared.input, input);
      assert.notEqual(prepared.input, input);
      assert.equal(releases, 0);
      return outcome;
    }
  };
  const run = executeSemanticMutationApplyAdmission(input, operations)
    .then(result => { returned = true; return result; });
  try { await started.promise; assert.equal(returned, false); }
  finally { held.resolve(); await run; }
  assert.equal(await run, outcome);
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
