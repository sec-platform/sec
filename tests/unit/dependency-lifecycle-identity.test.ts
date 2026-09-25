import { test } from 'bun:test';
import assert from 'node:assert/strict';
import type { RuntimeDependencyGeneratedStateLifecycle } from '../../src/adapters/toolchain/dependencies/runtime/lifecycle-capabilities.ts';
import {
  bindAndRetireCompilerDependencyPreimage,
  bindExistingCompilerDependencyGeneration, birthAndBindCompilerDependencyGeneration,
  compilerDependencyGenerationLifecycleExpectation, compilerDependencyStagingLifecycleExpectation,
  ensureCompilerDependencyPreimageRetiredForRecovery,
  settleRetiredCompilerDependencyGeneration
} from '../../src/adapters/toolchain/dependencies/runtime/lifecycle-registration.ts';
import { runtimeDependencyOperationControls } from '../../src/adapters/toolchain/dependencies/runtime/operation-controls.ts';

const physical = () => ({ device: 'device', inode: 'inode-a', objectId: 'object-a' });
const receipt = { registrationDigest: `sha256:${'a'.repeat(64)}` } as never;
function control(clock = () => 0, signal?: AbortSignal) {
  return runtimeDependencyOperationControls({ lockTimeoutMs: 100, monotonicNowMs: clock, signal });
}
const exhausted = (error: unknown) => (error as { code?: string }).code === 'RUNTIME-DEPS-003';

for (const expectation of [compilerDependencyGenerationLifecycleExpectation, compilerDependencyStagingLifecycleExpectation]) {
  test(`${expectation.name} owns its physical value rather than aliasing the caller`, () => {
    const source = physical(), expected = expectation(source);
    assert.notEqual(expected.physical, source);
    source.inode = 'later';
    assert.equal(expected.physical!.inode, 'inode-a');
    assert.ok(Object.isFrozen(expected.physical));
    assert.equal(Reflect.set(expected.physical!, 'inode', 'provider-mutation'), false);
    assert.equal(Object.isFrozen(source), false);
  });
}

for (const adopt of [bindExistingCompilerDependencyGeneration]) {
  test(`${adopt.name} is bound to the expected identity before method getters run`, async () => {
    const expected = physical();
    const generatedStateLifecycle: Pick<RuntimeDependencyGeneratedStateLifecycle, 'bind'> = { get bind(): NonNullable<RuntimeDependencyGeneratedStateLifecycle['bind']> {
      expected.inode = 'replacement';
      return async (_path, expectation) => { assert.equal(expectation!.physical!.inode, 'inode-a'); return receipt; };
    } };
    await adopt({ generatedStateLifecycle }, expected);
  });
}

test('birth fence and birth callback cannot retarget the later binding', async () => {
  const expected = physical();
  const events: string[] = [];
  await birthAndBindCompilerDependencyGeneration({ ...control(),
    async beforeCommit() { expected.inode = 'fence-replaced'; events.push('fence'); },
    generatedStateLifecycle: {
      async born(_path, id) { assert.equal(id, 'compiler-node-modules:stage'); expected.inode = 'born-replaced'; events.push('born'); },
      async bind(_path, expectation) { assert.equal(expectation!.physical!.inode, 'inode-a'); events.push('bind'); return receipt; }
    }
  }, '/tmp/stage', expected);
  assert.deepEqual(events, ['fence', 'born', 'bind']);
});

test('retired settlement observes its originally selected physical generation', async () => {
  const expected = physical();
  await settleRetiredCompilerDependencyGeneration({ ...control(), async beforeCommit() { expected.objectId = 'other'; },
    generatedStateLifecycle: { async settleRetired(_path, expectation) {
      assert.equal(expectation!.physical!.objectId, 'object-a'); return true;
    } }
  }, expected);
});

test('retirement receives an immutable expectation and preserves the original physical object', async () => {
  const expected = physical();
  const result = await bindAndRetireCompilerDependencyPreimage({ generatedStateLifecycle: {
    async bind(_path, expectation) {
      assert.equal(Reflect.set(expectation!.physical!, 'inode', 'other'), false);
      assert.equal(expected.inode, 'inode-a'); return receipt;
    }, async retired() { return receipt; }
  } }, expected, 'replace');
  assert.equal(result, (receipt as { registrationDigest: string }).registrationDigest);
});

