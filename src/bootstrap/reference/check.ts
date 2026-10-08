import { runDevCommand } from '../../adapters/self-hosting/development/runner/command-runner.ts';
import { compilerRoot } from '../../adapters/workspace-context.ts';
import {
  buildReferenceDriftCommands,
  scanReferenceDrift
} from '../../adapters/workspace/reference-drift.ts';
import { executeReferenceCheck, type ReferenceCheckReport } from '../../application/reference-check.ts';
import { referenceWorkspaceRelativePath } from './workspace.ts';

function gitCommandText(args: readonly string[]): string {
  return `git ${args.join(' ')}`;
}

const REFERENCE_DRIFT_COMMANDS = buildReferenceDriftCommands([
  referenceWorkspaceRelativePath
]);

/** Assemble the physical refresh and Git observation for the application use case. */
export async function buildReferenceCheckReport(): Promise<ReferenceCheckReport> {
  return executeReferenceCheck({
    root: compilerRoot,
    runnerCommand: 'bun run reference:check',
    refreshCommand: 'bun run reference:refresh',
    diffCommand: gitCommandText(REFERENCE_DRIFT_COMMANDS.tracked),
    untrackedScanCommand: gitCommandText(REFERENCE_DRIFT_COMMANDS.untracked)
  }, {
    refresh: () => runDevCommand('bun', ['run', 'reference:refresh'], process.env),
    scanDrift: () => scanReferenceDrift(compilerRoot, REFERENCE_DRIFT_COMMANDS)
  });
}
