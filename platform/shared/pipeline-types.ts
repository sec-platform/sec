import type { ValidatedEngineeringIRSnapshot } from './engineering-ir-types.ts';
import type { PassStatus } from './lock-types.ts';
import type { SemanticGeneratorPlan } from './semantic-generator-types.ts';
import type { SemanticViewSet } from './semantic-view-types.ts';
import type { WorkspaceWriteLeaseToken } from './workspace-write-lease.ts';

export const PIPELINE_JOURNAL_FORMAT_VERSION = '1' as const;

export const PIPELINE_STAGE_IDS = [
  'resolve',
  'semantic',
  'compose',
  'adapt',
  'verify',
  'lock',
  'emit'
] as const;

export type PassId = keyof PassStatus;
export type PipelineStageId = (typeof PIPELINE_STAGE_IDS)[number];
export const PIPELINE_VERIFY_STAGE_IDS = Object.freeze(
  PIPELINE_STAGE_IDS.slice(0, PIPELINE_STAGE_IDS.indexOf('verify') + 1)
) as readonly PipelineStageId[];
export const PIPELINE_EXECUTION_BOUNDARIES = [
  'pipeline-bootstrap',
  'pipeline-lease-bind',
  'pipeline-lease-bound',
  'pipeline-transaction-bootstrap',
  'pipeline-transaction',
  'pipeline-resolve',
  'pipeline-semantic',
  'pipeline-compose',
  'pipeline-adapt',
  'pipeline-verify',
  'pipeline-lock',
  'pipeline-emit',
  'verify-preflight',
  'verify-fast',
  'verify-runtime',
  'verify-artifact-publish'
] as const;
export type PipelineExecutionBoundary = (typeof PIPELINE_EXECUTION_BOUNDARIES)[number];
export type PipelineSource = 'api' | 'cli' | 'workbench' | 'reference' | 'upgrade' | 'repair' | 'ci';
export type PipelineTransactionStatus = 'running' | 'succeeded' | 'failed';
export type PipelinePassStatus = 'running' | 'succeeded' | 'failed' | 'blocked' | 'skipped';

export const PIPELINE_COMPLETION_PROOF_REVISION = 'pipeline-completion-proof-v1' as const;

export interface PipelineCompletionProofV1 {
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
  readonly localViewDigests: readonly {
    readonly relativePath: string;
    readonly digest: string;
  }[];
  readonly proofRevision: string;
}

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
