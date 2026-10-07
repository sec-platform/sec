import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { types as nativeTypes } from 'node:util';
import { snapshotVerificationData } from '../../../../assurance/verification/contract/data.ts';
import { CI_VERIFICATION_CONTRACT_REVISION, CI_VERIFICATION_WORKFLOW_PATH } from '../../../../assurance/verification/contract/revision.ts';
import type { VerificationGateResult } from "../../../../assurance/verification/result/contract/result.ts";
import { cloneAndDeepFreeze, deepFreeze, uniqueSorted } from '../../../../contracts/canonical.ts';
import {
  observeExecutionProgressPhase
} from '../../../../execution/execution-progress.ts';
import { withAcquiredResource } from '../../../../execution/resource-settlement.ts';
import type { CiVerificationActionPlanClosure, VerificationActionKeyDigest } from '../../../../execution/verification/action.ts';
import type { VerificationSessionHostedRequest } from "../../../../execution/verification/hosted.ts";
import type { VerificationGateEvidence } from '../../../../execution/verification/session.ts';
import {
  withAuthorityGitReadOperation,
  type AuthorityGitReadOperation
} from '../../../providers/git-read/authority.ts';
import {
  GIT_READ_EXACT_TREE_OPERATION_BUDGET,
  type GitBlobBytes
} from '../../../providers/git-read/runtime/session.ts';
import { ciVerificationHostedActionCandidateRoot, ciVerificationHostedJobTransportSlot } from '../../../providers/github-api/contract/hosted-job-policy.ts';
import { assertAuthenticatedGitHubJobOriginCurrent, type AuthenticatedGitHubJobOrigin } from '../../../providers/github-api/hosted-job-origin.ts';
import { withGitHubApiVerificationSession } from '../../../providers/github-api/operation-session.ts';
import { normalizeGitHubRepositoryPermission } from '../../../providers/github-api/repository-permission.ts';
import type { PhysicalWorkspaceSourceSnapshot } from '../../../repository/source-program-model/workspace-source-snapshot.ts';
import {
  assertSameNoFollowDirectoryIdentity,
  inspectExactNoFollowDirectoryPresence,
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
import { encodeVerificationActionData } from '../action/contract/action.ts';
import { buildCiVerificationActionPlanClosure, CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT, ciVerificationActionParentDispatchPlanArtifactName, ciVerificationActionParentDispatchPlanPayloadDigest, ciVerificationGateStep, createCiVerificationActionParentDispatchPlan, createCiVerificationActionProposal, createCiVerificationActionProviderEnvelope, createCiVerificationLocalExecutionEnvironment, parseCiSourceProgramTransitionBinding, parseCiVerificationActionParentDispatchPlan, parseCiVerificationActionProviderEnvelope, SOURCE_PROGRAM_TRANSITION_CANDIDATE_ROOT, SOURCE_PROGRAM_TRANSITION_ENTRYPOINT, SOURCE_PROGRAM_TRANSITION_GATE_ID, SOURCE_PROGRAM_TRANSITION_OUTPUT_FILE, type CiSourceProgramTransitionBinding, type CiVerificationActionCandidate, type CiVerificationActionParentActor, type CiVerificationActionParentDispatchPlan, type CiVerificationActionProviderEnvelope, type CiVerificationExecutionEnvironment, type CiVerificationGateStep, type CiVerificationProducerGate } from '../action/contract/ci.ts';
import { CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS, CI_VERIFICATION_HOSTED_PROVIDER_REVISION } from '../action/contract/environment.ts';
import { createVerificationActionProviderStartMarker, createVerificationActionProviderTerminalAnchor, parseVerificationActionProviderStartMarker, verificationActionProviderStartArtifactName, verificationActionProviderTerminalAnchorName, verificationActionProviderTerminalArtifactName } from '../action/contract/provider.ts';
import {
  writeVerificationActionProviderStartMarkerAtomic,
  writeVerificationActionProviderTerminalAnchorAtomic
} from '../action/journal.ts';
import type { CodexDevelopmentGitChangedRecord, CodexDevelopmentTestImpactTransitionObservation } from '../test-impact/runtime/transition.ts';
import { CodexDevelopmentAssertTestImpactTransitionSelection } from '../test-impact/runtime/transition.ts';
import { CodexDevelopmentCreateVerificationEvidenceProducer, CodexDevelopmentFinalizeVerificationEvidenceV4, CodexDevelopmentPrepareVerificationEvidenceTarget, CodexDevelopmentVerificationDigest, CodexDevelopmentWriteVerificationActionTerminalArtifactV2Atomic, CodexDevelopmentWriteVerificationEvidenceV4Atomic, parseTrustedRuntimeSourceProgramActionRecord, type TrustedRuntimeSourceProgramActionRecord } from './contract/evidence.ts';
import { CodexDevelopmentParseHostedActionRawResult, parseHostedSutCapabilityObservation } from './contract/hosted-sut-observation.ts';
import {
  assertCiExpectedHead,
  CodexDevelopmentBuildVerificationPlan, type CodexDevelopmentVerificationPlanProfile
} from './contract/plan.ts';
import {
  CI_VERIFICATION_HOSTED_SANDBOX_POLICY,
  CI_VERIFICATION_SESSION_CONTRACT_REVISION,
  CI_VERIFICATION_SESSION_DISPATCH_TYPE
} from './contract/revision.ts';
import { readAuthenticatedHostedJobRuntimeReceipt, type HostedJobRuntimeReceiptSelection } from './runtime/hosted-job-runtime-provenance.ts';

import { parseVerificationSessionHostedRequest } from "./contract/session-request.ts";
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
import type { CodexDevelopmentCiVerificationTestOptions } from './verification-action-effect.ts';
import { CodexDevelopmentExecuteCiActionClosure } from './verification-action-effect.ts';
import { CodexDevelopmentAssembleHostedActionTerminal, CodexDevelopmentComposeHostedEvidence, CodexDevelopmentCoordinateHostedActions } from './verification-coordination.ts';
import type { CodexDevelopmentHostedActionProviderIndex } from './verification-hosted-action-contract.ts';
import { CI_VERIFICATION_ACTION_ARTIFACT_INDEX_SCHEMA, ciActionDigest, CodexDevelopmentCreateHostedActionExecutionTicket, CodexDevelopmentParseHostedActionExecutionTicket, CodexDevelopmentParseHostedActionRequest, CodexDevelopmentParseHostedActionResolution, CodexDevelopmentReadHostedActionArtifactIndex, CodexDevelopmentReduceHostedActionProviderIndex, CodexDevelopmentResolveHostedAction, FORMAL_HOSTED_ONLY_ENV_KEYS, FORMAL_TRUSTED_RUNTIME_ONLY_ENV_KEYS, FORMAL_VERIFICATION_ENV_KEYS, hostedActionProviderIndexFromSnapshot, INVALIDATION_RULES, parseHostedEnvelope, VERIFICATION_EVIDENCE_PATH } from './verification-hosted-action-contract.ts';
import { CodexDevelopmentAssertHostedActionDependencyInputsV1, CodexDevelopmentAssertPreparedHostedActionCandidate, CodexDevelopmentInspectHostedActionArchive, CodexDevelopmentPrepareHostedActionInputs, currentHostedActionProducer, hostedActionRepositoryIdentity } from './verification-materialization.ts';
import { writeHostedActionJson } from './verification-shared.ts';
import { hostedSutInventoryClosureFromTicket } from './verification-sut.ts';

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
  let actionGates: readonly VerificationGateEvidence<VerificationGateResult>[] = [];
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
  'prepare-hosted-action-inputs'
]);

