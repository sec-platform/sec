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

import { rawSha256Hex, sha256 } from '../../../../contracts/canonical.ts';
import { issueOperationRequirementBindingContext } from '../../../../execution/operation/requirement-binding-context.ts';
import { withAcquiredResource } from '../../../../execution/resource-settlement.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileSemanticOperationPlan,
  issueSemanticOperationAttemptContext,
  type OperationDigest
} from '../../../../execution/operation/semantic.ts';
import { assertPhysicallyDisjointDirectoryChains, assertSameNoFollowDirectoryIdentity, createNoFollowOrdinaryDirectoryChain, deleteRetainedNoFollowEntry, inspectExactNoFollowDirectoryPresence, inspectNoFollowDirectoryChain, inspectNoFollowOrdinaryFileEntry, publishExclusiveDurableCanonicalFile, readNoFollowOrdinaryFile, retainNoFollowDirectoryForChildProcess, retainNoFollowOrdinaryFile, scanNoFollowDirectoryTreeMetadata, type NoFollowDirectoryTreeEntry, type PhysicalDirectoryChain, type PhysicalDirectoryIdentity } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  assertProcessResourceSessionReceipt,
  openProcessResourceSession
} from '../../../runtime-state/physical/runtime/process-resource-session.ts';
import {
  issueRetainedCommandBoundary,
  resolveExecutableLocator,
  RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
  RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR
} from '../../../runtime-state/physical/runtime/process.ts';

import {
  createBranchLifecycleGitChildEnvironment,
  createBranchLifecycleGitHubCredentialArgs,
  decodeBranchLifecycleChildError,
  decodeBranchLifecycleChildStdout
} from './branch-lifecycle-command.ts';
import {
  assertDurableRecoveryProof,
  assertGitBranchName,
  assertGitSha,
  type BranchCloseoutAttempt,
  type BranchLifecycleInventory,
  type BranchRecoveryAuthority
} from './branch-lifecycle-contract.ts';
import {
  assertClosedSupersessionEvidence,
  type ClosedSupersessionEvidence
} from './closed-supersession-review.ts';

const RECOVERY_GIT_DURATION_MS = 120_000;
const RECOVERY_GIT_REQUIREMENT = 'branch-lifecycle.recovery-git.process';
const RECOVERY_GIT_CONTRACT = sha256({
  owner: 'control.branch-lifecycle',
  operation: 'recovery-git',
  transport: 'runtime-state.process-resource-session'
}) as OperationDigest;
const RECOVERY_GIT_MAX_PROCESSES = 32;
const RECOVERY_GIT_MAX_STREAM_BYTES = 4 * 1024 * 1024;
const RECOVERY_GIT_MAX_OUTPUT_BYTES = RECOVERY_GIT_MAX_PROCESSES
  * RECOVERY_GIT_MAX_STREAM_BYTES * 2;

type RecoveryGitResult = Readonly<{
  status: number;
  stdout: Buffer;
  stderr: Buffer;
}>;
type RecoveryGitRunner = (cwd: string, args: readonly string[]) => Promise<RecoveryGitResult>;

function compileRecoveryGitOperation(input: Readonly<{
  repositoryRoot: string;
  intent: unknown;
  providerIdentityDigest: OperationDigest;
  deadlineAtUnixMs: number;
}>) {
  const plan = compileSemanticOperationPlan({
    operation: 'control.branch-lifecycle.recovery-git',
    intentDigest: sha256({ repositoryRoot: input.repositoryRoot, intent: input.intent }) as OperationDigest,
    decisionDigest: RECOVERY_GIT_CONTRACT,
    deadlineAtUnixMs: input.deadlineAtUnixMs,
    attempt: issueSemanticOperationAttemptContext({ authorityGrantDigest: RECOVERY_GIT_CONTRACT }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: RECOVERY_GIT_DURATION_MS },
      { resource: 'input-bytes', maximum: 1 },
      { resource: 'output-bytes', maximum: RECOVERY_GIT_MAX_OUTPUT_BYTES },
      { resource: 'processes', maximum: RECOVERY_GIT_MAX_PROCESSES }
    ],
    requirements: [{
      id: RECOVERY_GIT_REQUIREMENT,
      contractDigest: RECOVERY_GIT_CONTRACT,
      effectKinds: ['filesystem', 'process', 'provider'],
      failureKinds: [
        'filesystem.identity-drift',
        'filesystem.write-failed',
        'process.cancelled',
        'process.deadline-exhausted',
        'process.output-budget-exhausted',
        'process.settlement-unproven',
        'process.unavailable',
        'provider.unavailable'
      ]
    }]
  });
  return bindSemanticOperation(plan, [compileCapabilityBinding({
    requirementId: RECOVERY_GIT_REQUIREMENT,
    contractDigest: RECOVERY_GIT_CONTRACT,
    providerIdentityDigest: input.providerIdentityDigest
  })]);
}

