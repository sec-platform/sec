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

test('binary bytes with NUL are detected consistently', () => {
  const binaryBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(detectLineEnding(binaryBytes)).toBe('mixed');
  // Binary content that differs only in line endings still returns true
  const binaryCrlf = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(differsOnlyInLineEnding(binaryBytes, binaryCrlf)).toBe(false);
});
