import { createHash } from 'node:crypto';

import { describe, expect, test } from 'bun:test';

import { parseDockerEndpointIdentity } from '../../../src/adapters/providers/docker/contract/daemon.ts';
import { SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY } from '../../../src/adapters/providers/linux-verification/contract.ts';
import {
  LINUX_VERIFICATION_UNIT_PROFILE_DIGEST,
  LINUX_VERIFICATION_UNIT_REQUIREMENT_ID,
  linuxVerificationUnitInvocationDigest,
  type LinuxVerificationUnitReceipt
} from '../../../src/adapters/runtime-state/physical/contract/linux-verification-unit.ts';
import {
  TRUSTED_RUNTIME_MAIN_HEALTH_CHECK_COMMANDS,
  createTrustedRuntimeMainHealthInput,
  createTrustedRuntimeNativeMainHealthInvocation,
  createTrustedRuntimeNativeMainHealthReceipt,
  parseTrustedRuntimeMainHealthReceipt,
  trustedRuntimeMainHealthReceiptReference
} from '../../../src/adapters/self-hosting/control/main-health/main-health-observation.ts';
import { encodeVerificationActionData } from '../../../src/adapters/verification/platform/action/contract/action.ts';
import { parseTrustedRuntimeSourceProgramAttemptCarrier } from '../../../src/adapters/verification/platform/ci/contract/evidence.ts';
import {
  TRUSTED_RUNTIME_CONTAINER_IMAGE_ID,
  TRUSTED_RUNTIME_MUTABLE_TMPFS_SPEC,
  TRUSTED_RUNTIME_STATE_ENVIRONMENT,
  TRUSTED_RUNTIME_TEST_TMPFS_SPEC,
  assertTrustedRuntimeDependencyCacheVolume,
  assertTrustedRuntimeMainHealthQualification,
  assertTrustedRuntimeSourceProgramTransitionObservation,
  authorizeTrustedRuntimeContainerRecovery,
  composeTrustedRuntimeContainerLabels,
  createTrustedRuntimeDependencyCacheMarker,
  createTrustedRuntimeDependencyCacheVolumeSpec,
  parseTrustedRuntimeContainerIdentity,
  renderTrustedRuntimeCommandFailureDetail
} from '../../../src/adapters/verification/platform/trusted-runtime/trusted-runtime-container.ts';
import { rawSha256, sha256 } from '../../../src/contracts/canonical.ts';
import {
  bindSemanticOperation,
  compileCapabilityBinding,
  compileProviderSettlementSet,
  compileSemanticOperationPlan,
  issueNormalDomainReadbackReceipt,
  issueNormalOwnerTerminalJoinReceipt,
  issueProviderSettlementReceipt,
  issueSemanticOperationAttemptContext,
  type OperationDigest
} from '../../../src/execution/operation/semantic.ts';

const dockerEndpoint = Object.freeze({
  schema: 'sec-docker-endpoint-identity-v1' as const,
  contextName: 'desktop-linux',
  endpointHost: process.platform === 'win32'
    ? 'npipe:////./pipe/dockerDesktopLinuxEngine'
    : 'unix:///var/run/docker.sock',
  daemonId: 'daemon-example',
  osType: 'linux' as const,
  architecture: 'x86_64' as const
});

