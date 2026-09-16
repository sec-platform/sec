import type { SemanticEntity } from '../semantic/engineering-ir/contract/entity-types.ts';
import type { SemanticFact, SemanticValue } from '../semantic/engineering-ir/contract/fact-types.ts';
import type { ValidatedEngineeringIRSnapshot } from '../semantic/engineering-ir/contract/validated-types.ts';
import type { SemanticGeneratorDeclaration, SemanticGeneratorPlan, SemanticGeneratorPlanTask, StateTransitionMapGeneratorPlanTask, StateTransitionPlanEntry } from '../semantic/generation/contract/types.ts';
import { canonicalEquals, compareCodeUnits, deepFreeze, uniqueSorted } from '../system-architecture/foundation/runtime/canonical.ts';
import { CompilerError } from './errors.ts';
import type {
  EngineeringIRIndex
} from './ir/index-engineering-ir.ts';
import { indexValidatedEngineeringIR } from './ir/index-engineering-ir.ts';
import {
  artifactEntityId,
  generatorEntityId,
  normalizedArtifactTarget
} from './ir/ir-identity.ts';
import { assertUniqueSemanticOutputPaths } from './semantic-output-paths.ts';
import { assertStateTransitionFunctions } from './state-transition-plan.ts';

function entityTargets(
  index: EngineeringIRIndex,
  subject: string,
  predicate: SemanticFact['predicate']
): string[] {
  return (index.outgoingFactsBySubject.get(subject) ?? [])
    .filter((fact) => fact.predicate === predicate && fact.object.kind === 'entity')
    .map((fact) => fact.object.kind === 'entity' ? fact.object.entityId : '')
    .filter(Boolean)
    .sort(compareCodeUnits);
}

function requireSingleTarget(
  index: EngineeringIRIndex,
  subject: string,
  predicate: SemanticFact['predicate'],
  code: string
): string {
  const targets = entityTargets(index, subject, predicate);
  if (targets.length !== 1) {
    throw new CompilerError(code, `IR entity "${subject}" requires exactly one ${predicate} target`, {
      subject,
      predicate,
      targets
    });
  }
  return targets[0]!;
}

function attribute(entity: SemanticEntity, key: string): SemanticEntity['attributes'][number]['value'] | undefined {
  return entity.attributes.find((entry) => entry.key === key)?.value;
}

function requireStringAttribute(entity: SemanticEntity, key: string): string {
  const value = attribute(entity, key);
  if (typeof value !== 'string' || !value) {
    throw new CompilerError('GENERATOR-PLAN-006', `IR entity "${entity.id}" requires string attribute "${key}"`);
  }
  return value;
}

function requireStringArrayAttribute(entity: SemanticEntity, key: string): string[] {
  const value = attribute(entity, key);
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new CompilerError('GENERATOR-PLAN-006', `IR entity "${entity.id}" requires string[] attribute "${key}"`);
  }
  return uniqueSorted(value);
}

function stateValues(index: EngineeringIRIndex, stateEntityId: string): string[] {
  const values = (index.outgoingFactsBySubject.get(stateEntityId) ?? [])
    .filter((fact) => fact.predicate === 'GUARANTEES' && fact.object.kind === 'value')
    .map((fact) => fact.object.kind === 'value' ? fact.object.value : null)
    .filter((value): value is string => typeof value === 'string');
  if (values.length === 0) {
    throw new CompilerError('GENERATOR-PLAN-002', `Semantic state "${stateEntityId}" has no IR values`);
  }
  return uniqueSorted(values);
}

function transitionValue(value: SemanticValue, stateEntityId: string): {
  from: string;
  to: string;
  by: string;
} {
  if (
    value === null ||
    Array.isArray(value) ||
    typeof value !== 'object' ||
    typeof value.from !== 'string' ||
    typeof value.to !== 'string' ||
    typeof value.by !== 'string'
  ) {
    throw new CompilerError(
      'GENERATOR-PLAN-007',
      `Semantic state "${stateEntityId}" contains an invalid TRANSITIONS_TO Fact`
    );
  }
  return { from: value.from, to: value.to, by: value.by };
}

