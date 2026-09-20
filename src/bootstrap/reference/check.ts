import { projectReferenceCheckReport, type ReferenceCheckReport } from '../../application/reference-check.ts';
import { runDevCommand } from '../../adapters/self-hosting/development/runner/command-runner.ts';
import { compilerRoot } from '../../adapters/workspace-context.ts';
import {
  buildReferenceDriftCommands,
  scanReferenceDrift
} from '../../adapters/workspace/reference-drift.ts';
import { referenceWorkspaceRelativePath } from './workspace.ts';

function gitCommandText(args: readonly string[]): string {
  return `git ${args.join(' ')}`;
}

const REFERENCE_DRIFT_COMMANDS = buildReferenceDriftCommands([
  referenceWorkspaceRelativePath
]);

/** Compose the physical refresh and Git drift observations into the pure
 * application-owned Reference Check report. */
export async function buildReferenceCheckReport(): Promise<ReferenceCheckReport> {
  const refreshExitCode = await runDevCommand(
    'bun',
    ['run', 'reference:refresh'],
    process.env
  );
  const drift = refreshExitCode === 0
    ? await scanReferenceDrift(compilerRoot, REFERENCE_DRIFT_COMMANDS)
    : {
        exitCode: -1,
        trackedExitCode: -1,
        untrackedExitCode: -1,
        changedPaths: []
      };
  return projectReferenceCheckReport({
    root: compilerRoot,
    runnerCommand: 'bun run reference:check',
    refreshCommand: 'bun run reference:refresh',
    diffCommand: gitCommandText(REFERENCE_DRIFT_COMMANDS.tracked),
    untrackedScanCommand: gitCommandText(REFERENCE_DRIFT_COMMANDS.untracked),
    refreshExitCode,
    drift
  });
}
