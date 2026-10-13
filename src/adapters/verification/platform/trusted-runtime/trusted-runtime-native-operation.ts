import {
  LINUX_VERIFICATION_UNIT_CONTRACT_DIGEST,
  LINUX_VERIFICATION_UNIT_REQUIREMENT_ID
} from '../../../runtime-state/physical/runtime/linux-verification-unit.ts';

/** Shared native workspace limits and requirement; these data grant no Effect. */
export const TRUSTED_RUNTIME_CONTAINER_OPERATION_BUDGET = Object.freeze({
  durationMs: 4 * 60 * 60_000,
  inputBytes: 64 * 1024 * 1024,
  outputBytes: 512 * 1024 * 1024,
  processes: 512
});

export const TRUSTED_RUNTIME_NATIVE_REQUIREMENT = Object.freeze({
  id: LINUX_VERIFICATION_UNIT_REQUIREMENT_ID,
  contractDigest: LINUX_VERIFICATION_UNIT_CONTRACT_DIGEST,
  effectKinds: Object.freeze(['filesystem', 'process', 'provider', 'persistent-state'] as const),
  failureKinds: Object.freeze(['native-unit.admission-failed', 'native-unit.execution-failed', 'native-unit.settlement-unknown'])
});

export const TRUSTED_RUNTIME_NATIVE_BUDGETS = Object.freeze([
  Object.freeze({ resource: 'duration-ms', maximum: TRUSTED_RUNTIME_CONTAINER_OPERATION_BUDGET.durationMs }),
  Object.freeze({ resource: 'input-bytes', maximum: TRUSTED_RUNTIME_CONTAINER_OPERATION_BUDGET.inputBytes }),
  Object.freeze({ resource: 'output-bytes', maximum: TRUSTED_RUNTIME_CONTAINER_OPERATION_BUDGET.outputBytes }),
  Object.freeze({ resource: 'processes', maximum: TRUSTED_RUNTIME_CONTAINER_OPERATION_BUDGET.processes })
]);
