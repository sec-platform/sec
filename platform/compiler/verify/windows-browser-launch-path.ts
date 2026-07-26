import {
  lstat,
  mkdtemp,
  realpath,
  rmdir,
  stat,
  symlink,
  unlink
} from 'node:fs/promises';
import path from 'node:path';

import {
  acquireWindowsBrowserLaunchHostAuthority,
  type WindowsHostDirectoryAuthority
} from '../../shared/windows-host-filesystem-authority.ts';

const WINDOWS_LEGACY_LAUNCH_PATH_MAX = 259;
const WINDOWS_BROWSER_LAUNCH_PREFIX = 'sec-browser-launch-v1-';
const WINDOWS_BROWSER_LAUNCH_ALIAS = 'browser-cache';
export const WINDOWS_BROWSER_LAUNCH_PROOF_ARGUMENT_PREFIX =
  '--sec-browser-launch-proof-v1=' as const;

type FileSystemIdentity = Readonly<{
  ctimeNs: string;
  dev: string;
  ino: string;
  mode: string;
  mtimeNs: string;
  size: string;
}>;

type BrowserLaunchPathLeaseOptions = Readonly<{
  hostAuthority?: WindowsHostDirectoryAuthority;
  maxLaunchPathLength: number;
  platform: NodeJS.Platform;
}>;

export type BrowserLaunchPathLease = Readonly<{
  assertCurrent: () => Promise<void>;
  browsersPath: string;
  proofArgument: string;
  release: () => Promise<void>;
}>;

type BrowserLaunchPathProofV1 = Readonly<{
  browsersPath: string;
  executableIdentity: FileSystemIdentity;
  executableRelativePath: string;
  formatRevision: 'windows-browser-launch-proof-v1';
  leaseRoot: null | Readonly<{
    identity: FileSystemIdentity;
    path: string;
  }>;
  physicalBrowserRoot: string;
  physicalRootIdentity: FileSystemIdentity;
}>;

let registeredBrowserLaunchProof: BrowserLaunchPathProofV1 | undefined;

function identity(metadata: {
  readonly dev: bigint | number;
  readonly ino: bigint | number;
  readonly mode: bigint | number;
  readonly ctimeNs: bigint;
  readonly mtimeNs: bigint;
  readonly size: bigint | number;
}): FileSystemIdentity {
  return Object.freeze({
    ctimeNs: String(metadata.ctimeNs),
    dev: String(metadata.dev),
    ino: String(metadata.ino),
    mode: String(metadata.mode),
    mtimeNs: String(metadata.mtimeNs),
    size: String(metadata.size)
  });
}

function sameDirectoryIdentity(left: FileSystemIdentity, right: FileSystemIdentity): boolean {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode;
}

function sameFileIdentity(left: FileSystemIdentity, right: FileSystemIdentity): boolean {
  return sameDirectoryIdentity(left, right) &&
    left.ctimeNs === right.ctimeNs &&
    left.mtimeNs === right.mtimeNs &&
    left.size === right.size;
}

function exactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const canonicalExpected = [...expected].sort();
  return actual.length === canonicalExpected.length &&
    actual.every((key, index) => key === canonicalExpected[index]);
}

function exactIdentity(value: unknown): value is FileSystemIdentity {
  return exactKeys(value, ['ctimeNs', 'dev', 'ino', 'mode', 'mtimeNs', 'size']) &&
    typeof value.ctimeNs === 'string' &&
    typeof value.dev === 'string' &&
    typeof value.ino === 'string' &&
    typeof value.mode === 'string' &&
    typeof value.mtimeNs === 'string' &&
    typeof value.size === 'string';
}

