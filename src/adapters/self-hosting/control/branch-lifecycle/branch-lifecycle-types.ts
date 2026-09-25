export const BRANCH_LIFECYCLE_INVENTORY_SCHEMA =
  'sec-branch-lifecycle-inventory-v1' as const;
export const BRANCH_CLOSEOUT_PREPARATION_SCHEMA =
  'sec-branch-closeout-preparation-v1' as const;
export const BRANCH_CLOSEOUT_RECEIPT_SCHEMA =
  'sec-branch-closeout-receipt-v1' as const;
export const BRANCH_CLOSEOUT_PUBLISHED_RECEIPT_SCHEMA =
  'sec-branch-closeout-published-receipt-v1' as const;
export const BRANCH_REF_CLOSEOUT_CAPABILITY =
  'branch-ref-closeout-v1' as const;

export type BranchLifecycleClassification =
  | 'main'
  | 'active-candidate'
  | 'open-pr-candidate'
  | 'merged-closeout'
  | 'closed-superseded'
  | 'completed-spike'
  | 'protected-pending'
  | 'orphan-unknown';

export type BranchCloseoutDisposition =
  | 'merged'
  | 'closed-superseded'
  | 'completed-spike';

export type BranchCloseoutStatus =
  | 'completed'
  | 'protected-pending'
  | 'residue'
  | 'blocked';

export type BranchAuditSeverity = 'error' | 'warning';

export interface BranchRefObservation {
  branch: string;
  sha: string;
}

export interface BranchWorktreeObservation {
  path: string;
  headSha: string | null;
  branch: string | null;
  dirtyCount: number | null;
  untrackedCount: number | null;
  locked: boolean;
  prunable: boolean;
  observation: 'resolved' | 'unknown';
  reason: string | null;
}

export interface BranchPublishedCloseoutReceipt {
  schema: typeof BRANCH_CLOSEOUT_PUBLISHED_RECEIPT_SCHEMA;
  repository: string;
  pullRequest: number | null;
  branch: string;
  preparedHeadSha: string;
  preparationDigest: `sha256:${string}`;
  recoveryDigest: `sha256:${string}`;
  disposition: BranchCloseoutDisposition;
  durableGoal: {
    kind: 'main' | 'issue' | 'evidence';
    reference: string;
  };
  authorization: {
    remoteAction: 'delete-cas' | 'already-absent' | 'blocked';
    localAction: 'delete-exact' | 'already-absent' | 'protect-local' | 'blocked';
  };
  attempts: ReadonlyArray<{
    operation: BranchCloseoutAttempt['operation'];
    status: BranchCloseoutAttempt['status'];
    detailDigest: `sha256:${string}`;
  }>;
  readback: {
    mainRemoteSha: string | null;
    remoteBranchSha: string | null;
    localBranchSha: string | null;
    boundWorktreeCount: number;
    unknownCount: number;
  };
  closeoutStatus: BranchCloseoutStatus;
  mainSha: string | null;
  receiptDigest: `sha256:${string}`;
  publicationDigest: `sha256:${string}`;
}

export interface BranchCloseoutReceiptCommentCandidate {
  body: string;
  author: string;
  authorAssociation: string | null;
}

export interface BranchCloseoutReceiptObservation {
  requirement: 'required' | 'not-required' | 'unknown';
  status: 'present' | 'missing' | 'invalid' | 'conflicted' | 'not-required' | 'unknown';
  receipt: BranchPublishedCloseoutReceipt | null;
  reason: string | null;
}

export interface BranchPullRequestObservation {
  number: number;
  headBranch: string;
  headSha: string | null;
  baseBranch: string;
  state: 'open' | 'closed' | 'merged';
  isDraft: boolean;
  isCrossRepository: boolean;
  url: string | null;
  baseSha?: string | null;
  closeoutReceiptCommentCandidates?: BranchCloseoutReceiptCommentCandidate[];
  publishedCloseoutReceipts?: BranchPublishedCloseoutReceipt[];
  invalidCloseoutReceiptComments?: string[];
  closeoutReceipt?: BranchCloseoutReceiptObservation;
}

export interface BranchActiveWorkPackageObservation {
  state: 'active' | 'none' | 'invalid' | 'unresolved';
  branch: string | null;
  manifest: string | null;
  reason: string | null;
}

export interface BranchRepositorySettingObservation {
  observation: 'resolved' | 'unknown';
  deleteBranchOnMerge: boolean | null;
  reason: string | null;
}

