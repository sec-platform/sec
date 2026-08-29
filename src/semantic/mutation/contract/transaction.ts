import type { SemanticEntityId } from '../../engineering-ir/contract/entity-types.ts';
import type {
  SemanticMutationAuthorizationContext,
  SemanticMutationBase,
  SemanticMutationDiagnostic,
  SemanticMutationPlan,
  SemanticMutationRequest,
  SemanticMutationResult,
  SemanticMutationVerificationExecutionRef
} from './types.ts';

export const SEMANTIC_MUTATION_RECOVERY_RECORD_REVISION =
  'semantic-mutation-recovery-record-v1' as const;
export const SEMANTIC_MUTATION_TERMINAL_RETENTION = 256 as const;
export const SEMANTIC_MUTATION_REJECTED_TERMINAL_RECORD_REVISION =
  'semantic-mutation-rejected-terminal-record-v1' as const;
export const SEMANTIC_MUTATION_REQUEST_RECORD_VIEW_REVISION =
  'semantic-mutation-request-record-view-v1' as const;

export type SemanticMutationRecoveryState =
  | 'prepared'
  | 'authoring-committed'
  | 'verified'
  | 'rolled-back'
  | 'recovery-required';

export const SEMANTIC_MUTATION_RECOVERY_TRANSITIONS = Object.freeze({
  prepared: Object.freeze(['authoring-committed', 'recovery-required'] as const),
  'authoring-committed': Object.freeze(['verified', 'rolled-back', 'recovery-required'] as const),
  verified: Object.freeze([] as const),
  'rolled-back': Object.freeze([] as const),
  'recovery-required': Object.freeze([] as const)
}) satisfies Readonly<Record<SemanticMutationRecoveryState, readonly SemanticMutationRecoveryState[]>>;

export type SemanticMutationRecoveryFailureState =
  | 'rollback-failed'
  | 'restore-validation-failed'
  | 'rebuild-failed'
  | 'concurrent-write';

export interface SemanticMutationTransactionInput {
  readonly request: SemanticMutationRequest;
  readonly base: import('../../engineering-ir/contract/delta-types.ts').FactDeltaEndpointContext;
  readonly authorization: SemanticMutationAuthorizationContext;
}

export interface SemanticMutationApplyInput extends SemanticMutationTransactionInput {
  readonly expectedPlanRevision: string;
}

export type SemanticMutationApplyOutcome =
  | { readonly status: 'terminal'; readonly result: SemanticMutationResult }
  | {
      readonly status: 'request-rejected';
      readonly requestId: string;
      readonly requestRevision: string;
      readonly diagnostics: readonly SemanticMutationDiagnostic[];
      readonly diagnosticRevision: string;
    };

export interface SemanticMutationRequestIdentity {
  readonly graphId: string;
  readonly appId: SemanticEntityId;
  readonly requestId: string;
}

interface SemanticMutationRecoveryRecordBase {
  readonly formatRevision: typeof SEMANTIC_MUTATION_RECOVERY_RECORD_REVISION;
  readonly sequence: number;
  readonly previousRecordRevision: string;
  readonly transactionId: string;
  readonly requestIdentityDigest: string;
  readonly requestRevision: string;
  readonly authorizationRevision: string;
  readonly expectedPlanRevision: string;
  readonly planRevision: string;
  readonly editPlanRevision: string;
  readonly rollbackManifestDigest: string;
  readonly relativePath: string;
  readonly beforeByteDigest: string;
  readonly committedByteDigest: string;
  readonly base: SemanticMutationBase;
  readonly staged: SemanticMutationBase;
  readonly verificationExecutionRevision: string;
  readonly verificationReportRevision: string;
  readonly request: SemanticMutationRequest;
  readonly authorization: SemanticMutationAuthorizationContext;
  readonly plan: SemanticMutationPlan;
  readonly verification: SemanticMutationVerificationExecutionRef;
  readonly result?: SemanticMutationResult;
  readonly recoveryState?: SemanticMutationRecoveryFailureState;
  readonly diagnostics: readonly SemanticMutationDiagnostic[];
  readonly recordRevision: string;
}

