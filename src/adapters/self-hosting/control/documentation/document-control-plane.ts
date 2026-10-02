import { realpathSync } from 'node:fs';
import path from 'node:path';
import { withWorkspaceWriteLease } from '../../../filesystem/write-lease.ts';
import { GitReadAuthorityError, withAuthorityGitReadSession } from '../../../providers/git-read/authority.ts';
import { assertGitReadSessionReceipt, type GitReadSession } from '../../../providers/git-read/runtime/session.ts';
import { withGitHubCredentialBootstrap } from '../../../providers/github-api/credential-bootstrap.ts';
import { GIT_READ_OPERATION_BUDGET } from '../../development/tooling/git/git-read.ts';
import { CodexDevelopmentWorkPackageManifestDigest } from '../task/contract/work-package.ts';
import {
  admitDocumentControlExecutionRoot,
  assertCanonicalManifestPath,
  assertDocumentControlCandidateIsolation,
  assertReviewedOn
} from './document-control-admission.ts';
import { decodeDocumentControlCommand, projectDocumentControlPlaneStatusCli } from './document-control-cli.ts';
import {
  compileDocumentControlFreezeOperation,
  prepareDocumentControlFreezePlan
} from './document-control-freeze-plan.ts';
import {
  assertInitialFreezeObservationFence,
  buildNextIndex,
  captureRepositoryIndexTreeThroughExternalScratch,
  readAnchoredIndexSnapshot,
  resolveIndexPaths
} from './document-control-index.ts';
import {
  ActivePointerPath,
  type CodexDevelopmentFreezeFault,
  type CodexDevelopmentFreezeResult,
  RollingPlanPath
} from './document-control-journal-codec.ts';
import {
  assertFreezeReadOwnerCurrent,
  CodexDevelopmentDocumentControlCliAdmissionError,
  createReadOnlyResolverGit,
  currentDocumentControlGitReadSession,
  DOCUMENT_CONTROL_FREEZE_GIT_READ_BUDGET,
  documentControlCliFailure,
  ExternalCommandTimeoutMs,
  isDocumentControlHostCliTestSession,
  observeLiveDefaultSha,
  requireCommand,
  run,
  withDocumentControlFreezeReadSession
} from './document-control-observation.ts';
import {
  type CodexDevelopmentActiveWorkPackageResolution,
  CodexDevelopmentClassifyFreezeConvergence,
  type CodexDevelopmentDefaultRefState
} from './document-control-plane-contract.ts';
import {
  assertRegularRepositoryFile,
  type CodexDevelopmentDurabilityObserver,
  type FreezeDurabilityOptions,
  readOptionalSafeRegularFile,
  readSafeRegularFile,
  scanDirectDirectoryNames
} from './document-control-publication.ts';
import {
  advanceFreezeJournal,
  effectiveFreezeJournal,
  maybeFault,
  preflightFreezeProjectionEntryStates,
  readFreezeJournalSnapshot,
  restoreFreezeJournalDurability,
  retireEmptyFreezeTransactionRootAfterJournalLast,
  retireTerminalFreezeTransaction,
  verifyTerminalFreezeJournal,
  writeFreezeJournal
} from './document-control-recovery.ts';
import { resolveLiveControlPlane } from './document-control-status.ts';

/**
 * Document-control operation owner and existing public entry.
 *
 * Flow: CLI decoding -> trusted/candidate admission -> retained observation and
 * freeze-plan compilation -> native private-index construction -> journal/CAS
 * publication -> writer settlement -> separately admitted terminal retirement.
 * Status observes that same recovery lifecycle without publishing it.
 *
 * The leaves below have one-way dependencies. They split input interpretation,
 * native index custody, physical publication and recovery responsibilities, not
 * authority: this entry still admits the workflow and returns settled results.
 * Keep the public entry stable for continuation, verification and fixture callers.
 * Do not add a registry or a second tree builder to reconnect these roles.
 */

