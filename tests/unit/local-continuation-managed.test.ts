import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createLocalContinuationCheckpointV1 } from '../../platform/shared/local-continuation-checkpoint.ts';
import { encodeVerificationActionDataV2 } from '../../platform/shared/verification-action-contract.ts';

function run(cwd: string, command: string, args: readonly string[], env: NodeJS.ProcessEnv = process.env) {
  const result = spawnSync(command, [...args], { cwd, encoding: 'utf8', windowsHide: true, env });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (${result.status}): ${result.stderr || result.stdout}`);
  }
  return (result.stdout ?? '').trim();
}

function git(cwd: string, ...args: string[]): string {
  return run(cwd, 'git', args);
}

function invoke(cwd: string, script: string, env: NodeJS.ProcessEnv, ...args: string[]) {
  const result = spawnSync(process.execPath, [script, 'continue', ...args, '--json'], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    env
  });
  return result;
}

test('one upstream handoff becomes managed local continuation until explicit external boundaries', () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'sec-managed-continuation-'));
  const repositoryRoot = path.join(fixtureRoot, 'repo');
  const stateRoot = path.join(fixtureRoot, 'state');
  const cacheRoot = path.join(fixtureRoot, 'cache');
  const handoffPath = path.join(fixtureRoot, 'handoff.json');
  const script = path.resolve('scripts/codex/local-continuation.ts');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    SEC_STATE_HOME: stateRoot,
    SEC_CACHE_HOME: cacheRoot
  };
  try {
    mkdirSync(path.join(repositoryRoot, 'src'), { recursive: true });
    mkdirSync(path.join(repositoryRoot, 'docs', 'work-packages'), { recursive: true });
    run(repositoryRoot, 'git', ['init', '-b', 'integration/continuation-fixture']);
    git(repositoryRoot, 'config', 'user.email', 'sec@example.invalid');
    git(repositoryRoot, 'config', 'user.name', 'SEC Test');
    writeFileSync(path.join(repositoryRoot, 'src', 'value.ts'), 'export const value = 1;\n', 'utf8');
    git(repositoryRoot, 'add', '.');
    git(repositoryRoot, 'commit', '-m', 'base');
    const baseSha = git(repositoryRoot, 'rev-parse', 'HEAD');
    const baseTreeSha = git(repositoryRoot, 'rev-parse', 'HEAD^{tree}');

    const manifestPath = 'docs/work-packages/continuation-fixture-v1.md';
    writeFileSync(path.join(repositoryRoot, manifestPath), `---
schema: codex-development-work-package-v1
id: continuation-fixture-v1
tracking: none
base: ${baseSha}
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: continuation-fixture
    owner: continuation-fixture-owner
    ownedPaths:
      - docs/work-packages/continuation-fixture-v1.md
      - src/
forbiddenPaths:
  - README.md
acceptance:
  - managed-continuation
  - zero-remote-local-edit
tests:
  - bun test tests/unit/local-continuation-managed.test.ts
---

# Continuation fixture
`, 'utf8');
    writeFileSync(path.join(repositoryRoot, 'src', 'value.ts'), 'export const value = 2;\n', 'utf8');
    git(repositoryRoot, 'add', '.');
    git(repositoryRoot, 'commit', '-m', 'candidate');
    const headSha = git(repositoryRoot, 'rev-parse', 'HEAD');
    const headTreeSha = git(repositoryRoot, 'rev-parse', 'HEAD^{tree}');
    const checkpoint = createLocalContinuationCheckpointV1({
      repository: 'sec-platform/sec',
      prNumber: 496,
      branch: 'integration/continuation-fixture',
      baseSha,
      baseTreeSha,
      headSha,
      headTreeSha,
      manifestPath
    });
    writeFileSync(handoffPath, `${encodeVerificationActionDataV2(checkpoint)}\n`, 'utf8');

    const imported = invoke(repositoryRoot, script, env, '--handoff', handoffPath);
    expect(imported.status).toBe(0);
    const importedValue = JSON.parse(imported.stdout) as Record<string, unknown>;
    expect(importedValue.localState).toBe('exact-snapshot');
    expect((importedValue.invalidation as Record<string, unknown>).disposition).toBe('reuse-zero-remote');
    expect(importedValue.importedAdmission).not.toBeNull();

    const resumed = invoke(repositoryRoot, script, env);
    if (resumed.status !== 0) throw new Error(resumed.stderr || resumed.stdout);
    expect(resumed.status).toBe(0);
    const resumedValue = JSON.parse(resumed.stdout) as Record<string, unknown>;
    expect(resumedValue.localState).toBe('exact-snapshot');
    expect(resumedValue.importedAdmission).toBeNull();

    writeFileSync(path.join(repositoryRoot, 'src', 'value.ts'), 'export const value = 3;\n', 'utf8');
    const localEdit = invoke(repositoryRoot, script, env);
    expect(localEdit.status).toBe(0);
    const localEditValue = JSON.parse(localEdit.stdout) as Record<string, unknown>;
    expect(localEditValue.localState).toBe('local-candidate-diverged');
    expect((localEditValue.invalidation as Record<string, unknown>).remoteOwners).toEqual([]);

    const reviewBoundary = invoke(repositoryRoot, script, env, '--boundary', 'review');
    expect(reviewBoundary.status).toBe(0);
    const reviewValue = JSON.parse(reviewBoundary.stdout) as Record<string, unknown>;
    expect((reviewValue.invalidation as Record<string, unknown>).remoteOwners).toEqual(['review']);

    writeFileSync(path.join(repositoryRoot, 'README.md'), 'forbidden local edit\n', 'utf8');
    const forbiddenDirty = invoke(repositoryRoot, script, env);
    expect(forbiddenDirty.status).toBe(0);
    const forbiddenDirtyValue = JSON.parse(forbiddenDirty.stdout) as Record<string, unknown>;
    expect(forbiddenDirtyValue.localState).toBe('control-drift');
    expect((forbiddenDirtyValue.invalidation as Record<string, unknown>).disposition)
      .toBe('invalidate-control');

    rmSync(path.join(repositoryRoot, 'README.md'), { force: true });
    git(repositoryRoot, 'restore', '--source=HEAD', '--staged', '--worktree', '--', 'src/value.ts');
    const reimported = invoke(repositoryRoot, script, env, '--handoff', handoffPath);
    if (reimported.status !== 0) {
      const status = git(repositoryRoot, 'status', '--porcelain=v2', '--untracked-files=all');
      throw new Error(`clean handoff reimport failed; status=${JSON.stringify(status)}: ${reimported.stderr || reimported.stdout}`);
    }

    const externallyStale = invoke(repositoryRoot, script, env, '--external-changed');
    expect(externallyStale.status).toBe(0);
    expect((JSON.parse(externallyStale.stdout) as Record<string, unknown>).invalidation)
      .toMatchObject({ disposition: 'refresh-live-owner', remoteOwners: ['repository-orientation'] });
    const afterExternalChange = invoke(repositoryRoot, script, env);
    expect(afterExternalChange.status).not.toBe(0);
    expect(afterExternalChange.stderr).toContain('no managed continuation exists');
    expect(invoke(repositoryRoot, script, env, '--handoff', handoffPath).status).toBe(0);

    const stateBackup = path.join(fixtureRoot, 'state-before-control-drift');
    cpSync(stateRoot, stateBackup, { recursive: true });
    const unrelatedTree = git(repositoryRoot, 'rev-parse', 'HEAD^{tree}');
    const unrelatedCommit = run(repositoryRoot, 'git', [
      'commit-tree', unrelatedTree, '-m', 'unrelated candidate history'
    ]);
    git(repositoryRoot, 'reset', '--hard', unrelatedCommit);
    const unrelated = invoke(repositoryRoot, script, env);
    expect(unrelated.status).toBe(0);
    const unrelatedValue = JSON.parse(unrelated.stdout) as Record<string, unknown>;
    expect(unrelatedValue.localState).toBe('control-drift');
    expect((unrelatedValue.invalidation as Record<string, unknown>).disposition)
      .toBe('invalidate-control');

    git(repositoryRoot, 'reset', '--hard', headSha);
    rmSync(stateRoot, { recursive: true, force: true });
    cpSync(stateBackup, stateRoot, { recursive: true });

    const terminal = invoke(repositoryRoot, script, env, '--terminal');
    expect(terminal.status).toBe(0);
    expect((JSON.parse(terminal.stdout) as Record<string, unknown>).gc).toEqual({
      scanned: 1,
      removed: 1,
      retained: 0
    });
    const afterTerminal = invoke(repositoryRoot, script, env);
    expect(afterTerminal.status).not.toBe(0);
    expect(afterTerminal.stderr).toContain('no managed continuation exists');
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}, 60_000);
