import type { VerificationActionKeyDigest, VerificationActionPlan } from '../../src/adapters/verification/platform/action/contract/action.ts';
import { CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT, type CiVerificationNormalizedOperation } from '../../src/adapters/verification/platform/action/contract/ci.ts';
import type { VerificationActionProviderOrigin } from '../../src/adapters/verification/platform/action/contract/provider.ts';
import { finalizeVerificationActionTerminalArtifact, verificationActionCandidateBytesDigest, verificationDigest, type VerificationActionTerminalArtifact } from '../../src/adapters/verification/platform/ci/contract/evidence.ts';
import { CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA, CreateHostedSutExecutionAuthorization, FinalizeHostedActionRawResult, ReduceHostedSutObservation, type HostedSutSandboxReceipt } from '../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts';
import { CI_VERIFICATION_HOSTED_SANDBOX_POLICY, CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST } from '../../src/adapters/verification/platform/ci/contract/revision.ts';

function verificationFixtureDigest(value: unknown): VerificationActionKeyDigest {
  return verificationDigest(value) as VerificationActionKeyDigest;
}

export function buildUnsupportedVerificationActionTerminalArtifact(input: Readonly<{
  actionPlan: VerificationActionPlan;
  normalizedOperation: CiVerificationNormalizedOperation;
  baseSha: string;
  baseTreeSha: string;
  headSha: string;
  headTreeSha: string;
  manifestPath: string;
  manifestDigest: VerificationActionKeyDigest;
  producer: VerificationActionProviderOrigin;
}>): VerificationActionTerminalArtifact {
  const artifactInput = Object.freeze({
    baseSha: input.baseSha,
    baseTreeSha: input.baseTreeSha,
    headSha: input.headSha,
    headTreeSha: input.headTreeSha,
    manifestPath: input.manifestPath,
    manifestDigest: input.manifestDigest,
    inputClosureDigest: verificationDigest(input.actionPlan.action.inputClosure),
    candidateBytesDigest: verificationActionCandidateBytesDigest({
      baseSha: input.baseSha,
      baseTreeSha: input.baseTreeSha,
      headSha: input.headSha,
      headTreeSha: input.headTreeSha,
      manifestPath: input.manifestPath,
      manifestDigest: input.manifestDigest,
      action: input.actionPlan.action
    })
  });
  const inventoryClosure = Object.freeze({
    archiveDigest: verificationFixtureDigest('unsupported-terminal-archive'),
    inventoryDigest: verificationFixtureDigest('unsupported-terminal-inventory'),
    entryCount: 1,
    totalFileBytes: 1,
    dependencyClosureDigest: verificationFixtureDigest('unsupported-terminal-dependencies'),
    gitBundleDigest: verificationFixtureDigest('unsupported-terminal-git-closure')
  });
  const authorization = CreateHostedSutExecutionAuthorization({
    resolutionDigest: verificationFixtureDigest('unsupported-terminal-resolution'),
    ticketDigest: verificationFixtureDigest('unsupported-terminal-ticket'),
    actionPlan: input.actionPlan,
    normalizedOperation: input.normalizedOperation,
    candidateSha: input.headSha,
    candidateBytesDigest: artifactInput.candidateBytesDigest as VerificationActionKeyDigest,
    manifestPath: input.manifestPath,
    inventoryClosure,
    producer: input.producer
  });
  const unsupportedDiagnostic = 'unshare: operation not permitted';
  const outputDigest = verificationFixtureDigest('unsupported-terminal-output');
  const residueDigest = verificationFixtureDigest('unsupported-terminal-residue');
  const receiptWithoutDigest = Object.freeze({
    schema: CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA,
    policyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST,
    actionKey: input.actionPlan.action.actionKey,
    capability: Object.freeze({
      commandPlanDigest: authorization.physicalCommand.projectionDigest,
      commandStarted: true,
      exitCode: 1,
      markerObserved: false,
      outputDigest,
      teardownCommandStarted: true,
      teardownExitCode: 0,
      residueMarkerObserved: true,
      cgroupEmpty: true,
      residueReadbackDigest: residueDigest,
      diagnostic: unsupportedDiagnostic
    }),
    commandPlanDigest: null,
    resources: CI_VERIFICATION_HOSTED_SANDBOX_POLICY.limits,
    authenticatedArchive: Object.freeze({
      archiveDigest: inventoryClosure.archiveDigest,
      inventoryDigest: inventoryClosure.inventoryDigest,
      dependencyClosureDigest: inventoryClosure.dependencyClosureDigest,
      gitBundleDigest: inventoryClosure.gitBundleDigest,
      entryCount: inventoryClosure.entryCount,
      totalFileBytes: inventoryClosure.totalFileBytes
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
      candidateEnvironmentNames: Object.freeze([])
    }),
    execution: Object.freeze({
      started: false,
      unitName: null,
      exitCode: null,
      authenticatedInputDigest: null,
      postExecutionInputDigest: null,
      postExecutionReadbackErrorDigest: null,
      stdoutStderrDigest: outputDigest,
      stdoutDigest: outputDigest,
      stderrDigest: verificationFixtureDigest('unsupported-terminal-stderr'),
      stdoutBytesObserved: 0,
      stderrBytesObserved: 0,
      outputTruncated: false,
      commandStarted: false,
      boundedFailureTailDigest: outputDigest
    }),
    reap: Object.freeze({
      namespacePid1Exited: false,
      killChildEnabled: true,
      unshareProcessClosed: true
    }),
    residue: Object.freeze({
      cgroupEmpty: true,
      hostReadbackDigest: residueDigest
    }),
    diagnostic: unsupportedDiagnostic
  });
  const sandboxReceipt = Object.freeze({
    ...receiptWithoutDigest,
    receiptDigest: verificationFixtureDigest(receiptWithoutDigest)
  }) as HostedSutSandboxReceipt;
  const observation = FinalizeHostedActionRawResult({
    executionAuthorizationDigest: authorization.authorizationDigest,
    command: null,
    sandboxReceipt,
    startedAt: '2026-08-09T00:00:00.000Z',
    finishedAt: '2026-08-09T00:00:01.000Z'
  });
  const terminal = ReduceHostedSutObservation({
    actionPlan: input.actionPlan,
    normalizedOperation: input.normalizedOperation,
    candidateSha: input.headSha,
    candidateBytesDigest: artifactInput.candidateBytesDigest,
    manifestPath: input.manifestPath,
    producer: input.producer,
    authorization,
    observation,
    expectedRawResultDigest: observation.rawResultDigest
  });
  return finalizeVerificationActionTerminalArtifact({
    actionPlan: input.actionPlan,
    normalizedOperation: input.normalizedOperation,
    result: terminal.result,
    cleanup: terminal.cleanup,
    executionEnvironment: CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT,
    input: artifactInput,
    producer: input.producer,
    executionProof: terminal.proof
  });
}
