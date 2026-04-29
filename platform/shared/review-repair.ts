import type { RepairTaskCategory } from './repair-types.ts';

export interface ReviewRepairTaskSummary {
  taskId: string;
  category: RepairTaskCategory;
  sourceSlotId: string;
  targetBlock: string;
  targetFile: string;
  previewStatus: 'changed' | 'unchanged' | 'missing';
  addedLines: number;
  removedLines: number;
  failurePointCount: number;
  targetIds: string[];
  allowedPathCount: number;
  requiredSymbolCount: number;
  forbiddenOperationCount: number;
  testCount: number;
  failureTargetCount: number;
  writeBounds: string[];
  requiredSymbols: string[];
  forbiddenOperations: string[];
  testsToPass: string[];
  failureTargets: string[];
}

export interface ReviewRepairBlockerSummary {
  blockerId: string;
  boundary: string;
  reason: string;
  decisionRequired: string;
  failurePointCount: number;
}

export interface ReviewRepairFailureTaxonomyEntry {
  id: string;
  count: number;
}

export interface ReviewRepairFailureTaxonomySummary {
  laneSummaries: ReviewRepairFailureTaxonomyEntry[];
  kindSummaries: ReviewRepairFailureTaxonomyEntry[];
  issueTypeSummaries: ReviewRepairFailureTaxonomyEntry[];
  repairabilitySummaries: ReviewRepairFailureTaxonomyEntry[];
}

export type ReviewRepairTargetType =
  | 'generated-file'
  | 'slot-target'
  | 'acceptance-case'
  | 'policy-target'
  | 'runtime-target'
  | 'unknown';

export interface ReviewRepairTargetSummary {
  id: string;
  targetType: ReviewRepairTargetType;
  count: number;
}

export interface ReviewRepairVerificationTrace {
  pendingReason: 'repair-not-applied' | 'verify-required' | 'blocked' | 'none';
  nextAction: 'apply-repair' | 'rerun-verify' | 'resolve-blocker' | 'none';
}

export interface ReviewRepairSummary {
  status: 'pending' | 'applied' | 'skipped' | 'blocked';
  sourceVerificationStatus: 'passed' | 'failed';
  requiresVerification: boolean;
  taskCount: number;
  blockerCount: number;
  previewCount: number;
  changedPreviewCount: number;
  failurePointCount: number;
  verificationTrace: ReviewRepairVerificationTrace;
  failureTaxonomy: ReviewRepairFailureTaxonomySummary;
  targetSummaries: ReviewRepairTargetSummary[];
  taskCategorySummaries: ReviewRepairFailureTaxonomyEntry[];
  targetFileCount: number;
  targetFiles: string[];
  taskSummaries: ReviewRepairTaskSummary[];
  blockerSummaries: ReviewRepairBlockerSummary[];
}
