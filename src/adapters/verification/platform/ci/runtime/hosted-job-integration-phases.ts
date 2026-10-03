import {
  assertAuthenticatedGitHubJobOriginCurrent, type AuthenticatedGitHubJobOrigin
} from '../../../../providers/github-api/hosted-job-origin.ts';
import { verifyHostedIntegrationRecovery } from './hosted-job-integration-recovery.ts';

/** Only complete original-owner paths may be selected by the native launcher. */
export const HOSTED_INTEGRATION_PHASE_HANDLERS = Object.freeze({
  authorize: Object.freeze(['verify-integration-recovery'])
} as const);

export async function executeHostedIntegrationPhase(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin; jobId: string; phase: string;
  nativeChannels: Readonly<{ runnerTemp: string; needsJson: string; stepsJson: string }>;
}>): Promise<Readonly<{
  outputs: Readonly<Record<string, string>>; exitCode: 0 | 1; diagnostic: string | null;
  failure: Readonly<{ error: unknown }> | null;
}>> {
  const origin = input.origin;
  const observed = assertAuthenticatedGitHubJobOriginCurrent(origin);
  if (input.jobId !== 'authorize' || input.phase !== 'verify-integration-recovery'
      || observed.policyJobId !== input.jobId || observed.phase !== input.phase
      || observed.workflowPath !== '.github/workflows/merge-gate.yml' || observed.role !== 'control') {
    throw new Error('Integration phase selector differs from its authenticated executing job.');
  }
  const nativeChannels = Object.freeze({ runnerTemp: input.nativeChannels.runnerTemp,
    needsJson: input.nativeChannels.needsJson, stepsJson: input.nativeChannels.stepsJson });
  if (nativeChannels.runnerTemp !== process.env.RUNNER_TEMP) throw new Error('Integration native temporary channel differs from the executing job.');
  const outputs = await verifyHostedIntegrationRecovery({ origin, nativeChannels });
  assertAuthenticatedGitHubJobOriginCurrent(origin);
  return Object.freeze({ outputs, exitCode: 0, diagnostic: null, failure: null });
}
