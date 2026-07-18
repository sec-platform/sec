import { spawnSync } from 'node:child_process';
import { link, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { runStagedImportOrganizer } from '../../platform/dev-runner/import-organizer.ts';

function git(
  repoRoot: string,
  args: readonly string[],
  options: { readonly input?: Buffer | string; readonly bytes?: boolean } = {}
): string | Buffer {
  const result = spawnSync('git', [...args], {
    cwd: repoRoot,
    encoding: options.bytes ? 'buffer' : 'utf8',
    input: options.input,
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${Buffer.from(result.stderr).toString('utf8')}`);
  }
  return options.bytes ? Buffer.from(result.stdout) : String(result.stdout);
}

function source(order: 'sorted' | 'unsorted', newLine = '\n'): string {
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
  ].join(newLine);
}

async function createRepository(): Promise<string> {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'sec-imports-index-'));
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
      include: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts']
    }, null, 2)}\n`, 'utf8'),
    writeFile(path.join(repoRoot, 'values.ts'), 'export const alpha = 1; export const beta = 2;\n', 'utf8'),
    writeFile(path.join(repoRoot, 'fixture.ts'), source('sorted'), 'utf8')
  ]);
  git(repoRoot, ['add', '--all']);
  git(repoRoot, ['commit', '--quiet', '-m', 'initial']);
  return repoRoot;
}

async function stagedBytes(repoRoot: string, fileName: string): Promise<Buffer> {
  const objectId = String(git(repoRoot, ['rev-parse', `:${fileName}`])).trim();
  return git(repoRoot, ['cat-file', 'blob', objectId], { bytes: true }) as Buffer;
}

