import path from 'node:path';
import { pathExists, readText } from '../../shared/fs.ts';
import { compilerRoot, getWorkspacePaths } from '../../shared/paths.ts';
import { readYaml } from '../../shared/yaml.ts';
import type { PolicyReport, PolicySpec, PolicyViolation } from '../../shared/types.ts';

function evaluateTenantScopeRule(source: string, filePath: string): PolicyViolation | null {
  const hasCurrentTenant = source.includes('currentTenant(session)');
  const hasTenantFilter =
    source.includes('customer.tenantId === tenantId') || source.includes('tenantId === customer.tenantId');

  if (hasCurrentTenant && hasTenantFilter) {
    return null;
  }

  return {
    id: 'tenant-scope-required',
    severity: 'error',
    appliesTo: ['entity/customer-basic'],
    rule: 'tenant_context_must_flow_to_query',
    files: [filePath],
    message: 'Entity customer queries must derive tenant context and filter by tenantId.'
  };
}

function normalizePolicies(spec: PolicySpec | null | undefined): PolicySpec {
  return {
    policies: spec?.policies ?? []
  };
}

function mergePolicies(official: PolicySpec, project: PolicySpec): PolicySpec {
  const merged = new Map(official.policies.map((policy) => [policy.id, policy]));
  for (const policy of project.policies) {
    merged.set(policy.id, policy);
  }
  return {
    policies: [...merged.values()]
  };
}

export async function runPolicyGate(workspaceRoot: string): Promise<PolicyReport> {
  const { projectRoot, policySpecPath } = getWorkspacePaths(workspaceRoot);
  const officialPolicySpecPath = path.join(compilerRoot, 'platform', 'policies', 'official', 'policy.spec.yaml');

  const officialSpec = (await pathExists(officialPolicySpecPath))
    ? normalizePolicies(await readYaml<PolicySpec>(officialPolicySpecPath))
    : { policies: [] };
  const projectSpec = (await pathExists(policySpecPath))
    ? normalizePolicies(await readYaml<PolicySpec>(policySpecPath))
    : { policies: [] };

  const mergedSpec = mergePolicies(officialSpec, projectSpec);
  if (mergedSpec.policies.length === 0) {
    return {
      status: 'skipped',
      official: {
        policies: [],
        violations: []
      },
      project: {
        policies: [],
        violations: []
      },
      violations: []
    };
  }

  const violations: PolicyViolation[] = [];
  const officialViolations: PolicyViolation[] = [];
  const projectViolations: PolicyViolation[] = [];
  const projectPolicyIds = new Set(projectSpec.policies.map((policy) => policy.id));

  for (const policy of mergedSpec.policies) {
    if (policy.rule !== 'tenant_context_must_flow_to_query' || !policy.appliesTo.includes('entity/customer-basic')) {
      continue;
    }

    const targetFile = path.join(projectRoot, 'src', 'installed', 'entity', 'customer-service.ts');
    if (!(await pathExists(targetFile))) {
      continue;
    }
    const source = await readText(targetFile);
    const violation = evaluateTenantScopeRule(source, 'src/installed/entity/customer-service.ts');
    if (violation) {
      violations.push(violation);
      if (projectPolicyIds.has(policy.id)) {
        projectViolations.push(violation);
      } else {
        officialViolations.push(violation);
      }
    }
  }

  const shouldFail = violations.some((violation) => violation.severity === 'error' || violation.severity === 'blocker');
  return {
    status: shouldFail ? 'failed' : 'passed',
    official: {
      policies: officialSpec.policies.map((policy) => policy.id),
      violations: officialViolations
    },
    project: {
      policies: projectSpec.policies.map((policy) => policy.id),
      violations: projectViolations
    },
    violations
  };
}
