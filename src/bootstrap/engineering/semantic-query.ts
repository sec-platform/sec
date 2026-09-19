import path from 'node:path';
import type { SemanticQueryPurpose, SemanticQueryResult } from '../../application/semantic-query.ts';
import { requireSemanticQueryPurpose } from '../../application/semantic-query.ts';
import { loadWorkspaceEngineeringIRBuildInput } from '../../adapters/workspace/engineering-input.ts';
import { createRuntime } from '../create-runtime.ts';

/** Workspace reads are an explicit host operation. Neither the pure runtime nor
 * the entry transport acquires a write lease or persists a Lock for a query. */
export async function queryWorkspaceSemantics(
  workspaceRoot: string,
  purpose: SemanticQueryPurpose
): Promise<SemanticQueryResult> {
  const root = path.resolve(workspaceRoot);
  const selectedPurpose = requireSemanticQueryPurpose(purpose);
  const { engineeringIRInput, generatorDeclarations } = await loadWorkspaceEngineeringIRBuildInput(root);
  const runtime = createRuntime();
  try {
    return await runtime.handle({ purpose: selectedPurpose, input: { engineeringIRInput, generatorDeclarations } });
  } finally {
    await runtime.close();
  }
}
