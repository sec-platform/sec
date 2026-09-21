import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { assertTrustedCompletedWorktreePhysicalCloseout, prepareTrustedWorktreePhysicalCloseout } from '../../src/adapters/self-hosting/control/branch-lifecycle/worktree-physical-closeout.ts';
import { detailDigest } from '../../src/adapters/runtime-state/worktree-closeout-contract.ts';

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

test('real child death after durable acquisition fence but before terminal lets a fresh process converge without upgrading the opaque token', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-closeout-crash-')); const remote = path.join(root, 'remote.git'); const repository = path.join(root, 'repository'); const target = path.join(root, 'candidate');
  try {
    git(root, ['init', '--bare', remote]); git(root, ['init', '-b', 'main', repository]); git(repository, ['config', 'user.name', 'SEC']); git(repository, ['config', 'user.email', 'sec@example.invalid']); git(repository, ['config', 'core.autocrlf', 'false']);
    writeFileSync(path.join(repository, 'a.txt'), 'a\n'); git(repository, ['add', '.']); git(repository, ['commit', '-m', 'base']); git(repository, ['remote', 'add', 'origin', remote]); git(repository, ['push', '-u', 'origin', 'main']); git(remote, ['symbolic-ref', 'HEAD', 'refs/heads/main']); git(repository, ['remote', 'set-head', 'origin', 'main']);
    const branch = 'codex/crash'; git(repository, ['branch', branch]); git(repository, ['worktree', 'add', target, branch]);
    // A few hundred entries leave a real retained-cleanup interval after the
    // durable marker without making the fresh convergence itself unbounded on
    // Windows directory-durability barriers.
    for (let i = 0; i < 50; i += 1) writeFileSync(path.join(target, `slow-${i}.txt`), `${i}\n`); git(target, ['add', '.']); git(target, ['commit', '-m', 'slow']);
    const headSha = git(target, ['rev-parse', 'HEAD']); const treeSha = git(target, ['rev-parse', 'HEAD^{tree}']); const recoveryAuthorityDigest = detailDigest('crash-child');
    const prepared = await prepareTrustedWorktreePhysicalCloseout({ repositoryRoot: repository, targetPath: target, expectedBranch: branch, expectedHeadSha: headSha, expectedTreeSha: treeSha, expectedRecoveryAuthorityDigest: recoveryAuthorityDigest });
    const input = { repositoryRoot: repository, targetPath: target, expectedBranch: branch, expectedHeadSha: headSha, expectedTreeSha: treeSha, expectedRecoveryAuthorityDigest: recoveryAuthorityDigest, authorizationPath: prepared.authorization.authorizationPath };
    const fixture = path.join(import.meta.dir, 'worktree-physical-closeout-crash-fixture.ts');
    const firstOutput = path.join(root, 'first-receipt.json');
    const handshake = path.join(root, 'fence-before-terminal.json');
    const child = Bun.spawn([
      'bun', fixture, JSON.stringify(input), firstOutput,
      'pause-after-fence-before-terminal', handshake
    ], { stdout: 'pipe', stderr: 'pipe' });
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
    // The killed executor can hold both repository and target leases.  Let
    // their canonical stale/liveness recovery windows elapse; no test-side
    // release, heartbeat rewrite, or lease manager option is used.
    await Bun.sleep(36_000);
    const resumedOutput = path.join(root, 'resumed-receipt.json');
    const resumed = Bun.spawn(['bun', fixture, JSON.stringify(input), resumedOutput], { stdout: 'pipe', stderr: 'pipe' });
    // The killed child may leave both the repository and relocated target
    // leases live.  Fresh acquisition resolves their canonical 30s stale
    // windows serially, so this is intentionally wider than one stale window.
    const status = await Promise.race([resumed.exited, Bun.sleep(90_000).then(() => null)]);
    if (status === null) {
      const snapshot = diagnosticTree(root).join('\n');
      killFixtureTree(resumed.pid);
      throw new Error(`fresh child did not finish after stale recovery: ${await new Response(resumed.stderr).text()}\n${snapshot}`);
    }
    expect(status).toBe(0);
    const receipt = JSON.parse(readFileSync(resumedOutput, 'utf8')) as { terminal: string; receiptDigest: `sha256:${string}` };
    expect(receipt.terminal).toBe('completed');
    expect(existsSync(target)).toBe(false);
    // A later process may converge the physical registry/target state, but it
    // cannot upgrade the original process-local branch/ref capability.
    expect(() => assertTrustedCompletedWorktreePhysicalCloseout({
      token: prepared.token, repositoryRoot: repository, targetPath: target,
      branch, headSha, treeSha, recoveryAuthorityDigest
    })).toThrow('did not witness this process-held retirement');
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 180_000);
