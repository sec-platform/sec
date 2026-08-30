export type SlotCapabilityModuleSyntax =
  | 'import'
  | 'import-equals'
  | 'reexport'
  | 'require'
  | 'dynamic-import';

export type SlotCapabilityGlobalSyntax =
  | 'call'
  | 'constructor'
  | 'identifier'
  | 'root';

export type SlotCapabilityObservation = Readonly<{
  source: string;
  text: string;
}> & (
  | Readonly<{
      kind: 'runtime-module';
      moduleSpecifier: string | null;
      syntax: SlotCapabilityModuleSyntax;
    }>
  | Readonly<{
      capability: string;
      kind: 'runtime-global';
      syntax: SlotCapabilityGlobalSyntax;
    }>
);

export interface SlotCapabilityObservationBatch {
  readonly observations: readonly SlotCapabilityObservation[];
  readonly provider: Readonly<{
    id: 'typescript-compiler-api';
    revision: string;
  }>;
}

interface CustomSlotDirectCapabilityIntent {
  readonly allowedRuntimeGlobals: readonly string[];
  readonly allowedRuntimeModules: readonly string[];
  readonly dynamicModuleSpecifiers: 'forbidden' | 'allowed';
}

export const CUSTOM_SLOT_DIRECT_CAPABILITY_INTENT: CustomSlotDirectCapabilityIntent = Object.freeze({
  allowedRuntimeGlobals: Object.freeze([]),
  allowedRuntimeModules: Object.freeze([]),
  dynamicModuleSpecifiers: 'forbidden'
});

export type SlotCapabilityDecision =
  | Readonly<{ status: 'allowed' }>
  | Readonly<{
      code: 'SLOT-LINT-002' | 'SLOT-LINT-003' | 'SLOT-LINT-004' | 'SLOT-LINT-005';
      reason:
        | 'dynamic-module'
        | 'host-runtime-module'
        | 'runtime-capability'
        | 'unresolved-runtime-module';
      status: 'rejected';
    }>;

const HOST_RUNTIME_MODULES = new Set([
  'child_process',
  'cluster',
  'fs',
  'fs/promises',
  'module',
  'net',
  'os',
  'vm',
  'worker_threads'
]);

function normalizedRuntimeModule(specifier: string): string {
  return specifier.startsWith('node:') ? specifier.slice('node:'.length) : specifier;
}

export function evaluateCustomSlotCapabilityObservation(
  observation: SlotCapabilityObservation
): SlotCapabilityDecision {
  const intent = CUSTOM_SLOT_DIRECT_CAPABILITY_INTENT;
  if (observation.kind === 'runtime-global') {
    return intent.allowedRuntimeGlobals.includes(observation.capability)
      ? Object.freeze({ status: 'allowed' })
      : Object.freeze({
          code: 'SLOT-LINT-004',
          reason: 'runtime-capability',
          status: 'rejected'
        });
  }
  if (observation.moduleSpecifier === null) {
    if (observation.syntax === 'import-equals') {
      return Object.freeze({
        code: 'SLOT-LINT-005',
        reason: 'unresolved-runtime-module',
        status: 'rejected'
      });
    }
    return intent.dynamicModuleSpecifiers === 'allowed'
      ? Object.freeze({ status: 'allowed' })
      : Object.freeze({
          code: 'SLOT-LINT-003',
          reason: 'dynamic-module',
          status: 'rejected'
        });
  }
  const normalized = normalizedRuntimeModule(observation.moduleSpecifier);
  if (intent.allowedRuntimeModules.some((specifier) =>
    normalizedRuntimeModule(specifier) === normalized)) {
    return Object.freeze({ status: 'allowed' });
  }
  return HOST_RUNTIME_MODULES.has(normalized)
    ? Object.freeze({
        code: 'SLOT-LINT-002',
        reason: 'host-runtime-module',
        status: 'rejected'
      })
    : Object.freeze({
        code: 'SLOT-LINT-005',
        reason: 'unresolved-runtime-module',
        status: 'rejected'
      });
}
