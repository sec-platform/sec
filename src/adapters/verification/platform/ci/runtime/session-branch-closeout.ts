/** VerificationSession physical owner recovered from current-main semantics. */
import type { SecOperationDigest } from '../../../../../execution/operation/semantic.ts';
import { assertWorkspaceWriteLease, withWorkspaceWriteLease, type WorkspaceWriteLeaseToken } from '../../../../filesystem/write-lease.ts';
import {
  replaceDurableCanonicalFile,
  retainNoFollowOrdinaryFile
} from '../../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { type BranchCloseoutEffect, type BranchCloseoutOperationJournal, type BranchCloseoutOperationReceipt, type BranchCloseoutOperationStore, createBranchCloseoutOperationBinding, createBranchCloseoutOperationJournal, createBranchCloseoutOperationReceipt, createBranchCloseoutReceipt, parseBranchCloseoutOperationJournal, parseBranchCloseoutOperationReceipt } from '../../../../self-hosting/control/branch-lifecycle/branch-closeout-contract.ts';
import { BRANCH_CLOSEOUT_MUTATION_PHASE_STEP_NAME, createBranchCloseoutEffectStartPublication, type HostedWorkflowCommentProvenance, observeBranchCloseoutOperationPublication } from '../../../../self-hosting/control/branch-lifecycle/branch-closeout-receipt.ts';
import { operationJournalFilePath, operationReceiptFilePath, type PreparedBranchCloseoutEnvelope } from '../../../../self-hosting/control/branch-lifecycle/branch-closeout.ts';
import { branchLifecycleDigest } from '../../../../self-hosting/control/branch-lifecycle/branch-lifecycle-audit.ts';
import { collectBranchLifecycleInventory } from '../../../../self-hosting/control/branch-lifecycle/branch-lifecycle-inventory.ts';
import { BRANCH_REF_CLOSEOUT_CAPABILITY } from '../../../../self-hosting/control/branch-lifecycle/branch-lifecycle-types.ts';
import { acquireBranchRecoveryStore } from '../../../../self-hosting/control/branch-lifecycle/branch-recovery.ts';
import type { WorktreePhysicalCloseoutConsumptionToken } from '../../../../self-hosting/control/branch-lifecycle/worktree-physical-closeout.ts';
import type { HostedIntegrationPhaseOwnership, IntegrationAuthorizationOperationPublication } from '../../../../self-hosting/control/integration/integration-authorization-publication.ts';
import { encodeVerificationActionData } from '../../action/contract/action.ts';
import type { VerificationSessionScope } from '../contract/session-scope.ts';
import { publishHostedCloseoutEffectStart } from './session-closeout-publication.ts';
import { closeoutAttempt, closeoutEffect, deleteHostedLocalRefCas, deleteHostedRemoteRefCas, pruneHostedRemote } from './session-closeout-ref-provider.ts';
import { evaluateHostedCloseoutEffectPreconditionsUnderLease } from './session-closeout-worktree.ts';
import { loadProviderBranchCloseoutRecoveryArtifact } from './session-hosted-artifacts.ts';
import { commonGitDirectory, comparableFileSystemPath } from './session-local-repository.ts';
import path from 'node:path';

