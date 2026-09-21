import { test } from 'bun:test';
import assert from 'node:assert/strict';

import { ExactJsonError, parseExactJson, parseExactJsonBytes } from '../../src/contracts/exact-json.ts';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const admission = { maximumInputBytes: 1024, maximumDepth: 10 } as const;
function kind(expected: string): (error: unknown) => boolean {
  return (error) => error instanceof ExactJsonError && error.code === 'EXACT-JSON-001' && error.kind === expected;
}

for (const source of ['null', 'true', 'false', '0', '-0', '1e+20', '"中😀\\u0000"', '[]', '{}', '{"a":[null,1,{"b":false}]}']) {
  test(`exact JSON retains native value semantics for ${source}`, () => {
    assert.deepEqual(parseExactJson(source), JSON.parse(source));
  });
}

for (const source of ['', ' ', '[,]', '[1,]', '{"a":1,}', '{"a" 1}', '[1 2]', '{a:1}', '{"a":}', '01', '+1', 'undefined', 'NaN', '/*x*/{}', '{}[]', '"\\x20"', '"\\u000g"', '"a\nb"', '[', '{', '{"a":1', '[1', '[1,', '{"a":1,']) {
  test(`exact JSON rejects malformed text ${JSON.stringify(source)}`, () => {
    assert.throws(() => parseExactJson(source), kind('invalid-json'));
  });
}

for (const source of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"outer":{"x":1,"x":2}}', '[{"__proto__":1,"__proto__":2}]']) {
  test(`exact JSON rejects decoded duplicate keys ${source}`, () => {
    assert.throws(() => parseExactJson(source), kind('duplicate-key'));
  });
}

test('duplicate-key sets are scoped to each object, not shared globally', () => {
  assert.deepEqual(parseExactJson('[{"x":1},{"x":2}]'), [{ x: 1 }, { x: 2 }]);
});

test('exact JSON preserves own prototype-named keys without mutation of Object.prototype', () => {
  const parsed = parseExactJson('{"__proto__":{"polluted":true},"constructor":1}') as Record<string, unknown>;
  assert.equal(Object.getPrototypeOf(parsed), Object.prototype);
  assert.equal(Object.hasOwn(parsed, '__proto__'), true);
  assert.equal(Object.hasOwn(Object.prototype, 'polluted'), false);
});

test('maximum depth counts only containers, including the root', () => {
  assert.equal(parseExactJson('0', 'depth', undefined, 1), 0);
  assert.deepEqual(parseExactJson('[0]', 'depth', undefined, 1), [0]);
  assert.throws(() => parseExactJson('[[]]', 'depth', undefined, 1), kind('depth-limit'));
  assert.deepEqual(parseExactJson('[[]]', 'depth', undefined, 2), [[]]);
});

