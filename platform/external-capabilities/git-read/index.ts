export {
  createAuthorityGitReadSessionV1,
  isolatedGitChildEnvironment,
  isolatedGitReadEnvironment,
  type GitExecutableIdentityV1,
  type GitReadProviderFailureV1,
  type GitReadProviderIdentityV1,
  type GitReadProviderResolutionFailureV1,
  type GitReadProviderRouteV1,
  type GitReadProviderStatusV1,
  type GitReadSessionBudgetV1,
  type GitReadSessionCommandV1,
  type GitReadSessionFailureV1,
  type GitReadSessionResolutionV1,
  type GitReadSessionV1
} from './runtime/session.ts';

import {
  createAuthorityGitReadSessionV1,
  type GitReadProviderResolutionFailureV1,
  type GitReadSessionFailureV1,
  type GitReadSessionV1
} from './runtime/session.ts';

export class GitReadAuthorityErrorV1 extends Error {
  constructor(
    message: string,
    readonly failure: GitReadProviderResolutionFailureV1 | GitReadSessionFailureV1
  ) {
    super(message);
    this.name = 'GitReadAuthorityErrorV1';
  }
}

/**
 * One authority-owned session lifetime. A result cannot leave this boundary
 * until terminal provider settlement has completed and the session remains
 * failure-free.
 */
export async function withAuthorityGitReadSessionV1<T>(
  input: Parameters<typeof createAuthorityGitReadSessionV1>[0],
  operation: (session: GitReadSessionV1) => Promise<T>
): Promise<T> {
  const resolution = createAuthorityGitReadSessionV1(input);
  if (resolution.status !== 'ready') {
    throw new GitReadAuthorityErrorV1('Git read provider is unavailable.', resolution);
  }
  const session = resolution.session;
  let result: T | undefined;
  let primaryError: unknown;
  try {
    result = await operation(session);
  } catch (error) {
    primaryError = error;
  }
  try {
    await session.close?.();
  } catch (error) {
    primaryError ??= error;
  }
  if (primaryError !== undefined) throw primaryError;
  if (session.failure !== null) {
    throw new GitReadAuthorityErrorV1('Git read session failed terminal settlement.', session.failure);
  }
  return result as T;
}
