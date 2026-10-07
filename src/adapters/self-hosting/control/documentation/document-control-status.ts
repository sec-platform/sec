import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { GitReadAuthorityError, withAuthorityGitReadSession } from '../../../providers/git-read/authority.ts';
import {
  type ActiveWorkPackageOwnerObservation,
  issueActiveWorkPackageOwnerObservation
} from '../task/contract/active-work-observation.ts';
import { CodexDevelopmentParseCurrentWorkPackageManifest } from '../task/contract/work-package.ts';
import { projectWorkRollingExactManifestBinding } from '../work-selection/live-contract.ts';
import {
  captureControlIndexSnapshot,
  captureRepositoryIndexTreeThroughExternalScratch,
  type ControlIndexSnapshot
} from './document-control-index.ts';
import { CurrentStatePath, decodeUtf8, type FreezeJournal, shaValue } from './document-control-journal-codec.ts';
import {
  createReadOnlyResolverGit,
  DOCUMENT_CONTROL_STATUS_GIT_READ_BUDGET,
  DocumentControlCliAdmissionError,
  documentControlCliFailure,
  ExternalCommandTimeoutMs,
  isDocumentControlHostCliTestSession,
  observeGitHubControlFacts,
  observeLiveDefaultRef,
  optionalCommandSha,
  type ReadOnlyResolverGit,
  type ReadOnlyResolverGitObserver,
  requireCommand,
  unresolvedGitHubObservation,
  withDocumentControlGitReadSession
} from './document-control-observation.ts';
import {
  type ActiveWorkPackageResolution,
  assertControlPlaneBinding,
  assertRollingMachineBaseBinding,
  type DefaultRefState,
  parseActivePointer,
  parseCurrentStateSpec,
  parseRollingMachineProjection,
  parseRollingPlan,
  projectStatusContinuation,
  resolveActiveWorkPackage,
  resolveWorkSelectionProjectionMode,
  type StatusContinuationInput
} from './document-control-plane-contract.ts';
import {
  effectiveFreezeJournal,
  type FreezeJournalSnapshot,
  readFreezeJournalSnapshot
} from './document-control-recovery.ts';

/**
 * Read-only live status and Active Work Package projection. Observe the same
 * journal/index lifecycle before and after external reads; a racing or unfinished
 * freeze stays unresolved. Output digests and continuation hints do not grant
 * operation authority or replace the underlying owner observations.
 */

function projectObservedStatusContinuation(
  input: Omit<StatusContinuationInput, 'journal'> & Readonly<{
    journal: FreezeJournal | null;
  }>
) {
  return projectStatusContinuation({
    ...input,
    journal: input.journal === null ? null : Object.freeze({
      operationId: input.journal.operationId,
      manifestPath: input.journal.manifestPath,
      reviewedOn: input.journal.reviewedOn,
      baseSha: input.journal.baseSha,
      candidateTreeSha: input.journal.candidateTreeSha,
      proposalOnly: input.journal.authoringDisposition === 'proposal-only',
      phase: input.journal.phase
    })
  });
}

