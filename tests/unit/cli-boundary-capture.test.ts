import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { captureCliOptions } from '../../src/interface/cli/own-options.ts';
import { captureJsonOutputInput } from '../../src/interface/cli/json-output-options.ts';
import { parseWorkspaceViewCommandInput } from '../../src/interface/cli/workspace-command-input.ts';
import { formatJson, printJsonOrText } from '../../src/interface/cli/format-utils.ts';

test('property and own-enumerable fields retain explicitly different transport boundaries', () => {
  const input = Object.create({ inherited: true });
  Object.defineProperty(input, 'hidden', { value: 7 });
  input.owned = 9;
  assert.deepEqual({ ...captureCliOptions(input, [{ name: 'inherited', scope: 'property' }, { name: 'hidden', scope: 'property' }]) }, { inherited: true, hidden: 7 });
  assert.deepEqual({ ...captureCliOptions(input, [{ name: 'inherited', scope: 'own-enumerable' }, { name: 'hidden', scope: 'own-enumerable' }, { name: 'owned', scope: 'own-enumerable' }]) }, { inherited: undefined, hidden: undefined, owned: 9 });
});

test('selected capture does not enumerate or inspect unrelated fields, while preserving proxy reads', () => {
  let reads = 0;
  const input = new Proxy({ value: 7, get unrelated() { assert.fail('unowned getter'); } }, {
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
    const raw = new Proxy({ json: true, compact: true, get unused() { assert.fail('unowned'); } }, { ownKeys() { assert.fail('enumerated'); } });
    const inspected = parseWorkspaceViewCommandInput(command, mode, raw);
    const executed = parseWorkspaceViewCommandInput(command, undefined, raw);
    assert.equal(inspected.kind, 'inspect'); assert.equal(executed.kind, 'execute');
    assert.deepEqual(inspected.output, executed.output); assert.ok(Object.isFrozen(inspected));
  }
});

test('no-JSON roots are rejected before output, including a toJSON that returns undefined', () => {
  const log = console.log; let writes = 0; console.log = () => { writes++; };
  try {
    for (const value of [undefined, () => 7, Symbol('value'), { toJSON() { return undefined; } }]) {
      assert.throws(() => printJsonOrText(value, { json: true, compact: true }, () => assert.fail('text')), TypeError);
    }
    assert.equal(writes, 0);
  } finally { console.log = log; }
});

test('circular and bigint JSON failures remain failures, not successful output frames', () => {
  const cycle: unknown[] = []; cycle.push(cycle);
  for (const value of [cycle, 1n]) assert.throws(() => formatJson(value, { compact: false }), TypeError);
});

test('valid JSON output preserves exact standard formatting and lazy text selection', () => {
  for (const value of [null, false, 0, 'text', [], { a: 1, b: [2] }]) {
    for (const compact of [false, true]) assert.equal(formatJson(value, { compact }), JSON.stringify(value, null, compact ? 0 : 2));
  }
  const log = console.log; const lines: unknown[] = []; console.log = v => { lines.push(v); };
  try { printJsonOrText(undefined, { json: false, compact: false }, () => 'text'); assert.deepEqual(lines, ['text']); }
  finally { console.log = log; }
});
