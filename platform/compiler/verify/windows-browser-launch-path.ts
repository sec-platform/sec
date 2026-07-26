import {
  lstat,
  mkdtemp,
  realpath,
  rmdir,
  stat,
  symlink,
  unlink
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const WINDOWS_LEGACY_LAUNCH_PATH_MAX = 259;
const WINDOWS_BROWSER_LAUNCH_PREFIX = 'sec-browser-launch-v1-';
const WINDOWS_BROWSER_LAUNCH_ALIAS = 'browser-cache';

type FileSystemIdentity = Readonly<{
  dev: string;
  ino: string;
  mode: string;
  size: string;
}>;

type BrowserLaunchPathLeaseOptions = Readonly<{
  maxLaunchPathLength: number;
  platform: NodeJS.Platform;
  temporaryRoot: string;
}>;

export type BrowserLaunchPathLease = Readonly<{
  assertCurrent: () => Promise<void>;
  browsersPath: string;
  release: () => Promise<void>;
}>;

function identity(metadata: {
  readonly dev: bigint | number;
  readonly ino: bigint | number;
  readonly mode: bigint | number;
  readonly size: bigint | number;
}): FileSystemIdentity {
  return Object.freeze({
    dev: String(metadata.dev),
    ino: String(metadata.ino),
    mode: String(metadata.mode),
    size: String(metadata.size)
  });
}

function sameDirectoryIdentity(left: FileSystemIdentity, right: FileSystemIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode;
}

function sameFileIdentity(left: FileSystemIdentity, right: FileSystemIdentity): boolean {
  return sameDirectoryIdentity(left, right) && left.size === right.size;
}

function ordinaryWindowsPath(value: string): string {
  const normalized = path.win32.normalize(value);
  if (normalized.startsWith('\\\\?\\UNC\\')) return `\\\\${normalized.slice(8)}`;
  return normalized.startsWith('\\\\?\\') ? normalized.slice(4) : normalized;
}

function foldedPath(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === 'win32'
    ? ordinaryWindowsPath(resolved).toLocaleLowerCase('en-US')
    : resolved;
}

function samePath(left: string, right: string): boolean {
  return foldedPath(left) === foldedPath(right);
}

function requiredExecutableRelativePath(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\') ||
    path.posix.isAbsolute(value)) {
    throw new Error('Browser launch executable path must be a canonical relative path');
  }
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === '.' || normalized === '..' ||
    normalized.startsWith('../')) {
    throw new Error('Browser launch executable path must be a canonical relative path');
  }
  return normalized;
}

function joinRelative(root: string, relativePath: string): string {
  const joined = path.resolve(root, ...relativePath.split('/'));
  const relative = path.relative(path.resolve(root), joined);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Browser launch executable escaped its cache root');
  }
  return joined;
}

async function physicalDirectory(filePath: string, label: string): Promise<{
  readonly identity: FileSystemIdentity;
  readonly realPath: string;
}> {
  const metadata = await lstat(filePath, { bigint: true });
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`${label} must be a physical directory`);
  }
  const realPath = await realpath(filePath);
  if (!samePath(realPath, filePath)) {
    throw new Error(`${label} must not traverse a filesystem alias`);
  }
  return Object.freeze({ identity: identity(metadata), realPath });
}

async function physicalExecutable(filePath: string, label: string): Promise<{
  readonly identity: FileSystemIdentity;
  readonly realPath: string;
}> {
  const metadata = await lstat(filePath, { bigint: true });
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size <= 0n) {
    throw new Error(`${label} must be a non-empty physical file`);
  }
  const realPath = await realpath(filePath);
  if (!samePath(realPath, filePath)) {
    throw new Error(`${label} must not traverse a filesystem alias`);
  }
  return Object.freeze({ identity: identity(metadata), realPath });
}

async function followedIdentity(filePath: string): Promise<FileSystemIdentity> {
  return identity(await stat(filePath, { bigint: true }));
}

