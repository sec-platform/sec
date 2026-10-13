import type {
  GeneratedStateCleanupContinuationReceipt, GeneratedStateCleanupProfile,
  GeneratedStateDisposalReceipt, GeneratedStateInventory, GeneratedStatePhysicalIdentity,
  GeneratedStateRegistration
} from './contract.ts';

export interface GeneratedStateWorktreeRetirementProvider {
  readonly id: string;
  /** Pure admission: accepts the exact active or already-retired registration and makes no Effect. */
  plan(input: Readonly<{
    repositoryRoot: string;
    workspaceRoot: string;
    relativePath: string;
    source: GeneratedStatePhysicalIdentity;
    registration: GeneratedStateRegistration;
  }>): Promise<Readonly<{
    bytes: string;
    digest: `sha256:${string}`;
  }>>;
  /** Effect boundary: lifecycle always supplies the exact retired registration bound to the durable plan. */
  retire(authority: GeneratedStateWorktreeRetirementEffectAuthority): Promise<Readonly<{
    bytes: string;
    digest: `sha256:${string}`;
  }>>;
}

export interface GeneratedStateWorktreeRetirementEffectAuthority {
  readonly schema: 'sec-generated-state-worktree-retirement-effect-authority-v1';
}

export type GeneratedStateWorktreeRetirementEffectInput = Readonly<{
  operationId: `sha256:${string}`;
  repositoryRoot: string;
  workspaceRoot: string;
  relativePath: string;
  source: GeneratedStatePhysicalIdentity;
  registration: GeneratedStateRegistration;
  planBytes: string;
  planDigest: `sha256:${string}`;
}>;

export type GeneratedStateRetirementObservationStatus =
  | 'active'
  | 'retired-present'
  | 'retired-domain-settled'
  | 'absent'
  | 'mismatch';

export interface GeneratedStateRetirementObservation {
  readonly schema: 'sec-generated-state-retirement-observation-v1';
  readonly status: GeneratedStateRetirementObservationStatus;
  readonly relativePath: string;
  readonly registrationDigest: `sha256:${string}` | null;
  readonly physical: GeneratedStatePhysicalIdentity | null;
  readonly observationDigest: `sha256:${string}`;
}

export interface GeneratedStateProducerBindingExpectation {
  readonly owner?: string;
  readonly producer?: string;
  readonly ruleId?: string;
  readonly physical?: GeneratedStatePhysicalIdentity;
}

export interface GeneratedStateAbsentRegistrationExpectation {
  readonly owner: string;
  readonly producer: string;
  readonly ruleId: string;
  readonly physical: GeneratedStatePhysicalIdentity;
}

export type GeneratedStateAbsentRegistrationSettlementReceipt = Readonly<{
  readonly schema: 'sec-generated-state-absent-registration-settlement-v1';
  readonly relativePath: string;
  readonly registrationDigest: `sha256:${string}`;
  readonly retirementRef: `sha256:${string}`;
  readonly physical: GeneratedStatePhysicalIdentity;
  readonly outcome: string;
  readonly terminal: 'disposed';
  readonly receiptDigest: `sha256:${string}`;
}>;

export interface GeneratedStateProducerHookSet {
  born(relativePath: string, operationId: string): Promise<void>;
  inspect(relativePaths?: readonly string[]): Promise<GeneratedStateInventory>;
  bind(
    relativePath: string,
    expected?: GeneratedStateProducerBindingExpectation
  ): Promise<GeneratedStateRegistration>;
  restore(
    relativePath: string,
    expectedRegistrationDigest: `sha256:${string}`,
    expectedPhysical: GeneratedStatePhysicalIdentity,
    outcome: string
  ): Promise<GeneratedStateRegistration>;
  retired(relativePath: string, outcome: string): Promise<GeneratedStateRegistration | void>;
  settleRetired(
    relativePath: string,
    expected?: GeneratedStateProducerBindingExpectation
  ): Promise<boolean>;
  observeRetirement(
    relativePath: string,
    expected?: GeneratedStateProducerBindingExpectation
  ): Promise<GeneratedStateRetirementObservation>;
  settleAbsent(
    relativePath: string,
    expected: GeneratedStateAbsentRegistrationExpectation,
    outcome: string
  ): Promise<GeneratedStateAbsentRegistrationSettlementReceipt>;
  disposed(
    relativePath: string,
    request: Readonly<{ outcome: string; profile: GeneratedStateCleanupProfile }>
  ): Promise<GeneratedStateDisposalReceipt>;
}

export interface GeneratedStateProducerQuarantineHook {
  quarantine(
    relativePath: string,
    request: Readonly<{ outcome: string; profile: GeneratedStateCleanupProfile }>
  ): Promise<GeneratedStateCleanupContinuationReceipt>;
}