function parseBrowserLaunchProof(encoded: string): BrowserLaunchPathProofV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw new Error('Browser launch proof is invalid');
  }
  if (!exactKeys(parsed, [
    'browsersPath',
    'executableIdentity',
    'executableRelativePath',
    'formatRevision',
    'leaseRoot',
    'physicalBrowserRoot',
    'physicalRootIdentity'
  ]) ||
    parsed.formatRevision !== 'windows-browser-launch-proof-v1' ||
    typeof parsed.browsersPath !== 'string' ||
    typeof parsed.executableRelativePath !== 'string' ||
    typeof parsed.physicalBrowserRoot !== 'string' ||
    !exactIdentity(parsed.executableIdentity) ||
    !exactIdentity(parsed.physicalRootIdentity) ||
    (parsed.leaseRoot !== null && (
      !exactKeys(parsed.leaseRoot, ['identity', 'path']) ||
      !exactIdentity(parsed.leaseRoot.identity) ||
      typeof parsed.leaseRoot.path !== 'string'
    ))) {
    throw new Error('Browser launch proof is invalid');
  }
  requiredExecutableRelativePath(parsed.executableRelativePath);
  if (!path.isAbsolute(parsed.browsersPath) || !path.isAbsolute(parsed.physicalBrowserRoot)) {
    throw new Error('Browser launch proof is invalid');
  }
  const leaseRoot = parsed.leaseRoot as BrowserLaunchPathProofV1['leaseRoot'];
  const proof: BrowserLaunchPathProofV1 = {
    browsersPath: parsed.browsersPath,
    executableIdentity: Object.freeze({ ...parsed.executableIdentity }),
    executableRelativePath: parsed.executableRelativePath,
    formatRevision: parsed.formatRevision,
    leaseRoot: leaseRoot === null
      ? null
      : Object.freeze({
          identity: Object.freeze({ ...leaseRoot.identity }),
          path: leaseRoot.path
        }),
    physicalBrowserRoot: parsed.physicalBrowserRoot,
    physicalRootIdentity: Object.freeze({ ...parsed.physicalRootIdentity })
  };
  return Object.freeze(proof);
}

function proofArgument(proof: BrowserLaunchPathProofV1): string {
  return `${WINDOWS_BROWSER_LAUNCH_PROOF_ARGUMENT_PREFIX}${
    Buffer.from(JSON.stringify(proof), 'utf8').toString('base64url')}`;
}

