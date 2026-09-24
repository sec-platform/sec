import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  GIT_READ_DEFAULT_OPERATION_BUDGET,
  GIT_READ_EXACT_TREE_OPERATION_BUDGET,
  GitReadBudgetError,
  boundedGitReadDeadlineAt,
  resolveGitReadSessionBudget
} from '../../src/adapters/providers/git-read/runtime/budget.ts';
import { captureGitReadArguments, gitReadCommandIsObservation } from '../../src/adapters/providers/git-read/runtime/read-command.ts';

// Expected command forms and forbidden mutations are independent protocol
// vectors, not generated from the implementation's sets or regular expressions.
const accepted = [
  ['--version'], ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=no'],
  ['-c', 'core.fsmonitor=false', 'status', '--short'], ['branch', '--show-current'],
  ['cat-file', '--batch'], ['cat-file', '-t', 'HEAD'], ['show', 'HEAD:package.json'],
  ['show-ref', '--verify', '--quiet', 'refs/heads/topic/nested'],
  ['rev-parse', '--verify', 'HEAD^{commit}'], ['rev-parse', '--path-format=absolute', '--git-common-dir'],
  ['worktree', 'list', '--porcelain', '-z'], ['remote', 'get-url', '--all', 'origin'],
  ['config', '--get', 'core.hooksPath'],
  ['config', '--local', '--null', '--get-regexp', '^(extensions\\.worktreeconfig|core\\.hookspath)$'],
  ['config', '--file', '/repo/.git/config.worktree', '--null', '--get', 'core.hooksPath'],
  ['symbolic-ref', '--short', 'HEAD'],
  ['diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', 'HEAD', '--', 'src'],
  ['diff-files', '--name-only'], ['diff-index', '--cached', 'HEAD'],
  ['ls-files', '-z', '--stage'], ['ls-tree', '-r', '-z', '--full-tree', 'HEAD'],
  ['rev-list', '--first-parent', '--ancestry-path', '--reverse', 'main..HEAD'],
  ['merge-base', '--is-ancestor', 'main', 'HEAD'], ['var', 'GIT_AUTHOR_IDENT'],
  ['for-each-ref', '--format=%(refname)', 'refs/heads/'],
  ['for-each-ref', '--contains=0123456789abcdef0123456789abcdef01234567', '--format=%(refname)', 'refs/heads/'],
  ['ls-remote', '--exit-code', 'origin', 'refs/heads/main']
];
const forbidden = [
  [], ['reset', '--hard'], ['checkout', 'main'], ['clean', '-fd'], ['branch', '-D', 'main'],
  ['config', 'core.hooksPath', '/other'],
  ['config', '--local', '--null', '--get-regexp', '.*'],
  ['config', '--file', '-unsafe', '--null', '--get', 'core.hooksPath'],
  ['config', '--file', '/tmp/other', '--null', '--get', 'user.email'],
  ['worktree', 'remove', '/other'],
  ['remote', 'add', 'other', '/other'], ['symbolic-ref', 'HEAD', 'refs/heads/other'],
  ['-c', 'core.hooksPath=/other', 'status'], ['diff', '--ext-diff'], ['show', '--textconv'],
  ['ls-remote', '--upload-pack=other', 'origin', 'refs/heads/main'],
  ['cat-file', '--filters', 'HEAD:source'], ['grep', '--recurse-submodules', 'x'],
  ['show-ref', '--verify', '--quiet', 'refs/tags/release'],
  ['show-ref', '--verify', 'refs/heads/topic'],
  ['for-each-ref', '--contains=HEAD', '--format=%(refname)', 'refs/heads/'],
  ['for-each-ref', '--merged=main', '--format=%(refname)', 'refs/heads/'],
  ['commit', '-m', 'unrequested']
];

test('normal budgets preserve existing defaults, exact-tree duration and selected overrides', () => {
  assert.deepEqual(resolveGitReadSessionBudget(undefined), GIT_READ_DEFAULT_OPERATION_BUDGET);
  const input = { maxProcesses: 3, maxStdinBytes: 1 };
  const budget = resolveGitReadSessionBudget(input); input.maxProcesses = 10;
  assert.equal(budget.maxProcesses, 3); assert.equal(budget.maxStdinBytes, 1);
  assert.equal(resolveGitReadSessionBudget(GIT_READ_EXACT_TREE_OPERATION_BUDGET).deadlineMs, 120000);
  assert.ok(Object.isFrozen(budget));
});

test('a getter is observed once and cannot enlarge its validated budget at publication', () => {
  let calls = 0;
  const budget = resolveGitReadSessionBudget({ get maxProcesses() { return ++calls === 1 ? 3 : 10000; } });
  assert.equal(calls, 1); assert.equal(budget.maxProcesses, 3);
});

test('unknown and prototype-named fields are not budget decisions and their getters do not run', () => {
  for (const field of ['constructor', '__proto__', 'toString', 'unrelated']) {
    let called = false;
    const input = Object.defineProperty({}, field, { enumerable: true, get() { called = true; return 1; } });
    assert.throws(() => resolveGitReadSessionBudget(input), error =>
      error instanceof GitReadBudgetError && error.reason === 'unknown-field' && error.field === field);
    assert.equal(called, false);
  }
});

