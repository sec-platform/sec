import type { ObservedCommandOutcome } from '../../runtime-state/physical/runtime/observed-process.ts';
import type { PipelineExecutionBoundary } from '../compilation-protocol/types.ts';
import type { SemanticMutationIsolatedChildFailureStage } from './isolation/isolated-verification-child-outcome.ts';
import type {
  SemanticMutationIsolatedProgressCheckpoint,
  SemanticMutationIsolatedTerminationClass
} from './isolation/isolated-verification-child-progress.ts';

export type SemanticMutationIsolatedVerificationFailureStage =
  | 'runtime-materialization'
  | 'appcontainer-execution'
  | 'isolated-child-execution'
  | 'child-failed-before-artifacts'
  | 'child-terminated-without-outcome'
  | 'artifact-missing'
  | 'artifact-parse'
  | 'artifact-read'
  | 'artifact-protocol'
  | 'semantic-rebuild'
  | 'binding-mismatch';

export type SemanticMutationIsolatedVerificationArtifact =
  | 'child-outcome'
  | 'child-progress'
  | 'verification-report'
  | 'runtime-report'
  | 'policy-report'
  | 'acceptance-coverage'
  | 'verification-set';

export interface SemanticMutationIsolatedVerificationFailure {
  readonly stage: SemanticMutationIsolatedVerificationFailureStage;
  readonly child?: Readonly<{
    readonly stage: SemanticMutationIsolatedChildFailureStage;
    readonly boundary?: PipelineExecutionBoundary;
  }>;
  readonly artifact?: SemanticMutationIsolatedVerificationArtifact;
  readonly termination?: Readonly<{
    readonly class: SemanticMutationIsolatedTerminationClass;
    readonly checkpoint?: SemanticMutationIsolatedProgressCheckpoint;
    readonly pendingCheckpoint?: SemanticMutationIsolatedProgressCheckpoint;
  }>;
  readonly lifecycle?: Readonly<{
    readonly status: ObservedCommandOutcome['status'];
    readonly trigger?: NonNullable<ObservedCommandOutcome['trigger']>;
    readonly started: boolean;
    readonly exitCode: number | null;
    readonly durationMs: number;
    readonly stdout: ObservedCommandOutcome['stdout'];
    readonly stderr: ObservedCommandOutcome['stderr'];
    readonly termination: ObservedCommandOutcome['termination'];
  }>;
  readonly appContainer?: Readonly<{
    readonly phase: 'invalid-input' | 'preparation' | 'acl' | 'launch' | 'wait' | 'timeout' | 'cleanup';
    readonly preparationSubstage?:
      | 'native-helper-entry' | 'native-helper-build' | 'native-helper-bundle-contract'
      | 'native-helper-materialization' | 'native-helper-invocation' | 'native-helper-protocol'
      | 'native-helper-diagnostic' | 'native-receipt' | 'sid-derivation' | 'profile-creation'
      | 'owner-publication' | 'runtime-identity' | 'system-directory' | 'unknown';
    readonly nativeCode?: number;
    readonly hostToolFailure?: Readonly<{
      readonly stage: 'acl-grant' | 'acl-remove' | 'acl-verify-absent' | 'profile-query';
      readonly reason: 'spawn' | 'nonzero-exit' | 'timeout' | 'lease-loss' |
        'lifecycle-failure' | 'output-limit' | 'aborted' | 'termination-unconfirmed';
      readonly termination: 'not-requested' | 'confirmed' | 'unconfirmed';
    }>;
    readonly nativeHelperObservation?: Readonly<{
      readonly mode: 'derive' | 'create-profile' | 'execute';
      readonly exitClass: 'zero' | 'nonzero' | 'invalid';
      readonly diagnosticStream: 'empty' | 'present';
      readonly protocol: 'ok' | 'declared-failure' | 'invalid';
      readonly nativeReceipt: 'not-applicable' | 'absent' | 'exit-code' |
        'declared-failure' | 'invalid' | 'read-error';
    }>;
  }>;
}

export class SemanticMutationIsolatedVerificationUnavailableError extends Error {
  public readonly code = 'SEMANTIC-MUTATION-ISOLATED-VERIFICATION-UNAVAILABLE' as const;

  constructor(public readonly failure: SemanticMutationIsolatedVerificationFailure) {
    super('Semantic Mutation isolated verification is unavailable');
    this.name = 'SemanticMutationIsolatedVerificationUnavailableError';
  }
}
