import type { GitReadProviderResolutionFailure } from '../../../providers/git-read/runtime/session.ts';

// One error identity crosses the format and effect boundaries. In particular,
// a retained-lease conflict must survive translation without losing custody.
type GitProviderAdmission = Readonly<{
  readonly route: GitReadProviderResolutionFailure['route'];
  readonly status: GitReadProviderResolutionFailure['status'];
  readonly reason: GitReadProviderResolutionFailure['reason'];
  readonly detailDigest: `sha256:${string}`;
}>;

export class GitHookTransitionConflict extends Error {
  readonly code = 'git-hook-transition-conflict';
  readonly retainOperationLease: boolean;
  readonly providerAdmission: GitProviderAdmission | null;

  constructor(
    message: string,
    retainOperationLease = false,
    providerAdmission: GitProviderAdmission | null = null
  ) {
    super(message.startsWith('Git hook transition conflict:')
      ? message
      : 'Git hook transition conflict: ' + message);
    this.name = 'GitHookTransitionConflict';
    this.retainOperationLease = retainOperationLease;
    this.providerAdmission = providerAdmission;
  }
}

export function providerAdmissionConflict(
  failure: GitReadProviderResolutionFailure
): GitHookTransitionConflict {
  const admission = Object.freeze({
    route: failure.route,
    status: failure.status,
    reason: failure.reason,
    detailDigest: failure.detailDigest
  });
  return new GitHookTransitionConflict(
    'Git provider admission is ' + failure.status
      + ' for ' + failure.route
      + ' (' + failure.reason + '; ' + failure.detailDigest + '); '
      + 'Git hook authority was not changed.',
    false,
    admission
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function asTransition(error: unknown): GitHookTransitionConflict {
  return error instanceof GitHookTransitionConflict
    ? error
    : new GitHookTransitionConflict(errorMessage(error));
}
