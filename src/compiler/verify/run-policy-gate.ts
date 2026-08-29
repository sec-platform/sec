import { uniqueSorted } from '../../system-architecture/foundation/runtime/canonical.ts';
import { CompilerError } from '../errors.ts';
import type { InstallPlanStep, LockFile } from '../contract.ts';
import { readLockFile } from '../lock.ts';
import { getWorkspacePaths, resolvePathInside } from '../../workspace/paths.ts';
import { validatePolicyReport } from '../policies/runtime/report-authority.ts';
import type { MergedPolicyReportEntry, PolicyDiagnostic, PolicyReport, PolicyRule, PolicyViolation } from '../policies/contract/types.ts';
import { decodeExactUtf8, readOptionalRetainedOrdinaryFile } from '../../runtime-state/physical/runtime/retained-file-read.ts';
import { compareCodeUnits } from '../../system-architecture/foundation/runtime/canonical.ts';
import {
  loadPolicyDeclarations,
  type LoadedPolicyDefinition,
  type LoadedPolicyScope
} from '../parse/load-policy-declarations.ts';

const POLICY_STRUCTURAL_PROVIDER_ID = 'sec-policy-source-structure';
const POLICY_STRUCTURAL_PROVIDER_REVISION = 'tenant-context-structure-v1';
const POLICY_TENANT_REQUIRED_SEMANTIC_PREDICATES = Object.freeze(['FLOWS_TO'] as const);

function targetFilesForPolicy(lock: LockFile, policy: PolicyRule): string[] {
  return uniqueSorted(lock.installPlan
    .filter((step) => policy.appliesTo.includes(step.blockId) && isPolicyCheckableInstall(step))
    .map((step) => step.to));
}

function buildMergedPolicyEntries(
  definitions: ReadonlyMap<string, LoadedPolicyDefinition>,
  lock: LockFile
): MergedPolicyReportEntry[] {
  return [...definitions.values()]
    .map((definition) => ({
      id: definition.policy.id,
      sourceScope: definition.sourceScope,
      sourcePath: definition.sourcePath,
      targets: targetFilesForPolicy(lock, definition.policy)
    }))
    .sort((left, right) => compareCodeUnits(left.id, right.id));
}

function isPolicyCheckableInstall(step: InstallPlanStep): boolean {
  return step.action === 'copy' && step.to.startsWith('src/') && step.to.endsWith('.ts');
}

function evaluateTenantScopeStructure(
  source: string,
  filePath: string,
  definition: LoadedPolicyDefinition
): PolicyDiagnostic | null {
  const hasCurrentTenant = source.includes('currentTenant(session)');
  const tenantIdComparisonPattern = new RegExp(
    [
      String.raw`\b\w+\.tenantId\s*(?:===|!==)\s*tenantId\b`,
      String.raw`\btenantId\s*(?:===|!==)\s*\w+\.tenantId\b`
    ].join('|')
  );
  const hasTenantFilter = tenantIdComparisonPattern.test(source);

  if (hasCurrentTenant && hasTenantFilter) return null;
  return {
    id: definition.policy.id,
    severity: definition.policy.severity,
    appliesTo: definition.policy.appliesTo,
    rule: definition.policy.rule,
    files: [filePath],
    message: 'Source structure does not match the current tenant-context heuristic; semantic data-flow proof is unavailable.',
    sourceScope: definition.sourceScope,
    sourcePath: definition.sourcePath,
    evidenceClass: 'source-structure'
  };
}

function comparePolicyObservation(left: PolicyDiagnostic, right: PolicyDiagnostic): number {
  return compareCodeUnits(
    `${left.id}:${left.sourceScope}:${left.sourcePath}:${left.files.join(',')}:${left.message}`,
    `${right.id}:${right.sourceScope}:${right.sourcePath}:${right.files.join(',')}:${right.message}`
  );
}

