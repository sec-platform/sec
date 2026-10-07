import {
  CodexDevelopmentCiVerificationHostedActionCli,
  CodexDevelopmentCiVerificationMain,
  HOSTED_ACTION_COMMANDS
} from '../../adapters/verification/platform/ci/verification-cli.ts';
import { enableExecutionProgress, reportExecutionProgress } from '../../execution/execution-progress.ts';

/** Hosted ci-verification executable. Command spelling selects a workflow; it never authenticates a job. */
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