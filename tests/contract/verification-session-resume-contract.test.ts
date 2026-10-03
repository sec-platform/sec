import { expect, test } from 'bun:test';

import { HOSTED_RESUME_SIGNAL_SCHEMA, parseHostedResumeDispatchSignal, type HostedResumeEmitter, type HostedResumeSignal } from '../../src/adapters/providers/github-api/contract/hosted-resume-dispatch.ts';
import { createVerificationActionKey, createVerificationActionPlan, type VerificationActionKeyDigest, type VerificationActionPlan } from '../../src/adapters/verification/platform/action/contract/action.ts';
import { buildCiVerificationActionPlanClosure, CI_VERIFICATION_PER_JOB_HOSTED_EXECUTION_ENVIRONMENT, ciVerificationGateStep, createCiVerificationActionParentDispatchPlan, createCiVerificationActionProposal, createCiVerificationActionProviderEnvelope, type CiVerificationNormalizedOperation } from '../../src/adapters/verification/platform/action/contract/ci.ts';
import { CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS, CI_VERIFICATION_HOSTED_PROVIDER_REVISION } from '../../src/adapters/verification/platform/action/contract/environment.ts';
import { CI_GITHUB_ACTIONS_IDENTITY_POLICY, verificationActionProviderTerminalArtifactName, type VerificationActionProviderOrigin, type VerificationActionProviderTerminalObservation } from '../../src/adapters/verification/platform/action/contract/provider.ts';
import { CodexDevelopmentFinalizeVerificationActionTerminalArtifact, CodexDevelopmentParseVerificationActionTerminalArtifact, CodexDevelopmentVerificationActionCandidateBytesDigest, type CodexDevelopmentVerificationActionTerminalArtifact } from '../../src/adapters/verification/platform/ci/contract/evidence.ts';
import { assertCiVerificationSessionResumeBinding, ciVerificationSessionResumeDisplayTitle, createCiVerificationSessionResumeSignal, parseCiVerificationSessionResumeSignal } from '../../src/adapters/verification/platform/ci/runtime/verification-session-resume-contract.ts';
import { createVerificationSessionPerJobHostedRequest } from '../../src/adapters/verification/platform/ci/runtime/verification-session-runtime.ts';
import { canonicalEquals, rawSha256, sha256 } from '../../src/contracts/canonical.ts';

import { SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY } from '../../src/adapters/providers/linux-verification/contract.ts';
import { createHostedJobRuntimeReceipt } from '../../src/adapters/verification/platform/ci/contract/hosted-job-runtime.ts';
import { parseHostedActionRuntimeExecution } from '../../src/adapters/verification/platform/ci/contract/hosted-runtime-execution.ts';
import { CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA, CodexDevelopmentCreateHostedSutExecutionAuthorization, CodexDevelopmentFinalizeHostedActionRawResult, CodexDevelopmentReduceHostedSutObservation, type CodexDevelopmentHostedSutSandboxReceipt } from '../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts';
import { CI_VERIFICATION_HOSTED_SANDBOX_POLICY, CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST } from '../../src/adapters/verification/platform/ci/contract/revision.ts';

const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const REPOSITORY = 'sec-platform/sec';
const emitter: HostedResumeEmitter = {
  repositoryId: '1', repository: REPOSITORY, workflowPath: '.github/workflows/merge-gate.yml',
  workflowSha: BASE, runId: '41', runAttempt: 1, jobId: '42', checkRunId: '43', policyJobId: 'integrate',
  phase: 'resume-verification-session', stepName: 'Resume canonical verification Session', stepNumber: 6
};

