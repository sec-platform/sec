import type { CiArtifactManifest } from '../../assurance/verification/ci-artifacts/contract/types.ts';
import type { ArtifactCommandInput } from '../../entry/cli/artifact-command-input.ts';
import { executeArtifactCommandInput } from '../../entry/cli/artifact-command-execution.ts';
import { observeWorkspaceArtifacts, writeWorkspaceArtifacts } from './lazy-command-domains.ts';

/** Bootstrap supplies artifact data sources; Entry owns routing, projection and presentation. */
export async function executeArtifactCommand(
  workspaceRoot: string,
  commandPath: string,
  input: ArtifactCommandInput
): Promise<void> {
  return executeArtifactCommandInput(input, {
    readManifest: async () => {
      const { CI_ARTIFACT_FILES } = await import('../../assurance/verification/ci-artifacts/contract/manifest.ts');
      const { resolveWorkspaceArtifactPath } = await import('../../adapters/workspace-context.ts');
      const { readRequiredJson } = await import('../../adapters/workspace/required-artifact-read.ts');
      return readRequiredJson<CiArtifactManifest>(
        resolveWorkspaceArtifactPath(workspaceRoot, CI_ARTIFACT_FILES.artifactManifest),
        `Artifact manifest not found; run ${commandPath} --json first`
      );
    },
    observeManifest: () => observeWorkspaceArtifacts(workspaceRoot),
    generate: async () => {
      const { manifest } = await writeWorkspaceArtifacts(workspaceRoot);
      return manifest;
    }
  });
}
