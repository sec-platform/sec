import {
  parseRepositoryMaintenanceRequest,
  REPOSITORY_MAINTENANCE_REQUEST_SCHEMA,
  type MaintenanceRequest
} from './contract.ts';

const REPOSITORY_MAINTENANCE_WORKFLOW_PATH =
  '.github/workflows/repository-maintenance.yml' as const;

export function assertHostedRepositoryMaintenanceIdentity(
  request: MaintenanceRequest,
  environment: NodeJS.ProcessEnv
): void {
  const workflowRef =
    `${request.repository}/${REPOSITORY_MAINTENANCE_WORKFLOW_PATH}@refs/heads/main`;
  if (request.schema !== REPOSITORY_MAINTENANCE_REQUEST_SCHEMA
      || environment.GITHUB_ACTIONS !== 'true'
      || environment.GITHUB_SERVER_URL !== 'https://github.com'
      || environment.GITHUB_API_URL !== 'https://api.github.com'
      || environment.GITHUB_EVENT_NAME !== 'workflow_dispatch'
      || environment.GITHUB_RUN_ATTEMPT !== '1'
      || typeof environment.GITHUB_ACTOR !== 'string' || environment.GITHUB_ACTOR.length === 0
      || environment.GITHUB_REPOSITORY !== request.repository
      || environment.GITHUB_REF !== 'refs/heads/main'
      || environment.GITHUB_SHA !== request.expectedMainSha
      || environment.GITHUB_WORKFLOW_SHA !== request.expectedMainSha
      || environment.GITHUB_WORKFLOW_REF !== workflowRef) {
    throw new Error('repository maintenance requires one explicit maintainer workflow_dispatch batch on exact current main');
  }
  // These environment fields select the lane; the original GitHub capability owner
  // separately reads the native event, live run and maintainer permission, then binds
  // the request digest. Caller text and this structural check cannot issue authority.
}

export function parseHostedRepositoryMaintenanceRequest(
  environment: NodeJS.ProcessEnv
): MaintenanceRequest {
  const source = environment.SEC_MAINTENANCE_REQUEST_JSON;
  if (typeof source !== 'string' || source.length === 0) {
    throw new Error('SEC_MAINTENANCE_REQUEST_JSON is absent');
  }
  const request = parseRepositoryMaintenanceRequest(source);
  assertHostedRepositoryMaintenanceIdentity(request, environment);
  return request;
}
