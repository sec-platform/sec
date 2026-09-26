import { FailureError } from '../../../../contracts/failure.ts';
import type {
  GeneratedStateCleanupContinuationReceipt,
  GeneratedStateCleanupProfile,
  GeneratedStateDisposalReceipt,
  GeneratedStateInventory,
  GeneratedStatePhysicalIdentity,
  GeneratedStateRegistration
} from '../../../runtime-state/generated-state/contract.ts';
import type { GeneratedStateRetirementObservation } from '../../../runtime-state/generated-state/lifecycle.ts';

/** Generated-state methods owned by the dependency lifecycle boundary. */
export type RuntimeDependencyGeneratedStateLifecycle = Readonly<{
    born(relativePath: string, operationId: string): Promise<void>;
    /** Root-bound inventory from the same lifecycle store as every producer Effect. */
    inspect(relativePaths?: readonly string[]): Promise<GeneratedStateInventory>;
    /** Read-only adoption of an issuer-created active registration. */
    bind?: (
      relativePath: string,
      expected?: Readonly<{
        owner?: string;
        producer?: string;
        ruleId?: string;
        physical?: GeneratedStatePhysicalIdentity;
      }>
    ) => Promise<GeneratedStateRegistration>;
    /** Re-activate one exact retired predecessor after owner-local rollback. */
    restore?: (
      relativePath: string,
      expectedRegistrationDigest: `sha256:${string}`,
      expectedPhysical: GeneratedStatePhysicalIdentity,
      outcome: string
    ) => Promise<GeneratedStateRegistration>;
    retired(relativePath: string, outcome: string): Promise<GeneratedStateRegistration | void>;
    settleRetired?: (
      relativePath: string,
      expected?: Readonly<{
        owner?: string;
        producer?: string;
        ruleId?: string;
        physical?: GeneratedStatePhysicalIdentity;
      }>
    ) => Promise<boolean>;
    observeRetirement?: (
      relativePath: string,
      expected?: Readonly<{
        owner?: string;
        producer?: string;
        ruleId?: string;
        physical?: GeneratedStatePhysicalIdentity;
      }>
    ) => Promise<GeneratedStateRetirementObservation>;
    /** Terminalize one exact active registration after its physical root is already absent. */
    settleAbsent?: (
      relativePath: string,
      expected: Readonly<{
        owner: string;
        producer: string;
        ruleId: string;
        physical: GeneratedStatePhysicalIdentity;
      }>,
      outcome: string
    ) => Promise<Readonly<{
      schema: 'sec-generated-state-absent-registration-settlement-v1';
      relativePath: string;
      registrationDigest: `sha256:${string}`;
      retirementRef: `sha256:${string}`;
      physical: GeneratedStatePhysicalIdentity;
      outcome: string;
      terminal: 'disposed';
      receiptDigest: `sha256:${string}`;
    }>>;
    disposed(
      relativePath: string,
      request: Readonly<{ outcome: string; profile: GeneratedStateCleanupProfile }>
    ): Promise<GeneratedStateDisposalReceipt>;
    quarantine?: (
      relativePath: string,
      request: Readonly<{ outcome: string; profile: GeneratedStateCleanupProfile }>
    ) => Promise<GeneratedStateCleanupContinuationReceipt>;
}>;

export type RuntimeDependencyLifecycleInput<
  K extends keyof RuntimeDependencyGeneratedStateLifecycle = keyof RuntimeDependencyGeneratedStateLifecycle
> = Readonly<{ generatedStateLifecycle?: Pick<RuntimeDependencyGeneratedStateLifecycle, K> }>;

export type CapturedRuntimeDependencyLifecycle<K extends keyof RuntimeDependencyGeneratedStateLifecycle> =
  Readonly<Partial<Pick<RuntimeDependencyGeneratedStateLifecycle, K>>>;

/**
 * Capture only the methods needed by this operation, once and before awaits.
 * Native receiver binding preserves class/private-field providers. The view
 * does not expose unrelated lifecycle methods or the installation request.
 * This is interface attenuation, not a sandbox around provider code.
 */
export function captureRuntimeDependencyLifecycle<K extends keyof RuntimeDependencyGeneratedStateLifecycle>(
  input: RuntimeDependencyLifecycleInput<K>,
  keys: readonly K[]
): CapturedRuntimeDependencyLifecycle<K> | undefined {
  const source = input.generatedStateLifecycle;
  if (source === undefined) return undefined;
  if (source === null || (typeof source !== 'object' && typeof source !== 'function')) {
    throw new FailureError('IMPORT-AUTHORITY-004', 'Dependency lifecycle must be an operation capability object');
  }
  const entries = new Map<K, unknown>();
  for (const key of keys) {
    if (entries.has(key)) continue;
    const method = source[key];
    if (method !== undefined && typeof method !== 'function') {
      throw new FailureError('IMPORT-AUTHORITY-004', 'Dependency lifecycle method is not callable', { method: key });
    }
    entries.set(key, method === undefined ? undefined :
      (...args: unknown[]) => Reflect.apply(method, source, args));
  }
  return Object.freeze(Object.fromEntries(entries)) as CapturedRuntimeDependencyLifecycle<K>;
}
