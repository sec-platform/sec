/**
 * Hosted branch closeout's physical effect and recovery executor.
 *
 * This owner keeps each ref/prune effect beside its immediate live inventory,
 * lease checks, journal settlement, and terminal readback. Session orchestration
 * retains provider-authenticated markers and the private same-host worktree token
 * bridge; neither serialized journal state nor this module creates authority.
 */
import { sha256 } from '../../../../../contracts/canonical.ts';
import { issueSecOperationRequirementBindingContext } from '../../../../../execution/operation/requirement-binding-context.ts';
import { bindSecSemanticOperation, compileSecCapabilityBinding, compileSecSemanticOperationPlan, issueSecSemanticOperationAttemptContext, type SecOperationDigest } from '../../../../../execution/operation/semantic.ts';
import type { BranchCloseoutAttempt, BranchCloseoutEffect, BranchCloseoutOperationReceipt, BranchCloseoutPreparation, BranchLifecycleInventory, PreparedBranchCloseoutEnvelope } from '../../../../../execution/verification/branch-closeout.ts';
import { assertWorkspaceWriteLease, type WorkspaceWriteLeaseToken } from '../../../../filesystem/write-lease.ts';
import { withAuthorityGitReadSession } from '../../../../providers/git-read/authority.ts';
import { GIT_READ_DEFAULT_OPERATION_BUDGET } from '../../../../providers/git-read/runtime/budget.ts';
import { assertGitPhysicalProviderReceipt, closeGitPhysicalProvider, openGitPhysicalProvider } from '../../../../providers/git/physical-provider.ts';
import { MAXIMUM_LOCAL_REF_DELETE_AGGREGATE_OUTPUT_BYTES, MAXIMUM_LOCAL_REF_DELETE_PROCESS_COUNT, assertGitLocalRefDeleteBatchReceipt, deleteExactLocalGitRefs, measureExactLocalGitRefDeleteBatchAggregateInputBytes } from '../../../../providers/git/ref-effect.ts';
import { assertProcessResourceSessionReceipt, openProcessResourceSession } from '../../../../runtime-state/physical/runtime/process-resource-session.ts';
import { authorizeBranchCloseout, createBranchCloseoutOperationBinding, createBranchCloseoutOperationJournal, createBranchCloseoutOperationReceipt, createBranchCloseoutReceipt, parseBranchCloseoutOperationJournal, parseBranchCloseoutOperationReceipt, type BranchCloseoutOperationJournal } from '../../../../self-hosting/control/branch-lifecycle/branch-closeout-contract.ts';
import { operationJournalFilePath, operationReceiptFilePath } from '../../../../self-hosting/control/branch-lifecycle/branch-closeout.ts';
import { branchLifecycleDigest } from '../../../../self-hosting/control/branch-lifecycle/branch-lifecycle-audit.ts';
import { createBranchLifecycleGitHubCredentialArgs, decodeBranchLifecycleChildError } from '../../../../self-hosting/control/branch-lifecycle/branch-lifecycle-command.ts';
import { collectBranchLifecycleInventory } from '../../../../self-hosting/control/branch-lifecycle/branch-lifecycle-inventory.ts';
import { BRANCH_REF_CLOSEOUT_CAPABILITY } from '../../../../self-hosting/control/branch-lifecycle/branch-lifecycle-types.ts';
import { verifyRecoveryAuthorityLive } from '../../../../self-hosting/control/branch-lifecycle/branch-recovery.ts';
import { type WorktreePhysicalCloseoutConsumptionToken } from '../../../../self-hosting/control/branch-lifecycle/worktree-physical-closeout.ts';
import { encodeVerificationActionData } from '../../action/contract/action.ts';
import { createBranchCloseoutOperationStore } from './session-branch-closeout-store.ts';
import { requireCommand, runVerificationSessionCommand, type VerificationSessionScope } from './session-command.ts';

const HOSTED_LOCAL_REF_REQUIREMENT = 'verification-session.hosted-closeout.local-ref-delete';

const HOSTED_LOCAL_REF_CONTRACT = sha256({ owner: 'verification.ci', operation: 'hosted-closeout-local-ref-delete', effect: 'exact-native-git-ref-cas' }) as SecOperationDigest;

const HOSTED_LOCAL_REF_PROVIDER = sha256({ provider: 'external-capabilities.git.physical-provider', operation: HOSTED_LOCAL_REF_REQUIREMENT }) as SecOperationDigest;

