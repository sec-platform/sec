import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
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

import { expect, test } from 'bun:test';

import {
  CodexDevelopmentAssertVerificationActionTerminalArtifactV2,
  CodexDevelopmentAssertVerificationEvidenceV4,
  CodexDevelopmentCreateVerificationEvidenceProducerV4,
  CodexDevelopmentVerificationActionCandidateBytesDigestV2,
  CodexDevelopmentVerificationDigest,
  type CodexDevelopmentVerificationEvidenceV4
} from '../../platform/shared/ci-evidence-contract.ts';
import { CodexDevelopmentCreateTestImpactTransitionObservationV1 } from '../../platform/shared/ci-git-changed-files.ts';
import {
  CodexDevelopmentCreateHostedSutExecutionAuthorizationV1,
  CodexDevelopmentFinalizeHostedActionRawResultV2,
  CodexDevelopmentHostedSutCandidateEnvironmentV1,
  type CodexDevelopmentHostedSutExecutionAuthorizationV1
} from '../../platform/shared/ci-hosted-sut-observation-contract.ts';
import { buildCiQuickGatePlan } from '../../platform/shared/ci-verification-plan.ts';
import {
  CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS_V2,
  CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST_V1,
  CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1,
  CI_VERIFICATION_SESSION_DISPATCH_TYPE
} from '../../platform/shared/ci-verification-revision.ts';
import { compilerRoot } from '../../platform/shared/paths.ts';
import {
  computeTcbClosureLock,
  parseTcbClosureGeneratedRegionV2,
  planTcbClosureLockSourceV2,
  trustedRuntimeClosure,
  type TcbClosureLockInput
} from '../../platform/shared/tcb-closure-lock.ts';
import {
  SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH_V3
} from '../../platform/shared/tcb-trust-root-contract.ts';
import {
  buildCiVerificationActionPlanClosureV1,
  buildCiVerificationActionPlanV1,
  CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT_V2,
  ciVerificationGateStepV1,
  type CiVerificationActionCandidateV1,
  type CiVerificationActionPlanClosureV1,
  type CiVerificationProducerGateV1
} from '../../platform/shared/verification-action-ci-contract.ts';
import {
  encodeVerificationActionDataV2,
  type VerificationActionKeyDigest
} from '../../platform/shared/verification-action-contract.ts';
import {
  createVerificationActionProviderStartMarkerV2,
  createVerificationActionProviderTerminalAnchorV2,
  finalizeVerificationActionProviderStatusReadbackV2,
  VERIFICATION_ACTION_PROVIDER_POLICY_V2,
  verificationActionProviderRunTargetUrlV2,
  verificationActionProviderStartArtifactNameV2,
  verificationActionProviderStartDescriptionV2,
  verificationActionProviderStatusContextV2,
  verificationActionProviderTerminalAnchorNameV2,
  verificationActionProviderTerminalArtifactNameV2,
  verificationActionProviderTerminalDescriptionV2,
  type VerificationActionProviderOriginV2,
  type VerificationActionProviderStartObservationV2,
  type VerificationActionProviderStatusObservationV2,
  type VerificationActionProviderStatusReadbackV2,
  type VerificationActionProviderTerminalAnchorObservationV2
} from '../../platform/shared/verification-action-provider-contract.ts';
import type { VerificationResultStatus } from '../../platform/shared/verification-result-contract.ts';
import {
  CI_TCB_CLOSURE_LOCK_TARGET_V1,
  CI_VERIFICATION_ACTION_EXECUTION_TICKET_SCHEMA_V2,
  CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA_V2,
  CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA_V1,
  CodexDevelopmentAssembleHostedActionTerminalV2,
  CodexDevelopmentAssertHostedActionDependencyInputsV1,
  CodexDevelopmentAssertHostedActionParentEventV2,
  CodexDevelopmentAssertHostedDependencyArchiveProjectionV1,
  CodexDevelopmentAssertHostedSutSandboxCommandPlanV1,
  CodexDevelopmentAssertTrustedBootstrapSutMaterializationCleanV1,
  CodexDevelopmentBuildHostedSutSandboxCommandPlanV1,
  CodexDevelopmentBuildTrustedBootstrapSutSandboxCommandPlanV1,
  CodexDevelopmentCandidateProcessEnvironmentV2,
  CodexDevelopmentCaptureHostedDependencyPhysicalSnapshotV1,
  CodexDevelopmentCiVerificationMain,
  CodexDevelopmentCiVerificationTcbClosureLockCliV1,
  CodexDevelopmentComposeHostedEvidenceV2,
  CodexDevelopmentCoordinateHostedActionsV2,
  CodexDevelopmentExecuteHostedActionSutV2,
  CodexDevelopmentHostedDependencyMaterializerEnvironmentV1,
  CodexDevelopmentHostedSutCapabilityAssertionV1,
  CodexDevelopmentInspectHostedActionArchiveInventoryV3,
  CodexDevelopmentInspectHostedActionArchiveV2,
  CodexDevelopmentMaterializeTrustedBootstrapArchiveV3,
  CodexDevelopmentProbeHostedSutSandboxCapabilityV1,
  CodexDevelopmentRunBoundedDependencyMaterializationV1,
  CodexDevelopmentTrustedBootstrapSutHarnessV1,
  CodexDevelopmentValidateHostedActionArchiveInventoryV2,
  type CodexDevelopmentHostedActionArchiveInventoryV2,
  type CodexDevelopmentHostedActionArtifactObservationV2,
  type CodexDevelopmentHostedActionExecutionTicketV2,
  type CodexDevelopmentHostedActionRawResultV2,
  type CodexDevelopmentHostedActionResolutionV2,
  type CodexDevelopmentHostedSutSandboxProcessObservationV1,
  type CodexDevelopmentHostedSutSandboxReceiptV1
} from '../../scripts/ci-verification.ts';
import {
  VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA_V1,
  type VerificationSessionHostedRequestV1
} from '../../scripts/codex/verification-session-runtime.ts';

const HEAD = '1'.repeat(40);
const TREE = '2'.repeat(40);
const BASE = '3'.repeat(40);
const BASE_TREE = '4'.repeat(40);
const MANIFEST_PATH = 'docs/work-packages/exact-verification-v1.md';
const RAW = `sha256:${'a'.repeat(64)}` as const;

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
  options: Readonly<{ truncated?: boolean; started?: boolean }> = {}
): CodexDevelopmentHostedSutSandboxProcessObservationV1 {
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
    commandStarted: options.started ?? true
  });
}

function sandboxReceipt(
  actionKey: VerificationActionKeyDigest,
  status: 'passed' | 'failed' | 'unsupported' | 'invalidated' = 'passed',
  authorization?: CodexDevelopmentHostedSutExecutionAuthorizationV1
): CodexDevelopmentHostedSutSandboxReceiptV1 {
  const executed = status === 'passed' || status === 'failed';
  if (executed && authorization === undefined) {
    throw new Error('Executed sandbox fixture requires its physical command authorization.');
  }
  const settled = status !== 'invalidated';
  const withoutDigest = Object.freeze({
    schema: CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA_V1,
    policyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST_V1,
    actionKey,
    capability: Object.freeze({
      commandPlanDigest: executed ? authorization!.physicalCommand.projectionDigest : digest('8'),
      commandStarted: status !== 'invalidated',
      exitCode: executed ? 0 : status === 'unsupported' ? 1 : null,
      markerObserved: executed,
      outputDigest: digest('8'),
      teardownCommandStarted: status !== 'invalidated',
      teardownExitCode: status === 'invalidated' ? null : 0,
      residueMarkerObserved: status !== 'invalidated',
      cgroupEmpty: settled,
      residueReadbackDigest: digest('0'),
      diagnostic: status === 'passed' || status === 'failed' ? null
        : status === 'unsupported' ? 'unshare: operation not permitted' : 'capability observation lost'
    }),
    commandPlanDigest: executed ? authorization!.physicalCommand.projectionDigest : null,
    resources: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits,
    authenticatedArchive: Object.freeze({
      archiveDigest: digest('9'), inventoryDigest: digest('0'),
      dependencyClosureDigest: DEPENDENCY_CLOSURE, gitBundleDigest: GIT_CLOSURE,
      entryCount: 12, totalFileBytes: 1024
    }),
    rootIsolation: Object.freeze({
      substrate: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.substrate,
      namespaces: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.namespaces,
      uid: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.isolatedUid,
      gid: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.isolatedGid,
      network: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.network,
      inputMount: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.inputMount,
      workspace: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.workspace,
      outputTransport: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.outputTransport,
      candidateEnvironmentNames: executed ? Object.freeze(
        authorization!.physicalCommand.fixedSandboxEnvironment.map((entry) => entry.name)
      ) : Object.freeze([])
    }),
    execution: Object.freeze({
      started: executed, commandStarted: executed,
      unitName: executed ? authorization!.physicalCommand.unitName : null,
      exitCode: executed ? (status === 'passed' ? 0 : 1) : null,
      authenticatedInputDigest: executed ? digest('9') : null, stdoutStderrDigest: RAW,
      postExecutionInputDigest: executed ? digest('9') : null,
      postExecutionReadbackErrorDigest: null,
      stdoutDigest: RAW, stderrDigest: digest('0'), stdoutBytesObserved: executed ? 1 : 0,
      stderrBytesObserved: 0, outputTruncated: false,
      boundedFailureTailDigest: digest('0')
    }),
    reap: Object.freeze({
      namespacePid1Exited: executed, killChildEnabled: true, unshareProcessClosed: settled
    }),
    residue: Object.freeze({ cgroupEmpty: settled, hostReadbackDigest: digest('0') }),
    diagnostic: status === 'passed' ? null : status
  });
  return Object.freeze({
    ...withoutDigest,
    receiptDigest: CodexDevelopmentVerificationDigest(withoutDigest) as VerificationActionKeyDigest
  });
}

