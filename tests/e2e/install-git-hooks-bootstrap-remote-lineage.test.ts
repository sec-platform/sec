import { expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { configuredManagedHooksPath, expectManagedHooksMirror, git, installGitHooks, managedHookNames, managedHookSource, withCanonicalRemoteRepository } from './fixtures/install-git-hooks.ts';
test('primary bootstrap pins its admitted local lineage while remote state advances independently', async () => {
  await withCanonicalRemoteRepository(async (repoRoot) => {
    const initial = git(repoRoot, ['rev-parse', 'HEAD']);
    let advanced = false;
    expect(await installGitHooks({
      repoRoot,
      lifecycle: true,
      noRemoteFixture: false,
      bootstrapAuthorityActorBeforeConfigEffect: (actorRoot) => {
        if (advanced) return;
        advanced = true;
        writeFileSync(path.join(actorRoot, 'REMOTE-DRIFT.md'), 'remote drift\n', 'utf8');
        git(actorRoot, ['add', 'REMOTE-DRIFT.md']);
        git(actorRoot, ['commit', '--quiet', '-m', 'remote authority drift']);
        git(actorRoot, ['push', '--quiet', 'origin', 'main']);
        git(actorRoot, ['reset', '--quiet', '--hard', initial]);
        git(actorRoot, ['update-ref', 'refs/remotes/origin/main', initial]);
        git(actorRoot, ['symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main']);
      }
    })).toMatchObject({ status: 'installed' });
    await expectManagedHooksMirror(repoRoot, configuredManagedHooksPath(repoRoot));
  });
});

test('repository-common hook generation runs when an older worktree creates the first checkout', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'sec-hooks-first-checkout-'));
  const repoRoot = path.join(root, 'main');
  const olderRoot = path.join(root, 'older');
  const linkedRoot = path.join(root, 'linked');
  try {
    await mkdir(repoRoot);
    git(repoRoot, ['init', '--quiet', '-b', 'main']);
    git(repoRoot, ['config', 'user.email', 'tests@example.com']);
    git(repoRoot, ['config', 'user.name', 'SEC Tests']);
    await writeFile(path.join(repoRoot, 'README.md'), 'fixture\n', 'utf8');
    // Both revisions supply the package entry invoked by the managed hook.
    // The fixture observes dispatch; package metadata is verified separately.
    await writeFile(path.join(repoRoot, 'package.json'), JSON.stringify({
      scripts: { 'workspace:transition': '"$npm_execpath" -e "process.exit(0)"' }
    }));
    git(repoRoot, ['add', 'README.md', 'package.json']);
    git(repoRoot, ['commit', '--quiet', '-m', 'older checkout without managed hooks']);
    const olderHead = git(repoRoot, ['rev-parse', 'HEAD']);

    await mkdir(path.join(repoRoot, '.githooks'));
    await writeFile(path.join(repoRoot, '.gitattributes'), '/.githooks/* text eol=lf\n', 'utf8');
    await Promise.all(managedHookNames.map(async (hook) => {
      const hookPath = path.join(repoRoot, '.githooks', hook);
      await writeFile(
        hookPath,
        hook === 'post-checkout'
          // A command after exec is unreachable; observe dispatch before it.
          ? managedHookSource(hook).replace('exec bun',
            'printf first-checkout > .dependency-bootstrap-marker\nexec bun')
          : managedHookSource(hook),
        'utf8'
      );
      await chmod(hookPath, 0o755);
    }));
    git(repoRoot, [
      'add',
      '.gitattributes',
      'README.md',
      '.githooks'
    ]);
    for (const hook of managedHookNames) {
      git(repoRoot, ['update-index', '--chmod=+x', `.githooks/${hook}`]);
    }
    git(repoRoot, ['commit', '--quiet', '-m', 'install managed hooks']);
    const managedHead = git(repoRoot, ['rev-parse', 'HEAD']);

    expect(await installGitHooks({ repoRoot })).toMatchObject({ status: 'installed' });
    const configured = configuredManagedHooksPath(repoRoot);
    git(repoRoot, ['worktree', 'add', '--quiet', '--detach', olderRoot, olderHead]);
    await rm(path.join(olderRoot, '.dependency-bootstrap-marker'), { force: true });
    expect(() => git(olderRoot, ['ls-files', '--error-unmatch', '.githooks/post-checkout'])).toThrow();

    git(olderRoot, ['worktree', 'add', '--quiet', '-b', 'linked-first-checkout', linkedRoot, managedHead]);

    expect(await readFile(path.join(linkedRoot, '.dependency-bootstrap-marker'), 'utf8')).toBe('first-checkout');
    expect(await installGitHooks({ repoRoot: linkedRoot })).toMatchObject({ status: 'installed' });
    expect(path.resolve(git(linkedRoot, ['config', '--local', '--get', 'core.hooksPath']))).toBe(configured);
    const linkedGeneration = configuredManagedHooksPath(linkedRoot);
    expect(linkedGeneration).not.toBe(configured);
    expect(path.resolve(git(linkedRoot, ['config', '--get', 'core.hooksPath']))).toBe(linkedGeneration);
    await expectManagedHooksMirror(linkedRoot, linkedGeneration);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