function closeoutAttempt(
  attempts: BranchCloseoutAttempt[],
  operation: BranchCloseoutAttempt['operation'],
  status: BranchCloseoutAttempt['status'],
  detail: string
): BranchCloseoutAttempt {
  const value = { operation, status, detail };
  attempts.push(value);
  return value;
}

function closeoutEffect(attempt: BranchCloseoutAttempt): BranchCloseoutEffect {
  return Object.freeze({
    state: attempt.status === 'success' ? 'applied' : 'failed',
    detailDigest: branchLifecycleDigest({ detail: attempt.detail })
  });
}

function deleteHostedRemoteRefCas(
  ctx: VerificationSessionScope,
  preparation: BranchCloseoutPreparation,
  attempts: BranchCloseoutAttempt[]
): BranchCloseoutAttempt {
  const result = runVerificationSessionCommand(ctx, 'git', [
    ...createBranchLifecycleGitHubCredentialArgs(),
    'push',
    '--porcelain',
    `--force-with-lease=refs/heads/${preparation.branch}:${preparation.expectedRemoteSha}`,
    preparation.repository.remote,
    `:refs/heads/${preparation.branch}`
  ], preparation.repository.root);
  return closeoutAttempt(
    attempts,
    'remote-delete',
    result.status === 0 ? 'success' : 'failed',
    result.status === 0
      ? `deleted refs/heads/${preparation.branch} at expected ${preparation.expectedRemoteSha}`
      : decodeBranchLifecycleChildError(result)
  );
}

export async function deleteHostedLocalRefCas(
  preparation: BranchCloseoutPreparation,
  attempts: BranchCloseoutAttempt[],
  coordinatedLease: WorkspaceWriteLeaseToken,
  closeoutOperationId: SecOperationDigest
): Promise<BranchCloseoutAttempt> {
  const expected = preparation.expectedLocalSha ?? preparation.expectedHeadSha;
  const localEntry = Object.freeze({ ref: `refs/heads/${preparation.branch}`, expectedOldSha: expected });
  const durationMs = 120_000;
  const plan = compileSecSemanticOperationPlan({
    operation: 'verification-session.hosted-closeout-local-ref-delete',
    intentDigest: closeoutOperationId,
    decisionDigest: HOSTED_LOCAL_REF_CONTRACT,
    deadlineAtUnixMs: Date.now() + durationMs,
    attempt: issueSecSemanticOperationAttemptContext({ authorityGrantDigest: closeoutOperationId }),
    aggregateBudgets: [
      { resource: 'duration-ms', maximum: durationMs },
      { resource: 'input-bytes', maximum: measureExactLocalGitRefDeleteBatchAggregateInputBytes([localEntry]) },
      { resource: 'output-bytes', maximum: MAXIMUM_LOCAL_REF_DELETE_AGGREGATE_OUTPUT_BYTES },
      { resource: 'processes', maximum: MAXIMUM_LOCAL_REF_DELETE_PROCESS_COUNT }
    ],
    requirements: [{ id: HOSTED_LOCAL_REF_REQUIREMENT, contractDigest: HOSTED_LOCAL_REF_CONTRACT,
      effectKinds: ['filesystem', 'process', 'provider'],
      failureKinds: ['filesystem.identity-drift', 'filesystem.write-failed', 'process.cancelled',
        'process.deadline-exhausted', 'process.output-budget-exhausted', 'process.settlement-unproven',
        'process.unavailable'] }]
  });
  const operation = bindSecSemanticOperation(plan, [compileSecCapabilityBinding({
    requirementId: HOSTED_LOCAL_REF_REQUIREMENT, contractDigest: HOSTED_LOCAL_REF_CONTRACT,
    providerIdentityDigest: HOSTED_LOCAL_REF_PROVIDER
  })]);
  const processSession = openProcessResourceSession({ operation,
    requirementBindingContext: issueSecOperationRequirementBindingContext({ operation,
      requirementId: HOSTED_LOCAL_REF_REQUIREMENT, resourceCeilings: operation.plan.execution.aggregateBudgets }) });
  let primaryError: unknown;
  try {
    await withAuthorityGitReadSession({ cwd: preparation.repository.root,
      budget: GIT_READ_DEFAULT_OPERATION_BUDGET }, async (session) => {
      const executablePath = session.gitExecutableIdentity?.realPath;
      if (executablePath === undefined) throw new Error('Git read owner did not retain an executable identity.');
      const resolution = openGitPhysicalProvider({ cwd: preparation.repository.root, executablePath,
        operation, processSession, environmentSource: process.env, maximumExecutableBytes: 128 * 1024 * 1024 });
      if (resolution.status !== 'ready') throw new Error(`Git physical provider unavailable: ${resolution.reason}`);
      let effectError: unknown;
      try {
        const receipt = await deleteExactLocalGitRefs({ provider: resolution.capability, coordinatedLease,
          entries: [localEntry] });
        assertGitLocalRefDeleteBatchReceipt(receipt);
      } catch (error) { effectError = error; }
      try { assertGitPhysicalProviderReceipt(closeGitPhysicalProvider(resolution.capability), resolution.capability); }
      catch (error) { effectError ??= error; }
      if (effectError !== undefined) throw effectError;
    });
  } catch (error) { primaryError = error; }
  try {
    assertProcessResourceSessionReceipt(processSession.close(), { operationIdentityDigest: operation.plan.identity.identityDigest,
      boundAttemptDigest: operation.boundAttemptDigest, requirementId: HOSTED_LOCAL_REF_REQUIREMENT });
  } catch (error) { primaryError ??= error; }
  return closeoutAttempt(attempts, 'local-delete', primaryError === undefined ? 'success' : 'failed',
    primaryError === undefined
      ? `deleted refs/heads/${preparation.branch} at expected ${expected}`
      : primaryError instanceof Error ? primaryError.message : String(primaryError));
}

