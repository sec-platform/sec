import path from 'node:path';
import { getWorkspacePaths, resolveWorkspaceLockPath } from '../../shared/paths.ts';
import { listFilesRecursive, pathExists, readJson, readText } from '../../shared/fs.ts';
import { readYaml } from '../../shared/yaml.ts';
import type { InstallPlanStep, LockFile } from '../../shared/lock-types.ts';
import type {
  MergedPolicyReportEntry,
  PolicyReport,
  PolicyRule,
  PolicySourceFileReport,
  PolicySourceScope,
  PolicySpec,
  PolicyViolation
} from '../../shared/policy-types.ts';

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

function withinScopePath(scope: PolicySourceScope, rootPath: string, filePath: string, sourcePrefix?: string): string {
  const relativePath = normalizeRelativePath(rootPath, filePath);
  return scope === 'official' ? `platform/policies/official/${relativePath}` : `${sourcePrefix ?? 'project/policies'}/${relativePath}`;
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

function mergePolicyScopes(scopes: LoadedPolicyScope[]): LoadedPolicyScope {
  return {
    policies: [...new Set(scopes.flatMap((scope) => scope.policies))].sort((left, right) => left.localeCompare(right)),
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

function buildMergedPolicyEntries(
  definitions: Map<string, LoadedPolicyDefinition>,
  lock: LockFile | null
): MergedPolicyReportEntry[] {
  return [...definitions.values()]
    .map((definition) => ({
      id: definition.policy.id,
      sourceScope: definition.sourceScope,
      sourcePath: definition.sourcePath,
      targets: targetFilesForPolicy(lock, definition.policy)
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function targetFilesForPolicy(lock: LockFile | null, policy: PolicyRule): string[] {
  const installPlan = lock?.installPlan ?? [];
  const copyTargets = installPlan
    .filter((step) => policy.appliesTo.includes(step.blockId) && isPolicyCheckableInstall(step))
    .map((step) => step.to);

  return copyTargets.length > 0 ? [...new Set(copyTargets)].sort((left, right) => left.localeCompare(right)) : ['src/installed/entity/customer-service.ts'];
}

function isPolicyCheckableInstall(step: InstallPlanStep): boolean {
  return step.action === 'copy' && step.to.startsWith('src/') && step.to.endsWith('.ts');
}

function evaluateTenantScopeRule(
  source: string,
  filePath: string,
  definition: LoadedPolicyDefinition
): PolicyViolation | null {
  const hasCurrentTenant = source.includes('currentTenant(session)');
  const tenantIdComparisonPattern = new RegExp(
    [
      String.raw`\b\w+\.tenantId\s*(?:===|!==)\s*tenantId\b`,
      String.raw`\btenantId\s*(?:===|!==)\s*\w+\.tenantId\b`
    ].join('|')
  );
  const hasTenantFilter = tenantIdComparisonPattern.test(source);

  if (hasCurrentTenant && hasTenantFilter) {
    return null;
  }

  return {
    id: definition.policy.id,
    severity: definition.policy.severity,
    appliesTo: definition.policy.appliesTo,
    rule: definition.policy.rule,
    files: [filePath],
    message: 'Tenant-scoped queries must derive tenant context and filter by tenantId.',
    sourceScope: definition.sourceScope,
    sourcePath: definition.sourcePath
  };
}

function buildPolicyReport(
  official: LoadedPolicyScope,
  project: LoadedPolicyScope,
  mergedPolicies: Map<string, LoadedPolicyDefinition>,
  lock: LockFile | null,
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
      policies: buildMergedPolicyEntries(mergedPolicies, lock)
    },
    violations
  };
}

export async function runPolicyGate(workspaceRoot: string): Promise<PolicyReport> {
  const { officialPoliciesRoot, projectPoliciesRoot, sourcePoliciesRoot, legacySourcePoliciesRoot, projectRoot } = getWorkspacePaths(workspaceRoot);
  const official = await loadPolicyScope('official', officialPoliciesRoot);
  const project = mergePolicyScopes([
    await loadPolicyScope('project', projectPoliciesRoot, 'project/policies'),
    await loadPolicyScope('project', sourcePoliciesRoot, 'source/model/policies'),
    await loadPolicyScope('project', legacySourcePoliciesRoot, 'project/source/policies')
  ]);
  const mergedPolicies = mergePolicies(official, project);

  if (mergedPolicies.size === 0) {
    return buildPolicyReport(official, project, mergedPolicies, null, []);
  }

  const violations: PolicyViolation[] = [];
  const readableLockPath = await resolveWorkspaceLockPath(workspaceRoot);
  const lock = (await pathExists(readableLockPath)) ? await readJson<LockFile>(readableLockPath) : null;

  for (const definition of mergedPolicies.values()) {
    if (definition.policy.rule !== 'tenant_context_must_flow_to_query') {
      continue;
    }

    for (const targetFile of targetFilesForPolicy(lock, definition.policy)) {
      const absolutePath = path.join(projectRoot, targetFile);
      if (!(await pathExists(absolutePath))) {
        continue;
      }
      const violation = evaluateTenantScopeRule(await readText(absolutePath), targetFile, definition);
      if (violation) {
        violations.push(violation);
      }
    }
  }

  return buildPolicyReport(
    official,
    project,
    mergedPolicies,
    lock,
    violations.sort((left, right) =>
      `${left.id}:${left.sourceScope}:${left.sourcePath}:${left.files.join(',')}:${left.message}`.localeCompare(
        `${right.id}:${right.sourceScope}:${right.sourcePath}:${right.files.join(',')}:${right.message}`
      )
    )
  );
}
