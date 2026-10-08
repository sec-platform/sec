import type { GeneratedStatePhysicalIdentity, GeneratedStateRegistration } from './contract.ts';
import type { GeneratedStateCleanupIntent, GeneratedStateJournalPublicationRequest, GeneratedStateWorktreeRetirementIntent } from './journal-port.ts';
import type { GeneratedStateNativeObservationEvidence, GeneratedStateObservationFacts, GeneratedStateObservationScope } from './observation.ts';
import type {
  GeneratedStateDirectoryObservation,
  GeneratedStateNativeMutationResource,
  GeneratedStateNativeObservationResource,
  GeneratedStateNativeResource,
  GeneratedStatePublicationAuthority,
  GeneratedStateRegistrationObservation,
  GeneratedStateRegistrationRecord
} from './registration-contract.ts';
export type {
  GeneratedStateDirectoryObservation,
  GeneratedStateNativeMutationResource,
  GeneratedStateNativeObservationResource,
  GeneratedStateNativeResource, GeneratedStatePublicationAuthority, GeneratedStateRegistrationObservation, GeneratedStateRegistrationRecord
} from './registration-contract.ts';

export interface GeneratedStateRegistrationObservationBackend {
  captureObservationEvidence(resource: GeneratedStateNativeObservationResource, scope: GeneratedStateObservationScope):
    Readonly<{ evidence: GeneratedStateNativeObservationEvidence; facts: GeneratedStateObservationFacts }>;
  openObservation(input: Readonly<{ workspaceRoot: string; environment?: NodeJS.ProcessEnv }>): GeneratedStateNativeObservationResource | null;
  assertObservationCurrent(resource: GeneratedStateNativeResource): Promise<void>;
  readRegistrationObservation(resource: GeneratedStateNativeResource, relativePath: string): GeneratedStateRegistrationObservation;
  readRegistrationCensus(resource: GeneratedStateNativeResource): GeneratedStateRegistrationCensus;
  observePhysicalRoot(resource: GeneratedStateNativeResource, relativePath: string): Readonly<{
    kind: 'directory' | 'file' | 'link' | 'missing'; identity: GeneratedStatePhysicalIdentity | null;
  }>;
}

export interface GeneratedStateRegistrationCensus {
  readonly observations: ReadonlyMap<string, GeneratedStateRegistrationObservation>;
  readonly recordsByPath: ReadonlyMap<string, readonly GeneratedStateRegistrationRecord[]>;
}
export interface GeneratedStateRegistrationResponsibilities {
  readonly cleanupIntent: GeneratedStateCleanupIntent | null;
  readonly cleanupTombstoneState: 'absent' | 'present';
  readonly worktreeIntent: GeneratedStateWorktreeRetirementIntent | null;
}

export interface GeneratedStateMigrationSource {
  readonly disposedPaths?: ReadonlySet<string>;
  readonly recordsByPath?: ReadonlyMap<string, readonly GeneratedStateRegistrationRecord[]>;
  readonly sourceRoot: GeneratedStateDirectoryObservation;
  readonly sourceInventoryDigest: `sha256:${string}`;
  readonly sourceEntryIdentityDigest: `sha256:${string}`;
  readonly sourceGenerationCount: number;
  readonly sourcePointerCount: number;
  readonly generations: ReadonlyMap<`sha256:${string}`, Readonly<{ registration: GeneratedStateRegistration; bytes: Buffer }>>;
  readonly pointers: ReadonlyMap<string, Readonly<{ registration: GeneratedStateRegistration; bytes: Buffer }>>;
}

export interface GeneratedStateMigrationIntent {
  readonly schema: 'sec-generated-state-registration-migration-v1' | 'sec-generated-state-registration-migration-v3';
  readonly physicalPreimageDigest?: `sha256:${string}`;
  readonly phase: 'prepared' | 'complete';
  readonly migrationDigest: `sha256:${string}`;
  readonly sourceRoot: GeneratedStatePhysicalIdentity;
  readonly sourceInventoryDigest: `sha256:${string}`;
  readonly sourceGenerationCount: number;
  readonly sourcePointerCount: number;
  readonly targets: readonly Readonly<{ relativePath: string; registrationDigest: `sha256:${string}` }>[];
  readonly previousIntentDigest: `sha256:${string}` | null;
  readonly intentDigest: `sha256:${string}`;
}

export interface GeneratedStateMigrationPlan {
  readonly source: GeneratedStateMigrationSource;
  readonly prepared: GeneratedStateMigrationIntent;
  readonly complete: GeneratedStateMigrationIntent;
  readonly records: readonly GeneratedStateRegistrationRecord[];
}

export type GeneratedStatePublicationRequest =
  | GeneratedStateJournalPublicationRequest
  | Readonly<{ kind: 'registration'; registration: GeneratedStateRegistration;
      previousRecordDigest: `sha256:${string}` | null; event: 'registered' | 'disposed'; admission?: 'absent-retirement' }>
  | Readonly<{ kind: 'migration-prepared' | 'migration-complete'; intent: GeneratedStateMigrationIntent }>
  | Readonly<{ kind: 'migration-event'; record: GeneratedStateRegistrationRecord }>;

export interface GeneratedStateRegistrationMutationBackend {
  acquireMutation(input: Readonly<{ workspaceRoot: string; environment?: NodeJS.ProcessEnv }>): Promise<GeneratedStateNativeMutationResource>;
  assertCurrent(resource: GeneratedStateNativeMutationResource): Promise<void>;
  acknowledgeRecovery(resource: GeneratedStateNativeMutationResource): void;
  settleMutation(resource: GeneratedStateNativeMutationResource): Promise<void>;
  observeWorkspace(resource: GeneratedStateNativeMutationResource): GeneratedStatePhysicalIdentity;
  observeRoot(resource: GeneratedStateNativeMutationResource, relativePath: string): Readonly<{
    kind: 'directory' | 'file' | 'link' | 'missing'; identity: GeneratedStatePhysicalIdentity | null; linkTarget: string | null;
  }>;
  readRegistrationCensus(resource: GeneratedStateNativeMutationResource): GeneratedStateRegistrationCensus;
  readRegistrationResponsibilities(resource: GeneratedStateNativeMutationResource, relativePath: string): GeneratedStateRegistrationResponsibilities;
  readMigrationSource(resource: GeneratedStateNativeMutationResource): GeneratedStateMigrationSource | null;
  readMigrationIntents(resource: GeneratedStateNativeMutationResource): readonly GeneratedStateMigrationIntent[];
  describeMigration(resource: GeneratedStateNativeMutationResource, source: GeneratedStateMigrationSource,
    physicalPreimageDigest: `sha256:${string}`): GeneratedStateMigrationPlan;
  observeMigrationPhysicalPreimage(resource: GeneratedStateNativeMutationResource, source: GeneratedStateMigrationSource): `sha256:${string}`;
  assertMigrationTarget(resource: GeneratedStateNativeMutationResource, plan: GeneratedStateMigrationPlan): void;
  assertMigrationSourceUnchanged(resource: GeneratedStateNativeMutationResource, plan: GeneratedStateMigrationPlan): void;
  publishRegistration(resource: GeneratedStateNativeMutationResource, authority: GeneratedStatePublicationAuthority): void;
  publishMigrationPrepared(resource: GeneratedStateNativeMutationResource, authority: GeneratedStatePublicationAuthority): void;
  publishMigrationEvent(resource: GeneratedStateNativeMutationResource, authority: GeneratedStatePublicationAuthority): void;
  publishMigrationComplete(resource: GeneratedStateNativeMutationResource, authority: GeneratedStatePublicationAuthority): void;
}
