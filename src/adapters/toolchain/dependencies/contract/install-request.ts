import type { CommitFence } from "../../../../contracts/commit-fence.ts";
import { FailureError } from '../../../../contracts/failure.ts';

export const RUNTIME_DEPENDENCY_INSTALL_MODES = Object.freeze([
  'allow', 'offline-copy-only', 'prebound-only'
] as const);
export type RuntimeDependencyInstallMode = (typeof RUNTIME_DEPENDENCY_INSTALL_MODES)[number];

/** Caller decisions only. Clock, process, lifecycle and test providers belong
 * to the internal execution environment, not to a public installation request. */
export interface RuntimeDependencyInstallRequest {
  beforeCommit?: CommitFence;
  deadlineAtUnixMs?: number;
  installMode?: RuntimeDependencyInstallMode;
  lockTimeoutMs?: number;
  rematerialize?: boolean;
  signal?: AbortSignal;
  skipSharedDepsWarmup?: boolean;
}

export function isRuntimeDependencyInstallMode(value: unknown): value is RuntimeDependencyInstallMode {
  return typeof value === 'string'
    && (RUNTIME_DEPENDENCY_INSTALL_MODES as readonly string[]).includes(value);
}

/** Preserve public property lookup (including class methods), but read each
 * selected decision once. Internal options retain their own-enumerable boundary.
 * No clock is sampled here: its deadline/limit owner still performs admission. */
export function captureRuntimeDependencyInstallRequest(
  input: Readonly<RuntimeDependencyInstallRequest>
): Readonly<RuntimeDependencyInstallRequest> {
  if (input === null || typeof input !== 'object') {
    throw new FailureError('RUNTIME-DEPS-003', 'Runtime dependency request must be an object');
  }
  const { beforeCommit, deadlineAtUnixMs, installMode, lockTimeoutMs,
    rematerialize, signal, skipSharedDepsWarmup } = input;
  const captured = { beforeCommit, deadlineAtUnixMs, installMode, lockTimeoutMs,
    rematerialize, signal, skipSharedDepsWarmup };
  assertCapturedRuntimeDependencyInstallRequest(captured);
  return Object.freeze({
    beforeCommit: beforeCommit === undefined ? undefined : () => Reflect.apply(beforeCommit, input, []),
    deadlineAtUnixMs, installMode, lockTimeoutMs, rematerialize, signal, skipSharedDepsWarmup
  });
}

/** Validate a previously captured request without invoking or re-binding its
 * provider. Public capture and coordinator capture share these decisions;
 * deadline, signal branding and limits stay with the operation-control owner.
 */
export function assertCapturedRuntimeDependencyInstallRequest(
  input: Readonly<RuntimeDependencyInstallRequest>
): void {
  const { beforeCommit, installMode, rematerialize, skipSharedDepsWarmup } = input;
  if (beforeCommit !== undefined && typeof beforeCommit !== 'function') {
    throw new FailureError('RUNTIME-DEPS-003', 'Runtime dependency commit fence must be callable');
  }
  if (installMode !== undefined && !isRuntimeDependencyInstallMode(installMode)) {
    throw new FailureError('RUNTIME-DEPS-003', 'Runtime dependency install mode is invalid');
  }
  for (const [field, value] of [['rematerialize', rematerialize],
    ['skipSharedDepsWarmup', skipSharedDepsWarmup]] as const) {
    if (value !== undefined && typeof value !== 'boolean') {
      throw new FailureError('RUNTIME-DEPS-003', `Runtime dependency ${field} must be boolean`);
    }
  }
}
