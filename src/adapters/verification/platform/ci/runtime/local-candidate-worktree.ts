/** VerificationSession physical owner recovered from current-main semantics. */
import { decodeBranchLifecycleChildError } from '../../../../self-hosting/control/branch-lifecycle/branch-lifecycle-command.ts';
import { executeDetachedScratchWorktreePhysicalCloseout, prepareDetachedScratchWorktreePhysicalCloseout } from '../../../../self-hosting/control/branch-lifecycle/worktree-physical-closeout.ts';
import { encodeVerificationActionData } from '../../action/contract/action.ts';
import {
  assertSameNoFollowDirectoryIdentity,
  inspectExactNoFollowDirectoryPresence,
  inspectNoFollowDirectoryChain,
  inspectNoFollowOrdinaryFileEntry,
  retainNoFollowOrdinaryFile,
  type PhysicalDirectoryIdentity
} from '../../../../runtime-state/physical/runtime/physical-no-follow.ts';
import type { CiVerificationActionPlanClosure } from '../../action/contract/ci.ts';
import type { VerificationSessionScope } from '../contract/session-scope.ts';
import { commonGitDirectory, comparableFileSystemPath, exactRealPath, gitText, runVerificationSessionCommand } from './session-local-repository.ts';
import type { GitHubCandidateObservation } from './verification-session-github.ts';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const LOCAL_CANDIDATE_WORKTREE_OWNER_SCHEMA =
  'sec-verification-session-local-candidate-worktree-owner-v1' as const;

const LOCAL_CANDIDATE_WORKTREE_DIRECTORY = path.join(
  '.tmp', 'codex', 'verification-session-candidates'
);

type LocalCandidateWorktreeOwner = Readonly<{
  schema: typeof LOCAL_CANDIDATE_WORKTREE_OWNER_SCHEMA;
  authorityRoot: string;
  commonGitDirectory: string;
  candidateRoot: string;
  headSha: string;
  headTreeSha: string;
  sessionRevision: `sha256:${string}`;
  actionPlanDigest: `sha256:${string}`;
  ownerDigest: `sha256:${string}`;
}>;

type LocalCandidateWorktreeLease = Readonly<{
  owner: LocalCandidateWorktreeOwner;
  markerPath: string;
  reused: boolean;
}>;

