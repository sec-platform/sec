import { spawnSync } from 'node:child_process';
import { access, cp, link, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, expect, test } from 'bun:test';
import pLimit from 'p-limit';

import {
  runCandidateImportOrganizer,
  runImportPreparation,
  runStagedImportOrganizer,
  workingTreeTypeScriptTargets
} from '../../platform/dev-runner/import-organizer.ts';

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

const repositoryConcurrency = 4;
const repositorySlot = pLimit(repositoryConcurrency);
let repositoryTemplateRoot: string | undefined;
let repositoryTemplateInitializationCount = 0;
let activeRepositoryCount = 0;
let peakRepositoryCount = 0;

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function createRepositoryTemplate(
  afterDirectoryCreated?: (repoRoot: string) => Promise<void>
): Promise<string> {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'sec-imports-template-'));
  let ownershipTransferred = false;
  try {
    await afterDirectoryCreated?.(repoRoot);
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
    ownershipTransferred = true;
    return repoRoot;
  } finally {
    if (!ownershipTransferred) {
      await rm(repoRoot, { recursive: true, force: true });
    }
  }
}

async function copyRepositoryTemplate(
  copyRepository: (sourceRoot: string, targetRoot: string) => Promise<void> = async (
    sourceRoot,
    targetRoot
  ) => {
    await cp(sourceRoot, targetRoot, {
      recursive: true,
      errorOnExist: true,
      force: false
    });
  }
): Promise<string> {
  if (!repositoryTemplateRoot) {
    throw new Error('Import organizer repository template is unavailable');
  }
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'sec-imports-case-'));
  await rm(repoRoot, { recursive: true, force: true });
  let ownershipTransferred = false;
  try {
    await copyRepository(repositoryTemplateRoot, repoRoot);
    ownershipTransferred = true;
    return repoRoot;
  } finally {
    if (!ownershipTransferred) {
      await rm(repoRoot, { recursive: true, force: true });
    }
  }
}

beforeAll(async () => {
  repositoryTemplateRoot = await createRepositoryTemplate();
  repositoryTemplateInitializationCount += 1;
});

afterAll(async () => {
  try {
    expect(repositoryTemplateInitializationCount).toBe(1);
    expect(activeRepositoryCount).toBe(0);
    expect(peakRepositoryCount).toBeGreaterThan(0);
    expect(peakRepositoryCount).toBeLessThanOrEqual(repositoryConcurrency);
  } finally {
    if (repositoryTemplateRoot) {
      await rm(repositoryTemplateRoot, { recursive: true, force: true });
      repositoryTemplateRoot = undefined;
    }
  }
});

async function stagedBytes(repoRoot: string, fileName: string): Promise<Buffer> {
  const objectId = String(git(repoRoot, ['rev-parse', `:${fileName}`])).trim();
  return git(repoRoot, ['cat-file', 'blob', objectId], { bytes: true }) as Buffer;
}

async function withRepositoryActivity<T>(run: () => Promise<T>): Promise<T> {
  return repositorySlot(async () => {
    activeRepositoryCount += 1;
    peakRepositoryCount = Math.max(peakRepositoryCount, activeRepositoryCount);
    try {
      return await run();
    } finally {
      activeRepositoryCount -= 1;
    }
  });
}

async function withRepository(run: (repoRoot: string) => Promise<void>): Promise<void> {
  return withRepositoryActivity(async () => {
    let repoRoot: string | undefined;
    try {
      repoRoot = await copyRepositoryTemplate();
      await run(repoRoot);
    } finally {
      if (repoRoot) {
        await rm(repoRoot, { recursive: true, force: true });
      }
    }
  });
}

test.concurrent('fixture creators remove partial repositories before ownership transfer', async () => {
  await withRepositoryActivity(async () => {
    let failedTemplateRoot = '';
    await expect(createRepositoryTemplate(async (repoRoot) => {
      failedTemplateRoot = repoRoot;
      await writeFile(path.join(repoRoot, 'partial-template.txt'), 'partial\n', 'utf8');
      throw new Error('injected template initialization failure');
    })).rejects.toThrow('injected template initialization failure');
    expect(failedTemplateRoot).not.toBe('');
    expect(await pathExists(failedTemplateRoot)).toBe(false);

    let failedCopyRoot = '';
    await expect(copyRepositoryTemplate(async (sourceRoot, targetRoot) => {
      failedCopyRoot = targetRoot;
      await cp(sourceRoot, targetRoot, {
        recursive: true,
        errorOnExist: true,
        force: false
      });
      await writeFile(path.join(targetRoot, 'partial-copy.txt'), 'partial\n', 'utf8');
      throw new Error('injected repository copy failure');
    })).rejects.toThrow('injected repository copy failure');
    expect(failedCopyRoot).not.toBe('');
    expect(await pathExists(failedCopyRoot)).toBe(false);
  });
});

