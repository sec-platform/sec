import { expect, test } from 'bun:test';

import { SecError } from '../contract/failure.ts';
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

  expect(parse).toThrow(YamlSyntaxError);
  try {
    parse();
  } catch (error) {
    expect(error).toBeInstanceOf(SecError);
    expect(error).toMatchObject({
      code: 'YAML-SYNTAX-001',
      kind: 'invalid-yaml',
      details: { kind: 'invalid-yaml' }
    });
  }
});

test('strict YAML admits input by UTF-8 bytes before parsing', () => {
  const parse = () => parseYamlValue('name: 好', {
    ...VALUE_ADMISSION,
    maximumInputBytes: 8
  });

  expect(parse).toThrow(YamlInputLimitError);
  expect(parse).toThrow(expect.objectContaining({
    code: 'YAML-INPUT-001',
    actualInputBytes: 9,
    maximumInputBytes: 8
  }));
});

test('strict YAML preserves duplicate-key failure identity', () => {
  expect(() => parseYamlValue('value: first\nvalue: second\n', VALUE_ADMISSION))
    .toThrow(expect.objectContaining({
      code: 'YAML-SYNTAX-001',
      kind: 'duplicate-key',
      yamlErrorCode: 'DUPLICATE_KEY'
    }));
});
