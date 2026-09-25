import type { MaintenanceOperation, MaintenanceRequest } from './contract.ts';

export const REPOSITORY_MAINTENANCE_PLAN_SCHEMA = 'sec-repository-maintenance-plan-v1' as const;

export type RepositoryMaintenancePlan = Readonly<{
  schema: typeof REPOSITORY_MAINTENANCE_PLAN_SCHEMA;
  repository: string;
  expectedMainSha: string;
  steps: readonly MaintenanceOperation[];
}>;

/** Pure projection only. It selects no physical permission and performs no I/O. */
export function planRepositoryMaintenance(request: MaintenanceRequest): RepositoryMaintenancePlan {
  return Object.freeze({
    schema: REPOSITORY_MAINTENANCE_PLAN_SCHEMA,
    repository: request.repository,
    expectedMainSha: request.expectedMainSha,
    steps: Object.freeze([...request.operations])
  });
}
