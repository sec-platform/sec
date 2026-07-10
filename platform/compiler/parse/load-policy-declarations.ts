import { uniqueSorted } from '../../shared/collections.ts';
import { listFilesRecursive, pathExists } from '../../shared/fs.ts';
import { getWorkspacePaths, relativePosixPath } from '../../shared/paths.ts';
import type {
  PolicyRule,
  PolicySourceFileReport,
  PolicySourceScope,
  PolicySpec
} from '../../shared/policy-types.ts';
import { readYaml } from '../../shared/yaml.ts';

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

function normalizePolicies(spec: PolicySpec | null | undefined): PolicySpec {
  return {
    policies: spec?.policies ?? []
  };
}

function withinScopePath(
  scope: PolicySourceScope,
  rootPath: string,
  filePath: string,
  sourcePrefix?: string
): string {
  const relativePath = relativePosixPath(rootPath, filePath);
  return scope === 'official'
    ? `platform/policies/official/${relativePath}`
    : `${sourcePrefix ?? 'project/policies'}/${relativePath}`;
}

function isPolicySpecPath(filePath: string): boolean {
  const normalized = filePath.toLowerCase();
  return normalized.endsWith('.yaml') || normalized.endsWith('.yml');
}

async function loadPolicyScope(
  scope: PolicySourceScope,
  rootPath: string,
  sourcePrefix?: string
): Promise<LoadedPolicyScope> {
  if (!(await pathExists(rootPath))) {
    return {
      policies: [],
      sources: [],
      definitions: []
    };
  }

  const files = (await listFilesRecursive(rootPath))
    .filter((filePath) => isPolicySpecPath(filePath))
    .map((filePath) => ({
      absolutePath: filePath,
      normalizedPath: withinScopePath(scope, rootPath, filePath, sourcePrefix)
    }))
    .sort((left, right) => left.normalizedPath.localeCompare(right.normalizedPath));

  const declaredPolicyIds = new Set<string>();
  const sources: PolicySourceFileReport[] = [];
  const definitions: LoadedPolicyDefinition[] = [];

  for (const file of files) {
    const spec = normalizePolicies(await readYaml<PolicySpec>(file.absolutePath));
    const policyIds = uniqueSorted(spec.policies.map((policy) => policy.id));

    for (const policy of spec.policies) {
      declaredPolicyIds.add(policy.id);
      definitions.push({
        policy,
        sourceScope: scope,
        sourcePath: file.normalizedPath
      });
    }

    sources.push({
      path: file.normalizedPath,
      policyIds
    });
  }

  return {
    policies: uniqueSorted([...declaredPolicyIds]),
    sources,
    definitions
  };
}

function mergePolicyScopes(scopes: readonly LoadedPolicyScope[]): LoadedPolicyScope {
  return {
    policies: uniqueSorted(scopes.flatMap((scope) => scope.policies)),
    sources: scopes.flatMap((scope) => scope.sources).sort((left, right) => left.path.localeCompare(right.path)),
    definitions: scopes.flatMap((scope) => scope.definitions)
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

export async function loadPolicyDeclarations(workspaceRoot: string): Promise<LoadedPolicyDeclarations> {
  const {
    officialPoliciesRoot,
    projectPoliciesRoot,
    sourcePoliciesRoot,
    legacySourcePoliciesRoot
  } = getWorkspacePaths(workspaceRoot);
  const official = await loadPolicyScope('official', officialPoliciesRoot);
  const project = mergePolicyScopes([
    await loadPolicyScope('project', projectPoliciesRoot, 'project/policies'),
    await loadPolicyScope('project', sourcePoliciesRoot, 'source/model/policies'),
    await loadPolicyScope('project', legacySourcePoliciesRoot, 'project/source/policies')
  ]);
  const definitions = mergePolicies(official, project);
  const policies = [...definitions.values()]
    .map((definition) => definition.policy)
    .sort((left, right) => left.id.localeCompare(right.id));

  return {
    official,
    project,
    definitions,
    policies,
    policyIds: policies.map((policy) => policy.id)
  };
}
