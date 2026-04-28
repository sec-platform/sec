import path from 'node:path';
import { CompilerError } from '../../shared/errors.ts';
import { pathExists, readText, writeText } from '../../shared/fs.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import { loadOverrideManifest } from '../parse/load-override-manifest.ts';
import type { OverrideApplyPhase } from '../../shared/provenance-types.ts';

export async function applyOverrides(workspaceRoot: string, phase: OverrideApplyPhase): Promise<void> {
  const { projectRoot } = getWorkspacePaths(workspaceRoot);
  const manifest = await loadOverrideManifest(workspaceRoot);

  for (const entry of manifest.overrides.filter((override) => override.appliesAfter.includes(phase))) {
    const sourcePath = path.join(projectRoot, 'overrides', entry.entry);
    const targetPath = path.join(projectRoot, entry.target);

    if (!(await pathExists(sourcePath))) {
      throw new CompilerError(
        'OVERRIDE-APPLY-001',
        `Override "${entry.id}" source "${entry.entry}" is missing`
      );
    }

    const content = await readText(sourcePath);
    await writeText(targetPath, content);
  }
}
