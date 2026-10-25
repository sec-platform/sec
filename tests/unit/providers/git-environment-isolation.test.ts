import { test } from 'bun:test';
import assert from 'node:assert/strict';

import { canonicalGitChildEnvironment as environment, gitEnvironmentValue } from '../../../src/adapters/providers/git/environment.ts';

test('native environment lookup does not read unrelated getters', () => {
  const env = Object.defineProperty({ PATH: 'chosen' }, 'unrelated', { enumerable: true, get() { throw new Error('must not read'); } });
  assert.equal(gitEnvironmentValue(env, 'PATH'), 'chosen');
  assert.equal(gitEnvironmentValue(env, 'path'), process.platform === 'win32' ? 'chosen' : undefined);
});

const nonStringEnvironmentValues: readonly unknown[] = [
  0, 1, true, false, null, 1n, {}, [], () => 'coerced', Symbol('coerced'), new String('boxed')
];
for (const [index, value] of nonStringEnvironmentValues.entries()) {
  test(`retained environment value ${index} cannot acquire a new meaning through child-process coercion`, () => {
    assert.throws(() => environment({}, { CUSTOM: value } as NodeJS.ProcessEnv), TypeError);
  });
}

test('environment rejection does not invoke a caller-controlled string conversion', () => {
  let conversions = 0;
  const value = { toString() { conversions += 1; return 'coerced'; } };
  assert.throws(() => environment({ CUSTOM: value } as unknown as Record<string, string>, {}), TypeError);
  assert.equal(conversions, 0);
});
