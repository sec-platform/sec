import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { decodeExactUtf8 } from '../runtime-state/physical/runtime/retained-file-read.ts';
import { parseYamlValue, type YamlValueAdmission } from '../formats/yaml.ts';
import { writeText } from "../filesystem/files.ts";
import { type CommitFence } from "../../contracts/commit-fence.ts";

// Generic file-read defaults, not an authority grant or a shared limit for
// every domain. Callers with a domain contract pass that owner's limits.
export const WORKSPACE_YAML_MAX_INPUT_BYTES = 1024 * 1024;
export const WORKSPACE_YAML_MAX_ALIAS_COUNT = 100;
export type WorkspaceYamlReadOptions = Partial<Omit<YamlValueAdmission, 'label'>>;

/** Ordinary async file reading with one shared YAML parser. T describes the
 * caller's expected type only; the domain must still decode its actual schema.
 * This is not retained/no-follow IO, and the parser limit is post-read.
 */
export async function readYaml<T = unknown>(
  filePath: string,
  options: WorkspaceYamlReadOptions = {}
): Promise<T> {
  const absolutePath = path.resolve(filePath);
  const { maximumInputBytes, maximumAliasCount, stringKeys } = options;
  const admission = Object.freeze({ label: `Workspace YAML ${absolutePath}`,
    maximumInputBytes: maximumInputBytes === undefined ? WORKSPACE_YAML_MAX_INPUT_BYTES : maximumInputBytes,
    maximumAliasCount: maximumAliasCount === undefined ? WORKSPACE_YAML_MAX_ALIAS_COUNT : maximumAliasCount,
    stringKeys });
  const bytes = await fs.readFile(absolutePath);
  return parseYamlValue(decodeExactUtf8(bytes, admission.label), admission) as T;
}

export async function writeYaml(
  filePath: string,
  value: unknown,
  commitFence?: CommitFence
): Promise<void> {
  // The serializer can invoke caller conversion hooks. Resolve the intended
  // target before them, not only when the resulting text reaches writeText.
  const absolutePath = path.resolve(filePath);
  if (commitFence !== undefined && typeof commitFence !== 'function') {
    throw new TypeError('Workspace YAML commit fence must be callable');
  }
  const raw = YAML.stringify(value, { indent: 2 });
  if (typeof raw !== 'string') throw new TypeError('Workspace YAML serialization must produce text');
  await writeText(absolutePath, raw, commitFence);
}
