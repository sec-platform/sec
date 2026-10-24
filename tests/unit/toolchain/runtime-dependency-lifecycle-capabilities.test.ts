import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  bindAndRetireCompilerDependencyPreimage,
  bindExistingCompilerDependencyGeneration, bindExistingLegacySharedDependencyRoot,
  birthAndBindCompilerDependencyGeneration,
  ensureCompilerDependencyPreimageRetiredForRecovery,
  settleRetiredCompilerDependencyGeneration
} from '../../../src/adapters/toolchain/dependencies/runtime/lifecycle-registration.ts';
import { runtimeDependencyOperationOptions } from '../../../src/adapters/toolchain/dependencies/runtime/operation-context.ts';
import { CodedFailure } from '../../../src/contracts/failure.ts';
import { captureRuntimeDependencyLifecycle as capture, type RuntimeDependencyGeneratedStateLifecycle } from "../../../src/execution/generated-state/dependency-lifecycle.ts";

const physical = Object.freeze({ device: 'dev', inode: 'inode', objectId: 'object' });
const digest = `sha256:${'2'.repeat(64)}` as const;
const registration = { registrationDigest: digest } as Awaited<ReturnType<NonNullable<RuntimeDependencyGeneratedStateLifecycle['bind']>>>;
const authority = (error: unknown) => (error as { code: string }).code === 'IMPORT-AUTHORITY-004';

function bound(lifecycle: unknown, beforeCommit = async () => {}) {
  return runtimeDependencyOperationOptions({ lockTimeoutMs: 1000, generatedStateLifecycle: lifecycle as RuntimeDependencyGeneratedStateLifecycle, beforeCommit });
}

