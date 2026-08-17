import { expect, test } from 'bun:test';

import { readCompilerFile, readCompilerPackageJson } from '../helpers/compiler-fixtures.ts';

test('provider-neutral sec-dev tooling owns execution logic without Codex or CLI activation', async () => {
  for (const file of [
    'tooling/sec-dev/git/git-read.ts',
    'tooling/sec-dev/text/text-byte-census.ts',
    'tooling/sec-dev/workspace/worktree-settlement.ts'
  ]) {
    const source = await readCompilerFile(file);
    expect(source).not.toContain('scripts/codex');
    expect(source).not.toContain('import.meta.main');
    expect(source).not.toContain('process.argv');
    expect(source).not.toContain('#!/usr/bin/env bun');
  }
});

test('one Git read mechanics owner serves census and settlement', async () => {
  const gitRead = await readCompilerFile('tooling/sec-dev/git/git-read.ts');
  const census = await readCompilerFile('tooling/sec-dev/text/text-byte-census.ts');
  const settlement = await readCompilerFile('tooling/sec-dev/workspace/worktree-settlement.ts');

  expect(gitRead).toContain('spawnSync');
  expect(gitRead).toContain('resolveExactHeadCommit');
  expect(gitRead).toContain('readCommitBlobInventory');
  expect(gitRead).toContain('readBlobBatch');
  expect(gitRead).toContain('readTextAttributesBatch');
  expect(gitRead).toContain("['cat-file', '--batch']");
  expect(gitRead).toContain("['check-attr', '-z', '--stdin', '--source', exactCommit, 'text', 'eol']");

  for (const source of [census, settlement]) {
    expect(source).toContain("from '../git/git-read.ts'");
    expect(source).not.toContain('spawnSync');
    expect(source).not.toContain('function getBlobSha');
    expect(source).not.toContain('function checkAttributes');
  }
});

test('text census binds committed path, blob, and attribute observations to one captured commit', async () => {
  const source = await readCompilerFile('tooling/sec-dev/text/text-byte-census.ts');

  expect(source).toContain('const sourceCommit = resolveExactHeadCommit(root);');
  expect(source).toContain('readCommitBlobInventory(root, sourceCommit)');
  expect(source).toContain('readBlobBatch(root, objectIds)');
  expect(source).toContain('readTextAttributesBatch(root, sourceCommit, paths)');
  expect(source).not.toContain("['ls-files', '-z']");
  expect(source).not.toContain("['ls-tree', 'HEAD'");
  expect(source).not.toContain("['cat-file', 'blob'");
  expect(source).not.toContain('continue;');
});

test('worktree settlement fails closed and revalidates exact repository state before settled', async () => {
  const source = await readCompilerFile('tooling/sec-dev/workspace/worktree-settlement.ts');

  expect(source).toContain('readCommitBlobInventory(root, sourceCommit)');
  expect(source).toContain('readBlobBatch(root, objectIds)');
  expect(source).toContain('readTextAttributesBatch(root, sourceCommit, paths)');
  expect(source).toContain('repositoryStillMatchesObservation(root, sourceCommit)');
  expect(source.match(/repositoryStillMatchesObservation\(root, sourceCommit\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  expect(source).toContain("status: 'unsafe'");
  expect(source).not.toContain('function readWorktreeBytes');
  expect(source).not.toContain('return null;');
  expect(source).not.toContain('if (blobSha === null) continue');
});

test('ordinary package scripts invoke provider-neutral tooling directly', async () => {
  const pkg = await readCompilerPackageJson();
  expect(pkg.scripts['text:census']).toBe('bun tooling/sec-dev/text/text-byte-census.ts --json');
  expect(pkg.scripts['environment:settle']).toBe('bun tooling/sec-dev/workspace/worktree-settlement.ts');
  expect(pkg.scripts['environment:settle:fix']).toBe('bun tooling/sec-dev/workspace/worktree-settlement.ts --fix');
  for (const name of ['text:census', 'environment:settle', 'environment:settle:fix']) {
    expect(pkg.scripts[name]).not.toContain('scripts/codex/');
  }
});

test('legacy Codex script paths are thin compatibility adapters only', async () => {
  const census = await readCompilerFile('scripts/codex/text-byte-census.ts');
  const settlement = await readCompilerFile('scripts/codex/worktree-settlement.ts');

  expect(census).toContain("from '../../tooling/sec-dev/text/text-byte-census.ts'");
  expect(settlement).toContain("from '../../tooling/sec-dev/workspace/worktree-settlement.ts'");

  for (const source of [census, settlement]) {
    expect(source).toContain('import.meta.main');
    expect(source).not.toContain('spawnSync');
    expect(source).not.toContain("['ls-files', '-z']");
    expect(source).not.toContain("['cat-file', 'blob'");
    expect(source).not.toContain('function getBlobSha');
    expect(source).not.toContain('function checkAttributes');
  }
});
