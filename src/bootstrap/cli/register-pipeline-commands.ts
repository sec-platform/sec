import type { Command } from 'commander';
import { VERIFICATION_LANE_OPTION } from './verification-lane-option.ts';

import { addJsonFlags } from './command-options.ts';
import { printJsonOrText } from '../../entry/cli/format-utils.ts';
import { parsePipelineCompileOptions, parsePipelineOutputOptions, PIPELINE_COMPILE_DEFAULT_LANE, rejectPipelineOutputIssue } from './pipeline-command-input.ts';
import { formatPipelineCompilation, formatPipelineJournal } from './pipeline-command-presentation.ts';

export function registerPipelineCommands(program: Command): void {
  addJsonFlags(program.command('compile')
    .description('Run the canonical workspace compilation pipeline')
    .option('--from <stage>', 'Start at a pipeline stage')
    .option('--through <stage>', 'Stop after a pipeline stage')
    .option(VERIFICATION_LANE_OPTION.flags, VERIFICATION_LANE_OPTION.description, PIPELINE_COMPILE_DEFAULT_LANE), rejectPipelineOutputIssue)
    .action(async (opts: Record<string, unknown>) => {
      const workspaceRoot = process.cwd();
      const { output, invocation } = parsePipelineCompileOptions(opts);
      const { compileWorkspace } = await import('../engineering/pipeline-orchestrator.ts');
      const result = await compileWorkspace(workspaceRoot, invocation);
      printJsonOrText(result, output, formatPipelineCompilation);
    });

  const pipeline = program.command('pipeline')
    .description('Inspect pipeline execution state');

  addJsonFlags(pipeline.command('inspect')
    .description('Inspect the local pipeline transaction journal'), rejectPipelineOutputIssue)
    .action(async (opts: Record<string, unknown>) => {
      const workspaceRoot = process.cwd();
      const output = parsePipelineOutputOptions(opts);
      // Help and invalid options must not initialize journal or lease owners.
      const { readPipelineJournal } = await import('../../adapters/compilation/pipeline/journal.ts');
      const journal = await readPipelineJournal(workspaceRoot);
      printJsonOrText(journal, output, formatPipelineJournal);
    });
}
