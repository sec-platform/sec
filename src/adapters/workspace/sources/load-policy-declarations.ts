import path from 'node:path';

import { parseYamlValue } from '../../formats/yaml.ts';
import {
  buildLoadedPolicyScope,
  decodePolicySpec,
  mergeLoadedPolicyDeclarations,
  type LoadedPolicyDeclarations,
  type LoadedPolicyScope,
  type LoadedPolicySource
} from '../../../semantics/policies/declarations.ts';

import { inspectExactNoFollowDirectoryPresence, scanNoFollowDirectoryTreeMetadata } from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { decodeExactUtf8, readOptionalRetainedOrdinaryFile } from '../../runtime-state/physical/runtime/retained-file-read.ts';
import { compareCodeUnits } from '../../../contracts/canonical.ts';
import { compilerRuntimeResources } from '../../toolchain/runtime/layout.ts';
import { getWorkspacePaths, officialPoliciesRelativePath, policiesRelativePath } from "../../workspace-context.ts";
import { posixPath, relativePosixPath } from '../../../contracts/relative-path.ts';
import type { PolicySourceScope, PolicySpec } from '../../../semantics/policies/types.ts';

export const POLICY_SOURCE_INVENTORY_MAX_ENTRIES = 4096;
export const POLICY_SOURCE_INVENTORY_TIMEOUT_MS = 5000;
// Parsing admission is independent of the directory inventory capacity and
// does not bound bytes already allocated by the retained reader.
export const POLICY_YAML_MAX_INPUT_BYTES = 1024 * 1024;
export const POLICY_YAML_MAX_ALIAS_COUNT = 100;

function withinScopePath(
  scope: PolicySourceScope,
  rootPath: string,
  filePath: string,
  sourcePrefix?: string
): string {
  const relativePath = relativePosixPath(rootPath, filePath);
  return scope === 'official'
    ? `${posixPath(officialPoliciesRelativePath)}/${relativePath}`
    : `${sourcePrefix ?? posixPath(policiesRelativePath)}/${relativePath}`;
}

function isPolicySpecPath(filePath: string): boolean {
  const normalized = filePath.toLowerCase();
  return normalized.endsWith('.yaml') || normalized.endsWith('.yml');
}

function inventoryPolicyFiles(rootPath: string): string[] {
  const presence = inspectExactNoFollowDirectoryPresence(rootPath, 'Policy source root');
  if (presence.state === 'absent') return [];

  const entries = scanNoFollowDirectoryTreeMetadata(presence.directory.target, {
    deadlineAtMs: performance.now() + POLICY_SOURCE_INVENTORY_TIMEOUT_MS,
    maximumEntries: POLICY_SOURCE_INVENTORY_MAX_ENTRIES
  });
  const linked = entries.find((entry) => entry.kind === 'link');
  if (linked) {
    throw new Error(`Policy source inventory contains an unsupported link/reparse entry: ${linked.relativePath}`);
  }

  return entries
    .filter((entry) => entry.kind === 'file' && isPolicySpecPath(entry.relativePath))
    .map((entry) => path.join(rootPath, ...entry.relativePath.split('/')))
    .sort((left, right) => compareCodeUnits(posixPath(left), posixPath(right)));
}

function readPolicySpec(filePath: string, normalizedPath: string): PolicySpec {
  const bytes = readOptionalRetainedOrdinaryFile(filePath, `Policy source ${normalizedPath}`);
  if (bytes === null) {
    throw new Error(`Policy source disappeared after inventory: ${normalizedPath}`);
  }
  const source = decodeExactUtf8(bytes, `Policy source ${normalizedPath}`);
  let parsed: unknown;
  try {
    parsed = parseYamlValue(source, { label: `Policy source ${normalizedPath}`,
      maximumInputBytes: POLICY_YAML_MAX_INPUT_BYTES,
      maximumAliasCount: POLICY_YAML_MAX_ALIAS_COUNT, stringKeys: true });
  } catch (error) {
    throw new Error(`Policy source is not valid YAML: ${normalizedPath}`, { cause: error });
  }
  return decodePolicySpec(parsed, normalizedPath);
}

function loadPolicyScope(
  scope: PolicySourceScope,
  rootPath: string,
  sourcePrefix?: string
): LoadedPolicyScope {
  const sources: LoadedPolicySource[] = inventoryPolicyFiles(rootPath)
    .map(filePath => ({
      absolutePath: filePath,
      sourcePath: withinScopePath(scope, rootPath, filePath, sourcePrefix)
    }))
    .sort((left, right) => compareCodeUnits(left.sourcePath, right.sourcePath))
    .map(file => ({
      sourcePath: file.sourcePath,
      spec: readPolicySpec(file.absolutePath, file.sourcePath)
    }));
  return buildLoadedPolicyScope(scope, sources);
}

/** Retained Policy source observation is synchronous; callers must not fake I/O fanout with Promise wrappers. */
export function loadPolicyDeclarations(workspaceRoot: string): LoadedPolicyDeclarations {
  const paths = getWorkspacePaths(workspaceRoot);
  const official = loadPolicyScope('official', compilerRuntimeResources.officialPolicies);
  const project = loadPolicyScope('project', paths.policiesRoot, posixPath(policiesRelativePath));
  return mergeLoadedPolicyDeclarations(official, project);
}