function plan(identity = 'typecheck', providerRevision = CI_VERIFICATION_PER_JOB_HOSTED_EXECUTION_ENVIRONMENT.executionEnvironmentRevision): VerificationActionPlan {
  return createVerificationActionPlan({
    action: createVerificationActionKey({
      actionKind: 'ci-verification', producer: { identity: 'ci-verification', revision: 'fixture-v1' },
      operation: { identity, revision: 'fixture-v1', semanticDigest: sha256(identity), workingDirectory: '.',
        declaredEnvironment: [{ name: 'SEC_EXECUTION_ENVIRONMENT_REVISION', digest: sha256(providerRevision) }] },
      inputClosure: [{ path: 'package.json', digest: sha256('package') }],
      environment: { toolchainRevision: CI_VERIFICATION_PER_JOB_HOSTED_EXECUTION_ENVIRONMENT.toolchainRevision,
        providerRevision, contractRevision: 'fixture-v1' },
      requiredCheapPreflightActionKeys: [], upstreamActionKeys: [], resultSchemaRevision: 'verification-gate-result-v1'
    }), executionClass: 'cheap-preflight', dependencies: []
  });
}

function fixture(actionPlan = plan(), expectedActionPlanDigest: VerificationActionKeyDigest = sha256('closure')) {
  const request = createVerificationSessionPerJobHostedRequest({
    prNumber: 7, expectedBaseSha: BASE, expectedBaseTreeSha: 'c'.repeat(40), expectedHeadSha: HEAD,
    expectedHeadTreeSha: 'd'.repeat(40), manifestPath: 'config/repository/work-packages/resume.json',
    manifestDigest: sha256('manifest'), profile: 'quick', expectedScopeProposalDigest: sha256('scope'),
    expectedActionPlanDigest, expectedSessionRevision: sha256('session'), reviewPolicyDigest: sha256('review')
  });
  const proposal = createCiVerificationActionProposal({ sessionRequest: request, proposedActionKey: actionPlan.action.actionKey });
  const parentPlan = createCiVerificationActionParentDispatchPlan({
    repositoryId: '1', repository: REPOSITORY, parentRunId: '11', parentRunAttempt: 1, parentJobId: '12',
    parentWorkflowRef: `${REPOSITORY}/.github/workflows/compiler-pr-validation.yml@refs/heads/main`, parentWorkflowSha: BASE,
    parentActor: { login: 'maintainer', id: 101, nodeId: 'U_101', type: 'User', permission: 'maintain' }, proposals: [proposal]
  });
  const providerEnvelope = createCiVerificationActionProviderEnvelope({ proposal, parentPlan,
    parentDispatchPlanArtifactId: '13', parentDispatchPlanArchiveDigest: sha256('parent archive') });
  const completedAction: HostedResumeSignal['completedAction'] = {
    providerEnvelope, runId: '21', runAttempt: 1, terminalArtifactId: '31',
    terminalArtifactName: verificationActionProviderTerminalArtifactName(actionPlan.action.actionKey),
    terminalArchiveDigest: sha256('terminal archive'), terminalPayloadDigest: sha256('terminal payload')
  };
  const signal = createCiVerificationSessionResumeSignal({ completedAction, emitter });
  const producer: VerificationActionProviderOrigin = {
    repositoryId: 1, repository: REPOSITORY, workflowPath: '.github/workflows/compiler-pr-validation.yml',
    workflowRef: `.github/workflows/compiler-pr-validation.yml@${BASE}`, workflowSha: BASE, runId: '21', runAttempt: 1,
    appId: CI_GITHUB_ACTIONS_IDENTITY_POLICY.app.id, appNodeId: CI_GITHUB_ACTIONS_IDENTITY_POLICY.app.nodeId,
    sourceEvent: 'repository_dispatch'
  };
  const terminalObservation: VerificationActionProviderTerminalObservation = {
    originId: completedAction.terminalArtifactId, artifactName: completedAction.terminalArtifactName,
    archiveDigest: completedAction.terminalArchiveDigest, expired: false, referencedOrigin: producer,
    payload: { actionKey: actionPlan.action.actionKey, candidateSha: HEAD,
      payloadDigest: completedAction.terminalPayloadDigest, producer }
  };
  return { actionPlan, request, parentPlan, providerEnvelope, completedAction, signal, producer, terminalObservation };
}

