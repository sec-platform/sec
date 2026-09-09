import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { captureGitReadArguments, gitReadCommandIsObservation } from '../../src/external-capabilities/git-read/runtime/read-command.ts';

const head = 'a'.repeat(40);
const pathCommands = [
  ['status', '--short'], ['diff', '--name-only', head], ['diff-files', '--name-only'],
  ['diff-index', '--name-only', head], ['ls-files', '-z'], ['ls-tree', '--name-only', head]
];

test('the first option terminator turns all later values into literal pathspecs', () => {
  for (const prefix of pathCommands) for (const name of ['--textconv', '--ext-diff', '--cached', '--exec', '--filter=blob:none', '--upload-pack=x', '-odd', '--']) {
    const args = [...prefix, '--', name];
    assert.equal(gitReadCommandIsObservation(args), true, JSON.stringify(args));
  }
});

test('the same dangerous spelling before option termination remains forbidden', () => {
  for (const prefix of pathCommands) for (const option of ['--textconv', '--ext-diff', '--exec', '--filter=blob:none', '--upload-pack=x']) {
    assert.equal(gitReadCommandIsObservation([...prefix, option, '--', 'file']), false);
  }
  assert.equal(gitReadCommandIsObservation(['diff-files', '--cached', '--', 'file']), false);
  assert.equal(gitReadCommandIsObservation(['diff-files', '--', '--cached']), true);
});

test('grep patterns are exactly one -e operand, not recursively parsed helper switches', () => {
  for (const pattern of ['--textconv', '--recurse-submodules', '--upload-pack=x', '-e', '--']) {
    assert.equal(gitReadCommandIsObservation(['grep', '-F', '-l', '-z', '-e', pattern, head, '--', '.']), true);
  }
});

test('grep retains its closed revision, option and path grammar outside the pattern operand', () => {
  for (const args of [
    ['grep', '--textconv', '-e', 'literal', head, '--', '.'],
    ['grep', '--recurse-submodules', '-e', 'literal', head, '--', '.'],
    ['grep', '-e', '', head, '--', '.'], ['grep', '-e', 'literal', 'HEAD', '--', '.'],
    ['grep', '-e', 'literal', head, '--', 'other'], ['grep', '-e', 'literal', head, '--', '.', '--']
  ]) assert.equal(gitReadCommandIsObservation(args), false, JSON.stringify(args));
});

test('an added separator does not authorize mutation commands or global config injection', () => {
  for (const args of [
    ['reset', '--', 'file'], ['checkout', '--', 'file'], ['update-index', '--', 'file'],
    ['config', '--get', 'key', '--', 'other'], ['-c', 'core.hooksPath=other', 'status', '--', 'file'],
    ['branch', '--', '--show-current']
  ]) assert.equal(gitReadCommandIsObservation(args), false);
});

test('literal support is downstream of byte admission, not a bypass for NUL or malformed arrays', () => {
  assert.equal(captureGitReadArguments(['ls-files', '--', 'x\0y'], 100).status, 'invalid');
  const captured = captureGitReadArguments(['ls-files', '--', '--textconv'], 100);
  assert.equal(captured.status, 'ready');
  if (captured.status === 'ready') assert.equal(gitReadCommandIsObservation(captured.args), true);
});
