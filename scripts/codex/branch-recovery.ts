import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';

import {
  createBranchLifecycleGitChildEnvironmentV1,
  decodeBranchLifecycleChildErrorV1,
  decodeBranchLifecycleChildStdoutV1
} from './branch-lifecycle-command.ts';
import {
  assertDurableRecoveryAuthority,
  assertGitBranchName,
  assertGitSha,
  type BranchCloseoutAttempt,
  type BranchLifecycleInventory,
  type BranchRecoveryAuthority
} from './branch-lifecycle-contract.ts';

const COMMAND_TIMEOUT_MS = 60_000;
const COMMAND_MAX_BUFFER = 32 * 1024 * 1024;

function runRecoveryGit(cwd: string, args: readonly string[]) {
  if (args.some((arg) => arg.includes('\0'))) {
    throw new Error('Recovery command argument contains NUL.');
  }
  const result = spawnSync('git', [...args], {
    cwd,
    encoding: 'buffer',
    windowsHide: true,
    timeout: COMMAND_TIMEOUT_MS,
    maxBuffer: COMMAND_MAX_BUFFER,
    env: createBranchLifecycleGitChildEnvironmentV1(process.env)
  });
  return {
    status: result.status,
    stdout: Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(String(result.stdout ?? '')),
    stderr: Buffer.isBuffer(result.stderr)
      ? result.stderr
      : Buffer.from(String(result.stderr ?? result.error?.message ?? ''))
  };
}

function requireRecoveryGitText(cwd: string, args: readonly string[], label: string): string {
  const result = runRecoveryGit(cwd, args);
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${decodeBranchLifecycleChildErrorV1(result)}`);
  }
  return decodeBranchLifecycleChildStdoutV1(result);
}

function fsyncPath(filePath: string): void {
  const handle = openSync(filePath, 'r+');
  try {
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
}

function fsyncDirectory(directoryPath: string): void {
  try {
    fsyncPath(directoryPath);
  } catch {
    // Windows does not always permit opening a directory for fsync. The file
    // itself is still flushed before the rename completes.
  }
}

export function writeDurableFile(filePath: string, content: string | Buffer): void {
  const directory = path.dirname(filePath);
  mkdirSync(directory, { recursive: true });
  const temporary = path.join(
    directory,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.partial`
  );
  try {
    writeFileSync(temporary, content, { flag: 'wx' });
    fsyncPath(temporary);
    renameSync(temporary, filePath);
    fsyncPath(filePath);
    fsyncDirectory(directory);
  } catch (error) {
    try { unlinkSync(temporary); } catch { /* no residue */ }
    throw error;
  }
}

function sanitizeFileSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80);
}

function defaultRecoveryRoot(inventory: BranchLifecycleInventory): string {
  return path.resolve(
    path.dirname(inventory.repository.root),
    `${path.basename(inventory.repository.root)}-recovery`
  );
}

export function ensureRecoveryRoot(
  inventory: BranchLifecycleInventory,
  configuredRoot: string | undefined
): string {
  const requested = configuredRoot
    ?? process.env.SEC_BRANCH_RECOVERY_ROOT
    ?? defaultRecoveryRoot(inventory);
  const absolute = path.resolve(requested);
  mkdirSync(absolute, { recursive: true });
  const real = realpathSync(absolute);
  const probe: BranchRecoveryAuthority = {
    kind: 'bundle',
    path: path.join(real, 'durability-probe.bundle'),
    sha256: `sha256:${'0'.repeat(64)}`,
    verified: true,
    verifyOutput: 'path-only durability probe'
  };
  assertDurableRecoveryAuthority(probe, inventory);
  return real;
}

