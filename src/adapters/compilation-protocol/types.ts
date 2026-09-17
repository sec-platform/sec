import type { ValidatedEngineeringIRSnapshot } from '../../semantics/engineering-ir/validated-types.ts';
import type { SemanticGeneratorPlan } from '../../semantics/generation/types.ts';
import type { SemanticViewSet } from '../../semantics/projection/types.ts';
import type { WorkspaceWriteLeaseToken } from '../filesystem/write-lease.ts';
import type { PassId } from '../../compiler/contract/pass-status.ts';
import type { PipelineSource } from './journal-types.ts';
import type { PipelineStageId } from './stages.ts';

export { PIPELINE_STAGE_IDS, PIPELINE_VERIFY_STAGE_IDS } from './stages.ts';
export type { PipelineStageId } from './stages.ts';

export type { PassId } from '../../compiler/contract/pass-status.ts';
export { PIPELINE_EXECUTION_BOUNDARIES } from './execution-boundaries.ts';
export type { PipelineExecutionBoundary } from './execution-boundaries.ts';
export { PIPELINE_ADAPT_RETIREMENT_SCHEMA, PIPELINE_JOURNAL_FORMAT_VERSION } from './journal-types.ts';
export type { PipelineAdaptRetirementRecord, PipelineJournal, PipelinePassRecord, PipelinePassStatus, PipelineSource, PipelineTransactionRecord, PipelineTransactionStatus } from './journal-types.ts';

import type { PipelineExecutionBoundary } from './execution-boundaries.ts';

export const PIPELINE_COMPLETION_PROOF_REVISION = 'pipeline-completion-proof-v2' as const;

export interface PipelineCompletionProof {
  readonly formatRevision: typeof PIPELINE_COMPLETION_PROOF_REVISION;
  readonly transactionId: string;
  readonly inputRevision: string;
  readonly semanticRevision: string;
  readonly completedStages: readonly PipelineStageId[];
  readonly completedPasses: readonly PassId[];
  readonly verificationDigest: string;
  readonly provenanceDigest: string;
  readonly explainGraphDigest: string;
  readonly reviewSummaryDigest: string;
  readonly proofRevision: string;
}

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

export interface PipelineSemanticContext {
  readonly transactionId: string;
  readonly inputRevision: string;
  readonly semanticRevision: string;
  readonly snapshot: ValidatedEngineeringIRSnapshot;
  readonly generatorPlan: SemanticGeneratorPlan;
  readonly semanticViews: SemanticViewSet;
}

export interface PipelineExecutionContext {
  readonly transactionId: string;
  readonly source: PipelineSource;
  readonly onEvent?: PipelineEventHandler;
  readonly workspaceWriteLease: WorkspaceWriteLeaseToken;
  semantic?: PipelineSemanticContext;
}
