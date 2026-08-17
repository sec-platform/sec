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

test('one bounded Git read mechanics owner serves census and settlement', async () => {
  const gitRead = await readCompilerFile('tooling/sec-dev/git/git-read.ts');
  const census = await readCompilerFile('tooling/sec-dev/text/text-byte-census.ts');
  const settlement = await readCompilerFile('tooling/sec-dev/workspace/worktree-settlement.ts');

  expect(gitRead).toContain('spawnSync');
  expect(gitRead).toContain('resolveExactHeadCommit');
  expect(gitRead).toContain('readCommitBlobInventory');
  expect(gitRead).toContain("['ls-tree', '-r', '-z', '--full-tree', '-l', exactCommit]");
  expect(gitRead).toContain('chunkBlobEntries');
  expect(gitRead).toContain('readBlobEntryBatch');
  expect(gitRead).toContain('withIsolatedTextAttributeReader');
  expect(gitRead).toContain("['cat-file', '--batch']");
  expect(gitRead).toContain("'core.attributesFile='");
  expect(gitRead).toContain("GIT_ATTR_NOSYSTEM: '1'");
  expect(gitRead).toContain('GIT_OBJECT_DIRECTORY');
  expect(gitRead).toContain("env.GIT_NO_REPLACE_OBJECTS = '1'");
  expect(gitRead).toContain("env.GIT_NO_LAZY_FETCH = '1'");
  expect(gitRead).toContain("env.GIT_LITERAL_PATHSPECS = '1'");
  for (const ambient of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_OBJECT_DIRECTORY', 'GIT_ATTR_SOURCE', 'GIT_GLOB_PATHSPECS']) {
    expect(gitRead).toContain(`'${ambient}'`);
  }

  for (const source of [census, settlement]) {
    expect(source).toContain("from '../git/git-read.ts'");
    expect(source).not.toContain('spawnSync');
    expect(source).not.toContain('function getBlobSha');
    expect(source).not.toContain('function checkAttributes');
  }
});

test('text census binds one committed epoch and processes blob bytes in bounded batches', async () => {
  const source = await readCompilerFile('tooling/sec-dev/text/text-byte-census.ts');

  expect(source).toContain('const sourceCommit = resolveExactHeadCommit(root);');
  expect(source).toContain('readCommitBlobInventory(root, sourceCommit)');
  expect(source).toContain('chunkBlobEntries(files');
  expect(source).toContain('readBlobEntryBatch(root, batch)');
  expect(source).toContain('withIsolatedTextAttributeReader(root, sourceCommit');
  expect(source).toContain('CENSUS_BLOB_BATCH_MAX_BYTES');
  expect(source).not.toContain("['ls-files', '-z']");
  expect(source).not.toContain("['ls-tree', 'HEAD'");
  expect(source).not.toContain("['cat-file', 'blob'");
});

test('worktree settlement filters attributes before bounded blob reads and revalidates repository state', async () => {
  const source = await readCompilerFile('tooling/sec-dev/workspace/worktree-settlement.ts');

  expect(source).toContain('selectGovernedFiles(root, sourceCommit, files)');
  expect(source).toContain('chunkByCount(files, SETTLEMENT_ATTRIBUTE_BATCH_MAX_ITEMS)');
  expect(source).toContain('chunkBlobEntries(selection.files');
  expect(source).toContain('readBlobEntryBatch(repositoryRoot, batch)');
  expect(source).toContain('readNoFollowOrdinaryFileV1');
  expect(source).toContain('repositoryStillMatchesObservation(root, sourceCommit)');
  expect(source.match(/repositoryStillMatchesObservation\(root, sourceCommit\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
  expect(source).toContain("status: 'unsafe'");
  expect(source).not.toContain('function readWorktreeBytes');
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
