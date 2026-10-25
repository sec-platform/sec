import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { decodeExactUtf8 } from './utf8.ts';

test('exact UTF-8 codec preserves empty text, Unicode and embedded zero bytes', () => {
  for (const text of ['', 'ASCII\0text', '中文', 'é', 'e\u0301', '😀', '\u{10ffff}', 'a\ufeffb']) {
    assert.equal(decodeExactUtf8(new TextEncoder().encode(text)), text);
  }
});

test('exact UTF-8 codec retains its historical leading-BOM behavior and view bounds', () => {
  const carrier = new Uint8Array([0xff, 0xef, 0xbb, 0xbf, 0x61, 0xff]);
  assert.equal(decodeExactUtf8(carrier.subarray(1, 5)), 'a');
  assert.equal(decodeExactUtf8(new Uint8Array([0xef, 0xbb, 0xbf])), '');
});

test('malformed UTF-8 fails with the caller label and native decoding cause', () => {
  assert.throws(() => decodeExactUtf8(new Uint8Array([0xff]), 'Fact pack'), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /\bFact pack\b/u);
    assert.match(error.message, /\bUTF-8\b/u);
    assert.ok(error.cause instanceof TypeError);
    return true;
  });
  assert.throws(() => decodeExactUtf8(new Uint8Array([0xff])), /retained file is not exact UTF-8/);
});
