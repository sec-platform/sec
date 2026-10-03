import type { BranchCloseoutDisposition, BranchCloseoutPreparation, BranchCloseoutReceipt, BranchCloseoutRequest, BranchLifecycleClassification, BranchLifecycleInventory, BranchPublishedCloseoutReceipt } from '../../../../execution/verification/branch-closeout.ts';
export const BRANCH_LIFECYCLE_INVENTORY_SCHEMA: BranchLifecycleInventory["schema"] =
  'sec-branch-lifecycle-inventory-v1' as const;
export const BRANCH_CLOSEOUT_PREPARATION_SCHEMA: BranchCloseoutPreparation["schema"] =
  'sec-branch-closeout-preparation-v1' as const;
export const BRANCH_CLOSEOUT_RECEIPT_SCHEMA: BranchCloseoutReceipt["schema"] =
  'sec-branch-closeout-receipt-v1' as const;
export const BRANCH_CLOSEOUT_PUBLISHED_RECEIPT_SCHEMA: BranchPublishedCloseoutReceipt["schema"] =
  'sec-branch-closeout-published-receipt-v1' as const;
export const BRANCH_REF_CLOSEOUT_CAPABILITY: BranchCloseoutRequest["capability"] =
  'branch-ref-closeout-v1' as const;

export type BranchAuditSeverity = 'error' | 'warning';

export interface BranchLifecycleDispositionRecord {
  branch: string;
  disposition: BranchCloseoutDisposition | 'protected-pending';
  reference: string;
}

export interface ClassifiedBranchLifecycle {
  branch: string;
  localSha: string | null;
  remoteSha: string | null;
  classification: BranchLifecycleClassification;
  worktreePaths: string[];
  pullRequestNumbers: number[];
  reasons: string[];
}

export interface BranchLifecycleAuditFinding {
  code: string;
  severity: BranchAuditSeverity;
  branch: string | null;
  message: string;
}

export interface BranchLifecycleAuditReport {
  status: 'clean' | 'protected' | 'drift' | 'blocked';
  classifications: ClassifiedBranchLifecycle[];
  findings: BranchLifecycleAuditFinding[];
}