for (const depth of [0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
  test(`exact JSON rejects invalid maximum depth ${String(depth)}`, () => {
    assert.throws(() => parseExactJson('{}', 'depth', undefined, depth), TypeError);
  });
}

test('exact root-key contract retains missing, unexpected and invalid-contract failures', () => {
  const contract = { rootObjectKeys: ['kind', 'value'] };
  assert.deepEqual(parseExactJson('{"value":1,"kind":"x"}', 'fixture', contract), { value: 1, kind: 'x' });
  assert.throws(() => parseExactJson('{"kind":"x"}', 'fixture', contract), /missing required root key/);
  assert.throws(() => parseExactJson('{"kind":"x","value":1,"extra":0}', 'fixture', contract), /unsupported root key/);
  assert.throws(() => parseExactJson('[]', 'fixture', contract), /root object/);
  assert.throws(() => parseExactJson('{}', 'fixture', { rootObjectKeys: ['a', 'a'] }), TypeError);
});

test('exact JSON processes 20000 nested arrays at the admitted depth', () => {
  const depth = 20_000;
  let value = parseExactJson('['.repeat(depth) + '7' + ']'.repeat(depth), 'deep', undefined, depth);
  for (let index = 0; index < depth; index += 1) {
    assert.ok(Array.isArray(value));
    assert.equal(value.length, 1);
    value = value[0];
  }
  assert.equal(value, 7);
});

test('exact JSON processes 20000 nested objects without a hidden stack limit', () => {
  const depth = 20_000;
  let value = parseExactJson('{"x":'.repeat(depth) + 'true' + '}'.repeat(depth));
  for (let index = 0; index < depth; index += 1) value = (value as { x: unknown }).x;
  assert.equal(value, true);
});

test('deep over-limit input reports depth-limit rather than RangeError', () => {
  const depth = 20_000;
  assert.throws(() => parseExactJson('['.repeat(depth) + '0' + ']'.repeat(depth), 'deep', undefined, depth - 1), kind('depth-limit'));
});

test('deep duplicate reports the original exact-JSON failure kind', () => {
  const depth = 20_000;
  assert.throws(() => parseExactJson('['.repeat(depth) + '{"x":1,"x":2}' + ']'.repeat(depth)), kind('duplicate-key'));
});

test('byte admission accepts the exact byte boundary and rejects one byte more', () => {
  const input = bytes('"中"');
  assert.equal(parseExactJsonBytes(input, 'bytes', { maximumInputBytes: input.length, maximumDepth: 1 }), '中');
  assert.throws(() => parseExactJsonBytes(input, 'bytes', { maximumInputBytes: input.length - 1, maximumDepth: 1 }), kind('input-too-large'));
});

for (const input of [Uint8Array.of(0xff), Uint8Array.of(0xc0, 0xaf), Uint8Array.of(0xed, 0xa0, 0x80), Uint8Array.of(0xf0, 0x9f)]) {
  test(`byte admission rejects non-exact UTF-8 ${Array.from(input)}`, () => {
    assert.throws(() => parseExactJsonBytes(input, 'bytes', admission), kind('invalid-utf8'));
  });
}

test('leading UTF-8 BOM is not silently removed', () => {
  assert.throws(() => parseExactJsonBytes(Uint8Array.of(0xef, 0xbb, 0xbf, 0x7b, 0x7d), 'bytes', admission), kind('invalid-json'));
});

test('byte admission observes only the supplied typed-array view', () => {
  const raw = bytes('BAD{"ok":1}BAD');
  assert.deepEqual(parseExactJsonBytes(raw.subarray(3, raw.length - 3), 'bytes', admission), { ok: 1 });
});

test('byte admission accepts actual Buffer instances without widening their view', () => {
  const raw = Buffer.from('xx[1]yy');
  assert.deepEqual(parseExactJsonBytes(raw.subarray(2, 5), 'bytes', admission), [1]);
});

test('byte admission captures maximumInputBytes once so a getter cannot widen it', () => {
  let reads = 0;
  const limits = {
    get maximumInputBytes() { reads += 1; return reads === 1 ? 1 : 1024; },
    maximumDepth: 1
  };
  assert.throws(() => parseExactJsonBytes(bytes('{}'), 'bytes', limits), kind('input-too-large'));
  assert.equal(reads, 1);
});

test('byte admission captures maximumDepth once so a getter cannot widen it', () => {
  let reads = 0;
  const limits = {
    maximumInputBytes: 1024,
    get maximumDepth() { reads += 1; return reads === 1 ? 1 : 1024; }
  };
  assert.throws(() => parseExactJsonBytes(bytes('[[]]'), 'bytes', limits), kind('depth-limit'));
  assert.equal(reads, 1);
});

test('byte admission rejects shadowed byteLength instead of trusting the declared size', () => {
  const input = bytes('{"large":"payload"}');
  Object.defineProperty(input, 'byteLength', { value: 1 });
  assert.throws(() => parseExactJsonBytes(input, 'bytes', { maximumInputBytes: 2, maximumDepth: 1 }), kind('input-too-large'));
});

test('native byte slots are read without executing shadowed length, offset or buffer getters', () => {
  const input = bytes('[1]');
  for (const property of ['byteLength', 'byteOffset', 'buffer']) {
    Object.defineProperty(input, property, { get() { throw new Error(`untrusted ${property}`); } });
  }
  assert.deepEqual(parseExactJsonBytes(input, 'bytes', admission), [1]);
});

test('forged native-view prototypes and proxied views are rejected', () => {
  assert.throws(() => parseExactJsonBytes(Object.create(Uint8Array.prototype), 'bytes', admission), TypeError);
  assert.throws(() => parseExactJsonBytes(new Proxy(bytes('{}'), {}), 'bytes', admission), TypeError);
});

test('fixed view on a shared backing buffer is decoded without expanding the view', () => {
  const shared = new SharedArrayBuffer(8);
  const input = new Uint8Array(shared);
  input.set(bytes('xx{}yyyy'));
  assert.deepEqual(parseExactJsonBytes(input.subarray(2, 4), 'bytes', { maximumInputBytes: 2, maximumDepth: 1 }), {});
});

for (const maximumInputBytes of [0, -1, 1.5, Infinity, NaN]) {
  test(`byte admission rejects invalid maximumInputBytes ${String(maximumInputBytes)}`, () => {
    assert.throws(() => parseExactJsonBytes(bytes('{}'), 'bytes', { maximumInputBytes, maximumDepth: 1 }), TypeError);
  });
}
