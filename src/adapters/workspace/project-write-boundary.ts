import { assertProjectBaseline, readProjectBaseline } from './project-baseline.ts';
import { checkProvenanceFallback } from './project-integrity.ts';
import {
  currentProjectWriteAuthorization,
  projectProjectWriteAuthorization
} from './project-write-authorization.ts';

function activeProjectWriteImpactPaths(workspaceRoot: string): readonly string[] {
  const authorization = currentProjectWriteAuthorization();
  return authorization === null
    ? []
    : projectProjectWriteAuthorization(workspaceRoot, authorization).impactPaths;
}

export async function checkProjectWriteBoundary(workspaceRoot: string): Promise<void> {
  const baseline = readProjectBaseline(workspaceRoot);
  if (!baseline) {
    await checkProvenanceFallback(workspaceRoot);
    return;
  }
  assertProjectBaseline(workspaceRoot, baseline, {
    allowedChangedPaths: activeProjectWriteImpactPaths(workspaceRoot)
  });
}