/** Deliberately uses only the lower wire encoder so negative CI cases have
 * correct digests rather than failing incidentally on the outer checksum. */
function wire(completedAction: HostedResumeSignal['completedAction'], actualEmitter: HostedResumeEmitter = emitter): string {
  const content = { schema: HOSTED_RESUME_SIGNAL_SCHEMA,
    wakeKey: sha256({ schema: 'sec-verification-session-wake-key-v1', completedAction }), completedAction, emitter: actualEmitter };
  return JSON.stringify({ ...content, signalDigest: sha256(content) });
}

test('CI resume composes the actual provider wire, immutable human plan reference and stable compiler title', () => {
  const data = fixture();
  expect(parseCiVerificationSessionResumeSignal(JSON.stringify(data.signal))).toEqual(data.signal);
  expect(parseHostedResumeDispatchSignal(JSON.stringify(data.signal))).toEqual(data.signal);
  expect(data.signal.completedAction.providerEnvelope).toEqual(data.providerEnvelope);
  expect(data.parentPlan.parentActor.type).toBe('User');
  expect(data.signal.emitter.workflowPath).toBe('.github/workflows/merge-gate.yml');
  expect(Object.isFrozen(data.signal.completedAction.providerEnvelope)).toBe(true);
  expect(ciVerificationSessionResumeDisplayTitle(data.signal)).toBe(`resume Session ${data.signal.wakeKey}`);
});

test('emitter changes preserve wake identity and title but change the complete signal digest', () => {
  const data = fixture();
  const next = createCiVerificationSessionResumeSignal({ completedAction: data.completedAction,
    emitter: { ...emitter, runId: '51', jobId: '52', checkRunId: '53' } });
  expect(next.wakeKey).toBe(data.signal.wakeKey);
  expect(next.signalDigest).not.toBe(data.signal.signalDigest);
  expect(ciVerificationSessionResumeDisplayTitle(next)).toBe(ciVerificationSessionResumeDisplayTitle(data.signal));
  expect(next.completedAction.providerEnvelope).toEqual(data.providerEnvelope);
  expect(canonicalEquals(next.emitter, emitter)).toBe(false);
});

test('completed Action and attempt are part of the finite wake cause', () => {
  const data = fixture();
  const next = createCiVerificationSessionResumeSignal({
    completedAction: { ...data.completedAction, runAttempt: 2 }, emitter
  });
  expect(next.wakeKey).not.toBe(data.signal.wakeKey);
  expect(next.signalDigest).not.toBe(data.signal.signalDigest);
});

test('CI decoder rejects an opaque lower envelope, legacy request, wrong placement and request operation', () => {
  const data = fixture();
  expect(() => parseCiVerificationSessionResumeSignal(wire({ ...data.completedAction,
    providerEnvelope: { schema: 'fixture-original-action-envelope' } }))).toThrow('provider envelope');
  const { placement: _placement, ...legacyFields } = data.request;
  const requests = [
    { ...legacyFields, schema: 'sec-verification-session-hosted-request-v1' },
    { ...data.request, placement: 'github-actions-hosted' },
    { ...data.request, requestOperationId: sha256('different operation') },
    { ...data.request, alreadyVerified: true }
  ];
  for (const request of requests) {
    const completedAction = { ...data.completedAction, providerEnvelope: { ...data.providerEnvelope,
      proposal: { ...data.providerEnvelope.proposal, sessionRequest: request } } };
    expect(() => parseHostedResumeDispatchSignal(wire(completedAction))).not.toThrow();
    expect(() => parseCiVerificationSessionResumeSignal(wire(completedAction))).toThrow();
  }
});

