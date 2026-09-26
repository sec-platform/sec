import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { rawSha256, sha256 } from '../../../../contracts/canonical.ts';
import type { OperationDigest } from '../../../../execution/operation/semantic.ts';
import {
  createAuthorityGitScratchIndexTreeSession,
  type GitCommitIdentity,
  type GitReadSession
} from '../../../providers/git-read/runtime/session.ts';
import {
  inspectNoFollowDirectoryChain,
  inspectNoFollowDirectoryLeaf,
  inspectNoFollowOrdinaryFileEntry
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';

const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const REF = /^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._\/-]*$/u;

export type DevelopmentCommitRequest = Readonly<{
  readonly repositoryRoot: string;
  readonly message: string;
  readonly author: GitCommitIdentity;
  readonly committer: GitCommitIdentity;
}>;

export type DevelopmentCommitCandidate = Readonly<{
  readonly schema: 'sec-development-commit-candidate';
  readonly repositoryRoot: string;
  readonly ref: string;
  readonly preimage: string;
  readonly tree: string;
  readonly target: string;
  readonly requestDigest: OperationDigest;
  readonly candidateDigest: OperationDigest;
}>;

export type DevelopmentCommitCandidateDetails = Readonly<{
  readonly candidate: DevelopmentCommitCandidate;
  readonly commonDirectory: string;
  readonly worktreeGitDirectory: string;
  readonly indexPath: string;
  readonly indexParent: Readonly<{ path: string; device: string; inode: string }>;
  readonly indexEntry: Readonly<{
    device: string;
    inode: string;
    size: number;
    byteDigest: `sha256:${string}`;
  }>;
  readonly providerIdentityDigest: OperationDigest;
  readonly preflightReceiptDigest: OperationDigest;
}>;

const ISSUED_DEVELOPMENT_COMMIT_CANDIDATES = new WeakMap<object, DevelopmentCommitCandidateDetails>();

function requestDigest(request: DevelopmentCommitRequest): OperationDigest {
  const repositoryRoot = path.resolve(request.repositoryRoot);
  if (!path.isAbsolute(request.repositoryRoot) || repositoryRoot !== request.repositoryRoot
      || request.message.length === 0) {
    throw new Error('Development commit candidate requires one canonical repository root and non-empty message.');
  }
  return sha256({
    repositoryRoot,
    message: request.message,
    author: request.author,
    committer: request.committer
  }) as OperationDigest;
}

async function commandText(
  session: GitReadSession,
  args: readonly string[],
  label: string
): Promise<string> {
  const command = await session.run(args);
  if (command.kind !== 'completed' || command.result.code !== 0) {
    throw new Error(`Development commit candidate could not ${label}.`);
  }
  return Buffer.from(command.result.stdout).toString('utf8').trim();
}

function assertStandaloneDevelopmentCommitState(worktreeGitDirectory: string): void {
  const parent = inspectNoFollowDirectoryChain(worktreeGitDirectory, 'Development commit Git directory').target;
  for (const name of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'REBASE_HEAD']) {
    if (inspectNoFollowOrdinaryFileEntry(parent, name) !== null) {
      throw new Error(`Development commit rejects unfinished Git operation: ${name}`);
    }
  }
  for (const name of ['sequencer', 'rebase-merge', 'rebase-apply']) {
    if (inspectNoFollowDirectoryLeaf(parent, name) !== null) {
      throw new Error(`Development commit rejects unfinished Git operation: ${name}`);
    }
  }
}

function observeIndex(indexPath: string): Readonly<{
  parent: Readonly<{ path: string; device: string; inode: string }>;
  entry: Readonly<{
    device: string;
    inode: string;
    size: number;
    bytes: Uint8Array;
    byteDigest: `sha256:${string}`;
  }>;
}> {
  const parent = inspectNoFollowDirectoryChain(
    path.dirname(indexPath),
    'Development commit index parent'
  ).target;
  const entry = inspectNoFollowOrdinaryFileEntry(parent, path.basename(indexPath));
  if (entry === null || entry.kind !== 'file' || entry.bytes === null) {
    throw new Error('Development commit index is not one retained ordinary file.');
  }
  return Object.freeze({
    parent: Object.freeze({ path: parent.path, device: parent.device, inode: parent.inode }),
    entry: Object.freeze({
      device: entry.device,
      inode: entry.inode,
      size: entry.size,
      bytes: entry.bytes,
      byteDigest: rawSha256(entry.bytes)
    })
  });
}

