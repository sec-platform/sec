/** VerificationSession owns one exact detached candidate from acquisition through closeout. */
import { createHash } from 'node:crypto';
import path from 'node:path';

import { settleResourcesAsync } from '../../../../../execution/resource-settlement.ts';
import { assertWorkspaceWriteLease, withWorkspaceWriteLease } from '../../../../filesystem/write-lease.ts';
import {
  hasUnresolvedLocalGitWorktreeAdd, isSettledLocalGitWorktreeAddFailure, observeLocalGitWorktreeAddAttempt,
  observeLocalGitWorktreeAddSettlement, releaseLocalGitWorktreeAddSettlement,
  type LocalGitWorktreeAddFailureActor
} from '../../../../providers/git/local-worktree.ts';
import {
  PhysicalNoFollowError, createNoFollowDirectoryChain, deleteRetainedNoFollowEntry,
  inspectExactNoFollowDirectoryPresence, inspectNoFollowDirectoryChain,
  publishExclusiveDurableCanonicalFile, recoverDurableCanonicalFileReplacement, replaceDurableCanonicalFile, retainNoFollowOrdinaryFile,
  type RetainedNoFollowOrdinaryFile
} from '../../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  executeDetachedScratchWorktreePhysicalCloseout,
  prepareDetachedScratchWorktreePhysicalCloseout
} from '../../../../self-hosting/control/branch-lifecycle/worktree-physical-closeout.ts';
import { encodeVerificationActionData } from '../../action/contract/action.ts';
import { openSessionLocalRepository, type SessionLocalRepository } from './session-local-repository.ts';

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

function verificationSessionDigest(value: unknown): `sha256:${string}` {
  return `sha256:${createHash('sha256').update(encodeVerificationActionData(value)).digest('hex')}`;
}