function branchCloseoutStore(
  preparation: PreparedBranchCloseoutEnvelope['preparation']
): BranchCloseoutOperationStore {
  const recoveryPath = path.resolve(preparation.recovery.path);
  const recoveryRoot = path.dirname(recoveryPath);
  const physical = acquireBranchRecoveryStore({
    repositoryRoot: preparation.repository.root,
    commonDir: preparation.repository.commonDir,
    worktreeRoots: preparation.worktreePathsAtPreparation,
    recoveryRoot
  });
  if (path.resolve(physical.root.path) !== recoveryRoot) {
    throw new Error('Branch closeout operation store recovery root drifted.');
  }
  const fileName = (filePath: string): string => {
    const absolute = path.resolve(filePath);
    if (path.dirname(absolute) !== recoveryRoot) {
      throw new Error('Branch closeout operation store path escaped the recovery root.');
    }
    const name = path.basename(absolute);
    if (!/^[A-Za-z0-9._-]+$/u.test(name) || name === '.' || name === '..') {
      throw new Error('Branch closeout operation store file name is invalid.');
    }
    return name;
  };
  const exactBytes = (expected: Buffer) => (observed: Uint8Array): void => {
    if (!Buffer.from(observed).equals(expected)) {
      throw new Error('Branch closeout operation store durable readback differs.');
    }
  };
  return {
    read: (filePath) => {
      const observed = physical.read(fileName(filePath));
      return observed === null ? null : Buffer.from(observed).toString('utf8');
    },
    createExclusive: (filePath, bytes) => {
      const expected = Buffer.from(bytes, 'utf8');
      return physical.publishExclusive({
        name: fileName(filePath),
        bytes: expected,
        validate: exactBytes(expected)
      }).created;
    },
    replace: (filePath, expectedBytes, nextBytes) => {
      const name = fileName(filePath);
      const retained = retainNoFollowOrdinaryFile(
        physical.root,
        name,
        undefined,
        'Branch closeout operation store CAS preimage'
      );
      let expectedIdentity: Readonly<{ device: string; inode: string }>;
      try {
        const expected = Buffer.from(expectedBytes, 'utf8');
        if (!Buffer.from(retained.readBytes()).equals(expected)) {
          throw new Error('closeout store CAS mismatch.');
        }
        retained.assertCurrent();
        if (retained.linkCount !== 1) {
          throw new Error('closeout store CAS preimage has unexpected hard links.');
        }
        expectedIdentity = retained.physical;
      } finally {
        retained.dispose();
      }
      const next = Buffer.from(nextBytes, 'utf8');
      replaceDurableCanonicalFile({
        parent: physical.root,
        name,
        bytes: next,
        validate: exactBytes(next),
        expectedExisting: expectedIdentity,
        rejectExistingHardLinks: true
      });
      physical.assertCurrent();
    }
  };
}

