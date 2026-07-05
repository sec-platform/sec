import { CompilerError } from './errors.ts';
import { pathExists, readJson } from './fs.ts';
import { getWorkspacePaths, posixPath, resolvePathInside } from './paths.ts';
import { assertProjectBaseline, readProjectBaseline } from './project-baseline.ts';
import { calculateProjectFileHash } from './project-file-hash.ts';
import { listTrackedProjectPaths } from './project-tracked-files.ts';
import type { ProvenanceFile } from './provenance-types.ts';

async function verifyPreviousProvenance(
  workspaceRoot: string,
  options: { strictMissing: boolean }
): Promise<boolean> {
  const { projectRoot, provenancePath } = getWorkspacePaths(workspaceRoot);
  if (!(await pathExists(provenancePath))) return false;

  const provenance = await readJson<ProvenanceFile>(provenancePath);
  const trackedProjectPaths = options.strictMissing ? null : await listTrackedProjectPaths(workspaceRoot);
  for (const artifact of provenance.artifacts) {
    const artifactPath = posixPath(artifact.path);
    const protectedArtifact =
      !artifactPath.startsWith('source/') &&
      !artifactPath.startsWith('control/') &&
      !artifactPath.startsWith('.sec/') &&
      artifact.originType !== 'slot' &&
      artifactPath !== 'next-env.d.ts' &&
      artifactPath !== 'tsconfig.json';
    if (!protectedArtifact) continue;

    const absolutePath = resolvePathInside(projectRoot, artifactPath);
    if (!absolutePath || !(await pathExists(absolutePath))) {
      const missingIsDrift = options.strictMissing || trackedProjectPaths?.has(artifactPath) === true;
      if (missingIsDrift) {
        throw new CompilerError(
          'ERROR-DRIFT-001',
          `Reference drift detected: Read-only project file is missing: ${artifactPath}`
        );
      }
      continue;
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

export async function checkProjectBeforeCompile(workspaceRoot: string): Promise<void> {
  const baseline = await readProjectBaseline(workspaceRoot);
  if (baseline) {
    await assertProjectBaseline(workspaceRoot, baseline);
    return;
  }
  await verifyPreviousProvenance(workspaceRoot, { strictMissing: false });
}

export async function checkProjectBeforeVerify(workspaceRoot: string): Promise<void> {
  const baseline = await readProjectBaseline(workspaceRoot);
  if (baseline) {
    await assertProjectBaseline(workspaceRoot, baseline);
    return;
  }
  await verifyPreviousProvenance(workspaceRoot, { strictMissing: false });
}

export async function checkReferenceDrift(workspaceRoot: string): Promise<void> {
  await verifyPreviousProvenance(workspaceRoot, { strictMissing: true });
}

export async function checkProvenanceFallback(workspaceRoot: string): Promise<void> {
  await verifyPreviousProvenance(workspaceRoot, { strictMissing: false });
}