async function withRecoveryGitRunner<T>(
  repositoryRoot: string,
  intent: unknown,
  use: (run: RecoveryGitRunner) => Promise<T>
): Promise<T> {
  const root = path.resolve(repositoryRoot);
  if (!path.isAbsolute(repositoryRoot) || root !== repositoryRoot) {
    throw new Error('Recovery Git repository root must be canonical and absolute.');
  }
  const locator = resolveExecutableLocator('git', {
    cwd: root,
    pathValue: process.env.PATH ?? ''
  });
  if (locator === null || !path.isAbsolute(locator)) {
    throw new Error('Recovery Git executable is unavailable.');
  }
  return withAcquiredResource({
    operationLabel: 'branch-recovery-git',
    resourceLabel: 'git-executable',
    acquire: () => retainNoFollowOrdinaryFile(
      inspectNoFollowDirectoryChain(path.dirname(locator), 'Recovery Git executable parent'),
      path.basename(locator),
      undefined,
      'Recovery Git executable',
      RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
      'executable'
    ),
    async use(executable) {
      const rootChain = inspectNoFollowDirectoryChain(root, 'Recovery Git repository root');
      return withAcquiredResource({
        operationLabel: 'branch-recovery-git',
        resourceLabel: 'working-directory',
        acquire: () => retainNoFollowDirectoryForChildProcess(
          rootChain,
          RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
          'Recovery Git working directory'
        ),
        async use(workingDirectory) {
          const providerIdentityDigest = sha256({
            owner: 'runtime-state.physical',
            provider: 'branch-recovery-git-process',
            executable: {
              path: executable.path,
              physical: executable.physical,
              digest: executable.digest().byteDigest
            },
            workingDirectory: rootChain.target
          }) as OperationDigest;
          const deadlineAtUnixMs = Date.now() + RECOVERY_GIT_DURATION_MS;
          const operation = compileRecoveryGitOperation({
            repositoryRoot: root,
            intent,
            providerIdentityDigest,
            deadlineAtUnixMs
          });
          const boundary = issueRetainedCommandBoundary({ executable, workingDirectory });
          return withAcquiredResource({
            operationLabel: 'branch-recovery-git',
            resourceLabel: 'process-session',
            acquire: () => openProcessResourceSession({
              operation,
              requirementBindingContext: issueOperationRequirementBindingContext({
                operation,
                requirementId: RECOVERY_GIT_REQUIREMENT,
                resourceCeilings: operation.plan.execution.aggregateBudgets
              })
            }),
            async use(session) {
              const run: RecoveryGitRunner = async (cwd, args) => {
                const target = path.resolve(cwd);
                if (!path.isAbsolute(cwd) || target !== cwd || args.some((arg) => arg.includes('\0'))) {
                  throw new Error('Recovery Git command input is not canonical.');
                }
                const result = await session.run(boundary, ['-C', target, ...args], {
                  env: createBranchLifecycleGitChildEnvironment(process.env),
                  envMode: 'replace',
                  maxStdoutBytes: RECOVERY_GIT_MAX_STREAM_BYTES,
                  maxStderrBytes: RECOVERY_GIT_MAX_STREAM_BYTES
                });
                return Object.freeze({
                  status: result.result.code,
                  stdout: Buffer.from(result.result.stdout),
                  stderr: Buffer.from(result.result.stderr, 'utf8')
                });
              };
              return use(run);
            },
            release(session) {
              assertProcessResourceSessionReceipt(session.close(), {
                operationIdentityDigest: operation.plan.identity.identityDigest,
                boundAttemptDigest: operation.boundAttemptDigest,
                requirementId: RECOVERY_GIT_REQUIREMENT
              });
            }
          });
        },
        release: (workingDirectory) => workingDirectory.dispose()
      });
    },
    release: (executable) => executable.dispose()
  });
}

