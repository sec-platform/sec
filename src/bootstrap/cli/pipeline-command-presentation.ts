import type { PassStatus } from '../../compiler/contract/pass-status.ts';
import type { PipelineJournal } from '../../adapters/compilation-protocol/journal-types.ts';
import type { PipelineStageId } from '../../adapters/compilation-protocol/stages.ts';

/** Presentation reads results; it neither loads an executor nor decides success. */
export function formatPipelineCompilation(
  value: Readonly<{
    transactionId: string;
    completedStages: readonly PipelineStageId[];
    lock: Readonly<{ passStatus: Readonly<PassStatus> }>;
  }>
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