const hostedProducer: VerificationActionProviderOriginV2 = Object.freeze({
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

function manifestSource(): string {
  return `---
schema: codex-development-work-package-v1
id: exact-verification-v1
tracking: none
base: "${BASE}"
manifestState: frozen
requiredProfile: quick
ciRevision: ci-verification-v19
tasks:
  - id: exact-verification
    owner: verification-writer
    ownedPaths:
      - scripts/ci-verification.ts
forbiddenPaths:
  - platform/compiler/
acceptance:
  - exact-verification
tests:
  - focused-verification
---

# Exact Verification
`;
}

function exactManifest() {
  return {
    blobSha: '5'.repeat(40), bytes: new TextEncoder().encode(manifestSource()),
    mode: '100644' as const, type: 'blob' as const
  };
}

function clock(): () => Date {
  let time = Date.parse('2026-08-09T00:00:00.000Z');
  return () => new Date(time += 10);
}

function revisions(ref: string): string | null {
  if (ref === 'HEAD') return HEAD;
  if (ref === 'HEAD^{tree}') return TREE;
  if (ref === BASE || ref === 'HEAD^1') return BASE;
  if (ref === `${BASE}^{tree}`) return BASE_TREE;
  return null;
}

function baseOptions(root: string) {
  return {
    argv: ['--profile', 'quick', '--expected-head', HEAD],
    env: {
      SEC_CHANGED_BASE: BASE,
      SEC_AFFECTED_TESTS_BASE: BASE,
      SEC_WORK_PACKAGE_MANIFEST_PATH: MANIFEST_PATH
    },
    now: clock(),
    repositoryRoot: root,
    gitRevision: revisions,
    trackedTreeIsClean: () => true,
    changedFiles: () => ['platform/orchestrator.ts'],
    readExactGitBlob: () => exactManifest(),
    runGate: async () => ({ code: 0, rawOutputDigest: RAW, failureTail: '' })
  };
}

function hostedGates(): readonly CiVerificationProducerGateV1[] {
  return buildCiQuickGatePlan({ includeImports: true, includeDocs: true, includeRisk: false })
    .map(ciVerificationGateStepV1);
}

function hostedCandidate(): CiVerificationActionCandidateV1 {
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
    providerRevision: CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT_V2.executionEnvironmentRevision,
    contractRevision: 'ci-verification-v19',
    requiredBlobs: [
      ...CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS_V2.map((dependencyPath, index) => ({
        path: dependencyPath,
        digest: digest(String(index + 1))
      })),
      { path: 'input.txt', digest: digest('d') }
    ]
  };
}

function hostedResolution(
  gates: readonly CiVerificationProducerGateV1[] = [hostedGates()[0]!]
): CodexDevelopmentHostedActionResolutionV2 {
  const actionPlanClosure = buildCiVerificationActionPlanClosureV1({
    candidate: hostedCandidate(),
    gates
  });
  return hostedMemberResolution(actionPlanClosure, 0);
}

function hostedMemberResolution(
  actionPlanClosure: CiVerificationActionPlanClosureV1,
  memberIndex: number
): CodexDevelopmentHostedActionResolutionV2 {
  const actionPlan = actionPlanClosure.actions[memberIndex]!;
  const artifactInput = Object.freeze({
    baseSha: BASE,
    baseTreeSha: BASE_TREE,
    headSha: HEAD,
    headTreeSha: TREE,
    manifestPath: MANIFEST_PATH,
    manifestDigest: hostedCandidate().manifestDigest,
    inputClosureDigest: CodexDevelopmentVerificationDigest(actionPlan.action.inputClosure),
    candidateBytesDigest: CodexDevelopmentVerificationActionCandidateBytesDigestV2({
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
    schema: CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA_V2,
    requestDigest: digest('e'),
    actionKeyHex: actionPlan.action.actionKey.slice('sha256:'.length),
    actionPlan,
    actionPlanClosure,
    artifactInput,
    executionEnvironment: CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT_V2
  });
  return Object.freeze({
    ...withoutDigest,
    resolutionDigest: CodexDevelopmentVerificationDigest(withoutDigest) as VerificationActionKeyDigest
  });
}

function hostedTicket(
  resolution: CodexDevelopmentHostedActionResolutionV2,
  inventory: CodexDevelopmentHostedActionArchiveInventoryV2 = Object.freeze({
    archiveDigest: digest('9'),
    inventoryDigest: digest('0'),
    entryCount: 12,
    totalFileBytes: 1024,
    dependencyClosureDigest: DEPENDENCY_CLOSURE,
    gitBundleDigest: GIT_CLOSURE
  })
): CodexDevelopmentHostedActionExecutionTicketV2 {
  const actionKey = resolution.actionPlan.action.actionKey;
  const withoutDigest = Object.freeze({
    schema: CI_VERIFICATION_ACTION_EXECUTION_TICKET_SCHEMA_V2,
    resolutionDigest: resolution.resolutionDigest,
    actionKey,
    candidateSha: HEAD,
    candidateBytesDigest: resolution.artifactInput.candidateBytesDigest as VerificationActionKeyDigest,
    startStatusId: 101,
    startStatusNodeId: 'STATUS_start',
    startMarkerDigest: digest('f'),
    startArtifactOriginId: '7001',
    startArtifactName: verificationActionProviderStartArtifactNameV2(actionKey),
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
  resolution: CodexDevelopmentHostedActionResolutionV2,
  status: 'passed' | 'failed' | 'unsupported' | 'invalidated'
): CodexDevelopmentHostedActionRawResultV2 {
  const ticket = hostedTicket(resolution);
  const memberIndex = resolution.actionPlanClosure.actions.findIndex(
    (member) => member.action.actionKey === resolution.actionPlan.action.actionKey
  );
  const normalizedOperation = resolution.actionPlanClosure.normalizedOperations[memberIndex]!;
  const authorization = CodexDevelopmentCreateHostedSutExecutionAuthorizationV1({
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
  return CodexDevelopmentFinalizeHostedActionRawResultV2({
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

type HostedEnvelopeFixture = Parameters<typeof CodexDevelopmentCoordinateHostedActionsV2>[0]['envelope'];

function hostedDagClosure(
  dependencyIndexes: readonly (readonly number[])[]
): CiVerificationActionPlanClosureV1 {
  const gates = hostedGates();
  if (dependencyIndexes.length > gates.length) throw new Error('Hosted DAG fixture has too many members.');
  const actions = [] as ReturnType<typeof buildCiVerificationActionPlanV1>[];
  const normalizedOperations = [] as CiVerificationActionPlanClosureV1['normalizedOperations'][number][];
  for (const [index, dependencies] of dependencyIndexes.entries()) {
    const gate = gates[index]!;
    const normalized = buildCiVerificationActionPlanClosureV1({
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
    actions.push(buildCiVerificationActionPlanV1({
      candidate: hostedCandidate(),
      gate,
      upstreamActionKeys
    }));
    normalizedOperations.push(normalized);
  }
  const template = buildCiVerificationActionPlanClosureV1({
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
  actionPlanClosure: CiVerificationActionPlanClosureV1
): HostedEnvelopeFixture {
  const scopeAuthorizationRevision = hostedCandidate().scopeAuthorizationRevision;
  const scopeAuthorizationDigest = digest('5');
  const sessionProposalDigest = digest('6');
  const sessionRevision = digest('7');
  const mainHealthRevision = digest('8');
  const mainHealthDigest = digest('9');
  const withoutDigest = Object.freeze({
    schema: VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA_V1,
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

const hostedEvidenceProducer = CodexDevelopmentCreateVerificationEvidenceProducerV4({
  sourceTransport: 'github-actions',
  workflowPath: '.github/workflows/compiler-pr-validation.yml',
  workflowRef: `.github/workflows/compiler-pr-validation.yml@${BASE}`,
  workflowSha: BASE,
  runId: '9002',
  runAttempt: 1,
  actorNodeId: 'BOT_actions_fixture'
});

type HostedProviderInputs = Readonly<{
  observations: readonly CodexDevelopmentHostedActionArtifactObservationV2[];
  startObservations: readonly VerificationActionProviderStartObservationV2[];
  terminalAnchorObservations: readonly VerificationActionProviderTerminalAnchorObservationV2[];
  providerStatusReadbacks: readonly VerificationActionProviderStatusReadbackV2[];
}>;

function hostedProviderInputs(
  envelope: HostedEnvelopeFixture,
  terminals: ReadonlyMap<number, Readonly<{
    status: Exclude<VerificationResultStatus, 'not-run'>;
    expired?: boolean;
  }>>
): HostedProviderInputs {
  const observations: CodexDevelopmentHostedActionArtifactObservationV2[] = [];
  const startObservations: VerificationActionProviderStartObservationV2[] = [];
  const terminalAnchorObservations: VerificationActionProviderTerminalAnchorObservationV2[] = [];
  const providerStatusReadbacks: VerificationActionProviderStatusReadbackV2[] = [];
  for (const [index, member] of envelope.actionPlanClosure.actions.entries()) {
    const actionKey = member.action.actionKey;
    const terminalSpec = terminals.get(index);
    if (terminalSpec === undefined) {
      providerStatusReadbacks.push(finalizeVerificationActionProviderStatusReadbackV2({
        repositoryId: hostedProducer.repositoryId,
        repository: hostedProducer.repository,
        actionKey,
        candidateSha: HEAD,
        context: verificationActionProviderStatusContextV2(actionKey),
        perPage: 100,
        paginationComplete: true,
        pageDigests: [bytesDigest(`empty-status-page-${index}`)],
        statuses: []
      }));
      continue;
    }
    const resolution = hostedMemberResolution(envelope.actionPlanClosure, index);
    const rawResult = hostedRawResult(resolution, terminalSpec.status);
    const artifact = CodexDevelopmentAssembleHostedActionTerminalV2({
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
    const marker = createVerificationActionProviderStartMarkerV2({
      actionKey,
      candidateSha: HEAD,
      executionEnvironmentRevision:
        CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT_V2.executionEnvironmentRevision,
      producer: hostedProducer
    });
    const anchor = createVerificationActionProviderTerminalAnchorV2({
      actionKey,
      candidateSha: HEAD,
      startStatusId,
      startStatusNodeId,
      startArtifactOriginId: startOriginId,
      startArtifactName: verificationActionProviderStartArtifactNameV2(actionKey),
      startArtifactArchiveDigest: startArchiveDigest,
      startMarkerDigest: marker.markerDigest,
      terminalArtifactOriginId: terminalOriginId,
      terminalArtifactName: verificationActionProviderTerminalArtifactNameV2(actionKey),
      terminalArtifactArchiveDigest: terminalArchiveDigest,
      terminalArtifactPayloadDigest: terminalPayloadDigest,
      terminalAssemblerOrigin: hostedProducer,
      anchorPublisherOrigin: hostedProducer
    });
    const targetUrl = verificationActionProviderRunTargetUrlV2(hostedProducer);
    const creator = VERIFICATION_ACTION_PROVIDER_POLICY_V2.creator;
    const statuses: VerificationActionProviderStatusObservationV2[] = [
      Object.freeze({
        id: startStatusId,
        nodeId: startStatusNodeId,
        state: 'pending',
        context: verificationActionProviderStatusContextV2(actionKey),
        description: verificationActionProviderStartDescriptionV2(marker.markerDigest),
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
        context: verificationActionProviderStatusContextV2(actionKey),
        description: verificationActionProviderTerminalDescriptionV2(anchor.anchorDigest),
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
      artifactName: verificationActionProviderStartArtifactNameV2(actionKey),
      archiveDigest: startArchiveDigest,
      expired: false,
      payload: marker,
      referencedOrigin: hostedProducer
    }));
    observations.push(Object.freeze({
      providerObservation: Object.freeze({
        originId: terminalOriginId,
        artifactName: verificationActionProviderTerminalArtifactNameV2(actionKey),
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
      artifactName: verificationActionProviderTerminalAnchorNameV2(actionKey),
      archiveDigest: bytesDigest(`anchor-archive-${index}`),
      expired: false,
      payload: anchor,
      referencedOrigin: hostedProducer
    }));
    providerStatusReadbacks.push(finalizeVerificationActionProviderStatusReadbackV2({
      repositoryId: hostedProducer.repositoryId,
      repository: hostedProducer.repository,
      actionKey,
      candidateSha: HEAD,
      context: verificationActionProviderStatusContextV2(actionKey),
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

type TcbClosureCommandFixture = Readonly<{
  root: string;
  entrypoint: string;
  target: string;
  stage: string;
  archiveRoot: string;
  causalModule: string;
}>;

function createTcbClosureCommandFixture(): TcbClosureCommandFixture {
  const parent = path.join(compilerRoot, '.tmp');
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(path.join(parent, 'sec-tcb-command-'));
  const runtime = trustedRuntimeClosure();
  const reviewedSutEdge = 'scripts/ci-workspace-fast.ts -> platform/orchestrator.ts';
  if (!runtime.reviewedEdges.has(reviewedSutEdge)) {
    throw new Error('TCB closure fixture did not observe the canonical reviewed SUT boundary.');
  }
  const copiedPaths = new Set(runtime.closure);
  for (const edge of [...runtime.reviewedEdges, ...runtime.reviewedBoundaryEdges]) {
    const delimiter = ' -> ';
    const delimiterIndex = edge.indexOf(delimiter);
    if (delimiterIndex <= 0 || edge.indexOf(delimiter, delimiterIndex + delimiter.length) !== -1) {
      throw new Error(`TCB closure fixture observed a malformed reviewed edge: ${edge}.`);
    }
    copiedPaths.add(edge.slice(delimiterIndex + delimiter.length));
  }
  copiedPaths.add(SEC_TRUSTED_BOOTSTRAP_REGISTRY_PATH_V3);
  copiedPaths.add(CI_TCB_CLOSURE_LOCK_TARGET_V1);
  for (const repositoryPath of copiedPaths) {
    if (
      repositoryPath.length === 0
      || path.isAbsolute(repositoryPath)
      || repositoryPath.includes('\\')
      || path.posix.normalize(repositoryPath) !== repositoryPath
      || repositoryPath.startsWith('../')
      || repositoryPath.includes('/../')
    ) throw new Error(`TCB closure fixture path escapes canonical repository syntax: ${repositoryPath}.`);
    const source = path.resolve(compilerRoot, ...repositoryPath.split('/'));
    const targetPath = path.resolve(root, ...repositoryPath.split('/'));
    const sourceRelative = path.relative(compilerRoot, source);
    const targetRelative = path.relative(root, targetPath);
    if (
      sourceRelative.startsWith(`..${path.sep}`)
      || path.isAbsolute(sourceRelative)
      || targetRelative.startsWith(`..${path.sep}`)
      || path.isAbsolute(targetRelative)
    ) throw new Error(`TCB closure fixture path escapes its bounded root: ${repositoryPath}.`);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    copyFileSync(source, targetPath);
  }
  const target = path.join(root, ...CI_TCB_CLOSURE_LOCK_TARGET_V1.split('/'));
  return {
    root,
    entrypoint: path.join(root, 'scripts', 'ci-verification.ts'),
    target,
    stage: path.join(path.dirname(target), '.tcb-closure-lock.ts.sec-stage-v2'),
    archiveRoot: path.join(root, '.tmp', 'codex', 'tcb-closure-lock-v2'),
    causalModule: path.join(root, 'platform', 'shared', 'constants.ts')
  };
}

function tcbArchivePathFromResult(
  fixture: TcbClosureCommandFixture,
  result: Record<string, unknown>
): string {
  const relativePath = result.archivePath;
  if (typeof relativePath !== 'string' || !relativePath.startsWith('.tmp/codex/tcb-closure-lock-v2/')) {
    throw new Error('TCB closure command did not return one canonical archive path.');
  }
  return path.join(fixture.root, ...relativePath.split('/'));
}

function tcbArchiveFiles(fixture: TcbClosureCommandFixture): string[] {
  return existsSync(fixture.archiveRoot)
    ? readdirSync(fixture.archiveRoot).filter((name) => name.endsWith('.old.ts')).sort()
    : [];
}

function tcbOperationFiles(fixture: TcbClosureCommandFixture): string[] {
  return existsSync(fixture.archiveRoot)
    ? readdirSync(fixture.archiveRoot).filter((name) => name.endsWith('.operation.json')).sort()
    : [];
}

function tcbOperationRecordPathFromResult(
  fixture: TcbClosureCommandFixture,
  result: Record<string, unknown>
): string {
  return tcbArchivePathFromResult(fixture, result).replace(/\.old\.ts$/u, '.operation.json');
}

function prepareRecordedTcbOperation(
  fixture: TcbClosureCommandFixture,
  result: Record<string, unknown>
): void {
  const archivePath = tcbArchivePathFromResult(fixture, result);
  const match = /tcb-closure-lock-v3-([0-9a-f]{64})\.old\.ts$/u.exec(archivePath);
  if (match === null) throw new Error('TCB closure fixture archive path has no operationKey.');
  const record = {
    schema: 'sec-tcb-closure-lock-archive-operation-v3',
    target: CI_TCB_CLOSURE_LOCK_TARGET_V1,
    oldDigest: result.oldRawSourceDigest,
    nextDigest: result.nextRawSourceDigest,
    generatedAt: result.generatedAt,
    operationKey: match[1]
  };
  mkdirSync(fixture.archiveRoot, { recursive: true });
  writeFileSync(tcbOperationRecordPathFromResult(fixture, result), `${JSON.stringify(record)}\n`, 'utf8');
}

function prepareRawTcbOperation(
  fixture: TcbClosureCommandFixture,
  oldSource: string,
  nextSource: string,
  generatedAt: string
): Readonly<{ archivePath: string; recordPath: string; operationKey: string }> {
  const rawDigest = (source: string): string =>
    `sha256:${createHash('sha256').update(source).digest('hex')}`;
  const tuple = {
    schema: 'sec-tcb-closure-lock-archive-operation-v3',
    target: CI_TCB_CLOSURE_LOCK_TARGET_V1,
    oldDigest: rawDigest(oldSource),
    nextDigest: rawDigest(nextSource),
    generatedAt
  } as const;
  const operationKey = createHash('sha256').update(JSON.stringify(tuple)).digest('hex');
  const archivePath = path.join(fixture.archiveRoot, `tcb-closure-lock-v3-${operationKey}.old.ts`);
  const recordPath = path.join(fixture.archiveRoot, `tcb-closure-lock-v3-${operationKey}.operation.json`);
  mkdirSync(fixture.archiveRoot, { recursive: true });
  writeFileSync(recordPath, `${JSON.stringify({ ...tuple, operationKey })}\n`, 'utf8');
  return Object.freeze({ archivePath, recordPath, operationKey });
}

function installTcbTransactionRaceObserver(
  fixture: TcbClosureCommandFixture,
  sourceSuffix: string,
  point: 'before-authority-open' | 'before-current-entry-recheck' | 'before-destination-final-fence',
  action: 'same-bytes-object-substitution' | 'destination-third-value' | 'target-parent-junction'
): void {
  const source = readFileSync(fixture.entrypoint, 'utf8');
  const needle = ') | null = null;\n\nfunction observeTcbClosureTransactionRaceV1(';
  const observer = `) | null = (observedPoint, context) => {
  if (observedPoint !== ${JSON.stringify(point)} || !context.source.endsWith(${JSON.stringify(sourceSuffix)})) return;
  ${action === 'same-bytes-object-substitution'
    ? "renameSync(context.source, context.source+'.retained-object'); writeFileSync(context.source, context.expectedSource, 'utf8');"
    : action === 'destination-third-value'
      ? "writeFileSync(context.destination, 'destination third value', 'utf8');"
      : "const retainedParent=context.source+'.retained-directory'; renameSync(context.source, retainedParent); symlinkSync(retainedParent, context.source, process.platform === 'win32' ? 'junction' : 'dir');"}
};

function observeTcbClosureTransactionRaceV1(`;
  if (!source.includes(needle)) throw new Error('TCB closure private transaction race seam was not found.');
  const withFixtureFs = source.replace(
    '  realpathSync,\n',
    '  realpathSync,\n  renameSync,\n  symlinkSync,\n'
  );
  if (withFixtureFs === source) throw new Error('TCB closure copied source fs import seam was not found.');
  writeFileSync(fixture.entrypoint, withFixtureFs.replace(needle, observer), 'utf8');
}

type TcbClosureCliObservation = Readonly<{
  status: number;
  stdout: string;
  stderr: string;
}>;

const TCB_CLOSURE_FIXTURE_CHILD_TIMEOUT_MS = 15_000;
const TCB_CLOSURE_FIXTURE_CASE_TIMEOUT_MS = 30_000;
const TCB_CLOSURE_FIXTURE_RECOVERY_MATRIX_TIMEOUT_MS = 60_000;

function invokeTcbClosureCli(
  fixture: TcbClosureCommandFixture,
  argv: readonly string[],
  hosted = false
): TcbClosureCliObservation {
  const result = spawnSync(process.execPath, [fixture.entrypoint, ...argv], {
    cwd: fixture.root,
    encoding: 'utf8',
    env: { ...process.env, GITHUB_ACTIONS: hosted ? 'true' : 'false' },
    maxBuffer: 16 * 1024 * 1024,
    timeout: TCB_CLOSURE_FIXTURE_CHILD_TIMEOUT_MS,
    windowsHide: true
  });
  if (result.error !== undefined) throw result.error;
  return Object.freeze({
    status: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  });
}

function successfulTcbClosureCli(
  fixture: TcbClosureCommandFixture,
  argv: readonly string[]
): Record<string, unknown> {
  const result = invokeTcbClosureCli(fixture, argv);
  if (result.status !== 0) {
    throw new Error(`TCB closure fixture CLI failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

function tcbInputFromTrustedRuntimeClosure(): TcbClosureLockInput {
  const runtime = trustedRuntimeClosure();
  return {
    closure: new Set(runtime.closure),
    reviewedEdges: new Set(runtime.reviewedEdges),
    reviewedBoundaryEdges: new Set(runtime.reviewedBoundaryEdges),
    reviewedExternalImports: new Set(runtime.reviewedExternalImports),
    reviewedProcessDispatchers: new Set(runtime.reviewedProcessDispatchers)
  };
}

function planTcbFixtureUpdate(
  fixture: TcbClosureCommandFixture,
  generatedAt: string,
  revision: number
): ReturnType<typeof planTcbClosureLockSourceV2> {
  const source = readFileSync(fixture.target, 'utf8');
  writeFileSync(
    fixture.causalModule,
    `${readFileSync(fixture.causalModule, 'utf8')}\n// temp closure revision ${revision}\n`,
    'utf8'
  );
  return planTcbClosureLockSourceV2({
    source,
    nextLock: computeTcbClosureLock(tcbInputFromTrustedRuntimeClosure(), fixture.root),
    generatedAt
  });
}

test('TCB closure argv-only CLI checks, plans and applies only its copied fixed root', async () => {
  const fixture = createTcbClosureCommandFixture();
  try {
    const originalSource = readFileSync(fixture.target, 'utf8');
    const absentTarget = `${fixture.target}.absent-fixture`;
    renameSync(fixture.target, absentTarget);
    const missingCheck = invokeTcbClosureCli(fixture, ['tcb-closure-lock', '--mode', 'check']);
    expect(missingCheck.status).not.toBe(0);
    expect(missingCheck.stderr).toContain('target is missing outside a recoverable apply state');
    expect(existsSync(fixture.target)).toBe(false);
    expect(readFileSync(absentTarget, 'utf8')).toBe(originalSource);
    expect(existsSync(fixture.archiveRoot)).toBe(false);
    expect(existsSync(fixture.stage)).toBe(false);
    renameSync(absentTarget, fixture.target);

    const freshCheck = invokeTcbClosureCli(fixture, ['tcb-closure-lock', '--mode', 'check']);
    expect(freshCheck.status).toBe(0);
    expect(JSON.parse(freshCheck.stdout)).toMatchObject({ status: 'current', changed: false });
    expect(existsSync(fixture.archiveRoot)).toBe(false);
    expect(existsSync(fixture.stage)).toBe(false);
    const originalGeneratedAt = parseTcbClosureGeneratedRegionV2(originalSource).receipt.generatedAt;
    const currentSource = readFileSync(fixture.target, 'utf8');
    expect(currentSource).toBe(originalSource);
    expect(parseTcbClosureGeneratedRegionV2(currentSource).receipt.generatedAt).toBe(originalGeneratedAt);
    expect(readFileSync(fixture.target, 'utf8')).toBe(currentSource);
    expect(tcbArchiveFiles(fixture)).toHaveLength(0);
    expect(tcbOperationFiles(fixture)).toHaveLength(0);

    const update = planTcbFixtureUpdate(fixture, '2026-08-09T03:00:00.000Z', 1);
    expect(update.status).toBe('update-required');
    const dryRun = successfulTcbClosureCli(fixture, [
      'tcb-closure-lock', '--mode', 'dry-run', '--generated-at', '2026-08-09T03:00:00.000Z'
    ]);
    expect(dryRun).toMatchObject({ status: 'update-required', changed: false });
    expect(dryRun.nextRawSourceDigest).toBe(update.nextRawSourceDigest);
    const plannedArchive = tcbArchivePathFromResult(fixture, dryRun);
    expect(existsSync(plannedArchive)).toBe(false);
    expect(readFileSync(fixture.target, 'utf8')).toBe(currentSource);
    expect(existsSync(fixture.stage)).toBe(false);

    const applied = successfulTcbClosureCli(fixture, [
      'tcb-closure-lock', '--mode', 'apply', '--generated-at', '2026-08-09T03:00:00.000Z'
    ]);
    expect(applied).toMatchObject({ status: 'applied', changed: true });
    expect(tcbArchivePathFromResult(fixture, applied)).toBe(plannedArchive);
    expect(readFileSync(plannedArchive, 'utf8')).toBe(currentSource);
    expect(readFileSync(fixture.target, 'utf8')).toBe(update.nextSource);
    expect(existsSync(fixture.stage)).toBe(false);
    expect(tcbArchiveFiles(fixture)).toHaveLength(1);
    expect(tcbOperationFiles(fixture)).toHaveLength(1);

    const originalHosted = process.env.GITHUB_ACTIONS;
    process.env.GITHUB_ACTIONS = 'true';
    try {
      await expect(CodexDevelopmentCiVerificationTcbClosureLockCliV1([
        'tcb-closure-lock', '--mode', 'apply', '--generated-at', '2026-08-09T04:00:00.000Z'
      ])).rejects.toThrow('forbidden in hosted execution');
    } finally {
      if (originalHosted === undefined) delete process.env.GITHUB_ACTIONS;
      else process.env.GITHUB_ACTIONS = originalHosted;
    }
    await expect(CodexDevelopmentCiVerificationTcbClosureLockCliV1([
      'tcb-closure-lock', '--mode', 'check', '--path', fixture.target
    ])).rejects.toThrow('Usage:');
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}, TCB_CLOSURE_FIXTURE_CASE_TIMEOUT_MS);

test('TCB closure apply retains exact archives and recovers only canonical operation states', () => {
  const fixture = createTcbClosureCommandFixture();
  try {
    successfulTcbClosureCli(fixture, [
      'tcb-closure-lock', '--mode', 'apply', '--generated-at', '2026-08-09T05:00:00.000Z'
    ]);

    const staged = planTcbFixtureUpdate(fixture, '2026-08-09T06:00:00.000Z', 2);
    const stagedDryRun = successfulTcbClosureCli(fixture, [
      'tcb-closure-lock', '--mode', 'dry-run', '--generated-at', '2026-08-09T06:00:00.000Z'
    ]);
    const stagedArchive = tcbArchivePathFromResult(fixture, stagedDryRun);
    prepareRecordedTcbOperation(fixture, stagedDryRun);
    writeFileSync(fixture.stage, staged.nextSource, 'utf8');
    expect(existsSync(fixture.stage)).toBe(true);
    expect(existsSync(stagedArchive)).toBe(false);
    const wrongStageEpoch = invokeTcbClosureCli(fixture, [
      'tcb-closure-lock', '--mode', 'apply', '--generated-at', '2026-08-09T06:30:00.000Z'
    ]);
    expect(wrongStageEpoch.status).not.toBe(0);
    expect(wrongStageEpoch.stderr).toContain('generatedAt does not match');
    expect(readFileSync(fixture.stage, 'utf8')).toBe(staged.nextSource);
    const recoveredStage = successfulTcbClosureCli(fixture, [
      'tcb-closure-lock', '--mode', 'apply', '--generated-at', '2026-08-09T06:00:00.000Z'
    ]);
    expect(recoveredStage).toMatchObject({ status: 'recovered', changed: true });
    expect(recoveredStage.generatedAt).toBe('2026-08-09T06:00:00.000Z');
    expect(readFileSync(fixture.target, 'utf8')).toBe(staged.nextSource);
    expect(existsSync(fixture.stage)).toBe(false);
    expect(readFileSync(tcbArchivePathFromResult(fixture, recoveredStage), 'utf8')).not.toBe('');

    const captured = planTcbFixtureUpdate(fixture, '2026-08-09T07:00:00.000Z', 3);
    const capturedDryRun = successfulTcbClosureCli(fixture, [
      'tcb-closure-lock', '--mode', 'dry-run', '--generated-at', '2026-08-09T07:00:00.000Z'
    ]);
    const capturedArchive = tcbArchivePathFromResult(fixture, capturedDryRun);
    const capturedOldSource = readFileSync(fixture.target, 'utf8');
    prepareRecordedTcbOperation(fixture, capturedDryRun);
    writeFileSync(fixture.stage, captured.nextSource, 'utf8');
    renameSync(fixture.target, capturedArchive);
    expect(existsSync(fixture.target)).toBe(false);
    const recoveredCapture = successfulTcbClosureCli(fixture, [
      'tcb-closure-lock', '--mode', 'apply', '--generated-at', '2026-08-09T07:00:00.000Z'
    ]);
    expect(recoveredCapture.status).toBe('recovered');
    expect(readFileSync(fixture.target, 'utf8')).toBe(captured.nextSource);
    expect(readFileSync(capturedArchive, 'utf8')).toBe(capturedOldSource);

    const installed = planTcbFixtureUpdate(fixture, '2026-08-09T08:00:00.000Z', 4);
    const installedDryRun = successfulTcbClosureCli(fixture, [
      'tcb-closure-lock', '--mode', 'dry-run', '--generated-at', '2026-08-09T08:00:00.000Z'
    ]);
    const installedArchive = tcbArchivePathFromResult(fixture, installedDryRun);
    const installedOldSource = readFileSync(fixture.target, 'utf8');
    prepareRecordedTcbOperation(fixture, installedDryRun);
    writeFileSync(fixture.stage, installed.nextSource, 'utf8');
    renameSync(fixture.target, installedArchive);
    renameSync(fixture.stage, fixture.target);
    const recoveredInstall = successfulTcbClosureCli(fixture, [
      'tcb-closure-lock', '--mode', 'apply', '--generated-at', '2026-08-09T08:00:00.000Z'
    ]);
    expect(recoveredInstall.status).toBe('current');
    expect(readFileSync(fixture.target, 'utf8')).toBe(installed.nextSource);
    expect(readFileSync(installedArchive, 'utf8')).toBe(installedOldSource);

    const substituted = planTcbFixtureUpdate(fixture, '2026-08-09T09:00:00.000Z', 5);
    const substitutedDryRun = successfulTcbClosureCli(fixture, [
      'tcb-closure-lock', '--mode', 'dry-run', '--generated-at', '2026-08-09T09:00:00.000Z'
    ]);
    const substitutedArchive = tcbArchivePathFromResult(fixture, substitutedDryRun);
    const oldSource = readFileSync(fixture.target, 'utf8');
    const thirdValue = oldSource.replace(
      'generated exact TCB closure lock.',
      'concurrently substituted TCB closure lock.'
    );
    expect(thirdValue).not.toBe(oldSource);
    prepareRecordedTcbOperation(fixture, substitutedDryRun);
    writeFileSync(fixture.stage, substituted.nextSource, 'utf8');
    writeFileSync(substitutedArchive, thirdValue, 'utf8');
    const blocked = invokeTcbClosureCli(fixture, [
      'tcb-closure-lock', '--mode', 'apply', '--generated-at', '2026-08-09T09:00:00.000Z'
    ]);
    expect(blocked.status).not.toBe(0);
    expect(blocked.stderr).toContain('oldDigest mismatch');
    expect(readFileSync(fixture.target, 'utf8')).toBe(oldSource);
    expect(readFileSync(fixture.stage, 'utf8')).toBe(substituted.nextSource);
    expect(readFileSync(substitutedArchive, 'utf8')).toBe(thirdValue);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}, TCB_CLOSURE_FIXTURE_RECOVERY_MATRIX_TIMEOUT_MS);

test('TCB closure captured recovery blocks archive substitution without deleting any observed bytes', () => {
  const fixture = createTcbClosureCommandFixture();
  try {
    successfulTcbClosureCli(fixture, [
      'tcb-closure-lock', '--mode', 'apply', '--generated-at', '2026-08-09T10:00:00.000Z'
    ]);
    const recovery = planTcbFixtureUpdate(fixture, '2026-08-09T11:00:00.000Z', 6);
    const dryRun = successfulTcbClosureCli(fixture, [
      'tcb-closure-lock', '--mode', 'dry-run', '--generated-at', '2026-08-09T11:00:00.000Z'
    ]);
    const archive = tcbArchivePathFromResult(fixture, dryRun);
    const oldSource = readFileSync(fixture.target, 'utf8');
    const thirdValue = oldSource.replace(
      'generated exact TCB closure lock.',
      'substituted retained TCB closure archive.'
    );
    prepareRecordedTcbOperation(fixture, dryRun);
    writeFileSync(fixture.stage, recovery.nextSource, 'utf8');
    renameSync(fixture.target, archive);
    writeFileSync(archive, thirdValue, 'utf8');

    const blocked = invokeTcbClosureCli(fixture, [
      'tcb-closure-lock', '--mode', 'apply', '--generated-at', '2026-08-09T11:00:00.000Z'
    ]);
    expect(blocked.status).not.toBe(0);
    expect(blocked.stderr).toContain('oldDigest mismatch');
    expect(existsSync(fixture.target)).toBe(false);
    expect(readFileSync(fixture.stage, 'utf8')).toBe(recovery.nextSource);
    expect(readFileSync(archive, 'utf8')).toBe(thirdValue);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}, TCB_CLOSURE_FIXTURE_CASE_TIMEOUT_MS);

test('TCB closure raw CAPTURED census rejects non-canonical operation time without rollback', () => {
  const fixture = createTcbClosureCommandFixture();
  try {
    const oldSource = readFileSync(fixture.target, 'utf8');
    const plan = planTcbFixtureUpdate(fixture, '2026-08-09T11:30:00.000Z', 61);
    const operation = prepareRawTcbOperation(
      fixture,
      oldSource,
      plan.nextSource,
      '2026-08-09T11:30:00Z'
    );
    writeFileSync(fixture.stage, plan.nextSource, 'utf8');
    renameSync(fixture.target, operation.archivePath);

    const blocked = invokeTcbClosureCli(fixture, [
      'tcb-closure-lock', '--mode', 'apply', '--generated-at', '2026-08-09T11:30:00Z'
    ]);
    expect(blocked.status).not.toBe(0);
    expect(blocked.stderr).toContain('generatedAt must be canonical ISO-8601 UTC');
    expect(existsSync(fixture.target)).toBe(false);
    expect(readFileSync(fixture.stage, 'utf8')).toBe(plan.nextSource);
    expect(readFileSync(operation.archivePath, 'utf8')).toBe(oldSource);
    expect(existsSync(operation.recordPath)).toBe(true);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}, TCB_CLOSURE_FIXTURE_CASE_TIMEOUT_MS);

test('TCB closure CAPTURED rollback destination race preserves archive, stage and third value', () => {
  const fixture = createTcbClosureCommandFixture();
  try {
    const oldSource = readFileSync(fixture.target, 'utf8');
    installTcbTransactionRaceObserver(
      fixture,
      '.old.ts',
      'before-destination-final-fence',
      'destination-third-value'
    );
    const plan = planTcbFixtureUpdate(fixture, '2026-08-09T11:40:00.000Z', 62);
    const dryRun = successfulTcbClosureCli(fixture, [
      'tcb-closure-lock', '--mode', 'dry-run', '--generated-at', '2026-08-09T11:40:00.000Z'
    ]);
    const archive = tcbArchivePathFromResult(fixture, dryRun);
    prepareRecordedTcbOperation(fixture, dryRun);
    writeFileSync(fixture.stage, plan.nextSource, 'utf8');
    renameSync(fixture.target, archive);

    const blocked = invokeTcbClosureCli(fixture, [
      'tcb-closure-lock', '--mode', 'apply', '--generated-at', '2026-08-09T11:40:00.000Z'
    ]);
    expect(blocked.status).not.toBe(0);
    expect(blocked.stderr).toContain('destination final fence is occupied');
    expect(readFileSync(fixture.target, 'utf8')).toBe('destination third value');
    expect(readFileSync(fixture.stage, 'utf8')).toBe(plan.nextSource);
    expect(readFileSync(archive, 'utf8')).toBe(oldSource);
    expect(tcbOperationFiles(fixture)).toHaveLength(1);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}, TCB_CLOSURE_FIXTURE_CASE_TIMEOUT_MS);

test('TCB closure CAPTURED rollback never executes a semantically invalid staged source', () => {
  const fixture = createTcbClosureCommandFixture();
  try {
    const oldSource = readFileSync(fixture.target, 'utf8');
    const plan = planTcbFixtureUpdate(fixture, '2026-08-09T11:50:00.000Z', 63);
    const marker = path.join(fixture.root, '.semantic-invalid-stage-executed');
    const maliciousStage = `${plan.nextSource}\nawait Bun.write(${JSON.stringify(marker)}, 'executed');\n`;
    const operation = prepareRawTcbOperation(
      fixture,
      oldSource,
      maliciousStage,
      '2026-08-09T11:50:00.000Z'
    );
    writeFileSync(fixture.stage, maliciousStage, 'utf8');
    renameSync(fixture.target, operation.archivePath);

    const blocked = invokeTcbClosureCli(fixture, [
      'tcb-closure-lock', '--mode', 'apply', '--generated-at', '2026-08-09T11:50:00.000Z'
    ]);
    expect(blocked.status).not.toBe(0);
    expect(blocked.stderr).toContain('record does not bind its exact successor');
    expect(existsSync(marker)).toBe(false);
    expect(readFileSync(fixture.target, 'utf8')).toBe(oldSource);
    expect(readFileSync(fixture.stage, 'utf8')).toBe(maliciousStage);
    expect(existsSync(operation.archivePath)).toBe(false);
    expect(existsSync(operation.recordPath)).toBe(true);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}, TCB_CLOSURE_FIXTURE_CASE_TIMEOUT_MS);

for (const transition of [
  { label: 'target-to-archive', sourceSuffix: `${path.sep}tcb-closure-lock.ts` },
  { label: 'stage-to-target', sourceSuffix: `${path.sep}.tcb-closure-lock.ts.sec-stage-v2` }
] as const) {
  test(`TCB closure ${transition.label} rejects same-bytes different-object source substitution`, () => {
    const fixture = createTcbClosureCommandFixture();
    try {
      const originalSource = readFileSync(fixture.target, 'utf8');
      installTcbTransactionRaceObserver(
        fixture,
        transition.sourceSuffix,
        'before-current-entry-recheck',
        'same-bytes-object-substitution'
      );
      const plan = planTcbFixtureUpdate(fixture, '2026-08-09T12:00:00.000Z', 7);
      const blocked = invokeTcbClosureCli(fixture, [
        'tcb-closure-lock', '--mode', 'apply', '--generated-at', '2026-08-09T12:00:00.000Z'
      ]);
      expect(blocked.status).not.toBe(0);
      expect(blocked.stderr).toMatch(/retained (?:FileId\/volume|dev:ino) identity mismatch/u);
      const substitutedSource = transition.label === 'target-to-archive' ? fixture.target : fixture.stage;
      const expectedSource = transition.label === 'target-to-archive' ? originalSource : plan.nextSource;
      expect(readFileSync(substitutedSource, 'utf8')).toBe(expectedSource);
      expect(readFileSync(`${substitutedSource}.retained-object`, 'utf8')).toBe(expectedSource);
      if (transition.label === 'target-to-archive') {
        expect(readFileSync(fixture.target, 'utf8')).toBe(originalSource);
        expect(readFileSync(fixture.stage, 'utf8')).toBe(plan.nextSource);
        expect(tcbArchiveFiles(fixture)).toHaveLength(0);
      } else {
        expect(existsSync(fixture.target)).toBe(false);
        expect(tcbArchiveFiles(fixture)).toHaveLength(1);
        expect(readFileSync(path.join(fixture.archiveRoot, tcbArchiveFiles(fixture)[0]!), 'utf8'))
          .toBe(originalSource);
      }
      expect(tcbOperationFiles(fixture)).toHaveLength(1);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }, TCB_CLOSURE_FIXTURE_CASE_TIMEOUT_MS);
}

test('TCB closure destination final fence preserves the source and a concurrent third value', () => {
  const fixture = createTcbClosureCommandFixture();
  try {
    const originalSource = readFileSync(fixture.target, 'utf8');
    installTcbTransactionRaceObserver(
      fixture,
      `${path.sep}tcb-closure-lock.ts`,
      'before-destination-final-fence',
      'destination-third-value'
    );
    const plan = planTcbFixtureUpdate(fixture, '2026-08-09T13:00:00.000Z', 8);
    const blocked = invokeTcbClosureCli(fixture, [
      'tcb-closure-lock', '--mode', 'apply', '--generated-at', '2026-08-09T13:00:00.000Z'
    ]);
    expect(blocked.status).not.toBe(0);
    expect(blocked.stderr).toContain('destination final fence is occupied');
    expect(readFileSync(fixture.target, 'utf8')).toBe(originalSource);
    expect(readFileSync(fixture.stage, 'utf8')).toBe(plan.nextSource);
    expect(tcbArchiveFiles(fixture)).toHaveLength(1);
    expect(readFileSync(path.join(fixture.archiveRoot, tcbArchiveFiles(fixture)[0]!), 'utf8'))
      .toBe('destination third value');
    expect(tcbOperationFiles(fixture)).toHaveLength(1);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}, TCB_CLOSURE_FIXTURE_CASE_TIMEOUT_MS);

for (const swapped of ['target-parent', 'archive-ancestor'] as const) {
  test(`TCB closure rejects a ${swapped} junction or symlink without mutating observed bytes`, () => {
    const fixture = createTcbClosureCommandFixture();
    try {
      const originalSource = readFileSync(fixture.target, 'utf8');
      if (swapped === 'target-parent') {
        installTcbTransactionRaceObserver(
          fixture,
          '',
          'before-authority-open',
          'target-parent-junction'
        );
      }
      planTcbFixtureUpdate(fixture, '2026-08-09T14:00:00.000Z', 9);
      if (swapped === 'archive-ancestor') {
        const archiveAncestor = path.join(fixture.root, '.tmp', 'codex');
        const redirected = path.join(fixture.root, '.tmp', 'redirected-codex');
        mkdirSync(path.dirname(archiveAncestor), { recursive: true });
        mkdirSync(redirected, { recursive: true });
        symlinkSync(redirected, archiveAncestor, process.platform === 'win32' ? 'junction' : 'dir');
      }
      const blocked = invokeTcbClosureCli(fixture, [
        'tcb-closure-lock', '--mode', 'apply', '--generated-at', '2026-08-09T14:00:00.000Z'
      ]);
      expect(blocked.status).not.toBe(0);
      expect(blocked.stderr).toMatch(/non-reparse|openat failed/u);
      expect(readFileSync(fixture.target, 'utf8')).toBe(originalSource);
      expect(existsSync(fixture.stage)).toBe(false);
      expect(tcbArchiveFiles(fixture)).toHaveLength(0);
      expect(tcbOperationFiles(fixture)).toHaveLength(0);
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  }, TCB_CLOSURE_FIXTURE_CASE_TIMEOUT_MS);
}

test('CI runner executes every ordinary gate through Action and publishes only V4', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-ci-action-'));
  try {
    let evidence: CodexDevelopmentVerificationEvidenceV4 | null = null;
    const calls: string[] = [];
    const code = await CodexDevelopmentCiVerificationMain({
      ...baseOptions(root),
      runGate: async (gate) => {
        calls.push(gate.id);
        return { code: 0, rawOutputDigest: RAW, failureTail: '' };
      },
      writeEvidenceV4: (_file, value) => { evidence = value; }
    });
    expect(code).toBe(0);
    expect(calls.length).toBeGreaterThan(0);
    const captured = evidence as CodexDevelopmentVerificationEvidenceV4 | null;
    expect(captured?.schema).toBe('codex-development-verification-evidence-v4');
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
    const transition = CodexDevelopmentCreateTestImpactTransitionObservationV1({
      baseSha: BASE,
      headSha: HEAD,
      records: [{ status: 'changed', path: 'platform/orchestrator.ts' }],
      readPathBlob: () => null
    });
    expect(await CodexDevelopmentCiVerificationMain({
      ...baseOptions(root),
      transitionObservation: transition,
      writeEvidenceV4: () => undefined
    })).toBe(1);
    const { changedFiles: _changedFiles, ...recordOptions } = baseOptions(root);
    void _changedFiles;
    expect(await CodexDevelopmentCiVerificationMain({
      ...recordOptions,
      changedRecords: () => [{ status: 'added', path: 'platform/orchestrator.ts' }],
      transitionObservation: transition,
      writeEvidenceV4: () => undefined
    })).toBe(1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('multi-commit candidate uses exact current base and never requires HEAD^1', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-ci-multicommit-'));
  try {
    const refs: string[] = [];
    const code = await CodexDevelopmentCiVerificationMain({
      ...baseOptions(root),
      gitRevision: (ref) => {
        refs.push(ref);
        if (ref === 'HEAD^1') throw new Error('single-parent assumption is retired');
        return revisions(ref);
      },
      writeEvidenceV4: () => undefined
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
    const code = await CodexDevelopmentCiVerificationMain({
      ...baseOptions(root),
      env: { ...baseOptions(root).env, SEC_FORMAL_HOSTED_MODE: '1' },
      runGate: async () => {
        spawns += 1;
        return { code: 0, rawOutputDigest: RAW, failureTail: '' };
      },
      writeEvidenceV4: () => { writes += 1; }
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
    expect(await CodexDevelopmentCiVerificationMain({
      ...baseOptions(root),
      writeEvidenceV4: () => undefined
    })).toBe(0);
    let physical = 0;
    let writes = 0;
    expect(await CodexDevelopmentCiVerificationMain({
      ...baseOptions(root),
      runGate: async () => {
        physical += 1;
        return { code: 0, rawOutputDigest: RAW, failureTail: '' };
      },
      writeEvidenceV4: () => { writes += 1; }
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
    let first: CodexDevelopmentVerificationEvidenceV4 | null = null;
    expect(await CodexDevelopmentCiVerificationMain({
      ...baseOptions(root),
      runGate: async () => ({ code: 1, rawOutputDigest: RAW, failureTail: 'known failure' }),
      writeEvidenceV4: (_file, value) => { first = value; }
    })).toBe(1);
    const terminal = first as unknown as CodexDevelopmentVerificationEvidenceV4;
    expect(terminal.status).toBe('failed');
    const byActionKey = new Map(terminal.gates.map((gate) => [gate.action.actionKey, gate.result]));
    let physical = 0;
    let reused: CodexDevelopmentVerificationEvidenceV4 | null = null;
    expect(await CodexDevelopmentCiVerificationMain({
      ...baseOptions(root),
      runGate: async () => {
        physical += 1;
        return { code: 0, rawOutputDigest: RAW, failureTail: '' };
      },
      readDurableActionResult: (actionKey) => {
        const result = byActionKey.get(actionKey);
        return result === undefined ? null : { result, evidenceRefs: ['artifact://known-failure'] };
      },
      writeEvidenceV4: (_file, value) => { reused = value; }
    })).toBe(1);
    expect(physical).toBe(0);
    const second = reused as unknown as CodexDevelopmentVerificationEvidenceV4;
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

    expect(() => CodexDevelopmentAssertTrustedBootstrapSutMaterializationCleanV1({
      baseRoot, candidateRoot
    })).not.toThrow();

    const foreignBasePath = path.join(baseRoot, 'foreign.txt');
    writeFileSync(foreignBasePath, 'foreign\n');
    expect(() => CodexDevelopmentAssertTrustedBootstrapSutMaterializationCleanV1({
      baseRoot, candidateRoot
    })).toThrow(/clean base and candidate/);
    rmSync(foreignBasePath);

    const ignoredBasePath = path.join(baseRoot, 'ignored-residue.txt');
    writeFileSync(ignoredBasePath, 'ignored foreign base bytes\n');
    expect(() => CodexDevelopmentAssertTrustedBootstrapSutMaterializationCleanV1({
      baseRoot, candidateRoot
    })).toThrow(/clean base and candidate/);
    rmSync(ignoredBasePath);

    const dirtyCandidatePath = path.join(candidateRoot, 'dirty.txt');
    writeFileSync(dirtyCandidatePath, 'dirty\n');
    expect(() => CodexDevelopmentAssertTrustedBootstrapSutMaterializationCleanV1({
      baseRoot, candidateRoot
    })).toThrow(/clean base and candidate/);
    rmSync(dirtyCandidatePath);

    const ignoredCandidatePath = path.join(candidateRoot, 'ignored-residue.txt');
    writeFileSync(ignoredCandidatePath, 'ignored foreign candidate bytes\n');
    expect(() => CodexDevelopmentAssertTrustedBootstrapSutMaterializationCleanV1({
      baseRoot, candidateRoot
    })).toThrow(/clean base and candidate/);
    rmSync(ignoredCandidatePath);

    const candidateSubdirectory = path.join(candidateRoot, 'nested');
    mkdirSync(candidateSubdirectory);
    expect(() => CodexDevelopmentAssertTrustedBootstrapSutMaterializationCleanV1({
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
    const inventory = (archive: string): CodexDevelopmentHostedActionArchiveInventoryV2 => ({
      archiveDigest: bytesDigest(readFileSync(archive)),
      inventoryDigest: digest('0'),
      entryCount: 20,
      totalFileBytes: 4096,
      dependencyClosureDigest: DEPENDENCY_CLOSURE,
      gitBundleDigest: GIT_CLOSURE
    });
    let executionPlan: Parameters<typeof CodexDevelopmentAssertHostedSutSandboxCommandPlanV1>[0] | null = null;
    const retainedArchiveBytes: string[] = [];
    const cleanInventory = inventory(cleanArchive);
    const cleanTicket = hostedTicket(resolution, cleanInventory);
    const clean = await CodexDevelopmentExecuteHostedActionSutV2({
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
          return sandboxObservation(0, '__SEC_HOSTED_SANDBOX_RESIDUE_EMPTY_V1__:direct-process-closed');
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
    const cleanTerminal = CodexDevelopmentAssembleHostedActionTerminalV2({
      resolution, ticket: cleanTicket, rawResult: clean,
      expectedRawResultDigest: clean.rawResultDigest, producer: hostedProducer
    });
    expect(cleanTerminal.cleanup).toMatchObject({ status: 'passed', diagnostic: null });
    expect(cleanTerminal.cleanup.evidenceRefs).toEqual([
      `sandbox-receipt:${clean.sandboxReceipt.receiptDigest}`
    ]);
    expect(executionPlan).not.toBeNull();
    expect(retainedArchiveBytes).toEqual(['authenticated-clean-archive']);
    expect(JSON.stringify(executionPlan!.argv)).not.toContain(cleanArchive);
    expect(() => CodexDevelopmentAssertHostedSutSandboxCommandPlanV1(executionPlan!)).not.toThrow();
    expect(executionPlan!.argv.slice(-directBunTestArgv.length)).toEqual(directBunTestArgv);
    expect(cleanTerminal.result.execution?.argv).toEqual(directBunTestArgv);
    expect(executionPlan!.candidateEnvironmentNames).toContain('SEC_FORMAL_HOSTED_MODE');
    for (const name of [
      'SAFE_INPUT', 'GH_TOKEN', 'gh_token', 'GITHUB_TOKEN', 'Actions_Custom_Token',
      'GITHUB_ENV', 'ACTIONS_ID_TOKEN_REQUEST_URL'
    ]) expect(executionPlan!.candidateEnvironmentNames).not.toContain(name);

    const dirtyInventory = inventory(dirtyArchive);
    const dirtyTicket = hostedTicket(resolution, dirtyInventory);
    const dirty = await CodexDevelopmentExecuteHostedActionSutV2({
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
          return sandboxObservation(0, '__SEC_HOSTED_SANDBOX_RESIDUE_EMPTY_V1__:direct-process-closed');
        }
        writeFileSync(dirtyArchive, 'substituted archive bytes');
        return sandboxObservation(0, 'candidate could not write host input');
      }
    });
    const dirtyTerminal = CodexDevelopmentAssembleHostedActionTerminalV2({
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
  const executionAuthorization = CodexDevelopmentCreateHostedSutExecutionAuthorizationV1({
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
  const plan = CodexDevelopmentBuildHostedSutSandboxCommandPlanV1({
    actionKey: resolution.actionPlan.action.actionKey,
    candidateArchiveDigest: ticket.preparedCandidateArchiveDigest,
    bunExecutable: path.resolve('/trusted/tool/bun'),
    baseSha: normalizedOperation.candidate.baseSha,
    headSha: normalizedOperation.candidate.headSha,
    normalizedArgv: executionAuthorization.normalizedArgv,
    candidateEnvironment: CodexDevelopmentHostedSutCandidateEnvironmentV1({
      normalizedOperation,
      manifestPath: resolution.artifactInput.manifestPath
    }),
    executionAuthorization
  });
  expect(() => CodexDevelopmentAssertHostedSutSandboxCommandPlanV1(plan)).not.toThrow();
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
  for (const forbidden of [
    'GITHUB_OUTPUT', 'GH_TOKEN', '/host/output', '/var/run/docker.sock', '/run/docker.sock',
    '/home/runner/work', 'RUNNER_TEMP', 'verification-action-raw-result.json',
    'mount --bind /usr', '/usr/bin/sudo', '/usr/bin/systemd-run'
  ]) expect(encoded).not.toContain(forbidden);
  expect(plan.candidateEnvironmentNames).toEqual(
    executionAuthorization.physicalCommand.fixedSandboxEnvironment.map((entry) => entry.name)
  );
  const bootstrapPlan = CodexDevelopmentBuildTrustedBootstrapSutSandboxCommandPlanV1({
    bootstrapDigest: digest('b'),
    candidateArchiveDigest: digest('a'),
    bunExecutable: path.resolve('/trusted/tool/bun'),
    baseSha: normalizedOperation.candidate.baseSha,
    headSha: normalizedOperation.candidate.headSha,
    candidateEnvironment: CodexDevelopmentCandidateProcessEnvironmentV2({}, {
      SEC_BOOTSTRAP_BASE: normalizedOperation.candidate.baseSha,
      SEC_BOOTSTRAP_HEAD: normalizedOperation.candidate.headSha,
      SEC_BOOTSTRAP_TREE: TREE
    }),
    unitNonce: 'bootstrap-contract'
  });
  expect(() => CodexDevelopmentAssertHostedSutSandboxCommandPlanV1(bootstrapPlan)).not.toThrow();
  expect(bootstrapPlan.phase).toBe('bootstrap-execute');
  expect(bootstrapPlan.executionAuthorizationDigest).toBeNull();
  expect(bootstrapPlan.physicalCommandProjectionDigest).toBeNull();
  expect(bootstrapPlan.argv.at(-1)).toBe(CodexDevelopmentTrustedBootstrapSutHarnessV1);
  expect(JSON.stringify(bootstrapPlan.argv)).not.toContain('GITHUB_OUTPUT');
});

test('Linux retained archive descriptor defeats pathname ABA before private sandbox copy', () => {
  if (process.platform !== 'linux') return;
  const root = mkdtempSync(path.join(tmpdir(), 'sec-sut-retained-archive-'));
  const archive = path.join(root, 'prepared-candidate.tar');
  const movedArchive = path.join(root, 'prepared-candidate.authenticated.tar');
  const privateCopy = path.join(root, 'private-copy.tar');
  const executionMarker = path.join(root, 'executed');
  const expectedBytes = 'authenticated dependency archive\n';
  const maliciousBytes = 'malicious replacement dependency archive\n';
  let authenticatedFd: number | null = null;
  let maliciousFd: number | null = null;
  const copyAndAuthenticate = [
    '/usr/bin/cat -- /proc/self/fd/3 > "$1"',
    '[ "sha256:$(/usr/bin/sha256sum "$1" | /usr/bin/cut -d " " -f 1)" = "$2" ]',
    'printf executed > "$3"'
  ].join('\n');
  try {
    writeFileSync(archive, expectedBytes);
    authenticatedFd = openSync(archive, 'r');
    renameSync(archive, movedArchive);
    writeFileSync(archive, maliciousBytes);
    const expectedDigest = bytesDigest(expectedBytes);
    const retained = spawnSync('/usr/bin/bash', [
      '-ceu', copyAndAuthenticate, 'sec-retained-archive', privateCopy, expectedDigest, executionMarker
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe', authenticatedFd]
    });
    expect(retained.status).toBe(0);
    expect(readFileSync(privateCopy, 'utf8')).toBe(expectedBytes);
    expect(readFileSync(executionMarker, 'utf8')).toBe('executed');

    rmSync(privateCopy);
    rmSync(executionMarker);
    maliciousFd = openSync(archive, 'r');
    const substituted = spawnSync('/usr/bin/bash', [
      '-ceu', copyAndAuthenticate, 'sec-retained-archive', privateCopy, expectedDigest, executionMarker
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe', maliciousFd]
    });
    expect(substituted.status).not.toBe(0);
    expect(readFileSync(privateCopy, 'utf8')).toBe(maliciousBytes);
    expect(existsSync(executionMarker)).toBe(false);
  } finally {
    if (authenticatedFd !== null) closeSync(authenticatedFd);
    if (maliciousFd !== null) closeSync(maliciousFd);
    rmSync(root, { recursive: true, force: true });
  }
});

test('parent event binds the canonical one-key Session request wrapper', () => {
  const sessionRequest: VerificationSessionHostedRequestV1 = Object.freeze({
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
  expect(() => CodexDevelopmentAssertHostedActionParentEventV2(
    canonicalEvent,
    sessionRequest
  )).not.toThrow();
  expect(() => CodexDevelopmentAssertHostedActionParentEventV2(
    { ...canonicalEvent, action: 'wrong-session-event' },
    sessionRequest
  )).toThrow('exact Session request wrapper');
  expect(() => CodexDevelopmentAssertHostedActionParentEventV2(
    { ...canonicalEvent, client_payload: sessionRequest },
    sessionRequest
  )).toThrow('exact Session request wrapper');
  expect(() => CodexDevelopmentAssertHostedActionParentEventV2(
    { ...canonicalEvent, client_payload: { payload: sessionRequest, extra: true } },
    sessionRequest
  )).toThrow('exact Session request wrapper');
});

test('capability probe detaches its deliberate residue child for trusted teardown', async () => {
  const observation = await CodexDevelopmentProbeHostedSutSandboxCapabilityV1({
    actionKey: digest('a'),
    platform: 'linux',
    unitNonce: 'settled-probe',
    runSandboxProcess: async (plan) => {
      if (plan.phase === 'capability-self-test') {
        return sandboxObservation(0, '__SEC_HOSTED_SANDBOX_CAPABILITY_V1__');
      }
      return sandboxObservation(0, '__SEC_HOSTED_SANDBOX_RESIDUE_EMPTY_V1__:direct-process-closed');
    }
  });
  expect(observation).toMatchObject({ state: 'supported', cgroupEmpty: true });

  const assertion = CodexDevelopmentHostedSutCapabilityAssertionV1;
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

  const runnableLifecycle = 'const { spawn } = require("node:child_process");' +
    'const descendant = spawn(process.execPath, ["-e", "setTimeout(() => {}, 300000)"], ' +
    '{ detached: true, stdio: "ignore" });descendant.unref();';
  const root = mkdtempSync(path.join(tmpdir(), 'sec-hosted-detached-probe-'));
  const pidPath = path.join(root, 'descendant.pid');
  let descendantPid: number | null = null;
  const processExists = (pid: number): boolean => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  try {
    const startedAt = performance.now();
    const settled = spawnSync(process.execPath, [
      '-e', `${runnableLifecycle}require("node:fs").writeFileSync(${JSON.stringify(pidPath)}, ` +
        'String(descendant.pid));process.stdout.write("detached");'
    ], { encoding: 'utf8', timeout: 3_000, windowsHide: true });
    expect(settled.error).toBeUndefined();
    expect(settled.status).toBe(0);
    expect(performance.now() - startedAt).toBeLessThan(3_000);
    descendantPid = Number(readFileSync(pidPath, 'utf8'));
    expect(Number.isSafeInteger(descendantPid) && descendantPid > 0).toBe(true);
    expect(processExists(descendantPid)).toBe(true);
  } finally {
    if (descendantPid === null && existsSync(pidPath)) {
      const observedPid = Number(readFileSync(pidPath, 'utf8'));
      if (Number.isSafeInteger(observedPid) && observedPid > 0) descendantPid = observedPid;
    }
    if (descendantPid !== null && processExists(descendantPid)) {
      try { process.kill(descendantPid, 'SIGKILL'); } catch {}
      const cleanupDeadline = Date.now() + 3_000;
      while (processExists(descendantPid) && Date.now() < cleanupDeadline) Bun.sleepSync(10);
    }
    rmSync(root, { recursive: true, force: true });
  }
  expect(descendantPid).not.toBeNull();
  expect(processExists(descendantPid!)).toBe(false);
});

test('capability unsupported or ambiguous terminalizes without invoking the candidate executor', async () => {
  const resolution = hostedResolution();
  const root = mkdtempSync(path.join(tmpdir(), 'sec-hosted-capability-'));
  const archive = path.join(root, 'prepared-candidate.tar');
  writeFileSync(archive, 'capability-fixture');
  const archiveInventory: CodexDevelopmentHostedActionArchiveInventoryV2 = {
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
    const unsupported = await CodexDevelopmentExecuteHostedActionSutV2({
      resolution, ticket, candidateArchive: archive, archiveInventory,
      platform: 'linux', unitNonce: 'unsupported', now: clock(),
      runSandboxProcess: async (plan) => {
        if (plan.phase === 'execute') executions += 1;
        if (plan.phase === 'teardown') {
          return sandboxObservation(0, '__SEC_HOSTED_SANDBOX_RESIDUE_EMPTY_V1__:direct-process-closed');
        }
        capabilityPlan = plan.argv.join('\n');
        return sandboxObservation(1, 'unshare: Operation not permitted');
      }
    });
    const unsupportedTerminal = CodexDevelopmentAssembleHostedActionTerminalV2({
      resolution, ticket, rawResult: unsupported,
      expectedRawResultDigest: unsupported.rawResultDigest, producer: hostedProducer
    });
    expect(unsupportedTerminal.result).toMatchObject({ status: 'unsupported', disposition: 'not-executed' });
    expect(unsupported.sandboxReceipt.execution.started).toBe(false);
    expect(executions).toBe(0);
    for (const invariant of [
      'SEC_HOST_SANDBOX_SENTINEL', '/proc/1/environ', '/proc/net/route',
      'fetch("http://1.1.1.1', 'spawn("/usr/bin/sleep"', 'host-usr-or-proc-mount',
      'inherited-fd', 'cgroup-limits', '/home/runner/work', '/actions-runner/_work/_actions'
    ]) expect(CodexDevelopmentHostedSutCapabilityAssertionV1).toContain(invariant);
    expect(CodexDevelopmentHostedSutCapabilityAssertionV1).not.toContain('process.pid !== 1');
    expect(CodexDevelopmentHostedSutCapabilityAssertionV1).toContain('error?.code !== "ENOENT"');
    expect(CodexDevelopmentHostedSutCapabilityAssertionV1).toStartWith('(async () => {');
    expect(CodexDevelopmentHostedSutCapabilityAssertionV1).toContain(
      '})().catch((error) => { console.error(error); process.exitCode = 1; });'
    );
    for (const invariant of [
      'runtime-binary-closure', '/usr/sbin/chroot', '--kill-child=KILL'
    ]) expect(capabilityPlan).toContain(invariant);
    const productionSource = await Bun.file(
      new URL('../../scripts/ci-verification.ts', import.meta.url)
    ).text();
    expect(productionSource).toContain(
      'shellSingleQuoteV1(HOSTED_SUT_CHROOT_CAPABILITY_SCRIPT_V1)'
    );
    expect(productionSource).toContain(
      'shellSingleQuoteV1(HOSTED_SUT_CHROOT_EXECUTION_SCRIPT_V1)'
    );
    expect(productionSource).not.toContain(
      'JSON.stringify(HOSTED_SUT_CHROOT_CAPABILITY_SCRIPT_V1)'
    );
    expect(productionSource.match(/rm -rf -- "\$root" >\/dev\/null 2>&1 \|\| true/gu)).toHaveLength(2);
    expect(productionSource).toContain(
      'shellSingleQuoteV1(CodexDevelopmentHostedSutCapabilityAssertionV1)'
    );
    for (const forbidden of ['mount --bind /usr', '/var/run/docker.sock']) {
      expect(capabilityPlan).not.toContain(forbidden);
    }

    const ambiguous = await CodexDevelopmentExecuteHostedActionSutV2({
      resolution, ticket, candidateArchive: archive, archiveInventory,
      platform: 'linux', unitNonce: 'ambiguous', now: clock(),
      runSandboxProcess: async (plan) => {
        if (plan.phase === 'execute') executions += 1;
        if (plan.phase === 'teardown') {
          return sandboxObservation(0, '__SEC_HOSTED_SANDBOX_RESIDUE_EMPTY_V1__:direct-process-closed');
        }
        throw new Error('supervisor channel disappeared before process start');
      }
    });
    const ambiguousTerminal = CodexDevelopmentAssembleHostedActionTerminalV2({
      resolution, ticket, rawResult: ambiguous,
      expectedRawResultDigest: ambiguous.rawResultDigest, producer: hostedProducer
    });
    expect(ambiguousTerminal.result).toMatchObject({ status: 'invalidated', disposition: 'not-executed' });
    expect(ambiguous.sandboxReceipt.residue.cgroupEmpty).toBe(false);
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
    const raw = await CodexDevelopmentExecuteHostedActionSutV2({
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
          return sandboxObservation(0, '__SEC_HOSTED_SANDBOX_RESIDUE_EMPTY_V1__:direct-process-closed');
        }
        return sandboxObservation(
          125,
          '::set-output name=x::owned\n::add-mask::mask\n::stop-commands::token\n\u001b[31mcontrol\u0000',
          { truncated: true }
        );
      }
    });
    const terminal = CodexDevelopmentAssembleHostedActionTerminalV2({
      resolution, ticket, rawResult: raw,
      expectedRawResultDigest: raw.rawResultDigest, producer: hostedProducer
    });
    expect(terminal.result).toMatchObject({ status: 'invalidated', disposition: 'not-executed' });
    expect(raw.sandboxReceipt.execution.outputTruncated).toBe(true);
    expect(typeof raw.sandboxReceipt.execution.stdoutBytesObserved).toBe('number');
    expect(readFileSync(commandFile, 'utf8')).toBe('unchanged\n');
    const encoded = encodeVerificationActionDataV2(raw);
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
  expect(() => CodexDevelopmentValidateHostedActionArchiveInventoryV2(trusted)).not.toThrow();
  expect(() => CodexDevelopmentValidateHostedActionArchiveInventoryV2([
    ...trusted,
    entry('node_modules/gitnexus/vendor/tree-sitter-proto/binding.gyp'),
    entry('node_modules/gitnexus/node_modules/tree-sitter-proto/binding.gyp', 'symlink', {
      linkTarget: '../../vendor/tree-sitter-proto/binding.gyp'
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
    [entry('setuid', 'file', { mode: 0o4755 })]
  ];
  for (const inventory of hostile) {
    expect(() => CodexDevelopmentValidateHostedActionArchiveInventoryV2([
      ...trusted, ...inventory
    ])).toThrow();
  }
  expect(() => CodexDevelopmentValidateHostedActionArchiveInventoryV2([
    ...trusted,
    entry('loop', 'directory'),
    entry('loop/child', 'directory'),
    entry('loop/child/link', 'symlink', { linkTarget: '..' })
  ])).toThrow(/targets itself or an ancestor/u);
});

test('trusted bootstrap dependency archive projection is source-read-only and binds one physical generation', () => {
  const productionSource = readFileSync(path.join(compilerRoot, 'scripts', 'ci-verification.ts'), 'utf8');
  const prepareStart = productionSource.indexOf(
    'export function CodexDevelopmentPrepareTrustedBootstrapSutInputsV1'
  );
  const prepareEnd = productionSource.indexOf(
    'export function CodexDevelopmentMaterializeHostedActionCandidateV2',
    prepareStart
  );
  const prepareSource = productionSource.slice(prepareStart, prepareEnd);
  expect(prepareStart).toBeGreaterThanOrEqual(0);
  expect(prepareEnd).toBeGreaterThan(prepareStart);
  expect(prepareSource.indexOf('CodexDevelopmentCaptureHostedDependencyPhysicalSnapshotV1(baseNodeModules)'))
    .toBeGreaterThan(prepareSource.indexOf('CodexDevelopmentRunBoundedDependencyMaterializationV1'));
  expect(prepareSource.indexOf('CodexDevelopmentMaterializeTrustedBootstrapArchiveV3({'))
    .toBeGreaterThan(prepareSource.indexOf("'bundle', 'verify'"));
  expect(prepareSource.indexOf('CodexDevelopmentInspectHostedActionArchiveInventoryV3('))
    .toBeGreaterThan(prepareSource.indexOf('CodexDevelopmentMaterializeTrustedBootstrapArchiveV3({'));
  expect(prepareSource.indexOf('CodexDevelopmentAssertHostedDependencyArchiveProjectionV1({'))
    .toBeGreaterThan(prepareSource.indexOf('CodexDevelopmentInspectHostedActionArchiveInventoryV3('));
  expect(productionSource).toContain(
    'dependencyArchiveProjection: prepared.dependencyArchiveProjection'
  );
  expect(productionSource).not.toContain('CodexDevelopmentNormalizeHostedDependencySymlinkClosureV1');
  expect(productionSource).not.toContain('.sec-relocatable-link-');
  expect(productionSource).toContain('os.O_PATH | os.O_NOFOLLOW');
  expect(productionSource).toContain('os.readlink("", dir_fd=link_fd)');
  expect(productionSource).not.toContain('os.readlink(name, dir_fd=directory_fd)');

  const fileDigest = digest('6');
  const otherDigest = digest('7');
  const rootIdentity = Object.freeze({
    schema: 'sec-physical-no-follow-v1' as const,
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
  const archiveEntries = CodexDevelopmentValidateHostedActionArchiveInventoryV2([
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
  expect(CodexDevelopmentAssertHostedDependencyArchiveProjectionV1({
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
    expect(() => CodexDevelopmentAssertHostedDependencyArchiveProjectionV1({
      before, after, archiveEntries
    })).toThrow(/physical generation changed/u);
  }
  expect(() => CodexDevelopmentAssertHostedDependencyArchiveProjectionV1({
    before,
    after: before,
    archiveEntries: archiveEntries.map((entry) => entry.path === 'node_modules/pkg/target.txt'
      ? Object.freeze({ ...entry, physicalContentDigest: digest('5') }) : entry)
  })).toThrow(/file differs/u);
  expect(() => CodexDevelopmentAssertHostedDependencyArchiveProjectionV1({
    before,
    after: before,
    archiveEntries: archiveEntries.map((entry) => entry.path === 'node_modules/pkg/link.txt'
      ? Object.freeze({ ...entry, linkTarget: 'node_modules/pkg/other.txt' }) : entry)
  })).toThrow(/link differs/u);
  expect(() => CodexDevelopmentAssertHostedDependencyArchiveProjectionV1({
    before,
    after: before,
    archiveEntries: archiveEntries.slice(0, -1)
  })).toThrow(/missing, duplicate, or foreign/u);
  expect(() => CodexDevelopmentAssertHostedDependencyArchiveProjectionV1({
    before: changedAfter('pkg/link.txt', { linkTarget: '/host/secret' }),
    after: changedAfter('pkg/link.txt', { linkTarget: '/host/secret' }),
    archiveEntries
  })).toThrow(/escapes/u);
  expect(() => CodexDevelopmentAssertHostedDependencyArchiveProjectionV1({
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
    const before = CodexDevelopmentCaptureHostedDependencyPhysicalSnapshotV1(dependencyRoot);
    const archive = CodexDevelopmentMaterializeTrustedBootstrapArchiveV3({
      candidateRoot,
      dependencySnapshot: before,
      outputDirectory
    });
    const inventory = CodexDevelopmentInspectHostedActionArchiveInventoryV3(archive);
    const after = CodexDevelopmentCaptureHostedDependencyPhysicalSnapshotV1(dependencyRoot);
    expect(CodexDevelopmentAssertHostedDependencyArchiveProjectionV1({
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
    const inspected = CodexDevelopmentInspectHostedActionArchiveV2({
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
    expect(() => CodexDevelopmentInspectHostedActionArchiveV2({
      resolution,
      preparedCandidateArchive: archive,
      baseDependencyClosureDigest: digest('7'),
      authenticatedGitClosureDigest: gitBundleDigest,
      inspectArchive: () => inventory
    })).toThrow(/differs from trusted pre-start inputs/u);
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
    expect(CodexDevelopmentHostedDependencyMaterializerEnvironmentV1()).toEqual({
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
  expect(CodexDevelopmentRunBoundedDependencyMaterializationV1(() => {
    recoveredAttempts += 1;
    if (recoveredAttempts === 1) throw retryable;
  })).toEqual({ attempts: 2, recoveredFrom: 'bun-tarball-extraction' });
  expect(recoveredAttempts).toBe(2);

  const terminal = new Error('error: lockfile had changes, but lockfile is frozen');
  let terminalAttempts = 0;
  expect(() => CodexDevelopmentRunBoundedDependencyMaterializationV1(() => {
    terminalAttempts += 1;
    throw terminal;
  })).toThrow(terminal);
  expect(terminalAttempts).toBe(1);

  let repeatedExtractionAttempts = 0;
  expect(() => CodexDevelopmentRunBoundedDependencyMaterializationV1(() => {
    repeatedExtractionAttempts += 1;
    throw retryable;
  })).toThrow(/after one bounded Bun tarball-extraction recovery retry/u);
  expect(repeatedExtractionAttempts).toBe(2);
});

test('canonical terminal artifact derives four physical Result states while raw not-run is impossible', () => {
  const resolution = hostedResolution();
  const ticket = hostedTicket(resolution);
  let passedArtifact: ReturnType<typeof CodexDevelopmentAssembleHostedActionTerminalV2> | null = null;
  for (const status of ['passed', 'failed', 'unsupported', 'invalidated'] as const) {
    const rawResult = hostedRawResult(resolution, status);
    const artifact = CodexDevelopmentAssembleHostedActionTerminalV2({
      resolution,
      ticket,
      rawResult,
      expectedRawResultDigest: rawResult.rawResultDigest,
      producer: hostedProducer
    });
    expect(artifact.result.status).toBe(status);
    if (status === 'passed') passedArtifact = artifact;
    expect(artifact.producer).toEqual(hostedProducer);
    expect(() => CodexDevelopmentAssertVerificationActionTerminalArtifactV2(artifact, {
      actionPlan: resolution.actionPlan,
      executionEnvironmentRevision:
        CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT_V2.executionEnvironmentRevision
    })).not.toThrow();
  }
  expect(passedArtifact).not.toBeNull();
  const contradictory = structuredClone(passedArtifact!);
  (contradictory.result.execution as { outputDigest: VerificationActionKeyDigest }).outputDigest = digest('f');
  const { artifactDigest: ignoredArtifactDigest, ...withoutArtifactDigest } = contradictory;
  void ignoredArtifactDigest;
  (contradictory as { artifactDigest: VerificationActionKeyDigest }).artifactDigest =
    CodexDevelopmentVerificationDigest(withoutArtifactDigest) as VerificationActionKeyDigest;
  expect(() => CodexDevelopmentAssertVerificationActionTerminalArtifactV2(contradictory, {
    actionPlan: resolution.actionPlan
  })).toThrow(/execution proof does not replay/u);
});

test('hosted coordinator and composer preserve four physical terminals while coordinator owns not-run', () => {
  const closure = hostedDagClosure([[]]);
  const envelope = hostedEnvelopeFixture(closure);
  for (const status of ['passed', 'failed', 'unsupported', 'invalidated'] as const) {
    const provider = hostedProviderInputs(envelope, new Map([[0, { status }]]));
    const coordination = CodexDevelopmentCoordinateHostedActionsV2({ envelope, ...provider });
    expect(coordination).toMatchObject({
      disposition: 'complete',
      dispatchActionKeys: [],
      missingActionKeys: []
    });
    const composed = CodexDevelopmentComposeHostedEvidenceV2({
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
      verificationActionProviderTerminalDescriptionV2(
        provider.terminalAnchorObservations[0]!.payload!.anchorDigest
      )
    );
    expect(terminalStatus.description).not.toContain(status);
  }

  const cleanupFailedProvider = hostedProviderInputs(envelope, new Map([[
    0,
    { status: 'invalidated' as const }
  ]]));
  const cleanupFailed = CodexDevelopmentComposeHostedEvidenceV2({
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
    const coordination = CodexDevelopmentCoordinateHostedActionsV2({ envelope, ...partial });
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
    const completed = CodexDevelopmentComposeHostedEvidenceV2({
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
  expect(CodexDevelopmentCoordinateHostedActionsV2({
    envelope,
    ...passedDependency
  })).toMatchObject({
    disposition: 'dispatch',
    dispatchActionKeys: [closure.actions[1]!.action.actionKey]
  });

  const pendingDependency = hostedProviderInputs(envelope, new Map());
  const pending = CodexDevelopmentCoordinateHostedActionsV2({
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
  const coordination = CodexDevelopmentCoordinateHostedActionsV2({ envelope, ...expired });
  expect(coordination.disposition).toBe('blocked');
  expect(coordination.dispatchActionKeys).toEqual([]);
  expect(coordination.reason).toContain('retained out');
  expect(CodexDevelopmentComposeHostedEvidenceV2({
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
  expect(() => CodexDevelopmentCoordinateHostedActionsV2({
    envelope: omittedPrerequisiteEnvelope,
    ...provider
  })).toThrow('does not resolve to exactly one Action member');
  expect(() => CodexDevelopmentComposeHostedEvidenceV2({
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
  const artifact = CodexDevelopmentAssembleHostedActionTerminalV2({
    resolution: left,
    ticket: hostedTicket(left),
    rawResult,
    expectedRawResultDigest: rawResult.rawResultDigest,
    producer: hostedProducer
  });
  expect(() => CodexDevelopmentAssertVerificationActionTerminalArtifactV2(artifact, {
    actionPlan: right.actionPlan,
    executionEnvironmentRevision:
      CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT_V2.executionEnvironmentRevision
  })).not.toThrow();
  expect(encodeVerificationActionDataV2(artifact)).not.toContain(left.actionPlanClosure.actionPlanDigest);
  expect(encodeVerificationActionDataV2(artifact)).not.toContain(right.actionPlanClosure.actionPlanDigest);
});

test('test backend serializes one shared ActionKey while different roots and closures join one origin', async () => {
  const gates = hostedGates();
  const left = hostedResolution([gates[0]!, gates[1]!]);
  const right = hostedResolution([gates[0]!, gates[2]!]);
  const uniqueLeft = left.actionPlanClosure.actions[1]!.action.actionKey;
  const uniqueRight = right.actionPlanClosure.actions[1]!.action.actionKey;
  const shared = left.actionPlan.action.actionKey;
  const terminalOrigins = new Map<VerificationActionKeyDigest, string>();
  const inFlight = new Map<VerificationActionKeyDigest, Promise<string>>();
  const physical = new Map<VerificationActionKeyDigest, number>();
  const active = new Map<VerificationActionKeyDigest, number>();
  let maximumSameKeyActive = 0;
  const execute = async (actionKey: VerificationActionKeyDigest): Promise<string> => {
    const terminal = terminalOrigins.get(actionKey);
    if (terminal !== undefined) return terminal;
    const joined = inFlight.get(actionKey);
    if (joined !== undefined) return joined;
    const pending = (async () => {
      active.set(actionKey, (active.get(actionKey) ?? 0) + 1);
      maximumSameKeyActive = Math.max(maximumSameKeyActive, active.get(actionKey)!);
      physical.set(actionKey, (physical.get(actionKey) ?? 0) + 1);
      await Promise.resolve();
      const origin = `artifact://${actionKey.slice(7)}/origin-1`;
      terminalOrigins.set(actionKey, origin);
      active.set(actionKey, active.get(actionKey)! - 1);
      return origin;
    })();
    inFlight.set(actionKey, pending);
    return pending;
  };
  const [sharedLeft, sharedRight] = await Promise.all([
    execute(shared), execute(shared), execute(uniqueLeft), execute(uniqueRight)
  ]).then((values) => values.slice(0, 2));
  expect(maximumSameKeyActive).toBe(1);
  expect(physical.get(shared)).toBe(1);
  expect(physical.get(uniqueLeft)).toBe(1);
  expect(physical.get(uniqueRight)).toBe(1);
  expect(sharedLeft).toBe(sharedRight);
});

test('credential sanitizer never treats provider environment identity as a writable token', () => {
  expect(CodexDevelopmentCandidateProcessEnvironmentV2({
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
      CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT_V2.executionEnvironmentRevision,
    SEC_FORMAL_HOSTED_MODE: '1',
    TMPDIR: '/tmp'
  });
});
