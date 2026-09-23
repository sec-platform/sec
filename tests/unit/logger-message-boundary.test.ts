import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { createLogger } from '../../src/adapters/diagnostics/json-logger.ts';
import { buildJsonLogRecord } from '../../src/contracts/logging.ts';

const invalidMessages: ReadonlyArray<readonly [string, unknown]> = [
  ['undefined', undefined], ['null', null], ['number', 1], ['boolean', false],
  ['bigint', 1n], ['symbol', Symbol('message')], ['function', () => {}],
  ['array', []], ['record', {}], ['boxed string', new String('not primitive')]
];
for (const [name, message] of invalidMessages) {
  test(`rejects a non-string ${name} message before it can replace the canonical msg field`, () => {
    assert.throws(() => buildJsonLogRecord('info', message as never, undefined, 0), (error: unknown) => {
      assert.equal((error as { code: string }).code, 'LOGGING-RECORD-001');
      assert.match((error as Error).message, /message must be a string/);
      return true;
    });
  });
}

test('invalid messages are rejected without coercion, serialization, or metadata access', () => {
  let hooks = 0;
  let metadataReads = 0;
  const message = {
    toJSON() { hooks += 1; return 'forged'; },
    toString() { hooks += 1; return 'forged'; },
    [Symbol.toPrimitive]() { hooks += 1; return 'forged'; }
  };
  const data = { get value() { metadataReads += 1; return 'metadata'; } };
  assert.throws(() => buildJsonLogRecord('info', message as never, data, 0));
  assert.equal(hooks, 0);
  assert.equal(metadataReads, 0);
});

test('a revoked proxy message is rejected without reading proxy properties', () => {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  assert.throws(() => buildJsonLogRecord('warn', proxy as never, undefined, 0), (error: unknown) => {
    assert.equal((error as { code: string }).code, 'LOGGING-RECORD-001');
    return true;
  });
});

for (const message of ['', 'normal', 'line\nbreak', '\u0000', '中文 😀', '\ud800']) {
  test(`preserves a valid primitive string message ${JSON.stringify(message)}`, () => {
    const record = buildJsonLogRecord('info', message, { tag: 'kept', msg: 'forged' }, 123);
    assert.equal(Object.getPrototypeOf(record), null);
    assert.equal(Object.isFrozen(record), true);
    assert.equal(record.msg, message);
    assert.equal(record.tag, 'kept');
    assert.deepEqual(JSON.parse(JSON.stringify(record)), { tag: 'kept', level: 20, time: 123, msg: message });
  });
}

test('a filtered-out message is still lazy and does not read its metadata', () => {
  let reads = 0;
  const data = { get value() { reads += 1; throw new Error('must not read'); } };
  const logger = createLogger({ level: 'error' });
  assert.doesNotThrow(() => logger.debug({} as never, data));
  assert.equal(reads, 0);
});

test('the actual emitted logger path validates a message before JSON serialization', () => {
  let hooks = 0;
  const logger = createLogger({ level: 'debug' });
  assert.throws(() => logger.error({ toJSON() { hooks += 1; throw new Error('wrong error'); } } as never),
    (error: unknown) => (error as { code: string }).code === 'LOGGING-RECORD-001');
  assert.equal(hooks, 0);
});
