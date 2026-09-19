import type { CiArtifactManifest } from '../../assurance/verification/ci-artifacts/contract/types.ts';
import { buildArtifactUploadPathContract } from '../../application/artifact-upload-paths.ts';
import { projectCiArtifactManifest } from '../../application/ci-artifact-manifest-inspect.ts';
import type { ArtifactCommandInput } from './artifact-command-input.ts';
import { formatArtifactUploadPaths } from './artifact-upload-paths.ts';
import { formatCiArtifactManifest } from './ci-artifact-manifest-inspect.ts';
import { printJson, printJsonOrText } from './format-utils.ts';

export interface ArtifactCommandOperations {
  readManifest(): Promise<CiArtifactManifest>;
  observeManifest(): Promise<CiArtifactManifest>;
  generate(): Promise<CiArtifactManifest>;
}

/** Entry owns artifact sub-operation routing, projection and output protocol. */
export async function executeArtifactCommandInput(
  input: ArtifactCommandInput,
  operations: ArtifactCommandOperations
): Promise<void> {
  if (typeof operations.readManifest !== 'function' ||
      typeof operations.observeManifest !== 'function' ||
      typeof operations.generate !== 'function') {
    throw new TypeError('Artifact command operations must be callable');
  }

  switch (input.kind) {
    case 'manifest': {
      const manifest = await operations.readManifest.call(operations);
      printJsonOrText(
        manifest,
        input.output,
        value => formatCiArtifactManifest(projectCiArtifactManifest(value))
      );
      return;
    }
    case 'paths': {
      const manifest = await operations.observeManifest.call(operations);
      const contract = buildArtifactUploadPathContract(manifest, input.filter);
      printJsonOrText(contract, input.output, formatArtifactUploadPaths);
      return;
    }
    case 'generate': {
      const manifest = await operations.generate.call(operations);
      // Generation is a machine-readable manifest even without --json.
      printJson(manifest, input.output);
      return;
    }
    default: {
      const unreachable: never = input;
      throw new TypeError(`Unsupported artifact command input: ${typeof unreachable}`);
    }
  }
}
