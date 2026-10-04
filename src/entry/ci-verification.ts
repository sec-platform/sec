import { ciVerificationCommands } from '../bootstrap/development/ci-verification.ts';
import { enableExecutionProgress, reportExecutionProgress } from '../execution/execution-progress.ts';

async function main(): Promise<number> {
  if (ciVerificationCommands.hostedActionCommands.has(process.argv[2] ?? '')) {
    const result = await ciVerificationCommands.executeHostedAction(process.argv.slice(2));
    process.stdout.write(`${result}\n`);
    return 0;
  }
  return ciVerificationCommands.executeVerification();
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
