import { FailureError } from '../../../../contracts/failure.ts';
import type { CommandResult } from '../../../runtime-state/physical/runtime/process.ts';

declare const RUNTIME_DEPENDENCY_TEST_MATERIALIZATION_CAPABILITY: unique symbol;

export type RuntimeDependencyTestMaterializationCapability = Readonly<{
  readonly [RUNTIME_DEPENDENCY_TEST_MATERIALIZATION_CAPABILITY]: true;
}>;

export type RuntimeDependencyTestMaterializationRequest = Readonly<{
  args: readonly string[];
  cwd: string;
  timeoutMs: number;
}>;

type RuntimeDependencyTestMaterializer = (
  request: RuntimeDependencyTestMaterializationRequest
) => Promise<CommandResult>;

const issuedRuntimeDependencyTestMaterializations = new WeakMap<
  object,
  RuntimeDependencyTestMaterializer
>();

/** Test-owner issuer; deliberately absent from the production facade. */
export function issueRuntimeDependencyTestMaterialization(
  materialize: RuntimeDependencyTestMaterializer
): RuntimeDependencyTestMaterializationCapability {
  if (typeof materialize !== 'function') throw new TypeError('Test materializer must be callable');
  const capability = Object.freeze({});
  issuedRuntimeDependencyTestMaterializations.set(capability, materialize);
  return capability as unknown as RuntimeDependencyTestMaterializationCapability;
}

/** Admission only; never invokes the test provider or materializes anything. */
export function assertRuntimeDependencyTestMaterialization(capability: unknown): asserts capability is RuntimeDependencyTestMaterializationCapability {
  if (typeof capability !== 'object' || capability === null || !issuedRuntimeDependencyTestMaterializations.has(capability)) {
    throw new FailureError('RUNTIME-DEPS-004', 'Compiler dependency test materialization requires an owner-issued capability');
  }
}

export async function consumeRuntimeDependencyTestMaterialization(
  capability: RuntimeDependencyTestMaterializationCapability,
  request: RuntimeDependencyTestMaterializationRequest
): Promise<CommandResult> {
  assertRuntimeDependencyTestMaterialization(capability);
  const materialize = issuedRuntimeDependencyTestMaterializations.get(capability)!;
  return materialize(request);
}
