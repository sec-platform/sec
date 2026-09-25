import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { captureRuntimeDependencyLifecycle as capture, type RuntimeDependencyGeneratedStateLifecycle } from '../../src/adapters/toolchain/dependencies/runtime/lifecycle-capabilities.ts';
import {
  bindAndRetireCompilerDependencyPreimage,
  bindExistingCompilerDependencyGeneration,
  birthAndBindCompilerDependencyGeneration,
  ensureCompilerDependencyPreimageRetiredForRecovery,
  settleRetiredCompilerDependencyGeneration
} from '../../src/adapters/toolchain/dependencies/runtime/lifecycle-registration.ts';
import { runtimeDependencyOperationOptions } from '../../src/adapters/toolchain/dependencies/runtime/operation-context.ts';
import { FailureError } from '../../src/contracts/failure.ts';

const physical = Object.freeze({ device: 'dev', inode: 'inode', objectId: 'object' });
const digest = `sha256:${'2'.repeat(64)}` as const;
const registration = { registrationDigest: digest } as Awaited<ReturnType<NonNullable<RuntimeDependencyGeneratedStateLifecycle['bind']>>>;
const authority = (error: unknown) => (error as { code: string }).code === 'IMPORT-AUTHORITY-004';

function bound(lifecycle: unknown, beforeCommit = async () => {}) {
  return runtimeDependencyOperationOptions({ lockTimeoutMs: 1000, generatedStateLifecycle: lifecycle as RuntimeDependencyGeneratedStateLifecycle, beforeCommit });
}

