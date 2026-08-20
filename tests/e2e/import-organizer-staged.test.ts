import { spawnSync } from 'node:child_process';
import { access, cp, link, mkdir, mkdtemp, readFile, rename, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, expect, test } from 'bun:test';
import pLimit from 'p-limit';

import {
  runCandidateImportCheck,
  runCandidateImportOrganizer,
  runImportApply,
  runImportCheck,
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
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
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
    const head = String(git(repoRoot, ['rev-parse', 'HEAD'])).trim();
    git(repoRoot, ['update-ref', 'refs/remotes/origin/main', head]);
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

test.concurrent('candidate apply normalizes the complete committed, staged, unstaged, and untracked delta', async () => {
  await withRepository(async (repoRoot) => {
    const fixturePath = path.join(repoRoot, 'fixture.ts');
    const committedPath = path.join(repoRoot, 'committed.ts');
    const stagedPath = path.join(repoRoot, 'staged.ts');
    const untrackedPath = path.join(repoRoot, 'untracked.ts');
    const nestedUntrackedPath = path.join(repoRoot, 'wholly-untracked', 'nested.ts');
    const candidateBase = String(git(repoRoot, ['rev-parse', 'HEAD'])).trim();
    git(repoRoot, ['update-ref', 'refs/remotes/origin/main', candidateBase]);

    await writeFile(committedPath, source('unsorted'), 'utf8');
    git(repoRoot, ['add', 'committed.ts']);
    git(repoRoot, ['commit', '--quiet', '--no-verify', '-m', 'committed authoring delta']);
    await writeFile(stagedPath, source('unsorted'), 'utf8');
    git(repoRoot, ['add', 'staged.ts']);
    await Promise.all([
      writeFile(fixturePath, source('unsorted'), 'utf8'),
      writeFile(untrackedPath, source('unsorted'), 'utf8'),
      mkdir(path.dirname(nestedUntrackedPath), { recursive: true })
    ]);
    await writeFile(nestedUntrackedPath, source('unsorted'), 'utf8');

    expect(workingTreeTypeScriptTargets(repoRoot, undefined, {})).toEqual([
      'committed.ts',
      'fixture.ts',
      'staged.ts',
      'untracked.ts',
      'wholly-untracked/nested.ts'
    ]);
    const transformed = await runImportApply({}, repoRoot, {});
    expect(transformed.status).toBe('accepted');
    expect([...transformed.files].sort()).toEqual([
      'committed.ts',
      'fixture.ts',
      'staged.ts',
      'untracked.ts',
      'wholly-untracked/nested.ts'
    ]);

    for (const filePath of [committedPath, fixturePath, stagedPath, untrackedPath, nestedUntrackedPath]) {
      expect(await readFile(filePath, 'utf8')).toBe(source('sorted'));
    }
    const noop = await runImportApply({}, repoRoot, {});
    expect(noop.status).toBe('noop');
    expect(noop.files).toEqual([]);
  });
});

test.concurrent('working apply and staged freeze normalize identical Git-selected roots outside tsconfig', async () => {
  await withRepository(async (repoRoot) => {
    const toolingRoot = path.join(repoRoot, 'tooling');
    const includedRoot = path.join(repoRoot, 'included');
    const fixturePath = path.join(toolingRoot, 'fixture.ts');
    await Promise.all([
      mkdir(toolingRoot, { recursive: true }),
      mkdir(includedRoot, { recursive: true })
    ]);
    await Promise.all([
      writeFile(path.join(repoRoot, 'tsconfig.json'), `${JSON.stringify({
        compilerOptions: {
          allowImportingTsExtensions: true,
          module: 'ESNext',
          moduleResolution: 'Bundler',
          noEmit: true,
          target: 'ES2022'
        },
        include: ['included/**/*.ts']
      }, null, 2)}\n`, 'utf8'),
      writeFile(path.join(toolingRoot, 'values.ts'), 'export const alpha = 1; export const beta = 2;\n', 'utf8'),
      writeFile(fixturePath, source('sorted'), 'utf8'),
      writeFile(path.join(includedRoot, 'consumer.ts'), "export { answer } from '../tooling/fixture.ts';\n", 'utf8')
    ]);
    git(repoRoot, ['add', '--all']);
    git(repoRoot, ['commit', '--quiet', '--no-verify', '-m', 'transitive tooling root']);
    const candidateBase = String(git(repoRoot, ['rev-parse', 'HEAD'])).trim();
    git(repoRoot, ['update-ref', 'refs/remotes/origin/main', candidateBase]);

    const noncanonical = `${source('unsorted')}export const candidateChange = answer;\n`;
    await writeFile(fixturePath, noncanonical, 'utf8');
    expect(await runImportCheck({}, repoRoot, {})).toEqual({
      schema: 'sec-import-check-outcome-v1',
      status: 'needs-import-transform',
      files: ['tooling/fixture.ts']
    });
    const applied = await runImportApply({}, repoRoot, {});
    expect(applied.status).toBe('accepted');
    expect(applied.files).toEqual(['tooling/fixture.ts']);
    const canonicalWorkingBytes = await readFile(fixturePath);
    expect(canonicalWorkingBytes).toEqual(Buffer.from(
      `${source('sorted')}export const candidateChange = answer;\n`
    ));

    await writeFile(fixturePath, noncanonical, 'utf8');
    git(repoRoot, ['add', 'tooling/fixture.ts']);
    expect(await runCandidateImportCheck(repoRoot, {}, {})).toEqual({
      schema: 'sec-import-check-outcome-v1',
      status: 'needs-import-transform',
      files: ['tooling/fixture.ts']
    });
    expect(await runCandidateImportOrganizer(repoRoot, {}, {})).toBe(0);
    expect(await stagedBytes(repoRoot, 'tooling/fixture.ts')).toEqual(canonicalWorkingBytes);
    expect(await readFile(fixturePath)).toEqual(Buffer.from(noncanonical));
  });
});

test.concurrent('candidate apply rejects an inexact candidate base before changing source', async () => {
  await withRepository(async (repoRoot) => {
    const fixturePath = path.join(repoRoot, 'fixture.ts');
    await writeFile(fixturePath, source('unsorted'), 'utf8');
    const before = await readFile(fixturePath);

    await expect(runImportApply({}, repoRoot, { SEC_CHANGED_BASE: 'abc123' }))
      .rejects.toThrow('one full Git object ID');
    expect(await readFile(fixturePath)).toEqual(before);
  });
});

test.concurrent('imports check is a pure compare and publishes zero bytes', async () => {
  await withRepository(async (repoRoot) => {
    const fixturePath = path.join(repoRoot, 'fixture.ts');
    const stagedPath = path.join(repoRoot, 'staged.ts');
    await writeFile(fixturePath, source('unsorted'), 'utf8');
    await writeFile(stagedPath, source('unsorted'), 'utf8');
    git(repoRoot, ['add', 'staged.ts']);
    const beforeFixture = await readFile(fixturePath);
    const beforeStaged = await readFile(stagedPath);
    const beforeIndex = git(repoRoot, ['ls-files', '--stage', '-z'], { bytes: true });
    const rawIndexPath = path.join(repoRoot, '.git', 'index');
    const beforeRawIndex = await readFile(rawIndexPath);
    // Stale stat metadata is the Git path that would otherwise refresh the
    // raw index while bytes and staged identities remain unchanged.
    const nextMtime = new Date((await stat(stagedPath)).mtimeMs + 2_000);
    await utimes(stagedPath, nextMtime, nextMtime);

    const outcome = await runImportCheck({}, repoRoot, {});
    expect(outcome.status).toBe('needs-import-transform');
    expect([...outcome.files].sort()).toEqual(['fixture.ts', 'staged.ts']);

    expect(await readFile(fixturePath)).toEqual(beforeFixture);
    expect(await readFile(stagedPath)).toEqual(beforeStaged);
    expect(git(repoRoot, ['ls-files', '--stage', '-z'], { bytes: true })).toEqual(beforeIndex);
    expect(await readFile(rawIndexPath)).toEqual(beforeRawIndex);
    expect(String(git(repoRoot, ['diff', '--cached', '--name-only'])).trim()).toBe('staged.ts');
  });
});

test.concurrent('freeze seals identity by pure compare and never publishes to the index', async () => {
  await withRepository(async (repoRoot) => {
    const fixturePath = path.join(repoRoot, 'fixture.ts');
    const candidateBase = String(git(repoRoot, ['rev-parse', 'HEAD'])).trim();
    git(repoRoot, ['update-ref', 'refs/remotes/origin/main', candidateBase]);
    const staged = `${source('unsorted')}export const freezeChange = answer;\n`;
    await writeFile(fixturePath, staged, 'utf8');
    git(repoRoot, ['add', 'fixture.ts']);
    const beforeIndex = git(repoRoot, ['ls-files', '--stage', '-z'], { bytes: true });
    const rawIndexPath = path.join(repoRoot, '.git', 'index');
    const beforeRawIndex = await readFile(rawIndexPath);
    const beforeObjects = git(repoRoot, ['count-objects', '-v']);
    // candidateContext runs a pure git diff; stale stat metadata must not let
    // that comparison refresh the raw index cache.
    const staleMtime = new Date((await stat(fixturePath)).mtimeMs + 2_000);
    await utimes(fixturePath, staleMtime, staleMtime);

    const firstFreeze = await runCandidateImportCheck(repoRoot, {}, {});
    expect(firstFreeze.status).toBe('needs-import-transform');
    expect(firstFreeze.files).toEqual(['fixture.ts']);
    expect(await readFile(rawIndexPath)).toEqual(beforeRawIndex);
    expect(git(repoRoot, ['ls-files', '--stage', '-z'], { bytes: true })).toEqual(beforeIndex);
    expect(git(repoRoot, ['count-objects', '-v'])).toBe(beforeObjects);

    expect(await runCandidateImportOrganizer(repoRoot, {}, {})).toBe(0);
    const afterTransformIndex = git(repoRoot, ['ls-files', '--stage', '-z'], { bytes: true });
    const afterTransformObjects = git(repoRoot, ['count-objects', '-v']);
    const secondFreeze = await runCandidateImportCheck(repoRoot, {}, {});
    expect(secondFreeze.status).toBe('canonical');
    expect(git(repoRoot, ['ls-files', '--stage', '-z'], { bytes: true })).toEqual(afterTransformIndex);
    expect(git(repoRoot, ['count-objects', '-v'])).toBe(afterTransformObjects);
  });
});

test.concurrent('freeze returns typed needs-import-transform on a non-canonical staged state without index writes', async () => {
  await withRepository(async (repoRoot) => {
    const fixturePath = path.join(repoRoot, 'fixture.ts');
    const candidateBase = String(git(repoRoot, ['rev-parse', 'HEAD'])).trim();
    git(repoRoot, ['update-ref', 'refs/remotes/origin/main', candidateBase]);
    const staged = `${source('unsorted')}export const freezeChange = answer;\n`;
    await writeFile(fixturePath, staged, 'utf8');
    git(repoRoot, ['add', 'fixture.ts']);
    const beforeIndex = git(repoRoot, ['ls-files', '--stage', '-z'], { bytes: true });

    const frozen = await runCandidateImportCheck(repoRoot, {}, {});
    expect(frozen.status).toBe('needs-import-transform');
    expect(frozen.files).toEqual(['fixture.ts']);
    expect(await readFile(fixturePath)).toEqual(Buffer.from(staged));
    expect(git(repoRoot, ['ls-files', '--stage', '-z'], { bytes: true })).toEqual(beforeIndex);
  });
});

test.concurrent('true NOOP publishes no source bytes and no mtime churn', async () => {
  await withRepository(async (repoRoot) => {
    const fixturePath = path.join(repoRoot, 'fixture.ts');
    const valuesPath = path.join(repoRoot, 'values.ts');
    const beforeFixture = await readFile(fixturePath);
    const beforeValues = await readFile(valuesPath);
    const fixtureBefore = (await stat(fixturePath)).mtimeMs;
    const valuesBefore = (await stat(valuesPath)).mtimeMs;
    const beforeIndex = git(repoRoot, ['ls-files', '--stage', '-z'], { bytes: true });

    const outcome = await runImportApply({}, repoRoot, {});
    expect(outcome.status).toBe('noop');
    expect(outcome.files).toEqual([]);
    expect(await readFile(fixturePath)).toEqual(beforeFixture);
    expect(await readFile(valuesPath)).toEqual(beforeValues);
    expect((await stat(fixturePath)).mtimeMs).toBe(fixtureBefore);
    expect((await stat(valuesPath)).mtimeMs).toBe(valuesBefore);
    expect(git(repoRoot, ['ls-files', '--stage', '-z'], { bytes: true })).toEqual(beforeIndex);
  });
});

test.concurrent('sort-and-combine and remove-unused are independent typed intents', async () => {
  await withRepository(async (repoRoot) => {
    const fixturePath = path.join(repoRoot, 'fixture.ts');
    await writeFile(fixturePath, [
      "import { beta, alpha } from './values.ts';",
      "import { unusedOne, unusedTwo } from './values.ts';",
      '',
      'const answer = alpha + beta;',
      'export { answer };',
      ''
    ].join('\n'), 'utf8');

    const sortOnly = await runImportCheck({ intent: 'sort-and-combine' }, repoRoot, {});
    expect(sortOnly.status).toBe('needs-import-transform');
    expect(sortOnly.files).toEqual(['fixture.ts']);

    const removed = await runImportApply({ intent: 'remove-unused' }, repoRoot, {});
    expect(removed.status).toBe('accepted');
    const afterRemove = await readFile(fixturePath, 'utf8');
    expect(afterRemove).not.toContain('unusedOne');
    expect(afterRemove).not.toContain('unusedTwo');

    const removeAgain = await runImportApply({ intent: 'remove-unused' }, repoRoot, {});
    expect(removeAgain.status).toBe('noop');
    const afterSort = await runImportApply({ intent: 'sort-and-combine' }, repoRoot, {});
    expect(afterSort.status).toBe('accepted');
    expect(await readFile(fixturePath, 'utf8')).toContain(
      "import { alpha, beta } from './values.ts';"
    );
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
