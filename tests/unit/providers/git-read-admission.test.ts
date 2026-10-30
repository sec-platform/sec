import { test } from 'bun:test';
import assert from 'node:assert/strict';
import {
  GIT_READ_DEFAULT_OPERATION_BUDGET,
  GIT_READ_EXACT_TREE_OPERATION_BUDGET,
  GitReadBudgetError,
  boundedGitReadDeadlineAt,
  resolveGitReadSessionBudget
} from '../../../src/adapters/providers/git-read/runtime/budget.ts';
import { captureGitReadArguments, gitReadCommandIsObservation } from '../../../src/adapters/providers/git-read/runtime/read-command.ts';

const head = 'a'.repeat(40);
const pathCommands = [
  ['status', '--short'], ['diff', '--name-only', head], ['diff-files', '--name-only'],
  ['diff-index', '--name-only', head], ['ls-files', '-z'], ['ls-tree', '--name-only', head],
  ['rev-list', '--first-parent', '--full-history', '--show-pulls', '--count', `${head}..${head}`]
];

// Expected command forms and forbidden mutations are independent protocol
// vectors, not generated from the implementation's sets or regular expressions.
const accepted = [
  // Session-level grammar vectors live at this shared admission owner.
  ['status','--porcelain=v1','-z','--untracked-files=all'],
  ['rev-parse','--absolute-git-dir'],
  ['rev-list','--first-parent','--ancestry-path','--reverse','HEAD'],
  ['--version'], ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=no'],
  ['-c', 'core.fsmonitor=false', 'status', '--short'], ['branch', '--show-current'],
  ['cat-file', '--batch'], ['cat-file', '-t', 'HEAD'], ['show', 'HEAD:package.json'],
  ['rev-parse', '--verify', 'HEAD^{commit}'], ['rev-parse', '--path-format=absolute', '--git-common-dir'],
  ['worktree', 'list', '--porcelain', '-z'], ['remote', 'get-url', '--all', 'origin'],
  ['config', '--get', 'core.hooksPath'], ['symbolic-ref', '--short', 'HEAD'],
  ['diff', '--no-ext-diff', '--no-textconv', '--name-only', '-z', 'HEAD', '--', 'src'],
  ['diff-files', '--name-only'], ['diff-index', '--cached', 'HEAD'],
  ['ls-files', '-z', '--stage'], ['ls-tree', '-r', '-z', '--full-tree', 'HEAD'],
  ['rev-list', '--first-parent', '--ancestry-path', '--reverse', 'main..HEAD'],
  ['merge-base', '--is-ancestor', 'main', 'HEAD'], ['var', 'GIT_AUTHOR_IDENT'],
  ['for-each-ref', '--format=%(refname)', 'refs/heads/'], ['ls-remote', '--exit-code', 'origin', 'refs/heads/main'],
  ['status', '--porcelain=v1', '-z'], ['ls-files', '--stage', '-z'],
  ['ls-tree', '-r', '-z', 'HEAD'], ['rev-parse', '--verify', 'HEAD'],
  ['diff', '--no-ext-diff', '--name-only', 'HEAD'], ['remote', 'get-url', 'origin'], ['rev-list', '--count', 'HEAD'],
  // Remaining positional/global and exact-ref obligations share this owner.
  ...[
    ['branch', '--show-current'], ['config', '--get', 'core.hooksPath'],
    ['show', 'HEAD:package.json'], ['worktree', 'list', '--porcelain'],
    ['symbolic-ref', '--short', 'HEAD'], ['var', 'GIT_AUTHOR_IDENT']
  ].map(command => ['--git-dir', command[0]!, ...command]),
  ['--git-dir', 'show', '--work-tree', 'show', '--no-pager', 'show', 'HEAD:file'],
  ['-c', 'core.fsmonitor=false', '--git-dir', 'branch', '--literal-pathspecs', 'branch', '--show-current'],
  ['ls-remote', '--exit-code', 'origin', 'refs/pull/573/head'],
  ['ls-remote', 'origin', 'refs/heads/main'],
  ...[
    [], ['--no-pager'], ['-c', 'core.fsmonitor=false']
  ].map(prefix => [...prefix, 'for-each-ref', '--count=2', '--format=%(refname)%00%(objectname)', 'refs/heads/fix/example']),
  // Keep the full option/data grammar available without an installed Git.
  ...pathCommands.flatMap(prefix => (prefix[0] === 'ls-files'
    ? ['--textconv', '--ext-diff', '--cached', '--exec', '--filter=blob:none', '--upload-pack=x', '-odd', '--']
    : ['--textconv']).map(name => [...prefix, '--', name])),
  ['diff-files', '--', '--cached'],
  ...['--textconv', '--recurse-submodules', '--upload-pack=x', '-e', '--']
    .map(pattern => ['grep', '-F', '-l', '-z', '-e', pattern, head, '--', '.']),
  ['cat-file', '--batch-check'],
  ['rev-parse', '--revs-only', '--end-of-options', `${head}^{tree}`, `${head}:manifest.md`]
];
const forbidden = [
  // Session-level grammar vectors live at this shared admission owner.
  ['write-tree'],
  ['hash-object','-w','--stdin'],
  ['update-index','-z','--index-info'],
  ['config','user.name','unauthorized-writer'],
  ['branch','unauthorized-writer'],
  ['symbolic-ref','--delete','HEAD'],
  ['-c','core.hooksPath=unauthorized','status'],
  ['diff','--textconv'],
  ['cat-file','--filters','HEAD:package.json'],
  ['rev-list','--use-bitmap-index','--filter=blob:none','HEAD'],
  ['show','--format=%(trailers:only,unfold,key=SEC,separator=%x00)','HEAD'],
  [], ['reset', '--hard'], ['checkout', 'main'], ['clean', '-fd'], ['branch', '-D', 'main'],
  ['config', 'core.hooksPath', '/other'], ['worktree', 'remove', '/other'],
  ['remote', 'add', 'other', '/other'], ['symbolic-ref', 'HEAD', 'refs/heads/other'],
  ['-c', 'core.hooksPath=/other', 'status'], ['diff', '--ext-diff'], ['show', '--textconv'],
  ['ls-remote', '--upload-pack=other', 'origin', 'refs/heads/main'],
  ['cat-file', '--filters', 'HEAD:source'], ['grep', '--recurse-submodules', 'x'], ['commit', '-m', 'unrequested'],
  ['--git-dir', 'branch', 'branch', '-D', 'main'],
  ['--work-tree', 'config', 'config', 'core.hooksPath', '/other'],
  ['--git-dir', 'status', 'reset', '--hard'],
  ['--git-dir', 'worktree', 'worktree', 'remove', '/other'],
  ['--work-tree', 'show', 'show', '--textconv'],
  ['--git-dir'], ['--work-tree'], ['-c'], ['--git-dir', 'branch'],
  ['--unknown', 'branch', '--show-current'], ['--version', 'status'],
  ...['refs/pull/0/head', 'refs/pull/01/head', 'refs/pull/573/merge',
    'refs/pull/*/head', 'refs/pull/573/head*', 'refs/pull/573/head/other', 'refs/tags/main']
    .map(ref => ['ls-remote', '--exit-code', 'origin', ref]),
  ['ls-remote', '--exit-code', 'origin', 'refs/pull/573/head', 'refs/heads/main'],
  ...['', '0', '-1', '1', '3', '02', '+2', '2.0', '2 ', 'NaN', 'Infinity', '9007199254740992']
    .map(count => ['for-each-ref', `--count=${count}`, '--format=%(refname)%00%(objectname)', 'refs/heads/fix/example']),
  ['for-each-ref', '--count', '2', '--format=%(refname)%00%(objectname)', 'refs/heads/fix/example'],
  ['for-each-ref', '--count=2', '--count=2', '--format=%(refname)%00%(objectname)', 'refs/heads/fix/example'],
  ['for-each-ref', '--format=%(refname)%00%(objectname)', '--count=2', 'refs/heads/fix/example'],
  ['for-each-ref', '--count=2', 'refs/heads/fix/example'],
  ['for-each-ref', '--count=2', '--format=%(refname)%00%(objectname)'],
  ['for-each-ref', '--count=2', '--format=%(refname)%00%(objectname)', 'refs/heads/fix/example', '--sort=refname'],
  ['for-each-ref', '--count=2', '--format=%(refname)%00%(objectname)', 'refs/heads/fix/example', 'refs/heads/other'],
  ['for-each-ref', '--count=2', '--shell', '--format=%(refname)%00%(objectname)', 'refs/heads/fix/example'],
  ['for-each-ref', '--count=2', '--exec', '--format=%(refname)%00%(objectname)', 'refs/heads/fix/example'],
  ['--git-dir', 'for-each-ref', 'update-ref', 'refs/heads/fix/example', '1'.repeat(40)],
  ['-c', 'core.hooksPath=/other', 'for-each-ref', '--count=2', '--format=%(refname)%00%(objectname)', 'refs/heads/fix/example'],
  ...pathCommands.flatMap(prefix => (prefix[0] === 'ls-files'
    ? ['--textconv', '--ext-diff', '--exec', '--exec=unsafe', '--filter=blob:none', '--upload-pack=x']
    : ['--textconv']).map(option => [...prefix, option, '--', 'file'])),
  ['rev-list', '--first-parent', '--exec=unsafe', `${head}..${head}`, '--', 'file'],
  ['diff-files', '--cached', '--', 'file'],
  ['grep', '--textconv', '-e', 'literal', head, '--', '.'],
  ['grep', '--recurse-submodules', '-e', 'literal', head, '--', '.'],
  ['grep', '-e', '', head, '--', '.'], ['grep', '-e', 'literal', 'HEAD', '--', '.'],
  ['grep', '-e', 'literal', head, '--', 'other'], ['grep', '-e', 'literal', head, '--', '.', '--'],
  ['reset', '--', 'file'], ['checkout', '--', 'file'], ['update-index', '--', 'file'],
  ['config', '--get', 'key', '--', 'other'], ['-c', 'core.hooksPath=other', 'status', '--', 'file'],
  ['branch', '--', '--show-current'],
  ['cat-file', '--batch-check', '--textconv'], ['cat-file', '--batch-check', '--filters'],
  ['cat-file', '--batch-check=%(objectname)'], ['cat-file', '--batch-command'],
  ['rev-parse', '--revs-only', '--exec=unsafe'], ['rev-parse', '--revs-only', '--upload-pack=unsafe']
];

