import { compareCodeUnits, stableById, uniqueSorted } from '../../contracts/canonical.ts';
import { FailureError as CompilerError } from '../../contracts/failure.ts';
import { isSafeRelativePath, posixPath } from '../../contracts/relative-path.ts';
import { SEMANTIC_CONTRACT_FORMAT_VERSION, SEMANTIC_EFFECT_KINDS, SEMANTIC_RESPONSIBILITY_TARGET_KINDS, type SemanticContract, type SemanticContractEffect, type SemanticContractEntity, type SemanticContractImport, type SemanticContractOperation, type SemanticContractResponsibility, type SemanticContractResponsibilityBinding, type SemanticContractScenario, type SemanticContractScenarioStep, type SemanticContractState, type SemanticContractTransition } from './types.ts';

function assertId(value: string | undefined, context: string): asserts value is string {
  if (!value?.trim()) {
    throw new CompilerError('CONTRACT-SEMANTIC-001', `${context} requires a non-empty id`);
  }
}

function assertUniqueIds(values: readonly { id: string }[], context: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    assertId(value.id, context);
    if (seen.has(value.id)) {
      throw new CompilerError('CONTRACT-SEMANTIC-002', `${context} contains duplicate id "${value.id}"`);
    }
    seen.add(value.id);
  }
}

function normalizeEntity(entity: SemanticContractEntity): SemanticContractEntity {
  return {
    ...entity,
    fields: stableById((entity.fields ?? []).map((field) => ({
      ...field,
      required: field.required ?? false,
      mutable: field.mutable ?? false
    })))
  };
}

function normalizeTransition(transition: SemanticContractTransition): SemanticContractTransition {
  return { ...transition };
}

function normalizeState(state: SemanticContractState): SemanticContractState {
  return {
    ...state,
    values: uniqueSorted(state.values ?? []),
    transitions: [...(state.transitions ?? [])]
      .map(normalizeTransition)
      .sort((left, right) => compareCodeUnits(`${left.from}:${left.to}:${left.by}`, `${right.from}:${right.to}:${right.by}`))
  };
}

function normalizeResponsibilityBinding(
  binding: SemanticContractResponsibilityBinding
): SemanticContractResponsibilityBinding {
  return {
    target: { ...binding.target },
    declaration: {
      path: posixPath(binding.declaration.path),
      exportName: binding.declaration.exportName
    }
  };
}

function normalizeResponsibility(responsibility: SemanticContractResponsibility): SemanticContractResponsibility {
  const { role: _legacyRole, ...authoritative } = responsibility;
  return {
    ...authoritative,
    bindings: [...(responsibility.bindings ?? [])]
      .map(normalizeResponsibilityBinding)
      .sort((left, right) => compareCodeUnits(
        `${left.target.kind}:${left.target.id}:${left.declaration.path}:${left.declaration.exportName}`,
        `${right.target.kind}:${right.target.id}:${right.declaration.path}:${right.declaration.exportName}`
      )),
    owns: uniqueSorted(responsibility.owns ?? []),
    implements: uniqueSorted(responsibility.implements ?? []),
    dependsOn: uniqueSorted(responsibility.dependsOn ?? [])
  };
}

function normalizeOperation(operation: SemanticContractOperation): SemanticContractOperation {
  return {
    ...operation,
    inputs: [...(operation.inputs ?? [])],
    reads: uniqueSorted(operation.reads ?? []),
    writes: uniqueSorted(operation.writes ?? []),
    mutates: uniqueSorted(operation.mutates ?? []),
    requiresPolicies: uniqueSorted(operation.requiresPolicies ?? []),
    requiresPermissions: uniqueSorted(operation.requiresPermissions ?? []),
    performsEffects: uniqueSorted(operation.performsEffects ?? []),
    emits: uniqueSorted(operation.emits ?? []),
    invokes: uniqueSorted(operation.invokes ?? []),
    awaits: uniqueSorted(operation.awaits ?? [])
  };
}

function normalizeScenarioStep(step: SemanticContractScenarioStep): SemanticContractScenarioStep {
  return {
    ...step,
    after: uniqueSorted(step.after ?? [])
  };
}