function historicalNativeUnit(index: number): LinuxVerificationUnitReceipt {
  const unitId = String(index + 1).repeat(32);
  const identity = Object.freeze({ baseSha: '1'.repeat(40), headSha: '1'.repeat(40),
    baseTreeSha: '2'.repeat(40), headTreeSha: '2'.repeat(40), status: '' as const });
  const body = Object.freeze({ schema: 'sec-linux-native-verification-unit-receipt-v1' as const,
    profileRevision: 'sec-linux-native-verification-unit-v1' as const,
    profileDigest: LINUX_VERIFICATION_UNIT_PROFILE_DIGEST,
    operationIdentityDigest: sha256('historical-operation') as OperationDigest,
    boundAttemptDigest: sha256('historical-attempt') as OperationDigest,
    providerIdentityDigest: sha256('historical-provider') as OperationDigest,
    inputDigest: sha256('historical-input') as OperationDigest,
    invocationDigest: linuxVerificationUnitInvocationDigest(createTrustedRuntimeNativeMainHealthInvocation(TRUSTED_RUNTIME_MAIN_HEALTH_CHECK_COMMANDS[index]!)),
    deadlineAtUnixMs: Date.parse('2030-01-01T00:00:00.000Z'),
    unit: Object.freeze({ name: `sec-native-${unitId}.service`, invocationId: unitId,
      managerBootId: '11111111-1111-1111-1111-111111111111', managerStartTime: '1',
      cgroupPath: `/system.slice/sec-native-${unitId}.service`, mainPid: 100 + index,
      managerMainPid: 200 + index, managerMainPidStartTime: String(index + 20),
      mainPidStartTime: String(index + 10), rootDevice: '1', rootInode: String(index + 1000),
      workingDirectory: '/sec-runtime/workspace', workingDirectoryDevice: '1', workingDirectoryInode: String(index + 2000),
      trustedPackageReadable: true as const, outputWritable: true as const,
      namespaceIdentities: { mount: 'mnt:[1]', pid: 'pid:[2]', network: 'net:[3]', user: 'user:[4]', ipc: 'ipc:[5]' } }),
    inputs: Object.freeze({ runtimeManifestDigest: sha256('historical-runtime') as OperationDigest,
      bundleDigest: sha256('historical-bundle') as OperationDigest,
      dependencyContentDigest: null,
      sutArchiveDigest: null }),
    gitBefore: identity, gitAfter: identity,
    execution: Object.freeze({ exitCode: 0, stdoutDigest: rawSha256('') as OperationDigest,
      stderrDigest: rawSha256('') as OperationDigest, stdoutBytes: 0, stderrBytes: 0,
      outputTruncated: false as const }),
    outputFiles: Object.freeze([]), settlement: Object.freeze({ unitInactive: true as const,
      cgroupEmpty: true as const, privateMountsRetired: true as const, inputsRetired: true as const }) });
  return Object.freeze({ ...body, receiptDigest: sha256(body) as OperationDigest });
}

