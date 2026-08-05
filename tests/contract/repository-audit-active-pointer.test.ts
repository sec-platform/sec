import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { auditRepository } from '../../scripts/codex/repository-audit.ts';

function git(repositoryRoot: string, args: readonly string[]): string {
  const result = spawnSync('git', [...args], {
    cwd: repositoryRoot,
    encoding: 'utf8',
    windowsHide: true
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function pointer(manifestDigest: string): string {
  return [
    '---',
    'schema: sec-active-work-package-pointer-v2',
    'status: conditional',
    'last-reviewed: 2026-08-06',
    '---',
    '',
    '# Active Work Package',
    '',
    '```yaml',
    'selectionMode: exact-manifest-not-on-default-branch-v1',
    'defaultBranchRef: refs/heads/main',
    'defaultRefFreshness: live-platform-match-required',
    'manifest: docs/work-packages/fixture.md',
    `manifestDigest: sha256:${manifestDigest}`,
    'digestBytes: git-blob',
    'unavailableDefaultRef: unresolved',
    'matchingDefaultBlob: none',
    '```',
    ''
  ].join('\n');
}

function rollingPlan(): string {
  return [
    '---',
    'status: active',
    '---',
    '',
    '# Plan',
    '',
    '## 当前唯一 Work Package',
    '',
    '### fixture',
    '',
    '## 候选 Work Package',
    '',
    '### 1. successor-a',
    '',
    '### 2. successor-b',
    ''
  ].join('\n');
}

async function initializeRepository(): Promise<string> {
  const repositoryRoot = await mkdtemp(
    path.join(tmpdir(), 'sec-repository-audit-active-pointer-')
  );
  git(repositoryRoot, ['init', '--quiet', '--initial-branch=main']);
  git(repositoryRoot, ['config', 'user.name', 'SEC Test']);
  git(repositoryRoot, ['config', 'user.email', 'sec-test@example.invalid']);
  git(repositoryRoot, ['config', 'core.autocrlf', 'false']);
  await mkdir(path.join(repositoryRoot, 'docs', 'work-packages'), { recursive: true });
  await mkdir(path.join(repositoryRoot, 'docs', 'work'), { recursive: true });
  await writeFile(path.join(repositoryRoot, 'README.md'), '# Fixture\n', 'utf8');
  await writeFile(
    path.join(repositoryRoot, 'docs', 'work', 'rolling-plan.md'),
    rollingPlan(),
    'utf8'
  );
  return repositoryRoot;
}

test.serial(
  'repository audit accepts a selected manifest retained on default until successor takeover',
  async () => {
    const repositoryRoot = await initializeRepository();
    try {
      const manifest = '# Fixture Work Package\n';
      const manifestDigest = createHash('sha256').update(manifest).digest('hex');
      await writeFile(
        path.join(repositoryRoot, 'docs', 'work-packages', 'fixture.md'),
        manifest,
        'utf8'
      );
      await writeFile(
        path.join(repositoryRoot, 'docs', 'work', 'active-work-package.md'),
        pointer(manifestDigest),
        'utf8'
      );
      git(repositoryRoot, ['add', '-A']);
      git(repositoryRoot, ['commit', '--quiet', '-m', 'retain selected manifest']);
      const head = git(repositoryRoot, ['rev-parse', 'HEAD']);

      const report = await auditRepository(repositoryRoot, { defaultRef: head });

      expect(report.findings.some(({ code }) =>
        code === 'control-plane-selected-manifest-already-on-default')).toBe(false);
      expect(report.findings.some(({ code }) =>
        code === 'control-plane-digest-drift')).toBe(false);
      expect(report.findings.some(({ code }) =>
        code === 'control-plane-manifest-missing')).toBe(false);
    } finally {
      await rm(repositoryRoot, { force: true, recursive: true });
    }
  }
);

test.serial(
  'repository audit still fails closed when the selected manifest digest drifts',
  async () => {
    const repositoryRoot = await initializeRepository();
    try {
      const expectedManifest = '# Expected Work Package\n';
      const expectedDigest = createHash('sha256')
        .update(expectedManifest)
        .digest('hex');
      await writeFile(
        path.join(repositoryRoot, 'docs', 'work-packages', 'fixture.md'),
        '# Mutated Work Package\n',
        'utf8'
      );
      await writeFile(
        path.join(repositoryRoot, 'docs', 'work', 'active-work-package.md'),
        pointer(expectedDigest),
        'utf8'
      );
      git(repositoryRoot, ['add', '-A']);
      git(repositoryRoot, ['commit', '--quiet', '-m', 'drift manifest digest']);
      const head = git(repositoryRoot, ['rev-parse', 'HEAD']);

      const report = await auditRepository(repositoryRoot, { defaultRef: head });

      expect(report.findings).toContainEqual(expect.objectContaining({
        code: 'control-plane-digest-drift',
        path: 'docs/work/active-work-package.md',
        severity: 'critical'
      }));
    } finally {
      await rm(repositoryRoot, { force: true, recursive: true });
    }
  }
);

test.serial(
  'repository audit still fails closed when the selected manifest is missing',
  async () => {
    const repositoryRoot = await initializeRepository();
    try {
      await writeFile(
        path.join(repositoryRoot, 'docs', 'work', 'active-work-package.md'),
        pointer('0'.repeat(64)),
        'utf8'
      );
      git(repositoryRoot, ['add', '-A']);
      git(repositoryRoot, ['commit', '--quiet', '-m', 'reference missing manifest']);
      const head = git(repositoryRoot, ['rev-parse', 'HEAD']);

      const report = await auditRepository(repositoryRoot, { defaultRef: head });

      expect(report.findings).toContainEqual(expect.objectContaining({
        code: 'control-plane-manifest-missing',
        path: 'docs/work/active-work-package.md',
        severity: 'critical'
      }));
    } finally {
      await rm(repositoryRoot, { force: true, recursive: true });
    }
  }
);