test('invalid containers and numbers cannot select implicit or expanded budget policies', () => {
  for (const value of [null, false, 0, '', []]) assert.throws(() => resolveGitReadSessionBudget(value as never));
  for (const value of [0, -1, undefined, null, '1', NaN, Infinity, 0.5]) {
    assert.throws(() => resolveGitReadSessionBudget({ maxProcesses: value as never }), GitReadBudgetError);
  }
  assert.throws(() => resolveGitReadSessionBudget({ maxProcesses: 129 }), error =>
    error instanceof GitReadBudgetError && error.reason === 'canonical-ceiling-exceeded');
  assert.throws(() => resolveGitReadSessionBudget({ maxStdoutBytes: 256 * 1024 * 1024 + 1 }), error =>
    error instanceof GitReadBudgetError && error.reason === 'canonical-ceiling-exceeded');
  assert.throws(() => resolveGitReadSessionBudget({
    maxCommandStdoutBytes: GIT_READ_EXACT_TREE_OPERATION_BUDGET.maxCommandStdoutBytes + 1
  }), error => error instanceof GitReadBudgetError && error.reason === 'canonical-ceiling-exceeded');
});

test('exact-tree budget explicitly admits the bounded source snapshot envelope', () => {
  assert.equal(GIT_READ_DEFAULT_OPERATION_BUDGET.maxStdoutBytes, 64 * 1024 * 1024);
  assert.equal(GIT_READ_DEFAULT_OPERATION_BUDGET.maxCommandStdoutBytes, 32 * 1024 * 1024);
  assert.equal(GIT_READ_EXACT_TREE_OPERATION_BUDGET.maxStdoutBytes, 256 * 1024 * 1024);
  assert.equal(
    GIT_READ_EXACT_TREE_OPERATION_BUDGET.maxCommandStdoutBytes,
    128 * 1024 * 1024 + 250_000 * 128
  );
  assert.deepEqual(
    resolveGitReadSessionBudget(GIT_READ_EXACT_TREE_OPERATION_BUDGET),
    GIT_READ_EXACT_TREE_OPERATION_BUDGET
  );
});

test('parent deadlines only tighten the selected local observation window', () => {
  const budget = resolveGitReadSessionBudget({ deadlineMs: 100 });
  assert.equal(boundedGitReadDeadlineAt(1000, budget, 1050), 1050);
  assert.equal(boundedGitReadDeadlineAt(1000, budget, 1200), 1100);
  assert.equal(boundedGitReadDeadlineAt(1000, budget, undefined), 1100);
  for (const value of [-1, NaN, Infinity, 0.5, null]) {
    assert.throws(() => boundedGitReadDeadlineAt(1000, budget, value as never), GitReadBudgetError);
  }
});

test('captured argv retains ordinary read grammar with its exact UTF-8 byte charge', () => {
  for (const args of accepted) {
    const captured = captureGitReadArguments(args, 4096);
    assert.equal(captured.status, 'ready');
    if (captured.status !== 'ready') throw new Error('Expected an admitted vector');
    assert.equal(gitReadCommandIsObservation(captured.args), true, JSON.stringify(args));
    assert.equal(captured.bytes, Buffer.byteLength(args.join('\0') + '\0', 'utf8'));
    assert.notEqual(captured.args, args); assert.ok(Object.isFrozen(captured.args));
  }
});

test('capturing arguments never grants mutation or external-helper grammar', () => {
  for (const args of forbidden) {
    const captured = captureGitReadArguments(args, 4096);
    assert.equal(captured.status, 'ready');
    if (captured.status !== 'ready') throw new Error('Expected structurally valid argv');
    assert.equal(gitReadCommandIsObservation(captured.args), false, JSON.stringify(args));
  }
});

test('argv snapshots ignore custom iteration and method replacements', () => {
  const input = ['status', '--short'];
  input[Symbol.iterator] = () => ['reset'].values();
  input.slice = () => ['reset']; input.indexOf = () => -1;
  const captured = captureGitReadArguments(input, 4096);
  assert.equal(captured.status, 'ready');
  if (captured.status !== 'ready') throw new Error('Expected dense own string arguments');
  input[0] = 'reset';
  assert.deepEqual(captured.args, ['status', '--short']); assert.equal(gitReadCommandIsObservation(captured.args), true);
});

test('accessors, holes, inherited slots and NUL are refused without invoking array accessors', () => {
  let reads = 0;
  const accessor: string[] = [];
  Object.defineProperty(accessor, '0', { get() { reads++; return '--version'; } });
  for (const value of [accessor, new Array(1), [null], [1], ['a\0b'], {}, null]) {
    assert.equal(captureGitReadArguments(value as never, 4096).status, 'invalid');
  }
  assert.equal(reads, 0);
});

test('the argv byte budget includes UTF-8 and argument terminators and stops before later fields', () => {
  assert.equal(captureGitReadArguments(['好'], 4).status, 'ready');
  assert.equal(captureGitReadArguments(['好'], 3).status, 'exhausted');
  let observed = false;
  const args = ['too-long']; Object.defineProperty(args, '1', { get() { observed = true; throw new Error('later field'); } });
  assert.equal(captureGitReadArguments(args, 1).status, 'exhausted'); assert.equal(observed, false);
  for (const value of [-1, NaN, Infinity, 0.5]) assert.equal(captureGitReadArguments([], value).status, 'exhausted');
});
