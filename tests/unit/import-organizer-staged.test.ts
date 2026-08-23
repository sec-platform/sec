import { spawnSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { runStagedImportOrganizer } from '../../platform/dev-runner/import-organizer.ts';
import { generatedStateProducerHooksV1 } from '../../tooling/sec-dev/generated-state-lifecycle.ts';

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
    expect(await runStagedImportOrganizer(repoRoot, {
      generatedStateLifecycle: {
        born: async (relativePath) => {
          expect(relativePath).toMatch(/^\.tmp\/import-candidate-snapshots\/snapshot-/u);
          await access(path.join(repoRoot, ...relativePath.split('/')));
          lifecycle.push(`born:${relativePath}`);
        },
        disposed: async (relativePath, outcome) => {
          expect(outcome).toBe('candidate-snapshot-consumed');
          await rm(path.join(repoRoot, ...relativePath.split('/')), { recursive: true, force: true });
          lifecycle.push(`disposed:${relativePath}`);
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
  const lifecycle = generatedStateProducerHooksV1({ repositoryRoot: repoRoot });
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

    await expect(runStagedImportOrganizer(repoRoot, {
      generatedStateLifecycle: {
        born: async (pathValue, operationId) => {
          relativePath = pathValue;
          await lifecycle.born(pathValue, operationId);
        },
        disposed: async (pathValue, outcome) => lifecycle.disposed(pathValue, outcome)
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
    await lifecycle.disposed(relativePath!, 'negative-test-restored-owner');
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
