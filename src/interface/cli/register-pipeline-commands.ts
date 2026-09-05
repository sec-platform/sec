import type { Command } from 'commander';

import { printJsonOrText } from './format-utils.ts';
import { parsePipelineCompileOptions, parsePipelineOutputOptions } from './pipeline-command-input.ts';
import { formatPipelineCompilation, formatPipelineJournal } from './pipeline-command-presentation.ts';

export function registerPipelineCommands(program: Command): void {
  program.command('compile')
    .description('Run the canonical workspace compilation pipeline')
    .option('--from <stage>', 'Start at a pipeline stage')
    .option('--through <stage>', 'Stop after a pipeline stage')
    .option('--lane <lane>', 'Verification lane', 'all')
    .option('--json', 'Output as JSON')
    .option('--compact', 'Compact JSON output')
    .action(async (opts: Record<string, unknown>) => {
      const workspaceRoot = process.cwd();
      const { output, invocation } = parsePipelineCompileOptions(opts);
      const { compileWorkspace } = await import('../../compiler/orchestration/pipeline-orchestrator.ts');
      const result = await compileWorkspace(workspaceRoot, invocation);
      printJsonOrText(result, output, formatPipelineCompilation);
    });

  const pipeline = program.command('pipeline')
    .description('Inspect pipeline execution state');

  pipeline.command('inspect')
    .description('Inspect the local pipeline transaction journal')
    .option('--json', 'Output as JSON')
    .option('--compact', 'Compact JSON output')
    .action(async (opts: Record<string, unknown>) => {
      const workspaceRoot = process.cwd();
      const output = parsePipelineOutputOptions(opts);
      // Help and invalid options must not initialize journal or lease owners.
      const { readPipelineJournal } = await import('../../compiler/pipeline/journal.ts');
      const journal = await readPipelineJournal(workspaceRoot);
      printJsonOrText(journal, output, formatPipelineJournal);
    });
}