export function hostedActionCliArgs(
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

export function hostedActionTransportText(filePath: string, label: string): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(
    hostedActionTransportBytes(filePath, label)
  );
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
  sessionRequest: VerificationSessionHostedRequest<typeof import("./contract/session-request.ts").CI_VERIFICATION_SESSION_REQUEST_SCHEMA>
): void {
  const event = hostedActionRecord(eventValue, 'parent Session event');
  const expectedClientPayload = Object.freeze({ payload: sessionRequest });
  if (event.action !== CI_VERIFICATION_SESSION_DISPATCH_TYPE ||
      encodeVerificationActionData(event.client_payload) !==
        encodeVerificationActionData(expectedClientPayload)) {
    throw new Error('parent dispatch plan event does not contain the exact Session request wrapper.');
  }
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

/** Captures and publication admission for the application coordination stages.
 * A parsed/constructed value is data. Only this invocation's retained captures,
 * original provider readbacks and private prepared rows admit publication. */
export function createHostedActionCoordinationStagePorts(origin: AuthenticatedGitHubJobOrigin) {
  const ownField = <Value extends object, Key extends keyof Value>(input: Value, key: Key): Value[Key] => {
    if (nativeTypes.isProxy(input)) throw new TypeError('Hosted stage input cannot be a Proxy.');
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      throw new TypeError('Hosted stage fields must be enumerable own data.');
    }
    return descriptor.value;
  };
  const ownedPure = <Value>(value: Value): Value => {
    // Original verifier rejects proxies, accessors and non-data descendants.
    // Only after that non-calling inspection may the native clone own them.
    snapshotVerificationData(value, 'Hosted stage data');
    return cloneAndDeepFreeze(value);
  };
  const current = (phase?: string) => {
    const job = assertAuthenticatedGitHubJobOriginCurrent(origin);
    const phases = job.policyJobId === 'coordinate-verification-session'
      ? ['prepare-parent-plan', 'coordinate-session']
      : job.policyJobId === 'resolve-verification-action' ? ['resolve-hosted-action']
      : job.policyJobId === 'claim-verification-action' ? ['prepare-start-marker', 'claim-start'] : [];
    const role = job.policyJobId === 'coordinate-verification-session' ? 'control' : 'trusted';
    if (job.role !== role || !phases.includes(job.phase)
        || (phase !== undefined && phase !== job.phase)
        || job.trustedDriverRoot !== path.resolve(import.meta.dir, '../../../../..')) {
      throw new Error('Hosted coordination requires its original authenticated job and stage.');
    }
    return job;
  };
  current();
  type Envelope = ReturnType<typeof parseHostedEnvelope>;
  type Resolution = ReturnType<typeof CodexDevelopmentResolveHostedAction>;
  type Authority = Readonly<{ providerEnvelope: CiVerificationActionProviderEnvelope; envelope: Envelope }>;
  type Transaction = Awaited<ReturnType<typeof ensureVerificationActionGitHubProviderTransaction>>;
  type InventoryInput = Parameters<typeof CodexDevelopmentInspectHostedActionArchive>[0];
  type Inventory = ReturnType<typeof CodexDevelopmentInspectHostedActionArchive>;
  type Ticket = ReturnType<typeof CodexDevelopmentCreateHostedActionExecutionTicket>;
  type Marker = ReturnType<typeof createVerificationActionProviderStartMarker>;
  type Evidence = NonNullable<ReturnType<typeof CodexDevelopmentComposeHostedEvidence>['evidence']>;
  const texts = new Map<string, Readonly<{ file: string; label: string }>>();
  const captures = new WeakMap<object, string>();
  const resolutions = new WeakMap<object, Authority>();
  const inventories = new WeakMap<object, InventoryInput>();
  const inspectedInventories: Inventory[] = [];
  const providerEnvelopes: CiVerificationActionProviderEnvelope[] = [];
  const transactions: Readonly<{ authority: Authority; result: Transaction }>[] = [];
  const plans = new WeakMap<object, Parameters<typeof createCiVerificationActionParentDispatchPlan>[0]>();
  const markers = new WeakMap<object, Readonly<{ authority: Authority; snapshot: Transaction['snapshot']; inventory: Inventory;
    sandboxSource: string; sandboxSelection: HostedJobRuntimeReceiptSelection }>>();
  const ticketClaims = new WeakSet<object>();
  const tickets = new WeakMap<object, { readonly authority: Authority; readonly snapshot: Transaction['snapshot'];
    readonly inventory: Inventory; state: 'issued' | 'prepared' | 'consumed' }>();
  const evidenceRows = new WeakMap<object, Parameters<typeof CodexDevelopmentComposeHostedEvidence>[0]>();
  const prepared = new WeakSet<object>();
  const indexRows = new WeakMap<object, Transaction['snapshot']>();
  let sandboxCapture: Readonly<{ actionKey: VerificationActionKeyDigest; value: object; source: string; selection: HostedJobRuntimeReceiptSelection }> | undefined;
  const readTransport = (file: string, label: string): string => {
    current(); const source = hostedActionTransportText(file, label);
    texts.set(source, Object.freeze({ file, label })); current(); return source;
  };
  const assertText = (source: string): void => {
    const row = texts.get(source);
    if (row === undefined || hostedActionTransportText(row.file, row.label) !== source) {
      throw new Error('Hosted coordination input is not an unchanged original transport capture.');
    }
  };
  const captured = <T extends object>(source: string, parse: (source: string) => T): T => {
    assertText(source); const value = deepFreeze(parse(source)); captures.set(value, source); return value;
  };
  const capturedJson = <T extends object>(value: unknown, parse: (value: unknown) => T): T => {
    const canonical = encodeVerificationActionData(snapshotVerificationData(value, 'Hosted captured JSON'));
    const source = [...texts.keys()].find(text => encodeVerificationActionData(JSON.parse(text) as unknown) === canonical);
    if (source === undefined) throw new Error('Hosted coordination parser requires original captured bytes.');
    return captured(source, text => parse(JSON.parse(text) as unknown));
  };
  const assertCaptured = (value: object) => {
    const source = captures.get(value);
    if (source === undefined) throw new Error('Hosted coordination requires its original captured object.');
    assertText(source);
  };
  const assertAuthority = (authority: Authority) => {
    current(); assertCaptured(authority.providerEnvelope); assertCaptured(authority.envelope);
  };
  const resolveAction = (input: Parameters<typeof CodexDevelopmentResolveHostedAction>[0]): Resolution => {
    input = Object.freeze({ request: ownedPure(ownField(input, 'request')), envelope: ownField(input, 'envelope') });
    assertCaptured(input.envelope);
    const provider = [...transactions].find(row => row.authority.envelope === input.envelope
      && encodeVerificationActionData(row.authority.providerEnvelope.proposal) === encodeVerificationActionData(input.request));
    const source = [...texts.keys()].find(text => {
      try { return encodeVerificationActionData(parseCiVerificationActionProviderEnvelope(JSON.parse(text) as unknown).proposal)
        === encodeVerificationActionData(input.request); } catch { return false; }
    });
    const providerEnvelope = provider?.authority.providerEnvelope ?? providerEnvelopes.find(value =>
      encodeVerificationActionData(value.proposal) === encodeVerificationActionData(input.request)) ?? (source === undefined ? undefined
      : captured(source, text => parseCiVerificationActionProviderEnvelope(JSON.parse(text) as unknown)));
    const result = deepFreeze(CodexDevelopmentResolveHostedAction(input));
    if (providerEnvelope !== undefined) resolutions.set(result, Object.freeze({ providerEnvelope, envelope: input.envelope }));
    return result;
  };
  const transaction = async (authority: Authority, intent: Parameters<typeof ensureVerificationActionGitHubProviderTransaction>[0]['intent']) => {
    const selectedAuthority = Object.freeze({ providerEnvelope: ownField(authority, 'providerEnvelope'), envelope: ownField(authority, 'envelope') });
    const selectedIntent = ownedPure(intent);
    assertAuthority(selectedAuthority);
    const result = await ensureVerificationActionGitHubProviderTransaction({
      origin,
      authority: { envelope: selectedAuthority.providerEnvelope, actionPlanClosure: selectedAuthority.envelope.actionPlanClosure }, intent: selectedIntent
    });
    assertAuthority(selectedAuthority);
    const retained = deepFreeze(result); transactions.push(Object.freeze({ authority: selectedAuthority, result: retained }));
    return retained;
  };
  const providerIndex = (snapshot: Transaction['snapshot']) => {
    if (!transactions.some(row => row.result.snapshot === snapshot)) throw new Error('Provider index is not an original native readback.');
    const index = deepFreeze(hostedActionProviderIndexFromSnapshot(snapshot)); indexRows.set(index, snapshot); return index;
  };
  const latest = (authority: Authority) => {
    const row = [...transactions].reverse().find(row => row.authority.providerEnvelope === authority.providerEnvelope
      && row.authority.envelope === authority.envelope);
    if (row === undefined) throw new Error('Hosted preparation lacks its original provider transaction.');
    assertAuthority(authority); return row;
  };
  const subjectState = (authority: Authority, snapshot: Transaction['snapshot']) => {
    const resolution = CodexDevelopmentResolveHostedAction({ request: CodexDevelopmentParseHostedActionRequest(
      encodeVerificationActionData(authority.providerEnvelope.proposal)), envelope: authority.envelope });
    const index = hostedActionProviderIndexFromSnapshot(snapshot);
    const ordered = (values: readonly unknown[]) => values.map(value => encodeVerificationActionData(value)).sort();
    return { decision: CodexDevelopmentReduceHostedActionProviderIndex({ resolution, ...hostedActionRepositoryIdentity(), index }),
      start: ordered(index.startObservations), terminal: ordered(index.terminalObservations),
      anchor: ordered(index.terminalAnchorObservations),
      status: ordered(index.providerStatusReadbacks.map(row => ({ ...row, statuses: ordered(row.statuses) }))) };
  };
  const fresh = async (authority: Authority, snapshot: Transaction['snapshot'], phase: string,
    kind: 'coordinate-parent' | 'coordinate'): Promise<void> => {
    current(phase); assertAuthority(authority);
    const result = await transaction(authority, { kind });
    current(phase);
    if (result.disposition !== 'observed' || encodeVerificationActionData(subjectState(authority, snapshot))
        !== encodeVerificationActionData(subjectState(authority, result.snapshot))) {
      throw new Error('Hosted publication subject changed after preparation.');
    }
  };
  const inspectArchive = (input: InventoryInput) => {
    input = Object.freeze({ resolution: ownField(input, 'resolution'),
      preparedCandidateArchive: ownField(input, 'preparedCandidateArchive'),
      baseDependencyClosureDigest: ownField(input, 'baseDependencyClosureDigest'),
      authenticatedGitClosureDigest: ownField(input, 'authenticatedGitClosureDigest') });
    if (!resolutions.has(input.resolution)) throw new Error('Archive inspection requires original resolved Action capture.');
    current(); const value = deepFreeze(CodexDevelopmentInspectHostedActionArchive(input));
    inventories.set(value, Object.freeze({ ...input })); inspectedInventories.push(value); return value;
  };
  const candidateRoots = (resolution: Resolution) => {
    const job = current('prepare-start-marker');
    if (!resolutions.has(resolution) || sandboxCapture?.actionKey !== resolution.actionPlan.action.actionKey
        || !('state' in sandboxCapture.value) || sandboxCapture.value.state !== 'supported') {
      throw new Error('Candidate preparation requires its original resolved Action and authenticated supported preflight.');
    }
    const candidateRoot = path.resolve(job.trustedDriverRoot, ciVerificationHostedActionCandidateRoot());
    if (inspectExactNoFollowDirectoryPresence(path.resolve(candidateRoot, 'node_modules'),
      'Hosted Action candidate preexisting dependencies').state !== 'absent') {
      throw new Error('Hosted Action candidate contains a foreign dependency materialization.');
    }
    return Object.freeze({ baseRoot: job.trustedDriverRoot, candidateRoot });
  };
  const assertInventory = (value: Inventory) => {
    const input = inventories.get(value);
    if (input === undefined || encodeVerificationActionData(CodexDevelopmentInspectHostedActionArchive(input)) !== encodeVerificationActionData(value)) {
      throw new Error('Prepared candidate archive changed after its original inspection.');
    }
  };
  const consume = (value: object) => {
    if (!prepared.has(value)) throw new Error('Hosted writer requires its own privately prepared publication.');
    prepared.delete(value);
  };
  const parentContext = () => {
    const job = current();
    return Object.freeze({ runId: job.runId, runAttempt: job.runAttempt, workflowSha: job.workflowSha,
      workflowRef: process.env.GITHUB_WORKFLOW_REF ?? '', job: process.env.GITHUB_JOB ?? '' });
  };
  const assertPlan = (plan: CiVerificationActionParentDispatchPlan) => {
    const input = plans.get(plan), job = current('prepare-parent-plan');
    if (input === undefined || input.repository !== job.repository || input.parentRunId !== job.runId
        || input.parentRunAttempt !== job.runAttempt || input.parentWorkflowSha !== job.workflowSha
        || input.parentWorkflowRef !== `${job.repository}/.github/workflows/compiler-pr-validation.yml@refs/heads/main`
        || process.env.GITHUB_JOB !== 'coordinate-verification-session'
        || input.parentJobId !== hostedActionParentJobId(job.repository, job.runId, job.runAttempt)
        || encodeVerificationActionData(input.parentActor) !== encodeVerificationActionData(hostedActionParentActor(job.repository))
        || encodeVerificationActionData(createCiVerificationActionParentDispatchPlan(input)) !== encodeVerificationActionData(plan)) {
      throw new Error('Parent publication differs from its original current coordinator and human.');
    }
    const requestSource = [...texts.keys()].find(source => {
      try { const request = parseVerificationSessionHostedRequest(source); return input.proposals.every(proposal =>
        encodeVerificationActionData(proposal.sessionRequest) === encodeVerificationActionData(request)); } catch { return false; }
    });
    if (requestSource === undefined) throw new Error('Parent plan lacks its original full Session request capture.');
    assertText(requestSource);
    const envelopeSource = [...texts.keys()].find(source => {
      try { const envelope = parseHostedEnvelope(JSON.parse(source) as unknown);
        return envelope.session.baseSha === job.workflowSha && encodeVerificationActionData(input.proposals)
          === encodeVerificationActionData(envelope.actionPlanClosure.actions.map(member => createCiVerificationActionProposal({
            sessionRequest: parseVerificationSessionHostedRequest(requestSource), proposedActionKey: member.action.actionKey
          })).sort((left, right) => left.proposedActionKey.localeCompare(right.proposedActionKey))); } catch { return false; }
    });
    if (envelopeSource === undefined) throw new Error('Parent plan does not bind the complete original Session closure.');
    assertText(envelopeSource);
    const envelope = parseHostedEnvelope(JSON.parse(envelopeSource) as unknown);
    if (envelope.scopeAuthorization.issuer.principalId !== input.parentActor.nodeId) {
      throw new Error('Parent plan human differs from the original Scope issuer.');
    }
    for (const proposal of input.proposals) CodexDevelopmentResolveHostedAction({
      request: CodexDevelopmentParseHostedActionRequest(encodeVerificationActionData(proposal)), envelope
    });
  };
  return {
    readTransport, sourceText: (source: string) => { assertText(source); return source; },
    parseSessionRequest: (source: string) => captured(source, parseVerificationSessionHostedRequest),
    parseEnvelope: (value: unknown) => capturedJson(value, parseHostedEnvelope),
    parseParentPlan: (value: unknown) => capturedJson(value, parseCiVerificationActionParentDispatchPlan),
    parseProviderEnvelope: (value: unknown) => {
      const parsed = capturedJson(value, parseCiVerificationActionProviderEnvelope); providerEnvelopes.push(parsed); return parsed;
    },
    parseResolution: (source: string) => captured(source, CodexDevelopmentParseHostedActionResolution),
    parseStartMarker: (value: unknown) => {
      const row = transactions.find(row => row.result.snapshot.startObservations.some(start => start.payload === value));
      if (row === undefined) throw new Error('Start marker is not an original provider readback.');
      return deepFreeze(parseVerificationActionProviderStartMarker(value));
    },
    canonicalSource: encodeVerificationActionData, parseActionRequest: CodexDevelopmentParseHostedActionRequest,
    resolveAction, createProposal: (input: Parameters<typeof createCiVerificationActionProposal>[0]) => createCiVerificationActionProposal(ownedPure(input)),
    createProviderEnvelope: (input: Parameters<typeof createCiVerificationActionProviderEnvelope>[0]) => {
      input = Object.freeze({ proposal: ownedPure(ownField(input, 'proposal')), parentPlan: ownField(input, 'parentPlan'),
        parentDispatchPlanArtifactId: ownField(input, 'parentDispatchPlanArtifactId'),
        parentDispatchPlanArchiveDigest: ownField(input, 'parentDispatchPlanArchiveDigest') });
      assertCaptured(input.parentPlan); const value = deepFreeze(createCiVerificationActionProviderEnvelope(input));
      const source = captures.get(input.parentPlan)!; captures.set(value, source); providerEnvelopes.push(value); return value;
    },
    repositoryIdentity: () => { current(); return hostedActionRepositoryIdentity(); }, parentContext,
    assertCandidate: (resolution: Resolution) => {
      const roots = candidateRoots(resolution);
      CodexDevelopmentAssertPreparedHostedActionCandidate({ resolution, candidateRoot: roots.candidateRoot });
      current('prepare-start-marker');
    },
    checkDependencyInputs: (resolution: Resolution) => {
      const roots = candidateRoots(resolution);
      const digest = CodexDevelopmentAssertHostedActionDependencyInputsV1({ ...roots, baseSha: resolution.artifactInput.baseSha });
      current('prepare-start-marker'); return digest;
    },
    prepareCandidateArchive: (input: Readonly<{ resolution: Resolution; outputDirectory: string }>) => {
      input = Object.freeze({ resolution: ownField(input, 'resolution'), outputDirectory: ownField(input, 'outputDirectory') });
      const roots = candidateRoots(input.resolution);
      if (path.resolve(input.outputDirectory) !== path.resolve(roots.baseRoot,
        ciVerificationHostedJobTransportSlot('claim-verification-action', 'out', 'prepared'))) {
        throw new Error('Prepared candidate archive output is not its sole canonical transport directory.');
      }
      const value = deepFreeze(CodexDevelopmentPrepareHostedActionInputs({ ...roots, ...input }));
      current('prepare-start-marker'); return value;
    },
    parentJobId: hostedActionParentJobId, parentActor: hostedActionParentActor,
    createParentPlan: (input: Parameters<typeof createCiVerificationActionParentDispatchPlan>[0]) => {
      current('prepare-parent-plan'); const retained = ownedPure(input);
      const plan = deepFreeze(createCiVerificationActionParentDispatchPlan(retained)); plans.set(plan, retained); return plan;
    },
    parentPlanArtifactName: ciVerificationActionParentDispatchPlanArtifactName,
    parentPlanPayloadDigest: ciVerificationActionParentDispatchPlanPayloadDigest,
    transaction, providerIndex, artifactIndexSchema: CI_VERIFICATION_ACTION_ARTIFACT_INDEX_SCHEMA,
    reduceProvider: (input: Parameters<typeof CodexDevelopmentReduceHostedActionProviderIndex>[0]) => CodexDevelopmentReduceHostedActionProviderIndex(ownedPure(input)),
    coordinate: (input: Parameters<typeof CodexDevelopmentCoordinateHostedActions>[0]) => CodexDevelopmentCoordinateHostedActions(ownedPure(input)),
    inspectArchive,
    captureSandboxCapability: async (input: Readonly<{ selection: HostedJobRuntimeReceiptSelection; actionKey: VerificationActionKeyDigest }>) => {
      const job = current('prepare-start-marker'), selected = ownedPure(input);
      if (selected.selection.repository !== job.repository || selected.selection.actionKey !== selected.actionKey
          || selected.selection.policyJobId !== 'preflight-verification-action-sut'
          || selected.selection.phase !== 'self-test-hosted-action-sandbox') throw new Error('Sandbox receipt selector differs from the original Action preflight.');
      const proof = await withGitHubApiVerificationSession({ repositoryRoot: job.trustedDriverRoot, repository: job.repository,
        effect: 'verification-read', deadlineAtUnixMs: job.deadlineAtUnixMs,
        operation: capability => readAuthenticatedHostedJobRuntimeReceipt({ ...selected.selection, capability }) });
      current('prepare-start-marker');
      const output = hostedActionRecord(JSON.parse(proof.outputSource) as unknown, 'authenticated sandbox capability');
      if (output.actionKey !== selected.actionKey) throw new Error('Sandbox output differs from the original selected Action.');
      const state = output.status;
      if (state !== 'supported' && state !== 'unsupported' && state !== 'invalidated' && state !== 'unknown') {
        throw new Error('Authenticated sandbox capability has no original finite state.');
      }
      const observation = parseHostedSutCapabilityObservation(output.observation);
      const value = deepFreeze({ ...observation, state });
      sandboxCapture = Object.freeze({ actionKey: selected.actionKey, value, source: proof.outputSource, selection: selected.selection });
      return value;
    },
    producer: () => { current(); return currentHostedActionProducer(); },
    createStartMarker: (input: Parameters<typeof createVerificationActionProviderStartMarker>[0]) => createVerificationActionProviderStartMarker(ownedPure(input)),
    providerRevision: CI_VERIFICATION_HOSTED_PROVIDER_REVISION,
    prepareMarker: (marker: Marker) => {
      marker = ownedPure(marker);
      current('prepare-start-marker');
      const row = [...transactions].reverse().find(row => row.authority.providerEnvelope.proposal.proposedActionKey === marker.actionKey);
      if (row === undefined || row.result.disposition !== 'observed' || sandboxCapture?.actionKey !== marker.actionKey
          || !('state' in sandboxCapture.value) || sandboxCapture.value.state === 'unknown') throw new Error('Marker preparation lacks original preflight and provider facts.');
      const resolution = CodexDevelopmentResolveHostedAction({ request: CodexDevelopmentParseHostedActionRequest(
        encodeVerificationActionData(row.authority.providerEnvelope.proposal)), envelope: row.authority.envelope });
      const decision = CodexDevelopmentReduceHostedActionProviderIndex({ resolution, ...hostedActionRepositoryIdentity(),
        index: hostedActionProviderIndexFromSnapshot(row.result.snapshot) });
      const inventory = inspectedInventories.filter(value => inventories.get(value)?.resolution.resolutionDigest === resolution.resolutionDigest);
      if (decision.disposition !== 'start-allowed' || !decision.physicalExecutionAllowed
          || encodeVerificationActionData(createVerificationActionProviderStartMarker({ actionKey: marker.actionKey,
            candidateSha: resolution.artifactInput.headSha, executionEnvironmentRevision: CI_VERIFICATION_HOSTED_PROVIDER_REVISION,
            producer: currentHostedActionProducer() })) !== encodeVerificationActionData(marker)
          || inventory.length !== 1) throw new Error('Marker preparation differs from the exact native start admission.');
      const value = cloneAndDeepFreeze(marker);
      markers.set(value, Object.freeze({ authority: row.authority, snapshot: row.result.snapshot,
        inventory: inventory[0]!, sandboxSource: sandboxCapture.source, sandboxSelection: sandboxCapture.selection })); prepared.add(value); return value;
    },
    writePreparedMarker: async (file: string, marker: Marker) => {
      const row = markers.get(marker); if (row === undefined) throw new Error('Foreign or unprepared start marker.'); consume(marker);
      const job = current('prepare-start-marker');
      const proof = await withGitHubApiVerificationSession({ repositoryRoot: job.trustedDriverRoot, repository: job.repository,
        effect: 'verification-read', deadlineAtUnixMs: job.deadlineAtUnixMs,
        operation: capability => readAuthenticatedHostedJobRuntimeReceipt({ ...row.sandboxSelection, capability }) });
      if (proof.outputSource !== row.sandboxSource) throw new Error('Original sandbox preflight source changed before marker publication.');
      await fresh(row.authority, row.snapshot, 'prepare-start-marker', 'coordinate'); assertInventory(row.inventory);
      if (encodeVerificationActionData(marker.producer) !== encodeVerificationActionData(currentHostedActionProducer())) throw new Error('Marker producer changed.');
      current('prepare-start-marker'); writeVerificationActionProviderStartMarkerAtomic(file, marker);
    },
    startMarkerName: verificationActionProviderStartArtifactName, digest: ciActionDigest,
    createTicket: (input: Parameters<typeof CodexDevelopmentCreateHostedActionExecutionTicket>[0]) => {
      input = Object.freeze({ resolution: ownField(input, 'resolution'), marker: ownedPure(ownField(input, 'marker')),
        startObservation: ownField(input, 'startObservation'), startStatus: ownField(input, 'startStatus'),
        preparedCandidateArtifactName: ownField(input, 'preparedCandidateArtifactName'),
        preparedCandidateInventory: ownField(input, 'preparedCandidateInventory') });
      const authority = resolutions.get(input.resolution);
      if (authority === undefined) throw new Error('Ticket lacks original Action resolution.');
      const row = latest(authority), start = row.result.snapshot.startObservations[0];
      if (row.result.disposition !== 'started' || !row.result.newlyCreatedByThisInvocation || row.result.status === null
          || row.result.snapshot.startObservations.length !== 1 || start !== input.startObservation
          || row.result.status !== input.startStatus || !inventories.has(input.preparedCandidateInventory)
          || encodeVerificationActionData(input.marker.producer) !== encodeVerificationActionData(currentHostedActionProducer())) {
        throw new Error('Ticket requires this invocation\'s original newly owned claim and archive.');
      }
      if (ticketClaims.has(input.startStatus)) throw new Error('This invocation\'s original start claim already issued its execution ticket.');
      const ticket = deepFreeze(CodexDevelopmentCreateHostedActionExecutionTicket(input));
      ticketClaims.add(input.startStatus);
      tickets.set(ticket, { authority, snapshot: row.result.snapshot, inventory: input.preparedCandidateInventory, state: 'issued' }); return ticket;
    },
    prepareTicket: (ticket: Ticket) => {
      current('claim-start'); const row = tickets.get(ticket);
      if (row === undefined || row.state !== 'issued') throw new Error('Foreign or previously prepared execution ticket.');
      row.state = 'prepared'; prepared.add(ticket); return ticket;
    },
    writePreparedTicket: async (file: string, ticket: Ticket) => {
      const row = tickets.get(ticket);
      if (row === undefined || row.state !== 'prepared') throw new Error('Foreign, consumed or unprepared ticket.');
      consume(ticket); row.state = 'consumed'; tickets.delete(ticket);
      await fresh(row.authority, row.snapshot, 'claim-start', 'coordinate'); assertInventory(row.inventory);
      current('claim-start'); writeHostedActionJson(file, ticket);
    },
    prepareParentPlan: (plan: CiVerificationActionParentDispatchPlan) => { assertPlan(plan); prepared.add(plan); return plan; },
    writePreparedParentPlan: async (file: string, plan: CiVerificationActionParentDispatchPlan) => {
      consume(plan); assertPlan(plan); current('prepare-parent-plan'); writeHostedActionJson(file, plan);
    },
    writeResolution: async (file: string, resolution: Resolution) => {
      current('resolve-hosted-action'); const authority = resolutions.get(resolution);
      if (authority === undefined) throw new Error('Resolution lacks original captured provider authority.');
      const result = await transaction(authority, { kind: 'coordinate' });
      if (result.disposition !== 'observed') throw new Error('Resolution source cannot be authenticated.');
      current('resolve-hosted-action'); assertAuthority(authority); writeHostedActionJson(file, resolution);
    },
    writeArtifactIndex: async (file: string, index: CodexDevelopmentHostedActionProviderIndex) => {
      current();
      const privateSnapshot = indexRows.get(index), ownedIndex = ownedPure(index);
      const expected = { schema: CI_VERIFICATION_ACTION_ARTIFACT_INDEX_SCHEMA,
        terminalObservations: transactions.filter(row => row.result.disposition === 'observed').flatMap(row => hostedActionProviderIndexFromSnapshot(row.result.snapshot).terminalObservations),
        startObservations: transactions.filter(row => row.result.disposition === 'observed').flatMap(row => hostedActionProviderIndexFromSnapshot(row.result.snapshot).startObservations),
        terminalAnchorObservations: transactions.filter(row => row.result.disposition === 'observed').flatMap(row => hostedActionProviderIndexFromSnapshot(row.result.snapshot).terminalAnchorObservations),
        providerStatusReadbacks: transactions.filter(row => row.result.disposition === 'observed').flatMap(row => hostedActionProviderIndexFromSnapshot(row.result.snapshot).providerStatusReadbacks) };
      if (privateSnapshot === undefined && encodeVerificationActionData(ownedIndex) !== encodeVerificationActionData(expected)) throw new Error('Artifact index is not the complete original native observation set.');
      for (const row of transactions) assertAuthority(row.authority);
      writeHostedActionJson(file, ownedIndex);
    },
    readEvidenceIndex: (source: string) => captured(source, text => CodexDevelopmentReadHostedActionArtifactIndex({ source: text })),
    evidenceObservations: (index: ReturnType<typeof CodexDevelopmentReadHostedActionArtifactIndex>) => {
      const owned = ownedPure(index); return { observations: owned.observations, startObservations: owned.startObservations,
        terminalAnchorObservations: owned.terminalAnchorObservations, providerStatusReadbacks: owned.providerStatusReadbacks };
    },
    evidenceProducer: (input: Parameters<typeof CodexDevelopmentCreateVerificationEvidenceProducer>[0]) => CodexDevelopmentCreateVerificationEvidenceProducer(ownedPure(input)),
    composeEvidence: (input: Parameters<typeof CodexDevelopmentComposeHostedEvidence>[0]) => {
      input = Object.freeze({ envelope: ownField(input, 'envelope'),
        observations: ownedPure(ownField(input, 'observations')), startObservations: ownedPure(ownField(input, 'startObservations')),
        terminalAnchorObservations: ownedPure(ownField(input, 'terminalAnchorObservations')),
        providerStatusReadbacks: ownedPure(ownField(input, 'providerStatusReadbacks')),
        producer: ownedPure(ownField(input, 'producer')) });
      assertCaptured(input.envelope);
      const rows = input.envelope.actionPlanClosure.actions.map(member => transactions.find(row =>
        row.authority.envelope === input.envelope && row.authority.providerEnvelope.proposal.proposedActionKey === member.action.actionKey
        && row.result.disposition === 'observed'));
      if (rows.some(row => row === undefined)) throw new Error('Evidence lacks the full original authenticated parent member census.');
      const indices = rows.map(row => {
        if (row === undefined) throw new Error('Missing authenticated evidence member.');
        return hostedActionProviderIndexFromSnapshot(row.result.snapshot);
      });
      const expectedObservations = { observations: indices.flatMap(index => index.terminalObservations),
        startObservations: indices.flatMap(index => index.startObservations),
        terminalAnchorObservations: indices.flatMap(index => index.terminalAnchorObservations),
        providerStatusReadbacks: indices.flatMap(index => index.providerStatusReadbacks) };
      const actualObservations = { observations: input.observations, startObservations: input.startObservations,
        terminalAnchorObservations: input.terminalAnchorObservations, providerStatusReadbacks: input.providerStatusReadbacks };
      const job = current('coordinate-session'), actor = hostedActionParentActor(job.repository);
      const expectedProducer = CodexDevelopmentCreateVerificationEvidenceProducer({ sourceTransport: 'github-actions',
        workflowPath: '.github/workflows/compiler-pr-validation.yml',
        workflowRef: `.github/workflows/compiler-pr-validation.yml@${input.envelope.session.baseSha}`,
        workflowSha: input.envelope.session.baseSha, runId: job.runId, runAttempt: job.runAttempt, actorNodeId: actor.nodeId });
      if (actor.nodeId !== input.envelope.scopeAuthorization.issuer.principalId
          || encodeVerificationActionData(expectedProducer) !== encodeVerificationActionData(input.producer)
          || encodeVerificationActionData(expectedObservations) !== encodeVerificationActionData(actualObservations)) {
        throw new Error('Evidence composition differs from original provider observations or current human producer.');
      }
      const result = CodexDevelopmentComposeHostedEvidence(input);
      if (result.evidence !== null) evidenceRows.set(result.evidence, cloneAndDeepFreeze(input)); return result;
    },
    prepareEvidence: (evidence: Evidence) => { current('coordinate-session'); if (!evidenceRows.has(evidence)) throw new Error('Foreign evidence.'); prepared.add(evidence); return evidence; },
    writePreparedEvidence: async (file: string, evidence: Evidence) => {
      const input = evidenceRows.get(evidence); if (input === undefined) throw new Error('Foreign or unprepared evidence.'); consume(evidence);
      for (const member of input.envelope.actionPlanClosure.actions) {
        const row = transactions.find(row => row.authority.providerEnvelope.proposal.proposedActionKey === member.action.actionKey);
        if (row === undefined) throw new Error('Evidence member lost original authority.');
        await fresh(row.authority, row.result.snapshot, 'coordinate-session', 'coordinate-parent');
      }
      const actor = hostedActionParentActor(current('coordinate-session').repository);
      if (actor.nodeId !== input.producer.actorNodeId || actor.nodeId !== input.envelope.scopeAuthorization.issuer.principalId
          || encodeVerificationActionData(CodexDevelopmentComposeHostedEvidence(input).evidence) !== encodeVerificationActionData(evidence)) {
        throw new Error('Evidence producer or exact composition changed before publication.');
      }
      current('coordinate-session'); CodexDevelopmentWriteVerificationEvidenceV4Atomic(file, evidence);
    }
  };
}

