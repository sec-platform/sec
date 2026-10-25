import { expect, test } from 'bun:test';
import assert from 'node:assert/strict';
import { renderTemplateString } from '../../../src/compiler/templates/render-template-string.ts';
import { CodedFailure } from '../../../src/contracts/failure.ts';

const code = (expected: string, details?: Record<string, unknown>) => (error: unknown): boolean => {
  if (!(error instanceof CodedFailure) || error.code !== expected) return false;
  if (details !== undefined) {
    assert.ok(error.details !== null && typeof error.details === 'object');
    for (const [key, value] of Object.entries(details)) {
      assert.equal((error.details as Record<string, unknown>)[key], value);
    }
  }
  return true;
};

for (const newline of ['\n', '\r\n']) {
  test(`template conditionals preserve literal ${JSON.stringify(newline)} bytes around paired directives`, () => {
    const source = [
      'before', '/*#IF enabled*/', 'enabled', '/*#IF !nested*/',
      'not-nested', '/*#ENDIF*/', '/*#ENDIF*/', 'after'
    ].join(newline);
    // Markers are syntax. Active text, including each surrounding newline,
    // is content, not a formatter's permission to delete whitespace.
    expect(renderTemplateString(source, { enabled: true, nested: false }))
      .toBe(['before', '', 'enabled', '', 'not-nested', '', '', 'after'].join(newline));
    expect(renderTemplateString(source, { enabled: false, nested: false }))
      .toBe(['before', '', 'after'].join(newline));
  });
}

test('unknown, inherited, non-boolean, and malformed conditions fail closed', () => {
  assert.throws(() => renderTemplateString('/*#UNKNOWN*/', {}), code('COMPOSE-TEMPLATE-002'));
  assert.throws(() => renderTemplateString(
    '/*#IF missing*/value/*#ENDIF*/',
    {}
  ), code('COMPOSE-TEMPLATE-007', { key: 'missing' }));
  assert.throws(() => renderTemplateString(
    '/*#IF toString*/value/*#ENDIF*/',
    {}
  ), code('COMPOSE-TEMPLATE-007', { key: 'toString' }));
  assert.throws(() => renderTemplateString(
    '/*#IF enabled*/value/*#ENDIF*/',
    { enabled: 'true' }
  ), code('COMPOSE-TEMPLATE-007', { key: 'enabled', valueType: 'string' }));
  assert.throws(() => renderTemplateString(
    '/*#IF enabled*//*#IF dormantMissing*/value/*#ENDIF*//*#ENDIF*/',
    { enabled: false }
  ), code('COMPOSE-TEMPLATE-007', { key: 'dormantMissing' }));
  assert.throws(() => renderTemplateString(
    '/*#IF enabled*/value',
    { enabled: true }
  ), code('COMPOSE-TEMPLATE-003'));
  assert.throws(() => renderTemplateString(
    'value/*#ENDIF*/',
    {}
  ), code('COMPOSE-TEMPLATE-004'));
});

test('interpolation uses literal keys and literal replacement bytes', () => {
  const context = Object.assign(Object.create(null), {
    value: "__other__$&-$`-$'-$1", other: 'expanded', constructor: 'safe', count: 0
  });
  expect(renderTemplateString('value=__value__; other=__other__; ctor=__constructor__; count=__count__', context))
    .toBe("value=__other__$&-$`-$'-$1; other=expanded; ctor=safe; count=0");

  assert.throws(() => renderTemplateString('value=__missing__', {}), code('COMPOSE-TEMPLATE-007', { key: 'missing', placeholder: '__missing__' }));
  assert.throws(() => renderTemplateString('value=__enabled__', { enabled: true }), code('COMPOSE-TEMPLATE-007', { key: 'enabled', valueType: 'boolean' }));
  assert.throws(() => renderTemplateString('unchanged', {
    'value.*': 'invalid'
  }), code('COMPOSE-TEMPLATE-007', { key: 'value.*' }));
  assert.throws(() => renderTemplateString('unchanged', {
    value: Number.NaN
  }), code('COMPOSE-TEMPLATE-007', { key: 'value', valueType: 'number' }));
});

// Boundary fixtures for the current renderer resource profile, not a permanent
// size/compatibility promise or evidence that this budget is optimal.
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

test('template output accumulates substitutions up to its exact byte limit', () => {
  const input = '__VALUE__'.repeat(4);
  const value = 'a'.repeat(MAX_OUTPUT_BYTES / 4);
  const exact = 'a'.repeat(MAX_OUTPUT_BYTES);
  assert.equal(renderTemplateString(input, { VALUE: value }), exact);
  assert.throws(() => renderTemplateString(input + 'a', { VALUE: value }), code('COMPOSE-TEMPLATE-009'));
});

test('template output bound counts UTF-8 bytes rather than UTF-16 code units', () => {
  const exact = '界'.repeat(Math.floor(MAX_OUTPUT_BYTES / 3)) + 'x';
  assert.equal(Buffer.byteLength(exact), MAX_OUTPUT_BYTES);
  assert.equal(renderTemplateString('__VALUE__', { VALUE: exact }), exact);
  assert.throws(() => renderTemplateString('__VALUE__', { VALUE: exact + 'x' }), code('COMPOSE-TEMPLATE-009'));
});

test('template inactive branches do not interpolate missing values', () => {
  assert.equal(renderTemplateString('/*#IF ON*/__MISSING__/*#ENDIF*/', { ON: false }), '');
});
