import type { ValidatedEngineeringIRSnapshot } from '../../semantic/engineering-ir/contract/validated-types.ts';
import type { SemanticGeneratorPlan } from '../../semantic/generation/contract/types.ts';
import type { SemanticViewSet } from '../../semantic/projection/contract/types.ts';
import type { WorkspaceWriteLeaseToken } from '../../workspace/lease.ts';
import type { PassStatus } from '../contract.ts';

export const PIPELINE_JOURNAL_FORMAT_VERSION = '2' as const;
export const PIPELINE_ADAPT_RETIREMENT_SCHEMA = 'sec-pipeline-adapt-retirement-v1' as const;

export const PIPELINE_STAGE_IDS = [
  'resolve',
  'semantic',
  'compose',
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
  'pipeline-verify',
  'pipeline-lock',
  'pipeline-emit',
  'verify-preflight',
  'verify-fast',
  'verify-runtime',
  'verify-artifact-publish'
] as const;
export type PipelineExecutionBoundary = (typeof PIPELINE_EXECUTION_BOUNDARIES)[number];
export type PipelineSource = 'api' | 'cli' | 'reference' | 'upgrade' | 'repair' | 'ci';
export type PipelineTransactionStatus = 'running' | 'succeeded' | 'failed';
export type PipelinePassStatus = 'running' | 'succeeded' | 'failed' | 'blocked' | 'skipped';

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
