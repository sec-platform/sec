import type { WorkspaceWriteLeaseToken } from '../filesystem/write-lease.ts';
import type { PassId } from '../../compiler/contract/pass-status.ts';
import type { PipelineSource } from '../../compiler/pipeline/source.ts';
import type { PipelineSemanticContext } from '../../compiler/pipeline/semantic-context.ts';

export { PIPELINE_STAGE_IDS, PIPELINE_VERIFY_STAGE_IDS } from '../../compiler/pipeline/stages.ts';
export type { PipelineStageId } from '../../compiler/pipeline/stages.ts';

export type { PassId } from '../../compiler/contract/pass-status.ts';
export { PIPELINE_EXECUTION_BOUNDARIES } from '../../compiler/pipeline/execution-boundaries.ts';
export type { PipelineExecutionBoundary } from '../../compiler/pipeline/execution-boundaries.ts';
export { PIPELINE_ADAPT_RETIREMENT_SCHEMA, PIPELINE_JOURNAL_FORMAT_VERSION } from './journal-types.ts';
export type { PipelineAdaptRetirementRecord, PipelineJournal, PipelinePassRecord, PipelinePassStatus, PipelineTransactionRecord, PipelineTransactionStatus } from './journal-types.ts';
export type { PipelineSource } from '../../compiler/pipeline/source.ts';

import type { PipelineExecutionBoundary } from '../../compiler/pipeline/execution-boundaries.ts';

export { PIPELINE_COMPLETION_PROOF_REVISION } from '../../assurance/verification/pipeline/completion-proof.ts';
export type { PipelineCompletionProof } from '../../assurance/verification/pipeline/completion-proof.ts';

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

export type { PipelineSemanticContext } from '../../compiler/pipeline/semantic-context.ts';

export interface PipelineExecutionContext {
  readonly transactionId: string;
  readonly source: PipelineSource;
  readonly onEvent?: PipelineEventHandler;
  readonly workspaceWriteLease: WorkspaceWriteLeaseToken;
  semantic?: PipelineSemanticContext;
}
