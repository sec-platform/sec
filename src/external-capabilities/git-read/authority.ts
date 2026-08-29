import {
  createAuthorityGitReadSession,
  type GitReadProviderResolutionFailure,
  type GitReadSessionFailure,
  type GitReadSession
} from './runtime/session.ts';

export class GitReadAuthorityError extends Error {
  constructor(
    message: string,
    readonly failure: GitReadProviderResolutionFailure | GitReadSessionFailure
  ) {
    super(message);
    this.name = 'GitReadAuthorityError';
  }
}

/**
 * One authority-owned session lifetime. A result cannot leave this boundary
 * until terminal provider settlement has completed and the session remains
 * failure-free.
 */
export async function withAuthorityGitReadSession<T>(
  input: Parameters<typeof createAuthorityGitReadSession>[0],
  operation: (session: GitReadSession) => Promise<T>
): Promise<T> {
  const resolution = createAuthorityGitReadSession(input);
  if (resolution.status !== 'ready') {
    throw new GitReadAuthorityError('Git read provider is unavailable.', resolution);
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
    throw new GitReadAuthorityError('Git read session failed terminal settlement.', session.failure);
  }
  return result as T;
}
