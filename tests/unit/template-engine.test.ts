import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { TemplateEngine } from '../../src/adapters/compilation/compose/template-engine.ts';

for (const newline of ['\n', '\r\n']) {
  test(`template conditionals preserve literal ${JSON.stringify(newline)} bytes around paired directives`, () => {
    const source = [
      'before', '/*#IF enabled*/', 'enabled', '/*#IF !nested*/',
      'not-nested', '/*#ENDIF*/', '/*#ENDIF*/', 'after'
    ].join(newline);
    // Markers are syntax. Active text, including each surrounding newline,
    // is content, not a formatter's permission to delete whitespace.
    expect(TemplateEngine.renderString(source, { enabled: true, nested: false }))
      .toBe(['before', '', 'enabled', '', 'not-nested', '', '', 'after'].join(newline));
    expect(TemplateEngine.renderString(source, { enabled: false, nested: false }))
      .toBe(['before', '', 'after'].join(newline));
  });
}

test('unknown, inherited, non-boolean, and malformed conditions fail closed', () => {
  expect(() => TemplateEngine.renderString(
    '/*#IF missing*/value/*#ENDIF*/',
    {}
  )).toThrow(/unknown context key/);
  expect(() => TemplateEngine.renderString(
    '/*#IF toString*/value/*#ENDIF*/',
    {}
  )).toThrow(/unknown context key/);
  expect(() => TemplateEngine.renderString(
    '/*#IF enabled*/value/*#ENDIF*/',
    { enabled: 'true' }
  )).toThrow(/requires a boolean/);
  expect(() => TemplateEngine.renderString(
    '/*#IF enabled*//*#IF dormantMissing*/value/*#ENDIF*//*#ENDIF*/',
    { enabled: false }
  )).toThrow(/unknown context key/);
  expect(() => TemplateEngine.renderString(
    '/*#IF enabled*/value',
    { enabled: true }
  )).toThrow(/missing \/\*#ENDIF\*\//);
  expect(() => TemplateEngine.renderString(
    'value/*#ENDIF*/',
    {}
  )).toThrow(/unmatched \/\*#ENDIF\*\//);
});

test('interpolation uses literal keys and literal replacement bytes', () => {
  expect(TemplateEngine.renderString(
    'value=__value__; count=__count__',
    { value: '$&-$`-$\'', count: 2 }
  )).toBe('value=$&-$`-$\'; count=2');

  expect(() => TemplateEngine.renderString('value=__missing__', {}))
    .toThrow(/placeholder references an unknown context key/);
  expect(() => TemplateEngine.renderString('value=__enabled__', { enabled: true }))
    .toThrow(/placeholder requires a string or number/);
  expect(() => TemplateEngine.renderString('unchanged', {
    'value.*': 'invalid'
  })).toThrow(/context key is not canonical/);
  expect(() => TemplateEngine.renderString('unchanged', {
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
