import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { runStagedImportCheck } from '../../src/development/runner/import-organizer.ts';

function git(repoRoot: string, args: readonly string[], bytes = false): string | Buffer {
  const result = spawnSync('git', [...args], {
    cwd: repoRoot,
    encoding: bytes ? 'buffer' : 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${Buffer.from(result.stderr).toString('utf8')}`);
  }
  return bytes ? Buffer.from(result.stdout) : String(result.stdout);
}

function source(order: 'sorted' | 'unsorted'): string {
  const names = order === 'sorted' ? ['alpha', 'beta'] : ['beta', 'alpha'];
  return [
    'import {',
    `  ${names[0]},`,
    `  ${names[1]}`,
    "} from './values.ts';",
    '',
    'export const answer = alpha + beta;',
    ''
  ].join('\n');
}

test('staged check is pure while another Git owner retains the index lock', async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'sec-imports-check-lock-'));
  try {
    git(repoRoot, ['init', '--quiet']);
    git(repoRoot, ['config', 'user.email', 'tests@example.com']);
    git(repoRoot, ['config', 'user.name', 'SEC Tests']);
    git(repoRoot, ['config', 'core.autocrlf', 'false']);
    await Promise.all([
      writeFile(path.join(repoRoot, 'tsconfig.json'), `${JSON.stringify({
        compilerOptions: {
          allowImportingTsExtensions: true,
          module: 'ESNext',
          moduleResolution: 'Bundler',
          noEmit: true,
          target: 'ES2022'
        },
        include: ['**/*.ts']
      }, null, 2)}\n`, 'utf8'),
      writeFile(path.join(repoRoot, 'values.ts'), 'export const alpha = 1; export const beta = 2;\n', 'utf8'),
      writeFile(path.join(repoRoot, 'fixture.ts'), source('sorted'), 'utf8')
    ]);
    git(repoRoot, ['add', '--all']);
    git(repoRoot, ['commit', '--quiet', '-m', 'initial']);

    const fixturePath = path.join(repoRoot, 'fixture.ts');
    const tsconfigPath = path.join(repoRoot, 'tsconfig.json');
    await writeFile(fixturePath, source('unsorted'), 'utf8');
    git(repoRoot, ['add', 'fixture.ts']);
    await writeFile(tsconfigPath, '{ invalid unstaged config', 'utf8');
    const beforeIndex = git(repoRoot, ['ls-files', '--stage', '-z'], true);
    const beforeWorking = await readFile(fixturePath);
    const indexPath = String(git(
      repoRoot,
      ['rev-parse', '--path-format=absolute', '--git-path', 'index']
    )).trim();
    const lockPath = `${indexPath}.lock`;
    await writeFile(lockPath, 'retained-by-git-owner', { flag: 'wx' });

    const outcome = await runStagedImportCheck(repoRoot);

    expect(outcome).toEqual({
      schema: 'sec-import-check-outcome-v1',
      status: 'needs-import-transform',
      files: ['fixture.ts']
    });
    expect(git(repoRoot, ['ls-files', '--stage', '-z'], true)).toEqual(beforeIndex);
    expect(await readFile(fixturePath)).toEqual(beforeWorking);
    expect(await readFile(lockPath, 'utf8')).toBe('retained-by-git-owner');
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
