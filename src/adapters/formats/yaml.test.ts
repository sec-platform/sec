import assert from 'node:assert/strict';
import { expect, test } from 'bun:test';

import { CodedFailure } from '../../contracts/failure.ts';
import {
  YamlInputLimitError,
  YamlSyntaxError,
  parseYamlDocument,
  parseYamlValue
} from './yaml.ts';

const VALUE_ADMISSION = {
  label: 'YAML fixture',
  maximumInputBytes: 1024,
  maximumAliasCount: 8
} as const;

test('strict YAML exposes separate value and document capabilities', () => {
  const source = 'name: fixture\nenabled: true\n';

  expect(parseYamlValue(source, VALUE_ADMISSION)).toEqual({ name: 'fixture', enabled: true });
  expect(parseYamlDocument(source, VALUE_ADMISSION).get('name')).toBe('fixture');
});

test('strict YAML projects parser throws through one typed syntax identity', () => {
  const parse = () => parseYamlValue('value: [unterminated\n', VALUE_ADMISSION);

  assert.throws(parse, (error: unknown) => {
    expect(error).toBeInstanceOf(YamlSyntaxError);
    expect(error).toBeInstanceOf(CodedFailure);
    expect(error).toMatchObject({
      code: 'YAML-SYNTAX-001',
      kind: 'invalid-yaml',
      details: { kind: 'invalid-yaml' }
    });
    return true;
  });
});

test('strict YAML admits input by UTF-8 bytes before parsing', () => {
  const parse = () => parseYamlValue('name: 好', {
    ...VALUE_ADMISSION,
    maximumInputBytes: 8
  });

  assert.throws(parse, (error: unknown) => {
    expect(error).toBeInstanceOf(YamlInputLimitError);
    expect(error).toMatchObject({
      code: 'YAML-INPUT-001',
      actualInputBytes: 9,
      maximumInputBytes: 8
    });
    return true;
  });
});

test('strict YAML preserves duplicate-key failure identity', () => {
  expect(() => parseYamlValue('value: first\nvalue: second\n', VALUE_ADMISSION))
    .toThrow(expect.objectContaining({
      code: 'YAML-SYNTAX-001',
      kind: 'duplicate-key',
      yamlErrorCode: 'DUPLICATE_KEY'
    }));
});

test('both YAML capabilities reject a second document with the parser cause intact', () => {
  for (const source of ['first: 1\n---\nsecond: 2\n', '---\nfirst: 1\n...\n---\n']) {
    for (const parse of [parseYamlValue, parseYamlDocument]) {
      expect(() => parse(source, VALUE_ADMISSION)).toThrow(expect.objectContaining({
        code: 'YAML-SYNTAX-001',
        kind: 'invalid-yaml',
        yamlErrorCode: 'MULTIPLE_DOCS',
        cause: expect.objectContaining({ code: 'MULTIPLE_DOCS' })
      }));
    }
  }
  expect(parseYamlValue('---\nvalue: |\n  ---\n...\n', VALUE_ADMISSION))
    .toEqual({ value: '---\n' });
  expect(parseYamlValue('', VALUE_ADMISSION)).toBeNull();
});
