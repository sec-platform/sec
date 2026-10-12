import { compareCodeUnits, uniqueSortedByKey } from '../../contracts/canonical.ts';
import { CodedFailure } from '../../contracts/failure.ts';
import type { SemanticContract } from './types.ts';

/** v1 machine components are literal, never escaped. Labels and business values are not components. */
export function isSemanticIdentityComponent(value: unknown, fieldTarget = false): value is string {
  return typeof value === 'string' && value.length > 0 && value.trim() === value &&
    !value.includes(':') && !value.includes('\u0000') && (!fieldTarget || !value.includes('.'));
}

export function assertSemanticIdentityComponent(value: unknown, context: string, fieldTarget = false): asserts value is string {
  if (!isSemanticIdentityComponent(value, fieldTarget)) {
    throw new CodedFailure('CONTRACT-SEMANTIC-024', `${context} requires a literal non-empty, trimmed identity component without colon, NUL${fieldTarget ? ' or dot' : ''}`);
  }
}

export function semanticReferenceParts(reference: string): { qualifier?: string; id: string } {
  const parts = reference.split('::');
  if (parts.length === 1) {
    assertSemanticIdentityComponent(reference, 'Semantic reference');
    return { id: reference };
  }
  if (parts.length !== 2) throw new CodedFailure('CONTRACT-SEMANTIC-018', `Malformed qualified semantic reference "${reference}"`);
  assertSemanticIdentityComponent(parts[0], 'Semantic reference qualifier');
  assertSemanticIdentityComponent(parts[1], 'Semantic reference id');
  return { qualifier: parts[0]!, id: parts[1]! };
}

export function semanticTargetParts(target: string): { entityId: string; fieldId?: string } {
  const parts = target.split('.');
  if (parts.length > 2) throw new CodedFailure('CONTRACT-SEMANTIC-024', `Malformed entity/field target "${target}"`);
  assertSemanticIdentityComponent(parts[0], 'Entity target', true);
  if (parts.length === 2) assertSemanticIdentityComponent(parts[1], 'Field target', true);
  return { entityId: parts[0]!, ...(parts.length === 2 ? { fieldId: parts[1]! } : {}) };
}

/** Compare actual tuple components; encoded keys are only for equality, never ordering. */
export function compareSemanticTuple(left: readonly (string | undefined)[], right: readonly (string | undefined)[]): number {
  for (let index = 0; index < Math.min(left.length, right.length); index += 1) {
    const a = left[index];
    const b = right[index];
    const order = a === b ? 0 : a === undefined ? -1 : b === undefined ? 1 : compareCodeUnits(a, b);
    if (order) return order;
  }
  return left.length - right.length;
}

export function uniqueSortedSemanticTuples<Value>(values: readonly Value[], tuple: (value: Value) => readonly (string | undefined)[]): Value[] {
  return uniqueSortedByKey(values, (value) => JSON.stringify(tuple(value)))
    .sort((left, right) => compareSemanticTuple(tuple(left), tuple(right)));
}

/** Also used by the linker, whose typed callers can bypass source normalization. */
export function assertSemanticContractIdentityComponents(contract: SemanticContract): void {
  assertSemanticIdentityComponent(contract.id, 'Semantic contract id');
  assertSemanticIdentityComponent(contract.namespace, 'Semantic namespace');
  for (const entry of contract.imports ?? []) {
    for (const value of [entry.alias, entry.namespace, entry.contractId]) assertSemanticIdentityComponent(value, 'Semantic import');
  }
  const reference = (value: string) => semanticReferenceParts(value);
  const target = (value: string) => semanticTargetParts(reference(value).id);
  for (const entity of contract.entities ?? []) {
    assertSemanticIdentityComponent(entity.id, 'Entity id', true);
    for (const field of entity.fields ?? []) assertSemanticIdentityComponent(field.id, 'Field id', true);
  }
  for (const entries of [contract.states, contract.responsibilities, contract.operations, contract.events, contract.policies, contract.permissions, contract.effects, contract.scenarios]) {
    for (const entry of entries ?? []) assertSemanticIdentityComponent(entry.id, 'Semantic declaration id');
  }
  for (const state of contract.states ?? []) {
    assertSemanticIdentityComponent(reference(state.entity).id, 'State entity', true);
    assertSemanticIdentityComponent(state.field, 'State field', true);
    reference(state.owner);
    for (const transition of state.transitions ?? []) reference(transition.by);
  }
  for (const responsibility of contract.responsibilities ?? []) {
    for (const binding of responsibility.bindings ?? []) {
      reference(binding.target.id);
    }
    for (const value of responsibility.owns ?? []) target(value);
    for (const value of [...(responsibility.implements ?? []), ...(responsibility.dependsOn ?? [])]) reference(value);
  }
  for (const operation of contract.operations ?? []) {
    reference(operation.responsibility);
    for (const value of [...(operation.reads ?? []), ...(operation.writes ?? []), ...(operation.mutates ?? [])]) target(value);
    for (const value of [...(operation.requiresPolicies ?? []), ...(operation.requiresPermissions ?? []), ...(operation.performsEffects ?? []), ...(operation.emits ?? []), ...(operation.invokes ?? []), ...(operation.awaits ?? [])]) reference(value);
  }
  for (const policy of contract.policies ?? []) {
    for (const value of policy.verifiedBy ?? []) assertSemanticIdentityComponent(value, 'Verification policy id');
  }
  for (const scenario of contract.scenarios ?? []) {
    reference(scenario.entry);
    for (const value of scenario.acceptance ?? []) assertSemanticIdentityComponent(value, 'Acceptance id');
    for (const step of scenario.steps ?? []) {
      assertSemanticIdentityComponent(step.id, 'Scenario step id');
      reference(step.operation);
      for (const value of step.after ?? []) assertSemanticIdentityComponent(value, 'Scenario dependency id');
      if (step.onError !== undefined) assertSemanticIdentityComponent(step.onError, 'Scenario recovery step id');
    }
  }
}