test('optional absence stays a no-op without reading a physical identity or stage label', async () => {
  const expected = { get device(): never { assert.fail('unused identity read'); throw new Error('unreachable'); }, inode: 'inode', objectId: 'object' };
  const options = { ...control(), async beforeCommit() { assert.fail('unused fence'); } };
  await birthAndBindCompilerDependencyGeneration(options, undefined as never, expected);
  await settleRetiredCompilerDependencyGeneration(options, expected);
});

test('deadline exhausted by birth prevents the next bind, without abandoning the birth promise', async () => {
  let now = 0;
  await assert.rejects(birthAndBindCompilerDependencyGeneration({ ...control(() => now), generatedStateLifecycle: {
    async born() { now = 101; }, async bind() { assert.fail('bind after deadline'); }
  } }, '/tmp/stage', physical()), exhausted);
});

test('cancellation in birth remains its original value and prevents binding', async () => {
  const cancel = new AbortController(), reason = Object.freeze({ abort: 'birth' });
  await assert.rejects(birthAndBindCompilerDependencyGeneration({ ...control(() => 0, cancel.signal), generatedStateLifecycle: {
    async born() { cancel.abort(reason); }, async bind() { assert.fail('bind after abort'); }
  } }, '/tmp/stage', physical()), error => error === reason);
});

test('settlement cannot report success after exceeding its own operation deadline', async () => {
  let now = 0;
  await assert.rejects(settleRetiredCompilerDependencyGeneration({ ...control(() => now), generatedStateLifecycle: {
    async settleRetired() { now = 101; return true; }
  } }, physical()), exhausted);
});

test('recovery without an observer still refuses already-cancelled work', async () => {
  const cancel = new AbortController(), reason = Object.freeze({ abort: 'before-recovery' });
  const options = { ...control(() => 0, cancel.signal), generatedStateLifecycle: {
    async bind() { assert.fail('cancelled bind'); }, async retired() { assert.fail('cancelled retire'); }
  } };
  cancel.abort(reason);
  await assert.rejects(ensureCompilerDependencyPreimageRetiredForRecovery(options, physical(), 'recovery'), error => error === reason);
});

test('recovery cannot enter retirement after its binding exhausted the same budget', async () => {
  let now = 0;
  await assert.rejects(ensureCompilerDependencyPreimageRetiredForRecovery({ ...control(() => now), generatedStateLifecycle: {
    async bind() { now = 101; return receipt; }, async retired() { assert.fail('retirement after exhaustion'); }
  } }, physical(), 'recover'), exhausted);
});

test('cancellation during recovery binding is not relabelled as provenance failure', async () => {
  const cancel = new AbortController(), reason = Object.freeze({ abort: 'during-bind' });
  await assert.rejects(ensureCompilerDependencyPreimageRetiredForRecovery({ ...control(() => 0, cancel.signal), generatedStateLifecycle: {
    async bind() { cancel.abort(reason); return receipt; }, async retired() { assert.fail('retired after cancellation'); }
  } }, physical(), 'recover'), error => error === reason);
});

test('completed recovery retirement still rechecks its deadline', async () => {
  let now = 0;
  await assert.rejects(ensureCompilerDependencyPreimageRetiredForRecovery({ ...control(() => now), generatedStateLifecycle: {
    async bind() { return receipt; }, async retired() { now = 101; return receipt; }
  } }, physical(), 'recover'), exhausted);
});

test('a birth operation is joined rather than abandoned when its signal cancels', async () => {
  const cancel = new AbortController(), reason = new Error('cancel');
  let finish!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { finish = resolve; });
  const begun = new Promise<void>(resolve => { entered = resolve; });
  let settled = false;
  const pending = birthAndBindCompilerDependencyGeneration({ ...control(() => 0, cancel.signal), generatedStateLifecycle: {
    async born() { entered(); await held; }, async bind() { assert.fail('cancelled bind'); }
  } }, '/tmp/stage', physical()).finally(() => { settled = true; });
  const result = assert.rejects(pending, error => error === reason);
  try { await begun; cancel.abort(reason); await Promise.resolve(); assert.equal(settled, false); }
  finally { finish(); }
  await result;
});
