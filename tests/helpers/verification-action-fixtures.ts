import {
  CodexDevelopmentFinalizeVerificationActionTerminalArtifactV2,
  CodexDevelopmentVerificationActionCandidateBytesDigestV2,
  CodexDevelopmentVerificationDigest,
  type CodexDevelopmentVerificationActionTerminalArtifactV2
} from '../../platform/shared/ci-evidence-contract.ts';
import {
  CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA_V1,
  CodexDevelopmentCreateHostedSutExecutionAuthorizationV1,
  CodexDevelopmentFinalizeHostedActionRawResultV2,
  CodexDevelopmentReduceHostedSutObservationV1,
  type CodexDevelopmentHostedSutSandboxReceiptV1
} from '../../platform/shared/ci-hosted-sut-observation-contract.ts';
import {
  CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST_V1,
  CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1
} from '../../platform/shared/ci-verification-revision.ts';
import {
  CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT_V2,
  type CiVerificationNormalizedOperationV2
} from '../../platform/shared/verification-action-ci-contract.ts';
import type {
  VerificationActionKeyDigest,
  VerificationActionPlanV2
} from '../../platform/shared/verification-action-contract.ts';
import type {
  VerificationActionProviderOriginV2
} from '../../platform/shared/verification-action-provider-contract.ts';

function verificationFixtureDigest(value: unknown): VerificationActionKeyDigest {
  return CodexDevelopmentVerificationDigest(value) as VerificationActionKeyDigest;
}

export function buildUnsupportedVerificationActionTerminalArtifactV2(input: Readonly<{
  actionPlan: VerificationActionPlanV2;
  normalizedOperation: CiVerificationNormalizedOperationV2;
  baseSha: string;
  baseTreeSha: string;
  headSha: string;
  headTreeSha: string;
  manifestPath: string;
  manifestDigest: VerificationActionKeyDigest;
  producer: VerificationActionProviderOriginV2;
}>): CodexDevelopmentVerificationActionTerminalArtifactV2 {
  const artifactInput = Object.freeze({
    baseSha: input.baseSha,
    baseTreeSha: input.baseTreeSha,
    headSha: input.headSha,
    headTreeSha: input.headTreeSha,
    manifestPath: input.manifestPath,
    manifestDigest: input.manifestDigest,
    inputClosureDigest: CodexDevelopmentVerificationDigest(input.actionPlan.action.inputClosure),
    candidateBytesDigest: CodexDevelopmentVerificationActionCandidateBytesDigestV2({
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
  const authorization = CodexDevelopmentCreateHostedSutExecutionAuthorizationV1({
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
    schema: CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA_V1,
    policyDigest: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST_V1,
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
      sandboxRootAbsent: true,
      residueReadbackDigest: residueDigest,
      diagnostic: unsupportedDiagnostic
    }),
    commandPlanDigest: null,
    resources: CI_VERIFICATION_HOSTED_SANDBOX_POLICY_V1.limits,
    authenticatedArchive: Object.freeze({
      archiveDigest: inventoryClosure.archiveDigest,
      inventoryDigest: inventoryClosure.inventoryDigest,
      dependencyClosureDigest: inventoryClosure.dependencyClosureDigest,
      gitBundleDigest: inventoryClosure.gitBundleDigest,
      entryCount: inventoryClosure.entryCount,
      totalFileBytes: inventoryClosure.totalFileBytes
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
      supervisorExitObserved: false,
      killChildPolicyBound: true,
      supervisorClosed: true
    }),
    residue: Object.freeze({
      sandboxRootAbsent: true,
      hostReadbackDigest: residueDigest
    }),
    diagnostic: unsupportedDiagnostic
  });
  const sandboxReceipt = Object.freeze({
    ...receiptWithoutDigest,
    receiptDigest: verificationFixtureDigest(receiptWithoutDigest)
  }) as CodexDevelopmentHostedSutSandboxReceiptV1;
  const observation = CodexDevelopmentFinalizeHostedActionRawResultV2({
    executionAuthorizationDigest: authorization.authorizationDigest,
    command: null,
    sandboxReceipt,
    startedAt: '2026-08-09T00:00:00.000Z',
    finishedAt: '2026-08-09T00:00:01.000Z'
  });
  const terminal = CodexDevelopmentReduceHostedSutObservationV1({
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
  return CodexDevelopmentFinalizeVerificationActionTerminalArtifactV2({
    actionPlan: input.actionPlan,
    normalizedOperation: input.normalizedOperation,
    result: terminal.result,
    cleanup: terminal.cleanup,
    executionEnvironment: CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT_V2,
    input: artifactInput,
    producer: input.producer,
    executionProof: terminal.proof
  });
}