function historicalSourceProgramCarrier() {
  // This is a carrier-codec specimen. The opaque assessment transport payload
  // does not claim semantic assessment validity or any physical observation.
  const assessmentBody = { schema: 'source-program-transition-assessment-v2',
    runtimeSha: '1'.repeat(40), baseSha: '1'.repeat(40), baseTreeSha: '2'.repeat(40),
    headSha: '3'.repeat(40), headTreeSha: '4'.repeat(40), changedPaths: [] as string[],
    producerExecution: { observation: { implementationDigest: sha256('historical-source') },
      evidenceDigest: sha256('historical-loaded-source-evidence') } };
  const assessment = { ...assessmentBody, assessmentDigest: sha256(assessmentBody) };
  const stdout = `${encodeVerificationActionData(assessment)}\n`;
  const requirement = { id: LINUX_VERIFICATION_UNIT_REQUIREMENT_ID,
    contractDigest: LINUX_VERIFICATION_UNIT_PROFILE_DIGEST,
    effectKinds: ['process', 'filesystem', 'provider', 'persistent-state'] as const,
    failureKinds: ['historical-only'] };
  const operation = bindSemanticOperation(compileSemanticOperationPlan({
    operation: 'verification.trusted-runtime-native',
    intentDigest: sha256('historical-carrier-intent') as OperationDigest,
    decisionDigest: sha256('historical-carrier-decision') as OperationDigest,
    deadlineAtUnixMs: Date.parse('2030-01-01T00:00:00.000Z'),
    aggregateBudgets: [{ resource: 'duration-ms', maximum: 1000 },
      { resource: 'input-bytes', maximum: 1000 }, { resource: 'output-bytes', maximum: 10000 },
      { resource: 'processes', maximum: 10 }], requirements: [requirement],
    attempt: issueSemanticOperationAttemptContext({ authorityGrantDigest: sha256('historical-only') as OperationDigest })
  }), [compileCapabilityBinding({ requirementId: requirement.id, contractDigest: requirement.contractDigest,
    providerIdentityDigest: sha256('historical-carrier-provider') as OperationDigest })]);
  const invocation = { kind: 'source-program' as const, cwd: 'trusted' as const,
    argv: ['run', '--no-env-file', '/sec-runtime/trusted/src/bootstrap/engineering/source-program-transition.ts'],
    environment: { CI: '1', ...TRUSTED_RUNTIME_STATE_ENVIRONMENT }, outputFiles: [],
    maxStdoutBytes: 1024 * 1024, maxStderrBytes: 1024 * 1024 };
  const { receiptDigest: _oldUnitDigest, ...oldUnit } = historicalNativeUnit(0);
  const gitIdentity = { baseSha: assessment.baseSha, baseTreeSha: assessment.baseTreeSha,
    headSha: assessment.headSha, headTreeSha: assessment.headTreeSha, status: '' as const };
  const unitBody = { ...oldUnit, operationIdentityDigest: operation.plan.identity.identityDigest,
    boundAttemptDigest: operation.boundAttemptDigest,
    providerIdentityDigest: operation.bindings[0]!.providerIdentityDigest,
    invocationDigest: linuxVerificationUnitInvocationDigest(invocation),
    inputs: { ...oldUnit.inputs, dependencyContentDigest: sha256('historical-dependencies') as OperationDigest },
    unit: { ...oldUnit.unit, workingDirectory: '/sec-runtime/trusted' },
    gitBefore: gitIdentity, gitAfter: gitIdentity,
    execution: { ...oldUnit.execution, stdoutDigest: rawSha256(stdout) as OperationDigest,
      stdoutBytes: Buffer.byteLength(stdout) } };
  const unitReceipt = { ...unitBody, receiptDigest: sha256(unitBody) as OperationDigest };
  const processBody = { operationIdentityDigest: operation.plan.identity.identityDigest,
    boundAttemptDigest: operation.boundAttemptDigest, requirementId: requirement.id,
    providerBindingDigest: operation.bindings[0]!.bindingDigest,
    resourceCeilingIdentityDigest: sha256('historical-ceilings'),
    requirementBindingContextDigest: sha256('historical-context'),
    processCount: 1, settledProcessCount: 1, successfulProcessRecordCount: 1, failedProcessCount: 0,
    admittedNativeResourceCount: 1, startedNativeResourceCount: 1, rootProcessCount: 1,
    stdinWorkerCount: 0, helperProcessCount: 0, settledNativeResourceCount: 1,
    failedNativeAdmissionCount: 0, inputBytes: 0, outputBytes: Buffer.byteLength(stdout),
    deadlineAtUnixMs: operation.plan.attempt.deadlineAtUnixMs };
  const processReceipt = { ...processBody, receiptDigest: sha256(processBody) };
  const providerSettlement = issueProviderSettlementReceipt(operation, { requirementId: requirement.id,
    physicalDisposition: 'settled', providerSettlementReferenceDigest: sha256('historical-settlement') as OperationDigest });
  const providerSettlementSet = compileProviderSettlementSet(operation, [providerSettlement]);
  const readback = issueNormalDomainReadbackReceipt(operation, providerSettlementSet, {
    readbackContractDigest: sha256('historical-readback-contract') as OperationDigest,
    readbackReferenceDigest: sha256('historical-readback') as OperationDigest,
    currentPhysicalEpochDigest: sha256('historical-epoch') as OperationDigest, disposition: 'applied' });
  const ownerTerminalProjection = issueNormalOwnerTerminalJoinReceipt(operation, providerSettlementSet, readback, {
    ownerTerminalContractDigest: sha256('historical-owner-contract') as OperationDigest,
    ownerTerminalReferenceDigest: sha256('historical-owner') as OperationDigest });
  const settlementBody = { processReceipt, providerSettlement, unitReceiptDigests: [unitReceipt.receiptDigest],
    transportRetired: true as const };
  const sessionSettlement = { ...settlementBody, settlementDigest: sha256(settlementBody),
    providerSettlementSet, readback, ownerTerminalProjection };
  const physicalEvidence = { unitReceipt, invocation, sessionSettlement,
    dependencyCache: 'private-ephemeral' as const, workspaceTerminal: 'retired' as const };
  const observationBody = { schema: 'source-program-transition-observation-v2' as const,
    origin: 'first-qualified' as const, sourceActionOutputDigest: rawSha256(stdout),
    repository: 'sec-platform/sec', pullRequestNumber: 1,
    assessmentDigest: assessment.assessmentDigest, baseSha: assessment.baseSha,
    headSha: assessment.headSha, headTreeSha: assessment.headTreeSha,
    executionId: 'historical-source-program', producerSourceDigest: assessment.producerExecution.observation.implementationDigest,
    producerExecutionEvidenceDigest: assessment.producerExecution.evidenceDigest,
    actionKey: sha256('historical-action'), sessionRevision: sha256('historical-session'),
    payloadDigest: null, approvalObservationDigest: null, approvalDigest: null,
    settlementDigest: sha256({ unitReceipt, sessionSettlement }) };
  const observation = { ...observationBody, observationDigest: sha256(observationBody) };
  const body = { schema: 'source-program-isolated-attempt-evidence-v3' as const,
    authority: 'historical-evidence-only' as const, assessment, observation, physicalEvidence };
  return { ...body, evidenceDigest: sha256(body) };
}

