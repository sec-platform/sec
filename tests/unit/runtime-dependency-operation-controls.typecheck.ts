import {
  runtimeDependencyOperationControls,
  waitForRuntimeDependencyOperation,
  type RuntimeDependencyOperationControlInput
} from '../../src/adapters/toolchain/dependencies/runtime/operation-controls.ts';
import { readRuntimeDependencyOperationTelemetry } from '../../src/adapters/toolchain/dependencies/runtime/operation-telemetry.ts';

// A compile-only contract: mutable requests become immutable, capability-free controls.
function controlTypes(input: RuntimeDependencyOperationControlInput) {
  input.lockTimeoutMs = 100;
  const bound = runtimeDependencyOperationControls(input);
  readRuntimeDependencyOperationTelemetry(bound);
  void waitForRuntimeDependencyOperation(bound, 1, async () => {}, 'type contract');
  // @ts-expect-error An installation capability is not in the control projection.
  bound.beforeCommit();
  // @ts-expect-error A raw environment clock is not exposed after binding.
  bound.monotonicNowMs();
  // @ts-expect-error Controls do not carry installation policy requests.
  bound.installMode;
  // @ts-expect-error Controls do not expose generated-state lifecycle authority.
  bound.generatedStateLifecycle;
  // @ts-expect-error The effective timeout cannot be overwritten in place.
  bound.lockTimeoutMs = 200;
}
void controlTypes;
