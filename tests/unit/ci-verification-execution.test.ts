import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import { encodeVerificationActionData, type VerificationActionKeyDigest } from '../../src/adapters/verification/platform/action/contract/action.ts';
import { buildCiVerificationActionPlan, buildCiVerificationActionPlanClosure, CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT, ciVerificationGateStep, type CiVerificationActionCandidate, type CiVerificationActionPlanClosure, type CiVerificationProducerGate } from '../../src/adapters/verification/platform/action/contract/ci.ts';
import { CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS } from '../../src/adapters/verification/platform/action/contract/environment.ts';
import { createVerificationActionProviderStartMarker, createVerificationActionProviderTerminalAnchor, finalizeVerificationActionProviderStatusReadback, VERIFICATION_ACTION_PROVIDER_POLICY, verificationActionProviderRunTargetUrl, verificationActionProviderStartArtifactName, verificationActionProviderStartDescription, verificationActionProviderStatusContext, verificationActionProviderTerminalAnchorName, verificationActionProviderTerminalArtifactName, verificationActionProviderTerminalDescription, type VerificationActionProviderOrigin, type VerificationActionProviderStartObservation, type VerificationActionProviderStatusObservation, type VerificationActionProviderStatusReadback, type VerificationActionProviderTerminalAnchorObservation } from '../../src/adapters/verification/platform/action/contract/provider.ts';
import { assertVerificationActionTerminalArtifact, assertVerificationEvidence, createVerificationEvidenceProducer, verificationActionCandidateBytesDigest, verificationDigest, type VerificationEvidence } from '../../src/adapters/verification/platform/ci/contract/evidence.ts';
import { CreateHostedSutExecutionAuthorization, FinalizeHostedActionRawResult, HostedSutCandidateEnvironment, type HostedSutExecutionAuthorization } from '../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts';
import { buildCiQuickGatePlan } from '../../src/adapters/verification/platform/ci/contract/plan.ts';
import { CI_VERIFICATION_HOSTED_SANDBOX_POLICY, CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST, CI_VERIFICATION_SESSION_DISPATCH_TYPE } from '../../src/adapters/verification/platform/ci/contract/revision.ts';
import type { VerificationSessionHostedRequest } from '../../src/adapters/verification/platform/ci/contract/session-request.ts';
import { RunGateProcess, type GateProcessSettlement } from '../../src/adapters/verification/platform/ci/runtime/ci-orchestration-core.ts';
import {
  VERIFICATION_SESSION_HOSTED_ENVELOPE_SCHEMA
} from '../../src/adapters/verification/platform/ci/runtime/verification-session-runtime.ts';
import {
  CI_VERIFICATION_ACTION_EXECUTION_TICKET_SCHEMA,
  CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA,
  CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA,
  AssembleHostedActionTerminal,
  AssertHostedActionDependencyInputsV1,
  AssertHostedActionParentEvent,
  AssertHostedDependencyArchiveProjection,
  AssertHostedSutSandboxCommandPlan,
  AssertTrustedBootstrapSutMaterializationClean,
  BuildHostedSutSandboxCommandPlan,
  BuildTrustedBootstrapSutSandboxCommandPlan,
  CandidateProcessEnvironment,
  CaptureHostedDependencyPhysicalSnapshot,
  CiVerificationMainForTests,
  ComposeHostedEvidence,
  CoordinateHostedActions,
  ExecuteHostedActionSut,
  HostedDependencyMaterializerEnvironment,
  HostedSutCapabilityAssertion,
  InspectHostedActionArchive,
  InspectHostedActionArchiveInventory,
  MaterializeTrustedBootstrapArchive,
  ProbeHostedSutSandboxCapability,
  RunBoundedDependencyMaterialization,
  TrustedBootstrapSutHarness,
  ValidateHostedActionArchiveInventory,
  type HostedActionArchiveInventory,
  type HostedActionArtifactObservation,
  type HostedActionExecutionTicket,
  type HostedActionRawResult,
  type HostedActionResolution,
  type HostedSutSandboxProcessObservation,
  type HostedSutSandboxReceipt
} from '../../src/adapters/verification/platform/ci/verification.ts';
import { CreateTestImpactTransitionObservation } from '../../src/adapters/verification/platform/test-impact/runtime/transition.ts';
import type { VerificationResultStatus } from '../../src/assurance/verification/result/contract/result.ts';