function pruneHostedRemote(
  ctx: VerificationSessionScope,
  preparation: BranchCloseoutPreparation,
  attempts: BranchCloseoutAttempt[]
): BranchCloseoutAttempt {
  const result = runVerificationSessionCommand(ctx, 'git', [
    'remote', 'prune', preparation.repository.remote
  ], preparation.repository.root);
  return closeoutAttempt(
    attempts,
    'prune',
    result.status === 0 ? 'success' : 'failed',
    result.status === 0
      ? `pruned ${preparation.repository.remote}`
      : decodeBranchLifecycleChildError(result)
  );
}

/**
 * A closeout authorization is a point-in-time deny gate, never a lease for a
 * later ref effect.  Every marker/ref/prune boundary therefore obtains this
 * under the canonical repository lease immediately before its effect.
 */
function mergedCloseoutInventoryScope(ctx: VerificationSessionScope, preparation: BranchCloseoutPreparation) {
  if (preparation.pullRequestNumber === null) throw new Error('Merged closeout requires its exact prepared PR.');
  return { ...ctx, mergedCloseoutTarget: Object.freeze({
    number: preparation.pullRequestNumber,
    headBranch: preparation.branch,
    headSha: preparation.expectedHeadSha,
    baseBranch: preparation.repository.defaultBranch
  }) };
}

