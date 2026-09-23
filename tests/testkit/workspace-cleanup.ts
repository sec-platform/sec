import path from 'node:path';
import { getErrorCode } from '../../src/contracts/failure-inspection.ts';

export type WorkspaceDirectoryRemoveOptions = {
  readonly recursive: true;
  readonly force: true;
};

type WorkspaceCleanupSeam = {
  readonly platform: NodeJS.Platform;
  readonly removeDirectory: (
    directory: string,
    options: WorkspaceDirectoryRemoveOptions
  ) => Promise<void>;
  readonly sleep: (delayMs: number) => Promise<void>;
};

export type WorkspaceCleanupRequest = {
  readonly directory: string;
  readonly deferredCleanupDirs: Set<string>;
  readonly seam: WorkspaceCleanupSeam;
};

export type WorkspaceCallbackSettlementOptions =
  | { readonly retainOnCallbackFailure?: false }
  | {
      readonly retainOnCallbackFailure: true;
      readonly directory: string;
      readonly deferredCleanupDirs: Set<string>;
    };

/** Native mkdtemp appends random characters to a prefix; it does not make an
 * arbitrary caller path a child of our workspace parent. Admit a label first.
 * The caller still owns the parent directory and actual allocation capability.
 */
export function workspaceTemporaryPrefix(parent: string, prefix = 'engineering-compiler-test-'): string {
  if (typeof prefix !== 'string' || prefix.length === 0 || prefix === '.' || prefix === '..' ||
      prefix.includes('\0') || prefix.includes('/') || prefix.includes('\\') || /^[A-Za-z]:/u.test(prefix)) {
    throw new TypeError('Workspace prefix must be a non-empty single path segment');
  }
  return path.join(path.resolve(parent), prefix);
}

export function captureWorkspaceRetention(options: Readonly<{ retainOnCallbackFailure?: boolean }>): boolean {
  const retain = options.retainOnCallbackFailure;
  if (retain !== undefined && typeof retain !== 'boolean') {
    throw new TypeError('Workspace retention must be boolean');
  }
  return retain === true;
}

const retryDelaysMs = [50, 100, 200, 400, 800] as const;

export async function createWorkspaceWithDeferredCleanup(
  temporaryDirectoryPrefix: string,
  deferredCleanupDirs: Set<string>,
  createTemporaryDirectory: (prefix: string) => Promise<string>
): Promise<string> {
  const directory = await createTemporaryDirectory(temporaryDirectoryPrefix);
  deferredCleanupDirs.add(directory);
  return directory;
}

function cleanupFailureIsRetryable(error: unknown, platform: NodeJS.Platform): boolean {
  const code = getErrorCode(error);
  return code === 'EBUSY' || code === 'EPERM' || (platform === 'win32' && code === 'EACCES');
}

export async function removeWorkspaceDirectoryWithRetry({
  directory,
  deferredCleanupDirs,
  seam
}: WorkspaceCleanupRequest): Promise<void> {
  const { removeDirectory, sleep, platform } = seam;
  if (typeof removeDirectory !== 'function' || typeof sleep !== 'function') {
    throw new TypeError('Workspace cleanup requires callable removal and sleep capabilities');
  }
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      await Reflect.apply(removeDirectory, seam, [directory, { recursive: true, force: true }]);
      deferredCleanupDirs.delete(directory);
      return;
    } catch (error) {
      const retryDelayMs = retryDelaysMs[attempt];
      if (retryDelayMs === undefined || !cleanupFailureIsRetryable(error, platform)) throw error;
      try {
        await Reflect.apply(sleep, seam, [retryDelayMs]);
      } catch (sleepFailure) {
        throw new AggregateError([error, sleepFailure], 'Workspace removal and retry wait failed', { cause: error });
      }
    }
  }
}

/** Join independent cleanup attempts before the enclosing scope can retire.
 * Concurrency limits belong to the supplied removal operations. This has no
 * timer, retry, deletion or authority policy of its own. A failed sibling must
 * not prevent other already-selected resources receiving their cleanup attempt.
 */
export async function settleWorkspaceCleanups(
  cleanups: readonly (() => Promise<void>)[]
): Promise<void> {
  const selected = [...cleanups];
  if (selected.some(cleanup => typeof cleanup !== 'function')) {
    throw new TypeError('Workspace cleanup attempts must be callable');
  }
  const results = await Promise.allSettled(selected.map(cleanup => Promise.resolve().then(cleanup)));
  const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(failures, 'Independent workspace cleanup attempts failed', { cause: failures[0] });
  }
}

export async function settleWorkspaceCallback<T>(
  callback: () => Promise<T>,
  cleanup: () => Promise<void>,
  options: WorkspaceCallbackSettlementOptions = {}
): Promise<T> {
  // Capture the explicit forensic-retention decision before the callback can
  // mutate its source. A failure never grants implicit permission to skip cleanup.
  const retention = captureWorkspaceRetention(options)
    ? (() => {
        const retained = options as Extract<WorkspaceCallbackSettlementOptions, { retainOnCallbackFailure: true }>;
        return { directory: retained.directory, deferredCleanupDirs: retained.deferredCleanupDirs };
      })()
    : undefined;
  let callbackFailed = false;
  let primaryFailure: unknown;
  let result: T | undefined;
  try {
    result = await callback();
  } catch (error) {
    callbackFailed = true;
    primaryFailure = error;
  }
  if (callbackFailed && retention !== undefined) {
    retention.deferredCleanupDirs.delete(retention.directory);
    throw primaryFailure;
  }
  try {
    await cleanup();
  } catch (cleanupFailure) {
    if (!callbackFailed) throw cleanupFailure;
    // Test failures and cleanup failures are independent evidence. Preserve both
    // original values, including undefined, without mutating the primary Error.
    throw new AggregateError([primaryFailure, cleanupFailure], 'Workspace callback and cleanup failed', {
      cause: primaryFailure
    });
  }
  if (callbackFailed) throw primaryFailure;
  return result as T;
}
