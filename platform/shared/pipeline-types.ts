import type { PassStatus } from './lock-types.ts';

export const PIPELINE_JOURNAL_FORMAT_VERSION = '1' as const;

export const PIPELINE_STAGE_IDS = [
  'resolve',
  'compose',
  'adapt',
  'verify',
  'lock',
  'emit'
] as const;

export type PassId = keyof PassStatus;
export type PipelineStageId = (typeof PIPELINE_STAGE_IDS)[number];
export type PipelineSource = 'api' | 'cli' | 'workbench' | 'reference' | 'upgrade' | 'repair' | 'ci';
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
}

export type PipelineEventType =
  | 'transaction-start'
  | 'pass-start'
  | 'pass-success'
  | 'pass-failure'
  | 'transaction-success'
  | 'transaction-failure';

export interface PipelineEvent {
  type: PipelineEventType;
  transactionId: string;
  passId?: PassId;
  message: string;
}

export type PipelineEventHandler = (event: PipelineEvent) => void | Promise<void>;

export interface PipelineExecutionContext {
  transactionId: string;
  source: PipelineSource;
  onEvent?: PipelineEventHandler;
}
