import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { captureJsonOutputInput } from '../../src/entry/cli/json-output-options.ts';
import { captureCliOptions } from '../../src/entry/cli/own-options.ts';
import { parseWorkspaceViewCommandInput } from '../../src/entry/cli/workspace-command-input.ts';

test('property and own-enumerable fields retain explicitly different transport boundaries', () => {
  const input = Object.create({ inherited: true });
  Object.defineProperty(input, 'hidden', { value: 7 });
  input.owned = 9;
  assert.deepEqual({ ...captureCliOptions(input, [{ name: 'inherited', scope: 'property' }, { name: 'hidden', scope: 'property' }]) }, { inherited: true, hidden: 7 });
  assert.deepEqual({ ...captureCliOptions(input, [{ name: 'inherited', scope: 'own-enumerable' }, { name: 'hidden', scope: 'own-enumerable' }, { name: 'owned', scope: 'own-enumerable' }]) }, { inherited: undefined, hidden: undefined, owned: 9 });
});

test('selected capture does not enumerate or inspect unrelated fields, while preserving proxy reads', () => {
  let reads = 0;
  const input = new Proxy({ value: 7, get unrelated() { assert.fail('unowned getter'); throw new Error('unreachable'); } }, {
    ownKeys() { assert.fail('whole options enumeration'); },
    get(target, key, receiver) { if (key === 'value') reads++; return Reflect.get(target, key, receiver); }
  });
  assert.equal(captureCliOptions(input, [{ name: 'value', scope: 'own-enumerable' }]).value, 7);
  assert.equal(reads, 1);
});

test('selected accessors retain the original receiver and are read once', () => {
  let reads = 0;
  const input = { actual: 7, get value() { reads++; assert.equal(this, input); return this.actual; } };
  assert.equal(captureCliOptions(input, [{ name: 'value', scope: 'property' }]).value, 7);
  assert.equal(reads, 1);
});

test('captured data is immutable and detached from later raw property replacement', () => {
  const input = { value: 7 };
  const captured = captureCliOptions(input, [{ name: 'value', scope: 'property' }]);
  input.value = 99;
  assert.equal(captured.value, 7); assert.ok(Object.isFrozen(captured));
  assert.equal(Reflect.set(captured, 'value', 8), false);
});

test('prototype-looking field names remain data without polluting output prototypes', () => {
  const input = Object.assign(Object.create(null), { ['__proto__']: 7 });
  const captured = captureCliOptions(input, [{ name: '__proto__', scope: 'own-enumerable' }]);
  assert.equal(captured.__proto__, 7); assert.equal(Object.getPrototypeOf(captured), null);
});

test('invalid option containers are rejected rather than silently treated as empty input', () => {
  for (const value of [null, undefined, false, 0, '', () => 1]) {
    assert.throws(() => captureCliOptions(value as never, []), TypeError);
  }
});

test('capture preserves sequential getter observations and makes no atomic-snapshot claim', () => {
  const input = { get first() { this.second = 2; return 1; }, second: 0 };
  const captured = captureCliOptions(input, [{ name: 'first', scope: 'property' }, { name: 'second', scope: 'property' }]);
  assert.deepEqual({ ...captured }, { first: 1, second: 2 });
});

test('unsupported mixed command modes cannot fall through into a write request', () => {
  for (const command of ['lock', 'explain'] as const) for (const mode of ['unknown', null, 0, {}, 'constructor']) {
    assert.throws(() => parseWorkspaceViewCommandInput(command, mode, {}), (error: unknown) => (error as {code:string}).code === 'CLI-USAGE-001');
  }
});

test('mixed command output retains the old own-enumerable boundary without whole-object copying', () => {
  const inherited = Object.create({ json: true });
  Object.defineProperty(inherited, 'compact', { value: true });
  assert.deepEqual(parseWorkspaceViewCommandInput('lock', undefined, inherited).output, { json: false, compact: false });
  assert.equal(captureJsonOutputInput(inherited, 'property').json, true);
});

test('mixed read/write command routes expose distinct immutable selections', () => {
  for (const [command, mode] of [['lock', 'inspect'], ['explain', 'graph']] as const) {
    const raw = new Proxy({ json: true, compact: true, get unused() { assert.fail('unowned'); throw new Error('unreachable'); } }, { ownKeys() { assert.fail('enumerated'); } });
    const inspected = parseWorkspaceViewCommandInput(command, mode, raw);
    const executed = parseWorkspaceViewCommandInput(command, undefined, raw);
    assert.equal(inspected.kind, 'inspect'); assert.equal(executed.kind, 'execute');
    assert.deepEqual(inspected.output, executed.output); assert.ok(Object.isFrozen(inspected));
  }
});

