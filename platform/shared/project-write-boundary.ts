import { assertProjectBaseline, readProjectBaseline } from './project-baseline.ts';
import { checkReferenceDrift } from './project-integrity.ts';

export async function checkProjectWriteBoundary(workspaceRoot: string): Promise<void> {
  const baseline = await readProjectBaseline(workspaceRoot);
  if (!baseline) {
    await checkReferenceDrift(workspaceRoot);
    return;
  }
  await assertProjectBaseline(workspaceRoot, baseline);
}