export async function finalizeHostedBranchCloseout(input: Readonly<{
  ctx: VerificationSessionScope;
  prepared: PreparedBranchCloseoutEnvelope;
  binding: ReturnType<typeof createBranchCloseoutOperationBinding>;
  markerDisposition: 'published' | 'existing';
  writerId: string;
  now: () => string;
  lease: WorkspaceWriteLeaseToken;
  coordinatedLease: WorkspaceWriteLeaseToken;
  worktreeCleanupTokens: readonly WorktreePhysicalCloseoutConsumptionToken[];
  foreignWorktreeObservationDigests: readonly `sha256:${string}`[];
}>): Promise<BranchCloseoutOperationReceipt> {
  const preparation = input.prepared.preparation;
  const attempts = [...input.prepared.attempts];
  const request = {
    capability: BRANCH_REF_CLOSEOUT_CAPABILITY,
    disposition: 'merged',
    durableGoal: { kind: 'main', reference: `main@${input.binding.newMainSha}` }
  } as const;
  const remoteGuard = await evaluateHostedCloseoutEffectPreconditionsUnderLease({
    ctx: input.ctx,
    prepared: input.prepared,
    binding: input.binding,
    lease: input.lease,
    worktreeCleanupTokens: input.worktreeCleanupTokens,
    foreignWorktreeObservationDigests: input.foreignWorktreeObservationDigests
  });
  const { current, authorization } = remoteGuard;
  let terminalAuthorization = authorization;
  const currentRemote = current.remoteBranches.find(({ branch }) => (
    branch === preparation.branch
  ));
  const currentPullRequest = preparation.pullRequestNumber === null
    ? undefined
    : current.pullRequests.find(({ number }) => number === preparation.pullRequestNumber);
  let remoteEffect: BranchCloseoutEffect;
  if (input.markerDisposition === 'published') {
    if (currentRemote === undefined || authorization.blockers.length > 0
      || authorization.remoteAction !== 'delete-cas') {
      const evidence = Object.freeze({
        currentRemote: currentRemote === undefined
          ? { present: false as const, sha: null }
          : { present: true as const, sha: currentRemote.sha },
        authorization: {
          remoteAction: authorization.remoteAction,
          blockers: [...authorization.blockers].sort((left, right) => left.localeCompare(right))
        },
        currentPullRequest: currentPullRequest === undefined
          ? null
          : { state: currentPullRequest.state, headSha: currentPullRequest.headSha },
        activeWorkPackage: {
          state: current.activeWorkPackage.state,
          branch: current.activeWorkPackage.branch
        },
        unknowns: [...current.unknowns].sort((left, right) => left.localeCompare(right))
      });
      throw new Error(
        'New App-authenticated closeout marker did not retain one exact authorized remote delete: '
        + encodeVerificationActionData(evidence)
      );
    }
    await assertWorkspaceWriteLease(preparation.repository.root, input.lease);
    const remoteAttempt = deleteHostedRemoteRefCas(input.ctx, preparation, attempts);
    remoteEffect = closeoutEffect(remoteAttempt);
    if (remoteAttempt.status !== 'success') {
      throw new Error(
        'Provider-owned closeout remote deletion failed; the durable start marker forbids retry.'
      );
    }
  } else {
    if (currentRemote !== undefined || authorization.remoteAction !== 'already-absent') {
      throw new Error(
        'An existing closeout marker can recover only an exactly absent remote branch.'
      );
    }
    closeoutAttempt(
      attempts,
      'remote-delete',
      'skipped',
      'observed-absent under exact App-authenticated effect-start marker'
    );
    remoteEffect = Object.freeze({
      state: 'observed-absent',
      detailDigest: branchLifecycleDigest({
        detail: 'remote ref absent under exact App-authenticated effect-start marker'
      })
    });
  }

  // The host-local journal is deliberately opened only after the remote effect
  // has either completed under a newly-created marker or been provider-read back
  // as already absent under the exact existing marker.
  const store = branchCloseoutStore(preparation);
  const terminalPath = operationReceiptFilePath(
    preparation,
    input.binding.closeoutOperationId
  );
  const existingTerminal = store.read(terminalPath);
  if (existingTerminal !== null) {
    const terminal = parseBranchCloseoutOperationReceipt(existingTerminal);
    if (terminal.binding.closeoutOperationId !== input.binding.closeoutOperationId) {
      throw new Error('Persisted terminal receipt belongs to a different closeout operation.');
    }
    return terminal;
  }
  const journalPath = operationJournalFilePath(
    preparation,
    input.binding.closeoutOperationId
  );
  const initial = createBranchCloseoutOperationJournal({
    binding: input.binding,
    writerId: input.writerId,
    remote: remoteEffect,
    local: { state: 'not-started', detailDigest: null },
    prune: { state: 'not-started', detailDigest: null },
    terminalReceiptDigest: null
  });
  const canonicalBytes = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
  let journalBytes = store.read(journalPath);
  if (journalBytes === null) {
    const initialBytes = canonicalBytes(initial);
    if (!store.createExclusive(journalPath, initialBytes)) {
      journalBytes = store.read(journalPath);
      if (journalBytes === null) {
        throw new Error('Branch closeout operation journal raced without durable readback.');
      }
    } else {
      journalBytes = initialBytes;
    }
  }
  let journal = parseBranchCloseoutOperationJournal(journalBytes);
  if (journal.binding.closeoutOperationId !== input.binding.closeoutOperationId
    || journal.writerId !== input.writerId) {
    throw new Error('Branch closeout operation journal identity or owner conflicts.');
  }
  const updateJournal = (updates: Partial<Pick<
    BranchCloseoutOperationJournal,
    'remote' | 'local' | 'prune' | 'terminalReceiptDigest'
  >>): void => {
    const next = createBranchCloseoutOperationJournal({
      binding: journal.binding,
      writerId: journal.writerId,
      remote: updates.remote ?? journal.remote,
      local: updates.local ?? journal.local,
      prune: updates.prune ?? journal.prune,
      terminalReceiptDigest: updates.terminalReceiptDigest ?? journal.terminalReceiptDigest
    });
    const nextBytes = canonicalBytes(next);
    store.replace(journalPath, journalBytes!, nextBytes);
    journal = next;
    journalBytes = nextBytes;
  };
  if (journal.remote.state === 'not-started') {
    updateJournal({ remote: remoteEffect });
  } else if (journal.remote.state !== remoteEffect.state
    && !(journal.remote.state === 'applied' && remoteEffect.state === 'observed-absent')) {
    throw new Error('Host-local journal conflicts with the provider-observed remote effect.');
  }

  // The host-local journal is recovery memory, not effect authority. Recompute
  // the live owner authorization even when a prior state would otherwise be reused.
  const localGuard = await evaluateHostedCloseoutEffectPreconditionsUnderLease({
    ctx: input.ctx,
    prepared: input.prepared,
    binding: input.binding,
    lease: input.lease,
    worktreeCleanupTokens: input.worktreeCleanupTokens,
    foreignWorktreeObservationDigests: input.foreignWorktreeObservationDigests
  });
  terminalAuthorization = localGuard.authorization;
  const currentLocal = localGuard.current.localBranches.find(({ branch }) => branch === preparation.branch);
  // A forged/stale journal can only suppress/reuse an idempotent effect; it
  // cannot skip the live authorization above, and final completion is derived
  // from a fresh inventory readback.
  // codeql[js/user-controlled-bypass]
  if (journal.local.state === 'not-started') {
    // Remote CAS is irreversible.  Re-registration or lease drift after it
    // must stop the remaining local effects rather than reusing remote proof.
    if (currentLocal === undefined) {
      closeoutAttempt(attempts, 'local-delete', 'skipped', 'observed-absent');
      updateJournal({ local: {
        state: 'observed-absent',
        detailDigest: branchLifecycleDigest({ detail: 'local ref absent at pre-effect readback' })
      } });
    } else if (localGuard.authorization.blockers.length === 0
      && localGuard.authorization.localAction === 'delete-exact') {
      await assertWorkspaceWriteLease(preparation.repository.root, input.lease);
      await assertWorkspaceWriteLease(preparation.repository.commonDir, input.coordinatedLease);
      const localAttempt = await deleteHostedLocalRefCas(preparation, attempts,
        input.coordinatedLease, input.binding.closeoutOperationId as SecOperationDigest);
      updateJournal({ local: closeoutEffect(localAttempt) });
    } else {
      closeoutAttempt(
        attempts,
        'local-delete',
        'skipped',
        localGuard.authorization.blockers.length > 0
          ? `blocked: ${localGuard.authorization.blockers.join(' | ')}`
          : localGuard.authorization.localAction
      );
    }
  } else {
    closeoutAttempt(attempts, 'local-delete', 'skipped', `reused ${journal.local.state}`);
  }

  const pruneGuard = await evaluateHostedCloseoutEffectPreconditionsUnderLease({
    ctx: input.ctx,
    prepared: input.prepared,
    binding: input.binding,
    lease: input.lease,
    worktreeCleanupTokens: input.worktreeCleanupTokens,
    foreignWorktreeObservationDigests: input.foreignWorktreeObservationDigests
  });
  terminalAuthorization = pruneGuard.authorization;
  // Journal state is advisory recovery memory only; live authorization above
  // and final inventory readback remain mandatory.
  // codeql[js/user-controlled-bypass]
  if (journal.prune.state === 'not-started') {
    if (pruneGuard.authorization.blockers.length === 0) {
      await assertWorkspaceWriteLease(preparation.repository.root, input.lease);
      const pruneAttempt = pruneHostedRemote(input.ctx, preparation, attempts);
      updateJournal({ prune: closeoutEffect(pruneAttempt) });
    } else {
      closeoutAttempt(attempts, 'prune', 'skipped', 'closeout authorization blocked');
    }
  } else {
    closeoutAttempt(attempts, 'prune', 'skipped', `reused ${journal.prune.state}`);
  }

  await assertWorkspaceWriteLease(preparation.repository.root, input.lease);
  const after = collectBranchLifecycleInventory(input.ctx);
  await assertWorkspaceWriteLease(preparation.repository.root, input.lease);
  closeoutAttempt(
    attempts,
    'readback',
    after.unknowns.length === 0 ? 'success' : 'failed',
    after.unknowns.length === 0
      ? `remote/local/PR/worktree readback completed at ${after.observedAt}`
      : after.unknowns.join(' | ')
  );
  const receipt = createBranchCloseoutReceipt({
    generatedAt: input.now(),
    preparation,
    request,
    authorization: terminalAuthorization,
    attempts,
    before: input.prepared.before,
    after
  });
  const terminal = createBranchCloseoutOperationReceipt({
    binding: input.binding,
    writerId: input.writerId,
    generatedAt: receipt.generatedAt,
    remote: journal.remote,
    local: journal.local,
    prune: journal.prune,
    receipt
  });
  const terminalBytes = canonicalBytes(terminal);
  if (!store.createExclusive(terminalPath, terminalBytes)) {
    const raced = store.read(terminalPath);
    if (raced === null || raced !== terminalBytes) {
      throw new Error('Same closeout operation produced different terminal receipt bytes.');
    }
    return parseBranchCloseoutOperationReceipt(raced);
  }
  updateJournal({ terminalReceiptDigest: terminal.operationReceiptDigest });
  return terminal;
}

