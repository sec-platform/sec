import type { ReferenceCheckReport } from '../application/reference-check.ts';

export function formatReferenceCheck(
  report: ReferenceCheckReport,
  command: string
): string {
  return [
    `Reference workspace ${report.status}`,
    `Failed stage: ${report.failedStage}`,
    `Command: ${command}`,
    `Runner command: ${report.runnerCommand}`,
    `Commands: refresh=${report.refreshCommand}; diff=${report.diffCommand}; untracked=${report.untrackedScanCommand}`,
    `Refresh: exit=${report.refreshExitCode}; diff: exit=${report.diffExitCode}; tracked=${report.trackedDiffExitCode}; untracked=${report.untrackedScanExitCode}`,
    `Changed paths: ${report.changedPathCount > 0 ? report.changedPaths.join(', ') : 'none'}`,
    `Recommended action: ${report.recommendedAction}`
  ].join('\n');
}
