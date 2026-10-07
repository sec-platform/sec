import { spawnSync, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHostedSutCandidatePreparation, hostedSutCandidateArgv, hostedSutCandidateGuardArgv, hostedSutCandidatePreparationFromPlan } from '../../src/adapters/verification/platform/ci/contract/hosted-sut-command-plan.ts';
import { assertPreparedHostedActionArchiveCurrent, CodexDevelopmentPrepareHostedActionInputs, consumePreparedHostedActionArchive, createHostedActionArchiveRecipeIssuer, HOSTED_ACTION_ARCHIVE_DECODED_READER_SCRIPT } from '../../src/adapters/verification/platform/ci/verification-materialization.ts';
import type { CI_VERIFICATION_CONTRACT_REVISION } from "../../src/assurance/verification/contract/revision.ts";
import { ResourceCompositeSettlementError } from '../../src/execution/resource-settlement.ts';
import type { CiVerificationActionPlanClosure, VerificationActionKeyDigest } from '../../src/execution/verification/action.ts';
import type { HostedActionExecutionTicket, HostedActionRawResult, HostedActionResolution, HostedSutExecutionAuthorization, HostedSutInventory, HostedSutProcessObservation, HostedSutSandboxReceipt, VerificationSessionHostedRequest } from "../../src/execution/verification/hosted.ts";
import type { VerificationEvidence } from '../../src/execution/verification/session.ts';

import { expect, spyOn, test } from 'bun:test';
import * as physicalNoFollow from '../../src/adapters/runtime-state/physical/runtime/physical-no-follow.ts';
import { CI_VERIFICATION_PER_JOB_HOSTED_EXECUTION_ENVIRONMENT, parseCiVerificationHostedExecutionEnvironment, resolveCiVerificationHostedExecutionEnvironment } from '../../src/adapters/verification/platform/action/contract/ci.ts';

test('hosted environment data accepts both canonical profiles and rejects forged profile fields', () => {
  for (const environment of [CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT, CI_VERIFICATION_PER_JOB_HOSTED_EXECUTION_ENVIRONMENT]) {
    expect(parseCiVerificationHostedExecutionEnvironment(JSON.parse(JSON.stringify(environment)))).toBe(environment);
    expect(resolveCiVerificationHostedExecutionEnvironment(environment.executionEnvironmentRevision)).toBe(environment);
    expect(() => parseCiVerificationHostedExecutionEnvironment({ ...environment, runnerImage: 'caller-image' })).toThrow();
    expect(() => parseCiVerificationHostedExecutionEnvironment({ ...environment, authority: true })).toThrow();
  }
  expect(() => resolveCiVerificationHostedExecutionEnvironment('caller-provider')).toThrow();
  expect(CI_VERIFICATION_PER_JOB_HOSTED_EXECUTION_ENVIRONMENT.executionEnvironmentRevision).not.toBe(CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT.executionEnvironmentRevision);
});

import { BASE, BASE_TREE, baseOptions, clock, executeSentinelGate, HEAD, MANIFEST_PATH, revisions, TREE } from '../helpers/ci-verification-fixtures.ts';

import { encodeVerificationActionData } from '../../src/adapters/verification/platform/action/contract/action.ts';
import { buildCiVerificationActionPlan, buildCiVerificationActionPlanClosure, CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT, ciVerificationGateStep, type CiVerificationActionCandidate, type CiVerificationProducerGate } from '../../src/adapters/verification/platform/action/contract/ci.ts';
import { CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS } from '../../src/adapters/verification/platform/action/contract/environment.ts';
import { createVerificationActionProviderStartMarker, createVerificationActionProviderTerminalAnchor, finalizeVerificationActionProviderStatusReadback, VERIFICATION_ACTION_PROVIDER_POLICY, verificationActionProviderRunTargetUrl, verificationActionProviderStartArtifactName, verificationActionProviderStartDescription, verificationActionProviderStatusContext, verificationActionProviderTerminalAnchorName, verificationActionProviderTerminalArtifactName, verificationActionProviderTerminalDescription, type VerificationActionProviderOrigin, type VerificationActionProviderStartObservation, type VerificationActionProviderStatusObservation, type VerificationActionProviderStatusReadback, type VerificationActionProviderTerminalAnchorObservation } from '../../src/adapters/verification/platform/action/contract/provider.ts';
import { CodexDevelopmentAssertVerificationActionTerminalArtifact, CodexDevelopmentAssertVerificationEvidenceV4, CodexDevelopmentCreateVerificationEvidenceProducer, CodexDevelopmentVerificationActionCandidateBytesDigest, CodexDevelopmentVerificationDigest } from '../../src/adapters/verification/platform/ci/contract/evidence.ts';
import { CodexDevelopmentCreateHostedSutExecutionAuthorization, CodexDevelopmentFinalizeHostedActionRawResult, CodexDevelopmentHostedSutCandidateEnvironment } from '../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts';
import { buildCiQuickGatePlan } from '../../src/adapters/verification/platform/ci/contract/plan.ts';
import { CI_VERIFICATION_HOSTED_SANDBOX_POLICY, CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST, CI_VERIFICATION_SESSION_DISPATCH_TYPE } from '../../src/adapters/verification/platform/ci/contract/revision.ts';

import {
  GitCandidateCheckoutCleanupUnknownError,
  gitCandidateCheckoutRecipeBinding,
  withGitCandidateCheckout
} from '../../src/adapters/providers/git-bundle/runtime.ts';
import { CodexDevelopmentWorkPackageManifestDigest } from '../../src/adapters/self-hosting/control/task/contract/work-package.ts';
import { ciVerificationNormalizedOperationArgv, resolveCiVerificationDevRunnerTarget } from '../../src/adapters/verification/platform/action/contract/ci.ts';
import { hostedSutCapabilityCommandPlan, hostedSutTeardownCommandPlan } from '../../src/adapters/verification/platform/ci/contract/hosted-sut-command-plan.ts';
import { CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT, hostedSutCleanupComplete, hostedSutLifecycleComplete } from '../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts';
import {
  VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA
} from "../../src/adapters/verification/platform/ci/contract/session-request.ts";
import { CodexDevelopmentFailureTail } from '../../src/adapters/verification/platform/ci/runtime/ci-orchestration-core.ts';
import { ciActionDigest, CodexDevelopmentParseHostedActionExecutionTicket, CodexDevelopmentParseHostedActionResolution, type CodexDevelopmentHostedSutSandboxProcess } from '../../src/adapters/verification/platform/ci/verification-hosted-action-contract.ts';
import { assertRetainedHostedSutArchive, hostedActionFileDigest, retainHostedSutArchive } from '../../src/adapters/verification/platform/ci/verification-materialization.ts';
import { finalizeHostedSutSandboxReceipt, hostedSutRootIsolationReceipt, observeHostedSutSandboxChild, syntheticHostedSutSandboxProcessObservation } from '../../src/adapters/verification/platform/ci/verification-sut.ts';
import { assertHostedSutSandboxCommandPlan, buildHostedSutSandboxCommandPlan, buildTrustedBootstrapSutSandboxCommandPlan, CI_VERIFICATION_ACTION_EXECUTION_TICKET_SCHEMA, CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA, CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA, CodexDevelopmentAssembleHostedActionTerminal, CodexDevelopmentAssertHostedActionDependencyInputsV1, CodexDevelopmentAssertHostedActionParentEvent, CodexDevelopmentAssertHostedDependencyArchiveProjection, CodexDevelopmentAssertTrustedBootstrapSutMaterializationClean, CodexDevelopmentCaptureHostedDependencyPhysicalSnapshot, CodexDevelopmentCiVerificationMainForTests, CodexDevelopmentComposeHostedEvidence, CodexDevelopmentCoordinateHostedActions, CodexDevelopmentHostedDependencyMaterializerEnvironment, CodexDevelopmentInspectHostedActionArchive, CodexDevelopmentInspectHostedActionArchiveInventory, CodexDevelopmentMaterializeTrustedBootstrapArchive, CodexDevelopmentRunBoundedDependencyMaterialization, CodexDevelopmentValidateHostedActionArchiveInventory, HOSTED_SUT_CAPABILITY_ASSERTION, hostedCandidateProcessEnvironment, TRUSTED_BOOTSTRAP_SUT_HARNESS, type CodexDevelopmentHostedActionArtifactObservation } from '../../src/adapters/verification/platform/ci/verification.ts';
import { CodexDevelopmentCreateTestImpactTransitionObservation } from '../../src/adapters/verification/platform/test-impact/runtime/transition.ts';
import { executeHostedActionSut, probeHostedSutCapability, type HostedSutPorts } from '../../src/application/hosted-sut.ts';
import type { VerificationGateResult, VerificationResultStatus } from '../../src/assurance/verification/result/contract/result.ts';
import { prepareHostedActionSutInputs, runHostedActionSut, type HostedSutInvocation } from '../../src/bootstrap/development/hosted-sut.ts';

const RAW = `sha256:${'a'.repeat(64)}` as const;

type SutFixtureInput = Parameters<typeof prepareHostedActionSutInputs>[0] & Readonly<{
  env?: NodeJS.ProcessEnv; now?: () => Date; platform?: NodeJS.Platform;
  bunExecutable?: string; unitNonce?: string; runSandboxProcess?: CodexDevelopmentHostedSutSandboxProcess;
}>;

type NativeSutFixturePorts = HostedSutPorts<typeof CI_VERIFICATION_HOSTED_SANDBOX_POLICY,
  import('../../src/adapters/verification/platform/action/contract/ci.ts').CiVerificationExecutionEnvironment,
  VerificationActionProviderOrigin, typeof CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA,
  typeof CI_VERIFICATION_ACTION_EXECUTION_TICKET_SCHEMA,
  typeof import('../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts').CI_VERIFICATION_ACTION_SUT_AUTHORIZATION_SCHEMA,
  typeof import('../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts').CI_VERIFICATION_ACTION_PHYSICAL_COMMAND_SCHEMA,
  typeof import('../../src/adapters/verification/platform/action/contract/environment.ts').CI_VERIFICATION_HOSTED_PROVIDER_REVISION,
  typeof CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA,
  typeof import('../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts').CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA,
  typeof import('../../src/adapters/verification/platform/ci/verification-hosted-action-contract.ts').CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA,
  import('../../src/adapters/verification/platform/ci/runtime/ci-orchestration-core.ts').CodexDevelopmentGateProcessResult,
  ReturnType<typeof retainHostedSutArchive>>;

/** Original production contract functions plus explicitly synthetic process
 * observations. This fixture never opens or issues a native process session. */
function sutFixturePorts(input: Pick<SutFixtureInput, 'now' | 'platform' | 'bunExecutable' | 'unitNonce' | 'runSandboxProcess'>): NativeSutFixturePorts {
  return {
    platform: input.platform ?? process.platform, bunExecutable: input.bunExecutable ?? '/usr/bin/bun',
    unitNonce: input.unitNonce ?? 'sut-fixture', outputByteLimit: CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT,
    capabilityMarker: '__SEC_HOSTED_SANDBOX_CAPABILITY_V1__', unsupportedDiagnostic: 'Synthetic fixture has no native kernel observation.',
    now: input.now ?? (() => new Date()), digest: ciActionDigest, encodeData: encodeVerificationActionData,
    parseResolution: CodexDevelopmentParseHostedActionResolution, parseTicket: CodexDevelopmentParseHostedActionExecutionTicket,
    createAuthorization: CodexDevelopmentCreateHostedSutExecutionAuthorization,
    candidateEnvironment: CodexDevelopmentHostedSutCandidateEnvironment,
    createCapabilityPlan: hostedSutCapabilityCommandPlan, createTeardownPlan: hostedSutTeardownCommandPlan,
    createExecutionPlan: buildHostedSutSandboxCommandPlan, normalizedArgv: ciVerificationNormalizedOperationArgv,
    resolveAuthorizedOperation: resolveCiVerificationDevRunnerTarget,
    run: input.runSandboxProcess ?? (() => { throw new Error('SUT fixture requires explicit synthetic observations.'); }),
    unobservedProcess: syntheticHostedSutSandboxProcessObservation,
    lifecycleComplete: hostedSutLifecycleComplete, cleanupComplete: hostedSutCleanupComplete,
    failureTail: CodexDevelopmentFailureTail, resolveArchive: (source: string) => realpathSync.native(path.resolve(source)),
    retainArchive: retainHostedSutArchive, assertArchive: assertRetainedHostedSutArchive,
    pathDigest: hostedActionFileDigest, closeArchive: (archive: ReturnType<typeof retainHostedSutArchive>) => closeSync(archive.fileDescriptor),
    rootIsolation: hostedSutRootIsolationReceipt, finalizeReceipt: finalizeHostedSutSandboxReceipt,
    finalizeRawResult: CodexDevelopmentFinalizeHostedActionRawResult
  } satisfies NativeSutFixturePorts;
}

function executeSutFixture(input: SutFixtureInput) {
  return executeHostedActionSut(prepareHostedActionSutInputs({ resolution: input.resolution,
    ticket: input.ticket, candidateArchive: input.candidateArchive, archiveInventory: input.archiveInventory }), sutFixturePorts(input));
}

function probeSutFixture(input: Pick<SutFixtureInput, 'now' | 'platform' | 'bunExecutable' | 'unitNonce' | 'runSandboxProcess'> &
  Readonly<{ actionKey: VerificationActionKeyDigest; executionAuthorization?: ReturnType<typeof CodexDevelopmentCreateHostedSutExecutionAuthorization> }>) {
  return probeHostedSutCapability({ actionKey: input.actionKey, executionAuthorization: input.executionAuthorization }, sutFixturePorts(input));
}

