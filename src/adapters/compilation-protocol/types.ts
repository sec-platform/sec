import type { WorkspaceWriteLeaseToken } from '../filesystem/write-lease.ts';
import type { PassId } from '../../compiler/contract/pass-status.ts';
import type { PipelineSource } from '../../compiler/pipeline/source.ts';
import type { PipelineSemanticContext } from '../../compiler/pipeline/semantic-context.ts';

export { PIPELINE_ADAPT_RETIREMENT_SCHEMA, PIPELINE_JOURNAL_FORMAT_VERSION } from './journal-types.ts';
export type { PipelineAdaptRetirementRecord, PipelineJournal, PipelinePassRecord, PipelinePassStatus, PipelineTransactionRecord, PipelineTransactionStatus } from './journal-types.ts';
import type { PipelineExecutionBoundary } from '../../compiler/pipeline/execution-boundaries.ts';

export type PipelineEventType =
  | 'execution-boundary'
  | 'transaction-start'
  | 'pass-start'
  | 'pass-success'
  | 'pass-blocked'
  | 'pass-failure'
  | 'transaction-success'
  | 'transaction-failure';

export interface PipelineEvent {
  type: PipelineEventType;
  transactionId: string;
  passId?: PassId;
  boundary?: PipelineExecutionBoundary;
  message: string;
}

export type PipelineEventHandler = (event: PipelineEvent) => void | Promise<void>;

export interface PipelineExecutionContext {
  readonly transactionId: string;
  readonly source: PipelineSource;
  readonly onEvent?: PipelineEventHandler;
  readonly workspaceWriteLease: WorkspaceWriteLeaseToken;
  semantic?: PipelineSemanticContext;
}
