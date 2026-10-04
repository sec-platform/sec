import { expect, test } from 'bun:test';
import { SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY } from '../../src/adapters/providers/linux-verification/contract.ts';
import { assertLinuxVerificationUnitResult, LINUX_VERIFICATION_UNIT_CONTRACT_DIGEST } from '../../src/adapters/runtime-state/physical/runtime/linux-verification-unit.ts';
import { encodeVerificationActionData } from '../../src/adapters/verification/platform/action/contract/action.ts';
import { CI_VERIFICATION_PER_JOB_HOSTED_PROVIDER_REVISION } from '../../src/adapters/verification/platform/action/contract/environment.ts';
import { CI_HOSTED_JOB_RUNTIME_POLICY_DIGEST } from '../../src/adapters/verification/platform/ci/contract/hosted-job-runtime-policy.ts';
import { assertHostedJobRuntimeReceiptBinding, assertHostedJobRuntimeReceiptOutput, createHostedJobRuntimeReceipt, hostedJobRuntimeReceiptComplete, parseHostedJobRuntimeReceipt } from '../../src/adapters/verification/platform/ci/contract/hosted-job-runtime.ts';
import { HOSTED_SUT_SUPERVISOR_RESOURCE_CEILINGS } from '../../src/adapters/verification/platform/ci/runtime/hosted-sut-supervisor.ts';
import { compileHostedSutNativeInnerOperation } from '../../src/bootstrap/development/hosted-sut.ts';
import { assertSemanticOperationProjection } from '../../src/execution/operation/semantic.ts';
import type { VerificationActionKeyDigest } from '../../src/execution/verification/action.ts';
import type { HostedActionRawResult, HostedSutSandboxReceipt } from "../../src/execution/verification/hosted.ts";


import { buildCiVerificationActionPlanClosure, ciVerificationGateStep, type CiVerificationActionCandidate } from '../../src/adapters/verification/platform/action/contract/ci.ts';
import { CI_VERIFICATION_HOSTED_PROVIDER_REVISION } from '../../src/adapters/verification/platform/action/contract/environment.ts';
import type { VerificationActionProviderOrigin } from '../../src/adapters/verification/platform/action/contract/provider.ts';
import { CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA, CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT, CodexDevelopmentCreateHostedSutExecutionAuthorization, CodexDevelopmentFinalizeHostedActionRawResult, CodexDevelopmentReduceHostedSutObservation } from '../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts';
import { buildCiQuickGatePlan } from '../../src/adapters/verification/platform/ci/contract/plan.ts';
import { CI_VERIFICATION_HOSTED_SANDBOX_POLICY, CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST } from '../../src/adapters/verification/platform/ci/contract/revision.ts';
import { CI_VERIFICATION_CONTRACT_REVISION } from '../../src/assurance/verification/contract/revision.ts';
import { sha256 as canonicalSha256, rawSha256 } from '../../src/contracts/canonical.ts';

const digest = (value: string): VerificationActionKeyDigest =>
  `sha256:${value.repeat(64).slice(0, 64)}` as VerificationActionKeyDigest;
const canonicalDigest = (value: unknown): VerificationActionKeyDigest =>
  canonicalSha256(value) as VerificationActionKeyDigest;