export async function finalizeSameInvocationCloseout(input: Readonly<{
  ctx: VerificationSessionScope;
  repository: string;
  pullRequestNumber: number;
  prepared: PreparedBranchCloseoutEnvelope;
  binding: ReturnType<typeof createBranchCloseoutOperationBinding>;
  authorizationPublication: IntegrationAuthorizationOperationPublication;
  authorizationCommentId: number;
  recovery: ReturnType<typeof loadProviderBranchCloseoutRecoveryArtifact>;
  provenance: HostedWorkflowCommentProvenance;
  phase: HostedIntegrationPhaseOwnership;
  worktreeCleanupTokens: readonly WorktreePhysicalCloseoutConsumptionToken[];
  now: () => string;
}>): Promise<void> {
  if (input.phase.phase !== 'closeoutMutation'
    || input.phase.stepName !== BRANCH_CLOSEOUT_MUTATION_PHASE_STEP_NAME) {
    throw new Error('Same-invocation closeout does not own the canonical mutation phase.');
  }
  const expectedAuthorizationPublication = Object.freeze({
    authorizationPublicationId: input.authorizationPublication.authorizationPublicationId,
    publicationDigest: input.authorizationPublication.publicationDigest,
    commentId: input.authorizationCommentId
  });
  const expectedRecoveryArtifact = Object.freeze({
    artifactId: input.recovery.metadata.artifactId,
    artifactName: input.recovery.metadata.artifactName,
    artifactDigest: input.recovery.artifact.artifactDigest,
    runId: input.recovery.metadata.runId,
    runAttempt: input.recovery.metadata.runAttempt
  });
  const existing = observeBranchCloseoutOperationPublication(input.ctx.repositoryRoot, {
    repository: input.repository, pullRequestNumber: input.pullRequestNumber,
    closeoutOperationId: input.binding.closeoutOperationId
  });
  if (existing !== null) return;
  const commonDir = commonGitDirectory(input.ctx, input.ctx.repositoryRoot);
  if (comparableFileSystemPath(commonDir)
      !== comparableFileSystemPath(input.prepared.preparation.repository.commonDir)) {
    throw new Error('Hosted closeout Git common directory changed before effect-start.');
  }
  await withWorkspaceWriteLease(commonDir, undefined, (coordinatedLease) => (
    withWorkspaceWriteLease(input.ctx.repositoryRoot, undefined, async (lease) => {
    await assertWorkspaceWriteLease(commonDir, coordinatedLease);
    const guard = await evaluateHostedCloseoutEffectPreconditionsUnderLease({ ctx: input.ctx,
      prepared: input.prepared, binding: input.binding, lease,
      worktreeCleanupTokens: input.worktreeCleanupTokens,
      foreignWorktreeObservationDigests: [] });
    if (guard.authorization.blockers.length !== 0 || guard.authorization.remoteAction !== 'delete-cas') {
      throw new Error('Branch closeout is not authorized before effect-start publication: '
        + encodeVerificationActionData(guard.authorization));
    }
    const effectStart = createBranchCloseoutEffectStartPublication({ binding: input.binding,
      authorizationPublication: expectedAuthorizationPublication,
      recoveryArtifact: expectedRecoveryArtifact,
      phase: { runId: input.phase.runId, runAttempt: input.phase.runAttempt, jobId: input.phase.jobId,
        jobName: 'integrate', phase: 'closeoutMutation',
        stepName: BRANCH_CLOSEOUT_MUTATION_PHASE_STEP_NAME,
        stepNumber: input.phase.stepNumber, workflowSha: input.provenance.workflowSha },
      provenance: input.provenance });
    await assertWorkspaceWriteLease(input.ctx.repositoryRoot, lease);
    const published = publishHostedCloseoutEffectStart(input.ctx, effectStart);
    if (published.disposition !== 'published') {
      throw new Error('AMBIGUOUS_SIDE_EFFECT: hosted closeout effect start was not newly App-authenticated.');
    }
    await finalizeHostedBranchCloseout({ ctx: input.ctx, prepared: input.prepared,
      binding: input.binding, markerDisposition: 'published', writerId: input.binding.closeoutOperationId,
      now: input.now, lease, coordinatedLease, worktreeCleanupTokens: input.worktreeCleanupTokens,
      foreignWorktreeObservationDigests: [] });
    })
  ));
}