test('CI decoder rejects wrong Action name and trusted workflow source even with recomputed wire digests', () => {
  const data = fixture();
  expect(() => parseCiVerificationSessionResumeSignal(wire({ ...data.completedAction,
    terminalArtifactName: verificationActionProviderTerminalArtifactName(sha256('other Action')) }))).toThrow('terminal name');
  expect(() => parseCiVerificationSessionResumeSignal(wire({ ...data.completedAction,
    providerEnvelope: { ...data.providerEnvelope, parentWorkflowSha: HEAD } }))).toThrow('workflow source');
  expect(() => parseCiVerificationSessionResumeSignal(wire(data.completedAction,
    { ...emitter, workflowSha: HEAD }))).toThrow('workflow source');
  expect(() => parseCiVerificationSessionResumeSignal(wire(data.completedAction,
    { ...emitter, repository: 'foreign/sec' }))).toThrow('workflow source');
});

test('exact wire decoding rejects extensions, duplicate fields, altered checksums and payload wrappers', () => {
  const data = fixture(), source = JSON.stringify(data.signal);
  for (const value of [
    { ...data.signal, authority: 'trusted' },
    { ...data.signal, completedAction: { ...data.completedAction, permission: 'admin' } },
    { ...data.signal, emitter: { ...emitter, permission: 'maintain' } },
    { ...data.signal, signalDigest: sha256('forged') },
    { payload: data.signal }
  ]) expect(() => parseCiVerificationSessionResumeSignal(JSON.stringify(value))).toThrow();
  for (const duplicate of [
    source.replace('"runId":"21"', '"runId":"21","runId":"21"'),
    source.replace('"placement":', '"placement":"github-hosted-per-job-v1","placement":'),
    source.replace('"wakeKey":', `"wakeKey":"${data.signal.wakeKey}","wakeKey":`)
  ]) {
    expect(duplicate).not.toBe(source);
    expect(() => parseCiVerificationSessionResumeSignal(duplicate)).toThrow();
  }
});

test('constructor rejects callbacks and accessors instead of evaluating caller-controlled authority', () => {
  const data = fixture();
  let touched = false;
  const accessor = { get completedAction() { touched = true; return data.completedAction; }, emitter };
  expect(() => createCiVerificationSessionResumeSignal(accessor)).toThrow();
  expect(touched).toBe(false);
  expect(() => Reflect.apply(createCiVerificationSessionResumeSignal, undefined,
    [{ completedAction: data.completedAction, emitter, authorize: () => true }])).toThrow();
});

// These cases exercise early data rejection only. The terminal decoder's
// executing-job proof is deliberately unreachable and is never stubbed as PASS.
function untrustedBinding() {
  const data = fixture();
  return { signal: data.signal, parentPlan: data.parentPlan, actionPlan: data.actionPlan,
    terminalObservation: data.terminalObservation,
    terminalArtifact: {} as CodexDevelopmentVerificationActionTerminalArtifact };
}

test('cause binding rejects a foreign parent plan, non-member Action and legacy provider before terminal decoding', () => {
  const input = untrustedBinding();
  expect(() => assertCiVerificationSessionResumeBinding({ ...input,
    parentPlan: { ...input.parentPlan, parentRunId: '99' } })).toThrow('exact parent plan');
  expect(() => assertCiVerificationSessionResumeBinding({ ...input, actionPlan: plan('other') })).toThrow('closed per-job Action');
  expect(() => assertCiVerificationSessionResumeBinding({ ...input,
    actionPlan: plan('typecheck', CI_VERIFICATION_HOSTED_PROVIDER_REVISION) })).toThrow('closed per-job Action');
  expect(() => assertCiVerificationSessionResumeBinding({ ...input,
    parentPlan: { ...input.parentPlan, parentActor: { ...input.parentPlan.parentActor, type: 'Bot' as 'User' } } })).toThrow('must be User');
});

test('cause binding rejects wrong terminal ID, archive, payload, Action, candidate, name and expiration', () => {
  const input = untrustedBinding(), observation = input.terminalObservation;
  const mutations = [
    { ...observation, originId: '99' }, { ...observation, archiveDigest: sha256('other archive') },
    { ...observation, artifactName: 'unrelated-terminal' }, { ...observation, expired: true },
    { ...observation, payload: { ...observation.payload!, payloadDigest: sha256('other payload') } },
    { ...observation, payload: { ...observation.payload!, actionKey: sha256('other Action') } },
    { ...observation, payload: { ...observation.payload!, candidateSha: 'f'.repeat(40) } }
  ];
  for (const terminalObservation of mutations) {
    expect(() => assertCiVerificationSessionResumeBinding({ ...input, terminalObservation })).toThrow('closed cause');
  }
});

