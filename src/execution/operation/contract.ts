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
