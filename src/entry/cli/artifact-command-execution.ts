import type { ArtifactCommandInput } from './artifact-command-input.ts';
import { printJson, printJsonOrText } from './format-utils.ts';

export type ArtifactCommandProjection = Readonly<{
  value: unknown;
  text: string;
}>;

export interface ArtifactCommandOperations {
  manifest(): Promise<ArtifactCommandProjection>;
  paths(filter: Extract<ArtifactCommandInput, { kind: 'paths' }>['filter']): Promise<ArtifactCommandProjection>;
  generate(): Promise<unknown>;
}

/** Entry owns artifact sub-operation routing and its stable output protocol. */
export async function executeArtifactCommandInput(
  input: ArtifactCommandInput,
  operations: ArtifactCommandOperations
): Promise<void> {
  if (typeof operations.manifest !== 'function' ||
      typeof operations.paths !== 'function' ||
      typeof operations.generate !== 'function') {
    throw new TypeError('Artifact command operations must be callable');
  }

  switch (input.kind) {
    case 'manifest': {
      const result = await operations.manifest.call(operations);
      printJsonOrText(result.value, input.output, () => result.text);
      return;
    }
    case 'paths': {
      const result = await operations.paths.call(operations, input.filter);
      printJsonOrText(result.value, input.output, () => result.text);
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
