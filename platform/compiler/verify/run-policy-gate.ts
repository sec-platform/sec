import path from 'node:path';
import { getWorkspacePaths } from '../../shared/paths.ts';
import { listFilesRecursive, pathExists, readText } from '../../shared/fs.ts';
import { readYaml } from '../../shared/yaml.ts';
import type {
  MergedPolicyReportEntry,
  PolicyReport,
  PolicyRule,
  PolicySourceFileReport,
  PolicySourceScope,
  PolicySpec,
  PolicyViolation
} from '../../shared/types.ts';

interface LoadedPolicyDefinition {
  policy: PolicyRule;
  sourceScope: PolicySourceScope;
  sourcePath: string;
}

interface LoadedPolicyScope {
  policies: string[];
  sources: PolicySourceFileReport[];
  definitions: LoadedPolicyDefinition[];
}

function normalizePolicies(spec: PolicySpec | null | undefined): PolicySpec {
  return {
    policies: spec?.policies ?? []
  };
}

function normalizeRelativePath(rootPath: string, filePath: string): string {
  return path.relative(rootPath, filePath).replaceAll('\\', '/');
}

function withinScopePath(scope: PolicySourceScope, rootPath: string, filePath: string): string {
  const relativePath = normalizeRelativePath(rootPath, filePath);
  return scope === 'official' ? `platform/policies/official/${relativePath}` : `project/policies/${relativePath}`;
}

function isPolicySpecPath(filePath: string): boolean {
  const normalized = filePath.toLowerCase();
  return normalized.endsWith('.yaml') || normalized.endsWith('.yml');
}

async function loadPolicyScope(
  scope: PolicySourceScope,
  rootPath: string
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
      normalizedPath: withinScopePath(scope, rootPath, filePath)
    }))
    .sort((left, right) => left.normalizedPath.localeCompare(right.normalizedPath));

  const declaredPolicyIds = new Set<string>();
  const sources: PolicySourceFileReport[] = [];
  const definitions: LoadedPolicyDefinition[] = [];

  for (const file of files) {
    const spec = normalizePolicies(await readYaml<PolicySpec>(file.absolutePath));
    const policyIds = [...new Set(spec.policies.map((policy) => policy.id))].sort((left, right) =>
      left.localeCompare(right)
    );

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
    policies: [...declaredPolicyIds].sort((left, right) => left.localeCompare(right)),
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

function buildMergedPolicyEntries(definitions: Map<string, LoadedPolicyDefinition>): MergedPolicyReportEntry[] {
  return [...definitions.values()]
    .map((definition) => ({
      id: definition.policy.id,
      sourceScope: definition.sourceScope,
      sourcePath: definition.sourcePath
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function evaluateTenantScopeRule(
  source: string,
  filePath: string,
  definition: LoadedPolicyDefinition
): PolicyViolation | null {
  const hasCurrentTenant = source.includes('currentTenant(session)');
  const hasTenantFilter =
    source.includes('customer.tenantId === tenantId') || source.includes('tenantId === customer.tenantId');

  if (hasCurrentTenant && hasTenantFilter) {
    return null;
  }

  return {
    id: definition.policy.id,
    severity: definition.policy.severity,
    appliesTo: definition.policy.appliesTo,
    rule: definition.policy.rule,
    files: [filePath],
    message: 'Entity customer queries must derive tenant context and filter by tenantId.',
    sourceScope: definition.sourceScope,
    sourcePath: definition.sourcePath
  };
}

function buildPolicyReport(
  official: LoadedPolicyScope,
  project: LoadedPolicyScope,
  mergedPolicies: Map<string, LoadedPolicyDefinition>,
  violations: PolicyViolation[]
): PolicyReport {
  const officialViolations = violations.filter((violation) => violation.sourceScope === 'official');
  const projectViolations = violations.filter((violation) => violation.sourceScope === 'project');
  const shouldFail = violations.some((violation) => violation.severity === 'error' || violation.severity === 'blocker');
  const status =
    mergedPolicies.size === 0 ? 'skipped' : shouldFail ? 'failed' : 'passed';

  return {
    status,
    official: {
      policies: official.policies,
      sources: official.sources,
      violations: officialViolations
    },
    project: {
      policies: project.policies,
      sources: project.sources,
      violations: projectViolations
    },
    merged: {
      policies: buildMergedPolicyEntries(mergedPolicies)
    },
    violations
  };
}

export async function runPolicyGate(workspaceRoot: string): Promise<PolicyReport> {
  const { officialPoliciesRoot, projectPoliciesRoot, projectRoot } = getWorkspacePaths(workspaceRoot);
  const official = await loadPolicyScope('official', officialPoliciesRoot);
  const project = await loadPolicyScope('project', projectPoliciesRoot);
  const mergedPolicies = mergePolicies(official, project);

  if (mergedPolicies.size === 0) {
    return buildPolicyReport(official, project, mergedPolicies, []);
  }

  const violations: PolicyViolation[] = [];
  const targetFile = path.join(projectRoot, 'src', 'installed', 'entity', 'customer-service.ts');
  const targetFileExists = await pathExists(targetFile);
  const source = targetFileExists ? await readText(targetFile) : null;

  for (const definition of mergedPolicies.values()) {
    if (definition.policy.rule !== 'tenant_context_must_flow_to_query') {
      continue;
    }
    if (!definition.policy.appliesTo.includes('entity/customer-basic')) {
      continue;
    }
    if (!source) {
      continue;
    }

    const violation = evaluateTenantScopeRule(source, 'src/installed/entity/customer-service.ts', definition);
    if (violation) {
      violations.push(violation);
    }
  }

  return buildPolicyReport(
    official,
    project,
    mergedPolicies,
    violations.sort((left, right) =>
      `${left.id}:${left.sourceScope}:${left.sourcePath}:${left.message}`.localeCompare(
        `${right.id}:${right.sourceScope}:${right.sourcePath}:${right.message}`
      )
    )
  );
}