/** Rehash surrounding transport after deliberate inner corruption. A checksum
 * failure must not mask the source/attempt/provider relation under test. */
function resealHistoricalSourceProgramCarrier(candidate: ReturnType<typeof historicalSourceProgramCarrier>) {
  const { evidenceDigest: _evidenceDigest, ...carrier } = candidate;
  const { receiptDigest: _unitDigest, ...unitBody } = carrier.physicalEvidence.unitReceipt;
  const unitReceipt = { ...unitBody, receiptDigest: sha256(unitBody) as OperationDigest };
  const { settlementDigest: _settlementDigest, providerSettlementSet, readback,
    ownerTerminalProjection, ...settlementBody } = carrier.physicalEvidence.sessionSettlement;
  const fixedSettlementBody = { ...settlementBody, unitReceiptDigests: [unitReceipt.receiptDigest] };
  const sessionSettlement = { ...fixedSettlementBody, settlementDigest: sha256(fixedSettlementBody),
    providerSettlementSet, readback, ownerTerminalProjection };
  const { observationDigest: _observationDigest, ...observation } = carrier.observation;
  const observationBody = { ...observation, settlementDigest: sha256({ unitReceipt, sessionSettlement }) };
  const body = { ...carrier, observation: { ...observationBody, observationDigest: sha256(observationBody) },
    physicalEvidence: { ...carrier.physicalEvidence, unitReceipt, sessionSettlement } };
  return { ...body, evidenceDigest: sha256(body) };
}