test.concurrent('staged organizer selects pre-commit changes without rewriting a matching working tree', async () => {
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

test.concurrent('candidate organizer repairs the complete amended commit diff instead of only the staged delta', async () => {
  await withRepository(async (repoRoot) => {
    const fixturePath = path.join(repoRoot, 'fixture.ts');
    const candidateBase = String(git(repoRoot, ['rev-parse', 'HEAD'])).trim();
    const committed = `${source('unsorted')}export const committedChange = answer;\n`;
    const expected = `${source('sorted')}export const committedChange = answer;\n`;
    await writeFile(fixturePath, committed, 'utf8');
    git(repoRoot, ['add', 'fixture.ts']);
    git(repoRoot, ['commit', '--quiet', '-m', 'legacy candidate']);
    await writeFile(path.join(repoRoot, 'README.md'), 'amend metadata\n', 'utf8');
    git(repoRoot, ['add', 'README.md']);
    const contexts: string[] = [];

    expect(await runStagedImportOrganizer(repoRoot, {
      candidateContext: (mode) => {
        contexts.push(mode);
      }
    }, { candidateBase })).toBe(0);

    expect(await stagedBytes(repoRoot, 'fixture.ts')).toEqual(Buffer.from(expected));
    expect(await readFile(fixturePath)).toEqual(Buffer.from(committed));
    expect(String(git(repoRoot, ['diff', '--cached', '--name-only'])).trim().split(/\r?\n/u).sort())
      .toEqual(['README.md', 'fixture.ts']);
    expect(contexts).toEqual(['working-tree']);
    expect(await runStagedImportOrganizer(repoRoot, {
      candidateContext: (mode) => {
        contexts.push(mode);
      }
    }, { candidateBase })).toBe(0);
    expect(contexts).toEqual(['working-tree', 'snapshot']);
    expect(await stagedBytes(repoRoot, 'fixture.ts')).toEqual(Buffer.from(expected));
  });
});

test.concurrent('candidate organizer derives the branch merge-base without an ambient base variable', async () => {
  await withRepository(async (repoRoot) => {
    const fixturePath = path.join(repoRoot, 'fixture.ts');
    const candidateBase = String(git(repoRoot, ['rev-parse', 'HEAD'])).trim();
    git(repoRoot, ['update-ref', 'refs/remotes/origin/main', candidateBase]);
    const committed = `${source('unsorted')}export const committedChange = answer;\n`;
    const expected = `${source('sorted')}export const committedChange = answer;\n`;
    await writeFile(fixturePath, committed, 'utf8');
    git(repoRoot, ['add', 'fixture.ts']);
    git(repoRoot, ['commit', '--quiet', '--no-verify', '-m', 'legacy candidate']);
    await writeFile(path.join(repoRoot, 'README.md'), 'final candidate metadata\n', 'utf8');
    git(repoRoot, ['add', 'README.md']);

    expect(await runCandidateImportOrganizer(repoRoot, {}, {})).toBe(0);

    expect(await stagedBytes(repoRoot, 'fixture.ts')).toEqual(Buffer.from(expected));
    expect(await readFile(fixturePath)).toEqual(Buffer.from(committed));
    expect(String(git(repoRoot, ['diff', '--cached', '--name-only'])).trim().split(/\r?\n/u).sort())
      .toEqual(['README.md', 'fixture.ts']);
  });
});

test.concurrent('clean candidate context fails closed if an untracked path appears before index publication', async () => {
  await withRepository(async (repoRoot) => {
    const fixturePath = path.join(repoRoot, 'fixture.ts');
    const candidateBase = String(git(repoRoot, ['rev-parse', 'HEAD'])).trim();
    const staged = `${source('unsorted')}export const candidate = answer;\n`;
    await writeFile(fixturePath, staged, 'utf8');
    git(repoRoot, ['add', 'fixture.ts']);
    let context = '';

    await expect(runStagedImportOrganizer(repoRoot, {
      candidateContext: async (mode) => {
        context = mode;
        await writeFile(path.join(repoRoot, 'concurrent.txt'), 'concurrent untracked path\n', 'utf8');
      }
    }, { candidateBase })).rejects.toThrow(
      'Working tree or untracked paths changed while organizing candidate imports'
    );

    expect(context).toBe('working-tree');
    expect(await stagedBytes(repoRoot, 'fixture.ts')).toEqual(Buffer.from(staged));
    expect(await readFile(fixturePath)).toEqual(Buffer.from(staged));
  });
});

test.concurrent('authoring preparation normalizes the complete committed, staged, unstaged, and untracked delta', async () => {
  await withRepository(async (repoRoot) => {
    const fixturePath = path.join(repoRoot, 'fixture.ts');
    const committedPath = path.join(repoRoot, 'committed.ts');
    const stagedPath = path.join(repoRoot, 'staged.ts');
    const untrackedPath = path.join(repoRoot, 'untracked.ts');
    const candidateBase = String(git(repoRoot, ['rev-parse', 'HEAD'])).trim();
    git(repoRoot, ['update-ref', 'refs/remotes/origin/main', candidateBase]);

    await writeFile(committedPath, source('unsorted'), 'utf8');
    git(repoRoot, ['add', 'committed.ts']);
    git(repoRoot, ['commit', '--quiet', '--no-verify', '-m', 'committed authoring delta']);
    await writeFile(stagedPath, source('unsorted'), 'utf8');
    git(repoRoot, ['add', 'staged.ts']);
    await Promise.all([
      writeFile(fixturePath, source('unsorted'), 'utf8'),
      writeFile(untrackedPath, source('unsorted'), 'utf8')
    ]);

    expect(workingTreeTypeScriptTargets(repoRoot, {})).toEqual([
      'committed.ts',
      'fixture.ts',
      'staged.ts',
      'untracked.ts'
    ]);
    expect(await runImportPreparation(repoRoot, {})).toBe(0);

    for (const filePath of [committedPath, fixturePath, stagedPath, untrackedPath]) {
      expect(await readFile(filePath, 'utf8')).toBe(source('sorted'));
    }
    expect(await runImportPreparation(repoRoot, {})).toBe(0);
  });
});

test.concurrent('authoring preparation rejects an inexact candidate base before changing source', async () => {
  await withRepository(async (repoRoot) => {
    const fixturePath = path.join(repoRoot, 'fixture.ts');
    await writeFile(fixturePath, source('unsorted'), 'utf8');
    const before = await readFile(fixturePath);

    await expect(runImportPreparation(repoRoot, { SEC_CHANGED_BASE: 'abc123' }))
      .rejects.toThrow('one full Git object ID');
    expect(await readFile(fixturePath)).toEqual(before);
  });
});

test.concurrent('candidate organizer reads configuration and project context from the index snapshot', async () => {
  await withRepository(async (repoRoot) => {
    const fixturePath = path.join(repoRoot, 'fixture.ts');
    const tsconfigPath = path.join(repoRoot, 'tsconfig.json');
    const valuesPath = path.join(repoRoot, 'values.ts');
    const candidateBase = String(git(repoRoot, ['rev-parse', 'HEAD'])).trim();
    const staged = `${source('unsorted')}export const candidate = answer;\n`;
    await writeFile(fixturePath, staged, 'utf8');
    git(repoRoot, ['add', 'fixture.ts']);
    await writeFile(tsconfigPath, '{ invalid unstaged config', 'utf8');
    await writeFile(valuesPath, 'invalid unstaged project source', 'utf8');
    const contexts: string[] = [];

    expect(await runStagedImportOrganizer(repoRoot, {
      candidateContext: (mode) => {
        contexts.push(mode);
      }
    }, { candidateBase })).toBe(0);

    expect(contexts).toEqual(['snapshot']);
    expect(await stagedBytes(repoRoot, 'fixture.ts')).toEqual(Buffer.from(
      `${source('sorted')}export const candidate = answer;\n`
    ));
    expect(await readFile(tsconfigPath, 'utf8')).toBe('{ invalid unstaged config');
    expect(await readFile(valuesPath, 'utf8')).toBe('invalid unstaged project source');
  });
});

test.concurrent('candidate organizer requires one exact full commit identity', async () => {
  await withRepository(async (repoRoot) => {
    const head = String(git(repoRoot, ['rev-parse', 'HEAD'])).trim();
    await expect(runStagedImportOrganizer(repoRoot, {}, { candidateBase: head.slice(0, 12) }))
      .rejects.toThrow('one full Git object ID');
    await expect(runStagedImportOrganizer(repoRoot, {}, { candidateBase: 'f'.repeat(40) }))
      .rejects.toThrow('git rev-parse failed');
  });
});

test.concurrent('staged organizer preserves bytes visible through an external hardlink alias', async () => {
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

test.concurrent('staged organizer normalizes only the index when unstaged bytes diverge', async () => {
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

test.concurrent('staged organizer preserves CRLF and executable mode for an added file', async () => {
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

test.concurrent('staged organizer follows the rename target without restoring the source path', async () => {
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

test.concurrent('staged organizer owns the real index lock while preserving a concurrent working-tree update', async () => {
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

test.concurrent('staged organizer is a no-op when only non-TypeScript paths are staged', async () => {
  await withRepository(async (repoRoot) => {
    await writeFile(path.join(repoRoot, 'README.md'), 'staged documentation\n', 'utf8');
    git(repoRoot, ['add', 'README.md']);
    const before = git(repoRoot, ['ls-files', '--stage', '-z'], { bytes: true });

    expect(await runStagedImportOrganizer(repoRoot)).toBe(0);

    expect(git(repoRoot, ['ls-files', '--stage', '-z'], { bytes: true })).toEqual(before);
  });
});

test.concurrent('staged organizer publishes no index entry when multi-file blob generation fails midway', async () => {
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

test.concurrent('staged organizer rejects non-ordinary and unresolved TypeScript entries before index mutation', async () => {
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
