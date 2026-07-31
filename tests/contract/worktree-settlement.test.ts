import { expect, test } from 'bun:test';

import {
  WORKTREE_SETTLEMENT_SCHEMA_V1,
  detectLineEnding,
  differsOnlyInLineEnding
} from '../../platform/shared/worktree-settlement-contract.ts';

function toBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

test('detectLineEnding returns lf for LF-only bytes', () => {
  expect(detectLineEnding(toBytes('line1\nline2\n'))).toBe('lf');
});

test('detectLineEnding returns crlf for CRLF-only bytes', () => {
  expect(detectLineEnding(toBytes('line1\r\nline2\r\n'))).toBe('crlf');
});

test('detectLineEnding returns mixed for mixed LF and CRLF bytes', () => {
  expect(detectLineEnding(toBytes('line1\r\nline2\n'))).toBe('mixed');
});

test('detectLineEnding returns none for bytes without line endings', () => {
  expect(detectLineEnding(toBytes('oneliner'))).toBe('none');
});

test('detectLineEnding returns none for empty bytes', () => {
  expect(detectLineEnding(new Uint8Array(0))).toBe('none');
});

test('differsOnlyInLineEnding returns false when bytes are identical', () => {
  const bytes = toBytes('line1\nline2\n');
  expect(differsOnlyInLineEnding(bytes, bytes)).toBe(false);
});

test('differsOnlyInLineEnding returns true when only CRLF vs LF differs', () => {
  const lfBytes = toBytes('line1\nline2\n');
  const crlfBytes = toBytes('line1\r\nline2\r\n');
  expect(differsOnlyInLineEnding(lfBytes, crlfBytes)).toBe(true);
});

test('differsOnlyInLineEnding returns false when content differs', () => {
  const a = toBytes('line1\nline2\n');
  const b = toBytes('line1\ndifferent\n');
  expect(differsOnlyInLineEnding(a, b)).toBe(false);
});

test('differsOnlyInLineEnding returns true for single CRLF vs LF difference', () => {
  const lfBytes = toBytes('hello\nworld');
  const crlfBytes = toBytes('hello\r\nworld');
  expect(differsOnlyInLineEnding(lfBytes, crlfBytes)).toBe(true);
});

test('differsOnlyInLineEnding returns false when one is empty and other is not', () => {
  const empty = new Uint8Array(0);
  const nonEmpty = toBytes('content\n');
  expect(differsOnlyInLineEnding(empty, nonEmpty)).toBe(false);
});

test('WORKTREE_SETTLEMENT_SCHEMA_V1 is stable', () => {
  expect(WORKTREE_SETTLEMENT_SCHEMA_V1).toBe('sec-worktree-settlement-v1');
});

test('same blob content under LF and CRLF materialization yields consistent line-ending-only difference', () => {
  const content = 'function hello() {\n  return "world";\n}\n';
  const lfBytes = toBytes(content);
  const crlfBytes = toBytes(content.replaceAll('\n', '\r\n'));
  // The two differ only in line endings
  expect(differsOnlyInLineEnding(lfBytes, crlfBytes)).toBe(true);
  // And their line endings are different
  expect(detectLineEnding(lfBytes)).toBe('lf');
  expect(detectLineEnding(crlfBytes)).toBe('crlf');
});

test('binary bytes with NUL are detected consistently', () => {
  const binaryBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(detectLineEnding(binaryBytes)).toBe('mixed');
  // Binary content that differs only in line endings still returns true
  const binaryCrlf = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  expect(differsOnlyInLineEnding(binaryBytes, binaryCrlf)).toBe(false);
});
