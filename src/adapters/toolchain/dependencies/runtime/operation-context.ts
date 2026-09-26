import path from 'node:path';
import type { CommitFence } from "../../../../contracts/commit-fence.ts";
import { FailureError } from '../../../../contracts/failure.ts';
import { assertCapturedRuntimeDependencyInstallRequest, type RuntimeDependencyInstallRequest } from '../contract/install-request.ts';
import type { RuntimeDependencyLifecycleInput } from './lifecycle-capabilities.ts';
import type { RuntimeDependencyTestMaterializationCapability } from './materialization-fixture-capability.ts';
;

import {
  awaitRuntimeDependencyOperation,
  captureRuntimeDependencyBindingGuard,
  captureRuntimeDependencyControlInput,
  runtimeDependencyOperationContext,
  runtimeDependencyOperationControls,
  type BoundRuntimeDependencyOperationControls,
  type RuntimeDependencyOperationControlInput
} from './operation-controls.ts';

// Preserve existing public imports while retiring their old implementation.
export {
  MAX_DEPENDENCY_OPERATION_TIMEOUT_MS,
  runtimeDependencyOperationContext,

  runtimeDependencyOperationDeadlineAt,
  runtimeDependencyOperationRemainingMs,
  waitForRuntimeDependencyOperation
} from './operation-controls.ts';

// Execution-generation retention and install-operation admission are separate
// policy decisions. Preserve today's value without making either future change
// silently alter the other. This is not an evidence/GC retention period.
export const COMPILER_DEPENDENCY_EXECUTION_RETENTION_POLICY = Object.freeze({
  maximumDurationMs: 300_000
});

