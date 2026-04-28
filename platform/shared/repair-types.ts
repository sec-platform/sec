import type { SlotProvenanceHints, SlotTask } from './lock-types.ts';

export type RepairTaskCategory = 'slot-rewrite' | 'config-repair' | 'generated-artifact-refresh';

export interface RepairFailurePoint {
  lane: 'fast' | 'runtime' | 'all';
  kind: 'build' | 'unit' | 'acceptance' | 'policy' | 'runtime-build' | 'runtime-unit' | 'runtime-acceptance' | 'summary';
  issueType: 'slot' | 'spec' | 'kernel' | 'unknown';
  repairable: boolean;
  artifactPath: string;
  message: string;
  targetIds?: string[];
}

export interface RepairTaskPreview {
  beforeLines: number;
  afterLines: number;
  addedLines: number;
  removedLines: number;
  changed: boolean;
}

export interface RepairBlocker {
  blockerId: string;
  reason: string;
  boundary: 'slot' | 'spec' | 'kernel' | 'scope' | 'unknown';
  decisionRequired: string;
  failurePoints: RepairFailurePoint[];
}

export interface RepairTaskReview {
  allowedPathCount: number;
  requiredSymbolCount: number;
  forbiddenOperationCount: number;
  testCount: number;
  failureTargetCount: number;
  sourceSlotStatus?: SlotTask['status'];
  sourceWritableZones?: string[];
  sourceProvenanceHints?: SlotProvenanceHints;
  writeBounds: string[];
  requiredSymbols: string[];
  forbiddenOperations: string[];
  testsToPass: string[];
  failureTargets: string[];
}

export interface RepairTask {
  taskId: string;
  taskKind: 'repair-slot';
  category?: RepairTaskCategory;
  phase: 'repair';
  sourceSlotId: string;
  targetBlock: string;
  targetFile: string;
  allowedPaths: string[];
  requiredSymbols: string[];
  forbiddenOperations: string[];
  testsToPass: string[];
  failureSummary: string;
  failurePoints: RepairFailurePoint[];
  review?: RepairTaskReview;
  preview?: RepairTaskPreview;
}

export interface RepairPlan {
  formatVersion: string;
  status: 'pending' | 'applied' | 'skipped' | 'blocked';
  sourceVerificationStatus: 'passed' | 'failed';
  requiresVerification: boolean;
  tasks: RepairTask[];
  blockers?: RepairBlocker[];
}