export function createRecoveryBundle(input: {
  inventory: BranchLifecycleInventory;
  branch: string;
  expectedSha: string;
  recoveryRoot?: string;
  refSource?: { kind: 'branch' } | { kind: 'pull'; number: number };
}): { recovery: BranchRecoveryAuthority; attempts: BranchCloseoutAttempt[] } {
  const { inventory, branch, expectedSha } = input;
  const refSource = input.refSource ?? { kind: 'branch' as const };
  assertGitBranchName(branch);
  assertGitSha(expectedSha, 'recovery expected SHA');
  if (
    refSource.kind === 'pull'
    && (!Number.isSafeInteger(refSource.number) || refSource.number <= 0)
  ) {
    throw new Error('pull recovery source requires a positive PR number.');
  }
  const attempts: BranchCloseoutAttempt[] = [];
  const repositoryRoot = inventory.repository.root;
  const recoveryRoot = ensureRecoveryRoot(inventory, input.recoveryRoot);
  const token = `${Date.now()}-${process.pid}-${expectedSha.slice(0, 12)}`;
  const safeBranch = sanitizeFileSegment(branch);
  const bundleName = `sec-branch-closeout-${safeBranch}-${token}.bundle`;
  const bundlePath = path.join(recoveryRoot, bundleName);
  const checksumPath = `${bundlePath}.sha256`;
  const sourceSpec = refSource.kind === 'pull'
    ? `refs/pull/${refSource.number}/head`
    : `refs/heads/${branch}`;
  const sourceLabel = refSource.kind === 'pull'
    ? `pull/${refSource.number} head`
    : `remote branch ${branch}`;
  const temporaryRepository = mkdtempSync(path.join(recoveryRoot, '.sec-recovery-fetch-'));

  try {
    const initialize = runRecoveryGit(temporaryRepository, ['init', '--bare', '.']);
    if (initialize.status !== 0) {
      throw new Error(`recovery repository initialization failed: ${decodeBranchLifecycleChildErrorV1(initialize)}`);
    }
    const fetch = runRecoveryGit(temporaryRepository, [
      'fetch',
      '--no-tags',
      inventory.repository.remoteUrl,
      `+${sourceSpec}:refs/heads/recovery`
    ]);
    if (fetch.status !== 0) {
      throw new Error(
        `recovery fetch failed (${sourceLabel}): ${decodeBranchLifecycleChildErrorV1(fetch)}`
      );
    }
    const fetchedSha = requireRecoveryGitText(
      temporaryRepository,
      ['rev-parse', '--verify', 'refs/heads/recovery'],
      'recovery source resolution'
    );
    if (fetchedSha !== expectedSha) {
      throw new Error(
        `${sourceLabel} SHA raced during recovery preparation: expected ${expectedSha}, fetched ${fetchedSha}`
      );
    }

    const partialBundlePath = `${bundlePath}.${process.pid}.partial`;
    const create = runRecoveryGit(
      temporaryRepository,
      ['bundle', 'create', partialBundlePath, 'refs/heads/recovery']
    );
    if (create.status !== 0) {
      try { unlinkSync(partialBundlePath); } catch { /* no residue */ }
      throw new Error(`git bundle create failed: ${decodeBranchLifecycleChildErrorV1(create)}`);
    }
    if (statSync(partialBundlePath).size <= 0) {
      try { unlinkSync(partialBundlePath); } catch { /* no residue */ }
      throw new Error('recovery bundle is empty');
    }
    fsyncPath(partialBundlePath);
    renameSync(partialBundlePath, bundlePath);
    fsyncPath(bundlePath);
    fsyncDirectory(recoveryRoot);
    attempts.push({
      operation: 'recovery-create',
      status: 'success',
      detail: `${bundlePath} (source ${sourceLabel})`
    });

    const verify = runRecoveryGit(repositoryRoot, ['bundle', 'verify', bundlePath]);
    const verifyOutput = [
      verify.stdout.toString('utf8').trim(),
      verify.stderr.toString('utf8').trim()
    ].filter(Boolean).join('\n');
    if (verify.status !== 0) {
      attempts.push({
        operation: 'recovery-verify',
        status: 'failed',
        detail: verifyOutput || decodeBranchLifecycleChildErrorV1(verify)
      });
      throw new Error(
        `git bundle verify failed: ${verifyOutput || decodeBranchLifecycleChildErrorV1(verify)}`
      );
    }

    const digest = createHash('sha256').update(readFileSync(bundlePath)).digest('hex');
    writeDurableFile(checksumPath, `${digest}  ${path.basename(bundlePath)}\n`);
    const recovery: BranchRecoveryAuthority = {
      kind: 'bundle',
      path: realpathSync(bundlePath),
      sha256: `sha256:${digest}`,
      verified: true,
      verifyOutput
    };
    assertDurableRecoveryAuthority(recovery, inventory);
    attempts.push({
      operation: 'recovery-verify',
      status: 'success',
      detail: `${recovery.sha256}; ${verifyOutput}`
    });
    return { recovery, attempts };
  } finally {
    rmSync(temporaryRepository, { recursive: true, force: true });
  }
}

export function verifyRecoveryAuthorityLive(input: {
  inventory: BranchLifecycleInventory;
  recovery: BranchRecoveryAuthority;
}): BranchCloseoutAttempt {
  const { inventory, recovery } = input;
  try {
    assertDurableRecoveryAuthority(recovery, inventory);
    const bytes = readFileSync(recovery.path);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (`sha256:${digest}` !== recovery.sha256) {
      throw new Error(
        `recovery bundle digest mismatch: expected ${recovery.sha256}, observed sha256:${digest}`
      );
    }
    const expectedChecksum = `${digest}  ${path.basename(recovery.path)}\n`;
    const checksum = readFileSync(`${recovery.path}.sha256`, 'utf8');
    if (checksum !== expectedChecksum) {
      throw new Error('recovery checksum sidecar does not match the verified bundle');
    }
    const verify = runRecoveryGit(inventory.repository.root, ['bundle', 'verify', recovery.path]);
    const output = [
      verify.stdout.toString('utf8').trim(),
      verify.stderr.toString('utf8').trim()
    ].filter(Boolean).join('\n');
    if (verify.status !== 0) {
      throw new Error(
        `git bundle verify failed: ${output || decodeBranchLifecycleChildErrorV1(verify)}`
      );
    }
    return {
      operation: 'recovery-verify',
      status: 'success',
      detail: `live revalidation ${recovery.sha256}; ${output}`
    };
  } catch (error) {
    return {
      operation: 'recovery-verify',
      status: 'failed',
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}