const candidate: CiVerificationActionCandidate = Object.freeze({
  baseSha: '1'.repeat(40),
  baseTreeSha: '2'.repeat(40),
  headSha: '3'.repeat(40),
  headTreeSha: '4'.repeat(40),
  manifestPath: 'config/repository/work-packages/example-v1.md',
  manifestDigest: digest('a'),
  scopeAuthorizationRevision: digest('b'),
  profile: 'quick',
  toolchainRevision: 'bun@1.3.14',
  providerRevision: CI_VERIFICATION_HOSTED_PROVIDER_REVISION,
  contractRevision: CI_VERIFICATION_CONTRACT_REVISION,
  requiredBlobs: Object.freeze([
    { path: '.bun-version', digest: digest('c') },
    { path: 'bun.lock', digest: digest('d') },
    { path: 'bunfig.toml', digest: digest('e') },
    { path: 'package.json', digest: digest('f') }
  ])
});
const closure = buildCiVerificationActionPlanClosure({
  candidate,
  gates: [ciVerificationGateStep(
    buildCiQuickGatePlan({ includeImports: false, includeDocs: false })[0]!
  )]
});
const actionPlan = closure.actions[0]!;
const normalizedOperation = closure.normalizedOperations[0]!;
const producer: VerificationActionProviderOrigin = Object.freeze({
  repositoryId: 311,
  repository: 'openai/sec',
  workflowPath: '.github/workflows/compiler-pr-validation.yml',
  workflowRef: `.github/workflows/compiler-pr-validation.yml@${candidate.baseSha}`,
  workflowSha: candidate.baseSha,
  runId: '9001',
  runAttempt: 1,
  appId: 15368,
  appNodeId: 'MDM6QXBwMTUzNjg=',
  sourceEvent: 'repository_dispatch'
});
const inventoryClosure = Object.freeze({
  archiveDigest: digest('1'),
  inventoryDigest: digest('2'),
  entryCount: 12,
  totalFileBytes: 1024,
  dependencyClosureDigest: digest('3'),
  gitBundleDigest: digest('4')
});
const authorization = CodexDevelopmentCreateHostedSutExecutionAuthorization({
  resolutionDigest: digest('5'),
  ticketDigest: digest('6'),
  actionPlan,
  normalizedOperation,
  candidateSha: candidate.headSha,
  candidateBytesDigest: digest('7'),
  manifestPath: candidate.manifestPath,
  inventoryClosure,
  producer
});
const environmentNames = Object.freeze(
  authorization.physicalCommand.fixedSandboxEnvironment.map((entry) => entry.name)
);
const unitName = authorization.physicalCommand.unitName;

function receipt(input: Readonly<{
  capability?: 'supported' | 'unsupported' | 'invalidated';
  exitCode?: number;
  clean?: boolean;
}> = {}): HostedSutSandboxReceipt<typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY, typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST, typeof import("../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA> {
  const capability = input.capability ?? 'supported';
  const clean = input.clean ?? true;
  const executed = capability === 'supported';
  const withoutDigest = Object.freeze({
    schema: CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA,
    policyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST,
    actionKey: actionPlan.action.actionKey,
    capability: Object.freeze({
      commandPlanDigest: capability === 'supported'
        ? authorization.physicalCommand.projectionDigest : digest('9'),
      lifecycle: Object.freeze({
        supervisorSpawned: capability !== 'invalidated', supervisorClosed: clean,
        supervisorCloseCode: capability === 'supported' ? 0 : 1, supervisorSignal: null,
        namespaceEstablished: executed, candidateStarted: executed, candidateUnitSettled: clean,
        observationGap: null
      }),
      exitCode: capability === 'supported' ? 0 : capability === 'unsupported' ? 1 : null,
      markerObserved: capability === 'supported',
      outputDigest: digest('9'),
      cleanup: Object.freeze({
        supervisorSpawned: capability !== 'invalidated', supervisorClosed: clean,
        exitCode: clean ? 0 : null, outputDigest: digest('0')
      }),
      diagnostic: capability === 'supported' ? null
        : capability === 'unsupported' ? 'unshare: operation not permitted'
          : 'capability supervisor observation lost'
    }),
    commandPlanDigest: executed ? authorization.physicalCommand.projectionDigest : null,
    resources: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits,
    authenticatedArchive: inventoryClosure,
    rootIsolation: Object.freeze({
      substrate: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.substrate,
      namespaces: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.namespaces,
      uid: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedUid,
      gid: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.isolatedGid,
      network: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.network,
      inputMount: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.inputMount,
      workspace: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.workspace,
      outputTransport: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.outputTransport,
      candidateEnvironmentNames: executed ? environmentNames : Object.freeze([])
    }),
    execution: Object.freeze({
      lifecycle: Object.freeze({
        supervisorSpawned: executed, supervisorClosed: executed && clean,
        supervisorCloseCode: executed ? (input.exitCode ?? 0) : null, supervisorSignal: null,
        namespaceEstablished: executed, candidateStarted: executed, candidateUnitSettled: executed ? clean : null,
        observationGap: null
      }),
      unitName: executed ? unitName : null,
      exitCode: executed ? (input.exitCode ?? 0) : null,
      authenticatedInputDigest: executed ? inventoryClosure.archiveDigest : null,
      postExecutionInputDigest: executed ? inventoryClosure.archiveDigest : null,
      postExecutionReadbackErrorDigest: null,
      stdoutStderrDigest: digest('a'),
      stdoutDigest: digest('b'),
      stderrDigest: digest('c'),
      stdoutBytesObserved: executed ? 42 : 0,
      stderrBytesObserved: 0,
      outputTruncated: false,
      boundedFailureTailDigest: digest('d')
    }),
    cleanup: Object.freeze({
      supervisorSpawned: executed, supervisorClosed: executed && clean,
      exitCode: executed && clean ? 0 : null, outputDigest: digest('e')
    }),
    diagnostic: executed && (input.exitCode ?? 0) === 0 ? null
      : capability === 'unsupported' ? 'sandbox unsupported'
        : capability === 'invalidated' ? 'sandbox observation lost' : 'gate failed'
  });
  return Object.freeze({
    ...withoutDigest,
    receiptDigest: canonicalDigest(withoutDigest)
  });
}

