import { decodeExactUtf8, readOptionalRetainedOrdinaryFile } from '../../runtime-state/physical/runtime/retained-file-read.ts';
import { canonicalEquals, compareCodeUnits, uniqueSorted } from '../../contracts/canonical.ts';
import { resolvePathInside, srcRelativePath } from '../../workspace/runtime/paths.ts';
import type { InstallPlanStep, LockFile } from '../contract.ts';
import { CompilerError } from '../errors.ts';
import { artifactEntityId, capabilityEntityId } from '../ir/ir-identity.ts';
import { loadWorkspaceEngineeringIRBuildInput } from '../ir/load-workspace-engineering-ir-input.ts';
import { PREDICATE_SIGNATURE_REGISTRY } from '../../semantics/engineering-ir/predicate-signatures.ts';
import { buildValidatedEngineeringIR } from '../ir/validate-engineering-ir.ts';
import {
  loadPolicyDeclarations,
  type LoadedPolicyDefinition,
  type LoadedPolicyScope
} from '../parse/load-policy-declarations.ts';
import { policySemanticRule } from '../policies/contract/rules.ts';
import type { MergedPolicyReportEntry, PolicyDiagnostic, PolicyReport, PolicyRule, PolicyViolation } from '../policies/contract/types.ts';
import { validatePolicyReport } from '../policies/runtime/report-authority.ts';
import { observePolicySemanticFlow, POLICY_SEMANTIC_FLOW_PROVIDER_ID, POLICY_SEMANTIC_FLOW_PROVIDER_REVISION } from '../policies/runtime/semantic-flow.ts';

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
  return step.action === 'copy' && step.to.startsWith(`${srcRelativePath}/`) && step.to.endsWith('.ts');
}

function missingFlowDiagnostic(
  filePath: string,
  definition: LoadedPolicyDefinition
): PolicyDiagnostic {
  return {
    id: definition.policy.id,
    severity: definition.policy.severity,
    appliesTo: definition.policy.appliesTo,
    rule: definition.policy.rule,
    files: [filePath],
    message: 'Exact source analysis did not prove the required provider-to-target semantic data flow.',
    sourceScope: definition.sourceScope,
    sourcePath: definition.sourcePath,
    evidenceClass: 'source-structure'
  };
}

function missingFlowViolation(
  filePath: string,
  definition: LoadedPolicyDefinition
): PolicyViolation {
  const predicate = policySemanticRule(definition.policy.rule).requiredPredicate;
  return {
    id: definition.policy.id,
    severity: definition.policy.severity,
    appliesTo: definition.policy.appliesTo,
    rule: definition.policy.rule,
    files: [filePath],
    message: `Validated Engineering IR has no exact observed ${predicate} fact for this Policy target.`,
    sourceScope: definition.sourceScope,
    sourcePath: definition.sourcePath
  };
}

function comparePolicyObservation(
  left: Pick<PolicyViolation, 'id' | 'sourceScope' | 'sourcePath' | 'files' | 'message'>,
  right: Pick<PolicyViolation, 'id' | 'sourceScope' | 'sourcePath' | 'files' | 'message'>
): number {
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
  diagnostics: PolicyDiagnostic[],
  requiredSemanticPredicates: string[],
  unsupportedSemanticPredicates: string[]
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
      providerId: POLICY_SEMANTIC_FLOW_PROVIDER_ID,
      providerRevision: POLICY_SEMANTIC_FLOW_PROVIDER_REVISION,
      assurance: unsupportedSemanticPredicates.length === 0 ? 'semantic' : 'source-structure',
      requiredSemanticPredicates,
      unsupportedSemanticPredicates
    }
  });
}