function gitFixture(root: string, args: readonly string[]): string {
  const result = spawnSync('git', ['-C', root, ...args], {
    encoding: 'utf8', windowsHide: true, timeout: 30_000
  });
  if (result.status !== 0) {
    throw new Error(`Git fixture command failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

const digest = (value: string): VerificationActionKeyDigest =>
  `sha256:${value.repeat(64).slice(0, 64)}` as VerificationActionKeyDigest;

const DEPENDENCY_CLOSURE = digest('6');
const GIT_CLOSURE = digest('7');

function bytesDigest(value: string | Buffer): VerificationActionKeyDigest {
  return `sha256:${createHash('sha256').update(value).digest('hex')}` as VerificationActionKeyDigest;
}

function sandboxObservation(
  code: number,
  failureTail: string,
  options: Readonly<{ truncated?: boolean; started?: boolean; lifecycle?: Partial<HostedSutProcessObservation<import("../../src/adapters/verification/platform/ci/runtime/ci-orchestration-core.ts").CodexDevelopmentGateProcessResult>['lifecycle']> }> = {}
): HostedSutProcessObservation<import("../../src/adapters/verification/platform/ci/runtime/ci-orchestration-core.ts").CodexDevelopmentGateProcessResult> {
  const stdoutDigest = bytesDigest(failureTail);
  const stderrDigest = bytesDigest('');
  return Object.freeze({
    code,
    rawOutputDigest: CodexDevelopmentVerificationDigest({
      stdoutDigest, stderrDigest, failureTail, truncated: options.truncated ?? false
    }),
    failureTail,
    stdoutDigest,
    stderrDigest,
    stdoutBytesObserved: Buffer.byteLength(failureTail),
    stderrBytesObserved: 0,
    outputTruncated: options.truncated ?? false,
    lifecycle: Object.freeze({
      supervisorSpawned: options.started ?? true, supervisorClosed: true,
      supervisorCloseCode: code, supervisorSignal: null,
      namespaceEstablished: options.started ?? true, candidateStarted: options.started ?? true,
      candidateUnitSettled: true, observationGap: null,
      ...options.lifecycle
    })
  });
}

function sandboxReceipt(
  actionKey: VerificationActionKeyDigest,
  status: 'passed' | 'failed' | 'unsupported' | 'invalidated' = 'passed',
  authorization?: HostedSutExecutionAuthorization<typeof import("../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_SUT_AUTHORIZATION_SCHEMA, import("../../src/adapters/verification/platform/action/contract/ci.ts").CiVerificationExecutionEnvironment, typeof import("../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_PHYSICAL_COMMAND_SCHEMA, typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY, typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST, import("../../src/adapters/verification/platform/action/contract/provider.ts").VerificationActionProviderOrigin, typeof import("../../src/adapters/verification/platform/action/contract/environment.ts").CI_VERIFICATION_HOSTED_PROVIDER_REVISION>
): HostedSutSandboxReceipt<typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY, typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST, typeof import("../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA> {
  const executed = status === 'passed' || status === 'failed';
  if (executed && authorization === undefined) {
    throw new Error('Executed sandbox fixture requires its physical command authorization.');
  }
  const settled = status !== 'invalidated';
  const withoutDigest = Object.freeze({
    schema: CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA,
    policyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST,
    actionKey,
    capability: Object.freeze({
      commandPlanDigest: executed ? authorization!.physicalCommand.projectionDigest : digest('8'),
      lifecycle: Object.freeze({
        supervisorSpawned: status !== 'invalidated', supervisorClosed: settled,
        supervisorCloseCode: executed ? 0 : 1, supervisorSignal: null,
        namespaceEstablished: executed, candidateStarted: executed, candidateUnitSettled: settled,
        observationGap: null
      }),
      exitCode: executed ? 0 : status === 'unsupported' ? 1 : null,
      markerObserved: executed,
      outputDigest: digest('8'),
      cleanup: Object.freeze({
        supervisorSpawned: status !== 'invalidated', supervisorClosed: settled,
        exitCode: settled ? 0 : null, outputDigest: digest('0')
      }),
      diagnostic: status === 'passed' || status === 'failed' ? null
        : status === 'unsupported' ? 'unshare: operation not permitted' : 'capability observation lost'
    }),
    commandPlanDigest: executed ? authorization!.physicalCommand.projectionDigest : null,
    resources: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits,
    authenticatedArchive: Object.freeze({
      archiveDigest: digest('9'), inventoryDigest: digest('0'),
      dependencyClosureDigest: DEPENDENCY_CLOSURE, gitBundleDigest: GIT_CLOSURE,
      entryCount: 12, totalFileBytes: 1024
    }),
    rootIsolation: Object.freeze({
      substrate: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.substrate,
      namespaces: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.namespaces,
      uid: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedUid,
      gid: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedGid,
      network: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.network,
      inputMount: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.inputMount,
      workspace: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.workspace,
      outputTransport: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.outputTransport,
      candidateEnvironmentNames: executed ? Object.freeze(
        authorization!.physicalCommand.fixedSandboxEnvironment.map((entry) => entry.name)
      ) : Object.freeze([])
    }),
    execution: Object.freeze({
      lifecycle: Object.freeze({
        supervisorSpawned: executed, supervisorClosed: executed && settled,
        supervisorCloseCode: executed ? (status === 'passed' ? 0 : 1) : null, supervisorSignal: null,
        namespaceEstablished: executed, candidateStarted: executed, candidateUnitSettled: executed ? settled : null,
        observationGap: null
      }),
      unitName: executed ? authorization!.physicalCommand.unitName : null,
      exitCode: executed ? (status === 'passed' ? 0 : 1) : null,
      authenticatedInputDigest: executed ? digest('9') : null, stdoutStderrDigest: RAW,
      postExecutionInputDigest: executed ? digest('9') : null,
      postExecutionReadbackErrorDigest: null,
      stdoutDigest: RAW, stderrDigest: digest('0'), stdoutBytesObserved: executed ? 1 : 0,
      stderrBytesObserved: 0, outputTruncated: false,
      boundedFailureTailDigest: digest('0')
    }),
    cleanup: Object.freeze({
      supervisorSpawned: executed, supervisorClosed: executed && settled,
      exitCode: executed && settled ? 0 : null, outputDigest: digest('0')
    }),
    diagnostic: status === 'passed' ? null : status
  });
  return Object.freeze({
    ...withoutDigest,
    receiptDigest: CodexDevelopmentVerificationDigest(withoutDigest) as VerificationActionKeyDigest
  });
}

const hostedProducer: VerificationActionProviderOrigin = Object.freeze({
  repositoryId: 311,
  repository: 'openai/sec',
  workflowPath: '.github/workflows/compiler-pr-validation.yml',
  workflowRef: `.github/workflows/compiler-pr-validation.yml@${BASE}`,
  workflowSha: BASE,
  runId: '9001',
  runAttempt: 1,
  appId: 15368,
  appNodeId: 'MDM6QXBwMTUzNjg=',
  sourceEvent: 'repository_dispatch'
});

function hostedGates(): readonly CiVerificationProducerGate[] {
  return buildCiQuickGatePlan({ includeImports: true, includeDocs: true })
    .map(ciVerificationGateStep);
}

function hostedCandidate(): CiVerificationActionCandidate {
  return {
    baseSha: BASE,
    baseTreeSha: BASE_TREE,
    headSha: HEAD,
    headTreeSha: TREE,
    manifestPath: MANIFEST_PATH,
    manifestDigest: digest('b'),
    scopeAuthorizationRevision: digest('c'),
    profile: 'quick',
    toolchainRevision: 'bun@1.3.14',
    providerRevision: CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT.executionEnvironmentRevision,
    contractRevision: 'ci-verification-v19',
    requiredBlobs: [
      ...CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS.map((dependencyPath, index) => ({
        path: dependencyPath,
        digest: digest(String(index + 1))
      })),
      { path: 'input.txt', digest: digest('d') }
    ]
  };
}

function hostedResolution(
  gates: readonly CiVerificationProducerGate[] = [hostedGates()[0]!]
): HostedActionResolution<import("../../src/adapters/verification/platform/action/contract/ci.ts").CiVerificationExecutionEnvironment, typeof import("../../src/adapters/verification/platform/ci/verification-hosted-action-contract.ts").CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA> {
  const actionPlanClosure = buildCiVerificationActionPlanClosure({
    candidate: hostedCandidate(),
    gates
  });
  return hostedMemberResolution(actionPlanClosure, 0);
}

function hostedMemberResolution(
  actionPlanClosure: CiVerificationActionPlanClosure,
  memberIndex: number
): HostedActionResolution<import("../../src/adapters/verification/platform/action/contract/ci.ts").CiVerificationExecutionEnvironment, typeof import("../../src/adapters/verification/platform/ci/verification-hosted-action-contract.ts").CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA> {
  const actionPlan = actionPlanClosure.actions[memberIndex]!;
  const artifactInput = Object.freeze({
    baseSha: BASE,
    baseTreeSha: BASE_TREE,
    headSha: HEAD,
    headTreeSha: TREE,
    manifestPath: MANIFEST_PATH,
    manifestDigest: hostedCandidate().manifestDigest,
    inputClosureDigest: CodexDevelopmentVerificationDigest(actionPlan.action.inputClosure),
    candidateBytesDigest: CodexDevelopmentVerificationActionCandidateBytesDigest({
      baseSha: BASE,
      baseTreeSha: BASE_TREE,
      headSha: HEAD,
      headTreeSha: TREE,
      manifestPath: MANIFEST_PATH,
      manifestDigest: hostedCandidate().manifestDigest,
      action: actionPlan.action
    })
  });
  const withoutDigest = Object.freeze({
    schema: CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA,
    requestDigest: digest('e'),
    actionKeyHex: actionPlan.action.actionKey.slice('sha256:'.length),
    actionPlan,
    actionPlanClosure,
    artifactInput,
    executionEnvironment: CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT
  });
  return Object.freeze({
    ...withoutDigest,
    resolutionDigest: CodexDevelopmentVerificationDigest(withoutDigest) as VerificationActionKeyDigest
  });
}

function hostedTicket(
  resolution: HostedActionResolution<import("../../src/adapters/verification/platform/action/contract/ci.ts").CiVerificationExecutionEnvironment, typeof import("../../src/adapters/verification/platform/ci/verification-hosted-action-contract.ts").CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA>,
  inventory: HostedSutInventory = Object.freeze({
    archiveDigest: digest('9'),
    inventoryDigest: digest('0'),
    entryCount: 12,
    totalFileBytes: 1024,
    dependencyClosureDigest: DEPENDENCY_CLOSURE,
    gitBundleDigest: GIT_CLOSURE
  })
): HostedActionExecutionTicket<import("../../src/adapters/verification/platform/ci/contract/evidence.ts").CodexDevelopmentVerificationActionArtifactProducer, typeof import("../../src/adapters/verification/platform/ci/verification-hosted-action-contract.ts").CI_VERIFICATION_ACTION_EXECUTION_TICKET_SCHEMA> {
  const actionKey = resolution.actionPlan.action.actionKey;
  const withoutDigest = Object.freeze({
    schema: CI_VERIFICATION_ACTION_EXECUTION_TICKET_SCHEMA,
    resolutionDigest: resolution.resolutionDigest,
    actionKey,
    candidateSha: HEAD,
    candidateBytesDigest: resolution.artifactInput.candidateBytesDigest as VerificationActionKeyDigest,
    startStatusId: 101,
    startStatusNodeId: 'STATUS_start',
    startMarkerDigest: digest('f'),
    startArtifactOriginId: '7001',
    startArtifactName: verificationActionProviderStartArtifactName(actionKey),
    startArtifactArchiveDigest: digest('1'),
    preparedCandidateArtifactName:
      `sec-verification-action-prepared-v2-${actionKey.slice(7)}-run-${hostedProducer.runId}` +
      `-attempt-${hostedProducer.runAttempt}`,
    preparedCandidateArchiveDigest: inventory.archiveDigest,
    preparedCandidateInventoryDigest: inventory.inventoryDigest,
    preparedCandidateEntryCount: inventory.entryCount,
    preparedCandidateTotalFileBytes: inventory.totalFileBytes,
    baseDependencyClosureDigest: inventory.dependencyClosureDigest,
    authenticatedGitClosureDigest: inventory.gitBundleDigest,
    producer: hostedProducer
  });
  return Object.freeze({
    ...withoutDigest,
    ticketDigest: CodexDevelopmentVerificationDigest(withoutDigest) as VerificationActionKeyDigest
  });
}

function hostedRawResult(
  resolution: HostedActionResolution<import("../../src/adapters/verification/platform/action/contract/ci.ts").CiVerificationExecutionEnvironment, typeof import("../../src/adapters/verification/platform/ci/verification-hosted-action-contract.ts").CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA>,
  status: 'passed' | 'failed' | 'unsupported' | 'invalidated'
): HostedActionRawResult<typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY, typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST, typeof import("../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA, typeof import("../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA> {
  const ticket = hostedTicket(resolution);
  const memberIndex = resolution.actionPlanClosure.actions.findIndex(
    (member) => member.action.actionKey === resolution.actionPlan.action.actionKey
  );
  const normalizedOperation = resolution.actionPlanClosure.normalizedOperations[memberIndex]!;
  const authorization = CodexDevelopmentCreateHostedSutExecutionAuthorization({
    resolutionDigest: resolution.resolutionDigest,
    ticketDigest: ticket.ticketDigest,
    actionPlan: resolution.actionPlan,
    normalizedOperation,
    candidateSha: resolution.artifactInput.headSha,
    candidateBytesDigest: resolution.artifactInput.candidateBytesDigest as VerificationActionKeyDigest,
    manifestPath: resolution.artifactInput.manifestPath,
    inventoryClosure: Object.freeze({
      archiveDigest: digest('9'),
      inventoryDigest: digest('0'),
      entryCount: 12,
      totalFileBytes: 1024,
      dependencyClosureDigest: DEPENDENCY_CLOSURE,
      gitBundleDigest: GIT_CLOSURE
    }),
    producer: hostedProducer
  });
  const receipt = sandboxReceipt(resolution.actionPlan.action.actionKey, status, authorization);
  return CodexDevelopmentFinalizeHostedActionRawResult({
    executionAuthorizationDigest: authorization.authorizationDigest,
    command: status === 'passed' || status === 'failed' ? Object.freeze({
      commandPlanDigest: receipt.commandPlanDigest!,
      executionAuthorizationDigest: authorization.authorizationDigest,
      physicalCommandProjectionDigest: authorization.physicalCommand.projectionDigest
    }) : null,
    sandboxReceipt: receipt,
    startedAt: '2026-08-09T00:00:00.000Z',
    finishedAt: '2026-08-09T00:00:01.000Z'
  });
}

type HostedEnvelopeFixture = Parameters<typeof CodexDevelopmentCoordinateHostedActions>[0]['envelope'];

function hostedDagClosure(
  dependencyIndexes: readonly (readonly number[])[]
): CiVerificationActionPlanClosure {
  const gates = hostedGates();
  if (dependencyIndexes.length > gates.length) throw new Error('Hosted DAG fixture has too many members.');
  const actions = [] as ReturnType<typeof buildCiVerificationActionPlan>[];
  const normalizedOperations = [] as CiVerificationActionPlanClosure['normalizedOperations'][number][];
  for (const [index, dependencies] of dependencyIndexes.entries()) {
    const gate = gates[index]!;
    const normalized = buildCiVerificationActionPlanClosure({
      candidate: hostedCandidate(),
      gates: [gate]
    }).normalizedOperations[0]!;
    const upstreamActionKeys = dependencies.map((dependencyIndex) => {
      const dependency = actions[dependencyIndex];
      if (dependency === undefined || dependencyIndex >= index) {
        throw new Error('Hosted DAG fixture dependencies must reference an earlier member.');
      }
      return dependency.action.actionKey;
    });
    actions.push(buildCiVerificationActionPlan({
      candidate: hostedCandidate(),
      gate,
      upstreamActionKeys
    }));
    normalizedOperations.push(normalized);
  }
  const template = buildCiVerificationActionPlanClosure({
    candidate: hostedCandidate(),
    gates: [gates[0]!]
  });
  const withoutDigest = Object.freeze({
    schema: template.schema,
    producerRevision: template.producerRevision,
    actions: Object.freeze(actions),
    normalizedOperations: Object.freeze(normalizedOperations)
  });
  return Object.freeze({
    ...withoutDigest,
    actionPlanDigest: CodexDevelopmentVerificationDigest(withoutDigest) as VerificationActionKeyDigest
  });
}

function hostedEnvelopeFixture(
  actionPlanClosure: CiVerificationActionPlanClosure
): HostedEnvelopeFixture {
  const scopeAuthorizationRevision = hostedCandidate().scopeAuthorizationRevision;
  const scopeAuthorizationDigest = digest('5');
  const sessionProposalDigest = digest('6');
  const sessionRevision = digest('7');
  const mainHealthRevision = digest('8');
  const mainHealthDigest = digest('9');
  const withoutDigest = Object.freeze({
    schema: VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA,
    requestOperationId: digest('0'),
    scopeAuthorization: Object.freeze({
      repository: hostedProducer.repository,
      authorizationRevision: scopeAuthorizationRevision,
      authorizationDigest: scopeAuthorizationDigest
    }),
    preGateReview: Object.freeze({ receiptDigest: digest('a') }),
    mainHealth: Object.freeze({ healthRevision: mainHealthRevision, ledgerDigest: mainHealthDigest }),
    session: Object.freeze({
      schema: 'codex-development-verification-session-v2',
      sessionId: 'hosted-composition-fixture',
      createdAt: '2026-08-09T00:00:00.000Z',
      repository: hostedProducer.repository,
      prNumber: 42,
      baseSha: BASE,
      baseTreeSha: BASE_TREE,
      headSha: HEAD,
      headTreeSha: TREE,
      manifestPath: MANIFEST_PATH,
      manifestDigest: hostedCandidate().manifestDigest,
      sessionProposalDigest,
      scopeAuthorizationRevision,
      scopeAuthorizationReceiptDigest: scopeAuthorizationDigest,
      actionPlanClosureDigest: actionPlanClosure.actionPlanDigest,
      profile: 'quick',
      environmentDigest: digest('b'),
      trustRevision: BASE,
      reviewPolicyDigest: digest('c'),
      evidenceRequirementDigest: digest('d'),
      integrationPolicyDigest: digest('e'),
      mainHealthRef: Object.freeze({
        healthRevision: mainHealthRevision,
        ledgerReceiptDigest: mainHealthDigest
      }),
      sessionRevision
    }),
    actionPlanClosure
  });
  return Object.freeze({
    ...withoutDigest,
    envelopeDigest: CodexDevelopmentVerificationDigest(withoutDigest)
  }) as unknown as HostedEnvelopeFixture;
}

const hostedEvidenceProducer = CodexDevelopmentCreateVerificationEvidenceProducer({
  sourceTransport: 'github-actions',
  workflowPath: '.github/workflows/compiler-pr-validation.yml',
  workflowRef: `.github/workflows/compiler-pr-validation.yml@${BASE}`,
  workflowSha: BASE,
  runId: '9002',
  runAttempt: 1,
  actorNodeId: 'BOT_actions_fixture'
});

type HostedProviderInputs = Readonly<{
  observations: readonly CodexDevelopmentHostedActionArtifactObservation[];
  startObservations: readonly VerificationActionProviderStartObservation[];
  terminalAnchorObservations: readonly VerificationActionProviderTerminalAnchorObservation[];
  providerStatusReadbacks: readonly VerificationActionProviderStatusReadback[];
}>;

function hostedProviderInputs(
  envelope: HostedEnvelopeFixture,
  terminals: ReadonlyMap<number, Readonly<{
    status: Exclude<VerificationResultStatus, 'not-run'>;
    expired?: boolean;
  }>>
): HostedProviderInputs {
  const observations: CodexDevelopmentHostedActionArtifactObservation[] = [];
  const startObservations: VerificationActionProviderStartObservation[] = [];
  const terminalAnchorObservations: VerificationActionProviderTerminalAnchorObservation[] = [];
  const providerStatusReadbacks: VerificationActionProviderStatusReadback[] = [];
  for (const [index, member] of envelope.actionPlanClosure.actions.entries()) {
    const actionKey = member.action.actionKey;
    const terminalSpec = terminals.get(index);
    if (terminalSpec === undefined) {
      providerStatusReadbacks.push(finalizeVerificationActionProviderStatusReadback({
        repositoryId: hostedProducer.repositoryId,
        repository: hostedProducer.repository,
        actionKey,
        candidateSha: HEAD,
        context: verificationActionProviderStatusContext(actionKey),
        perPage: 100,
        paginationComplete: true,
        pageDigests: [bytesDigest(`empty-status-page-${index}`)],
        statuses: []
      }));
      continue;
    }
    const resolution = hostedMemberResolution(envelope.actionPlanClosure, index);
    const rawResult = hostedRawResult(resolution, terminalSpec.status);
    const artifact = CodexDevelopmentAssembleHostedActionTerminal({
      resolution,
      ticket: hostedTicket(resolution),
      rawResult,
      expectedRawResultDigest: rawResult.rawResultDigest,
      producer: hostedProducer
    });
    const terminalPayloadDigest = artifact.artifactDigest as VerificationActionKeyDigest;
    const startStatusId = 1001 + index * 10;
    const startStatusNodeId = `STATUS_start_${index}`;
    const startOriginId = String(2001 + index * 10);
    const terminalOriginId = String(2002 + index * 10);
    const anchorOriginId = String(2003 + index * 10);
    const startArchiveDigest = bytesDigest(`start-archive-${index}`);
    const terminalArchiveDigest = bytesDigest(`terminal-archive-${index}`);
    const marker = createVerificationActionProviderStartMarker({
      actionKey,
      candidateSha: HEAD,
      executionEnvironmentRevision:
        CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT.executionEnvironmentRevision,
      producer: hostedProducer
    });
    const anchor = createVerificationActionProviderTerminalAnchor({
      actionKey,
      candidateSha: HEAD,
      startStatusId,
      startStatusNodeId,
      startArtifactOriginId: startOriginId,
      startArtifactName: verificationActionProviderStartArtifactName(actionKey),
      startArtifactArchiveDigest: startArchiveDigest,
      startMarkerDigest: marker.markerDigest,
      terminalArtifactOriginId: terminalOriginId,
      terminalArtifactName: verificationActionProviderTerminalArtifactName(actionKey),
      terminalArtifactArchiveDigest: terminalArchiveDigest,
      terminalArtifactPayloadDigest: terminalPayloadDigest,
      terminalAssemblerOrigin: hostedProducer,
      anchorPublisherOrigin: hostedProducer
    });
    const targetUrl = verificationActionProviderRunTargetUrl(hostedProducer);
    const creator = VERIFICATION_ACTION_PROVIDER_POLICY.creator;
    const statuses: VerificationActionProviderStatusObservation[] = [
      Object.freeze({
        id: startStatusId,
        nodeId: startStatusNodeId,
        state: 'pending',
        context: verificationActionProviderStatusContext(actionKey),
        description: verificationActionProviderStartDescription(marker.markerDigest),
        targetUrl,
        commitSha: HEAD,
        createdAt: '2026-08-09T00:00:00.000Z',
        updatedAt: '2026-08-09T00:00:00.000Z',
        creator,
        referencedOrigin: hostedProducer
      }),
      Object.freeze({
        id: startStatusId + 1,
        nodeId: `STATUS_terminal_${index}`,
        state: 'success',
        context: verificationActionProviderStatusContext(actionKey),
        description: verificationActionProviderTerminalDescription(anchor.anchorDigest),
        targetUrl,
        commitSha: HEAD,
        createdAt: '2026-08-09T00:00:01.000Z',
        updatedAt: '2026-08-09T00:00:01.000Z',
        creator,
        referencedOrigin: hostedProducer
      })
    ];
    startObservations.push(Object.freeze({
      originId: startOriginId,
      artifactName: verificationActionProviderStartArtifactName(actionKey),
      archiveDigest: startArchiveDigest,
      expired: false,
      payload: marker,
      referencedOrigin: hostedProducer
    }));
    observations.push(Object.freeze({
      providerObservation: Object.freeze({
        originId: terminalOriginId,
        artifactName: verificationActionProviderTerminalArtifactName(actionKey),
        archiveDigest: terminalSpec.expired ? null : terminalArchiveDigest,
        expired: terminalSpec.expired ?? false,
        payload: terminalSpec.expired ? null : Object.freeze({
          actionKey,
          candidateSha: HEAD,
          payloadDigest: terminalPayloadDigest,
          producer: hostedProducer
        }),
        referencedOrigin: hostedProducer
      }),
      artifact: terminalSpec.expired ? null : artifact
    }));
    terminalAnchorObservations.push(Object.freeze({
      originId: anchorOriginId,
      artifactName: verificationActionProviderTerminalAnchorName(actionKey),
      archiveDigest: bytesDigest(`anchor-archive-${index}`),
      expired: false,
      payload: anchor,
      referencedOrigin: hostedProducer
    }));
    providerStatusReadbacks.push(finalizeVerificationActionProviderStatusReadback({
      repositoryId: hostedProducer.repositoryId,
      repository: hostedProducer.repository,
      actionKey,
      candidateSha: HEAD,
      context: verificationActionProviderStatusContext(actionKey),
      perPage: 100,
      paginationComplete: true,
      pageDigests: [bytesDigest(`terminal-status-page-${index}`)],
      statuses
    }));
  }
  return Object.freeze({
    observations: Object.freeze(observations),
    startObservations: Object.freeze(startObservations),
    terminalAnchorObservations: Object.freeze(terminalAnchorObservations),
    providerStatusReadbacks: Object.freeze(providerStatusReadbacks)
  });
}

test('CI runner executes an ordinary gate through Action and publishes only V4', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-ci-action-'));
  try {
    let evidence: VerificationEvidence<typeof CI_VERIFICATION_CONTRACT_REVISION, VerificationResultStatus, VerificationGateResult> | null = null;
    const calls: string[] = [];
    const code = await CodexDevelopmentCiVerificationMainForTests({
      ...baseOptions(root),
      runGate: async (gate, execution) => {
        calls.push(gate.id);
        return executeSentinelGate(root, 0)(gate, execution);
      },
      writeEvidence: (_file, value) => { evidence = value; }
    });
    expect(code).toBe(0);
    expect(calls.length).toBeGreaterThan(0);
    const captured = evidence as VerificationEvidence<typeof CI_VERIFICATION_CONTRACT_REVISION, VerificationResultStatus, VerificationGateResult> | null;
    expect(captured?.gates.every((gate) => gate.action.actionKey === gate.result.inputDigest)).toBe(true);
    expect(() => CodexDevelopmentAssertVerificationEvidenceV4(captured, {
      actionPlan: captured!.actionPlan
    }, new Date('2026-08-09T00:01:00.000Z'))).not.toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CI runner accepts transition injection only with matching exact changed records', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-ci-transition-binding-'));
  try {
    const transition = CodexDevelopmentCreateTestImpactTransitionObservation({
      baseSha: BASE,
      headSha: HEAD,
      records: [{ status: 'changed', path: 'src/bootstrap/engineering/cli.ts' }],
      readPathBlob: () => null
    });
    expect(await CodexDevelopmentCiVerificationMainForTests({
      ...baseOptions(root),
      transitionObservation: transition,
      writeEvidence: () => undefined
    })).toBe(1);
    const { changedFiles: _changedFiles, ...recordOptions } = baseOptions(root);
    void _changedFiles;
    expect(await CodexDevelopmentCiVerificationMainForTests({
      ...recordOptions,
      changedRecords: () => [{ status: 'added', path: 'src/bootstrap/engineering/cli.ts' }],
      transitionObservation: transition,
      writeEvidence: () => undefined
    })).toBe(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('multi-commit candidate uses exact current base and never requires HEAD^1', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-ci-multicommit-'));
  try {
    const refs: string[] = [];
    const code = await CodexDevelopmentCiVerificationMainForTests({
      ...baseOptions(root),
      gitRevision: (ref) => {
        refs.push(ref);
        if (ref === 'HEAD^1') throw new Error('single-parent assumption is retired');
        return revisions(ref);
      },
      writeEvidence: () => undefined
    });
    expect(code).toBe(0);
    expect(refs).not.toContain('HEAD^1');
    expect(refs).toContain(`${BASE}^{tree}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('formal hosted mode fails closed before physical execution without complete Session/Action closure', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-ci-formal-'));
  try {
    let spawns = 0;
    let writes = 0;
    const code = await CodexDevelopmentCiVerificationMainForTests({
      ...baseOptions(root),
      env: { ...baseOptions(root).env, SEC_FORMAL_HOSTED_MODE: '1' },
      runGate: async (gate, execution) => {
        spawns += 1;
        return executeSentinelGate(root, 0)(gate, execution);
      },
      writeEvidence: () => { writes += 1; }
    });
    expect(code).toBe(1);
    expect(spawns).toBe(0);
    expect(writes).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Action journal reuse is not Evidence without an independent durable result resolver', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-ci-reuse-'));
  try {
    expect(await CodexDevelopmentCiVerificationMainForTests({
      ...baseOptions(root),
      writeEvidence: () => undefined
    })).toBe(0);
    let physical = 0;
    let writes = 0;
    expect(await CodexDevelopmentCiVerificationMainForTests({
      ...baseOptions(root),
      runGate: async (gate, execution) => {
        physical += 1;
        return executeSentinelGate(root, 0)(gate, execution);
      },
      writeEvidence: () => { writes += 1; }
    })).toBe(1);
    expect(physical).toBe(0);
    expect(writes).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('durable known failure reuse remains failed and never executes or promotes to PASS', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-ci-known-failure-'));
  try {
    let first: VerificationEvidence<typeof CI_VERIFICATION_CONTRACT_REVISION, VerificationResultStatus, VerificationGateResult> | null = null;
    expect(await CodexDevelopmentCiVerificationMainForTests({
      ...baseOptions(root),
      runGate: executeSentinelGate(root, 1, 'known failure'),
      writeEvidence: (_file, value) => { first = value; }
    })).toBe(1);
    const terminal = first as unknown as VerificationEvidence<typeof CI_VERIFICATION_CONTRACT_REVISION, VerificationResultStatus, VerificationGateResult>;
    expect(terminal.status).toBe('failed');
    const byActionKey = new Map(terminal.gates.map((gate) => [gate.action.actionKey, gate.result]));
    let physical = 0;
    let reused: VerificationEvidence<typeof CI_VERIFICATION_CONTRACT_REVISION, VerificationResultStatus, VerificationGateResult> | null = null;
    expect(await CodexDevelopmentCiVerificationMainForTests({
      ...baseOptions(root),
      runGate: async (gate, execution) => {
        physical += 1;
        return executeSentinelGate(root, 0)(gate, execution);
      },
      readDurableActionResult: (actionKey) => {
        const result = byActionKey.get(actionKey);
        return result === undefined ? null : { result, evidenceRefs: ['artifact://known-failure'] };
      },
      writeEvidence: (_file, value) => { reused = value; }
    })).toBe(1);
    expect(physical).toBe(0);
    const second = reused as unknown as VerificationEvidence<typeof CI_VERIFICATION_CONTRACT_REVISION, VerificationResultStatus, VerificationGateResult>;
    expect(second.status).toBe('failed');
    expect(second.gates[0]!.result).toMatchObject({ status: 'failed', disposition: 'reused' });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('trusted bootstrap cleanliness excludes only its exact nested candidate checkout', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-bootstrap-nested-candidate-'));
  const baseRoot = path.join(root, 'base');
  const candidateRoot = path.join(baseRoot, 'candidate-sut');
  try {
    mkdirSync(baseRoot, { recursive: true });
    gitFixture(baseRoot, ['init', '--quiet']);
    gitFixture(baseRoot, ['config', 'user.email', 'sec-test@example.invalid']);
    gitFixture(baseRoot, ['config', 'user.name', 'SEC Test']);
    writeFileSync(path.join(baseRoot, '.gitignore'), 'ignored-residue.txt\n');
    writeFileSync(path.join(baseRoot, 'base.txt'), 'base\n');
    gitFixture(baseRoot, ['add', '.gitignore', 'base.txt']);
    gitFixture(baseRoot, ['commit', '--quiet', '-m', 'base']);
    const clone = spawnSync('git', ['clone', '--quiet', baseRoot, candidateRoot], {
      encoding: 'utf8', windowsHide: true, timeout: 30_000
    });
    if (clone.status !== 0) throw new Error(`Git fixture clone failed: ${clone.stderr || clone.stdout}`);
    gitFixture(candidateRoot, ['config', 'user.email', 'sec-test@example.invalid']);
    gitFixture(candidateRoot, ['config', 'user.name', 'SEC Test']);
    writeFileSync(path.join(candidateRoot, 'candidate.txt'), 'candidate\n');
    gitFixture(candidateRoot, ['add', 'candidate.txt']);
    gitFixture(candidateRoot, ['commit', '--quiet', '-m', 'candidate']);

    expect(() => CodexDevelopmentAssertTrustedBootstrapSutMaterializationClean({
      baseRoot, candidateRoot
    })).not.toThrow();

    const foreignBasePath = path.join(baseRoot, 'foreign.txt');
    writeFileSync(foreignBasePath, 'foreign\n');
    expect(() => CodexDevelopmentAssertTrustedBootstrapSutMaterializationClean({
      baseRoot, candidateRoot
    })).toThrow(/clean base and candidate/);
    rmSync(foreignBasePath);

    const ignoredBasePath = path.join(baseRoot, 'ignored-residue.txt');
    writeFileSync(ignoredBasePath, 'ignored foreign base bytes\n');
    expect(() => CodexDevelopmentAssertTrustedBootstrapSutMaterializationClean({
      baseRoot, candidateRoot
    })).toThrow(/clean base and candidate/);
    rmSync(ignoredBasePath);

    const dirtyCandidatePath = path.join(candidateRoot, 'dirty.txt');
    writeFileSync(dirtyCandidatePath, 'dirty\n');
    expect(() => CodexDevelopmentAssertTrustedBootstrapSutMaterializationClean({
      baseRoot, candidateRoot
    })).toThrow(/clean base and candidate/);
    rmSync(dirtyCandidatePath);

    const ignoredCandidatePath = path.join(candidateRoot, 'ignored-residue.txt');
    writeFileSync(ignoredCandidatePath, 'ignored foreign candidate bytes\n');
    expect(() => CodexDevelopmentAssertTrustedBootstrapSutMaterializationClean({
      baseRoot, candidateRoot
    })).toThrow(/clean base and candidate/);
    rmSync(ignoredCandidatePath);

    const candidateSubdirectory = path.join(candidateRoot, 'nested');
    mkdirSync(candidateSubdirectory);
    expect(() => CodexDevelopmentAssertTrustedBootstrapSutMaterializationClean({
      baseRoot, candidateRoot: candidateSubdirectory
    })).toThrow(/two exact Git checkout roots/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('hosted SUT executes only through the isolated command plan and terminalizes raw archive drift', async () => {
  const directBunTestArgv = [
    'bun', 'test', 'tests/unit/verification-action-ci-contract.test.ts',
    '--test-name-pattern', '^direct Bun tests$', '--timeout', '180000'
  ];
  const resolution = hostedResolution([{
    id: 'hosted-direct-bun-test',
    phase: 'quick',
    argv: directBunTestArgv,
    runtime: 'bun',
    environment: {},
    coveredScopeIds: ['scope:hosted-direct-bun-test']
  }]);
  const cleanRoot = mkdtempSync(path.join(tmpdir(), 'sec-hosted-clean-'));
  const dirtyRoot = mkdtempSync(path.join(tmpdir(), 'sec-hosted-dirty-'));
  try {
    const cleanArchive = path.join(cleanRoot, 'prepared-candidate.tar');
    const dirtyArchive = path.join(dirtyRoot, 'prepared-candidate.tar');
    writeFileSync(cleanArchive, 'authenticated-clean-archive');
    writeFileSync(dirtyArchive, 'authenticated-dirty-archive');
    const inventory = (archive: string): HostedSutInventory => ({
      archiveDigest: bytesDigest(readFileSync(archive)),
      inventoryDigest: digest('0'),
      entryCount: 20,
      totalFileBytes: 4096,
      dependencyClosureDigest: DEPENDENCY_CLOSURE,
      gitBundleDigest: GIT_CLOSURE
    });
    let executionPlan: Parameters<typeof assertHostedSutSandboxCommandPlan>[0] | null = null;
    const retainedArchiveBytes: string[] = [];
    const cleanInventory = inventory(cleanArchive);
    const cleanTicket = hostedTicket(resolution, cleanInventory);
    const clean = await executeSutFixture({
      resolution,
      ticket: cleanTicket,
      candidateArchive: cleanArchive,
      archiveInventory: cleanInventory,
      env: {
        SAFE_INPUT: 'visible',
        GH_TOKEN: 'secret-1',
        gh_token: 'secret-2',
        GITHUB_TOKEN: 'secret-3',
        Actions_Custom_Token: 'secret-4',
        GITHUB_ENV: 'secret-command-file',
        ACTIONS_ID_TOKEN_REQUEST_URL: 'secret-url'
      },
      now: clock(),
      platform: 'linux',
      unitNonce: 'clean',
      runSandboxProcess: async (plan, retainedArchive) => {
        if (plan.phase === 'capability-self-test') {
          return sandboxObservation(0, '__SEC_HOSTED_SANDBOX_CAPABILITY_V1__');
        }
        if (plan.phase === 'teardown') {
          return sandboxObservation(0, '');
        }
        executionPlan = plan;
        expect(retainedArchive).toBeDefined();
        const movedArchive = `${cleanArchive}.retained`;
        renameSync(cleanArchive, movedArchive);
        writeFileSync(cleanArchive, 'malicious dependency archive at the authenticated pathname');
        try {
          const buffer = Buffer.alloc(256);
          const bytes = readSync(
            retainedArchive!.fileDescriptor,
            buffer,
            0,
            buffer.byteLength,
            0
          );
          retainedArchiveBytes.push(buffer.subarray(0, bytes).toString('utf8'));
          expect(retainedArchive!.archiveDigest).toBe(cleanInventory.archiveDigest);
        } finally {
          rmSync(cleanArchive);
          renameSync(movedArchive, cleanArchive);
        }
        return sandboxObservation(0, 'candidate output is captured, never echoed');
      }
    });
    const cleanTerminal = CodexDevelopmentAssembleHostedActionTerminal({
      resolution, ticket: cleanTicket, rawResult: clean,
      expectedRawResultDigest: clean.rawResultDigest, producer: hostedProducer
    });
    // Rename-away/restore changes the original physical generation metadata,
    // even when the retained descriptor still reads the authenticated bytes.
    expect(cleanTerminal.cleanup).toMatchObject({ status: 'failed', diagnostic: expect.stringContaining('retained archive changed') });
    expect(cleanTerminal.cleanup.evidenceRefs).toEqual([
      `sandbox-receipt:${clean.sandboxReceipt.receiptDigest}`
    ]);
    expect(executionPlan).not.toBeNull();
    expect(retainedArchiveBytes).toEqual(['authenticated-clean-archive']);
    expect(JSON.stringify(executionPlan!.argv)).not.toContain(cleanArchive);
    expect(() => assertHostedSutSandboxCommandPlan(executionPlan!)).not.toThrow();
    expect(executionPlan!.argv.slice(-directBunTestArgv.length)).toEqual(directBunTestArgv);
    expect(cleanTerminal.result.execution).toBeNull();
    expect(executionPlan!.candidateEnvironmentNames).toContain('SEC_FORMAL_HOSTED_MODE');
    for (const name of [
      'SAFE_INPUT', 'GH_TOKEN', 'gh_token', 'GITHUB_TOKEN', 'Actions_Custom_Token',
      'GITHUB_ENV', 'ACTIONS_ID_TOKEN_REQUEST_URL'
    ]) expect(executionPlan!.candidateEnvironmentNames).not.toContain(name);

    const dirtyInventory = inventory(dirtyArchive);
    const dirtyTicket = hostedTicket(resolution, dirtyInventory);
    const dirty = await executeSutFixture({
      resolution,
      ticket: dirtyTicket,
      candidateArchive: dirtyArchive,
      archiveInventory: dirtyInventory,
      now: clock(),
      platform: 'linux',
      unitNonce: 'dirty',
      runSandboxProcess: async (plan) => {
        if (plan.phase === 'capability-self-test') {
          return sandboxObservation(0, '__SEC_HOSTED_SANDBOX_CAPABILITY_V1__');
        }
        if (plan.phase === 'teardown') {
          return sandboxObservation(0, '');
        }
        writeFileSync(dirtyArchive, 'substituted archive bytes');
        return sandboxObservation(0, 'candidate could not write host input');
      }
    });
    const dirtyTerminal = CodexDevelopmentAssembleHostedActionTerminal({
      resolution, ticket: dirtyTicket, rawResult: dirty,
      expectedRawResultDigest: dirty.rawResultDigest, producer: hostedProducer
    });
    expect(dirtyTerminal.result.status).toBe('invalidated');
    expect(dirtyTerminal.cleanup).toMatchObject({ status: 'failed' });
    expect(dirtyTerminal.cleanup.diagnostic).toContain('authenticated archive');
  } finally {
    rmSync(cleanRoot, { recursive: true, force: true });
    rmSync(dirtyRoot, { recursive: true, force: true });
  }
});

test('sandbox command plan proves cgroup, namespace, private-root, uid, capability, fd and output boundaries', () => {
  const resolution = hostedResolution();
  const ticket = hostedTicket(resolution);
  const memberIndex = resolution.actionPlanClosure.actions.findIndex(
    (member) => member.action.actionKey === resolution.actionPlan.action.actionKey
  );
  const normalizedOperation = resolution.actionPlanClosure.normalizedOperations[memberIndex]!;
  const executionAuthorization = CodexDevelopmentCreateHostedSutExecutionAuthorization({
    resolutionDigest: resolution.resolutionDigest,
    ticketDigest: ticket.ticketDigest,
    actionPlan: resolution.actionPlan,
    normalizedOperation,
    candidateSha: resolution.artifactInput.headSha,
    candidateBytesDigest: resolution.artifactInput.candidateBytesDigest as VerificationActionKeyDigest,
    manifestPath: resolution.artifactInput.manifestPath,
    inventoryClosure: Object.freeze({
      archiveDigest: ticket.preparedCandidateArchiveDigest,
      inventoryDigest: ticket.preparedCandidateInventoryDigest,
      entryCount: ticket.preparedCandidateEntryCount,
      totalFileBytes: ticket.preparedCandidateTotalFileBytes,
      dependencyClosureDigest: ticket.baseDependencyClosureDigest,
      gitBundleDigest: ticket.authenticatedGitClosureDigest
    }),
    producer: hostedProducer
  });
  const plan = buildHostedSutSandboxCommandPlan({
    actionKey: resolution.actionPlan.action.actionKey,
    candidateArchiveDigest: ticket.preparedCandidateArchiveDigest,
    bunExecutable: '/trusted/tool/bun',
    baseSha: normalizedOperation.candidate.baseSha,
    headSha: normalizedOperation.candidate.headSha,
    normalizedArgv: executionAuthorization.normalizedArgv,
    candidateEnvironment: CodexDevelopmentHostedSutCandidateEnvironment({
      normalizedOperation,
      manifestPath: resolution.artifactInput.manifestPath
    }),
    executionAuthorization
  });
  expect(() => assertHostedSutSandboxCommandPlan(plan)).not.toThrow();
  expect(plan.command).toBe('/usr/bin/unshare');
  const encoded = JSON.stringify(plan.argv);
  for (const invariant of [
    '--mount', '--pid', '--fork', '--kill-child=KILL', '--net',
    '/usr/sbin/chroot', 'mount -t proc',
    'copy_runtime /usr/bin/bash /usr/bin/bash', 'copy_runtime /usr/bin/tar /usr/bin/tar',
    'runtime-binary-closure',
    '/authenticated-input/prepared-candidate.tar', '/usr/bin/setpriv', '--no-new-privs',
    '--bounding-set=-all', '/usr/bin/prlimit', '/usr/bin/env -i',
    '/proc/self/fd/3', '/usr/bin/cat --', '$candidate_archive', '/usr/bin/sha256sum',
    'for fd_path in /proc/self/fd/*', 'git -C /workspace init'
  ]) expect(encoded).toContain(invariant);
  expect(encoded).toContain(CI_VERIFICATION_HOSTED_SANDBOX_POLICY.python.executablePath);
  expect(encoded).toContain(CI_VERIFICATION_HOSTED_SANDBOX_POLICY.python.stdlibDirectory);
  for (const forbidden of [
    'GITHUB_OUTPUT', 'GH_TOKEN', '/host/output', '/var/run/docker.sock', '/run/docker.sock',
    '/home/runner/work', 'RUNNER_TEMP', 'verification-action-raw-result.json',
    'mount --bind /usr', '/usr/bin/sudo', '/usr/bin/systemd-run'
  ]) expect(encoded).not.toContain(forbidden);
  expect(plan.candidateEnvironmentNames).toEqual(
    executionAuthorization.physicalCommand.fixedSandboxEnvironment.map((entry) => entry.name)
  );
  const bootstrapPlan = buildTrustedBootstrapSutSandboxCommandPlan({
    bootstrapDigest: digest('b'),
    candidateArchiveDigest: digest('a'),
    bunExecutable: '/trusted/tool/bun',
    baseSha: normalizedOperation.candidate.baseSha,
    headSha: normalizedOperation.candidate.headSha,
    candidateEnvironment: hostedCandidateProcessEnvironment({
      SEC_EXECUTION_ENVIRONMENT_REVISION: normalizedOperation.candidate.executionEnvironmentRevision
    }, {
      SEC_BOOTSTRAP_BASE: normalizedOperation.candidate.baseSha,
      SEC_BOOTSTRAP_HEAD: normalizedOperation.candidate.headSha,
      SEC_BOOTSTRAP_TREE: TREE
    }),
    unitNonce: 'bootstrap-contract'
  });
  expect(() => assertHostedSutSandboxCommandPlan(bootstrapPlan)).not.toThrow();
  expect(bootstrapPlan.phase).toBe('bootstrap-execute');
  expect(bootstrapPlan.executionAuthorizationDigest).toBeNull();
  expect(bootstrapPlan.physicalCommandProjectionDigest).toBeNull();
  expect(bootstrapPlan.argv.at(-1)).toBe(TRUSTED_BOOTSTRAP_SUT_HARNESS);
  expect(TRUSTED_BOOTSTRAP_SUT_HARNESS).toContain('reader.releaseLock()');
  expect(TRUSTED_BOOTSTRAP_SUT_HARNESS).toContain('reader.cancel(error)');
  expect(TRUSTED_BOOTSTRAP_SUT_HARNESS).toContain('Promise.allSettled([stdoutCollection, stderrCollection, exitPromise])');
  expect(JSON.stringify(bootstrapPlan.argv)).not.toContain('GITHUB_OUTPUT');
});

test('parent event binds the canonical one-key Session request wrapper', () => {
  const sessionRequest: VerificationSessionHostedRequest<typeof import("../../src/adapters/verification/platform/ci/contract/session-request.ts").CI_VERIFICATION_SESSION_REQUEST_SCHEMA> = Object.freeze({
    schema: 'sec-verification-session-hosted-request-v1',
    prNumber: 42,
    expectedBaseSha: BASE,
    expectedBaseTreeSha: BASE_TREE,
    expectedHeadSha: HEAD,
    expectedHeadTreeSha: TREE,
    manifestPath: MANIFEST_PATH,
    manifestDigest: hostedCandidate().manifestDigest,
    profile: 'quick',
    expectedScopeProposalDigest: digest('5'),
    expectedActionPlanDigest: digest('6'),
    expectedSessionRevision: digest('7'),
    reviewPolicyDigest: digest('8'),
    requestOperationId: digest('9')
  });
  const canonicalEvent = Object.freeze({
    action: CI_VERIFICATION_SESSION_DISPATCH_TYPE,
    client_payload: Object.freeze({ payload: sessionRequest })
  });
  expect(() => CodexDevelopmentAssertHostedActionParentEvent(
    canonicalEvent,
    sessionRequest
  )).not.toThrow();
  expect(() => CodexDevelopmentAssertHostedActionParentEvent(
    { ...canonicalEvent, action: 'wrong-session-event' },
    sessionRequest
  )).toThrow('exact Session request wrapper');
  expect(() => CodexDevelopmentAssertHostedActionParentEvent(
    { ...canonicalEvent, client_payload: sessionRequest },
    sessionRequest
  )).toThrow('exact Session request wrapper');
  expect(() => CodexDevelopmentAssertHostedActionParentEvent(
    { ...canonicalEvent, client_payload: { payload: sessionRequest, extra: true } },
    sessionRequest
  )).toThrow('exact Session request wrapper');
});

test('supervisor errors do not settle the hosted process before close or attest inner execution', async () => {
  const child = Object.assign(new EventEmitter(), {
    stdout: null, stderr: null, kill: () => true
  }) as unknown as ChildProcess;
  let resolved = false;
  const pending = observeHostedSutSandboxChild(child).then((observation) => {
    resolved = true;
    return observation;
  });
  child.emit('spawn');
  child.emit('error', new Error('unshare: Operation not permitted'));
  await Promise.resolve();
  expect(resolved).toBe(false);
  child.emit('close', 1, null);
  const observation = await pending;
  expect(observation.lifecycle).toEqual({
    supervisorSpawned: true, supervisorClosed: true, supervisorCloseCode: 1, supervisorSignal: null,
    namespaceEstablished: null, candidateStarted: null, candidateUnitSettled: null,
    observationGap: 'unsupported-source'
  });
  expect(observation.code).toBe(1);
});

test('capability success and directory cleanup cannot promote a pre-namespace supervisor failure to executed', async () => {
  const resolution = hostedResolution();
  const root = mkdtempSync(path.join(tmpdir(), 'sec-hosted-pre-namespace-'));
  const archive = path.join(root, 'prepared-candidate.tar');
  writeFileSync(archive, 'pre-namespace-fixture');
  const archiveInventory = {
    archiveDigest: bytesDigest('pre-namespace-fixture'), inventoryDigest: digest('0'),
    entryCount: 4, totalFileBytes: 100,
    dependencyClosureDigest: DEPENDENCY_CLOSURE, gitBundleDigest: GIT_CLOSURE
  };
  const ticket = hostedTicket(resolution, archiveInventory);
  try {
    const unqualified = prepareHostedActionSutInputs({
      resolution, ticket, candidateArchive: path.join(root, 'absent.tar'), archiveInventory
    });
    // Production no longer has an ambient default observer. The actual Bootstrap
    // entry must reject missing native invocation before opening any candidate.
    await expect(runHostedActionSut(unqualified, {} as HostedSutInvocation)).rejects.toThrow();
    expect(existsSync(path.join(root, 'absent.tar'))).toBe(false);

    const rawResult = await executeSutFixture({
      resolution, ticket, candidateArchive: archive, archiveInventory,
      platform: 'linux', unitNonce: 'pre-namespace', now: clock(),
      runSandboxProcess: async (plan) => {
        if (plan.phase === 'capability-self-test') {
          return sandboxObservation(0, '__SEC_HOSTED_SANDBOX_CAPABILITY_V1__');
        }
        if (plan.phase === 'teardown') {
          // The retired claim in stdout cannot replace the absent physical facts.
          return sandboxObservation(0, '__SEC_HOSTED_SANDBOX_RESIDUE_EMPTY_V1__:direct-process-closed');
        }
        return sandboxObservation(1, 'unshare: Operation not permitted', { lifecycle: {
          namespaceEstablished: null, candidateStarted: null, candidateUnitSettled: null,
          observationGap: 'unsupported-source'
        } });
      }
    });
    const terminal = CodexDevelopmentAssembleHostedActionTerminal({
      resolution, ticket, rawResult,
      expectedRawResultDigest: rawResult.rawResultDigest, producer: hostedProducer
    });
    expect(terminal.result).toMatchObject({ status: 'invalidated', disposition: 'not-executed' });
    expect(rawResult.sandboxReceipt.execution.lifecycle.candidateStarted).toBeNull();
    expect(rawResult.sandboxReceipt.cleanup.exitCode).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('capability requires the post-runtime marker and rejects a missing Python executable', async () => {
  const supported = await probeSutFixture({
    actionKey: digest('a'),
    platform: 'linux',
    unitNonce: 'python-supported',
    runSandboxProcess: async (plan) => {
      if (plan.phase === 'capability-self-test') {
        return sandboxObservation(0, '__SEC_HOSTED_SANDBOX_CAPABILITY_V1__');
      }
      return sandboxObservation(0, '');
    }
  });
  expect(supported).toMatchObject({ state: 'supported', markerObserved: true, lifecycle: { candidateUnitSettled: true } });

  const missingPython = await probeSutFixture({
    actionKey: digest('b'),
    platform: 'linux',
    unitNonce: 'missing-python',
    runSandboxProcess: async (plan) => plan.phase === 'capability-self-test'
      ? sandboxObservation(127, '/usr/bin/python3: No such file or directory')
      : sandboxObservation(0, '')
  });
  expect(missingPython).toMatchObject({
    state: 'unsupported',
    markerObserved: false,
    lifecycle: { candidateUnitSettled: true }
  });
});

test.each([
  ['forbidden target', '/workspace/secret', null, 'inherited-fd:3'],
  ['disappearing descriptor', null, 'ENOENT', null],
  ['unreadable descriptor', null, 'EACCES', 'fd-readlink:EACCES'],
  ['failed descriptor read', null, 'EIO', 'fd-readlink:EIO'],
  ['allowed descriptor', '/dev/null', null, null]
] as const)('capability inherited descriptor assertion: %s', (_case, target, errorCode, expectedFailure) => {
  const assertion = HOSTED_SUT_CAPABILITY_ASSERTION;
  const start = assertion.indexOf('for (const descriptor of fs.readdirSync("/proc/self/fd"))');
  const end = assertion.indexOf('const cgroup =', start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  // Execute the shipped assertion block, not a second checker. These controlled
  // readlink outcomes qualify its rejection logic, not actual provider isolation.
  const check = new Function('fs', 'fail', assertion.slice(start, end));
  const observed: string[] = [];
  const execute = () => check({
    readdirSync(directory: string) {
      expect(directory).toBe('/proc/self/fd');
      return ['3', '4'];
    },
    readlinkSync(descriptorPath: string) {
      observed.push(descriptorPath);
      if (descriptorPath === '/proc/self/fd/3') {
        if (errorCode !== null) {
          throw Object.assign(new Error(`fd-readlink:${errorCode}`), { code: errorCode });
        }
        return target;
      }
      return '/dev/null';
    }
  }, (message: string) => { throw new Error(message); });
  if (expectedFailure === null) {
    expect(execute).not.toThrow();
    expect(observed).toEqual(['/proc/self/fd/3', '/proc/self/fd/4']);
  } else {
    expect(execute).toThrow(expectedFailure);
    expect(observed).toEqual(['/proc/self/fd/3']);
  }
});

test('capability probe detaches its deliberate residue child for trusted teardown', async () => {
  const observation = await probeSutFixture({
    actionKey: digest('a'),
    platform: 'linux',
    unitNonce: 'settled-probe',
    runSandboxProcess: async (plan) => {
      if (plan.phase === 'capability-self-test') {
        return sandboxObservation(0, '__SEC_HOSTED_SANDBOX_CAPABILITY_V1__');
      }
      return sandboxObservation(0, '');
    }
  });
  expect(observation).toMatchObject({ state: 'supported', lifecycle: { candidateUnitSettled: true } });

  const assertion = HOSTED_SUT_CAPABILITY_ASSERTION;
  const spawnOffset = assertion.indexOf('const descendant = spawn');
  const markerOffset = assertion.indexOf('process.stdout.write');
  expect(spawnOffset).toBeGreaterThanOrEqual(0);
  expect(markerOffset).toBeGreaterThan(spawnOffset);
  const lifecycle = assertion.slice(spawnOffset, markerOffset);
  expect(lifecycle).toContain('spawn("/usr/bin/sleep", ["300"]');
  expect(lifecycle).toContain('detached: true');
  expect(lifecycle).toContain('descendant.unref();');
  expect(lifecycle).not.toContain('descendant.kill');
  expect(lifecycle).not.toContain('descendant.exited');


});

test('capability unsupported or ambiguous terminalizes without invoking the candidate executor', async () => {
  const resolution = hostedResolution();
  const root = mkdtempSync(path.join(tmpdir(), 'sec-hosted-capability-'));
  const archive = path.join(root, 'prepared-candidate.tar');
  writeFileSync(archive, 'capability-fixture');
  const archiveInventory: HostedSutInventory = {
    archiveDigest: bytesDigest('capability-fixture'),
    inventoryDigest: digest('0'),
    entryCount: 4,
    totalFileBytes: 100,
    dependencyClosureDigest: DEPENDENCY_CLOSURE,
    gitBundleDigest: GIT_CLOSURE
  };
  try {
    let executions = 0;
    let capabilityPlan = '';
    const ticket = hostedTicket(resolution, archiveInventory);
    const unsupported = await executeSutFixture({
      resolution, ticket, candidateArchive: archive, archiveInventory,
      platform: 'linux', unitNonce: 'unsupported', now: clock(),
      runSandboxProcess: async (plan) => {
        if (plan.phase === 'execute') executions += 1;
        if (plan.phase === 'teardown') {
          return sandboxObservation(0, '');
        }
        capabilityPlan = plan.argv.join('\n');
        return sandboxObservation(1, 'unshare: Operation not permitted');
      }
    });
    const unsupportedTerminal = CodexDevelopmentAssembleHostedActionTerminal({
      resolution, ticket, rawResult: unsupported,
      expectedRawResultDigest: unsupported.rawResultDigest, producer: hostedProducer
    });
    expect(unsupportedTerminal.result).toMatchObject({ status: 'unsupported', disposition: 'not-executed' });
    expect(unsupported.sandboxReceipt.execution.lifecycle.candidateStarted).toBe(false);
    expect(executions).toBe(0);
    for (const invariant of [
      'SEC_HOST_SANDBOX_SENTINEL', '/proc/1/environ', '/proc/net/route',
      'fetch("http://1.1.1.1', 'spawn("/usr/bin/sleep"', 'host-usr-or-proc-mount',
      'inherited-fd', 'cgroup-limits', '/home/runner/work', '/actions-runner/_work/_actions'
    ]) expect(HOSTED_SUT_CAPABILITY_ASSERTION).toContain(invariant);
    expect(HOSTED_SUT_CAPABILITY_ASSERTION).not.toContain('process.pid !== 1');
    expect(HOSTED_SUT_CAPABILITY_ASSERTION).toContain('error?.code !== "ENOENT"');
    expect(HOSTED_SUT_CAPABILITY_ASSERTION).toStartWith('(async () => {');
    expect(HOSTED_SUT_CAPABILITY_ASSERTION).toContain(
      '})().catch((error) => { console.error(error); process.exitCode = 1; });'
    );
    for (const invariant of [
      'runtime-binary-closure', '/usr/sbin/chroot', '--kill-child=KILL'
    ]) expect(capabilityPlan).toContain(invariant);
    for (const forbidden of ['mount --bind /usr', '/var/run/docker.sock']) {
      expect(capabilityPlan).not.toContain(forbidden);
    }

    const ambiguous = await executeSutFixture({
      resolution, ticket, candidateArchive: archive, archiveInventory,
      platform: 'linux', unitNonce: 'ambiguous', now: clock(),
      runSandboxProcess: async (plan) => {
        if (plan.phase === 'execute') executions += 1;
        if (plan.phase === 'teardown') {
          return sandboxObservation(0, '');
        }
        throw new Error('supervisor channel disappeared before process start');
      }
    });
    const ambiguousTerminal = CodexDevelopmentAssembleHostedActionTerminal({
      resolution, ticket, rawResult: ambiguous,
      expectedRawResultDigest: ambiguous.rawResultDigest, producer: hostedProducer
    });
    expect(ambiguousTerminal.result).toMatchObject({ status: 'invalidated', disposition: 'not-executed' });
    expect(ambiguous.sandboxReceipt.capability.lifecycle.candidateUnitSettled).toBeNull();
    expect(executions).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('hostile command-channel output is bounded into the raw receipt without mutating host channels', async () => {
  const resolution = hostedResolution();
  const root = mkdtempSync(path.join(tmpdir(), 'sec-hosted-output-'));
  const archive = path.join(root, 'prepared-candidate.tar');
  const commandFile = path.join(root, 'github-output');
  writeFileSync(archive, 'output-fixture');
  writeFileSync(commandFile, 'unchanged\n');
  try {
    const archiveInventory = {
      archiveDigest: bytesDigest('output-fixture'), inventoryDigest: digest('0'),
      entryCount: 4, totalFileBytes: 100,
      dependencyClosureDigest: DEPENDENCY_CLOSURE, gitBundleDigest: GIT_CLOSURE
    };
    const ticket = hostedTicket(resolution, archiveInventory);
    const raw = await executeSutFixture({
      resolution,
      ticket,
      candidateArchive: archive,
      archiveInventory,
      env: {
        GITHUB_OUTPUT: commandFile,
        GITHUB_ENV: path.join(root, 'github-env'),
        GITHUB_STEP_SUMMARY: path.join(root, 'summary'),
        GH_TOKEN: 'secret'
      },
      platform: 'linux', unitNonce: 'hostile-output', now: clock(),
      runSandboxProcess: async (plan) => {
        if (plan.phase === 'capability-self-test') {
          return sandboxObservation(0, '__SEC_HOSTED_SANDBOX_CAPABILITY_V1__');
        }
        if (plan.phase === 'teardown') {
          return sandboxObservation(0, '');
        }
        return sandboxObservation(
          125,
          '::set-output name=x::owned\n::add-mask::mask\n::stop-commands::token\n\u001b[31mcontrol\u0000',
          { truncated: true }
        );
      }
    });
    const terminal = CodexDevelopmentAssembleHostedActionTerminal({
      resolution, ticket, rawResult: raw,
      expectedRawResultDigest: raw.rawResultDigest, producer: hostedProducer
    });
    expect(terminal.result).toMatchObject({ status: 'invalidated', disposition: 'not-executed' });
    expect(raw.sandboxReceipt.execution.outputTruncated).toBe(true);
    expect(typeof raw.sandboxReceipt.execution.stdoutBytesObserved).toBe('number');
    expect(readFileSync(commandFile, 'utf8')).toBe('unchanged\n');
    const encoded = encodeVerificationActionData(raw);
    expect(encoded).not.toContain('::set-output');
    expect(encoded).not.toContain('\u001b');
    expect(encoded).not.toContain('\\u001b');
    expect(raw.sandboxReceipt.rootIsolation.candidateEnvironmentNames).not.toContain('GITHUB_OUTPUT');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('raw archive metadata rejects traversal, special files, unsafe links, duplicates and case conflicts', () => {
  const entry = (
    entryPath: string,
    type: string = 'file',
    overrides: Readonly<Record<string, unknown>> = {}
  ) => ({
    path: entryPath, type, linkTarget: null, size: type === 'file' ? 1 : 0,
    mode: type === 'directory' ? 0o755 : 0o644,
    physicalContentDigest: type === 'file' || type === 'hardlink' ? digest('9') : null,
    contentDigest: null, ...overrides
  });
  const trusted = [
    entry('package.json'),
    entry('.sec-trusted-input/candidate.bundle', 'file', { contentDigest: GIT_CLOSURE }),
    entry('.sec-trusted-input/dependency-closure.json', 'file', {
      contentDigest: DEPENDENCY_CLOSURE
    })
  ];
  expect(() => CodexDevelopmentValidateHostedActionArchiveInventory(trusted)).not.toThrow();
  expect(() => CodexDevelopmentValidateHostedActionArchiveInventory([
    ...trusted,
    entry('node_modules/example-parser/vendor/parser-core/binding.gyp'),
    entry('node_modules/example-parser/node_modules/parser-core/binding.gyp', 'symlink', {
      linkTarget: '../../vendor/parser-core/binding.gyp'
    })
  ])).not.toThrow();
  const hostile = [
    [entry('/absolute')],
    [entry('../escape')],
    [entry('device', 'character')],
    [entry('pipe', 'fifo')],
    [entry('link', 'symlink', { linkTarget: '../../host' })],
    [entry('absolute-link', 'symlink', { linkTarget: '/host/secret' })],
    [entry('missing', 'hardlink', { linkTarget: 'absent' })],
    [entry('dup'), entry('dup')],
    [entry('Case'), entry('case')],
    [entry('setuid', 'file', { mode: 0o4755 })],
    [entry('oversize', 'file', { size: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.fileSizeBytes + 1 })],
    [entry('directory-payload', 'directory', { size: 1 })]
  ];
  for (const inventory of hostile) {
    expect(() => CodexDevelopmentValidateHostedActionArchiveInventory([
      ...trusted, ...inventory
    ])).toThrow();
  }
  const forwardChain = Array.from({ length: 32 }, (_, index) => entry(`chain-${index}`, 'hardlink', {
    linkTarget: index === 31 ? 'package.json' : `chain-${index + 1}`
  }));
  expect(() => CodexDevelopmentValidateHostedActionArchiveInventory([
    ...forwardChain,
    entry('shared-tail-a', 'hardlink', { linkTarget: 'chain-15' }),
    entry('shared-tail-b', 'hardlink', { linkTarget: 'chain-15' }),
    ...trusted
  ])).not.toThrow();
  expect(() => CodexDevelopmentValidateHostedActionArchiveInventory([
    ...trusted,
    ...forwardChain.map((value) => value.path === 'chain-31'
      ? { ...value, linkTarget: 'chain-0' }
      : value)
  ])).toThrow(/link cycle/u);
  expect(() => CodexDevelopmentValidateHostedActionArchiveInventory(
    Array(250_001).fill(entry('excess-entry'))
  )).toThrow(/entry bound/u);
  expect(() => CodexDevelopmentValidateHostedActionArchiveInventory(
    Array.from({ length: 17 }, (_, index) => entry(`aggregate-${index}`, 'file', {
      size: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.fileSizeBytes
    }))
  )).toThrow(/workspace bound/u);
  expect(() => CodexDevelopmentValidateHostedActionArchiveInventory([
    ...trusted,
    entry('loop', 'directory'),
    entry('loop/child', 'directory'),
    entry('loop/child/link', 'symlink', { linkTarget: '..' })
  ])).toThrow(/targets itself or an ancestor/u);
});

test('archive decoded read and discard share one budget across finite streams and format probes', () => {
  // Future execution stays behind the formal test owner. This fixture has only
  // 16 in-memory bytes and never opens an archive, file descriptor or decompressor.
  const result = spawnSync('/usr/bin/python3', ['-I', '-B', '-c', [
    'import io, json',
    HOSTED_ACTION_ARCHIVE_DECODED_READER_SCRIPT,
      "class FiniteStream:",
      "  def __init__(self, size=16): self.data = bytes(range(size)); self.position = 0; self.reads = []; self.seeks = 0",
      "  def tell(self): return self.position",
      "  def read(self, size):",
      "    self.reads.append(size)",
      "    data = self.data[self.position:self.position + size]; self.position += len(data)",
      "    return data",
      "  def seek(self, *args):",
      "    self.seeks += 1",
      "    raise RuntimeError(\"underlying seek must never be delegated\")",
      "  def close(self): pass",
      "def rejection(operation):",
      "  try: operation()",
      "  except RuntimeError as error: return str(error)",
      "  raise AssertionError(\"bounded reader accepted a forbidden operation\")",
      "budget = HostedArchiveDecodedBudget(io.DEFAULT_BUFFER_SIZE + 16, 4, 3)",
      "stream = FiniteStream(); reader = HostedArchiveDecodedReader(stream, budget)",
      "first = list(reader.read(4))",
      "# Advancing the actual stream is charged even when the consumer reports zero logical payload.",
      "logical_member_bytes = 0",
      "position = reader.seek(12)",
      "last = list(reader.read(4))",
      "rejected = [",
      "  rejection(lambda: reader.read(1)),",
      "  rejection(lambda: reader.read(5)),",
      "  rejection(lambda: reader.read()),",
      "  rejection(lambda: reader.seek(17)),",
      "  rejection(lambda: reader.seek(0)),",
      "  rejection(lambda: reader.seek(0, 2))",
      "]",
      "shared = HostedArchiveDecodedBudget(2 * io.DEFAULT_BUFFER_SIZE + 6, 4, 3)",
      "first_probe = HostedArchiveDecodedReader(FiniteStream(), shared); first_probe.read(4)",
      "second_probe = HostedArchiveDecodedReader(FiniteStream(), shared); second_probe.read(2)",
      "probe_rejection = rejection(lambda: HostedArchiveDecodedReader(FiniteStream(), shared))",
      "partial_budget = HostedArchiveDecodedBudget(io.DEFAULT_BUFFER_SIZE + 8, 4, 3)",
      "partial_stream = FiniteStream(2); partial = HostedArchiveDecodedReader(partial_stream, partial_budget)",
      "partial_rejection = rejection(lambda: partial.seek(4))",
      "print(json.dumps({\"first\": first, \"last\": last, \"position\": position, \"finalPosition\": reader.tell(), \"remaining\": budget.remaining, \"reads\": stream.reads, \"seeks\": stream.seeks, \"rejected\": rejected, \"sharedRemaining\": shared.remaining, \"probeRejection\": probe_rejection, \"partialReads\": partial_stream.reads, \"partialRemaining\": partial_budget.remaining, \"partialRejection\": partial_rejection}, sort_keys=True))"
  ].join('\n')], {
    encoding: 'utf8', timeout: 3_000, maxBuffer: 64 * 1024,
    env: { PATH: '/usr/bin:/bin', LANG: 'C.UTF-8' }, windowsHide: true
  });
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    first: [0, 1, 2, 3], last: [12, 13, 14, 15], position: 12, finalPosition: 16, remaining: 0,
    reads: [4, 3, 3, 2, 4], seeks: 0,
    rejected: [
      'archive decoded byte bound exceeded',
      'archive decoded read allocation bound exceeded',
      'archive decoded read allocation bound exceeded',
      'archive decoded byte bound exceeded',
      'archive decoded backward seek is unsupported',
      'archive decoded seek is unsupported'
    ],
    sharedRemaining: 0, probeRejection: 'archive decoded byte bound exceeded',
    partialReads: [3, 2], partialRemaining: 3,
    partialRejection: 'archive decoded stream ended during forward seek'
  });
});

test('retained archive inventory bounds extended headers before payload and preserves compressed PAX links', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-hosted-inventory-bounds-'));
  const archive = path.join(root, 'candidate.tar');
  // Independent POSIX ustar fixture: the rejected large sizes have no payload.
  const header = (name: string, type: string, size: number, target = ''): Buffer => {
    const bytes = Buffer.alloc(512);
    bytes.write(name, 0, 100, 'utf8');
    bytes.write('0000644\0', 100, 'ascii');
    bytes.write('0000000\0', 108, 'ascii');
    bytes.write('0000000\0', 116, 'ascii');
    bytes.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'ascii');
    bytes.write('00000000000\0', 136, 'ascii');
    bytes.fill(0x20, 148, 156);
    bytes.write(type, 156, 'ascii');
    bytes.write(target, 157, 100, 'utf8');
    bytes.write('ustar\0', 257, 'ascii');
    bytes.write('00', 263, 'ascii');
    const checksum = bytes.reduce((sum, value) => sum + value, 0);
    bytes.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 'ascii');
    return bytes;
  };
  const payload = (bytes: Buffer): Buffer => Buffer.concat([
    bytes, Buffer.alloc((512 - bytes.length % 512) % 512)
  ]);
  try {
    for (const [type, size, diagnostic] of [
      ['0', CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits.fileSizeBytes + 1, /member byte bound/u],
      ['x', 128 * 1024 * 1024 + 1, /metadata byte bound/u],
      ['S', 0, /forbidden or unsupported/u],
      ['3', 0, /forbidden or unsupported/u]
    ] as const) {
      writeFileSync(archive, header('hostile', type, size));
      expect(() => CodexDevelopmentInspectHostedActionArchiveInventory(archive)).toThrow(diagnostic);
    }
    const longPath = `pkg/${'long-'.repeat(25)}source.txt`;
    const paxRecord = (field: string): Buffer => {
      const body = `${field}=${longPath}\n`;
      let length = Buffer.byteLength(body) + 3;
      while (length !== Buffer.byteLength(`${length} ${body}`)) {
        length = Buffer.byteLength(`${length} ${body}`);
      }
      return Buffer.from(`${length} ${body}`);
    };
    const pax = paxRecord('path');
    const linkPax = paxRecord('linkpath');
    const content = Buffer.from('authenticated archive content');
    const bytes = Buffer.concat([
      header('extended', 'x', pax.length), payload(pax),
      header('short', '0', content.length), payload(content),
      header('hardlink', '1', 0, 'forward'),
      header('extended-link', 'x', linkPax.length), payload(linkPax),
      header('forward', '1', 0, 'short'),
      header('symlink', '2', 0, 'forward'),
      Buffer.alloc(1024)
    ]);
    for (const encoded of [bytes, gzipSync(bytes)]) {
      writeFileSync(archive, encoded);
      const inventory = CodexDevelopmentInspectHostedActionArchiveInventory(archive);
      expect(inventory.totalFileBytes).toBe(content.length);
      const ordinary = inventory.entries.find((entry) => entry.path === longPath);
      expect(ordinary?.physicalContentDigest).toBe(bytesDigest(
        Buffer.from(JSON.stringify({ bytes: content.toString('hex') }))
      ));
      expect(inventory.entries.find((entry) => entry.path === 'hardlink')?.physicalContentDigest)
        .toBe(ordinary?.physicalContentDigest);
      expect(inventory.entries.find((entry) => entry.path === 'symlink')?.linkTarget).toBe('forward');
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('trusted dependency archive projection binds one stable physical generation', () => {
  const fileDigest = digest('6');
  const otherDigest = digest('7');
  const rootIdentity = Object.freeze({
    path: '/work/node_modules',
    finalPath: '/work/node_modules',
    device: '1', inode: '2', objectId: '1:2'
  });
  const entries = Object.freeze([
    Object.freeze({
      relativePath: 'pkg', kind: 'directory' as const, device: '1', inode: '3',
      size: 4096, contentDigest: null, linkTarget: null
    }),
    Object.freeze({
      relativePath: 'pkg/link.txt', kind: 'link' as const, device: '1', inode: '4',
      size: 40, contentDigest: null, linkTarget: '/work/node_modules/pkg/target.txt'
    }),
    Object.freeze({
      relativePath: 'pkg/other.txt', kind: 'file' as const, device: '1', inode: '5',
      size: 5, contentDigest: otherDigest, linkTarget: null
    }),
    Object.freeze({
      relativePath: 'pkg/target.txt', kind: 'file' as const, device: '1', inode: '6',
      size: 3, contentDigest: fileDigest, linkTarget: null
    })
  ]);
  const before = Object.freeze({
    schema: 'sec-hosted-dependency-physical-snapshot-v1' as const,
    root: rootIdentity,
    entries
  });
  const archiveEntry = (
    entryPath: string,
    type: 'directory' | 'file' | 'symlink',
    overrides: Readonly<Record<string, unknown>> = {}
  ) => ({
    path: entryPath,
    type,
    linkTarget: null,
    size: type === 'file' ? 1 : 0,
    mode: type === 'directory' ? 0o755 : 0o644,
    physicalContentDigest: type === 'file' ? digest('9') : null,
    contentDigest: null,
    ...overrides
  });
  const archiveEntries = CodexDevelopmentValidateHostedActionArchiveInventory([
    archiveEntry('node_modules', 'directory'),
    archiveEntry('node_modules/pkg', 'directory'),
    archiveEntry('node_modules/pkg/link.txt', 'symlink', { linkTarget: 'target.txt' }),
    archiveEntry('node_modules/pkg/other.txt', 'file', {
      size: 5, physicalContentDigest: otherDigest
    }),
    archiveEntry('node_modules/pkg/target.txt', 'file', {
      size: 3, physicalContentDigest: fileDigest
    })
  ]).entries;
  expect(CodexDevelopmentAssertHostedDependencyArchiveProjection({
    before, after: before, archiveEntries
  })).toMatchObject({
    schema: 'sec-hosted-dependency-archive-projection-v1',
    entriesObserved: 4,
    linksProjected: 1
  });

  const changedAfter = (relativePath: string, changes: Readonly<Record<string, unknown>>) =>
    Object.freeze({
      ...before,
      entries: Object.freeze(before.entries.map((entry) => entry.relativePath === relativePath
        ? Object.freeze({ ...entry, ...changes }) : entry))
    });
  for (const after of [
    Object.freeze({ ...before, root: Object.freeze({ ...before.root, inode: '99' }) }),
    changedAfter('pkg', { inode: '99' }),
    changedAfter('pkg/link.txt', { inode: '99' }),
    changedAfter('pkg/target.txt', { inode: '99' }),
    changedAfter('pkg/target.txt', { contentDigest: digest('5') })
  ]) {
    expect(() => CodexDevelopmentAssertHostedDependencyArchiveProjection({
      before, after, archiveEntries
    })).toThrow(/physical generation changed/u);
  }
  expect(() => CodexDevelopmentAssertHostedDependencyArchiveProjection({
    before,
    after: before,
    archiveEntries: archiveEntries.map((entry) => entry.path === 'node_modules/pkg/target.txt'
      ? Object.freeze({ ...entry, physicalContentDigest: digest('5') }) : entry)
  })).toThrow(/file differs/u);
  expect(() => CodexDevelopmentAssertHostedDependencyArchiveProjection({
    before,
    after: before,
    archiveEntries: archiveEntries.map((entry) => entry.path === 'node_modules/pkg/link.txt'
      ? Object.freeze({ ...entry, linkTarget: 'node_modules/pkg/other.txt' }) : entry)
  })).toThrow(/link differs/u);
  expect(() => CodexDevelopmentAssertHostedDependencyArchiveProjection({
    before,
    after: before,
    archiveEntries: archiveEntries.slice(0, -1)
  })).toThrow(/missing, duplicate, or foreign/u);
  expect(() => CodexDevelopmentAssertHostedDependencyArchiveProjection({
    before: changedAfter('pkg/link.txt', { linkTarget: '/host/secret' }),
    after: changedAfter('pkg/link.txt', { linkTarget: '/host/secret' }),
    archiveEntries
  })).toThrow(/escapes/u);
  expect(() => CodexDevelopmentAssertHostedDependencyArchiveProjection({
    before: changedAfter('pkg/link.txt', { linkTarget: '/work/node_modules/pkg' }),
    after: changedAfter('pkg/link.txt', { linkTarget: '/work/node_modules/pkg' }),
    archiveEntries
  })).toThrow(/ancestor/u);
});

test('linux retained bootstrap archive relocates dependency links without mutating source', () => {
  if (process.platform !== 'linux') return;
  const root = mkdtempSync(path.join(tmpdir(), 'sec-hosted-dependency-archive-'));
  const candidateRoot = path.join(root, 'candidate');
  const dependencyRoot = path.join(root, 'node_modules');
  const outputDirectory = path.join(root, 'output');
  const extractedRoot = path.join(root, 'extracted');
  const retainedSource = path.join(root, 'node_modules-source-moved');
  const target = path.join(dependencyRoot, 'pkg', 'target.txt');
  const link = path.join(dependencyRoot, 'pkg', 'link.txt');
  const collision = path.join(dependencyRoot, 'pkg', '.sec-relocatable-link-collision.tmp');
  try {
    mkdirSync(candidateRoot, { recursive: true });
    mkdirSync(path.dirname(target), { recursive: true });
    mkdirSync(outputDirectory, { recursive: true });
    mkdirSync(extractedRoot, { recursive: true });
    writeFileSync(path.join(candidateRoot, 'package.json'), '{}\n');
    writeFileSync(target, 'trusted-target\n');
    writeFileSync(collision, 'foreign-name-preserved\n');
    symlinkSync(target, link);
    const before = CodexDevelopmentCaptureHostedDependencyPhysicalSnapshot(dependencyRoot);
    const archive = CodexDevelopmentMaterializeTrustedBootstrapArchive({
      candidateRoot,
      dependencySnapshot: before,
      outputDirectory
    });
    const inventory = CodexDevelopmentInspectHostedActionArchiveInventory(archive);
    const after = CodexDevelopmentCaptureHostedDependencyPhysicalSnapshot(dependencyRoot);
    expect(CodexDevelopmentAssertHostedDependencyArchiveProjection({
      before, after, archiveEntries: inventory.entries
    }).linksProjected).toBe(1);
    expect(readlinkSync(link, 'utf8')).toBe(target);
    expect(readFileSync(collision, 'utf8')).toBe('foreign-name-preserved\n');

    renameSync(dependencyRoot, retainedSource);
    const extracted = spawnSync('/usr/bin/tar', ['-xf', archive, '-C', extractedRoot], {
      encoding: 'utf8', windowsHide: true, timeout: 30_000
    });
    expect(extracted.status).toBe(0);
    const extractedLink = path.join(extractedRoot, 'node_modules', 'pkg', 'link.txt');
    const extractedTarget = path.join(extractedRoot, 'node_modules', 'pkg', 'target.txt');
    expect(readlinkSync(extractedLink, 'utf8')).toBe('target.txt');
    expect(realpathSync.native(extractedLink)).toBe(realpathSync.native(extractedTarget));
    expect(readFileSync(extractedLink, 'utf8')).toBe('trusted-target\n');
    expect(readFileSync(path.join(
      extractedRoot, 'node_modules', 'pkg', '.sec-relocatable-link-collision.tmp'
    ), 'utf8')).toBe('foreign-name-preserved\n');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('pre-start archive inspection authenticates raw bytes and exact dependency and Git closure without extraction', () => {
  const resolution = hostedResolution();
  const root = mkdtempSync(path.join(tmpdir(), 'sec-hosted-prestart-'));
  const archive = path.join(root, 'prepared-candidate.tar');
  writeFileSync(archive, 'authenticated raw archive');
  const dependencyClosureDigest = DEPENDENCY_CLOSURE;
  const gitBundleDigest = GIT_CLOSURE;
  const required = new Set([
    ...resolution.actionPlan.action.inputClosure.map((entry) => entry.path),
    resolution.artifactInput.manifestPath
  ]);
  const inventory = [
    ...[...required].map((entryPath) => ({
      path: entryPath, type: 'file', linkTarget: null, size: 1, mode: 0o644,
      physicalContentDigest: digest('9'), contentDigest: null
    })),
    {
      path: '.sec-trusted-input/candidate.bundle', type: 'file', linkTarget: null,
      size: 1, mode: 0o600, physicalContentDigest: digest('9'), contentDigest: gitBundleDigest
    },
    {
      path: '.sec-trusted-input/dependency-closure.json', type: 'file', linkTarget: null,
      size: 1, mode: 0o600, physicalContentDigest: digest('8'),
      contentDigest: dependencyClosureDigest
    }
  ];
  try {
    const inspected = CodexDevelopmentInspectHostedActionArchive({
      resolution,
      preparedCandidateArchive: archive,
      baseDependencyClosureDigest: dependencyClosureDigest,
      authenticatedGitClosureDigest: gitBundleDigest,
      inspectArchive: () => inventory
    });
    expect(inspected).toMatchObject({
      archiveDigest: bytesDigest('authenticated raw archive'),
      dependencyClosureDigest,
      gitBundleDigest
    });
    expect(() => CodexDevelopmentInspectHostedActionArchive({
      resolution,
      preparedCandidateArchive: archive,
      baseDependencyClosureDigest: digest('7'),
      authenticatedGitClosureDigest: gitBundleDigest,
      inspectArchive: () => inventory
    })).toThrow(/differs from trusted pre-start inputs/u);
    expect(() => CodexDevelopmentInspectHostedActionArchive({
      resolution,
      preparedCandidateArchive: archive,
      baseDependencyClosureDigest: dependencyClosureDigest,
      authenticatedGitClosureDigest: gitBundleDigest,
      inspectArchive: () => {
        writeFileSync(archive, 'mutated raw archive bytes');
        return inventory;
      }
    })).toThrow(/changed after authentication/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('dependency authority is exact-base only and materializer environment cannot inherit registry exfiltration', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-hosted-dependency-'));
  const base = path.join(root, 'base');
  const candidate = path.join(root, 'candidate');
  mkdirSync(base, { recursive: true });
  mkdirSync(candidate, { recursive: true });
  try {
    for (const file of ['.bun-version', 'bun.lock', 'bunfig.toml', 'package.json']) {
      writeFileSync(path.join(base, file), `${file}:trusted\n`);
      writeFileSync(path.join(candidate, file), `${file}:trusted\n`);
    }
    expect(CodexDevelopmentAssertHostedActionDependencyInputsV1({
      baseRoot: base, candidateRoot: candidate, baseSha: BASE
    })).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(CodexDevelopmentHostedDependencyMaterializerEnvironment()).toEqual({
      PATH: '/usr/bin:/bin', HOME: '/tmp/sec-hosted-dependency-home',
      TMPDIR: '/tmp/sec-hosted-dependency-tmp', LANG: 'C.UTF-8',
      BUN_INSTALL_CACHE_DIR: '/tmp/sec-hosted-dependency-home/.bun/install/cache',
      CI: '1'
    });
    writeFileSync(path.join(candidate, '.npmrc'), '//registry.example/:_authToken=stolen\n');
    expect(() => CodexDevelopmentAssertHostedActionDependencyInputsV1({
      baseRoot: base, candidateRoot: candidate, baseSha: BASE
    })).toThrow(/\.npmrc/u);
    rmSync(path.join(candidate, '.npmrc'));
    writeFileSync(path.join(candidate, 'bun.lock'), 'drift\n');
    expect(() => CodexDevelopmentAssertHostedActionDependencyInputsV1({
      baseRoot: base, candidateRoot: candidate, baseSha: BASE
    })).toThrow(/drifted/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('trusted bootstrap dependency materialization retries only one exact Bun extraction failure', () => {
  const retryable = new Error(
    'Trusted bootstrap exact-base dependency materialization failed: ' +
    'error: Fail extracting tarball for "onnxruntime-node"\n' +
    'error: Fail extracting tarball from onnxruntime-node'
  );
  let recoveredAttempts = 0;
  expect(CodexDevelopmentRunBoundedDependencyMaterialization(() => {
    recoveredAttempts += 1;
    if (recoveredAttempts === 1) throw retryable;
  })).toEqual({ attempts: 2, recoveredFrom: 'bun-tarball-extraction' });
  expect(recoveredAttempts).toBe(2);

  const terminal = new Error('error: lockfile had changes, but lockfile is frozen');
  let terminalAttempts = 0;
  expect(() => CodexDevelopmentRunBoundedDependencyMaterialization(() => {
    terminalAttempts += 1;
    throw terminal;
  })).toThrow(terminal);
  expect(terminalAttempts).toBe(1);

  let repeatedExtractionAttempts = 0;
  expect(() => CodexDevelopmentRunBoundedDependencyMaterialization(() => {
    repeatedExtractionAttempts += 1;
    throw retryable;
  })).toThrow(/after one bounded Bun tarball-extraction recovery retry/u);
  expect(repeatedExtractionAttempts).toBe(2);
});

test('canonical terminal artifact derives four physical Result states while raw not-run is impossible', () => {
  const resolution = hostedResolution();
  const ticket = hostedTicket(resolution);
  let passedArtifact: ReturnType<typeof CodexDevelopmentAssembleHostedActionTerminal> | null = null;
  for (const status of ['passed', 'failed', 'unsupported', 'invalidated'] as const) {
    const rawResult = hostedRawResult(resolution, status);
    const artifact = CodexDevelopmentAssembleHostedActionTerminal({
      resolution,
      ticket,
      rawResult,
      expectedRawResultDigest: rawResult.rawResultDigest,
      producer: hostedProducer
    });
    expect(artifact.result.status).toBe(status);
    if (status === 'passed') passedArtifact = artifact;
    expect(artifact.producer).toEqual(hostedProducer);
    expect(() => CodexDevelopmentAssertVerificationActionTerminalArtifact(artifact, {
      actionPlan: resolution.actionPlan,
      executionEnvironmentRevision:
        CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT.executionEnvironmentRevision
    })).not.toThrow();
  }
  expect(passedArtifact).not.toBeNull();
  const contradictory = structuredClone(passedArtifact!);
  (contradictory.result.execution as { outputDigest: VerificationActionKeyDigest }).outputDigest = digest('f');
  const { artifactDigest: ignoredArtifactDigest, ...withoutArtifactDigest } = contradictory;
  void ignoredArtifactDigest;
  (contradictory as { artifactDigest: VerificationActionKeyDigest }).artifactDigest =
    CodexDevelopmentVerificationDigest(withoutArtifactDigest) as VerificationActionKeyDigest;
  expect(() => CodexDevelopmentAssertVerificationActionTerminalArtifact(contradictory, {
    actionPlan: resolution.actionPlan
  })).toThrow(/execution proof does not replay/u);
});

test('hosted coordinator and composer preserve four physical terminals while coordinator owns not-run', () => {
  const closure = hostedDagClosure([[]]);
  const envelope = hostedEnvelopeFixture(closure);
  for (const status of ['passed', 'failed', 'unsupported', 'invalidated'] as const) {
    const provider = hostedProviderInputs(envelope, new Map([[0, { status }]]));
    const coordination = CodexDevelopmentCoordinateHostedActions({ envelope, ...provider });
    expect(coordination).toMatchObject({
      disposition: 'complete',
      dispatchActionKeys: [],
      missingActionKeys: []
    });
    const composed = CodexDevelopmentComposeHostedEvidence({
      envelope,
      ...provider,
      producer: hostedEvidenceProducer,
      now: () => new Date('2026-08-09T00:00:02.000Z')
    });
    expect(composed.evidence?.status).toBe(status === 'invalidated' ? 'failed' : status);
    expect(composed.evidence?.gates[0]?.result.status).toBe(status);
    expect(composed.evidence?.gates[0]?.result.evidenceRefs).toContain(
      `verification-action-artifact:${provider.observations[0]!.artifact!.artifactDigest}`
    );
    expect(composed.evidence?.gates[0]?.cleanup.status).toBe(
      status === 'unsupported' ? 'not-required' : status === 'invalidated' ? 'failed' : 'passed'
    );
    expect(() => CodexDevelopmentAssertVerificationEvidenceV4(composed.evidence, {
      actionPlan: closure
    })).not.toThrow();
    const terminalStatus = provider.providerStatusReadbacks[0]!.statuses[1]!;
    expect(terminalStatus.state).toBe('success');
    expect(terminalStatus.description).toBe(
      `v2 terminal ${provider.terminalAnchorObservations[0]!.payload!.anchorDigest}`
    );
    expect(terminalStatus.description).not.toContain(status);
  }

  const cleanupFailedProvider = hostedProviderInputs(envelope, new Map([[
    0,
    { status: 'invalidated' as const }
  ]]));
  const cleanupFailed = CodexDevelopmentComposeHostedEvidence({
    envelope,
    ...cleanupFailedProvider,
    producer: hostedEvidenceProducer,
    now: () => new Date('2026-08-09T00:00:02.000Z')
  });
  expect(cleanupFailed.evidence).toMatchObject({
    status: 'failed',
    gates: [{ result: { status: 'invalidated' }, cleanup: { status: 'failed' } }]
  });
  expect(() => CodexDevelopmentAssertVerificationEvidenceV4(cleanupFailed.evidence, {
    actionPlan: closure
  })).not.toThrow();
});

test('hosted DAG fail-fast is dependency-derived and preserves independent branches', () => {
  const closure = hostedDagClosure([[], [0], [], [1]]);
  const envelope = hostedEnvelopeFixture(closure);
  for (const nonPassingStatus of ['unsupported', 'invalidated'] as const) {
    const partial = hostedProviderInputs(envelope, new Map([[
      0,
      { status: nonPassingStatus }
    ]]));
    const coordination = CodexDevelopmentCoordinateHostedActions({ envelope, ...partial });
    expect(coordination.disposition).toBe('dispatch');
    expect(coordination.dispatchActionKeys).toEqual([
      closure.actions[2]!.action.actionKey
    ]);
    expect(coordination.dispatchActionKeys).not.toContain(closure.actions[1]!.action.actionKey);
    expect(coordination.dispatchActionKeys).not.toContain(closure.actions[3]!.action.actionKey);

    const completedProvider = hostedProviderInputs(envelope, new Map([
      [0, { status: nonPassingStatus }],
      [2, { status: 'passed' as const }]
    ]));
    const completed = CodexDevelopmentComposeHostedEvidence({
      envelope,
      ...completedProvider,
      producer: hostedEvidenceProducer,
      now: () => new Date('2026-08-09T00:00:02.000Z')
    });
    expect(completed.coordination.disposition).toBe('complete');
    expect(completed.evidence?.status).toBe(
      nonPassingStatus === 'invalidated' ? 'failed' : nonPassingStatus
    );
    expect(completed.evidence?.gates.map((gate) => gate.result.status)).toEqual([
      nonPassingStatus,
      'not-run',
      'passed',
      'not-run'
    ]);
    expect(completed.evidence?.gates[1]?.result.reasonCode).toBe('fail-fast-prerequisite-failed');
    expect(completed.evidence?.gates[3]?.result.reasonCode).toBe('fail-fast-prerequisite-failed');
    expect(completed.evidence?.gates[2]?.result.evidenceRefs).toContain(
      `verification-action-artifact:${completedProvider.observations[1]!.artifact!.artifactDigest}`
    );
  }
});

test('hosted DAG dispatches only members whose direct dependencies are passed', () => {
  const closure = hostedDagClosure([[], [0]]);
  const envelope = hostedEnvelopeFixture(closure);
  const passedDependency = hostedProviderInputs(envelope, new Map([[
    0,
    { status: 'passed' as const }
  ]]));
  expect(CodexDevelopmentCoordinateHostedActions({
    envelope,
    ...passedDependency
  })).toMatchObject({
    disposition: 'dispatch',
    dispatchActionKeys: [closure.actions[1]!.action.actionKey]
  });

  const pendingDependency = hostedProviderInputs(envelope, new Map());
  const pending = CodexDevelopmentCoordinateHostedActions({
    envelope,
    ...pendingDependency
  });
  expect(pending.disposition).toBe('dispatch');
  expect(pending.dispatchActionKeys).toEqual([closure.actions[0]!.action.actionKey]);
  expect(pending.dispatchActionKeys).not.toContain(closure.actions[1]!.action.actionKey);
});

test('expired hosted terminal artifact blocks without replay or Evidence', () => {
  const closure = hostedDagClosure([[]]);
  const envelope = hostedEnvelopeFixture(closure);
  const expired = hostedProviderInputs(envelope, new Map([[
    0,
    { status: 'passed' as const, expired: true }
  ]]));
  const coordination = CodexDevelopmentCoordinateHostedActions({ envelope, ...expired });
  expect(coordination.disposition).toBe('blocked');
  expect(coordination.dispatchActionKeys).toEqual([]);
  expect(coordination.reason).toContain('retained out');
  expect(CodexDevelopmentComposeHostedEvidence({
    envelope,
    ...expired,
    producer: hostedEvidenceProducer
  }).evidence).toBeNull();
});

test('hosted composition rejects an authenticated dependent PASS when its prerequisite is omitted', () => {
  const completeClosure = hostedDagClosure([[], [0]]);
  const completeEnvelope = hostedEnvelopeFixture(completeClosure);
  const completeProvider = hostedProviderInputs(completeEnvelope, new Map([[
    1,
    { status: 'passed' as const }
  ]]));
  expect(completeProvider.observations[0]!.artifact?.result.status).toBe('passed');
  const dependent = completeClosure.actions[1]!;
  const withoutDigest = Object.freeze({
    schema: completeClosure.schema,
    producerRevision: completeClosure.producerRevision,
    actions: Object.freeze([dependent]),
    normalizedOperations: Object.freeze([completeClosure.normalizedOperations[1]!])
  });
  const omittedPrerequisiteClosure = Object.freeze({
    ...withoutDigest,
    actionPlanDigest: CodexDevelopmentVerificationDigest(withoutDigest) as VerificationActionKeyDigest
  });
  const omittedPrerequisiteEnvelope = hostedEnvelopeFixture(omittedPrerequisiteClosure);
  const provider = Object.freeze({
    observations: completeProvider.observations,
    startObservations: completeProvider.startObservations,
    terminalAnchorObservations: completeProvider.terminalAnchorObservations,
    providerStatusReadbacks: Object.freeze(completeProvider.providerStatusReadbacks.filter(
      (readback) => readback.actionKey === dependent.action.actionKey
    ))
  });
  expect(() => CodexDevelopmentCoordinateHostedActions({
    envelope: omittedPrerequisiteEnvelope,
    ...provider
  })).toThrow('does not resolve to exactly one Action member');
  expect(() => CodexDevelopmentComposeHostedEvidence({
    envelope: omittedPrerequisiteEnvelope,
    ...provider,
    producer: hostedEvidenceProducer
  })).toThrow('does not resolve to exactly one Action member');
});

test('one immutable Action terminal is reusable across different Session closures without plan-digest authority', () => {
  const gates = hostedGates();
  expect(gates.length).toBeGreaterThanOrEqual(3);
  const left = hostedResolution([gates[0]!, gates[1]!]);
  const right = hostedResolution([gates[0]!, gates[2]!]);
  expect(left.actionPlanClosure.actionPlanDigest).not.toBe(right.actionPlanClosure.actionPlanDigest);
  expect(left.actionPlan.action.actionKey).toBe(right.actionPlan.action.actionKey);

  const rawResult = hostedRawResult(left, 'passed');
  const artifact = CodexDevelopmentAssembleHostedActionTerminal({
    resolution: left,
    ticket: hostedTicket(left),
    rawResult,
    expectedRawResultDigest: rawResult.rawResultDigest,
    producer: hostedProducer
  });
  expect(() => CodexDevelopmentAssertVerificationActionTerminalArtifact(artifact, {
    actionPlan: right.actionPlan,
    executionEnvironmentRevision:
      CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT.executionEnvironmentRevision
  })).not.toThrow();
  expect(encodeVerificationActionData(artifact)).not.toContain(left.actionPlanClosure.actionPlanDigest);
  expect(encodeVerificationActionData(artifact)).not.toContain(right.actionPlanClosure.actionPlanDigest);
});

test('credential sanitizer never treats provider environment identity as a writable token', () => {
  expect(() => hostedCandidateProcessEnvironment({})).toThrow(/explicitly supplied execution environment revision/u);
  expect(hostedCandidateProcessEnvironment({
    SEC_EXECUTION_ENVIRONMENT_REVISION: CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT.executionEnvironmentRevision,
    GITHUB_TOKEN: 'secret',
    actions_runtime_token: 'secret',
    GITHUB_OUTPUT: 'secret',
    USER_INPUT: 'discarded',
    SEC_CHANGED_BASE: BASE
  })).toEqual({
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    HOME: '/home/sut',
    LANG: 'C',
    PATH: '/tool/bin:/usr/bin:/bin',
    SEC_CHANGED_BASE: BASE,
    SEC_EXECUTION_ENVIRONMENT_REVISION:
      CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT.executionEnvironmentRevision,
    SEC_FORMAL_HOSTED_MODE: '1',
    TMPDIR: '/tmp'
  });
});

test('CI V3 reader binds exact raw plan bytes and preserves observed base checks before execution', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-ci-v3-reader-'));
  try {
    const options = baseOptions(root);
    const legacy = new TextDecoder().decode(options.readExactGitBlob().bytes);
    const v3 = legacy.replace('codex-development-work-package-v1', 'codex-development-work-package-v3')
      .replace(`base: "${BASE}"\n`, '');
    const blob = (source: string) => ({ ...options.readExactGitBlob(), bytes: Buffer.from(source),
      blobSha: createHash('sha1').update(source).digest('hex') });
    let starts = 0;
    let evidence: VerificationEvidence<typeof CI_VERIFICATION_CONTRACT_REVISION, VerificationResultStatus, VerificationGateResult> | null = null;
    const runGate: typeof options.runGate = async (gate, execution) => {
      starts += 1;
      return executeSentinelGate(root, 0)(gate, execution);
    };
    for (const source of [legacy.replace(BASE, '9'.repeat(40)), v3.replace('manifestState:', `base: "${BASE}"\nmanifestState:`)]) {
      expect(await CodexDevelopmentCiVerificationMainForTests({ ...options, runGate,
        readExactGitBlob: () => blob(source), readGitBlob: () => blob(source), writeEvidence: () => undefined })).toBe(1);
      expect(starts).toBe(0);
    }
    expect(await CodexDevelopmentCiVerificationMainForTests({ ...options, runGate,
      env: { ...options.env, SEC_AFFECTED_TESTS_BASE: '9'.repeat(40) },
      gitRevision: ref => ref === '9'.repeat(40) ? ref
        : ref === `${'9'.repeat(40)}^{tree}` ? '8'.repeat(40) : revisions(ref),
      readExactGitBlob: () => blob(v3), readGitBlob: () => blob(v3), writeEvidence: () => undefined })).toBe(1);
    expect(starts).toBe(0);
    expect(await CodexDevelopmentCiVerificationMainForTests({ ...options, runGate,
      readExactGitBlob: () => blob(v3), readGitBlob: () => blob(v3),
      writeEvidence: (_file, value) => { evidence = value; } })).toBe(0);
    expect(starts).toBeGreaterThan(0);
    expect(evidence).not.toBeNull();
    expect(JSON.stringify(evidence)).toContain(bytesDigest(v3));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});


test('candidate readonly preparation follows the original normalized Action and preserves workspace writers', () => {
  // Expected access is independently stated for actual admitted operations.
  // The canonical Action owner also enforces each target's execution topology.
  for (const [id, phase, argv, expected] of [
    ['direct-test', 'workspace', ['bun', 'test', 'tests/unit/ci-verification-execution.test.ts'], 'read-only'],
    ['fast', 'quick', ['bun', 'run', 'test', '--', '--scope', 'fast'], 'read-only'],
    ['affected', 'quick', ['bun', 'run', 'test', '--', '--affected'], 'read-only'],
    ['check-plan', 'quick', ['bun', 'run', 'check', '--', '--affected', '--plan'], 'read-only'],
    ['resolve', 'workspace', ['bun', 'run', 'sec', '--', 'resolve'], 'writable'],
    ['lock', 'workspace', ['bun', 'run', 'sec', '--', 'lock'], 'writable'],
    ['warmup', 'full', ['bun', 'run', 'sec', '--', 'deps', 'warmup'], 'writable']
  ] as const) {
    const gate = { id, phase, argv, runtime: 'bun' as const, environment: {}, coveredScopeIds: [] };
    const resolution = phase === 'quick' ? hostedResolution([gate])
      : hostedMemberResolution(buildCiVerificationActionPlanClosure({ candidate: hostedCandidate(),
        gates: [{ ...hostedGates()[0]!, id: `preflight-${id}` }, gate] }), 1);
    const operation = resolution.actionPlanClosure.normalizedOperations.find(value =>
      value.semanticDigest === resolution.actionPlan.action.operation.semanticDigest)!;
    const ticket = hostedTicket(resolution);
    const authorization = CodexDevelopmentCreateHostedSutExecutionAuthorization({
      resolutionDigest: resolution.resolutionDigest, ticketDigest: ticket.ticketDigest,
      actionPlan: resolution.actionPlan, normalizedOperation: operation,
      candidateSha: resolution.artifactInput.headSha,
      candidateBytesDigest: resolution.artifactInput.candidateBytesDigest as VerificationActionKeyDigest,
      manifestPath: resolution.artifactInput.manifestPath,
      inventoryClosure: { archiveDigest: ticket.preparedCandidateArchiveDigest,
        inventoryDigest: ticket.preparedCandidateInventoryDigest, entryCount: ticket.preparedCandidateEntryCount,
        totalFileBytes: ticket.preparedCandidateTotalFileBytes, dependencyClosureDigest: ticket.baseDependencyClosureDigest,
        gitBundleDigest: ticket.authenticatedGitClosureDigest }, producer: hostedProducer });
    const preparation = createHostedSutCandidatePreparation({ operation, authorization, deadlineAtUnixMs: 1_900_000_000_000 });
    expect(preparation.inputAccess).toBe(expected);
    expect(preparation).toMatchObject({ baseSha: BASE, baseTreeSha: BASE_TREE, headSha: HEAD, headTreeSha: TREE,
      actionKey: resolution.actionPlan.action.actionKey, archiveDigest: ticket.preparedCandidateArchiveDigest });
    const input = { actionKey: authorization.actionKey, candidateArchiveDigest: ticket.preparedCandidateArchiveDigest,
      bunExecutable: '/trusted/bin/bun', baseSha: BASE, headSha: HEAD, normalizedArgv: authorization.normalizedArgv,
      candidateEnvironment: CodexDevelopmentHostedSutCandidateEnvironment({ normalizedOperation: operation, manifestPath: MANIFEST_PATH }),
      executionAuthorization: authorization, candidatePreparation: preparation };
    const plan = buildHostedSutSandboxCommandPlan(input);
    expect(hostedSutCandidatePreparationFromPlan(plan)).toEqual(preparation);
    expect(hostedSutCandidateArgv(plan)).toEqual(['/tool/bin/bun', ...argv.slice(1)]);
    expect(hostedSutCandidateGuardArgv(plan) === null).toBe(expected === 'writable');
    for (const patch of [{ actionKey: digest('f') }, { authorizationDigest: digest('f') },
      { archiveDigest: digest('f') }, { inventoryDigest: digest('f') }, { baseSha: HEAD },
      { inputAccess: expected === 'read-only' ? 'writable' as const : 'read-only' as const }]) {
      expect(() => buildHostedSutSandboxCommandPlan({ ...input, candidatePreparation: { ...preparation, ...patch } })).toThrow();
    }
    expect(() => createHostedSutCandidatePreparation({ operation, authorization: { ...authorization,
      operationSemanticDigest: digest('f') }, deadlineAtUnixMs: preparation.deadlineAtUnixMs })).toThrow();
  }
});

function privateActionArchiveFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-private-action-archive-'));
  const baseRoot = path.join(root, 'base');
  const candidateRoot = path.join(root, 'candidate');
  const outputDirectory = path.join(root, 'output');
  try {
    mkdirSync(baseRoot);
    const sources: Record<string, string> = {
      '.gitignore': 'node_modules/\n', '.bun-version': '1.3.14\n',
      'bun.lock': '{}\n', 'bunfig.toml': '', 'package.json': '{}\n',
      'input.txt': 'base input\n', [MANIFEST_PATH]: '# Private archive fixture\n'
    };
    for (const [name, bytes] of Object.entries(sources)) {
      mkdirSync(path.dirname(path.join(baseRoot, name)), { recursive: true });
      writeFileSync(path.join(baseRoot, name), bytes);
    }
    gitFixture(baseRoot, ['init', '--quiet']);
    gitFixture(baseRoot, ['config', 'user.name', 'SEC Fixture']);
    gitFixture(baseRoot, ['config', 'user.email', 'sec-fixture@example.invalid']);
    gitFixture(baseRoot, ['add', '.']); gitFixture(baseRoot, ['commit', '--quiet', '-m', 'base']);
    const baseSha = gitFixture(baseRoot, ['rev-parse', 'HEAD']);
    const baseTreeSha = gitFixture(baseRoot, ['rev-parse', 'HEAD^{tree}']);
    gitFixture(baseRoot, ['worktree', 'add', '--quiet', '--detach', candidateRoot, baseSha]);
    sources['input.txt'] = 'candidate input\n';
    writeFileSync(path.join(candidateRoot, 'input.txt'), sources['input.txt']);
    // The fixed Python recipes must not import candidate module names.
    writeFileSync(path.join(candidateRoot, 'tarfile.py'), "raise RuntimeError('candidate module must remain data')\n");
    gitFixture(candidateRoot, ['add', '.']); gitFixture(candidateRoot, ['commit', '--quiet', '-m', 'candidate']);
    const headSha = gitFixture(candidateRoot, ['rev-parse', 'HEAD']);
    const headTreeSha = gitFixture(candidateRoot, ['rev-parse', 'HEAD^{tree}']);
    mkdirSync(path.join(baseRoot, 'node_modules', 'fixture'), { recursive: true });
    writeFileSync(path.join(baseRoot, 'node_modules', 'fixture', 'value.txt'), 'exact trusted dependency\n');
    const candidate: CiVerificationActionCandidate = { ...hostedCandidate(), baseSha, baseTreeSha, headSha, headTreeSha,
      manifestDigest: CodexDevelopmentWorkPackageManifestDigest(sources[MANIFEST_PATH]!) as VerificationActionKeyDigest,
      requiredBlobs: hostedCandidate().requiredBlobs.map(entry => ({
        path: entry.path, digest: bytesDigest(sources[entry.path]!)
      })) };
    const actionPlanClosure = buildCiVerificationActionPlanClosure({ candidate, gates: [hostedGates()[0]!] });
    const actionPlan = actionPlanClosure.actions[0]!;
    const artifactInput = Object.freeze({ baseSha, baseTreeSha, headSha, headTreeSha,
      manifestPath: candidate.manifestPath, manifestDigest: candidate.manifestDigest,
      inputClosureDigest: CodexDevelopmentVerificationDigest(actionPlan.action.inputClosure),
      candidateBytesDigest: CodexDevelopmentVerificationActionCandidateBytesDigest({ ...candidate, action: actionPlan.action }) });
    const core = Object.freeze({ schema: CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA,
      requestDigest: digest('e'), actionKeyHex: actionPlan.action.actionKey.slice(7), actionPlan, actionPlanClosure,
      artifactInput, executionEnvironment: CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT });
    const resolution = Object.freeze({ ...core, resolutionDigest: CodexDevelopmentVerificationDigest(core) as VerificationActionKeyDigest });
    return Object.freeze({ root, baseRoot, candidateRoot, outputDirectory, baseSha, headSha, resolution });
  } catch (error) { rmSync(root, { recursive: true, force: true }); throw error; }
}

async function preparePrivateActionArchive(fixture: ReturnType<typeof privateActionArchiveFixture>) {
  const issuer = createHostedActionArchiveRecipeIssuer();
  let generation = '';
  const result = await withGitCandidateCheckout({ sourceRoot: fixture.candidateRoot, trustedRoot: fixture.baseRoot,
    baseSha: fixture.baseSha, headSha: fixture.headSha, purpose: 'action-materialization',
    archiveRecipeIssuer: issuer, deadlineAtUnixMs: Date.now() + 120_000 }, async checkout => {
    generation = path.dirname(checkout.candidateRoot);
    const value = await CodexDevelopmentPrepareHostedActionInputs({ resolution: fixture.resolution,
      baseRoot: fixture.baseRoot, candidateRoot: checkout.candidateRoot, outputDirectory: fixture.outputDirectory, checkout });
    return Object.freeze({ value, operation: gitCandidateCheckoutRecipeBinding(checkout, issuer) });
  });
  expect(existsSync(generation)).toBe(false);
  return result;
}

test.skipIf(process.platform !== 'linux')('actual private materializer output survives scope retirement and rejects copies, foreign operations and replay', async () => {
  const fixture = privateActionArchiveFixture();
  try {
    const prepared = await preparePrivateActionArchive(fixture);
    expect(existsSync(prepared.value.preparedCandidateArchive)).toBe(true);
    expect(prepared.value.archiveInventory.archiveDigest).toBe(bytesDigest(readFileSync(prepared.value.preparedCandidateArchive)));
    const issuer = createHostedActionArchiveRecipeIssuer();
    const foreignOperation = await withGitCandidateCheckout({ sourceRoot: fixture.candidateRoot, trustedRoot: fixture.baseRoot,
      baseSha: fixture.baseSha, headSha: fixture.headSha, purpose: 'action-materialization',
      archiveRecipeIssuer: issuer, deadlineAtUnixMs: Date.now() + 120_000 }, async checkout => gitCandidateCheckoutRecipeBinding(checkout, issuer));
    expect(() => consumePreparedHostedActionArchive({ ...prepared.value }, prepared.operation)).toThrow('original materializer object');
    expect(() => consumePreparedHostedActionArchive(prepared.value, foreignOperation)).toThrow('original materializer object');
    assertPreparedHostedActionArchiveCurrent(prepared.value, prepared.operation);
    expect(consumePreparedHostedActionArchive(prepared.value, prepared.operation)).toBe(prepared.value.archiveInventory);
    expect(() => consumePreparedHostedActionArchive(prepared.value, prepared.operation)).toThrow('already consumed');
    // The original output owner may still read current bytes; it never reissues
    // the one consumed inventory or opens another decoder process.
    assertPreparedHostedActionArchiveCurrent(prepared.value, prepared.operation);
  } finally { rmSync(fixture.root, { recursive: true, force: true }); }
});

for (const mutation of ['replace', 'bytes', 'mode'] as const) {
  test.skipIf(process.platform !== 'linux')(`actual prepared archive rejects ${mutation} drift without rebasing its original proof`, async () => {
    const fixture = privateActionArchiveFixture();
    try {
      const prepared = await preparePrivateActionArchive(fixture);
      const archive = prepared.value.preparedCandidateArchive;
      const bytes = readFileSync(archive);
      if (mutation === 'replace') { renameSync(archive, `${archive}.original`); writeFileSync(archive, bytes); }
      if (mutation === 'bytes') writeFileSync(archive, Buffer.concat([bytes, Buffer.from('changed')]));
      if (mutation === 'mode') chmodSync(archive, 0o644);
      expect(() => assertPreparedHostedActionArchiveCurrent(prepared.value, prepared.operation)).toThrow();
      writeFileSync(archive, bytes);
      expect(() => consumePreparedHostedActionArchive(prepared.value, prepared.operation)).toThrow();
    } finally { rmSync(fixture.root, { recursive: true, force: true }); }
  });
}

for (const fault of ['candidate-acquire', 'candidate-acquire-and-base-close', 'read-and-both-closes'] as const) {
  test.skipIf(process.platform !== 'linux')(`actual prepare settles dependency resources after ${fault}`, async () => {
    const fixture = privateActionArchiveFixture();
    const originalRetain = physicalNoFollow.retainNoFollowOrdinaryFile;
    const retained: Array<ReturnType<typeof originalRetain>> = [];
    const attempted: string[] = [];
    const primary = new Error(`injected dependency failure: ${fault}`);
    const cleanup = new Error(`injected dependency cleanup failure: ${fault}`);
    let generation = '';
    let observed: unknown;
    let dependencyPath = '';
    // This seam injects acquisition/read/close failure into the real producer.
    // It retains actual files and never issues a substitute process capability.
    const spy = spyOn(physicalNoFollow, 'retainNoFollowOrdinaryFile').mockImplementation((...args) => {
      const label = args[3] ?? '';
      const base = label.startsWith('Hosted dependency base authority ');
      const candidate = label.startsWith('Hosted dependency candidate authority ');
      if (!base && !candidate) return originalRetain(...args);
      dependencyPath ||= args[1];
      if (candidate && fault !== 'read-and-both-closes') throw primary;
      const value = originalRetain(...args);
      retained.push(value);
      return Object.freeze({ ...value,
        readBytes: () => {
          if (base && fault === 'read-and-both-closes') throw primary;
          return value.readBytes();
        },
        dispose: () => {
          attempted.push(base ? 'base' : 'candidate');
          if (fault !== 'candidate-acquire') throw cleanup;
          value.dispose();
        }
      });
    });
    try {
      try {
        await withGitCandidateCheckout({ sourceRoot: fixture.candidateRoot, trustedRoot: fixture.baseRoot,
          baseSha: fixture.baseSha, headSha: fixture.headSha, purpose: 'action-materialization',
          archiveRecipeIssuer: createHostedActionArchiveRecipeIssuer(), deadlineAtUnixMs: Date.now() + 120_000 }, async checkout => {
          generation = path.dirname(checkout.candidateRoot);
          return CodexDevelopmentPrepareHostedActionInputs({ resolution: fixture.resolution,
            baseRoot: fixture.baseRoot, candidateRoot: checkout.candidateRoot,
            outputDirectory: fixture.outputDirectory, checkout });
        });
      } catch (error) { observed = error; }
      // Assertions live outside the expected-failure operation. A failed
      // assertion can never be accepted as its expected primary/close error.
      expect(dependencyPath).not.toBe('');
      expect(existsSync(path.join(fixture.outputDirectory, 'prepared-candidate.tar'))).toBe(false);
      expect(attempted).toEqual(fault === 'read-and-both-closes' ? ['candidate', 'base'] : ['base']);
      expect(retained.length).toBe(fault === 'read-and-both-closes' ? 2 : 1);
      if (fault === 'candidate-acquire') {
        expect(observed).toBe(primary);
        expect(existsSync(generation)).toBe(false);
        expect(() => retained[0]!.assertCurrent()).toThrow();
      } else {
        expect(observed).toBeInstanceOf(GitCandidateCheckoutCleanupUnknownError);
        expect(existsSync(generation)).toBe(true);
        const error = observed as GitCandidateCheckoutCleanupUnknownError;
        expect(error.failure).toBeInstanceOf(ResourceCompositeSettlementError);
        const scopeFailure = (error.failure as ResourceCompositeSettlementError).errors
          .find(value => value instanceof ResourceCompositeSettlementError) as ResourceCompositeSettlementError | undefined;
        expect(scopeFailure).toBeDefined();
        if (scopeFailure === undefined) throw new Error('Actual dependency settlement failure was lost.');
        expect(scopeFailure.errors).toContain(primary);
        expect(scopeFailure.errors.filter(value => value === cleanup).length)
          .toBe(fault === 'read-and-both-closes' ? 2 : 1);
      }
    } finally {
      spy.mockRestore();
      if (fault !== 'candidate-acquire') for (const value of retained) value.dispose();
      if (generation !== '' && existsSync(generation)) rmSync(generation, { recursive: true, force: true });
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
}
