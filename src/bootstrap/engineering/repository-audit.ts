#!/usr/bin/env bun
import { parseRepositoryAuditCliOptions, repositoryAuditDeadline } from '../../adapters/repository/repository-audit/cli-contract.ts';
import { runRepositoryAuditCli } from '../../adapters/repository/repository-audit/cli.ts';
import { SourceProgramCompilationInterruptedError } from '../../adapters/repository/source-program-model/compilation-operation.ts';
import { enableExecutionProgress, reportExecutionProgress } from '../../execution/execution-progress.ts';
import { runRepositorySourceProgramTransition } from './source-program-transition.ts';

if (import.meta.main) {
  const argv = process.argv.slice(2);
  const input = parseRepositoryAuditCliOptions(argv);
  const command = input.mode === 'source-program' ? 'audit:source-program'
    : input.mode === 'module-topology' ? 'audit:module-topology' : 'audit:repository';
  enableExecutionProgress();
  reportExecutionProgress({ command, phase: 'command', state: 'start' });
  try {
    if (input.mode === 'source-program' && input.transitionCandidateRoot !== null) {
      await runRepositorySourceProgramTransition(argv);
    } else {
      await runRepositoryAuditCli(argv, input.mode === 'source-program'
        ? { deadlineAtUnixMs: repositoryAuditDeadline() } : {});
    }
    reportExecutionProgress({ command, phase: 'command',
      state: process.exitCode === undefined || process.exitCode === 0 ? 'complete' : 'failed' });
  } catch (error) {
    reportExecutionProgress({ command, phase: 'command', state: 'failed' });
    if (!(error instanceof SourceProgramCompilationInterruptedError)) throw error;
    process.stderr.write(`${JSON.stringify({ code: error.code, phase: error.phase, phaseEvents: error.phaseEvents })}\n`);
    process.exitCode = 1;
  }
}
