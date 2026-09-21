import { compareCodeUnits, uniqueSorted } from '../../contracts/canonical.ts';
import { PolicySpecSchema } from './source-schema.ts';
import type {
  PolicyRule,
  PolicySourceFileReport,
  PolicySourceScope,
  PolicySpec
} from './types.ts';

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

export interface LoadedPolicySource {
  readonly sourcePath: string;
  readonly spec: PolicySpec;
}

/** Decode one already-parsed policy source and coalesce canonical-equal duplicates. */
export function decodePolicySpec(input: unknown, sourcePath: string): PolicySpec {
  const result = PolicySpecSchema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues
      .map(issue => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ');
    throw new Error(
      `Policy source violates the exact schema: ${sourcePath}: ${details}`,
      { cause: result.error }
    );
  }
  return {
    policies: [...new Map(
      result.data.policies.map(policy => [policy.id, policy])
    ).values()]
  };
}

/** Build one semantic policy scope from already captured source values. */
export function buildLoadedPolicyScope(
  scope: PolicySourceScope,
  sources: readonly LoadedPolicySource[]
): LoadedPolicyScope {
  const declaredPolicyIds = new Set<string>();
  const reports: PolicySourceFileReport[] = [];
  const definitions: LoadedPolicyDefinition[] = [];

  for (const source of sources) {
    const policyIds = uniqueSorted(source.spec.policies.map(policy => policy.id));
    for (const policy of source.spec.policies) {
      declaredPolicyIds.add(policy.id);
      definitions.push({
        policy,
        sourceScope: scope,
        sourcePath: source.sourcePath
      });
    }
    reports.push({ path: source.sourcePath, policyIds });
  }

  return {
    policies: uniqueSorted([...declaredPolicyIds]),
    sources: reports,
    definitions
  };
}

/** Merge source scopes in precedence order: project declarations override official ones. */
export function mergeLoadedPolicyDeclarations(
  official: LoadedPolicyScope,
  project: LoadedPolicyScope
): LoadedPolicyDeclarations {
  const definitions = new Map<string, LoadedPolicyDefinition>();
  for (const definition of [...official.definitions, ...project.definitions]) {
    definitions.set(definition.policy.id, definition);
  }
  const policies = [...definitions.values()]
    .map(definition => definition.policy)
    .sort((left, right) => compareCodeUnits(left.id, right.id));

  return {
    official,
    project,
    definitions,
    policies,
    policyIds: policies.map(policy => policy.id)
  };
}
