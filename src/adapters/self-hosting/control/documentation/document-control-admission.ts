import { realpathSync } from 'node:fs';
import path from 'node:path';
import { rawSha256 } from '../../../../contracts/canonical.ts';
import { withAuthorityGitReadSession } from '../../../providers/git-read/authority.ts';
import { compileSecRepositoryModuleMembership } from '../../../repository/architecture/contract.ts';
import { GIT_READ_OPERATION_BUDGET } from '../../development/tooling/git/git-read.ts';
import {
  CodexDevelopmentParseCurrentWorkPackageManifest,
  CodexDevelopmentWorkPackageManifestDigest
} from '../task/contract/work-package.ts';
import {
  ActivePointerPath,
  CurrentStatePath,
  decodeUtf8,
  RollingPlanPath,
  shaValue
} from './document-control-journal-codec.ts';
import {
  readGitBlob,
  requireCommand,
  requireGitBlob,
  run,
  withDocumentControlGitReadSession
} from './document-control-observation.ts';
import {
  CodexDevelopmentAssertControlPlaneBinding,
  CodexDevelopmentAssertRollingMachineBaseBinding,
  CodexDevelopmentClassifyPublishedControlBinding,
  type CodexDevelopmentCommittedCandidateReplanAuthority,
  CodexDevelopmentParseActivePointer,
  CodexDevelopmentParseCurrentStateSpec,
  CodexDevelopmentParseRollingMachineProjection,
  CodexDevelopmentParseRollingPlanHeadings,
  CodexDevelopmentResolveWorkSelectionProjectionMode
} from './document-control-plane-contract.ts';

/**
 * Exact committed-source and execution/candidate admission. These checks consume
 * canonical Git/Work Package facts; paths, CLI options and compiled projections
 * cannot issue operation authority. Replan ancestry and every intervening control
 * generation remain required, including a change later reverted on main.
 */

export function assertCanonicalManifestPath(manifestPath: string): void {
  if (!/^config\/repository\/work-packages\/[a-z0-9][a-z0-9-]*\.md$/u.test(manifestPath)) {
    throw new Error('freeze --manifest must be one canonical Work Package manifest path.');
  }
}