for (const adopt of [bindExistingCompilerDependencyGeneration]) {
  test(`${adopt.name} captures only read-only bind and preserves a private-field receiver`, async () => {
    class Provider {
      #calls = 0;
      async bind(_path: string, expected: unknown) { this.#calls++; assert.ok(expected); return registration; }
      get retired() { assert.fail('read-only consumer acquired retirement'); throw new Error('unreachable'); }
      get disposed() { assert.fail('read-only consumer acquired disposal'); throw new Error('unreachable'); }
      calls() { return this.#calls; }
    }
    const provider = new Provider();
    await adopt({ generatedStateLifecycle: provider }, physical);
    assert.equal(provider.calls(), 1);
  });
}

test('capability capture never enumerates its provider or unrelated installation fields', () => {
  let reads = 0;
  const provider = new Proxy({ get bind() { reads++; return async () => registration; },
    get disposed() { assert.fail('unused capability read'); throw new Error('unreachable'); } }, { ownKeys() { assert.fail('provider enumerated'); } });
  const input = { generatedStateLifecycle: provider, get testMaterialization() { assert.fail('unrelated options'); throw new Error('unreachable'); } };
  const view = capture(input, ['bind', 'bind']);
  assert.equal(reads, 1); assert.deepEqual(Object.keys(view!), ['bind']); assert.ok(Object.isFrozen(view));
  assert.equal('disposed' in view!, false);
});

test('a captured method has no dependency on its mutable public bind property', async () => {
  class Provider { #value = registration; async bind() { return this.#value; } }
  const provider = new Provider();
  const view = capture({ generatedStateLifecycle: provider }, ['bind'])!;
  provider.bind = async () => assert.fail('replacement method used');
  assert.equal(await view.bind!('node_modules'), registration);
});

test('birth preflights the complete selected capability pair before any fence or birth', async () => {
  const events: string[] = [];
  await assert.rejects(birthAndBindCompilerDependencyGeneration(bound({ born: async () => { events.push('born'); } },
    async () => { events.push('fence'); }), '/stage/a', physical), authority);
  assert.deepEqual(events, []);
});

test('birth retains its initial bind through fence and birth method replacement', async () => {
  const events: string[] = [];
  const source = {
    async born(path: string) { assert.equal(this, source); events.push(`born:${path}`); source.bind = async () => assert.fail('changed after birth'); },
    async bind(path: string) { assert.equal(this, source); events.push(`bind:${path}`); return registration; }
  };
  const options = bound(source, async () => { events.push('fence'); source.bind = async () => assert.fail('changed in fence'); });
  await birthAndBindCompilerDependencyGeneration(options, '/stage/a', physical);
  assert.deepEqual(events, ['fence', 'born:node_modules', 'bind:node_modules']);
});

test('settlement snapshots its own method before the operation fence', async () => {
  const events: string[] = [];
  const source = { async settleRetired(path: string) { assert.equal(this, source); events.push(path); return true; } };
  await settleRetiredCompilerDependencyGeneration(bound(source, async () => { source.settleRetired = async () => assert.fail('replaced'); }), physical);
  assert.deepEqual(events, ['node_modules']);
});

test('retirement snapshots bind and retire together and returns the exact receipt digest', async () => {
  const events: string[] = [];
  const source = {
    async bind() { assert.equal(this, source); events.push('bind'); source.retired = async () => assert.fail('late retirement'); return registration; },
    async retired(path: string, outcome: string) { assert.equal(this, source); events.push(`${path}:${outcome}`); return registration; }
  };
  assert.equal(await bindAndRetireCompilerDependencyPreimage({ generatedStateLifecycle: source }, physical, 'replace'), digest);
  assert.deepEqual(events, ['bind', 'node_modules:replace']);
});

test('missing retirement is rejected before binding or retiring a preimage', async () => {
  let calls = 0;
  await assert.rejects(bindAndRetireCompilerDependencyPreimage({ generatedStateLifecycle: {
    bind: async () => { calls++; return registration; }
  } } as never, physical, 'replace'), authority);
  assert.equal(calls, 0);
});

test('recovery without an observation capability uses the same captured retirement path', async () => {
  const events: string[] = [];
  const source = { bind: async () => { events.push('bind'); return registration; },
    retired: async () => { events.push('retire'); } };
  await ensureCompilerDependencyPreimageRetiredForRecovery({ generatedStateLifecycle: source }, physical, 'recover');
  assert.deepEqual(events, ['bind', 'retire']);
});

for (const value of [null, true, 7, 'lifecycle']) {
  test(`non-capability provider ${typeof value} is rejected at capture`, () => {
    assert.throws(() => capture({ generatedStateLifecycle: value as never }, ['bind']), authority);
  });
}

for (const value of [null, false, 1, 'bind', {}]) {
  test(`selected method ${typeof value} must be callable before effects`, () => {
    assert.throws(() => capture({ generatedStateLifecycle: { bind: value as never } }, ['bind']), authority);
  });
}

test('absent optional lifecycle does not acquire or execute a fence', async () => {
  let fences = 0;
  const options = bound(undefined, async () => { fences++; });
  await settleRetiredCompilerDependencyGeneration(options);
  await birthAndBindCompilerDependencyGeneration(options, '/stage/a', physical);
  assert.equal(fences, 0);
});

for (const failure of [null, undefined, 'plain failure', new Error('owner failed')]) {
  test(`adoption retains the original ${typeof failure} cause in its typed failure`, async () => {
    await assert.rejects(bindExistingCompilerDependencyGeneration({ generatedStateLifecycle: {
      bind: async () => { throw failure; }
    } }, physical), (error: unknown) => authority(error) && (error as Error).cause === failure);
  });
}

test('hostile failure values do not replace a lifecycle domain failure', async () => {
  const { proxy, revoke } = Proxy.revocable({}, {}); revoke();
  await assert.rejects(bindAndRetireCompilerDependencyPreimage({ generatedStateLifecycle: {
    bind: async () => { throw proxy; }, retired: async () => assert.fail('retirement after failed binding')
  } }, physical, 'replace'), (error: unknown) => authority(error) && (error as Error).cause === proxy);
});

test('an existing typed retirement blocker is preserved without wrapping', async () => {
  const failure = new FailureError('IMPORT-AUTHORITY-004', 'owned failure');
  await assert.rejects(bindAndRetireCompilerDependencyPreimage({ generatedStateLifecycle: {
    bind: async () => { throw failure; }, retired: async () => {}
  } }, physical, 'replace'), (error) => error === failure);
});