function normalizeScenario(scenario: SemanticContractScenario): SemanticContractScenario {
  return {
    ...scenario,
    steps: stableById((scenario.steps ?? []).map(normalizeScenarioStep)),
    acceptance: uniqueSorted(scenario.acceptance ?? [])
  };
}

function normalizeEffect(effect: SemanticContractEffect): SemanticContractEffect {
  return { ...effect };
}

function normalizeImport(entry: SemanticContractImport): SemanticContractImport {
  return { ...entry };
}

function isQualifiedReference(value: string): boolean {
  const segments = value.split('::');
  if (segments.length === 1) return false;
  if (segments.length !== 2 || segments.some((segment) => !segment.trim())) {
    throw new CompilerError('CONTRACT-SEMANTIC-018', `Malformed qualified semantic reference "${value}"`);
  }
  return true;
}

function targetExists(target: string, entities: Map<string, SemanticContractEntity>): boolean {
  const [entityId, fieldId, ...rest] = target.split('.');
  const entity = entities.get(entityId ?? '');
  if (!entity || rest.length > 0) return false;
  if (!fieldId) return true;
  return entity.fields.some((field) => field.id === fieldId);
}

function assertReference(set: ReadonlySet<string>, value: string, context: string): void {
  if (isQualifiedReference(value)) return;
  if (!set.has(value)) {
    throw new CompilerError('CONTRACT-SEMANTIC-003', `${context} references unknown id "${value}"`);
  }
}

function assertTargetReference(entities: Map<string, SemanticContractEntity>, value: string, context: string): void {
  if (isQualifiedReference(value)) return;
  if (!targetExists(value, entities)) {
    throw new CompilerError('CONTRACT-SEMANTIC-004', `${context} references unknown entity or field "${value}"`);
  }
}

function assertOperationResponsibilityConsistency(contract: SemanticContract): void {
  const responsibilityByOperation = new Map<string, string>();
  for (const responsibility of contract.responsibilities) {
    for (const operationId of responsibility.implements) {
      if (isQualifiedReference(operationId)) continue;
      const existing = responsibilityByOperation.get(operationId);
      if (existing && existing !== responsibility.id) {
        throw new CompilerError(
          'CONTRACT-SEMANTIC-017',
          `Operation "${operationId}" is listed by multiple responsibilities: "${existing}" and "${responsibility.id}"`
        );
      }
      responsibilityByOperation.set(operationId, responsibility.id);
    }
  }

  for (const operation of contract.operations) {
    if (isQualifiedReference(operation.responsibility)) continue;
    const listedResponsibility = responsibilityByOperation.get(operation.id);
    if (listedResponsibility !== operation.responsibility) {
      throw new CompilerError(
        'CONTRACT-SEMANTIC-017',
        `Operation "${operation.id}" responsibility "${operation.responsibility}" does not match implements owner "${listedResponsibility ?? 'none'}"`
      );
    }
  }
}

