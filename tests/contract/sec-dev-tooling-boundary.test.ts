import { expect, test } from 'bun:test';

import { readCompilerFile, readCompilerPackageJson } from '../helpers/compiler-fixtures.ts';

test('provider-neutral sec-dev tooling owns execution logic without Codex or CLI activation', async () => {
  for (const file of [
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
