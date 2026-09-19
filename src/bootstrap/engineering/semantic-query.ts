import path from 'node:path';
import type { SemanticQueryPurpose, SemanticQueryResult } from '../../application/semantic-query.ts';
import { requireSemanticQueryPurpose } from '../../application/semantic-query.ts';
import { loadWorkspaceEngineeringIRBuildInput } from '../../adapters/workspace/engineering-input.ts';
import { readSemanticQueryInput } from '../../adapters/workspace/semantic-query-input.ts';
import { createRuntime } from '../create-runtime.ts';

/** Workspace reads or a closed input file are explicit host operations. Neither the pure runtime nor
 * the entry transport acquires a write lease or persists a Lock for a query. */
export async function queryWorkspaceSemantics(
  workspaceRoot: string,
  purpose: SemanticQueryPurpose,
  inputFile?: string
): Promise<SemanticQueryResult> {
  const root = path.resolve(workspaceRoot);
  const selectedPurpose = requireSemanticQueryPurpose(purpose);
  const input = inputFile === undefined
    ? await loadWorkspaceEngineeringIRBuildInput(root)
    : readSemanticQueryInput(path.resolve(root, inputFile));
  const runtime = createRuntime();
  try {
    return await runtime.handle({ purpose: selectedPurpose, input });
  } finally {
    await runtime.close();
  }
}