function readPolicyTarget(workspaceRoot: string, targetFile: string): string {
  const absolutePath = resolvePathInside(workspaceRoot, targetFile);
  if (absolutePath === null) {
    throw new CompilerError('VERIFY-POLICY-002', `Policy target path escapes the workspace root: ${targetFile}`);
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

function policyProviderModulePaths(
  lock: LockFile,
  manifests: readonly { blockId: string; manifest: { provides: readonly string[] } }[],
  sourceCapability: string
): ReadonlySet<string> {
  const providerBlocks = new Set(
    manifests
      .filter((manifest) => manifest.manifest.provides.includes(sourceCapability))
      .map((manifest) => manifest.blockId)
  );
  return new Set(lock.installPlan
    .filter((step) => providerBlocks.has(step.blockId) && isPolicyCheckableInstall(step))
    .map((step) => step.to));
}

export async function runPolicyGate(workspaceRoot: string): Promise<PolicyReport> {
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

  let workspaceInput: Awaited<ReturnType<typeof loadWorkspaceEngineeringIRBuildInput>>;
  try {
    workspaceInput = await loadWorkspaceEngineeringIRBuildInput(workspaceRoot);
  } catch (error) {
    throw new CompilerError(
      'VERIFY-POLICY-001',
      'Policy applicability cannot be resolved without one readable canonical Lock',
      { cause: error instanceof Error ? error.message : String(error) }
    );
  }

  const lock = workspaceInput.sourceLock;
  if (!canonicalEquals(workspaceInput.engineeringIRInput.policyDeclarations, [
    ...mergedPolicies.values()
  ].map((definition) => definition.policy))) {
    throw new CompilerError(
      'VERIFY-POLICY-005',
      'Policy declarations changed while deriving the canonical Engineering IR input'
    );
  }

  const diagnostics: PolicyDiagnostic[] = [];
  const observations = new Map<string, Readonly<{
    sourceCapability: string;
    sourceRevision: string;
    target: string;
  }>>();
  for (const definition of mergedPolicies.values()) {
    const rule = policySemanticRule(definition.policy.rule);
    const providerModulePaths = policyProviderModulePaths(
      lock,
      workspaceInput.engineeringIRInput.manifests,
      rule.sourceCapability
    );
    if (providerModulePaths.size === 0) {
      throw new CompilerError(
        'VERIFY-POLICY-005',
        `Policy rule ${definition.policy.rule} has no resolved source capability provider module`
      );
    }
    for (const targetFile of targetFilesForPolicy(lock, definition.policy)) {
      const observation = observePolicySemanticFlow({
        targetPath: targetFile,
        source: readPolicyTarget(workspaceRoot, targetFile),
        providerModulePaths,
        rule
      });
      if (observation.status === 'proven') {
        observations.set(`${rule.sourceCapability}\u0000${targetFile}`, {
          sourceCapability: rule.sourceCapability,
          sourceRevision: observation.sourceRevision,
          target: targetFile
        });
      } else {
        diagnostics.push(missingFlowDiagnostic(targetFile, definition));
      }
    }
  }

  const snapshot = buildValidatedEngineeringIR({
    ...workspaceInput.engineeringIRInput,
    observedFlows: [...observations.values()].map((observation) => ({
      providerId: POLICY_SEMANTIC_FLOW_PROVIDER_ID,
      sourceCapability: observation.sourceCapability,
      sourcePath: observation.target,
      sourceRevision: observation.sourceRevision,
      target: observation.target
    }))
  });
  const requiredSemanticPredicates = uniqueSorted([...mergedPolicies.values()]
    .map((definition) => policySemanticRule(definition.policy.rule).requiredPredicate));
  const unsupportedSemanticPredicates = requiredSemanticPredicates.filter((predicate) =>
    PREDICATE_SIGNATURE_REGISTRY[predicate as keyof typeof PREDICATE_SIGNATURE_REGISTRY].status !== 'active');
  const violations: PolicyViolation[] = [];
  for (const definition of mergedPolicies.values()) {
    const rule = policySemanticRule(definition.policy.rule);
    for (const targetFile of targetFilesForPolicy(lock, definition.policy)) {
      const subject = capabilityEntityId(rule.sourceCapability);
      const object = artifactEntityId(targetFile);
      const observation = observations.get(`${rule.sourceCapability}\u0000${targetFile}`);
      const proven = observation !== undefined && snapshot.ir.facts.some((fact) =>
        fact.subject === subject
        && fact.predicate === rule.requiredPredicate
        && fact.object.kind === 'entity'
        && fact.object.entityId === object
        && fact.assertions.some((assertion) => assertion.authority === 'observed'
          && assertion.provenance.some((provenance) =>
            provenance.kind === 'static-analysis'
            && provenance.sourceId === POLICY_SEMANTIC_FLOW_PROVIDER_ID
            && provenance.sourcePath === targetFile
            && provenance.revision === observation.sourceRevision)));
      if (!proven) violations.push(missingFlowViolation(targetFile, definition));
    }
  }

  return buildPolicyReport(
    official,
    project,
    mergedPolicies,
    lock,
    violations.sort(comparePolicyObservation),
    diagnostics.sort(comparePolicyObservation),
    requiredSemanticPredicates,
    unsupportedSemanticPredicates
  );
}
