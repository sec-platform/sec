import path from 'node:path';

import { validateOverrideManifest } from '../../../compiler/contract/override-validation.ts';
import { failureMessage } from '../../../contracts/failure-inspection.ts';
import { parseYamlValue } from '../../formats/yaml.ts';

import { decodeExactUtf8, readOptionalRetainedOrdinaryFile } from '../../runtime-state/physical/runtime/retained-file-read.ts';
import type { OverrideManifest } from '../../../semantics/provenance/types.ts';
import { getWorkspacePaths } from "../../workspace-context.ts";
import { CompilerError } from '../../../compiler/errors.ts';

export const OVERRIDE_YAML_MAX_INPUT_BYTES = 1024 * 1024;
export const OVERRIDE_YAML_MAX_ALIAS_COUNT = 100;

export async function resolveOverrideManifestPath(workspaceRoot: string): Promise<string> {
  return path.join(getWorkspacePaths(workspaceRoot).overridesRoot, 'override-manifest.yaml');
}

function parseOverrideManifest(source: string, filePath: string): OverrideManifest {
  let raw: unknown;
  try {
    raw = parseYamlValue(source, { label: `Override manifest ${filePath}`,
      maximumInputBytes: OVERRIDE_YAML_MAX_INPUT_BYTES,
      stringKeys: true, maximumAliasCount: OVERRIDE_YAML_MAX_ALIAS_COUNT });
  } catch (error) {
    throw new CompilerError('OVERRIDE-SCHEMA-001', `Override manifest is not valid YAML: ${filePath}`,
      { cause: failureMessage(error) }, { cause: error });
  }
  // Preserve empty YAML's existing empty-manifest interpretation. Runtime
  // schema validation still precedes cross-record/path/ownership decisions.
  return validateOverrideManifest(raw ?? {});
}

export async function loadOverrideManifest(workspaceRoot: string): Promise<OverrideManifest> {
  const overrideManifestPath = await resolveOverrideManifestPath(workspaceRoot);
  const bytes = readOptionalRetainedOrdinaryFile(
    overrideManifestPath,
    'Override manifest'
  );
  if (bytes === null) return { overrides: [] };
  const source = decodeExactUtf8(bytes, 'Override manifest');
  return parseOverrideManifest(source, overrideManifestPath);
}
