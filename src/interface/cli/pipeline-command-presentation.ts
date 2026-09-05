import type { CompileWorkspaceResult } from '../../compiler/orchestration/pipeline-orchestrator.ts';
import type { PipelineJournal } from '../../compiler/pipeline/types.ts';

/** Presentation reads results; it neither loads an executor nor decides success. */
export function formatPipelineCompilation(
  value: Pick<CompileWorkspaceResult, 'transactionId' | 'completedStages' | 'lock'>
): string {
  return [
    `Compilation transaction ${value.transactionId} succeeded`,
    `Stages: ${value.completedStages.join(' -> ')}`,
    `Lock: ${Object.entries(value.lock.passStatus).map(([passId, state]) => `${passId}=${state}`).join(', ')}`
  ].join('\n');
}

export function formatPipelineJournal(journal: PipelineJournal): string {
  const latest = journal.transactions.at(-1);
  return [
    `Pipeline journal ${journal.formatVersion}`,
    `Active transaction: ${journal.activeTransactionId ?? 'none'}`,
    `Last committed transaction: ${journal.lastCommittedTransactionId ?? 'none'}`,
    `Transactions: ${journal.transactions.length}`,
    ...(latest ? [
      `Latest: ${latest.id} ${latest.status} source=${latest.source}`,
      `Passes: ${latest.passRecords.map((entry) => `${entry.passId}=${entry.status}`).join(', ') || 'none'}`
    ] : [])
  ].join('\n');
}
