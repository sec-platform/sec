#!/usr/bin/env bun
/** SEC canonical VerificationSession V2 operator CLI; effects and authority live in explicit owners. */
import { assertWorkspaceWriteLease, withWorkspaceWriteLease } from '../../../../filesystem/write-lease.ts';
import { withAuthorityGitReadSession } from '../../../../providers/git-read/authority.ts';
import { GIT_READ_DEFAULT_OPERATION_BUDGET } from '../../../../providers/git-read/runtime/budget.ts';
import { GIT_READ_EXACT_TREE_OPERATION_BUDGET } from '../../../../providers/git-read/runtime/session.ts';
import { BRANCH_CLOSEOUT_RECOVERY_ARTIFACT_FILE_NAME, createBranchCloseoutOperationBinding, parseBranchCloseoutOperationReceipt } from '../../../../self-hosting/control/branch-lifecycle/branch-closeout-contract.ts';
import { assertBranchCloseoutEffectStartMatches, BRANCH_CLOSEOUT_MUTATION_PHASE_STEP_NAME, createBranchCloseoutEffectStartPublication, observeBranchCloseoutEffectStartPublication, observeBranchCloseoutOperationPublication } from '../../../../self-hosting/control/branch-lifecycle/branch-closeout-receipt.ts';
import { operationReceiptFilePath, type PreparedBranchCloseoutEnvelope, prepareMergedPullRequestCloseout } from '../../../../self-hosting/control/branch-lifecycle/branch-closeout.ts';
import { createLocalMainCloseoutBindingFromHostedAuthority, executeLocalMainCloseout } from '../../../../self-hosting/control/branch-lifecycle/local-main-closeout.ts';
import type { WorktreePhysicalCloseoutConsumptionToken } from '../../../../self-hosting/control/branch-lifecycle/worktree-physical-closeout.ts';
import { observeActiveWorkPackage } from '../../../../self-hosting/control/documentation/document-control-plane.ts';
import { createIntegrationAuthorizationOperationPublication, type IntegrationAuthorizationOperationPublication, observeIntegrationAuthorizationOperationPublications } from '../../../../self-hosting/control/integration/integration-authorization-publication.ts';
import { assertCanonicalMergeMessage, CodexDevelopmentParseMergeGateResult } from '../../../../self-hosting/control/integration/merge-gate.ts';
import type { IssueDispositionPlan } from '../../../../self-hosting/control/issues/disposition.ts';
import { CodexDevelopmentAssertWorkPackageOwnership, CodexDevelopmentParseCurrentWorkPackageManifest, CodexDevelopmentParseWorkPackageLocator, CodexDevelopmentWorkPackageManifestDigest } from '../../../../self-hosting/control/task/contract/work-package.ts';
import { executeVerifiedCiActionPlan } from '../../../../self-hosting/development/runner/verification-action-executor.ts';
import { encodeVerificationActionData } from '../../action/contract/action.ts';
import { type CiVerificationActionPlanClosure, type CiVerificationExecutionEnvironment, createCiVerificationLocalExecutionEnvironment } from '../../action/contract/ci.ts';
import { CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS } from '../../action/contract/environment.ts';
import { executeLocalVerificationActionDag, type LocalVerificationActionDagResult } from '../../action/runner.ts';
import { parseVerificationSession } from '../../session/contract/session.ts';
import { parseOpenPullRequestList, projectWorkPackageRegistry } from '../../session/runtime/work-package-registry.ts';
import type { CodexDevelopmentTestImpactTransitionObservation } from '../../test-impact/runtime/transition.ts';
import { CodexDevelopmentCreateVerificationEvidenceProducer, CodexDevelopmentParseVerificationSessionArtifact } from '../contract/evidence.ts';
import { createVerificationSessionScope, type VerificationSessionScope } from '../contract/session-scope.ts';
import { CodexDevelopmentDefaultChangedPaths, CodexDevelopmentExactGitWorkspaceSourceSnapshot, CodexDevelopmentTestImpactSourceProviderFromSnapshot } from './ci-orchestration-core.ts';
import { acquireLocalCandidateWorktree, removeLocalCandidateWorktree } from './local-candidate-worktree.ts';
import { exactCommitMarker } from './merge-commit-marker.ts';
import { readJson, writeCanonicalDurable, writeDurable } from './session-artifact-files.ts';
import { publishHostedIntegrationAuthorizationOperation } from './session-authorization-publication.ts';
import { finalizeHostedBranchCloseout, finalizeSameInvocationCloseout } from './session-branch-closeout.ts';
import { closeoutPublicationCompositeDigest, type HostedCloseoutEffectStartReadback, publishHostedCloseoutEffectStart, publishHostedCloseoutTerminal } from './session-closeout-publication.ts';
import { observeExactRemoteCloseoutBranch } from './session-closeout-ref-provider.ts';
import { consumeSameHostWorktreeCloseout, evaluateHostedCloseoutEffectPreconditionsUnderLease, loadOriginalHostPreparedCloseout, routePreparedWorktreeCleanupAttempt } from './session-closeout-worktree.ts';
import { ensureHostedReviewLocator, ensureMaintainerReviewWakeup, executeReviewProviderRevalidation } from './session-github-provider.ts';
import { loadHostedArtifactForMergeWorkflow, loadProviderBranchCloseoutRecoveryArtifact, materializeBranchCloseoutRecoveryArtifact, selectTrustedHostedSessionArtifact } from './session-hosted-artifacts.ts';
import { assertBoundPostMergeMain, assertHostedCompilerIdentity, assertHostedIntegrationIdentity, githubEvent, hostedActorHandle, positiveEnvironmentInteger } from './session-hosted-identity.ts';
import { addSeconds, assertHostedIntegrationPreflightStillControls, evaluateFreshHostedIntegration, hostedIntegrationPreflightResultPath, loadMarkerBoundMergedAuthorizationRecovery, loadMergedHostedCloseoutContext, observeDurableVerificationSessionProjection } from './session-integration-observation.ts';
import { observeExactIssueDispositionPlan, observeHostedTrackingIssueDisposition, observePostMergeIssueReconciliation } from './session-issue-reconciliation.ts';
import { commonGitDirectory, comparableFileSystemPath, inspectLocalVerificationActionRepositoryWithScope, openRuntimeJournalFileSystem, requireVerificationSessionCommandText, runVerificationSessionCommand, SESSION_COMMAND_MAX_BUFFER } from './session-local-repository.ts';
import { joinExactPostMergeMainHealth } from './session-post-merge-health.ts';
import { inspectTrustedRuntime, synchronizeTrustedRemoteDefaultRef } from './trusted-runtime-observation.ts';
import { createVerificationSessionGitHubClient, type GitHubCandidateObservation, shouldPublishMaintainerReviewWakeup, type VerificationSessionGitHubClient } from './verification-session-github.ts';
import { planHostedIntegrationEffects, routeHostedIntegration, selectMergedAuthorizationPublication } from './verification-session-integration-routing.ts';
import { appendVerificationSessionJournalEvent, createEphemeralVerificationSessionJournalFs, createVerificationSessionOperationId, readVerificationSessionJournal, type VerificationSessionJournalFileSystem } from './verification-session-journal.ts';
import { assertHostedSquashMergeCompletion, executeHostedSquashMerge, type HostedSynchronousSquashMergeResponse } from './verification-session-merge-provider.ts';
import { assertTrustedMainRuntime, classifyVerificationSessionArtifactReuse, createTrustedHostedArtifactProvenance, createTrustedIntegrationAuthorizationPublicationSource, createVerificationSessionMergeOperationId, finalizeVerificationSessionHostedArtifact, integrationMergeMarkers, parseVerificationSessionHostedRequest, prepareLocalQuickVerificationActionPlan, prepareTrustedMainVerificationSession, prepareVerificationSessionHosted, reconstructVerificationSessionHostedFacts, refreshVerificationSessionHostedArtifact, resumeVerificationSession, type VerificationSessionHostedEnvelope, type VerificationSessionHostedFacts } from './verification-session-runtime.ts';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
export { assertHostedCompilerDispatchPayload, assertHostedCompilerInternalProvenance } from '../contract/hosted-dispatch.ts';
export { readExactCommitMarker } from './merge-commit-marker.ts';
export { deleteHostedLocalRefCas } from './session-closeout-ref-provider.ts';
export { routePreparedWorktreeCleanupAttempt } from './session-closeout-worktree.ts';
export { observeExactIssueDispositionPlan, observePostMergeIssueReconciliation } from './session-issue-reconciliation.ts';
export { HOSTED_INTEGRATION_ROUTE_SCHEMA, classifyDurableVerificationSessionProjection, planHostedIntegrationEffects, routeHostedIntegration } from './verification-session-integration-routing.ts';
export type { HostedIntegrationEffectPlan, HostedIntegrationRoute } from './verification-session-integration-routing.ts';
export { assertHostedSquashMergeCompletion, parseHostedSynchronousSquashMergeResponse } from './verification-session-merge-provider.ts';
export type { HostedSynchronousSquashMergeResponse } from './verification-session-merge-provider.ts';

async function createBranchLifecycleVerificationScope(
  repositoryRoot: string
): Promise<VerificationSessionScope> {
  return createVerificationSessionScope({
    repositoryRoot,
    activeWorkPackageObservation: await observeActiveWorkPackage(repositoryRoot)
  });
}

export async function observeVerificationSessionChangedSelection(input: {
  repositoryRoot: string;
  repository: string;
  prNumber: number;
  candidate: GitHubCandidateObservation;
  github: VerificationSessionGitHubClient;
}): Promise<Readonly<{
  changedPaths: readonly string[];
  testImpactSourceProvider: ReturnType<typeof CodexDevelopmentTestImpactSourceProviderFromSnapshot>;
  testImpactTransition: CodexDevelopmentTestImpactTransitionObservation;
}>> {
  const provider = input.github.observeChangedPaths({
    repository: input.repository,
    prNumber: input.prNumber,
    state: 'OPEN',
    draft: false,
    baseSha: input.candidate.baseSha,
    headSha: input.candidate.headSha
  });
  const exactObservation = await withAuthorityGitReadSession({
    cwd: input.repositoryRoot,
    budget: GIT_READ_EXACT_TREE_OPERATION_BUDGET
  }, async (session) => Object.freeze({
    exact: await CodexDevelopmentDefaultChangedPaths(
      session,
      input.candidate.baseSha,
      input.candidate.headSha
    ),
    workspaceSnapshot: await CodexDevelopmentExactGitWorkspaceSourceSnapshot(
      session,
      input.candidate.headSha
    )
  }));
  const { exact } = exactObservation;
  if (JSON.stringify(exact.files) !== JSON.stringify(provider.paths)) {
    throw new Error('VerificationSession provider inventory differs from the exact Git base/head transition.');
  }
  return Object.freeze({
    changedPaths: Object.freeze([...provider.paths]),
    testImpactSourceProvider: CodexDevelopmentTestImpactSourceProviderFromSnapshot(
      exactObservation.workspaceSnapshot,
      input.repositoryRoot
    ),
    testImpactTransition: exact.transitionObservation
  });
}

export function observeVerificationSessionActionDependencyBlobs(input: {
  github: VerificationSessionGitHubClient;
  repository: string;
  baseSha: string;
  headSha: string;
}) {
  return Object.freeze(CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS.map((dependencyPath) =>
    Object.freeze({
      path: dependencyPath,
      baseSource: input.github.readBlobText(input.repository, input.baseSha, dependencyPath),
      candidateSource: input.github.readBlobText(input.repository, input.headSha, dependencyPath)
    })));
}

