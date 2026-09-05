import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { test } from 'bun:test';
import { CompilerError, formatCompilerFailure } from '../../src/compiler/errors.ts';

test('compiler failure formatting preserves existing JSON detail output', () => {
  const details = { path: 'source.ts', line: 7, values: [true, null] };
  const error = new CompilerError('TEST-001', 'primary failure', details);
  assert.equal(formatCompilerFailure(error), `${error.stack}\n${JSON.stringify(details, null, 2)}`);
});

test('circular compiler details cannot erase the primary failure', () => {
  const details: Record<string, unknown> = { name: 'cycle' };
  details.self = details;
  const error = new CompilerError('TEST-002', 'primary cycle failure', details);
  const output = formatCompilerFailure(error);
  assert.ok(output.startsWith(error.stack!));
  assert.match(output, /cycle/u);
  assert.match(output, /Circular/u);
});

test('bigint compiler details remain diagnostic rather than throwing during formatting', () => {
  const error = new CompilerError('TEST-003', 'primary bigint failure', { value: 1n });
  const output = formatCompilerFailure(error);
  assert.ok(output.startsWith(error.stack!));
  assert.match(output, /1n/u);
});

test('failing toJSON cannot replace the primary compiler failure', () => {
  const error = new CompilerError('TEST-004', 'primary toJSON failure', {
    toJSON() { throw new Error('secondary serialization failure'); }, value: 'retained'
  });
  const output = formatCompilerFailure(error);
  assert.ok(output.startsWith(error.stack!));
  assert.match(output, /retained/u);
});

test('diagnostic fallback does not invoke user inspection hooks or metadata getters', () => {
  let reads = 0;
  let inspections = 0;
  const details: Record<PropertyKey, unknown> = { value: 1n };
  Object.defineProperty(details, 'computed', { enumerable: true, get() { reads++; throw new Error('getter'); } });
  details[inspect.custom] = () => { inspections++; throw new Error('inspect hook'); };
  const error = new CompilerError('TEST-005', 'primary fallback failure', details);
  const output = formatCompilerFailure(error);
  assert.ok(output.startsWith(error.stack!));
  assert.equal(reads, 0);
  assert.equal(inspections, 0);
});

test('a thrown null-prototype record can still be formatted', () => {
  const error = Object.assign(Object.create(null), { code: 'THROWN', value: 7 });
  const output = formatCompilerFailure(error);
  assert.match(output, /THROWN/u);
  assert.match(output, /7/u);
});

test('a thrown object with a failing conversion still yields a diagnostic', () => {
  const error = { value: 'retained', toString() { throw new Error('conversion failed'); } };
  const output = formatCompilerFailure(error);
  assert.match(output, /retained/u);
});

test('ordinary errors and primitive throws retain their existing presentation', () => {
  const error = new Error('ordinary');
  assert.equal(formatCompilerFailure(error), error.stack);
  for (const value of [undefined, null, false, 0, 7n, 'text', Symbol('symbol')]) {
    assert.equal(formatCompilerFailure(value), String(value));
  }
});

test('a revoked thrown proxy cannot break diagnostic formatting', () => {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  assert.equal(typeof formatCompilerFailure(proxy), 'string');
});

test('unreadable details preserve the primary error instead of re-reading the accessor', () => {
  const error = new CompilerError('TEST-006', 'primary details access failure');
  const primary = error.stack!;
  let reads = 0;
  Object.defineProperty(error, 'details', { get() { reads++; throw new Error('details unavailable'); } });
  const output = formatCompilerFailure(error);
  assert.ok(output.startsWith(primary));
  assert.equal(reads, 1);
});

test('fallback formats the captured details rather than replacement carrier metadata', () => {
  const error = new CompilerError('TEST-007', 'primary captured-details failure');
  const details = {
    original: 'retained',
    toJSON() {
      Object.defineProperty(error, 'details', { value: { replacement: 'wrong' } });
      throw new Error('serialization failed');
    }
  };
  Object.defineProperty(error, 'details', { value: details, configurable: true });
  const output = formatCompilerFailure(error);
  assert.match(output, /original: 'retained'/u);
  assert.doesNotMatch(output, /replacement: 'wrong'/u);
});

test('a throwing Error stack accessor cannot escape the diagnostic boundary', () => {
  const error = new Error('primary unreadable stack');
  Object.defineProperty(error, 'stack', { get() { throw new Error('stack unavailable'); } });
  assert.equal(typeof formatCompilerFailure(error), 'string');
});

test('malformed runtime Error fields cannot change the formatter return type', () => {
  const error = new Error('runtime field');
  Object.defineProperty(error, 'stack', { value: 7 });
  assert.equal(typeof formatCompilerFailure(error), 'string');
});
