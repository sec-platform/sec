import { compareCodeUnits } from '../../contracts/canonical.ts';

/** Algorithm-independent semantic operation vocabulary shared by identity generations. */
export const OPERATION_EFFECT_KINDS = Object.freeze([
  'filesystem',
  'network',
  'persistent-state',
  'process',
  'provider'
] as const);

export type OperationEffectKind = (typeof OPERATION_EFFECT_KINDS)[number];

export const OPERATION_BUDGET_RESOURCES = Object.freeze([
  'duration-ms',
  'input-bytes',
  'output-bytes',
  'processes',
  'records'
] as const);

export type OperationBudgetResource = (typeof OPERATION_BUDGET_RESOURCES)[number];

export const PROCESS_OPERATION_BUDGET_RESOURCES = Object.freeze([
  'duration-ms',
  'input-bytes',
  'output-bytes',
  'processes'
] as const satisfies readonly OperationBudgetResource[]);

export type OperationBudget = Readonly<{
  readonly resource: OperationBudgetResource;
  readonly maximum: number;
}>;

export function canonicalUniqueOperationStrings(
  values: readonly string[],
  label: string
): readonly string[] {
  const canonical = [...values].sort(compareCodeUnits);
  if (canonical.some((value) => value.length === 0 || value.trim() !== value)
      || new Set(canonical).size !== canonical.length) {
    throw new Error(`${label} must contain unique non-empty canonical values.`);
  }
  return Object.freeze(canonical);
}

export function isCanonicalOperationBudgetMaximum(
  resource: OperationBudgetResource,
  maximum: number
): boolean {
  return OPERATION_BUDGET_RESOURCES.includes(resource)
    && Number.isSafeInteger(maximum)
    && (maximum > 0 || (resource === 'input-bytes' && maximum === 0));
}

export function canonicalOperationBudget(budget: OperationBudget): OperationBudget {
  const keys = Object.keys(budget).sort(compareCodeUnits);
  if (keys.length !== 2 || keys[0] !== 'maximum' || keys[1] !== 'resource'
      || !isCanonicalOperationBudgetMaximum(budget.resource, budget.maximum)) {
    throw new Error('Semantic operation aggregate budget is not canonical.');
  }
  return Object.freeze({ resource: budget.resource, maximum: budget.maximum });
}

export function canonicalOperationEffectKinds(
  values: readonly string[],
  label: string
): readonly OperationEffectKind[] {
  const canonical = canonicalUniqueOperationStrings(values, label);
  if (canonical.some((kind) => !OPERATION_EFFECT_KINDS.includes(kind as OperationEffectKind))) {
    throw new Error(`${label} contains an unsupported Effect kind.`);
  }
  return canonical as readonly OperationEffectKind[];
}
