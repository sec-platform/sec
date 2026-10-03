import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  fsyncSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync
} from 'node:fs';
import path from 'node:path';
import type { BranchCloseoutAttempt, BranchLifecycleInventory, BranchRecoveryAuthority } from '../../../../execution/verification/branch-closeout.ts';

import { assertPhysicallyDisjointDirectoryChains, assertSameNoFollowDirectoryIdentity, createNoFollowOrdinaryDirectoryChain, deleteRetainedNoFollowEntry, inspectExactNoFollowDirectoryPresence, inspectNoFollowDirectoryChain, inspectNoFollowOrdinaryFileEntry, publishExclusiveDurableCanonicalFile, readNoFollowOrdinaryFile, scanNoFollowDirectoryTreeMetadata, type NoFollowDirectoryTreeEntry, type PhysicalDirectoryChain, type PhysicalDirectoryIdentity } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';

import {
  createBranchLifecycleGitChildEnvironment,
  createBranchLifecycleGitHubCredentialArgs,
  decodeBranchLifecycleChildError,
  decodeBranchLifecycleChildStdout
} from './branch-lifecycle-command.ts';
import { assertDurableRecoveryAuthority, assertGitBranchName, assertGitSha } from './branch-lifecycle-contract.ts';

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
    env: createBranchLifecycleGitChildEnvironment(process.env)
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
    throw new Error(`${label} failed: ${decodeBranchLifecycleChildError(result)}`);
  }
  return decodeBranchLifecycleChildStdout(result);
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

export interface BranchRecoveryStore {
  readonly root: PhysicalDirectoryIdentity;
  readonly rootChain: PhysicalDirectoryChain;
  /** True only when this acquisition created the final recovery-root inode. */
  readonly createdByAcquisition: boolean;
  readonly publishExclusive: (input: Readonly<{
    name: string;
    bytes: Uint8Array;
    validate: (bytes: Uint8Array) => void;
  }>) => Readonly<{ path: string; digest: string; created: boolean }>;
  readonly read: (name: string) => Uint8Array | null;
  readonly inspectFile: (name: string) => NoFollowDirectoryTreeEntry | null;
  readonly listOwnedFiles: (prefix: string) => readonly string[];
  readonly removeExact: (name: string, expected: NoFollowDirectoryTreeEntry) => void;
  readonly retireIfEmpty: () => boolean;
  readonly assertPhysicallyDisjointFrom: (absoluteDirectoryPaths: readonly string[]) => void;
  readonly assertCurrent: () => void;
}

function sameDirectoryIdentity(
  left: PhysicalDirectoryIdentity,
  right: PhysicalDirectoryIdentity
): boolean {
  return left.path === right.path
    && left.finalPath === right.finalPath
    && left.device === right.device
    && left.inode === right.inode
    && left.objectId === right.objectId;
}

function sameDirectoryChain(
  left: PhysicalDirectoryChain,
  right: PhysicalDirectoryChain
): boolean {
  return sameDirectoryIdentity(left.target, right.target)
    && left.ancestors.length === right.ancestors.length
    && left.ancestors.every((entry, index) =>
      sameDirectoryIdentity(entry, right.ancestors[index]!));
}

