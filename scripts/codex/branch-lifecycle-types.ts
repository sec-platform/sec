export const BRANCH_LIFECYCLE_INVENTORY_SCHEMA_V1 =
  'sec-branch-lifecycle-inventory-v1' as const;
export const BRANCH_CLOSEOUT_PREPARATION_SCHEMA_V1 =
  'sec-branch-closeout-preparation-v1' as const;
export const BRANCH_CLOSEOUT_RECEIPT_SCHEMA_V1 =
  'sec-branch-closeout-receipt-v1' as const;
export const BRANCH_REF_CLOSEOUT_CAPABILITY_V1 =
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

export interface BranchPullRequestObservation {
  number: number;
  headBranch: string;
  headSha: string | null;
  baseBranch: string;
  state: 'open' | 'closed' | 'merged';
  isDraft: boolean;
  isCrossRepository: boolean;
  url: string | null;
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
  schema: typeof BRANCH_LIFECYCLE_INVENTORY_SCHEMA_V1;
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

export interface BranchRecoveryAuthority {
  kind: 'bundle';
  path: string;
  sha256: `sha256:${string}`;
  verified: boolean;
  verifyOutput: string;
}

export interface BranchCloseoutPreparation {
  schema: typeof BRANCH_CLOSEOUT_PREPARATION_SCHEMA_V1;
  preparedAt: string;
  repository: {
    root: string;
    commonDir: string;
    fullName: string;
    remote: string;
    defaultBranch: string;
  };
  branch: string;
  expectedHeadSha: string;
  expectedRemoteSha: string;
  expectedLocalSha: string | null;
  pullRequestNumber: number | null;
  pullRequestStateAtPreparation: 'open' | 'closed' | 'merged' | null;
  recovery: BranchRecoveryAuthority;
  worktreePathsAtPreparation: string[];
  preparationDigest: `sha256:${string}`;
}

export interface BranchCloseoutRequest {
  capability: typeof BRANCH_REF_CLOSEOUT_CAPABILITY_V1;
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
  schema: typeof BRANCH_CLOSEOUT_RECEIPT_SCHEMA_V1;
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
