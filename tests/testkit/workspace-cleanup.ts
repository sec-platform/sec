export type WorkspaceDirectoryRemoveOptions = {
  readonly recursive: true;
  readonly force: true;
};

export type WorkspaceCleanupSeam = {
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
  | {
      readonly retainOnCallbackFailure?: false;
    }
  | {
      readonly retainOnCallbackFailure: true;
      readonly directory: string;
      readonly deferredCleanupDirs: Set<string>;
    };

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

function cleanupFailureCode(error: unknown): unknown {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return error.code;
}

function cleanupFailureIsRetryable(error: unknown, platform: NodeJS.Platform): boolean {
  const code = cleanupFailureCode(error);
  return code === 'EBUSY' || code === 'EPERM' || (platform === 'win32' && code === 'EACCES');
}

export async function removeWorkspaceDirectoryWithRetry({
  directory,
  deferredCleanupDirs,
  seam
}: WorkspaceCleanupRequest): Promise<void> {
  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      await seam.removeDirectory(directory, { recursive: true, force: true });
      deferredCleanupDirs.delete(directory);
      return;
    } catch (error) {
      const retryDelayMs = retryDelaysMs[attempt];
      if (retryDelayMs === undefined || !cleanupFailureIsRetryable(error, seam.platform)) {
        throw error;
      }
      await seam.sleep(retryDelayMs);
    }
  }
}

export async function settleWorkspaceCallback<T>(
  callback: () => Promise<T>,
  cleanup: () => Promise<void>,
  options: WorkspaceCallbackSettlementOptions = {}
): Promise<T> {
  let callbackFailed = false;
  let primaryFailure: unknown;
  let result: T | undefined;

  try {
    result = await callback();
  } catch (error) {
    callbackFailed = true;
    primaryFailure = error;
  }

  if (callbackFailed && options.retainOnCallbackFailure === true) {
    options.deferredCleanupDirs.delete(options.directory);
    throw primaryFailure;
  }

  try {
    await cleanup();
  } catch (cleanupFailure) {
    if (!callbackFailed) throw cleanupFailure;
  }

  if (callbackFailed) throw primaryFailure;
  return result as T;
}