function raw(input: Readonly<{
  capability?: 'supported' | 'unsupported' | 'invalidated';
  exitCode?: number;
  clean?: boolean;
}> = {}): HostedActionRawResult<typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY, typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST, typeof import("../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA, typeof import("../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA> {
  const sandboxReceipt = receipt(input);
  return CodexDevelopmentFinalizeHostedActionRawResult({
    executionAuthorizationDigest: authorization.authorizationDigest,
    command: (input.capability ?? 'supported') === 'supported' ? Object.freeze({
      commandPlanDigest: sandboxReceipt.commandPlanDigest!,
      executionAuthorizationDigest: authorization.authorizationDigest,
      physicalCommandProjectionDigest: authorization.physicalCommand.projectionDigest
    }) : null,
    sandboxReceipt,
    startedAt: '2026-08-09T00:00:00.000Z',
    finishedAt: '2026-08-09T00:00:01.000Z'
  });
}

function reduce(
  observation: HostedActionRawResult<typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY, typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST, typeof import("../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA, typeof import("../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA>,
  executionAuthorization: typeof authorization = authorization
) {
  return CodexDevelopmentReduceHostedSutObservation({
    actionPlan,
    normalizedOperation,
    candidateSha: candidate.headSha,
    candidateBytesDigest: digest('7'),
    manifestPath: candidate.manifestPath,
    producer,
    authorization: executionAuthorization,
    observation,
    expectedRawResultDigest: observation.rawResultDigest
  });
}

test('raw SUT transport is observation-only and the sole reducer derives four physical terminal states', () => {
  const passed = raw();
  expect(Object.keys(passed).sort()).toEqual([
    'command', 'executionAuthorizationDigest', 'finishedAt', 'rawResultDigest',
    'sandboxReceipt', 'schema', 'startedAt'
  ]);
  for (const forbidden of ['result', 'cleanup', 'status', 'normalizedOperation']) {
    expect(forbidden in passed).toBe(false);
  }
  expect(reduce(passed)).toMatchObject({
    result: { status: 'passed', disposition: 'executed' },
    cleanup: { status: 'passed' },
    proof: {
      authorization: { actionKey: actionPlan.action.actionKey },
      externalRawResultDigest: passed.rawResultDigest
    }
  });
  expect(reduce(raw({ exitCode: 1 })).result.status).toBe('failed');
  expect(reduce(raw({ capability: 'unsupported' })).result.status).toBe('unsupported');
  expect(reduce(raw({ capability: 'invalidated', clean: false })).result.status).toBe('invalidated');
  for (const observation of [
    raw(), raw({ exitCode: 1 }), raw({ capability: 'unsupported' }),
    raw({ capability: 'invalidated', clean: false })
  ]) expect(reduce(observation).result.status).not.toBe('not-run');
});

test('physical command authorization and PASS settlement reject recomputed contradictory observations', () => {
  const original = raw();
  const rehashObservation = (observation: HostedActionRawResult<typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY, typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST, typeof import("../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA, typeof import("../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA>): void => {
    const { receiptDigest: ignoredReceiptDigest, ...receiptWithoutDigest } = observation.sandboxReceipt;
    void ignoredReceiptDigest;
    (observation.sandboxReceipt as { receiptDigest: VerificationActionKeyDigest }).receiptDigest =
      canonicalDigest(receiptWithoutDigest);
    const { rawResultDigest: ignoredRawDigest, ...rawWithoutDigest } = observation;
    void ignoredRawDigest;
    (observation as { rawResultDigest: VerificationActionKeyDigest }).rawResultDigest =
      canonicalDigest(rawWithoutDigest);
  };
  const forgedObservation = (
    mutate: (observation: HostedActionRawResult<typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY, typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST, typeof import("../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA, typeof import("../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA>) => void
  ): HostedActionRawResult<typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY, typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST, typeof import("../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA, typeof import("../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA> => {
    const observation = structuredClone(original) as HostedActionRawResult<typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY, typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST, typeof import("../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA, typeof import("../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA>;
    mutate(observation);
    rehashObservation(observation);
    return observation;
  };
  const rehashAuthorization = (value: typeof authorization): void => {
    const { projectionDigest: ignoredProjectionDigest, ...physicalWithoutDigest } = value.physicalCommand;
    void ignoredProjectionDigest;
    (value.physicalCommand as { projectionDigest: VerificationActionKeyDigest }).projectionDigest =
      canonicalDigest(physicalWithoutDigest);
    const { authorizationDigest: ignoredAuthorizationDigest, ...authorizationWithoutDigest } = value;
    void ignoredAuthorizationDigest;
    (value as { authorizationDigest: VerificationActionKeyDigest }).authorizationDigest =
      canonicalDigest(authorizationWithoutDigest);
  };

  const forgedPlan = forgedObservation((observation) => {
    (observation.command as { commandPlanDigest: VerificationActionKeyDigest }).commandPlanDigest = digest('f');
    (observation.sandboxReceipt as { commandPlanDigest: VerificationActionKeyDigest | null })
      .commandPlanDigest = digest('f');
  });
  expect(() => reduce(forgedPlan)).toThrow(/physical command observation/u);

  const forgedUnit = forgedObservation((observation) => {
    (observation.sandboxReceipt.execution as { unitName: string | null }).unitName =
      `sec-sut-${actionPlan.action.actionKey.slice(7, 23)}-attacker`;
  });
  expect(() => reduce(forgedUnit)).toThrow(/physical command observation/u);

  const forgedEnvironmentName = forgedObservation((observation) => {
    (observation.sandboxReceipt.rootIsolation as { candidateEnvironmentNames: readonly string[] })
      .candidateEnvironmentNames = Object.freeze(
        [...environmentNames.slice(1), 'SEC_ATTACKER_INPUT'].sort()
      );
  });
  expect(() => reduce(forgedEnvironmentName)).toThrow(/physical command observation/u);

  const forgedCapabilityPlan = forgedObservation((observation) => {
    (observation.sandboxReceipt.capability as { commandPlanDigest: VerificationActionKeyDigest | null })
      .commandPlanDigest = digest('e');
  });
  expect(() => reduce(forgedCapabilityPlan)).toThrow(/non-supported sandbox observation/u);

  const missingCapabilityPlan = forgedObservation((observation) => {
    (observation.sandboxReceipt.capability as { commandPlanDigest: VerificationActionKeyDigest | null })
      .commandPlanDigest = null;
  });
  expect(() => reduce(missingCapabilityPlan)).toThrow(/non-supported sandbox observation/u);

  const missingExecutionPlan = forgedObservation((observation) => {
    (observation.sandboxReceipt as { commandPlanDigest: VerificationActionKeyDigest | null })
      .commandPlanDigest = null;
  });
  expect(() => reduce(missingExecutionPlan)).toThrow(/physical command observation/u);

  const forgedProjection = forgedObservation((observation) => {
    (observation.command as { physicalCommandProjectionDigest: VerificationActionKeyDigest })
      .physicalCommandProjectionDigest = digest('d');
  });
  expect(() => reduce(forgedProjection)).toThrow(/physical command observation/u);

  for (const mutate of [
    (observation: HostedActionRawResult<typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY, typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST, typeof import("../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA, typeof import("../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA>) => {
      (observation.sandboxReceipt.execution as { outputTruncated: boolean }).outputTruncated = true;
    },
    (observation: HostedActionRawResult<typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY, typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST, typeof import("../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA, typeof import("../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA>) => {
      (observation.sandboxReceipt.execution as { stdoutBytesObserved: number }).stdoutBytesObserved =
        CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT + 1;
    },
    (observation: HostedActionRawResult<typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY, typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST, typeof import("../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA, typeof import("../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA>) => {
      (observation.sandboxReceipt.execution as { stderrBytesObserved: number }).stderrBytesObserved =
        CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT + 1;
    },
    (observation: HostedActionRawResult<typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY, typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST, typeof import("../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA, typeof import("../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA>) => {
      (observation.sandboxReceipt as { diagnostic: string | null }).diagnostic = 'dirty successful receipt';
    },
    (observation: HostedActionRawResult<typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY, typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST, typeof import("../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA, typeof import("../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA>) => {
      (observation.sandboxReceipt.execution.lifecycle as { candidateStarted: boolean }).candidateStarted = false;
    },
    (observation: HostedActionRawResult<typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY, typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST, typeof import("../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA, typeof import("../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA>) => {
      (observation.sandboxReceipt.execution as { postExecutionInputDigest: VerificationActionKeyDigest | null })
        .postExecutionInputDigest = null;
    },
    (observation: HostedActionRawResult<typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY, typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST, typeof import("../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA, typeof import("../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA>) => {
      (observation.sandboxReceipt.execution.lifecycle as { namespaceEstablished: boolean }).namespaceEstablished = false;
    },
    (observation: HostedActionRawResult<typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY, typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST, typeof import("../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA, typeof import("../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA>) => {
      (observation.sandboxReceipt.execution.lifecycle as { candidateUnitSettled: boolean | null }).candidateUnitSettled = null;
    }
  ]) {
    expect(reduce(forgedObservation(mutate)).result.status).toBe('invalidated');
  }

  const forgedCapabilityDiagnostic = forgedObservation((observation) => {
    (observation.sandboxReceipt.capability as { diagnostic: string | null }).diagnostic =
      'dirty supported capability';
  });
  expect(() => reduce(forgedCapabilityDiagnostic)).toThrow(/non-supported sandbox observation/u);

  const forgedEnvironmentValueAuthorization = structuredClone(authorization);
  const fixedEnvironment = forgedEnvironmentValueAuthorization.physicalCommand.fixedSandboxEnvironment
    .map((entry) => ({ ...entry }));
  fixedEnvironment[0]!.valueDigest = digest('c');
  (forgedEnvironmentValueAuthorization.physicalCommand as {
    fixedSandboxEnvironment: readonly Readonly<{ name: string; valueDigest: VerificationActionKeyDigest }>[];
  }).fixedSandboxEnvironment = Object.freeze(fixedEnvironment.map((entry) => Object.freeze(entry)));
  rehashAuthorization(forgedEnvironmentValueAuthorization);
  expect(() => reduce(original, forgedEnvironmentValueAuthorization)).toThrow(/physical command differs/u);

  const forgedArgvAuthorization = structuredClone(authorization);
  (forgedArgvAuthorization.physicalCommand as { canonicalArgvDigest: VerificationActionKeyDigest })
    .canonicalArgvDigest = digest('b');
  rehashAuthorization(forgedArgvAuthorization);
  expect(() => reduce(original, forgedArgvAuthorization)).toThrow(/physical command differs/u);

  const forgedInventory = forgedObservation((observation) => {
    (observation.sandboxReceipt.authenticatedArchive as { inventoryDigest: VerificationActionKeyDigest })
      .inventoryDigest = digest('a');
  });
  expect(() => reduce(forgedInventory)).toThrow(/exact inventory closure/u);

  expect(() => CodexDevelopmentReduceHostedSutObservation({
    actionPlan,
    normalizedOperation,
    candidateSha: candidate.headSha,
    candidateBytesDigest: digest('7'),
    manifestPath: candidate.manifestPath,
    producer,
    authorization,
    observation: original,
    expectedRawResultDigest: digest('0')
  })).toThrow(/trusted external observation/u);
});

// Synthetic historical records exercise codecs only. They cannot mint a live
// native unit, an authenticated GitHub origin, or qualified runtime evidence.
function nativeRuntimeReceiptData() {
  const innerSupervisor = { operationIdentityDigest: digest('c'), boundAttemptDigest: digest('d'),
    deadlineAtUnixMs: 90_000, requirementId: 'ci.hosted-sut-supervisor-process' as const,
    requirementContractDigest: digest('e'), resourceCeilingIdentityDigest: digest('f'), settlementReceiptDigest: digest('0') };
  const git = { baseSha: '1'.repeat(40), baseTreeSha: '2'.repeat(40),
    headSha: '1'.repeat(40), headTreeSha: '2'.repeat(40), status: '' as const };
  const unitBody = {
    schema: 'sec-linux-native-verification-unit-receipt-v1' as const,
    profileRevision: 'sec-linux-native-verification-unit-v1' as const,
    profileDigest: LINUX_VERIFICATION_UNIT_CONTRACT_DIGEST,
    operationIdentityDigest: digest('a'), boundAttemptDigest: digest('b'), providerIdentityDigest: digest('c'),
    inputDigest: digest('d'), invocationDigest: digest('e'), deadlineAtUnixMs: 100_000,
    unit: { name: `sec-native-${'1'.repeat(32)}.service`, invocationId: '2'.repeat(32),
      managerBootId: '00000000-0000-0000-0000-000000000001', managerStartTime: '100',
      cgroupPath: `/system.slice/sec-native-${'1'.repeat(32)}.service`, mainPid: 2,
      mainPidStartTime: '200', namespaceIdentities: { mount: 'mnt:[11]', pid: 'pid:[12]',
        network: 'net:[13]', user: 'user:[14]', ipc: 'ipc:[15]' }, rootDevice: '1', rootInode: '2',
      workingDirectory: '/sec-runtime/trusted', workingDirectoryDevice: '1', workingDirectoryInode: '3',
      trustedPackageReadable: true as const, outputWritable: true as const,
      managerMainPid: 3, managerMainPidStartTime: '150' },
    inputs: { runtimeManifestDigest: digest('f'), bundleDigest: digest('1'),
      dependencyContentDigest: digest('2'), sutArchiveDigest: null },
    gitBefore: git, gitAfter: git,
    execution: { exitCode: 0, stdoutDigest: digest('3'), stderrDigest: digest('4'),
      stdoutBytes: 10, stderrBytes: 0, outputTruncated: false as const },
    outputFiles: [], settlement: { unitInactive: true as const, cgroupEmpty: true as const,
      privateMountsRetired: true as const, inputsRetired: true as const }
  };
  const control = `${encodeVerificationActionData({ schema: 'sec-hosted-sut-native-control-v1',
    outer: { operationIdentityDigest: unitBody.operationIdentityDigest, boundAttemptDigest: unitBody.boundAttemptDigest,
      providerIdentityDigest: unitBody.providerIdentityDigest, inputDigest: unitBody.inputDigest, deadlineAtUnixMs: unitBody.deadlineAtUnixMs },
    phase: 'self-test-hosted-action-sandbox', actionKey: digest('8'), resolutionDigest: digest('a'), innerSupervisor, output: {} })}\n`;
  const observedUnitBody = { ...unitBody, execution: { ...unitBody.execution,
    stdoutDigest: rawSha256(control), stdoutBytes: Buffer.byteLength(control) } };
  const nativeUnit = { ...observedUnitBody, receiptDigest: canonicalDigest(observedUnitBody) };
  return createHostedJobRuntimeReceipt({ providerRevision: 'historical-native-environment-fixture',
    origin: { repository: 'sec-platform/sec', repositoryId: '1', workflowPath: '.github/workflows/compiler-pr-validation.yml',
      workflowSha: git.baseSha, trustedSourceSha: git.baseSha, trustedSourceTreeSha: git.baseTreeSha,
      runId: '2', runAttempt: 1, jobId: '3', checkRunId: '4',
      policyJobId: 'preflight-verification-action-sut', role: 'sut', identityDigest: digest('5'),
      workflowSourceDigest: digest('6'), launcherSourceDigest: digest('7'), originalDeadlineAtUnixMs: 200_000 },
    operation: { phase: 'self-test-hosted-action-sandbox', actionKey: digest('8'),
      operationIdentityDigest: nativeUnit.operationIdentityDigest, boundAttemptDigest: nativeUnit.boundAttemptDigest,
      deadlineAtUnixMs: nativeUnit.deadlineAtUnixMs, resolutionDigest: digest('a') }, nativeUnit, innerSupervisor,
    execution: { started: true, settled: true, exitCode: 0, stdoutBytes: 3, stderrBytes: 0,
      outputDigest: rawSha256('{}\n'), outputTruncated: false, sandboxObservationDigest: digest('9') },
    cleanup: { providerScopeSettled: true, sessionSettlementDigest: digest('a'), processSettlementDigest: digest('b'),
      outputSettled: true, ownedSourcesReleased: true, innerSupervisorSettled: true } });
}

function rehashRuntimeReceipt(value: ReturnType<typeof nativeRuntimeReceiptData>) {
  const { receiptDigest: ignoredUnitDigest, ...unitBody } = value.nativeUnit;
  void ignoredUnitDigest;
  const nativeUnit = { ...unitBody, receiptDigest: canonicalDigest(unitBody) };
  const { receiptDigest: ignoredReceiptDigest, ...body } = { ...value, nativeUnit };
  void ignoredReceiptDigest;
  return { ...body, receiptDigest: canonicalDigest(body) };
}

test('native hosted receipt rejects recomputed source, attempt and output contradictions', () => {
  const data = nativeRuntimeReceiptData();
  for (const altered of [
    { ...data, operation: { ...data.operation, boundAttemptDigest: digest('f') } },
    { ...data, execution: { ...data.execution, outputDigest: digest('e') } },
    { ...data, execution: { ...data.execution, stdoutBytes: 11 } },
    { ...data, innerSupervisor: { ...data.innerSupervisor, boundAttemptDigest: digest('9') } },
    { ...data, innerSupervisor: { ...data.innerSupervisor, deadlineAtUnixMs: 100_001 } },
    { ...data, nativeUnit: { ...data.nativeUnit,
      gitBefore: { ...data.nativeUnit.gitBefore, baseSha: 'a'.repeat(40) },
      gitAfter: { ...data.nativeUnit.gitAfter, baseSha: 'a'.repeat(40) } } }
  ]) {
    expect(() => {
      const parsed = parseHostedJobRuntimeReceipt(rehashRuntimeReceipt(altered));
      if (parsed.schema !== 'sec-hosted-job-runtime-receipt-v2') throw new Error('native schema expected');
      assertHostedJobRuntimeReceiptOutput(parsed, '{}\n');
    }).toThrow();
  }
  const expected = { origin: data.origin, phase: data.operation.phase, actionKey: data.operation.actionKey, resolutionDigest: data.operation.resolutionDigest,
    executionEnvironmentRevision: data.providerRevision, runtimeManifestDigest: data.nativeUnit.inputs.runtimeManifestDigest };
  expect(() => assertHostedJobRuntimeReceiptBinding(data, { ...expected, executionEnvironmentRevision: 'other-native-runtime' }))
    .toThrow(/independent native job, runtime or Action binding/u);
  expect(() => assertHostedJobRuntimeReceiptBinding(data, { ...expected, runtimeManifestDigest: digest('0') }))
    .toThrow(/independent native job, runtime or Action binding/u);
  expect(() => assertHostedJobRuntimeReceiptBinding(data, { ...expected, actionKey: digest('0') }))
    .toThrow(/independent native job, runtime or Action binding/u);
});

test('native hosted receipt never restores live unit authority from parsed complete data', () => {
  const parsed = parseHostedJobRuntimeReceipt(nativeRuntimeReceiptData());
  expect(hostedJobRuntimeReceiptComplete(parsed)).toBe(true);
  assertHostedJobRuntimeReceiptOutput(nativeRuntimeReceiptData(), '{}\n');
  expect(() => assertHostedJobRuntimeReceiptOutput(nativeRuntimeReceiptData(), '{"changed":true}\n')).toThrow();
  expect(() => assertLinuxVerificationUnitResult({ receipt: nativeRuntimeReceiptData().nativeUnit, stdout: new Uint8Array(),
    stderr: new Uint8Array(), outputFiles: {} } as unknown as Parameters<typeof assertLinuxVerificationUnitResult>[0],
    {} as Parameters<typeof assertLinuxVerificationUnitResult>[1])).toThrow();
  const data = nativeRuntimeReceiptData();
  const incomplete = structuredClone(data) as unknown as Record<string, unknown>;
  incomplete.cleanup = { ...data.cleanup, ownedSourcesReleased: false };
  expect(() => parseHostedJobRuntimeReceipt(incomplete)).toThrow();
  const truncated = structuredClone(data) as unknown as Record<string, unknown>;
  truncated.execution = { ...data.execution, outputTruncated: true };
  expect(() => parseHostedJobRuntimeReceipt(truncated)).toThrow();
});

test('historical Docker receipt decoding cannot satisfy active native completeness', () => {
  const native = nativeRuntimeReceiptData();
  const authority = SEC_LINUX_VERIFICATION_ENVIRONMENT_AUTHORITY;
  const body = { schema: 'sec-hosted-job-runtime-receipt-v1',
    providerRevision: CI_VERIFICATION_PER_JOB_HOSTED_PROVIDER_REVISION,
    policyDigest: CI_HOSTED_JOB_RUNTIME_POLICY_DIGEST,
    origin: native.origin, operation: { phase: native.operation.phase, actionKey: native.operation.actionKey,
      operationIdentityDigest: native.operation.operationIdentityDigest, boundAttemptDigest: native.operation.boundAttemptDigest,
      deadlineAtUnixMs: native.operation.deadlineAtUnixMs },
    materialization: { specDigest: digest('a'), runtimeManifestDigest: authority.image.runtimeContentDigest,
      dockerProjectionDigest: authority.image.dockerProjectionDigest, provenanceArtifactDigest: digest('b'),
      executionImageDigest: authority.trustedRuntime.imageDigest,
      bunExecutableDigest: authority.trustedRuntime.bunExecutableDigest,
      engineProviderIdentityDigest: digest('c'), ociExporterIdentityDigest: digest('d') },
    container: { id: '1'.repeat(64), name: 'historical-unit', ownershipDigest: digest('e'),
      creationReadbackDigest: digest('f'), startedReadbackDigest: digest('1'), terminalReadbackDigest: digest('2') },
    execution: { ...native.execution },
    cleanup: { containerAbsent: true, providerScopeSettled: true, outputSettled: true, ownedSourcesReleased: true }
  };
  const decoded = parseHostedJobRuntimeReceipt({ ...body, receiptDigest: canonicalDigest(body) });
  expect(decoded.schema).toBe('sec-hosted-job-runtime-receipt-v1');
  expect(hostedJobRuntimeReceiptComplete(decoded)).toBe(false);
  expect(() => assertHostedJobRuntimeReceiptBinding(decoded, { origin: native.origin,
    phase: native.operation.phase, actionKey: native.operation.actionKey, resolutionDigest: native.operation.resolutionDigest,
    executionEnvironmentRevision: native.providerRevision, runtimeManifestDigest: native.nativeUnit.inputs.runtimeManifestDigest }))
    .toThrow(/independent native job, runtime or Action binding/u);
});

test('native child compiles its own bounded foundation operation instead of restoring JSON authority', () => {
  const started = Date.now();
  const outer = { operationIdentityDigest: digest('1'), boundAttemptDigest: digest('2'),
    providerIdentityDigest: digest('3'), inputDigest: digest('4'), deadlineAtUnixMs: started + 30_000 };
  const operation = compileHostedSutNativeInnerOperation({ outer,
    phase: 'execute-hosted-action-sut', actionKey: digest('5'), resolutionDigest: digest('6') });
  expect(() => assertSemanticOperationProjection(operation)).not.toThrow();
  expect(() => assertSemanticOperationProjection(JSON.parse(JSON.stringify(operation))))
    .toThrow(/foundation-compiled operation plan/u);
  expect(operation.boundAttemptDigest).not.toBe(outer.boundAttemptDigest);
  expect(operation.plan.identity.identityDigest).not.toBe(outer.operationIdentityDigest);
  expect(operation.plan.attempt.deadlineAtUnixMs).toBeLessThanOrEqual(outer.deadlineAtUnixMs);
  expect(operation.plan.execution.aggregateBudgets).toEqual(
    [...HOSTED_SUT_SUPERVISOR_RESOURCE_CEILINGS].sort((left, right) => left.resource.localeCompare(right.resource)));
  const changed = compileHostedSutNativeInnerOperation({ outer: { ...outer, boundAttemptDigest: digest('7') },
    phase: 'execute-hosted-action-sut', actionKey: digest('5'), resolutionDigest: digest('6') });
  expect(changed.plan.identity.identityDigest).not.toBe(operation.plan.identity.identityDigest);
  expect(() => compileHostedSutNativeInnerOperation({ outer: { ...outer, deadlineAtUnixMs: started - 1 },
    phase: 'execute-hosted-action-sut', actionKey: digest('5'), resolutionDigest: digest('6') }))
    .toThrow(/bounded original correlation/u);
});
