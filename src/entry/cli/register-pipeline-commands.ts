import type { Command } from 'commander';
import { PIPELINE_VERIFICATION_LANE_OPTION } from '../../application/pipeline-request.ts';
import {
  projectPipelineCompilation,
  projectPipelineJournal,
  type PipelineCompilationProjectionInput,
  type PipelineJournalProjectionInput
} from '../../application/pipeline-view.ts';
import { addJsonFlags } from './command-options.ts';
import { printJsonOrText } from './format-utils.ts';
import {
  parsePipelineCompileOptions,
  parsePipelineOutputOptions,
  PIPELINE_COMPILE_DEFAULT_LANE,
  rejectPipelineOutputIssue
} from './pipeline-command-input.ts';
import { formatPipelineCompilation, formatPipelineJournal } from './pipeline-command-presentation.ts';

type PipelineInvocation = ReturnType<typeof parsePipelineCompileOptions>['invocation'];

export interface PipelineCommandOperations {
  readonly compile: (workspaceRoot: string, invocation: PipelineInvocation) => Promise<PipelineCompilationProjectionInput>;
  readonly inspect: (workspaceRoot: string) => Promise<PipelineJournalProjectionInput>;
}

/** Entry owns command grammar and presentation. Bootstrap supplies effectful operations. */
export function registerPipelineCommands(program: Command, operations: PipelineCommandOperations): void {
  const compile = operations.compile;
  const inspect = operations.inspect;
  if (typeof compile !== 'function' || typeof inspect !== 'function') {
    throw new TypeError('Pipeline command operations must be callable');
  }

  addJsonFlags(program.command('compile')
    .description('Run the canonical workspace compilation pipeline')
    .option('--from <stage>', 'Start at a pipeline stage')
    .option('--through <stage>', 'Stop after a pipeline stage')
    .option(PIPELINE_VERIFICATION_LANE_OPTION.flags, PIPELINE_VERIFICATION_LANE_OPTION.description, PIPELINE_COMPILE_DEFAULT_LANE), rejectPipelineOutputIssue)
    .action(async (opts: Record<string, unknown>) => {
      const workspaceRoot = process.cwd();
      const { output, invocation } = parsePipelineCompileOptions(opts);
      const result = await compile(workspaceRoot, invocation);
      printJsonOrText(result, output, (value) => formatPipelineCompilation(projectPipelineCompilation(value)));
    });

  const pipeline = program.command('pipeline').description('Inspect pipeline execution state');
  addJsonFlags(pipeline.command('inspect')
    .description('Inspect the local pipeline transaction journal'), rejectPipelineOutputIssue)
    .action(async (opts: Record<string, unknown>) => {
      const workspaceRoot = process.cwd();
      const output = parsePipelineOutputOptions(opts);
      const journal = await inspect(workspaceRoot);
      printJsonOrText(journal, output, (value) => formatPipelineJournal(projectPipelineJournal(value)));
    });
}
