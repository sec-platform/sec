export const WORKSPACE_TRANSITION_FAILURE_CODES = [
  'workspace-transition-argument-invalid',
  'workspace-transition-current-head-mismatch',
  'workspace-transition-object-id-invalid',
  'workspace-transition-operation-budget-exhausted',
  'workspace-transition-observation-unresolved',
  'workspace-transition-provider-integration-unavailable',
  'workspace-transition-rewrite-extra-unsupported',
  'workspace-transition-rewrite-input-invalid',
  'workspace-transition-rewrite-input-limit-exceeded'
] as const;

export const WORKSPACE_TRANSITION_DEADLINE_ENV =
  'SEC_WORKSPACE_TRANSITION_DEADLINE_AT_UNIX_MS' as const;

export type WorkspaceTransitionFailureCode =
  (typeof WORKSPACE_TRANSITION_FAILURE_CODES)[number];

export class WorkspaceTransitionContractError extends Error {
  readonly code: WorkspaceTransitionFailureCode;

  constructor(code: WorkspaceTransitionFailureCode, message: string) {
    super(message);
    this.name = 'WorkspaceTransitionContractError';
    this.code = code;
  }
}

export type GitObjectIdLength = 40 | 64;
export type GitObjectId = string;

export type WorkspaceTransitionTrigger = Readonly<
  | {
    readonly event: 'post-checkout';
    readonly previousHead: GitObjectId | null;
    readonly newHead: GitObjectId;
    readonly checkoutKind: 'branch' | 'paths';
  }
  | {
    readonly event: 'post-merge';
    readonly currentHead: GitObjectId;
    readonly squash: boolean;
  }
  | {
    readonly event: 'post-rewrite';
    readonly currentHead: GitObjectId;
    readonly command: 'amend' | 'rebase';
    readonly records: readonly Readonly<{
      readonly oldHead: GitObjectId;
      readonly newHead: GitObjectId;
    }>[];
  }
>;

export type ParseWorkspaceTransitionTriggerInput = Readonly<{
  readonly event: WorkspaceTransitionTrigger['event'];
  readonly arguments: readonly string[];
  readonly currentHead: string;
  readonly objectIdLength: GitObjectIdLength;
  readonly standardInput?: Uint8Array;
}>;

export const WORKSPACE_TRANSITION_OBSERVATION_DISPOSITIONS = [
  'deferred',
  'ready',
  'materialization-required',
  'unresolved'
] as const;

export type WorkspaceTransitionObservationDisposition =
  (typeof WORKSPACE_TRANSITION_OBSERVATION_DISPOSITIONS)[number];

export type WorkspaceTransitionCapabilityObservation = Readonly<{
  readonly disposition: WorkspaceTransitionObservationDisposition;
  readonly observationDigest: `sha256:${string}`;
}>;

export type WorkspaceTransitionRequiredEffect =
  | 'compiler-dependency-tree.materialize'
  | 'managed-git-hooks.materialize';

export type WorkspaceTransitionPlan = Readonly<{
  readonly trigger: WorkspaceTransitionTrigger;
  readonly worktreeIdentityDigest: `sha256:${string}`;
  readonly dependency: WorkspaceTransitionCapabilityObservation;
  readonly hooks: WorkspaceTransitionCapabilityObservation;
  readonly decision: 'no-effect' | 'effects-required' | 'blocked';
  readonly requiredEffects: readonly WorkspaceTransitionRequiredEffect[];
  readonly freshProcessBoundary: 'none' | 'after-compiler-dependency-tree';
  readonly blockers: readonly ('compiler-dependency-tree' | 'managed-git-hooks')[];
  readonly planDigest: `sha256:${string}`;
}>;