function stateTransitions(
  index: EngineeringIRIndex,
  stateEntityId: string
): StateTransitionPlanEntry[] {
  return (index.outgoingFactsBySubject.get(stateEntityId) ?? [])
    .filter((fact) => fact.predicate === 'TRANSITIONS_TO' && fact.object.kind === 'value')
    .map((fact) => {
      const transition = transitionValue(
        fact.object.kind === 'value' ? fact.object.value : null,
        stateEntityId
      );
      const operation = index.entityById.get(transition.by);
      if (!operation || operation.kind !== 'operation') {
        throw new CompilerError(
          'GENERATOR-PLAN-007',
          `Semantic transition operation "${transition.by}" is unavailable`
        );
      }
      return {
        from: transition.from,
        to: transition.to,
        by: operation.label,
        operationEntityId: operation.id
      };
    })
    .sort((left, right) =>
      compareCodeUnits(
        `${left.from}:${left.to}:${left.operationEntityId}`,
        `${right.from}:${right.to}:${right.operationEntityId}`
      )
    );
}

function verificationSelectors(index: EngineeringIRIndex, artifactId: string): string[] {
  return uniqueSorted(
    (index.outgoingFactsBySubject.get(artifactId) ?? [])
      .filter((fact) => fact.predicate === 'VERIFIED_BY' && fact.object.kind === 'value')
      .map((fact) => fact.object.kind === 'value' ? fact.object.value : null)
      .filter((value): value is { selector: string } =>
        value !== null &&
        !Array.isArray(value) &&
        typeof value === 'object' &&
        typeof value.selector === 'string'
      )
      .map((value) => value.selector)
  );
}

function contractPath(
  index: EngineeringIRIndex,
  stateEntityId: string,
  contractId: string
): string {
  const sourceId = `semantic-contract:${contractId}`;
  const paths = uniqueSorted(
    (index.outgoingFactsBySubject.get(stateEntityId) ?? [])
      .flatMap((fact) => fact.assertions)
      .flatMap((assertion) => assertion.provenance)
      .filter((entry) => entry.sourceId === sourceId && entry.sourcePath)
      .map((entry) => entry.sourcePath!)
  );
  if (paths.length !== 1) {
    throw new CompilerError(
      'GENERATOR-PLAN-008',
      `Semantic state "${stateEntityId}" requires exactly one contract provenance path`,
      { stateEntityId, contractId, paths }
    );
  }
  return paths[0]!;
}

