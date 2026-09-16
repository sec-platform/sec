import { expect, test } from 'bun:test';

import {
  detectLineEnding,
  differsOnlyInLineEnding
} from '../../src/runtime-state/worktree-settlement.ts';

function toBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

test('line-ending classification covers the complete result space', () => {
  for (const [source, expected] of [
    ['line1\nline2\n', 'lf'],
    ['line1\r\nline2\r\n', 'crlf'],
    ['line1\r\nline2\n', 'mixed'],
    ['oneliner', 'none'],
    ['', 'none']
  ] as const) {
    expect(detectLineEnding(toBytes(source)), JSON.stringify(source)).toBe(expected);
  }
});

test('line-ending-only comparison distinguishes normalization from content changes', () => {
  for (const [left, right, expected] of [
    ['line1\nline2\n', 'line1\nline2\n', false],
    ['line1\nline2\n', 'line1\r\nline2\r\n', true],
    ['hello\nworld', 'hello\r\nworld', true],
    ['line1\nline2\n', 'line1\ndifferent\n', false],
    ['', 'content\n', false]
  ] as const) {
    expect(differsOnlyInLineEnding(toBytes(left), toBytes(right)), `${JSON.stringify(left)} -> ${JSON.stringify(right)}`)
      .toBe(expected);
  }
});

test('line-ending-only comparison preserves every non-CRLF byte exactly', () => {
  const cases = [
    {
      name: 'NUL is preserved while LF expands to CRLF',
      left: [0x00, 0x0A, 0x41],
      right: [0x00, 0x0D, 0x0A, 0x41],
      expected: true
    },
    {
      name: 'NUL content changes are rejected',
      left: [0x00, 0x0A],
      right: [0x01, 0x0D, 0x0A],
      expected: false
    },
    {
      name: 'identical invalid UTF-8 bytes survive line-ending changes',
      left: [0xFF, 0x0A],
      right: [0xFF, 0x0D, 0x0A],
      expected: true
    },
    {
      name: 'different invalid UTF-8 bytes are rejected',
      left: [0xFF, 0x0A],
      right: [0xFE, 0x0D, 0x0A],
      expected: false
    },
    {
      name: 'ordinary content differences beside CRLF are rejected',
      left: [0x41, 0x0A, 0x42],
      right: [0x41, 0x0D, 0x0A, 0x43],
      expected: false
    },
    {
      name: 'balanced LF and CRLF swaps remain line-ending-only at equal byte length',
      left: [0x61, 0x0D, 0x0A, 0x62, 0x0A],
      right: [0x61, 0x0A, 0x62, 0x0D, 0x0A],
      expected: true
    },
    {
      name: 'lone CR is content, not a line ending',
      left: [0x41, 0x0D, 0x42, 0x0A],
      right: [0x41, 0x0A, 0x42, 0x0D, 0x0A],
      expected: false
    }
  ] as const;

  for (const { name, left, right, expected } of cases) {
    expect(differsOnlyInLineEnding(new Uint8Array(left), new Uint8Array(right)), name).toBe(expected);
  }
});
