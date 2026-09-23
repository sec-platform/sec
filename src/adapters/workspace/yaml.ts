import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { type CommitFence } from "../../contracts/commit-fence.ts";
import { writeText } from "../filesystem/files.ts";
import {
  parseYamlValue,
  YamlInputLimitError,
  type YamlValueAdmission
} from '../formats/yaml.ts';
import {
  decodeExactUtf8,
  readOptionalRetainedOrdinaryLeaf,
  retainOptionalDirectory
} from '../runtime-state/physical/runtime/retained-file-read.ts';

// Generic file-read defaults, not an authority grant or a shared limit for
// every domain. Callers with a domain contract pass that owner's limits.
export const WORKSPACE_YAML_MAX_INPUT_BYTES = 1024 * 1024;
const WORKSPACE_YAML_MAX_ALIAS_COUNT = 100;
export type WorkspaceYamlReadOptions = Partial<Omit<YamlValueAdmission, 'label'>>;

/** Bounded retained file reading with one shared YAML parser. T describes the
 * caller's expected type only; the domain must still decode its actual schema.
 * The lexical lstat below is only an early allocation guard. Physical identity,
 * no-follow admission and the authoritative byte ceiling belong to the retained
 * leaf read that follows it.
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
  if (!Number.isSafeInteger(admission.maximumInputBytes) || admission.maximumInputBytes <= 0) {
    throw new TypeError('YAML input admission maximumInputBytes must be one positive safe integer');
  }

  // Reject a stable oversized file before allocating its contents. This
  // observation is not trusted for identity: a later substitution still meets
  // the retained no-follow read and the same byte ceiling below.
  const early = await fs.lstat(absolutePath);
  if (early.size > admission.maximumInputBytes) {
    throw new YamlInputLimitError(
      admission.label,
      early.size,
      admission.maximumInputBytes
    );
  }

  const parent = retainOptionalDirectory(
    path.dirname(absolutePath),
    `${admission.label} parent`
  );
  const bytes = parent === null
    ? null
    : readOptionalRetainedOrdinaryLeaf(
        parent,
        path.basename(absolutePath),
        { maximumBytes: admission.maximumInputBytes }
      );
  if (bytes === null) {
    const error = new Error(
      `ENOENT: no such file or directory, open '${absolutePath}'`
    ) as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    error.path = absolutePath;
    error.syscall = 'open';
    throw error;
  }
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
