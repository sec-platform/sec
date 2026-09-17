import { admitArtifactKind } from '../../application/artifact-request.ts';
import { decodeBooleanFlag } from './boolean-option.ts';
import { jsonOpts, usageError } from './command-options.ts';
import { captureCliOptions } from './own-options.ts';

export const ARTIFACT_PATHS_OPTION = Object.freeze({
  name: 'paths', flags: '--paths', description: 'List artifact paths', defaultValue: false
} as const);
export const ARTIFACT_KIND_OPTION = Object.freeze({
  name: 'kind', flags: '--kind <kind>', description: 'Filter by artifact kind'
} as const);


/** Inspection, read-only upload selection and manifest generation are distinct operations. */
export function parseArtifactCommandInput(mode: unknown, options: Readonly<Record<string, unknown>>) {
  const output = jsonOpts(options);
  if (mode === 'manifest') return Object.freeze({ kind: 'manifest' as const, output });
  if (mode !== undefined) throw usageError('Unsupported artifact mode');
  const paths = decodeBooleanFlag(captureCliOptions(options, [{ name: ARTIFACT_PATHS_OPTION.name, scope: 'own-enumerable' }])[ARTIFACT_PATHS_OPTION.name], ARTIFACT_PATHS_OPTION.defaultValue,
    () => { throw usageError(`${ARTIFACT_PATHS_OPTION.flags} must be a boolean flag`); });
  // A filter has no effect on generation. Preserve that behavior without reading it.
  if (!paths) return Object.freeze({ kind: 'generate' as const, output });
  const filter = captureCliOptions(options, [{ name: ARTIFACT_KIND_OPTION.name, scope: 'own-enumerable' }])[ARTIFACT_KIND_OPTION.name];
  const admission = admitArtifactKind(filter);
  if (!admission.accepted) {
    throw usageError(`--kind must be one of: ${admission.choices.join(', ')}`);
  }
  return Object.freeze({ kind: 'paths' as const, output, filter: admission.kind });
}
export type ArtifactCommandInput = ReturnType<typeof parseArtifactCommandInput>;