test('cause binding rejects mismatched completed run, attempt, source or independent origin readback', () => {
  const input = untrustedBinding(), observation = input.terminalObservation, original = observation.payload!.producer;
  for (const producer of [
    { ...original, runId: '99' }, { ...original, runAttempt: 2 }, { ...original, workflowSha: HEAD },
    { ...original, sourceEvent: 'workflow_dispatch' as 'repository_dispatch' }, { ...original, repositoryId: 2 }
  ]) {
    const terminalObservation = { ...observation, payload: { ...observation.payload!, producer }, referencedOrigin: producer };
    expect(() => assertCiVerificationSessionResumeBinding({ ...input, terminalObservation })).toThrow('run, attempt or source');
  }
  expect(() => assertCiVerificationSessionResumeBinding({ ...input,
    terminalObservation: { ...observation, referencedOrigin: { ...original, runAttempt: 2 } } })).toThrow('run, attempt or source');
});

// DATA only, adapted from the frozen 769e961 executing-job fixture and existing
// unsupported terminal helper. No provider, process, credential or live issuer
// is invoked, and an unsupported Action remains unsupported after the wake.
function terminalData(input: Readonly<{
  actionPlan: VerificationActionPlan; normalizedOperation: CiVerificationNormalizedOperation;
  baseSha: string; baseTreeSha: string; headSha: string; headTreeSha: string;
  manifestPath: string; manifestDigest: VerificationActionKeyDigest; producer: VerificationActionProviderOrigin;
}>): CodexDevelopmentVerificationActionTerminalArtifact {
  const { actionPlan, normalizedOperation, producer } = input;
  const artifactInput = { baseSha: input.baseSha, baseTreeSha: input.baseTreeSha, headSha: input.headSha,
    headTreeSha: input.headTreeSha, manifestPath: input.manifestPath, manifestDigest: input.manifestDigest,
    inputClosureDigest: sha256(actionPlan.action.inputClosure),
    candidateBytesDigest: CodexDevelopmentVerificationActionCandidateBytesDigest({ ...input, action: actionPlan.action }) };
  const inventoryClosure = { archiveDigest: sha256('archive'), inventoryDigest: sha256('inventory'), entryCount: 1,
    totalFileBytes: 1, dependencyClosureDigest: sha256('dependencies'), gitBundleDigest: sha256('git closure') };
  const authorization = CodexDevelopmentCreateHostedSutExecutionAuthorization({ resolutionDigest: sha256('resolution'),
    ticketDigest: sha256('ticket'), actionPlan, normalizedOperation, candidateSha: input.headSha,
    candidateBytesDigest: artifactInput.candidateBytesDigest as VerificationActionKeyDigest,
    manifestPath: input.manifestPath, inventoryClosure, producer });
  const policy = CI_VERIFICATION_HOSTED_SANDBOX_POLICY, outputDigest = sha256('output');
  const diagnostic = 'unshare: operation not permitted';
  const sandboxContent = {
    schema: CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA, policyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST,
    actionKey: actionPlan.action.actionKey,
    capability: { commandPlanDigest: authorization.physicalCommand.projectionDigest,
      lifecycle: { supervisorSpawned: true, supervisorClosed: true, supervisorCloseCode: 1, supervisorSignal: null,
        namespaceEstablished: false, candidateStarted: false, candidateUnitSettled: true, observationGap: null },
      exitCode: 1, markerObserved: false, outputDigest,
      cleanup: { supervisorSpawned: true, supervisorClosed: true, exitCode: 0, outputDigest }, diagnostic },
    commandPlanDigest: null, resources: policy.limits, authenticatedArchive: inventoryClosure,
    rootIsolation: { substrate: policy.substrate, namespaces: policy.namespaces, uid: policy.isolatedUid,
      gid: policy.isolatedGid, network: policy.network, inputMount: policy.inputMount, workspace: policy.workspace,
      outputTransport: policy.outputTransport, candidateEnvironmentNames: [] },
    execution: { lifecycle: { supervisorSpawned: false, supervisorClosed: false, supervisorCloseCode: null,
      supervisorSignal: null, namespaceEstablished: false, candidateStarted: false, candidateUnitSettled: null, observationGap: null },
      unitName: null, exitCode: null, authenticatedInputDigest: null, postExecutionInputDigest: null,
      postExecutionReadbackErrorDigest: null, stdoutStderrDigest: outputDigest, stdoutDigest: outputDigest,
      stderrDigest: outputDigest, stdoutBytesObserved: 0, stderrBytesObserved: 0, outputTruncated: false,
      boundedFailureTailDigest: outputDigest },
    cleanup: { supervisorSpawned: false, supervisorClosed: false, exitCode: null, outputDigest }, diagnostic
  };
  const sandboxReceipt = { ...sandboxContent, receiptDigest: sha256(sandboxContent) } as CodexDevelopmentHostedSutSandboxReceipt;
  const observation = CodexDevelopmentFinalizeHostedActionRawResult({ executionAuthorizationDigest: authorization.authorizationDigest,
    command: null, sandboxReceipt, startedAt: '2026-08-09T00:00:00.000Z', finishedAt: '2026-08-09T00:00:01.000Z' });
  const terminal = CodexDevelopmentReduceHostedSutObservation({ actionPlan, normalizedOperation, candidateSha: input.headSha,
    candidateBytesDigest: artifactInput.candidateBytesDigest, manifestPath: input.manifestPath, producer, authorization,
    observation, expectedRawResultDigest: observation.rawResultDigest });
  const environment = SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY, rawSource = JSON.stringify(observation);
  const receipt = createHostedJobRuntimeReceipt({
    origin: { repository: producer.repository, repositoryId: String(producer.repositoryId), workflowPath: producer.workflowPath,
      workflowSha: input.baseSha, trustedSourceSha: input.baseSha, trustedSourceTreeSha: input.baseTreeSha,
      runId: producer.runId, runAttempt: producer.runAttempt, jobId: '300', checkRunId: '301',
      policyJobId: 'execute-verification-action-sut', role: 'sut', identityDigest: sha256('identity'),
      workflowSourceDigest: sha256('workflow'), launcherSourceDigest: sha256('launcher'), originalDeadlineAtUnixMs: 1_800_000_000_000 },
    operation: { phase: 'execute-hosted-action-sut', actionKey: actionPlan.action.actionKey,
      operationIdentityDigest: sha256('operation'), boundAttemptDigest: sha256('attempt'), deadlineAtUnixMs: 1_799_999_999_000 },
    materialization: { specDigest: sha256('spec'), runtimeManifestDigest: environment.image.runtimeContentDigest,
      dockerProjectionDigest: environment.image.dockerProjectionDigest, provenanceArtifactDigest: sha256('provenance'),
      executionImageDigest: environment.trustedRuntime.imageDigest, bunExecutableDigest: environment.trustedRuntime.bunExecutableDigest,
      engineProviderIdentityDigest: sha256('engine'), ociExporterIdentityDigest: sha256('exporter') },
    container: { id: 'd'.repeat(64), name: 'data-only-executing-job', ownershipDigest: sha256('ownership'),
      creationReadbackDigest: sha256('creation'), startedReadbackDigest: sha256('started'), terminalReadbackDigest: sha256('terminal') },
    execution: { started: true, settled: true, exitCode: 0, stdoutBytes: Buffer.byteLength(rawSource), stderrBytes: 0,
      outputDigest: rawSha256(rawSource), outputTruncated: false, sandboxObservationDigest: sandboxReceipt.receiptDigest },
    cleanup: { containerAbsent: true, providerScopeSettled: true, outputSettled: true, ownedSourcesReleased: true }
  });
  const runtimeExecution = parseHostedActionRuntimeExecution({ receipt, transport: {
    artifactId: '400', artifactName: `sec-verification-action-raw-v2-${actionPlan.action.actionKey.slice(7)}`
      + `-run-${producer.runId}-attempt-${producer.runAttempt}`, archiveDigest: sha256('raw archive'),
    receiptMember: 'hosted-job-runtime-receipt.json', outputMember: 'verification-action-raw-observation.json',
    checkRunUrl: `https://api.github.com/repos/${producer.repository}/check-runs/301`, launcherStepNumber: 6, uploadStepNumber: 7,
    artifactCreatedAtUnixMs: 1_799_999_990_000, artifactUpdatedAtUnixMs: 1_799_999_991_000,
    sourceAnchor: 'authenticated-current-default', observedAtUnixMs: 1_799_999_992_000
  } });
  return CodexDevelopmentFinalizeVerificationActionTerminalArtifact({ actionPlan, normalizedOperation,
    result: terminal.result, cleanup: terminal.cleanup, executionEnvironment: CI_VERIFICATION_PER_JOB_HOSTED_EXECUTION_ENVIRONMENT,
    input: artifactInput, producer, executionProof: terminal.proof, runtimeExecution });
}