test('normal budgets preserve existing defaults, exact-tree duration and selected overrides', () => {
  assert.deepEqual(resolveGitReadSessionBudget(undefined), GIT_READ_DEFAULT_OPERATION_BUDGET);
  const input = { maxProcesses: 3, maxStdinBytes: 1 };
  const budget = resolveGitReadSessionBudget(input); input.maxProcesses = 10;
  assert.equal(budget.maxProcesses, 3); assert.equal(budget.maxStdinBytes, 1);
  assert.deepEqual(
    resolveGitReadSessionBudget(GIT_READ_EXACT_TREE_OPERATION_BUDGET),
    GIT_READ_EXACT_TREE_OPERATION_BUDGET
  );
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

test('parent deadlines only tighten the selected local observation window', () => {
  const budget = resolveGitReadSessionBudget({ deadlineMs: 100 });
  assert.equal(boundedGitReadDeadlineAt(1000, budget, 1050), 1050);
  assert.equal(boundedGitReadDeadlineAt(1000, budget, 1200), 1100);
  assert.equal(boundedGitReadDeadlineAt(1000, budget, undefined), 1100);
  for (const value of [-1, NaN, Infinity, 0.5, null]) {
    assert.throws(() => boundedGitReadDeadlineAt(1000, budget, value as never), GitReadBudgetError);
  }
});

test('ordinary read vectors remain admitted and byte capture retains their grammar', () => {
  for (const args of accepted) {
    if (args[0] === 'diff' && args.includes('--')) {
      const captured = captureGitReadArguments(args, 4096);
      assert.equal(captured.status, 'ready');
      if (captured.status !== 'ready') throw new Error('Expected an admitted vector');
      assert.deepEqual(captured.args, args);
      assert.equal(captured.bytes, Buffer.byteLength(args.join('\0') + '\0', 'utf8'));
      assert.equal(gitReadCommandIsObservation(captured.args), true);
    } else assert.equal(gitReadCommandIsObservation(args), true, JSON.stringify(args));
  }
});

test('capturing arguments never grants mutation or external-helper grammar', () => {
  for (const args of forbidden) {
    if (args.length === 0 || args[0] === 'reset') {
      const captured = captureGitReadArguments(args, 4096);
      assert.equal(captured.status, 'ready');
      if (captured.status !== 'ready') throw new Error('Expected structurally valid argv');
      assert.deepEqual(captured.args, args);
      assert.equal(gitReadCommandIsObservation(captured.args), false);
    } else assert.equal(gitReadCommandIsObservation(args), false, JSON.stringify(args));
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
  assert.equal(Reflect.set(captured.args, '0', 'reset'), false);
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
});
