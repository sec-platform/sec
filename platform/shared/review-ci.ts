export interface ReviewFailurePoint {
  lane: 'fast' | 'runtime' | 'all';
  kind: 'summary' | 'policy' | 'build' | 'unit' | 'acceptance' | 'upgrade' | 'repair';
  message: string;
  artifactPath: string;
}

export interface ReviewRegressionRisk {
  kind: 'coverage-gap' | 'override-active' | 'upgrade-impact' | 'upgrade-verification' | 'repair-verification';
  message: string;
  blockId?: string;
  slotId?: string;
}

export interface ReviewConflictHint {
  kind:
    | 'override-conflict'
    | 'upgrade-plan-present'
    | 'upgrade-preflight-passed'
    | 'repair-plan-present'
    | 'repair-blocked';
  message: string;
  relatedId: string;
}

export type ReviewChainStageId = 'verification' | 'coverage' | 'artifacts' | 'review';
export type ReviewChainStageStatus = 'passed' | 'attention' | 'failed';

export interface ReviewChainStageSummary {
  id: ReviewChainStageId;
  status: ReviewChainStageStatus;
  detail: string;
}

export interface ReviewChainSummary {
  status: ReviewChainStageStatus;
  stageCount: number;
  passedStageCount: number;
  attentionStageCount: number;
  failedStageCount: number;
  stageSummaries: ReviewChainStageSummary[];
}

export interface ReviewCiSummary {
  status: 'passed' | 'attention' | 'failed';
  failureCount: number;
  regressionRiskCount: number;
  conflictHintCount: number;
  impactedBlockCount: number;
  impactedSlotCount: number;
  runtimeEntryCount: number;
}