function fullBindingFixture(gateId = 'typecheck', baseSha = BASE) {
  const initial = fixture(), request = initial.request;
  const closure = buildCiVerificationActionPlanClosure({ candidate: {
    baseSha, baseTreeSha: request.expectedBaseTreeSha,
    headSha: request.expectedHeadSha, headTreeSha: request.expectedHeadTreeSha,
    manifestPath: request.manifestPath, manifestDigest: request.manifestDigest,
    scopeAuthorizationRevision: request.expectedScopeProposalDigest, profile: 'quick',
    toolchainRevision: CI_VERIFICATION_PER_JOB_HOSTED_EXECUTION_ENVIRONMENT.toolchainRevision,
    providerRevision: CI_VERIFICATION_PER_JOB_HOSTED_EXECUTION_ENVIRONMENT.executionEnvironmentRevision,
    contractRevision: 'ci-verification-v19',
    requiredBlobs: CI_VERIFICATION_ACTION_DEPENDENCY_INPUT_PATHS.map(path => ({ path, digest: sha256(path) }))
  }, gates: [ciVerificationGateStep({ id: gateId, phase: 'quick', args: ['run', 'typecheck'] })] });
  const data = fixture(closure.actions[0]!, closure.actionPlanDigest);
  const terminalInput = { actionPlan: data.actionPlan, normalizedOperation: closure.normalizedOperations[0]!,
    baseSha, baseTreeSha: request.expectedBaseTreeSha, headSha: request.expectedHeadSha,
    headTreeSha: request.expectedHeadTreeSha, manifestPath: request.manifestPath, manifestDigest: request.manifestDigest,
    producer: { ...data.producer, workflowSha: baseSha, workflowRef: `${data.producer.workflowPath}@${baseSha}` } };
  const artifact = terminalData(terminalInput);
  return { terminalInput, binding: bindPayload({ signal: data.signal, parentPlan: data.parentPlan,
    actionPlan: data.actionPlan, terminalObservation: data.terminalObservation, terminalArtifact: artifact }, artifact) };
}