async function withRepository(run: (repoRoot: string) => Promise<void>): Promise<void> {
  const repoRoot = await createRepository();
  try {
    await run(repoRoot);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
}

test('staged organizer selects pre-commit changes without rewriting a matching working tree', async () => {
  await withRepository(async (repoRoot) => {
    const fixturePath = path.join(repoRoot, 'fixture.ts');
    const staged = `${source('unsorted')}export const stagedChange = answer;\n`;
    const expected = `${source('sorted')}export const stagedChange = answer;\n`;
    await writeFile(fixturePath, staged, 'utf8');
    git(repoRoot, ['add', 'fixture.ts']);

    expect(await runStagedImportOrganizer(repoRoot)).toBe(0);

    expect(await stagedBytes(repoRoot, 'fixture.ts')).toEqual(Buffer.from(expected));
    expect(await readFile(fixturePath)).toEqual(Buffer.from(staged));
    expect(String(git(repoRoot, ['diff', '--cached', '--name-only'])).trim()).toBe('fixture.ts');
  });
});

test('staged organizer preserves bytes visible through an external hardlink alias', async () => {
  await withRepository(async (repoRoot) => {
    const fixturePath = path.join(repoRoot, 'fixture.ts');
    const aliasPath = `${repoRoot}-fixture-hardlink.ts`;
    const staged = `${source('unsorted')}export const stagedChange = answer;\n`;
    try {
      await writeFile(fixturePath, staged, 'utf8');
      await link(fixturePath, aliasPath);
      git(repoRoot, ['add', 'fixture.ts']);

      expect(await runStagedImportOrganizer(repoRoot)).toBe(0);

      expect(await stagedBytes(repoRoot, 'fixture.ts')).toEqual(Buffer.from(
        `${source('sorted')}export const stagedChange = answer;\n`
      ));
      expect(await readFile(fixturePath)).toEqual(Buffer.from(staged));
      expect(await readFile(aliasPath)).toEqual(Buffer.from(staged));
    } finally {
      await rm(aliasPath, { force: true });
    }
  });
});

test.skipIf(process.platform === 'win32')(
  'staged organizer preserves bytes visible through an external symlink alias',
  async () => {
    await withRepository(async (repoRoot) => {
      const fixturePath = path.join(repoRoot, 'fixture.ts');
      const aliasPath = `${repoRoot}-fixture-symlink.ts`;
      const staged = source('unsorted');
      try {
        await writeFile(fixturePath, staged, 'utf8');
        await symlink(fixturePath, aliasPath, 'file');
        git(repoRoot, ['add', 'fixture.ts']);

        expect(await runStagedImportOrganizer(repoRoot)).toBe(0);

        expect(await stagedBytes(repoRoot, 'fixture.ts')).toEqual(Buffer.from(source('sorted')));
        expect(await readFile(fixturePath)).toEqual(Buffer.from(staged));
        expect(await readFile(aliasPath)).toEqual(Buffer.from(staged));
      } finally {
        await rm(aliasPath, { force: true });
      }
    });
  }
);

test('staged organizer normalizes only the index when unstaged bytes diverge', async () => {
  await withRepository(async (repoRoot) => {
    const fixturePath = path.join(repoRoot, 'fixture.ts');
    const staged = source('unsorted');
    const working = `${staged}// unstaged work must survive\n`;
    await writeFile(fixturePath, staged, 'utf8');
    git(repoRoot, ['add', 'fixture.ts']);
    await writeFile(fixturePath, working, 'utf8');

    expect(await runStagedImportOrganizer(repoRoot)).toBe(0);

    expect(await stagedBytes(repoRoot, 'fixture.ts')).toEqual(Buffer.from(source('sorted')));
    expect(await readFile(fixturePath, 'utf8')).toBe(working);
  });
});

test('staged organizer preserves CRLF and executable mode for an added file', async () => {
  await withRepository(async (repoRoot) => {
    const fileName = 'added.mts';
    const filePath = path.join(repoRoot, fileName);
    await writeFile(filePath, source('unsorted', '\r\n'), 'utf8');
    git(repoRoot, ['add', fileName]);
    git(repoRoot, ['update-index', '--chmod=+x', fileName]);

    expect(await runStagedImportOrganizer(repoRoot)).toBe(0);

    const expected = Buffer.from(source('sorted', '\r\n'));
    expect(await stagedBytes(repoRoot, fileName)).toEqual(expected);
    expect(await readFile(filePath)).toEqual(Buffer.from(source('unsorted', '\r\n')));
    expect(String(git(repoRoot, ['ls-files', '--stage', '--', fileName]))).toStartWith('100755 ');
  });
});

test('staged organizer follows the rename target without restoring the source path', async () => {
  await withRepository(async (repoRoot) => {
    const sourcePath = path.join(repoRoot, 'fixture.ts');
    const targetPath = path.join(repoRoot, 'renamed.ts');
    await rename(sourcePath, targetPath);
    await writeFile(targetPath, source('unsorted'), 'utf8');
    git(repoRoot, ['add', '--all']);

    expect(await runStagedImportOrganizer(repoRoot)).toBe(0);

    expect(await stagedBytes(repoRoot, 'renamed.ts')).toEqual(Buffer.from(source('sorted')));
    expect(await readFile(targetPath)).toEqual(Buffer.from(source('unsorted')));
    expect(String(git(repoRoot, ['ls-files', '--', 'fixture.ts']))).toBe('');
    expect(String(git(repoRoot, ['diff', '--cached', '--name-status', '--find-renames']))).toContain('renamed.ts');
  });
});

test('staged organizer owns the real index lock while preserving a concurrent working-tree update', async () => {
  await withRepository(async (repoRoot) => {
    const fixturePath = path.join(repoRoot, 'fixture.ts');
    const staged = `${source('unsorted')}export const stagedChange = answer;\n`;
    const expected = `${source('sorted')}export const stagedChange = answer;\n`;
    const concurrentWorking = `${staged}// concurrent working-tree update\n`;
    await writeFile(fixturePath, staged, 'utf8');
    git(repoRoot, ['add', 'fixture.ts']);
    let restageRejected = false;

    expect(await runStagedImportOrganizer(repoRoot, {
      afterIndexLock: async () => {
        await writeFile(fixturePath, concurrentWorking, 'utf8');
        const result = spawnSync('git', ['add', 'fixture.ts'], {
          cwd: repoRoot,
          encoding: 'utf8',
          windowsHide: true
        });
        restageRejected = result.status !== 0;
        expect(result.stderr).toContain('index.lock');
        expect(await stagedBytes(repoRoot, 'fixture.ts')).toEqual(Buffer.from(staged));
      }
    })).toBe(0);

    expect(restageRejected).toBe(true);
    expect(await stagedBytes(repoRoot, 'fixture.ts')).toEqual(Buffer.from(expected));
    expect(await readFile(fixturePath)).toEqual(Buffer.from(concurrentWorking));
  });
});

test('staged organizer is a no-op when only non-TypeScript paths are staged', async () => {
  await withRepository(async (repoRoot) => {
    await writeFile(path.join(repoRoot, 'README.md'), 'staged documentation\n', 'utf8');
    git(repoRoot, ['add', 'README.md']);
    const before = git(repoRoot, ['ls-files', '--stage', '-z'], { bytes: true });

    expect(await runStagedImportOrganizer(repoRoot)).toBe(0);

    expect(git(repoRoot, ['ls-files', '--stage', '-z'], { bytes: true })).toEqual(before);
  });
});

test('staged organizer publishes no index entry when multi-file blob generation fails midway', async () => {
  await withRepository(async (repoRoot) => {
    await Promise.all([
      writeFile(path.join(repoRoot, 'fixture.ts'), source('unsorted'), 'utf8'),
      writeFile(path.join(repoRoot, 'second.ts'), source('unsorted'), 'utf8')
    ]);
    git(repoRoot, ['add', 'fixture.ts', 'second.ts']);
    const before = git(repoRoot, ['ls-files', '--stage', '-z'], { bytes: true });
    let generated = 0;

    await expect(runStagedImportOrganizer(repoRoot, {
      beforeHash: () => {
        generated += 1;
        if (generated === 2) throw new Error('injected blob generation failure');
      }
    })).rejects.toThrow('injected blob generation failure');

    expect(generated).toBe(2);
    expect(git(repoRoot, ['ls-files', '--stage', '-z'], { bytes: true })).toEqual(before);
    expect(await readFile(path.join(repoRoot, 'fixture.ts'), 'utf8')).toBe(source('unsorted'));
    expect(await readFile(path.join(repoRoot, 'second.ts'), 'utf8')).toBe(source('unsorted'));
  });
});

test('staged organizer rejects non-ordinary and unresolved TypeScript entries before index mutation', async () => {
  await withRepository(async (repoRoot) => {
    const workingBytes = Buffer.from('working-tree bytes must survive\n');
    await writeFile(path.join(repoRoot, 'link.ts'), workingBytes);
    const linkObject = String(git(repoRoot, ['hash-object', '-w', '--stdin'], {
      input: 'values.ts'
    })).trim();
    git(repoRoot, ['update-index', '--add', '--cacheinfo', `120000,${linkObject},link.ts`]);
    const before = git(repoRoot, ['ls-files', '--stage', '-z'], { bytes: true });

    await expect(runStagedImportOrganizer(repoRoot)).rejects.toThrow('not an ordinary file');
    expect(git(repoRoot, ['ls-files', '--stage', '-z'], { bytes: true })).toEqual(before);
    expect(await stagedBytes(repoRoot, 'link.ts')).toEqual(Buffer.from('values.ts'));
    expect(await readFile(path.join(repoRoot, 'link.ts'))).toEqual(workingBytes);
  });

  await withRepository(async (repoRoot) => {
    const objectIds = ['base', 'ours', 'theirs'].map((value) => String(git(
      repoRoot,
      ['hash-object', '-w', '--stdin'],
      { input: source('sorted').replace('answer', value) }
    )).trim());
    const records = objectIds
      .map((objectId, index) => `100644 ${objectId} ${index + 1}\tconflict.ts\n`)
      .join('');
    git(repoRoot, ['update-index', '--index-info'], { input: records });
    const before = git(repoRoot, ['ls-files', '--stage', '-z'], { bytes: true });

    await expect(runStagedImportOrganizer(repoRoot)).rejects.toThrow('unresolved TypeScript index stages');
    expect(git(repoRoot, ['ls-files', '--stage', '-z'], { bytes: true })).toEqual(before);
  });
});