export type SemanticMutationRecoveryRecord = SemanticMutationRecoveryRecordBase & (
  | {
      readonly state: 'verified' | 'rolled-back';
      /** Workspace-global durable completion order for retention. */
      readonly terminalSequence: number;
    }
  | {
      readonly state: 'prepared' | 'authoring-committed' | 'recovery-required';
      readonly terminalSequence?: never;
    }
);

export interface SemanticMutationRejectedTerminalRecord {
  readonly formatRevision: typeof SEMANTIC_MUTATION_REJECTED_TERMINAL_RECORD_REVISION;
  readonly requestIdentityDigest: string;
  readonly requestRevision: string;
  readonly planRevision: string;
  readonly terminalSequence: number;
  readonly result: Extract<SemanticMutationResult, { readonly status: 'rejected' }>;
  readonly recordRevision: string;
}

export type SemanticMutationRequestRecord =
  | SemanticMutationRecoveryRecord
  | SemanticMutationRejectedTerminalRecord;

interface SemanticMutationRequestTransactionRecordViewBase {
  readonly formatRevision: typeof SEMANTIC_MUTATION_REQUEST_RECORD_VIEW_REVISION;
  readonly recordKind: 'transaction';
  readonly identity: SemanticMutationRequestIdentity;
  readonly requestIdentityDigest: string;
  readonly transactionId: string;
  readonly requestRevision: string;
  readonly authorizationRevision: string;
  readonly expectedPlanRevision: string;
  readonly planRevision: string;
  readonly editPlanRevision: string;
  readonly rollbackManifestDigest: string;
  readonly base: SemanticMutationBase;
  readonly staged: SemanticMutationBase;
  readonly verificationExecutionRevision: string;
  readonly verificationReportRevision: string;
  readonly diagnostics: readonly SemanticMutationDiagnostic[];
  readonly recordRevision: string;
}

type SemanticMutationRequestTransactionRecordView =
  SemanticMutationRequestTransactionRecordViewBase & (
    | {
        readonly state: 'prepared' | 'authoring-committed';
        readonly terminalSequence?: never;
        readonly result?: never;
        readonly recoveryState?: never;
      }
    | {
        readonly state: 'verified';
        readonly terminalSequence: number;
        readonly result: Extract<SemanticMutationResult, { readonly status: 'accepted' }>;
        readonly recoveryState?: never;
      }
    | {
        readonly state: 'rolled-back';
        readonly terminalSequence: number;
        readonly result: Extract<SemanticMutationResult, { readonly status: 'rolled-back' }>;
        readonly recoveryState?: never;
      }
    | {
        readonly state: 'recovery-required';
        readonly terminalSequence?: never;
        readonly result: Extract<SemanticMutationResult, { readonly status: 'recovery-required' }>;
        readonly recoveryState: SemanticMutationRecoveryFailureState;
      }
  );

export type SemanticMutationRequestRecordView =
  | SemanticMutationRequestTransactionRecordView
  | {
      readonly formatRevision: typeof SEMANTIC_MUTATION_REQUEST_RECORD_VIEW_REVISION;
      readonly recordKind: 'rejected-terminal';
      readonly identity: SemanticMutationRequestIdentity;
      readonly requestIdentityDigest: string;
      readonly state: 'rejected';
      readonly requestRevision: string;
      readonly planRevision: string;
      readonly terminalSequence: number;
      readonly result: Extract<SemanticMutationResult, { readonly status: 'rejected' }>;
      readonly diagnostics: readonly SemanticMutationDiagnostic[];
      readonly recordRevision: string;
    };

export type SemanticMutationInternalRecoveryOutcome =
  | { readonly status: 'clean' }
  | { readonly status: 'terminal'; readonly result: SemanticMutationResult }
  | {
      readonly status: 'recovery-required';
      readonly record: SemanticMutationRecoveryRecord;
    };

export type SemanticMutationRecoveryOutcome =
  | { readonly status: 'clean' }
  | { readonly status: 'terminal'; readonly result: SemanticMutationResult }
  | {
      readonly status: 'recovery-required';
      readonly record: Extract<
        SemanticMutationRequestRecordView,
        { readonly recordKind: 'transaction' }
      >;
    };
