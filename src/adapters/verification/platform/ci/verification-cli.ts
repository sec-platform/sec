import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { CI_VERIFICATION_CONTRACT_REVISION, CI_VERIFICATION_WORKFLOW_PATH } from '../../../../assurance/verification/contract/revision.ts';
import { uniqueSorted } from '../../../../contracts/canonical.ts';
import {
  observeExecutionProgressPhase
} from '../../../../execution/execution-progress.ts';
import { withAcquiredResource } from '../../../../execution/resource-settlement.ts';
import {
  withAuthorityGitReadOperation,
  type AuthorityGitReadOperation
} from '../../../providers/git-read/authority.ts';
import {
  GIT_READ_EXACT_TREE_OPERATION_BUDGET,
  type GitBlobBytes
} from '../../../providers/git-read/runtime/session.ts';
import { normalizeGitHubRepositoryPermission } from '../../../providers/github-api/repository-permission.ts';
import type { PhysicalWorkspaceSourceSnapshot } from '../../../repository/source-program-model/workspace-source-snapshot.ts';
import {
  assertSameNoFollowDirectoryIdentity,
  inspectNoFollowDirectoryChain,
  PhysicalNoFollowError,
  publishExclusiveDurableCanonicalFile,
  retainNoFollowFileTransaction,
  retainNoFollowOrdinaryFile
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  CodexDevelopmentParseCurrentWorkPackageManifest,
  CodexDevelopmentWorkPackageAcceptsObservedBase,
  CodexDevelopmentWorkPackageManifestDigest,
  type CodexDevelopmentWorkPackageManifest
} from '../../../self-hosting/control/task/contract/work-package.ts';
import { DEV_RUNNER_ENTRYPOINT_PATH } from '../../../self-hosting/development/runner/contract.ts';
import { compilerRuntimeLayout } from '../../../toolchain/runtime/layout.ts';
import { encodeVerificationActionData, type VerificationActionKeyDigest } from '../action/contract/action.ts';
import { buildCiVerificationActionPlanClosure, CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT, ciVerificationActionParentDispatchPlanArtifactName, ciVerificationActionParentDispatchPlanPayloadDigest, ciVerificationGateStep, createCiVerificationActionParentDispatchPlan, createCiVerificationActionProposal, createCiVerificationActionProviderEnvelope, createCiVerificationLocalExecutionEnvironment, parseCiSourceProgramTransitionBinding, parseCiVerificationActionParentDispatchPlan, parseCiVerificationActionProviderEnvelope, SOURCE_PROGRAM_TRANSITION_CANDIDATE_ROOT, SOURCE_PROGRAM_TRANSITION_ENTRYPOINT, SOURCE_PROGRAM_TRANSITION_GATE_ID, SOURCE_PROGRAM_TRANSITION_OUTPUT_FILE, type CiSourceProgramTransitionBinding, type CiVerificationActionCandidate, type CiVerificationActionParentActor, type CiVerificationActionParentDispatchPlan, type CiVerificationActionPlanClosure, type CiVerificationActionProviderEnvelope, type CiVerificationExecutionEnvironment, type CiVerificationGateStep, type CiVerificationProducerGate } from '../action/contract/ci.ts';
import { CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS, CI_VERIFICATION_HOSTED_PROVIDER_REVISION } from '../action/contract/environment.ts';
import { createVerificationActionProviderStartMarker as createVerificationActionStartMarkerV2, createVerificationActionProviderTerminalAnchor as createVerificationActionTerminalStatusAnchorV2, parseVerificationActionProviderStartMarker as parseVerificationActionStartMarkerV2, verificationActionProviderTerminalAnchorName, verificationActionProviderTerminalArtifactName, verificationActionProviderStartArtifactName as verificationActionStartMarkerNameV2, type VerificationActionProviderDecision, type VerificationActionProviderStartObservation, type VerificationActionProviderStatusReadback, type VerificationActionProviderTerminalAnchorObservation } from '../action/contract/provider.ts';
import {
  writeVerificationActionStartMarkerV2Atomic,
  writeVerificationActionTerminalStatusAnchorV2Atomic
} from '../action/journal.ts';
import type { CodexDevelopmentGitChangedRecord, CodexDevelopmentTestImpactTransitionObservation } from '../test-impact/runtime/transition.ts';
import { CodexDevelopmentAssertTestImpactTransitionSelection } from '../test-impact/runtime/transition.ts';
import {
  CodexDevelopmentCreateVerificationEvidenceProducer, CodexDevelopmentFinalizeVerificationEvidenceV4, CodexDevelopmentPrepareVerificationEvidenceTarget, CodexDevelopmentVerificationDigest,
  CodexDevelopmentWriteVerificationActionTerminalArtifactV2Atomic,
  CodexDevelopmentWriteVerificationEvidenceV4Atomic,
  parseTrustedRuntimeSourceProgramActionRecord,
  type CodexDevelopmentVerificationGateEvidenceV4,
  type TrustedRuntimeSourceProgramActionRecord
} from './contract/evidence.ts';
import {
  assertCiExpectedHead,
  CodexDevelopmentBuildVerificationPlan, type CodexDevelopmentVerificationPlanProfile
} from './contract/plan.ts';
import {
  CI_VERIFICATION_HOSTED_SANDBOX_POLICY,
  CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST,
  CI_VERIFICATION_SESSION_CONTRACT_REVISION,
  CI_VERIFICATION_SESSION_DISPATCH_TYPE
} from './contract/revision.ts';
import type { VerificationSessionHostedRequest } from './contract/session-request.ts';
import {
  CodexDevelopmentChangedFilesFromRecords,
  CodexDevelopmentDefaultChangedPaths,
  CodexDevelopmentDefaultGitRevision,
  CodexDevelopmentDefaultTrackedTreeIsClean,
  CodexDevelopmentExactGitWorkspaceSourceSnapshot,
  CodexDevelopmentFailureTail,
  CodexDevelopmentReadExactGitBlobs,
  CodexDevelopmentRunGateProcess,
  CodexDevelopmentTestImpactSourceProviderFromSnapshot,
  type CodexDevelopmentChangedPathSnapshot
} from './runtime/ci-orchestration-core.ts';
import {
  ensureVerificationActionGitHubProviderTransaction
} from './runtime/verification-action-github-provider.ts';
import {
  parseVerificationSessionHostedRequest, type VerificationSessionHostedEnvelope
} from './runtime/verification-session-runtime.ts';
import type { CodexDevelopmentCiVerificationTestOptions } from './verification-action-effect.ts';
import { CodexDevelopmentExecuteCiActionClosure } from './verification-action-effect.ts';
import { CodexDevelopmentAssembleHostedActionTerminal, CodexDevelopmentComposeHostedEvidence, CodexDevelopmentCoordinateHostedActions, CodexDevelopmentParseHostedActionRawResult } from './verification-coordination.ts';
import type { CodexDevelopmentHostedActionArtifactObservation, CodexDevelopmentHostedActionCoordination, CodexDevelopmentHostedActionProviderIndex, CodexDevelopmentHostedActionResolution } from './verification-hosted-action-contract.ts';
import { CI_VERIFICATION_ACTION_ARTIFACT_INDEX_SCHEMA, ciActionDigest, CodexDevelopmentCreateHostedActionExecutionTicket, CodexDevelopmentParseHostedActionExecutionTicket, CodexDevelopmentParseHostedActionRequest, CodexDevelopmentParseHostedActionResolution, CodexDevelopmentReadHostedActionArtifactIndex, CodexDevelopmentReduceHostedActionProviderIndex, CodexDevelopmentResolveHostedAction, FORMAL_HOSTED_ONLY_ENV_KEYS, FORMAL_TRUSTED_RUNTIME_ONLY_ENV_KEYS, FORMAL_VERIFICATION_ENV_KEYS, hostedActionProviderIndexFromSnapshot, INVALIDATION_RULES, parseHostedEnvelope, VERIFICATION_EVIDENCE_PATH } from './verification-hosted-action-contract.ts';
import { CodexDevelopmentInspectHostedActionArchive, CodexDevelopmentMaterializeHostedActionCandidate, CodexDevelopmentPrepareHostedActionInputs, currentHostedActionProducer, hostedActionRepositoryIdentity } from './verification-materialization.ts';
import { positiveEnvironmentInteger, writeHostedActionJson } from './verification-shared.ts';
import { CodexDevelopmentExecuteHostedActionSut, CodexDevelopmentExecuteTrustedBootstrapSut, CodexDevelopmentProbeHostedSutSandboxCapability, hostedSutInventoryClosureFromTicket } from './verification-sut.ts';