export { CodexDevelopmentDocumentControlCliAdmissionError, createDocumentControlRoutingTestActorForTests, observeDocumentControlWorkRouting, projectDocumentControlGitHubFailure, withDocumentControlHostCliTestSessionV1, type CodexDevelopmentDocumentControlCliAdmissionReason, type CodexDevelopmentDocumentControlCliAdmissionStatus, type CodexDevelopmentDocumentControlCliOperation, type DocumentControlRoutingTestActor } from './document-control-observation.ts';

export {
  type CodexDevelopmentDurabilityEvent, type CodexDevelopmentDurabilityStage, type CodexDevelopmentFreezeFault, type CodexDevelopmentFreezeResult
} from './document-control-journal-codec.ts';

export {
  CodexDevelopmentDurabilityBarrierError,
  CodexDevelopmentUnsafeAnchoredPathError,
  CodexDevelopmentUnsupportedAnchoredPathEffectError, type CodexDevelopmentDurabilityObserver
} from './document-control-publication.ts';

export { observeActiveWorkPackage, resolveLiveControlPlane } from './document-control-status.ts';

export {
  projectDocumentControlPlaneStatusCli, type DocumentControlPlaneStatusCliProjection
} from './document-control-cli.ts';

type FreezeWriterSettlementObservation = Readonly<{
  freezeOperationId: string;
  gitOperationIdentityDigest: string;
  gitAttemptDigest: string;
  gitReceiptDigest: string;
  processCount: number;
  admittedRootProcesses: number;
  admittedNativeProcesses: number;
}>;

type FreezeDocumentControlPlaneInput = {
  cwd: string;
  manifestPath: string;
  reviewedOn: string;
  /** Author one untrusted tracking:none successor projection without activation authority. */
  proposalOnly?: boolean;
  faultAfter?: CodexDevelopmentFreezeFault;
  /** Internal test seam after writer settlement and before terminal re-admission. */
  beforeTerminalRetirement?: (writer: FreezeWriterSettlementObservation) => Promise<void> | void;
  /** Internal deterministic contract-test observer for rename durability ordering. */
  durabilityObserver?: CodexDevelopmentDurabilityObserver;
  /** Internal deterministic contract-test seam for an unsupported directory barrier. */
  parentDirectoryBarrier?: (directoryPath: string) => Promise<void>;
  /** Internal deterministic contract-test seam before the post-admission local stability fence. */
  beforeInitialJournalFence?: () => Promise<void> | void;
  /** Internal deterministic contract-test seam after exact rename source/parent anchors are open. */
  beforeAnchoredRename?: FreezeDurabilityOptions['beforeAnchoredRename'];
  /** Internal deterministic seam after namespace mutation and before the retained-object flush. */
  afterAnchoredNamespaceMutationBeforeFlush?: FreezeDurabilityOptions['afterAnchoredNamespaceMutationBeforeFlush'];
  /** Internal deterministic seam after containing-parent anchors are retained and before creation. */
  beforeAnchoredCreate?: FreezeDurabilityOptions['beforeAnchoredCreate'];
  /** Internal deterministic seam after exact cleanup bytes are read from the opened object. */
  beforeAnchoredCleanup?: FreezeDurabilityOptions['beforeAnchoredCleanup'];
  /** Internal Linux-only fault seam after exact PRE recovery link identity readback. */
  afterExactPreRecoveryLink?: FreezeDurabilityOptions['afterExactPreRecoveryLink'];
  /** Internal deterministic fault seam immediately before a newly-created directory parent flush. */
  beforeCreatedParentBarrier?: FreezeDurabilityOptions['beforeCreatedParentBarrier'];
  /** Internal deterministic observer after a newly-created directory parent is durably flushed. */
  createdParentBarrierObserver?: FreezeDurabilityOptions['createdParentBarrierObserver'];
};

/**
 * Executes a freeze with the caller's already-bound Git read session.  The
 * public entrypoint below opens this session for production callers; tests and
 * composed control-plane operations may supply their own owner-issued scope.
 */