function verificationSessionDigest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(encodeVerificationActionData(value)).digest('hex')}`;
}

function assertContainedPath(root: string, candidate: string, label: string): void {
  const relative = path.relative(root, candidate);
  if (relative === '' || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error(`${label} must be a strict descendant of the trusted authority root.`);
  }
}

function ensureOrdinaryDirectoryChain(authorityRoot: string): string {
  let current = authorityRoot;
  for (const segment of LOCAL_CANDIDATE_WORKTREE_DIRECTORY.split(/[\\/]+/u)) {
    const next = path.join(current, segment);
    assertContainedPath(authorityRoot, next, 'local candidate worktree directory');
    if (!existsSync(next)) mkdirSync(next);
    const metadata = lstatSync(next);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error('local candidate worktree directory must be an ordinary directory.');
    }
    const real = realpathSync.native(next);
    if (comparableFileSystemPath(real) !== comparableFileSystemPath(next)) {
      throw new Error('local candidate worktree directory crossed a symlink or reparse boundary.');
    }
    current = real;
  }
  return current;
}

function createLocalCandidateWorktreeOwner(input: {
  authorityRoot: string;
  commonGitDirectory: string;
  candidateRoot: string;
  headSha: string;
  headTreeSha: string;
  sessionRevision: `sha256:${string}`;
  actionPlanDigest: `sha256:${string}`;
}): LocalCandidateWorktreeOwner {
  const withoutDigest = Object.freeze({
    schema: LOCAL_CANDIDATE_WORKTREE_OWNER_SCHEMA,
    authorityRoot: input.authorityRoot,
    commonGitDirectory: input.commonGitDirectory,
    candidateRoot: input.candidateRoot,
    headSha: input.headSha,
    headTreeSha: input.headTreeSha,
    sessionRevision: input.sessionRevision,
    actionPlanDigest: input.actionPlanDigest
  });
  return Object.freeze({ ...withoutDigest, ownerDigest: verificationSessionDigest(withoutDigest) });
}

function parseLocalCandidateWorktreeOwner(source: unknown): LocalCandidateWorktreeOwner {
  const value: unknown = typeof source === 'string' ? JSON.parse(source) : source;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('local candidate worktree owner marker must be an object.');
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(',');
  const expectedKeys = [
    'actionPlanDigest', 'authorityRoot', 'candidateRoot', 'commonGitDirectory',
    'headSha', 'headTreeSha', 'ownerDigest', 'schema', 'sessionRevision'
  ].sort().join(',');
  if (keys !== expectedKeys || record.schema !== LOCAL_CANDIDATE_WORKTREE_OWNER_SCHEMA
    || typeof record.authorityRoot !== 'string' || !path.isAbsolute(record.authorityRoot)
    || typeof record.commonGitDirectory !== 'string' || !path.isAbsolute(record.commonGitDirectory)
    || typeof record.candidateRoot !== 'string' || !path.isAbsolute(record.candidateRoot)
    || typeof record.headSha !== 'string' || !/^[0-9a-f]{40}$/u.test(record.headSha)
    || typeof record.headTreeSha !== 'string' || !/^[0-9a-f]{40}$/u.test(record.headTreeSha)
    || typeof record.sessionRevision !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(record.sessionRevision)
    || typeof record.actionPlanDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(record.actionPlanDigest)
    || typeof record.ownerDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(record.ownerDigest)) {
    throw new Error('local candidate worktree owner marker identity is invalid.');
  }
  const parsed = createLocalCandidateWorktreeOwner({
    authorityRoot: record.authorityRoot,
    commonGitDirectory: record.commonGitDirectory,
    candidateRoot: record.candidateRoot,
    headSha: record.headSha,
    headTreeSha: record.headTreeSha,
    sessionRevision: record.sessionRevision as `sha256:${string}`,
    actionPlanDigest: record.actionPlanDigest as `sha256:${string}`
  });
  if (parsed.ownerDigest !== record.ownerDigest) {
    throw new Error('local candidate worktree owner marker digest mismatch.');
  }
  return parsed;
}


function readLocalCandidateWorktreeOwnerMarker(markerPath: string): LocalCandidateWorktreeOwner {
  const absolute = path.resolve(markerPath);
  const retained = retainNoFollowOrdinaryFile(
    inspectNoFollowDirectoryChain(
      path.dirname(absolute),
      'local candidate worktree owner marker parent'
    ),
    path.basename(absolute),
    undefined,
    'local candidate worktree owner marker'
  );
  try {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(retained.readBytes());
    retained.assertCurrent();
    return parseLocalCandidateWorktreeOwner(source);
  } finally {
    retained.dispose();
  }
}

function createExclusiveCanonicalFile(filePath: string, value: unknown): boolean {
  let handle: number;
  try {
    handle = openSync(filePath, 'wx');
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') return false;
    throw error;
  }
  try {
    writeFileSync(handle, `${encodeVerificationActionData(value)}\n`, 'utf8');
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  return true;
}

function worktreeRegistration(ctx: VerificationSessionScope, authorityRoot: string, candidateRoot: string):
Readonly<{ headSha: string; detached: boolean }> | null {
  const result = runVerificationSessionCommand(ctx, 'git', ['worktree', 'list', '--porcelain', '-z'], authorityRoot);
  if (result.status !== 0) {
    throw new Error(`Cannot read Git worktree registration: ${decodeBranchLifecycleChildError(result)}`);
  }
  const records: Array<{ root: string; headSha: string | null; detached: boolean }> = [];
  let current: { root: string; headSha: string | null; detached: boolean } | null = null;
  const stdout = typeof result.stdout === 'string' ? result.stdout : result.stdout.toString('utf8');
  for (const field of stdout.split('\0')) {
    if (field.startsWith('worktree ')) {
      if (current !== null) records.push(current);
      current = { root: field.slice('worktree '.length), headSha: null, detached: false };
    } else if (current !== null && field.startsWith('HEAD ')) {
      current.headSha = field.slice('HEAD '.length);
    } else if (current !== null && field === 'detached') {
      current.detached = true;
    }
  }
  if (current !== null) records.push(current);
  const matching = records.filter((record) =>
    comparableFileSystemPath(record.root) === comparableFileSystemPath(candidateRoot));
  if (matching.length > 1) throw new Error('local candidate worktree has duplicate Git registrations.');
  const selected = matching[0];
  if (selected === undefined) return null;
  if (selected.headSha === null || !/^[0-9a-f]{40}$/u.test(selected.headSha)) {
    throw new Error('local candidate worktree Git registration has an invalid HEAD.');
  }
  return Object.freeze({ headSha: selected.headSha, detached: selected.detached });
}

function assertLocalCandidateWorktreeExact(input: {
  ctx: VerificationSessionScope;
  owner: LocalCandidateWorktreeOwner;
  allowTrackedChanges?: boolean;
  expectedRoot?: PhysicalDirectoryIdentity;
}): void {
  const { ctx, owner } = input;
  const candidateIdentity = inspectNoFollowDirectoryChain(
    owner.candidateRoot,
    'local candidate worktree root'
  ).target;
  if (input.expectedRoot !== undefined) {
    if (candidateIdentity.device !== input.expectedRoot.device
      || candidateIdentity.inode !== input.expectedRoot.inode) {
      throw new Error('local candidate worktree physical identity changed before verification.');
    }
    assertSameNoFollowDirectoryIdentity(input.expectedRoot, 'local candidate worktree expected root');
  }
  const gitMarker = inspectNoFollowOrdinaryFileEntry(
    candidateIdentity,
    '.git',
    { maximumBytes: 1024 * 1024 }
  );
  if (gitMarker === null || gitMarker.kind !== 'file') {
    throw new Error('local candidate worktree .git marker must be an ordinary file.');
  }
  if (commonGitDirectory(ctx, owner.candidateRoot) !== owner.commonGitDirectory) {
    throw new Error('local candidate worktree belongs to another Git common directory.');
  }
  const root = gitText(ctx, owner.candidateRoot,
    ['rev-parse', '--path-format=absolute', '--show-toplevel'], 'candidate worktree root readback');
  if (comparableFileSystemPath(root) !== comparableFileSystemPath(owner.candidateRoot)) {
    throw new Error('local candidate worktree root readback differs from its owner marker.');
  }
  const headSha = gitText(ctx, owner.candidateRoot, ['rev-parse', 'HEAD'], 'candidate worktree HEAD readback');
  const headTreeSha = gitText(ctx, owner.candidateRoot,
    ['rev-parse', 'HEAD^{tree}'], 'candidate worktree tree readback');
  const trackedStatus = gitText(ctx, owner.candidateRoot,
    ['status', '--porcelain=v1', '--untracked-files=no'], 'candidate worktree tracked status');
  const registration = worktreeRegistration(ctx, owner.authorityRoot, owner.candidateRoot);
  if (headSha !== owner.headSha || headTreeSha !== owner.headTreeSha
    || (!input.allowTrackedChanges && trackedStatus !== '')
    || registration === null || registration.headSha !== owner.headSha || !registration.detached) {
    throw new Error('local candidate worktree is not the exact clean detached candidate.');
  }
  assertSameNoFollowDirectoryIdentity(candidateIdentity, 'local candidate worktree final root');
}

export function acquireLocalCandidateWorktree(input: {
  ctx: VerificationSessionScope;
  authorityRoot: string;
  candidate: GitHubCandidateObservation;
  sessionRevision: `sha256:${string}`;
  actionPlanClosure: CiVerificationActionPlanClosure;
}): LocalCandidateWorktreeLease {
  const authorityRoot = exactRealPath(input.authorityRoot, 'trusted authority root');
  const authorityMetadata = lstatSync(authorityRoot);
  if (!authorityMetadata.isDirectory()) throw new Error('trusted authority root must be a directory.');
  const commonDirectory = commonGitDirectory(input.ctx, authorityRoot);
  const trackedStatus = gitText(input.ctx, authorityRoot,
    ['status', '--porcelain=v1', '--untracked-files=no'], 'trusted authority tracked status');
  if (trackedStatus !== '') throw new Error('trusted authority root must remain tracked-clean.');
  const resolvedHead = gitText(input.ctx, authorityRoot,
    ['rev-parse', `${input.candidate.headSha}^{commit}`], 'candidate commit readback');
  const resolvedTree = gitText(input.ctx, authorityRoot,
    ['rev-parse', `${input.candidate.headSha}^{tree}`], 'candidate tree readback');
  if (resolvedHead !== input.candidate.headSha || resolvedTree !== input.candidate.headTreeSha) {
    throw new Error('trusted authority object database does not contain the exact candidate head and tree.');
  }
  const parent = ensureOrdinaryDirectoryChain(authorityRoot);
  const candidateRoot = path.join(parent, input.candidate.headSha);
  const markerPath = `${candidateRoot}.owner.json`;
  assertContainedPath(authorityRoot, candidateRoot, 'local candidate worktree');
  const owner = createLocalCandidateWorktreeOwner({ authorityRoot, commonGitDirectory: commonDirectory,
    candidateRoot, headSha: input.candidate.headSha, headTreeSha: input.candidate.headTreeSha,
    sessionRevision: input.sessionRevision,
    actionPlanDigest: input.actionPlanClosure.actionPlanDigest as `sha256:${string}` });
  const createdMarker = createExclusiveCanonicalFile(markerPath, owner);
  if (!createdMarker) {
    const observed = readLocalCandidateWorktreeOwnerMarker(markerPath);
    if (encodeVerificationActionData(observed) !== encodeVerificationActionData(owner)) {
      throw new Error('local candidate worktree is owned by a different Session or Action plan.');
    }
  }
  const registration = worktreeRegistration(input.ctx, authorityRoot, candidateRoot);
  const candidatePresence = inspectExactNoFollowDirectoryPresence(candidateRoot);
  if (registration !== null || candidatePresence.state === 'present') {
    if (registration === null || candidatePresence.state !== 'present') {
      throw new Error('local candidate worktree filesystem and Git registration disagree.');
    }
    assertLocalCandidateWorktreeExact({
      ctx: input.ctx,
      owner,
      expectedRoot: candidatePresence.directory.target
    });
    return Object.freeze({ owner, markerPath, reused: true });
  }
  const add = runVerificationSessionCommand(input.ctx, 'git',
    ['worktree', 'add', '--detach', candidateRoot, input.candidate.headSha], authorityRoot);
  if (add.status !== 0) {
    const afterFailure = worktreeRegistration(input.ctx, authorityRoot, candidateRoot);
    const afterFailurePresence = inspectExactNoFollowDirectoryPresence(candidateRoot);
    if (afterFailure === null || afterFailurePresence.state !== 'present') {
      throw new Error(`Cannot materialize exact local candidate worktree: ${decodeBranchLifecycleChildError(add)}`);
    }
  }
  const materializedPresence = inspectExactNoFollowDirectoryPresence(candidateRoot);
  if (materializedPresence.state !== 'present') {
    throw new Error('local candidate worktree disappeared after Git materialization.');
  }
  assertLocalCandidateWorktreeExact({
    ctx: input.ctx,
    owner,
    expectedRoot: materializedPresence.directory.target
  });
  return Object.freeze({ owner, markerPath, reused: false });
}

export async function removeLocalCandidateWorktree(input: {
  ctx: VerificationSessionScope;
  lease: LocalCandidateWorktreeLease;
}): Promise<'removed' | 'retained-physical-closeout-blocked'> {
  const observed = readLocalCandidateWorktreeOwnerMarker(input.lease.markerPath);
  if (encodeVerificationActionData(observed) !== encodeVerificationActionData(input.lease.owner)) {
    throw new Error('local candidate worktree cleanup owner marker drifted.');
  }
  // Local quick verification uses a detached scratch worktree.  It belongs to
  // Issue #186's physical owner but cannot mint a branch/ref-closeout token:
  // the opaque branch-consumption path explicitly rejects detached-scratch
  // authorizations.  Dirty or identity-drifted scratch state is retained for
  // inspection; never fall back to a path-based Git worktree effect.
  try {
    const authorization = await prepareDetachedScratchWorktreePhysicalCloseout({
      repositoryRoot: observed.authorityRoot,
      targetPath: observed.candidateRoot,
      expectedHeadSha: observed.headSha,
      expectedTreeSha: observed.headTreeSha,
      expectedRecoveryAuthorityDigest: observed.ownerDigest
    });
    const receipt = await executeDetachedScratchWorktreePhysicalCloseout({
      repositoryRoot: observed.authorityRoot,
      targetPath: observed.candidateRoot,
      expectedHeadSha: observed.headSha,
      expectedTreeSha: observed.headTreeSha,
      expectedRecoveryAuthorityDigest: observed.ownerDigest,
      authorizationPath: authorization.authorizationPath
    });
    if (receipt.terminal !== 'completed'
      || receipt.readback.registryPresent || receipt.readback.physicalPresent
      || !receipt.readback.authorizationValid
      || comparableFileSystemPath(receipt.repository.root) !== comparableFileSystemPath(observed.authorityRoot)
      || comparableFileSystemPath(receipt.target.path) !== comparableFileSystemPath(observed.candidateRoot)
      || receipt.target.headSha !== observed.headSha
      || receipt.target.treeSha !== observed.headTreeSha
      || receipt.target.recoveryAuthorityDigest !== observed.ownerDigest) {
      return 'retained-physical-closeout-blocked';
    }
    unlinkSync(input.lease.markerPath);
    return 'removed';
  } catch {
    return 'retained-physical-closeout-blocked';
  }
}