function formalVerificationBinding(env: NodeJS.ProcessEnv): Readonly<{
  mode: 'github-actions' | 'trusted-runtime';
  sessionRevision: string;
  sessionProposalDigest: `sha256:${string}`;
  scopeAuthorizationRevision: `sha256:${string}`;
  scopeAuthorizationDigest: `sha256:${string}`;
  reviewReceiptDigest: `sha256:${string}`;
  mainHealthRevision: `sha256:${string}`;
  mainHealthDigest: `sha256:${string}`;
  trustRevision: string;
  baseTreeSha: string;
  actionPlanDigest: `sha256:${string}`;
  executionEnvironment: CiVerificationExecutionEnvironment;
  requiredBlobs: readonly { path: string; digest: `sha256:${string}` }[];
  sourceProgramTransition?: CiSourceProgramTransitionBinding;
  sourceAction?: TrustedRuntimeSourceProgramActionRecord;
}> | null {
  const hosted = env.SEC_FORMAL_HOSTED_MODE === '1';
  const trustedRuntime = env.SEC_FORMAL_TRUSTED_RUNTIME_MODE === '1';
  if (!hosted && !trustedRuntime) return null;
  if (hosted === trustedRuntime) {
    throw new Error('Formal verification requires exactly one provider mode.');
  }
  const mode = hosted ? 'github-actions' : 'trusted-runtime';
  const requiredKeys = [
    ...FORMAL_VERIFICATION_ENV_KEYS,
    ...(hosted ? FORMAL_HOSTED_ONLY_ENV_KEYS : FORMAL_TRUSTED_RUNTIME_ONLY_ENV_KEYS)
  ];
  for (const key of requiredKeys) {
    if (env[key] === undefined || env[key] === '') {
      throw new Error(`Formal ${mode} verification requires ${key}.`);
    }
  }
  const sha = (value: string, label: string): string => {
    if (!/^[0-9a-f]{40}$/u.test(value)) throw new Error(`${label} must be a lowercase Git SHA.`);
    return value;
  };
  const digest = (value: string, label: string): `sha256:${string}` => {
    if (!/^sha256:[0-9a-f]{64}$/u.test(value)) throw new Error(`${label} must be a SHA-256 digest.`);
    return value as `sha256:${string}`;
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(env.SEC_REQUIRED_BLOB_CLOSURE_JSON!);
  } catch (error) {
    throw new Error('SEC_REQUIRED_BLOB_CLOSURE_JSON is not valid JSON.', { cause: error });
  }
  if (!Array.isArray(parsed)) throw new Error('SEC_REQUIRED_BLOB_CLOSURE_JSON must be an array.');
  const requiredBlobs = parsed.map((entry, index) => {
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry) ||
        Object.keys(entry).sort().join(',') !== 'digest,path') {
      throw new Error(`Formal ${mode} requiredBlobs[${index}] is invalid.`);
    }
    const candidate = entry as Record<string, unknown>;
    if (typeof candidate.path !== 'string' || candidate.path.length === 0 || candidate.path.includes('\\') ||
        candidate.path.startsWith('/') || candidate.path.startsWith('../')) {
      throw new Error(`Formal ${mode} requiredBlobs[${index}].path is invalid.`);
    }
    return Object.freeze({
      path: candidate.path,
      digest: digest(String(candidate.digest), `requiredBlobs[${index}].digest`)
    });
  });
  const executionEnvironment = hosted
    ? CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT
    : createCiVerificationLocalExecutionEnvironment({
        os: process.platform,
        arch: process.arch,
        bunVersion: Bun.version
      });
  if (env.SEC_EXECUTION_ENVIRONMENT_REVISION !== executionEnvironment.executionEnvironmentRevision) {
    throw new Error(`Formal ${mode} verification execution environment revision is not canonical.`);
  }
  return Object.freeze({
    mode,
    sessionRevision: env.SEC_SESSION_REVISION!,
    sessionProposalDigest: digest(env.SEC_SESSION_PROPOSAL_DIGEST!, 'SEC_SESSION_PROPOSAL_DIGEST'),
    scopeAuthorizationRevision: digest(env.SEC_SCOPE_AUTHORIZATION_REVISION!, 'SEC_SCOPE_AUTHORIZATION_REVISION'),
    scopeAuthorizationDigest: digest(env.SEC_SCOPE_AUTHORIZATION_DIGEST!, 'SEC_SCOPE_AUTHORIZATION_DIGEST'),
    reviewReceiptDigest: digest(env.SEC_REVIEW_RECEIPT_DIGEST!, 'SEC_REVIEW_RECEIPT_DIGEST'),
    mainHealthRevision: digest(env.SEC_MAIN_HEALTH_REVISION!, 'SEC_MAIN_HEALTH_REVISION'),
    mainHealthDigest: digest(env.SEC_MAIN_HEALTH_DIGEST!, 'SEC_MAIN_HEALTH_DIGEST'),
    trustRevision: sha(env.SEC_TRUST_REVISION!, 'SEC_TRUST_REVISION'),
    baseTreeSha: sha(env.SEC_BASE_TREE_SHA!, 'SEC_BASE_TREE_SHA'),
    actionPlanDigest: digest(env.SEC_ACTION_PLAN_DIGEST!, 'SEC_ACTION_PLAN_DIGEST'),
    executionEnvironment,
    requiredBlobs: Object.freeze(requiredBlobs),
    ...(env.SEC_SOURCE_PROGRAM_ACTION_HANDOFF === undefined ? {} : {
      sourceAction: mode !== 'trusted-runtime'
        ? (() => { throw new Error('Source Program Action handoff requires the trusted runtime transport.'); })()
        : parseTrustedRuntimeSourceProgramActionRecord(JSON.parse(env.SEC_SOURCE_PROGRAM_ACTION_HANDOFF))
    }),
    ...(env.SEC_SOURCE_PROGRAM_TRANSITION_BINDING === undefined ? {} : {
      sourceProgramTransition: mode !== 'trusted-runtime'
        ? (() => { throw new Error('Source Program transition requires the isolated adopted-base runtime.'); })()
        : parseCiSourceProgramTransitionBinding(JSON.parse(env.SEC_SOURCE_PROGRAM_TRANSITION_BINDING))
    })
  });
}

function parseProfile(argv: string[]): { profile: CodexDevelopmentVerificationPlanProfile; expectedHead: string | undefined } {
  let profile: CodexDevelopmentVerificationPlanProfile | null = null;
  let expectedHead: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument !== '--profile' && argument !== '--expected-head') {
      throw new Error(`Unknown CI verification argument: ${argument}.`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`CI verification ${argument} requires a value.`);
    if (argument === '--profile') {
      if (profile !== null) throw new Error('CI verification --profile may only be specified once.');
      if (value !== 'quick' && value !== 'full') throw new Error('CI verification requires --profile quick|full.');
      profile = value;
    } else {
      if (expectedHead !== undefined) throw new Error('CI verification --expected-head may only be specified once.');
      expectedHead = value;
    }
    index += 1;
  }
  if (profile === null) throw new Error('CI verification requires --profile quick|full.');
  return { profile, expectedHead };
}

type ManifestBinding = {
  manifestPath: string | null;
  manifestDigest: string | null;
  manifest: CodexDevelopmentWorkPackageManifest | null;
};

function manifestBinding(
  env: NodeJS.ProcessEnv,
  sourceBlob: GitBlobBytes | null
): ManifestBinding {
  const manifestPath = env.SEC_WORK_PACKAGE_MANIFEST_PATH;
  if (!manifestPath) return { manifestPath: null, manifestDigest: null, manifest: null };
  if (!/^config\/repository\/work-packages\/[a-z0-9][a-z0-9-]*\.md$/u.test(manifestPath)) {
    throw new Error('SEC_WORK_PACKAGE_MANIFEST_PATH must be a canonical repository-relative Work Package path.');
  }
  if (sourceBlob === null) {
    throw new Error(`Work Package manifest is unavailable at the exact candidate: ${manifestPath}.`);
  }
  const source = sourceBlob.bytes;
  if (source.byteLength > 1024 * 1024) {
    throw new Error('Work Package manifest exceeds its canonical byte limit.');
  }
  const text = new TextDecoder('utf-8', { fatal: true }).decode(source);
  const manifest = CodexDevelopmentParseCurrentWorkPackageManifest(text, manifestPath);
  return {
    manifestPath,
    manifestDigest: CodexDevelopmentWorkPackageManifestDigest(source),
    manifest
  };
}

