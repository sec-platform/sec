export const SEMANTIC_CONTRACT_FORMAT_VERSION = '1' as const;

export const SEMANTIC_EFFECT_KINDS = [
  'database-read',
  'database-write',
  'filesystem-read',
  'filesystem-write',
  'network-connect',
  'network-send',
  'process-spawn',
  'environment-read',
  'secret-read',
  'clock-read',
  'random-read',
  'event-emit',
  'external-service-call'
] as const;

export type SemanticEffectKind = (typeof SEMANTIC_EFFECT_KINDS)[number];

export interface SemanticContractImport {
  alias: string;
  namespace: string;
  contractId: string;
}

export interface SemanticContractField {
  id: string;
  type: string;
  required?: boolean;
  mutable?: boolean;
}

export interface SemanticContractEntity {
  id: string;
  label?: string;
  fields: SemanticContractField[];
}

export interface SemanticContractTransition {
  from: string;
  to: string;
  by: string;
}

export interface SemanticContractState {
  id: string;
  label?: string;
  entity: string;
  field: string;
  owner: string;
  values: string[];
  transitions: SemanticContractTransition[];
}

export const SEMANTIC_RESPONSIBILITY_TARGET_KINDS = [
  'entity',
  'effect',
  'operation',
  'scenario'
] as const;

export type SemanticResponsibilityTargetKind =
  (typeof SEMANTIC_RESPONSIBILITY_TARGET_KINDS)[number];

export interface SemanticContractResponsibilityBinding {
  target: {
    kind: SemanticResponsibilityTargetKind;
    id: string;
  };
  declaration: {
    path: string;
    exportName: string;
  };
}

export interface SemanticContractResponsibility {
  id: string;
  label?: string;
  /** @deprecated Descriptive text only; it is not responsibility authority. */
  role?: string;
  bindings?: SemanticContractResponsibilityBinding[];
  owns: string[];
  implements: string[];
  dependsOn: string[];
}

export interface SemanticContractOperation {
  id: string;
  label?: string;
  responsibility: string;
  inputs: string[];
  output?: string;
  reads: string[];
  writes: string[];
  mutates: string[];
  requiresPolicies: string[];
  requiresPermissions: string[];
  performsEffects: string[];
  emits: string[];
  invokes: string[];
  awaits: string[];
}

export interface SemanticContractEvent {
  id: string;
  label?: string;
  payloadType?: string;
}

export interface SemanticContractPolicy {
  id: string;
  label?: string;
  rule?: string;
  verifiedBy?: string[];
}

export interface SemanticContractPermission {
  id: string;
  label?: string;
  scope?: string;
}

export interface SemanticContractEffect {
  id: string;
  label?: string;
  kind: SemanticEffectKind;
  target?: string;
}

export interface SemanticContractScenarioStep {
  id: string;
  operation: string;
  after: string[];
  awaits?: boolean;
  retryMaxAttempts?: number;
  onError?: string;
}

export interface SemanticContractScenario {
  id: string;
  label?: string;
  entry: string;
  steps: SemanticContractScenarioStep[];
  acceptance: string[];
}

export interface SemanticContract {
  formatVersion: typeof SEMANTIC_CONTRACT_FORMAT_VERSION;
  id: string;
  namespace: string;
  imports?: SemanticContractImport[];
  entities: SemanticContractEntity[];
  states: SemanticContractState[];
  responsibilities: SemanticContractResponsibility[];
  operations: SemanticContractOperation[];
  events: SemanticContractEvent[];
  policies: SemanticContractPolicy[];
  permissions: SemanticContractPermission[];
  effects: SemanticContractEffect[];
  scenarios: SemanticContractScenario[];
}

export interface LoadedSemanticContract {
  blockId: string;
  contractPath: string;
  contract: SemanticContract;
}