async function runFreezeOwner(input: FreezeDocumentControlPlaneInput, options: Readonly<{
  deadlineAtUnixMs: number;
  requiredTerminalOperationId?: string;
  beforeWriter?: () => Promise<void>;
}>): Promise<Readonly<{ result: CodexDevelopmentFreezeResult; deferred: boolean; writer: FreezeWriterSettlementObservation }>> {
  input = Object.freeze({ ...input });
  const cwd = path.resolve(input.cwd);
  // A distinct old terminal responsibility may finish before this new request.
  // Only successful retirement AND provider settlement allow the second owner;
  // both retain the original wall deadline. A pending/failed writer never does.
  for (let pass = 0; pass < 2; pass++) {
    let deferred = false, retiredPrior = false;
    let writerSession: GitReadSession | undefined;
    const result = await withAuthorityGitReadSession({ cwd,
      budget: options.requiredTerminalOperationId === undefined
        ? DOCUMENT_CONTROL_FREEZE_GIT_READ_BUDGET : GIT_READ_OPERATION_BUDGET,
      deadlineAtUnixMs: options.deadlineAtUnixMs }, session => withDocumentControlFreezeReadSession(session, async () => {
        writerSession = session;
        await options.beforeWriter?.();
        return freezeDocumentControlPlaneWithSession(input, {
          requiredTerminalOperationId: options.requiredTerminalOperationId,
          priorTerminalRetired: pass === 0 ? () => { retiredPrior = true; } : undefined,
          forbidAnotherPriorTerminal: pass !== 0,
          ...(options.requiredTerminalOperationId === undefined ? { deferTerminalRetirement: () => { deferred = true; } } : {})
        });
      }));
    // withAuthority... has already joined and successfully settled this exact
    // writer owner. close() only retrieves its original cached immutable receipt;
    // no new close, command, allowance or provider is started by this observation.
    const receipt = await writerSession?.close?.();
    if (writerSession === undefined || receipt === undefined) throw new Error('Freeze writer settlement receipt is unavailable.');
    assertGitReadSessionReceipt(receipt);
    if (receipt.operationIdentityDigest === null || receipt.boundAttemptDigest === null
        || receipt.failureDetailDigest !== null || receipt.processSessionOwnership !== 'owned') {
      throw new Error('Freeze writer diagnostic requires its successful owned terminal receipt.');
    }
    const writer: FreezeWriterSettlementObservation = Object.freeze({
      freezeOperationId: result.operationId, gitOperationIdentityDigest: receipt.operationIdentityDigest,
      gitAttemptDigest: receipt.boundAttemptDigest, gitReceiptDigest: receipt.receiptDigest,
      processCount: receipt.processCount, admittedRootProcesses: writerSession.budget.maxProcesses,
      admittedNativeProcesses: writerSession.budget.maxProcesses
    });
    if (retiredPrior) {
      if (pass !== 0) throw new Error('A competing prior freeze appeared after its retirement boundary.');
      continue;
    }
    return Object.freeze({ result, deferred, writer });
  }
  throw new Error('Freeze owner did not settle its bounded request.');
}

