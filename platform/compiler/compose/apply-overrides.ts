import path from 'node:path';
import { CompilerError } from '../../shared/errors.ts';
import { pathExists, readText, writeText, type CommitFence } from '../../shared/fs.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import type { OverrideApplyPhase } from '../../shared/provenance-types.ts';
import { loadOverrideManifest, resolveOverrideManifestPath } from '../parse/load-override-manifest.ts';

export async function applyOverrides(
  workspaceRoot: string,
  phase: OverrideApplyPhase,
  commitFence?: CommitFence
): Promise<void> {
  const { projectRoot } = getWorkspacePaths(workspaceRoot);
  const manifest = await loadOverrideManifest(workspaceRoot);
  const overrideManifestPath = await resolveOverrideManifestPath(workspaceRoot);
  const overrideRoot = path.dirname(overrideManifestPath);

  for (const entry of manifest.overrides.filter((override) => override.appliesAfter.includes(phase))) {
    const sourcePath = path.join(overrideRoot, entry.entry);
    const targetPath = path.join(projectRoot, entry.target);

    if (!(await pathExists(sourcePath))) {
      throw new CompilerError(
        'OVERRIDE-APPLY-001',
        `Override "${entry.id}" source "${entry.entry}" is missing`
      );
    }

    const content = await readText(sourcePath);
    await writeText(targetPath, content, commitFence);
  }
}