function comparableFileSystemPath(filePath: string): string {
  const absolute = path.resolve(filePath);
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute;
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


const LOCAL_CANDIDATE_WORKTREE_MARKER_SCHEMA = 'sec-verification-session-local-candidate-worktree-marker-v2' as const;
type LocalCandidateWorktreeMarker = Readonly<{
  schema: typeof LOCAL_CANDIDATE_WORKTREE_MARKER_SCHEMA;
  owner: LocalCandidateWorktreeOwner;
  attempt: Readonly<{
    attemptId: string;
    phase: 'prepared' | 'in-flight-or-unresolved' | 'settled';
    settlementDigest: `sha256:${string}` | null;
  }>;
}>;

export class LocalCandidateWorktreeAttemptError extends Error {
  constructor(readonly reason: 'legacy-attempt-unknown' | 'prior-attempt-closure-unavailable' | 'attempt-unresolved', message: string) {
    super(message);
    this.name = 'LocalCandidateWorktreeAttemptError';
  }
}

function parseLocalCandidateWorktreeMarker(bytes: Buffer): LocalCandidateWorktreeMarker {
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  if (value?.schema === LOCAL_CANDIDATE_WORKTREE_OWNER_SCHEMA) {
    parseLocalCandidateWorktreeOwner(value);
    throw new LocalCandidateWorktreeAttemptError('legacy-attempt-unknown',
      'Legacy candidate marker has no prior-attempt closure; preserve it for the original owner.');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'attempt,owner,schema'
    || value.schema !== LOCAL_CANDIDATE_WORKTREE_MARKER_SCHEMA) throw new Error('Candidate attempt marker is invalid.');
  const owner = parseLocalCandidateWorktreeOwner(value.owner);
  const attempt = value.attempt;
  if (attempt === null || typeof attempt !== 'object' || Array.isArray(attempt)
    || Object.keys(attempt).sort().join(',') !== 'attemptId,phase,settlementDigest'
    || typeof attempt.attemptId !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u.test(attempt.attemptId)
    || !['prepared', 'in-flight-or-unresolved', 'settled'].includes(attempt.phase)
    || (attempt.phase === 'settled'
      ? typeof attempt.settlementDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(attempt.settlementDigest)
      : attempt.settlementDigest !== null)) throw new Error('Candidate attempt disposition is invalid.');
  return Object.freeze({ schema: LOCAL_CANDIDATE_WORKTREE_MARKER_SCHEMA, owner,
    attempt: Object.freeze({ attemptId: attempt.attemptId, phase: attempt.phase, settlementDigest: attempt.settlementDigest }) });
}

export type LocalCandidateWorktreeCloseout = 'removed' | 'retained-physical-closeout-blocked'
  | 'physical-closeout-unsettled' | 'worktree-closed-marker-unsettled';

export type LocalCandidateWorktreeLease = Readonly<{
  owner: LocalCandidateWorktreeOwner;
  markerPath: string;
  reused: boolean;
  inspectRepository(root: string): ReturnType<SessionLocalRepository['observe']>;
  closeout(): Promise<LocalCandidateWorktreeCloseout>;
  release(): Promise<void>;
}>;

export async function acquireLocalCandidateWorktree(input: Readonly<{
  authorityRoot: string;
  candidate: Readonly<{ headSha: string; headTreeSha: string }>;
  sessionRevision: `sha256:${string}`;
  actionPlanDigest: `sha256:${string}`;
  maximumRepositoryObservations: number;
  failureActor?: LocalGitWorktreeAddFailureActor;
}>): Promise<LocalCandidateWorktreeLease> {
  const requestedCandidate = input.candidate;
  input = Object.freeze({ authorityRoot: input.authorityRoot,
    candidate: Object.freeze({ headSha: requestedCandidate.headSha, headTreeSha: requestedCandidate.headTreeSha }),
    sessionRevision: input.sessionRevision, actionPlanDigest: input.actionPlanDigest,
    maximumRepositoryObservations: input.maximumRepositoryObservations,
    ...(input.failureActor === undefined ? {} : { failureActor: input.failureActor }) });
  if (!Number.isSafeInteger(input.maximumRepositoryObservations) || input.maximumRepositoryObservations < 1
    || input.maximumRepositoryObservations > 1024) throw new Error('Candidate repository observation budget is invalid.');
  const authority = openSessionLocalRepository(input.authorityRoot, 16 + input.maximumRepositoryObservations * 4);
  let candidate: SessionLocalRepository | undefined;
  let marker: RetainedNoFollowOrdinaryFile | undefined;
  let released = false;
  const release = async (): Promise<void> => {
    if (released) return;
    released = true;
    await settleResourcesAsync({ cleanup: [
      { label: 'candidate-git', settle: async () => candidate?.release() },
      { label: 'candidate-owner-marker', settle: async () => marker?.dispose() },
      { label: 'authority-git', settle: () => authority.release() }
    ] });
  };
  try {
    return await withWorkspaceWriteLease(authority.commonDirectory, undefined, async (coordination) => {
      await assertWorkspaceWriteLease(authority.commonDirectory, coordination);
      const authorityRoot = authority.root;
      const trusted = await authority.observe();
      if (!trusted.trackedClean) throw new Error('Trusted authority root must remain clean.');
      const exact = await authority.resolveCommit(input.candidate.headSha);
      if (exact.headSha !== input.candidate.headSha || exact.headTreeSha !== input.candidate.headTreeSha) {
        throw new Error('Trusted authority does not contain the exact candidate head and tree.');
      }
      const parent = createNoFollowDirectoryChain(
        inspectNoFollowDirectoryChain(authorityRoot, 'candidate authority root').target,
        LOCAL_CANDIDATE_WORKTREE_DIRECTORY.split(path.sep)
      );
      const candidateRoot = path.join(parent.path, input.candidate.headSha);
      if (hasUnresolvedLocalGitWorktreeAdd(candidateRoot)) throw new LocalCandidateWorktreeAttemptError('attempt-unresolved',
        'Candidate target has an unresolved prior native add; a different marker attempt cannot bypass it.');
      const markerPath = `${candidateRoot}.owner.json`;
      const owner = createLocalCandidateWorktreeOwner({ authorityRoot, commonGitDirectory: authority.commonDirectory,
        candidateRoot, ...input.candidate, sessionRevision: input.sessionRevision, actionPlanDigest: input.actionPlanDigest });
      parseLocalCandidateWorktreeOwner(owner);
      const retainMarker = () => retainNoFollowOrdinaryFile(
        inspectNoFollowDirectoryChain(parent.path, 'candidate marker parent'), path.basename(markerPath),
        undefined, 'candidate owner marker'
      );
      const preparedMarker = (): LocalCandidateWorktreeMarker => {
        const identity = authority.prepareAddAttempt(owner.ownerDigest, candidateRoot, owner.headSha);
        return Object.freeze({ schema: LOCAL_CANDIDATE_WORKTREE_MARKER_SCHEMA, owner,
          attempt: Object.freeze({ attemptId: identity.attemptId, phase: 'prepared', settlementDigest: null }) });
      };
      // An interrupted Windows replacement can quarantine the prior marker.
      // Recover its bytes before absence can authorize a new prepared attempt;
      // the authentic Git-attempt checks below still decide closure.
      recoverDurableCanonicalFileReplacement({ parent, name: path.basename(markerPath) });
      try { marker = retainMarker(); } catch (error) {
        if (!(error instanceof PhysicalNoFollowError) || error.code !== 'PHYSICAL_NO_FOLLOW_ABSENT') throw error;
        const bytes = Buffer.from(`${encodeVerificationActionData(preparedMarker())}\n`);
        publishExclusiveDurableCanonicalFile({ parent, name: path.basename(markerPath), bytes,
          validate: (observed) => {
            if (!Buffer.from(observed).equals(bytes)) throw new Error('Candidate marker publication drifted.');
          } });
        marker = retainMarker();
      }
      if (marker.linkCount !== 1 || marker.size > 16 * 1024) {
        throw new Error('Candidate worktree owner marker must be one bounded ordinary file.');
      }
      let originalMarkerBytes = Buffer.from(marker.readBytes());
      let markerState = parseLocalCandidateWorktreeMarker(originalMarkerBytes);
      const assertMarker = (): void => {
        if (released || marker === undefined) throw new Error('Candidate worktree lifetime has ended.');
        marker.assertCurrent();
        if (marker.linkCount !== 1 || marker.size > 16 * 1024
          || !Buffer.from(marker.readBytes()).equals(originalMarkerBytes)
          || encodeVerificationActionData(markerState.owner) !== encodeVerificationActionData(owner)) {
          throw new Error('Candidate worktree owner marker drifted or belongs to another session.');
        }
      };
      const replaceMarker = (next: LocalCandidateWorktreeMarker): void => {
        assertMarker();
        const bytes = Buffer.from(`${encodeVerificationActionData(next)}\n`);
        const physical = marker!.physical;
        marker!.dispose();
        marker = undefined;
        replaceDurableCanonicalFile({ parent, name: path.basename(markerPath), bytes,
          expectedExisting: physical, expectedExistingBytes: originalMarkerBytes, rejectExistingHardLinks: true,
          validate: (observed) => {
            if (!Buffer.from(observed).equals(bytes)) throw new Error('Candidate attempt publication readback drifted.');
          } });
        marker = retainMarker();
        originalMarkerBytes = bytes;
        markerState = parseLocalCandidateWorktreeMarker(bytes);
        assertMarker();
      };
      const attemptIdentity = () => Object.freeze({ attemptId: markerState.attempt.attemptId,
        ownerDigest: owner.ownerDigest, candidateRoot, headSha: owner.headSha });
      const settleMarker = (): void => {
        const settlement = observeLocalGitWorktreeAddSettlement(attemptIdentity());
        if (settlement === null) throw new LocalCandidateWorktreeAttemptError('attempt-unresolved',
          'Candidate add has no authentic physical closure; adoption and re-add are forbidden.');
        if (markerState.attempt.phase === 'settled') {
          if (markerState.attempt.settlementDigest !== settlement.settlementDigest) throw new Error('Candidate settlement reference drifted.');
          return;
        }
        replaceMarker(Object.freeze({ ...markerState, attempt: Object.freeze({
          attemptId: markerState.attempt.attemptId, phase: 'settled', settlementDigest: settlement.settlementDigest
        }) }));
      };
      assertMarker();
      const priorAttempt = observeLocalGitWorktreeAddAttempt(attemptIdentity());
      if (priorAttempt === null) throw new LocalCandidateWorktreeAttemptError('prior-attempt-closure-unavailable',
        'Candidate attempt origin or closure is unavailable; restart recovery requires its original owner.');
      if (priorAttempt.phase === 'in-flight-or-unresolved') throw new LocalCandidateWorktreeAttemptError('attempt-unresolved',
        'Candidate add is in-flight or unresolved; adoption and re-add are forbidden.');
      if (priorAttempt.phase === 'settled') settleMarker();
      else if (markerState.attempt.phase !== 'prepared') throw new Error('Candidate attempt phase differs from its actual owner.');
      const registration = async () => {
        assertMarker();
        const matches = (await authority.registrations()).filter((record) =>
          comparableFileSystemPath(record.path) === comparableFileSystemPath(candidateRoot));
        if (matches.length > 1) throw new Error('Candidate worktree has duplicate registrations.');
        return matches[0];
      };
      const beforeRegistration = await registration();
      const present = inspectExactNoFollowDirectoryPresence(candidateRoot, 'candidate worktree').state === 'present';
      if ((beforeRegistration !== undefined) !== present) {
        throw new Error('Candidate worktree filesystem and Git registration disagree.');
      }
      const reused = present;
      if (present && markerState.attempt.phase !== 'settled') {
        throw new Error('A not-started attempt cannot adopt an existing candidate.');
      }
      if (!present) {
        if (markerState.attempt.phase === 'settled') {
          const previous = attemptIdentity();
          replaceMarker(preparedMarker());
          releaseLocalGitWorktreeAddSettlement(previous);
        }
        assertMarker();
        await assertWorkspaceWriteLease(authority.commonDirectory, coordination);
        let settledFailure: unknown;
        try {
          await authority.addDetached(candidateRoot, owner.headSha, {
            attemptId: markerState.attempt.attemptId, ownerDigest: owner.ownerDigest,
            beforeStart: async () => {
              await assertWorkspaceWriteLease(authority.commonDirectory, coordination);
              replaceMarker(Object.freeze({ ...markerState, attempt: Object.freeze({
                attemptId: markerState.attempt.attemptId, phase: 'in-flight-or-unresolved', settlementDigest: null
              }) }));
            },
            ...(input.failureActor === undefined ? {} : { failureActor: input.failureActor })
          });
        } catch (error) {
          if (!isSettledLocalGitWorktreeAddFailure(error)) throw error;
          settledFailure = error;
        }
        settleMarker();
        if (settledFailure !== undefined) {
          const afterFailure = await registration();
          if (afterFailure === undefined
            || inspectExactNoFollowDirectoryPresence(candidateRoot, 'candidate creation readback').state !== 'present') {
            throw settledFailure;
          }
        }
        assertMarker();
      }
      candidate = openSessionLocalRepository(candidateRoot, 8 + input.maximumRepositoryObservations * 3);
      const inspectCandidate = async () => {
        assertMarker();
        const observed = await candidate!.observe();
        const registered = await registration();
        if (observed.gitCommonDirectory !== owner.commonGitDirectory
          || observed.headSha !== owner.headSha || observed.headTreeSha !== owner.headTreeSha
          || registered === undefined || registered.headSha !== owner.headSha || !registered.detached) {
          throw new Error('Candidate worktree is not the exact registered detached candidate.');
        }
        assertMarker();
        candidate!.assertCurrent();
        return observed;
      };
      if (!(await inspectCandidate()).trackedClean) throw new Error('Candidate worktree is not clean.');
      return Object.freeze({ owner, markerPath, reused,
        inspectRepository: async (root: string) => {
          assertMarker();
          candidate!.assertCurrent();
          if (root === candidateRoot) return inspectCandidate();
          if (root !== authorityRoot) throw new Error('Repository inspector cannot leave the acquired candidate scope.');
          const observed = await authority.observe();
          assertMarker();
          candidate!.assertCurrent();
          return observed;
        },
        closeout: async (): Promise<LocalCandidateWorktreeCloseout> => {
          let phase: 'admission' | 'worktree' | 'marker' = 'admission';
          try {
            if (!(await inspectCandidate()).trackedClean) return 'retained-physical-closeout-blocked' as const;
            const authorization = await prepareDetachedScratchWorktreePhysicalCloseout({
              repositoryRoot: authorityRoot, targetPath: candidateRoot,
              expectedHeadSha: owner.headSha, expectedTreeSha: owner.headTreeSha,
              expectedRecoveryAuthorityDigest: owner.ownerDigest
            });
            assertMarker();
            candidate!.assertCurrent();
            // The canonical closeout now owns a durable exact physical authorization.
            // Release deletion-excluding Windows handles only at this owner handoff.
            await candidate!.release();
            phase = 'worktree';
            const receipt = await executeDetachedScratchWorktreePhysicalCloseout({
              repositoryRoot: authorityRoot, targetPath: candidateRoot,
              expectedHeadSha: owner.headSha, expectedTreeSha: owner.headTreeSha,
              expectedRecoveryAuthorityDigest: owner.ownerDigest,
              authorizationPath: authorization.authorizationPath
            });
            if (receipt.terminal !== 'completed' || receipt.readback.registryPresent || receipt.readback.physicalPresent
              || !receipt.readback.authorizationValid
              || comparableFileSystemPath(receipt.repository.root) !== comparableFileSystemPath(authorityRoot)
              || comparableFileSystemPath(receipt.target.path) !== comparableFileSystemPath(candidateRoot)
              || receipt.target.headSha !== owner.headSha || receipt.target.treeSha !== owner.headTreeSha
              || receipt.target.recoveryAuthorityDigest !== owner.ownerDigest) {
              return 'physical-closeout-unsettled';
            }
            phase = 'marker';
            return await withWorkspaceWriteLease(authority.commonDirectory, undefined, async (coordination) => {
              await assertWorkspaceWriteLease(authority.commonDirectory, coordination);
              assertMarker();
              authority.assertCurrent();
              if (inspectExactNoFollowDirectoryPresence(candidateRoot, 'closed candidate readback').state !== 'absent'
                || await registration() !== undefined) {
                return 'worktree-closed-marker-unsettled' as const;
              }
              await assertWorkspaceWriteLease(authority.commonDirectory, coordination);
              assertMarker();
              const physical = marker!.physical;
              marker!.dispose();
              marker = undefined;
              // Session marker retirement is cooperative identity-conditioned
              // deletion, not development.commit's non-cooperative byte-CAS.
              // The shared common-dir lease excludes participating Session writers;
              // Physical owns no-follow identity fences and absence readback.
              // External Linux namespace writers can still make settlement unknown.
              deleteRetainedNoFollowEntry({ root: parent, relativePath: path.basename(markerPath), kind: 'file',
                ...physical, ancestorDirectories: [] });
              releaseLocalGitWorktreeAddSettlement(attemptIdentity());
              return 'removed' as const;
            });
          } catch {
            return phase === 'admission' ? 'retained-physical-closeout-blocked'
              : phase === 'worktree' ? 'physical-closeout-unsettled' : 'worktree-closed-marker-unsettled';
          }
        },
        release
      });
    });
  } catch (error) {
    await settleResourcesAsync({ primary: { label: 'candidate-acquisition', error },
      cleanup: [{ label: 'candidate-acquisition-resources', settle: release }] });
    throw error;
  }
}
