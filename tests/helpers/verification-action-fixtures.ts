import type { CiVerificationNormalizedOperation, VerificationActionKeyDigest, VerificationActionPlan } from '../../src/execution/verification/action.ts';
import type { HostedSutSandboxReceipt } from "../../src/execution/verification/hosted.ts";

import { CI_VERIFICATION_HOSTED_EXECUTION_ENVIRONMENT } from '../../src/adapters/verification/platform/action/contract/ci.ts';
import type { VerificationActionProviderOrigin } from '../../src/adapters/verification/platform/action/contract/provider.ts';
import { CodexDevelopmentFinalizeVerificationActionTerminalArtifact, CodexDevelopmentVerificationActionCandidateBytesDigest, CodexDevelopmentVerificationDigest, type CodexDevelopmentVerificationActionTerminalArtifact } from '../../src/adapters/verification/platform/ci/contract/evidence.ts';
import { CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA, CodexDevelopmentCreateHostedSutExecutionAuthorization, CodexDevelopmentFinalizeHostedActionRawResult, CodexDevelopmentReduceHostedSutObservation } from '../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts';
import { CI_VERIFICATION_HOSTED_SANDBOX_POLICY, CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST } from '../../src/adapters/verification/platform/ci/contract/revision.ts';

function verificationFixtureDigest(value: unknown): VerificationActionKeyDigest {
  return CodexDevelopmentVerificationDigest(value) as VerificationActionKeyDigest;
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
}>): CodexDevelopmentVerificationActionTerminalArtifact {
  const artifactInput = Object.freeze({
    baseSha: input.baseSha,
    baseTreeSha: input.baseTreeSha,
    headSha: input.headSha,
    headTreeSha: input.headTreeSha,
    manifestPath: input.manifestPath,
    manifestDigest: input.manifestDigest,
    inputClosureDigest: CodexDevelopmentVerificationDigest(input.actionPlan.action.inputClosure),
    candidateBytesDigest: CodexDevelopmentVerificationActionCandidateBytesDigest({
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
  const authorization = CodexDevelopmentCreateHostedSutExecutionAuthorization({
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
      lifecycle: Object.freeze({
        supervisorSpawned: true, supervisorClosed: true, supervisorCloseCode: 1, supervisorSignal: null,
        namespaceEstablished: false, candidateStarted: false, candidateUnitSettled: true, observationGap: null
      }),
      exitCode: 1,
      markerObserved: false,
      outputDigest,
      cleanup: Object.freeze({
        supervisorSpawned: true, supervisorClosed: true, exitCode: 0, outputDigest: residueDigest
      }),
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
      lifecycle: Object.freeze({
        supervisorSpawned: false, supervisorClosed: false, supervisorCloseCode: null, supervisorSignal: null,
        namespaceEstablished: false, candidateStarted: false, candidateUnitSettled: null, observationGap: null
      }),
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
      boundedFailureTailDigest: outputDigest
    }),
    cleanup: Object.freeze({
      supervisorSpawned: false, supervisorClosed: false, exitCode: null, outputDigest: residueDigest
    }),
    diagnostic: unsupportedDiagnostic
  });
  const sandboxReceipt = Object.freeze({
    ...receiptWithoutDigest,
    receiptDigest: verificationFixtureDigest(receiptWithoutDigest)
  }) as HostedSutSandboxReceipt<typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY, typeof import("../../src/adapters/verification/platform/ci/contract/revision.ts").CI_VERIFICATION_HOSTED_SANDBOX_POLICY_DIGEST, typeof import("../../src/adapters/verification/platform/ci/contract/hosted-sut-observation.ts").CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA>;
  const observation = CodexDevelopmentFinalizeHostedActionRawResult({
    executionAuthorizationDigest: authorization.authorizationDigest,
    command: null,
    sandboxReceipt,
    startedAt: '2026-08-09T00:00:00.000Z',
    finishedAt: '2026-08-09T00:00:01.000Z'
  });
  const terminal = CodexDevelopmentReduceHostedSutObservation({
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
  return CodexDevelopmentFinalizeVerificationActionTerminalArtifact({
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
