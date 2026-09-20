import { canonicalEquals, compareCodeUnits, uniqueSorted } from '../../contracts/canonical.ts';
import type { InstallPlanStep, LockFile } from '../../compiler/contract.ts';
import { CompilerError } from '../../compiler/errors.ts';
import type { BuildEngineeringIRInput } from '../../compiler/ir/build-engineering-ir.ts';
import { artifactEntityId, capabilityEntityId } from '../../compiler/ir/ir-identity.ts';
import { buildValidatedEngineeringIR } from '../../compiler/ir/validate-engineering-ir.ts';
import { PREDICATE_SIGNATURE_REGISTRY } from '../../semantics/engineering-ir/predicate-signatures.ts';
import {
  policySemanticRule,
  type PolicySemanticRuleDefinition
} from '../../semantics/policies/rules.ts';
import type {
  MergedPolicyReportEntry,
  PolicyDiagnostic,
  PolicyReport,
  PolicyRule,
  PolicySourceFileReport,
  PolicySourceScope,
  PolicyViolation
} from '../../semantics/policies/types.ts';
import { srcRelativePath } from '../../workspace/paths.ts';
import { validatePolicyReport } from './report.ts';

export interface PolicyGateDefinition {
  readonly policy: PolicyRule;
  readonly sourceScope: PolicySourceScope;
  readonly sourcePath: string;
}

export interface PolicyGateScope {
  readonly policies: readonly string[];
  readonly sources: readonly PolicySourceFileReport[];
}

export interface PolicyGateObservationRequest {
  readonly requestId: string;
  readonly targetPath: string;
  readonly providerModulePaths: readonly string[];
  readonly rule: PolicySemanticRuleDefinition;
}

export interface PolicyGateObservation {
  readonly requestId: string;
  readonly sourceRevision: string;
  readonly status: 'proven' | 'not-proven';
}

export interface PreparedPolicyGateEvaluation {
  readonly official: PolicyGateScope;
  readonly project: PolicyGateScope;
  readonly definitions: readonly PolicyGateDefinition[];
  readonly lock: LockFile;
  readonly engineeringIRInput: BuildEngineeringIRInput;
  readonly providerId: string;
  readonly providerRevision: string;
  readonly requests: readonly PolicyGateObservationRequest[];
  readonly requiredSemanticPredicates: readonly string[];
  readonly unsupportedSemanticPredicates: readonly string[];
}

function isPolicyCheckableInstall(step: InstallPlanStep): boolean {
  return step.action === 'copy'
    && step.to.startsWith(`${srcRelativePath}/`)
    && step.to.endsWith('.ts');
}

function targetFilesForPolicy(lock: LockFile, policy: PolicyRule): string[] {
  return uniqueSorted(
    lock.installPlan
      .filter(step => policy.appliesTo.includes(step.blockId) && isPolicyCheckableInstall(step))
      .map(step => step.to)
  );
}

function policyProviderModulePaths(
  lock: LockFile,
  manifests: BuildEngineeringIRInput['manifests'],
  sourceCapability: string
): string[] {
  const providerBlocks = new Set(
    manifests
      .filter(entry => entry.manifest.provides.includes(sourceCapability))
      .map(entry => entry.blockId)
  );
  return uniqueSorted(
    lock.installPlan
      .filter(step => providerBlocks.has(step.blockId) && isPolicyCheckableInstall(step))
      .map(step => step.to)
  );
}

function requestId(definition: PolicyGateDefinition, targetPath: string): string {
  return [
    definition.policy.id,
    definition.sourceScope,
    definition.sourcePath,
    targetPath
  ].join('\u0000');
}

function definitionByRequest(
  prepared: PreparedPolicyGateEvaluation
): ReadonlyMap<string, Readonly<{ definition: PolicyGateDefinition; targetPath: string }>> {
  const definitions = new Map<string, Readonly<{ definition: PolicyGateDefinition; targetPath: string }>>();
  for (const definition of prepared.definitions) {
    for (const targetPath of targetFilesForPolicy(prepared.lock, definition.policy)) {
      const id = requestId(definition, targetPath);
      if (definitions.has(id)) {
        throw new Error(`Policy observation request identity is duplicated: ${id}`);
      }
      definitions.set(id, Object.freeze({ definition, targetPath }));
    }
  }
  return definitions;
}

