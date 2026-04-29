import { applyViewMutations, type ViewMutationReport } from '../compiler/workbench/apply-view-mutations.ts';

export async function applyWorkbenchMutations(workspaceRoot = process.cwd()): Promise<ViewMutationReport> {
  return applyViewMutations(workspaceRoot);
}
