import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { TemplateEngine } from '../../src/adapters/compilation/compose/template-engine.ts';
import { renderTemplateString } from '../../src/compiler/templates/render-template-string.ts';

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
  expect(() => renderTemplateString(
    '/*#IF missing*/value/*#ENDIF*/',
    {}
  )).toThrow(/unknown context key/);
  expect(() => renderTemplateString(
    '/*#IF toString*/value/*#ENDIF*/',
    {}
  )).toThrow(/unknown context key/);
  expect(() => renderTemplateString(
    '/*#IF enabled*/value/*#ENDIF*/',
    { enabled: 'true' }
  )).toThrow(/requires a boolean/);
  expect(() => renderTemplateString(
    '/*#IF enabled*//*#IF dormantMissing*/value/*#ENDIF*//*#ENDIF*/',
    { enabled: false }
  )).toThrow(/unknown context key/);
  expect(() => renderTemplateString(
    '/*#IF enabled*/value',
    { enabled: true }
  )).toThrow(/missing \/\*#ENDIF\*\//);
  expect(() => renderTemplateString(
    'value/*#ENDIF*/',
    {}
  )).toThrow(/unmatched \/\*#ENDIF\*\//);
});

test('interpolation uses literal keys and literal replacement bytes', () => {
  expect(renderTemplateString(
    'value=__value__; count=__count__',
    { value: '$&-$`-$\'', count: 2 }
  )).toBe('value=$&-$`-$\'; count=2');

  expect(() => renderTemplateString('value=__missing__', {}))
    .toThrow(/placeholder references an unknown context key/);
  expect(() => renderTemplateString('value=__enabled__', { enabled: true }))
    .toThrow(/placeholder requires a string or number/);
  expect(() => renderTemplateString('unchanged', {
    'value.*': 'invalid'
  })).toThrow(/context key is not canonical/);
  expect(() => renderTemplateString('unchanged', {
    value: Number.NaN
  })).toThrow(/context value is unsupported/);
});

test('template file reads stay inside the root and observe current bytes', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-template-engine-'));
  try {
    const templatePath = path.join(root, 'sample.template');
    writeFileSync(templatePath, 'first __value__', 'utf8');
    expect(TemplateEngine.render('sample.template', { value: 1 }, root)).toBe('first 1');

    writeFileSync(templatePath, 'second __value__', 'utf8');
    expect(TemplateEngine.render('sample.template', { value: 2 }, root)).toBe('second 2');

    expect(() => TemplateEngine.render('../outside.template', {}, root))
      .toThrow(/escapes its allowed root/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