function sameIndexObservation(
  current: ReturnType<typeof observeIndex>,
  expected: DevelopmentCommitCandidateDetails
): boolean {
  return current.parent.path === expected.indexParent.path
    && current.parent.device === expected.indexParent.device
    && current.parent.inode === expected.indexParent.inode
    && current.entry.device === expected.indexEntry.device
    && current.entry.inode === expected.indexEntry.inode
    && current.entry.size === expected.indexEntry.size
    && current.entry.byteDigest === expected.indexEntry.byteDigest;
}

/**
 * Freeze the exact staged candidate inside the caller-owned production Git
 * session. This capability is observation-only: scratch objects are retired
 * before return and no repository object, journal or ref is published.
 */
export async function freezeDevelopmentCommitCandidate(input: Readonly<{
  request: DevelopmentCommitRequest;
  session: GitReadSession;
}>): Promise<DevelopmentCommitCandidate> {
  const repositoryRoot = path.resolve(input.request.repositoryRoot);
  const requestIdentity = requestDigest(input.request);
  const session = input.session;
  if (session.providerIdentity === null || path.resolve(session.cwd) !== repositoryRoot
      || session.failure !== null || !session.verifyExecutable()
      || session.verifyWorkingDirectory?.() !== true) {
    throw new Error('Development commit candidate requires the exact current production Git session.');
  }
  const worktreeRoot = path.resolve(await commandText(session, ['rev-parse', '--show-toplevel'], 'resolve worktree'));
  const commonDirectory = path.resolve(await commandText(
    session,
    ['rev-parse', '--path-format=absolute', '--git-common-dir'],
    'resolve common directory'
  ));
  const worktreeGitDirectory = path.resolve(await commandText(
    session, ['rev-parse', '--absolute-git-dir'], 'resolve worktree Git directory'
  ));
  assertStandaloneDevelopmentCommitState(worktreeGitDirectory);
  const indexPath = path.resolve(await commandText(
    session,
    ['rev-parse', '--path-format=absolute', '--git-path', 'index'],
    'resolve index'
  ));
  const ref = await commandText(session, ['symbolic-ref', '--quiet', 'HEAD'], 'resolve HEAD ref');
  const preimage = await commandText(
    session,
    ['rev-parse', '--verify', '--end-of-options', ref],
    'resolve HEAD parent'
  );
  const preimageTree = await commandText(
    session,
    ['rev-parse', '--verify', '--end-of-options', `${preimage}^{tree}`],
    'resolve HEAD tree'
  );
  if (worktreeRoot !== repositoryRoot || !REF.test(ref)
      || !OBJECT_ID.test(preimage) || !OBJECT_ID.test(preimageTree)) {
    throw new Error('Development commit candidate repository/ref preflight is not canonical.');
  }
  const beforeIndex = observeIndex(indexPath);
  const scratchRoot = await mkdtemp(path.join(tmpdir(), 'sec-development-commit-candidate-'));
  try {
    await mkdir(path.join(scratchRoot, 'objects'));
    await writeFile(path.join(scratchRoot, 'index'), beforeIndex.entry.bytes, { flag: 'wx' });
    const resolution = await createAuthorityGitScratchIndexTreeSession({
      gitReadSession: session,
      scratchRoot
    });
    if (resolution.status !== 'ready') {
      throw new Error(`Development commit candidate tree freeze unavailable: ${resolution.reason}`);
    }
    try {
      const treeResult = await resolution.session.writeTree();
      if (treeResult.status !== 'ready') {
        throw new Error(`Development commit candidate write-tree failed: ${treeResult.reason}`);
      }
      if (treeResult.value === preimageTree) {
        throw new Error('Development commit candidate has no staged tree delta.');
      }
      const commitResult = await resolution.session.commitTree({
        tree: treeResult.value,
        parents: Object.freeze([preimage]),
        message: input.request.message,
        author: input.request.author,
        committer: input.request.committer
      });
      if (commitResult.status !== 'ready') {
        throw new Error(
          `Development commit candidate target freeze failed: ${commitResult.reason}`
          + (commitResult.detail === undefined ? '' : `; ${commitResult.detail}`)
        );
      }
      const afterIndex = observeIndex(indexPath);
      const providerIdentityDigest = sha256(session.providerIdentity) as OperationDigest;
      const candidateUnsigned = Object.freeze({
        schema: 'sec-development-commit-candidate' as const,
        repositoryRoot,
        ref,
        preimage,
        tree: treeResult.value,
        target: commitResult.value,
        requestDigest: requestIdentity
      });
      const candidate = Object.freeze({
        ...candidateUnsigned,
        candidateDigest: sha256({
          ...candidateUnsigned,
          providerIdentityDigest,
          indexParent: beforeIndex.parent,
          indexEntry: {
            device: beforeIndex.entry.device,
            inode: beforeIndex.entry.inode,
            size: beforeIndex.entry.size,
            byteDigest: beforeIndex.entry.byteDigest
          }
        }) as OperationDigest
      });
      const details = Object.freeze({
        candidate,
        commonDirectory,
        worktreeGitDirectory,
        indexPath,
        indexParent: beforeIndex.parent,
        indexEntry: Object.freeze({
          device: beforeIndex.entry.device,
          inode: beforeIndex.entry.inode,
          size: beforeIndex.entry.size,
          byteDigest: beforeIndex.entry.byteDigest
        }),
        providerIdentityDigest,
        preflightReceiptDigest: sha256({
          candidateDigest: candidate.candidateDigest,
          commonDirectory,
          worktreeGitDirectory,
          indexPath
        }) as OperationDigest
      });
      if (!sameIndexObservation(afterIndex, details)) {
        throw new Error('Development commit index drifted after exact candidate freeze.');
      }
      ISSUED_DEVELOPMENT_COMMIT_CANDIDATES.set(candidate, details);
      return candidate;
    } finally {
      await resolution.session.close();
    }
  } finally {
    await rm(scratchRoot, { recursive: true, force: true });
  }
}

