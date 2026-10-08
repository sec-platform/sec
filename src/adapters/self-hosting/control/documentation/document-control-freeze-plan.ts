import path from 'node:path';
import {
  CodexDevelopmentParseCurrentWorkPackageManifest,
  CodexDevelopmentWorkPackageManifestDigest
} from '../task/contract/work-package.ts';
import { assertRoadmapTerminalCompactionCandidate } from '../work-selection/live-contract.ts';
import {
  assertCommittedCandidateReplanAuthority,
  assertNoUnrelatedStagedChanges
} from './document-control-admission.ts';
import { captureControlIndexSnapshot } from './document-control-index.ts';
import {
  ActivePointerPath,
  CurrentStatePath,
  decodeUtf8,
  freezeIndexTransportDigest,
  type FreezeJournal,
  FreezeJournalSchema,
  freezeOperationId,
  type FreezeResult,
  FreezeResultSchema,
  LegacyFreezeJournalSchema,
  LegacyFreezeResultSchema,
  RollingPlanPath,
  shaValue,
  toBase64
} from './document-control-journal-codec.ts';
import {
  observeCommittedCandidateProjectionSourceTreeDelta,
  observeDocumentControlWorkRouting,
  readControlTreeBlobs,
  readGitBlob,
  requireCommand,
  requireControlBlob,
  requireGitBlob,
  run
} from './document-control-observation.ts';
import {
  assertControlPlaneBinding,
  assertPriorFreezeProjection,
  classifyPublishedControlBinding,
  createFreezeProjection,
  type MainHealthRepairProjection,
  parseActivePointer,
  parseCurrentStateSpec,
  parseRollingMachineProjection,
  parseRollingPlan,
  parseRollingPlanHeadings,
  requiresCommittedCandidateProjectionRefresh,
  resolveActiveWorkPackage,
  resolveWorkSelectionProjectionMode,
  type WorkSelectionProjection
} from './document-control-plane-contract.ts';
import { assertRegularRepositoryFile, inspectSafePath, readSafeRegularFile } from './document-control-publication.ts';

/**
 * Freeze planning composes immutable source, admitted selection and exact candidate
 * bytes. It delegates projection semantics to the existing contract and native
 * index capture to its custody owner. The operation owner retains publication,
 * observation fences and settlement; this plan is not a second control authority.
 */

/**
 * Observe and compile the exact HEAD/index/worktree control inputs. This runs
 * inside the caller's retained Git session and workspace lease. The result is
 * a plan, never publication authority: the owner still fences live main, the
 * retained index PRE and worktree bytes before creating any journal.
 */
