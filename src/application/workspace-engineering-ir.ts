import { buildEngineeringIR, type BuildEngineeringIRInput } from '../compiler/ir/build-engineering-ir.ts';
import type { EngineeringIR } from '../semantics/engineering-ir/root-types.ts';

type Awaitable<T> = T | PromiseLike<T>;

export interface WorkspaceEngineeringIRQueryOperations {
  readInput(): Awaitable<Readonly<{ engineeringIRInput: BuildEngineeringIRInput }>>;
}

/** Pure workspace IR query: read one admitted input and compile it without
 * publishing Lock state or acquiring a write lease. */
export async function buildWorkspaceEngineeringIRResult(
  operations: WorkspaceEngineeringIRQueryOperations
): Promise<EngineeringIR> {
  const { readInput } = operations;
  if (typeof readInput !== 'function') {
    throw new TypeError('Workspace Engineering IR reader must be callable');
  }
  const { engineeringIRInput } = await readInput.call(operations);
  return buildEngineeringIR(engineeringIRInput);
}
