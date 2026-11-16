import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  birthAndBindCompilerDependencyGeneration,
  ensureCompilerDependencyPreimageRetiredForRecovery,
  settleRetiredCompilerDependencyGeneration
} from '../../../src/adapters/toolchain/dependencies/runtime/lifecycle-registration.ts';
import { runtimeDependencyOperationControls } from '../../../src/adapters/toolchain/dependencies/runtime/operation-controls.ts';

const physical = () => ({ device: 'device', inode: 'inode-a', objectId: 'object-a' });
const receipt = { registrationDigest: `sha256:${'a'.repeat(64)}` } as never;
function control(clock = () => 0, signal?: AbortSignal) {
  return runtimeDependencyOperationControls({ lockTimeoutMs: 100, monotonicNowMs: clock, signal });
}
const exhausted = (error: unknown) => (error as { code?: string }).code === 'RUNTIME-DEPS-003';

test('deadline exhausted by birth prevents the next bind, without abandoning the birth promise', async () => {
  let now = 0;
  await assert.rejects(birthAndBindCompilerDependencyGeneration({ ...control(() => now), generatedStateLifecycle: {
    async born() { now = 101; }, async bind() { assert.fail('bind after deadline'); }
  } }, '/tmp/stage', physical()), exhausted);
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
  await assert.rejects(ensureCompilerDependencyPreimageRetiredForRecovery(options, physical(), 'recovery', process.cwd()), error => error === reason);
});

test('recovery cannot enter retirement after its binding exhausted the same budget', async () => {
  let now = 0;
  await assert.rejects(ensureCompilerDependencyPreimageRetiredForRecovery({ ...control(() => now), generatedStateLifecycle: {
    async bind() { now = 101; return receipt; }, async retired() { assert.fail('retirement after exhaustion'); }
  } }, physical(), 'recover', process.cwd()), exhausted);
});

test('cancellation during recovery binding is not relabelled as provenance failure', async () => {
  const cancel = new AbortController(), reason = Object.freeze({ abort: 'during-bind' });
  await assert.rejects(ensureCompilerDependencyPreimageRetiredForRecovery({ ...control(() => 0, cancel.signal), generatedStateLifecycle: {
    async bind() { cancel.abort(reason); return receipt; }, async retired() { assert.fail('retired after cancellation'); }
  } }, physical(), 'recover', process.cwd()), error => error === reason);
});

test('completed recovery retirement still rechecks its deadline', async () => {
  let now = 0;
  await assert.rejects(ensureCompilerDependencyPreimageRetiredForRecovery({ ...control(() => now), generatedStateLifecycle: {
    async bind() { return receipt; }, async retired() { now = 101; return receipt; }
  } }, physical(), 'recover', process.cwd()), exhausted);
});

test('a birth operation joins its callback after cancellation and preserves the original non-Error reason', async () => {
  const cancel = new AbortController(), reason = Object.freeze({ abort: 'birth' });
  let finish!: () => void, entered!: () => void;
  const held = new Promise<void>(resolve => { finish = resolve; });
  const begun = new Promise<void>(resolve => { entered = resolve; });
  let settled = false;
  const pending = birthAndBindCompilerDependencyGeneration({ ...control(() => 0, cancel.signal), generatedStateLifecycle: {
    async born() { cancel.abort(reason); entered(); await held; }, async bind() { assert.fail('cancelled bind'); }
  } }, '/tmp/stage', physical()).finally(() => { settled = true; });
  const result = assert.rejects(pending, error => error === reason);
  try { await begun; await Promise.resolve(); assert.equal(settled, false); }
  finally { finish(); }
  await result;
});
