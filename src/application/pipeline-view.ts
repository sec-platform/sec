import type { PassStatus } from '../compiler/contract/pass-status.ts';
import type { PipelineStageId } from '../compiler/pipeline/stages.ts';

export interface PipelineCompilationProjectionInput {
  readonly transactionId: string;
  readonly completedStages: readonly PipelineStageId[];
  readonly lock: Readonly<{ passStatus: Readonly<PassStatus> }>;
}

export interface PipelineJournalProjectionInput {
  readonly formatVersion: string;
  readonly activeTransactionId?: string;
  readonly lastCommittedTransactionId?: string;
  readonly transactions: readonly Readonly<{
    id: string;
    status: string;
    source: string;
    passRecords: readonly Readonly<{ passId: string; status: string }>[];
  }>[];
}

export interface PipelineCompilationView {
  readonly transactionId: string;
  readonly completedStages: readonly PipelineStageId[];
  readonly passStatus: Readonly<PassStatus>;
}

export interface PipelineJournalView {
  readonly formatVersion: string;
  readonly activeTransactionId?: string;
  readonly lastCommittedTransactionId?: string;
  readonly transactionCount: number;
  readonly latest?: Readonly<{
    id: string;
    status: string;
    source: string;
    passRecords: readonly Readonly<{ passId: string; status: string }>[];
  }>;
}

export function projectPipelineCompilation(input: PipelineCompilationProjectionInput): PipelineCompilationView {
  return Object.freeze({
    transactionId: input.transactionId,
    completedStages: Object.freeze([...input.completedStages]),
    passStatus: input.lock.passStatus
  });
}

export function projectPipelineJournal(input: PipelineJournalProjectionInput): PipelineJournalView {
  const latest = input.transactions.at(-1);
  return Object.freeze({
    formatVersion: input.formatVersion,
    ...(input.activeTransactionId === undefined ? {} : { activeTransactionId: input.activeTransactionId }),
    ...(input.lastCommittedTransactionId === undefined ? {} : { lastCommittedTransactionId: input.lastCommittedTransactionId }),
    transactionCount: input.transactions.length,
    ...(latest === undefined ? {} : {
      latest: Object.freeze({
        id: latest.id,
        status: latest.status,
        source: latest.source,
        passRecords: Object.freeze(latest.passRecords.map((entry) => Object.freeze({
          passId: entry.passId,
          status: entry.status
        })))
      })
    })
  });
}
