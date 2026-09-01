import type { CommandResult } from '../../../runtime-state/physical/runtime/process.ts';
import { SecError } from '../../../system-architecture/foundation/contract/failure.ts';

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
  const capability = Object.freeze({});
  issuedRuntimeDependencyTestMaterializations.set(capability, materialize);
  return capability as unknown as RuntimeDependencyTestMaterializationCapability;
}

export async function consumeRuntimeDependencyTestMaterialization(
  capability: RuntimeDependencyTestMaterializationCapability,
  request: RuntimeDependencyTestMaterializationRequest
): Promise<CommandResult> {
  const materialize = issuedRuntimeDependencyTestMaterializations.get(capability);
  if (materialize === undefined) {
    throw new SecError(
      'RUNTIME-DEPS-004',
      'Compiler dependency test materialization requires an owner-issued capability'
    );
  }
  return materialize(request);
}
