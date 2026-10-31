import { spawnSync } from 'node:child_process';
import { access, cp, lstat, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { settleWorkspaceCallback } from '../../testkit/workspace-cleanup.ts';

import { afterAll, expect, test } from 'bun:test';

import {
  runStagedIndexOnlyImportOrganizer,
  runSynchronizedStagedImportOrganizer
} from '../../../src/adapters/self-hosting/development/runner/import-organizer.ts';
import { generatedStateProducerHooks } from '../../helpers/generated-state-fixture.ts';

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

// The two staged workflows have the exact same tracked source commit.
// Cache only this immutable Git base; each case owns an independent index,
// worktree, candidate snapshot, generated-state journal and cleanup.
type OrganizerGitBase = Readonly<{ root: string; candidateBase: string }>;
let organizerGitBase: Promise<OrganizerGitBase> | undefined;

async function buildOrganizerGitBase(): Promise<OrganizerGitBase> {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'sec-import-shared-base-'));
  try {
  git(repoRoot, ['init', '--quiet']);
  git(repoRoot, ['config', 'core.autocrlf', 'false']);
  const writes = await Promise.allSettled([
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
  const writeFailures = writes.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
  if (writeFailures.length === 1) throw writeFailures[0];
  if (writeFailures.length > 1) {
    throw new AggregateError(writeFailures, 'Import organizer source writes failed');
  }
  git(repoRoot, ['add', '--all']);
  git(repoRoot, ['-c', 'user.name=SEC Tests', '-c', 'user.email=tests@example.com', 'commit', '--quiet', '-m', 'initial']);
    return Object.freeze({
      root: repoRoot,
      candidateBase: String(git(repoRoot, ['rev-parse', 'HEAD'])).trim()
    });
  } catch (error) {
    try { await rm(repoRoot, { recursive: true, force: true }); }
    catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Import organizer source and cleanup both failed');
    }
    throw error;
  }
}

function retainedOrganizerGitBase(): Promise<OrganizerGitBase> {
  if (organizerGitBase !== undefined) return organizerGitBase;
  const pending = buildOrganizerGitBase();
  organizerGitBase = pending;
  // Failure has already settled the incomplete physical seed; only successful
  // immutable Git source data may be held for later independent cases.
  void pending.catch(() => {
    if (organizerGitBase === pending) organizerGitBase = undefined;
  });
  return pending;
}

afterAll(async () => {
  if (organizerGitBase === undefined) return;
  const settled = await Promise.allSettled([organizerGitBase]);
  if (settled[0]?.status === 'fulfilled') {
    await rm(settled[0].value.root, { recursive: true, force: true });
  }
  organizerGitBase = undefined;
});

async function copyOrganizerGitBase(prefix: string): Promise<Readonly<{
  repoRoot: string;
  candidateBase: string;
}>> {
  const repoRoot = await mkdtemp(path.join(tmpdir(), prefix));
  try {
    const base = await retainedOrganizerGitBase();
    await cp(base.root, repoRoot, { recursive: true });
    return Object.freeze({ repoRoot, candidateBase: base.candidateBase });
  } catch (error) {
    try { await rm(repoRoot, { recursive: true, force: true }); }
    catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Import organizer copy and cleanup both failed');
    }
    throw error;
  }
}

async function prepareSnapshotCandidate(
  prefix: string, operation: (value: Readonly<{ repoRoot: string; candidateBase: string }>) => Promise<void>
): Promise<void> {
  const { repoRoot, candidateBase } = await copyOrganizerGitBase(prefix);
  const fixturePath = path.join(repoRoot, 'fixture.ts');
  await settleWorkspaceCallback(async () => {
    await writeFile(fixturePath, source('unsorted'));
    git(repoRoot, ['add', 'fixture.ts']);
    await writeFile(fixturePath, `${source('unsorted')}// unstaged owner bytes\n`);
    await operation(Object.freeze({ repoRoot, candidateBase }));
  }, async () => { await rm(repoRoot, { recursive: true, force: true }); });
}

test('staged organizer fast sentinel preserves working bytes while normalizing the index', async () => {
  // This distinct native test now clones the same immutable Git source as
  // other staged cases. Its long-path-specific commit remains test-owned.
  const { repoRoot } = await copyOrganizerGitBase('sec-imports-fast-');
  await settleWorkspaceCallback(async () => {
    git(repoRoot, ['config', 'core.hooksPath', '.git/hooks']);
    const workPackageDirectory = path.join(repoRoot, 'config', 'repository', 'work-packages');
    await mkdir(workPackageDirectory, { recursive: true });
    const longCanonicalOwner = path.join(
      workPackageDirectory,
      `default-branch-health-repair-${'a'.repeat(120)}-${'b'.repeat(64)}.md`
    );

    await writeFile(longCanonicalOwner, 'canonical owner fixture\n', 'utf8');
    git(repoRoot, ['-c', 'core.longpaths=true', 'add', '--all']);
    git(repoRoot, ['-c', 'user.name=SEC Tests', '-c', 'user.email=tests@example.com', 'commit', '--quiet', '-m', 'long-path fixture']);
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
  }, () => rm(repoRoot, { recursive: true, force: true }));
});

