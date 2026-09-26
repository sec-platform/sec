/**
 * Sole production GitHub API surface.
 *
 * Deterministic transports and capability issuers live under ./test/, whose
 * path is rejected by the canonical repository module graph when imported by
 * production source.
 */
export {
  GITHUB_API_READ_OPERATION_TIMEOUT_MS,
  GITHUB_API_REQUEST_TIMEOUT_MS,
  GitHubApiProviderError,
  assertGitHubApiCapability,
  assertGitHubApiReadOperationBudgetCurrent,
  currentGitHubApiCapability,
  executeGitHubApiOperation,
  executeObservedGitHubApiOperation,
  readGitHubApiBytes,
  inspectGitHubApiCapability, withGitHubApiBranchCloseoutWriteSession, withGitHubApiIssueCommentWriteSession, withGitHubApiMergeWriteSession, withGitHubApiReadOperationBudget,
  withGitHubApiReadSession,
  withGitHubApiRepositoryDispatchWriteSession,
  withGitHubApiRunnerAdminSession,
  withGitHubApiStatusWriteSession,
  type GitHubApiCapability,
  type GitHubApiByteOperation,
  type GitHubApiEffect,
  type GitHubApiOperation,
  type GitHubApiPrincipal
} from './internal/operation-session-runtime.ts';
