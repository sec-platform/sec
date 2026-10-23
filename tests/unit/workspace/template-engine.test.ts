import { expect, test } from 'bun:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { TemplateEngine } from '../../../src/adapters/compilation/compose/template-engine.ts';
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
  expect(renderTemplateString(
    'value=__value__; count=__count__',
    { value: '$&-$`-$\'', count: 2 }
  )).toBe('value=$&-$`-$\'; count=2');

  assert.throws(() => renderTemplateString('value=__missing__', {}), code('COMPOSE-TEMPLATE-007', { key: 'missing', placeholder: '__missing__' }));
  assert.throws(() => renderTemplateString('value=__enabled__', { enabled: true }), code('COMPOSE-TEMPLATE-007', { key: 'enabled', valueType: 'boolean' }));
  assert.throws(() => renderTemplateString('unchanged', {
    'value.*': 'invalid'
  }), code('COMPOSE-TEMPLATE-007', { key: 'value.*' }));
  assert.throws(() => renderTemplateString('unchanged', {
    value: Number.NaN
  }), code('COMPOSE-TEMPLATE-007', { key: 'value', valueType: 'number' }));
});

test('template file reads stay inside the root and observe current bytes', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-template-engine-'));
  try {
    const templatePath = path.join(root, 'sample.template');
    writeFileSync(templatePath, 'first __value__', 'utf8');
    expect(TemplateEngine.render('sample.template', { value: 1 }, root)).toBe('first 1');

    writeFileSync(templatePath, 'second __value__', 'utf8');
    expect(TemplateEngine.render('sample.template', { value: 2 }, root)).toBe('second 2');

    assert.throws(() => TemplateEngine.render('../outside.template', {}, root), code('COMPOSE-TEMPLATE-005'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