async function requireRecoveryGitText(
  run: RecoveryGitRunner,
  cwd: string,
  args: readonly string[],
  label: string
): Promise<string> {
  const result = await run(cwd, args);
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
      ?? process.env.SEC_BRANCH_RECOVERY_ROOT
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

export async function createRecoveryBundle(input: {
  inventory: BranchLifecycleInventory;
  branch: string;
  expectedSha: string;
  recoveryRoot?: string;
  refSource: { kind: 'local-branch' | 'remote-branch' } | { kind: 'pull'; number: number };
}): Promise<{ recovery: BranchRecoveryAuthority; attempts: BranchCloseoutAttempt[] }> {
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
    : `${refSource.kind === 'local-branch' ? 'local' : 'remote'} branch ${branch}`;
  const temporaryRepository = refSource.kind === 'local-branch'
    ? null
    : mkdtempSync(path.join(recoveryRoot, '.sec-recovery-fetch-'));

  return withRecoveryGitRunner(repositoryRoot, {
    operation: 'create-recovery-bundle',
    branch,
    expectedSha,
    source: refSource
  }, async (run) => {
    try {
      let bundleSourceRoot: string;
      let bundleSourceRef: string;
      if (refSource.kind === 'local-branch') {
        bundleSourceRoot = repositoryRoot;
        bundleSourceRef = sourceSpec;
      } else {
        if (temporaryRepository === null) throw new Error('Remote recovery workspace is unavailable.');
        const initialize = await run(temporaryRepository, ['init', '--bare', '.']);
        if (initialize.status !== 0) {
          throw new Error(`recovery repository initialization failed: ${decodeBranchLifecycleChildError(initialize)}`);
        }
        const fetch = await run(temporaryRepository, [
          ...createBranchLifecycleGitHubCredentialArgs(),
          'fetch',
          '--no-tags',
          inventory.repository.remoteUrl,
          `+${sourceSpec}:refs/heads/recovery`
        ]);
        if (fetch.status !== 0) {
          throw new Error(
            `recovery fetch failed (${sourceLabel}): ${decodeBranchLifecycleChildError(fetch)}`
          );
        }
        bundleSourceRoot = temporaryRepository;
        bundleSourceRef = 'refs/heads/recovery';
      }
      const resolvedSha = await requireRecoveryGitText(
        run,
        bundleSourceRoot,
        ['rev-parse', '--verify', bundleSourceRef],
        'recovery source resolution'
      );
      if (resolvedSha !== expectedSha) {
        throw new Error(
          `${sourceLabel} SHA raced during recovery preparation: expected ${expectedSha}, resolved ${resolvedSha}`
        );
      }

      const partialBundlePath = `${bundlePath}.${process.pid}.partial`;
      const create = await run(
        bundleSourceRoot,
        ['bundle', 'create', partialBundlePath, bundleSourceRef]
      );
      if (create.status !== 0) {
        try { unlinkSync(partialBundlePath); } catch { /* no residue */ }
        throw new Error(`git bundle create failed: ${decodeBranchLifecycleChildError(create)}`);
      }
      if (statSync(partialBundlePath).size <= 0) {
        try { unlinkSync(partialBundlePath); } catch { /* no residue */ }
        throw new Error('recovery bundle is empty');
      }
      const bundleHeads = await requireRecoveryGitText(
        run,
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
      attempts.push({
        operation: 'recovery-create',
        status: 'success',
        detail: `${bundlePath} (source ${sourceLabel})`
      });

      const verify = await run(repositoryRoot, ['bundle', 'verify', bundlePath]);
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

      const digest = rawSha256Hex(readFileSync(bundlePath));
      writeDurableFile(checksumPath, `${digest}  ${path.basename(bundlePath)}\n`);
      const recovery: BranchRecoveryAuthority = {
        kind: 'bundle',
        path: realpathSync(bundlePath),
        sha256: `sha256:${digest}`,
        verified: true,
        verifyOutput
      };
      assertDurableRecoveryProof(recovery, inventory);
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
  });
}

type MainAbsorptionRecovery = Extract<BranchRecoveryAuthority, { kind: 'main-absorption' }>;

export interface NativeMainAbsorptionObservation {
  readonly sourceSha: string;
  readonly sourceTreeSha: string;
  readonly mainSha: string;
  readonly mainTreeSha: string;
  readonly basis: 'native-ancestor' | 'identical-tree';
  readonly recoveryDigest: `sha256:${string}`;
}

async function exactCommitTree(run: RecoveryGitRunner, repositoryRoot: string, sha: string, label: string): Promise<string> {
  assertGitSha(sha, `${label} SHA`);
  const commit = await requireRecoveryGitText(run, repositoryRoot, [
    'rev-parse', '--verify', '--end-of-options', `${sha}^{commit}`
  ], `${label} commit`);
  if (commit !== sha) throw new Error(`${label} commit identity differs.`);
  const tree = await requireRecoveryGitText(run, repositoryRoot, [
    'rev-parse', '--verify', '--end-of-options', `${sha}^{tree}`
  ], `${label} tree`);
  assertGitSha(tree, `${label} tree SHA`);
  return tree;
}

async function isNativeAncestor(run: RecoveryGitRunner, repositoryRoot: string, sourceSha: string, mainSha: string): Promise<boolean> {
  const result = await run(repositoryRoot, [
    'merge-base', '--is-ancestor', sourceSha, mainSha
  ]);
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(`Main absorption ancestry observation failed: ${decodeBranchLifecycleChildError(result)}`);
}

function mainAbsorptionProofBytes(input: Readonly<{
  sourceSha: string;
  sourceTreeSha: string;
  mainSha: string;
  mainTreeSha: string;
  basis: MainAbsorptionRecovery['basis'];
  reviewReference?: string;
  reviewReceiptDigest?: `sha256:${string}`;
}>): Buffer {
  return Buffer.from(`${JSON.stringify({
    schema: 'sec-branch-main-absorption-proof-v1',
    sourceSha: input.sourceSha,
    sourceTreeSha: input.sourceTreeSha,
    mainSha: input.mainSha,
    mainTreeSha: input.mainTreeSha,
    basis: input.basis,
    ...(input.reviewReference === undefined ? {} : { reviewReference: input.reviewReference }),
    ...(input.reviewReceiptDigest === undefined ? {} : { reviewReceiptDigest: input.reviewReceiptDigest })
  })}\n`, 'utf8');
}

/** Pure native retention observation used before any recovery/preparation bytes are published. */
export async function observeNativeMainAbsorption(input: Readonly<{
  repositoryRoot: string;
  sourceSha: string;
  mainSha: string;
}>): Promise<NativeMainAbsorptionObservation | null> {
  return withRecoveryGitRunner(input.repositoryRoot, {
    operation: 'observe-native-main-absorption',
    sourceSha: input.sourceSha,
    mainSha: input.mainSha
  }, async (run) => {
    const sourceTreeSha = await exactCommitTree(run, input.repositoryRoot, input.sourceSha, 'Absorbed source');
    const mainTreeSha = await exactCommitTree(run, input.repositoryRoot, input.mainSha, 'Absorbing main');
    const basis = await isNativeAncestor(run, input.repositoryRoot, input.sourceSha, input.mainSha)
      ? 'native-ancestor' as const
      : sourceTreeSha === mainTreeSha
        ? 'identical-tree' as const
        : null;
    if (basis === null) return null;
    const proof = mainAbsorptionProofBytes({
      sourceSha: input.sourceSha,
      sourceTreeSha,
      mainSha: input.mainSha,
      mainTreeSha,
      basis
    });
    return Object.freeze({
      sourceSha: input.sourceSha,
      sourceTreeSha,
      mainSha: input.mainSha,
      mainTreeSha,
      basis,
      recoveryDigest: `sha256:${rawSha256Hex(proof)}` as const
    });
  });
}

async function assertLiveMainContains(
  run: RecoveryGitRunner,
  inventory: BranchLifecycleInventory,
  mainSha: string
): Promise<void> {
  const root = inventory.repository.root;
  const branch = inventory.repository.defaultBranch;
  const candidates = [
    { expected: inventory.main.localSha, ref: `refs/heads/${branch}` },
    { expected: inventory.main.remoteSha, ref: `refs/remotes/${inventory.repository.remote}/${branch}` }
  ];
  const observed: string[] = [];
  for (const { expected, ref } of candidates) {
    if (expected === null) continue;
    const actual = await requireRecoveryGitText(run, root, ['rev-parse', '--verify', ref], `Current main ${ref}`);
    if (actual !== expected) throw new Error(`Current main ref changed after inventory: ${ref}`);
    observed.push(actual);
  }
  for (const current of observed) {
    if (await isNativeAncestor(run, root, mainSha, current)) return;
  }
  throw new Error('Absorbing main commit is not retained by a current main ref.');
}

function assertReviewedAbsorption(
  inventory: BranchLifecycleInventory,
  recovery: MainAbsorptionRecovery,
  evidence: ClosedSupersessionEvidence | undefined
): void {
  if (evidence === undefined) throw new Error('Reviewed main absorption requires live authenticated review evidence.');
  assertClosedSupersessionEvidence(evidence);
  const review = evidence.review;
  if (review.repository !== inventory.repository.fullName
      || review.headSha !== recovery.sourceSha
      || review.headTreeSha !== recovery.sourceTreeSha
      || review.currentMainSha !== recovery.mainSha
      || review.currentMainTreeSha !== recovery.mainTreeSha
      || evidence.reference !== recovery.reviewReference
      || evidence.receiptDigest !== recovery.reviewReceiptDigest) {
    throw new Error('Authenticated supersession review differs from exact main absorption.');
  }
}

async function assertMainAbsorptionLive(
  run: RecoveryGitRunner,
  inventory: BranchLifecycleInventory,
  recovery: MainAbsorptionRecovery,
  reviewEvidence?: ClosedSupersessionEvidence
): Promise<string> {
  assertDurableRecoveryProof(recovery, inventory);
  const root = inventory.repository.root;
  if (await exactCommitTree(run, root, recovery.sourceSha, 'Absorbed source') !== recovery.sourceTreeSha
      || await exactCommitTree(run, root, recovery.mainSha, 'Absorbing main') !== recovery.mainTreeSha) {
    throw new Error('Main absorption exact Git tree changed.');
  }
  await assertLiveMainContains(run, inventory, recovery.mainSha);
  if (recovery.basis === 'native-ancestor') {
    if (!await isNativeAncestor(run, root, recovery.sourceSha, recovery.mainSha)) {
      throw new Error('Source commit is not an ancestor of absorbing main.');
    }
  } else if (recovery.basis === 'identical-tree') {
    if (recovery.sourceTreeSha !== recovery.mainTreeSha) {
      throw new Error('Source and absorbing main trees differ.');
    }
  } else {
    assertReviewedAbsorption(inventory, recovery, reviewEvidence);
  }
  return `${recovery.basis}; source ${recovery.sourceSha}/${recovery.sourceTreeSha}; main ${recovery.mainSha}/${recovery.mainTreeSha}`;
}

function mainAbsorptionProof(recovery: MainAbsorptionRecovery): Buffer {
  return mainAbsorptionProofBytes(recovery);
}

export async function createMainAbsorptionRecovery(input: {
  inventory: BranchLifecycleInventory;
  branch: string;
  expectedSha: string;
  mainSha: string;
  basis: MainAbsorptionRecovery['basis'];
  recoveryRoot?: string;
  reviewEvidence?: ClosedSupersessionEvidence;
}): Promise<{ recovery: BranchRecoveryAuthority; attempts: BranchCloseoutAttempt[] }> {
  const { inventory, branch, expectedSha, mainSha, basis } = input;
  assertGitBranchName(branch);
  assertGitSha(expectedSha, 'absorbed source SHA');
  assertGitSha(mainSha, 'absorbing main SHA');
  if (basis !== 'native-ancestor' && basis !== 'identical-tree'
      && basis !== 'reviewed-supersession') throw new Error('Main absorption basis is invalid.');
  return withRecoveryGitRunner(inventory.repository.root, {
    operation: 'create-main-absorption-recovery',
    branch,
    expectedSha,
    mainSha,
    basis
  }, async (run) => {
    const sourceTreeSha = await exactCommitTree(run, inventory.repository.root, expectedSha, 'Absorbed source');
    const mainTreeSha = await exactCommitTree(run, inventory.repository.root, mainSha, 'Absorbing main');
    const store = acquireBranchRecoveryStore({
      repositoryRoot: inventory.repository.root,
      commonDir: inventory.repository.commonDir,
      worktreeRoots: inventory.worktrees.map(({ path: worktreePath }) => worktreePath),
      recoveryRoot: input.recoveryRoot
    });
    let name: string | null = null;
    let createdProof = false;
    try {
      const review = basis === 'reviewed-supersession' ? input.reviewEvidence : undefined;
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
        basis,
        ...(review === undefined ? {} : {
          reviewReference: review.reference,
          reviewReceiptDigest: review.receiptDigest
        })
      };
      const verifyOutput = await assertMainAbsorptionLive(run, inventory, draft, review);
      const verified: MainAbsorptionRecovery = { ...draft, verifyOutput };
      const bytes = mainAbsorptionProof(verified);
      const digest = rawSha256Hex(bytes);
      const identity = rawSha256Hex(JSON.stringify({ branch, digest }));
      name = `sec-branch-closeout-${sanitizeFileSegment(branch)}-${identity}.main-absorption.json`;
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
      const attempt = await verifyRecoveryAuthorityLiveWithRunner(run, {
        inventory,
        recovery,
        reviewEvidence: review
      });
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
  });
}

async function verifyRecoveryAuthorityLiveWithRunner(
  run: RecoveryGitRunner,
  input: {
    inventory: BranchLifecycleInventory;
    recovery: BranchRecoveryAuthority;
    reviewEvidence?: ClosedSupersessionEvidence;
  }
): Promise<BranchCloseoutAttempt> {
  const { inventory, recovery } = input;
  try {
    assertDurableRecoveryProof(recovery, inventory);
    if (recovery.kind === 'main-absorption') {
      const parent = inspectNoFollowDirectoryChain(path.dirname(recovery.path), 'Main absorption recovery root').target;
      const bytes = readNoFollowOrdinaryFile(parent, path.basename(recovery.path));
      if (bytes === null) throw new Error('Main absorption proof is absent.');
      const digest = `sha256:${rawSha256Hex(bytes)}`;
      if (digest !== recovery.sha256 || !Buffer.from(bytes).equals(mainAbsorptionProof(recovery))) {
        throw new Error('Main absorption proof digest or exact content changed.');
      }
      const output = await assertMainAbsorptionLive(run, inventory, recovery, input.reviewEvidence);
      return { operation: 'recovery-verify', status: 'success', detail: `live main absorption ${recovery.sha256}; ${output}` };
    }
    const bytes = readFileSync(recovery.path);
    const digest = rawSha256Hex(bytes);
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
    const verify = await run(inventory.repository.root, ['bundle', 'verify', recovery.path]);
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

export async function verifyRecoveryAuthorityLive(input: {
  inventory: BranchLifecycleInventory;
  recovery: BranchRecoveryAuthority;
  reviewEvidence?: ClosedSupersessionEvidence;
}): Promise<BranchCloseoutAttempt> {
  return withRecoveryGitRunner(input.inventory.repository.root, {
    operation: 'verify-recovery-authority',
    recoveryKind: input.recovery.kind,
    recoveryDigest: input.recovery.sha256
  }, (run) => verifyRecoveryAuthorityLiveWithRunner(run, input));
}
