import { assertCompositionBaseline, readCompositionBaseline } from './composition-baseline.ts';
import { CompilerError } from './errors.ts';
import { pathExists, readJson } from './fs.ts';
import { getWorkspacePaths, posixPath, resolvePathInside } from './paths.ts';
import { calculateProjectFileHash } from './project-file-hash.ts';
import type { ProvenanceFile } from './provenance-types.ts';

async function assertReferenceProvenance(workspaceRoot: string): Promise<boolean> {
  const { projectRoot, provenancePath } = getWorkspacePaths(workspaceRoot);
  if (!(await pathExists(provenancePath))) return false;

  const provenance = await readJson<ProvenanceFile>(provenancePath);
  for (const artifact of provenance.artifacts) {
    const artifactPath = posixPath(artifact.path);
    const isReadOnly =
      !artifactPath.startsWith('source/') &&
      !artifactPath.startsWith('control/') &&
      !artifactPath.startsWith('.sec/') &&
      artifact.originType !== 'slot' &&
      artifactPath !== 'next-env.d.ts' &&
      artifactPath !== 'tsconfig.json';
    if (!isReadOnly) continue;

    const absolutePath = resolvePathInside(projectRoot, artifactPath);
    if (!absolutePath || !(await pathExists(absolutePath))) {
      throw new CompilerError(
        'ERROR-DRIFT-001',
        `Reference drift detected: Read-only project file is missing: ${artifactPath}`
      );
    }
    if (artifact.hash) {
      const currentHash = await calculateProjectFileHash(absolutePath);
      if (currentHash !== artifact.hash) {
        throw new CompilerError(
          'ERROR-DRIFT-001',
          `Reference drift detected: Read-only project file modified: ${artifactPath}`
        );
      }
    }
  }
  return true;
}

export async function checkProjectDriftBeforeCompose(workspaceRoot: string): Promise<void> {
  if (await assertReferenceProvenance(workspaceRoot)) return;
  const baseline = await readCompositionBaseline(workspaceRoot);
  if (baseline) await assertCompositionBaseline(workspaceRoot, baseline);
}

export async function checkComposedProjectDrift(workspaceRoot: string): Promise<void> {
  const baseline = await readCompositionBaseline(workspaceRoot);
  if (baseline) {
    await assertCompositionBaseline(workspaceRoot, baseline);
    return;
  }
  await assertReferenceProvenance(workspaceRoot);
}

export async function checkReferenceDrift(workspaceRoot: string): Promise<void> {
  await assertReferenceProvenance(workspaceRoot);
}