export async function evaluateHostedCloseoutEffectPreconditionsUnderLease(input: Readonly<{
  ctx: VerificationSessionScope;
  prepared: PreparedBranchCloseoutEnvelope;
  binding: ReturnType<typeof createBranchCloseoutOperationBinding>;
  lease: WorkspaceWriteLeaseToken;
  worktreeCleanupTokens: readonly WorktreePhysicalCloseoutConsumptionToken[];
  foreignWorktreeObservationDigests: readonly `sha256:${string}`[];
}>): Promise<Readonly<{
  current: BranchLifecycleInventory;
  authorization: ReturnType<typeof authorizeBranchCloseout>;
}>> {
  const preparation = input.prepared.preparation;
  await assertWorkspaceWriteLease(preparation.repository.root, input.lease);
  const observedCurrent = collectBranchLifecycleInventory(mergedCloseoutInventoryScope(input.ctx, preparation));
  const recoveryReadback = verifyRecoveryAuthorityLive({
    inventory: observedCurrent,
    recovery: preparation.recovery
  });
  const current: BranchLifecycleInventory = {
    ...observedCurrent,
    unknowns: [...new Set([
      ...observedCurrent.unknowns,
      ...(recoveryReadback.status === 'success' ? [] : [recoveryReadback.detail])
    ])].sort((left, right) => left.localeCompare(right))
  };
  const expectedHeadTreeSha = requireCommand(
    input.ctx,
    'git',
    ['rev-parse', `${preparation.expectedHeadSha}^{tree}`],
    'branch closeout immediate effect prepared head tree'
  );
  const authorization = authorizeBranchCloseout({
    preparation,
    request: {
      capability: BRANCH_REF_CLOSEOUT_CAPABILITY,
      disposition: 'merged',
      durableGoal: { kind: 'main', reference: `main@${input.binding.newMainSha}` }
    },
    before: input.prepared.before,
    current,
    worktreeCleanupTokens: input.worktreeCleanupTokens,
    expectedHeadTreeSha,
    foreignWorktreeObservationDigests: input.foreignWorktreeObservationDigests
  });
  await assertWorkspaceWriteLease(preparation.repository.root, input.lease);
  return Object.freeze({ current, authorization });
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
  const terminalPath = operationReceiptFilePath(
    preparation,
    input.binding.closeoutOperationId
  );
  const journalPath = operationJournalFilePath(preparation, input.binding.closeoutOperationId);
  const store = createBranchCloseoutOperationStore({
    repositoryRoot: preparation.repository.root,
    commonGitDirectory: preparation.repository.commonDir,
    repositoryLease: input.lease,
    commonGitLease: input.coordinatedLease,
    journalPath,
    receiptPath: terminalPath
  });
  const existingTerminal = await store.read(terminalPath);
  if (existingTerminal !== null) {
    const terminal = parseBranchCloseoutOperationReceipt(existingTerminal);
    if (terminal.binding.closeoutOperationId !== input.binding.closeoutOperationId) {
      throw new Error('Persisted terminal receipt belongs to a different closeout operation.');
    }
    return terminal;
  }
  const initial = createBranchCloseoutOperationJournal({
    binding: input.binding,
    writerId: input.writerId,
    remote: remoteEffect,
    local: { state: 'not-started', detailDigest: null },
    prune: { state: 'not-started', detailDigest: null },
    terminalReceiptDigest: null
  });
  const canonicalBytes = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;
  let journalBytes = await store.read(journalPath);
  if (journalBytes === null) {
    const initialBytes = canonicalBytes(initial);
    if (!await store.createExclusive(journalPath, initialBytes)) {
      journalBytes = await store.read(journalPath);
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
  const updateJournal = async (updates: Partial<Pick<
    BranchCloseoutOperationJournal,
    'remote' | 'local' | 'prune' | 'terminalReceiptDigest'
  >>): Promise<void> => {
    const next = createBranchCloseoutOperationJournal({
      binding: journal.binding,
      writerId: journal.writerId,
      remote: updates.remote ?? journal.remote,
      local: updates.local ?? journal.local,
      prune: updates.prune ?? journal.prune,
      terminalReceiptDigest: updates.terminalReceiptDigest ?? journal.terminalReceiptDigest
    });
    const nextBytes = canonicalBytes(next);
    await store.replace(journalPath, journalBytes!, nextBytes);
    journal = next;
    journalBytes = nextBytes;
  };
  if (journal.remote.state === 'not-started') {
    await updateJournal({ remote: remoteEffect });
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
      await updateJournal({ local: {
        state: 'observed-absent',
        detailDigest: branchLifecycleDigest({ detail: 'local ref absent at pre-effect readback' })
      } });
    } else if (localGuard.authorization.blockers.length === 0
      && localGuard.authorization.localAction === 'delete-exact') {
      await assertWorkspaceWriteLease(preparation.repository.root, input.lease);
      await assertWorkspaceWriteLease(preparation.repository.commonDir, input.coordinatedLease);
      const localAttempt = await deleteHostedLocalRefCas(preparation, attempts,
        input.coordinatedLease, input.binding.closeoutOperationId as SecOperationDigest);
      await updateJournal({ local: closeoutEffect(localAttempt) });
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
      await updateJournal({ prune: closeoutEffect(pruneAttempt) });
    } else {
      closeoutAttempt(attempts, 'prune', 'skipped', 'closeout authorization blocked');
    }
  } else {
    closeoutAttempt(attempts, 'prune', 'skipped', `reused ${journal.prune.state}`);
  }

  await assertWorkspaceWriteLease(preparation.repository.root, input.lease);
  const after = collectBranchLifecycleInventory(mergedCloseoutInventoryScope(input.ctx, preparation));
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
  if (!await store.createExclusive(terminalPath, terminalBytes)) {
    const raced = await store.read(terminalPath);
    if (raced === null || raced !== terminalBytes) {
      throw new Error('Same closeout operation produced different terminal receipt bytes.');
    }
    return parseBranchCloseoutOperationReceipt(raced);
  }
  await updateJournal({ terminalReceiptDigest: terminal.operationReceiptDigest });
  return terminal;
}