function buildPolicyReport(
  official: LoadedPolicyScope,
  project: LoadedPolicyScope,
  mergedPolicies: ReadonlyMap<string, LoadedPolicyDefinition>,
  lock: LockFile,
  violations: PolicyViolation[],
  diagnostics: PolicyDiagnostic[]
): PolicyReport {
  const officialViolations = violations.filter((violation) => violation.sourceScope === 'official');
  const projectViolations = violations.filter((violation) => violation.sourceScope === 'project');
  const mergedEntries = buildMergedPolicyEntries(mergedPolicies, lock);
  const applicable = mergedEntries.some((entry) => entry.targets.length > 0);
  const shouldFail = violations.some((violation) => violation.severity === 'error' || violation.severity === 'blocker');
  const status = !applicable ? 'skipped' : shouldFail ? 'failed' : 'passed';

  return validatePolicyReport({
    status,
    official: { policies: official.policies, sources: official.sources, violations: officialViolations },
    project: { policies: project.policies, sources: project.sources, violations: projectViolations },
    merged: { policies: mergedEntries },
    violations,
    diagnostics,
    evaluation: {
      providerId: POLICY_STRUCTURAL_PROVIDER_ID,
      providerRevision: POLICY_STRUCTURAL_PROVIDER_REVISION,
      assurance: 'source-structure',
      requiredSemanticPredicates: [...POLICY_TENANT_REQUIRED_SEMANTIC_PREDICATES],
      unsupportedSemanticPredicates: [...POLICY_TENANT_REQUIRED_SEMANTIC_PREDICATES]
    }
  });
}

function readPolicyTarget(projectRoot: string, targetFile: string): string {
  const absolutePath = resolvePathInside(projectRoot, targetFile);
  if (absolutePath === null) {
    throw new CompilerError('VERIFY-POLICY-002', `Policy target path escapes the project root: ${targetFile}`);
  }
  const bytes = readOptionalRetainedOrdinaryFile(absolutePath, `Policy target ${targetFile}`);
  if (bytes === null) {
    throw new CompilerError('VERIFY-POLICY-003', `Applicable policy target is missing: ${targetFile}`);
  }
  try {
    return decodeExactUtf8(bytes, `Policy target ${targetFile}`);
  } catch (error) {
    throw new CompilerError(
      'VERIFY-POLICY-004',
      `Applicable policy target is not exact UTF-8: ${targetFile}`,
      { cause: error instanceof Error ? error.message : String(error) }
    );
  }
}

export function runPolicyGate(workspaceRoot: string): PolicyReport {
  const { projectRoot } = getWorkspacePaths(workspaceRoot);
  const { official, project, definitions: mergedPolicies } = loadPolicyDeclarations(workspaceRoot);

  if (mergedPolicies.size === 0) {
    return validatePolicyReport({
      status: 'skipped',
      official: { policies: official.policies, sources: official.sources, violations: [] },
      project: { policies: project.policies, sources: project.sources, violations: [] },
      merged: { policies: [] },
      violations: [],
      diagnostics: []
    });
  }

  let lock: LockFile;
  try {
    lock = readLockFile(workspaceRoot);
  } catch (error) {
    throw new CompilerError(
      'VERIFY-POLICY-001',
      'Policy applicability cannot be resolved without one readable canonical Lock',
      { cause: error instanceof Error ? error.message : String(error) }
    );
  }

  const diagnostics: PolicyDiagnostic[] = [];
  for (const definition of mergedPolicies.values()) {
    for (const targetFile of targetFilesForPolicy(lock, definition.policy)) {
      const diagnostic = evaluateTenantScopeStructure(
        readPolicyTarget(projectRoot, targetFile),
        targetFile,
        definition
      );
      if (diagnostic) diagnostics.push(diagnostic);
    }
  }

  return buildPolicyReport(
    official,
    project,
    mergedPolicies,
    lock,
    [],
    diagnostics.sort(comparePolicyObservation)
  );
}
