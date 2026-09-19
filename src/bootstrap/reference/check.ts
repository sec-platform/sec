import { projectReferenceCheckReport, type ReferenceCheckReport } from '../../application/reference-check.ts';
import { runDevCommand } from '../../adapters/self-hosting/development/runner/command-runner.ts';
import { compilerRoot } from '../../adapters/workspace-context.ts';
import {
  REFERENCE_TRACKED_DIFF_ARGS,
  REFERENCE_UNTRACKED_SCAN_ARGS,
  scanReferenceDrift
} from './runtime/drift-scan.ts';

function gitCommandText(args: readonly string[]): string {
  return `git ${args.join(' ')}`;
}

/** Compose the physical refresh and Git drift observations into the pure
 * application-owned Reference Check report. */
export async function buildReferenceCheckReport(): Promise<ReferenceCheckReport> {
  const refreshExitCode = await runDevCommand(
    'bun',
    ['run', 'reference:refresh'],
    process.env
  );
  const drift = refreshExitCode === 0
    ? await scanReferenceDrift(compilerRoot)
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
    diffCommand: gitCommandText(REFERENCE_TRACKED_DIFF_ARGS),
    untrackedScanCommand: gitCommandText(REFERENCE_UNTRACKED_SCAN_ARGS),
    refreshExitCode,
    drift
  });
}
