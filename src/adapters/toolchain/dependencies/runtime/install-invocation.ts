import { FailureError } from '../../../../contracts/failure.ts';
import type { RuntimeDependencyInstallRequest } from '../contract/install-request.ts';
import { isRuntimeDependencyInstallMode } from '../contract/install-request.ts';
import { assertRuntimeDependencyTestMaterialization } from './materialization-fixture-capability.ts';
import type { RuntimeDependencyEffectFenceInput, RuntimeDependencyFaultInjectionInput } from './operation-context.ts';
import { captureRuntimeDependencyBindingGuard, runtimeDependencyOperationControls } from './operation-controls.ts';

export type CompilerInstallInvocationInput = RuntimeDependencyEffectFenceInput
  & Readonly<Pick<RuntimeDependencyInstallRequest, 'installMode'>>
  & Readonly<Pick<RuntimeDependencyFaultInjectionInput, 'testMaterialization'>>;

/** Capture only the fields this installer owns. The compatibility facade may
 * remain wide for other consumers, but unrelated getters/capabilities never
 * enter this process execution boundary. A method retains its real provider. */
export function bindCompilerInstallInvocation(options: CompilerInstallInvocationInput) {
  const guard = captureRuntimeDependencyBindingGuard(options);
  function own<K extends keyof CompilerInstallInvocationInput>(key: K): CompilerInstallInvocationInput[K] {
    return Object.getOwnPropertyDescriptor(options, key)?.enumerable ? options[key] : undefined;
  }
  const mode = own('installMode');
  const beforeCommit = own('beforeCommit');
  const materialization = own('testMaterialization');
  if (mode !== undefined && !isRuntimeDependencyInstallMode(mode)) {
    throw new FailureError('RUNTIME-DEPS-003', 'Runtime dependency install mode is invalid');
  }
  if (mode === 'prebound-only') throw new FailureError('RUNTIME-DEPS-003', 'Prebound-only mode cannot execute a dependency installation');
  if (beforeCommit !== undefined && typeof beforeCommit !== 'function') throw new FailureError('RUNTIME-DEPS-003', 'Compiler dependency commit fence must be callable');
  if (materialization !== undefined) assertRuntimeDependencyTestMaterialization(materialization);
  guard(options);
  const controls = runtimeDependencyOperationControls(options);
  guard(options);
  return Object.freeze({ controls, isolated: mode === 'offline-copy-only', materialization,
    beforeCommit: beforeCommit === undefined ? undefined : () => Reflect.apply(beforeCommit, options, [])
  });
}