function missingFlowDiagnostic(
  targetPath: string,
  definition: PolicyGateDefinition
): PolicyDiagnostic {
  return {
    id: definition.policy.id,
    severity: definition.policy.severity,
    appliesTo: definition.policy.appliesTo,
    rule: definition.policy.rule,
    files: [targetPath],
    message: 'Exact source analysis did not prove the required provider-to-target semantic data flow.',
    sourceScope: definition.sourceScope,
    sourcePath: definition.sourcePath,
    evidenceClass: 'source-structure'
  };
}

function missingFlowViolation(
  targetPath: string,
  definition: PolicyGateDefinition
): PolicyViolation {
  const predicate = policySemanticRule(definition.policy.rule).requiredPredicate;
  return {
    id: definition.policy.id,
    severity: definition.policy.severity,
    appliesTo: definition.policy.appliesTo,
    rule: definition.policy.rule,
    files: [targetPath],
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

function mergedPolicyEntries(
  definitions: readonly PolicyGateDefinition[],
  lock: LockFile
): MergedPolicyReportEntry[] {
  return definitions
    .map(definition => ({
      id: definition.policy.id,
      sourceScope: definition.sourceScope,
      sourcePath: definition.sourcePath,
      targets: targetFilesForPolicy(lock, definition.policy)
    }))
    .sort((left, right) => compareCodeUnits(left.id, right.id));
}

export function buildSkippedPolicyGateReport(
  official: PolicyGateScope,
  project: PolicyGateScope
): PolicyReport {
  return validatePolicyReport({
    status: 'skipped',
    official: {
      policies: [...official.policies],
      sources: [...official.sources],
      violations: []
    },
    project: {
      policies: [...project.policies],
      sources: [...project.sources],
      violations: []
    },
    merged: { policies: [] },
    violations: [],
    diagnostics: []
  });
}

export function preparePolicyGateEvaluation(input: Readonly<{
  official: PolicyGateScope;
  project: PolicyGateScope;
  definitions: readonly PolicyGateDefinition[];
  lock: LockFile;
  engineeringIRInput: BuildEngineeringIRInput;
  providerId: string;
  providerRevision: string;
}>): PreparedPolicyGateEvaluation {
  if (!canonicalEquals(
    input.engineeringIRInput.policyDeclarations,
    input.definitions.map(definition => definition.policy)
  )) {
    throw new CompilerError(
      'VERIFY-POLICY-005',
      'Policy declarations changed while deriving the canonical Engineering IR input'
    );
  }

  const requests: PolicyGateObservationRequest[] = [];
  for (const definition of input.definitions) {
    const rule = policySemanticRule(definition.policy.rule);
    const providerModulePaths = policyProviderModulePaths(
      input.lock,
      input.engineeringIRInput.manifests,
      rule.sourceCapability
    );
    if (providerModulePaths.length === 0) {
      throw new CompilerError(
        'VERIFY-POLICY-005',
        `Policy rule ${definition.policy.rule} has no resolved source capability provider module`
      );
    }
    for (const targetPath of targetFilesForPolicy(input.lock, definition.policy)) {
      requests.push(Object.freeze({
        requestId: requestId(definition, targetPath),
        targetPath,
        providerModulePaths: Object.freeze([...providerModulePaths]),
        rule
      }));
    }
  }

  const requiredSemanticPredicates = uniqueSorted(
    input.definitions.map(definition =>
      policySemanticRule(definition.policy.rule).requiredPredicate
    )
  );
  const unsupportedSemanticPredicates = requiredSemanticPredicates.filter(predicate =>
    PREDICATE_SIGNATURE_REGISTRY[
      predicate as keyof typeof PREDICATE_SIGNATURE_REGISTRY
    ].status !== 'active'
  );

  return Object.freeze({
    official: input.official,
    project: input.project,
    definitions: Object.freeze([...input.definitions]),
    lock: input.lock,
    engineeringIRInput: input.engineeringIRInput,
    providerId: input.providerId,
    providerRevision: input.providerRevision,
    requests: Object.freeze(requests),
    requiredSemanticPredicates: Object.freeze(requiredSemanticPredicates),
    unsupportedSemanticPredicates: Object.freeze(unsupportedSemanticPredicates)
  });
}

export function completePolicyGateEvaluation(
  prepared: PreparedPolicyGateEvaluation,
  observations: readonly PolicyGateObservation[]
): PolicyReport {
  if (observations.length !== prepared.requests.length) {
    throw new Error('Policy semantic observation set does not match the prepared request set');
  }

  const requestsById = new Map(prepared.requests.map(request => [request.requestId, request]));
  const definitionsByRequest = definitionByRequest(prepared);
  const observationsById = new Map<string, PolicyGateObservation>();
  const diagnostics: PolicyDiagnostic[] = [];
  const observedFlows = new Map<string, Readonly<{
    sourceCapability: string;
    sourceRevision: string;
    target: string;
  }>>();

  for (const observation of observations) {
    if (observationsById.has(observation.requestId)) {
      throw new Error(`Policy semantic observation is duplicated: ${observation.requestId}`);
    }
    const request = requestsById.get(observation.requestId);
    const bound = definitionsByRequest.get(observation.requestId);
    if (!request || !bound) {
      throw new Error(`Policy semantic observation is not part of the prepared request set: ${observation.requestId}`);
    }
    observationsById.set(observation.requestId, observation);
    if (observation.status === 'proven') {
      observedFlows.set(`${request.rule.sourceCapability}\u0000${request.targetPath}`, {
        sourceCapability: request.rule.sourceCapability,
        sourceRevision: observation.sourceRevision,
        target: request.targetPath
      });
    } else {
      diagnostics.push(missingFlowDiagnostic(bound.targetPath, bound.definition));
    }
  }

  if (observationsById.size !== prepared.requests.length) {
    throw new Error('Policy semantic observation set is incomplete');
  }

  const snapshot = buildValidatedEngineeringIR({
    ...prepared.engineeringIRInput,
    observedFlows: [...observedFlows.values()].map(observation => ({
      providerId: prepared.providerId,
      sourceCapability: observation.sourceCapability,
      sourcePath: observation.target,
      sourceRevision: observation.sourceRevision,
      target: observation.target
    }))
  });

  const violations: PolicyViolation[] = [];
  for (const request of prepared.requests) {
    const bound = definitionsByRequest.get(request.requestId)!;
    const observation = observationsById.get(request.requestId)!;
    const subject = capabilityEntityId(request.rule.sourceCapability);
    const object = artifactEntityId(request.targetPath);
    const proven = observation.status === 'proven' && snapshot.ir.facts.some(fact =>
      fact.subject === subject
      && fact.predicate === request.rule.requiredPredicate
      && fact.object.kind === 'entity'
      && fact.object.entityId === object
      && fact.assertions.some(assertion => assertion.authority === 'observed'
        && assertion.provenance.some(provenance =>
          provenance.kind === 'static-analysis'
          && provenance.sourceId === prepared.providerId
          && provenance.sourcePath === request.targetPath
          && provenance.revision === observation.sourceRevision))
    );
    if (!proven) {
      violations.push(missingFlowViolation(bound.targetPath, bound.definition));
    }
  }

  const sortedViolations = violations.sort(comparePolicyObservation);
  const sortedDiagnostics = diagnostics.sort(comparePolicyObservation);
  const officialViolations = sortedViolations.filter(entry => entry.sourceScope === 'official');
  const projectViolations = sortedViolations.filter(entry => entry.sourceScope === 'project');
  const merged = mergedPolicyEntries(prepared.definitions, prepared.lock);
  const applicable = merged.some(entry => entry.targets.length > 0);
  const shouldFail = sortedViolations.some(entry =>
    entry.severity === 'error' || entry.severity === 'blocker'
  );

  return validatePolicyReport({
    status: !applicable ? 'skipped' : shouldFail ? 'failed' : 'passed',
    official: {
      policies: [...prepared.official.policies],
      sources: [...prepared.official.sources],
      violations: officialViolations
    },
    project: {
      policies: [...prepared.project.policies],
      sources: [...prepared.project.sources],
      violations: projectViolations
    },
    merged: { policies: merged },
    violations: sortedViolations,
    diagnostics: sortedDiagnostics,
    evaluation: {
      providerId: prepared.providerId,
      providerRevision: prepared.providerRevision,
      assurance: prepared.unsupportedSemanticPredicates.length === 0
        ? 'semantic'
        : 'source-structure',
      requiredSemanticPredicates: [...prepared.requiredSemanticPredicates],
      unsupportedSemanticPredicates: [...prepared.unsupportedSemanticPredicates]
    }
  });
}
