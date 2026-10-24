import { test } from 'bun:test';
import assert from 'node:assert/strict';

import { createAuthorWorkspace, readAuthorCandidate } from '../../../src/workspace/author-candidate.ts';

test('author capture detaches source without freezing caller-owned values', () => {
  const source = { label: 'initial', nested: { value: 1 } };
  const workspace = createAuthorWorkspace(source);
  source.label = 'caller edit';
  source.nested.value = 2;
  Reflect.set(workspace.initial.content.nested, 'value', 99);
  assert.deepEqual(workspace.read(workspace.initial), { label: 'initial', nested: { value: 1 } });
});

test('forks preserve independent branches and earlier captured values', () => {
  const workspace = createAuthorWorkspace({ value: 1 });
  const draft = { value: 2 };
  const edited = workspace.fork(workspace.initial, draft);
  const sibling = workspace.fork(workspace.initial, { value: 3 });
  const next = workspace.fork(edited, { value: 4 });
  draft.value = 99;
  assert.equal(edited.parentRevision, workspace.initial.revision);
  assert.equal(sibling.parentRevision, workspace.initial.revision);
  assert.equal(next.parentRevision, edited.revision);
  assert.notEqual(sibling.revision, edited.revision);
  assert.deepEqual([workspace.initial, edited, sibling, next].map(candidate => workspace.read(candidate)),
    [{ value: 1 }, { value: 2 }, { value: 3 }, { value: 4 }]);
});

test('candidate-looking copies are rejected and workspace ownership is enforced', () => {
  const left = createAuthorWorkspace({ value: 1 });
  const right = createAuthorWorkspace({ value: 2 });
  assert.throws(() => readAuthorCandidate({ ...left.initial }), { code: 'AUTHOR-CANDIDATE-002' });
  assert.throws(() => left.read(right.initial), { code: 'AUTHOR-CANDIDATE-003' });
  assert.throws(() => left.fork(right.initial, { value: 3 }), { code: 'AUTHOR-CANDIDATE-003' });
  assert.throws(() => left.planSave(left.initial, right.initial), { code: 'AUTHOR-CANDIDATE-003' });
  assert.throws(() => left.planSave(right.initial, left.initial), { code: 'AUTHOR-CANDIDATE-003' });
  // A query can consume an actually issued candidate without claiming to be
  // its workspace owner. Read access is not authority to fork or save it.
  assert.deepEqual(readAuthorCandidate(right.initial), { value: 2 });
});

test('save planning selects before and after without promoting a mutable saved head', () => {
  const workspace = createAuthorWorkspace({ value: 1 });
  const edited = workspace.fork(workspace.initial, { value: 2 });
  const plan = workspace.planSave(workspace.initial, edited);
  assert.equal(plan.expected, workspace.initial);
  assert.equal(plan.candidate, edited);
  assert.deepEqual(plan.before, { value: 1 });
  assert.deepEqual(plan.after, { value: 2 });
  assert.deepEqual(workspace.read(workspace.initial), { value: 1 });
});
