import type { Command } from 'commander';

import { compileWorkspace } from '../orchestrator.ts';
import { CompilerError } from '../shared/errors.ts';
import { readPipelineJournal } from '../shared/pipeline-journal.ts';
import {
  PIPELINE_STAGE_IDS,
  type PipelineStageId
} from '../shared/pipeline-types.ts';
import type { VerificationLane } from '../shared/verification-types.ts';
import { formatJson, printJsonOrText } from './format-utils.ts';

function pipelineStage(value: string | undefined, option: string): PipelineStageId | undefined {
  if (value === undefined) return undefined;
  if (!PIPELINE_STAGE_IDS.includes(value as PipelineStageId)) {
    throw new CompilerError(
      'PIPELINE-USAGE-001',
      `${option} must be one of: ${PIPELINE_STAGE_IDS.join(', ')}`
    );
  }
  return value as PipelineStageId;
}

function verificationLane(value: string): VerificationLane {
  if (value !== 'fast' && value !== 'runtime' && value !== 'all') {
    throw new CompilerError('PIPELINE-USAGE-002', '--lane must be fast, runtime, or all');
  }
  return value;
}

function outputOptions(opts: Record<string, unknown>): { json: boolean; compact: boolean } {
  const output = { json: !!opts.json, compact: !!opts.compact };
  if (output.compact && !output.json) {
    throw new CompilerError('PIPELINE-USAGE-003', '--compact requires --json');
  }
  return output;
}

export function registerPipelineCommands(program: Command): void {
  program.command('compile')
    .description('Run the canonical workspace compilation pipeline')
    .option('--from <stage>', 'Start at a pipeline stage')
    .option('--through <stage>', 'Stop after a pipeline stage')
    .option('--lane <lane>', 'Verification lane', 'all')
    .option('--json', 'Output as JSON')
    .option('--compact', 'Compact JSON output')
    .action(async (opts: Record<string, unknown>) => {
      const output = outputOptions(opts);
      const from = pipelineStage(opts.from as string | undefined, '--from');
      const through = pipelineStage(opts.through as string | undefined, '--through');
      const result = await compileWorkspace(process.cwd(), {
        source: 'cli',
        ...(from ? { from } : {}),
        ...(through ? { through } : {}),
        verificationLane: verificationLane(String(opts.lane))
      });

      printJsonOrText(result, output, (value) => [
        `Compilation transaction ${value.transactionId} succeeded`,
        `Stages: ${value.completedStages.join(' -> ')}`,
        `Lock: ${Object.entries(value.lock.passStatus).map(([passId, state]) => `${passId}=${state}`).join(', ')}`
      ].join('\n'));
    });

  const pipeline = program.command('pipeline')
    .description('Inspect pipeline execution state');

  pipeline.command('inspect')
    .description('Inspect the local pipeline transaction journal')
    .option('--json', 'Output as JSON')
    .option('--compact', 'Compact JSON output')
    .action(async (opts: Record<string, unknown>) => {
      const output = outputOptions(opts);
      const journal = await readPipelineJournal(process.cwd());
      if (output.json) {
        console.log(formatJson(journal, output));
        return;
      }
      const latest = journal.transactions.at(-1);
      console.log([
        `Pipeline journal ${journal.formatVersion}`,
        `Active transaction: ${journal.activeTransactionId ?? 'none'}`,
        `Last committed transaction: ${journal.lastCommittedTransactionId ?? 'none'}`,
        `Transactions: ${journal.transactions.length}`,
        ...(latest ? [
          `Latest: ${latest.id} ${latest.status} source=${latest.source}`,
          `Passes: ${latest.passRecords.map((entry) => `${entry.passId}=${entry.status}`).join(', ') || 'none'}`
        ] : [])
      ].join('\n'));
    });
}