/** Internal environment supplied by dependency orchestration, never public input. */
interface RuntimeDependencyEnvironmentInput {
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

/** Closed coordinator view. A generic input may contain application data, but
 * those extra keys are no longer forwarded as implicit execution capabilities.
 */
export type RuntimeDependencyOperationOptions = Readonly<Omit<RuntimeDependencyInstallOptions,
  'deadlineAtUnixMs' | 'lockTimeoutMs' | 'pollIntervalMs' | 'signal'>> & BoundRuntimeDependencyOperationControls;

const issuedOperationOptions = new WeakSet<object>();
const boundOperationMethods = new WeakSet<object>();
const runtimeDependencyInstallOptionKeys = new Set<PropertyKey>([
  'beforeCommit', 'deadlineAtUnixMs', 'generatedStateLifecycle', 'installMode',
  'lockTimeoutMs', 'monotonicNowMs', 'now', 'pollIntervalMs', 'rematerialize',
  'sharedDepsRoot', 'signal', 'skipSharedDepsWarmup', 'sleep',
  'testCompilerBridgeValidationHook', 'testCompilerPublishHook',
  'testCompilerPublishPlatform', 'testCompilerRename', 'testInstallLockDelete',
  'testInstallLockDeletePlatform', 'testMaterialization', 'testProjectProjectionHook'
] satisfies readonly (keyof RuntimeDependencyInstallOptions)[]);

function ownOption<K extends keyof RuntimeDependencyInstallOptions>(
  input: RuntimeDependencyInstallOptions, key: K
): RuntimeDependencyInstallOptions[K] {
  return Object.getOwnPropertyDescriptor(input, key)?.enumerable ? input[key] : undefined;
}

/** Unbound coordinator inputs may carry unrelated application data, which is
 * deliberately not enumerated. Once an input carries a parent operation,
 * however, an unknown enumerable accessor is executable authority that could
 * rewrite that parent during a compatibility snapshot. Inspect descriptors
 * without invoking accessors and retain the original binding across proxy
 * own-key/descriptor traps before accepting the input.
 */
function assertNoUnownedParentBoundAccessors(
  input: RuntimeDependencyInstallOptions,
  controlsInput: Readonly<RuntimeDependencyOperationControlInput>,
  guard: (captured: RuntimeDependencyOperationControlInput) => void
): void {
  const bindingKeys = Object.getOwnPropertySymbols(controlsInput);
  if (bindingKeys.length === 0) return;
  const admittedKeys = new Set<PropertyKey>([...runtimeDependencyInstallOptionKeys, ...bindingKeys]);
  let unownedAccessor: PropertyKey | undefined;
  try {
    for (const key of Reflect.ownKeys(input)) {
      if (admittedKeys.has(key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (descriptor?.enumerable === true && !('value' in descriptor)) {
        unownedAccessor = key;
        break;
      }
    }
  } finally {
    guard(input);
  }
  if (unownedAccessor !== undefined) {
    throw new FailureError(
      'RUNTIME-DEPS-003',
      'Parent-bound runtime dependency options contain an unowned executable accessor'
    );
  }
}

/** Method identity is fixed, while legitimate provider-private state remains
 * owned by its real receiver. A wrapper issued here is not wrapped again when
 * a child changes another option; repeated binds do not grow callback chains.
 */
function bindOperationMethod<F extends (...args: never[]) => unknown>(
  value: F | undefined, receiver: object, label: string
): F | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'function') throw new FailureError('RUNTIME-DEPS-003', `${label} must be callable`);
  if (boundOperationMethods.has(value)) return value;
  const bound = ((...args: Parameters<F>) => Reflect.apply(value, receiver, args)) as F;
  boundOperationMethods.add(bound);
  return bound;
}

/** The coordinator still owns the composition of request, environment and
 * capabilities. Capture only declared fields, once, before clock execution;
 * lower consumers keep using their existing narrower projections.
 */
export function runtimeDependencyOperationOptions<T extends RuntimeDependencyInstallOptions>(
  options: T
): RuntimeDependencyOperationOptions {
  if (options === null || typeof options !== 'object') {
    throw new FailureError('RUNTIME-DEPS-003', 'Runtime dependency options must be an object');
  }
  if (issuedOperationOptions.has(options)) {
    // Re-sample the checked clock and propagate cancellation as before; effects
    // still own their remaining-budget checks. Only capture/allocation is elided.
    const controls = runtimeDependencyOperationControls(options);
    if (runtimeDependencyOperationContext(controls) === runtimeDependencyOperationContext(options)) {
      return options as T & RuntimeDependencyOperationOptions;
    }
  }
  const cwd = process.cwd();
  const guard = captureRuntimeDependencyBindingGuard(options);
  const controlsInput = captureRuntimeDependencyControlInput(options);
  assertNoUnownedParentBoundAccessors(options, controlsInput, guard);
  const beforeCommit = ownOption(options, 'beforeCommit');
  const installMode = ownOption(options, 'installMode');
  const rematerialize = ownOption(options, 'rematerialize');
  const skipSharedDepsWarmup = ownOption(options, 'skipSharedDepsWarmup');
  const now = ownOption(options, 'now');
  const sleep = ownOption(options, 'sleep');
  const sharedDepsRoot = ownOption(options, 'sharedDepsRoot');
  const generatedStateLifecycle = ownOption(options, 'generatedStateLifecycle');
  const testCompilerPublishPlatform = ownOption(options, 'testCompilerPublishPlatform');
  const testCompilerPublishHook = ownOption(options, 'testCompilerPublishHook');
  const testProjectProjectionHook = ownOption(options, 'testProjectProjectionHook');
  const testCompilerBridgeValidationHook = ownOption(options, 'testCompilerBridgeValidationHook');
  const testInstallLockDelete = ownOption(options, 'testInstallLockDelete');
  const testInstallLockDeletePlatform = ownOption(options, 'testInstallLockDeletePlatform');
  const testCompilerRename = ownOption(options, 'testCompilerRename');
  const testMaterialization = ownOption(options, 'testMaterialization');
  guard(options);
  if (sharedDepsRoot !== undefined && typeof sharedDepsRoot !== 'string') {
    throw new FailureError('RUNTIME-DEPS-003', 'Runtime dependency shared root must be a path string');
  }
  // Reuse the request owner's boolean/mode/fence grammar. Do not maintain a
  // second coercion policy at the internal coordinator boundary.
  const request = Object.freeze({
    beforeCommit: bindOperationMethod(beforeCommit, options, 'Runtime dependency commit fence'),
    installMode, rematerialize, skipSharedDepsWarmup
  });
  assertCapturedRuntimeDependencyInstallRequest(request);
  const methods = {
    now: bindOperationMethod(now, options, 'Runtime dependency wall clock'),
    sleep: bindOperationMethod(sleep, options, 'Runtime dependency sleep'),
    testCompilerPublishHook: bindOperationMethod(testCompilerPublishHook, options, 'Compiler publication hook'),
    testProjectProjectionHook: bindOperationMethod(testProjectProjectionHook, options, 'Project projection hook'),
    testCompilerBridgeValidationHook: bindOperationMethod(testCompilerBridgeValidationHook, options, 'Compiler bridge hook'),
    testInstallLockDelete: bindOperationMethod(testInstallLockDelete, options, 'Install-lock deletion hook'),
    testCompilerRename: bindOperationMethod(testCompilerRename, options, 'Compiler rename provider')
  };
  // Clock capture and its receiver belong to controls for all callers, not
  // only coordinator requests. Reuse that exact snapshot and parent ledger.
  const monotonicNowMs = controlsInput.monotonicNowMs;
  const controls = runtimeDependencyOperationControls(controlsInput);
  guard(options);
  const captured: RuntimeDependencyOperationOptions = Object.freeze({
    ...request, ...methods, ...controls, monotonicNowMs,
    sharedDepsRoot: sharedDepsRoot === undefined ? undefined : path.resolve(cwd, sharedDepsRoot),
    generatedStateLifecycle, testCompilerPublishPlatform, testInstallLockDeletePlatform, testMaterialization
  } satisfies Record<keyof RuntimeDependencyInstallOptions, unknown>);
  issuedOperationOptions.add(captured);
  return captured;
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
    beforeCommit: bindOperationMethod(beforeCommit, input, 'Runtime dependency effect fence')
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