async function executePreparedLocalQuickDag(input: {
  ctx: VerificationSessionScope;
  authorityRoot: string;
  candidate: GitHubCandidateObservation;
  sessionRevision: `sha256:${string}`;
  actionPlanClosure: CiVerificationActionPlanClosure;
  executionEnvironment: CiVerificationExecutionEnvironment;
  environment: NodeJS.ProcessEnv;
}): Promise<Readonly<{
  result: LocalVerificationActionDagResult;
  worktreeDisposition: 'created-and-removed' | 'reused-and-removed' | 'retained-blocked' | 'retained-physical-closeout-blocked';
}>> {
  const commonDir = commonGitDirectory(input.ctx, input.authorityRoot);
  const lease = await withWorkspaceWriteLease(commonDir, undefined, async (coordinatedLease) => {
    await assertWorkspaceWriteLease(commonDir, coordinatedLease);
    return acquireLocalCandidateWorktree(input);
  });
  const result = await executeLocalVerificationActionDag({
    authorityRoot: lease.owner.authorityRoot,
    candidateRoot: lease.owner.candidateRoot,
    actionPlanClosure: input.actionPlanClosure,
    executionEnvironment: input.executionEnvironment,
    environment: input.environment,
    executeActionPlan: (providerInput) => executeVerifiedCiActionPlan(providerInput),
    inspectRepository: (repositoryRoot) => (
      inspectLocalVerificationActionRepositoryWithScope(input.ctx, repositoryRoot)
    )
  });
  if (result.status === 'blocked') {
    return Object.freeze({ result, worktreeDisposition: 'retained-blocked' });
  }
  const scratchCloseout = await removeLocalCandidateWorktree({ ctx: input.ctx, lease });
  if (scratchCloseout === 'retained-physical-closeout-blocked') {
    return Object.freeze({ result, worktreeDisposition: scratchCloseout });
  }
  return Object.freeze({ result,
    worktreeDisposition: lease.reused ? 'reused-and-removed' : 'created-and-removed' });
}

function required(args: ReadonlyMap<string, string>, name: string): string {
  const value = args.get(name);
  if (value === undefined) throw new Error(`${name} is required.\n${USAGE}`);
  return value;
}

const USAGE = `Usage:
  bun src/adapters/verification/platform/ci/runtime/verification-session.ts project --default-ref <ref> [--open-prs true] [--repository <owner/name>] [--json]
  bun src/adapters/verification/platform/ci/runtime/verification-session.ts prepare --pr <n> --request-output <request.json> [--repository <owner/name>] [--json]
  bun src/adapters/verification/platform/ci/runtime/verification-session.ts revalidate-review-provider --pr <n> [--repository <owner/name>] [--json]
  bun src/adapters/verification/platform/ci/runtime/verification-session.ts observe-hosted --request <request.json> --output <facts.json> [--json]
  bun src/adapters/verification/platform/ci/runtime/verification-session.ts prepare-hosted --request <request.json> --facts <facts.json> --output <envelope.json> [--json]
  bun src/adapters/verification/platform/ci/runtime/verification-session.ts artifact-status --artifact <artifact.json> [--json]
  bun src/adapters/verification/platform/ci/runtime/verification-session.ts finalize-hosted --envelope <envelope.json> (--evidence <evidence.json> | --previous-artifact <artifact.json>) --output <artifact.json> [--json]
  bun src/adapters/verification/platform/ci/runtime/verification-session.ts prepare-integration-hosted --repository <owner/name> --output <projection.json> [--json]
  bun src/adapters/verification/platform/ci/runtime/verification-session.ts integrate-hosted --repository <owner/name> --output <projection.json> [--json]
  bun src/adapters/verification/platform/ci/runtime/verification-session.ts local-main-closeout --repository <owner/name> --pr <n> --protected-root <path> --expected-local-head <sha> [--json]
  bun src/adapters/verification/platform/ci/runtime/verification-session.ts closeout-mutate-hosted --repository <owner/name> --output <projection.json> [--json]
  bun src/adapters/verification/platform/ci/runtime/verification-session.ts closeout-publish-hosted --repository <owner/name> --output <projection.json> [--json]
  bun src/adapters/verification/platform/ci/runtime/verification-session.ts resume --request <request.json> [--repository <owner/name>] [--json]
  bun src/adapters/verification/platform/ci/runtime/verification-session.ts freeze --artifact <artifact.json> --session-output <session.json> --scope-output <scope.json> [--json]
  bun src/adapters/verification/platform/ci/runtime/verification-session.ts status --request <request.json> [--repository <owner/name>] [--json]
  bun src/adapters/verification/platform/ci/runtime/verification-session.ts status-offline --session-file <session.json> [--json]
`;

const COMMAND_FLAGS: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  project: new Set(['--default-ref', '--open-prs', '--repository']),
  prepare: new Set(['--pr', '--request-output', '--repository']),
  'revalidate-review-provider': new Set(['--pr', '--repository']),
  'observe-hosted': new Set(['--request', '--output', '--repository']),
  'prepare-hosted': new Set(['--request', '--facts', '--output']),
  'artifact-status': new Set(['--artifact']),
  'finalize-hosted': new Set(['--envelope', '--evidence', '--previous-artifact', '--output']),
  'prepare-integration-hosted': new Set(['--output', '--repository']),
  'integrate-hosted': new Set(['--output', '--repository']),
  'local-main-closeout': new Set(['--repository', '--pr', '--protected-root', '--expected-local-head']),
  'closeout-mutate-hosted': new Set(['--output', '--repository']),
  'closeout-publish-hosted': new Set(['--output', '--repository']),
  resume: new Set(['--request', '--repository']),
  freeze: new Set(['--artifact', '--session-output', '--scope-output']),
  status: new Set(['--request', '--repository']),
  'status-offline': new Set(['--session-file'])
});