/** Native captures and original child effects for the application terminal flow. */
export function createHostedActionTerminalStagePorts(origin: AuthenticatedGitHubJobOrigin) {
  const current = (expectedPhase?: string): void => {
    const job = assertAuthenticatedGitHubJobOriginCurrent(origin);
    if (job.policyJobId !== 'assemble-verification-action-terminal'
        || !['assemble-hosted-action-terminal', 'prepare-terminal-anchor', 'anchor-terminal'].includes(job.phase)
        || (expectedPhase !== undefined && job.phase !== expectedPhase)
        || job.trustedDriverRoot !== path.resolve(import.meta.dir, '../../../../..')) {
      throw new Error('Hosted terminal stage requires its original authenticated assembler invocation.');
    }
  };
  current();
  type Authority = Readonly<{ providerEnvelope: CiVerificationActionProviderEnvelope; envelope: ReturnType<typeof parseHostedEnvelope> }>;
  type Observation = Awaited<ReturnType<typeof ensureVerificationActionGitHubProviderTransaction>>;
  const captures = new WeakMap<object, Readonly<{ file: string; source: string; label: string }>>();
  const preparedTerminals = new WeakMap<object, Readonly<{ authority: Authority; snapshot: Observation['snapshot']; inputs: readonly object[] }>>();
  const preparedAnchors = new WeakMap<object, Readonly<{ authority: Authority; snapshot: Observation['snapshot'] }>>();
  let observed: Readonly<{ authority: Authority; result: Observation }> | undefined;
  const capture = <T extends object>(file: string, label: string, parse: (source: string) => T): T => {
    current();
    const source = hostedActionTransportText(file, label);
    const value = deepFreeze(parse(source));
    captures.set(value, Object.freeze({ file, source, label }));
    current();
    return value;
  };
  const assertCaptured = (value: object): void => {
    const retained = captures.get(value);
    if (retained === undefined || hostedActionTransportText(retained.file, retained.label) !== retained.source) {
      throw new Error('Hosted terminal publication requires unchanged original captured inputs.');
    }
  };
  const assertAuthority = (authority: Authority): void => {
    assertCaptured(authority.providerEnvelope);
    assertCaptured(authority.envelope);
  };
  const preparedObservation = () => {
    current();
    if (observed === undefined || observed.result.disposition !== 'observed') {
      throw new Error('Hosted terminal preparation requires its authenticated provider observation.');
    }
    assertAuthority(observed.authority);
    return observed;
  };
  const assertResolution = (resolution: ReturnType<typeof CodexDevelopmentResolveHostedAction>, authority: Authority): void => {
    const expected = CodexDevelopmentResolveHostedAction({
      request: CodexDevelopmentParseHostedActionRequest(encodeVerificationActionData(authority.providerEnvelope.proposal)),
      envelope: authority.envelope
    });
    if (encodeVerificationActionData(expected) !== encodeVerificationActionData(resolution)) {
      throw new Error('Hosted terminal preparation differs from its original authenticated Action.');
    }
  };
  const freshPublication = async (prepared: Readonly<{ authority: Authority; snapshot: Observation['snapshot'] }>, phase: string): Promise<void> => {
    current(phase);
    assertAuthority(prepared.authority);
    const fresh = await ensureVerificationActionGitHubProviderTransaction({
      origin,
      authority: { envelope: prepared.authority.providerEnvelope, actionPlanClosure: prepared.authority.envelope.actionPlanClosure },
      intent: { kind: 'coordinate' }
    });
    current(phase);
    assertAuthority(prepared.authority);
    const subjectState = (snapshot: Observation['snapshot']) => {
      const resolution = CodexDevelopmentResolveHostedAction({
        request: CodexDevelopmentParseHostedActionRequest(encodeVerificationActionData(prepared.authority.providerEnvelope.proposal)),
        envelope: prepared.authority.envelope
      });
      const index = hostedActionProviderIndexFromSnapshot(snapshot);
      const ordered = (values: readonly unknown[]) => values.map(value => encodeVerificationActionData(value)).sort();
      return {
        decision: CodexDevelopmentReduceHostedActionProviderIndex({ resolution, ...hostedActionRepositoryIdentity(), index }),
        start: ordered(index.startObservations), terminal: ordered(index.terminalObservations),
        anchor: ordered(index.terminalAnchorObservations),
        status: index.providerStatusReadbacks.map(readback => ({ ...readback, statuses: ordered(readback.statuses) }))
      };
    };
    if (fresh.disposition !== 'observed'
        || encodeVerificationActionData(subjectState(fresh.snapshot)) !== encodeVerificationActionData(subjectState(prepared.snapshot))) {
      throw new Error('Hosted terminal publication provider state changed after preparation.');
    }
  };
  return {
    readProviderEnvelope: (file: string) => {
      current();
      const value = capture(file, 'internal Action provider envelope', source => {
        const parsed = parseCiVerificationActionProviderEnvelope(JSON.parse(source) as unknown);
        if (source !== `${encodeVerificationActionData(parsed)}\n`) throw new Error('Noncanonical Action provider envelope.');
        return parsed;
      });
      current(); return value;
    },
    readHostedEnvelope: (file: string) => {
      current(); const value = capture(file, 'parent Session envelope', source => parseHostedEnvelope(JSON.parse(source) as unknown));
      current(); return value;
    },
    readResolution: (file: string) => {
      current(); const value = capture(file, 'internal Action resolution', CodexDevelopmentParseHostedActionResolution);
      current(); return value;
    },
    readExecutionTicket: (file: string) => {
      current(); const value = capture(file, 'hosted Action execution ticket', CodexDevelopmentParseHostedActionExecutionTicket);
      current(); return value;
    },
    readRawResult: (file: string) => {
      current(); const value = capture(file, 'hosted Action raw result', CodexDevelopmentParseHostedActionRawResult);
      current(); return value;
    },
    parseActionRequest: CodexDevelopmentParseHostedActionRequest,
    resolveAction: CodexDevelopmentResolveHostedAction,
    canonicalSource: encodeVerificationActionData,
    coordinateChild: async (authority: Authority) => {
      current(); assertAuthority(authority); const result = await ensureVerificationActionGitHubProviderTransaction({
        origin,
        authority: { envelope: authority.providerEnvelope, actionPlanClosure: authority.envelope.actionPlanClosure },
        intent: { kind: 'coordinate' }
      }); current(); assertAuthority(authority);
      observed = Object.freeze({ authority: Object.freeze({ ...authority }), result: deepFreeze(result) });
      return result;
    },
    producer: () => { current(); return currentHostedActionProducer(); },
    repositoryIdentity: () => { current(); return hostedActionRepositoryIdentity(); },
    providerIndex: hostedActionProviderIndexFromSnapshot,
    reduceProvider: CodexDevelopmentReduceHostedActionProviderIndex,
    inventoryClosureFromTicket: hostedSutInventoryClosureFromTicket,
    rebuildTicket: CodexDevelopmentCreateHostedActionExecutionTicket,
    assembleTerminal: (input: Parameters<typeof CodexDevelopmentAssembleHostedActionTerminal>[0]) => {
      current('assemble-hosted-action-terminal');
      const retained = preparedObservation();
      assertResolution(input.resolution, retained.authority);
      assertCaptured(input.ticket); assertCaptured(input.rawResult);
      const producer = currentHostedActionProducer();
      if (encodeVerificationActionData(producer) !== encodeVerificationActionData(input.producer)
          || encodeVerificationActionData(producer) !== encodeVerificationActionData(input.ticket.producer)) {
        throw new Error('Hosted terminal assembler is not the original trusted claim run.');
      }
      const index = hostedActionProviderIndexFromSnapshot(retained.result.snapshot);
      const start = index.startObservations[0];
      const status = index.providerStatusReadbacks[0]?.statuses.find(entry => entry.id === input.ticket.startStatusId);
      if (index.startObservations.length !== 1 || start?.payload === null || start?.payload === undefined
          || status === undefined || index.terminalObservations.length !== 0 || index.terminalAnchorObservations.length !== 0) {
        throw new Error('Hosted terminal assembler requires the sole exact unresolved start ticket.');
      }
      const rebuilt = CodexDevelopmentCreateHostedActionExecutionTicket({ resolution: input.resolution,
        marker: start.payload, startObservation: start, startStatus: status,
        preparedCandidateArtifactName: input.ticket.preparedCandidateArtifactName,
        preparedCandidateInventory: hostedSutInventoryClosureFromTicket(input.ticket) });
      if (rebuilt.ticketDigest !== input.ticket.ticketDigest) throw new Error('Hosted terminal ticket differs from original provider readback.');
      const artifact = deepFreeze(CodexDevelopmentAssembleHostedActionTerminal(input));
      preparedTerminals.set(artifact, Object.freeze({ authority: retained.authority, snapshot: retained.result.snapshot,
        inputs: Object.freeze([input.ticket, input.rawResult]) }));
      return artifact;
    },
    createAnchor: (input: Parameters<typeof createVerificationActionProviderTerminalAnchor>[0]) => {
      current('prepare-terminal-anchor');
      const retained = preparedObservation();
      const resolution = CodexDevelopmentResolveHostedAction({
        request: CodexDevelopmentParseHostedActionRequest(encodeVerificationActionData(retained.authority.providerEnvelope.proposal)),
        envelope: retained.authority.envelope
      });
      const index = hostedActionProviderIndexFromSnapshot(retained.result.snapshot);
      const decision = CodexDevelopmentReduceHostedActionProviderIndex({ resolution, ...hostedActionRepositoryIdentity(), index });
      const start = index.startObservations[0], terminal = index.terminalObservations[0];
      const status = index.providerStatusReadbacks[0]?.statuses.find(entry => entry.state === 'pending');
      if (decision.disposition !== 'repair-terminal-anchor' || !decision.terminalAnchorRepairAllowed
          || start?.payload === null || start?.payload === undefined || start.archiveDigest === null
          || terminal?.artifact === null || terminal?.artifact === undefined
          || terminal.providerObservation.archiveDigest === null || terminal.providerObservation.payload === null || status === undefined) {
        throw new Error('Hosted terminal anchor lacks original exact repair admission.');
      }
      const expected = createVerificationActionProviderTerminalAnchor({ actionKey: resolution.actionPlan.action.actionKey,
        candidateSha: resolution.artifactInput.headSha, startStatusId: status.id, startStatusNodeId: status.nodeId,
        startArtifactOriginId: start.originId, startArtifactName: start.artifactName,
        startArtifactArchiveDigest: start.archiveDigest, startMarkerDigest: start.payload.markerDigest,
        terminalArtifactOriginId: terminal.providerObservation.originId, terminalArtifactName: terminal.providerObservation.artifactName,
        terminalArtifactArchiveDigest: terminal.providerObservation.archiveDigest,
        terminalArtifactPayloadDigest: terminal.providerObservation.payload.payloadDigest,
        terminalAssemblerOrigin: terminal.providerObservation.payload.producer, anchorPublisherOrigin: currentHostedActionProducer() });
      const anchor = createVerificationActionProviderTerminalAnchor(input);
      if (encodeVerificationActionData(anchor) !== encodeVerificationActionData(expected)) throw new Error('Hosted terminal anchor differs from original exact facts.');
      deepFreeze(anchor);
      preparedAnchors.set(anchor, Object.freeze({ authority: retained.authority, snapshot: retained.result.snapshot }));
      return anchor;
    },
    writeTerminal: async (file: string, artifact: Parameters<typeof CodexDevelopmentWriteVerificationActionTerminalArtifactV2Atomic>[1]) => {
      const prepared = preparedTerminals.get(artifact);
      if (prepared === undefined) throw new Error('Hosted terminal writer requires its same-invocation prepared artifact.');
      await freshPublication(prepared, 'assemble-hosted-action-terminal');
      if (preparedTerminals.get(artifact) !== prepared) throw new Error('Hosted terminal preparation was already consumed.');
      for (const captured of prepared.inputs) assertCaptured(captured);
      if (encodeVerificationActionData(artifact.producer) !== encodeVerificationActionData(currentHostedActionProducer())) {
        throw new Error('Hosted terminal producer changed before publication.');
      }
      preparedTerminals.delete(artifact);
      CodexDevelopmentWriteVerificationActionTerminalArtifactV2Atomic(file, artifact); current('assemble-hosted-action-terminal');
    },
    writeAnchor: async (file: string, anchor: Parameters<typeof writeVerificationActionProviderTerminalAnchorAtomic>[1]) => {
      const prepared = preparedAnchors.get(anchor);
      if (prepared === undefined) throw new Error('Hosted anchor writer requires its same-invocation prepared anchor.');
      await freshPublication(prepared, 'prepare-terminal-anchor');
      if (preparedAnchors.get(anchor) !== prepared) throw new Error('Hosted anchor preparation was already consumed.');
      if (encodeVerificationActionData(anchor.anchorPublisherOrigin) !== encodeVerificationActionData(currentHostedActionProducer())) {
        throw new Error('Hosted anchor publisher changed before publication.');
      }
      preparedAnchors.delete(anchor);
      writeVerificationActionProviderTerminalAnchorAtomic(file, anchor); current('prepare-terminal-anchor');
    },
    anchorTerminal: async (authority: Authority, anchor: Parameters<typeof writeVerificationActionProviderTerminalAnchorAtomic>[1]) => {
      current('anchor-terminal'); const result = await ensureVerificationActionGitHubProviderTransaction({
        origin,
        authority: { envelope: authority.providerEnvelope, actionPlanClosure: authority.envelope.actionPlanClosure },
        intent: { kind: 'anchor-terminal', anchor }
      }); current('anchor-terminal'); return result;
    },
    terminalArtifactName: verificationActionProviderTerminalArtifactName,
    terminalAnchorName: verificationActionProviderTerminalAnchorName
  };
}

export async function CodexDevelopmentCiVerificationHostedActionCli(argv: string[]): Promise<string> {
  const command = argv[0];
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
  throw new Error(`Unknown hosted Action command: ${command ?? '<missing>'}.`);
}
