import { createHash } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs';
import path from 'node:path';

import {
  assertDurableRecoveryAuthority,
  assertGitBranchName,
  assertGitSha,
  type BranchCloseoutAttempt,
  type BranchLifecycleInventory,
  type BranchRecoveryAuthority
} from './branch-lifecycle-contract.ts';
import {
  commandErrorText,
  requireBranchCommandText,
  runBranchCommand,
  type BranchLifecycleContext
} from './branch-lifecycle-command.ts';

function fsyncPath(filePath: string): void {
  const handle = openSync(filePath, 'r');
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

function ensureRecoveryRoot(
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

function deleteStagingRef(
  ctx: BranchLifecycleContext,
  repositoryRoot: string,
  stagingRef: string
): void {
  runBranchCommand(ctx, 'git', ['update-ref', '-d', stagingRef], repositoryRoot);
}

export function createRecoveryBundle(input: {
  ctx: BranchLifecycleContext;
  inventory: BranchLifecycleInventory;
  branch: string;
  expectedSha: string;
}): { recovery: BranchRecoveryAuthority; attempts: BranchCloseoutAttempt[] } {
  const { ctx, inventory, branch, expectedSha } = input;
  assertGitBranchName(branch);
  assertGitSha(expectedSha, 'recovery expected SHA');
  const attempts: BranchCloseoutAttempt[] = [];
  const repositoryRoot = inventory.repository.root;
  const recoveryRoot = ensureRecoveryRoot(inventory, ctx.recoveryRoot);
  const token = `${Date.now()}-${process.pid}-${expectedSha.slice(0, 12)}`;
  const stagingRef = `refs/sec/closeout-staging/${token}`;
  const safeBranch = sanitizeFileSegment(branch);
  const bundleName = `sec-branch-closeout-${safeBranch}-${token}.bundle`;
  const bundlePath = path.join(recoveryRoot, bundleName);
  const checksumPath = `${bundlePath}.sha256`;

  try {
    const fetch = runBranchCommand(ctx, 'git', [
      'fetch',
      '--no-tags',
      inventory.repository.remote,
      `+refs/heads/${branch}:${stagingRef}`
    ], repositoryRoot);
    if (fetch.status !== 0) {
      throw new Error(`recovery fetch failed: ${commandErrorText(fetch)}`);
    }
    const fetchedSha = requireBranchCommandText(
      ctx,
      'git',
      ['rev-parse', '--verify', stagingRef],
      'recovery staging ref resolution',
      repositoryRoot
    );
    if (fetchedSha !== expectedSha) {
      throw new Error(
        `remote SHA raced during recovery preparation: expected ${expectedSha}, fetched ${fetchedSha}`
      );
    }

    const partialBundlePath = `${bundlePath}.${process.pid}.partial`;
    const create = runBranchCommand(
      ctx,
      'git',
      ['bundle', 'create', partialBundlePath, stagingRef],
      repositoryRoot
    );
    if (create.status !== 0) {
      try { unlinkSync(partialBundlePath); } catch { /* no residue */ }
      throw new Error(`git bundle create failed: ${commandErrorText(create)}`);
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
      detail: bundlePath
    });

    const verify = runBranchCommand(ctx, 'git', ['bundle', 'verify', bundlePath], repositoryRoot);
    const verifyOutput = [
      verify.stdout.toString('utf8').trim(),
      verify.stderr.toString('utf8').trim()
    ].filter(Boolean).join('\n');
    if (verify.status !== 0) {
      attempts.push({
        operation: 'recovery-verify',
        status: 'failed',
        detail: verifyOutput || commandErrorText(verify)
      });
      throw new Error(`git bundle verify failed: ${verifyOutput || commandErrorText(verify)}`);
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
    deleteStagingRef(ctx, repositoryRoot, stagingRef);
  }
}

export function verifyRecoveryAuthorityLive(input: {
  ctx: BranchLifecycleContext;
  inventory: BranchLifecycleInventory;
  recovery: BranchRecoveryAuthority;
}): BranchCloseoutAttempt {
  const { ctx, inventory, recovery } = input;
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
    const verify = runBranchCommand(
      ctx,
      'git',
      ['bundle', 'verify', recovery.path],
      inventory.repository.root
    );
    const output = [
      verify.stdout.toString('utf8').trim(),
      verify.stderr.toString('utf8').trim()
    ].filter(Boolean).join('\n');
    if (verify.status !== 0) {
      throw new Error(`git bundle verify failed: ${output || commandErrorText(verify)}`);
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