async function runCodexDevelopmentCiVerification(
  options: CodexDevelopmentCiVerificationTestOptions,
  gitOperation: AuthorityGitReadOperation
): Promise<number> {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const now = options.now ?? (() => new Date());
  const repositoryRoot = path.resolve(options.repositoryRoot
    ?? ((options.env ?? process.env).SEC_FORMAL_TRUSTED_RUNTIME_MODE === '1'
      ? SOURCE_PROGRAM_TRANSITION_CANDIDATE_ROOT : process.cwd()));
  const gitRevision = options.gitRevision;
  const trackedTreeIsClean = options.trackedTreeIsClean;
  const changedFileResolver = options.changedFiles;
  const changedRecordResolver = options.changedRecords;
  const readGitBlob = options.readGitBlob;
  const runGate = options.runGate
    ?? ((step, execution) => CodexDevelopmentRunGateProcess(
      step.id === SOURCE_PROGRAM_TRANSITION_GATE_ID ? compilerRuntimeLayout.packageRoot : repositoryRoot, step, execution));
  const writeEvidence = options.writeEvidence;
  const evidencePath = path.resolve(env.SEC_CI_VERIFICATION_EVIDENCE_PATH ?? VERIFICATION_EVIDENCE_PATH);
  let started = new Date();
  let startedAt = started.toISOString();
  let headSha: string | null = null;
  let treeSha: string | null = null;
  const prBaseRef = env.SEC_CHANGED_BASE ?? 'refs/remotes/origin/main';
  const affectedBaseRef = env.SEC_AFFECTED_TESTS_BASE ?? prBaseRef;
  let prBaseSha: string | null = null;
  let affectedBaseSha: string | null = null;
  let cleanBefore: boolean | null = null;
  let cleanAfter: boolean | null = null;
  let profile: CodexDevelopmentVerificationPlanProfile = 'quick';
  let files: string[] | null = null;
  let steps: CiVerificationGateStep[] = [];
  let actionPlan: CiVerificationActionPlanClosure | null = null;
  let actionCandidate: CiVerificationActionCandidate | null = null;
  let actionGates: readonly CodexDevelopmentVerificationGateEvidenceV4[] = [];
  let formalBinding: ReturnType<typeof formalVerificationBinding> = null;
  let failure: { stage: string; tail: string } | null = null;
  let exitCode = 0;
  let stage = 'argv';
  let binding: ManifestBinding = { manifestPath: null, manifestDigest: null, manifest: null };
  let initializationFailure: string | null = null;
  let defaultChangedSnapshot: CodexDevelopmentChangedPathSnapshot | null = null;
  let defaultBaseTreeSha: string | null = null;
  let exactCandidateBlobs: ReadonlyMap<string, GitBlobBytes> = new Map();
  let exactWorkspaceSnapshot: PhysicalWorkspaceSourceSnapshot | null = null;
  let parsedProfile: ReturnType<typeof parseProfile> | null = null;

  try {
    CodexDevelopmentPrepareVerificationEvidenceTarget(evidencePath);
  } catch (error) {
    initializationFailure = error instanceof Error ? error.stack ?? error.message : String(error);
  }
  if (initializationFailure === null) {
    try {
      started = now();
      startedAt = started.toISOString();
      parsedProfile = parseProfile(argv);
      if (gitRevision !== undefined) {
        headSha = gitRevision('HEAD');
        treeSha = gitRevision('HEAD^{tree}');
        prBaseSha = gitRevision(prBaseRef);
        affectedBaseSha = gitRevision(affectedBaseRef);
      }
      if (trackedTreeIsClean !== undefined) cleanBefore = trackedTreeIsClean();
      const requiresDefaultChangedObservation = changedRecordResolver === undefined
        && changedFileResolver === undefined
        && options.transitionObservation === undefined;
      const manifestPath = env.SEC_WORK_PACKAGE_MANIFEST_PATH;
      const exactBlobPaths = uniqueSorted([
        ...(options.readGitBlob === undefined ? ['config/repository/active-work-package.md'] : []),
        ...(options.readExactGitBlob === undefined
          ? [
              ...CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS,
              ...(manifestPath === undefined ? [] : [manifestPath])
            ]
          : [])
      ]);
      const requiresGitPhase = gitRevision === undefined
        || trackedTreeIsClean === undefined
        || requiresDefaultChangedObservation
        || (options.testVerificationPlan === undefined
          && options.testImpactSourceProvider === undefined)
        || exactBlobPaths.length > 0;
      if (requiresGitPhase) {
        const observed = await observeExecutionProgressPhase(
          'ci-verification',
          'preflight.git-and-exact-inputs',
          () => gitOperation.runPhase('preflight', async (session) => {
            let observedHeadSha = headSha;
            let observedTreeSha = treeSha;
            let observedPrBaseSha = prBaseSha;
            let observedAffectedBaseSha = affectedBaseSha;
            let observedCleanBefore = cleanBefore;
            let observedBaseTreeSha: string | null = null;
            let observedChangedSnapshot: CodexDevelopmentChangedPathSnapshot | null = null;
            if (gitRevision === undefined) {
              observedHeadSha = await CodexDevelopmentDefaultGitRevision(session, 'HEAD');
              observedTreeSha = await CodexDevelopmentDefaultGitRevision(session, 'HEAD^{tree}');
              observedPrBaseSha = await CodexDevelopmentDefaultGitRevision(session, prBaseRef);
              observedAffectedBaseSha = await CodexDevelopmentDefaultGitRevision(
                session,
                affectedBaseRef
              );
              observedBaseTreeSha = await CodexDevelopmentDefaultGitRevision(
                session,
                `${observedPrBaseSha}^{tree}`
              );
            }
            if (trackedTreeIsClean === undefined) {
              observedCleanBefore = await CodexDevelopmentDefaultTrackedTreeIsClean(session);
            }
            if (requiresDefaultChangedObservation
                && observedPrBaseSha !== null
                && observedHeadSha !== null) {
              observedChangedSnapshot = await CodexDevelopmentDefaultChangedPaths(
                session,
                observedPrBaseSha,
                observedHeadSha
              );
            }
            if (observedHeadSha === null) {
              throw new Error('CI Git preflight cannot acquire candidate inputs without an exact head.');
            }
            const observedExactBlobs = exactBlobPaths.length === 0
              ? new Map<string, GitBlobBytes>()
              : await CodexDevelopmentReadExactGitBlobs(
                  session,
                  observedHeadSha,
                  exactBlobPaths
                );
            const observedWorkspaceSnapshot = parsedProfile?.profile === 'quick'
                && options.testVerificationPlan === undefined
                && options.testImpactSourceProvider === undefined
              ? await CodexDevelopmentExactGitWorkspaceSourceSnapshot(session, observedHeadSha)
              : null;
            return Object.freeze({
              headSha: observedHeadSha,
              treeSha: observedTreeSha,
              prBaseSha: observedPrBaseSha,
              affectedBaseSha: observedAffectedBaseSha,
              cleanBefore: observedCleanBefore,
              baseTreeSha: observedBaseTreeSha,
              changedSnapshot: observedChangedSnapshot,
              exactBlobs: observedExactBlobs,
              workspaceSnapshot: observedWorkspaceSnapshot
            });
          })
        );
        headSha = observed.headSha;
        treeSha = observed.treeSha;
        prBaseSha = observed.prBaseSha;
        affectedBaseSha = observed.affectedBaseSha;
        cleanBefore = observed.cleanBefore;
        defaultBaseTreeSha = observed.baseTreeSha;
        defaultChangedSnapshot = observed.changedSnapshot;
        exactCandidateBlobs = observed.exactBlobs;
        exactWorkspaceSnapshot = observed.workspaceSnapshot;
      }
    } catch (error) {
      initializationFailure = error instanceof Error ? error.stack ?? error.message : String(error);
    }
  }

  try {
    if (initializationFailure) throw new Error(`CI verification initialization failed: ${initializationFailure}`);
    const parsed = parsedProfile;
    if (parsed === null) throw new Error('CI verification profile was not parsed.');
    profile = parsed.profile;
    stage = 'preflight';
    if (!headSha || !treeSha || !prBaseSha || !affectedBaseSha) {
      throw new Error('CI verification cannot resolve exact head/tree/two bases.');
    }
    const exactHeadSha = headSha;
    assertCiExpectedHead(headSha, parsed.expectedHead ?? env.SEC_EXPECTED_HEAD_SHA);
    if (!cleanBefore) throw new Error('CI verification requires a clean complete worktree before execution.');
    stage = 'manifest';
    const configuredManifestPath = env.SEC_WORK_PACKAGE_MANIFEST_PATH;
    const manifestBlob = configuredManifestPath === undefined
      ? null
      : options.readExactGitBlob !== undefined
        ? options.readExactGitBlob({
            repositoryRoot,
            commitSha: headSha,
            maxBytes: 1024 * 1024,
            repositoryPath: configuredManifestPath
          })
        : exactCandidateBlobs.get(configuredManifestPath) ?? null;
    binding = manifestBinding(env, manifestBlob);
    stage = 'preflight';
    if (binding.manifest !== null && !CodexDevelopmentWorkPackageAcceptsObservedBase(binding.manifest, prBaseSha)) {
      throw new Error('Work Package manifest base does not match the exact PR base.');
    }
    if (binding.manifestPath !== null && prBaseSha !== affectedBaseSha) {
      throw new Error('Frozen verification requires the exact affected base to equal the current PR base.');
    }
    formalBinding = formalVerificationBinding(env);
    let rawChangedFiles: string[] | null;
    let transitionObservation: CodexDevelopmentTestImpactTransitionObservation | undefined;
    let injectedChangedRecords: CodexDevelopmentGitChangedRecord[] | null | undefined;
    if (changedRecordResolver) {
      const changedRecords = changedRecordResolver(prBaseSha);
      injectedChangedRecords = changedRecords;
      rawChangedFiles = changedRecords === null
        ? null
        : CodexDevelopmentChangedFilesFromRecords(changedRecords);
      transitionObservation = options.transitionObservation;
    } else if (changedFileResolver) {
      if (options.transitionObservation !== undefined) {
        throw new Error('CI verification transition injection requires the exact changed-record test seam.');
      }
      rawChangedFiles = changedFileResolver(prBaseSha);
    } else {
      if (options.transitionObservation !== undefined) {
        throw new Error('CI verification transition injection requires an explicit changed-input test seam.');
      }
      if (defaultChangedSnapshot === null) {
        throw new Error('CI verification did not receive its default changed-path observation.');
      }
      rawChangedFiles = defaultChangedSnapshot.files;
      transitionObservation = defaultChangedSnapshot.transitionObservation;
    }
    if (rawChangedFiles !== null && transitionObservation !== undefined) {
      CodexDevelopmentAssertTestImpactTransitionSelection({
        baseSha: prBaseSha,
        headSha,
        changedPaths: rawChangedFiles,
        ...(injectedChangedRecords === undefined || injectedChangedRecords === null
          ? {}
          : { records: injectedChangedRecords }),
        observation: transitionObservation
      });
    }
    // Selection consumes the same immutable candidate generation regardless
    // of how the changed-path observation was obtained. Injected paths can
    // vary the transition input in tests, but cannot inject or suppress the
    // Source Program authority used to interpret those paths.
    const plan = options.testVerificationPlan ?? (() => {
      const testImpactProvider = profile === 'full'
        ? null
        : options.testImpactSourceProvider
          ?? (exactWorkspaceSnapshot === null
            ? null
            : CodexDevelopmentTestImpactSourceProviderFromSnapshot(
                exactWorkspaceSnapshot,
                repositoryRoot
              ));
      if (profile === 'quick' && testImpactProvider === null) {
        throw new Error('CI verification did not receive an owner-issued exact test-impact source provider.');
      }
      return CodexDevelopmentBuildVerificationPlan(
        profile,
        rawChangedFiles,
        testImpactProvider,
        transitionObservation,
        formalBinding?.sourceProgramTransition
      );
    })();
    files = plan.changedFiles;
    steps = plan.gates;
    if (steps.some((step) => step.phase === 'risk')) {
      console.log(`CI verification: risk gate required; reasons=[${plan.selectionReasons.join(', ')}]; owners=[${plan.affectedOwners.join(', ')}]`);
    } else {
      console.log('CI verification: no slow/workspace risk impact detected; risk gate skipped.');
    }
    if (!plan.selectionResolved) throw new Error('CI verification changed-file selection is unresolved.');

    console.log(`SEC verification contract revision: ${CI_VERIFICATION_CONTRACT_REVISION}`);
    console.log(`SEC verification profile: ${profile}`);
    console.log(`SEC verification exact head: ${headSha}`);
    console.log(`SEC verification tree: ${treeSha}`);
    console.log(`SEC verification PR base: ${prBaseSha}`);
    console.log(`SEC verification affected base: ${affectedBaseSha}`);

    stage = 'gates';
    const fallbackManifestPath = 'config/repository/active-work-package.md';
    const fallbackManifest = readGitBlob === undefined
      ? exactCandidateBlobs.get(fallbackManifestPath) ?? null
      : readGitBlob(headSha, fallbackManifestPath);
    if (binding.manifestPath === null && fallbackManifest === null) {
      throw new Error('CI Action producer cannot bind a manifest/control-plane blob.');
    }
    const baseTreeSha = formalBinding?.baseTreeSha
      ?? (gitRevision === undefined
        ? defaultBaseTreeSha
        : gitRevision(`${prBaseSha}^{tree}`));
    if (baseTreeSha === null) throw new Error('CI Action producer cannot resolve the exact base tree.');
    const localDigest = (value: unknown): `sha256:${string}` => (
      CodexDevelopmentVerificationDigest(value) as `sha256:${string}`
    );
    const executionEnvironment = formalBinding !== null
      ? formalBinding.executionEnvironment
      : createCiVerificationLocalExecutionEnvironment({
          os: process.platform,
          arch: process.arch,
          bunVersion: Bun.version
        });
    const localDependencyBlobs = formalBinding === null
      ? CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS.map((dependencyPath) => {
          const blob = options.readExactGitBlob === undefined
            ? exactCandidateBlobs.get(dependencyPath) ?? null
            : options.readExactGitBlob({
                repositoryRoot,
                commitSha: exactHeadSha,
                repositoryPath: dependencyPath
              });
          if (blob === null || blob.type !== 'blob') {
            throw new Error(`Local VerificationAction dependency input is unavailable: ${dependencyPath}.`);
          }
          return Object.freeze({
            path: dependencyPath,
            digest: `sha256:${createHash('sha256').update(blob.bytes).digest('hex')}` as VerificationActionKeyDigest
          });
        })
      : [];
    const candidate: CiVerificationActionCandidate = {
      baseSha: prBaseSha,
      baseTreeSha,
      headSha,
      headTreeSha: treeSha,
      manifestPath: binding.manifestPath ?? fallbackManifestPath,
      manifestDigest: (binding.manifestDigest ?? localDigest(fallbackManifest!.bytes)) as `sha256:${string}`,
      scopeAuthorizationRevision: formalBinding?.scopeAuthorizationRevision ?? localDigest({
        baseSha: prBaseSha, baseTreeSha, headSha, headTreeSha: treeSha, files
      }),
      profile,
      toolchainRevision: executionEnvironment.toolchainRevision,
      providerRevision: executionEnvironment.executionEnvironmentRevision,
      contractRevision: CI_VERIFICATION_CONTRACT_REVISION,
      requiredBlobs: formalBinding?.requiredBlobs ?? localDependencyBlobs
    };
    actionCandidate = candidate;
    const producerGates: readonly CiVerificationProducerGate[] = steps.map(ciVerificationGateStep);
    const descriptors = producerGates.map((gate) => Object.freeze({
      gate,
      env: {
        ...env,
        SEC_TEST_WORKSPACE_NAMESPACE: `verification-${gate.id.replace(/[^a-z0-9]+/giu, '-').toLowerCase()}`
      }
    }));
    actionPlan = buildCiVerificationActionPlanClosure({ candidate, gates: producerGates });
    if (formalBinding !== null && actionPlan.actionPlanDigest !== formalBinding.actionPlanDigest) {
      throw new Error('Formal hosted Action plan digest differs from the trusted dispatcher reconstruction.');
    }
    const actionExecution = await CodexDevelopmentExecuteCiActionClosure({
      repositoryRoot,
      actionPlan,
      gates: descriptors,
      headSha,
      now,
      runGate: async (descriptor, execution) => {
        console.log(`::group::SEC verification: ${descriptor.id}`);
        try {
          if (descriptor.id !== SOURCE_PROGRAM_TRANSITION_GATE_ID) {
            return await runGate(descriptor, execution);
          }
          if (formalBinding?.mode !== 'trusted-runtime'
              || formalBinding.sourceProgramTransition?.baseSha !== prBaseSha
              || formalBinding.sourceProgramTransition.headSha !== headSha
              || descriptor.argv[1] !== SOURCE_PROGRAM_TRANSITION_ENTRYPOINT) {
            throw new Error('Source Program transition requires the exact adopted-base runtime binding.');
          }
          // Keep the configured parent alive across execution and publication;
          // neither a new directory nor recycled inode may inherit this binding.
          return await withAcquiredResource({
            operationLabel: 'Source Program transition output publication',
            resourceLabel: 'Source Program transition output parent',
            acquire: () => retainNoFollowFileTransaction(
              path.dirname(evidencePath), 'Source Program transition output'
            ),
            use: async (transitionOutput) => {
              const settled = await runGate({
                ...descriptor,
                argv: [descriptor.argv[0]!, '--no-env-file', '--config',
                  path.join(compilerRuntimeLayout.packageRoot, 'bunfig.toml'),
                  path.join(compilerRuntimeLayout.packageRoot, SOURCE_PROGRAM_TRANSITION_ENTRYPOINT), ...descriptor.argv.slice(2)]
              }, execution);
              if (settled.result.stdout === undefined) {
                throw new Error('Source Program transition producer did not return exact stdout bytes.');
              }
              // A copy of the captured process bytes, bound in this Action's evidenceRefs.
              // Neither this file nor the JSON it contains is an author capability.
              transitionOutput.assertCurrent();
              const stdout = Buffer.from(settled.result.stdout);
              const publication = publishExclusiveDurableCanonicalFile({
                parent: transitionOutput.rootIdentity,
                name: SOURCE_PROGRAM_TRANSITION_OUTPUT_FILE,
                bytes: stdout,
                permissionMode: 0o400,
                validate: (bytes) => {
                  if (!Buffer.from(bytes).equals(stdout)) {
                    throw new Error('Source Program transition output differs from the captured stdout bytes.');
                  }
                }
              });
              // Physical permits idempotent reuse; this producer's wx contract does not.
              if (!publication.created) {
                throw new PhysicalNoFollowError(
                  'PHYSICAL_NO_FOLLOW_EXCLUSIVE_CONFLICT',
                  'Source Program transition output already exists.'
                );
              }
              return settled;
            },
            release: (transitionOutput) => transitionOutput.dispose()
          });
        } finally {
          console.log('::endgroup::');
        }
      },
      ...(formalBinding?.sourceAction === undefined ? {} : {
        sourceAction: formalBinding.sourceAction,
        sessionRevision: formalBinding.sessionRevision
      }),
      actionRunner: options.actionRunner,
      readDurableActionResult: options.readDurableActionResult
    });
    actionGates = actionExecution.gates;
    if (actionExecution.failed) {
      exitCode = 1;
      const failedGate = actionGates.find((gate) => gate.result.status !== 'passed');
      failure = {
        stage: `gate:${failedGate?.result.gateId ?? 'unknown'}`,
        tail: failedGate?.result.diagnostic ?? 'CI Action plan did not pass.'
      };
    }
  } catch (error) {
    exitCode = exitCode || 1;
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    failure ??= { stage, tail: CodexDevelopmentFailureTail(message, 'CI verification failed.') };
    console.error(message);
  } finally {
    let finalObservationStage = 'exact-identity';
    try {
      let finalHead: string | null = null;
      let finalTree: string | null = null;
      if (headSha !== null && treeSha !== null && gitRevision !== undefined) {
        finalHead = gitRevision('HEAD');
        finalTree = gitRevision('HEAD^{tree}');
      }
      if (trackedTreeIsClean !== undefined) {
        finalObservationStage = 'clean-state';
        cleanAfter = trackedTreeIsClean();
      }
      if (gitRevision === undefined || trackedTreeIsClean === undefined) {
        await gitOperation.runPhase('readback', async (session) => {
          if (headSha !== null && treeSha !== null && gitRevision === undefined) {
            finalObservationStage = 'exact-identity';
            finalHead = await CodexDevelopmentDefaultGitRevision(session, 'HEAD');
            finalTree = await CodexDevelopmentDefaultGitRevision(session, 'HEAD^{tree}');
          }
          if (trackedTreeIsClean === undefined) {
            finalObservationStage = 'clean-state';
            cleanAfter = await CodexDevelopmentDefaultTrackedTreeIsClean(session);
          }
        });
      }
      if (headSha !== null && treeSha !== null) {
        if (finalHead !== headSha || finalTree !== treeSha) {
          exitCode = 1;
          failure ??= { stage: 'exact-identity', tail: 'CI verification exact head or tree changed during execution.' };
        }
      }
    } catch (error) {
      cleanAfter = null;
      exitCode = 1;
      failure ??= {
        stage: finalObservationStage,
        tail: CodexDevelopmentFailureTail(
          error instanceof Error ? error.stack ?? error.message : String(error),
          finalObservationStage === 'exact-identity'
            ? 'Exact identity recheck failed.'
            : 'Clean-state probe failed.'
        )
      };
    }
    if (cleanAfter !== true && exitCode === 0) {
      exitCode = 1;
      failure = { stage: 'clean-state', tail: 'CI verification left the complete worktree dirty or unresolved.' };
    }
    let finished = new Date(Math.max(Date.now(), started.getTime()));
    try {
      finished = now();
    } catch (error) {
      exitCode = 1;
      failure = {
        stage: 'clock',
        tail: CodexDevelopmentFailureTail(
          error instanceof Error ? error.stack ?? error.message : String(error),
          'Clock probe failed.'
        )
      };
    }
    try {
      if (actionPlan === null || actionCandidate === null) {
        throw new Error('CI verification did not construct a canonical Action plan; V2/V3 fallback publication is retired.');
      }
      const finalGates = [...actionGates];
      if (exitCode !== 0 && finalGates.every((gate) => gate.result.status === 'passed') && finalGates.length > 0) {
        const last = finalGates.at(-1)!;
        finalGates[finalGates.length - 1] = {
          ...last,
          cleanup: {
            status: 'failed',
            evidenceRefs: [],
            diagnostic: failure?.tail ?? 'Post-action exact identity or cleanup failed.'
          }
        };
      }
      const status = finalGates.some((gate) => gate.cleanup.status === 'failed' || gate.result.status === 'failed')
        ? 'failed' as const
        : finalGates.some((gate) => gate.result.status === 'invalidated') ? 'invalidated' as const
          : finalGates.some((gate) => gate.result.status === 'unsupported') ? 'unsupported' as const
            : finalGates.some((gate) => gate.result.status === 'not-run') ? 'not-run' as const
              : 'passed' as const;
      const localBindingDigest = (value: unknown): `sha256:${string}` => (
        CodexDevelopmentVerificationDigest(value) as `sha256:${string}`
      );
      const evidence = CodexDevelopmentFinalizeVerificationEvidenceV4({
        contractRevision: CI_VERIFICATION_CONTRACT_REVISION,
        sessionRevision: formalBinding?.sessionRevision ?? CI_VERIFICATION_SESSION_CONTRACT_REVISION,
        sessionProposalDigest: formalBinding?.sessionProposalDigest ?? localBindingDigest({
          actionPlanDigest: actionPlan.actionPlanDigest,
          scopeAuthorizationRevision: actionCandidate.scopeAuthorizationRevision,
          baseSha: actionCandidate.baseSha,
          headSha: actionCandidate.headSha
        }),
        scopeAuthorizationRevision: actionCandidate.scopeAuthorizationRevision,
        scopeAuthorizationDigest: formalBinding?.scopeAuthorizationDigest ?? actionCandidate.scopeAuthorizationRevision,
        reviewReceiptDigest: formalBinding?.reviewReceiptDigest ?? localBindingDigest('local-nonformal-review'),
        mainHealthRevision: formalBinding?.mainHealthRevision ?? localBindingDigest('local-nonformal-main-health-revision'),
        mainHealthDigest: formalBinding?.mainHealthDigest ?? localBindingDigest('local-nonformal-main-health'),
        trustRevision: formalBinding?.trustRevision ?? actionCandidate.baseSha,
        profile,
        baseSha: actionCandidate.baseSha,
        baseTreeSha: actionCandidate.baseTreeSha,
        headSha: actionCandidate.headSha,
        headTreeSha: actionCandidate.headTreeSha,
        manifestPath: actionCandidate.manifestPath,
        manifestDigest: actionCandidate.manifestDigest,
        producer: CodexDevelopmentCreateVerificationEvidenceProducer({
          sourceTransport: formalBinding?.mode === 'github-actions' ? 'github-actions' : 'local-dev-runner',
          workflowPath: formalBinding?.mode === 'github-actions'
            ? '.github/workflows/compiler-pr-validation.yml'
            : formalBinding?.mode === 'trusted-runtime'
              ? CI_VERIFICATION_WORKFLOW_PATH
              : DEV_RUNNER_ENTRYPOINT_PATH,
          workflowRef: formalBinding?.mode === 'github-actions'
            ? (env.SEC_TRUSTED_WORKFLOW_REF ?? '')
            : `${formalBinding?.mode === 'trusted-runtime'
              ? CI_VERIFICATION_WORKFLOW_PATH
              : DEV_RUNNER_ENTRYPOINT_PATH}@${actionCandidate.baseSha}`,
          workflowSha: formalBinding?.mode === 'github-actions'
            ? (env.GITHUB_WORKFLOW_SHA ?? '')
            : actionCandidate.baseSha,
          runId: formalBinding?.mode === 'trusted-runtime'
            ? env.SEC_TRUSTED_RUNTIME_EXECUTION_ID!
            : env.GITHUB_RUN_ID ?? 'local-run',
          runAttempt: formalBinding?.mode === 'trusted-runtime'
            ? 1
            : Number(env.GITHUB_RUN_ATTEMPT ?? '1'),
          actorNodeId: formalBinding?.mode === 'trusted-runtime'
            ? env.SEC_TRUSTED_RUNTIME_ACTOR_NODE_ID!
            : env.SEC_WORKFLOW_ACTOR_NODE_ID ?? 'local-dev-runner'
        }),
        actionPlan,
        status,
        startedAt,
        finishedAt: finished.toISOString(),
        gates: finalGates,
        evidenceRefs: finalGates.flatMap((gate) => gate.result.evidenceRefs),
        invalidationRules: [
          ...INVALIDATION_RULES,
          'session, scope authorization, Action closure, Review receipt, MainHealth, or trust revision changes'
        ]
      });
      if (writeEvidence) writeEvidence(evidencePath, evidence);
      else CodexDevelopmentWriteVerificationEvidenceV4Atomic(evidencePath, evidence);
      console.log(`SEC verification evidence: ${evidencePath}`);
      console.log(`SEC_VERIFICATION_SUMMARY ${JSON.stringify(evidence)}`);
    } catch (error) {
      exitCode = 1;
      console.error(`SEC verification evidence write failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    }
  }
  return exitCode;
}

async function executeCodexDevelopmentCiVerification(
  options: CodexDevelopmentCiVerificationTestOptions
): Promise<number> {
  const repositoryRoot = path.resolve(options.repositoryRoot
    ?? ((options.env ?? process.env).SEC_FORMAL_TRUSTED_RUNTIME_MODE === '1'
      ? SOURCE_PROGRAM_TRANSITION_CANDIDATE_ROOT : process.cwd()));
  const deadlineAtUnixMs = Date.now()
    + CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.wallSeconds * 1_000;
  return withAuthorityGitReadOperation({
    cwd: repositoryRoot,
    budget: GIT_READ_EXACT_TREE_OPERATION_BUDGET,
    deadlineAtUnixMs
  }, (gitOperation) => runCodexDevelopmentCiVerification(options, gitOperation));
}

/** Production CLI entry. Provider and repository observations are never caller-injected. */
export async function CodexDevelopmentCiVerificationMain(): Promise<number> {
  return executeCodexDevelopmentCiVerification({});
}

/** Test-only execution harness; production modules must not import this entry. */
export async function CodexDevelopmentCiVerificationMainForTests(
  options: CodexDevelopmentCiVerificationTestOptions
): Promise<number> {
  return executeCodexDevelopmentCiVerification(options);
}

export const HOSTED_ACTION_COMMANDS = new Set([
  'ensure-hosted-action-provider',
  'resolve-hosted-action',
  'prepare-hosted-action-inputs',
  'execute-trusted-bootstrap-sut',
  'self-test-hosted-action-sandbox',
  'execute-hosted-action-sut',
  'assemble-hosted-action-terminal',
  'compose-hosted-evidence'
]);

function hostedActionCliArgs(
  argv: readonly string[],
  allowed: readonly string[]
): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  const allow = new Set(allowed);
  for (let index = 1; index < argv.length; index += 1) {
    const flag = argv[index]!;
    if (flag === '--json') continue;
    if (!allow.has(flag) || result.has(flag)) throw new Error(`Unknown or repeated ${argv[0]} flag: ${flag}.`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires one value.`);
    result.set(flag, value);
    index += 1;
  }
  for (const flag of allowed) if (!result.has(flag)) throw new Error(`${argv[0]} requires ${flag}.`);
  return result;
}

function hostedActionRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be one object.`);
  }
  return value as Record<string, unknown>;
}

function hostedActionTransportBytes(filePath: string, label: string): Buffer {
  const transportRootPath = path.resolve('.tmp/codex');
  const absolute = path.resolve(filePath);
  const relative = path.relative(transportRootPath, absolute);
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative) || relative.includes('\0')) {
    throw new Error(`${label} must be one file inside the hosted transport namespace.`);
  }
  const transportRoot = inspectNoFollowDirectoryChain(
    transportRootPath, 'Hosted Action transport root'
  ).target;
  const retained = retainNoFollowOrdinaryFile(
    inspectNoFollowDirectoryChain(path.dirname(absolute), `${label} parent`),
    path.basename(absolute),
    undefined,
    label
  );
  try {
    const bytes = Buffer.from(retained.readBytes());
    retained.assertCurrent();
    assertSameNoFollowDirectoryIdentity(transportRoot, 'Hosted Action transport root');
    return bytes;
  } finally {
    retained.dispose();
  }
}

function hostedActionTransportText(filePath: string, label: string): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(
    hostedActionTransportBytes(filePath, label)
  );
}

function hostedActionCanonicalFile<T>(
  filePath: string,
  parser: (value: unknown) => T,
  label: string
): T {
  const source = hostedActionTransportText(filePath, label);
  const value = parser(JSON.parse(source) as unknown);
  if (source !== `${encodeVerificationActionData(value)}\n`) {
    throw new Error(`${label} is not one exact canonical JSON line.`);
  }
  return value;
}

function hostedActionParentActor(repository: string): CiVerificationActionParentActor {
  const login = process.env.GITHUB_ACTOR ?? '';
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u.test(login) ||
      process.env.GITHUB_TRIGGERING_ACTOR !== login) {
    throw new Error('parent Session runtime is not bound to one exact human principal.');
  }
  const permissionReadback = hostedActionRecord(hostedActionGhReadJson([
    `/repos/${repository}/collaborators/${login}/permission`
  ], 'parent actor permission'), 'parent actor permission');
  const user = hostedActionRecord(permissionReadback.user, 'parent actor permission user');
  const permission = normalizeGitHubRepositoryPermission(permissionReadback);
  const id = user.id;
  const nodeId = user.node_id;
  if ((permission !== 'maintain' && permission !== 'admin') || user.login !== login ||
      !Number.isSafeInteger(id) || Number(id) < 1 ||
      typeof nodeId !== 'string' || nodeId.length === 0 || user.type !== 'User') {
    throw new Error('parent Session actor lacks exact live maintain/admin authority.');
  }
  return Object.freeze({
    login,
    id: Number(id),
    nodeId,
    type: 'User' as const,
    permission
  });
}

function hostedActionParentJobId(repository: string, runId: string, runAttempt: number): string {
  const jobs: Record<string, unknown>[] = [];
  for (let page = 1; page <= 1000; page += 1) {
    const response = hostedActionRecord(hostedActionGhReadJson([
      `/repos/${repository}/actions/runs/${runId}/attempts/${runAttempt}/jobs?per_page=100&page=${page}`
    ], `parent job page ${page}`), `parent job page ${page}`);
    if (!Array.isArray(response.jobs) || response.jobs.length > 100) {
      throw new Error(`parent job page ${page} is incomplete.`);
    }
    jobs.push(...response.jobs.map((entry, index) =>
      hostedActionRecord(entry, `parent job page ${page}[${index}]`)
    ));
    if (response.jobs.length < 100) break;
    if (page === 1000) throw new Error('parent job pagination exceeded the bounded census.');
  }
  const expectedSha = process.env.GITHUB_WORKFLOW_SHA;
  const matches = jobs.filter((job) => job.name === 'coordinate-verification-session' &&
    String(job.run_id ?? '') === runId && job.run_attempt === runAttempt && job.head_sha === expectedSha &&
    (job.status === 'in_progress' || job.status === 'completed'));
  if (matches.length !== 1 || !/^[1-9][0-9]*$/u.test(String(matches[0]!.id ?? ''))) {
    throw new Error('parent Session coordinator job is not one exact current provider job.');
  }
  return String(matches[0]!.id);
}

export function CodexDevelopmentAssertHostedActionParentEvent(
  eventValue: unknown,
  sessionRequest: VerificationSessionHostedRequest
): void {
  const event = hostedActionRecord(eventValue, 'parent Session event');
  const expectedClientPayload = Object.freeze({ payload: sessionRequest });
  if (event.action !== CI_VERIFICATION_SESSION_DISPATCH_TYPE ||
      encodeVerificationActionData(event.client_payload) !==
        encodeVerificationActionData(expectedClientPayload)) {
    throw new Error('parent dispatch plan event does not contain the exact Session request wrapper.');
  }
}

function createHostedActionParentPlan(input: Readonly<{
  sessionRequest: VerificationSessionHostedRequest;
  envelope: VerificationSessionHostedEnvelope;
}>): CiVerificationActionParentDispatchPlan {
  const repositoryIdentity = hostedActionRepositoryIdentity();
  const runId = process.env.GITHUB_RUN_ID ?? '';
  const runAttempt = positiveEnvironmentInteger('GITHUB_RUN_ATTEMPT');
  const workflowSha = process.env.GITHUB_WORKFLOW_SHA ?? '';
  const workflowRef = process.env.GITHUB_WORKFLOW_REF ?? '';
  if (!/^[1-9][0-9]*$/u.test(runId) || !/^[0-9a-f]{40}$/u.test(workflowSha) ||
      workflowSha !== input.sessionRequest.expectedBaseSha ||
      workflowRef !== `${repositoryIdentity.repository}/.github/workflows/compiler-pr-validation.yml@refs/heads/main` ||
      process.env.GITHUB_JOB !== 'coordinate-verification-session') {
    throw new Error('parent dispatch plan is not running in the exact trusted Session coordinator.');
  }
  // Event payload ownership is intentionally upstream: validate-hosted-request
  // binds the repository_dispatch wrapper to these exact request bytes before
  // this job materializes hosted-request.json. This owner revalidates the live
  // workflow/base/actor authority instead of reopening a second event path.
  const proposals = input.envelope.actionPlanClosure.actions.map((member) =>
    createCiVerificationActionProposal({
      sessionRequest: input.sessionRequest,
      proposedActionKey: member.action.actionKey
    })
  );
  for (const proposal of proposals) {
    CodexDevelopmentResolveHostedAction({
      request: CodexDevelopmentParseHostedActionRequest(encodeVerificationActionData(proposal)),
      envelope: input.envelope
    });
  }
  return createCiVerificationActionParentDispatchPlan({
    repositoryId: String(repositoryIdentity.repositoryId),
    repository: repositoryIdentity.repository,
    parentRunId: runId,
    parentRunAttempt: runAttempt,
    parentJobId: hostedActionParentJobId(repositoryIdentity.repository, runId, runAttempt),
    parentWorkflowRef: workflowRef,
    parentWorkflowSha: workflowSha,
    parentActor: hostedActionParentActor(repositoryIdentity.repository),
    proposals
  });
}

function hostedActionParentAuthority(input: Readonly<{
  requestPath: string;
  envelopePath: string;
  parentPlanPath: string;
  parentArtifactId: string;
  parentArtifactArchiveDigest: string;
}>): Readonly<{
  sessionRequest: VerificationSessionHostedRequest;
  envelope: VerificationSessionHostedEnvelope;
  parentPlan: CiVerificationActionParentDispatchPlan;
  providerEnvelopes: readonly CiVerificationActionProviderEnvelope[];
}> {
  const sessionRequest = parseVerificationSessionHostedRequest(
    hostedActionTransportText(input.requestPath, 'parent Session request')
  );
  const envelope = parseHostedEnvelope(
    JSON.parse(hostedActionTransportText(input.envelopePath, 'parent Session envelope')) as unknown
  );
  const parentPlan = hostedActionCanonicalFile(
    input.parentPlanPath,
    parseCiVerificationActionParentDispatchPlan,
    'parent dispatch plan'
  );
  const expectedProposals = envelope.actionPlanClosure.actions.map((member) =>
    createCiVerificationActionProposal({ sessionRequest, proposedActionKey: member.action.actionKey })
  ).sort((left, right) => left.proposedActionKey.localeCompare(right.proposedActionKey));
  if (encodeVerificationActionData(parentPlan.proposals) !== encodeVerificationActionData(expectedProposals)) {
    throw new Error('parent dispatch plan proposals differ from the exact hosted Action closure.');
  }
  if (!/^[1-9][0-9]*$/u.test(input.parentArtifactId) ||
      !/^sha256:[0-9a-f]{64}$/u.test(input.parentArtifactArchiveDigest)) {
    throw new Error('parent dispatch plan artifact identity is invalid.');
  }
  const providerEnvelopes = parentPlan.proposals.map((proposal) =>
    createCiVerificationActionProviderEnvelope({
      proposal,
      parentPlan,
      parentDispatchPlanArtifactId: input.parentArtifactId,
      parentDispatchPlanArchiveDigest: input.parentArtifactArchiveDigest as VerificationActionKeyDigest
    })
  );
  return Object.freeze({ sessionRequest, envelope, parentPlan, providerEnvelopes: Object.freeze(providerEnvelopes) });
}

function hostedActionChildAuthority(input: Readonly<{
  providerEnvelopePath: string;
  envelopePath: string;
  resolutionPath?: string;
}>): Readonly<{
  providerEnvelope: CiVerificationActionProviderEnvelope;
  envelope: VerificationSessionHostedEnvelope;
  resolution: CodexDevelopmentHostedActionResolution;
}> {
  const providerEnvelope = hostedActionCanonicalFile(
    input.providerEnvelopePath,
    parseCiVerificationActionProviderEnvelope,
    'internal Action provider envelope'
  );
  const envelope = parseHostedEnvelope(
    JSON.parse(hostedActionTransportText(input.envelopePath, 'parent Session envelope')) as unknown
  );
  const resolution = CodexDevelopmentResolveHostedAction({
    request: CodexDevelopmentParseHostedActionRequest(
      encodeVerificationActionData(providerEnvelope.proposal)
    ),
    envelope
  });
  if (input.resolutionPath !== undefined) {
    const supplied = CodexDevelopmentParseHostedActionResolution(
      hostedActionTransportText(input.resolutionPath, 'internal Action resolution')
    );
    if (encodeVerificationActionData(supplied) !== encodeVerificationActionData(resolution)) {
      throw new Error('caller Action resolution differs from the authenticated provider envelope.');
    }
  }
  return Object.freeze({ providerEnvelope, envelope, resolution });
}

async function observeHostedActionAuthority(input: Readonly<{
  providerEnvelope: CiVerificationActionProviderEnvelope;
  envelope: VerificationSessionHostedEnvelope;
  role: 'parent' | 'child';
}>): Promise<Readonly<{
  index: CodexDevelopmentHostedActionProviderIndex;
  decision: VerificationActionProviderDecision;
}>> {
  const result = await ensureVerificationActionGitHubProviderTransaction({
    authority: {
      envelope: input.providerEnvelope,
      actionPlanClosure: input.envelope.actionPlanClosure
    },
    intent: { kind: input.role === 'parent' ? 'coordinate-parent' : 'coordinate' }
  });
  if (result.disposition !== 'observed') {
    throw new Error(`hosted Action provider observation returned ${result.disposition}.`);
  }
  const index = hostedActionProviderIndexFromSnapshot(result.snapshot);
  const resolution = CodexDevelopmentResolveHostedAction({
    request: CodexDevelopmentParseHostedActionRequest(
      encodeVerificationActionData(input.providerEnvelope.proposal)
    ),
    envelope: input.envelope
  });
  const decision = CodexDevelopmentReduceHostedActionProviderIndex({
    resolution,
    ...hostedActionRepositoryIdentity(),
    index
  });
  return Object.freeze({ index, decision });
}

function hostedActionGhReadJson(args: readonly string[], label: string): unknown {
  const result = spawnSync('gh', ['api', '-H', 'Accept: application/vnd.github+json', ...args], {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true
  });
  if (result.error !== undefined || result.status !== 0 || typeof result.stdout !== 'string') {
    throw new Error(`${label} readback failed: ${String(result.error ?? result.stderr).slice(0, 512)}`);
  }
  try {
    return JSON.parse(result.stdout) as unknown;
  } catch (error) {
    throw new Error(`${label} readback is not JSON: ${String(error).slice(0, 512)}`);
  }
}

async function readParentPlanObservation(
  authority: ReturnType<typeof hostedActionParentAuthority>
): Promise<string> {
  const first = authority.providerEnvelopes[0];
  if (first === undefined) throw new Error('parent dispatch plan has no Action proposal.');
  const observed = await observeHostedActionAuthority({
    providerEnvelope: first,
    envelope: authority.envelope,
    role: 'parent'
  });
  return JSON.stringify({
    status: 'verified',
    parentDispatchPlanDigest: authority.parentPlan.parentDispatchPlanDigest,
    parentArtifactPayloadDigest: first.parentDispatchPlanPayloadDigest,
    firstActionDisposition: observed.decision.disposition
  });
}

async function observeHostedSessionProvider(
  authority: ReturnType<typeof hostedActionParentAuthority>
): Promise<Readonly<{
  artifactIndex: CodexDevelopmentHostedActionProviderIndex;
  coordination: CodexDevelopmentHostedActionCoordination;
}>> {
  const terminalObservations: CodexDevelopmentHostedActionArtifactObservation[] = [];
  const startObservations: VerificationActionProviderStartObservation[] = [];
  const terminalAnchorObservations: VerificationActionProviderTerminalAnchorObservation[] = [];
  const providerStatusReadbacks: VerificationActionProviderStatusReadback[] = [];
  for (const providerEnvelope of authority.providerEnvelopes) {
    const observed = await observeHostedActionAuthority({
      providerEnvelope,
      envelope: authority.envelope,
      role: 'parent'
    });
    terminalObservations.push(...observed.index.terminalObservations);
    startObservations.push(...observed.index.startObservations);
    terminalAnchorObservations.push(...observed.index.terminalAnchorObservations);
    providerStatusReadbacks.push(...observed.index.providerStatusReadbacks);
  }
  const artifactIndex = Object.freeze({
    schema: CI_VERIFICATION_ACTION_ARTIFACT_INDEX_SCHEMA,
    terminalObservations: Object.freeze(terminalObservations),
    startObservations: Object.freeze(startObservations),
    terminalAnchorObservations: Object.freeze(terminalAnchorObservations),
    providerStatusReadbacks: Object.freeze(providerStatusReadbacks)
  });
  const coordination = CodexDevelopmentCoordinateHostedActions({
    envelope: authority.envelope,
    observations: artifactIndex.terminalObservations,
    startObservations: artifactIndex.startObservations,
    terminalAnchorObservations: artifactIndex.terminalAnchorObservations,
    providerStatusReadbacks: artifactIndex.providerStatusReadbacks
  });
  return Object.freeze({ artifactIndex, coordination });
}

async function coordinateHostedSessionProvider(
  authority: ReturnType<typeof hostedActionParentAuthority>
): Promise<Readonly<{
  artifactIndex: CodexDevelopmentHostedActionProviderIndex;
  coordination: CodexDevelopmentHostedActionCoordination;
  dispatched: number;
}>> {
  const observed = await observeHostedSessionProvider(authority);
  let dispatched = 0;
  if (observed.coordination.disposition === 'dispatch') {
    const envelopesByKey = new Map(
      authority.providerEnvelopes.map((providerEnvelope) => [
        providerEnvelope.proposal.proposedActionKey,
        providerEnvelope
      ])
    );
    for (const actionKey of observed.coordination.dispatchActionKeys) {
      const providerEnvelope = envelopesByKey.get(actionKey);
      if (providerEnvelope === undefined) {
        throw new Error('coordinator selected an Action outside the authenticated parent plan.');
      }
      const result = await ensureVerificationActionGitHubProviderTransaction({
        authority: {
          envelope: providerEnvelope,
          actionPlanClosure: authority.envelope.actionPlanClosure
        },
        intent: { kind: 'dispatch-child' }
      });
      if (result.disposition !== 'dispatched') {
        throw new Error(`internal Action wake-up was not accepted: ${result.reason ?? result.disposition}.`);
      }
      dispatched += 1;
    }
  }
  return Object.freeze({ ...observed, dispatched });
}


function hostedActionSelectedProviderIntent(argv: readonly string[]): string | undefined {
  const intentIndex = argv.indexOf('--intent');
  if (intentIndex < 0) return undefined;
  const value = argv[intentIndex + 1];
  return value === undefined || value.startsWith('--') ? undefined : value;
}

async function runPrepareParentPlanProvider(argv: string[]): Promise<string | null> {
  if (argv[0] !== 'ensure-hosted-action-provider' ||
      hostedActionSelectedProviderIntent(argv) !== 'prepare-parent-plan') return null;
  const args = hostedActionCliArgs(argv, ['--intent', '--request', '--envelope', '--output']);
  const sessionRequest = parseVerificationSessionHostedRequest(
    hostedActionTransportText(args.get('--request')!, 'hosted Session request')
  );
  const envelope = parseHostedEnvelope(
    JSON.parse(hostedActionTransportText(args.get('--envelope')!, 'hosted Session envelope')) as unknown
  );
  const parentPlan = createHostedActionParentPlan({ sessionRequest, envelope });
  writeHostedActionJson(args.get('--output')!, parentPlan);
  return JSON.stringify({
    status: 'prepared',
    artifactName: ciVerificationActionParentDispatchPlanArtifactName(
      parentPlan.parentRunId,
      parentPlan.parentRunAttempt
    ),
    payloadDigest: ciVerificationActionParentDispatchPlanPayloadDigest(parentPlan),
    parentDispatchPlanDigest: parentPlan.parentDispatchPlanDigest,
    proposalCount: parentPlan.proposals.length,
    output: path.resolve(args.get('--output')!)
  });
}

async function runVerifyParentPlanProvider(argv: string[]): Promise<string | null> {
  if (argv[0] !== 'ensure-hosted-action-provider' ||
      hostedActionSelectedProviderIntent(argv) !== 'verify-parent-plan') return null;
  const args = hostedActionCliArgs(argv, [
    '--intent', '--request', '--envelope', '--parent-plan',
    '--parent-artifact-id', '--parent-artifact-archive-digest'
  ]);
  const authority = hostedActionParentAuthority({
    requestPath: args.get('--request')!,
    envelopePath: args.get('--envelope')!,
    parentPlanPath: args.get('--parent-plan')!,
    parentArtifactId: args.get('--parent-artifact-id')!,
    parentArtifactArchiveDigest: args.get('--parent-artifact-archive-digest')!
  });
  return readParentPlanObservation(authority);
}

async function runCoordinateSessionProvider(argv: string[]): Promise<string | null> {
  if (argv[0] !== 'ensure-hosted-action-provider' ||
      hostedActionSelectedProviderIntent(argv) !== 'coordinate-session') return null;
  const args = hostedActionCliArgs(argv, [
    '--intent', '--request', '--envelope', '--parent-plan', '--parent-artifact-id',
    '--parent-artifact-archive-digest', '--artifact-index'
  ]);
  const authority = hostedActionParentAuthority({
    requestPath: args.get('--request')!,
    envelopePath: args.get('--envelope')!,
    parentPlanPath: args.get('--parent-plan')!,
    parentArtifactId: args.get('--parent-artifact-id')!,
    parentArtifactArchiveDigest: args.get('--parent-artifact-archive-digest')!
  });
  const coordinated = await coordinateHostedSessionProvider(authority);
  writeHostedActionJson(args.get('--artifact-index')!, coordinated.artifactIndex);
  return JSON.stringify({
    ...coordinated.coordination,
    dispatched: coordinated.dispatched,
    artifactIndex: path.resolve(args.get('--artifact-index')!)
  });
}

async function runObserveSessionProvider(argv: string[]): Promise<string | null> {
  if (argv[0] !== 'ensure-hosted-action-provider' ||
      hostedActionSelectedProviderIntent(argv) !== 'observe-session') return null;
  const args = hostedActionCliArgs(argv, [
    '--intent', '--request', '--envelope', '--parent-plan', '--parent-artifact-id',
    '--parent-artifact-archive-digest', '--artifact-index'
  ]);
  const authority = hostedActionParentAuthority({
    requestPath: args.get('--request')!,
    envelopePath: args.get('--envelope')!,
    parentPlanPath: args.get('--parent-plan')!,
    parentArtifactId: args.get('--parent-artifact-id')!,
    parentArtifactArchiveDigest: args.get('--parent-artifact-archive-digest')!
  });
  const observed = await observeHostedSessionProvider(authority);
  writeHostedActionJson(args.get('--artifact-index')!, observed.artifactIndex);
  return JSON.stringify({
    ...observed.coordination,
    dispatched: 0,
    artifactIndex: path.resolve(args.get('--artifact-index')!)
  });
}

async function runObserveActionProvider(argv: string[]): Promise<string | null> {
  if (argv[0] !== 'ensure-hosted-action-provider' ||
      hostedActionSelectedProviderIntent(argv) !== 'observe-action') return null;
  const args = hostedActionCliArgs(argv, [
    '--intent', '--provider-envelope', '--envelope', '--resolution', '--artifact-index'
  ]);
  const authority = hostedActionChildAuthority({
    providerEnvelopePath: args.get('--provider-envelope')!,
    envelopePath: args.get('--envelope')!,
    resolutionPath: args.get('--resolution')!
  });
  const observed = await observeHostedActionAuthority({
    providerEnvelope: authority.providerEnvelope,
    envelope: authority.envelope,
    role: 'child'
  });
  writeHostedActionJson(args.get('--artifact-index')!, observed.index);
  return JSON.stringify({
    ...observed.decision,
    artifactIndex: path.resolve(args.get('--artifact-index')!)
  });
}

async function runPrepareStartMarkerProvider(argv: string[]): Promise<string | null> {
  if (argv[0] !== 'ensure-hosted-action-provider' ||
      hostedActionSelectedProviderIntent(argv) !== 'prepare-start-marker') return null;
  const args = hostedActionCliArgs(argv, [
    '--intent', '--provider-envelope', '--envelope', '--resolution',
    '--prepared-candidate-archive', '--base-dependency-closure-digest',
    '--authenticated-git-closure-digest', '--output'
  ]);
  const authority = hostedActionChildAuthority({
    providerEnvelopePath: args.get('--provider-envelope')!,
    envelopePath: args.get('--envelope')!,
    resolutionPath: args.get('--resolution')!
  });
  const archiveInventory = CodexDevelopmentInspectHostedActionArchive({
    resolution: authority.resolution,
    preparedCandidateArchive: args.get('--prepared-candidate-archive')!,
    baseDependencyClosureDigest:
      args.get('--base-dependency-closure-digest')! as VerificationActionKeyDigest,
    authenticatedGitClosureDigest:
      args.get('--authenticated-git-closure-digest')! as VerificationActionKeyDigest
  });
  const sandboxCapability = await CodexDevelopmentProbeHostedSutSandboxCapability({
    actionKey: authority.resolution.actionPlan.action.actionKey
  });
  if (sandboxCapability.state === 'unknown') {
    throw new Error(`Hosted Action sandbox pre-start capability is an ambiguous machine observation: ${
      sandboxCapability.diagnostic ?? 'no diagnostic'
    }`);
  }
  const observed = await observeHostedActionAuthority({
    providerEnvelope: authority.providerEnvelope,
    envelope: authority.envelope,
    role: 'child'
  });
  if (observed.decision.disposition !== 'start-allowed' || !observed.decision.physicalExecutionAllowed) {
    throw new Error(`start marker cannot be prepared from ${observed.decision.disposition}.`);
  }
  const marker = createVerificationActionStartMarkerV2({
    actionKey: authority.resolution.actionPlan.action.actionKey,
    candidateSha: authority.resolution.artifactInput.headSha,
    executionEnvironmentRevision: CI_VERIFICATION_HOSTED_PROVIDER_REVISION,
    producer: currentHostedActionProducer()
  });
  writeVerificationActionStartMarkerV2Atomic(args.get('--output')!, marker);
  return JSON.stringify({
    status: 'marker-prepared',
    actionKey: marker.actionKey,
    markerName: verificationActionStartMarkerNameV2(marker.actionKey),
    markerDigest: marker.markerDigest,
    archiveDigest: archiveInventory.archiveDigest,
    archiveInventoryDigest: archiveInventory.inventoryDigest,
    sandboxCapabilityState: sandboxCapability.state,
    sandboxCapabilityDigest: ciActionDigest(sandboxCapability),
    output: path.resolve(args.get('--output')!)
  });
}

async function runClaimStartProvider(argv: string[]): Promise<string | null> {
  if (argv[0] !== 'ensure-hosted-action-provider' ||
      hostedActionSelectedProviderIntent(argv) !== 'claim-start') return null;
  const args = hostedActionCliArgs(argv, [
    '--intent', '--provider-envelope', '--envelope', '--resolution',
    '--prepared-candidate-archive', '--base-dependency-closure-digest',
    '--authenticated-git-closure-digest', '--output'
  ]);
  const authority = hostedActionChildAuthority({
    providerEnvelopePath: args.get('--provider-envelope')!,
    envelopePath: args.get('--envelope')!,
    resolutionPath: args.get('--resolution')!
  });
  const before = await ensureVerificationActionGitHubProviderTransaction({
    authority: { envelope: authority.providerEnvelope, actionPlanClosure: authority.envelope.actionPlanClosure },
    intent: { kind: 'coordinate' }
  });
  const markerObservation = before.snapshot.startObservations[0];
  if (before.disposition !== 'observed' || before.snapshot.startObservations.length !== 1 ||
      markerObservation?.expired !== false || markerObservation.payload === null) {
    throw new Error('claim-start requires one exact uploaded immutable start marker.');
  }
  const marker = parseVerificationActionStartMarkerV2(markerObservation.payload);
  const claimed = await ensureVerificationActionGitHubProviderTransaction({
    authority: { envelope: authority.providerEnvelope, actionPlanClosure: authority.envelope.actionPlanClosure },
    intent: { kind: 'claim-start', marker }
  });
  if (claimed.disposition !== 'started' || !claimed.newlyCreatedByThisInvocation || claimed.status === null) {
    return JSON.stringify({
      status: 'joined',
      actionKey: claimed.actionKey,
      issued: false,
      ticketDigest: null,
      output: null,
      reason: claimed.reason
    });
  }
  const startObservation = claimed.snapshot.startObservations[0];
  if (claimed.snapshot.startObservations.length !== 1 || startObservation?.payload === null) {
    throw new Error('claim-start readback lost the exact start marker.');
  }
  const preparedCandidateInventory = CodexDevelopmentInspectHostedActionArchive({
    resolution: authority.resolution,
    preparedCandidateArchive: args.get('--prepared-candidate-archive')!,
    baseDependencyClosureDigest:
      args.get('--base-dependency-closure-digest')! as VerificationActionKeyDigest,
    authenticatedGitClosureDigest:
      args.get('--authenticated-git-closure-digest')! as VerificationActionKeyDigest
  });
  const ticket = CodexDevelopmentCreateHostedActionExecutionTicket({
    resolution: authority.resolution,
    marker,
    startObservation,
    startStatus: claimed.status,
    preparedCandidateArtifactName:
      `sec-verification-action-prepared-v2-${marker.actionKey.slice(7)}-run-${marker.producer.runId}` +
      `-attempt-${marker.producer.runAttempt}`,
    preparedCandidateInventory
  });
  writeHostedActionJson(args.get('--output')!, ticket);
  return JSON.stringify({
    status: 'ticket-issued',
    actionKey: ticket.actionKey,
    issued: true,
    ticketDigest: ticket.ticketDigest,
    output: path.resolve(args.get('--output')!)
  });
}

async function runPrepareTerminalAnchorProvider(argv: string[]): Promise<string | null> {
  if (argv[0] !== 'ensure-hosted-action-provider' ||
      hostedActionSelectedProviderIntent(argv) !== 'prepare-terminal-anchor') return null;
  const args = hostedActionCliArgs(argv, [
    '--intent', '--provider-envelope', '--envelope', '--resolution', '--output'
  ]);
  const authority = hostedActionChildAuthority({
    providerEnvelopePath: args.get('--provider-envelope')!,
    envelopePath: args.get('--envelope')!,
    resolutionPath: args.get('--resolution')!
  });
  const observed = await observeHostedActionAuthority({
    providerEnvelope: authority.providerEnvelope,
    envelope: authority.envelope,
    role: 'child'
  });
  if (observed.decision.disposition !== 'repair-terminal-anchor' ||
      !observed.decision.terminalAnchorRepairAllowed) {
    throw new Error(`terminal anchor cannot be prepared from ${observed.decision.disposition}.`);
  }
  const startObservation = observed.index.startObservations[0];
  const terminalObservation = observed.index.terminalObservations[0];
  const startStatus = observed.index.providerStatusReadbacks[0]?.statuses.find(
    (entry) => entry.state === 'pending'
  );
  if (startObservation?.payload === null || startObservation?.payload === undefined ||
      startObservation.archiveDigest === null || terminalObservation?.artifact === null ||
      terminalObservation?.artifact === undefined ||
      terminalObservation.providerObservation.archiveDigest === null || startStatus === undefined) {
    throw new Error('terminal anchor lacks exact authenticated start and terminal bytes.');
  }
  const anchor = createVerificationActionTerminalStatusAnchorV2({
    actionKey: authority.resolution.actionPlan.action.actionKey,
    candidateSha: authority.resolution.artifactInput.headSha,
    startStatusId: startStatus.id,
    startStatusNodeId: startStatus.nodeId,
    startArtifactOriginId: startObservation.originId,
    startArtifactName: startObservation.artifactName,
    startArtifactArchiveDigest: startObservation.archiveDigest,
    startMarkerDigest: startObservation.payload.markerDigest,
    terminalArtifactOriginId: terminalObservation.providerObservation.originId,
    terminalArtifactName: terminalObservation.providerObservation.artifactName,
    terminalArtifactArchiveDigest: terminalObservation.providerObservation.archiveDigest,
    terminalArtifactPayloadDigest: terminalObservation.artifact.artifactDigest as VerificationActionKeyDigest,
    terminalAssemblerOrigin: terminalObservation.artifact.producer,
    anchorPublisherOrigin: currentHostedActionProducer()
  });
  writeVerificationActionTerminalStatusAnchorV2Atomic(args.get('--output')!, anchor);
  return JSON.stringify({
    status: 'anchor-prepared',
    actionKey: anchor.actionKey,
    anchorName: verificationActionProviderTerminalAnchorName(anchor.actionKey),
    anchorDigest: anchor.anchorDigest,
    output: path.resolve(args.get('--output')!)
  });
}

async function runAnchorTerminalProvider(argv: string[]): Promise<string | null> {
  if (argv[0] !== 'ensure-hosted-action-provider' ||
      hostedActionSelectedProviderIntent(argv) !== 'anchor-terminal') return null;
  const args = hostedActionCliArgs(argv, [
    '--intent', '--provider-envelope', '--envelope', '--resolution'
  ]);
  const authority = hostedActionChildAuthority({
    providerEnvelopePath: args.get('--provider-envelope')!,
    envelopePath: args.get('--envelope')!,
    resolutionPath: args.get('--resolution')!
  });
  const before = await ensureVerificationActionGitHubProviderTransaction({
    authority: { envelope: authority.providerEnvelope, actionPlanClosure: authority.envelope.actionPlanClosure },
    intent: { kind: 'coordinate' }
  });
  const anchorObservation = before.snapshot.terminalAnchorObservations[0];
  if (before.disposition !== 'observed' || before.snapshot.terminalAnchorObservations.length !== 1 ||
      anchorObservation?.expired !== false || anchorObservation.payload === null) {
    throw new Error('anchor-terminal requires one exact uploaded terminal anchor.');
  }
  const result = await ensureVerificationActionGitHubProviderTransaction({
    authority: { envelope: authority.providerEnvelope, actionPlanClosure: authority.envelope.actionPlanClosure },
    intent: { kind: 'anchor-terminal', anchor: anchorObservation.payload }
  });
  if ((result.disposition !== 'terminal-anchored' && result.disposition !== 'complete') ||
      result.status === null) {
    throw new Error(`neutral terminal tombstone was not anchored: ${result.reason ?? result.disposition}.`);
  }
  const index = hostedActionProviderIndexFromSnapshot(result.snapshot);
  const decision = CodexDevelopmentReduceHostedActionProviderIndex({
    resolution: authority.resolution,
    ...hostedActionRepositoryIdentity(),
    index
  });
  if (decision.disposition !== 'terminal-anchored') {
    throw new Error('neutral terminal tombstone did not read back as terminal-anchored.');
  }
  return JSON.stringify({
    status: 'terminal-anchored',
    actionKey: decision.actionKey,
    terminalPayloadDigest: decision.terminalPayloadDigest,
    decisionDigest: decision.decisionDigest
  });
}

async function runAssembleHostedActionTerminal(argv: string[]): Promise<string | null> {
  if (argv[0] !== 'assemble-hosted-action-terminal') return null;
  const args = hostedActionCliArgs(argv, [
    '--provider-envelope', '--envelope', '--resolution', '--ticket', '--raw-result',
    '--expected-raw-result-digest', '--output'
  ]);
  const authority = hostedActionChildAuthority({
    providerEnvelopePath: args.get('--provider-envelope')!,
    envelopePath: args.get('--envelope')!,
    resolutionPath: args.get('--resolution')!
  });
  const resolution = authority.resolution;
  const ticket = CodexDevelopmentParseHostedActionExecutionTicket(
    hostedActionTransportText(args.get('--ticket')!, 'hosted Action execution ticket')
  );
  const rawResult = CodexDevelopmentParseHostedActionRawResult(
    hostedActionTransportText(args.get('--raw-result')!, 'hosted Action raw result')
  );
  const observed = await ensureVerificationActionGitHubProviderTransaction({
    authority: { envelope: authority.providerEnvelope, actionPlanClosure: authority.envelope.actionPlanClosure },
    intent: { kind: 'coordinate' }
  });
  if (observed.disposition !== 'observed') {
    throw new Error(`Hosted Action assembler provider observation returned ${observed.disposition}.`);
  }
  const producer = currentHostedActionProducer();
  if (encodeVerificationActionData(producer) !== encodeVerificationActionData(ticket.producer)) {
    throw new Error('Hosted Action terminal assembler is not the original trusted claim run.');
  }
  const index = hostedActionProviderIndexFromSnapshot(observed.snapshot);
  const startObservation = index.startObservations[0];
  const readback = index.providerStatusReadbacks[0];
  const startStatus = readback?.statuses.find((entry) => entry.id === ticket.startStatusId);
  if (index.startObservations.length !== 1 || startObservation === undefined || startStatus === undefined ||
      index.terminalObservations.length !== 0 || index.terminalAnchorObservations.length !== 0) {
    throw new Error('Hosted Action assembler does not own the sole exact unresolved start ticket.');
  }
  const rebuiltTicket = CodexDevelopmentCreateHostedActionExecutionTicket({
    resolution,
    marker: startObservation.payload!,
    startObservation,
    startStatus,
    preparedCandidateArtifactName: ticket.preparedCandidateArtifactName,
    preparedCandidateInventory: hostedSutInventoryClosureFromTicket(ticket)
  });
  if (rebuiltTicket.ticketDigest !== ticket.ticketDigest) {
    throw new Error('Hosted Action assembler ticket no longer matches provider readback.');
  }
  const artifact = CodexDevelopmentAssembleHostedActionTerminal({
    resolution,
    ticket,
    rawResult,
    expectedRawResultDigest: args.get('--expected-raw-result-digest')! as VerificationActionKeyDigest,
    producer
  });
  CodexDevelopmentWriteVerificationActionTerminalArtifactV2Atomic(args.get('--output')!, artifact);
  return JSON.stringify({
    status: artifact.result.status,
    actionKey: artifact.actionPlan.action.actionKey,
    artifactName: verificationActionProviderTerminalArtifactName(artifact.actionPlan.action.actionKey),
    artifactDigest: artifact.artifactDigest,
    output: path.resolve(args.get('--output')!)
  });
}

async function tryRunHostedActionProvider(argv: string[]): Promise<string | null> {
  for (const handler of [
    runPrepareParentPlanProvider,
    runVerifyParentPlanProvider,
    runCoordinateSessionProvider,
    runObserveSessionProvider,
    runObserveActionProvider,
    runPrepareStartMarkerProvider,
    runClaimStartProvider,
    runPrepareTerminalAnchorProvider,
    runAnchorTerminalProvider
  ] as const) {
    const result = await handler(argv);
    if (result !== null) return result;
  }
  if (argv[0] === 'ensure-hosted-action-provider') {
    throw new Error(
      `Unknown ensure-hosted-action-provider intent: ${hostedActionSelectedProviderIntent(argv) ?? '<missing>'}.`
    );
  }
  return null;
}

export async function CodexDevelopmentCiVerificationHostedActionCli(argv: string[]): Promise<string> {
  const command = argv[0];
  if (command === 'execute-trusted-bootstrap-sut') {
    const args = hostedActionCliArgs(argv, [
      '--base-root', '--candidate-root', '--output-directory', '--base-sha',
      '--head-sha', '--tree-sha', '--manifest-path'
    ]);
    const result = await CodexDevelopmentExecuteTrustedBootstrapSut({
      baseRoot: args.get('--base-root')!,
      candidateRoot: args.get('--candidate-root')!,
      outputDirectory: args.get('--output-directory')!,
      baseSha: args.get('--base-sha')!,
      headSha: args.get('--head-sha')!,
      treeSha: args.get('--tree-sha')!,
      manifestPath: args.get('--manifest-path')!
    });
    return JSON.stringify(result);
  }
  const providerResult = await tryRunHostedActionProvider(argv);
  if (providerResult !== null) return providerResult;
  if (command === 'prepare-hosted-action-inputs') {
    const args = hostedActionCliArgs(argv, [
      '--resolution', '--base-root', '--candidate-root', '--output-directory'
    ]);
    const resolution = CodexDevelopmentParseHostedActionResolution(
      hostedActionTransportText(args.get('--resolution')!, 'hosted Action resolution')
    );
    const prepared = CodexDevelopmentPrepareHostedActionInputs({
      resolution,
      baseRoot: args.get('--base-root')!,
      candidateRoot: args.get('--candidate-root')!,
      outputDirectory: args.get('--output-directory')!
    });
    return JSON.stringify({
      status: 'prepared',
      actionKey: resolution.actionPlan.action.actionKey,
      preparedCandidateArchive: prepared.preparedCandidateArchive,
      archiveDigest: prepared.archiveInventory.archiveDigest,
      archiveInventoryDigest: prepared.archiveInventory.inventoryDigest,
      baseDependencyClosureDigest: prepared.baseDependencyClosureDigest,
      authenticatedGitClosureDigest: prepared.authenticatedGitClosureDigest
    });
  }
  if (command === 'self-test-hosted-action-sandbox') {
    const args = hostedActionCliArgs(argv, ['--resolution']);
    const resolution = CodexDevelopmentParseHostedActionResolution(
      hostedActionTransportText(args.get('--resolution')!, 'hosted Action resolution')
    );
    const observation = await CodexDevelopmentProbeHostedSutSandboxCapability({
      actionKey: resolution.actionPlan.action.actionKey
    });
    if (observation.state === 'unknown') {
      throw new Error(`Hosted Action sandbox capability is a retryable unknown machine observation: ${
        observation.diagnostic ?? 'no diagnostic'
      }`);
    }
    const { state, ...physicalObservation } = observation;
    return JSON.stringify({
      schema: 'sec-verification-action-sut-capability-v2',
      status: state,
      actionKey: resolution.actionPlan.action.actionKey,
      policyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST,
      observation: physicalObservation
    });
  }
  if (command === 'resolve-hosted-action') {
    const args = hostedActionCliArgs(argv, ['--provider-envelope', '--envelope', '--output']);
    const providerEnvelope = parseCiVerificationActionProviderEnvelope(
      JSON.parse(hostedActionTransportText(args.get('--provider-envelope')!, 'hosted Action provider envelope')) as unknown
    );
    const request = CodexDevelopmentParseHostedActionRequest(
      encodeVerificationActionData(providerEnvelope.proposal)
    );
    const envelope = parseHostedEnvelope(
      JSON.parse(hostedActionTransportText(args.get('--envelope')!, 'hosted Session envelope')) as unknown
    );
    const resolution = CodexDevelopmentResolveHostedAction({ request, envelope });
    writeHostedActionJson(args.get('--output')!, resolution);
    return JSON.stringify({
      status: 'resolved',
      actionKey: resolution.actionPlan.action.actionKey,
      actionKeyHex: resolution.actionKeyHex,
      resolutionDigest: resolution.resolutionDigest,
      output: path.resolve(args.get('--output')!)
    });
  }
  if (command === 'execute-hosted-action-sut') {
    const args = hostedActionCliArgs(argv, [
      '--resolution', '--ticket', '--prepared-candidate-archive', '--output'
    ]);
    const resolution = CodexDevelopmentParseHostedActionResolution(
      hostedActionTransportText(args.get('--resolution')!, 'hosted Action resolution')
    );
    const ticket = CodexDevelopmentParseHostedActionExecutionTicket(
      hostedActionTransportText(args.get('--ticket')!, 'hosted Action execution ticket')
    );
    if (ticket.resolutionDigest !== resolution.resolutionDigest ||
        ticket.actionKey !== resolution.actionPlan.action.actionKey ||
        ticket.candidateSha !== resolution.artifactInput.headSha ||
        ticket.candidateBytesDigest !== resolution.artifactInput.candidateBytesDigest) {
      throw new Error('Hosted Action SUT ticket differs from the trusted resolution.');
    }
    const archiveInventory = CodexDevelopmentMaterializeHostedActionCandidate({
      resolution,
      ticket,
      preparedCandidateArchive: args.get('--prepared-candidate-archive')!
    });
    const rawResult = await CodexDevelopmentExecuteHostedActionSut({
      resolution,
      ticket,
      candidateArchive: args.get('--prepared-candidate-archive')!,
      archiveInventory
    });
    writeHostedActionJson(args.get('--output')!, rawResult);
    return JSON.stringify({
      rawResultDigest: rawResult.rawResultDigest,
      output: path.resolve(args.get('--output')!)
    });
  }
  const terminalResult = await runAssembleHostedActionTerminal(argv);
  if (terminalResult !== null) return terminalResult;
  if (command === 'compose-hosted-evidence') {
    const args = hostedActionCliArgs(argv, [
      '--envelope', '--artifact-index', '--output'
    ]);
    const envelope = parseHostedEnvelope(
      JSON.parse(hostedActionTransportText(args.get('--envelope')!, 'hosted Session envelope')) as unknown
    );
    const index = CodexDevelopmentReadHostedActionArtifactIndex({
      source: hostedActionTransportText(args.get('--artifact-index')!, 'hosted Action artifact index')
    });
    const producer = CodexDevelopmentCreateVerificationEvidenceProducer({
      sourceTransport: 'github-actions',
      workflowPath: '.github/workflows/compiler-pr-validation.yml',
      workflowRef: `.github/workflows/compiler-pr-validation.yml@${envelope.session.baseSha}`,
      workflowSha: envelope.session.baseSha,
      runId: process.env.GITHUB_RUN_ID ?? '',
      runAttempt: positiveEnvironmentInteger('GITHUB_RUN_ATTEMPT'),
      actorNodeId: envelope.scopeAuthorization.issuer.principalId
    });
    const composed = CodexDevelopmentComposeHostedEvidence({
      envelope,
      observations: index.observations,
      startObservations: index.startObservations,
      terminalAnchorObservations: index.terminalAnchorObservations,
      providerStatusReadbacks: index.providerStatusReadbacks,
      producer
    });
    if (composed.evidence !== null) {
      CodexDevelopmentWriteVerificationEvidenceV4Atomic(args.get('--output')!, composed.evidence);
    }
    return JSON.stringify({
      ...composed.coordination,
      evidenceWritten: composed.evidence !== null,
      output: composed.evidence === null ? null : path.resolve(args.get('--output')!)
    });
  }
  throw new Error(`Unknown hosted Action command: ${command ?? '<missing>'}.`);
}
