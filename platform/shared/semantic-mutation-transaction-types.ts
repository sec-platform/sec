import type { SemanticEntityId } from './engineering-ir-types.ts';
import type {
  SemanticMutationAuthorizationContextV2,
  SemanticMutationBaseV2,
  SemanticMutationDiagnosticV2,
  SemanticMutationPlanV2,
  SemanticMutationRequestV2,
  SemanticMutationResultV2,
  SemanticMutationVerificationExecutionRefV2
} from './semantic-mutation-types.ts';

export const SEMANTIC_MUTATION_RECOVERY_RECORD_REVISION =
  'semantic-mutation-recovery-record-v1' as const;
export const SEMANTIC_MUTATION_STAGED_TRANSACTION_REVISION =
  'semantic-mutation-staged-transaction-v1' as const;
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

export interface SemanticMutationTransactionInputV1 {
  readonly request: SemanticMutationRequestV2;
  readonly base: import('./engineering-ir-types.ts').FactDeltaEndpointContext;
  readonly authorization: SemanticMutationAuthorizationContextV2;
}

export interface SemanticMutationApplyInputV1 extends SemanticMutationTransactionInputV1 {
  readonly expectedPlanRevision: string;
}

export type SemanticMutationApplyOutcomeV1 =
  | { readonly status: 'terminal'; readonly result: SemanticMutationResultV2 }
  | {
      readonly status: 'request-rejected';
      readonly requestId: string;
      readonly requestRevision: string;
      readonly diagnostics: readonly SemanticMutationDiagnosticV2[];
      readonly diagnosticRevision: string;
    };

export interface SemanticMutationRequestIdentityV1 {
  readonly graphId: string;
  readonly appId: SemanticEntityId;
  readonly requestId: string;
}

interface SemanticMutationRecoveryRecordBaseV1 {
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
  readonly base: SemanticMutationBaseV2;
  readonly staged: SemanticMutationBaseV2;
  readonly verificationExecutionRevision: string;
  readonly verificationReportRevision: string;
  readonly request: SemanticMutationRequestV2;
  readonly authorization: SemanticMutationAuthorizationContextV2;
  readonly plan: SemanticMutationPlanV2;
  readonly verification: SemanticMutationVerificationExecutionRefV2;
  readonly result?: SemanticMutationResultV2;
  readonly recoveryState?: SemanticMutationRecoveryFailureState;
  readonly diagnostics: readonly SemanticMutationDiagnosticV2[];
  readonly recordRevision: string;
}

export type SemanticMutationRecoveryRecordV1 = SemanticMutationRecoveryRecordBaseV1 & (
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

export interface SemanticMutationRejectedTerminalRecordV1 {
  readonly formatRevision: typeof SEMANTIC_MUTATION_REJECTED_TERMINAL_RECORD_REVISION;
  readonly requestIdentityDigest: string;
  readonly requestRevision: string;
  readonly planRevision: string;
  readonly terminalSequence: number;
  readonly result: Extract<SemanticMutationResultV2, { readonly status: 'rejected' }>;
  readonly recordRevision: string;
}

export type SemanticMutationRequestRecordV1 =
  | SemanticMutationRecoveryRecordV1
  | SemanticMutationRejectedTerminalRecordV1;

interface SemanticMutationRequestTransactionRecordViewBaseV1 {
  readonly formatRevision: typeof SEMANTIC_MUTATION_REQUEST_RECORD_VIEW_REVISION;
  readonly recordKind: 'transaction';
  readonly identity: SemanticMutationRequestIdentityV1;
  readonly requestIdentityDigest: string;
  readonly transactionId: string;
  readonly requestRevision: string;
  readonly authorizationRevision: string;
  readonly expectedPlanRevision: string;
  readonly planRevision: string;
  readonly editPlanRevision: string;
  readonly rollbackManifestDigest: string;
  readonly base: SemanticMutationBaseV2;
  readonly staged: SemanticMutationBaseV2;
  readonly verificationExecutionRevision: string;
  readonly verificationReportRevision: string;
  readonly diagnostics: readonly SemanticMutationDiagnosticV2[];
  readonly recordRevision: string;
}

type SemanticMutationRequestTransactionRecordViewV1 =
  SemanticMutationRequestTransactionRecordViewBaseV1 & (
    | {
        readonly state: 'prepared' | 'authoring-committed';
        readonly terminalSequence?: never;
        readonly result?: never;
        readonly recoveryState?: never;
      }
    | {
        readonly state: 'verified';
        readonly terminalSequence: number;
        readonly result: Extract<SemanticMutationResultV2, { readonly status: 'accepted' }>;
        readonly recoveryState?: never;
      }
    | {
        readonly state: 'rolled-back';
        readonly terminalSequence: number;
        readonly result: Extract<SemanticMutationResultV2, { readonly status: 'rolled-back' }>;
        readonly recoveryState?: never;
      }
    | {
        readonly state: 'recovery-required';
        readonly terminalSequence?: never;
        readonly result: Extract<SemanticMutationResultV2, { readonly status: 'recovery-required' }>;
        readonly recoveryState: SemanticMutationRecoveryFailureState;
      }
  );

export type SemanticMutationRequestRecordViewV1 =
  | SemanticMutationRequestTransactionRecordViewV1
  | {
      readonly formatRevision: typeof SEMANTIC_MUTATION_REQUEST_RECORD_VIEW_REVISION;
      readonly recordKind: 'rejected-terminal';
      readonly identity: SemanticMutationRequestIdentityV1;
      readonly requestIdentityDigest: string;
      readonly state: 'rejected';
      readonly requestRevision: string;
      readonly planRevision: string;
      readonly terminalSequence: number;
      readonly result: Extract<SemanticMutationResultV2, { readonly status: 'rejected' }>;
      readonly diagnostics: readonly SemanticMutationDiagnosticV2[];
      readonly recordRevision: string;
    };

export type SemanticMutationInternalRecoveryOutcomeV1 =
  | { readonly status: 'clean' }
  | { readonly status: 'terminal'; readonly result: SemanticMutationResultV2 }
  | {
      readonly status: 'recovery-required';
      readonly record: SemanticMutationRecoveryRecordV1;
    };

export type SemanticMutationRecoveryOutcomeV1 =
  | { readonly status: 'clean' }
  | { readonly status: 'terminal'; readonly result: SemanticMutationResultV2 }
  | {
      readonly status: 'recovery-required';
      readonly record: Extract<
        SemanticMutationRequestRecordViewV1,
        { readonly recordKind: 'transaction' }
      >;
    };