export async function prepareDocumentControlFreezePlan(input: Readonly<{
  repositoryRoot: string;
  manifestPath: string;
  reviewedOn: string;
  proposalOnly?: boolean;
  manifestBytes: Buffer;
}>) {
  const { repositoryRoot, manifestBytes } = input;
  const headSha = shaValue(
    requireCommand(await run('git', ['rev-parse', 'HEAD'], repositoryRoot), 'Candidate HEAD'),
    'Candidate HEAD'
  );
  const headControls = await readControlTreeBlobs(repositoryRoot, headSha, [CurrentStatePath, ActivePointerPath, RollingPlanPath]);
  const headStateBytes = requireControlBlob(headControls, CurrentStatePath, 'Immutable candidate current-state authority');
  const spec = parseCurrentStateSpec(
    decodeUtf8(headStateBytes, 'Immutable candidate current-state authority')
  );
  const localDefaultSha = shaValue(
    requireCommand(
      await run('git', ['rev-parse', '--verify', spec.resolver.defaultRef], repositoryRoot),
      'Local default ref'
    ),
    'Local default ref'
  );
  const baseTreeSha = shaValue(
    requireCommand(await run('git', ['rev-parse', `${localDefaultSha}^{tree}`], repositoryRoot), 'Base tree'),
    'Base tree'
  );
  const committedCandidateReplanAuthority = headSha === localDefaultSha
    ? undefined
    : await assertCommittedCandidateReplanAuthority({
      repositoryRoot,
      headSha,
      trustedDefaultSha: localDefaultSha,
      trustedDefaultTree: baseTreeSha,
      manifestPath: input.manifestPath
    });
  const defaultStateBytes = headSha === localDefaultSha ? headStateBytes : await requireGitBlob(
    repositoryRoot,
    `${localDefaultSha}:${CurrentStatePath}`,
    'Trusted default current-state authority'
  );
  const defaultSpec = parseCurrentStateSpec(
    decodeUtf8(defaultStateBytes, 'Trusted default current-state authority')
  );
  const workSelectionProjectionMode = resolveWorkSelectionProjectionMode(
    defaultSpec
  );

  // This complete local authority preflight uses an external object directory;
  // no repository object, index, journal, or control publication is permitted
  // before both it and the sole live-default admission have succeeded.
  const headPointerSource = decodeUtf8(requireControlBlob(headControls, ActivePointerPath,
    'Immutable candidate active pointer preflight'), 'Immutable candidate active pointer preflight');
  const headPointer = parseActivePointer(headPointerSource);
  const targets = Object.freeze([...new Set([
    input.manifestPath,
    headPointer.manifest,
    ActivePointerPath,
    RollingPlanPath,
    ...(workSelectionProjectionMode === 'required-v1' ? ['config/repository/work-selection.md'] : [])
  ])]);
  const targetSet = new Set<string>(targets);
  const snapshot = await captureControlIndexSnapshot(repositoryRoot, {
    targetManifestPath: input.manifestPath,
    stagedBaseSha: headSha,
    requiredStageZeroPaths: targets
  });
  if (!snapshot.stateBytes.equals(headStateBytes)) {
    throw new Error('Document control freeze rejects staged current-state authority bytes.');
  }
  const pointer = parseActivePointer(snapshot.pointerSource);
  assertControlPlaneBinding({ spec, pointer });
  const rolling = parseRollingPlan(snapshot.rollingPlanSource);
  if (rolling.activePackageId !== path.posix.basename(pointer.manifest, '.md')) {
    throw new Error('The immutable index pointer and rolling plan select different Work Packages.');
  }
  const immutablePointerSource = headPointerSource;
  const immutableRollingPlanSource = decodeUtf8(requireControlBlob(headControls, RollingPlanPath,
    'Immutable candidate rolling plan'), 'Immutable candidate rolling plan');
  const immutablePointer = parseActivePointer(immutablePointerSource);
  assertControlPlaneBinding({ spec, pointer: immutablePointer });
  const immutableRolling = committedCandidateReplanAuthority !== undefined
      && workSelectionProjectionMode === 'required-v1'
    ? parseRollingPlanHeadings(immutableRollingPlanSource)
    : parseRollingPlan(immutableRollingPlanSource);
  if (immutableRolling.activePackageId !== path.posix.basename(immutablePointer.manifest, '.md')) {
    throw new Error('Immutable HEAD pointer and rolling plan do not bind one selection baseline.');
  }
  const immutableCurrentManifestBytes = await requireGitBlob(
    repositoryRoot,
    `${headSha}:${immutablePointer.manifest}`,
    'Immutable candidate current Work Package manifest'
  );
  const immutableCurrentDefaultManifestBlob = await readGitBlob(
    repositoryRoot,
    `${localDefaultSha}:${immutablePointer.manifest}`
  ) ?? null;
  const immutableCurrentResolution = resolveActiveWorkPackage({
    pointer: immutablePointer,
    candidateManifestBlob: immutableCurrentManifestBytes,
    defaultManifestBlob: immutableCurrentDefaultManifestBlob,
    defaultRefState: 'fresh'
  });

  // A successor freeze may stage deletion of the old pointer-bound manifest.
  // Its immutable HEAD bytes remain the semantic PRE image; absence from the
  // candidate index is the demanded retirement Effect, not missing authority.
  const currentManifestBlob = snapshot.candidateManifestBlob
    ?? immutableCurrentManifestBytes;
  const currentDefaultManifestBlob = await readGitBlob(
    repositoryRoot,
    `${localDefaultSha}:${pointer.manifest}`
  ) ?? null;
  const currentResolution = resolveActiveWorkPackage({
    pointer,
    candidateManifestBlob: currentManifestBlob,
    defaultManifestBlob: currentDefaultManifestBlob,
    defaultRefState: 'fresh'
  });
  const repairableCommittedCandidateDigestDrift = committedCandidateReplanAuthority !== undefined
    && currentResolution.state === 'invalid'
    && currentResolution.reason === 'candidate-digest-mismatch';
  if (currentResolution.state === 'unresolved'
      || (currentResolution.state === 'invalid' && !repairableCommittedCandidateDigestDrift)) {
    throw new Error('Current active Work Package control plane is not resolvable before freeze.');
  }
  if (input.proposalOnly === true
      && (immutableCurrentResolution.state !== 'none'
        || immutableCurrentDefaultManifestBlob === null)) {
    throw new Error(
      'Proposal-only freeze requires a published current pointer manifest and no active Work Package.'
    );
  }

  assertNoUnrelatedStagedChanges(snapshot.stagedPaths, targetSet);
  const pointerFile = await assertRegularRepositoryFile(repositoryRoot, ActivePointerPath);
  const rollingPlanFile = await assertRegularRepositoryFile(repositoryRoot, RollingPlanPath);
  const pointerPre = Buffer.from(snapshot.pointerBytes);
  const rollingPlanPre = Buffer.from(snapshot.rollingPlanBytes);
  const [pointerWorktree, rollingPlanWorktree] = await Promise.all([
    readSafeRegularFile({
      boundaryRoot: repositoryRoot,
      filePath: pointerFile,
      label: 'Active pointer'
    }),
    readSafeRegularFile({
      boundaryRoot: repositoryRoot,
      filePath: rollingPlanFile,
      label: 'Rolling plan'
    })
  ]);
  if (!pointerWorktree.equals(pointerPre)) {
    throw new Error('Active pointer worktree bytes differ from the immutable index PRE image.');
  }
  const indexedTargetManifest = snapshot.targetManifestBlob;
  const defaultTargetManifest = input.manifestPath === pointer.manifest
    ? currentDefaultManifestBlob ?? undefined
    : await readGitBlob(repositoryRoot, `${localDefaultSha}:${input.manifestPath}`);
  const immutableRollingMachine = parseRollingMachineProjection(
    immutableRollingPlanSource
  );
  const publishedBinding = classifyPublishedControlBinding({
    authorityProven: committedCandidateReplanAuthority !== undefined,
    historicalBaseIsLiveDefault: immutableRollingMachine?.exactMain === localDefaultSha,
    pointerBindsDefault: defaultTargetManifest !== undefined
      && CodexDevelopmentWorkPackageManifestDigest(defaultTargetManifest) === immutablePointer.manifestDigest,
    pointerBindsHistoricalRolling:
      immutableRollingMachine?.schema === 'sec-work-rolling-transition-projection-v1'
      && immutableRollingMachine.active.manifestDigest === immutablePointer.manifestDigest,
    publishedTargetPresent: defaultTargetManifest !== undefined,
    rollingTransition: immutableRollingMachine?.schema === 'sec-work-rolling-transition-projection-v1'
  });
  if (publishedBinding.kind === 'blocked') {
    throw new Error(`Published Work Package binding is blocked: ${publishedBinding.reason}.`);
  }

  const indexedControlMatchesImmutableHead = snapshot.pointerSource === immutablePointerSource
    && snapshot.rollingPlanSource === immutableRollingPlanSource;
  let indexedControlMatchesPriorProjection = false;
  let priorProjectionFailure: unknown;
  if (!indexedControlMatchesImmutableHead && indexedTargetManifest !== undefined) {
    try {
      assertPriorFreezeProjection({
        spec,
        immutableRollingPlanSource,
        pointerSource: snapshot.pointerSource,
        rollingPlanSource: snapshot.rollingPlanSource,
        manifestPath: input.manifestPath,
        manifestBytes: indexedTargetManifest,
        baseSha: localDefaultSha,
        baseTreeSha
      });
      indexedControlMatchesPriorProjection = true;
    } catch (error) {
      priorProjectionFailure = error;
    }
  }
  if (!indexedControlMatchesImmutableHead && !indexedControlMatchesPriorProjection) {
    throw new Error(
      'Staged control PRE must equal immutable HEAD or retain its exact immutable selection topology.',
      { cause: priorProjectionFailure }
    );
  }

  const requestedRollingPlanSource = rollingPlanWorktree.equals(rollingPlanPre)
    ? indexedControlMatchesPriorProjection
        && parseRollingMachineProjection(snapshot.rollingPlanSource) === null
      ? snapshot.rollingPlanSource
      : undefined
    : decodeUtf8(rollingPlanWorktree, 'Requested rolling-plan projection');
  const targetManifest = CodexDevelopmentParseCurrentWorkPackageManifest(
    decodeUtf8(manifestBytes, 'Work Package manifest'),
    input.manifestPath
  );
  const targetManifestDigest = CodexDevelopmentWorkPackageManifestDigest(
    manifestBytes
  ) as `sha256:${string}`;
  const committedCandidateProjectionRefreshRequired = workSelectionProjectionMode === 'required-v1'
    && committedCandidateReplanAuthority !== undefined
    && targetManifest.id === immutableRolling.activePackageId
    && requiresCommittedCandidateProjectionRefresh({
      projection: parseRollingMachineProjection(immutableRollingPlanSource),
      exactMain: localDefaultSha,
      exactMainTree: baseTreeSha,
      active: {
        packageId: targetManifest.id,
        tracking: targetManifest.tracking,
        manifestPath: input.manifestPath,
        manifestDigest: targetManifestDigest
      },
      sourceTreeDeltaPaths: await observeCommittedCandidateProjectionSourceTreeDelta({
        repositoryRoot,
        currentTree: committedCandidateReplanAuthority.sourceTree,
        rollingPlanSource: immutableRollingPlanSource
      }),
      permittedProjectionDeltaPaths: targetSet
    });
  // This delta is projection-freshness input, not Work Package scope authority.
  // A non-projection path forces a new digest-bound projection; the Work Package
  // Gate independently owns whether that candidate path is permitted at all.
  let workSelectionProjection: WorkSelectionProjection | undefined;
  let mainHealthRepairProjection: MainHealthRepairProjection | undefined;
  if (targetManifest.id !== immutableRolling.activePackageId
      && input.proposalOnly !== true
      && workSelectionProjectionMode === 'required-v1') {
    const candidateBranch = requireCommand(
      await run('git', ['branch', '--show-current'], repositoryRoot),
      'WorkDecision candidate branch'
    );
    if (candidateBranch.length === 0 || candidateBranch === spec.resolver.defaultBranch) {
      throw new Error('A new WorkDecision-selected package requires one non-default candidate branch.');
    }
    const { repairDecision, selection } = await observeDocumentControlWorkRouting({
      repositoryRoot,
      repository: spec.resolver.repository,
      defaultBranch: spec.resolver.defaultBranch,
      exactMainSha: localDefaultSha,
      exactMainTreeSha: baseTreeSha
    });
    if (repairDecision.routingState === 'repair-only') {
      if (currentResolution.state !== 'none'
          || currentDefaultManifestBlob === null
          || repairDecision.status !== 'repair-ready'
          || repairDecision.binding === null
          || repairDecision.binding.manifestPath !== input.manifestPath) {
        throw new Error(
          `MainHealth repair projection is unavailable, stale, or conflicts with an active package (${repairDecision.reasonCode}).`
        );
      }
      mainHealthRepairProjection = Object.freeze({
        decision: repairDecision,
        publishedActivePackage: Object.freeze({
          manifestPath: pointer.manifest,
          manifestDigest: pointer.manifestDigest,
          defaultManifestBytes: currentDefaultManifestBlob
        })
      });
    } else if (repairDecision.routingState === 'locked') {
      throw new Error(
        `MainHealth locks ordinary selection and repair (${repairDecision.reasonCode}).`
      );
    } else {
      if (selection === null) {
        throw new Error('Ordinary MainHealth routing did not produce one WorkDecision observation.');
      }
      if (selection.status !== 'resolved') {
        throw new Error(
          `WorkDecision observation is unresolved (${selection.reasonCodes.join(',')}): `
          + selection.blockerRefs.join(',')
        );
      }
      const decision = selection.receipt.decision;
      if (selection.terminalCompaction !== null) {
        const candidateRoadmap = snapshot.roadmapBlob;
        assertRoadmapTerminalCompactionCandidate({
          compaction: selection.terminalCompaction,
          roadmapSource: candidateRoadmap === undefined
            ? ''
            : decodeUtf8(candidateRoadmap, 'Candidate roadmap terminal compaction'),
          presentDelayedManifestPaths: selection.terminalCompaction.delayedManifestRetirementPaths
            .filter((manifestPath) => snapshot.indexPaths.includes(manifestPath))
        });
      }
      const selectedCatalogItem = selection.receipt.catalog.items.find(
        ({ workId }) => workId === decision.selectedWorkId
      );
      if (decision.status !== 'select-next'
          || selectedCatalogItem === undefined
          || selectedCatalogItem.packageId !== targetManifest.id
          || selectedCatalogItem.tracking !== targetManifest.tracking) {
        throw new Error(
          'Target manifest is not the exact package selected by the live WorkDecision: '
          + `decision=${decision.status}/${decision.selectedWorkId ?? 'none'}, `
          + `target=${targetManifest.id}/${targetManifest.tracking}, `
          + `current=${selection.receipt.input.current.activeState}/`
          + `${selection.receipt.input.current.closeoutState}.`
        );
      }
      workSelectionProjection = Object.freeze({ receipt: selection.receipt });
    }
  }
  const projection = createFreezeProjection({
    spec,
    currentPointerSource: immutablePointerSource,
    currentRollingPlanSource: immutableRollingPlanSource,
    currentManifestBytes: immutableCurrentManifestBytes,
    requestedRollingPlanSource,
    workSelectionProjection,
    mainHealthRepairProjection,
    proposalOnly: input.proposalOnly === true
      ? {
          currentResolution: immutableCurrentResolution,
          defaultManifestBytes: immutableCurrentDefaultManifestBlob!
        }
      : undefined,
    committedCandidateReplanProjection: workSelectionProjectionMode === 'required-v1'
      && committedCandidateReplanAuthority !== undefined
      && targetManifest.id === immutableRolling.activePackageId
      && (
        committedCandidateProjectionRefreshRequired
        ||
        CodexDevelopmentWorkPackageManifestDigest(manifestBytes)
          !== immutablePointer.manifestDigest
        || (
          requestedRollingPlanSource !== undefined
          && requestedRollingPlanSource !== immutableRollingPlanSource
        )
      )
      ? committedCandidateReplanAuthority
      : undefined,
    manifestPath: input.manifestPath,
    manifestBytes,
    baseSha: localDefaultSha,
    baseTreeSha,
    reviewedOn: input.reviewedOn
  });
  if (projection.retiredManifestPath === null) {
    if (snapshot.candidateManifestBlob === undefined) {
      throw new Error('Same-package freeze cannot retire its pointer-bound manifest.');
    }
  } else {
    const indexedRetiredManifestPresent = snapshot.indexPaths.includes(
      projection.retiredManifestPath
    );
    if (projection.retiredManifestPath !== immutablePointer.manifest) {
      throw new Error('Successor freeze retirement differs from the immutable prior pointer.');
    }
    if (indexedRetiredManifestPresent) {
      throw new Error('Successor freeze retained the prior pointer manifest in the candidate index.');
    }
    if (!snapshot.stagedPaths.includes(projection.retiredManifestPath)) {
      throw new Error(
        'Successor freeze prior pointer manifest deletion is not staged against exact HEAD; '
        + `observed staged paths: ${snapshot.stagedPaths.join(',') || 'none'}.`
      );
    }
    const retiredWorktreePath = path.join(
      repositoryRoot,
      ...projection.retiredManifestPath.split('/')
    );
    const remaining = await inspectSafePath({
      boundaryRoot: repositoryRoot,
      candidatePath: retiredWorktreePath,
      label: 'Successor freeze retired manifest',
      finalKind: 'file',
      allowMissing: true
    });
    if (remaining !== null) {
      throw new Error('Successor freeze prior manifest must be absent from the worktree.');
    }
  }
  const pointerNext = Buffer.from(projection.pointerSource, 'utf8');
  const rollingPlanNext = Buffer.from(projection.rollingPlanSource, 'utf8');
  return Object.freeze({ spec, headSha, localDefaultSha, baseTreeSha, snapshot, projection, indexedTargetManifest, pointerFile, rollingPlanFile, pointerPre, rollingPlanPre, pointerWorktree, rollingPlanWorktree, pointerNext, rollingPlanNext });
}