async function resolveActivationBlockedStatus(input: {
  repositoryRoot: string;
  resolverGit: ReadOnlyResolverGit;
  journal: FreezeJournal | null;
  reason: 'activation-in-progress' | 'document-control-authoring-in-progress' | 'activation-observation-raced';
  terminal?: boolean;
  liveDefaultFailure?: string;
}): Promise<Record<string, unknown>> {
  const stateSource = await readFile(path.join(input.repositoryRoot, CurrentStatePath), 'utf8');
  const spec = parseCurrentStateSpec(stateSource);
  const localDefaultShaResult = await input.resolverGit.run(
    ['rev-parse', '--verify', spec.resolver.defaultRef],
    input.repositoryRoot
  );
  const localDefaultSha = localDefaultShaResult.code === 0 ? localDefaultShaResult.stdout.trim() : undefined;
  const liveDefaultRef = await observeLiveDefaultRef({
    repositoryRoot: input.repositoryRoot,
    repository: spec.resolver.repository,
    remote: spec.resolver.remote,
    defaultBranch: spec.resolver.defaultBranch,
    resolverGit: input.resolverGit
  });
  const liveDefaultSha = liveDefaultRef.status === 'observed' ? liveDefaultRef.sha : undefined;
  const defaultRefState: DefaultRefState = localDefaultSha === undefined || liveDefaultSha === undefined
    ? 'unavailable'
    : localDefaultSha === liveDefaultSha ? 'fresh' : 'stale';
  const headSha = requireCommand(
    await input.resolverGit.run(['rev-parse', 'HEAD'], input.repositoryRoot),
    'candidate head resolution'
  );
  const branch = requireCommand(
    await input.resolverGit.run(['branch', '--show-current'], input.repositoryRoot),
    'candidate branch resolution'
  )
    || '(detached)';
  const mergeBase = defaultRefState === 'fresh'
    ? requireCommand(
        await input.resolverGit.run(['merge-base', localDefaultSha!, headSha], input.repositoryRoot),
        'candidate merge-base resolution'
      )
    : undefined;
  return {
    schema: 'sec-resolved-current-state-v1',
    observedAt: new Date().toISOString(),
    source: CurrentStatePath,
    repository: {
      fullName: spec.resolver.repository,
      defaultBranch: spec.resolver.defaultBranch,
      localDefaultSha,
      liveDefaultSha,
      ...(liveDefaultRef.status === 'unresolved' ? { liveDefaultFailure: liveDefaultRef.reason } : {}),
      defaultRefState,
      tree: undefined,
      ...(input.liveDefaultFailure === undefined ? {} : { liveDefaultFailure: input.liveDefaultFailure })
    },
    workspace: {
      headSha,
      branch,
      mergeBase,
      candidateTreeSha: null,
      status: 'activation observation blocked; worktree status intentionally not observed'
    },
    github: {
      status: 'unresolved',
      reason: input.reason === 'activation-in-progress'
        ? 'GitHub observation skipped while activation is nonterminal'
        : input.reason === 'document-control-authoring-in-progress'
        ? 'GitHub observation skipped while proposal authoring is nonterminal'
        : 'GitHub observation skipped because activation changed during status resolution'
    },
    activeWorkPackage: { state: 'unresolved', reason: input.reason },
    continuation: projectObservedStatusContinuation({
      repositoryRoot: input.repositoryRoot,
      headSha,
      candidateTreeSha: null,
      defaultRefState,
      activeWorkPackage: { state: 'unresolved', reason: input.reason },
      pointerManifest: null,
      changes: null,
      journal: input.journal
    }),
    activation: input.journal === null ? null : {
      operationId: input.journal.operationId,
      phase: input.journal.phase,
      terminal: input.terminal ?? input.journal.phase === 'terminal'
    },
    stableFacts: spec.stableFacts
  };
}

function journalObservationIdentity(snapshot: FreezeJournalSnapshot | null): string | null {
  if (snapshot === null) return null;
  const journal = effectiveFreezeJournal(snapshot)!;
  return `${journal.operationId}\0${journal.phase}\0${snapshot.canonicalPresent ? 'canonical' : 'recovery'}\0${snapshot.recovery?.completionMode ?? 'none'}`;
}

function freezeJournalActivationInProgress(snapshot: FreezeJournalSnapshot | null): boolean {
  const journal = effectiveFreezeJournal(snapshot);
  return snapshot !== null && (
    journal!.phase !== 'terminal'
    || snapshot.recovery?.completionMode === 'canonical-install-required'
    || snapshot.recovery?.completionMode === 'active-next-retirement-required'
  );
}

function freezeJournalInProgressReason(
  journal: FreezeJournal | null
): 'activation-in-progress' | 'document-control-authoring-in-progress' {
  return journal?.authoringDisposition === 'proposal-only'
    ? 'document-control-authoring-in-progress'
    : 'activation-in-progress';
}

