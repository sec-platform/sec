import { expect, test } from 'bun:test';

import type { VerificationActionKeyDigest } from '../../src/adapters/verification/platform/action/contract/action.ts';
import { buildCiVerificationActionPlanClosure, ciVerificationGateStep, type CiVerificationActionCandidate } from '../../src/adapters/verification/platform/action/contract/ci.ts';
import { CI_VERIFICATION_HOSTED_PROVIDER_REVISION } from '../../src/adapters/verification/platform/action/contract/environment.ts';
import type { VerificationActionProviderOrigin } from '../../src/adapters/verification/platform/action/contract/provider.ts';
import { CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA, CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT, CreateHostedSutExecutionAuthorization, FinalizeHostedActionRawResult, ReduceHostedSutObservation, type HostedActionRawResult, type HostedSutSandboxReceipt } from '../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts';
import { buildCiQuickGatePlan } from '../../src/adapters/verification/platform/ci/contract/plan.ts';
import { CI_VERIFICATION_HOSTED_SANDBOX_POLICY, CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST } from '../../src/adapters/verification/platform/ci/contract/revision.ts';
import { CI_VERIFICATION_CONTRACT_REVISION } from '../../src/assurance/verification/contract/revision.ts';
import { sha256 as canonicalSha256 } from '../../src/contracts/canonical.ts';

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
const authorization = CreateHostedSutExecutionAuthorization({
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
}> = {}): HostedSutSandboxReceipt {
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
      commandStarted: capability !== 'invalidated',
      exitCode: capability === 'supported' ? 0 : capability === 'unsupported' ? 1 : null,
      markerObserved: capability === 'supported',
      outputDigest: digest('9'),
      teardownCommandStarted: capability !== 'invalidated',
      teardownExitCode: capability === 'invalidated' ? null : 0,
      residueMarkerObserved: capability !== 'invalidated',
      cgroupEmpty: clean,
      residueReadbackDigest: digest('0'),
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
      started: executed,
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
      commandStarted: executed,
      boundedFailureTailDigest: digest('d')
    }),
    reap: Object.freeze({
      namespacePid1Exited: executed,
      killChildEnabled: true,
      unshareProcessClosed: clean
    }),
    residue: Object.freeze({ cgroupEmpty: clean, hostReadbackDigest: digest('e') }),
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
}> = {}): HostedActionRawResult {
  const sandboxReceipt = receipt(input);
  return FinalizeHostedActionRawResult({
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
  observation: HostedActionRawResult,
  executionAuthorization: typeof authorization = authorization
) {
  return ReduceHostedSutObservation({
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
  const rehashObservation = (observation: HostedActionRawResult): void => {
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
    mutate: (observation: HostedActionRawResult) => void
  ): HostedActionRawResult => {
    const observation = structuredClone(original) as HostedActionRawResult;
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
    (observation: HostedActionRawResult) => {
      (observation.sandboxReceipt.execution as { outputTruncated: boolean }).outputTruncated = true;
    },
    (observation: HostedActionRawResult) => {
      (observation.sandboxReceipt.execution as { stdoutBytesObserved: number }).stdoutBytesObserved =
        CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT + 1;
    },
    (observation: HostedActionRawResult) => {
      (observation.sandboxReceipt.execution as { stderrBytesObserved: number }).stderrBytesObserved =
        CI_VERIFICATION_HOSTED_SUT_OUTPUT_BYTE_LIMIT + 1;
    },
    (observation: HostedActionRawResult) => {
      (observation.sandboxReceipt as { diagnostic: string | null }).diagnostic = 'dirty successful receipt';
    },
    (observation: HostedActionRawResult) => {
      (observation.sandboxReceipt.execution as { started: boolean }).started = false;
    },
    (observation: HostedActionRawResult) => {
      (observation.sandboxReceipt.execution as { postExecutionInputDigest: VerificationActionKeyDigest | null })
        .postExecutionInputDigest = null;
    },
    (observation: HostedActionRawResult) => {
      (observation.sandboxReceipt.reap as { namespacePid1Exited: boolean }).namespacePid1Exited = false;
    },
    (observation: HostedActionRawResult) => {
      (observation.sandboxReceipt.residue as { cgroupEmpty: boolean }).cgroupEmpty = false;
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

  expect(() => ReduceHostedSutObservation({
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
