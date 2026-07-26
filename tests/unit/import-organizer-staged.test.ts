import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { runStagedImportOrganizer } from '../../platform/dev-runner/import-organizer.ts';

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
    'const answer = alpha + beta;',
    'export { answer };',
    ''
  ].join('\n');
}

test('staged organizer fast sentinel preserves working bytes while normalizing the index', async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'sec-imports-fast-'));
  try {
    git(repoRoot, ['init', '--quiet']);
    git(repoRoot, ['config', 'user.email', 'tests@example.com']);
    git(repoRoot, ['config', 'user.name', 'SEC Tests']);
    git(repoRoot, ['config', 'core.autocrlf', 'false']);
    git(repoRoot, ['config', 'core.hooksPath', '.git/hooks']);
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
    const workingBytes = Buffer.from(`${source('unsorted')}export const stagedChange = answer;\n`);
    const expectedIndexBytes = Buffer.from(`${source('sorted')}export const stagedChange = answer;\n`);
    await writeFile(fixturePath, workingBytes);
    git(repoRoot, ['add', 'fixture.ts']);

    expect(await runStagedImportOrganizer(repoRoot)).toBe(0);

    const objectId = String(git(repoRoot, ['rev-parse', ':fixture.ts'])).trim();
    expect(git(repoRoot, ['cat-file', 'blob', objectId], true)).toEqual(expectedIndexBytes);
    expect(await readFile(fixturePath)).toEqual(workingBytes);
    expect(String(git(repoRoot, ['diff', '--cached', '--name-only'])).trim()).toBe('fixture.ts');
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
