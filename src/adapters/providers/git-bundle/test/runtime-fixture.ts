import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export function createGitBundleTestFixture() {
  const roots: string[] = [];
  // This seed has completed both native commits before any case copies it.
  // No case can mutate the template: .git, index, refs, objects and working
  // file are copied into its own root before any candidate effect occurs.
  let template: Readonly<{ root: string; baseSha: string; headSha: string }> | null = null;

  function temporaryRoot(label: string): string {
    const root = mkdtempSync(path.join(tmpdir(), `sec-git-bundle-${label}-`));
    roots.push(root);
    return root;
  }

  function git(cwd: string, args: readonly string[]): string {
    const result = Bun.spawnSync(['git', ...args], {
      cwd,
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0',
        GIT_AUTHOR_NAME: 'SEC Test',
        GIT_AUTHOR_EMAIL: 'sec-test@example.invalid',
        GIT_COMMITTER_NAME: 'SEC Test',
        GIT_COMMITTER_EMAIL: 'sec-test@example.invalid'
      },
      stdout: 'pipe',
      stderr: 'pipe'
    });
    if (result.exitCode !== 0) {
      throw new Error(new TextDecoder().decode(result.stderr));
    }
    return new TextDecoder().decode(result.stdout).trim();
  }

  function initializedRepositoryTemplate(): NonNullable<typeof template> {
    if (template !== null) return template;
    const root = mkdtempSync(path.join(tmpdir(), 'sec-git-bundle-seed-'));
    try {
      git(root, ['init', '--quiet']);
      writeFileSync(path.join(root, 'value.txt'), 'base\n');
      git(root, ['add', '--', 'value.txt']);
      git(root, ['commit', '--quiet', '-m', 'base']);
      writeFileSync(path.join(root, 'value.txt'), 'head\n');
      git(root, ['commit', '--quiet', '-am', 'head']);
      const revisions = git(root, ['rev-parse', 'HEAD^', 'HEAD']).split(/\r?\n/u);
      if (revisions.length !== 2 || revisions.some(sha => !/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/u.test(sha))) {
        throw new Error('Expected one base and one head Git commit identity.');
      }
      template = Object.freeze({ root, baseSha: revisions[0]!, headSha: revisions[1]! });
      return template;
    } catch (error) {
      try { rmSync(root, { recursive: true, force: true }); }
      catch (cleanup) {
        throw new AggregateError([error, cleanup], 'Git bundle seed creation and cleanup failed');
      }
      throw error;
    }
  }

  function repositoryFixture(): Readonly<{
    root: string;
    baseSha: string;
    headSha: string;
  }> {
    const source = initializedRepositoryTemplate();
    const root = temporaryRoot('repository');
    // Ordinary copies, never links or shared Git object alternatives. Even a
    // test that rewrites refs, config, index or objects cannot affect its peers.
    cpSync(path.join(source.root, '.git'), path.join(root, '.git'), {
      recursive: true, errorOnExist: true, force: false
    });
    cpSync(path.join(source.root, 'value.txt'), path.join(root, 'value.txt'), {
      errorOnExist: true, force: false
    });
    return Object.freeze({ root, baseSha: source.baseSha, headSha: source.headSha });
  }

  function dispose(): void {
    if (template !== null) {
      rmSync(template.root, { recursive: true, force: true });
      template = null;
    }
  }

  return { roots, temporaryRoot, git, repositoryFixture, dispose };
}
