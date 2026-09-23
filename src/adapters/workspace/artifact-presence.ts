import path from 'node:path';
import { pathExists } from '../filesystem/files.ts';
import { resolveWorkspaceArtifactPath } from '../workspace-context.ts';

/** Existence observations only: not content validation, authority, or an atomic
 * snapshot. Bind and validate every locator before the first filesystem read. */
export async function findPresentWorkspaceArtifacts(
  workspaceRoot: string,
  artifactPaths: readonly string[]
): Promise<ReadonlySet<string>> {
  const root = path.resolve(workspaceRoot);
  const candidates = [...new Set(artifactPaths)].map(artifactPath => ({
    artifactPath,
    absolutePath: resolveWorkspaceArtifactPath(root, artifactPath)
  }));
  const observations = await Promise.all(candidates.map(async candidate => ({
    artifactPath: candidate.artifactPath,
    exists: await pathExists(candidate.absolutePath)
  })));
  return new Set(observations.filter(value => value.exists).map(value => value.artifactPath));
}
