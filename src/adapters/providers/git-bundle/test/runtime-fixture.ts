import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export function createGitBundleTestFixture() {
  const roots: string[] = [];

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
        GIT_TERMINAL_PROMPT: '0'
      },
      stdout: 'pipe',
      stderr: 'pipe'
    });
    if (result.exitCode !== 0) {
      throw new Error(new TextDecoder().decode(result.stderr));
    }
    return new TextDecoder().decode(result.stdout).trim();
  }

  function repositoryFixture(): Readonly<{
    root: string;
    baseSha: string;
    headSha: string;
  }> {
    const root = temporaryRoot('repository');
    git(root, ['init', '--quiet']);
    git(root, ['config', 'user.name', 'SEC Test']);
    git(root, ['config', 'user.email', 'sec-test@example.invalid']);
    writeFileSync(path.join(root, 'value.txt'), 'base\n');
    git(root, ['add', '--', 'value.txt']);
    git(root, ['commit', '--quiet', '-m', 'base']);
    const baseSha = git(root, ['rev-parse', 'HEAD']);
    writeFileSync(path.join(root, 'value.txt'), 'head\n');
    git(root, ['commit', '--quiet', '-am', 'head']);
    return Object.freeze({ root, baseSha, headSha: git(root, ['rev-parse', 'HEAD']) });
  }
  return { roots, temporaryRoot, git, repositoryFixture };
}