async function freezeDocumentControlPlaneWithSession(
  input: FreezeDocumentControlPlaneInput,
  options: Readonly<{
    deferTerminalRetirement?: () => void;
    requiredTerminalOperationId?: string;
    priorTerminalRetired?: () => void;
    forbidAnotherPriorTerminal?: boolean;
  }> = {}
): Promise<CodexDevelopmentFreezeResult> {
  assertCanonicalManifestPath(input.manifestPath);
  assertReviewedOn(input.reviewedOn);
  const repositoryRoot = requireCommand(
    await run('git', ['rev-parse', '--show-toplevel'], input.cwd),
    'git repository discovery'
  );
  const durability: FreezeDurabilityOptions = Object.freeze({
    observer: input.durabilityObserver,
    parentDirectoryBarrier: input.parentDirectoryBarrier,
    beforeAnchoredRename: input.beforeAnchoredRename,
    afterAnchoredNamespaceMutationBeforeFlush: input.afterAnchoredNamespaceMutationBeforeFlush,
    beforeAnchoredCreate: input.beforeAnchoredCreate,
    beforeAnchoredCleanup: input.beforeAnchoredCleanup,
    afterExactPreRecoveryLink: input.afterExactPreRecoveryLink,
    beforeCreatedParentBarrier: input.beforeCreatedParentBarrier,
    createdParentBarrierObserver: input.createdParentBarrierObserver
  });
  return withWorkspaceWriteLease(repositoryRoot, undefined, async () => {
    let existingJournalSnapshot = await readFreezeJournalSnapshot(repositoryRoot);
    if (currentDocumentControlGitReadSession() !== undefined) assertFreezeReadOwnerCurrent();
    if (options.requiredTerminalOperationId !== undefined
        && (existingJournalSnapshot === null || !existingJournalSnapshot.canonicalPresent
          || existingJournalSnapshot.journal.phase !== 'terminal'
          || existingJournalSnapshot.journal.operationId !== options.requiredTerminalOperationId
          || (existingJournalSnapshot.recovery !== null
            && existingJournalSnapshot.recovery.completionMode !== 'complete'))) {
      throw new Error('Terminal freeze continuation lost its exact durable journal.');
    }
    const manifestFile = await assertRegularRepositoryFile(repositoryRoot, input.manifestPath);
    const manifestBytes = await readSafeRegularFile({
      boundaryRoot: repositoryRoot,
      filePath: manifestFile,
      label: 'Work Package manifest'
    });
    const manifestDigest = CodexDevelopmentWorkPackageManifestDigest(manifestBytes) as `sha256:${string}`;
    const pendingJournal = effectiveFreezeJournal(existingJournalSnapshot);
    if (pendingJournal !== null && pendingJournal.phase !== 'terminal'
        && (pendingJournal.manifestPath !== input.manifestPath || pendingJournal.manifestDigest !== manifestDigest
          || pendingJournal.reviewedOn !== input.reviewedOn)) {
      throw new Error('A competing nonterminal document control freeze journal exists.');
    }
    if (currentDocumentControlGitReadSession() !== undefined) assertFreezeReadOwnerCurrent();
    if (existingJournalSnapshot === null) {
      await retireEmptyFreezeTransactionRootAfterJournalLast({ repositoryRoot, durability });
    }
    const existingRecoveryIncomplete = existingJournalSnapshot?.recovery !== undefined
      && existingJournalSnapshot.recovery !== null
      && existingJournalSnapshot.recovery.completionMode !== 'complete';
    const requestedAuthoringDisposition = input.proposalOnly === true
      ? 'proposal-only' as const
      : 'activation' as const;
    if (existingJournalSnapshot !== null
        && (existingJournalSnapshot.journal.authoringDisposition ?? 'activation')
          !== requestedAuthoringDisposition) {
      throw new Error('Existing document-control journal belongs to another authoring disposition.');
    }
    if (existingJournalSnapshot !== null
        && (existingJournalSnapshot.journal.phase !== 'terminal' || existingRecoveryIncomplete)) {
      await preflightFreezeProjectionEntryStates(repositoryRoot, existingJournalSnapshot!);
      await restoreFreezeJournalDurability(repositoryRoot, durability, existingJournalSnapshot);
    }
    if (existingJournalSnapshot?.recovery !== undefined
        && existingJournalSnapshot.recovery !== null
        && existingJournalSnapshot.recovery.completionMode !== 'complete') {
      const recovery = existingJournalSnapshot.recovery;
      const recoveredBytes = await writeFreezeJournal(
        repositoryRoot,
        recovery.expectedPreBytes,
        recovery.nextJournal,
        durability,
        input.faultAfter
      );
      const recoveredSnapshot = await readFreezeJournalSnapshot(repositoryRoot);
      if (recoveredSnapshot === null || !recoveredSnapshot.canonicalPresent
          || !recoveredSnapshot.bytes.equals(recoveredBytes)
          || !recoveredSnapshot.bytes.equals(recovery.nextBytes)
          || (recoveredSnapshot.recovery !== null
            && recoveredSnapshot.recovery.completionMode !== 'complete')) {
        throw new Error('Recovered freeze journal CAS is not canonically installed and completely retired.');
      }
      existingJournalSnapshot = recoveredSnapshot;
      await preflightFreezeProjectionEntryStates(repositoryRoot, recoveredSnapshot);
      await restoreFreezeJournalDurability(repositoryRoot, durability, recoveredSnapshot);
    }
    const existingJournal = existingJournalSnapshot?.journal ?? null;
    if (existingJournal !== null && existingJournal.phase !== 'terminal') {
      if (existingJournal.manifestPath !== input.manifestPath
          || existingJournal.manifestDigest !== manifestDigest
          || existingJournal.reviewedOn !== input.reviewedOn) {
        throw new Error('A competing nonterminal document control freeze journal exists.');
      }
      return advanceFreezeJournal({
        repositoryRoot,
        journal: existingJournal,
        journalBytes: existingJournalSnapshot!.bytes,
        faultAfter: input.faultAfter,
        durability,
        deferTerminalRetirement: options.deferTerminalRetirement
      });
    }
    if (existingJournal !== null && existingJournal.phase === 'terminal') {
      const sameRequest = existingJournal.manifestPath === input.manifestPath
        && existingJournal.manifestDigest === manifestDigest && existingJournal.reviewedOn === input.reviewedOn;
      if (!sameRequest && options.forbidAnotherPriorTerminal === true) {
        throw new Error('A competing prior freeze appeared after its retirement boundary.');
      }
      if (options.requiredTerminalOperationId !== undefined
          && (existingJournal.manifestPath !== input.manifestPath
            || existingJournal.manifestDigest !== manifestDigest
            || existingJournal.reviewedOn !== input.reviewedOn)) {
        throw new Error('Terminal freeze continuation no longer matches the manifest or review date.');
      }
      const previousResult = await verifyTerminalFreezeJournal({
        repositoryRoot,
        snapshot: existingJournalSnapshot!,
        manifestPath: existingJournal.manifestPath,
        manifestDigest: existingJournal.manifestDigest,
        reviewedOn: existingJournal.reviewedOn
      });
      await retireTerminalFreezeTransaction({
        repositoryRoot,
        snapshot: existingJournalSnapshot!,
        durability
      });
      existingJournalSnapshot = null;
      if (existingJournal.manifestPath === input.manifestPath
          && existingJournal.manifestDigest === manifestDigest
          && existingJournal.reviewedOn === input.reviewedOn) {
        return previousResult;
      }
      if (options.priorTerminalRetired !== undefined) {
        options.priorTerminalRetired();
        return previousResult;
      }
    }

    const { spec, headSha, localDefaultSha, baseTreeSha, snapshot, projection, indexedTargetManifest, pointerFile, rollingPlanFile, pointerPre, rollingPlanPre, pointerWorktree, rollingPlanWorktree, pointerNext, rollingPlanNext } = await prepareDocumentControlFreezePlan({
      repositoryRoot, manifestPath: input.manifestPath, reviewedOn: input.reviewedOn,
      proposalOnly: input.proposalOnly, manifestBytes
    });
    const indexPaths = await resolveIndexPaths(repositoryRoot);
    if (existingJournalSnapshot === null) {
      const orphanRecovery = scanDirectDirectoryNames(
        indexPaths.gitDirectory,
        'Git index orphan recovery census'
      )
        .filter((name) => name.startsWith('.entry-'))
        .sort();
      if (orphanRecovery.length > 0) {
        throw new Error(
          `Git index recovery residue has no journal authority and is preserved: ${orphanRecovery.join(', ')}.`
        );
      }
    }
    if (await readOptionalSafeRegularFile({
      boundaryRoot: indexPaths.gitDirectory,
      filePath: indexPaths.lockPath,
      label: 'Git index preparation lock'
    }) !== null) {
      throw new Error('Document control freeze found an active Git index lock; preserving it.');
    }
    let indexReadback = await readAnchoredIndexSnapshot({
      boundaryRoot: indexPaths.gitDirectory,
      filePath: indexPaths.indexPath,
      label: 'Git index preparation readback'
    });
    if (indexReadback.identity !== snapshot.index.identity
        || !indexReadback.bytes.equals(snapshot.index.bytes)) {
      const semanticReadback = await captureRepositoryIndexTreeThroughExternalScratch({
        repositoryRoot,
        resolverGit: createReadOnlyResolverGit()
      });
      if (semanticReadback.treeSha !== snapshot.treeSha) {
        throw new Error(
          `Git index semantic tree changed during freeze preparation (before=${snapshot.treeSha}, `
          + `after=${semanticReadback.treeSha}).`
        );
      }
      indexReadback = semanticReadback.index;
    }
    const indexPre = Buffer.from(indexReadback.bytes);
    const liveDefaultSha = await observeLiveDefaultSha({
      repositoryRoot,
      repository: spec.resolver.repository,
      remote: spec.resolver.remote,
      defaultBranch: spec.resolver.defaultBranch,
      resolverGit: createReadOnlyResolverGit()
    });
    if (liveDefaultSha === undefined) {
      throw new Error('Pre-publication live default admission is unavailable.');
    }
    if (liveDefaultSha !== localDefaultSha) {
      throw new Error('Live default ref is stale before repository object publication; freeze fails closed.');
    }
    const createFreezeOperation = (candidateTreeSha: string, indexNext: Buffer) => (
      compileDocumentControlFreezeOperation({
        authoringDisposition: projection.authoringDisposition,
        manifestPath: input.manifestPath, manifestDigest: projection.manifestDigest,
        reviewedOn: input.reviewedOn, localDefaultSha, baseTreeSha,
        preIndexTreeSha: snapshot.treeSha, candidateTreeSha, indexPre, indexNext,
        manifestBytes, pointerPre, pointerNext, rollingPlanWorktree, rollingPlanNext
      })
    );
    const retirementSatisfied = projection.retiredManifestPath === null
      || !snapshot.indexPaths.includes(projection.retiredManifestPath);
    const convergence = CodexDevelopmentClassifyFreezeConvergence({
      targetManifestMatches: indexedTargetManifest !== undefined
        && indexedTargetManifest.equals(manifestBytes),
      pointerMatches: pointerPre.equals(pointerNext),
      indexedRollingMatches: rollingPlanPre.equals(rollingPlanNext),
      worktreeRollingMatches: rollingPlanWorktree.equals(rollingPlanNext),
      retirementSatisfied
    });
    if (convergence === 'semantic-noop') {
      const noop = createFreezeOperation(snapshot.treeSha, indexPre);
      await input.beforeInitialJournalFence?.();
      await assertInitialFreezeObservationFence({
        repositoryRoot,
        defaultRef: spec.resolver.defaultRef,
        headSha,
        localDefaultSha,
        indexPaths,
        indexSnapshot: indexReadback,
        expectedIndexTreeSha: snapshot.treeSha,
        allowSemanticIndexDrift: true,
        worktreeFiles: [
          { filePath: manifestFile, expectedBytes: manifestBytes, label: 'manifest' },
          { filePath: pointerFile, expectedBytes: pointerPre, label: 'active pointer' },
          { filePath: rollingPlanFile, expectedBytes: rollingPlanWorktree, label: 'rolling plan' }
        ],
        absentWorktreePaths: projection.retiredManifestPath === null
          ? []
          : [projection.retiredManifestPath]
      });
      return noop.result;
    }
    const built = await buildNextIndex({
      repositoryRoot,
      gitDirectory: indexPaths.gitDirectory,
      indexPath: indexPaths.indexPath,
      targets: [
        { path: input.manifestPath, pre: indexedTargetManifest, bytes: manifestBytes },
        { path: ActivePointerPath, pre: pointerPre, bytes: pointerNext },
        { path: RollingPlanPath, pre: rollingPlanPre, bytes: rollingPlanNext }
      ],
      absentPaths: projection.retiredManifestPath === null
        ? []
        : [projection.retiredManifestPath]
    });
    const operation = createFreezeOperation(built.treeSha, built.bytes);
    const builtConvergence = CodexDevelopmentClassifyFreezeConvergence({
      candidateTreeMatches: built.treeSha === snapshot.treeSha,
      targetManifestMatches: true,
      pointerMatches: pointerWorktree.equals(pointerNext),
      indexedRollingMatches: true,
      worktreeRollingMatches: rollingPlanWorktree.equals(rollingPlanNext),
      retirementSatisfied
    });
    if (builtConvergence === 'semantic-noop') {
      await input.beforeInitialJournalFence?.();
      await assertInitialFreezeObservationFence({
        repositoryRoot,
        defaultRef: spec.resolver.defaultRef,
        headSha,
        localDefaultSha,
        indexPaths,
        indexSnapshot: indexReadback,
        expectedIndexTreeSha: snapshot.treeSha,
        allowSemanticIndexDrift: true,
        worktreeFiles: [
          { filePath: manifestFile, expectedBytes: manifestBytes, label: 'manifest' },
          { filePath: pointerFile, expectedBytes: pointerNext, label: 'active pointer' },
          { filePath: rollingPlanFile, expectedBytes: rollingPlanNext, label: 'rolling plan' }
        ]
      });
      return operation.result;
    }
    await input.beforeInitialJournalFence?.();
    await assertInitialFreezeObservationFence({
      repositoryRoot,
      defaultRef: spec.resolver.defaultRef,
      headSha,
      localDefaultSha,
      indexPaths,
      indexSnapshot: indexReadback,
      expectedIndexTreeSha: snapshot.treeSha,
      allowSemanticIndexDrift: false,
      worktreeFiles: [
        { filePath: manifestFile, expectedBytes: manifestBytes, label: 'manifest' },
        { filePath: pointerFile, expectedBytes: pointerPre, label: 'active pointer' },
        { filePath: rollingPlanFile, expectedBytes: rollingPlanWorktree, label: 'rolling plan' }
      ],
      absentWorktreePaths: projection.retiredManifestPath === null
        ? []
        : [projection.retiredManifestPath]
    });
    const journalBytes = await writeFreezeJournal(
      repositoryRoot,
      existingJournalSnapshot?.bytes ?? null,
      operation.journal,
      durability,
      input.faultAfter
    );
    maybeFault(input.faultAfter, 'after-journal-prepare');
    return advanceFreezeJournal({
      repositoryRoot,
      journal: operation.journal,
      journalBytes,
      faultAfter: input.faultAfter,
      durability,
      deferTerminalRetirement: options.deferTerminalRetirement
    });
  });
}

