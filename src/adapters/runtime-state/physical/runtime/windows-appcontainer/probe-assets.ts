import type { BigIntStats } from 'node:fs';
import { lstat, open, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rawSha256Hex } from '../../../../../contracts/canonical.ts';

export type WindowsAppContainerProbeAssetRole =
  | 'execution-conformance'
  | 'lease-loss-runner'
  | 'network-probe'
  | 'vector-runner';

export const WINDOWS_APPCONTAINER_EXECUTION_CONFORMANCE_RESULT_RELATIVE_PATH =
  'execution-conformance-result.json' as const;

const MAXIMUM_PROBE_ASSET_BYTES = 256 * 1024;

const PROBE_ASSET_SOURCES = Object.freeze([
  Object.freeze({
    role: 'execution-conformance' as const,
    relativePath: 'execution-conformance.mjs',
    sourceUrl: new URL('./probes/execution-conformance.mjs', import.meta.url)
  }),
  Object.freeze({
    role: 'lease-loss-runner' as const,
    relativePath: 'lease-loss-runner.mjs',
    sourceUrl: new URL('./probes/lease-loss-runner.mjs', import.meta.url)
  }),
  Object.freeze({
    role: 'network-probe' as const,
    relativePath: 'network-probe.mjs',
    sourceUrl: new URL('./probes/network-probe.mjs', import.meta.url)
  }),
  Object.freeze({
    role: 'vector-runner' as const,
    relativePath: 'vector-runner.mjs',
    sourceUrl: new URL('./probes/vector-runner.mjs', import.meta.url)
  })
]);

interface PhysicalFileIdentity {
  readonly device: string;
  readonly inode: string;
  readonly mode: string;
  readonly linkCount: string;
  readonly byteLength: string;
  readonly modifiedAtNanoseconds: string;
  readonly changedAtNanoseconds: string;
}

interface LoadedProbeAsset {
  readonly role: WindowsAppContainerProbeAssetRole;
  readonly relativePath: string;
  readonly bytes: Uint8Array;
  readonly digest: `sha256:${string}`;
  readonly sourceIdentity: PhysicalFileIdentity;
}

export interface WindowsAppContainerLoadedProbeAssetSet {
  readonly setDigest: `sha256:${string}`;
  readonly roles: readonly WindowsAppContainerProbeAssetRole[];
}

export interface WindowsAppContainerStagedProbeAssetSet {
  readonly setDigest: `sha256:${string}`;
  readonly roles: readonly WindowsAppContainerProbeAssetRole[];
}

export type WindowsAppContainerProbeAssetFailure =
  | 'cleanup-failed'
  | 'source-drift'
  | 'source-invalid'
  | 'source-read-failed'
  | 'stage-conflict'
  | 'stage-readback-failed';

export class WindowsAppContainerProbeAssetError extends Error {
  constructor(readonly failure: WindowsAppContainerProbeAssetFailure) {
    super(`Windows AppContainer probe asset ${failure}`);
    this.name = 'WindowsAppContainerProbeAssetError';
  }
}

const loadedProbeAssetSets = new WeakMap<WindowsAppContainerLoadedProbeAssetSet, readonly LoadedProbeAsset[]>();

