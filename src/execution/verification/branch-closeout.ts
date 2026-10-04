/** Canonical pure branch closeout contracts. Native schemas,
 * parsers, retained issuers and physical effects remain with their owners. */


export interface PreparedBranchCloseoutEnvelope {
  schema: "sec-branch-closeout-prepared-envelope-v2";
  preparation: BranchCloseoutPreparation;
  before: BranchLifecycleInventory;
  attempts: BranchCloseoutAttempt[];
  foreignWorktreeObservations: readonly ForeignWorktreeCloseoutObservation[];
  envelopeDigest: `sha256:${string}`;
}

/** A non-reversible observation of a worktree seen by a different host. */
export interface ForeignWorktreeCloseoutObservation {
  readonly schema: 'sec-branch-closeout-foreign-worktree-observation-v1';
  readonly hostBindingDigest: `sha256:${string}`;
  readonly observationDigest: `sha256:${string}`;
}

export interface BranchCloseoutPreparation {
  schema: "sec-branch-closeout-preparation-v1";
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

export type BranchRecoveryAuthority =
  | BranchBundleRecoveryAuthority
  | BranchMainAbsorptionRecoveryAuthority;

export interface BranchBundleRecoveryAuthority {
  kind: 'bundle';
  path: string;
  sha256: `sha256:${string}`;
  verified: boolean;
  verifyOutput: string;
}

export interface BranchMainAbsorptionRecoveryAuthority {
  kind: 'main-absorption';
  path: string;
  sha256: `sha256:${string}`;
  verified: true;
  verifyOutput: string;
  sourceSha: string;
  sourceTreeSha: string;
  mainSha: string;
  mainTreeSha: string;
  basis: 'native-ancestor' | 'identical-tree';
}

export interface BranchLifecycleInventory {
  schema: "sec-branch-lifecycle-inventory-v1";
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
  baseSha?: string | null;
  closeoutReceiptCommentCandidates?: BranchCloseoutReceiptCommentCandidate[];
  publishedCloseoutReceipts?: BranchPublishedCloseoutReceipt[];
  invalidCloseoutReceiptComments?: string[];
  closeoutReceipt?: BranchCloseoutReceiptObservation;
}

export interface BranchCloseoutReceiptCommentCandidate {
  body: string;
  author: string;
  authorAssociation: string | null;
}

export interface BranchPublishedCloseoutReceipt {
  schema: "sec-branch-closeout-published-receipt-v1";
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

export type BranchCloseoutDisposition =
  | 'merged'
  | 'closed-superseded'
  | 'completed-spike';

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

export type BranchCloseoutStatus =
  | 'completed'
  | 'protected-pending'
  | 'residue'
  | 'blocked';

export interface BranchCloseoutReceiptObservation {
  requirement: 'required' | 'not-required' | 'unknown';
  status: 'present' | 'missing' | 'invalid' | 'conflicted' | 'not-required' | 'unknown';
  receipt: BranchPublishedCloseoutReceipt | null;
  reason: string | null;
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

export interface BranchCloseoutReceipt {
  schema: "sec-branch-closeout-receipt-v1";
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

export interface BranchCloseoutRequest {
  capability: "branch-ref-closeout-v1";
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

export type BranchLifecycleClassification =
  | 'main'
  | 'active-candidate'
  | 'open-pr-candidate'
  | 'merged-closeout'
  | 'closed-superseded'
  | 'completed-spike'
  | 'protected-pending'
  | 'orphan-unknown';

export interface DirectHostedWorkflowCommentProvenance {
  schema: "sec-hosted-workflow-comment-provenance-v1";
  repositoryId: string;
  workflowPath: '.github/workflows/merge-gate.yml';
  workflowRef: string;
  workflowSha: string;
  runId: string;
  runAttempt: number;
  eventName: 'workflow_run';
  sourceRunId: string;
  sourceRunAttempt: number;
  actorLogin: string;
  actorNodeId: string;
  actorPermission: 'maintain' | 'admin';
  app: {
    id: number;
    nodeId: string;
    slug: string;
  };
  provenanceDigest: `sha256:${string}`;
}

/** Historical locator data. Native readers independently capture and authenticate
 * the original delegated Session; this carrier never grants effect authority. */
export interface DelegatedHostedWorkflowCommentProvenance extends Omit<
  DirectHostedWorkflowCommentProvenance, 'schema' | 'actorPermission'
> {
  schema: 'hosted-delegated-session-comment-provenance';
  actorPermission: 'none';
  sourceArtifact: Readonly<{
    artifactId: string;
    artifactName: string;
    artifactDigest: `sha256:${string}`;
    archiveDigest: `sha256:${string}`;
  }>;
}

export type HostedWorkflowCommentProvenance = DirectHostedWorkflowCommentProvenance
  | DelegatedHostedWorkflowCommentProvenance;

export interface BranchCloseoutOperationPublication {
  schema: "sec-branch-closeout-operation-publication-v1";
  closeoutOperationId: `sha256:${string}`;
  binding: BranchCloseoutOperationBinding;
  effectStart: BranchCloseoutEffectStartReference;
  receipt: BranchCloseoutStablePublishedReceipt;
  provenance: HostedWorkflowCommentProvenance;
  publicationDigest: `sha256:${string}`;
}

export interface BranchCloseoutEffectStartReference {
  effectStartId: `sha256:${string}`;
  publicationDigest: `sha256:${string}`;
  commentId: number;
}

export interface BranchCloseoutStablePublishedReceipt {
  repository: string;
  pullRequest: number | null;
  branch: string;
  preparedHeadSha: string;
  preparationDigest: `sha256:${string}`;
  recoveryDigest: `sha256:${string}`;
  disposition: BranchCloseoutDisposition;
  durableGoal: { kind: 'main' | 'issue' | 'evidence'; reference: string };
  authorization: BranchPublishedCloseoutReceipt['authorization'];
  readback: BranchPublishedCloseoutReceipt['readback'];
  closeoutStatus: BranchCloseoutStatus;
  mainSha: string | null;
}

export interface BranchCloseoutEffectStartPublication {
  schema: "sec-branch-closeout-effect-start-publication-v1";
  effectStartId: `sha256:${string}`;
  closeoutOperationId: `sha256:${string}`;
  binding: BranchCloseoutOperationBinding;
  authorizationPublication: {
    authorizationPublicationId: `sha256:${string}`;
    publicationDigest: `sha256:${string}`;
    commentId: number;
  };
  recoveryArtifact: {
    artifactId: string;
    artifactName: string;
    artifactDigest: `sha256:${string}`;
    runId: string;
    runAttempt: number;
  };
  phase: {
    runId: string;
    runAttempt: number;
    jobId: string;
    jobName: 'integrate';
    phase: 'closeoutMutation';
    stepName: "Close out exact integrated branch";
    stepNumber: number;
    workflowSha: string;
  };
  provenance: HostedWorkflowCommentProvenance;
  publicationDigest: `sha256:${string}`;
}

export interface BranchCloseoutOperationBinding {
  schema: "sec-branch-closeout-operation-v1";
  closeoutOperationId: `sha256:${string}`;
  authorizationId: string;
  consumptionOperationId: string;
  integrationAuthorizationReceiptDigest: `sha256:${string}`;
  repository: string;
  pullRequestNumber: number;
  headSha: string;
  newMainSha: string;
  newMainTreeSha: string;
  candidateTreeSha: string;
  preparationDigest: `sha256:${string}`;
  recoveryDigest: `sha256:${string}`;
}

export interface BranchCloseoutOperationReceipt {
  schema: "sec-branch-closeout-operation-receipt-v1";
  binding: BranchCloseoutOperationBinding;
  writerId: string;
  generatedAt: string;
  remote: BranchCloseoutEffect;
  local: BranchCloseoutEffect;
  prune: BranchCloseoutEffect;
  receipt: BranchCloseoutReceipt;
  operationReceiptDigest: `sha256:${string}`;
}

export interface BranchCloseoutEffect {
  state: BranchCloseoutEffectState;
  detailDigest: `sha256:${string}` | null;
}

export type BranchCloseoutEffectState =
  | 'not-started'
  | 'applied'
  | 'observed-absent'
  | 'failed';

export interface BranchCloseoutRecoveryArtifact {
  schema: "sec-branch-closeout-recovery-artifact-v1";
  repository: string;
  pullRequestNumber: number;
  sessionRevision: `sha256:${string}`;
  headSha: string;
  headTreeSha: string;
  preparedEnvelopeBase64: string;
  preparedEnvelopeByteLength: number;
  preparedEnvelopeDigest: `sha256:${string}`;
  recoveryBundleBase64: string;
  recoveryBundleByteLength: number;
  recoveryBundleDigest: `sha256:${string}`;
  artifactDigest: `sha256:${string}`;
}
