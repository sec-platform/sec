import { assertProjectBaseline, readProjectBaseline } from './project-baseline.ts';
import { checkProvenanceFallback } from './project-integrity.ts';

export async function checkProjectWriteBoundary(workspaceRoot: string): Promise<void> {
  const baseline = await readProjectBaseline(workspaceRoot);
  if (!baseline) {
    await checkProvenanceFallback(workspaceRoot);
    return;
  }
  await assertProjectBaseline(workspaceRoot, baseline);
}
