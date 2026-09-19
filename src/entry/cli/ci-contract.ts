import type { CiContractInspectionSource } from '../../application/ci-contract-inspect.ts';

export function formatCiContract(contract: CiContractInspectionSource): string {
  return [
    `CI contract ${contract.status}`,
    `Command: ${contract.command}`,
    `Default gate: ${contract.defaultGate}`,
    `Full runtime gate: ${contract.fullRuntimeGate}`,
    `Verification contract revision: ${contract.verificationContractRevision}`,
    `Execution model: ${contract.executionModel}`,
    `PR workflow event: ${contract.prWorkflowEvent}`,
    `PR dispatch type: ${contract.prDispatchType}`,
    `PR workflow step count: ${contract.prWorkflowStepCount}`,
    `PR workflow step order: ${contract.prWorkflowStepOrder.join(' -> ')}`,
    `Release workflow step count: ${contract.releaseWorkflowStepCount}`,
    `Release workflow step order: ${contract.releaseWorkflowStepOrder.join(' -> ')}`,
    `PR workflow command count: ${contract.prWorkflowCommandCount}`,
    `PR workflow commands: ${contract.prWorkflowCommands.join(', ')}`,
    `Release workflow command count: ${contract.releaseWorkflowCommandCount}`,
    `Release workflow commands: ${contract.releaseWorkflowCommands.join(', ')}`,
    `PR quick lane command count: ${contract.prQuickLaneCommandCount}`,
    `PR quick lane commands: ${contract.prQuickLaneCommands.join(', ')}`,
    `Full lane command count: ${contract.fullLaneCommandCount}`,
    `Full lane commands: ${contract.fullLaneCommands.join(', ')}`,
    `Verify command count: ${contract.verifyCommandCount}`,
    `Verify commands: ${contract.verifyCommands.join(', ')}`,
    `Quality command count: ${contract.qualityCommandCount}`,
    `Quality commands: ${contract.qualityCommands.join(', ')}`,
    `Diagnostic command count: ${contract.diagnosticCommandCount}`,
    `Diagnostic commands: ${contract.diagnosticCommands.join(', ')}`,
    `Artifact upload command count: ${contract.artifactUploadCommandCount}`,
    `Artifact uploads: ${contract.artifactUploadCommands.join(', ')}`,
    `Artifact paths: ${contract.artifactPathCount}`,
    `Artifact path list: ${contract.artifactPaths.join(', ')}`,
    `Steps: ${contract.stepCount}`,
    ...contract.steps.map(step => [
      `Step ${step.id}`,
      `phase=${step.phase}`,
      `command=${step.command}`,
      `producesCount=${step.producesCount}`,
      `produces=${step.produces.join(', ')}`
    ].join('; '))
  ].join('\n');
}
