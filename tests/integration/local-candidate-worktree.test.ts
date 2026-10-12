import { expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, constants, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { worktreePhysicalCloseoutOperations } from '../../src/bootstrap/runtime-state/worktree-closeout.ts';

import { canonicalGitChildEnvironment } from '../../src/adapters/providers/git/environment.ts';
import { createLocalGitWorktreeAddFailureActorForTests } from '../../src/adapters/providers/git/local-worktree.ts';
import * as physical from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import { acquireLocalCandidateWorktree, type LocalCandidateWorktreeLease } from '../../src/adapters/verification/platform/ci/runtime/local-candidate-worktree.ts';

function git(root: string, ...args: string[]): string {
  const result = spawnSync('git', ['-c', 'core.hooksPath=', '-c', 'core.fsmonitor=false', ...args], {
    cwd: root, env: canonicalGitChildEnvironment(), encoding: 'utf8'
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'local-candidate-'));
  git(root, 'init', '--quiet', '-b', 'main');
  writeFileSync(path.join(root, '.gitignore'), '.tmp/\n');
  writeFileSync(path.join(root, 'source.txt'), 'candidate source\n');
  git(root, 'add', '.');
  git(root, '-c', 'user.name=Candidate Fixture', '-c', 'user.email=candidate@example.invalid', 'commit', '--quiet', '-m', 'fixture');
  git(root, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(root, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  return { root, input: { authorityRoot: root,
    candidate: { headSha: git(root, 'rev-parse', 'HEAD'), headTreeSha: git(root, 'rev-parse', 'HEAD^{tree}') },
    sessionRevision: `sha256:${'1'.repeat(64)}` as const,
    actionPlanDigest: `sha256:${'2'.repeat(64)}` as const,
    maximumRepositoryObservations: 4
  } };
}

async function withFixture(run: (value: ReturnType<typeof fixture>, lease: LocalCandidateWorktreeLease) => Promise<void>) {
  const value = fixture();
  let lease: LocalCandidateWorktreeLease | undefined;
  try {
    lease = await acquireLocalCandidateWorktree(value.input, worktreePhysicalCloseoutOperations);
    await run(value, lease);
  } finally {
    await lease?.release();
    rmSync(value.root, { recursive: true, force: true });
  }
}

test('actual local candidate acquisition retains native Git use and canonical closeout removes exact registration and marker', async () => {
  await withFixture(async (value, lease) => {
    expect(lease.reused).toBe(false);
    expect(await lease.inspectRepository(lease.owner.candidateRoot)).toEqual({
      ...value.input.candidate, trackedClean: true, gitCommonDirectory: path.join(value.root, '.git')
    });
    expect(git(value.root, 'worktree', 'list', '--porcelain')).toContain(lease.owner.candidateRoot);
    expect(await lease.closeout()).toBe('removed');
    expect(existsSync(lease.owner.candidateRoot)).toBe(false);
    expect(existsSync(lease.markerPath)).toBe(false);
    expect(git(value.root, 'worktree', 'list', '--porcelain')).not.toContain(lease.owner.candidateRoot);
  });
}, 30_000);

test.skipIf(process.platform !== 'linux')('a substituted .git marker blocks retained Git use and preserves candidate ownership', async () => {
  await withFixture(async (value, lease) => {
    const markerBytes = readFileSync(lease.markerPath);
    const gitMarker = path.join(lease.owner.candidateRoot, '.git');
    renameSync(gitMarker, `${gitMarker}.original`);
    symlinkSync(path.join(value.root, '.git'), gitMarker);
    await expect(lease.inspectRepository(lease.owner.candidateRoot)).rejects.toThrow();
    expect(await lease.closeout()).toBe('retained-physical-closeout-blocked');
    expect(existsSync(lease.owner.candidateRoot)).toBe(true);
    expect(readFileSync(lease.markerPath)).toEqual(markerBytes);
  });
}, 30_000);

test.skipIf(process.platform !== 'linux')('an identically re-created owner marker is not the retained cleanup authority', async () => {
  await withFixture(async (_value, lease) => {
    const bytes = readFileSync(lease.markerPath);
    renameSync(lease.markerPath, `${lease.markerPath}.original`);
    writeFileSync(lease.markerPath, bytes);
    await expect(lease.inspectRepository(lease.owner.candidateRoot)).rejects.toThrow();
    expect(await lease.closeout()).toBe('retained-physical-closeout-blocked');
    expect(existsSync(lease.owner.candidateRoot)).toBe(true);
    expect(readFileSync(lease.markerPath)).toEqual(bytes);
  });
}, 30_000);

test('acquisition rejects a mismatched native worktree registration without removing the existing candidate or marker', async () => {
  await withFixture(async (value, lease) => {
    await lease.release();
    const bytes = readFileSync(lease.markerPath);
    const admin = readFileSync(path.join(lease.owner.candidateRoot, '.git'), 'utf8').trim().slice('gitdir: '.length);
    writeFileSync(path.join(admin, 'gitdir'), `${path.join(value.root, 'different', '.git')}\n`);
    await expect(acquireLocalCandidateWorktree(value.input, worktreePhysicalCloseoutOperations)).rejects.toThrow();
    expect(existsSync(lease.owner.candidateRoot)).toBe(true);
    expect(readFileSync(lease.markerPath)).toEqual(bytes);
  });
}, 30_000);

test('tracked candidate drift retains both the candidate and owner marker at closeout', async () => {
  await withFixture(async (value, lease) => {
    const bytes = readFileSync(lease.markerPath);
    writeFileSync(path.join(lease.owner.candidateRoot, 'source.txt'), 'changed after verification\n');
    expect(await lease.closeout()).toBe('retained-physical-closeout-blocked');
    expect(readFileSync(path.join(lease.owner.candidateRoot, 'source.txt'), 'utf8')).toBe('changed after verification\n');
    expect(readFileSync(lease.markerPath)).toEqual(bytes);
    expect(git(value.root, 'worktree', 'list', '--porcelain')).toContain(lease.owner.candidateRoot);
  });
}, 30_000);

test.skipIf(process.platform !== 'linux')('settled native checkout failure cannot be adopted without exact candidate readback', async () => {
  const value = fixture();
  try {
    const blob = git(value.root, 'rev-parse', 'HEAD:source.txt');
    const treeResult = spawnSync('git', ['mktree'], {
      cwd: value.root, env: canonicalGitChildEnvironment(), encoding: 'utf8',
      input: `100644 blob ${blob}\t${'x'.repeat(300)}\n`
    });
    if (treeResult.status !== 0) throw new Error(treeResult.stderr);
    const headTreeSha = treeResult.stdout.trim();
    const headSha = git(value.root, '-c', 'user.name=Candidate Fixture', '-c', 'user.email=candidate@example.invalid',
      'commit-tree', headTreeSha, '-p', 'HEAD', '-m', 'unmaterializable native candidate');
    const target = path.join(value.root, '.tmp', 'codex', 'verification-session-candidates', headSha);
    await expect(acquireLocalCandidateWorktree({ ...value.input, candidate: { headSha, headTreeSha } }, worktreePhysicalCloseoutOperations))
      .rejects.toThrow(/Local Git command failed|not clean/u);
    // Native Git is the oracle for its own partial-effect settlement. The
    // session must not issue a lease or erase the recovery owner marker.
    expect(existsSync(`${target}.owner.json`)).toBe(true);
    const registered = git(value.root, 'worktree', 'list', '--porcelain').includes(`worktree ${target}\n`);
    expect(registered).toBe(existsSync(target));
    if (registered) expect(git(target, 'status', '--porcelain=v1')).not.toBe('');
  } finally { rmSync(value.root, { recursive: true, force: true }); }
}, 30_000);

test('prepared acquisition failure remains retryable and genuine same-process closure permits reuse', async () => {
  const value = fixture();
  let lease: LocalCandidateWorktreeLease | undefined;
  try {
    const failureActor = createLocalGitWorktreeAddFailureActorForTests({ phase: 'before-start',
      fail: async () => { throw new Error('fixture admission failed before native start'); } });
    await expect(acquireLocalCandidateWorktree({ ...value.input, failureActor }, worktreePhysicalCloseoutOperations)).rejects.toThrow('before native start');
    const markerPath = path.join(value.root, '.tmp', 'codex', 'verification-session-candidates', `${value.input.candidate.headSha}.owner.json`);
    expect(JSON.parse(readFileSync(markerPath, 'utf8')).attempt.phase).toBe('prepared');
    lease = await acquireLocalCandidateWorktree(value.input, worktreePhysicalCloseoutOperations);
    expect(lease.reused).toBe(false);
    expect(JSON.parse(readFileSync(markerPath, 'utf8')).attempt.phase).toBe('settled');
    await lease.release();
    lease = await acquireLocalCandidateWorktree(value.input, worktreePhysicalCloseoutOperations);
    expect(lease.reused).toBe(true);
    expect(git(lease.owner.candidateRoot, 'rev-parse', 'HEAD')).toBe(value.input.candidate.headSha);
    expect(git(lease.owner.candidateRoot, 'status', '--porcelain=v1')).toBe('');
    expect(await lease.closeout()).toBe('removed');
    expect(existsSync(lease.owner.candidateRoot)).toBe(false);
    expect(existsSync(markerPath)).toBe(false);
  } finally { await lease?.release(); rmSync(value.root, { recursive: true, force: true }); }
}, 30_000);

for (const residue of ['present', 'absent'] as const) {
  test.skipIf(process.platform !== 'linux')(`unresolved native add with ${residue} residue forbids the next same-identity acquisition`, async () => {
    const value = fixture();
    const control = path.join(value.root, '.tmp', 'native-add-control');
    mkdirSync(control, { recursive: true });
    const fifo = path.join(control, 'gate');
    const fifoResult = spawnSync('mkfifo', [fifo], { encoding: 'utf8' });
    if (fifoResult.status !== 0) throw new Error(fifoResult.stderr);
    const shellQuote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
    const hooks = path.join(control, 'hooks');
    mkdirSync(hooks);
    writeFileSync(path.join(hooks, 'post-checkout'), `#!/bin/sh\ncat ${shellQuote(fifo)} >/dev/null\n`, { mode: 0o700 });
    let nativeChild: ReturnType<typeof spawn> | undefined;
    let nativeClosed: Promise<void> | undefined;
    let writer: number | undefined;
    let nativeStarts = 0;
    let nativeExit: number | null | undefined;
    const failureActor = createLocalGitWorktreeAddFailureActorForTests({ phase: 'after-start-admission',
      fail: async (input) => {
        nativeStarts++;
        // A native Git root is genuinely still active. The present case has
        // completed checkout and waits in a fixture-only hook; the absent case
        // waits while reading its fixture-only include before creation begins.
        nativeChild = spawn(input.executablePath, [
          '-c', `core.hooksPath=${residue === 'present' ? hooks : '/dev/null'}`,
          ...(residue === 'absent' ? ['-c', `include.path=${fifo}`] : []),
          'worktree', 'add', '--detach', '--', input.candidateRoot, input.headSha
        ], { cwd: input.cwd, env: input.environment, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
        nativeChild.stdout?.resume();
        nativeChild.stderr?.resume();
        nativeClosed = new Promise<void>((resolve, reject) => {
          nativeChild!.once('error', reject);
          nativeChild!.once('close', (code) => { nativeExit = code; resolve(); });
        });
        const deadline = Date.now() + 5_000;
        for (;;) {
          try { writer = openSync(fifo, constants.O_WRONLY | constants.O_NONBLOCK); break; }
          catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENXIO' || Date.now() >= deadline) throw error;
            await delay(5);
          }
        }
        expect(nativeChild.exitCode).toBeNull();
        process.kill(nativeChild.pid!, 0);
        throw new Error('fixture native add termination is genuinely unproven');
      }
    });
    try {
      // Keep a genuine but never-started owner attempt for the same target.
      // Repointing JSON at it must not bypass a different unresolved add.
      const preparedFailure = createLocalGitWorktreeAddFailureActorForTests({ phase: 'before-start',
        fail: async () => { throw new Error('fixture prepared decoy, no native start'); } });
      await expect(acquireLocalCandidateWorktree({ ...value.input, failureActor: preparedFailure }, worktreePhysicalCloseoutOperations)).rejects.toThrow('prepared decoy');
      const preparedMarkerPath = path.join(value.root, '.tmp', 'codex', 'verification-session-candidates', `${value.input.candidate.headSha}.owner.json`);
      const preparedDecoy = JSON.parse(readFileSync(preparedMarkerPath, 'utf8'));
      rmSync(preparedMarkerPath);
      await expect(acquireLocalCandidateWorktree({ ...value.input, failureActor }, worktreePhysicalCloseoutOperations)).rejects.toThrow('genuinely unproven');
      const target = path.join(value.root, '.tmp', 'codex', 'verification-session-candidates', value.input.candidate.headSha);
      const markerPath = `${target}.owner.json`;
      const markerBytes = readFileSync(markerPath);
      expect(JSON.parse(markerBytes.toString('utf8')).attempt.phase).toBe('in-flight-or-unresolved');
      expect(existsSync(target)).toBe(residue === 'present');
      if (residue === 'present') {
        expect(git(target, 'rev-parse', 'HEAD')).toBe(value.input.candidate.headSha);
        expect(git(target, 'rev-parse', 'HEAD^{tree}')).toBe(value.input.candidate.headTreeSha);
        expect(git(target, 'status', '--porcelain=v1')).toBe('');
      }
      await expect(acquireLocalCandidateWorktree(value.input, worktreePhysicalCloseoutOperations)).rejects.toMatchObject({ reason: 'attempt-unresolved' });
      expect(readFileSync(markerPath)).toEqual(markerBytes);
      expect(nativeStarts).toBe(1);
      expect(nativeChild!.exitCode).toBeNull();
      process.kill(nativeChild!.pid!, 0);
      // Caller-edited JSON is not a physical closure capability.
      const forged = JSON.parse(markerBytes.toString('utf8'));
      forged.attempt.phase = 'settled';
      forged.attempt.settlementDigest = `sha256:${'9'.repeat(64)}`;
      writeFileSync(markerPath, `${JSON.stringify(forged)}\n`);
      await expect(acquireLocalCandidateWorktree(value.input, worktreePhysicalCloseoutOperations)).rejects.toMatchObject({ reason: 'attempt-unresolved' });
      for (const attemptId of [forged.attempt.attemptId, '00000000-0000-0000-0000-000000000001', preparedDecoy.attempt.attemptId]) {
        forged.attempt = { attemptId, phase: 'prepared', settlementDigest: null };
        const forgedBytes = `${JSON.stringify(forged)}\n`;
        writeFileSync(markerPath, forgedBytes);
        await expect(acquireLocalCandidateWorktree(value.input, worktreePhysicalCloseoutOperations)).rejects.toMatchObject({ reason: 'attempt-unresolved' });
        expect(readFileSync(markerPath, 'utf8')).toBe(forgedBytes);
        expect(existsSync(target)).toBe(residue === 'present');
      }
      expect(nativeChild!.exitCode).toBeNull();
      process.kill(nativeChild!.pid!, 0);
    } finally {
      // Remove only the fixture gate before EOF so a second native config read
      // cannot block on reopening the same FIFO. Join precedes repository cleanup.
      rmSync(fifo, { force: true });
      if (writer !== undefined) closeSync(writer);
      if (nativeChild !== undefined && nativeClosed !== undefined) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const closed = await Promise.race([nativeClosed.then(() => true), new Promise<false>((resolve) => {
          timer = setTimeout(() => resolve(false), 5_000);
        })]);
        if (timer !== undefined) clearTimeout(timer);
        if (!closed) {
          try { process.kill(-nativeChild.pid!, 'SIGKILL'); } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
          }
          await nativeClosed;
        }
        expect(nativeChild.exitCode !== null || nativeChild.signalCode !== null).toBe(true);
        if (closed) expect(nativeExit).toBe(0);
        try { process.kill(-nativeChild.pid!, 0); throw new Error('Fixture native Git process group remains live.'); }
        catch (error) { expect((error as NodeJS.ErrnoException).code).toBe('ESRCH'); }
      }
      rmSync(value.root, { recursive: true, force: true });
    }
  }, 30_000);
}

test('legacy candidate marker cannot imply prior-attempt closure and is preserved verbatim', async () => {
  await withFixture(async (value, lease) => {
    await lease.release();
    const owner = JSON.parse(readFileSync(lease.markerPath, 'utf8')).owner;
    const legacy = `${JSON.stringify(owner)}\n`;
    writeFileSync(lease.markerPath, legacy);
    await expect(acquireLocalCandidateWorktree(value.input, worktreePhysicalCloseoutOperations)).rejects.toMatchObject({ reason: 'legacy-attempt-unknown' });
    expect(readFileSync(lease.markerPath, 'utf8')).toBe(legacy);
    expect(existsSync(lease.owner.candidateRoot)).toBe(true);
  });
}, 30_000);


for (const interruptedReplacement of [false, true]) {
  test.skipIf(interruptedReplacement && process.platform !== 'win32')(interruptedReplacement
    ? 'Windows restart recovers the quarantined candidate marker without manufacturing prior Git closure'
    : 'restart cannot reconstruct authentic prior Git closure from candidate marker JSON', async () => {
    await withFixture(async (value, lease) => {
      await lease.release();
      const bytes = readFileSync(lease.markerPath);
      if (interruptedReplacement) {
        const parent = physical.inspectNoFollowDirectoryChain(path.dirname(lease.markerPath), 'candidate marker recovery fixture').target;
        const name = path.basename(lease.markerPath);
        const current = physical.inspectNoFollowOrdinaryFileEntry(parent, name)!;
        const next = JSON.parse(bytes.toString('utf8'));
        next.attempt = { ...next.attempt, phase: 'in-flight-or-unresolved', settlementDigest: null };
        const interruptedBytes = Buffer.from(`${JSON.stringify(next)}\n`);
        expect(() => physical.replaceDurableCanonicalFile({ parent, name, bytes: interruptedBytes,
          expectedExisting: { device: current.device, inode: current.inode }, expectedExistingBytes: bytes,
          rejectExistingHardLinks: true,
          validate: (observed) => {
            if (!Buffer.from(observed).equals(interruptedBytes)) throw new Error('fixture marker bytes changed');
          },
          windowsInterruptionActor: physical.createWindowsDurableCanonicalFileReplacementInterruptionActorForTests(
            'after-preimage-quarantine'
          )
        })).toThrow('interrupted at after-preimage-quarantine');
        expect(existsSync(lease.markerPath)).toBe(false);
      }
      const modulePath = path.resolve(import.meta.dirname, '../../src/adapters/verification/platform/ci/runtime/local-candidate-worktree.ts');
      const source = `import { acquireLocalCandidateWorktree } from ${JSON.stringify(modulePath)};
        try { const lease = await acquireLocalCandidateWorktree(${JSON.stringify(value.input)}); await lease.release(); process.exitCode = 2; }
        catch (error) { console.log(JSON.stringify({ reason: error.reason })); }`;
      const result = spawnSync(process.execPath, ['-e', source], { cwd: value.root, env: process.env,
        encoding: 'utf8', timeout: 10_000 });
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout.trim())).toEqual({ reason: 'prior-attempt-closure-unavailable' });
      expect(readFileSync(lease.markerPath)).toEqual(bytes);
      expect(existsSync(lease.owner.candidateRoot)).toBe(true);
    });
  }, 30_000);
}
