/** Test-only deterministic GitHub API capability surface. */
export {
  issueGitHubApiCapabilityForTestSupport as issueGitHubApiTestCapability,
  withGitHubApiEnrollmentSessionForTestSupport as withGitHubApiTestEnrollmentSession,
  withGitHubApiReadOperationBudgetForTestSupport as withGitHubApiTestReadOperationBudget,
  withGitHubApiSessionForTestSupport as withGitHubApiTestSession,
  type GitHubApiTransport
} from '../internal/operation-session-runtime.ts';
