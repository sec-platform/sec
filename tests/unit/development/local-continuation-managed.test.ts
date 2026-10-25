import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { createLocalContinuationCheckpoint, LOCAL_CONTINUATION_CHECKPOINT_MAX_BYTES } from '../../../src/adapters/self-hosting/control/continuation/checkpoint.ts';
import { encodeVerificationActionData } from '../../../src/adapters/verification/platform/action/contract/action.ts';
import { runRetainedBunTestCommand } from '../../testkit/process-resource.ts';
import { settleWorkspaceCallback } from '../../testkit/workspace-cleanup.ts';

const LOCAL_CONTINUATION_PROGRAM_PATH = path.resolve(
  import.meta.dir,
  '../../../src/adapters/self-hosting/control/continuation/local-continuation.ts'
);

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, env: process.env });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return (result.stdout ?? '').trim();
}

async function invoke(cwd: string, env: NodeJS.ProcessEnv, ...args: string[]) {
  return await runRetainedBunTestCommand([LOCAL_CONTINUATION_PROGRAM_PATH, 'continue', ...args, '--json'], {
    cwd, env, envMode: 'replace', timeoutMs: 60_000
  });
}

test.each(['codex-development-work-package-v1', 'codex-development-work-package-v3'] as const)(
  '%s upstream handoff preserves managed admission, resume and ownership', async (schema) => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'sec-managed-continuation-'));
  const repositoryRoot = path.join(fixtureRoot, 'repo');
  const stateRoot = path.join(fixtureRoot, 'state');
  const cacheRoot = path.join(fixtureRoot, 'cache');
  const handoffPath = path.join(fixtureRoot, 'handoff.json');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SEC_STATE_HOME: stateRoot,
    SEC_CACHE_HOME: cacheRoot
  };
  await settleWorkspaceCallback(async () => {
    mkdirSync(path.join(repositoryRoot, 'src'), { recursive: true });
    mkdirSync(path.join(repositoryRoot, 'config', 'repository', 'work-packages'), { recursive: true });
    git(repositoryRoot, 'init', '-b', 'integration/continuation-fixture');
    git(repositoryRoot, 'config', 'core.autocrlf', 'false');
    git(repositoryRoot, 'config', 'user.email', 'sec@example.invalid');
    git(repositoryRoot, 'config', 'user.name', 'SEC Test');
    writeFileSync(path.join(repositoryRoot, 'src', 'value.ts'), 'export const value = 1;\n', 'utf8');
    git(repositoryRoot, 'add', '.');
    git(repositoryRoot, 'commit', '-m', 'base');
    const baseSha = git(repositoryRoot, 'rev-parse', 'HEAD');
    const baseTreeSha = git(repositoryRoot, 'rev-parse', 'HEAD^{tree}');

    const manifestPath = 'config/repository/work-packages/continuation-fixture-v1.md';
    writeFileSync(path.join(repositoryRoot, manifestPath), `---
schema: ${schema}
id: continuation-fixture-v1
tracking: none
${schema === 'codex-development-work-package-v1' ? `base: ${baseSha}\n` : ''}manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: continuation-fixture
    owner: continuation-fixture-owner
    ownedPaths:
      - config/repository/work-packages/continuation-fixture-v1.md
      - src/
forbiddenPaths:
  - README.md
acceptance:
  - managed-continuation
  - zero-remote-local-edit
tests:
  - tests/unit/development/local-continuation-managed.test.ts
---

# Continuation fixture
`, 'utf8');
    writeFileSync(path.join(repositoryRoot, 'src', 'value.ts'), 'export const value = 2;\n', 'utf8');
    git(repositoryRoot, 'add', '.');
    git(repositoryRoot, 'commit', '-m', 'candidate');
    const headSha = git(repositoryRoot, 'rev-parse', 'HEAD');
    const headTreeSha = git(repositoryRoot, 'rev-parse', 'HEAD^{tree}');
    const checkpoint = createLocalContinuationCheckpoint({
      repository: 'sec-platform/sec',
      prNumber: 496,
      branch: 'integration/continuation-fixture',
      baseSha,
      baseTreeSha,
      headSha,
      headTreeSha,
      manifestPath
    });
    writeFileSync(handoffPath, `${encodeVerificationActionData(checkpoint)}\n`, 'utf8');

    if (schema === 'codex-development-work-package-v3' && process.platform !== 'win32') {
      const aliasPath = path.join(fixtureRoot, 'handoff-link.json');
      symlinkSync(handoffPath, aliasPath, 'file');
      expect((await invoke(repositoryRoot, env, '--handoff', aliasPath)).code).not.toBe(0);
      rmSync(aliasPath, { force: true });
    }
    if (schema === 'codex-development-work-package-v3') {
      const oversizedHandoffPath = path.join(fixtureRoot, 'handoff-oversized.json');
      writeFileSync(
        oversizedHandoffPath,
        ' '.repeat(LOCAL_CONTINUATION_CHECKPOINT_MAX_BYTES + 1),
        'utf8'
      );
      expect((await invoke(repositoryRoot, env, '--handoff', oversizedHandoffPath)).code).not.toBe(0);
    }

    const imported = await invoke(repositoryRoot, env, '--handoff', handoffPath);
    expect(imported.code).toBe(0);
    const importedValue = JSON.parse(imported.stdout) as Record<string, unknown>;
    expect(importedValue.localState).toBe('exact-snapshot');
    expect((importedValue.invalidation as Record<string, unknown>).disposition).toBe('reuse-zero-remote');
    expect(importedValue.importedAdmission).toMatchObject({
      baseSha, baseTreeSha, authority: 'context-compression-only'
    });

    const resumed = await invoke(repositoryRoot, env);
    expect(resumed.code, resumed.stderr || resumed.stdout).toBe(0);
    const resumedValue = JSON.parse(resumed.stdout) as Record<string, unknown>;
    expect(resumedValue.localState).toBe('exact-snapshot');
    expect(resumedValue.importedAdmission).toBeNull();

    writeFileSync(path.join(repositoryRoot, 'src', 'value.ts'), 'export const value = 3;\n', 'utf8');
    const localEdit = await invoke(repositoryRoot, env);
    expect(localEdit.code).toBe(0);
    const localEditValue = JSON.parse(localEdit.stdout) as Record<string, unknown>;
    expect(localEditValue.localState).toBe('local-candidate-diverged');
    expect((localEditValue.invalidation as Record<string, unknown>).remoteOwners).toEqual([]);

    if (schema === 'codex-development-work-package-v3') {
      const reviewBoundary = await invoke(repositoryRoot, env, '--boundary', 'review');
      expect(reviewBoundary.code).toBe(0);
      const reviewValue = JSON.parse(reviewBoundary.stdout) as Record<string, unknown>;
      expect((reviewValue.invalidation as Record<string, unknown>).remoteOwners).toEqual(['review']);
    }

    writeFileSync(path.join(repositoryRoot, 'README.md'), 'forbidden local edit\n', 'utf8');
    const forbiddenDirty = await invoke(repositoryRoot, env);
    expect(forbiddenDirty.code).toBe(0);
    const forbiddenDirtyValue = JSON.parse(forbiddenDirty.stdout) as Record<string, unknown>;
    expect(forbiddenDirtyValue.localState).toBe('control-drift');
    expect((forbiddenDirtyValue.invalidation as Record<string, unknown>).disposition)
      .toBe('invalidate-control');

    // Both manifest versions have exercised native admission, persisted resume
    // and changed-record ownership. The checkpoint/store/invalidation protocol
    // below has no Work Package schema branch; keep its real lifecycle on V3.
    if (schema === 'codex-development-work-package-v1') return;

    rmSync(path.join(repositoryRoot, 'README.md'), { force: true });
    git(repositoryRoot, 'restore', '--source=HEAD', '--staged', '--worktree', '--', 'src/value.ts');
    const reimported = await invoke(repositoryRoot, env, '--handoff', handoffPath);
    if (reimported.code !== 0) {
      const status = git(repositoryRoot, 'status', '--porcelain=v2', '--untracked-files=all');
      throw new Error(`clean handoff reimport failed; status=${JSON.stringify(status)}: ${reimported.stderr || reimported.stdout}`);
    }

    const externallyStale = await invoke(repositoryRoot, env, '--external-changed');
    expect(externallyStale.code).toBe(0);
    expect((JSON.parse(externallyStale.stdout) as Record<string, unknown>).invalidation)
      .toMatchObject({ disposition: 'refresh-live-owner', remoteOwners: ['repository-orientation'] });
    const afterExternalChange = await invoke(repositoryRoot, env);
    expect(afterExternalChange.code).not.toBe(0);
    expect(afterExternalChange.stderr).toContain('no managed continuation exists');
    expect((await invoke(repositoryRoot, env, '--handoff', handoffPath)).code).toBe(0);

    const stateBackup = path.join(fixtureRoot, 'state-before-control-drift');
    cpSync(stateRoot, stateBackup, { recursive: true });
    const unrelatedTree = git(repositoryRoot, 'rev-parse', 'HEAD^{tree}');
    const unrelatedCommit = git(repositoryRoot,
      'commit-tree', unrelatedTree, '-m', 'unrelated candidate history'
    );
    git(repositoryRoot, 'reset', '--hard', unrelatedCommit);
    const unrelated = await invoke(repositoryRoot, env);
    expect(unrelated.code).toBe(0);
    const unrelatedValue = JSON.parse(unrelated.stdout) as Record<string, unknown>;
    expect(unrelatedValue.localState).toBe('control-drift');
    expect((unrelatedValue.invalidation as Record<string, unknown>).disposition)
      .toBe('invalidate-control');

    git(repositoryRoot, 'reset', '--hard', headSha);
    rmSync(stateRoot, { recursive: true, force: true });
    cpSync(stateBackup, stateRoot, { recursive: true });

    const terminal = await invoke(repositoryRoot, env, '--terminal');
    expect(terminal.code).toBe(0);
    expect((JSON.parse(terminal.stdout) as Record<string, unknown>).gc).toEqual({
      scanned: 1,
      removed: 1,
      retained: 0
    });
    const afterTerminal = await invoke(repositoryRoot, env);
    expect(afterTerminal.code).not.toBe(0);
    expect(afterTerminal.stderr).toContain('no managed continuation exists');
  }, async () => {
    rmSync(fixtureRoot, { recursive: true, force: true });
  });
}, 60_000);