export function assertReviewedOn(reviewedOn: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(reviewedOn)) {
    throw new Error('freeze --reviewed-on must be an ISO calendar date.');
  }
  const date = new Date(`${reviewedOn}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== reviewedOn) {
    throw new Error('freeze --reviewed-on must be a real ISO calendar date.');
  }
}

export function assertNoUnrelatedStagedChanges(
  stagedPaths: readonly string[],
  targets: ReadonlySet<string>
): void {
  const unrelated = stagedPaths.filter((candidate) => !targets.has(candidate));
  if (unrelated.length > 0) {
    throw new Error(`Document control freeze rejects unrelated staged paths: ${unrelated.join(', ')}.`);
  }
}

export async function assertCommittedCandidateReplanAuthority(input: {
  repositoryRoot: string;
  headSha: string;
  trustedDefaultSha: string;
  trustedDefaultTree: string;
  manifestPath: string;
}): Promise<CodexDevelopmentCommittedCandidateReplanAuthority> {
  const ancestry = requireCommand(
    await run('git', ['rev-list', '--parents', '-n', '1', input.headSha], input.repositoryRoot),
    'Committed candidate ancestry'
  ).split(/\s+/u);
  if (ancestry.length !== 2 || ancestry[0] !== input.headSha || ancestry[1] !== input.trustedDefaultSha) {
    throw new Error(
      'Committed candidate replan requires one exact candidate generation whose sole parent is the live default.'
    );
  }
  const candidateState = await requireGitBlob(
    input.repositoryRoot,
    `${input.headSha}:${CurrentStatePath}`,
    'Committed candidate current-state authority'
  );
  const trustedState = await requireGitBlob(
    input.repositoryRoot,
    `${input.trustedDefaultSha}:${CurrentStatePath}`,
    'Live-default current-state authority'
  );
  if (!candidateState.equals(trustedState)) {
    throw new Error('Committed candidate replan must preserve the exact live-default current-state authority bytes.');
  }
  const spec = CodexDevelopmentParseCurrentStateSpec(
    decodeUtf8(candidateState, 'Committed candidate current-state')
  );
  const pointerBytes = await requireGitBlob(
    input.repositoryRoot,
    `${input.headSha}:${ActivePointerPath}`,
    'Committed candidate active pointer'
  );
  const pointerSource = decodeUtf8(pointerBytes, 'Committed candidate active pointer');
  const pointer = CodexDevelopmentParseActivePointer(pointerSource);
  CodexDevelopmentAssertControlPlaneBinding({ spec, pointer });
  const rollingBytes = await requireGitBlob(
    input.repositoryRoot,
    `${input.headSha}:${RollingPlanPath}`,
    'Committed candidate rolling plan'
  );
  const rollingSource = decodeUtf8(rollingBytes, 'Committed candidate rolling plan');
  const rolling = CodexDevelopmentParseRollingPlanHeadings(rollingSource);
  const rollingMachine = CodexDevelopmentParseRollingMachineProjection(rollingSource);
  const manifestBytes = await requireGitBlob(
    input.repositoryRoot,
    `${input.headSha}:${input.manifestPath}`,
    'Committed candidate Work Package manifest'
  );
  const manifest = CodexDevelopmentParseCurrentWorkPackageManifest(
    decodeUtf8(manifestBytes, 'Committed candidate Work Package manifest'),
    input.manifestPath
  );
  if (pointer.manifest !== input.manifestPath
      || rolling.activePackageId !== manifest.id
      || manifest.base !== input.trustedDefaultSha) {
    throw new Error(
      'Committed candidate replan requires the exact active pointer, rolling plan, manifest path, and base binding.'
    );
  }
  if (CodexDevelopmentResolveWorkSelectionProjectionMode(spec) === 'required-v1'
      && rollingMachine === null) {
    throw new Error('Committed candidate replan requires the prior machine projection identity.');
  }
  // A candidate is required to be a direct child of the live default.  When
  // it carries the exact projection bytes from that parent, the parent is the
  // publication authority; do not walk from an old base and mistake the first
  // unrelated descendant commit for the projection publication.  Historical
  // candidates that intentionally carry older bytes still take the bounded
  // ancestry path below.
  const liveDefaultRollingBytes = await requireGitBlob(
    input.repositoryRoot,
    `${input.trustedDefaultSha}:${RollingPlanPath}`,
    'Live-default rolling projection'
  );
  const rollingMatchesLiveDefault = liveDefaultRollingBytes.equals(rollingBytes);
  if (rollingMachine !== null) {
    if (rollingMachine.exactMain === input.trustedDefaultSha) {
      CodexDevelopmentAssertRollingMachineBaseBinding({
        projection: rollingMachine,
        exactMain: input.trustedDefaultSha,
        exactMainTree: input.trustedDefaultTree
      });
    } else {
      if (rollingMachine.schema !== 'sec-work-rolling-transition-projection-v1'
          || rollingMachine.authority.kind !== 'committed-candidate-replan') {
        throw new Error(
          'Committed candidate replan can repair only one fully bound historical committed-candidate projection.'
        );
      }
      const historicalBaseTree = shaValue(requireCommand(
        await run('git', ['rev-parse', `${rollingMachine.exactMain}^{tree}`], input.repositoryRoot),
        'Historical rolling base tree'
      ), 'Historical rolling base tree');
      if (historicalBaseTree !== rollingMachine.exactMainTree) {
        throw new Error('Historical rolling projection tree does not bind its exact recorded base revision.');
      }
      const historicalBaseAncestry = await run(
        'git',
        ['merge-base', '--is-ancestor', rollingMachine.exactMain, input.trustedDefaultSha],
        input.repositoryRoot
      );
      if (historicalBaseAncestry.code !== 0) {
        throw new Error('Historical rolling projection base is not an ancestor of the live default.');
      }
      if (!rollingMatchesLiveDefault) {
        const historicalPointerSource = decodeUtf8(await requireGitBlob(
          input.repositoryRoot,
          `${rollingMachine.exactMain}:${ActivePointerPath}`,
          'Historical live-default active pointer'
        ), 'Historical live-default active pointer');
        const historicalPointer = CodexDevelopmentParseActivePointer(historicalPointerSource);
        const unchangedControlPaths = [
          CurrentStatePath,
          ActivePointerPath,
          RollingPlanPath,
          historicalPointer.manifest,
          'config/repository/work-selection.md'
        ];
        let controlEndpointsPresent = true;
        // The retained Git-read session admits one child operation at a time.
        // Parallel blob reads can fail its process resource settlement before
        // any control comparison or freeze effect occurs.
        for (const controlPath of unchangedControlPaths) {
          const historical = await readGitBlob(
            input.repositoryRoot, `${rollingMachine.exactMain}:${controlPath}`
          );
          const current = await readGitBlob(
            input.repositoryRoot, `${input.trustedDefaultSha}:${controlPath}`
          );
          if (historical === undefined || current === undefined || !historical.equals(current)) {
            controlEndpointsPresent = false;
            break;
          }
        }
        let controlGenerationUnchanged = controlEndpointsPresent;
        if (controlGenerationUnchanged) {
          const lineage = requireCommand(await run('git', [
            'rev-list', '--first-parent', '--parents', '--reverse',
            `${rollingMachine.exactMain}..${input.trustedDefaultSha}`
          ], input.repositoryRoot), 'Historical live-default first-parent lineage');
          let previous = rollingMachine.exactMain;
          for (const line of lineage.trim().split(/\r?\n/u)) {
            const identities = line.trim().split(/\s+/u);
            if (identities.length < 2 || identities[1] !== previous) {
              controlGenerationUnchanged = false;
              break;
            }
            previous = identities[0]!;
          }
          if (previous !== input.trustedDefaultSha) controlGenerationUnchanged = false;
          if (controlGenerationUnchanged) {
            // Git's first-parent path walk counts changes at every generation,
            // including a change later reverted to the original bytes.  The
            // single native read keeps process use independent of history size.
            const changedControlCount = requireCommand(await run('git', [
              'rev-list', '--first-parent', '--full-history', '--show-pulls', '--count',
              `${rollingMachine.exactMain}..${input.trustedDefaultSha}`,
              '--', ...unchangedControlPaths
            ], input.repositoryRoot), 'Historical live-default control path changes').trim();
            if (!/^(?:0|[1-9][0-9]*)$/u.test(changedControlCount)) {
              throw new Error('Historical live-default control path count is invalid.');
            }
            controlGenerationUnchanged = changedControlCount === '0';
          }
        }
        if (!controlGenerationUnchanged) {
          const publicationChain = requireCommand(
            await run('git', [
              'rev-list',
              '--first-parent',
              '--ancestry-path',
              '--reverse',
              `${rollingMachine.exactMain}..${input.trustedDefaultSha}`
            ], input.repositoryRoot),
            'Published rolling projection ancestry'
          ).split(/\s+/u);
          const publicationCommit = publicationChain[0];
          if (publicationCommit === undefined) {
            throw new Error('Historical rolling projection has no published live-default generation.');
          }
          const publicationAncestry = requireCommand(
            await run('git', ['rev-list', '--parents', '-n', '1', publicationCommit], input.repositoryRoot),
            'Published rolling projection commit ancestry'
          ).split(/\s+/u);
          if (publicationAncestry.length !== 2
              || publicationAncestry[0] !== publicationCommit
              || publicationAncestry[1] !== rollingMachine.exactMain) {
            throw new Error(
              'Published rolling projection must be the sole-parent first live-default generation after its exact base.'
            );
          }
          const publishedRollingBytes = await requireGitBlob(
            input.repositoryRoot,
            `${publicationCommit}:${RollingPlanPath}`,
            'Published rolling projection bytes'
          );
          if (!publishedRollingBytes.equals(rollingBytes)) {
            throw new Error('Candidate rolling bytes do not equal the exact published live-default projection.');
          }
          const publishedPointerSource = decodeUtf8(await requireGitBlob(
            input.repositoryRoot,
            `${publicationCommit}:${ActivePointerPath}`,
            'Published rolling projection pointer'
          ), 'Published rolling projection pointer');
          const publishedPointer = CodexDevelopmentParseActivePointer(publishedPointerSource);
          const publishedManifestBytes = await requireGitBlob(
            input.repositoryRoot,
            `${publicationCommit}:${input.manifestPath}`,
            'Published rolling projection manifest'
          );
          const publishedManifest = CodexDevelopmentParseCurrentWorkPackageManifest(
            decodeUtf8(publishedManifestBytes, 'Published rolling projection manifest'),
            input.manifestPath
          );
          const publishedManifestDigest = CodexDevelopmentWorkPackageManifestDigest(publishedManifestBytes);
          if (publishedPointer.manifest !== input.manifestPath
              || publishedPointer.manifestDigest !== publishedManifestDigest
              || rollingMachine.active.manifestDigest !== publishedManifestDigest
              || publishedManifest.id !== rollingMachine.active.packageId
              || publishedManifest.tracking !== rollingMachine.active.tracking) {
            throw new Error('Historical rolling authority does not bind the exact published control generation.');
          }
        }
      }
      const sourceAuthority = rollingMachine.authority;
      const sourceAncestry = requireCommand(
        await run('git', ['rev-list', '--parents', '-n', '1', sourceAuthority.sourceHead], input.repositoryRoot),
        'Historical committed-candidate source ancestry'
      ).split(/\s+/u);
      if (sourceAncestry.length !== 2
          || sourceAncestry[0] !== sourceAuthority.sourceHead
          || sourceAncestry[1] !== rollingMachine.exactMain) {
        throw new Error(
          'Historical committed-candidate source must have the recorded rolling base as its sole parent.'
        );
      }
      const sourceTree = shaValue(requireCommand(
        await run('git', ['rev-parse', `${sourceAuthority.sourceHead}^{tree}`], input.repositoryRoot),
        'Historical committed-candidate source tree'
      ), 'Historical committed-candidate source tree');
      if (sourceTree !== sourceAuthority.sourceTree) {
        throw new Error('Historical committed-candidate source tree does not match its recorded authority.');
      }
      const sourceManifestBytes = await requireGitBlob(
        input.repositoryRoot,
        `${sourceAuthority.sourceHead}:${input.manifestPath}`,
        'Historical committed-candidate source manifest'
      );
      const sourceManifestDigest = CodexDevelopmentWorkPackageManifestDigest(sourceManifestBytes);
      if (sourceManifestDigest !== sourceAuthority.sourceManifestDigest) {
        throw new Error('Historical committed-candidate manifest does not bind its recorded source digest.');
      }
      const sourcePointer = decodeUtf8(await requireGitBlob(
        input.repositoryRoot,
        `${sourceAuthority.sourceHead}:${ActivePointerPath}`,
        'Historical committed-candidate source pointer'
      ), 'Historical committed-candidate source pointer');
      const sourceRolling = decodeUtf8(await requireGitBlob(
        input.repositoryRoot,
        `${sourceAuthority.sourceHead}:${RollingPlanPath}`,
        'Historical committed-candidate source rolling plan'
      ), 'Historical committed-candidate source rolling plan');
      if (rawSha256(sourcePointer) !== sourceAuthority.sourcePointerRevision
          || rawSha256(sourceRolling) !== sourceAuthority.sourceRollingRevision) {
        throw new Error('Historical committed-candidate control bytes do not match their recorded authority.');
      }
      const parsedSourcePointer = CodexDevelopmentParseActivePointer(sourcePointer);
      if (parsedSourcePointer.manifest !== input.manifestPath
          || parsedSourcePointer.manifestDigest !== sourceManifestDigest) {
        throw new Error('Historical committed-candidate source does not bind its exact manifest.');
      }
    }
    if (rollingMachine.active.packageId !== manifest.id
        || rollingMachine.active.tracking !== manifest.tracking
        || (rollingMachine.schema === 'sec-work-rolling-transition-projection-v1'
          && rollingMachine.active.manifestPath !== input.manifestPath)) {
      throw new Error('Committed candidate replan cannot replace package, tracking, or manifest identity.');
    }
  }
  const defaultManifestBlob = await readGitBlob(
    input.repositoryRoot,
    `${input.trustedDefaultSha}:${input.manifestPath}`
  );
  if (defaultManifestBlob !== undefined) {
    const defaultManifestDigest = CodexDevelopmentWorkPackageManifestDigest(defaultManifestBlob);
    const pointerBindsDefault = defaultManifestDigest === pointer.manifestDigest;
    const pointerBindsRolling = rollingMachine?.schema === 'sec-work-rolling-transition-projection-v1'
      && rollingMachine.active.manifestDigest === pointer.manifestDigest;
    const binding = CodexDevelopmentClassifyPublishedControlBinding({
      authorityProven: true,
      historicalBaseIsLiveDefault: rollingMachine?.exactMain === input.trustedDefaultSha,
      pointerBindsDefault,
      pointerBindsHistoricalRolling: pointerBindsRolling,
      publishedTargetPresent: true,
      rollingTransition: rollingMachine?.schema === 'sec-work-rolling-transition-projection-v1'
    });
    if (binding.kind !== 'repairable') {
      throw new Error(
        `Published projection drift repair is blocked: ${binding.kind === 'blocked' ? binding.reason : 'absent'}.`
      );
    }
    const defaultManifest = CodexDevelopmentParseCurrentWorkPackageManifest(
      decodeUtf8(defaultManifestBlob, 'Live-default drifted Work Package manifest'),
      input.manifestPath
    );
    if (defaultManifest.id !== manifest.id || defaultManifest.tracking !== manifest.tracking) {
      throw new Error('Published Work Package drift repair cannot replace package or tracking identity.');
    }
  }
  const sourceTree = shaValue(
    requireCommand(
      await run('git', ['rev-parse', `${input.headSha}^{tree}`], input.repositoryRoot),
      'Committed candidate tree'
    ),
    'Committed candidate tree'
  );
  return Object.freeze({
    kind: 'committed-candidate-replan',
    sourceHead: input.headSha,
    sourceTree,
    sourceManifestDigest: CodexDevelopmentWorkPackageManifestDigest(
      manifestBytes
    ) as `sha256:${string}`,
    sourcePointerRevision: rawSha256(pointerSource),
    sourceRollingRevision: rawSha256(rollingSource)
  });
}

/** Verify the trusted execution checkout before candidate owner admission.
 * Decoding a freeze request does not confer this authority. */
export async function admitDocumentControlExecutionRoot(input: Readonly<{
  executionRoot: string; deadlineAtUnixMs: number;
}>): Promise<string> {
  const { executionRoot, deadlineAtUnixMs: freezeDeadlineAtUnixMs } = input;
  const remainingFreezeBudget = (): number => Math.max(
    1,
    freezeDeadlineAtUnixMs - Date.now()
  );
  let executionDefaultBranch: string | undefined;
  await withAuthorityGitReadSession({
    cwd: executionRoot,
    budget: Object.freeze({
      ...GIT_READ_OPERATION_BUDGET,
      deadlineMs: remainingFreezeBudget()
    }),
    deadlineAtUnixMs: freezeDeadlineAtUnixMs
  }, (session) => withDocumentControlGitReadSession(session, async () => {
    const executionBranch = requireCommand(
      await run('git', ['branch', '--show-current'], executionRoot),
      'Document-control execution branch'
    );
    const executionHead = shaValue(
      requireCommand(await run('git', ['rev-parse', 'HEAD'], executionRoot), 'Document-control execution HEAD'),
      'Document-control execution HEAD'
    );
    const executionSpec = CodexDevelopmentParseCurrentStateSpec(decodeUtf8(await requireGitBlob(
      executionRoot,
      `${executionHead}:${CurrentStatePath}`,
      'Document-control execution current-state authority'
    ), 'Document-control execution current-state authority'));
    executionDefaultBranch = executionSpec.resolver.defaultBranch;
    const executionDefault = shaValue(requireCommand(
      await run('git', ['rev-parse', '--verify', executionSpec.resolver.defaultRef], executionRoot),
      'Document-control execution default'
    ), 'Document-control execution default');
    const executionSurfacePaths = [
      ...compileSecRepositoryModuleMembership(executionRoot).moduleRoots,
      'package.json',
      'bun.lock'
    ];
    const executionSurfaceStatus = await run('git', [
      'status', '--porcelain=v1', '--untracked-files=all', '--',
      ...executionSurfacePaths
    ], executionRoot);
    if (executionBranch !== 'main' || executionHead !== executionDefault
        || executionSurfaceStatus.code !== 0 || executionSurfaceStatus.stdout.length > 0) {
      throw new Error(
        'Document-control freeze must execute from the clean trusted main control surface; '
        + 'use --workspace to target the isolated candidate.'
      );
    }
  }));

  if (executionDefaultBranch === undefined) throw new Error('Document-control execution default branch is unavailable.');
  return executionDefaultBranch;
}

/** Recheck candidate isolation inside the candidate writer's Git session. */
export async function assertDocumentControlCandidateIsolation(input: Readonly<{
  requestedWorkspace: string; executionRoot: string; executionDefaultBranch: string;
}>): Promise<void> {
  const { requestedWorkspace, executionRoot, executionDefaultBranch } = input;
  const candidateRoot = path.resolve(requireCommand(
    await run('git', ['rev-parse', '--show-toplevel'], requestedWorkspace),
    'Document-control candidate root'
  ));
  const physicalKey = (value: string) => {
    const resolved = realpathSync(value).replaceAll('\\', '/');
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
  };
  const candidateBranch = requireCommand(
    await run('git', ['branch', '--show-current'], candidateRoot),
    'Document-control candidate branch'
  );
  if (physicalKey(candidateRoot) === physicalKey(executionRoot)
      || candidateBranch.length === 0
      || candidateBranch === executionDefaultBranch) {
    throw new Error(
      'Document-control freeze target must be one distinct isolated non-default candidate worktree.'
    );
  }
}
