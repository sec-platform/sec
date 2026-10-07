import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { captureGitReadArguments, gitReadCommandIsObservation } from '../../src/adapters/providers/git-read/runtime/read-command.ts';

// These are independent argv protocol vectors, not generated from the policy.
function allowed(args: string[]): boolean {
  const captured = captureGitReadArguments(args, 4096);
  assert.equal(captured.status, 'ready');
  if (captured.status !== 'ready') throw new Error('Fixture argv should be structurally valid');
  return gitReadCommandIsObservation(captured.args);
}

test('repository locator values do not become command positions', () => {
  for (const locator of ['--git-dir', '--work-tree']) {
    for (const command of [
      ['branch', '--show-current'], ['config', '--get', 'core.hooksPath'],
      ['show', 'HEAD:package.json'], ['worktree', 'list', '--porcelain'],
      ['symbolic-ref', '--short', 'HEAD'], ['var', 'GIT_AUTHOR_IDENT']
    ]) assert.equal(allowed([locator, command[0]!, ...command]), true);
  }
});

test('multiple global options preserve the actual subcommand boundary', () => {
  assert.equal(allowed(['--git-dir', 'show', '--work-tree', 'show', '--no-pager', 'show', 'HEAD:file']), true);
  assert.equal(allowed(['-c', 'core.fsmonitor=false', '--git-dir', 'branch', '--literal-pathspecs', 'branch', '--show-current']), true);
});

test('a command-shaped locator does not authorize a mutating subcommand', () => {
  for (const args of [
    ['--git-dir', 'branch', 'branch', '-D', 'main'],
    ['--work-tree', 'config', 'config', 'core.hooksPath', '/other'],
    ['--git-dir', 'status', 'reset', '--hard'],
    ['--git-dir', 'worktree', 'worktree', 'remove', '/other'],
    ['--work-tree', 'show', 'show', '--textconv']
  ]) assert.equal(allowed(args), false);
});

test('incomplete and unrecognized global options still fail closed', () => {
  for (const args of [[], ['--git-dir'], ['--work-tree'], ['-c'], ['--git-dir', 'branch'],
    ['--unknown', 'branch', '--show-current'], ['-c', 'core.hooksPath=/other', 'status']]) {
    assert.equal(allowed(args), false);
  }
  assert.equal(allowed(['--version']), true);
  assert.equal(allowed(['--version', 'status']), false);
});

test('ordinary read forms retain their previous independent protocol vectors', () => {
  for (const args of [
    ['status', '--porcelain=v1', '-z'], ['cat-file', '--batch'], ['ls-files', '--stage', '-z'],
    ['ls-tree', '-r', '-z', 'HEAD'], ['rev-parse', '--verify', 'HEAD'],
    ['merge-base', '--is-ancestor', 'main', 'HEAD'], ['diff', '--no-ext-diff', '--name-only', 'HEAD'],
    ['remote', 'get-url', 'origin'], ['rev-list', '--count', 'HEAD'],
    ['for-each-ref', '--format=%(refname)', 'refs/heads/']
  ]) assert.equal(allowed(args), true, JSON.stringify(args));
});

test('local-ref retirement can observe its exact bounded native ref fields', () => {
  // This is the actual observeExactLocalRefForJournalRetirement argv shape.
  // Its consumer still checks both field count and full ref identity.
  const observation = [
    'for-each-ref', '--count=2', '--format=%(refname)%00%(objectname)', 'refs/heads/fix/example'
  ];
  assert.equal(allowed(observation), true);
  assert.equal(allowed(['--no-pager', ...observation]), true);
  assert.equal(allowed(['-c', 'core.fsmonitor=false', ...observation]), true);
});

test('bounded ref observation rejects unsupported count syntax and extra capabilities', () => {
  const format = '--format=%(refname)%00%(objectname)';
  const ref = 'refs/heads/fix/example';
  for (const count of ['', '0', '-1', '1', '3', '02', '+2', '2.0', '2 ', 'NaN', 'Infinity', '9007199254740992']) {
    assert.equal(allowed(['for-each-ref', `--count=${count}`, format, ref]), false, count);
  }
  for (const args of [
    ['for-each-ref', '--count', '2', format, ref],
    ['for-each-ref', '--count=2', '--count=2', format, ref],
    ['for-each-ref', format, '--count=2', ref],
    ['for-each-ref', '--count=2', ref],
    ['for-each-ref', '--count=2', format],
    ['for-each-ref', '--count=2', format, '--sort=refname'],
    ['for-each-ref', '--count=2', format, ref, 'refs/heads/other'],
    ['for-each-ref', '--count=2', '--shell', format, ref],
    ['for-each-ref', '--count=2', '--exec', format, ref],
    ['--git-dir', 'for-each-ref', 'update-ref', ref, '1'.repeat(40)],
    ['-c', 'core.hooksPath=/other', 'for-each-ref', '--count=2', format, ref]
  ]) assert.equal(allowed(args), false, JSON.stringify(args));
});
