import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { CompilerError } from '../../src/compiler/errors.ts';
import { renderTemplateString } from '../../src/compiler/templates/render-template-string.ts';

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const code = (expected: string) => (error: unknown): boolean =>
  error instanceof CompilerError && error.code === expected;

test('template expansion enforces its byte bound before allocating the expanded result', () => {
  // This would expand to over one gigabyte if String.replace ran to completion.
  const input = '__VALUE__ '.repeat(1024);
  const value = 'x'.repeat(1024 * 1024);
  assert.throws(() => renderTemplateString(input, { VALUE: value }), code('COMPOSE-TEMPLATE-009'));
});

test('template output admits exactly its limit and rejects one byte beyond it', () => {
  const exact = 'a'.repeat(MAX_OUTPUT_BYTES);
  assert.equal(renderTemplateString('__VALUE__', { VALUE: exact }), exact);
  assert.throws(() => renderTemplateString('__VALUE__', { VALUE: exact + 'a' }), code('COMPOSE-TEMPLATE-009'));
});

test('template output bound counts UTF-8 bytes rather than UTF-16 code units', () => {
  const exact = '界'.repeat(Math.floor(MAX_OUTPUT_BYTES / 3)) + 'x';
  assert.equal(Buffer.byteLength(exact), MAX_OUTPUT_BYTES);
  assert.equal(renderTemplateString('__VALUE__', { VALUE: exact }), exact);
  assert.throws(() => renderTemplateString('__VALUE__', { VALUE: exact + 'x' }), code('COMPOSE-TEMPLATE-009'));
});

test('template byte accounting preserves surrogate pairs spanning substitution boundaries', () => {
  const prefix = 'x'.repeat(MAX_OUTPUT_BYTES - 4);
  const result = renderTemplateString('__VALUE__\uDE00', { VALUE: prefix + '\uD83D' });
  assert.equal(result, prefix + '😀');
  assert.equal(Buffer.byteLength(result), MAX_OUTPUT_BYTES);
});

test('template accounting includes dangling surrogate replacement bytes', () => {
  const value = 'x'.repeat(MAX_OUTPUT_BYTES - 3) + '\uD83D';
  assert.equal(renderTemplateString('__VALUE__', { VALUE: value }), value);
  assert.throws(() => renderTemplateString('__VALUE__x', { VALUE: value }), code('COMPOSE-TEMPLATE-009'));
});

test('template context accessors are rejected without executing user code', () => {
  let reads = 0;
  const context = { get VALUE() { reads++; return 'unsafe'; } };
  assert.throws(() => renderTemplateString('__VALUE__', context), code('COMPOSE-TEMPLATE-007'));
  assert.equal(reads, 0);
});

test('template interpolation remains literal, simultaneous and safe for prototype-looking keys', () => {
  const context = Object.assign(Object.create(null), { A: '__B__$&$1', B: 'expanded', constructor: 'safe' });
  assert.equal(renderTemplateString('__A__ / __B__ / __constructor__', context), '__B__$&$1 / expanded / safe');
  assert.equal(renderTemplateString('__N__', { N: 0 }), '0');
});

test('template conditions retain exact nesting, negation and structural validation', () => {
  const template = 'a/*#IF OUTER*/b/*#IF !INNER*/c/*#ENDIF*/d/*#ENDIF*/e';
  assert.equal(renderTemplateString(template, { OUTER: true, INNER: false }), 'abcde');
  assert.equal(renderTemplateString(template, { OUTER: false, INNER: true }), 'ae');
  assert.throws(() => renderTemplateString('/*#IF ON*/', { ON: true }), code('COMPOSE-TEMPLATE-003'));
  assert.throws(() => renderTemplateString('/*#ENDIF*/', {}), code('COMPOSE-TEMPLATE-004'));
  assert.throws(() => renderTemplateString('/*#UNKNOWN*/', {}), code('COMPOSE-TEMPLATE-002'));
});

test('template inactive branches neither interpolate nor conceal invalid conditions', () => {
  assert.equal(renderTemplateString('/*#IF ON*/__MISSING__/*#ENDIF*/', { ON: false }), '');
  assert.throws(() => renderTemplateString('/*#IF ON*//*#IF UNKNOWN*//*#ENDIF*//*#ENDIF*/', { ON: false }), code('COMPOSE-TEMPLATE-007'));
});

test('template input bound and context primitive validation remain fail-closed', () => {
  assert.throws(() => renderTemplateString('x'.repeat(1024 * 1024 + 1), {}), code('COMPOSE-TEMPLATE-006'));
  for (const value of [null, {}, [], Infinity, NaN, undefined, () => 'x']) {
    assert.throws(() => renderTemplateString('__VALUE__', { VALUE: value }), code('COMPOSE-TEMPLATE-007'));
  }
  assert.throws(() => renderTemplateString('__VALUE__', { VALUE: true }), code('COMPOSE-TEMPLATE-007'));
});
