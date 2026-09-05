import type {
  GeneratedStateCleanupContinuationReceipt,
  GeneratedStateCleanupProfile,
  GeneratedStateDisposalReceipt,
  GeneratedStatePhysicalIdentity,
  GeneratedStateRegistration
} from '../../../runtime-state/generated-state/contract.ts';
import type { GeneratedStateRetirementObservation } from '../../../runtime-state/generated-state/lifecycle.ts';
import type { CommitFence } from '../../../workspace/files.ts';
import type { RuntimeDependencyTestMaterializationCapability } from './materialization-fixture-capability.ts';

import {
  awaitRuntimeDependencyOperation,
  MAX_DEPENDENCY_OPERATION_TIMEOUT_MS,
  runtimeDependencyOperationContext,
  runtimeDependencyOperationControls,
  captureRuntimeDependencyBindingGuard,
  runtimeDependencyOperationRemainingMs,
  type BoundRuntimeDependencyOperationControls,
  type RuntimeDependencyOperationControlInput
} from './operation-controls.ts';

// Preserve existing public imports while retiring their old implementation.
export {
  MAX_DEPENDENCY_OPERATION_TIMEOUT_MS,
  runtimeDependencyOperationContext,
  runtimeDependencyOperationControls,
  runtimeDependencyOperationDeadlineAt,
  runtimeDependencyOperationRemainingMs,
  waitForRuntimeDependencyOperation,
  type BoundRuntimeDependencyOperationControls,
  type RuntimeDependencyOperationContext,
  type RuntimeDependencyOperationControlInput
} from './operation-controls.ts';

export const COMPILER_DEPENDENCY_EXECUTION_RETENTION_POLICY = Object.freeze({
  maximumDurationMs: MAX_DEPENDENCY_OPERATION_TIMEOUT_MS
});

export interface RuntimeDependencyInstallOptions extends RuntimeDependencyOperationControlInput {
  beforeCommit?: CommitFence;
  installMode?: 'allow' | 'offline-copy-only' | 'prebound-only';
  now?: () => string;
  rematerialize?: boolean;
  sharedDepsRoot?: string;
  skipSharedDepsWarmup?: boolean;
  sleep?: (ms: number) => Promise<void>;
  testCompilerPublishPlatform?: NodeJS.Platform;
  testCompilerPublishHook?: (stage: 'active-backed-up') => void | Promise<void>;
  testProjectProjectionHook?: (
    stage: 'prepared' | 'backed-up' | 'published' | 'binding-validated' | 'stamp-readback'
  ) => void | Promise<void>;
  testCompilerBridgeValidationHook?: (
    stage: 'binding-observed' | 'final-binding-observed'
  ) => void | Promise<void>;
  /** Package-local fault injection for the Windows lock-file settlement owner. */
  testInstallLockDelete?: (filePath: string, attempt: number) => void | Promise<void>;
  testInstallLockDeletePlatform?: NodeJS.Platform;
  testCompilerRename?: (source: string, target: string) => Promise<void>;
  /**
   * Process-local materialization capability issued only by the dependency
   * test owner.  It can replace the install result in deterministic fixtures,
   * but it can neither choose an executable nor become a production process
   * transport.
   */
  testMaterialization?: RuntimeDependencyTestMaterializationCapability;
  generatedStateLifecycle?: Readonly<{
    born(relativePath: string, operationId: string): Promise<void>;
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
}

export type RuntimeDependencyOperationOptions<
  T extends RuntimeDependencyInstallOptions = RuntimeDependencyInstallOptions
> = Readonly<Omit<T, 'deadlineAtUnixMs' | 'lockTimeoutMs' | 'pollIntervalMs' | 'signal'>> & BoundRuntimeDependencyOperationControls;

/** Install boundary keeps its own capabilities; budget consumers receive only controls. */
export function runtimeDependencyOperationOptions<T extends RuntimeDependencyInstallOptions>(
  options: T
): RuntimeDependencyOperationOptions<T> {
  const assertBindingUnchanged = captureRuntimeDependencyBindingGuard(options);
  const captured = { ...options };
  assertBindingUnchanged(captured);
  return Object.freeze({ ...captured, ...runtimeDependencyOperationControls(captured) });
}

export async function runtimeDependencyOperationEffectFence(
  options: BoundRuntimeDependencyOperationControls & Readonly<Pick<RuntimeDependencyInstallOptions, 'beforeCommit'>>,
  label: string
): Promise<void> {
  runtimeDependencyOperationRemainingMs(options, `${label} admission`);
  // A never-settling fence must not hold the caller beyond cancellation or
  // its operation deadline. Rejection is not a claim that provider work stopped.
  await awaitRuntimeDependencyOperation(
    runtimeDependencyOperationContext(options), `${label} effect`, () => options.beforeCommit?.()
  );
}

