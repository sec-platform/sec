import { enableExecutionProgress, reportExecutionProgress } from '../../../../execution/execution-progress.ts';
import {
  HOSTED_ACTION_COMMANDS,
  CodexDevelopmentCiVerificationHostedActionCli,
  CodexDevelopmentCiVerificationMain
} from './verification-cli.ts';

export {
  CI_VERIFICATION_ACTION_RAW_RESULT_SCHEMA,
  CI_VERIFICATION_ACTION_SANDBOX_RECEIPT_SCHEMA,
  type CodexDevelopmentHostedActionRawResult,
  type CodexDevelopmentHostedSutSandboxReceipt
} from './contract/hosted-sut-observation.ts';

export {
  CI_VERIFICATION_ACTION_RESOLUTION_SCHEMA,
  CI_VERIFICATION_ACTION_COORDINATION_SCHEMA,
  CI_VERIFICATION_ACTION_ARTIFACT_INDEX_SCHEMA,
  CI_VERIFICATION_ACTION_EXECUTION_TICKET_SCHEMA,
  CI_VERIFICATION_ACTION_SANDBOX_COMMAND_PLAN_SCHEMA,
  CodexDevelopmentReadHostedActionArtifactIndex,
  CodexDevelopmentParseHostedActionRequest,
  CodexDevelopmentResolveHostedAction,
  CodexDevelopmentParseHostedActionResolution,
  CodexDevelopmentCreateHostedActionExecutionTicket,
  CodexDevelopmentParseHostedActionExecutionTicket,
  CodexDevelopmentReduceHostedActionProviderIndex,
  CodexDevelopmentAssertPreparedHostedActionCandidate,
  CodexDevelopmentHostedDependencyMaterializerEnvironment,
  CodexDevelopmentAssertHostedActionDependencyInputsV1,
  CodexDevelopmentCaptureHostedDependencyPhysicalSnapshot,
  CodexDevelopmentAssertHostedDependencyArchiveProjection,
  CodexDevelopmentMaterializeTrustedBootstrapArchive,
  CodexDevelopmentValidateHostedActionArchiveInventory,
  CodexDevelopmentInspectHostedActionArchiveInventory,
  CodexDevelopmentInspectHostedActionArchive,
  CodexDevelopmentRunBoundedDependencyMaterialization,
  CodexDevelopmentPrepareHostedActionInputs,
  CodexDevelopmentAssertTrustedBootstrapSutMaterializationClean,
  CodexDevelopmentPrepareTrustedBootstrapSutInputs,
  CodexDevelopmentMaterializeHostedActionCandidate,
  CodexDevelopmentCandidateProcessEnvironment,
  CodexDevelopmentTrustedBootstrapSutHarness,
  CodexDevelopmentHostedSutCapabilityAssertion,
  CodexDevelopmentAssertHostedSutSandboxCommandPlan,
  CodexDevelopmentBuildHostedSutSandboxCommandPlan,
  CodexDevelopmentBuildTrustedBootstrapSutSandboxCommandPlan,
  CodexDevelopmentExecuteTrustedBootstrapSut,
  CodexDevelopmentProbeHostedSutSandboxCapability,
  CodexDevelopmentExecuteHostedActionSut,
  CodexDevelopmentParseHostedActionRawResult,
  CodexDevelopmentAssembleHostedActionTerminal,
  CodexDevelopmentCoordinateHostedActions,
  CodexDevelopmentComposeHostedEvidence,
  CodexDevelopmentExecuteCiActionClosure,
  type CodexDevelopmentHostedSutSandboxCommandPlan,
  type CodexDevelopmentHostedSutSandboxProcessObservation,
  type CodexDevelopmentHostedSutSandboxProcess,
  type CodexDevelopmentHostedActionProposal,
  type CodexDevelopmentHostedActionResolution,
  type CodexDevelopmentHostedActionExecutionTicket,
  type CodexDevelopmentHostedActionArtifactObservation,
  type CodexDevelopmentHostedActionStartObservation,
  type CodexDevelopmentHostedActionTerminalAnchorObservation,
  type CodexDevelopmentHostedActionCoordination,
  type CodexDevelopmentHostedActionProviderIndex,
  type CodexDevelopmentHostedActionArchiveInventory,
  type CodexDevelopmentHostedDependencyPhysicalSnapshot,
  type CodexDevelopmentHostedDependencyArchiveProjection,
  type CodexDevelopmentPreparedHostedActionInputs,
  type CodexDevelopmentDependencyMaterializationRecovery,
  type CodexDevelopmentPreparedTrustedBootstrapSutInputs,
  type CodexDevelopmentCiVerificationTestOptions,
  type CodexDevelopmentCiActionExecution
} from './verification-runtime.ts';

export {
  CodexDevelopmentCiVerificationMain,
  CodexDevelopmentCiVerificationMainForTests,
  CodexDevelopmentAssertHostedActionParentEvent,
  CodexDevelopmentCiVerificationHostedActionCli
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
