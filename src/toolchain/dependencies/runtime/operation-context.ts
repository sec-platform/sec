import type { RuntimeDependencyInstallRequest } from '../contract/install-request.ts';
import type { RuntimeDependencyLifecycleInput } from './lifecycle-capabilities.ts';
export type { RuntimeDependencyGeneratedStateLifecycle, RuntimeDependencyLifecycleInput } from './lifecycle-capabilities.ts';
import type { CommitFence } from '../../../workspace/files.ts';
import type { RuntimeDependencyTestMaterializationCapability } from './materialization-fixture-capability.ts';

import {
  awaitRuntimeDependencyOperation,
  runtimeDependencyOperationContext,
  runtimeDependencyOperationControls,
  captureRuntimeDependencyBindingGuard,
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

// Execution-generation retention and install-operation admission are separate
// policy decisions. Preserve today's value without making either future change
// silently alter the other. This is not an evidence/GC retention period.
export const COMPILER_DEPENDENCY_EXECUTION_RETENTION_POLICY = Object.freeze({
  maximumDurationMs: 300_000
});

/** Internal environment supplied by dependency orchestration, never public input. */
export interface RuntimeDependencyEnvironmentInput {
  now?: () => string;
  sharedDepsRoot?: string;
  sleep?: (ms: number) => Promise<void>;
}

/** Test-owner facilities remain explicit and separate from production requests. */
export interface RuntimeDependencyFaultInjectionInput {
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

/** Compatibility composition at the coordinator only. Lower consumers must
 * use controls, effect input or a selected lifecycle projection instead. */
export interface RuntimeDependencyInstallOptions extends RuntimeDependencyInstallRequest,
  RuntimeDependencyOperationControlInput, RuntimeDependencyLifecycleInput,
  RuntimeDependencyEnvironmentInput, RuntimeDependencyFaultInjectionInput {}

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

export type RuntimeDependencyEffectFenceInput = RuntimeDependencyOperationControlInput & Readonly<{ beforeCommit?: CommitFence }>;

/** Bind just operation controls and the selected commit fence. Consumers that
 * need no install request or lifecycle provider must not carry that facade.
 * The method retains its real receiver; the guard preserves the parent ledger.
 */
export function runtimeDependencyEffectFenceOptions(
  input: RuntimeDependencyEffectFenceInput
): RuntimeDependencyEffectFenceOptions {
  const guard = captureRuntimeDependencyBindingGuard(input);
  const beforeCommit = input.beforeCommit;
  if (beforeCommit !== undefined && typeof beforeCommit !== 'function') {
    throw new TypeError('Runtime dependency effect fence must be callable');
  }
  guard(input);
  const controls = runtimeDependencyOperationControls(input);
  guard(input);
  return Object.freeze({ ...controls, ...(beforeCommit === undefined ? {} : {
    beforeCommit: () => Reflect.apply(beforeCommit, input, [])
  }) });
}


export async function runtimeDependencyOperationEffectFence(
  options: RuntimeDependencyEffectFenceOptions,
  label: string
): Promise<void> {
  // Fix the selected method before budget sampling invokes caller clock code.
  // The supplied receiver remains real; a record clone would lose private state.
  const beforeCommit = options.beforeCommit;
  if (beforeCommit !== undefined && typeof beforeCommit !== 'function') {
    throw new TypeError('Runtime dependency effect fence must be callable');
  }
  const context = runtimeDependencyOperationContext(options);
  // A never-settling fence must not hold the caller beyond cancellation or
  // its operation deadline. Rejection is not a claim that provider work stopped.
  await awaitRuntimeDependencyOperation(
    context, `${label} effect`, () => beforeCommit === undefined
      ? undefined : Reflect.apply(beforeCommit, options, [])
  );
}