export function registerWindowsBrowserLaunchProofFromArguments(
  argv: readonly string[]
): void {
  if (registeredBrowserLaunchProof !== undefined) {
    throw new Error('Browser launch proof was already registered');
  }
  const candidates = argv.filter((argument) =>
    argument.startsWith(WINDOWS_BROWSER_LAUNCH_PROOF_ARGUMENT_PREFIX));
  if (candidates.length !== 1) {
    throw new Error('Exactly one browser launch proof argument is required');
  }
  registeredBrowserLaunchProof = parseBrowserLaunchProof(
    candidates[0].slice(WINDOWS_BROWSER_LAUNCH_PROOF_ARGUMENT_PREFIX.length)
  );
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

async function assertBrowserLaunchProofCurrent(
  proof: BrowserLaunchPathProofV1,
  expectedPhysicalBrowserRoot: string,
  expectedBrowsersPath: string
): Promise<void> {
  if (!samePath(proof.physicalBrowserRoot, expectedPhysicalBrowserRoot) ||
    !samePath(proof.browsersPath, expectedBrowsersPath)) {
    throw new Error('Browser launch proof does not bind the staged runtime plan');
  }
  const physicalRoot = await physicalDirectory(
    proof.physicalBrowserRoot,
    'Staged browser cache'
  );
  const physicalExecutablePath = joinRelative(
    proof.physicalBrowserRoot,
    proof.executableRelativePath
  );
  const executable = await physicalExecutable(
    physicalExecutablePath,
    'Staged browser executable'
  );
  if (!sameDirectoryIdentity(physicalRoot.identity, proof.physicalRootIdentity) ||
    !sameFileIdentity(executable.identity, proof.executableIdentity)) {
    throw new Error('Browser launch proof changed before browser spawn');
  }
  if (proof.leaseRoot === null) {
    if (!samePath(proof.browsersPath, proof.physicalBrowserRoot)) {
      throw new Error('Browser launch proof changed before browser spawn');
    }
    return;
  }
  const leaseRoot = await physicalDirectory(
    proof.leaseRoot.path,
    'Browser launch lease root'
  );
  const aliasMetadata = await optionalLinkMetadata(proof.browsersPath);
  if (!sameDirectoryIdentity(leaseRoot.identity, proof.leaseRoot.identity) ||
    !aliasMetadata?.isSymbolicLink() ||
    !samePath(path.dirname(proof.browsersPath), proof.leaseRoot.path)) {
    throw new Error('Browser launch proof changed before browser spawn');
  }
  const projectedExecutablePath = joinRelative(
    proof.browsersPath,
    proof.executableRelativePath
  );
  if (!samePath(await realpath(proof.browsersPath), physicalRoot.realPath) ||
    !samePath(await realpath(projectedExecutablePath), executable.realPath) ||
    !sameFileIdentity(await followedIdentity(projectedExecutablePath), proof.executableIdentity)) {
    throw new Error('Browser launch proof changed before browser spawn');
  }
}

export function assertRegisteredWindowsBrowserLaunchProofCurrent(
  expectedPhysicalBrowserRoot: string,
  expectedBrowsersPath: string,
  proofForTests?: string
): Promise<void> {
  const proof = proofForTests === undefined
    ? registeredBrowserLaunchProof
    : parseBrowserLaunchProof(
        proofForTests.startsWith(WINDOWS_BROWSER_LAUNCH_PROOF_ARGUMENT_PREFIX)
          ? proofForTests.slice(WINDOWS_BROWSER_LAUNCH_PROOF_ARGUMENT_PREFIX.length)
          : proofForTests
      );
  if (proof === undefined) {
    throw new Error('Browser launch proof is unavailable');
  }
  return assertBrowserLaunchProofCurrent(
    proof,
    expectedPhysicalBrowserRoot,
    expectedBrowsersPath
  );
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
    const proof = Object.freeze({
      browsersPath: browserRoot,
      executableIdentity: executable.identity,
      executableRelativePath: relativeExecutable,
      formatRevision: 'windows-browser-launch-proof-v1' as const,
      leaseRoot: null,
      physicalBrowserRoot: browserRoot,
      physicalRootIdentity: physicalRoot.identity
    });
    let released = false;
    return Object.freeze({
      browsersPath: browserRoot,
      proofArgument: proofArgument(proof),
      assertCurrent: async () => {
        if (released) throw new Error('Browser launch path lease was already released');
        await assertBrowserLaunchProofCurrent(proof, browserRoot, browserRoot);
      },
      release: async () => {
        released = true;
      }
    });
  }

  const hostAuthority = options.hostAuthority;
  if (!hostAuthority) {
    throw new Error('Windows browser launch host authority is unavailable');
  }
  await hostAuthority.assertCurrent();
  const temporaryAuthority = await physicalDirectory(
    hostAuthority.rootPath,
    'Browser launch host authority'
  );
  await hostAuthority.assertCurrent();
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
    await hostAuthority.release();
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
    if (!leaseRootProof) {
      throw new Error('Browser launch lease root ownership was not established');
    }
    const proof = Object.freeze({
      browsersPath: aliasPath,
      executableIdentity: executable.identity,
      executableRelativePath: relativeExecutable,
      formatRevision: 'windows-browser-launch-proof-v1' as const,
      leaseRoot: Object.freeze({
        identity: leaseRootProof.identity,
        path: leaseRoot
      }),
      physicalBrowserRoot: browserRoot,
      physicalRootIdentity: physicalRoot.identity
    });
    const assertCurrent = async (): Promise<void> => {
      if (released) throw new Error('Browser launch path lease was already released');
      await hostAuthority.assertCurrent();
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
      proofArgument: proofArgument(proof),
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

export async function acquireBrowserLaunchPath(
  physicalBrowserRoot: string,
  executableRelativePath: string
): Promise<BrowserLaunchPathLease> {
  const hostAuthority = process.platform === 'win32'
    ? await acquireWindowsBrowserLaunchHostAuthority()
    : undefined;
  try {
    return await createBrowserLaunchPathLease(physicalBrowserRoot, executableRelativePath, {
      ...(hostAuthority === undefined ? {} : { hostAuthority }),
      maxLaunchPathLength: WINDOWS_LEGACY_LAUNCH_PATH_MAX,
      platform: process.platform
    });
  } catch (error) {
    if (hostAuthority !== undefined) {
      try {
        await hostAuthority.release();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Browser launch host authority acquisition and cleanup both failed'
        );
      }
    }
    throw error;
  }
}

/** Test-only platform and temporary-root seam; production uses the host values above. */
export async function acquireBrowserLaunchPathForTests(
  physicalBrowserRoot: string,
  executableRelativePath: string,
  options: Readonly<{
    maxLaunchPathLength?: number;
    platform: NodeJS.Platform;
    proveTemporaryAuthority?: () => Promise<void>;
    temporaryRoot: string;
  }>
): Promise<BrowserLaunchPathLease> {
  const hostAuthority = options.platform === 'win32'
    ? Object.freeze({
        assertCurrent: options.proveTemporaryAuthority ?? (async () => {
          throw new Error('Windows browser launch host authority test proof is unavailable');
        }),
        release: async () => undefined,
        rootPath: options.temporaryRoot
      })
    : undefined;
  await hostAuthority?.assertCurrent();
  return createBrowserLaunchPathLease(physicalBrowserRoot, executableRelativePath, {
    ...(hostAuthority === undefined ? {} : { hostAuthority }),
    maxLaunchPathLength: options.maxLaunchPathLength ?? WINDOWS_LEGACY_LAUNCH_PATH_MAX,
    platform: options.platform
  });
}
