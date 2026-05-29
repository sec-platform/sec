import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { CompilerError } from '../../shared/errors.ts';
import { getWorkspacePaths } from '../../shared/paths.ts';
import { pathExists, readJson } from '../../shared/fs.ts';
import type { ProvenanceFile } from '../../shared/provenance-types.ts';

async function calculateFileHash(absolutePath: string): Promise<string | undefined> {
  try {
    const content = await fs.readFile(absolutePath);
    return createHash('sha256').update(content).digest('hex');
  } catch {
    return undefined;
  }
}

export async function checkReferenceDrift(workspaceRoot: string): Promise<void> {
  const { projectRoot, provenancePath } = getWorkspacePaths(workspaceRoot);

  if (!(await pathExists(provenancePath))) {
    return;
  }

  const provenance = await readJson<ProvenanceFile>(provenancePath);

  for (const artifact of provenance.artifacts) {
    // Check if it is in the read-only zone of the project:
    // resides in project/ (doesn't start with source/ or control/) and is NOT slot
    // We exclude environment declaration files and TS configs dynamically updated by the builder.
    const isReadOnlyZone =
      !artifact.path.startsWith('source/') &&
      !artifact.path.startsWith('control/') &&
      artifact.originType !== 'slot' &&
      artifact.path !== 'next-env.d.ts' &&
      artifact.path !== 'tsconfig.json';

    if (isReadOnlyZone) {
      const absPath = path.join(projectRoot, artifact.path);
      const exists = await pathExists(absPath);
      if (!exists) {
        throw new CompilerError(
          'ERROR-DRIFT-001',
          `Reference drift detected: Read-only project file is missing: ${artifact.path}`
        );
      }

      if (artifact.hash) {
        const currentHash = await calculateFileHash(absPath);
        if (currentHash !== artifact.hash) {
          throw new CompilerError(
            'ERROR-DRIFT-001',
            `Reference drift detected: Read-only project file modified: ${artifact.path}`
          );
        }
      }
    }
  }
}
