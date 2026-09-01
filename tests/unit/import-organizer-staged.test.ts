import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import {
  runStagedIndexOnlyImportOrganizer,
  runSynchronizedStagedImportOrganizer
} from '../../src/development/runner/import-organizer.ts';
import { generatedStateProducerHooks } from '../../src/runtime-state/generated-state/lifecycle.ts';

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

async function prepareSnapshotCandidate(prefix: string): Promise<Readonly<{
  repoRoot: string;
  candidateBase: string;
}>> {
  const repoRoot = await mkdtemp(path.join(tmpdir(), prefix));
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
  const candidateBase = String(git(repoRoot, ['rev-parse', 'HEAD'])).trim();
  const fixturePath = path.join(repoRoot, 'fixture.ts');
  await writeFile(fixturePath, source('unsorted'));
  git(repoRoot, ['add', 'fixture.ts']);
  await writeFile(fixturePath, `${source('unsorted')}// unstaged owner bytes\n`);
  return Object.freeze({ repoRoot, candidateBase });
}

test('staged organizer fast sentinel preserves working bytes while normalizing the index', async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'sec-imports-fast-'));
  try {
    git(repoRoot, ['init', '--quiet']);
    git(repoRoot, ['config', 'user.email', 'tests@example.com']);
    git(repoRoot, ['config', 'user.name', 'SEC Tests']);
    git(repoRoot, ['config', 'core.autocrlf', 'false']);
    git(repoRoot, ['config', 'core.hooksPath', '.git/hooks']);
    const workPackageDirectory = path.join(repoRoot, 'docs', 'work-packages');
    await mkdir(workPackageDirectory, { recursive: true });
    const longCanonicalOwner = path.join(
      workPackageDirectory,
      `default-branch-health-repair-${'a'.repeat(120)}-${'b'.repeat(64)}.md`
    );
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
      writeFile(path.join(repoRoot, 'fixture.ts'), source('sorted'), 'utf8'),
      writeFile(longCanonicalOwner, 'canonical owner fixture\n', 'utf8')
    ]);
    git(repoRoot, ['-c', 'core.longpaths=true', 'add', '--all']);
    git(repoRoot, ['commit', '--quiet', '-m', 'initial']);
    const candidateBase = String(git(repoRoot, ['rev-parse', 'HEAD'])).trim();

    const fixturePath = path.join(repoRoot, 'fixture.ts');
    const stagedBytes = Buffer.from(`${source('unsorted')}export const stagedChange = answer;\n`);
    const workingBytes = Buffer.concat([stagedBytes, Buffer.from('// unstaged owner bytes\n')]);
    const expectedIndexBytes = Buffer.from(`${source('sorted')}export const stagedChange = answer;\n`);
    await writeFile(fixturePath, stagedBytes);
    git(repoRoot, ['add', 'fixture.ts']);
    await writeFile(fixturePath, workingBytes);

    const lifecycle: string[] = [];
    const lifecycleOwner = generatedStateProducerHooks({ repositoryRoot: repoRoot });
    expect(await runStagedIndexOnlyImportOrganizer(repoRoot, {
      generatedStateLifecycle: {
        born: async (relativePath, operationId) => {
          expect(relativePath).toMatch(/^\.tmp\/import-candidate-snapshots\/snapshot-/u);
          await access(path.join(repoRoot, ...relativePath.split('/')));
          await lifecycleOwner.born(relativePath, operationId);
          lifecycle.push(`born:${relativePath}`);
        },
        disposed: async (relativePath, request) => {
          expect(request).toMatchObject({
            outcome: 'candidate-snapshot-consumed',
            profile: 'automatic'
          });
          const receipt = await lifecycleOwner.disposed(relativePath, request);
          lifecycle.push(`disposed:${relativePath}`);
          return receipt;
        }
      }
    }, { candidateBase })).toBe(0);

    const objectId = String(git(repoRoot, ['rev-parse', ':fixture.ts'])).trim();
    expect(git(repoRoot, ['cat-file', 'blob', objectId], true)).toEqual(expectedIndexBytes);
    expect(await readFile(fixturePath)).toEqual(workingBytes);
    expect(String(git(repoRoot, ['diff', '--cached', '--name-only'])).trim()).toBe('fixture.ts');
    expect(lifecycle).toHaveLength(2);
    expect(lifecycle[1]).toBe(lifecycle[0]!.replace('born:', 'disposed:'));
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test('candidate snapshot retained capability rejects ancestor substitution without writing foreign bytes', async () => {
  if (process.platform !== 'linux') return;
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'sec-import-snapshot-fence-'));
  const fixturePath = path.join(repoRoot, 'fixture.ts');
  const lifecycle = generatedStateProducerHooks({ repositoryRoot: repoRoot });
  let snapshotRoot: string | null = null;
  let movedRoot: string | null = null;
  let relativePath: string | null = null;
  try {
    git(repoRoot, ['init', '--quiet']);
    git(repoRoot, ['config', 'user.name', 'SEC Test']);
    git(repoRoot, ['config', 'user.email', 'sec-test@example.invalid']);
    await writeFile(fixturePath, source('sorted'));
    git(repoRoot, ['add', '--all']);
    git(repoRoot, ['commit', '--quiet', '-m', 'initial']);
    const candidateBase = String(git(repoRoot, ['rev-parse', 'HEAD'])).trim();
    await writeFile(fixturePath, source('unsorted'));
    git(repoRoot, ['add', 'fixture.ts']);
    await writeFile(fixturePath, `${source('unsorted')}// unstaged\n`);

    await expect(runStagedIndexOnlyImportOrganizer(repoRoot, {
      generatedStateLifecycle: {
        born: async (pathValue, operationId) => {
          relativePath = pathValue;
          await lifecycle.born(pathValue, operationId);
        },
        disposed: async (pathValue, request) => lifecycle.disposed(pathValue, request)
      },
      beforeCandidateSnapshotWrite: async (pathValue) => {
        snapshotRoot = pathValue;
        movedRoot = `${pathValue}.owner-retained`;
        await rename(pathValue, movedRoot);
        await mkdir(pathValue);
        await writeFile(path.join(pathValue, 'foreign-sentinel'), 'foreign');
      }
    }, { candidateBase })).rejects.toThrow(/identity|lifecycle cleanup|changed/u);

    expect(snapshotRoot).not.toBeNull();
    expect(movedRoot).not.toBeNull();
    expect(relativePath).not.toBeNull();
    expect(await readFile(path.join(snapshotRoot!, 'foreign-sentinel'), 'utf8')).toBe('foreign');
    await expect(access(path.join(snapshotRoot!, 'fixture.ts'))).rejects.toThrow();

    await rm(snapshotRoot!, { recursive: true, force: true });
    await rename(movedRoot!, snapshotRoot!);
    await lifecycle.disposed(relativePath!, {
      outcome: 'negative-test-restored-owner',
      profile: 'automatic'
    });
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test('candidate snapshot birth failure preserves the primary error without inventing retirement authority', async () => {
  const { candidateBase, repoRoot } = await prepareSnapshotCandidate('sec-import-birth-failure-');
  const primaryError = new Error('candidate birth primary failure');
  let disposedCalls = 0;
  let snapshotRelativePath: string | null = null;
  try {
    let observedError: unknown;
    try {
      await runStagedIndexOnlyImportOrganizer(repoRoot, {
        generatedStateLifecycle: {
          born: async (relativePath) => {
            snapshotRelativePath = relativePath;
            throw primaryError;
          },
          disposed: async () => {
            disposedCalls += 1;
            throw new Error('unexpected disposal after birth failure');
          }
        }
      }, { candidateBase });
    } catch (error) {
      observedError = error;
    }

    expect(observedError).toBe(primaryError);
    expect(disposedCalls).toBe(0);
    expect(snapshotRelativePath).not.toBeNull();
    await access(path.join(repoRoot, ...snapshotRelativePath!.split('/')));
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test('candidate snapshot cleanup records its failure after a successful birth without replacing the primary error', async () => {
  const { candidateBase, repoRoot } = await prepareSnapshotCandidate('sec-import-cleanup-failure-');
  const primaryError = new Error('candidate materialization primary failure');
  const cleanupError = new Error('candidate lifecycle cleanup failure');
  try {
    let observedError: unknown;
    try {
      await runStagedIndexOnlyImportOrganizer(repoRoot, {
        generatedStateLifecycle: {
          born: async () => undefined,
          disposed: async () => {
            throw cleanupError;
          }
        },
        beforeCandidateSnapshotWrite: async () => {
          throw primaryError;
        }
      }, { candidateBase });
    } catch (error) {
      observedError = error;
    }

    expect(observedError).toBeInstanceOf(AggregateError);
    const failures = [...(observedError as AggregateError).errors];
    expect(failures).toEqual([primaryError, cleanupError]);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

async function prepareSynchronizedCandidate(prefix: string): Promise<Readonly<{
  repoRoot: string;
  fixturePath: string;
  stagedBytes: Buffer;
}>> {
  const repoRoot = await mkdtemp(path.join(tmpdir(), prefix));
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
  const stagedBytes = Buffer.from(source('unsorted'));
  await writeFile(fixturePath, stagedBytes);
  git(repoRoot, ['add', 'fixture.ts']);
  return Object.freeze({ repoRoot, fixturePath, stagedBytes });
}

test('synchronized staged apply publishes exact bytes to index and worktree without presenting source', async () => {
  const { fixturePath, repoRoot } = await prepareSynchronizedCandidate('sec-import-sync-');
  const largeSentinel = `PRESENTATION_MUST_NOT_CONTAIN_${'x'.repeat(256 * 1024)}`;
  const stagedBytes = Buffer.from(`${source('unsorted')}// ${largeSentinel}\n`);
  const messages: string[] = [];
  const originalLog = console.log;
  try {
    await writeFile(fixturePath, stagedBytes);
    git(repoRoot, ['add', 'fixture.ts']);
    console.log = (...values: unknown[]) => {
      messages.push(values.map(String).join(' '));
    };
    expect(await runSynchronizedStagedImportOrganizer(repoRoot)).toBe(0);
    const expected = Buffer.from(`${source('sorted')}// ${largeSentinel}\n`);
    expect(await readFile(fixturePath)).toEqual(expected);
    const objectId = String(git(repoRoot, ['rev-parse', ':fixture.ts'])).trim();
    expect(git(repoRoot, ['cat-file', 'blob', objectId], true)).toEqual(expected);
    const presentation = messages.join('\n');
    expect(presentation).not.toContain(largeSentinel);
    expect(Buffer.byteLength(presentation, 'utf8')).toBeLessThan(1024);
  } finally {
    console.log = originalLog;
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test('synchronized staged apply accepts a target that normalizes back to the candidate base', async () => {
  const { fixturePath, repoRoot } = await prepareSynchronizedCandidate('sec-import-sync-base-');
  try {
    expect(String(git(repoRoot, ['diff', '--cached', '--name-only'])).trim()).toBe('fixture.ts');

    expect(await runSynchronizedStagedImportOrganizer(repoRoot)).toBe(0);

    const expected = Buffer.from(source('sorted'));
    expect(await readFile(fixturePath)).toEqual(expected);
    const objectId = String(git(repoRoot, ['rev-parse', ':fixture.ts'])).trim();
    expect(git(repoRoot, ['cat-file', 'blob', objectId], true)).toEqual(expected);
    expect(String(git(repoRoot, ['diff', '--cached', '--name-only'])).trim()).toBe('');
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test('synchronized staged apply rejects index-worktree drift with zero publication', async () => {
  const { fixturePath, repoRoot, stagedBytes } = await prepareSynchronizedCandidate('sec-import-sync-drift-');
  try {
    const worktreeBytes = Buffer.concat([stagedBytes, Buffer.from('// unstaged owner bytes\n')]);
    await writeFile(fixturePath, worktreeBytes);
    const indexBefore = git(repoRoot, ['ls-files', '--stage', '-z'], true);
    let observed: unknown;
    try {
      await runSynchronizedStagedImportOrganizer(repoRoot);
    } catch (error) {
      observed = error;
    }
    expect(observed).toMatchObject({ code: 'IMPORT-STAGED-WORKTREE-DIVERGED' });
    expect(git(repoRoot, ['ls-files', '--stage', '-z'], true)).toEqual(indexBefore);
    expect(await readFile(fixturePath)).toEqual(worktreeBytes);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test('synchronized staged apply rolls back a pre-index failure and exposes durable recovery journals', async () => {
  const { fixturePath, repoRoot, stagedBytes } = await prepareSynchronizedCandidate('sec-import-sync-rollback-');
  try {
    const indexBefore = git(repoRoot, ['ls-files', '--stage', '-z'], true);
    let observed: unknown;
    try {
      await runSynchronizedStagedImportOrganizer(repoRoot, {
        beforeSynchronizedIndexPublish: () => {
          throw new Error('injected index publication failure');
        }
      });
    } catch (error) {
      observed = error;
    }
    expect(observed).toMatchObject({
      code: 'IMPORT-STAGED-SYNC-ROLLED-BACK',
      details: {
        forwardJournalPath: expect.stringContaining('journal.jsonl'),
        rollbackJournalPath: expect.stringContaining('journal.jsonl')
      }
    });
    expect(git(repoRoot, ['ls-files', '--stage', '-z'], true)).toEqual(indexBefore);
    expect((await readFile(fixturePath)).equals(stagedBytes)).toBe(true);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