/** Pure journal/result compilation. These planned success fields become an
 * observed result only after the owner completes publication and settlement. */
export function compileDocumentControlFreezeOperation(input: Readonly<{
  authoringDisposition: 'activation' | 'proposal-only';
  manifestPath: string; manifestDigest: `sha256:${string}`; reviewedOn: string;
  localDefaultSha: string; baseTreeSha: string; preIndexTreeSha: string;
  candidateTreeSha: string; indexPre: Buffer; indexNext: Buffer;
  manifestBytes: Buffer; pointerPre: Buffer; pointerNext: Buffer;
  rollingPlanWorktree: Buffer; rollingPlanNext: Buffer;
}>): Readonly<{ journal: FreezeJournal; result: FreezeResult }> {
  const { localDefaultSha, baseTreeSha, candidateTreeSha, indexPre, indexNext,
    manifestBytes, pointerPre, pointerNext, rollingPlanWorktree, rollingPlanNext } = input;
  const indexTransport = Object.freeze({ pre: toBase64(indexPre), next: toBase64(indexNext) });
  const semantic = Object.freeze({
    schema: input.authoringDisposition === 'proposal-only'
      ? FreezeJournalSchema
      : LegacyFreezeJournalSchema,
    ...(input.authoringDisposition === 'proposal-only'
      ? { authoringDisposition: input.authoringDisposition }
      : {}),
    manifestPath: input.manifestPath,
    manifestDigest: input.manifestDigest,
    reviewedOn: input.reviewedOn,
    baseSha: localDefaultSha,
    baseTreeSha,
    preIndexTreeSha: input.preIndexTreeSha,
    candidateTreeSha,
    files: Object.freeze({
      manifest: Object.freeze({ pre: toBase64(manifestBytes), next: toBase64(manifestBytes) }),
      pointer: Object.freeze({ pre: toBase64(pointerPre), next: toBase64(pointerNext) }),
      rollingPlan: Object.freeze({
        pre: toBase64(rollingPlanWorktree),
        next: toBase64(rollingPlanNext)
      })
    }),
    index: indexTransport,
    indexTransportDigest: freezeIndexTransportDigest(indexTransport)
  });
  const operationId = freezeOperationId(semantic);
  const result: FreezeResult = Object.freeze({
    schema: input.authoringDisposition === 'proposal-only'
      ? FreezeResultSchema
      : LegacyFreezeResultSchema,
    status: input.authoringDisposition === 'proposal-only'
      ? 'PROPOSED'
      : 'ACTIVATED_INDEX_PENDING_COMMIT',
    operationId,
    baseSha: localDefaultSha,
    baseTreeSha,
    candidateTreeSha,
    candidateHeadSha: null,
    manifestPath: input.manifestPath,
    manifestDigest: input.manifestDigest,
    indexPublished: true,
    worktreeProjected: true
  });
  return Object.freeze({
    journal: Object.freeze({
      ...semantic,
      operationId,
      phase: 'prepared',
      result
    }),
    result
  });
}