const HEAD = '1'.repeat(40);
const TREE = '2'.repeat(40);
const BASE = '3'.repeat(40);
const BASE_TREE = '4'.repeat(40);
const MANIFEST_PATH = 'config/repository/work-packages/exact-verification-v1.md';
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
): HostedSutSandboxProcessObservation {
  const stdoutDigest = bytesDigest(failureTail);
  const stderrDigest = bytesDigest('');
  return Object.freeze({
    code,
    rawOutputDigest: verificationDigest({
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
  authorization?: HostedSutExecutionAuthorization
): HostedSutSandboxReceipt {
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
    receiptDigest: verificationDigest(withoutDigest) as VerificationActionKeyDigest
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
      - src/adapters/verification/platform/ci/verification.ts
forbiddenPaths:
  - src/compiler/
acceptance:
  - exact-verification
tests:
  - tests/unit/ci-verification-execution.test.ts
---

# Exact Verification
`;
}

function exactManifest(testIdentity: string) {
  const source = `${manifestSource()}\n<!-- test-run:${bytesDigest(testIdentity)} -->\n`;
  return {
    blobSha: createHash('sha1').update(source).digest('hex'),
    bytes: new TextEncoder().encode(source),
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
  const changedFiles = ['docs/product.md'];
  const manifest = exactManifest(root);
  const docsGate = buildCiQuickGatePlan({
    includeImports: false,
    includeDocs: true,
    selectedSlowSuites: [],
    selectedSlowTests: []
  }).find(({ id }) => id === 'docs-doctor');
  if (docsGate === undefined) throw new Error('CI test plan requires its documentation gate.');
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
    // Injected changed-path tests have no immutable source receipt. Use one
    // owner-resolved documentation path; source graph selection is exercised
    // only through the exact Git provider route.
    changedFiles: () => changedFiles,
    readExactGitBlob: () => manifest,
    readGitBlob: () => manifest,
    testVerificationPlan: {
      profile: 'quick' as const,
      changedFiles,
      selectionResolved: true,
      selectionReasons: [],
      affectedOwners: ['product'],
      affectedSlowTests: [],
      gates: [docsGate]
    },
    runGate: executeSentinelGate(root, 0)
  };
}

function executeSentinelGate(repositoryRoot: string, code: number, output = '') {
  return async (
    gate: Readonly<{ id: string; argv: string[]; env: NodeJS.ProcessEnv }>,
    execution: Parameters<typeof RunGateProcess>[2]
  ): Promise<GateProcessSettlement> => RunGateProcess(
    repositoryRoot,
    {
      ...gate,
      argv: [process.execPath, '-e', `${output.length > 0 ? `console.error(${JSON.stringify(output)});` : ''}process.exit(${code});`]
    },
    execution
  );
}

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
): HostedActionResolution {
  const actionPlanClosure = buildCiVerificationActionPlanClosure({
    candidate: hostedCandidate(),
    gates
  });
  return hostedMemberResolution(actionPlanClosure, 0);
}

function hostedMemberResolution(
  actionPlanClosure: CiVerificationActionPlanClosure,
  memberIndex: number
): HostedActionResolution {
  const actionPlan = actionPlanClosure.actions[memberIndex]!;
  const artifactInput = Object.freeze({
    baseSha: BASE,
    baseTreeSha: BASE_TREE,
    headSha: HEAD,
    headTreeSha: TREE,
    manifestPath: MANIFEST_PATH,
    manifestDigest: hostedCandidate().manifestDigest,
    inputClosureDigest: verificationDigest(actionPlan.action.inputClosure),
    candidateBytesDigest: verificationActionCandidateBytesDigest({
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
    resolutionDigest: verificationDigest(withoutDigest) as VerificationActionKeyDigest
  });
}

function hostedTicket(
  resolution: HostedActionResolution,
  inventory: HostedActionArchiveInventory = Object.freeze({
    archiveDigest: digest('9'),
    inventoryDigest: digest('0'),
    entryCount: 12,
    totalFileBytes: 1024,
    dependencyClosureDigest: DEPENDENCY_CLOSURE,
    gitBundleDigest: GIT_CLOSURE
  })
): HostedActionExecutionTicket {
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
    ticketDigest: verificationDigest(withoutDigest) as VerificationActionKeyDigest
  });
}

function hostedRawResult(
  resolution: HostedActionResolution,
  status: 'passed' | 'failed' | 'unsupported' | 'invalidated'
): HostedActionRawResult {
  const ticket = hostedTicket(resolution);
  const memberIndex = resolution.actionPlanClosure.actions.findIndex(
    (member) => member.action.actionKey === resolution.actionPlan.action.actionKey
  );
  const normalizedOperation = resolution.actionPlanClosure.normalizedOperations[memberIndex]!;
  const authorization = CreateHostedSutExecutionAuthorization({
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
  return FinalizeHostedActionRawResult({
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

type HostedEnvelopeFixture = Parameters<typeof CoordinateHostedActions>[0]['envelope'];

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
    actionPlanDigest: verificationDigest(withoutDigest) as VerificationActionKeyDigest
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
    envelopeDigest: verificationDigest(withoutDigest)
  }) as unknown as HostedEnvelopeFixture;
}

const hostedEvidenceProducer = createVerificationEvidenceProducer({
  sourceTransport: 'github-actions',
  workflowPath: '.github/workflows/compiler-pr-validation.yml',
  workflowRef: `.github/workflows/compiler-pr-validation.yml@${BASE}`,
  workflowSha: BASE,
  runId: '9002',
  runAttempt: 1,
  actorNodeId: 'BOT_actions_fixture'
});

type HostedProviderInputs = Readonly<{
  observations: readonly HostedActionArtifactObservation[];
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
  const observations: HostedActionArtifactObservation[] = [];
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
    const artifact = AssembleHostedActionTerminal({
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
    let evidence: VerificationEvidence | null = null;
    const calls: string[] = [];
    const code = await CiVerificationMainForTests({
      ...baseOptions(root),
      runGate: async (gate, execution) => {
        calls.push(gate.id);
        return executeSentinelGate(root, 0)(gate, execution);
      },
      writeEvidence: (_file, value) => { evidence = value; }
    });
    expect(code).toBe(0);
    expect(calls.length).toBeGreaterThan(0);
    const captured = evidence as VerificationEvidence | null;
    expect(captured?.gates.every((gate) => gate.action.actionKey === gate.result.inputDigest)).toBe(true);
    expect(() => assertVerificationEvidence(captured, {
      actionPlan: captured!.actionPlan
    }, new Date('2026-08-09T00:01:00.000Z'))).not.toThrow();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CI runner accepts transition injection only with matching exact changed records', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sec-ci-transition-binding-'));
  try {
    const transition = CreateTestImpactTransitionObservation({
      baseSha: BASE,
      headSha: HEAD,
      records: [{ status: 'changed', path: 'src/bootstrap/engineering/cli.ts' }],
      readPathBlob: () => null
    });
    expect(await CiVerificationMainForTests({
      ...baseOptions(root),
      transitionObservation: transition,
      writeEvidence: () => undefined
    })).toBe(1);
    const { changedFiles: _changedFiles, ...recordOptions } = baseOptions(root);
    void _changedFiles;
    expect(await CiVerificationMainForTests({
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
    const code = await CiVerificationMainForTests({
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
    const code = await CiVerificationMainForTests({
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
    expect(await CiVerificationMainForTests({
      ...baseOptions(root),
      writeEvidence: () => undefined
    })).toBe(0);
    let physical = 0;
    let writes = 0;
    expect(await CiVerificationMainForTests({
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
    let first: VerificationEvidence | null = null;
    expect(await CiVerificationMainForTests({
      ...baseOptions(root),
      runGate: executeSentinelGate(root, 1, 'known failure'),
      writeEvidence: (_file, value) => { first = value; }
    })).toBe(1);
    const terminal = first as unknown as VerificationEvidence;
    expect(terminal.status).toBe('failed');
    const byActionKey = new Map(terminal.gates.map((gate) => [gate.action.actionKey, gate.result]));
    let physical = 0;
    let reused: VerificationEvidence | null = null;
    expect(await CiVerificationMainForTests({
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
    const second = reused as unknown as VerificationEvidence;
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

    expect(() => AssertTrustedBootstrapSutMaterializationClean({
      baseRoot, candidateRoot
    })).not.toThrow();

    const foreignBasePath = path.join(baseRoot, 'foreign.txt');
    writeFileSync(foreignBasePath, 'foreign\n');
    expect(() => AssertTrustedBootstrapSutMaterializationClean({
      baseRoot, candidateRoot
    })).toThrow(/clean base and candidate/);
    rmSync(foreignBasePath);

    const ignoredBasePath = path.join(baseRoot, 'ignored-residue.txt');
    writeFileSync(ignoredBasePath, 'ignored foreign base bytes\n');
    expect(() => AssertTrustedBootstrapSutMaterializationClean({
      baseRoot, candidateRoot
    })).toThrow(/clean base and candidate/);
    rmSync(ignoredBasePath);

    const dirtyCandidatePath = path.join(candidateRoot, 'dirty.txt');
    writeFileSync(dirtyCandidatePath, 'dirty\n');
    expect(() => AssertTrustedBootstrapSutMaterializationClean({
      baseRoot, candidateRoot
    })).toThrow(/clean base and candidate/);
    rmSync(dirtyCandidatePath);

    const ignoredCandidatePath = path.join(candidateRoot, 'ignored-residue.txt');
    writeFileSync(ignoredCandidatePath, 'ignored foreign candidate bytes\n');
    expect(() => AssertTrustedBootstrapSutMaterializationClean({
      baseRoot, candidateRoot
    })).toThrow(/clean base and candidate/);
    rmSync(ignoredCandidatePath);

    const candidateSubdirectory = path.join(candidateRoot, 'nested');
    mkdirSync(candidateSubdirectory);
    expect(() => AssertTrustedBootstrapSutMaterializationClean({
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
    const inventory = (archive: string): HostedActionArchiveInventory => ({
      archiveDigest: bytesDigest(readFileSync(archive)),
      inventoryDigest: digest('0'),
      entryCount: 20,
      totalFileBytes: 4096,
      dependencyClosureDigest: DEPENDENCY_CLOSURE,
      gitBundleDigest: GIT_CLOSURE
    });
    let executionPlan: Parameters<typeof AssertHostedSutSandboxCommandPlan>[0] | null = null;
    const retainedArchiveBytes: string[] = [];
    const cleanInventory = inventory(cleanArchive);
    const cleanTicket = hostedTicket(resolution, cleanInventory);
    const clean = await ExecuteHostedActionSut({
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
        expect(retainedArchive!.capability.childPath).toBe('/proc/self/fd/5');
        retainedArchiveBytes.push(
          Buffer.from(retainedArchive!.capability.readBytes()).toString('utf8')
        );
        expect(retainedArchive!.archiveDigest).toBe(cleanInventory.archiveDigest);
        return sandboxObservation(0, 'candidate output is captured, never echoed');
      }
    });
    const cleanTerminal = AssembleHostedActionTerminal({
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
    expect(() => AssertHostedSutSandboxCommandPlan(executionPlan!)).not.toThrow();
    expect(executionPlan!.argv.slice(-directBunTestArgv.length)).toEqual(directBunTestArgv);
    expect(cleanTerminal.result.execution?.argv).toEqual(directBunTestArgv);
    expect(executionPlan!.candidateEnvironmentNames).toContain('SEC_FORMAL_HOSTED_MODE');
    for (const name of [
      'SAFE_INPUT', 'GH_TOKEN', 'gh_token', 'GITHUB_TOKEN', 'Actions_Custom_Token',
      'GITHUB_ENV', 'ACTIONS_ID_TOKEN_REQUEST_URL'
    ]) expect(executionPlan!.candidateEnvironmentNames).not.toContain(name);

    const dirtyInventory = inventory(dirtyArchive);
    const dirtyTicket = hostedTicket(resolution, dirtyInventory);
    const dirty = await ExecuteHostedActionSut({
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
    const dirtyTerminal = AssembleHostedActionTerminal({
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
  const executionAuthorization = CreateHostedSutExecutionAuthorization({
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
  const plan = BuildHostedSutSandboxCommandPlan({
    actionKey: resolution.actionPlan.action.actionKey,
    candidateArchiveDigest: ticket.preparedCandidateArchiveDigest,
    bunExecutable: path.resolve('/trusted/tool/bun'),
    baseSha: normalizedOperation.candidate.baseSha,
    headSha: normalizedOperation.candidate.headSha,
    normalizedArgv: executionAuthorization.normalizedArgv,
    candidateEnvironment: HostedSutCandidateEnvironment({
      normalizedOperation,
      manifestPath: resolution.artifactInput.manifestPath
    }),
    executionAuthorization
  });
  expect(() => AssertHostedSutSandboxCommandPlan(plan)).not.toThrow();
  expect(plan.command).toBe('/usr/bin/unshare');
  const encoded = JSON.stringify(plan.argv);
  for (const invariant of [
    '--mount', '--pid', '--fork', '--kill-child=KILL', '--net',
    '/usr/sbin/chroot', 'mount -t proc',
    'copy_runtime /usr/bin/bash /usr/bin/bash', 'copy_runtime /usr/bin/tar /usr/bin/tar',
    'runtime-binary-closure',
    '/authenticated-input/prepared-candidate.tar', '/usr/bin/setpriv', '--no-new-privs',
    '--bounding-set=-all', '/usr/bin/prlimit', '/usr/bin/env -i',
    '/proc/self/fd/5', '/usr/bin/cat --', '$candidate_archive', '/usr/bin/sha256sum',
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
  const bootstrapPlan = BuildTrustedBootstrapSutSandboxCommandPlan({
    bootstrapDigest: digest('b'),
    candidateArchiveDigest: digest('a'),
    bunExecutable: path.resolve('/trusted/tool/bun'),
    baseSha: normalizedOperation.candidate.baseSha,
    headSha: normalizedOperation.candidate.headSha,
    candidateEnvironment: CandidateProcessEnvironment({}, {
      SEC_BOOTSTRAP_BASE: normalizedOperation.candidate.baseSha,
      SEC_BOOTSTRAP_HEAD: normalizedOperation.candidate.headSha,
      SEC_BOOTSTRAP_TREE: TREE
    }),
    unitNonce: 'bootstrap-contract'
  });
  expect(() => AssertHostedSutSandboxCommandPlan(bootstrapPlan)).not.toThrow();
  expect(bootstrapPlan.phase).toBe('bootstrap-execute');
  expect(bootstrapPlan.executionAuthorizationDigest).toBeNull();
  expect(bootstrapPlan.physicalCommandProjectionDigest).toBeNull();
  expect(bootstrapPlan.argv.at(-1)).toBe(TrustedBootstrapSutHarness);
  expect(TrustedBootstrapSutHarness).toContain('reader.releaseLock()');
  expect(TrustedBootstrapSutHarness).toContain('reader.cancel(error)');
  expect(TrustedBootstrapSutHarness).toContain('Promise.allSettled([stdoutCollection, stderrCollection, exitPromise])');
  expect(JSON.stringify(bootstrapPlan.argv)).not.toContain('GITHUB_OUTPUT');
});

test('parent event binds the canonical one-key Session request wrapper', () => {
  const sessionRequest: VerificationSessionHostedRequest = Object.freeze({
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
  expect(() => AssertHostedActionParentEvent(
    canonicalEvent,
    sessionRequest
  )).not.toThrow();
  expect(() => AssertHostedActionParentEvent(
    { ...canonicalEvent, action: 'wrong-session-event' },
    sessionRequest
  )).toThrow('exact Session request wrapper');
  expect(() => AssertHostedActionParentEvent(
    { ...canonicalEvent, client_payload: sessionRequest },
    sessionRequest
  )).toThrow('exact Session request wrapper');
  expect(() => AssertHostedActionParentEvent(
    { ...canonicalEvent, client_payload: { payload: sessionRequest, extra: true } },
    sessionRequest
  )).toThrow('exact Session request wrapper');
});

test('capability requires the post-runtime marker and rejects a missing Python executable', async () => {
  const supported = await ProbeHostedSutSandboxCapability({
    actionKey: digest('a'),
    platform: 'linux',
    unitNonce: 'python-supported',
    runSandboxProcess: async (plan) => {
      if (plan.phase === 'capability-self-test') {
        return sandboxObservation(0, '__SEC_HOSTED_SANDBOX_CAPABILITY_V1__');
      }
      return sandboxObservation(0, '__SEC_HOSTED_SANDBOX_RESIDUE_EMPTY_V1__:direct-process-closed');
    }
  });
  expect(supported).toMatchObject({ state: 'supported', markerObserved: true, cgroupEmpty: true });

  const missingPython = await ProbeHostedSutSandboxCapability({
    actionKey: digest('b'),
    platform: 'linux',
    unitNonce: 'missing-python',
    runSandboxProcess: async (plan) => plan.phase === 'capability-self-test'
      ? sandboxObservation(127, '/usr/bin/python3: No such file or directory')
      : sandboxObservation(0, '__SEC_HOSTED_SANDBOX_RESIDUE_EMPTY_V1__:direct-process-closed')
  });
  expect(missingPython).toMatchObject({
    state: 'unsupported',
    markerObserved: false,
    cgroupEmpty: true
  });
});

test('capability probe detaches its deliberate residue child for trusted teardown', async () => {
  const observation = await ProbeHostedSutSandboxCapability({
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

  const assertion = HostedSutCapabilityAssertion;
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
  const archiveInventory: HostedActionArchiveInventory = {
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
    const unsupported = await ExecuteHostedActionSut({
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
    const unsupportedTerminal = AssembleHostedActionTerminal({
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
    ]) expect(HostedSutCapabilityAssertion).toContain(invariant);
    expect(HostedSutCapabilityAssertion).not.toContain('process.pid !== 1');
    expect(HostedSutCapabilityAssertion).toContain('error?.code !== "ENOENT"');
    expect(HostedSutCapabilityAssertion).toStartWith('(async () => {');
    expect(HostedSutCapabilityAssertion).toContain(
      '})().catch((error) => { console.error(error); process.exitCode = 1; });'
    );
    for (const invariant of [
      'runtime-binary-closure', '/usr/sbin/chroot', '--kill-child=KILL'
    ]) expect(capabilityPlan).toContain(invariant);
    for (const forbidden of ['mount --bind /usr', '/var/run/docker.sock']) {
      expect(capabilityPlan).not.toContain(forbidden);
    }

    const ambiguous = await ExecuteHostedActionSut({
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
    const ambiguousTerminal = AssembleHostedActionTerminal({
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
    const raw = await ExecuteHostedActionSut({
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
    const terminal = AssembleHostedActionTerminal({
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
  expect(() => ValidateHostedActionArchiveInventory(trusted)).not.toThrow();
  expect(() => ValidateHostedActionArchiveInventory([
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
    [entry('setuid', 'file', { mode: 0o4755 })]
  ];
  for (const inventory of hostile) {
    expect(() => ValidateHostedActionArchiveInventory([
      ...trusted, ...inventory
    ])).toThrow();
  }
  expect(() => ValidateHostedActionArchiveInventory([
    ...trusted,
    entry('loop', 'directory'),
    entry('loop/child', 'directory'),
    entry('loop/child/link', 'symlink', { linkTarget: '..' })
  ])).toThrow(/targets itself or an ancestor/u);
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
  const archiveEntries = ValidateHostedActionArchiveInventory([
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
  expect(AssertHostedDependencyArchiveProjection({
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
    expect(() => AssertHostedDependencyArchiveProjection({
      before, after, archiveEntries
    })).toThrow(/physical generation changed/u);
  }
  expect(() => AssertHostedDependencyArchiveProjection({
    before,
    after: before,
    archiveEntries: archiveEntries.map((entry) => entry.path === 'node_modules/pkg/target.txt'
      ? Object.freeze({ ...entry, physicalContentDigest: digest('5') }) : entry)
  })).toThrow(/file differs/u);
  expect(() => AssertHostedDependencyArchiveProjection({
    before,
    after: before,
    archiveEntries: archiveEntries.map((entry) => entry.path === 'node_modules/pkg/link.txt'
      ? Object.freeze({ ...entry, linkTarget: 'node_modules/pkg/other.txt' }) : entry)
  })).toThrow(/link differs/u);
  expect(() => AssertHostedDependencyArchiveProjection({
    before,
    after: before,
    archiveEntries: archiveEntries.slice(0, -1)
  })).toThrow(/missing, duplicate, or foreign/u);
  expect(() => AssertHostedDependencyArchiveProjection({
    before: changedAfter('pkg/link.txt', { linkTarget: '/host/secret' }),
    after: changedAfter('pkg/link.txt', { linkTarget: '/host/secret' }),
    archiveEntries
  })).toThrow(/escapes/u);
  expect(() => AssertHostedDependencyArchiveProjection({
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
    const before = CaptureHostedDependencyPhysicalSnapshot(dependencyRoot);
    const archive = MaterializeTrustedBootstrapArchive({
      candidateRoot,
      dependencySnapshot: before,
      outputDirectory
    });
    const inventory = InspectHostedActionArchiveInventory(archive);
    const after = CaptureHostedDependencyPhysicalSnapshot(dependencyRoot);
    expect(AssertHostedDependencyArchiveProjection({
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
    const inspected = InspectHostedActionArchive({
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
    expect(() => InspectHostedActionArchive({
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
    expect(AssertHostedActionDependencyInputsV1({
      baseRoot: base, candidateRoot: candidate, baseSha: BASE
    })).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(HostedDependencyMaterializerEnvironment()).toEqual({
      PATH: '/usr/bin:/bin', HOME: '/tmp/sec-hosted-dependency-home',
      TMPDIR: '/tmp/sec-hosted-dependency-tmp', LANG: 'C.UTF-8',
      BUN_INSTALL_CACHE_DIR: '/tmp/sec-hosted-dependency-home/.bun/install/cache',
      CI: '1'
    });
    writeFileSync(path.join(candidate, '.npmrc'), '//registry.example/:_authToken=stolen\n');
    expect(() => AssertHostedActionDependencyInputsV1({
      baseRoot: base, candidateRoot: candidate, baseSha: BASE
    })).toThrow(/\.npmrc/u);
    rmSync(path.join(candidate, '.npmrc'));
    writeFileSync(path.join(candidate, 'bun.lock'), 'drift\n');
    expect(() => AssertHostedActionDependencyInputsV1({
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
  expect(RunBoundedDependencyMaterialization(() => {
    recoveredAttempts += 1;
    if (recoveredAttempts === 1) throw retryable;
  })).toEqual({ attempts: 2, recoveredFrom: 'bun-tarball-extraction' });
  expect(recoveredAttempts).toBe(2);

  const terminal = new Error('error: lockfile had changes, but lockfile is frozen');
  let terminalAttempts = 0;
  expect(() => RunBoundedDependencyMaterialization(() => {
    terminalAttempts += 1;
    throw terminal;
  })).toThrow(terminal);
  expect(terminalAttempts).toBe(1);

  let repeatedExtractionAttempts = 0;
  expect(() => RunBoundedDependencyMaterialization(() => {
    repeatedExtractionAttempts += 1;
    throw retryable;
  })).toThrow(/after one bounded Bun tarball-extraction recovery retry/u);
  expect(repeatedExtractionAttempts).toBe(2);
});

test('canonical terminal artifact derives four physical Result states while raw not-run is impossible', () => {
  const resolution = hostedResolution();
  const ticket = hostedTicket(resolution);
  let passedArtifact: ReturnType<typeof AssembleHostedActionTerminal> | null = null;
  for (const status of ['passed', 'failed', 'unsupported', 'invalidated'] as const) {
    const rawResult = hostedRawResult(resolution, status);
    const artifact = AssembleHostedActionTerminal({
      resolution,
      ticket,
      rawResult,
      expectedRawResultDigest: rawResult.rawResultDigest,
      producer: hostedProducer
    });
    expect(artifact.result.status).toBe(status);
    if (status === 'passed') passedArtifact = artifact;
    expect(artifact.producer).toEqual(hostedProducer);
    expect(() => assertVerificationActionTerminalArtifact(artifact, {
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
    verificationDigest(withoutArtifactDigest) as VerificationActionKeyDigest;
  expect(() => assertVerificationActionTerminalArtifact(contradictory, {
    actionPlan: resolution.actionPlan
  })).toThrow(/execution proof does not replay/u);
});

test('hosted coordinator and composer preserve four physical terminals while coordinator owns not-run', () => {
  const closure = hostedDagClosure([[]]);
  const envelope = hostedEnvelopeFixture(closure);
  for (const status of ['passed', 'failed', 'unsupported', 'invalidated'] as const) {
    const provider = hostedProviderInputs(envelope, new Map([[0, { status }]]));
    const coordination = CoordinateHostedActions({ envelope, ...provider });
    expect(coordination).toMatchObject({
      disposition: 'complete',
      dispatchActionKeys: [],
      missingActionKeys: []
    });
    const composed = ComposeHostedEvidence({
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
    expect(() => assertVerificationEvidence(composed.evidence, {
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
  const cleanupFailed = ComposeHostedEvidence({
    envelope,
    ...cleanupFailedProvider,
    producer: hostedEvidenceProducer,
    now: () => new Date('2026-08-09T00:00:02.000Z')
  });
  expect(cleanupFailed.evidence).toMatchObject({
    status: 'failed',
    gates: [{ result: { status: 'invalidated' }, cleanup: { status: 'failed' } }]
  });
  expect(() => assertVerificationEvidence(cleanupFailed.evidence, {
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
    const coordination = CoordinateHostedActions({ envelope, ...partial });
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
    const completed = ComposeHostedEvidence({
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
  expect(CoordinateHostedActions({
    envelope,
    ...passedDependency
  })).toMatchObject({
    disposition: 'dispatch',
    dispatchActionKeys: [closure.actions[1]!.action.actionKey]
  });

  const pendingDependency = hostedProviderInputs(envelope, new Map());
  const pending = CoordinateHostedActions({
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
  const coordination = CoordinateHostedActions({ envelope, ...expired });
  expect(coordination.disposition).toBe('blocked');
  expect(coordination.dispatchActionKeys).toEqual([]);
  expect(coordination.reason).toContain('retained out');
  expect(ComposeHostedEvidence({
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
    actionPlanDigest: verificationDigest(withoutDigest) as VerificationActionKeyDigest
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
  expect(() => CoordinateHostedActions({
    envelope: omittedPrerequisiteEnvelope,
    ...provider
  })).toThrow('does not resolve to exactly one Action member');
  expect(() => ComposeHostedEvidence({
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
  const artifact = AssembleHostedActionTerminal({
    resolution: left,
    ticket: hostedTicket(left),
    rawResult,
    expectedRawResultDigest: rawResult.rawResultDigest,
    producer: hostedProducer
  });
  expect(() => assertVerificationActionTerminalArtifact(artifact, {
    actionPlan: right.actionPlan,
    executionEnvironmentRevision:
      CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT.executionEnvironmentRevision
  })).not.toThrow();
  expect(encodeVerificationActionData(artifact)).not.toContain(left.actionPlanClosure.actionPlanDigest);
  expect(encodeVerificationActionData(artifact)).not.toContain(right.actionPlanClosure.actionPlanDigest);
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
  expect(CandidateProcessEnvironment({
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