test.skipIf(process.platform !== 'linux')('candidate snapshot retained capability rejects ancestor substitution without writing foreign bytes', async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'sec-import-snapshot-fence-'));
  const fixturePath = path.join(repoRoot, 'fixture.ts');
  const lifecycle = generatedStateProducerHooks({ repositoryRoot: repoRoot });
  let snapshotRoot: string | null = null;
  let movedRoot: string | null = null;
  let relativePath: string | null = null;
  await settleWorkspaceCallback(async () => {
    git(repoRoot, ['init', '--quiet']);
    await writeFile(fixturePath, source('sorted'));
    git(repoRoot, ['add', '--all']);
    git(repoRoot, ['-c', 'user.name=SEC Test', '-c', 'user.email=sec-test@example.invalid', 'commit', '--quiet', '-m', 'initial']);
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
    await expect(lstat(path.join(snapshotRoot!, 'fixture.ts'))).rejects.toMatchObject({ code: 'ENOENT' });

    await rm(snapshotRoot!, { recursive: true, force: true });
    await rename(movedRoot!, snapshotRoot!);
    await lifecycle.disposed(relativePath!, {
      outcome: 'negative-test-restored-owner',
      profile: 'automatic'
    });
  }, async () => {
    await rm(repoRoot, { recursive: true, force: true });
  });
});

test('candidate snapshot birth failure preserves the primary error without inventing retirement authority', async () => {
  await prepareSnapshotCandidate('sec-import-birth-failure-', async ({ candidateBase, repoRoot }) => {
    const primaryError = new Error('candidate birth primary failure');
    let disposedCalls = 0;
    let snapshotRelativePath: string | null = null;
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
  });
});

test('candidate snapshot cleanup records its failure after a successful birth without replacing the primary error', async () => {
  await prepareSnapshotCandidate('sec-import-cleanup-failure-', async ({ candidateBase, repoRoot }) => {
    const primaryError = new Error('candidate materialization primary failure');
    const cleanupError = new Error('candidate lifecycle cleanup failure');
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
  });
});

async function prepareSynchronizedCandidate(
  prefix: string, operation: (value: Readonly<{ repoRoot: string; fixturePath: string; stagedBytes: Buffer }>) => Promise<void>
): Promise<void> {
  const { repoRoot } = await copyOrganizerGitBase(prefix);
  const fixturePath = path.join(repoRoot, 'fixture.ts');
  const stagedBytes = Buffer.from(source('unsorted'));
  await settleWorkspaceCallback(async () => {
    await writeFile(fixturePath, stagedBytes);
    git(repoRoot, ['add', 'fixture.ts']);
    await operation(Object.freeze({ repoRoot, fixturePath, stagedBytes }));
  }, async () => { await rm(repoRoot, { recursive: true, force: true }); });
}

test('synchronized staged apply publishes exact bytes to index and worktree without presenting source', async () => {
  await prepareSynchronizedCandidate('sec-import-sync-', async ({ fixturePath, repoRoot }) => {
    const largeSentinel = `PRESENTATION_MUST_NOT_CONTAIN_${'x'.repeat(256 * 1024)}`;
    const stagedBytes = Buffer.from(`${source('unsorted')}// ${largeSentinel}\n`);
    const messages: string[] = [];
    const originalLog = console.log;
    await settleWorkspaceCallback(async () => {
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
    }, async () => { console.log = originalLog; });
  });
});

test('synchronized staged apply accepts a target that normalizes back to the candidate base', async () => {
  await prepareSynchronizedCandidate('sec-import-sync-base-', async ({ fixturePath, repoRoot }) => {
    expect(String(git(repoRoot, ['diff', '--cached', '--name-only'])).trim()).toBe('fixture.ts');

    expect(await runSynchronizedStagedImportOrganizer(repoRoot)).toBe(0);

    const expected = Buffer.from(source('sorted'));
    expect(await readFile(fixturePath)).toEqual(expected);
    const objectId = String(git(repoRoot, ['rev-parse', ':fixture.ts'])).trim();
    expect(git(repoRoot, ['cat-file', 'blob', objectId], true)).toEqual(expected);
    expect(String(git(repoRoot, ['diff', '--cached', '--name-only'])).trim()).toBe('');
  });
});

test('synchronized staged apply rejects index-worktree drift with zero publication', async () => {
  await prepareSynchronizedCandidate('sec-import-sync-drift-', async ({ fixturePath, repoRoot, stagedBytes }) => {
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
  });
});

test('synchronized staged apply rolls back a pre-index failure and exposes durable recovery journals', async () => {
  await prepareSynchronizedCandidate('sec-import-sync-rollback-', async ({ fixturePath, repoRoot, stagedBytes }) => {
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
  });
});
