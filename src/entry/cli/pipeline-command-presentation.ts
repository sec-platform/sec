import type { PipelineCompilationView, PipelineJournalView } from '../../application/pipeline-view.ts';

export function formatPipelineCompilation(value: PipelineCompilationView): string {
  return [
    `Compilation transaction ${value.transactionId} succeeded`,
    `Stages: ${value.completedStages.join(' -> ')}`,
    `Lock: ${Object.entries(value.passStatus).map(([passId, state]) => `${passId}=${state}`).join(', ')}`
  ].join('\n');
}

export function formatPipelineJournal(journal: PipelineJournalView): string {
  return [
    `Pipeline journal ${journal.formatVersion}`,
    `Active transaction: ${journal.activeTransactionId ?? 'none'}`,
    `Last committed transaction: ${journal.lastCommittedTransactionId ?? 'none'}`,
    `Transactions: ${journal.transactionCount}`,
    ...(journal.latest ? [
      `Latest: ${journal.latest.id} ${journal.latest.status} source=${journal.latest.source}`,
      `Passes: ${journal.latest.passRecords.map((entry) => `${entry.passId}=${entry.status}`).join(', ') || 'none'}`
    ] : [])
  ].join('\n');
}
