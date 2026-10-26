import assert from 'node:assert/strict';
import { expect, test } from 'bun:test';

import { CodedFailure } from '../../contracts/failure.ts';
import {
  YamlSyntaxError,
  parseYamlDocument,
  parseYamlValue
} from './yaml.ts';

const VALUE_ADMISSION = {
  label: 'YAML fixture',
  maximumInputBytes: 1024,
  maximumAliasCount: 8
} as const;

test('both YAML capabilities reject a second document with the parser cause intact', () => {
  const source = 'first: 1\n---\nsecond: 2\n';
  for (const parse of [parseYamlValue, parseYamlDocument]) {
    assert.throws(() => parse(source, VALUE_ADMISSION), (error: unknown) => {
      expect(error).toBeInstanceOf(YamlSyntaxError);
      expect(error).toBeInstanceOf(CodedFailure);
      expect(error).toMatchObject({
        code: 'YAML-SYNTAX-001',
        kind: 'invalid-yaml',
        details: { kind: 'invalid-yaml' },
        yamlErrorCode: 'MULTIPLE_DOCS',
        cause: expect.objectContaining({ code: 'MULTIPLE_DOCS' })
      });
      return true;
    });
  }
  expect(parseYamlValue('---\nvalue: |\n  ---\n...\n', VALUE_ADMISSION))
    .toEqual({ value: '---\n' });
  expect(parseYamlValue('', VALUE_ADMISSION)).toBeNull();
});