type ResolveLiveControlPlaneOptions = Readonly<{
  observeGitHub?: boolean;
  /** Deterministic contract-test seam for the journal/snapshot double-read race. */
  afterIndexSnapshot?: () => Promise<void> | void;
  /** Deterministic contract-test seam for exact-SHA/index/ref readback races. */
  beforeObservationReadback?: () => Promise<void> | void;
  /** Deterministic contract-test seam between anchored residue census reads. */
  beforeJournalRecoveryCensusReadback?: () => Promise<void> | void;
  /** Deterministic contract-test observation of the final read-only Git child environment. */
  resolverGitCommandObserver?: ReadOnlyResolverGitObserver;
}>;

export async function resolveLiveControlPlane(
  cwd: string,
  options: ResolveLiveControlPlaneOptions = {}
): Promise<Record<string, unknown>> {
  if (isDocumentControlHostCliTestSession()) {
    return resolveLiveControlPlaneWithGitReadSession(cwd, options);
  }
  try {
    const absoluteDeadline = Date.now() + ExternalCommandTimeoutMs;
    return await withAuthorityGitReadSession({
      cwd: path.resolve(cwd),
      budget: DOCUMENT_CONTROL_STATUS_GIT_READ_BUDGET,
      deadlineAtUnixMs: absoluteDeadline
    }, (session) => withDocumentControlGitReadSession(
      session,
      () => resolveLiveControlPlaneWithGitReadSession(cwd, options)
    ));
  } catch (error) {
    if (error instanceof DocumentControlCliAdmissionError) throw error;
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

function strictRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be one object.`);
  }
  return value as Record<string, unknown>;
}

function strictNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value || value.includes('\0')) {
    throw new Error(`${label} must be one non-empty trimmed string.`);
  }
  return value;
}

function strictOptionalSha(value: unknown, label: string): string | null {
  if (value === undefined || value === null) return null;
  const result = strictNonEmptyString(value, label);
  if (!/^[0-9a-f]{40}$/u.test(result)) throw new Error(`${label} must be one lowercase Git SHA.`);
  return result;
}

function issueActiveWorkObservation(
  resolved: Readonly<Record<string, unknown>>
): ActiveWorkPackageOwnerObservation {
  const repository = strictRecord(resolved.repository, 'Resolved repository');
  const workspace = strictRecord(resolved.workspace, 'Resolved workspace');
  const active = strictRecord(resolved.activeWorkPackage, 'Resolved active Work Package');
  const repositoryName = strictNonEmptyString(repository.fullName, 'Resolved repository.fullName');
  const defaultBranch = strictNonEmptyString(repository.defaultBranch, 'Resolved repository.defaultBranch');
  const observedAt = strictNonEmptyString(resolved.observedAt, 'Resolved observedAt');
  if (!Number.isFinite(Date.parse(observedAt))) {
    throw new Error('Resolved observedAt must be one ISO timestamp.');
  }
  const localDefaultSha = strictOptionalSha(repository.localDefaultSha, 'Resolved repository.localDefaultSha');
  const liveDefaultSha = strictOptionalSha(repository.liveDefaultSha, 'Resolved repository.liveDefaultSha');
  const state = active.state;
  if (state !== 'active' && state !== 'none' && state !== 'invalid' && state !== 'unresolved') {
    throw new Error('Resolved active Work Package state is invalid.');
  }
  const defaultSha = localDefaultSha !== null && localDefaultSha === liveDefaultSha
    ? localDefaultSha
    : null;
  let branch: string | null = null;
  let manifest: string | null = null;
  let reason: string | null = null;
  if (state === 'active') {
    if (repository.defaultRefState !== 'fresh' || defaultSha === null) {
      throw new Error('Active Work Package observation requires one fresh exact default ref.');
    }
    branch = strictNonEmptyString(workspace.branch, 'Resolved active Work Package branch');
    if (branch === '(detached)' || branch === defaultBranch) {
      throw new Error('Active Work Package branch must be one non-default candidate branch.');
    }
    manifest = strictNonEmptyString(active.manifest, 'Resolved active Work Package manifest');
  } else {
    reason = strictNonEmptyString(active.reason, 'Resolved active Work Package reason');
    if (typeof repository.liveDefaultFailure === 'string' && repository.liveDefaultFailure.length > 0) {
      reason += `: ${repository.liveDefaultFailure}`;
    }
    if (state === 'none' && (repository.defaultRefState !== 'fresh' || defaultSha === null)) {
      throw new Error('No-active-work observation requires one fresh exact default ref.');
    }
  }
  return issueActiveWorkPackageOwnerObservation({
    repository: repositoryName,
    defaultBranch,
    defaultSha,
    observedAt,
    state,
    branch,
    manifest,
    reason
  });
}

/**
 * Runs the documentation owner's live resolver and emits the sole opaque
 * active-work observation accepted by production branch-lifecycle composition.
 */
export async function observeActiveWorkPackage(
  cwd: string
): Promise<ActiveWorkPackageOwnerObservation> {
  return issueActiveWorkObservation(await resolveLiveControlPlane(cwd, { observeGitHub: false }));
}

async function resolveLiveControlPlaneWithGitReadSession(
  cwd: string,
  options: ResolveLiveControlPlaneOptions
): Promise<Record<string, unknown>> {
  const resolverGit = createReadOnlyResolverGit(options.resolverGitCommandObserver);
  const repositoryRoot = requireCommand(
    await resolverGit.run(['rev-parse', '--show-toplevel'], cwd),
    'git repository discovery'
  );
  const activationJournalSnapshot = await readFreezeJournalSnapshot(
    repositoryRoot,
    options.beforeJournalRecoveryCensusReadback
  );
  const activationJournal = effectiveFreezeJournal(activationJournalSnapshot);
  if (freezeJournalActivationInProgress(activationJournalSnapshot)) {
    return resolveActivationBlockedStatus({
      repositoryRoot,
      resolverGit,
      journal: activationJournal,
      reason: freezeJournalInProgressReason(activationJournal),
      terminal: false
    });
  }
  let snapshot: ControlIndexSnapshot;
  try {
    snapshot = await captureControlIndexSnapshot(repositoryRoot, { resolverGit, observeMachineStatus: true });
  } catch (error) {
    const racedJournalSnapshot = await readFreezeJournalSnapshot(
      repositoryRoot,
      options.beforeJournalRecoveryCensusReadback
    );
    const racedJournal = effectiveFreezeJournal(racedJournalSnapshot);
    if (freezeJournalActivationInProgress(racedJournalSnapshot)) {
      return resolveActivationBlockedStatus({
        repositoryRoot,
        resolverGit,
        journal: racedJournal,
        reason: freezeJournalInProgressReason(racedJournal),
        terminal: false
      });
    }
    throw error;
  }
  await options.afterIndexSnapshot?.();
  const spec = parseCurrentStateSpec(snapshot.stateSource);
  const pointer = parseActivePointer(snapshot.pointerSource);
  const rollingPlan = parseRollingPlan(snapshot.rollingPlanSource);
  const rollingMachine = parseRollingMachineProjection(snapshot.rollingPlanSource);
  const rollingManifestBinding = rollingMachine === null
    ? null
    : projectWorkRollingExactManifestBinding(rollingMachine);
  assertControlPlaneBinding({ spec, pointer });
  if (rollingPlan.activePackageId !== path.posix.basename(pointer.manifest, '.md')) {
    throw new Error('Immutable index pointer and rolling plan select different Work Packages.');
  }
  if (resolveWorkSelectionProjectionMode(spec) === 'required-v1'
      && rollingMachine === null) {
    throw new Error('Required rolling projection is absent.');
  }
  if (rollingManifestBinding !== null
      && (rollingManifestBinding.active.manifestPath !== pointer.manifest
        || rollingManifestBinding.active.manifestDigest !== pointer.manifestDigest)) {
    throw new Error('Rolling machine projection does not bind the exact active pointer manifest.');
  }

  const localDefaultShaResult = await resolverGit.run(
    ['rev-parse', '--verify', spec.resolver.defaultRef],
    repositoryRoot
  );
  const localDefaultSha = optionalCommandSha(localDefaultShaResult, 'Local default ref');
  const liveDefaultRef = await observeLiveDefaultRef({
    repositoryRoot,
    repository: spec.resolver.repository,
    remote: spec.resolver.remote,
    defaultBranch: spec.resolver.defaultBranch,
    resolverGit
  });
  const liveDefaultSha = liveDefaultRef.status === 'observed' ? liveDefaultRef.sha : undefined;
  const defaultRefState: DefaultRefState = (
    localDefaultSha === undefined || liveDefaultSha === undefined
      ? 'unavailable'
      : localDefaultSha === liveDefaultSha
        ? 'fresh'
        : 'stale'
  );

  const candidateManifestBlob = snapshot.candidateManifestBlob;
  const defaultManifestBlob = defaultRefState === 'fresh'
    ? await resolverGit.readBlob(repositoryRoot, `${localDefaultSha}:${pointer.manifest}`) ?? null
    : null;
  const activeWorkPackage: ActiveWorkPackageResolution =
    resolveActiveWorkPackage({
      pointer,
      candidateManifestBlob,
      defaultManifestBlob,
      defaultRefState
    });
  if (activeWorkPackage.state === 'active'
      && candidateManifestBlob !== undefined
      && rollingManifestBinding !== null) {
    const candidateManifest = CodexDevelopmentParseCurrentWorkPackageManifest(
      decodeUtf8(candidateManifestBlob, 'Rolling transition active manifest'),
      pointer.manifest
    );
    if (candidateManifest.id !== rollingManifestBinding.active.packageId
        || candidateManifest.tracking !== rollingManifestBinding.active.tracking) {
      throw new Error('Rolling machine projection does not bind the exact active manifest identity.');
    }
  }
  const mainTree = defaultRefState === 'fresh'
    ? shaValue(
        requireCommand(
          await resolverGit.run(['rev-parse', `${localDefaultSha}^{tree}`], repositoryRoot),
          'default-branch tree resolution'
        ),
        'Default-branch tree'
      )
    : undefined;
  // A rolling projection binds the default revision only while its manifest is
  // prospective. Once the exact manifest blob is published on default, the
  // projection is immutable transition history; requiring it to bind the
  // post-merge commit would make every successful publication self-lock the
  // resolver before it can reorient on the new main.
  if (activeWorkPackage.state === 'active'
      && rollingMachine !== null
      && localDefaultSha !== undefined
      && mainTree !== undefined) {
    assertRollingMachineBaseBinding({
      projection: rollingMachine,
      exactMain: localDefaultSha,
      exactMainTree: mainTree
    });
  }
  const headSha = shaValue(
    requireCommand(await resolverGit.run(['rev-parse', 'HEAD'], repositoryRoot), 'candidate head resolution'),
    'Candidate HEAD'
  );
  const branch = requireCommand(
    await resolverGit.run(['branch', '--show-current'], repositoryRoot),
    'candidate branch resolution'
  ) || '(detached)';
  const mergeBase = defaultRefState === 'fresh'
    ? shaValue(
        requireCommand(
          await resolverGit.run(['merge-base', localDefaultSha!, headSha], repositoryRoot),
          'candidate merge-base resolution'
        ),
        'Candidate merge-base'
      )
    : undefined;
  const worktreeStatus = snapshot.worktreeStatus;
  const observeGitHub = options.observeGitHub !== false;
  const githubState = observeGitHub
    ? await observeGitHubControlFacts(repositoryRoot, spec.resolver.repository)
    : unresolvedGitHubObservation('GitHub observation skipped while activation is nonterminal');

  await options.beforeObservationReadback?.();
  let indexTreeReadback: string | null = null;
  try {
    ({ treeSha: indexTreeReadback } = await captureRepositoryIndexTreeThroughExternalScratch({
      repositoryRoot,
      resolverGit
    }));
  } catch (error) {
    if (error instanceof DocumentControlCliAdmissionError
        || error instanceof GitReadAuthorityError) throw error;
    indexTreeReadback = null;
  }
  const headReadbackResult = await resolverGit.run(['rev-parse', 'HEAD'], repositoryRoot);
  const localDefaultReadbackResult = await resolverGit.run(
    ['rev-parse', '--verify', spec.resolver.defaultRef],
    repositoryRoot
  );
  const headShaReadback = optionalCommandSha(headReadbackResult, 'Candidate HEAD readback');
  const localDefaultShaReadback = optionalCommandSha(localDefaultReadbackResult, 'Local default ref readback');
  const liveDefaultRefReadback = await observeLiveDefaultRef({
    repositoryRoot,
    repository: spec.resolver.repository,
    remote: spec.resolver.remote,
    defaultBranch: spec.resolver.defaultBranch,
    resolverGit
  });
  const liveDefaultShaReadback = liveDefaultRefReadback.status === 'observed' ? liveDefaultRefReadback.sha : undefined;
  // The journal is the seqlock: document-control authoring publishes it before any index/worktree
  // effect, so this read must be the final volatile observation in the fence.
  const activationJournalReadbackSnapshot = await readFreezeJournalSnapshot(
    repositoryRoot,
    options.beforeJournalRecoveryCensusReadback
  );
  const activationJournalReadback = effectiveFreezeJournal(activationJournalReadbackSnapshot);
  if (freezeJournalActivationInProgress(activationJournalReadbackSnapshot)) {
    return resolveActivationBlockedStatus({
      repositoryRoot,
      resolverGit,
      journal: activationJournalReadback,
      reason: freezeJournalInProgressReason(activationJournalReadback),
      terminal: false
    });
  }
  if (journalObservationIdentity(activationJournalReadbackSnapshot)
      !== journalObservationIdentity(activationJournalSnapshot)) {
    return resolveActivationBlockedStatus({
      repositoryRoot,
      resolverGit,
      journal: activationJournalReadback,
      reason: 'activation-observation-raced'
    });
  }
  if (
    indexTreeReadback !== snapshot.treeSha
    || headShaReadback !== headSha
    || localDefaultShaReadback !== localDefaultSha
    || liveDefaultShaReadback !== liveDefaultSha
  ) {
    return resolveActivationBlockedStatus({
      repositoryRoot,
      resolverGit,
      journal: activationJournalReadback,
      reason: 'activation-observation-raced',
      ...(liveDefaultRef.status === 'unresolved' ? { liveDefaultFailure: liveDefaultRef.reason }
        : liveDefaultRefReadback.status === 'unresolved' ? { liveDefaultFailure: liveDefaultRefReadback.reason } : {})
    });
  }

  return {
    schema: 'sec-resolved-current-state-v1',
    observedAt: new Date().toISOString(),
    source: 'config/repository/current-state.yaml',
    repository: {
      fullName: spec.resolver.repository,
      defaultBranch: spec.resolver.defaultBranch,
      localDefaultSha,
      liveDefaultSha,
      ...(liveDefaultRef.status === 'unresolved' ? { liveDefaultFailure: liveDefaultRef.reason } : {}),
      defaultRefState,
      tree: mainTree
    },
    workspace: {
      headSha,
      branch,
      mergeBase,
      candidateTreeSha: snapshot.treeSha,
      status: worktreeStatus
    },
    github: githubState,
    activeWorkPackage,
    continuation: projectObservedStatusContinuation({
      repositoryRoot,
      headSha,
      candidateTreeSha: snapshot.treeSha,
      defaultRefState,
      activeWorkPackage,
      pointerManifest: pointer.manifest,
      changes: snapshot.machineStatus,
      journal: activationJournalReadback
    }),
    activation: activationJournalReadback === null ? null : {
      operationId: activationJournalReadback.operationId,
      phase: activationJournalReadback.phase,
      terminal: activationJournalReadback.phase === 'terminal'
    },
    stableFacts: spec.stableFacts
  };
}