function buildStateTransitionTask(
  snapshot: ValidatedEngineeringIRSnapshot,
  index: EngineeringIRIndex,
  source: SemanticGeneratorDeclaration
): StateTransitionMapGeneratorPlanTask {
  const declaration = source.declaration;
  const expectedGeneratorId = generatorEntityId(source.blockId, declaration.id);
  const generator = index.entityById.get(expectedGeneratorId);
  if (!generator || generator.kind !== 'generator') {
    throw new CompilerError('GENERATOR-PLAN-006', `Generator Entity "${expectedGeneratorId}" is unavailable`);
  }
  const target = normalizedArtifactTarget(declaration.target);
  if (
    requireStringAttribute(generator, 'contractId') !== declaration.contract ||
    requireStringAttribute(generator, 'stateId') !== declaration.state ||
    requireStringAttribute(generator, 'target') !== target ||
    requireStringAttribute(generator, 'generatorKind') !== declaration.kind ||
    requireStringAttribute(generator, 'produces') !== declaration.produces ||
    requireStringAttribute(generator, 'typeBindingName') !== declaration.typeBinding.name ||
    requireStringAttribute(generator, 'typeBindingImportFrom') !== declaration.typeBinding.importFrom ||
    !canonicalEquals(requireStringArrayAttribute(generator, 'consumes'), uniqueSorted(declaration.consumes)) ||
    !canonicalEquals(requireStringArrayAttribute(generator, 'verification'), uniqueSorted(declaration.verification))
  ) {
    throw new CompilerError('GENERATOR-PLAN-009', `Generator declaration "${declaration.id}" does not match validated IR`);
  }

  const stateEntityId = requireSingleTarget(index, generator.id, 'CONSUMES', 'GENERATOR-PLAN-002');
  const state = index.entityById.get(stateEntityId);
  if (!state || state.kind !== 'state') {
    throw new CompilerError('GENERATOR-PLAN-002', `Semantic state "${stateEntityId}" is unavailable`);
  }
  const artifactId = requireSingleTarget(index, generator.id, 'GENERATES', 'GENERATOR-PLAN-010');
  const expectedArtifactId = artifactEntityId(target);
  const artifact = index.entityById.get(artifactId);
  if (
    artifactId !== expectedArtifactId ||
    artifact?.kind !== 'artifact' ||
    requireStringAttribute(artifact, 'target') !== target ||
    requireStringAttribute(artifact, 'artifactKind') !== declaration.produces
  ) {
    throw new CompilerError('GENERATOR-PLAN-010', `Generator "${generator.id}" has an invalid Artifact target`);
  }
  if (!entityTargets(index, state.id, 'LOWERS_TO').includes(artifactId)) {
    throw new CompilerError('GENERATOR-PLAN-010', `State "${state.id}" does not lower to "${artifactId}"`);
  }

  const namespacePrefix = 'state:';
  const stateSuffix = `:${declaration.state}`;
  if (!state.id.startsWith(namespacePrefix) || !state.id.endsWith(stateSuffix)) {
    throw new CompilerError('GENERATOR-PLAN-002', `State Entity "${state.id}" does not match selector "${declaration.state}"`);
  }

  const verifiedByEntityIds = entityTargets(index, artifactId, 'VERIFIED_BY');
  const expectedVerifiedByEntityIds = uniqueSorted(
    declaration.verification
      .map((selector) => `acceptance:${selector}`)
      .filter((entityId) => index.entityById.get(entityId)?.kind === 'acceptance')
  );
  const expectedVerificationSelectors = uniqueSorted(
    declaration.verification.filter((selector) => !index.entityById.has(`acceptance:${selector}`))
  );
  if (
    !canonicalEquals(verifiedByEntityIds, expectedVerifiedByEntityIds) ||
    !canonicalEquals(verificationSelectors(index, artifactId), expectedVerificationSelectors)
  ) {
    throw new CompilerError('GENERATOR-PLAN-011', `Artifact "${artifactId}" verification Facts do not match its declaration`);
  }

  return {
    id: expectedGeneratorId,
    blockId: source.blockId,
    generatorId: declaration.id,
    generatorEntityId: generator.id,
    artifactEntityId: artifactId,
    inputRevision: snapshot.ir.inputRevision,
    semanticRevision: snapshot.ir.semanticRevision,
    kind: declaration.kind,
    contractId: declaration.contract,
    contractPath: contractPath(index, state.id, declaration.contract),
    contractNamespace: state.id.slice(namespacePrefix.length, -stateSuffix.length),
    stateId: declaration.state,
    stateEntityId: state.id,
    stateValues: stateValues(index, state.id),
    transitions: stateTransitions(index, state.id),
    target,
    consumes: uniqueSorted(declaration.consumes),
    produces: declaration.produces,
    typeBinding: { ...declaration.typeBinding },
    verification: uniqueSorted(declaration.verification),
    verifiedByEntityIds,
    registrySourceId: source.registrySourceId,
    registryKind: source.registryKind,
    registryLocation: source.registryLocation,
    registryPath: source.registryPath
  };
}

export function buildSemanticGeneratorPlan(
  snapshot: ValidatedEngineeringIRSnapshot,
  declarations: readonly SemanticGeneratorDeclaration[]
): SemanticGeneratorPlan {
  const index = indexValidatedEngineeringIR(snapshot);
  const tasks: SemanticGeneratorPlanTask[] = declarations
    .slice()
    .sort((left, right) =>
      compareCodeUnits(`${left.blockId}:${left.declaration.id}`, `${right.blockId}:${right.declaration.id}`)
    )
    .map((source) => {
      switch (source.declaration.kind) {
        case 'generate-state-transition-map':
          return buildStateTransitionTask(snapshot, index, source);
      }
    });

  assertStateTransitionFunctions(tasks);
  assertUniqueSemanticOutputPaths(tasks);
  return deepFreeze({
    inputRevision: snapshot.ir.inputRevision,
    semanticRevision: snapshot.ir.semanticRevision,
    tasks
  });
}
