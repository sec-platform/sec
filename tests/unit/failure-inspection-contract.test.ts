import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { getErrorCode as compilerCode, CompilerError, inspectFailureValue as compilerInspect } from '../../src/compiler/errors.ts';
import { failureMessage, getErrorCode, inspectFailureValue } from '../../src/contracts/failure-inspection.ts';

test('compiler consumers retain the exact shared inspection functions', () => {
  assert.equal(compilerCode, getErrorCode);
  assert.equal(compilerInspect, inspectFailureValue);
});

for (const reason of [undefined, null, false, 0, 7n, Symbol('failure'), 'text']) {
  test(`primitive ${String(reason)} has a diagnostic without losing its value`, () => {
    assert.equal(failureMessage(reason), String(reason));
    assert.equal(getErrorCode(reason), undefined);
  });
}

test('ordinary and typed errors retain message and code across the shared inspection boundary', () => {
  const ordinary = new Error('ordinary'), typed = new CompilerError('OWNER-001', 'typed', { path: 'a' });
  assert.equal(failureMessage(ordinary), 'ordinary'); assert.equal(failureMessage(typed), 'typed');
  assert.equal(getErrorCode(typed), 'OWNER-001');
});

test('diagnostic projection invokes neither object conversion, custom inspect nor unrelated getters', () => {
  let calls = 0;
  const value = { toString() { calls++; throw new Error('conversion'); },
    get content() { calls++; throw new Error('getter'); }, [inspect.custom]() { calls++; throw new Error('inspect'); } };
  assert.equal(typeof failureMessage(value), 'string'); assert.equal(typeof inspectFailureValue(value), 'string');
  assert.equal(calls, 0);
});

test('revoked proxy and broken Error.message remain describable', () => {
  const { proxy, revoke } = Proxy.revocable({}, {}); revoke();
  assert.equal(typeof failureMessage(proxy), 'string'); assert.equal(getErrorCode(proxy), undefined);
  const error = new Error('hidden');
  Object.defineProperty(error, 'message', { get() { throw new Error('getter failed'); } });
  assert.equal(typeof failureMessage(error), 'string');
});

test('error codes read once, reject nonstrings, and do not throw through the projection', () => {
  let reads = 0;
  assert.equal(getErrorCode({ get code() { reads++; return 'E-CODE'; } }), 'E-CODE'); assert.equal(reads, 1);
  for (const code of [null, 0, {}, Symbol('code')]) assert.equal(getErrorCode({ code }), undefined);
  assert.equal(getErrorCode({ get code() { throw undefined; } }), undefined);
});

test('native Error accessor fields are never invoked, including when nested', () => {
  let reads = 0;
  const error = new Error('initial');
  for (const key of ['message', 'name', 'stack']) {
    Object.defineProperty(error, key, {
      configurable: true,
      enumerable: true,
      get() { reads++; throw new Error(`read ${key}`); }
    });
  }
  assert.match(failureMessage(error), /Accessor not evaluated/u);
  assert.match(inspectFailureValue({ nested: error }), /Accessor not evaluated/u);
  assert.equal(reads, 0);
});

test('live and revoked proxies reach no traps or renderer', () => {
  let traps = 0;
  const live = new Proxy({}, {
    get() { traps++; throw new Error('get'); },
    ownKeys() { traps++; throw new Error('ownKeys'); },
    getOwnPropertyDescriptor() { traps++; throw new Error('descriptor'); },
    getPrototypeOf() { traps++; throw new Error('prototype'); }
  });
  const { proxy: revoked, revoke } = Proxy.revocable({}, {});
  revoke();
  for (const value of [live, revoked, { nested: live }]) {
    assert.match(inspectFailureValue(value), /Proxy not inspected/u);
    assert.match(failureMessage(value), /Proxy not inspected/u);
  }
  assert.equal(traps, 0);
});

test('presentation keeps own data without inherited constructors or prototype setters', () => {
  let inheritedReads = 0;
  const parent = Object.defineProperty({}, 'constructor', {
    get() { inheritedReads++; throw new Error('constructor'); }
  });
  const value = Object.create(parent) as Record<string, unknown>;
  Object.defineProperty(value, '__proto__', { value: 'retained', enumerable: true });
  value.self = value;
  const rendered = inspectFailureValue(value);
  assert.match(rendered, /__proto__/u);
  assert.match(rendered, /retained/u);
  assert.match(rendered, /Circular reference/u);
  assert.equal(inheritedReads, 0);
});

test('presentation bounds nested, wide and long diagnostic data', () => {
  let deep: Record<string, unknown> = { terminal: 'retained' };
  for (let index = 0; index < 10; index++) deep = { child: deep };
  const wide = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`key${index}`, index]));
  const rendered = inspectFailureValue({ deep, wide, long: 'x'.repeat(10000), exotic: new Map([['a', 1]]) });
  assert.ok(rendered.length <= 4096);
  assert.match(rendered, /Depth limit/u);
  assert.match(rendered, /Key limit/u);
  assert.match(rendered, /truncated/u);
  assert.match(rendered, /Prototype and possible internal details not expanded/u);
});

test('presentation distinguishes marker-named and truncated colliding data keys', () => {
  const common = 'k'.repeat(512);
  const value = Object.create(null) as Record<string, unknown>;
  value['[Key limit]'] = 'user key marker';
  value['[Internal slots]'] = 'user slot marker';
  value[`${common}first`] = 'first long key';
  value[`${common}second`] = 'second long key';
  const rendered = inspectFailureValue(value);
  assert.match(rendered, /user key marker/u);
  assert.match(rendered, /user slot marker/u);
  assert.match(rendered, /first long key/u);
  assert.match(rendered, /second long key/u);
  assert.match(rendered, /key collision 2/u);
});

test('nested native Error inspection never materializes its lazy stack', () => {
  const original = Object.getOwnPropertyDescriptor(Error, 'prepareStackTrace');
  let stackReads = 0;
  try {
    Error.prepareStackTrace = () => { stackReads++; return 'rendered stack'; };
    const error = new Error('lazy original');
    const rendered = inspectFailureValue({ error });
    const observedReads = stackReads;
    assert.equal(observedReads, 0);
    assert.match(rendered, /lazy original/u);
  } finally {
    if (original === undefined) Reflect.deleteProperty(Error, 'prepareStackTrace');
    else Object.defineProperty(Error, 'prepareStackTrace', original);
  }
});