async function optionalLinkMetadata(filePath: string): Promise<
  Awaited<ReturnType<typeof lstat>> | null
> {
  try {
    return await lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function createBrowserLaunchPathLease(
  physicalBrowserRoot: string,
  executableRelativePath: string,
  options: BrowserLaunchPathLeaseOptions
): Promise<BrowserLaunchPathLease> {
  const browserRoot = path.resolve(physicalBrowserRoot);
  const relativeExecutable = requiredExecutableRelativePath(executableRelativePath);
  const physicalRoot = await physicalDirectory(browserRoot, 'Staged browser cache');
  const physicalExecutablePath = joinRelative(browserRoot, relativeExecutable);
  const executable = await physicalExecutable(
    physicalExecutablePath,
    'Staged browser executable'
  );

  if (options.platform !== 'win32') {
    let released = false;
    return Object.freeze({
      browsersPath: browserRoot,
      assertCurrent: async () => {
        if (released) throw new Error('Browser launch path lease was already released');
        const currentRoot = await physicalDirectory(browserRoot, 'Staged browser cache');
        const currentExecutable = await physicalExecutable(
          physicalExecutablePath,
          'Staged browser executable'
        );
        if (!sameDirectoryIdentity(currentRoot.identity, physicalRoot.identity) ||
          !sameFileIdentity(currentExecutable.identity, executable.identity)) {
          throw new Error('Staged browser cache changed before launch');
        }
      },
      release: async () => {
        released = true;
      }
    });
  }

  const temporaryRoot = path.resolve(options.temporaryRoot);
  const temporaryAuthority = await physicalDirectory(
    temporaryRoot,
    'Browser launch temporary authority'
  );
  const leaseRoot = await mkdtemp(path.join(
    temporaryAuthority.realPath,
    WINDOWS_BROWSER_LAUNCH_PREFIX
  ));
  const aliasPath = path.join(leaseRoot, WINDOWS_BROWSER_LAUNCH_ALIAS);
  let leaseRootProof: Awaited<ReturnType<typeof physicalDirectory>> | undefined;
  let aliasCreated = false;

  const assertOwnedLeaseRoot = async (): Promise<void> => {
    if (!leaseRootProof) {
      throw new Error('Browser launch lease root ownership was not established');
    }
    const currentLeaseRoot = await physicalDirectory(
      leaseRoot,
      'Browser launch lease root'
    );
    if (!sameDirectoryIdentity(currentLeaseRoot.identity, leaseRootProof.identity)) {
      throw new Error('Browser launch lease root changed before cleanup');
    }
  };
  const cleanupOwnedCreation = async (): Promise<void> => {
    await assertOwnedLeaseRoot();
    const aliasMetadata = await optionalLinkMetadata(aliasPath);
    if (aliasMetadata?.isSymbolicLink()) {
      await unlink(aliasPath);
    } else if (aliasMetadata !== null) {
      throw new Error('Browser launch alias path contains unowned data');
    }
    await rmdir(leaseRoot);
  };

  try {
    leaseRootProof = await physicalDirectory(leaseRoot, 'Browser launch lease root');
    await symlink(
      physicalRoot.realPath,
      aliasPath,
      process.platform === 'win32' ? 'junction' : 'dir'
    );
    aliasCreated = true;
    const projectedExecutablePath = joinRelative(aliasPath, relativeExecutable);
    if (projectedExecutablePath.length > options.maxLaunchPathLength) {
      throw new Error('Projected browser executable exceeds the Win32 launch path limit');
    }
    const aliasMetadata = await lstat(aliasPath);
    if (!aliasMetadata.isSymbolicLink()) {
      throw new Error('Browser launch projection is not a filesystem alias');
    }
    const aliasTarget = await realpath(aliasPath);
    const projectedExecutableRealPath = await realpath(projectedExecutablePath);
    if (!samePath(aliasTarget, physicalRoot.realPath) ||
      !samePath(projectedExecutableRealPath, executable.realPath) ||
      !sameFileIdentity(await followedIdentity(projectedExecutablePath), executable.identity)) {
      throw new Error('Browser launch projection does not bind the staged browser cache');
    }

    let released = false;
    let releaseFlight: Promise<void> | undefined;
    const assertCurrent = async (): Promise<void> => {
      if (released) throw new Error('Browser launch path lease was already released');
      const currentLeaseRoot = await physicalDirectory(
        leaseRoot,
        'Browser launch lease root'
      );
      if (!leaseRootProof ||
        !sameDirectoryIdentity(currentLeaseRoot.identity, leaseRootProof.identity)) {
        throw new Error('Browser launch lease root changed before launch');
      }
      const currentPhysicalRoot = await physicalDirectory(
        browserRoot,
        'Staged browser cache'
      );
      const currentExecutable = await physicalExecutable(
        physicalExecutablePath,
        'Staged browser executable'
      );
      const currentAlias = await optionalLinkMetadata(aliasPath);
      if (!currentAlias?.isSymbolicLink() ||
        !sameDirectoryIdentity(currentPhysicalRoot.identity, physicalRoot.identity) ||
        !sameFileIdentity(currentExecutable.identity, executable.identity)) {
        throw new Error('Browser launch projection changed before launch');
      }
      const currentAliasTarget = await realpath(aliasPath);
      const currentProjectedExecutable = await realpath(projectedExecutablePath);
      if (!samePath(currentAliasTarget, physicalRoot.realPath) ||
        !samePath(currentProjectedExecutable, executable.realPath) ||
        !sameFileIdentity(await followedIdentity(projectedExecutablePath), executable.identity)) {
        throw new Error('Browser launch projection changed before launch');
      }
    };
    const release = async (): Promise<void> => {
      if (released) return;
      if (releaseFlight) return releaseFlight;
      releaseFlight = (async () => {
        let validationError: unknown;
        try {
          await assertCurrent();
        } catch (error) {
          validationError = error;
        }
        await cleanupOwnedCreation();
        if (await optionalLinkMetadata(aliasPath) !== null) {
          throw new Error('Browser launch projection cleanup did not remove its alias');
        }
        released = true;
        if (validationError !== undefined) throw validationError;
      })();
      try {
        await releaseFlight;
      } catch (error) {
        releaseFlight = undefined;
        throw error;
      }
    };
    return Object.freeze({
      assertCurrent,
      browsersPath: aliasPath,
      release
    });
  } catch (error) {
    if (aliasCreated || leaseRootProof !== undefined) {
      try {
        await cleanupOwnedCreation();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Browser launch projection acquisition and cleanup both failed'
        );
      }
    }
    throw error;
  }
}

export function acquireBrowserLaunchPath(
  physicalBrowserRoot: string,
  executableRelativePath: string
): Promise<BrowserLaunchPathLease> {
  return createBrowserLaunchPathLease(physicalBrowserRoot, executableRelativePath, {
    maxLaunchPathLength: WINDOWS_LEGACY_LAUNCH_PATH_MAX,
    platform: process.platform,
    temporaryRoot: tmpdir()
  });
}

/** Test-only platform and temporary-root seam; production uses the host values above. */
export function acquireBrowserLaunchPathForTests(
  physicalBrowserRoot: string,
  executableRelativePath: string,
  options: Readonly<{
    maxLaunchPathLength?: number;
    platform: NodeJS.Platform;
    temporaryRoot: string;
  }>
): Promise<BrowserLaunchPathLease> {
  return createBrowserLaunchPathLease(physicalBrowserRoot, executableRelativePath, {
    maxLaunchPathLength: options.maxLaunchPathLength ?? WINDOWS_LEGACY_LAUNCH_PATH_MAX,
    platform: options.platform,
    temporaryRoot: options.temporaryRoot
  });
}
