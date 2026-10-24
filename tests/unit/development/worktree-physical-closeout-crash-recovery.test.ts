import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { worktreePhysicalCloseoutOperations } from '../../../src/bootstrap/runtime-state/worktree-closeout.ts';

import { detailDigest } from '../../../src/adapters/runtime-state/worktree-closeout-contract.ts';
import { assertTrustedCompletedWorktreePhysicalCloseout, prepareTrustedWorktreePhysicalCloseout } from '../../../src/adapters/self-hosting/control/branch-lifecycle/worktree-physical-closeout.ts';

function git(cwd: string, args: string[]): string { const r = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true }); if (r.status !== 0) throw new Error(r.stderr); return r.stdout.trim(); }
async function waitFor(check: () => boolean): Promise<boolean> { const until = Date.now() + 20_000; while (Date.now() < until) { if (check()) return true; await Bun.sleep(10); } return check(); }
function killFixtureTree(pid: number): void {
  if (process.platform === 'win32') {
    const result = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error(`taskkill failed for fixture ${pid}: ${result.stderr}`);
    return;
  }
  try { process.kill(pid, 'SIGKILL'); } catch (error) { throw new Error(`SIGKILL failed for fixture ${pid}: ${String(error)}`); }
}
function diagnosticTree(root: string, depth = 0): string[] {
  if (!existsSync(root) || depth > 2) return [];
  const rows: string[] = [];
  for (const name of readdirSync(root).sort()) {
    const item = path.join(root, name); let metadata;
    try { metadata = lstatSync(item); } catch { continue; }
    rows.push(`${'  '.repeat(depth)}${path.relative(root, item) || name}:${metadata.isDirectory() ? 'dir' : metadata.isSymbolicLink() ? 'link' : 'file'}:${metadata.size}`);
    if (metadata.isDirectory() && !metadata.isSymbolicLink()) rows.push(...diagnosticTree(item, depth + 1));
    else if (metadata.isFile() && metadata.size < 16_384 && /(?:\.json|HEAD|gitdir|commondir)$/u.test(name)) {
      rows.push(`${'  '.repeat(depth + 1)}${readFileSync(item, 'utf8').trim()}`);
    }
  }
  return rows;
}

function recoveryTreeBytes(root: string): readonly unknown[] {
  return readdirSync(root).sort().map(name => {
    const entry = path.join(root, name);
    const metadata = lstatSync(entry, { bigint: true });
    expect(metadata.isSymbolicLink()).toBe(false);
    expect(metadata.isDirectory() || metadata.isFile()).toBe(true);
    return [name, metadata.dev, metadata.ino,
      metadata.isDirectory() ? recoveryTreeBytes(entry) : readFileSync(entry)];
  });
}