describe('provider-neutral trusted runtime container', () => {
  test('native SourceProgram carrier binds original attempts, provider joins and canonical output without issuing authority', () => {
    const carrier = historicalSourceProgramCarrier();
    const parsed = parseTrustedRuntimeSourceProgramAttemptCarrier(JSON.parse(JSON.stringify(carrier)));
    expect(encodeVerificationActionData(parsed)).toBe(encodeVerificationActionData(carrier));
    for (const observation of [parsed.observation, { ...parsed.observation },
      JSON.parse(JSON.stringify(parsed.observation))]) {
      expect(() => assertTrustedRuntimeSourceProgramTransitionObservation(observation))
        .toThrow('exact live isolated producer observation');
    }
    const physical = carrier.physicalEvidence;
    expect(physical.invocation.environment).toMatchObject({
      SEC_STATE_HOME: '/sec-runtime/output/state',
      SEC_CACHE_HOME: '/sec-runtime/output/cache'
    });
    const rejectsPhysical = (changed: typeof physical) => {
      expect(() => parseTrustedRuntimeSourceProgramAttemptCarrier(
        resealHistoricalSourceProgramCarrier({ ...carrier, physicalEvidence: changed })))
        .toThrow('exact source, output or physical joins');
    };
    rejectsPhysical({ ...physical, unitReceipt: { ...physical.unitReceipt,
      boundAttemptDigest: sha256('another-original-attempt') as OperationDigest } });
    const { providerReceiptDigest: _providerDigest, ...providerBody } = physical.sessionSettlement.providerSettlement;
    const wrongRequirement = { ...providerBody, requirementId: 'verification.another-requirement' };
    const providerSettlement = { ...wrongRequirement,
      providerReceiptDigest: sha256({ domain: 'sec.operation.provider-settlement-receipt', receipt: wrongRequirement }) as OperationDigest };
    const { providerSettlementSetDigest: _setDigest, ...setBody } = physical.sessionSettlement.providerSettlementSet;
    const wrongSet = { ...setBody, settlements: [providerSettlement], providerReceiptDigests: [providerSettlement.providerReceiptDigest] };
    rejectsPhysical({ ...physical, sessionSettlement: { ...physical.sessionSettlement, providerSettlement,
      providerSettlementSet: { ...wrongSet,
        providerSettlementSetDigest: sha256({ domain: 'sec.operation.provider-settlement-set', settlementSet: wrongSet }) as OperationDigest } } });
    const other = historicalSourceProgramCarrier().physicalEvidence.sessionSettlement;
    rejectsPhysical({ ...physical, sessionSettlement: { ...physical.sessionSettlement, readback: other.readback } });
    rejectsPhysical({ ...physical, sessionSettlement: { ...physical.sessionSettlement,
      providerSettlementSet: other.providerSettlementSet } });
    rejectsPhysical({ ...physical, invocation: { ...physical.invocation, argv: [...physical.invocation.argv, '--different-command'] } });
    const { assessmentDigest: _assessmentDigest, ...assessmentBody } = carrier.assessment;
    const changedAssessment = { ...assessmentBody, changedPaths: ['src/changed.ts'] };
    const assessment = { ...changedAssessment, assessmentDigest: sha256(changedAssessment) };
    expect(() => parseTrustedRuntimeSourceProgramAttemptCarrier(resealHistoricalSourceProgramCarrier({
      ...carrier, assessment, observation: { ...carrier.observation, assessmentDigest: assessment.assessmentDigest }
    }))).toThrow('exact source, output or physical joins');
  });
  test('native MainHealth historical bytes bind every exact input and settled unit without reviving qualification', () => {
    // Historical codec specimens are deliberately caller-shaped. They never
    // stand in for an executed unit or enter either producer's live registry.
    const request = Object.freeze({ repository: 'sec-platform/sec', mainSha: '1'.repeat(40), mainTreeSha: '2'.repeat(40),
      executionId: 'historical-native-main-health', observedAt: '2026-10-04T00:00:00.000Z',
      actionResults: TRUSTED_RUNTIME_MAIN_HEALTH_CHECK_COMMANDS.map((command, index) => ({ command, unitReceipt: historicalNativeUnit(index) })) });
    const receipt = createTrustedRuntimeNativeMainHealthReceipt(request);
    expect(parseTrustedRuntimeMainHealthReceipt(JSON.stringify(receipt))).toEqual(receipt);
    expect(trustedRuntimeMainHealthReceiptReference(receipt)).toBe(
      `live-receipt:trusted-main-health/v4/${receipt.mainSha}/${receipt.receiptDigest.slice(7)}`
    );
    const parsed = parseTrustedRuntimeMainHealthReceipt(JSON.stringify(receipt));
    const projected = createTrustedRuntimeMainHealthInput({
      schema: 'sec-trusted-runtime-main-health-observation-v1',
      repository: parsed.repository, mainSha: parsed.mainSha, mainTreeSha: parsed.mainTreeSha,
      trustRevision: parsed.mainSha, executionId: parsed.executionId,
      verificationReceiptDigest: parsed.receiptDigest, observedAt: parsed.observedAt,
      expiresAt: '2026-10-04T00:10:00.000Z'
    }, parsed.schema);
    expect(projected.producer.sourceRef).toBe(
      `live-receipt:trusted-main-health/v4/${parsed.mainSha}/${parsed.receiptDigest.slice(7)}`
    );
    expect(projected.producer.sourceDigest).toBe(parsed.receiptDigest);
    for (const schema of ['sec-trusted-runtime-main-health-receipt-v2', 'sec-trusted-runtime-main-health-receipt-v3']) {
      expect(() => parseTrustedRuntimeMainHealthReceipt({ ...receipt, schema })).toThrow('receipt schema is invalid');
    }
    expect(TRUSTED_RUNTIME_MAIN_HEALTH_CHECK_COMMANDS).toEqual(['bun --version']);
    expect(receipt.dependencyPreparation).toBe('not-required-for-runtime-readiness');
    expect(receipt.actionResults[0]!.unitReceipt.inputs.dependencyContentDigest).toBeNull();
    expect(() => parseTrustedRuntimeMainHealthReceipt({ ...receipt,
      receiptDigest: `sha256:${'f'.repeat(64)}` })).toThrow('canonical subject, plan or result bytes');
    for (const unqualified of [receipt, { ...receipt }, parseTrustedRuntimeMainHealthReceipt(JSON.stringify(receipt))]) {
      expect(() => assertTrustedRuntimeMainHealthQualification({ receipt: unqualified,
        repositoryRoot: process.cwd(), repository: receipt.repository, mainSha: receipt.mainSha,
        mainTreeSha: receipt.mainTreeSha })).toThrow('current live production execution qualification');
    }
    expect(() => createTrustedRuntimeNativeMainHealthReceipt({ ...request, mainSha: '3'.repeat(40) })).toThrow('another exact main');
    expect(() => createTrustedRuntimeNativeMainHealthReceipt({ ...request,
      actionResults: request.actionResults.slice(1) })).toThrow('single runtime-readiness result');
    expect(() => createTrustedRuntimeNativeMainHealthReceipt({ ...request,
      actionResults: [{ ...request.actionResults[0]!, command: 'bun run test -- --scope fast' }] }))
      .toThrow('differs from the canonical plan');
    const incomplete = { ...request.actionResults[0]!.unitReceipt,
      settlement: { ...request.actionResults[0]!.unitReceipt.settlement, cgroupEmpty: false } };
    const { receiptDigest: _discarded, ...incompleteBody } = incomplete;
    expect(() => createTrustedRuntimeNativeMainHealthReceipt({ ...request,
      actionResults: request.actionResults.map((entry, index) => index === 0
        ? { ...entry, unitReceipt: { ...incompleteBody, receiptDigest: sha256(incompleteBody) } as unknown as LinuxVerificationUnitReceipt }
        : entry) })).toThrow('settlement is incomplete');
    for (const probe of ['trustedPackageReadable', 'outputWritable'] as const) {
      const { receiptDigest: _digest, ...original } = request.actionResults[0]!.unitReceipt;
      const unreadable = { ...original, unit: { ...original.unit, [probe]: false } };
      expect(() => createTrustedRuntimeNativeMainHealthReceipt({ ...request,
        actionResults: request.actionResults.map((entry, index) => index === 0
          ? { ...entry, unitReceipt: { ...unreadable, receiptDigest: sha256(unreadable) } as unknown as LinuxVerificationUnitReceipt }
          : entry) })).toThrow('readiness was not observed');
    }
    const { receiptDigest: _cwdDigest, ...originalCwd } = request.actionResults[0]!.unitReceipt;
    const wrongCwd = { ...originalCwd, unit: { ...originalCwd.unit, workingDirectory: '/tmp' } };
    expect(() => createTrustedRuntimeNativeMainHealthReceipt({ ...request,
      actionResults: request.actionResults.map((entry, index) => index === 0
        ? { ...entry, unitReceipt: { ...wrongCwd, receiptDigest: sha256(wrongCwd) } as unknown as LinuxVerificationUnitReceipt }
        : entry) })).toThrow('exact main');
    expect(() => parseTrustedRuntimeMainHealthReceipt({ ...receipt, imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID })).toThrow('shape or fixed identity');
    expect(() => parseTrustedRuntimeMainHealthReceipt({ ...receipt,
      actionResults: receipt.actionResults.map((entry, index) => index === 0
        ? { ...entry, resultDigest: `sha256:${'f'.repeat(64)}` } : entry) })).toThrow('canonical subject, plan or result bytes');
  });



  test('admits only the canonical executable test tmpfs and non-executable runtime state', () => {
    const container = {
      Id: '4'.repeat(64),
      Image: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID,
      Name: '/sec-trusted-runtime-example',
      Config: { Labels: {} },
      HostConfig: {
        ReadonlyRootfs: true,
        Init: true,
        Tmpfs: {
          '/tmp': TRUSTED_RUNTIME_TEST_TMPFS_SPEC.slice('/tmp:'.length),
          '/sec-runtime': TRUSTED_RUNTIME_MUTABLE_TMPFS_SPEC.slice('/sec-runtime:'.length)
        }
      },
      Mounts: [{
        Destination: '/candidate.bundle',
        Source: 'C:\\sec\\candidate.bundle',
        Type: 'bind',
        RW: false
      }]
    };
    expect(parseTrustedRuntimeContainerIdentity(JSON.stringify([container])))
      .toMatchObject({
        initProcess: true,
        candidateBundleSource: 'C:\\sec\\candidate.bundle',
        executableTestTmpfs: true,
        nonExecutableMutableTmpfs: true
      });
    expect(() => parseTrustedRuntimeContainerIdentity(JSON.stringify([{
      ...container,
      HostConfig: { ...container.HostConfig, Init: false }
    }]))).toThrow('container identity is invalid');
    expect(() => parseTrustedRuntimeContainerIdentity(JSON.stringify([{
      ...container,
      Mounts: [{ Destination: '/candidate.bundle', Type: 'bind', RW: false }]
    }]))).toThrow('read-only bind mount');
    expect(() => parseTrustedRuntimeContainerIdentity(JSON.stringify([{
      ...container,
      HostConfig: {
        ...container.HostConfig,
        Tmpfs: { ...container.HostConfig.Tmpfs, '/tmp': 'rw,noexec,nosuid,nodev,size=2g' }
      }
    }]))).toThrow('/tmp options differ');
    expect(() => parseTrustedRuntimeContainerIdentity(JSON.stringify([{
      ...container,
      HostConfig: {
        ...container.HostConfig,
        Tmpfs: { ...container.HostConfig.Tmpfs, '/foreign': 'rw' }
      }
    }]))).toThrow('targets differ');
  });

  test('historical Docker receipt endpoints retain exact local identity and reject remote transport', () => {
    expect(parseDockerEndpointIdentity(dockerEndpoint)).toEqual(dockerEndpoint);
    expect(() => parseDockerEndpointIdentity({
      ...dockerEndpoint,
      endpointHost: 'tcp://remote.example:2376'
    })).toThrow(/local npipe or unix transport/);
  });

  test('labels captured stdout and stderr and identifies absent provider output', () => {
    const detail = renderTrustedRuntimeCommandFailureDetail({
      stdout: 'compiler diagnostic',
      stderr: 'process exit summary'
    });
    expect(detail).toMatch(/stdout:\s*compiler diagnostic(?=\s|$)/u);
    expect(detail).toMatch(/stderr:\s*process exit summary(?=\s|$)/u);
    expect(renderTrustedRuntimeCommandFailureDetail({ stdout: '', stderr: '' }))
      .toMatch(/no captured output/iu);
  });

  test('reclaims only one twice-observed exact dead-owner container identity', () => {
    const operationKey = 'session-1234567890abcdef';
    const ownerNonce = '12345678-1234-4234-9234-1234567890ab';
    const imageLabels = Object.freeze({
      'sec.trusted-runtime.image-schema': 'sec-trusted-runtime-container-v1'
    });
    const expected = Object.freeze({
      operationKey,
      repository: 'sec-platform/sec',
      baseSha: '1'.repeat(40),
      headSha: '2'.repeat(40),
      endpointDigest: `sha256:${'3'.repeat(64)}` as `sha256:${string}`,
      imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID,
      imageLabels,
      ownerHost: 'trusted-host',
      dependencyCacheVolumeName: null
    });
    const identity = Object.freeze({
      id: '4'.repeat(64),
      imageId: expected.imageId,
      name: `sec-trusted-runtime-${operationKey}-${ownerNonce}`,
      readOnlyRootfs: true as const,
      readOnlyCandidateBundle: true as const,
      candidateBundleSource: 'C:\\sec\\candidate.bundle',
      initProcess: true as const,
      executableTestTmpfs: true as const,
      nonExecutableMutableTmpfs: true as const,
      dependencyCacheVolumeName: null,
      labels: Object.freeze({
        ...imageLabels,
        'sec.trusted-runtime.operation': operationKey,
        'sec.trusted-runtime.repository': expected.repository,
        'sec.trusted-runtime.base-sha': expected.baseSha,
        'sec.trusted-runtime.head-sha': expected.headSha,
        'sec.trusted-runtime.endpoint-digest': expected.endpointDigest,
        'sec.trusted-runtime.owner-host': expected.ownerHost,
        'sec.trusted-runtime.owner-pid': '4242',
        'sec.trusted-runtime.owner-nonce': ownerNonce,
        'sec.trusted-runtime.image-id': expected.imageId
      })
    });
    let observations = 0;
    expect(authorizeTrustedRuntimeContainerRecovery({
      first: identity,
      confirmed: identity,
      expected,
      observeProcessLiveness: () => {
        observations += 1;
        return 'dead';
      }
    })).toBe(identity.id);
    expect(observations).toBe(2);
    expect(() => authorizeTrustedRuntimeContainerRecovery({
      first: { ...identity,
        dependencyCacheVolumeName: 'sec-trusted-runtime-bun-cache-v1-1234567890abcdef1234567890abcdef' },
      confirmed: identity,
      expected,
      observeProcessLiveness: () => 'dead'
    })).toThrow(/differs from the fenced operation/);
    expect(() => authorizeTrustedRuntimeContainerRecovery({
      first: identity,
      confirmed: identity,
      expected,
      observeProcessLiveness: () => 'alive'
    })).toThrow(/recovery is not authorized/);
    expect(() => authorizeTrustedRuntimeContainerRecovery({
      first: identity,
      confirmed: { ...identity, id: '5'.repeat(64) },
      expected,
      observeProcessLiveness: () => 'dead'
    })).toThrow(/identity or owner liveness changed/);
    expect(() => authorizeTrustedRuntimeContainerRecovery({
      first: identity,
      confirmed: { ...identity, candidateBundleSource: 'C:\\foreign\\candidate.bundle' },
      expected,
      observeProcessLiveness: () => 'dead'
    })).toThrow(/identity or owner liveness changed/);
    expect(() => authorizeTrustedRuntimeContainerRecovery({
      first: { ...identity, labels: { ...identity.labels,
        'sec.trusted-runtime.owner-host': 'foreign-host' } },
      confirmed: identity,
      expected,
      observeProcessLiveness: () => 'dead'
    })).toThrow(/differs from the fenced operation/);
    expect(() => authorizeTrustedRuntimeContainerRecovery({
      first: { ...identity, labels: { ...identity.labels,
        'sec.trusted-runtime.image-schema': 'foreign-image' } },
      confirmed: identity,
      expected,
      observeProcessLiveness: () => 'dead'
    })).toThrow(/differs from the fenced operation/);
  });

  test('one exact label set drives Docker create and identity readback', () => {
    const labels = composeTrustedRuntimeContainerLabels(
      { 'sec.trusted-runtime.image-schema': 'sec-trusted-runtime-container-v1' },
      { 'sec.trusted-runtime.operation': 'main-12345678' }
    );
    expect(labels).toEqual({
      'sec.trusted-runtime.image-schema': 'sec-trusted-runtime-container-v1',
      'sec.trusted-runtime.operation': 'main-12345678'
    });
    expect(() => composeTrustedRuntimeContainerLabels(
      { shared: 'image' },
      { shared: 'operation' }
    )).toThrow('collide with retained operation identity');
  });

  test('admits an exact Docker cache inspect and binds its endpoint and volume identity', () => {
    const marker = createTrustedRuntimeDependencyCacheMarker({
      repository: 'sec-platform/sec',
      bunLockBlobSha: '1'.repeat(40),
      imageId: TRUSTED_RUNTIME_CONTAINER_IMAGE_ID
    });
    const spec = createTrustedRuntimeDependencyCacheVolumeSpec(marker);
    const inspect = JSON.stringify([{
      CreatedAt: '2026-08-21T00:00:00Z',
      Driver: 'local',
      Labels: spec.labels,
      Name: spec.name,
      Options: null,
      Scope: 'local'
    }]);
    const expectedName = `sec-trusted-runtime-bun-cache-v1-${marker.cacheKey.slice(7, 39)}`;
    // Encode the retained v1 identity independently, with canonical key order.
    const expectedDigest = `sha256:${createHash('sha256').update(JSON.stringify({
      createdAt: '2026-08-21T00:00:00Z',
      driver: 'local',
      endpointDigest: `sha256:${'2'.repeat(64)}`,
      labels: {
        'sec.trusted-runtime.cache-key': marker.cacheKey,
        'sec.trusted-runtime.cache-schema': 'sec-trusted-runtime-dependency-cache-volume-v1',
        'sec.trusted-runtime.image-id': TRUSTED_RUNTIME_CONTAINER_IMAGE_ID,
        'sec.trusted-runtime.repository': 'sec-platform/sec'
      },
      name: expectedName,
      schema: 'sec-trusted-runtime-dependency-cache-volume-v1',
      scope: 'local'
    })).digest('hex')}`;
    expect(spec.name).toBe(expectedName);
    expect(assertTrustedRuntimeDependencyCacheVolume({
      source: inspect,
      expected: spec,
      endpointDigest: `sha256:${'2'.repeat(64)}`
    })).toBe(expectedDigest);
    expect(() => assertTrustedRuntimeDependencyCacheVolume({
      source: JSON.stringify([{
        ...JSON.parse(inspect)[0],
        Labels: { ...spec.labels, 'sec.trusted-runtime.cache-key': `sha256:${'3'.repeat(64)}` }
      }]),
      expected: spec,
      endpointDigest: `sha256:${'2'.repeat(64)}`
    })).toThrow(/differs from the content-addressed specification/);
  });
});
