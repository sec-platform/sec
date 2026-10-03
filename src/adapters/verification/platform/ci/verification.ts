import { enableExecutionProgress, reportExecutionProgress } from '../../../../execution/execution-progress.ts';
import {
  CodexDevelopmentCiVerificationHostedActionCli,
  CodexDevelopmentCiVerificationMain,
  HOSTED_ACTION_COMMANDS
} from './verification-cli.ts';

export {
  CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA,
  CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA,
  type CodexDevelopmentHostedActionRawResult,
  type CodexDevelopmentHostedSutSandboxReceipt
} from './contract/hosted-sut-observation.ts';

export {
  CI_VERIFICATION_ACTION_ARTIFACT_INDEX_SCHEMA, CI_VERIFICATION_ACTION_COORDINATION_SCHEMA, CI_VERIFICATION_ACTION_EXECUTION_TICKET_SCHEMA, CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA, CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA, CodexDevelopmentAssembleHostedActionTerminal, CodexDevelopmentAssertHostedActionDependencyInputsV1, CodexDevelopmentAssertHostedDependencyArchiveProjection, CodexDevelopmentAssertHostedSutSandboxCommandPlan, CodexDevelopmentAssertPreparedHostedActionCandidate, CodexDevelopmentAssertTrustedBootstrapSutMaterializationClean, CodexDevelopmentBuildHostedSutSandboxCommandPlan,
  CodexDevelopmentBuildTrustedBootstrapSutSandboxCommandPlan, CodexDevelopmentCandidateProcessEnvironment, CodexDevelopmentCaptureHostedDependencyPhysicalSnapshot, CodexDevelopmentComposeHostedEvidence, CodexDevelopmentCoordinateHostedActions, CodexDevelopmentCreateHostedActionExecutionTicket, CodexDevelopmentExecuteCiActionClosure, CodexDevelopmentExecuteHostedActionSut, CodexDevelopmentExecuteTrustedBootstrapSut, CodexDevelopmentHostedDependencyMaterializerEnvironment, CodexDevelopmentHostedSutCapabilityAssertion, CodexDevelopmentInspectHostedActionArchive, CodexDevelopmentInspectHostedActionArchiveInventory, CodexDevelopmentMaterializeHostedActionCandidate, CodexDevelopmentMaterializeTrustedBootstrapArchive, CodexDevelopmentParseHostedActionExecutionTicket, CodexDevelopmentParseHostedActionRawResult, CodexDevelopmentParseHostedActionRequest, CodexDevelopmentParseHostedActionResolution, CodexDevelopmentPrepareHostedActionInputs, CodexDevelopmentPrepareTrustedBootstrapSutInputs, CodexDevelopmentProbeHostedSutSandboxCapability, CodexDevelopmentReadHostedActionArtifactIndex, CodexDevelopmentReduceHostedActionProviderIndex, CodexDevelopmentResolveHostedAction, CodexDevelopmentRunBoundedDependencyMaterialization, CodexDevelopmentTrustedBootstrapSutHarness, CodexDevelopmentValidateHostedActionArchiveInventory, type CodexDevelopmentCiActionExecution, type CodexDevelopmentCiVerificationTestOptions, type CodexDevelopmentDependencyMaterializationRecovery, type CodexDevelopmentHostedActionArchiveInventory, type CodexDevelopmentHostedActionArtifactObservation, type CodexDevelopmentHostedActionCoordination, type CodexDevelopmentHostedActionExecutionTicket, type CodexDevelopmentHostedActionProposal, type CodexDevelopmentHostedActionProviderIndex, type CodexDevelopmentHostedActionResolution, type CodexDevelopmentHostedActionStartObservation,
  type CodexDevelopmentHostedActionTerminalAnchorObservation, type CodexDevelopmentHostedDependencyArchiveProjection, type CodexDevelopmentHostedDependencyPhysicalSnapshot, type CodexDevelopmentHostedSutSandboxCommandPlan, type CodexDevelopmentHostedSutSandboxProcess, type CodexDevelopmentHostedSutSandboxProcessObservation, type CodexDevelopmentPreparedHostedActionInputs, type CodexDevelopmentPreparedTrustedBootstrapSutInputs
} from './verification-runtime.ts';

export {
  CodexDevelopmentAssertHostedActionParentEvent,
  CodexDevelopmentCiVerificationHostedActionCli, CodexDevelopmentCiVerificationMain,
  CodexDevelopmentCiVerificationMainForTests
} from './verification-cli.ts';

async function main(): Promise<number> {
  if (HOSTED_ACTION_COMMANDS.has(process.argv[2] ?? '')) {
    const result = await CodexDevelopmentCiVerificationHostedActionCli(process.argv.slice(2));
    process.stdout.write(`${result}\n`);
    return 0;
  }
  return CodexDevelopmentCiVerificationMain();
}

if (import.meta.main) {
  enableExecutionProgress();
  reportExecutionProgress({ command: 'ci-verification', phase: 'command', state: 'start' });
  try {
    const exitCode = await main();
    reportExecutionProgress({
      command: 'ci-verification', phase: 'command',
      state: exitCode === 0 ? 'complete' : 'failed', detail: { exitCode }
    });
    process.exitCode = exitCode;
  } catch (error) {
    reportExecutionProgress({
      command: 'ci-verification', phase: 'command', state: 'failed',
      detail: { error: error instanceof Error ? error.message : String(error) }
    });
    throw error;
  }
}