async function completeDeferredTerminalFreeze(
  input: FreezeDocumentControlPlaneInput,
  expected: CodexDevelopmentFreezeResult,
  deadlineAtUnixMs: number,
  writer: FreezeWriterSettlementObservation
): Promise<CodexDevelopmentFreezeResult> {
  // The terminal journal is a durable boundary. Its retirement has its own
  // bounded owner session and re-observes all authority under the workspace
  // lease; no process allowance is silently renewed inside the writer phase.
  await input.beforeTerminalRetirement?.(writer);
  const { result: completed } = await runFreezeOwner(input, {
    deadlineAtUnixMs, requiredTerminalOperationId: expected.operationId
  });
  if (completed.operationId !== expected.operationId
      || completed.candidateTreeSha !== expected.candidateTreeSha
      || completed.manifestDigest !== expected.manifestDigest) {
    throw new Error('Terminal freeze continuation changed the exact frozen result.');
  }
  return completed;
}

/**
 * Public freeze boundary.  A production caller must never reach the freeze
 * writer without the canonical Git-read issuer: the writer performs both
 * read-only repository census and index/object effects.  Test transport and a
 * composing production operation may provide an already-bound session; a
 * direct production call gets one bounded owner session here.
 */
export async function freezeDocumentControlPlane(
  input: FreezeDocumentControlPlaneInput
): Promise<CodexDevelopmentFreezeResult> {
  if (isDocumentControlHostCliTestSession()
      || currentDocumentControlGitReadSession() !== undefined) {
    return freezeDocumentControlPlaneWithSession(input);
  }
  const deadlineAtUnixMs = Date.now() + ExternalCommandTimeoutMs;
  try {
    const { result, deferred, writer } = await runFreezeOwner(input, { deadlineAtUnixMs });
    return deferred ? await completeDeferredTerminalFreeze(input, result, deadlineAtUnixMs, writer) : result;
  } catch (error) {
    if (error instanceof CodexDevelopmentDocumentControlCliAdmissionError) throw error;
    if (error instanceof GitReadAuthorityError) {
      throw documentControlCliFailure(
        'git',
        'git-read',
        'unavailable',
        error.failure.reason,
        error.failure.detailDigest
      );
    }
    throw error;
  }
}

