import { sha256 } from '../../../../contracts/canonical.ts';
import { parseRepositoryMaintenanceRequest, type MaintenanceRequest } from './contract.ts';
import { planRepositoryMaintenance, type RepositoryMaintenancePlan } from './plan.ts';

/** Hosted transport identity only; it grants no repository mutation authority. */
export function assertHostedRepositoryMaintenanceIdentity(
  plan: RepositoryMaintenancePlan,
  environment: NodeJS.ProcessEnv
): void {
  const expectedWorkflow = `${plan.repository}/.github/workflows/repository-maintenance.yml@refs/heads/main`;
  if (environment.GITHUB_EVENT_NAME !== 'repository_dispatch'
      || environment.SEC_MAINTENANCE_EVENT_TYPE !== 'sec-repository-maintenance-v1'
      || environment.GITHUB_REPOSITORY !== plan.repository
      || environment.GITHUB_REF !== 'refs/heads/main'
      || environment.GITHUB_SHA !== plan.expectedMainSha
      || environment.GITHUB_WORKFLOW_SHA !== plan.expectedMainSha
      || environment.GITHUB_WORKFLOW_REF !== expectedWorkflow) {
    throw new Error('repository maintenance must execute from the exact current main repository_dispatch identity');
  }
}

/** Decode the hosted input transport before opening any mutation capability.
 * Raw request text is never staged in the repository or included in receipts.
 */
export function parseHostedRepositoryMaintenanceRequest(
  environment: NodeJS.ProcessEnv
): MaintenanceRequest {
  const source = environment.SEC_MAINTENANCE_REQUEST_JSON;
  const expectedDigest = environment.SEC_MAINTENANCE_REQUEST_DIGEST;
  if (typeof source !== 'string' || source.length === 0 || source.length > 131072
      || typeof expectedDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(expectedDigest)) {
    throw new Error('Maintenance request input shape is invalid.');
  }
  const request = parseRepositoryMaintenanceRequest(source);
  if (sha256(request) !== expectedDigest) {
    throw new Error('Maintenance request digest is invalid.');
  }
  assertHostedRepositoryMaintenanceIdentity(planRepositoryMaintenance(request), environment);
  return request;
}
