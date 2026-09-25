import { lstatSync, readlinkSync } from 'node:fs';
import path from 'node:path';

import { rawSha256, sha256, uniqueSorted } from '../../../../contracts/canonical.ts';
import { FailureError } from '../../../../contracts/failure.ts';
import type { BoundSemanticOperation } from '../../../../execution/operation/semantic.ts';
import { settleResources as settlePhysicalResources, settleResourcesAsync as settlePhysicalResourcesAsync, type ResourceSettlementFailure as PhysicalResourceSettlementFailure } from '../../../../execution/resource-settlement.ts';
import { GitReadAuthorityError, issueGitReadAuthorityOperation, withAuthorityGitReadSession } from '../../../providers/git-read/authority.ts';
import { GIT_READ_EXACT_TREE_OPERATION_BUDGET } from '../../../providers/git-read/runtime/budget.ts';
import type { GitReadSession } from '../../../providers/git-read/runtime/session.ts';
import { parseGitAbsolutePathReply, parseGitObjectIdReply, parseWorktreeStatusPorcelainZ } from '../../../runtime-state/physical/contract/git-worktree-observation.ts';
import {
  inspectNoFollowDirectoryChain,
  PhysicalNoFollowError,
  retainNoFollowOrdinaryFile,
  type PhysicalDirectoryChain
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import type { ProcessResourceSession } from '../../../runtime-state/physical/runtime/process-resource-session.ts';

import { compilerRoot } from "../../../workspace-context.ts";

const OBSERVATION_BUDGET = Object.freeze({
  // GitRead remains inside its canonical provider ceiling. A standalone
  // command's longer native observation window is owned by the fence, after
  // this short root-discovery ledger is settled.
  deadlineMs: GIT_READ_EXACT_TREE_OPERATION_BUDGET.deadlineMs,
  maxProcesses: 8,
  maxStdoutBytes: 32 * 1024 * 1024,
  maxStderrBytes: 512 * 1024,
  maxRecords: 250_000
});
/** Bind the standalone runner's existing repository discovery contract.
 * The root, environment and per-session budget match the real read consumer
 * below. This does not authorize the command body or prove zero writes; those
 * remain with its original provider and native change-observer owners.
 */
export function compileRepositoryObservationOperation(): BoundSemanticOperation {
  return issueGitReadAuthorityOperation({
    cwd: compilerRoot,
    environment: { LANG: 'C', LC_ALL: 'C' },
    budget: OBSERVATION_BUDGET
  });
}

const receiptBrand: unique symbol = Symbol('repository-observation-receipt');

export type RepositoryObservationFailureKind =
  | 'authority-unavailable'
  | 'physical-unresolved'
  | 'receipt-closed'
  | 'receipt-unissued';

export class RepositoryObservationError extends FailureError {
  readonly kind: RepositoryObservationFailureKind;

  constructor(kind: RepositoryObservationFailureKind, message: string, ...cause: [] | [unknown]) {
    super('DEVELOPMENT-REPOSITORY-OBSERVATION-001', message, { kind },
      cause.length === 0 ? undefined : { cause: cause[0] });
    this.name = 'RepositoryObservationError';
    this.kind = kind;
  }
}

type RepositoryPathFact = Readonly<{
  path: string;
  kind: 'absent' | 'file' | 'symlink';
  device: string | null;
  inode: string | null;
  size: number;
  byteDigest: `sha256:${string}` | null;
  linkTargetDigest: `sha256:${string}` | null;
  absenceWitnessDigest: `sha256:${string}` | null;
}>;

type RepositoryObservationBaseline = Readonly<{
  head: string;
  providerIdentityDigest: `sha256:${string}`;
  repositoryRootIdentityDigest: `sha256:${string}`;
  commonDirectoryPath: string;
  commonDirectoryIdentityDigest: `sha256:${string}`;
  indexPath: string;
  indexFact: RepositoryPathFact;
  statusBytesDigest: `sha256:${string}`;
  changedPaths: readonly string[];
  untrackedPaths: readonly string[];
  worktreeFacts: readonly RepositoryPathFact[];
  digest: `sha256:${string}`;
}>;

interface RepositoryObservationReceipt {
  readonly [receiptBrand]: true;
  readonly subjectDigest: `sha256:${string}`;
  readonly head: string;
  readonly providerIdentityDigest: `sha256:${string}`;
  readonly repositoryRootIdentityDigest: `sha256:${string}`;
  readonly commonDirectoryIdentityDigest: `sha256:${string}`;
  readonly indexDigest: `sha256:${string}`;
  readonly statusDigest: `sha256:${string}`;
  readonly worktreeFactsDigest: `sha256:${string}`;
  readonly changedPaths: readonly string[];
  readonly untrackedPaths: readonly string[];
  readonly receiptDigest: `sha256:${string}`;
}

type RepositoryObservationVerification = Readonly<{
  status: 'current';
  receiptDigest: `sha256:${string}`;
}> | Readonly<{
  status: 'changed';
  receiptDigest: `sha256:${string}`;
  currentDigest: `sha256:${string}`;
  changedPaths: readonly string[];
}>;

type LiveObservation = {
  readonly repositoryRoot: string;
  readonly baseline: RepositoryObservationBaseline;
  closed: boolean;
  verified: boolean;
};

export type RepositoryObservedOperation<Value> = Readonly<{
  value: Value;
  receipt: RepositoryObservationReceipt;
  verification: RepositoryObservationVerification;
}>;

const liveObservations = new WeakMap<object, LiveObservation>();

/**
 * Resolves the physical roots that must remain under continuous observation
 * for one repository operation.  This is discovery only: the caller must arm
 * the Runtime State physical observer before issuing the operation baseline.
 */
export async function resolveRepositoryObservationRoots(
  repositoryRoot: string,
  operation: BoundSemanticOperation,
  processSession?: ProcessResourceSession
): Promise<readonly string[]> {
  const exactRoot = path.resolve(repositoryRoot);
  return withAuthorityGitReadSession({
    cwd: exactRoot,
    environment: { LANG: 'C', LC_ALL: 'C' },
    operation,
    ...(processSession === undefined ? {} : { processSession }),
    budget: OBSERVATION_BUDGET
  }, async (session) => {
    requireSessionIdentity(session);
    const commonDirectory = parseDirectoryPath(await gitBytes(session, [
      'rev-parse', '--path-format=absolute', '--git-common-dir'
    ], 'resolve the common Git directory for continuous observation'),
    'Repository common Git directory');
    if (!session.verifyExecutable() || session.verifyWorkingDirectory?.() !== true) {
      throw new RepositoryObservationError(
        'authority-unavailable',
        'Repository observation root discovery lost its retained provider or working directory'
      );
    }
    const rootKey = process.platform === 'win32' ? exactRoot.toLowerCase() : exactRoot;
    const commonKey = process.platform === 'win32'
      ? commonDirectory.toLowerCase()
      : commonDirectory;
    const commonIsInsideRoot = commonKey === rootKey
      || commonKey.startsWith(`${rootKey}${path.sep}`);
    return Object.freeze(commonIsInsideRoot
      ? [exactRoot]
      : [exactRoot, commonDirectory].sort());
  });
}

async function gitBytes(session: GitReadSession, args: readonly string[], label: string): Promise<Uint8Array> {
  const command = await session.run(args);
  if (command.kind !== 'completed') {
    throw new GitReadAuthorityError(`Repository observation could not ${label}.`, command);
  }
  if (command.result.code !== 0) {
    throw new RepositoryObservationError(
      'authority-unavailable',
      `Repository observation could not ${label}: ${command.result.stderr.trim()}`
    );
  }
  return command.result.stdout;
}

function statusPaths(bytes: Uint8Array): Readonly<{
  changedPaths: readonly string[];
  untrackedPaths: readonly string[];
}> {
  let records: ReturnType<typeof parseWorktreeStatusPorcelainZ>;
  try {
    // This command requests --untracked-files=all and --ignored=no; a directory
    // summary is not a file observation. Reuse the protocol owner, not a second
    // NUL/rename parser that silently coalesces malformed statuses.
    records = parseWorktreeStatusPorcelainZ(bytes, { allowDirectoryEntries: false });
  } catch (error) {
    throw new RepositoryObservationError('authority-unavailable', 'Repository status record is malformed', error);
  }
  const changedPaths: string[] = [];
  const untrackedPaths: string[] = [];
  for (const record of records) {
    changedPaths.push(record.path);
    if (record.originalPath !== null) changedPaths.push(record.originalPath);
    if (record.index === '?' && record.worktree === '?') untrackedPaths.push(record.path);
  }
  return Object.freeze({
    changedPaths: Object.freeze(uniqueSorted(changedPaths)),
    untrackedPaths: Object.freeze(uniqueSorted(untrackedPaths))
  });
}

function absentFact(
  repositoryPath: string,
  ancestor: PhysicalDirectoryChain,
  missingSegments: readonly string[]
): RepositoryPathFact {
  return Object.freeze({
    path: repositoryPath,
    kind: 'absent',
    device: ancestor.target.device,
    inode: ancestor.target.inode,
    size: 0,
    byteDigest: null,
    linkTargetDigest: null,
    absenceWitnessDigest: sha256(Object.freeze({
      ancestor: ancestor.target,
      missingSegments
    })) as `sha256:${string}`
  });
}

function symlinkFact(absolutePath: string, repositoryPath: string): RepositoryPathFact {
  const before = lstatSync(absolutePath, { bigint: true });
  if (!before.isSymbolicLink()) {
    throw new RepositoryObservationError('physical-unresolved', `Repository path changed type: ${repositoryPath}`);
  }
  const target = readlinkSync(absolutePath);
  const after = lstatSync(absolutePath, { bigint: true });
  if (!after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino
      || before.size !== after.size || before.mtimeNs !== after.mtimeNs
      || before.ctimeNs !== after.ctimeNs) {
    throw new RepositoryObservationError('physical-unresolved', `Repository symlink changed during observation: ${repositoryPath}`);
  }
  return Object.freeze({
    path: repositoryPath,
    kind: 'symlink',
    device: String(after.dev),
    inode: String(after.ino),
    size: Number(after.size),
    byteDigest: null,
    linkTargetDigest: rawSha256(target),
    absenceWitnessDigest: null
  });
}

type ParentWitness = Readonly<{
  chain: PhysicalDirectoryChain;
  missingSegments: readonly string[];
}>;

function observeParentWitness(
  absolutePath: string,
  parentChains: Map<string, PhysicalDirectoryChain>
): ParentWitness {
  let cursor = path.dirname(absolutePath);
  const missingSegments: string[] = [];
  for (;;) {
    const cached = parentChains.get(cursor);
    if (cached !== undefined) {
      return Object.freeze({ chain: cached, missingSegments: Object.freeze(missingSegments) });
    }
    try {
      const chain = inspectNoFollowDirectoryChain(cursor, 'Repository observation parent');
      parentChains.set(cursor, chain);
      return Object.freeze({ chain, missingSegments: Object.freeze(missingSegments) });
    } catch (error) {
      if (!(error instanceof PhysicalNoFollowError) || error.code !== 'PHYSICAL_NO_FOLLOW_ABSENT') throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        throw new RepositoryObservationError(
          'physical-unresolved',
          `Repository path has no existing physical ancestor: ${absolutePath}`,
          error
        );
      }
      missingSegments.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}

function assertParentChainCurrent(parent: PhysicalDirectoryChain): void {
  const current = inspectNoFollowDirectoryChain(parent.target.path, 'Repository observation parent readback');
  if (sha256(current) !== sha256(parent)) {
    throw new RepositoryObservationError(
      'physical-unresolved',
      `Repository observation parent changed: ${parent.target.path}`
    );
  }
}

function absolutePathFact(
  absolutePath: string,
  repositoryPath: string,
  parentChains: Map<string, PhysicalDirectoryChain>
): RepositoryPathFact {
  const parentWitness = observeParentWitness(absolutePath, parentChains);
  const parent = parentWitness.chain;
  let metadata;
  try {
    metadata = lstatSync(absolutePath, { bigint: true });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      assertParentChainCurrent(parent);
      return absentFact(
        repositoryPath,
        parent,
        Object.freeze([...parentWitness.missingSegments, path.basename(absolutePath)])
      );
    }
    throw new RepositoryObservationError('physical-unresolved', `Repository path cannot be observed: ${repositoryPath}`, error);
  }
  if (parentWitness.missingSegments.length !== 0) {
    throw new RepositoryObservationError(
      'physical-unresolved',
      `Repository path appeared while its missing parent was observed: ${repositoryPath}`
    );
  }
  if (metadata.isSymbolicLink()) {
    const fact = symlinkFact(absolutePath, repositoryPath);
    assertParentChainCurrent(parent);
    return fact;
  }
  if (!metadata.isFile()) {
    throw new RepositoryObservationError('physical-unresolved', `Repository path is not an ordinary file: ${repositoryPath}`);
  }
  let retained: ReturnType<typeof retainNoFollowOrdinaryFile> | undefined;
  let result: RepositoryPathFact | undefined;
  let primary: PhysicalResourceSettlementFailure | undefined;
  try {
    retained = retainNoFollowOrdinaryFile(
      parent,
      path.basename(absolutePath),
      undefined,
      `Repository observation ${repositoryPath}`
    );
    const digest = retained.digest();
    retained.assertCurrent();
    result = Object.freeze({
      path: repositoryPath,
      kind: 'file',
      device: retained.physical.device,
      inode: retained.physical.inode,
      size: digest.size,
      byteDigest: digest.byteDigest,
      linkTargetDigest: null,
      absenceWitnessDigest: null
    });
  } catch (error) {
    let recognized = false;
    try { recognized = error instanceof RepositoryObservationError; } catch { /* Preserve the thrown value. */ }
    primary = { label: `repository-file:${repositoryPath}`, error: recognized ? error :
      new RepositoryObservationError('physical-unresolved', `Repository file observation failed: ${repositoryPath}`, error) };
  }
  settlePhysicalResources({ primary, cleanup: retained === undefined ? [] : [{
    label: `repository-file-release:${repositoryPath}`,
    settle: () => {
      try { retained!.dispose(); }
      catch (error) {
        throw new RepositoryObservationError('physical-unresolved',
          `Repository file observation did not settle: ${repositoryPath}`, error);
      }
    }
  }] });
  return result!;
}

function pathFact(
  repositoryRoot: string,
  repositoryPath: string,
  parentChains: Map<string, PhysicalDirectoryChain>
): RepositoryPathFact {
  const absolutePath = path.resolve(repositoryRoot, ...repositoryPath.split('/'));
  if (absolutePath !== repositoryRoot && !absolutePath.startsWith(`${repositoryRoot}${path.sep}`)) {
    throw new RepositoryObservationError('physical-unresolved', `Repository path escaped its root: ${repositoryPath}`);
  }
  return absolutePathFact(absolutePath, repositoryPath, parentChains);
}

function pathFacts(repositoryRoot: string, paths: readonly string[]): readonly RepositoryPathFact[] {
  const parentChains = new Map<string, PhysicalDirectoryChain>();
  return Object.freeze(paths.map((repositoryPath) => pathFact(repositoryRoot, repositoryPath, parentChains)));
}

function parseHead(bytes: Uint8Array): string {
  const head = parseGitObjectIdReply(bytes);
  if (head === null) {
    throw new RepositoryObservationError('authority-unavailable', 'Repository HEAD is not one exact object id');
  }
  return head;
}

function parseDirectoryPath(bytes: Uint8Array, label: string): string {
  const observed = parseGitAbsolutePathReply(bytes);
  if (observed === null) {
    throw new RepositoryObservationError('authority-unavailable', `${label} is not one exact absolute path`);
  }
  return observed;
}

function requireSessionIdentity(session: GitReadSession): Readonly<{
  providerIdentityDigest: `sha256:${string}`;
  repositoryRootIdentityDigest: `sha256:${string}`;
}> {
  if (session.providerIdentity === null || session.workingDirectoryIdentity == null) {
    throw new RepositoryObservationError(
      'authority-unavailable',
      'Repository observation requires retained Git provider and working-directory identities'
    );
  }
  return Object.freeze({
    providerIdentityDigest: sha256(session.providerIdentity) as `sha256:${string}`,
    repositoryRootIdentityDigest: sha256(session.workingDirectoryIdentity) as `sha256:${string}`
  });
}

async function observeBaseline(
  session: GitReadSession,
  repositoryRoot: string
): Promise<RepositoryObservationBaseline> {
  const sessionIdentity = requireSessionIdentity(session);
  const head = parseHead(await gitBytes(session, ['rev-parse', '--verify', 'HEAD^{commit}'], 'resolve HEAD'));
  const statusBytes = await gitBytes(session, [
    '-c', 'core.quotepath=false', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
    'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=no'
  ], 'observe status');
  const indexPath = parseDirectoryPath(await gitBytes(session, [
    'rev-parse', '--path-format=absolute', '--git-path', 'index'
  ], 'resolve the index'), 'Repository index path');
  const commonDirectoryPath = parseDirectoryPath(await gitBytes(session, [
    'rev-parse', '--path-format=absolute', '--git-common-dir'
  ], 'resolve the common Git directory'), 'Repository common Git directory');
  const commonDirectoryIdentity = inspectNoFollowDirectoryChain(
    commonDirectoryPath,
    'Repository common Git directory'
  );
  const paths = statusPaths(statusBytes);
  const indexFact = absolutePathFact(indexPath, '<git-index>', new Map());
  const worktreeFacts = pathFacts(repositoryRoot, paths.changedPaths);
  const headReadback = parseHead(await gitBytes(session, ['rev-parse', '--verify', 'HEAD^{commit}'], 're-observe HEAD'));
  const statusReadback = await gitBytes(session, [
    '-c', 'core.quotepath=false', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
    'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=no'
  ], 're-observe status');
  const indexReadback = absolutePathFact(indexPath, '<git-index>', new Map());
  const commonDirectoryReadback = inspectNoFollowDirectoryChain(
    commonDirectoryPath,
    'Repository common Git directory readback'
  );
  if (headReadback !== head || rawSha256(statusReadback) !== rawSha256(statusBytes)
      || sha256(indexReadback) !== sha256(indexFact)
      || sha256(commonDirectoryReadback) !== sha256(commonDirectoryIdentity)
      || !session.verifyExecutable() || session.verifyWorkingDirectory?.() !== true) {
    throw new RepositoryObservationError('authority-unavailable', 'Repository changed while its observation receipt was issued');
  }
  const recordFailure = session.consumeRecords(paths.changedPaths.length + paths.untrackedPaths.length);
  if (recordFailure !== null) {
    throw new GitReadAuthorityError('Repository observation record budget was exhausted.', recordFailure);
  }
  const canonical = Object.freeze({
    head,
    ...sessionIdentity,
    commonDirectoryPath,
    commonDirectoryIdentityDigest: sha256(commonDirectoryIdentity) as `sha256:${string}`,
    indexPath,
    indexFact,
    statusBytesDigest: rawSha256(statusBytes),
    changedPaths: paths.changedPaths,
    untrackedPaths: paths.untrackedPaths,
    worktreeFacts
  });
  return Object.freeze({ ...canonical, digest: sha256(canonical) as `sha256:${string}` });
}

function issueReceipt(baseline: RepositoryObservationBaseline): RepositoryObservationReceipt {
  const canonical = Object.freeze({
    subjectDigest: baseline.digest,
    head: baseline.head,
    providerIdentityDigest: baseline.providerIdentityDigest,
    repositoryRootIdentityDigest: baseline.repositoryRootIdentityDigest,
    commonDirectoryIdentityDigest: baseline.commonDirectoryIdentityDigest,
    indexDigest: sha256(baseline.indexFact) as `sha256:${string}`,
    statusDigest: baseline.statusBytesDigest,
    worktreeFactsDigest: sha256(baseline.worktreeFacts) as `sha256:${string}`,
    changedPaths: baseline.changedPaths,
    untrackedPaths: baseline.untrackedPaths
  });
  return Object.freeze({
    [receiptBrand]: true as const,
    ...canonical,
    receiptDigest: sha256(canonical) as `sha256:${string}`
  });
}

/**
 * Produces a non-authoritative final-state equality projection. It does not
 * observe transient writes and therefore cannot authorize a strict zero-write
 * operation. Strict zero-write admission requires an opaque native change
 * observer issued by the Runtime State physical owner.
 */
export async function withRepositoryFinalStateObservation<Value>(
  repositoryRoot: string,
  semanticOperation: BoundSemanticOperation,
  operation: () => Promise<Value>
): Promise<RepositoryObservedOperation<Value>> {
  if (typeof operation !== 'function') throw new TypeError('Repository observed operation must be callable');
  const exactRoot = path.resolve(repositoryRoot);
  return withAuthorityGitReadSession({
    cwd: exactRoot,
    environment: { LANG: 'C', LC_ALL: 'C' },
    operation: semanticOperation,
    budget: OBSERVATION_BUDGET
  }, async (session) => {
    const baseline = await observeBaseline(session, exactRoot);
    const receipt = issueReceipt(baseline);
    const live: LiveObservation = {
      repositoryRoot: exactRoot,
      baseline,
      closed: false,
      verified: false
    };
    liveObservations.set(receipt, live);
    try {
      let value: Value | undefined;
      let primary: PhysicalResourceSettlementFailure | undefined;
      try {
        value = await operation();
      } catch (error) {
        primary = { label: 'repository-observed-operation', error };
      }
      let verification: RepositoryObservationVerification | undefined;
      await settlePhysicalResourcesAsync({ primary, cleanup: [{
        label: 'repository-final-state-readback',
        settle: async () => {
          verification = await verifyRepositoryObservationCurrent(receipt, session);
          // Preserve an independent changed-state observation when the body also
          // failed. A successful body still returns this non-authoritative view;
          // it does not become a proof of strict zero writes or permission to undo.
          if (primary !== undefined && verification.status === 'changed') {
            throw new RepositoryObservationError('physical-unresolved',
              'Repository final state changed while the observed operation failed', verification);
          }
        }
      }] });
      return Object.freeze({ value: value!, receipt, verification: verification! });
    } finally {
      live.closed = true;
      liveObservations.delete(receipt);
    }
  });
}

async function verifyRepositoryObservationCurrent(
  receipt: RepositoryObservationReceipt,
  session: GitReadSession
): Promise<RepositoryObservationVerification> {
  const live = liveObservations.get(receipt);
  if (live === undefined) {
    throw new RepositoryObservationError('receipt-unissued', 'Repository observation receipt is not live and owner-issued');
  }
  if (live.closed || live.verified) {
    throw new RepositoryObservationError('receipt-closed', 'Repository observation receipt is already settled');
  }
  live.verified = true;
  {
    const sessionIdentity = requireSessionIdentity(session);
    const head = parseHead(await gitBytes(session, ['rev-parse', '--verify', 'HEAD^{commit}'], 'verify HEAD'));
    const statusBytes = await gitBytes(session, [
      '-c', 'core.quotepath=false', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false',
      'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=no'
    ], 'verify status');
    const currentPaths = statusPaths(statusBytes);
    const indexFact = absolutePathFact(live.baseline.indexPath, '<git-index>', new Map());
    const commonDirectoryIdentity = inspectNoFollowDirectoryChain(
      live.baseline.commonDirectoryPath,
      'Repository common Git directory final readback'
    );
    const providerCurrent = session.verifyExecutable()
      && sessionIdentity.providerIdentityDigest === live.baseline.providerIdentityDigest;
    const repositoryRootCurrent = session.verifyWorkingDirectory?.() === true
      && sessionIdentity.repositoryRootIdentityDigest === live.baseline.repositoryRootIdentityDigest;
    const sameGitState = head === live.baseline.head
      && rawSha256(statusBytes) === live.baseline.statusBytesDigest
      && sha256(indexFact) === sha256(live.baseline.indexFact)
      && sha256(commonDirectoryIdentity) === live.baseline.commonDirectoryIdentityDigest
      && providerCurrent
      && repositoryRootCurrent;
    const worktreeFacts = sameGitState
      ? pathFacts(live.repositoryRoot, live.baseline.changedPaths)
      : Object.freeze([]);
    const currentCanonical = Object.freeze({
      head,
      providerIdentityDigest: providerCurrent ? sessionIdentity.providerIdentityDigest : null,
      repositoryRootIdentityDigest: repositoryRootCurrent
        ? sessionIdentity.repositoryRootIdentityDigest
        : null,
      commonDirectoryIdentityDigest: sha256(commonDirectoryIdentity),
      indexPath: live.baseline.indexPath,
      indexFact,
      statusBytesDigest: rawSha256(statusBytes),
      changedPaths: currentPaths.changedPaths,
      untrackedPaths: currentPaths.untrackedPaths,
      worktreeFacts
    });
    const currentDigest = sha256(currentCanonical) as `sha256:${string}`;
    if (sameGitState && sha256(worktreeFacts) === sha256(live.baseline.worktreeFacts)) {
      return Object.freeze({ status: 'current', receiptDigest: receipt.receiptDigest });
    }
    return Object.freeze({
      status: 'changed',
      receiptDigest: receipt.receiptDigest,
      currentDigest,
      changedPaths: Object.freeze(uniqueSorted([
        ...live.baseline.changedPaths,
        ...currentPaths.changedPaths
      ]))
    });
  }
}
