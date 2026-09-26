import { expect, test } from 'bun:test';

import { ExactJsonError, parseExactJson, parseExactJsonBytes } from './exact-json.ts';
import { FailureError } from './failure.ts';

test('exact JSON retains duplicate-key information and one typed failure identity', () => {
  const parse = () => parseExactJson('{"value":1,"\\u0076alue":2}', 'Exact fixture');

  expect(parse).toThrow(ExactJsonError);
  try {
    parse();
  } catch (error) {
    expect(error).toBeInstanceOf(FailureError);
    expect(error).toMatchObject({
      code: 'EXACT-JSON-001',
      kind: 'duplicate-key',
      details: { kind: 'duplicate-key' }
    });
  }
});

test('exact JSON rejects trailing syntax and trailing documents', () => {
  expect(() => parseExactJson('{"value":1,}', 'Exact fixture')).toThrow('trailing comma');
  expect(() => parseExactJson('{"value":1}\n[]', 'Exact fixture')).toThrow('trailing data');
});

test('exact JSON enforces an owner-supplied root field contract without a registry', () => {
  const contract = { rootObjectKeys: ['kind', 'value'] } as const;

  expect(parseExactJson('{"kind":"fixture","value":1}', 'Exact fixture', contract)).toEqual({
    kind: 'fixture',
    value: 1
  });
  expect(() => parseExactJson(
    '{"kind":"fixture","value":1,"unknown":true}',
    'Exact fixture',
    contract
  )).toThrow('unsupported root key "unknown"');
  expect(() => parseExactJson('{"kind":"fixture"}', 'Exact fixture', contract))
    .toThrow('missing required root key "value"');
  expect(() => parseExactJson('[]', 'Exact fixture', contract))
    .toThrow('must contain one root object');
});

test('exact JSON bytes fail before domain validation when encoding or size is not admitted', () => {
  const admission = { maximumInputBytes: 16, maximumDepth: 1 } as const;

  expect(() => parseExactJsonBytes(
    Uint8Array.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xff, 0x7d]),
    'Exact fixture',
    admission
  )).toThrow('not exact UTF-8');
  expect(() => parseExactJsonBytes(
    new TextEncoder().encode('{"value":"larger than admitted"}'),
    'Exact fixture',
    admission
  )).toThrow('maximum input size');
});

test('exact JSON bytes bound recursive containers while accepting a flat domain document', () => {
  const admission = { maximumInputBytes: 128, maximumDepth: 1 } as const;

  expect(parseExactJsonBytes(
    new TextEncoder().encode('{"status":"ready"}'),
    'Exact fixture',
    admission
  )).toEqual({ status: 'ready' });
  expect(() => parseExactJsonBytes(
    new TextEncoder().encode('{"nested":{"status":"ready"}}'),
    'Exact fixture',
    admission
  )).toThrow('maximum container depth');
});
