import path from 'node:path';

import { parseYamlValue } from '../../formats/yaml.ts';
import { PolicySpecSchema } from '../../../semantics/policies/source-schema.ts';

import { inspectExactNoFollowDirectoryPresence, scanNoFollowDirectoryTreeMetadata } from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { decodeExactUtf8, readOptionalRetainedOrdinaryFile } from '../../runtime-state/physical/runtime/retained-file-read.ts';
import { compareCodeUnits, uniqueSorted } from '../../../contracts/canonical.ts';
import { compilerRuntimeResources } from '../../toolchain/runtime/layout.ts';
import { getWorkspacePaths, officialPoliciesRelativePath, policiesRelativePath } from "../../workspace-context.ts";
import { posixPath, relativePosixPath } from '../../../contracts/relative-path.ts';
import type { PolicyRule, PolicySourceFileReport, PolicySourceScope, PolicySpec } from '../../../semantics/policies/types.ts';

export interface LoadedPolicyDefinition {
  policy: PolicyRule;
  sourceScope: PolicySourceScope;
  sourcePath: string;
}

export interface LoadedPolicyScope {
  policies: string[];
  sources: PolicySourceFileReport[];
  definitions: LoadedPolicyDefinition[];
}

export interface LoadedPolicyDeclarations {
  official: LoadedPolicyScope;
  project: LoadedPolicyScope;
  definitions: ReadonlyMap<string, LoadedPolicyDefinition>;
  policies: PolicyRule[];
  policyIds: string[];
}

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
  const result = PolicySpecSchema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Policy source violates the exact schema: ${normalizedPath}: ${details}`, { cause: result.error });
  }

  return {
    // Zod already owns the decoded objects and arrays. Only same-source
    // duplicate coalescing remains here; do not copy each field a second time.
    policies: [...new Map(result.data.policies.map((policy) => [policy.id, policy])).values()]
  };
}

function loadPolicyScope(
  scope: PolicySourceScope,
  rootPath: string,
  sourcePrefix?: string
): LoadedPolicyScope {
  const files = inventoryPolicyFiles(rootPath)
    .map((filePath) => ({
      absolutePath: filePath,
      normalizedPath: withinScopePath(scope, rootPath, filePath, sourcePrefix)
    }))
    .sort((left, right) => compareCodeUnits(left.normalizedPath, right.normalizedPath));

  const declaredPolicyIds = new Set<string>();
  const sources: PolicySourceFileReport[] = [];
  const definitions: LoadedPolicyDefinition[] = [];

  for (const file of files) {
    const spec = readPolicySpec(file.absolutePath, file.normalizedPath);
    const policyIds = uniqueSorted(spec.policies.map((policy) => policy.id));

    for (const policy of spec.policies) {
      declaredPolicyIds.add(policy.id);
      definitions.push({ policy, sourceScope: scope, sourcePath: file.normalizedPath });
    }

    sources.push({ path: file.normalizedPath, policyIds });
  }

  return {
    policies: uniqueSorted([...declaredPolicyIds]),
    sources,
    definitions
  };
}

function mergePolicies(
  official: LoadedPolicyScope,
  project: LoadedPolicyScope
): Map<string, LoadedPolicyDefinition> {
  const merged = new Map<string, LoadedPolicyDefinition>();
  for (const definition of [...official.definitions, ...project.definitions]) {
    merged.set(definition.policy.id, definition);
  }
  return merged;
}

/** Retained Policy source observation is synchronous; callers must not fake I/O fanout with Promise wrappers. */
export function loadPolicyDeclarations(workspaceRoot: string): LoadedPolicyDeclarations {
  const paths = getWorkspacePaths(workspaceRoot);
  const official = loadPolicyScope('official', compilerRuntimeResources.officialPolicies);
  const project = loadPolicyScope('project', paths.policiesRoot, posixPath(policiesRelativePath));
  const definitions = mergePolicies(official, project);
  const policies = [...definitions.values()]
    .map((definition) => definition.policy)
    .sort((left, right) => compareCodeUnits(left.id, right.id));

  return {
    official,
    project,
    definitions,
    policies,
    policyIds: policies.map((policy) => policy.id)
  };
}
