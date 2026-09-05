import type { RuntimeDependencyLifecycleInput } from './lifecycle-capabilities.ts';
export type { RuntimeDependencyGeneratedStateLifecycle, RuntimeDependencyLifecycleInput } from './lifecycle-capabilities.ts';
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

export interface RuntimeDependencyInstallOptions extends RuntimeDependencyOperationControlInput, RuntimeDependencyLifecycleInput {
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

export type RuntimeDependencyEffectFenceOptions = BoundRuntimeDependencyOperationControls & Readonly<{ beforeCommit?: CommitFence }>;

export async function runtimeDependencyOperationEffectFence(
  options: RuntimeDependencyEffectFenceOptions,
  label: string
): Promise<void> {
  runtimeDependencyOperationRemainingMs(options, `${label} admission`);
  // A never-settling fence must not hold the caller beyond cancellation or
  // its operation deadline. Rejection is not a claim that provider work stopped.
  await awaitRuntimeDependencyOperation(
    runtimeDependencyOperationContext(options), `${label} effect`, () => options.beforeCommit?.()
  );
}