export interface BranchPruneConfigurationObservation {
  observation: 'resolved' | 'unknown';
  fetchPrune: boolean | null;
  remotePrune: boolean | null;
  fetchPruneTags: boolean | null;
  reason: string | null;
}

export interface BranchLifecycleInventory {
  schema: typeof BRANCH_LIFECYCLE_INVENTORY_SCHEMA;
  observedAt: string;
  repository: {
    root: string;
    commonDir: string;
    fullName: string;
    remote: string;
    remoteUrl: string;
    defaultBranch: string;
  };
  main: {
    localSha: string | null;
    remoteSha: string | null;
  };
  localBranches: BranchRefObservation[];
  remoteBranches: BranchRefObservation[];
  worktrees: BranchWorktreeObservation[];
  pullRequests: BranchPullRequestObservation[];
  activeWorkPackage: BranchActiveWorkPackageObservation;
  repositorySetting: BranchRepositorySettingObservation;
  pruneConfiguration: BranchPruneConfigurationObservation;
  unknowns: string[];
}

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

interface BranchBundleRecoveryAuthority {
  kind: 'bundle';
  path: string;
  sha256: `sha256:${string}`;
  verified: boolean;
  verifyOutput: string;
}

interface BranchMainAbsorptionRecoveryAuthority {
  kind: 'main-absorption';
  path: string;
  sha256: `sha256:${string}`;
  verified: true;
  verifyOutput: string;
  sourceSha: string;
  sourceTreeSha: string;
  mainSha: string;
  mainTreeSha: string;
  basis: 'native-ancestor' | 'identical-tree' | 'reviewed-supersession';
  reviewReference?: string;
  reviewReceiptDigest?: `sha256:${string}`;
}

export type BranchRecoveryAuthority =
  | BranchBundleRecoveryAuthority
  | BranchMainAbsorptionRecoveryAuthority;

export interface BranchCloseoutPreparation {
  schema: typeof BRANCH_CLOSEOUT_PREPARATION_SCHEMA;
  preparedAt: string;
  repository: {
    root: string;
    commonDir: string;
    fullName: string;
    remote: string;
    defaultBranch: string;
  };
  branch: string;
  /**
   * Observed ref state at preparation time. `present` binds an existing
   * remote ref; `absent` settles a ref that is already gone (post-merge
   * delete-branch-on-merge, or an earlier unrecorded deletion) whose content
   * is durably covered by a verified recovery bundle or main absorption.
   */
  refState: 'present' | 'absent';
  expectedHeadSha: string;
  expectedRemoteSha: string;
  expectedLocalSha: string | null;
  /**
   * The exact PR-recorded head SHA when the prepared ref head differs from the
   * PR head (drift), or the same SHA otherwise. Null only without a PR binding.
   */
  expectedPrHeadSha: string | null;
  pullRequestNumber: number | null;
  pullRequestStateAtPreparation: 'open' | 'closed' | 'merged' | null;
  recovery: BranchRecoveryAuthority;
  worktreePathsAtPreparation: string[];
  preparationDigest: `sha256:${string}`;
}

export interface BranchCloseoutRequest {
  capability: typeof BRANCH_REF_CLOSEOUT_CAPABILITY;
  disposition: BranchCloseoutDisposition;
  durableGoal: {
    kind: 'main' | 'issue' | 'evidence';
    reference: string;
  };
}

export interface BranchCloseoutAuthorization {
  branch: string;
  classification: BranchLifecycleClassification;
  remoteAction: 'delete-cas' | 'already-absent' | 'blocked';
  localAction: 'delete-exact' | 'already-absent' | 'protect-local' | 'blocked';
  blockers: string[];
  protections: string[];
}

export interface BranchCloseoutAttempt {
  operation:
    | 'recovery-create'
    | 'recovery-verify'
    | 'remote-delete'
    | 'local-delete'
    | 'prune'
    | 'readback';
  status: 'success' | 'skipped' | 'failed';
  detail: string;
}

export interface BranchCloseoutReceipt {
  schema: typeof BRANCH_CLOSEOUT_RECEIPT_SCHEMA;
  generatedAt: string;
  preparation: BranchCloseoutPreparation;
  request: BranchCloseoutRequest;
  authorization: BranchCloseoutAuthorization;
  attempts: BranchCloseoutAttempt[];
  before: BranchLifecycleInventory;
  after: BranchLifecycleInventory;
  status: BranchCloseoutStatus;
  residue: string[];
  receiptDigest: `sha256:${string}`;
}
