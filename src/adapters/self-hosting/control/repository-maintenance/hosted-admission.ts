import {
  parseRepositoryMaintenanceRequest,
  type MaintenanceRequest
} from './contract.ts';

export const REPOSITORY_MAINTENANCE_ISSUE_NUMBER = 313 as const;
export const REPOSITORY_MAINTENANCE_WORKFLOW_PATH =
  '.github/workflows/repository-maintenance.yml' as const;

function positiveIntegerText(value: string | undefined, label: string): number {
  if (value === undefined || !/^[1-9][0-9]*$/u.test(value)) {
    throw new Error(`${label} must be one positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`${label} exceeds the safe integer range`);
  return parsed;
}

export function assertHostedRepositoryMaintenanceIdentity(
  request: MaintenanceRequest,
  environment: NodeJS.ProcessEnv
): void {
  const workflowRef =
    `${request.repository}/${REPOSITORY_MAINTENANCE_WORKFLOW_PATH}@refs/heads/main`;
  const issueNumber = positiveIntegerText(
    environment.SEC_MAINTENANCE_ISSUE_NUMBER,
    'SEC_MAINTENANCE_ISSUE_NUMBER'
  );
  positiveIntegerText(environment.SEC_MAINTENANCE_COMMENT_ID, 'SEC_MAINTENANCE_COMMENT_ID');
  const association = environment.SEC_MAINTENANCE_AUTHOR_ASSOCIATION;
  const author = environment.SEC_MAINTENANCE_COMMENT_AUTHOR;
  if (environment.GITHUB_ACTIONS !== 'true'
      || environment.GITHUB_SERVER_URL !== 'https://github.com'
      || environment.GITHUB_API_URL !== 'https://api.github.com'
      || environment.GITHUB_EVENT_NAME !== 'issue_comment'
      || issueNumber !== REPOSITORY_MAINTENANCE_ISSUE_NUMBER
      || (association !== 'OWNER' && association !== 'MEMBER')
      || typeof author !== 'string' || author.length === 0
      || environment.GITHUB_ACTOR !== author
      || environment.GITHUB_REPOSITORY !== request.repository
      || environment.GITHUB_REF !== 'refs/heads/main'
      || environment.GITHUB_SHA !== request.expectedMainSha
      || environment.GITHUB_WORKFLOW_SHA !== request.expectedMainSha
      || environment.GITHUB_WORKFLOW_REF !== workflowRef) {
    throw new Error(
      'repository maintenance must execute from one maintainer-authored #313 issue_comment on exact current main'
    );
  }
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
