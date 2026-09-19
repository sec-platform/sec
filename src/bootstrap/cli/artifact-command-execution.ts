import type { CiArtifactManifest } from '../../assurance/verification/ci-artifacts/contract/types.ts';
import type { ArtifactCommandInput } from '../../entry/cli/artifact-command-input.ts';
import { executeArtifactCommandInput } from '../../entry/cli/artifact-command-execution.ts';
import { observeWorkspaceArtifacts, writeWorkspaceArtifacts } from './lazy-command-domains.ts';

/** Bootstrap supplies artifact data sources; Entry owns operation routing and presentation. */
export async function executeArtifactCommand(
  workspaceRoot: string,
  commandPath: string,
  input: ArtifactCommandInput
): Promise<void> {
  return executeArtifactCommandInput(input, {
    manifest: async () => {
      const { CI_ARTIFACT_FILES } = await import('../../assurance/verification/ci-artifacts/contract/manifest.ts');
      const { resolveWorkspaceArtifactPath } = await import('../../adapters/workspace-context.ts');
      const { readRequiredJson } = await import('../../adapters/workspace/required-artifact-read.ts');
      const { projectCiArtifactManifest } = await import('../../application/ci-artifact-manifest-inspect.ts');
      const { formatCiArtifactManifest } = await import('../../entry/cli/ci-artifact-manifest-inspect.ts');
      const value = await readRequiredJson<CiArtifactManifest>(
        resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.artifactManifest),
        `Artifact manifest not found; run ${commandPath} --json first`
      );
      return {
        value,
        text: formatCiArtifactManifest(projectCiArtifactManifest(value))
      };
    },
    paths: async filter => {
      const { buildArtifactUploadPathContract } = await import('../../application/artifact-upload-paths.ts');
      const { formatArtifactUploadPaths } = await import('../../entry/cli/artifact-upload-paths.ts');
      const manifest = await observeWorkspaceArtifacts(workspaceRoot);
      const value = buildArtifactUploadPathContract(manifest, filter);
      return { value, text: formatArtifactUploadPaths(value) };
    },
    generate: async () => {
      const { manifest } = await writeWorkspaceArtifacts(workspaceRoot);
      return manifest;
    }
  });
}
