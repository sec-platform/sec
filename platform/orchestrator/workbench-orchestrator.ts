import { applyViewMutations, type ViewMutationReport } from '../compiler/index.ts';

export async function applyWorkbenchMutations(workspaceRoot = process.cwd()): Promise<ViewMutationReport> {
  return applyViewMutations(workspaceRoot);
}