function sha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${rawSha256Hex(bytes)}`;
}

function samePath(left: string, right: string): boolean {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  return process.platform === 'win32'
    ? resolvedLeft.toLocaleLowerCase('en-US') === resolvedRight.toLocaleLowerCase('en-US')
    : resolvedLeft === resolvedRight;
}

function physicalIdentity(stats: BigIntStats): PhysicalFileIdentity {
  return Object.freeze({
    device: String(stats.dev),
    inode: String(stats.ino),
    mode: String(stats.mode),
    linkCount: String(stats.nlink),
    byteLength: String(stats.size),
    modifiedAtNanoseconds: String(stats.mtimeNs),
    changedAtNanoseconds: String(stats.ctimeNs)
  });
}

function sameIdentity(left: PhysicalFileIdentity, right: PhysicalFileIdentity): boolean {
  return left.device === right.device && left.inode === right.inode &&
    left.mode === right.mode && left.linkCount === right.linkCount &&
    left.byteLength === right.byteLength &&
    left.modifiedAtNanoseconds === right.modifiedAtNanoseconds &&
    left.changedAtNanoseconds === right.changedAtNanoseconds;
}

async function readBoundedCanonicalFile(
  filePath: string,
  invalidFailure: WindowsAppContainerProbeAssetFailure,
  readFailure: WindowsAppContainerProbeAssetFailure
): Promise<Readonly<{
  bytes: Uint8Array;
  digest: `sha256:${string}`;
  identity: PhysicalFileIdentity;
}>> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const beforePath = await lstat(filePath, { bigint: true });
    const physicalPath = await realpath(filePath);
    if (!beforePath.isFile() || beforePath.isSymbolicLink() || beforePath.nlink !== 1n ||
      !samePath(physicalPath, filePath) || beforePath.size < 0n ||
      beforePath.size > BigInt(MAXIMUM_PROBE_ASSET_BYTES)) {
      throw new WindowsAppContainerProbeAssetError(invalidFailure);
    }
    handle = await open(filePath, 'r');
    const beforeHandle = await handle.stat({ bigint: true });
    const beforeIdentity = physicalIdentity(beforePath);
    if (!beforeHandle.isFile() || !sameIdentity(
      beforeIdentity,
      physicalIdentity(beforeHandle)
    )) {
      throw new WindowsAppContainerProbeAssetError(invalidFailure);
    }
    const expectedBytes = Number(beforeHandle.size);
    const buffer = Buffer.alloc(expectedBytes + 1);
    let offset = 0;
    while (offset < buffer.byteLength) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.byteLength - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const afterHandle = await handle.stat({ bigint: true });
    const afterPath = await lstat(filePath, { bigint: true });
    if (offset !== expectedBytes || !sameIdentity(
      beforeIdentity,
      physicalIdentity(afterHandle)
    ) || !sameIdentity(
      beforeIdentity,
      physicalIdentity(afterPath)
    )) {
      throw new WindowsAppContainerProbeAssetError('source-drift');
    }
    const bytes = buffer.subarray(0, expectedBytes);
    return Object.freeze({
      bytes: new Uint8Array(bytes),
      digest: sha256(bytes),
      identity: beforeIdentity
    });
  } catch (error) {
    if (error instanceof WindowsAppContainerProbeAssetError) throw error;
    throw new WindowsAppContainerProbeAssetError(readFailure);
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function setDigest(assets: readonly LoadedProbeAsset[]): `sha256:${string}` {
  const material = assets.map((asset) =>
    `${asset.role}\0${asset.relativePath}\0${asset.digest}\0${JSON.stringify(asset.sourceIdentity)}\n`
  ).join('');
  return sha256(Buffer.from(material, 'utf8'));
}

export function windowsAppContainerProbeAssetRelativePath(
  role: WindowsAppContainerProbeAssetRole
): string {
  const source = PROBE_ASSET_SOURCES.find((candidate) => candidate.role === role);
  if (!source) throw new WindowsAppContainerProbeAssetError('source-invalid');
  return source.relativePath;
}

export function windowsAppContainerProbeAssetRelativePaths(): readonly string[] {
  return Object.freeze(PROBE_ASSET_SOURCES.map((asset) => asset.relativePath));
}

export async function loadWindowsAppContainerProbeAssetSet(): Promise<WindowsAppContainerLoadedProbeAssetSet> {
  const assets: LoadedProbeAsset[] = [];
  for (const source of PROBE_ASSET_SOURCES) {
    const sourcePath = fileURLToPath(source.sourceUrl);
    const observed = await readBoundedCanonicalFile(sourcePath, 'source-invalid', 'source-read-failed');
    assets.push(Object.freeze({
      role: source.role,
      relativePath: source.relativePath,
      bytes: observed.bytes,
      digest: observed.digest,
      sourceIdentity: observed.identity
    }));
  }
  const result: WindowsAppContainerLoadedProbeAssetSet = Object.freeze({
    setDigest: setDigest(assets),
    roles: Object.freeze(assets.map((asset) => asset.role))
  });
  loadedProbeAssetSets.set(result, Object.freeze(assets));
  return result;
}

export async function stageWindowsAppContainerProbeAssetSet(
  stagingRoot: string,
  loaded: WindowsAppContainerLoadedProbeAssetSet,
  beforeEffect: () => Promise<void>
): Promise<WindowsAppContainerStagedProbeAssetSet> {
  const assets = loadedProbeAssetSets.get(loaded);
  if (!assets || loaded.setDigest !== setDigest(assets)) {
    throw new WindowsAppContainerProbeAssetError('source-drift');
  }
  const created: string[] = [];
  try {
    for (const asset of assets) {
      const destination = path.join(stagingRoot, asset.relativePath);
      await beforeEffect();
      let handle: Awaited<ReturnType<typeof open>> | undefined;
      try {
        handle = await open(destination, 'wx');
        await handle.writeFile(asset.bytes);
        await handle.sync();
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === 'EEXIST') {
          throw new WindowsAppContainerProbeAssetError('stage-conflict');
        }
        throw error;
      } finally {
        await handle?.close().catch(() => undefined);
      }
      created.push(destination);
    }
    for (const asset of assets) {
      const staged = await readBoundedCanonicalFile(
        path.join(stagingRoot, asset.relativePath),
        'stage-readback-failed',
        'stage-readback-failed'
      );
      if (staged.digest !== asset.digest || staged.bytes.byteLength !== asset.bytes.byteLength ||
        !Buffer.from(staged.bytes).equals(Buffer.from(asset.bytes))) {
        throw new WindowsAppContainerProbeAssetError('stage-readback-failed');
      }
    }
    await beforeEffect();
    return Object.freeze({ setDigest: loaded.setDigest, roles: loaded.roles });
  } catch (error) {
    let cleanupFailed = false;
    for (const destination of created.reverse()) {
      try {
        await beforeEffect();
        await rm(destination, { force: true });
        try {
          await lstat(destination);
          cleanupFailed = true;
        } catch (cleanupError) {
          if ((cleanupError as NodeJS.ErrnoException)?.code !== 'ENOENT') cleanupFailed = true;
        }
      } catch {
        cleanupFailed = true;
      }
    }
    if (cleanupFailed) throw new WindowsAppContainerProbeAssetError('cleanup-failed');
    if (error instanceof WindowsAppContainerProbeAssetError) throw error;
    throw new WindowsAppContainerProbeAssetError('stage-readback-failed');
  }
}