test('real child death before terminal preserves durable recovery evidence without authorizing stale takeover', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-closeout-crash-')); const remote = path.join(root, 'remote.git'); const repository = path.join(root, 'repository'); const target = path.join(root, 'candidate');
  let activeChild: { readonly pid: number; readonly exitCode: number | null; readonly exited: Promise<number> } | undefined;
  try {
    git(root, ['init', '--bare', remote]); git(root, ['init', '-b', 'main', repository]); git(repository, ['config', 'user.name', 'SEC']); git(repository, ['config', 'user.email', 'sec@example.invalid']); git(repository, ['config', 'core.autocrlf', 'false']);
    writeFileSync(path.join(repository, 'a.txt'), 'a\n'); git(repository, ['add', '.']); git(repository, ['commit', '-m', 'base']); git(repository, ['remote', 'add', 'origin', remote]); git(repository, ['push', '-u', 'origin', 'main']); git(remote, ['symbolic-ref', 'HEAD', 'refs/heads/main']); git(repository, ['remote', 'set-head', 'origin', 'main']);
    const branch = 'codex/crash'; git(repository, ['branch', branch]); git(repository, ['worktree', 'add', target, branch]);
    // A few hundred entries leave a real retained-cleanup interval after the
    // durable marker without making the fresh convergence itself unbounded on
    // Windows directory-durability barriers.
    for (let i = 0; i < 50; i += 1) writeFileSync(path.join(target, `slow-${i}.txt`), `${i}\n`); git(target, ['add', '.']); git(target, ['commit', '-m', 'slow']);
    const headSha = git(target, ['rev-parse', 'HEAD']); const treeSha = git(target, ['rev-parse', 'HEAD^{tree}']); const recoveryAuthorityDigest = detailDigest('crash-child');
    const prepared = await prepareTrustedWorktreePhysicalCloseout({ repositoryRoot: repository, targetPath: target, expectedBranch: branch, expectedHeadSha: headSha, expectedTreeSha: treeSha, expectedRecoveryAuthorityDigest: recoveryAuthorityDigest }, worktreePhysicalCloseoutOperations);
    const input = { repositoryRoot: repository, targetPath: target, expectedBranch: branch, expectedHeadSha: headSha, expectedTreeSha: treeSha, expectedRecoveryAuthorityDigest: recoveryAuthorityDigest, authorizationPath: prepared.authorization.authorizationPath };
    const fixture = path.join(import.meta.dir, './worktree-physical-closeout-crash-fixture.ts');
    const firstOutput = path.join(root, 'first-receipt.json');
    const handshake = path.join(root, 'fence-before-terminal.json');
    const child = Bun.spawn([
      'bun', fixture, JSON.stringify(input), firstOutput,
      'pause-after-fence-before-terminal', handshake
    ], { stdout: 'pipe', stderr: 'pipe' });
    activeChild = child;
    const proofRoot = prepared.authorization.proofRoot.path;
    const observed = await waitFor(() => {
      if (!existsSync(handshake)) return false;
      const proofEntries = readdirSync(proofRoot);
      const fenceEntries = readdirSync(path.dirname(target));
      return proofEntries.filter((name) => /^\.workspace-write-lease-transition-[0-9a-f]{64}\.json$/u.test(name)).length === 1 &&
        !proofEntries.some((name) => /^workspace-write-lease-retired-namespace-[0-9a-f]{64}$/u.test(name)) &&
        fenceEntries.some((name) => /^\.workspace-write-lease-retired-[0-9a-f]{64}\.json$/u.test(name));
    });
    if (!observed) throw new Error(`fixture never exposed the exact durable-fence/terminal-pending shape:\n${diagnosticTree(root).join('\n')}`);
    expect(JSON.parse(readFileSync(handshake, 'utf8'))).toMatchObject({ stage: 'acquisition-fence-durable-terminal-pending', proofRoot: path.resolve(proofRoot) });
    killFixtureTree(child.pid); expect(await child.exited).not.toBe(0);
    const proofNames = readdirSync(proofRoot).sort();
    const fenceNames = readdirSync(path.dirname(target))
      .filter(name => /^\.workspace-write-lease-retired-[0-9a-f]{64}\.json$/u.test(name)).sort();
    expect(fenceNames).toHaveLength(1);
    const recoveryFiles = [input.authorizationPath,
      ...proofNames.map(name => path.join(proofRoot, name)),
      ...fenceNames.map(name => path.join(path.dirname(target), name))];
    const retainedBytes = recoveryFiles.map(file => [file, readFileSync(file)] as const);
    const registeredBefore = git(repository, ['worktree', 'list', '--porcelain']);
    expect(registeredBefore).toContain(`branch refs/heads/${branch}`);
    const tombstonePath = path.join(path.dirname(target), prepared.authorization.tombstoneName);
    const tombstoneBefore = lstatSync(tombstonePath, { bigint: true });
    expect(tombstoneBefore.isDirectory()).toBe(true);
    const retainedRoots = [path.dirname(input.authorizationPath),
      path.join(repository, '.git', '.sec', 'workspace-write-lease'),
      path.join(repository, '.sec', 'workspace-write-lease'),
      path.join(tombstonePath, '.sec', 'workspace-write-lease')];
    const retainedTrees = retainedRoots.map(directory => [directory, recoveryTreeBytes(directory)] as const);
    expect(existsSync(firstOutput)).toBe(false);
    // The original process has exited, but neither its stale heartbeat nor the
    // preterminal fence proves every effect settled. Let the canonical stale
    // window elapse without releasing or rewriting the original leases.
    await Bun.sleep(36_000);
    const resumedOutput = path.join(root, 'resumed-receipt.json');
    const resumed = Bun.spawn(['bun', fixture, JSON.stringify(input), resumedOutput], { stdout: 'pipe', stderr: 'pipe' });
    activeChild = resumed;
    // Keep the original bounded child window; a fresh process must refuse
    // stale takeover, not manufacture a terminal from process death.
    const status = await Promise.race([resumed.exited, Bun.sleep(90_000).then(() => null)]);
    if (status === null) {
      const snapshot = diagnosticTree(root).join('\n');
      killFixtureTree(resumed.pid);
      throw new Error(`fresh child did not finish its stale-recovery refusal: ${await new Response(resumed.stderr).text()}\n${snapshot}`);
    }
    expect(status).not.toBe(0);
    expect(await new Response(resumed.stderr).text()).toContain(
      'Workspace writer lease predecessor process/effect settlement is unproven; legacy state is preserved'
    );
    expect(existsSync(resumedOutput)).toBe(false);
    expect(git(repository, ['worktree', 'list', '--porcelain'])).toBe(registeredBefore);
    expect(readdirSync(proofRoot).sort()).toEqual(proofNames);
    expect(readdirSync(path.dirname(target))
      .filter(name => /^\.workspace-write-lease-retired-[0-9a-f]{64}\.json$/u.test(name)).sort()).toEqual(fenceNames);
    for (const [file, bytes] of retainedBytes) expect(readFileSync(file)).toEqual(bytes);
    for (const [directory, bytes] of retainedTrees) expect(recoveryTreeBytes(directory)).toEqual(bytes);
    const tombstoneAfter = lstatSync(tombstonePath, { bigint: true });
    expect([tombstoneAfter.dev, tombstoneAfter.ino]).toEqual([tombstoneBefore.dev, tombstoneBefore.ino]);
    expect(readFileSync(path.join(tombstonePath, 'a.txt'), 'utf8')).toBe('a\n');
    for (let i = 0; i < 50; i += 1) {
      expect(readFileSync(path.join(tombstonePath, `slow-${i}.txt`), 'utf8')).toBe(`${i}\n`);
    }
    expect(existsSync(target)).toBe(false);
    // A failed fresh attempt cannot upgrade the original process-local token.
    expect(() => assertTrustedCompletedWorktreePhysicalCloseout({
      token: prepared.token, repositoryRoot: repository, targetPath: target,
      branch, headSha, treeSha, recoveryAuthorityDigest
    })).toThrow('did not witness this process-held retirement');
  } finally {
    try {
      if (activeChild?.exitCode === null) killFixtureTree(activeChild.pid);
      await activeChild?.exited;
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
}, 180_000);