function bindPayload(input: Parameters<typeof assertCiVerificationSessionResumeBinding>[0],
  artifact: CodexDevelopmentVerificationActionTerminalArtifact): Parameters<typeof assertCiVerificationSessionResumeBinding>[0] {
  const payloadDigest = artifact.artifactDigest as VerificationActionKeyDigest;
  return { ...input, terminalArtifact: artifact,
    signal: createCiVerificationSessionResumeSignal({ completedAction: { ...input.signal.completedAction,
      terminalPayloadDigest: payloadDigest }, emitter: input.signal.emitter }),
    terminalObservation: { ...input.terminalObservation, payload: { ...input.terminalObservation.payload!, payloadDigest } } };
}

test('complete per-job terminal binding accepts the original five-state result without minting an execution grant', () => {
  const { binding } = fullBindingFixture();
  expect(binding.terminalArtifact.schema).toBe('sec-verification-action-terminal-artifact-v3');
  expect(binding.terminalArtifact.result.status).toBe('unsupported');
  expect(CodexDevelopmentParseVerificationActionTerminalArtifact(JSON.stringify(binding.terminalArtifact))).toEqual(binding.terminalArtifact);
  expect(() => assertCiVerificationSessionResumeBinding(binding)).not.toThrow();
  expect(binding.parentPlan.parentActor.type).toBe('User');
  expect(binding.signal.emitter.runId).not.toBe(binding.parentPlan.parentRunId);
});