export function normalizeSemanticContract(input: SemanticContract): SemanticContract {
  if (input?.formatVersion !== SEMANTIC_CONTRACT_FORMAT_VERSION) {
    throw new CompilerError(
      'CONTRACT-SEMANTIC-005',
      `Semantic contract must use formatVersion "${SEMANTIC_CONTRACT_FORMAT_VERSION}"`
    );
  }
  assertId(input.id, 'Semantic contract');
  if (!input.namespace?.trim()) {
    throw new CompilerError('CONTRACT-SEMANTIC-006', `Semantic contract "${input.id}" requires namespace`);
  }

  const contract: SemanticContract = {
    formatVersion: SEMANTIC_CONTRACT_FORMAT_VERSION,
    id: input.id,
    namespace: input.namespace,
    imports: [...(input.imports ?? [])]
      .map(normalizeImport)
      .sort((left, right) => compareCodeUnits(left.alias, right.alias)),
    entities: stableById((input.entities ?? []).map(normalizeEntity)),
    states: stableById((input.states ?? []).map(normalizeState)),
    responsibilities: stableById((input.responsibilities ?? []).map(normalizeResponsibility)),
    operations: stableById((input.operations ?? []).map(normalizeOperation)),
    events: stableById(input.events ?? []),
    policies: stableById((input.policies ?? []).map((policy) => ({
      ...policy,
      verifiedBy: uniqueSorted(policy.verifiedBy ?? [])
    }))),
    permissions: stableById(input.permissions ?? []),
    effects: stableById((input.effects ?? []).map(normalizeEffect)),
    scenarios: stableById((input.scenarios ?? []).map(normalizeScenario))
  };

  assertUniqueIds(contract.entities, `Semantic contract "${contract.id}" entities`);
  assertUniqueIds(contract.states, `Semantic contract "${contract.id}" states`);
  assertUniqueIds(contract.responsibilities, `Semantic contract "${contract.id}" responsibilities`);
  assertUniqueIds(contract.operations, `Semantic contract "${contract.id}" operations`);
  assertUniqueIds(contract.events, `Semantic contract "${contract.id}" events`);
  assertUniqueIds(contract.policies, `Semantic contract "${contract.id}" policies`);
  assertUniqueIds(contract.permissions, `Semantic contract "${contract.id}" permissions`);
  assertUniqueIds(contract.effects, `Semantic contract "${contract.id}" effects`);
  assertUniqueIds(contract.scenarios, `Semantic contract "${contract.id}" scenarios`);

  for (const entry of contract.imports ?? []) {
    assertId(entry.alias, `Semantic contract "${contract.id}" import`);
    assertId(entry.namespace, `Semantic contract "${contract.id}" import namespace`);
    assertId(entry.contractId, `Semantic contract "${contract.id}" import contractId`);
  }

  const entities = new Map(contract.entities.map((entity) => [entity.id, entity]));
  for (const entity of contract.entities) {
    assertUniqueIds(entity.fields, `Entity "${entity.id}" fields`);
    for (const field of entity.fields) {
      if (!field.type?.trim()) {
        throw new CompilerError('CONTRACT-SEMANTIC-007', `Field "${entity.id}.${field.id}" requires type`);
      }
    }
  }

  const responsibilityIds = new Set(contract.responsibilities.map((entry) => entry.id));
  const operationIds = new Set(contract.operations.map((entry) => entry.id));
  const eventIds = new Set(contract.events.map((entry) => entry.id));
  const policyIds = new Set(contract.policies.map((entry) => entry.id));
  const permissionIds = new Set(contract.permissions.map((entry) => entry.id));
  const effectIds = new Set(contract.effects.map((entry) => entry.id));
  const entityIds = new Set(contract.entities.map((entry) => entry.id));
  const scenarioIds = new Set(contract.scenarios.map((entry) => entry.id));

  for (const state of contract.states) {
    if (!isQualifiedReference(state.entity)) {
      const entity = entities.get(state.entity);
      if (!entity) {
        throw new CompilerError('CONTRACT-SEMANTIC-008', `State "${state.id}" references unknown entity "${state.entity}"`);
      }
      if (!entity.fields.some((field) => field.id === state.field)) {
        throw new CompilerError('CONTRACT-SEMANTIC-009', `State "${state.id}" references unknown field "${state.entity}.${state.field}"`);
      }
    } else if (!state.field?.trim()) {
      throw new CompilerError('CONTRACT-SEMANTIC-009', `State "${state.id}" requires a field`);
    }
    assertReference(responsibilityIds, state.owner, `State "${state.id}" owner`);
    if (state.values.length === 0) {
      throw new CompilerError('CONTRACT-SEMANTIC-010', `State "${state.id}" requires at least one value`);
    }
    const values = new Set(state.values);
    for (const transition of state.transitions) {
      if (!values.has(transition.from) || !values.has(transition.to)) {
        throw new CompilerError('CONTRACT-SEMANTIC-011', `State "${state.id}" transition ${transition.from}->${transition.to} uses unknown value`);
      }
      assertReference(operationIds, transition.by, `State "${state.id}" transition`);
    }
  }

  for (const responsibility of contract.responsibilities) {
    const bindingTargets = new Set<string>();
    const bindingDeclarations = new Set<string>();
    for (const binding of responsibility.bindings ?? []) {
      if (!SEMANTIC_RESPONSIBILITY_TARGET_KINDS.includes(binding.target.kind)) {
        throw new CompilerError('CONTRACT-SEMANTIC-019', `Responsibility "${responsibility.id}" binding uses unsupported target kind "${String(binding.target.kind)}"`);
      }
      assertId(binding.target.id, `Responsibility "${responsibility.id}" binding target`);
      const targetSet = binding.target.kind === 'entity'
        ? entityIds
        : binding.target.kind === 'effect'
          ? effectIds
          : binding.target.kind === 'operation'
            ? operationIds
            : scenarioIds;
      assertReference(targetSet, binding.target.id, `Responsibility "${responsibility.id}" binding target`);
      if (!binding.declaration.path || !isSafeRelativePath(binding.declaration.path)) {
        throw new CompilerError('CONTRACT-SEMANTIC-020', `Responsibility "${responsibility.id}" binding declaration path must be repository-relative`);
      }
      assertId(binding.declaration.exportName, `Responsibility "${responsibility.id}" binding declaration exportName`);
      const targetKey = `${binding.target.kind}:${binding.target.id}`;
      const declarationKey = `${binding.declaration.path}:${binding.declaration.exportName}`;
      if (bindingTargets.has(targetKey)) {
        throw new CompilerError('CONTRACT-SEMANTIC-021', `Responsibility "${responsibility.id}" repeats binding target "${targetKey}"`);
      }
      if (bindingDeclarations.has(declarationKey)) {
        throw new CompilerError('CONTRACT-SEMANTIC-021', `Responsibility "${responsibility.id}" repeats binding declaration "${declarationKey}"`);
      }
      bindingTargets.add(targetKey);
      bindingDeclarations.add(declarationKey);
    }
    for (const target of responsibility.owns) assertTargetReference(entities, target, `Responsibility "${responsibility.id}" owns`);
    for (const operation of responsibility.implements) assertReference(operationIds, operation, `Responsibility "${responsibility.id}" implements`);
    for (const dependency of responsibility.dependsOn) assertReference(responsibilityIds, dependency, `Responsibility "${responsibility.id}" dependsOn`);
  }

  for (const operation of contract.operations) {
    assertReference(responsibilityIds, operation.responsibility, `Operation "${operation.id}" responsibility`);
    for (const target of [...operation.reads, ...operation.writes, ...operation.mutates]) {
      assertTargetReference(entities, target, `Operation "${operation.id}" data access`);
    }
    for (const policy of operation.requiresPolicies) assertReference(policyIds, policy, `Operation "${operation.id}" requiresPolicies`);
    for (const permission of operation.requiresPermissions) assertReference(permissionIds, permission, `Operation "${operation.id}" requiresPermissions`);
    for (const effect of operation.performsEffects) assertReference(effectIds, effect, `Operation "${operation.id}" performsEffects`);
    for (const event of operation.emits) assertReference(eventIds, event, `Operation "${operation.id}" emits`);
    for (const invoked of [...operation.invokes, ...operation.awaits]) assertReference(operationIds, invoked, `Operation "${operation.id}" execution relation`);
  }
  assertOperationResponsibilityConsistency(contract);

  for (const effect of contract.effects) {
    if (!SEMANTIC_EFFECT_KINDS.includes(effect.kind)) {
      throw new CompilerError('CONTRACT-SEMANTIC-013', `Effect "${effect.id}" uses unsupported kind "${String(effect.kind)}"`);
    }
  }

  for (const scenario of contract.scenarios) {
    assertReference(operationIds, scenario.entry, `Scenario "${scenario.id}" entry`);
    assertUniqueIds(scenario.steps, `Scenario "${scenario.id}" steps`);
    const stepIds = new Set(scenario.steps.map((step) => step.id));
    for (const step of scenario.steps) {
      assertReference(operationIds, step.operation, `Scenario "${scenario.id}" step "${step.id}" operation`);
      for (const dependency of step.after) assertReference(stepIds, dependency, `Scenario "${scenario.id}" step "${step.id}" after`);
      if (step.onError) assertReference(stepIds, step.onError, `Scenario "${scenario.id}" step "${step.id}" onError`);
      if (step.retryMaxAttempts !== undefined && (!Number.isInteger(step.retryMaxAttempts) || step.retryMaxAttempts < 1)) {
        throw new CompilerError('CONTRACT-SEMANTIC-014', `Scenario "${scenario.id}" step "${step.id}" retryMaxAttempts must be a positive integer`);
      }
    }
  }

  return contract;
}
