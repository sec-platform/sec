import type { PassId } from '../../compiler/contract/pass-status.ts';
import type { PipelineStageId } from '../../compiler/pipeline/stages.ts';
import type { PipelineSource } from '../../compiler/pipeline/source.ts';

export const PIPELINE_JOURNAL_FORMAT_VERSION = '2' as const;
export const PIPELINE_ADAPT_RETIREMENT_SCHEMA = 'sec-pipeline-adapt-retirement-v1' as const;

export type PipelineTransactionStatus = 'running' | 'succeeded' | 'failed';
export type PipelinePassStatus = 'running' | 'succeeded' | 'failed' | 'blocked' | 'skipped';

export interface PipelinePassRecord {
  passId: PassId;
  status: PipelinePassStatus;
  startedAt: string;
  completedAt?: string;
  errorCode?: string;
  message?: string;
}

export interface PipelineTransactionRecord {
  id: string;
  source: PipelineSource;
  requestedStages: PipelineStageId[];
  status: PipelineTransactionStatus;
  startedAt: string;
  completedAt?: string;
  passRecords: PipelinePassRecord[];
  errorCode?: string;
  message?: string;
}

export interface PipelineJournal {
  formatVersion: typeof PIPELINE_JOURNAL_FORMAT_VERSION;
  activeTransactionId?: string;
  lastCommittedTransactionId?: string;
  transactions: PipelineTransactionRecord[];
  retirements?: PipelineAdaptRetirementRecord[];
}

export interface PipelineAdaptRetirementRecord {
  readonly schema: typeof PIPELINE_ADAPT_RETIREMENT_SCHEMA;
  readonly retiredStage: 'adapt';
  readonly legacyJournalBytesDigest: `sha256:${string}`;
  readonly evidenceFile: string;
}
