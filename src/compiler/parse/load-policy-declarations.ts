import path from 'node:path';

import YAML from 'yaml';
import { z } from 'zod';

import { isCanonicalBlockId } from '../../semantic/identity/contract/block.ts';
import { canonicalEquals } from '../../system-architecture/foundation/runtime/canonical.ts';
import { uniqueSorted } from '../../system-architecture/foundation/runtime/canonical.ts';
import { getWorkspacePaths, officialPoliciesRelativePath, posixPath, relativePosixPath } from '../../workspace/paths.ts';
import { inspectExactNoFollowDirectoryPresence, scanNoFollowDirectoryTreeMetadata } from '../../runtime-state/physical/runtime/physical-no-follow.ts';
import { isCanonicalPolicyId } from '../policies/contract/identity.ts';
import type { PolicyRule, PolicySourceFileReport, PolicySourceScope, PolicySpec } from '../policies/contract/types.ts';
import { decodeExactUtf8, readOptionalRetainedOrdinaryFile } from '../../runtime-state/physical/runtime/retained-file-read.ts';
import { compareCodeUnits } from '../../system-architecture/foundation/runtime/canonical.ts';

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
const POLICY_RULE = 'tenant_context_must_flow_to_query' as const;

const policyRuleSchema = z.object({
  id: z.string().refine(isCanonicalPolicyId, 'Policy id must be one canonical lowercase token'),
  severity: z.enum(['info', 'warn', 'error', 'blocker']),
  appliesTo: z.array(z.string()).min(1),
  rule: z.literal(POLICY_RULE)
}).strict().superRefine((policy, context) => {
  for (let index = 0; index < policy.appliesTo.length; index += 1) {
    const blockId = policy.appliesTo[index]!;
    if (!isCanonicalBlockId(blockId)) {
      context.addIssue({
        code: 'custom',
        path: ['appliesTo', index],
        message: 'Policy appliesTo entries must be canonical Block IDs'
      });
    }
  }
  if (!canonicalEquals(policy.appliesTo, uniqueSorted(policy.appliesTo))) {
    context.addIssue({
      code: 'custom',
      path: ['appliesTo'],
      message: 'Policy appliesTo entries must be unique and canonically ordered'
    });
  }
});

function canonicalPolicyValue(policy: z.output<typeof policyRuleSchema>): string {
  return JSON.stringify({
    id: policy.id,
    severity: policy.severity,
    appliesTo: policy.appliesTo,
    rule: policy.rule
  });
}

const policySpecSchema = z.object({
  policies: z.array(policyRuleSchema)
}).strict().superRefine((spec, context) => {
  // Canonical-equal duplicate declarations carry no additional semantics; only
  // conflicting duplicates (same id with a differing canonical value) are rejected.
  const seen = new Map<string, string>();
  for (let index = 0; index < spec.policies.length; index += 1) {
    const policy = spec.policies[index]!;
    const canonical = canonicalPolicyValue(policy);
    const previous = seen.get(policy.id);
    if (previous !== undefined && previous !== canonical) {
      context.addIssue({
        code: 'custom',
        path: ['policies', index, 'id'],
        message: `Conflicting duplicate policy id in one source: ${policy.id}`
      });
    }
    seen.set(policy.id, canonical);
  }
});

function withinScopePath(
  scope: PolicySourceScope,
  rootPath: string,
  filePath: string,
  sourcePrefix?: string
): string {
  const relativePath = relativePosixPath(rootPath, filePath);
  return scope === 'official'
    ? `${posixPath(officialPoliciesRelativePath)}/${relativePath}`
    : `${sourcePrefix ?? 'project/policies'}/${relativePath}`;
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
    parsed = YAML.parse(source) as unknown;
  } catch (error) {
    throw new Error(`Policy source is not valid YAML: ${normalizedPath}`, { cause: error });
  }
  const result = policySpecSchema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Policy source violates the exact schema: ${normalizedPath}: ${details}`);
  }

  return {
    policies: [...new Map(result.data.policies.map((policy) => [policy.id, policy])).values()]
      .map((policy) => ({
        id: policy.id,
        severity: policy.severity,
        appliesTo: [...policy.appliesTo],
        rule: policy.rule
      }))
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

function mergePolicyScopes(scopesLowToHighPrecedence: readonly LoadedPolicyScope[]): LoadedPolicyScope {
  return {
    policies: uniqueSorted(scopesLowToHighPrecedence.flatMap((scope) => scope.policies)),
    sources: scopesLowToHighPrecedence
      .flatMap((scope) => scope.sources)
      .sort((left, right) => compareCodeUnits(left.path, right.path)),
    definitions: scopesLowToHighPrecedence.flatMap((scope) => scope.definitions)
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
  const {
    officialPoliciesRoot,
    projectPoliciesRoot,
    sourcePoliciesRoot
  } = getWorkspacePaths(workspaceRoot);
  const official = loadPolicyScope('official', officialPoliciesRoot);

  const project = mergePolicyScopes([
    loadPolicyScope('project', projectPoliciesRoot, 'project/policies'),
    loadPolicyScope('project', sourcePoliciesRoot, 'source/model/policies')
  ]);
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