export function requireDevelopmentCommitCandidate(
  value: unknown,
  request: DevelopmentCommitRequest
): DevelopmentCommitCandidateDetails {
  if (value === null || typeof value !== 'object') {
    throw new Error('Development commit requires an owner-issued frozen candidate.');
  }
  const details = ISSUED_DEVELOPMENT_COMMIT_CANDIDATES.get(value);
  if (details === undefined || details.candidate.requestDigest !== requestDigest(request)) {
    throw new Error('Development commit candidate origin or request identity is invalid.');
  }
  return details;
}

/** Final exact source fence before any repository journal/object/ref Effect. */
export async function assertDevelopmentCommitCandidateCurrent(input: Readonly<{
  candidate: DevelopmentCommitCandidate;
  request: DevelopmentCommitRequest;
  session: GitReadSession;
}>): Promise<DevelopmentCommitCandidateDetails> {
  const details = requireDevelopmentCommitCandidate(input.candidate, input.request);
  const session = input.session;
  if (session.providerIdentity === null || session.failure !== null
      || path.resolve(session.cwd) !== details.candidate.repositoryRoot
      || sha256(session.providerIdentity) !== details.providerIdentityDigest
      || !session.verifyExecutable() || session.verifyWorkingDirectory?.() !== true) {
    throw new Error('Development commit candidate provider identity changed before Effect admission.');
  }
  const ref = await commandText(session, ['symbolic-ref', '--quiet', 'HEAD'], 'read back HEAD ref');
  const preimage = await commandText(
    session,
    ['rev-parse', '--verify', '--end-of-options', details.candidate.ref],
    'read back HEAD preimage'
  );
  const currentIndex = observeIndex(details.indexPath);
  assertStandaloneDevelopmentCommitState(details.worktreeGitDirectory);
  if (ref !== details.candidate.ref || preimage !== details.candidate.preimage
      || !sameIndexObservation(currentIndex, details)) {
    throw new Error('Development commit candidate changed before Effect admission.');
  }
  return details;
}
