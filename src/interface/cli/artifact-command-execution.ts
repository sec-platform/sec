import type { CiArtifactManifest } from '../../verification/ci-artifacts/contract/types.ts';
import type { ArtifactCommandInput } from './artifact-command-input.ts';
import { formatJson, printJsonOrText } from './format-utils.ts';
import { observeWorkspaceArtifacts, writeWorkspaceArtifacts } from './lazy-command-domains.ts';

/** A route owns exactly one artifact operation; no raw options or live Command crosses it. */
export async function executeArtifactCommand(workspaceRoot: string, commandPath: string, input: ArtifactCommandInput): Promise<void> {
  switch (input.kind) {
    case 'manifest': {
      const { CI_ARTIFACT_FILES } = await import('../../verification/ci-artifacts/contract/manifest.ts');
      const { resolveWorkspaceArtifactPath } = await import('../../workspace/runtime/paths.ts');
      const { printWorkspaceJson } = await import('./artifact-command-read.ts');
      const { formatCiArtifactManifest } = await import('./formatters.ts');
      await printWorkspaceJson<CiArtifactManifest>(workspaceRoot,
        (root) => resolveWorkspaceArtifactPath(root, CI_ARTIFACT_FILES.artifactManifest),
        `Artifact manifest not found; run ${commandPath} --json first`, input.output, formatCiArtifactManifest);
      return;
    }
    case 'paths': {
      const { buildArtifactUploadPathContract } = await import('./formatters.ts');
      const manifest = await observeWorkspaceArtifacts(workspaceRoot);
      const contract = buildArtifactUploadPathContract(manifest, input.filter);
      printJsonOrText(contract, input.output, (value) => value.paths.join('\n'));
      return;
    }
    case 'generate': {
      const { manifest } = await writeWorkspaceArtifacts(workspaceRoot);
      // Generation has always returned a JSON manifest, even without --json.
      console.log(formatJson(manifest, input.output));
      return;
    }
    default: {
      const unreachable: never = input;
      throw new TypeError(`Unsupported artifact command input: ${typeof unreachable}`);
    }
  }
}
