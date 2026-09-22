import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { assertLowercaseGitSha, parseWorktreePorcelainZ, parseWorktreeStatusPorcelainZ } from '../../src/adapters/runtime-state/physical/contract/git-worktree-observation.ts';
import { gitProtocolSuccess, inGitProtocolRepository } from '../testkit/git-protocol.ts';

const oid = 'a'.repeat(40);
const record = (...fields: string[]) => Buffer.from(['worktree /fixture', ...fields, '', ''].join('\0'));

test('bare and HEAD cannot describe the same worktree in either field order', () => {
  for (const fields of [['bare', `HEAD ${oid}`], [`HEAD ${oid}`, 'bare']]) {
    assert.throws(() => parseWorktreePorcelainZ(record(...fields)), /bare.*HEAD/);
  }
});

test('bare, detached and branch records keep their distinct required fields', () => {
  assert.deepEqual(parseWorktreePorcelainZ(record('bare')), [{ path: '/fixture', headSha: null, branch: null,
    bare: true, detached: false, locked: false, prunable: false }]);
  assert.equal(parseWorktreePorcelainZ(record(`HEAD ${oid}`, 'detached'))[0]!.detached, true);
  assert.equal(parseWorktreePorcelainZ(record(`HEAD ${'0'.repeat(40)}`, 'branch refs/heads/unborn'))[0]!.branch, 'unborn');
  for (const fields of [['detached'], ['branch refs/heads/branch'], [`HEAD ${oid}`],
    ['bare', 'detached'], ['bare', 'branch refs/heads/branch']]) {
    assert.throws(() => parseWorktreePorcelainZ(record(...fields)));
  }
});

test('a dot-leading component is invalid at every depth, not only the beginning', () => {
  for (const branch of ['.hidden', 'topic/.hidden', 'topic/.hidden/leaf', 'topic/../leaf']) {
    assert.throws(() => parseWorktreePorcelainZ(record(`HEAD ${oid}`, `branch refs/heads/${branch}`)), /branch field/);
  }
  for (const branch of ['main', 'topic/sub.name', 'topic/@name', '分支/主题']) {
    assert.equal(parseWorktreePorcelainZ(record(`HEAD ${oid}`, `branch refs/heads/${branch}`))[0]!.branch, branch);
  }
});

test('object-id assertion never coerces a non-string or evaluates caller conversion hooks', () => {
  let coerced = false;
  const value = { toString() { coerced = true; return oid; } };
  assert.throws(() => assertLowercaseGitSha(value as never, 'HEAD'));
  assert.equal(coerced, false);
  assert.throws(() => assertLowercaseGitSha(BigInt('1'.repeat(40)) as never, 'HEAD'));
  assertLowercaseGitSha(oid, 'HEAD');
  // The closeout contract remains SHA1-only; this change does not silently widen it.
  assert.throws(() => assertLowercaseGitSha('a'.repeat(64), 'HEAD'));
});

test('only documented conflict pairs may contain an unmerged marker', () => {
  for (const pair of ['U ', ' U', 'UM', 'MU', 'UT', 'TU', 'UR', 'RU', 'UC', 'CU']) {
    assert.throws(() => parseWorktreeStatusPorcelainZ(Buffer.from(`${pair} conflict\0`)), /status pair/);
  }
});

test('all seven merge-conflict pairs remain valid, including those with no U character', () => {
  for (const pair of ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']) {
    assert.deepEqual(parseWorktreeStatusPorcelainZ(Buffer.from(`${pair} conflict\0`)), [
      { index: pair[0], worktree: pair[1], path: 'conflict', originalPath: null }
    ]);
  }
});

test('non-conflict modified, renamed, ignored and staged-deletion plus untracked records are unchanged', () => {
  const raw = 'MM modified\0R  destination\0source\0!! ignored/\0D  kept\0?? kept\0';
  assert.deepEqual(parseWorktreeStatusPorcelainZ(Buffer.from(raw)), [
    { index: 'M', worktree: 'M', path: 'modified', originalPath: null },
    { index: 'R', worktree: ' ', path: 'destination', originalPath: 'source' },
    { index: '!', worktree: '!', path: 'ignored', originalPath: null },
    { index: 'D', worktree: ' ', path: 'kept', originalPath: null },
    { index: '?', worktree: '?', path: 'kept', originalPath: null }
  ]);
});

