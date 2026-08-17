import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  assertGitObjectId,
  readBlobBatch,
  readCommitBlobInventory,
  readTextAttributesBatch,
  resolveExactHeadCommit
} from '../../tooling/sec-dev/git/git-read.ts';
import { runCensus } from '../../tooling/sec-dev/text/text-byte-census.ts';
import { runSettlement } from '../../tooling/sec-dev/workspace/worktree-settlement.ts';

function git(repositoryRoot: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

async function createRepository(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  git(root, ['init', '--quiet']);
  git(root, ['config', 'user.email', 'tests@example.com']);
  git(root, ['config', 'user.name', 'SEC Tests']);
  git(root, ['config', 'core.autocrlf', 'false']);
  await fs.writeFile(path.join(root, '.gitattributes'), '*.ts text eol=lf\n');
  await fs.writeFile(path.join(root, 'committed.ts'), 'export const committed = true;\n');
  git(root, ['add', '--all']);
  git(root, ['commit', '--quiet', '-m', 'initial']);
  return root;
}

test('Git read mechanics accept full SHA-1 and SHA-256 object IDs', () => {
  expect(assertGitObjectId('a'.repeat(40), 'sha1')).toBe('a'.repeat(40));
  expect(assertGitObjectId('b'.repeat(64), 'sha256')).toBe('b'.repeat(64));
  expect(() => assertGitObjectId('c'.repeat(39), 'short')).toThrow();
  expect(() => assertGitObjectId('d'.repeat(63), 'short-sha256')).toThrow();
  expect(() => assertGitObjectId('e'.repeat(65), 'long')).toThrow();
});

test('batch blob and attribute observations bind to one exact commit', async () => {
  const root = await createRepository('sec-dev-git-batch-');
  try {
    const commit = resolveExactHeadCommit(root);
    const inventory = readCommitBlobInventory(root, commit);
    expect(inventory.map((entry) => entry.path)).toEqual(['.gitattributes', 'committed.ts']);
    expect(inventory.every((entry) => Number.isSafeInteger(entry.byteSize) && entry.byteSize >= 0)).toBe(true);

    const blobs = readBlobBatch(root, inventory.map((entry) => entry.objectId));
    const committed = inventory.find((entry) => entry.path === 'committed.ts')!;
    expect(blobs.get(committed.objectId)?.toString('utf8')).toBe('export const committed = true;\n');

    const attributes = readTextAttributesBatch(root, commit, inventory.map((entry) => entry.path));
    expect(attributes.get('committed.ts')).toEqual({ textAttr: 'set', eolAttr: 'lf' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('committed attribute policy is isolated from .git/info/attributes overrides', async () => {
  const root = await createRepository('sec-dev-attribute-isolation-');
  try {
    await fs.mkdir(path.join(root, '.git', 'info'), { recursive: true });
    await fs.writeFile(path.join(root, '.git', 'info', 'attributes'), '*.ts -text\n');
    const commit = resolveExactHeadCommit(root);

    const attributes = readTextAttributesBatch(root, commit, ['committed.ts']);
    expect(attributes.get('committed.ts')).toEqual({ textAttr: 'set', eolAttr: 'lf' });

    const census = await runCensus(root);
    expect(census.classificationCounts['canonical-lf']).toBe(1);
    expect(census.failClosed).toBe(false);

    const settlement = await runSettlement(root);
    expect(settlement.status).toBe('settled');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('legal custom Git attribute values remain fail-closed policy input instead of parser crashes', async () => {
  const root = await createRepository('sec-dev-attribute-custom-');
  try {
    await fs.writeFile(path.join(root, '.gitattributes'), '*.ts text=auto\n');
    git(root, ['add', '.gitattributes']);
    git(root, ['commit', '--quiet', '-m', 'custom-attribute']);

    const report = await runCensus(root);
    expect(report.classificationCounts.unknown).toBe(1);
    expect(report.flaggedEntries.find((entry) => entry.path === 'committed.ts')?.anomalies)
      .toContain('attributes-missing');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('text census ignores staged-only index paths and scans the captured committed blob epoch', async () => {
  const root = await createRepository('sec-dev-census-epoch-');
  try {
    const committedAttributesOid = git(root, ['rev-parse', 'HEAD:.gitattributes']);
    await fs.writeFile(path.join(root, 'staged-only.ts'), 'export const stagedOnly = true;\n');
    git(root, ['add', 'staged-only.ts']);

    const report = await runCensus(root);
    expect(report.totalFiles).toBe(2);
    expect(report.gitattributesBlobSha).toBe(committedAttributesOid);
    expect(report.classificationCounts['canonical-lf']).toBe(1);
    expect(report.flaggedEntries.some((entry) => entry.path === 'staged-only.ts')).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('worktree settlement distinguishes settled, dirty, and untracked without fail-open reads', async () => {
  const root = await createRepository('sec-dev-settlement-');
  try {
    const settled = await runSettlement(root);
    expect(settled.status).toBe('settled');
    expect(settled.dirtyCount).toBe(0);
    expect(settled.untrackedCount).toBe(0);

    await fs.writeFile(path.join(root, 'committed.ts'), 'export const committed = false;\n');
    const dirty = await runSettlement(root);
    expect(dirty.status).toBe('dirty');
    expect(dirty.dirtyCount).toBe(1);

    git(root, ['checkout', '--', 'committed.ts']);
    await fs.writeFile(path.join(root, 'untracked.ts'), 'export const untracked = true;\n');
    const untracked = await runSettlement(root);
    expect(untracked.status).toBe('untracked');
    expect(untracked.untrackedCount).toBe(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('tracked governed symlink cannot be followed and reported as settled', async () => {
  if (process.platform === 'win32') return;

  const root = await mkdtemp(path.join(tmpdir(), 'sec-dev-settlement-link-'));
  try {
    git(root, ['init', '--quiet']);
    git(root, ['config', 'user.email', 'tests@example.com']);
    git(root, ['config', 'user.name', 'SEC Tests']);
    git(root, ['config', 'core.autocrlf', 'false']);
    await fs.writeFile(path.join(root, '.gitattributes'), '*.ts text eol=lf\n');
    await fs.writeFile(path.join(root, 'target.ts'), 'export const external = true;\n');
    await fs.symlink('target.ts', path.join(root, 'linked.ts'));
    git(root, ['add', '--all']);
    git(root, ['commit', '--quiet', '-m', 'tracked-link']);

    const receipt = await runSettlement(root);
    expect(receipt.status).toBe('unsafe');
    expect(receipt.summary).toContain('Settlement exact Git/physical observation failed closed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