export async function runDocumentControlPlaneCli(): Promise<void> {
  return withGitHubCredentialBootstrap(process.argv.slice(2), runDocumentControlPlaneCliArguments);
}

async function runDocumentControlPlaneCliArguments(argv: string[]): Promise<void> {
  const request = decodeDocumentControlCommand(argv, process.cwd());
  if (request.command === 'status') {
    const resolved = await resolveLiveControlPlane(request.workspace);
    const output = request.full
      ? resolved
      : projectDocumentControlPlaneStatusCli(resolved);
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    const repository = resolved.repository as { defaultRefState: CodexDevelopmentDefaultRefState };
    const github = resolved.github as { status: string };
    const active = resolved.activeWorkPackage as CodexDevelopmentActiveWorkPackageResolution;
    if (
      repository.defaultRefState !== 'fresh'
      || github.status !== 'resolved'
      || active.state === 'invalid'
      || active.state === 'unresolved'
    ) process.exitCode = 1;
    return;
  }
  // CLI command dispatch selects the operation; freeze rebinds exact main/candidate/manifest authority internally.
  // codeql[js/user-controlled-bypass]
  if (request.command === 'freeze') {
    const { workspace, manifestPath, reviewedOn, proposalOnly } = request;
    const executionRoot = path.resolve(import.meta.dir, '..', '..', '..', '..', '..');
    const freezeDeadlineAtUnixMs = Date.now() + ExternalCommandTimeoutMs;
    const executionDefaultBranch = await admitDocumentControlExecutionRoot({
      executionRoot, deadlineAtUnixMs: freezeDeadlineAtUnixMs
    });

    const requestedWorkspace = realpathSync(path.resolve(workspace));
    const freezeInput = { cwd: requestedWorkspace, manifestPath, reviewedOn,
      proposalOnly };
    const { result, deferred, writer } = await runFreezeOwner(freezeInput, {
      deadlineAtUnixMs: freezeDeadlineAtUnixMs, beforeWriter: async () => {
        await assertDocumentControlCandidateIsolation({
          requestedWorkspace, executionRoot, executionDefaultBranch
        });
      }
    });
    const settled = deferred
      ? await completeDeferredTerminalFreeze(freezeInput, result, freezeDeadlineAtUnixMs, writer)
      : result;
    process.stdout.write(`${JSON.stringify(settled, null, 2)}\n`);
    return;
  }
}

if (import.meta.main) {
  await runDocumentControlPlaneCli();
}