test('real Git conflict stages project to the same seven exact status pairs', () => inGitProtocolRepository(async (_root, git) => {
  const blob = gitProtocolSuccess(git(['hash-object', '-w', '--stdin'], undefined, 'content\n')).trim();
  // Stage presence is input; expected status pairs are independently stated below.
  const indexRecords: string[] = [];
  for (let mask = 1; mask <= 7; mask++) for (let stage = 1; stage <= 3; stage++) {
    if ((mask & (1 << (stage - 1))) !== 0) indexRecords.push(`100644 ${blob} ${stage}\tmask${mask}\n`);
  }
  gitProtocolSuccess(git(['update-index', '--index-info'], undefined, indexRecords.join('')));
  const source = gitProtocolSuccess(git(['status', '--porcelain=v1', '-z', '--untracked-files=no']));
  assert.deepEqual(parseWorktreeStatusPorcelainZ(Buffer.from(source)).map(value => [value.path, value.index + value.worktree]), [
    ['mask1', 'DD'], ['mask2', 'AU'], ['mask3', 'UD'], ['mask4', 'UA'], ['mask5', 'DU'], ['mask6', 'AA'], ['mask7', 'UU']
  ]);
}));

test('real Git rejects nested dot components while ordinary branch names still parse', () => inGitProtocolRepository(async (_root, git) => {
  for (const branch of ['topic/.hidden', 'topic/.hidden/leaf']) {
    const response = git(['check-ref-format', `refs/heads/${branch}`]);
    assert.equal(response.error, undefined); assert.equal(response.status, 1);
    assert.throws(() => parseWorktreePorcelainZ(record(`HEAD ${oid}`, `branch refs/heads/${branch}`)));
  }
  for (const branch of ['topic/sub.name', '分支/主题']) {
    gitProtocolSuccess(git(['check-ref-format', `refs/heads/${branch}`]));
    assert.equal(parseWorktreePorcelainZ(record(`HEAD ${oid}`, `branch refs/heads/${branch}`))[0]!.branch, branch);
  }
}));

test('real worktree inventory preserves branch, detached, locked and bare variants', () => inGitProtocolRepository(async (root, git) => {
  writeFileSync(path.join(root, 'tracked'), 'data');
  gitProtocolSuccess(git(['add', '--', 'tracked']));
  gitProtocolSuccess(git(['commit', '-qm', 'fixture']));
  const head = gitProtocolSuccess(git(['rev-parse', 'HEAD'])).trim();
  const detached = path.join(root, 'detached');
  gitProtocolSuccess(git(['worktree', 'add', '--quiet', '--detach', detached, head]));
  gitProtocolSuccess(git(['worktree', 'lock', '--reason', 'fixture\nreason', detached]));
  const rows = parseWorktreePorcelainZ(Buffer.from(gitProtocolSuccess(git(['worktree', 'list', '--porcelain', '-z']))));
  const main = rows.find(row => row.path === root)!, child = rows.find(row => row.path === detached)!;
  assert.equal(main.headSha, head); assert.equal(main.bare, false); assert.equal(main.detached, false);
  assert.ok(main.branch); assert.equal(child.headSha, head); assert.equal(child.detached, true);
  assert.equal(child.branch, null); assert.equal(child.locked, true);
  const bare = path.join(root, 'bare.git');
  gitProtocolSuccess(git(['init', '--bare', '--quiet', bare]));
  const bareRows = parseWorktreePorcelainZ(Buffer.from(gitProtocolSuccess(git(['--git-dir', bare, 'worktree', 'list', '--porcelain', '-z']))));
  assert.equal(bareRows.length, 1); assert.equal(bareRows[0]!.bare, true); assert.equal(bareRows[0]!.headSha, null);
}));