for (const [adopt, expectedPath, expectedIdentity] of [
  [bindExistingCompilerDependencyGeneration, 'node_modules', {
    owner: 'compiler-dependency-runtime', producer: 'ensure-compiler-deps-ready', ruleId: 'compiler-node-modules'
  }],
  [bindExistingLegacySharedDependencyRoot, '.shared-deps', {
    owner: 'project-runtime', producer: 'ensure-shared-deps-ready', ruleId: 'shared-dependency-cache'
  }]
] as const) {
  test(`${adopt.name} captures identity before read-only bind and preserves its private-field receiver`, async () => {
    const expected = { device: 'dev', inode: 'inode', objectId: 'object' };
    class Provider {
      #calls = 0;
      get bind() { expected.inode = 'replacement'; return this.selectedBind; }
      async selectedBind(path: string, expectation?: { physical?: { inode: string } }) {
        this.#calls++;
        assert.equal(path, expectedPath);
        assert.deepEqual(expectation, { ...expectedIdentity,
          physical: { device: 'dev', inode: 'inode', objectId: 'object' } });
        return registration;
      }
      get retired() { assert.fail('read-only consumer acquired retirement'); throw new Error('unreachable'); }
      get disposed() { assert.fail('read-only consumer acquired disposal'); throw new Error('unreachable'); }
      calls() { return this.#calls; }
    }
    const provider = new Provider();
    await adopt({ generatedStateLifecycle: provider }, expected);
    assert.equal(provider.calls(), 1);
  });
}

test('capability capture snapshots selected methods without enumerating its provider or unrelated fields', async () => {
  let reads = 0;
  const provider = new Proxy({ get bind() { reads++; return async () => registration; },
    get disposed() { assert.fail('unused capability read'); throw new Error('unreachable'); } }, { ownKeys() { assert.fail('provider enumerated'); } });
  const input = { generatedStateLifecycle: provider, get testMaterialization() { assert.fail('unrelated options'); throw new Error('unreachable'); } };
  const view = capture(input, ['bind', 'bind']);
  assert.equal(reads, 1); assert.deepEqual(Object.keys(view!), ['bind']); assert.ok(Object.isFrozen(view));
  assert.equal('disposed' in view!, false);
  Object.defineProperty(provider, 'bind', { value: async () => assert.fail('replacement method used') });
  assert.equal(await view!.bind!('node_modules'), registration);
});

test('birth preflights the complete selected capability pair before any fence or birth', async () => {
  const events: string[] = [];
  await assert.rejects(birthAndBindCompilerDependencyGeneration(bound({ born: async () => { events.push('born'); } },
    async () => { events.push('fence'); }), '/stage/a', physical), authority);
  assert.deepEqual(events, []);
});

test('birth retains its identity and methods through fence and birth callback mutation', async () => {
  const events: string[] = [];
  const expected = { device: 'dev', inode: 'inode', objectId: 'object' };
  const source = {
    async born(path: string, operationId: string) {
      assert.equal(this, source); assert.equal(operationId, 'compiler-node-modules:a');
      expected.inode = 'born-replaced'; events.push(`born:${path}`);
      source.bind = async () => assert.fail('changed after birth');
    },
    async bind(path: string, expectation?: { physical?: { inode: string } }) {
      assert.equal(this, source); assert.equal(expectation!.physical!.inode, 'inode');
      events.push(`bind:${path}`); return registration;
    }
  };
  const options = bound(source, async () => {
    expected.inode = 'fence-replaced'; events.push('fence');
    source.bind = async () => assert.fail('changed in fence');
  });
  await birthAndBindCompilerDependencyGeneration(options, '/stage/a', expected);
  assert.deepEqual(events, ['fence', 'born:node_modules', 'bind:node_modules']);
});

test('settlement snapshots its method and physical identity before the operation fence', async () => {
  const events: string[] = [];
  const expected = { device: 'dev', inode: 'inode', objectId: 'object' };
  const source = { async settleRetired(path: string, expectation?: { physical?: { objectId: string } }) {
    assert.equal(this, source); assert.equal(expectation!.physical!.objectId, 'object');
    events.push(path); return true;
  } };
  await settleRetiredCompilerDependencyGeneration(bound(source, async () => {
    expected.objectId = 'other'; source.settleRetired = async () => assert.fail('replaced');
  }), expected);
  assert.deepEqual(events, ['node_modules']);
});

test('retirement owns its immutable identity and selected methods and returns the exact receipt digest', async () => {
  const events: string[] = [];
  const expected = { device: 'dev', inode: 'inode', objectId: 'object' };
  const source = {
    async bind(_path: string, expectation?: { physical?: { inode: string } }) {
      assert.equal(this, source);
      assert.equal(Reflect.set(expectation!.physical!, 'inode', 'other'), false);
      assert.equal(expected.inode, 'inode');
      events.push('bind'); source.retired = async () => assert.fail('late retirement'); return registration;
    },
    async retired(path: string, outcome: string) { assert.equal(this, source); events.push(`${path}:${outcome}`); return registration; }
  };
  assert.equal(await bindAndRetireCompilerDependencyPreimage({ generatedStateLifecycle: source }, expected, 'replace'), digest);
  assert.deepEqual(events, ['bind', 'node_modules:replace']);
});

test('missing required lifecycle methods reject before their selected effects', async () => {
  let calls = 0;
  await assert.rejects(bindAndRetireCompilerDependencyPreimage({ generatedStateLifecycle: {
    bind: async () => { calls++; return registration; }
  } } as never, physical, 'replace'), authority);
  assert.equal(calls, 0);
  await assert.rejects(bindExistingCompilerDependencyGeneration({ generatedStateLifecycle: {} }, physical), authority);
});

test('recovery without an observation capability uses the same captured retirement path', async () => {
  const events: string[] = [];
  const source = { bind: async () => { events.push('bind'); return registration; },
    retired: async () => { events.push('retire'); } };
  await ensureCompilerDependencyPreimageRetiredForRecovery({ generatedStateLifecycle: source }, physical, 'recover', process.cwd());
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

test('absent optional lifecycle reads neither physical identity nor stage and executes no fence', async () => {
  let fences = 0;
  const expected = { get device(): never { assert.fail('unused identity read'); throw new Error('unreachable'); }, inode: 'inode', objectId: 'object' };
  const options = bound(undefined, async () => { fences++; });
  await settleRetiredCompilerDependencyGeneration(options, expected);
  await birthAndBindCompilerDependencyGeneration(options, undefined as never, expected);
  assert.equal(fences, 0);
});

for (const failure of [null, undefined, 'plain failure', new Error('owner failed')]) {
  test(`adoption retains the original ${typeof failure} cause in its typed failure`, async () => {
    await assert.rejects(bindExistingLegacySharedDependencyRoot({ generatedStateLifecycle: {
      bind: async () => { throw failure; }
    } }, physical), (error: unknown) => {
      assert.equal(authority(error), true);
      assert.equal((error as Error).cause, failure);
      if (failure instanceof Error) assert.deepEqual((error as CodedFailure).details, { cause: 'owner failed' });
      return true;
    });
  });
}

test('hostile failure values do not replace a lifecycle domain failure', async () => {
  const { proxy, revoke } = Proxy.revocable({}, {}); revoke();
  await assert.rejects(bindAndRetireCompilerDependencyPreimage({ generatedStateLifecycle: {
    bind: async () => { throw proxy; }, retired: async () => assert.fail('retirement after failed binding')
  } }, physical, 'replace'), (error: unknown) => authority(error) && (error as Error).cause === proxy);
});

test('an existing typed retirement blocker is preserved without wrapping', async () => {
  const failure = new CodedFailure('IMPORT-AUTHORITY-004', 'owned failure');
  await assert.rejects(bindAndRetireCompilerDependencyPreimage({ generatedStateLifecycle: {
    bind: async () => { throw failure; }, retired: async () => {}
  } }, physical, 'replace'), (error) => error === failure);
});