export async function verificationSessionCli(argv: string[]): Promise<string> {
  const command = argv[0];
  const allowedFlags = command === undefined ? undefined : COMMAND_FLAGS[command];
  if (allowedFlags === undefined) throw new Error(`Unknown command: ${command ?? '<missing>'}\n${USAGE}`);
  const args = new Map<string, string>();
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === '--json') continue;
    if (!arg.startsWith('--')) throw new Error(`Unknown argument: ${arg}\n${USAGE}`);
    if (!allowedFlags.has(arg)) throw new Error(`Unknown argument for ${command}: ${arg}\n${USAGE}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for ${arg}.`);
    args.set(arg, value);
    index += 1;
  }
  const repository = args.get('--repository') ?? 'sec-platform/sec';
  const repositoryRoot = process.cwd();
  const environment = process.env;
  const now = () => new Date().toISOString();
  let ctx = createVerificationSessionScope({ repositoryRoot });
  if (new Set([
    'prepare-integration-hosted',
    'integrate-hosted',
    'closeout-mutate-hosted',
    'closeout-publish-hosted'
  ]).has(command)) {
    ctx = await createBranchLifecycleVerificationScope(repositoryRoot);
  }
  let runtimeJournalFs: VerificationSessionJournalFileSystem | null = null;
  if (new Set(['prepare', 'resume', 'status', 'status-offline', 'integrate-hosted']).has(command)) {
    runtimeJournalFs = await openRuntimeJournalFileSystem(repositoryRoot, environment);
  }
  const durableJournalFs = (): VerificationSessionJournalFileSystem => {
    if (runtimeJournalFs === null) {
      throw new Error(`${command} did not acquire the canonical Runtime State journal authority.`);
    }
    return runtimeJournalFs;
  };
  const githubAdapter = () => createVerificationSessionGitHubClient(repositoryRoot);
  const event = () => githubEvent(environment);
  // CLI command routing selects one closed operation only. The selected
  // operation revalidates every authority/target/effect precondition internally.
  // codeql[js/user-controlled-bypass]
  if (command === 'revalidate-review-provider') {
    const prNumber = Number(required(args, '--pr'));
    if (!Number.isSafeInteger(prNumber) || prNumber < 1) {
      throw new Error('--pr must be a positive integer.');
    }
    return executeReviewProviderRevalidation({
      ctx,
      github: githubAdapter(),
      repository,
      prNumber,
      now
    });
  }
  // CLI command routing selects a closed operation; each branch parses and validates its own exact authority.
  // codeql[js/user-controlled-bypass]
  if (command === 'local-main-closeout') {
    const prNumber = Number(required(args, '--pr'));
    if (!Number.isSafeInteger(prNumber) || prNumber < 1) throw new Error('--pr must be a positive integer.');
    const liveCandidate = githubAdapter().observeCandidate(repository, prNumber);
    if (liveCandidate.state !== 'MERGED' || liveCandidate.mergeCommitMessage === null) {
      throw new Error('local-main closeout requires one live merged PR readback.');
    }
    const sessionRevision = exactCommitMarker(liveCandidate.mergeCommitMessage, 'Verification-Session');
    if (!/^sha256:[0-9a-f]{64}$/u.test(sessionRevision)) {
      throw new Error('merged commit Verification-Session marker is not an exact digest.');
    }
    const publications = observeIntegrationAuthorizationOperationPublications(repositoryRoot, {
      repository,
      pullRequestNumber: prNumber,
      sessionRevision: sessionRevision as `sha256:${string}`
    });
    const selected = selectMergedAuthorizationPublication({
      candidate: liveCandidate,
      sessionRevision: sessionRevision as `sha256:${string}`,
      publications
    });
    const authorization = selected.publication.result.authorization;
    if (authorization.repository !== repository || authorization.prNumber !== prNumber
      || authorization.headSha !== liveCandidate.headSha
      || authorization.headTreeSha !== liveCandidate.headTreeSha
      || liveCandidate.mergeCommitTreeSha !== liveCandidate.headTreeSha) {
      throw new Error('live merged candidate differs from the hosted IntegrationAuthorization closure.');
    }
    const markers = integrationMergeMarkers({
      sessionRevision: selected.publication.sessionRevision,
      authorizationId: selected.publication.authorizationId,
      authorizationReceiptDigest: selected.publication.authorizationReceiptDigest,
      consumptionOperationId: selected.publication.consumptionOperationId,
      authorizationPublicationId: selected.publication.authorizationPublicationId,
      authorizationPublicationDigest: selected.publication.publicationDigest,
      commentId: selected.commentId
    });
    assertCanonicalMergeMessage({
      authorizationMarkers: markers,
      reviewReceipt: selected.publication.result.reviewReceipt,
      expectedTitle: `Verified integration ${sessionRevision.slice(7, 19)}`,
      message: liveCandidate.mergeCommitMessage
    });
    const protectedRoot = required(args, '--protected-root');
    const expectedLocalPreimageSha = required(args, '--expected-local-head');
    if (!/^[0-9a-f]{40}$/u.test(expectedLocalPreimageSha)) {
      throw new Error('--expected-local-head must be an exact commit SHA.');
    }
    const gitRunner = (repoRoot: string, gitArgs: readonly string[]) => {
      const observed = runVerificationSessionCommand(ctx, 'git', gitArgs, repoRoot);
      return Object.freeze({
        status: observed.status ?? 1,
        stdout: observed.stdout.toString('utf8'),
        stderr: observed.stderr.toString('utf8')
      });
    };
    const expectedLocalTree = gitRunner(protectedRoot, [
      'rev-parse', '--verify', `${expectedLocalPreimageSha}^{tree}`
    ]);
    if (expectedLocalTree.status !== 0 || !/^[0-9a-f]{40}$/u.test(expectedLocalTree.stdout.trim())) {
      throw new Error('expected local main preimage tree is unavailable.');
    }
    const binding = createLocalMainCloseoutBindingFromHostedAuthority({
      protectedRoot,
      expectedLocalPreimageSha,
      expectedLocalPreimageTreeSha: expectedLocalTree.stdout.trim(),
      hostedAuthority: {
        repository: selected.publication.repository,
        pullRequestNumber: selected.publication.pullRequestNumber,
        sessionRevision: selected.publication.sessionRevision,
        authorizationId: selected.publication.authorizationId,
        authorizationReceiptDigest: selected.publication.authorizationReceiptDigest,
        consumptionOperationId: selected.publication.consumptionOperationId,
        authorizationPublicationId: selected.publication.authorizationPublicationId,
        authorizationPublicationDigest: selected.publication.publicationDigest,
        authorizationHeadSha: authorization.headSha,
        authorizationHeadTreeSha: authorization.headTreeSha,
        reviewReceiptDigest: selected.publication.result.reviewReceipt.receiptDigest,
        reviewRevision: selected.publication.result.reviewReceipt.reviewRevision,
        integrationWorkflowSha: selected.publication.provenance.workflowSha,
        integrationRunId: selected.publication.provenance.runId,
        integrationRunAttempt: selected.publication.provenance.runAttempt
      },
      authorizationMarkers: markers,
      liveCommentId: selected.commentId,
      liveCandidate
    });
    const commonDir = commonGitDirectory(ctx, protectedRoot);
    const result = await withWorkspaceWriteLease(commonDir, undefined, (coordinatedLease) => (
      withWorkspaceWriteLease(protectedRoot, undefined, (lease) => (
        executeLocalMainCloseout(protectedRoot, binding, gitRunner, lease, coordinatedLease)
      ))
    ));
    const receipt = Object.freeze({
      schema: 'sec-local-main-closeout-receipt-v3', binding, result, observedAt: now()
    });
    return JSON.stringify(receipt, null, 2);
  }
  if (command === 'project') {
    const defaultRef = required(args, '--default-ref');
    const openPullRequests = args.get('--open-prs') === 'true'
      ? parseOpenPullRequestList(requireVerificationSessionCommandText(ctx, 'gh', [
          'pr', 'list', '--repo', repository, '--state', 'open', '--json',
          'number,headRefName,headRefOid,baseRefName,baseRefOid,body'
        ], 'open pull request inventory', ctx.repositoryRoot))
      : undefined;
    let registryRecords = 0;
    return projectWorkPackageRegistry({ observedAt: now(), repository,
      defaultBranch: 'main', defaultRef, ...(openPullRequests === undefined ? {} : { openPullRequests })
    }, (args, bytes) => runVerificationSessionCommand(ctx, 'git', args, ctx.repositoryRoot, bytes), {
      maxCommandStdoutBytes: SESSION_COMMAND_MAX_BUFFER,
      consumeRecords: count => {
        registryRecords += count;
        if (registryRecords > GIT_READ_DEFAULT_OPERATION_BUDGET.maxRecords) {
          throw new Error('Registry projection exceeds the Git read record budget.');
        }
      }
    });
  }
  // CLI command routing selects a closed operation; each branch parses and validates its own exact authority.
  // codeql[js/user-controlled-bypass]
  if (command === 'prepare') {
    const prNumber = Number(required(args, '--pr'));
    if (!Number.isSafeInteger(prNumber) || prNumber < 1) throw new Error('--pr must be a positive integer.');
    const github = githubAdapter();
    const candidate = github.observeCandidate(repository, prNumber);
    if (candidate.state !== 'OPEN' || candidate.isDraft || candidate.isCrossRepository) {
      throw new Error('prepare requires one open same-repository non-draft PR.');
    }
    const proof = inspectTrustedRuntime({ repositoryRoot });
    assertTrustedMainRuntime(proof, candidate.baseSha);
    const manifestPath = CodexDevelopmentParseWorkPackageLocator(candidate.body);
    const manifestSource = github.readBlobText(repository, candidate.headSha, manifestPath);
    const manifestDigest = CodexDevelopmentWorkPackageManifestDigest(manifestSource) as `sha256:${string}`;
    const manifest = CodexDevelopmentParseCurrentWorkPackageManifest(manifestSource);
    if (manifest.schema !== 'codex-development-work-package-v1') {
      throw new Error('prepare currently requires the canonical V1 Work Package requiredProfile field.');
    }
    const changedSelection = await observeVerificationSessionChangedSelection({
      repositoryRoot,
      repository,
      prNumber,
      candidate,
      github
    });
    const changedPaths = changedSelection.changedPaths;
    CodexDevelopmentAssertWorkPackageOwnership(manifest, [...changedPaths]);
    const dependencyBlobs = observeVerificationSessionActionDependencyBlobs({ github, repository,
      baseSha: candidate.baseSha, headSha: candidate.headSha });
    const principal = github.observeViewerPrincipal(repository);
    if (principal.permission !== 'admin' && principal.permission !== 'maintain') {
      throw new Error('prepare viewer lacks maintain/admin permission.');
    }
    const barrier = github.observeReviewBarrier({ repository, prNumber, headSha: candidate.headSha,
      excludedPrincipalNodeIds: new Set([candidate.authorNodeId, principal.nodeId]) });
    const observedAt = now();
    const prepared = prepareTrustedMainVerificationSession({ repository, candidate, manifestPath, manifestDigest,
      changedPaths, testImpactTransition: changedSelection.testImpactTransition,
      testImpactSourceProvider: changedSelection.testImpactSourceProvider,
      profile: manifest.requiredProfile, integrationPrincipalNodeId: principal.nodeId,
      producerPrincipalNodeId: principal.nodeId, sourceRunId: environment.GITHUB_RUN_ID ?? `local-${process.pid}`,
      sourceRef: `refs/heads/main@${candidate.baseSha}`, observedAt, reviewBarrier: barrier,
      mainHealthChecks: github.observeChecks(repository, candidate.baseSha), dependencyBlobs });
    writeDurable(required(args, '--request-output'), prepared.request);
    if (prepared.reviewBarrier.status === 'provider-schema-unsupported') {
      return JSON.stringify({ status: 'BLOCKED', sessionRevision: prepared.sessionRevision,
        reviewProvider: Object.freeze({ status: prepared.reviewBarrier.status,
          reasonCode: prepared.reviewBarrier.reasonCode,
          responseDigest: prepared.reviewBarrier.responseDigest,
          observedAt: prepared.reviewBarrier.observedAt }),
        reviewWakeup: null, dispatchSignalSent: false, workflowJoin: null,
        localVerification: null }, null, 2);
    }
    const reviewBarrierAllowsExecution = prepared.reviewBarrier.status === 'clear'
      || prepared.reviewBarrier.status === 'waiting';
    const journalFs = durableJournalFs();
    const journal = readVerificationSessionJournal({
      sessionRevision: prepared.sessionRevision,
      fs: journalFs
    });
    if (journal.completedStageIndex < 0) appendVerificationSessionJournalEvent({
      sessionRevision: prepared.sessionRevision, targetStage: 'frozen', kind: 'completed',
      receiptDigest: prepared.sessionRevision, operationId: null, fs: journalFs });
    let hosted = selectTrustedHostedSessionArtifact({ github, repository,
      transports: github.observeActionsArtifacts(repository), request: prepared.request });
    const localExecutionEnvironment = createCiVerificationLocalExecutionEnvironment({
      os: process.platform,
      arch: process.arch,
      bunVersion: Bun.version
    });
    const localVerification = hosted === null && reviewBarrierAllowsExecution
      ? await executePreparedLocalQuickDag({
          ctx,
          authorityRoot: repositoryRoot,
          candidate,
          sessionRevision: prepared.sessionRevision,
          actionPlanClosure: prepareLocalQuickVerificationActionPlan({
            candidate,
            manifestPath,
            manifestDigest,
            changedPaths,
            testImpactTransition: changedSelection.testImpactTransition,
            testImpactSourceProvider: changedSelection.testImpactSourceProvider,
            expectedTestImpactTransitionDigest: prepared.testImpactTransitionDigest,
            scopeAuthorizationRevision: prepared.scopeAuthorizationRevision,
            executionEnvironment: localExecutionEnvironment,
            dependencyBlobs
          }),
          executionEnvironment: localExecutionEnvironment,
          environment
        })
      : null;
    if (hosted === null && localVerification?.result.status === 'passed') {
      // The local DAG may run long enough for another coordinator to publish.
      // Re-read provider state before deciding whether a wake-up is necessary.
      hosted = selectTrustedHostedSessionArtifact({ github, repository,
        transports: github.observeActionsArtifacts(repository), request: prepared.request });
    }
    let effectReviewBarrier: ReturnType<VerificationSessionGitHubClient['observeReviewBarrier']> =
      prepared.reviewBarrier;
    if (localVerification?.result.status === 'passed') {
      const effectCandidate = github.observeCandidate(repository, prNumber);
      const unchangedCandidate = effectCandidate.repository === candidate.repository
        && effectCandidate.number === candidate.number
        && effectCandidate.state === 'OPEN'
        && !effectCandidate.isDraft
        && !effectCandidate.isCrossRepository
        && effectCandidate.authorNodeId === candidate.authorNodeId
        && effectCandidate.baseBranch === candidate.baseBranch
        && effectCandidate.baseSha === prepared.request.expectedBaseSha
        && effectCandidate.baseTreeSha === prepared.request.expectedBaseTreeSha
        && effectCandidate.headBranch === candidate.headBranch
        && effectCandidate.headSha === prepared.request.expectedHeadSha
        && effectCandidate.headTreeSha === prepared.request.expectedHeadTreeSha
        && CodexDevelopmentParseWorkPackageLocator(effectCandidate.body) === prepared.request.manifestPath;
      if (!unchangedCandidate) {
        throw new Error('prepare candidate drifted after local quick verification and before Review wake-up.');
      }
      effectReviewBarrier = github.observeReviewBarrier({
        repository,
        prNumber,
        headSha: effectCandidate.headSha,
        excludedPrincipalNodeIds: new Set([effectCandidate.authorNodeId, principal.nodeId])
      });
    }
    if (effectReviewBarrier.status === 'provider-schema-unsupported') {
      return JSON.stringify({
        status: 'BLOCKED',
        sessionRevision: prepared.sessionRevision,
        reviewProvider: effectReviewBarrier,
        reviewWakeup: null,
        dispatchSignalSent: false,
        workflowJoin: null,
        localVerification
      }, null, 2);
    }
    const reviewWakeup = shouldPublishMaintainerReviewWakeup({
      reviewBarrierStatus: effectReviewBarrier.status,
      localVerificationStatus: localVerification?.result.status ?? null,
      hostedArtifactPresent: hosted !== null
    })
      ? ensureMaintainerReviewWakeup(ctx, github, {
          repository,
          prNumber,
          sessionRevision: prepared.sessionRevision,
          operationId: createVerificationSessionOperationId({
            sessionRevision: prepared.sessionRevision,
            operationKind: 'request-review',
            semanticInputDigest: prepared.request.requestOperationId
          }),
          requestOperationId: prepared.request.requestOperationId,
          headSha: prepared.request.expectedHeadSha,
          headTreeSha: prepared.request.expectedHeadTreeSha,
          publisherLogin: principal.login,
          publisherNodeId: principal.nodeId
        })
      : null;
    const runJoin = github.observeVerificationSessionWorkflowJoin({ repository, prNumber,
      sessionRevision: prepared.sessionRevision,
      actionPlanDigest: prepared.request.expectedActionPlanDigest,
      baseSha: prepared.request.expectedBaseSha,
      now: now() });
    const effectReviewBarrierAllowsExecution = effectReviewBarrier.status === 'clear'
      || effectReviewBarrier.status === 'waiting';
    const localAllowsHostedSignal = localVerification === null
      ? hosted !== null
      : localVerification.result.status === 'passed';
    const dispatchSignalSent = effectReviewBarrierAllowsExecution
      && localAllowsHostedSignal && hosted === null && runJoin.status === 'redispatch-eligible';
    if (dispatchSignalSent) {
      // repository_dispatch is deliberately only an at-least-once wake-up
      // signal. The serialized hosted coordinator owns Review-request and
      // candidate execution dedup; the local journal is cache, not authority.
      github.ensureVerificationSessionWakeup(repository, prepared.request);
    }
    if (effectReviewBarrier.status === 'blocked') return JSON.stringify({ status: 'BLOCKED',
      sessionRevision: prepared.sessionRevision, reason: effectReviewBarrier.reason,
      reviewWakeup, dispatchSignalSent, workflowJoin: runJoin, localVerification: null }, null, 2);
    if (localVerification !== null && localVerification.result.status !== 'passed') {
      return JSON.stringify({
        status: localVerification.result.status === 'failed'
          ? 'LOCAL_VERIFICATION_FAILED' : 'LOCAL_VERIFICATION_BLOCKED',
        sessionRevision: prepared.sessionRevision,
        reason: localVerification.result.status === 'failed'
          ? 'local quick Action DAG failed; hosted dispatch is forbidden'
          : 'local quick Action DAG did not acquire a terminal journal result; hosted dispatch is forbidden',
        requestOperationId: prepared.request.requestOperationId,
        reviewWakeup,
        dispatchSignalSent,
        workflowJoin: runJoin,
        localVerification
      }, null, 2);
    }
    return JSON.stringify({
      status: effectReviewBarrier.status === 'clear'
        ? hosted !== null ? 'HOSTED_VERIFICATION_AVAILABLE' : 'WAITING_HOSTED_VERIFICATION'
        : 'WAITING_REVIEW',
      sessionRevision: prepared.sessionRevision, reason: effectReviewBarrier.status === 'clear'
        ? hosted !== null ? 'joined exact remote Session artifact'
          : runJoin.status === 'joined' ? `joined hosted coordinator ${runJoin.reason}` : 'hosted coordinator signaled'
        : `${effectReviewBarrier.reason}; hosted coordinator owns the canonical Review request`,
      requestOperationId: prepared.request.requestOperationId,
      reviewWakeup,
      dispatchSignalSent,
      workflowJoin: runJoin,
      localVerification,
      dispatchSemantics: 'at-least-once-signal-not-authority'
    }, null, 2);
  }
  if (command === 'freeze') {
    const artifact = CodexDevelopmentParseVerificationSessionArtifact(
      readFileSync(path.resolve(required(args, '--artifact')), 'utf8')
    );
    writeDurable(required(args, '--session-output'), artifact.session);
    writeDurable(required(args, '--scope-output'), artifact.scopeAuthorization);
    return JSON.stringify({ status: 'frozen', sessionRevision: artifact.session.sessionRevision,
      sessionOutput: path.resolve(required(args, '--session-output')),
      scopeOutput: path.resolve(required(args, '--scope-output')) }, null, 2);
  }
  if (command === 'status-offline') {
    const session = parseVerificationSession(readFileSync(path.resolve(required(args, '--session-file')), 'utf8'));
    const journal = readVerificationSessionJournal({
      sessionRevision: session.sessionRevision,
      fs: durableJournalFs()
    });
    return JSON.stringify({ mode: 'offline-projection', session, journal }, null, 2);
  }
  // CLI command routing selects a closed operation; each branch parses and validates its own exact authority.
  // codeql[js/user-controlled-bypass]
  if (command === 'status') {
    const request = parseVerificationSessionHostedRequest(
      readFileSync(path.resolve(required(args, '--request')), 'utf8')
    );
    const github = githubAdapter();
    const candidate = github.observeCandidate(repository, request.prNumber);
    const publications = observeIntegrationAuthorizationOperationPublications(ctx.repositoryRoot, { repository,
      pullRequestNumber: request.prNumber, sessionRevision: request.expectedSessionRevision });
    const durable = observeDurableVerificationSessionProjection({ ctx, github, repository, request,
      candidate, publications });
    if (durable !== null) return JSON.stringify(durable, null, 2);
    const hosted = selectTrustedHostedSessionArtifact({ github, repository,
      transports: github.observeActionsArtifacts(repository), request });
    if (hosted === null) {
      const workflowJoin = github.observeVerificationSessionWorkflowJoin({ repository,
        prNumber: request.prNumber, sessionRevision: request.expectedSessionRevision,
        actionPlanDigest: request.expectedActionPlanDigest, baseSha: request.expectedBaseSha });
      return JSON.stringify({ mode: 'remote', status: workflowJoin.status === 'joined'
        ? 'WAITING_HOSTED_VERIFICATION' : 'HOSTED_REDISPATCH_ELIGIBLE', repository,
      prNumber: request.prNumber, sessionRevision: request.expectedSessionRevision, workflowJoin }, null, 2);
    }
    const artifact = hosted.artifact;
    const reuse = classifyVerificationSessionArtifactReuse(artifact, now());
    return JSON.stringify({ mode: 'remote', status: artifact.evidence.status !== 'passed' ? 'BLOCKED'
      : reuse.status === 'whole-artifact-current'
        ? 'WAITING_INTEGRATION_AUTHORIZATION' : 'WAITING_HOSTED_AUTHORITY_REFRESH',
      reason: reuse.status === 'whole-artifact-current' ? null : reuse.reason,
      repository, prNumber: request.prNumber, sessionRevision: request.expectedSessionRevision,
      candidateState: candidate.state, evidenceStatus: artifact.evidence.status,
      artifactReuse: reuse.status }, null, 2);
  }
  // CLI command routing selects a closed operation; each branch parses and validates its own exact authority.
  // codeql[js/user-controlled-bypass]
  if (command === 'observe-hosted') {
    const request = parseVerificationSessionHostedRequest(readFileSync(path.resolve(required(args, '--request')), 'utf8'));
    const github = githubAdapter();
    const eventPayload = event();
    const compilerIdentity = assertHostedCompilerIdentity({ ctx, github, repository,
      event: eventPayload, request, environment, repositoryRoot });
    const candidate = github.observeCandidate(repository, request.prNumber);
    const candidateChecks: readonly [unknown, unknown, string][] = [
      [candidate.baseSha, request.expectedBaseSha, 'base'], [candidate.baseTreeSha, request.expectedBaseTreeSha, 'base tree'],
      [candidate.headSha, request.expectedHeadSha, 'head'], [candidate.headTreeSha, request.expectedHeadTreeSha, 'head tree']
    ];
    for (const [actual, expected, label] of candidateChecks) if (actual !== expected) throw new Error(`observe-hosted ${label} drifted.`);
    if (CodexDevelopmentParseWorkPackageLocator(candidate.body) !== request.manifestPath) throw new Error('observe-hosted manifest locator drifted.');
    const manifestSource = github.readBlobText(repository, request.expectedHeadSha, request.manifestPath);
    if (CodexDevelopmentWorkPackageManifestDigest(manifestSource) !== request.manifestDigest) throw new Error('observe-hosted manifest digest drifted.');
    const manifest = CodexDevelopmentParseCurrentWorkPackageManifest(manifestSource);
    const changedSelection = await observeVerificationSessionChangedSelection({
      repositoryRoot,
      repository,
      prNumber: request.prNumber,
      candidate,
      github
    });
    const changedPaths = changedSelection.changedPaths;
    CodexDevelopmentAssertWorkPackageOwnership(manifest, [...changedPaths]);
    const dependencyBlobs = observeVerificationSessionActionDependencyBlobs({ github, repository,
      baseSha: request.expectedBaseSha, headSha: request.expectedHeadSha });
    const reviewBarrier = github.observeReviewBarrier({ repository, prNumber: request.prNumber,
      headSha: request.expectedHeadSha,
      excludedPrincipalNodeIds: new Set([candidate.authorNodeId, compilerIdentity.actorNodeId]) });
    if (reviewBarrier.status === 'provider-schema-unsupported') {
      return JSON.stringify({ status: 'BLOCKED', sessionRevision: request.expectedSessionRevision,
        reviewProvider: reviewBarrier, output: null }, null, 2);
    }
    if (reviewBarrier.status === 'blocked') {
      throw new Error(`observe-hosted Review barrier blocked: ${reviewBarrier.reason}`);
    }
    if (reviewBarrier.status === 'waiting') {
      const operationId = createVerificationSessionOperationId({
        sessionRevision: request.expectedSessionRevision,
        operationKind: 'request-review', semanticInputDigest: request.requestOperationId
      });
      // The hosted writer publishes only a non-triggering locator. It is an
      // audit projection, not a Codex activation or Review authority.
      const reviewLocator = ensureHostedReviewLocator(ctx, github, { repository,
        prNumber: request.prNumber, sessionRevision: request.expectedSessionRevision,
        operationId, headSha: request.expectedHeadSha, headTreeSha: request.expectedHeadTreeSha,
        sourceRunId: compilerIdentity.runId, sourceRunAttempt: compilerIdentity.runAttempt,
        workflowRef: `.github/workflows/compiler-pr-validation.yml@${request.expectedBaseSha}` });
      return JSON.stringify({ status: 'WAITING_REVIEW', sessionRevision: request.expectedSessionRevision,
        reviewLocator: reviewLocator.status, reviewLocatorCommentId: reviewLocator.commentId,
        reviewLocatorPublicationDigest: reviewLocator.publicationDigest, output: null }, null, 2);
    }
    if (reviewBarrier.status !== 'clear') throw new Error('observe-hosted Review barrier did not narrow to clear.');
    const observedAt = now();
    const observedFacts = reconstructVerificationSessionHostedFacts({
      request, repository, candidate, changedPaths,
      testImpactTransition: changedSelection.testImpactTransition,
      testImpactSourceProvider: changedSelection.testImpactSourceProvider,
      integrationPrincipalNodeId: compilerIdentity.actorNodeId,
      producerPrincipalNodeId: compilerIdentity.actorNodeId, sourceRunId: compilerIdentity.runId,
      sourceRef: `.github/workflows/compiler-pr-validation.yml@${request.expectedBaseSha}`, observedAt, reviewBarrier,
      mainHealthChecks: github.observeChecks(repository, request.expectedBaseSha), dependencyBlobs });
    // Facts are diagnostic/reconstruction input only. A Review receipt is
    // minted later by prepare-hosted from its own fresh private observation.
    writeDurable(required(args, '--output'), observedFacts);
    return JSON.stringify({ status: 'observed', output: path.resolve(required(args, '--output')) }, null, 2);
  }
  if (command === 'prepare-hosted') {
    const request = parseVerificationSessionHostedRequest(readFileSync(path.resolve(required(args, '--request')), 'utf8'));
    const facts = readJson<VerificationSessionHostedFacts>(required(args, '--facts'));
    const github = githubAdapter();
    const candidate = github.observeCandidate(facts.repository, request.prNumber);
    const reviewBarrier = github.observeReviewBarrier({ repository: facts.repository, prNumber: request.prNumber,
      headSha: request.expectedHeadSha,
      excludedPrincipalNodeIds: new Set([candidate.authorNodeId, facts.integrationPrincipalNodeId]) });
    if (reviewBarrier.status !== 'clear') {
      throw new Error(`prepare-hosted fresh Review barrier is ${reviewBarrier.status}.`);
    }
    const envelope = prepareVerificationSessionHosted({ request,
      facts: Object.freeze({ ...facts, candidate, reviewBarrier }), now: now() });
    writeDurable(required(args, '--output'), envelope);
    return JSON.stringify({ status: 'prepared', envelopeDigest: envelope.envelopeDigest, output: path.resolve(required(args, '--output')) }, null, 2);
  }
  if (command === 'artifact-status') {
    const artifact = CodexDevelopmentParseVerificationSessionArtifact(
      readFileSync(path.resolve(required(args, '--artifact')), 'utf8')
    );
    return JSON.stringify(classifyVerificationSessionArtifactReuse(artifact, now()), null, 2);
  }
  if (command === 'finalize-hosted') {
    const evidencePath = args.get('--evidence');
    const previousArtifactPath = args.get('--previous-artifact');
    if ((evidencePath === undefined) === (previousArtifactPath === undefined)) {
      throw new Error('finalize-hosted requires exactly one of --evidence or --previous-artifact.');
    }
    const envelope = readJson<VerificationSessionHostedEnvelope>(required(args, '--envelope'));
    const artifact = evidencePath !== undefined
      ? finalizeVerificationSessionHostedArtifact({ envelope,
          evidence: readJson<Parameters<typeof finalizeVerificationSessionHostedArtifact>[0]['evidence']>(evidencePath) })
      : (() => {
          const previousArtifact = CodexDevelopmentParseVerificationSessionArtifact(
            readFileSync(path.resolve(previousArtifactPath!), 'utf8')
          );
          const eventPayload = event();
          const github = githubAdapter();
          const actor = github.observePrincipal(envelope.session.repository, hostedActorHandle(eventPayload));
          if (actor.permission !== 'admin' && actor.permission !== 'maintain') {
            throw new Error('trusted artifact refresh actor lacks maintain/admin permission.');
          }
          const runId = environment.GITHUB_RUN_ID ?? '';
          if (!/^[1-9][0-9]*$/u.test(runId)) throw new Error('GITHUB_RUN_ID is required for trusted artifact refresh.');
          const producer = CodexDevelopmentCreateVerificationEvidenceProducer({
            sourceTransport: 'github-actions', workflowPath: '.github/workflows/compiler-pr-validation.yml',
            workflowRef: `.github/workflows/compiler-pr-validation.yml@${envelope.session.baseSha}`,
            workflowSha: envelope.session.baseSha, runId,
            runAttempt: positiveEnvironmentInteger('GITHUB_RUN_ATTEMPT', environment), actorNodeId: actor.nodeId
          });
          return refreshVerificationSessionHostedArtifact({ envelope, previousArtifact, producer,
            refreshedAt: now() });
        })();
    writeCanonicalDurable(required(args, '--output'), artifact);
    return JSON.stringify({ status: 'finalized', artifactDigest: artifact.artifactDigest, output: path.resolve(required(args, '--output')) }, null, 2);
  }
  // CLI command routing selects a closed operation; each branch parses and validates its own exact authority.
  // codeql[js/user-controlled-bypass]
  if (command === 'resume') {
    const request = parseVerificationSessionHostedRequest(
      readFileSync(path.resolve(required(args, '--request')), 'utf8')
    );
    const github = githubAdapter();
    const candidate = github.observeCandidate(repository, request.prNumber);
    const authorizationPublications = observeIntegrationAuthorizationOperationPublications(ctx.repositoryRoot, {
      repository, pullRequestNumber: request.prNumber,
      sessionRevision: request.expectedSessionRevision
    });
    const durable = observeDurableVerificationSessionProjection({ ctx, github, repository, request,
      candidate, publications: authorizationPublications });
    if (durable !== null) return JSON.stringify(durable, null, 2);
    const allArtifacts = github.observeActionsArtifacts(repository);
    const hosted = selectTrustedHostedSessionArtifact({ github, repository,
      transports: allArtifacts, request });
    const runJoin = github.observeVerificationSessionWorkflowJoin({ repository,
      prNumber: request.prNumber, sessionRevision: request.expectedSessionRevision,
      actionPlanDigest: request.expectedActionPlanDigest, baseSha: request.expectedBaseSha });
    if (hosted === null) {
      const redispatched = runJoin.status === 'redispatch-eligible';
      if (redispatched) {
        github.ensureVerificationSessionWakeup(repository, request);
      }
      return JSON.stringify({ status: 'WAITING_HOSTED_VERIFICATION',
        sessionRevision: request.expectedSessionRevision,
        reason: redispatched
          ? 'trusted hosted artifact is not available; hosted coordinator was re-signaled'
          : `joined hosted coordinator ${runJoin.reason}`,
        redispatched, workflowJoin: runJoin,
        dispatchSemantics: 'at-least-once-signal-not-authority' }, null, 2);
    }
    const reuse = classifyVerificationSessionArtifactReuse(hosted.artifact, now());
    if (hosted.artifact.evidence.status !== 'passed') {
      return JSON.stringify({ status: 'BLOCKED', sessionRevision: request.expectedSessionRevision,
        reason: `hosted Action evidence is ${hosted.artifact.evidence.status}`,
        candidateState: candidate.state, workflowJoin: runJoin }, null, 2);
    }
    if (reuse.status !== 'whole-artifact-current') {
      const redispatched = runJoin.status === 'redispatch-eligible';
      if (redispatched) {
        github.ensureVerificationSessionWakeup(repository, request);
      }
      return JSON.stringify({ status: 'WAITING_HOSTED_AUTHORITY_REFRESH',
        sessionRevision: request.expectedSessionRevision, reason: reuse.reason,
        candidateState: candidate.state, redispatched, workflowJoin: runJoin,
        dispatchSemantics: 'at-least-once-signal-not-authority' }, null, 2);
    }
    return JSON.stringify({ status: 'WAITING_INTEGRATION_AUTHORIZATION',
      sessionRevision: request.expectedSessionRevision,
      reason: 'fresh exact hosted Session artifact is available; no durable App authorization receipt exists',
      candidateState: candidate.state, workflowJoin: runJoin }, null, 2);
  }
  // CLI command routing selects a closed operation; each branch parses and validates its own exact authority.
  // codeql[js/user-controlled-bypass]
  if (command === 'prepare-integration-hosted') {
    const github = githubAdapter();
    const eventPayload = event();
    const hosted = loadHostedArtifactForMergeWorkflow(github, repository, eventPayload);
    const artifact = hosted.artifact;
    if (artifact.session.repository !== repository) {
      throw new Error('prepare-integration-hosted repository differs from the authenticated Session artifact.');
    }
    const candidate = github.observeCandidate(repository, artifact.session.prNumber);
    const outputPath = required(args, '--output');
    const candidateRoute = routeHostedIntegration({ repository, session: artifact.session,
      candidate, priorEffectStarted: false, authorizationPublicationCount: 0 });
    if (candidateRoute.lane === 'blocked') {
      const projection = Object.freeze({ ...candidateRoute,
        effects: planHostedIntegrationEffects(candidateRoute), observedAt: now() });
      writeDurable(outputPath, projection);
      return JSON.stringify({ ...projection, output: path.resolve(outputPath) }, null, 2);
    }
    const identity = assertHostedIntegrationIdentity({ ctx, github, repository, event: eventPayload,
      session: artifact.session, candidate, phase: 'recoveryPreparation', environment, repositoryRoot });
    const publications = observeIntegrationAuthorizationOperationPublications(ctx.repositoryRoot, { repository,
      pullRequestNumber: artifact.session.prNumber, sessionRevision: artifact.session.sessionRevision });
    const route = routeHostedIntegration({ repository, session: artifact.session, candidate,
      priorEffectStarted: identity.phase.priorEffectStarted,
      authorizationPublicationCount: publications.length });
    const effects = planHostedIntegrationEffects(route);
    if (route.lane === 'blocked') {
      const projection = Object.freeze({ ...route, effects, observedAt: now() });
      writeDurable(outputPath, projection);
      return JSON.stringify({ ...projection, output: path.resolve(outputPath) }, null, 2);
    }
    if (route.lane === 'merged-recovery') {
      const original = loadMarkerBoundMergedAuthorizationRecovery({ ctx, github, repository,
        session: artifact.session, candidate, publications });
      const projection = Object.freeze({ ...route, effects,
        authorizationPublicationId: original.selected.publication.authorizationPublicationId,
        authorizationCommentId: original.selected.commentId,
        authorizationReceiptDigest: original.selected.publication.authorizationReceiptDigest,
        recoveryArtifact: Object.freeze({ artifactId: original.recovery.metadata.artifactId,
          artifactName: original.recovery.metadata.artifactName,
          artifactFileName: BRANCH_CLOSEOUT_RECOVERY_ARTIFACT_FILE_NAME,
          artifactDigest: original.recovery.artifact.artifactDigest,
          runId: original.recovery.metadata.runId,
          runAttempt: original.recovery.metadata.runAttempt }),
        observedAt: now() });
      writeDurable(outputPath, projection);
      return JSON.stringify({ ...projection, output: path.resolve(outputPath) }, null, 2);
    }
    if (!effects.prepareRecoveryArtifact) {
      throw new Error('OPEN hosted integration route did not authorize recovery preparation.');
    }
    const preflight = evaluateFreshHostedIntegration({ github, repository, hosted, candidate,
      provenance: identity.provenance, observedAt: now() });
    writeDurable(
      hostedIntegrationPreflightResultPath(ctx.repositoryRoot),
      preflight.result
    );
    const prepared = prepareMergedPullRequestCloseout(ctx, { number: artifact.session.prNumber,
      headBranch: candidate.headBranch, headSha: artifact.session.headSha });
    const recovery = materializeBranchCloseoutRecoveryArtifact({ outputPath, repository,
      session: artifact.session, prepared, runId: identity.provenance.runId,
      runAttempt: identity.provenance.runAttempt, environment });
    const projection = Object.freeze({ ...route, effects,
      preflightResultDigest: preflight.result.resultDigest,
      recoveryArtifact: Object.freeze({ artifactName: recovery.artifactName,
        artifactFileName: BRANCH_CLOSEOUT_RECOVERY_ARTIFACT_FILE_NAME,
        artifactFilePath: recovery.artifactFilePath,
        artifactDigest: recovery.artifact.artifactDigest }), observedAt: now() });
    writeDurable(outputPath, projection);
    return JSON.stringify({ ...projection, output: path.resolve(outputPath) }, null, 2);
  }
  // CLI command routing selects a closed operation; each branch parses and validates its own exact authority.
  // codeql[js/user-controlled-bypass]
  if (command === 'integrate-hosted') {
    const github = githubAdapter();
    const eventPayload = event();
    const hosted = loadHostedArtifactForMergeWorkflow(github, repository, eventPayload);
    const artifact = hosted.artifact;
    if (artifact.session.repository !== repository) {
      throw new Error('integrate-hosted repository differs from the authenticated Session artifact.');
    }
    let candidate = github.observeCandidate(repository, artifact.session.prNumber);
    let boundPostMergeMainSha: string | null = null;
    if (candidate.state === 'MERGED') {
      const synchronized = synchronizeTrustedRemoteDefaultRef({ ctx });
      boundPostMergeMainSha = assertBoundPostMergeMain({ ctx, repository,
        session: artifact.session, candidate, lane: 'merged-recovery',
        liveMainSha: synchronized.defaultSha, environment });
    }
    const hostedIdentity = assertHostedIntegrationIdentity({ ctx, github, repository,
      event: eventPayload, session: artifact.session, candidate, phase: 'closeoutMutation',
      environment, repositoryRoot });
    const hostedProvenance = hostedIdentity.provenance;
    const integrationNow = now();
    const expectedConsumptionOperationId = createVerificationSessionMergeOperationId({
      sessionRevision: artifact.session.sessionRevision, headSha: artifact.session.headSha,
      actionPlanDigest: artifact.evidence.actionPlan.actionPlanDigest });
    const remoteAttempts = observeIntegrationAuthorizationOperationPublications(ctx.repositoryRoot, { repository,
      pullRequestNumber: artifact.session.prNumber, sessionRevision: artifact.session.sessionRevision });
    const route = routeHostedIntegration({ repository, session: artifact.session, candidate,
      priorEffectStarted: hostedIdentity.phase.priorEffectStarted,
      authorizationPublicationCount: remoteAttempts.length });
    const effects = planHostedIntegrationEffects(route);
    if (route.lane === 'blocked') {
      throw new Error(`AMBIGUOUS_SIDE_EFFECT: hosted integration route is blocked: ${route.reason}`);
    }

    let selected: Readonly<{ commentId: number;
      publication: IntegrationAuthorizationOperationPublication }>;
    let selectedRecovery: ReturnType<typeof loadProviderBranchCloseoutRecoveryArtifact>;
    let originalHostPrepared: PreparedBranchCloseoutEnvelope | null = null;
    let ownsUnambiguousMergeStart = false;
    let issueDispositionPlan: IssueDispositionPlan | null = null;

    if (route.lane === 'merged-recovery') {
      const original = loadMarkerBoundMergedAuthorizationRecovery({ ctx, github, repository,
        session: artifact.session, candidate, publications: remoteAttempts });
      selected = original.selected;
      selectedRecovery = original.recovery;
    } else {
      if (!effects.createAuthorizationPublication || !effects.executePhysicalMerge) {
        throw new Error('OPEN hosted integration route did not authorize first-effect execution.');
      }
      if (candidate.state !== 'OPEN' || candidate.baseSha !== artifact.session.baseSha
        || candidate.baseTreeSha !== artifact.session.baseTreeSha
        || candidate.headSha !== artifact.session.headSha
        || candidate.headTreeSha !== artifact.session.headTreeSha
        || candidate.isDraft || candidate.isCrossRepository) {
        throw new Error('integrate-hosted OPEN candidate identity drifted before authorization.');
      }
      const existingOperationAttempts = remoteAttempts.filter(({ publication }) => (
        publication.consumptionOperationId === expectedConsumptionOperationId
        || publication.result.authorization.headSha === artifact.session.headSha
      ));
      if (existingOperationAttempts.length > 0) {
        throw new Error('AMBIGUOUS_SIDE_EFFECT: OPEN candidate already has a remote authorization start publication.');
      }
      const evaluation = evaluateFreshHostedIntegration({ github, repository, hosted, candidate,
        provenance: hostedProvenance, observedAt: integrationNow });
      issueDispositionPlan = evaluation.issueDispositionPlan;
      const frozenPreflight = CodexDevelopmentParseMergeGateResult(readFileSync(
        hostedIntegrationPreflightResultPath(ctx.repositoryRoot),
        'utf8'
      ));
      const expectedPreflightDigest = environment.EXPECTED_PREFLIGHT_RESULT_DIGEST;
      if (expectedPreflightDigest === undefined
        || frozenPreflight.resultDigest !== expectedPreflightDigest) {
        throw new Error('integrate-hosted downloaded preflight digest differs from the terminal status binding.');
      }
      assertHostedIntegrationPreflightStillControls({
        frozen: frozenPreflight,
        fresh: evaluation.result
      });
      if (frozenPreflight.authorization.consumptionOperationId !== expectedConsumptionOperationId) {
        throw new Error('Frozen merge-gate preflight changed the stable consumption operation identity.');
      }
      const recovery = loadProviderBranchCloseoutRecoveryArtifact({ ctx, github, repository,
        session: artifact.session, runId: hostedProvenance.runId,
        runAttempt: hostedProvenance.runAttempt });
      selectedRecovery = recovery;
      originalHostPrepared = loadOriginalHostPreparedCloseout({ ctx,
        outputPath: required(args, '--output'), providerRecovery: recovery });
      const publication = createIntegrationAuthorizationOperationPublication({
        result: frozenPreflight, closeoutPreparation: recovery.remotePrepared,
        recoveryArtifact: { artifactId: recovery.metadata.artifactId,
          artifactName: recovery.metadata.artifactName,
          artifactFileName: BRANCH_CLOSEOUT_RECOVERY_ARTIFACT_FILE_NAME,
          artifactDigest: recovery.artifact.artifactDigest,
          runId: recovery.metadata.runId, runAttempt: recovery.metadata.runAttempt },
        provenance: hostedProvenance });
      const published = publishHostedIntegrationAuthorizationOperation(ctx, publication);
      if (published.status !== 'published' || !published.createdByThisInvocation
        || published.publication === null || published.commentId === null) {
        throw new Error(`AMBIGUOUS_SIDE_EFFECT: Integration authorization start publication was not newly and exactly created: ${published.detail}`);
      }
      if (published.publication.provenance.runId !== hostedProvenance.runId
        || published.publication.provenance.runAttempt !== hostedProvenance.runAttempt
        || published.publication.provenance.workflowRef !== hostedProvenance.workflowRef
        || published.publication.provenance.actorNodeId !== hostedProvenance.actorNodeId) {
        throw new Error('AMBIGUOUS_SIDE_EFFECT: authorization start publication owner differs from this hosted invocation.');
      }
      selected = Object.freeze({ publication: published.publication, commentId: published.commentId });
      ownsUnambiguousMergeStart = true;
    }

    const authorizationResult = selected.publication.result;
    const authorizationSource = createTrustedIntegrationAuthorizationPublicationSource({
      publication: selected.publication, commentId: selected.commentId });
    const trustedHosted = createTrustedHostedArtifactProvenance({ artifact,
      artifactText: hosted.originText, observation: hosted.originMetadata,
      actorPermission: hosted.originMetadata.actorPermission });
    const localPrepared = selectedRecovery.prepared;
    const changedPaths = route.lane === 'merged-recovery'
      ? artifact.scopeAuthorization.authorizedPaths
      : github.observeChangedPaths({ repository, prNumber: artifact.session.prNumber,
          state: 'OPEN', draft: false,
          baseSha: artifact.session.baseSha, headSha: artifact.session.headSha }).paths;
    const external = {
      now,
      expiresAt: addSeconds,
      trustedRuntimeProof: (session: typeof artifact.session) => inspectTrustedRuntime({
        repositoryRoot, candidateHeadSha: session.headSha }),
      runLocalActions: () => artifact.evidence.status === 'passed'
        ? { status: 'passed' as const, resultDigest: artifact.evidence.evidenceDigest as `sha256:${string}` }
        : { status: 'failed' as const, reason: `hosted Action evidence is ${artifact.evidence.status}` },
      hostedArtifact: () => ({ artifact, provenance: trustedHosted }),
      saveReviewReceipt: () => undefined,
      integrationAuthorizationArtifact: () => authorizationSource,
      integrationAuthorizationPublication: () => ({
        authorizationId: selected.publication.authorizationId,
        authorizationReceiptDigest: selected.publication.authorizationReceiptDigest,
        consumptionOperationId: selected.publication.consumptionOperationId,
        authorizationPublicationId: selected.publication.authorizationPublicationId,
        authorizationPublicationDigest: selected.publication.publicationDigest,
        commentId: selected.commentId,
        preparationDigest: localPrepared.preparation.preparationDigest
      }),
      consumedAuthorizationIds: () => {
        const observed = github.observeCandidate(repository, artifact.session.prNumber);
        if (observed.state !== 'MERGED' || observed.mergeCommitMessage === null) return new Set<string>();
        const markers = integrationMergeMarkers({
          sessionRevision: artifact.session.sessionRevision,
          authorizationId: selected.publication.authorizationId,
          authorizationReceiptDigest: selected.publication.authorizationReceiptDigest,
          consumptionOperationId: selected.publication.consumptionOperationId,
          authorizationPublicationId: selected.publication.authorizationPublicationId,
          authorizationPublicationDigest: selected.publication.publicationDigest,
          commentId: selected.commentId
        });
        return markers.every((marker) => observed.mergeCommitMessage!.split(/\r?\n/u).includes(marker))
          ? new Set([selected.publication.authorizationId]) : new Set<string>();
      },
      observeCloseoutPreparation: () => ({ status: 'prepared' as const,
        preparationDigest: localPrepared.preparation.preparationDigest }),
      observeCloseoutBinding: (_authorization: typeof authorizationResult.authorization,
        session: typeof artifact.session, merged: GitHubCandidateObservation) => {
        if (merged.mergeCommitSha === null || merged.mergeCommitTreeSha === null) {
          return { status: 'waiting' as const, reason: 'exact merge readback is unavailable' };
        }
        return { status: 'available' as const, binding: createBranchCloseoutOperationBinding({
          integrationAuthorization: authorizationResult.authorization,
          preparation: localPrepared.preparation, newMainSha: merged.mergeCommitSha,
          newMainTreeSha: merged.mergeCommitTreeSha, candidateTreeSha: session.headTreeSha }) };
      },
      observeCloseout: (binding: ReturnType<typeof createBranchCloseoutOperationBinding>) => {
        const observed = observeBranchCloseoutOperationPublication(ctx.repositoryRoot, { repository,
          pullRequestNumber: artifact.session.prNumber, closeoutOperationId: binding.closeoutOperationId });
        if (observed === null) return { status: 'waiting' as const,
          reason: 'terminal remote closeout publication is unavailable' };
        const status = observed.publication.receipt.closeoutStatus;
        if (status === 'blocked' || status === 'residue') return { status: 'blocked' as const,
          reason: `branch closeout terminal ${status}` };
        return { status, receiptDigest: `sha256:${createHash('sha256').update(
          encodeVerificationActionData({ closeoutOperationId: binding.closeoutOperationId,
            publicationDigest: observed.publication.publicationDigest, commentId: observed.commentId })
        ).digest('hex')}` as const };
      }
    };
    const reduce = (journalFs: VerificationSessionJournalFileSystem) => resumeVerificationSession({ repositoryRoot,
      session: artifact.session, scopeAuthorization: artifact.scopeAuthorization, changedPaths,
      integrationPrincipalNodeId: authorizationResult.provenance.actorNodeId, github, external, journalFs });
    let result = reduce(createEphemeralVerificationSessionJournalFs(durableJournalFs().rootPath));
    let issueReconciliation: Readonly<Record<string, unknown>> = Object.freeze({
      status: 'not-observed', results: Object.freeze([])
    });
    const stopCloseoutForIssueReconciliation = (mergedCandidate: GitHubCandidateObservation): never => {
      const projection = Object.freeze({ schema: 'sec-verification-session-integration-projection-v1',
        repository, prNumber: artifact.session.prNumber, sessionRevision: artifact.session.sessionRevision,
        lane: route.lane, effects,
        authorizationId: selected.publication.authorizationId,
        authorizationReceiptDigest: selected.publication.authorizationReceiptDigest,
        authorizationPublicationId: selected.publication.authorizationPublicationId,
        authorizationCommentId: selected.commentId, status: 'BLOCKED',
        issueDispositionPlan,
        issueReconciliation,
        boundPostMergeMainSha,
        mergedCommitSha: mergedCandidate.mergeCommitSha,
        mergedCommitTreeSha: mergedCandidate.mergeCommitTreeSha,
        candidateTreeSha: artifact.session.headTreeSha,
        completedStage: result.completedStage, receiptDigest: result.receiptDigest,
        reason: 'external-maintainer-action-required: unexpected GitHub Issue closure requires reconciliation before closeout.',
        observedAt: now() });
      writeDurable(required(args, '--output'), projection);
      throw new Error('external-maintainer-action-required: unexpected GitHub Issue closure blocks MainHealth and branch closeout.');
    };
    if (candidate.state === 'MERGED') {
      issueReconciliation = observePostMergeIssueReconciliation({ repository,
        prNumber: artifact.session.prNumber, candidate });
      if (issueReconciliation.status === 'manual-action-required' || issueReconciliation.status === 'blocked') {
        stopCloseoutForIssueReconciliation(candidate);
      }
    }
    if (result.status === 'READY_TO_INTEGRATE') {
      if (!effects.executePhysicalMerge || !ownsUnambiguousMergeStart) {
        throw new Error('AMBIGUOUS_SIDE_EFFECT: this hosted invocation does not own a newly published merge start claim.');
      }
      candidate = github.observeCandidate(repository, artifact.session.prNumber);
      if (candidate.state !== 'OPEN' || candidate.baseSha !== artifact.session.baseSha
        || candidate.baseTreeSha !== artifact.session.baseTreeSha
        || candidate.headSha !== artifact.session.headSha || candidate.headTreeSha !== artifact.session.headTreeSha) {
        throw new Error('integrate-hosted candidate drifted immediately before physical merge.');
      }
      const fresh = reduce(createEphemeralVerificationSessionJournalFs(durableJournalFs().rootPath));
      if (fresh.status !== 'READY_TO_INTEGRATE'
        || fresh.operationId !== authorizationResult.authorization.consumptionOperationId) {
        throw new Error(`integrate-hosted effect guard changed before merge: ${fresh.status} ${fresh.reason}`);
      }
      const immediatePlan = observeExactIssueDispositionPlan({
        github,
        repository,
        candidate,
        manifestPath: artifact.session.manifestPath,
        manifestDigest: artifact.session.manifestDigest,
        tracking: CodexDevelopmentParseCurrentWorkPackageManifest(
          github.readBlobText(repository, artifact.session.headSha, artifact.session.manifestPath),
          artifact.session.manifestPath
        ).tracking
      });
      if (issueDispositionPlan === null
        || immediatePlan.planDigest !== issueDispositionPlan.planDigest) {
        throw new Error('integrate-hosted Issue disposition plan drifted immediately before merge.');
      }
      const markers = integrationMergeMarkers({
        sessionRevision: artifact.session.sessionRevision,
        authorizationId: selected.publication.authorizationId,
        authorizationReceiptDigest: selected.publication.authorizationReceiptDigest,
        consumptionOperationId: selected.publication.consumptionOperationId,
        authorizationPublicationId: selected.publication.authorizationPublicationId,
        authorizationPublicationDigest: selected.publication.publicationDigest,
        commentId: selected.commentId });
      const issueMarkers = [
        `Issue-Disposition-Plan: ${issueDispositionPlan.planDigest}`,
        `Issue-Disposition-Mode: ${issueDispositionPlan.mode}`,
        `Issue-Disposition-Tracking: ${issueDispositionPlan.trackingIssueNumber ?? 'none'}`,
        `Issue-Disposition-Prose: ${issueDispositionPlan.titleBodyDigest}`
      ];
      let providerResponse: HostedSynchronousSquashMergeResponse | null = null;
      let mergeCommandFailure: unknown = null;
      try {
        providerResponse = executeHostedSquashMerge({ ctx, repository, prNumber: artifact.session.prNumber,
          headSha: artifact.session.headSha, sessionRevision: artifact.session.sessionRevision,
          publication: selected.publication, commentId: selected.commentId, issueDispositionPlan });
      } catch (error) {
        mergeCommandFailure = error;
      }
      let merged: GitHubCandidateObservation;
      try {
        merged = github.observeCandidate(repository, artifact.session.prNumber);
      } catch (error) {
        const providerReason = mergeCommandFailure instanceof Error
          ? mergeCommandFailure.message
          : mergeCommandFailure === null ? 'provider reported success' : String(mergeCommandFailure);
        const readbackReason = error instanceof Error ? error.message : String(error);
        throw new Error('AMBIGUOUS_SIDE_EFFECT: synchronous hosted merge attempt requires recovery; '
          + `provider=${providerReason}; exact-readback=${readbackReason}`);
      }
      try {
        assertHostedSquashMergeCompletion({ candidate: merged,
          expectedBaseSha: artifact.session.baseSha,
          expectedHeadSha: artifact.session.headSha, expectedHeadTreeSha: artifact.session.headTreeSha,
          markers: [...markers, ...issueMarkers], reviewReceipt: selected.publication.result.reviewReceipt,
          expectedTitle: `Verified integration ${artifact.session.sessionRevision.slice(7, 19)}`,
          providerMergeCommitSha: providerResponse?.sha ?? null });
      } catch (readbackError) {
        const providerReason = mergeCommandFailure instanceof Error
          ? mergeCommandFailure.message
          : mergeCommandFailure === null ? 'provider reported success' : String(mergeCommandFailure);
        const readbackReason = readbackError instanceof Error ? readbackError.message : String(readbackError);
        throw new Error('AMBIGUOUS_SIDE_EFFECT: synchronous hosted merge attempt requires recovery; '
          + `provider=${providerReason}; exact-readback=${readbackReason}`);
      }
      issueReconciliation = observePostMergeIssueReconciliation({ repository,
        prNumber: artifact.session.prNumber, candidate: merged });
      if (issueReconciliation.status !== 'no-op') {
        stopCloseoutForIssueReconciliation(merged);
      }
      const synchronized = synchronizeTrustedRemoteDefaultRef({ ctx });
      if (route.lane !== 'open-first-effect' || originalHostPrepared === null) {
        throw new Error('external-maintainer-disposition-required: merged recovery has no same-process original-host closeout authority.');
      }
      boundPostMergeMainSha = assertBoundPostMergeMain({ ctx, repository,
        session: artifact.session, candidate: merged, lane: 'open-first-effect',
        liveMainSha: synchronized.defaultSha, environment });
      await joinExactPostMergeMainHealth({ ctx, github, repository,
        mainSha: boundPostMergeMainSha, environment });
      // The physical merge changed the default SHA and retired the active
      // package. Re-observe at the new stable phase instead of allowing the
      // pre-merge capability to authorize post-merge branch effects.
      ctx = await createBranchLifecycleVerificationScope(repositoryRoot);
      const worktreeCleanupTokens = await routePreparedWorktreeCleanupAttempt({
        foreignWorktreeObservationDigests: originalHostPrepared.foreignWorktreeObservations
          .map(({ observationDigest }) => observationDigest),
        targetCount: new Set(originalHostPrepared.preparation.worktreePathsAtPreparation).size,
        consumeLocalPreparedTargets: () => consumeSameHostWorktreeCloseout({ ctx,
          prepared: originalHostPrepared! })
      });
      const binding = createBranchCloseoutOperationBinding({
        integrationAuthorization: authorizationResult.authorization,
        preparation: originalHostPrepared.preparation,
        newMainSha: boundPostMergeMainSha, newMainTreeSha: merged.mergeCommitTreeSha!,
        candidateTreeSha: artifact.session.headTreeSha
      });
      await finalizeSameInvocationCloseout({ ctx, repository,
        pullRequestNumber: artifact.session.prNumber, prepared: originalHostPrepared,
        binding, authorizationPublication: selected.publication,
        authorizationCommentId: selected.commentId, recovery: selectedRecovery,
        provenance: hostedProvenance, phase: hostedIdentity.phase,
        worktreeCleanupTokens, now });
      result = reduce(durableJournalFs());
    }
    const mergedProjectionCandidate = github.observeCandidate(repository, artifact.session.prNumber);
    if (issueReconciliation.status === 'not-observed') {
      issueReconciliation = observePostMergeIssueReconciliation({ repository,
        prNumber: artifact.session.prNumber, candidate: mergedProjectionCandidate });
      if (issueReconciliation.status === 'manual-action-required' || issueReconciliation.status === 'blocked') {
        stopCloseoutForIssueReconciliation(mergedProjectionCandidate);
      }
    }
    const projection = Object.freeze({ schema: 'sec-verification-session-integration-projection-v1',
      repository, prNumber: artifact.session.prNumber, sessionRevision: artifact.session.sessionRevision,
      lane: route.lane, effects,
      authorizationId: selected.publication.authorizationId,
      authorizationReceiptDigest: selected.publication.authorizationReceiptDigest,
      authorizationPublicationId: selected.publication.authorizationPublicationId,
      authorizationCommentId: selected.commentId, status: result.status,
      issueDispositionPlan,
      issueReconciliation,
      boundPostMergeMainSha,
      mergedCommitSha: mergedProjectionCandidate.state === 'MERGED'
        ? mergedProjectionCandidate.mergeCommitSha : null,
      mergedCommitTreeSha: mergedProjectionCandidate.state === 'MERGED'
        ? mergedProjectionCandidate.mergeCommitTreeSha : null,
      candidateTreeSha: artifact.session.headTreeSha,
      completedStage: result.completedStage, receiptDigest: result.receiptDigest,
      reason: result.reason, observedAt: now() });
    writeDurable(required(args, '--output'), projection);
    return JSON.stringify({ ...projection, output: path.resolve(required(args, '--output')) }, null, 2);
  }
  if (command === 'closeout-mutate-hosted') {
    const github = githubAdapter();
    const eventPayload = event();
    const closeout = loadMergedHostedCloseoutContext({ ctx, github, repository,
      event: eventPayload, environment, repositoryRoot, phase: 'closeoutMutation' });
    const session = closeout.hosted.artifact.session;
    // A fresh process cannot rehydrate an opaque physical token.  The
    // immutable prepared target set may be consumed only in this process,
    // after the recovered envelope proves that it has no foreign target.
    // A foreign observation remains a typed blocker all the way through the
    // marker and finalizer; it is never cleared by command selection.
    let worktreeCleanupTokens: readonly WorktreePhysicalCloseoutConsumptionToken[] = [];
    const foreignWorktreeObservationDigests = closeout.recovery.prepared.foreignWorktreeObservations
      .map(({ observationDigest }) => observationDigest);
    const issueDisposition = observeHostedTrackingIssueDisposition({
      github, repository, closeout, observedAt: now()
    });
    const existing = observeBranchCloseoutOperationPublication(ctx.repositoryRoot, { repository,
      pullRequestNumber: session.prNumber, closeoutOperationId: closeout.binding.closeoutOperationId });
    if (existing !== null) {
      const terminalStatus = existing.publication.receipt.closeoutStatus;
      if (terminalStatus === 'blocked' || terminalStatus === 'residue') {
        throw new Error(`Hosted closeout terminal is ${terminalStatus}; it cannot be promoted to success.`);
      }
      const projection = Object.freeze({ schema: 'sec-verification-session-closeout-mutation-v1',
        repository, prNumber: session.prNumber, sessionRevision: session.sessionRevision,
        closeoutOperationId: closeout.binding.closeoutOperationId,
        issueDisposition,
        disposition: 'reused-terminal', closeoutStatus: terminalStatus,
        publicationDigest: existing.publication.publicationDigest,
        closeoutCommentId: existing.commentId, observedAt: now() });
      writeDurable(required(args, '--output'), projection);
      return JSON.stringify({ ...projection, output: path.resolve(required(args, '--output')) }, null, 2);
    }
    // An empty target list is ordinary no-worktree closeout.  It cannot erase
    // an original obligation: rehydrating a preparation with a target creates
    // a foreign observation above, which blocks before the private consumer
    // can run.
    worktreeCleanupTokens = await routePreparedWorktreeCleanupAttempt({
      foreignWorktreeObservationDigests,
      targetCount: new Set(closeout.recovery.prepared.preparation.worktreePathsAtPreparation).size,
      consumeLocalPreparedTargets: () => consumeSameHostWorktreeCloseout({
        ctx,
        prepared: closeout.recovery.prepared
      })
    });
    const expectedAuthorizationPublication = Object.freeze({
      authorizationPublicationId: closeout.selected.publication.authorizationPublicationId,
      publicationDigest: closeout.selected.publication.publicationDigest,
      commentId: closeout.selected.commentId
    });
    const expectedRecoveryArtifact = Object.freeze({
      artifactId: closeout.recovery.metadata.artifactId,
      artifactName: closeout.recovery.metadata.artifactName,
      artifactDigest: closeout.recovery.artifact.artifactDigest,
      runId: closeout.recovery.metadata.runId,
      runAttempt: closeout.recovery.metadata.runAttempt
    });
    const commonDir = commonGitDirectory(ctx, ctx.repositoryRoot);
    if (comparableFileSystemPath(commonDir)
        !== comparableFileSystemPath(closeout.recovery.prepared.preparation.repository.commonDir)) {
      throw new Error('Hosted closeout Git common directory changed before effect-start.');
    }
    const { effectStart, terminal } = await withWorkspaceWriteLease(commonDir, undefined, (coordinatedLease) => (
      withWorkspaceWriteLease(ctx.repositoryRoot, undefined, async (lease) => {
    await assertWorkspaceWriteLease(commonDir, coordinatedLease);
    let effectStart: HostedCloseoutEffectStartReadback;
    const observedStart = observeBranchCloseoutEffectStartPublication(ctx.repositoryRoot, { repository,
      pullRequestNumber: session.prNumber, closeoutOperationId: closeout.binding.closeoutOperationId });
    if (observedStart !== null) {
      assertBranchCloseoutEffectStartMatches({ publication: observedStart.publication,
        binding: closeout.binding, authorizationPublication: expectedAuthorizationPublication,
        recoveryArtifact: expectedRecoveryArtifact });
      const remoteBranch = observeExactRemoteCloseoutBranch(ctx, closeout.recovery.prepared);
      if (remoteBranch.state !== 'absent') {
        throw new Error(
          'AMBIGUOUS_SIDE_EFFECT: an existing closeout effect start marker forbids another remote deletion.'
        );
      }
      effectStart = Object.freeze({ disposition: 'existing', ...observedStart });
    } else {
      if (closeout.identity.phase.priorAttemptStarted) {
        throw new Error(
          'AMBIGUOUS_SIDE_EFFECT: a prior closeout mutation phase started without an exact effect start marker.'
        );
      }
      const remoteBranch = observeExactRemoteCloseoutBranch(ctx, closeout.recovery.prepared);
      if (remoteBranch.state !== 'present'
        || remoteBranch.sha !== closeout.recovery.prepared.preparation.expectedHeadSha) {
        throw new Error(
          'AMBIGUOUS_SIDE_EFFECT: a new closeout effect start requires the exact prepared remote branch.'
        );
      }
      const phase = closeout.identity.phase;
      if (phase.phase !== 'closeoutMutation' || phase.jobName !== 'integrate'
        || phase.stepName !== BRANCH_CLOSEOUT_MUTATION_PHASE_STEP_NAME) {
        throw new Error('Hosted closeout mutation phase is not the canonical provider step.');
      }
      const preMarkerGuard = await evaluateHostedCloseoutEffectPreconditionsUnderLease({
        ctx,
        prepared: closeout.recovery.prepared,
        binding: closeout.binding,
        lease,
        worktreeCleanupTokens,
        foreignWorktreeObservationDigests
      });
      const preMarkerAuthorization = preMarkerGuard.authorization;
      if (preMarkerAuthorization.blockers.length > 0 || preMarkerAuthorization.remoteAction !== 'delete-cas') {
        throw new Error(
          'Branch closeout is not authorized before effect-start publication: ' + encodeVerificationActionData(preMarkerAuthorization)
        );
      }
      const publication = createBranchCloseoutEffectStartPublication({
        binding: closeout.binding,
        authorizationPublication: expectedAuthorizationPublication,
        recoveryArtifact: expectedRecoveryArtifact,
        phase: { runId: phase.runId, runAttempt: phase.runAttempt, jobId: phase.jobId,
          jobName: 'integrate', phase: 'closeoutMutation',
          stepName: BRANCH_CLOSEOUT_MUTATION_PHASE_STEP_NAME,
          stepNumber: phase.stepNumber, workflowSha: closeout.identity.provenance.workflowSha },
        provenance: closeout.identity.provenance
      });
      await assertWorkspaceWriteLease(ctx.repositoryRoot, lease);
      const publishedStart = publishHostedCloseoutEffectStart(ctx, publication);
      if (publishedStart.disposition !== 'published') {
        throw new Error(
          'AMBIGUOUS_SIDE_EFFECT: hosted closeout effect start was not newly App-authenticated.'
        );
      }
      effectStart = publishedStart;
    }
    // Intentionally no host-local journal, cache, or projection write may occur
    // between the exact remote start readback above and this high-level effect.
    const terminal = await finalizeHostedBranchCloseout({
      ctx,
      prepared: closeout.recovery.prepared,
      binding: closeout.binding,
      writerId: closeout.binding.closeoutOperationId,
      markerDisposition: effectStart.disposition,
      now,
      lease,
      coordinatedLease,
      worktreeCleanupTokens,
      foreignWorktreeObservationDigests
    });
    return Object.freeze({ effectStart, terminal });
      })
    ));
    if (encodeVerificationActionData(terminal.binding)
      !== encodeVerificationActionData(closeout.binding)) {
      throw new Error('Hosted closeout terminal receipt binding differs from the exact merged operation.');
    }
    if (terminal.receipt.status === 'blocked' || terminal.receipt.status === 'residue') {
      throw new Error(`Hosted closeout terminal is ${terminal.receipt.status}; publication is forbidden.`);
    }
    const receiptPath = operationReceiptFilePath(closeout.recovery.prepared.preparation,
      closeout.binding.closeoutOperationId);
    const projection = Object.freeze({ schema: 'sec-verification-session-closeout-mutation-v1',
      repository, prNumber: session.prNumber, sessionRevision: session.sessionRevision,
      closeoutOperationId: closeout.binding.closeoutOperationId,
      issueDisposition,
      disposition: effectStart.disposition === 'existing'
        ? 'recovered-after-effect-start' : 'executed',
      effectStartId: effectStart.publication.effectStartId,
      effectStartPublicationDigest: effectStart.publication.publicationDigest,
      effectStartCommentId: effectStart.commentId,
      closeoutStatus: terminal.receipt.status,
      operationReceiptDigest: terminal.operationReceiptDigest,
      operationReceiptPath: path.resolve(receiptPath), observedAt: now() });
    writeDurable(required(args, '--output'), projection);
    return JSON.stringify({ ...projection, output: path.resolve(required(args, '--output')) }, null, 2);
  }
  if (command === 'closeout-publish-hosted') {
    const github = githubAdapter();
    const eventPayload = event();
    const closeout = loadMergedHostedCloseoutContext({ ctx, github, repository,
      event: eventPayload, environment, repositoryRoot, phase: 'closeoutPublication' });
    const session = closeout.hosted.artifact.session;
    const existing = observeBranchCloseoutOperationPublication(ctx.repositoryRoot, { repository,
      pullRequestNumber: session.prNumber, closeoutOperationId: closeout.binding.closeoutOperationId });
    if (existing !== null) {
      const terminalStatus = existing.publication.receipt.closeoutStatus;
      if (terminalStatus === 'blocked' || terminalStatus === 'residue') {
        throw new Error(`Hosted closeout terminal is ${terminalStatus}; it cannot be promoted to success.`);
      }
      const projection = Object.freeze({ schema: 'sec-verification-session-closeout-publication-v1',
        repository, prNumber: session.prNumber, sessionRevision: session.sessionRevision,
        closeoutOperationId: closeout.binding.closeoutOperationId, disposition: 'reused',
        closeoutStatus: terminalStatus,
        publicationDigest: existing.publication.publicationDigest,
        commentId: existing.commentId,
        receiptDigest: closeoutPublicationCompositeDigest({
          closeoutOperationId: closeout.binding.closeoutOperationId,
          publicationDigest: existing.publication.publicationDigest,
          commentId: existing.commentId
        }), observedAt: now() });
      writeDurable(required(args, '--output'), projection);
      return JSON.stringify({ ...projection, output: path.resolve(required(args, '--output')) }, null, 2);
    }
    if (closeout.identity.phase.priorAttemptStarted) {
      throw new Error('AMBIGUOUS_SIDE_EFFECT: a prior closeout publication phase started without an exact terminal comment.');
    }
    const effectStart = observeBranchCloseoutEffectStartPublication(ctx.repositoryRoot, { repository,
      pullRequestNumber: session.prNumber, closeoutOperationId: closeout.binding.closeoutOperationId });
    if (effectStart === null) {
      throw new Error('Hosted closeout publication requires one exact App-authenticated effect start marker.');
    }
    assertBranchCloseoutEffectStartMatches({ publication: effectStart.publication,
      binding: closeout.binding,
      authorizationPublication: {
        authorizationPublicationId: closeout.selected.publication.authorizationPublicationId,
        publicationDigest: closeout.selected.publication.publicationDigest,
        commentId: closeout.selected.commentId
      },
      recoveryArtifact: {
        artifactId: closeout.recovery.metadata.artifactId,
        artifactName: closeout.recovery.metadata.artifactName,
        artifactDigest: closeout.recovery.artifact.artifactDigest,
        runId: closeout.recovery.metadata.runId,
        runAttempt: closeout.recovery.metadata.runAttempt
      } });
    const receiptPath = operationReceiptFilePath(closeout.recovery.prepared.preparation,
      closeout.binding.closeoutOperationId);
    if (!existsSync(receiptPath)) {
      throw new Error('Hosted closeout publication requires the exact local operation receipt from the mutation phase.');
    }
    const terminal = parseBranchCloseoutOperationReceipt(readFileSync(receiptPath, 'utf8'));
    if (encodeVerificationActionData(terminal.binding)
      !== encodeVerificationActionData(closeout.binding)) {
      throw new Error('Hosted closeout operation receipt belongs to a different merged operation.');
    }
    if (terminal.receipt.status === 'blocked' || terminal.receipt.status === 'residue') {
      throw new Error(`Hosted closeout terminal is ${terminal.receipt.status}; publication is forbidden.`);
    }
    const publication = publishHostedCloseoutTerminal({
      ctx,
      operationReceipt: terminal,
      provenance: closeout.identity.provenance,
      effectStart: Object.freeze({ disposition: 'existing', ...effectStart })
    });
    if (publication.publication.closeoutOperationId !== closeout.binding.closeoutOperationId
      || encodeVerificationActionData(publication.publication.binding)
        !== encodeVerificationActionData(terminal.binding)) {
      throw new Error('Hosted closeout publication readback differs from the exact operation receipt.');
    }
    const projection = Object.freeze({ schema: 'sec-verification-session-closeout-publication-v1',
      repository, prNumber: session.prNumber, sessionRevision: session.sessionRevision,
      closeoutOperationId: closeout.binding.closeoutOperationId, disposition: 'published',
      closeoutStatus: terminal.receipt.status,
      operationReceiptDigest: terminal.operationReceiptDigest,
      publicationDigest: publication.publication.publicationDigest,
      commentId: publication.commentId,
      receiptDigest: closeoutPublicationCompositeDigest({
        closeoutOperationId: closeout.binding.closeoutOperationId,
        publicationDigest: publication.publication.publicationDigest,
        commentId: publication.commentId
      }), observedAt: now() });
    writeDurable(required(args, '--output'), projection);
    return JSON.stringify({ ...projection, output: path.resolve(required(args, '--output')) }, null, 2);
  }
  throw new Error(USAGE);
}

if (import.meta.main) {
  process.stdout.write(`${await verificationSessionCli(process.argv.slice(2))}\n`);
}
