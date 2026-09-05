import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'bun:test';

import { canonicalGitChildEnvironment } from '../../src/external-capabilities/git/environment.ts';
import { assertGitBranchName } from '../../src/system-architecture/foundation/contract/git-reference.ts';

const environment = canonicalGitChildEnvironment({}, process.env);

function gitAcceptsBranch(name: string): boolean {
  const result = spawnSync('git', ['check-ref-format', '--branch', name], {
    env: environment,
    encoding: 'utf8',
    timeout: 5_000
  });
  if (result.error !== undefined) throw result.error;
  assert.notEqual(result.status, null, `Git was terminated while checking ${JSON.stringify(name)}`);
  return result.status === 0;
}

test('HEAD is a reserved branch argument even though refs/heads/HEAD is a syntactic ref', () => {
  assert.equal(gitAcceptsBranch('HEAD'), false);
  assert.throws(() => assertGitBranchName('HEAD', 'Target branch'), /Target branch must be/);
});

test('the reserved branch check does not broaden to similar permitted names', () => {
  for (const name of ['head', 'Head', 'feature/HEAD', 'HEAD/feature', 'HEAD-feature', 'FETCH_HEAD', 'main', '功能/测试']) {
    assert.equal(gitAcceptsBranch(name), true);
    assert.doesNotThrow(() => assertGitBranchName(name));
  }
});

test('option-safe bounded grammar still rejects revision syntax and malformed branch names', () => {
  for (const name of ['', '@', '@{-1}', '-main', '/main', 'main/', 'main.', 'a..b', 'a//b', 'a/.hidden', 'a.lock', 'a/b.lock', 'a b', 'a:b', 'a~1', 'a^1', 'a?b', 'a*b', 'a[b', 'a\\b', 'a\nb', 'a\0b', 'x'.repeat(256)]) {
    assert.throws(() => assertGitBranchName(name), /bounded option-safe Git branch name/);
  }
});

test('generated names accepted by the SEC boundary remain accepted by native Git', () => {
  let checked = 0;
  for (const stem of ['main', 'feature', 'fix', 'release', 'HEAD', 'head', 'space name', 'dot.lock', '-leading']) {
    for (const suffix of ['', '/one', '/nested/two', '-v2', '.v2', '_v2', '//bad', '/.bad', '/bad.lock', '..bad', '@{1}', '~1']) {
      const name = stem + suffix;
      try { assertGitBranchName(name); } catch { continue; }
      assert.equal(gitAcceptsBranch(name), true, name);
      checked += 1;
    }
  }
  assert.ok(checked > 20);
});
