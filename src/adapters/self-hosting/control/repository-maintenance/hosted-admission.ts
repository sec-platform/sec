import type { RepositoryMaintenancePlan } from './plan.ts';

/** Hosted transport identity only; it grants no repository mutation authority. */
export function assertHostedRepositoryMaintenanceIdentity(
  plan: RepositoryMaintenancePlan,
  environment: NodeJS.ProcessEnv
): void {
  const expectedWorkflow = `${plan.repository}/.github/workflows/repository-maintenance.yml@refs/heads/main`;
  if (environment.GITHUB_EVENT_NAME !== 'workflow_dispatch'
      || environment.GITHUB_REPOSITORY !== plan.repository
      || environment.GITHUB_REF !== 'refs/heads/main'
      || environment.GITHUB_SHA !== plan.expectedMainSha
      || environment.GITHUB_WORKFLOW_REF !== expectedWorkflow) {
    throw new Error('repository maintenance must execute from the exact current main workflow_dispatch identity');
  }
}