function pathInside(candidate: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!path.isAbsolute(relative)
    && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function materializeNoFollowDirectory(absolutePath: string): Readonly<{
  root: PhysicalDirectoryIdentity;
  createdPaths: readonly string[];
}> {
  const target = path.resolve(absolutePath);
  const missing: string[] = [];
  let cursor = target;
  for (;;) {
    const presence = inspectExactNoFollowDirectoryPresence(
      cursor,
      'Branch recovery directory'
    );
    if (presence.state === 'present') {
      const ancestor = presence.directory.target;
      if (missing.length > 0) createNoFollowOrdinaryDirectoryChain(ancestor, missing);
      assertSameNoFollowDirectoryIdentity(ancestor, 'Branch recovery existing ancestor');
      const root = inspectNoFollowDirectoryChain(target, 'Branch recovery directory readback').target;
      let createdPath = ancestor.path;
      const createdPaths = missing.map((segment) => {
        createdPath = path.join(createdPath, segment);
        return createdPath;
      });
      return Object.freeze({ root, createdPaths: Object.freeze(createdPaths) });
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error('Branch recovery directory has no existing physical ancestor.');
    missing.unshift(path.basename(cursor));
    cursor = parent;
  }
}

/**
 * Acquires the single branch-recovery filesystem authority.  The root may be
 * shared by the established recovery families, but this store only reads and
 * publishes caller-supplied collision-rejecting leaf names.  Every operation
 * revalidates the same physical root and never follows a link or reparse point.
 */
export function acquireBranchRecoveryStore(input: Readonly<{
  repositoryRoot: string;
  commonDir: string;
  worktreeRoots: readonly string[];
  recoveryRoot?: string;
}>): BranchRecoveryStore {
  const repositoryRoot = path.resolve(input.repositoryRoot);
  const commonDir = path.resolve(input.commonDir);
  const worktreeRoots = [...new Set(input.worktreeRoots.map((entry) => path.resolve(entry)))];
  const requested = path.resolve(
    input.recoveryRoot
      ?? path.join(path.dirname(repositoryRoot), `${path.basename(repositoryRoot)}-recovery`)
  );
  for (const forbidden of [repositoryRoot, commonDir, ...worktreeRoots]) {
    if (pathInside(requested, forbidden) || pathInside(forbidden, requested)) {
      throw new Error(`Branch recovery root must be physically separate from owned Git paths: ${forbidden}`);
    }
  }

  const repository = inspectNoFollowDirectoryChain(repositoryRoot, 'Branch recovery repository');
  const common = inspectNoFollowDirectoryChain(commonDir, 'Branch recovery common directory');
  const worktrees = worktreeRoots.map((entry) =>
    inspectNoFollowDirectoryChain(entry, 'Branch recovery worktree'));
  const materialized = materializeNoFollowDirectory(requested);
  const root = materialized.root;
  const rootChain = inspectNoFollowDirectoryChain(root.path, 'Branch recovery root');
  const createdDirectories = Object.freeze(materialized.createdPaths.map((createdPath) => {
    const identity = rootChain.ancestors.find((candidate) => candidate.path === createdPath);
    if (identity === undefined) {
      throw new Error(`Branch recovery created directory is absent from its physical chain: ${createdPath}`);
    }
    return identity;
  }));
  for (const [label, forbidden] of [
    ['repository', repository],
    ['common directory', common],
    ...worktrees.map((entry, index) => [`worktree ${index}`, entry] as const)
  ] as const) {
    assertPhysicallyDisjointDirectoryChains(
      rootChain,
      forbidden,
      `Branch recovery root and ${label}`
    );
  }

  const assertCurrentChain = (): PhysicalDirectoryChain => {
    const current = assertSameNoFollowDirectoryIdentity(root, 'Branch recovery root');
    if (!sameDirectoryChain(rootChain, current)) {
      throw new Error('Branch recovery physical ancestor chain changed.');
    }
    return current;
  };
  const assertCurrent = (): void => {
    assertCurrentChain();
  };
  return Object.freeze({
    root,
    rootChain,
    createdByAcquisition: createdDirectories.some((entry) => entry.path === root.path),
    publishExclusive: (publication: Readonly<{
      name: string;
      bytes: Uint8Array;
      validate: (bytes: Uint8Array) => void;
    }>) => {
      assertCurrent();
      const result = publishExclusiveDurableCanonicalFile({
        parent: root,
        name: publication.name,
        bytes: publication.bytes,
        validate: publication.validate
      });
      assertCurrent();
      return result;
    },
    read: (name: string) => {
      assertCurrent();
      const result = readNoFollowOrdinaryFile(root, name);
      assertCurrent();
      return result;
    },
    inspectFile: (name: string) => {
      assertCurrent();
      const result = inspectNoFollowOrdinaryFileEntry(root, name);
      assertCurrent();
      return result;
    },
    listOwnedFiles: (prefix: string) => {
      if (!/^[A-Za-z0-9._-]+$/u.test(prefix)) {
        throw new Error('Branch recovery owned-file prefix is invalid.');
      }
      assertCurrent();
      const entries = scanNoFollowDirectoryTreeMetadata(root, {
        deadlineAtMs: performance.now() + 5_000,
        maximumEntries: 20_000
      });
      const owned = entries.filter((entry) => (
        !entry.relativePath.includes('/')
        && !entry.relativePath.includes('\\')
        && entry.relativePath.startsWith(prefix)
      ));
      const unsafe = owned.find((entry) => entry.kind !== 'file');
      if (unsafe !== undefined) {
        throw new Error(`Branch recovery owned path is not an ordinary file: ${unsafe.relativePath}`);
      }
      assertCurrent();
      return Object.freeze(owned.map(({ relativePath }) => relativePath)
        .sort((left, right) => left.localeCompare(right)));
    },
    removeExact: (name: string, expected: NoFollowDirectoryTreeEntry) => {
      if (!/^[A-Za-z0-9._-]+$/u.test(name) || expected.relativePath !== name
          || expected.kind !== 'file' || expected.linkTarget !== null) {
        throw new Error('Branch recovery exact-removal binding is invalid.');
      }
      assertCurrent();
      const current = inspectNoFollowOrdinaryFileEntry(root, name);
      if (current === null || current.kind !== 'file'
          || current.device !== expected.device || current.inode !== expected.inode
          || current.size !== expected.size
          || (expected.bytes !== null && (current.bytes === null
            || !Buffer.from(current.bytes).equals(Buffer.from(expected.bytes))))) {
        throw new Error(`Branch recovery file changed before retirement: ${name}`);
      }
      deleteRetainedNoFollowEntry({
        root,
        relativePath: name,
        kind: 'file',
        device: current.device,
        inode: current.inode,
        ancestorDirectories: []
      });
      if (inspectNoFollowOrdinaryFileEntry(root, name) !== null) {
        throw new Error(`Branch recovery file remains after retirement: ${name}`);
      }
      assertCurrent();
    },
    retireIfEmpty: () => {
      assertCurrent();
      const inventory = scanNoFollowDirectoryTreeMetadata(root, {
        deadlineAtMs: performance.now() + 5_000,
        maximumEntries: 20_000
      });
      if (inventory.length !== 0) return false;
      const parent = inspectNoFollowDirectoryChain(
        path.dirname(root.path),
        'Branch recovery empty-root parent'
      ).target;
      deleteRetainedNoFollowEntry({
        root: parent,
        relativePath: path.basename(root.path),
        kind: 'directory',
        device: root.device,
        inode: root.inode,
        ancestorDirectories: []
      });
      if (inspectExactNoFollowDirectoryPresence(
        root.path,
        'Branch recovery empty-root readback'
      ).state !== 'absent') {
        throw new Error('Branch recovery empty root remains after retirement.');
      }
      for (const created of [...createdDirectories].reverse().slice(1)) {
        const presence = inspectExactNoFollowDirectoryPresence(
          created.path,
          'Branch recovery created ancestor retirement'
        );
        if (presence.state === 'absent') continue;
        const createdInventory = scanNoFollowDirectoryTreeMetadata(presence.directory.target, {
          deadlineAtMs: performance.now() + 5_000,
          maximumEntries: 20_000
        });
        if (createdInventory.length !== 0) break;
        const createdParent = inspectNoFollowDirectoryChain(
          path.dirname(created.path),
          'Branch recovery created ancestor parent'
        ).target;
        deleteRetainedNoFollowEntry({
          root: createdParent,
          relativePath: path.basename(created.path),
          kind: 'directory',
          device: created.device,
          inode: created.inode,
          ancestorDirectories: []
        });
      }
      return true;
    },
    assertPhysicallyDisjointFrom: (absoluteDirectoryPaths: readonly string[]) => {
      const current = assertCurrentChain();
      for (const directoryPath of absoluteDirectoryPaths) {
        const directory = inspectNoFollowDirectoryChain(
          path.resolve(directoryPath),
          'Branch recovery dynamic worktree'
        );
        assertPhysicallyDisjointDirectoryChains(
          current,
          directory,
          `Branch recovery root and dynamic worktree ${directoryPath}`
        );
      }
      assertCurrent();
    },
    assertCurrent
  });
}

export function ensureRecoveryRoot(
  inventory: BranchLifecycleInventory,
  configuredRoot: string | undefined
): string {
  return acquireBranchRecoveryStore({
    repositoryRoot: inventory.repository.root,
    commonDir: inventory.repository.commonDir,
    worktreeRoots: inventory.worktrees.map((worktree) => worktree.path),
    recoveryRoot: configuredRoot
  }).root.path;
}

export function createRecoveryBundle(input: {
  inventory: BranchLifecycleInventory;
  branch: string;
  expectedSha: string;
  recoveryRoot?: string;
  refSource: { kind: 'local-branch' | 'remote-branch' } | { kind: 'pull'; number: number };
}): { recovery: BranchRecoveryAuthority; attempts: BranchCloseoutAttempt[] } {
  const { inventory, branch, expectedSha } = input;
  const refSource = input.refSource;
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
  const store = acquireBranchRecoveryStore({
    repositoryRoot: inventory.repository.root,
    commonDir: inventory.repository.commonDir,
    worktreeRoots: inventory.worktrees.map((worktree) => worktree.path),
    ...(input.recoveryRoot === undefined ? {} : { recoveryRoot: input.recoveryRoot })
  });
  const recoveryRoot = store.root.path;
  const token = `${Date.now()}-${process.pid}-${randomUUID()}`;
  const bundleName = `sec-branch-closeout-${token}.bundle`;
  const bundlePath = path.join(recoveryRoot, bundleName);
  const checksumName = `${bundleName}.sha256`;
  const sourceSpec = refSource.kind === 'pull'
    ? `refs/pull/${refSource.number}/head`
    : `refs/heads/${branch}`;
  const sourceLabel = refSource.kind === 'pull'
    ? `pull/${refSource.number} head`
    : `${refSource.kind === 'local-branch' ? 'local' : 'remote'} branch ${branch}`;
  const temporaryRepository = refSource.kind === 'local-branch'
    ? null
    : mkdtempSync(path.join(recoveryRoot, '.sec-recovery-fetch-'));

  try {
    let bundleSourceRoot: string;
    let bundleSourceRef: string;
    if (refSource.kind === 'local-branch') {
      bundleSourceRoot = repositoryRoot;
      bundleSourceRef = sourceSpec;
    } else {
      if (temporaryRepository === null) throw new Error('Remote recovery workspace is unavailable.');
      const initialize = runRecoveryGit(temporaryRepository, ['init', '--bare', '.']);
      if (initialize.status !== 0) {
        throw new Error(`recovery repository initialization failed: ${decodeBranchLifecycleChildError(initialize)}`);
      }
      const fetch = runRecoveryGit(temporaryRepository, [
        ...createBranchLifecycleGitHubCredentialArgs(),
        'fetch',
        '--no-tags',
        inventory.repository.remoteUrl,
        `+${sourceSpec}:refs/heads/recovery`,
        `+refs/heads/${inventory.repository.defaultBranch}:refs/heads/recovery-main`
      ]);
      if (fetch.status !== 0) {
        throw new Error(
          `recovery fetch failed (${sourceLabel}): ${decodeBranchLifecycleChildError(fetch)}`
        );
      }
      bundleSourceRoot = temporaryRepository;
      bundleSourceRef = 'refs/heads/recovery';
    }
    const resolvedSha = requireRecoveryGitText(
      bundleSourceRoot,
      ['rev-parse', '--verify', bundleSourceRef],
      'recovery source resolution'
    );
    if (resolvedSha !== expectedSha) {
      throw new Error(
        `${sourceLabel} SHA raced during recovery preparation: expected ${expectedSha}, resolved ${resolvedSha}`
      );
    }

    const mainSha = inventory.main.remoteSha;
    if (mainSha === null) {
      throw new Error('Recovery compaction requires one exact remote default-branch SHA.');
    }
    assertGitSha(mainSha, 'recovery main SHA');
    const bundleMainRef = refSource.kind === 'local-branch'
      ? mainSha
      : 'refs/heads/recovery-main';
    const resolvedMainSha = requireRecoveryGitText(
      bundleSourceRoot,
      ['rev-parse', '--verify', '--end-of-options', `${bundleMainRef}^{commit}`],
      'recovery main resolution'
    );
    if (resolvedMainSha !== mainSha) {
      throw new Error(
        `recovery main SHA raced during recovery preparation: expected ${mainSha}, resolved ${resolvedMainSha}`
      );
    }

    const uniqueCommitCountSource = requireRecoveryGitText(
      bundleSourceRoot,
      ['rev-list', '--count', bundleSourceRef, `^${bundleMainRef}`],
      'recovery unique commit census'
    );
    const uniqueCommitCount = Number(uniqueCommitCountSource);
    if (!Number.isSafeInteger(uniqueCommitCount) || uniqueCommitCount < 0) {
      throw new Error('Recovery unique commit census is invalid.');
    }
    let exclusions: string[];
    if (uniqueCommitCount > 0) {
      // The durable main ref is the prerequisite. Git bundle records the
      // exact boundary OIDs it actually needs; bundle verify revalidates them
      // in every recovery environment.
      exclusions = [`^${bundleMainRef}`];
    } else {
      // The source is already reachable from main. Keep only the exact source
      // commit generation instead of copying main history. All source parents
      // are durable prerequisites because the source itself is main-reachable.
      const sourceLine = requireRecoveryGitText(
        bundleSourceRoot,
        ['rev-list', '--parents', '-n', '1', bundleSourceRef],
        'recovery absorbed-source parent census'
      );
      const [sourceCommit, ...parents] = sourceLine.split(/\s+/u);
      if (sourceCommit !== expectedSha
          || parents.some((parent) => !/^[0-9a-f]{40}$/u.test(parent))) {
        throw new Error('Recovery absorbed-source parent census is invalid.');
      }
      exclusions = parents.map((parent) => `^${parent}`);
    }

    const partialBundlePath = `${bundlePath}.${process.pid}.partial`;
    const create = runRecoveryGit(
      bundleSourceRoot,
      ['bundle', 'create', partialBundlePath, bundleSourceRef, ...exclusions]
    );
    if (create.status !== 0) {
      try { unlinkSync(partialBundlePath); } catch { /* no residue */ }
      throw new Error(`git bundle create failed: ${decodeBranchLifecycleChildError(create)}`);
    }
    if (statSync(partialBundlePath).size <= 0) {
      try { unlinkSync(partialBundlePath); } catch { /* no residue */ }
      throw new Error('recovery bundle is empty');
    }
    const bundleHeads = requireRecoveryGitText(
      repositoryRoot,
      ['bundle', 'list-heads', partialBundlePath],
      'recovery bundle head readback'
    );
    if (!bundleHeads.split(/\r?\n/u).some((line) => line.startsWith(`${expectedSha} `))) {
      try { unlinkSync(partialBundlePath); } catch { /* no residue */ }
      throw new Error(
        `${sourceLabel} changed while the recovery bundle was created; expected head ${expectedSha} is absent.`
      );
    }
    fsyncPath(partialBundlePath);
    renameSync(partialBundlePath, bundlePath);
    fsyncPath(bundlePath);
    fsyncDirectory(recoveryRoot);
    store.assertCurrent();
    attempts.push({
      operation: 'recovery-create',
      status: 'success',
      detail: `${bundlePath} (source ${sourceLabel}; unique commits ${uniqueCommitCount}; prerequisite main ${mainSha})`
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
        detail: verifyOutput || decodeBranchLifecycleChildError(verify)
      });
      throw new Error(
        `git bundle verify failed: ${verifyOutput || decodeBranchLifecycleChildError(verify)}`
      );
    }

    const digest = createHash('sha256').update(readFileSync(bundlePath)).digest('hex');
    const checksumText = `${digest}  ${bundleName}\n`;
    store.publishExclusive({
      name: checksumName,
      bytes: Buffer.from(checksumText, 'utf8'),
      validate: (bytes) => {
        if (Buffer.from(bytes).toString('utf8') !== checksumText) {
          throw new Error('Branch recovery checksum publication changed bytes.');
        }
      }
    });
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
    if (temporaryRepository !== null) {
      rmSync(temporaryRepository, { recursive: true, force: true });
    }
  }
}

type MainAbsorptionRecovery = Extract<BranchRecoveryAuthority, { kind: 'main-absorption' }>;

function exactCommitTree(repositoryRoot: string, sha: string, label: string): string {
  assertGitSha(sha, `${label} SHA`);
  const commit = requireRecoveryGitText(repositoryRoot, [
    'rev-parse', '--verify', '--end-of-options', `${sha}^{commit}`
  ], `${label} commit`);
  if (commit !== sha) throw new Error(`${label} commit identity differs.`);
  const tree = requireRecoveryGitText(repositoryRoot, [
    'rev-parse', '--verify', '--end-of-options', `${sha}^{tree}`
  ], `${label} tree`);
  assertGitSha(tree, `${label} tree SHA`);
  return tree;
}

function isNativeAncestor(repositoryRoot: string, sourceSha: string, mainSha: string): boolean {
  const result = runRecoveryGit(repositoryRoot, [
    'merge-base', '--is-ancestor', sourceSha, mainSha
  ]);
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(`Main absorption ancestry observation failed: ${decodeBranchLifecycleChildError(result)}`);
}

function assertLiveMainContains(inventory: BranchLifecycleInventory, mainSha: string): void {
  const root = inventory.repository.root;
  const branch = inventory.repository.defaultBranch;
  const candidates = [
    { expected: inventory.main.localSha, ref: `refs/heads/${branch}` },
    { expected: inventory.main.remoteSha, ref: `refs/remotes/${inventory.repository.remote}/${branch}` }
  ];
  const observed = candidates.filter(({ expected }) => expected !== null).map(({ expected, ref }) => {
    const actual = requireRecoveryGitText(root, ['rev-parse', '--verify', ref], `Current main ${ref}`);
    if (actual !== expected) throw new Error(`Current main ref changed after inventory: ${ref}`);
    return actual;
  });
  if (!observed.some((current) => isNativeAncestor(root, mainSha, current))) {
    throw new Error('Absorbing main commit is not retained by a current main ref.');
  }
}

/** Recheck immutable native absorption after its completed recovery proof was retired. */
export function assertRetiredNativeMainAbsorptionLive(
  inventory: BranchLifecycleInventory,
  recovery: MainAbsorptionRecovery
): void {
  assertDurableRecoveryAuthority(recovery, inventory);
  const root = inventory.repository.root;
  if (exactCommitTree(root, recovery.sourceSha, 'Absorbed source') !== recovery.sourceTreeSha
      || exactCommitTree(root, recovery.mainSha, 'Absorbing main') !== recovery.mainTreeSha) {
    throw new Error('Retired main absorption exact Git tree changed.');
  }
  assertLiveMainContains(inventory, recovery.mainSha);
  if (recovery.basis === 'native-ancestor') {
    if (!isNativeAncestor(root, recovery.sourceSha, recovery.mainSha)) {
      throw new Error('Retired source is not an ancestor of absorbing main.');
    }
  } else if (recovery.sourceTreeSha !== recovery.mainTreeSha) {
    throw new Error('Retired source and absorbing main trees differ.');
  }
}

function mainAbsorptionProof(recovery: MainAbsorptionRecovery): Buffer {
  return Buffer.from(`${JSON.stringify({
    schema: 'sec-branch-main-absorption-proof-v1',
    sourceSha: recovery.sourceSha,
    sourceTreeSha: recovery.sourceTreeSha,
    mainSha: recovery.mainSha,
    mainTreeSha: recovery.mainTreeSha,
    basis: recovery.basis
  })}\n`, 'utf8');
}

export function createMainAbsorptionRecovery(input: Readonly<{
  inventory: BranchLifecycleInventory;
  branch: string;
  expectedSha: string;
  mainSha: string;
  basis: MainAbsorptionRecovery['basis'];
  recoveryRoot?: string;
}>): { recovery: MainAbsorptionRecovery; attempts: BranchCloseoutAttempt[] } {
  const { inventory, branch, expectedSha, mainSha, basis } = input;
  assertGitBranchName(branch);
  assertGitSha(expectedSha, 'absorbed source SHA');
  assertGitSha(mainSha, 'absorbing main SHA');
  const sourceTreeSha = exactCommitTree(inventory.repository.root, expectedSha, 'Absorbed source');
  const mainTreeSha = exactCommitTree(inventory.repository.root, mainSha, 'Absorbing main');
  const store = acquireBranchRecoveryStore({
    repositoryRoot: inventory.repository.root,
    commonDir: inventory.repository.commonDir,
    worktreeRoots: inventory.worktrees.map(({ path: worktreePath }) => worktreePath),
    ...(input.recoveryRoot === undefined ? {} : { recoveryRoot: input.recoveryRoot })
  });
  let name: string | null = null;
  let createdProof = false;
  try {
    const draft: MainAbsorptionRecovery = {
      kind: 'main-absorption',
      path: path.join(store.root.path, 'sec-branch-closeout-pending.main-absorption.json'),
      sha256: `sha256:${'0'.repeat(64)}`,
      verified: true,
      verifyOutput: basis,
      sourceSha: expectedSha,
      sourceTreeSha,
      mainSha,
      mainTreeSha,
      basis
    };
    assertRetiredNativeMainAbsorptionLive(inventory, draft);
    const verified = { ...draft, verifyOutput: `${basis}; source ${expectedSha}/${sourceTreeSha}; main ${mainSha}/${mainTreeSha}` };
    const bytes = mainAbsorptionProof(verified);
    const digest = createHash('sha256').update(bytes).digest('hex');
    const identity = createHash('sha256').update(JSON.stringify({ branch, digest })).digest('hex');
    name = `sec-branch-closeout-${identity}.main-absorption.json`;
    const recovery: MainAbsorptionRecovery = {
      ...verified,
      path: path.join(store.root.path, name),
      sha256: `sha256:${digest}`
    };
    const existing = store.read(name);
    if (existing !== null) {
      if (!Buffer.from(existing).equals(bytes)) {
        throw new Error('Existing main absorption proof differs from exact retry identity.');
      }
      const retained = store.inspectFile(name);
      if (retained === null || retained.kind !== 'file') {
        throw new Error('Existing main absorption proof physical identity is absent.');
      }
    } else {
      const published = store.publishExclusive({
        name,
        bytes,
        validate: (actual) => {
          if (!Buffer.from(actual).equals(bytes)) throw new Error('Main absorption proof publication changed.');
        }
      });
      if (published.path !== recovery.path) throw new Error('Main absorption proof path changed.');
      createdProof = true;
    }
    const attempt = verifyRecoveryAuthorityLive({ inventory, recovery });
    if (attempt.status !== 'success') throw new Error(attempt.detail);
    return {
      recovery,
      attempts: [
        { operation: 'recovery-create', status: 'success', detail: recovery.path },
        attempt
      ]
    };
  } catch (error) {
    const proof = createdProof && name !== null ? store.inspectFile(name) : null;
    if (proof !== null && name !== null) store.removeExact(name, proof);
    if (store.createdByAcquisition) store.retireIfEmpty();
    throw error;
  }
}

export function verifyRecoveryAuthorityLive(input: {
  inventory: BranchLifecycleInventory;
  recovery: BranchRecoveryAuthority;
}): BranchCloseoutAttempt {
  const { inventory, recovery } = input;
  try {
    assertDurableRecoveryAuthority(recovery, inventory);
    if (recovery.kind === 'main-absorption') {
      const parent = inspectNoFollowDirectoryChain(path.dirname(recovery.path), 'Main absorption recovery root').target;
      const bytes = readNoFollowOrdinaryFile(parent, path.basename(recovery.path));
      if (bytes === null) throw new Error('Main absorption proof is absent.');
      const digest = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      if (digest !== recovery.sha256 || !Buffer.from(bytes).equals(mainAbsorptionProof(recovery))) {
        throw new Error('Main absorption proof digest or exact content changed.');
      }
      assertRetiredNativeMainAbsorptionLive(inventory, recovery);
      return { operation: 'recovery-verify', status: 'success', detail: `live main absorption ${recovery.sha256}; ${recovery.verifyOutput}` };
    }
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
        `git bundle verify failed: ${output || decodeBranchLifecycleChildError(verify)}`
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

export function verifyRecoveryAuthorityHeadLive(input: {
  inventory: BranchLifecycleInventory;
  recovery: BranchRecoveryAuthority;
  expectedHeadSha: string;
}): BranchCloseoutAttempt {
  assertGitSha(input.expectedHeadSha, 'recovery expected head SHA');
  const verified = verifyRecoveryAuthorityLive(input);
  if (verified.status !== 'success') return verified;
  try {
    const heads = requireRecoveryGitText(
      input.inventory.repository.root,
      ['bundle', 'list-heads', input.recovery.path],
      'recovery bundle head readback'
    );
    if (!heads.split(/\r?\n/u).some((line) => line.startsWith(`${input.expectedHeadSha} `))) {
      throw new Error(
        `recovery bundle does not retain expected head ${input.expectedHeadSha}`
      );
    }
    return {
      operation: 'recovery-verify',
      status: 'success',
      detail: `live head-bound revalidation ${input.recovery.sha256}; ${input.expectedHeadSha}`
    };
  } catch (error) {
    return {
      operation: 'recovery-verify',
      status: 'failed',
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}