test('late binding rejects individually valid terminal artifacts with a foreign Action, source, run or attempt', () => {
  const { binding, terminalInput } = fullBindingFixture();
  expect(() => assertCiVerificationSessionResumeBinding(binding)).not.toThrow();
  const foreignSource = 'e'.repeat(40);
  const variants = [
    fullBindingFixture('different-action').binding.terminalArtifact,
    fullBindingFixture('typecheck', foreignSource).binding.terminalArtifact,
    terminalData({ ...terminalInput, producer: { ...terminalInput.producer, runId: '88' } }),
    terminalData({ ...terminalInput, producer: { ...terminalInput.producer, runAttempt: 2 } })
  ];
  for (const artifact of variants) {
    expect(() => CodexDevelopmentParseVerificationActionTerminalArtifact(JSON.stringify(artifact))).not.toThrow();
    expect(() => assertCiVerificationSessionResumeBinding(bindPayload(binding, artifact))).toThrow('terminal payload differs');
  }
});

test('late binding rejects a valid terminal with independently re-bound candidate tree input', () => {
  const { binding, terminalInput } = fullBindingFixture();
  expect(() => assertCiVerificationSessionResumeBinding(binding)).not.toThrow();
  for (const field of ['baseTreeSha', 'headTreeSha'] as const) {
    const artifact = terminalData({ ...terminalInput, [field]: 'e'.repeat(40) });
    expect(() => CodexDevelopmentParseVerificationActionTerminalArtifact(JSON.stringify(artifact))).not.toThrow();
    expect(() => assertCiVerificationSessionResumeBinding(bindPayload(binding, artifact))).toThrow('terminal candidate differs');
  }
});

test('late binding still requires the actual terminal digest and complete new runtime record', () => {
  const { binding } = fullBindingFixture();
  expect(() => assertCiVerificationSessionResumeBinding(binding)).not.toThrow();
  const forgedDigest = sha256('other terminal');
  const signal = createCiVerificationSessionResumeSignal({ completedAction: { ...binding.signal.completedAction,
    terminalPayloadDigest: forgedDigest }, emitter: binding.signal.emitter });
  expect(() => assertCiVerificationSessionResumeBinding({ ...binding, signal,
    terminalObservation: { ...binding.terminalObservation, payload: { ...binding.terminalObservation.payload!,
      payloadDigest: forgedDigest } } })).toThrow('terminal payload differs');
  const artifact = binding.terminalArtifact;
  if (artifact.schema !== 'sec-verification-action-terminal-artifact-v3') throw new Error('Expected the real v3 fixture.');
  const { runtimeExecution: _runtime, artifactDigest: _digest, ...legacyContent } = artifact;
  const missingRuntime = { ...legacyContent, artifactDigest: sha256(legacyContent) };
  expect(() => assertCiVerificationSessionResumeBinding(bindPayload(binding,
    missingRuntime as unknown as CodexDevelopmentVerificationActionTerminalArtifact))).toThrow();
});
