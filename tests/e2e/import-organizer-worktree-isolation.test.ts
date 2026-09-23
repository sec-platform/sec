import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, expect, test } from 'bun:test';

import {
  runCandidateImportCheck,
  runCandidateImportOrganizer,
  runImportApply,
  runImportCheck,
} from '../../src/adapters/self-hosting/development/runner/import-organizer.ts';

/**
 * Physical two-worktree isolation witness (Issue #348): WT-A check/apply/
 * freeze must never change WT-B index or worktree. The real linked-worktree
 * layout is created here; `git rev-parse --git-path index` is recorded for
 * both trees and every operation in WT-A is followed by an exact index/worktree
 * readback of WT-B. Only a failing witness may classify cross-worktree index
 * contamination as a real defect.
 */

function git(repoRoot: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${Buffer.from(result.stderr).toString('utf8')}`);
  }
  return String(result.stdout);
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

function sha256Bytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

let baseRoot: string | undefined;
let repoRoot: string | undefined;
let worktreeA: string | undefined;
let worktreeB: string | undefined;
let worktreeBIndexPath: string | undefined;

async function digestTree(root: string): Promise<{
  head: string;
  tree: string;
  index: string;
  indexRaw: string;
  fixture: string;
}> {
  const indexPath = await (async () => {
    const configured = git(root, ['rev-parse', '--git-path', 'index']).trim();
    return path.isAbsolute(configured) ? configured : path.resolve(root, configured);
  })();
  // Index content identity is the staged-entry census (stat metadata in the
  // raw index file legitimately differs across worktrees and checkouts).
  const indexBuffer = await readFile(indexPath);
  return {
    head: git(root, ['rev-parse', 'HEAD']).trim(),
    tree: git(root, ['rev-parse', 'HEAD^{tree}']).trim(),
    index: sha256Bytes(Buffer.from(git(root, ['ls-files', '--stage', '-z']), 'utf8')),
    indexRaw: sha256Bytes(indexBuffer),
    fixture: sha256Bytes(await readFile(path.join(root, 'fixture.ts')))
  };
}

beforeAll(async () => {
  baseRoot = await mkdtemp(path.join(tmpdir(), 'sec-imports-isolation-'));
  repoRoot = path.join(baseRoot, 'repo');
  worktreeA = path.join(baseRoot, 'wt-a');
  worktreeB = path.join(baseRoot, 'wt-b');
  await writeFile(path.join(baseRoot, 'placeholder'), 'seed\n', 'utf8');
  git(baseRoot, ['init', '--quiet', '--separate-git-dir', path.join(baseRoot, 'common.git'), repoRoot]);
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
      include: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts']
    }, null, 2)}\n`, 'utf8'),
    writeFile(path.join(repoRoot, 'values.ts'), 'export const alpha = 1; export const beta = 2;\n', 'utf8'),
    writeFile(path.join(repoRoot, 'fixture.ts'), source('sorted'), 'utf8')
  ]);
  git(repoRoot, ['add', '--all']);
  git(repoRoot, ['commit', '--quiet', '-m', 'initial']);
  const head = git(repoRoot, ['rev-parse', 'HEAD']).trim();
  git(repoRoot, ['worktree', 'add', '--quiet', '--detach', worktreeA!, head]);
  git(repoRoot, ['worktree', 'add', '--quiet', '--detach', worktreeB!, head]);
  const bIndexConfigured = git(worktreeB, ['rev-parse', '--git-path', 'index']).trim();
  worktreeBIndexPath = path.isAbsolute(bIndexConfigured) ? bIndexConfigured : path.resolve(worktreeB, bIndexConfigured);
});

afterAll(async () => {
  try {
    if (repoRoot) {
      git(repoRoot, ['worktree', 'remove', '--force', worktreeA!]);
      git(repoRoot, ['worktree', 'remove', '--force', worktreeB!]);
    }
  } finally {
    if (baseRoot) {
      await rm(baseRoot, { recursive: true, force: true });
    }
  }
});

test('WT-A freeze/check/apply leave the WT-B index and worktree byte-identical', async () => {
  expect(worktreeA).toBeDefined();
  expect(worktreeB).toBeDefined();
  const aIndexConfigured = git(worktreeA!, ['rev-parse', '--git-path', 'index']).trim();
  const aIndexPath = path.isAbsolute(aIndexConfigured)
    ? aIndexConfigured
    : path.resolve(worktreeA!, aIndexConfigured);
  expect(aIndexPath).not.toBe(worktreeBIndexPath);

  const beforeB = await digestTree(worktreeB!);
  const beforeA = await digestTree(worktreeA!);
  expect(beforeA.index).toBe(beforeB.index);

  const fixturePath = path.join(worktreeA!, 'fixture.ts');
  const staged = `${source('unsorted')}export const stagedInA = answer;\n`;
  await writeFile(fixturePath, staged, 'utf8');
  git(worktreeA!, ['add', 'fixture.ts']);
  const head = beforeA.head;
  git(worktreeA!, ['update-ref', 'refs/remotes/origin/main', head]);

  // 1. freeze (candidate identity seal) in WT-A: typed needs-import-transform,
  //    zero index writes in A, and no observable change in B.
  const frozen = await runCandidateImportCheck(worktreeA!, {}, {});
  expect(frozen.status).toBe('needs-import-transform');
  expect(frozen.files).toEqual(['fixture.ts']);
  expect(await digestTree(worktreeB!)).toEqual(beforeB);

  // 2. staged transform in WT-A publishes only A's index.
  expect(await runCandidateImportOrganizer(worktreeA!, {}, {})).toBe(0);
  const afterATransform = await digestTree(worktreeA!);
  expect(afterATransform.index).not.toBe(beforeA.index);
  expect(await digestTree(worktreeB!)).toEqual(beforeB);

  // 3. freeze again: canonical in A, B still untouched.
  const resealed = await runCandidateImportCheck(worktreeA!, {}, {});
  expect(resealed.status).toBe('canonical');
  expect(await digestTree(worktreeB!)).toEqual(beforeB);

  // 4. working-tree transform in WT-A writes only A's source files.
  const worktreeANoncanonical = `${source('unsorted')}export const workingInA = answer;\n`;
  await writeFile(fixturePath, worktreeANoncanonical, 'utf8');
  git(worktreeA!, ['add', 'fixture.ts']);
  const checkOutcome = await runImportCheck({}, worktreeA!, {});
  expect(checkOutcome.status).toBe('needs-import-transform');
  const applyOutcome = await runImportApply({}, worktreeA!, {});
  expect(applyOutcome.status).toBe('accepted');
  expect((await readFile(fixturePath, 'utf8')).startsWith(source('sorted'))).toBe(true);
  expect(await digestTree(worktreeB!)).toEqual(beforeB);
  expect(worktreeBIndexPath).toBe(
    path.isAbsolute(git(worktreeB!, ['rev-parse', '--git-path', 'index']).trim())
      ? git(worktreeB!, ['rev-parse', '--git-path', 'index']).trim()
      : path.resolve(worktreeB!, git(worktreeB!, ['rev-parse', '--git-path', 'index']).trim())
  );
});
