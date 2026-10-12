import { createHash } from 'node:crypto';
import { fstatSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { Agent, request } from 'node:https';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { rootCertificates } from 'node:tls';
import { createGunzip } from 'node:zlib';

import { sha256 } from '../../../../contracts/canonical.ts';
import { linkNativeAbortSignals, throwIfNativeAborted } from '../../../../contracts/native-abort.ts';
import { settleResources, settleResourcesAsync } from '../../../../execution/resource-settlement.ts';
import {
  assertPhysicalGenerationRetirementReceipt,
  createExclusiveNoFollowRandomDirectory,
  inspectNoFollowDirectoryChain,
  materializeRetainedNoFollowProvenDirectoryGeneration,
  publishExclusiveDurableCanonicalFile,
  retainNoFollowDirectoryForChildProcess,
  retireNoFollowDirectoryTree,
  scanNoFollowDirectoryTreeInventory,
  type NoFollowDirectoryTreeRetirementReceipt,
  type PhysicalDirectoryIdentity,
  type RetainedNoFollowProvenDirectoryGeneration
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { DOCKER_LINUX_INSTALLATION_PROFILE } from '../contract/linux-installation-profile.ts';
import {
  assertLinuxDockerStaticElfProgramHeaders,
  inspectLinuxDockerStaticElfHeader,
  LINUX_DOCKER_STATIC_TOOLCHAIN_DIGEST,
  LinuxDockerStaticToolchainError,
  LINUX_DOCKER_STATIC_TOOLCHAIN as supply
} from '../contract/linux-static-toolchain.ts';

const maximumTarBytes = 384 * 1024 * 1024;
const maximumEntries = 32;
const maximumToolBytes = supply.docker.executableBytes + supply.buildx.executableBytes;
const ambientNetworkOverrides = Object.freeze([
  'HTTP_PROXY', 'http_proxy', 'HTTPS_PROXY', 'https_proxy', 'ALL_PROXY', 'all_proxy',
  'NODE_USE_ENV_PROXY', 'NODE_TLS_REJECT_UNAUTHORIZED', 'NODE_EXTRA_CA_CERTS',
  'SSL_CERT_FILE', 'SSL_CERT_DIR', 'BUN_CONFIG_HTTP_PROXY'
]);

/** The publisher owns retirement; consumers borrow generation until they close. */
export interface PublishedLinuxDockerStaticToolchain {
  readonly generation: RetainedNoFollowProvenDirectoryGeneration;
  assertCurrent(): Promise<void>;
  retire(): Promise<NoFollowDirectoryTreeRetirementReceipt>;
}

/** A failed closeout retains the exact owned locator; it is never ready supply. */
export class LinuxDockerStaticPublicationError extends LinuxDockerStaticToolchainError {
  constructor(
    readonly phase: 'download' | 'publish' | 'retire',
    readonly residue: PhysicalDirectoryIdentity | null,
    cause: unknown
  ) {
    super('unavailable', `Linux Docker static ${phase} did not settle successfully.`, { cause });
    this.name = 'LinuxDockerStaticPublicationError';
  }
}

function mismatch(message: string): never {
  throw new LinuxDockerStaticToolchainError('mismatch', message);
}

function budget(deadlineAtUnixMs: number, signal?: AbortSignal): number {
  throwIfNativeAborted(signal);
  if (!Number.isSafeInteger(deadlineAtUnixMs) || deadlineAtUnixMs <= Date.now()) {
    throw new LinuxDockerStaticToolchainError('unavailable', 'Static Docker publication budget expired or was cancelled.');
  }
  return deadlineAtUnixMs - Date.now();
}

function assertBytes(bytes: Uint8Array, size: number, digest: string): void {
  if (bytes.byteLength !== size || `sha256:${createHash('sha256').update(bytes).digest('hex')}` !== digest) {
    mismatch('Static Docker supply bytes differ from the fixed vendor digest or length.');
  }
}

function assertExecutable(bytes: Uint8Array, tool: typeof supply.docker | typeof supply.buildx): void {
  assertBytes(bytes, tool.executableBytes, tool.executableDigest);
  const header = inspectLinuxDockerStaticElfHeader(bytes.subarray(0, 64), bytes.byteLength);
  assertLinuxDockerStaticElfProgramHeaders({
    header,
    programHeaders: bytes.subarray(header.programHeaderOffset, header.programHeaderOffset + header.programHeaderCount * 56),
    fileBytes: bytes.byteLength
  });
}

/** Pure framing only: this returns bytes, never a retained generation or grant.
 * The pinned Docker 28.0.4 tar contains nine GNU headers, 212316160 decoded bytes,
 * ordinary files plus the docker/ directory, zero padding and two EOF blocks.
 * No archive path is ever extracted to the filesystem. */
export function selectLinuxDockerStaticTarMember(bytes: Uint8Array, deadlineAtUnixMs: number): Uint8Array {
  budget(deadlineAtUnixMs);
  if (bytes.byteLength > maximumTarBytes || bytes.byteLength < 1024 || bytes.byteLength % 512 !== 0) {
    mismatch('Docker archive decoded framing is out of bounds.');
  }
  const tar = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const seen = new Set<string>();
  let selected: Buffer | undefined;
  const octal = (field: Buffer): number => {
    const value = field.toString('ascii').replace(/[\0 ]+$/u, '').replace(/^ +/u, '');
    if (!/^[0-7]+$/u.test(value)) mismatch('Docker archive numeric field is not ordinary octal.');
    const result = Number.parseInt(value, 8);
    if (!Number.isSafeInteger(result)) mismatch('Docker archive numeric field overflows.');
    return result;
  };
  for (let offset = 0; offset < tar.length;) {
    budget(deadlineAtUnixMs);
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      if (tar.length - offset < 1024 || !tar.subarray(offset).every((byte) => byte === 0)) {
        mismatch('Docker archive has incomplete EOF or trailing data.');
      }
      if (selected === undefined) mismatch('Docker archive lacks its unique ordinary CLI member.');
      budget(deadlineAtUnixMs);
      return selected;
    }
    if (seen.size >= maximumEntries || header.length !== 512
        || !header.subarray(257, 265).equals(Buffer.from('ustar  \0'))
        || header.subarray(345, 512).some((byte) => byte !== 0)
        || header.subarray(157, 257).some((byte) => byte !== 0)) {
      mismatch('Docker archive has unsupported headers, links or extensions.');
    }
    const sum = header.reduce((total, byte, index) => total + (index >= 148 && index < 156 ? 32 : byte), 0);
    if (sum !== octal(header.subarray(148, 156))) mismatch('Docker archive header checksum differs.');
    const end = header.subarray(0, 100).indexOf(0);
    if (end < 1 || header.subarray(end, 100).some((byte) => byte !== 0)) mismatch('Docker archive name is not canonical.');
    const name = header.subarray(0, end).toString('ascii');
    if (!header.subarray(0, end).equals(Buffer.from(name, 'ascii'))
        || (name !== 'docker/' && !/^docker\/[A-Za-z0-9._-]+$/u.test(name))
        || name === 'docker/.' || name === 'docker/..') mismatch('Docker archive member escapes its fixed directory.');
    const identity = name.replace(/\/$/u, '');
    if (seen.has(identity)) mismatch('Docker archive repeats a member.');
    seen.add(identity);
    const size = octal(header.subarray(124, 136));
    const mode = octal(header.subarray(100, 108));
    const type = header[156];
    if (mode > 0o777 || (name === 'docker/' ? type !== 53 || size !== 0 : type !== 48)) {
      mismatch('Docker archive member is not an ordinary file or its root directory.');
    }
    const start = offset + 512;
    const next = start + Math.ceil(size / 512) * 512;
    if (size > maximumTarBytes || next > tar.length
        || tar.subarray(start + size, next).some((byte) => byte !== 0)) mismatch('Docker archive size or padding is invalid.');
    if (name === supply.docker.archiveMember) {
      if (size !== supply.docker.executableBytes || (mode & 0o100) === 0) mismatch('Docker archive CLI size or executable mode differs.');
      selected = tar.subarray(start, start + size);
    }
    offset = next;
  }
  return mismatch('Docker archive lacks complete EOF blocks.');
}

/** Only the fixed GitHub release may redirect, once, to its official asset host. */
export function resolveLinuxDockerStaticAssetRedirect(location: string): URL {
  let target: URL;
  try { target = new URL(location); } catch { return mismatch('Static Docker asset redirect is not absolute HTTPS.'); }
  if (target.protocol !== 'https:' || target.hostname !== 'release-assets.githubusercontent.com'
      || target.port !== '' || target.username !== '' || target.password !== '' || target.hash !== ''
      || !/^\/github-production-release-asset\/[0-9]+\/[A-Za-z0-9-]+$/u.test(target.pathname)) {
    mismatch('Static Docker asset redirect leaves the fixed official asset chain.');
  }
  return target;
}

async function collect(source: Readable, maximumBytes: number, signal: AbortSignal): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  await pipeline(source, new Writable({
    write(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maximumBytes) { callback(new LinuxDockerStaticToolchainError('mismatch', 'Static Docker stream exceeds its byte bound.')); return; }
      chunks.push(Buffer.from(chunk));
      callback();
    }
  }), { signal });
  return Buffer.concat(chunks, bytes);
}

/** Bounded gzip framing and the fixed-member selector; still bytes-only. */
export async function decodeLinuxDockerStaticArchiveMember(
  compressed: Uint8Array, deadlineAtUnixMs: number, signal: AbortSignal
): Promise<Buffer> {
  signal = linkNativeAbortSignals(signal);
  budget(deadlineAtUnixMs, signal);
  if (compressed.byteLength > supply.docker.archiveBytes) mismatch('Docker compressed archive exceeds its byte bound.');
  const gunzip = createGunzip();
  const decoded = collect(gunzip, maximumTarBytes, signal);
  const inflate = pipeline(Readable.from([compressed]), gunzip, { signal });
  const results = await Promise.allSettled([decoded, inflate]);
  const errors = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
  if (errors.length !== 0) throw new AggregateError(errors, 'Static Docker gzip decoding failed.');
  budget(deadlineAtUnixMs, signal);
  return Buffer.from(selectLinuxDockerStaticTarMember((results[0] as PromiseFulfilledResult<Buffer>).value, deadlineAtUnixMs));
}

async function download(agent: Agent, kind: 'docker' | 'buildx', signal: AbortSignal): Promise<Buffer> {
  let target = new URL(kind === 'docker' ? supply.docker.archiveUrl : supply.buildx.url);
  const size = kind === 'docker' ? supply.docker.archiveBytes : supply.buildx.executableBytes;
  const digest = kind === 'docker' ? supply.docker.archiveDigest : supply.buildx.executableDigest;
  for (let hop = 0; hop < 2; hop += 1) {
    const response = await new Promise<IncomingMessage>((resolve, reject) => {
      const pending = request(target, {
        agent, signal, method: 'GET', ca: [...rootCertificates], rejectUnauthorized: true,
        headers: { Accept: 'application/octet-stream', 'Accept-Encoding': 'identity' }
      }, resolve);
      pending.once('error', reject);
      pending.end();
    });
    if (kind === 'buildx' && hop === 0 && [301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
      // Settle the bounded redirect body before opening the sole successor.
      await collect(response, 64 * 1024, signal);
      target = resolveLinuxDockerStaticAssetRedirect(response.headers.location ?? '');
      continue;
    }
    try {
      if (response.statusCode !== 200 || response.headers['content-encoding'] !== undefined
          && response.headers['content-encoding'] !== 'identity'
          || response.headers['content-length'] !== undefined && response.headers['content-length'] !== String(size)) {
        mismatch('Static Docker vendor response status, encoding or length differs.');
      }
    } catch (error) {
      await settleResourcesAsync({ primary: { label: 'static-vendor-response', error }, cleanup: [
        { label: 'static-vendor-response-close', settle: async () => {
          if (response.closed) return;
          const closed = new Promise<void>((resolve) => response.once('close', resolve));
          response.destroy();
          await closed;
        } }
      ] });
      throw error;
    }
    const bytes = await collect(response, size, signal);
    assertBytes(bytes, size, digest);
    return bytes;
  }
  return mismatch('Static Docker vendor redirect bound exceeded.');
}

/** No ambient tools, caller-supplied sources, credentials, shell, daemon or installation. */
export async function publishLinuxDockerStaticToolchain(input: Readonly<{
  deadlineAtUnixMs: number;
  signal?: AbortSignal;
}>): Promise<PublishedLinuxDockerStaticToolchain> {
  const captured = Object.freeze({ ...input });
  const { deadlineAtUnixMs } = captured;
  const signal = linkNativeAbortSignals(captured.signal);
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new LinuxDockerStaticToolchainError('unsupported', 'Static Docker publication requires Linux x64.');
  }
  budget(deadlineAtUnixMs, signal);
  if (ambientNetworkOverrides.some((key) => process.env[key] !== undefined && process.env[key] !== '')) {
    throw new LinuxDockerStaticToolchainError('unavailable', 'Static Docker publication rejects ambient proxy or TLS overrides.');
  }
  const controller = new AbortController();
  const cancellation = linkNativeAbortSignals(signal, controller.signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let agent: Agent | undefined;
  let phase: 'download' | 'publish' = 'download';
  let root: PhysicalDirectoryIdentity | null = null;
  let generationParent: PhysicalDirectoryIdentity | null = null;
  let networkSettled = false;
  const settleNetwork = async (): Promise<void> => {
    if (networkSettled) return;
    networkSettled = true;
    await settleResourcesAsync({ cleanup: [
      { label: 'static-publication-timer', settle: () => { if (timer !== undefined) clearTimeout(timer); } },
      { label: 'static-publication-https-agent', settle: () => agent?.destroy() }
    ] });
  };
  let generation: RetainedNoFollowProvenDirectoryGeneration | undefined;
  let retirement: Promise<NoFollowDirectoryTreeRetirementReceipt> | undefined;
  let physicallyAbsent = false;
  const retire = (): Promise<NoFollowDirectoryTreeRetirementReceipt> => {
    if (retirement !== undefined) return retirement;
    retirement = (async () => {
      try {
        budget(deadlineAtUnixMs);
        if (generation !== undefined) assertPhysicalGenerationRetirementReceipt(await generation.retire());
        const remaining = budget(deadlineAtUnixMs);
        const inventory = scanNoFollowDirectoryTreeInventory(root!, {
          deadlineAtMs: performance.now() + remaining, maximumEntries: 2, maximumBytes: maximumToolBytes
        });
        const receipt = retireNoFollowDirectoryTree({ parent: generationParent!, root: root!, inventory,
          restoreOwnerPermissions: true, deadlineAtMonotonicMs: performance.now() + budget(deadlineAtUnixMs) });
        physicallyAbsent = true;
        return receipt;
      } catch (error) { throw new LinuxDockerStaticPublicationError('retire', root, error); }
    })();
    return retirement;
  };
  try {
    timer = setTimeout(() => controller.abort(new Error('Static Docker publication deadline expired.')),
      Math.min(budget(deadlineAtUnixMs, signal), 2_147_483_647));
    agent = new Agent({ keepAlive: false, maxSockets: 1, proxyEnv: {}, ca: [...rootCertificates], rejectUnauthorized: true });
    const compressed = await download(agent, 'docker', cancellation);
    budget(deadlineAtUnixMs, cancellation);
    const docker = await decodeLinuxDockerStaticArchiveMember(compressed, deadlineAtUnixMs, cancellation);
    assertExecutable(docker, supply.docker);
    const buildx = await download(agent, 'buildx', cancellation);
    assertExecutable(buildx, supply.buildx);
    budget(deadlineAtUnixMs, cancellation);
    phase = 'publish';
    generationParent = inspectNoFollowDirectoryChain(DOCKER_LINUX_INSTALLATION_PROFILE.runtimeParent).target;
    root = createExclusiveNoFollowRandomDirectory(generationParent, 'sec-docker-static-');
    const held = retainNoFollowDirectoryForChildProcess(inspectNoFollowDirectoryChain(root.path), 15, 'Static Docker private generation');
    try {
      const metadata = fstatSync(held.stdioSourceDescriptor!, { bigint: true });
      if (!metadata.isDirectory() || metadata.uid !== BigInt(process.geteuid!()) || (metadata.mode & 0o777n) !== 0o700n) {
        mismatch('Static Docker generation root is not private to its effective owner.');
      }
      held.assertCurrent();
    } catch (error) {
      settleResources({ primary: { label: 'static-private-root', error }, cleanup: [
        { label: 'static-private-root-descriptor', settle: () => held.dispose() }
      ] });
      throw error;
    }
    held.dispose();
    for (const [tool, bytes] of [[supply.docker, docker], [supply.buildx, buildx]] as const) {
      budget(deadlineAtUnixMs, cancellation);
      publishExclusiveDurableCanonicalFile({ parent: root, name: tool.file, bytes,
        permissionMode: 0o500, validate: (value) => assertExecutable(value, tool) });
    }
    const inventory = scanNoFollowDirectoryTreeInventory(root, {
      deadlineAtMs: performance.now() + budget(deadlineAtUnixMs, cancellation),
      maximumEntries: 2, maximumBytes: maximumToolBytes, includeByteDigest: true
    });
    if (inventory.length !== 2 || [supply.docker, supply.buildx].some((tool) => !inventory.some((entry) => (
      entry.kind === 'file' && entry.relativePath === tool.file && entry.size === tool.executableBytes
      && entry.byteDigest === tool.executableDigest
    )))) mismatch('Published Docker generation differs from the exact pinned two-file inventory.');
    const treeDigest = sha256(inventory) as `sha256:${string}`;
    generation = (await materializeRetainedNoFollowProvenDirectoryGeneration({
      root, inventory, proofText: null, releaseMode: 'restore-owner-write', deadlineAtUnixMs, signal: cancellation,
      binding: { treeDigest, treeEntryCount: inventory.length,
        generationDigest: sha256({ root, treeDigest, toolchainDigest: LINUX_DOCKER_STATIC_TOOLCHAIN_DIGEST }) as `sha256:${string}` }
    })).generation;
    const publishedGeneration = generation;
    const assertCurrent = async (): Promise<void> => {
      if (retirement !== undefined) throw new LinuxDockerStaticToolchainError('unavailable', 'Static Docker publisher is retired or retiring.');
      budget(deadlineAtUnixMs, signal);
      publishedGeneration.assertCurrent();
      await publishedGeneration.assertAuthorityCurrent();
      budget(deadlineAtUnixMs, signal);
    };
    await assertCurrent();
    await settleNetwork();
    await assertCurrent();
    return Object.freeze({ generation: publishedGeneration, assertCurrent, retire });
  } catch (error) {
    try {
      await settleResourcesAsync({ primary: { label: 'static-toolchain-publication', error },
        cleanup: [
          ...(root === null ? [] : [{ label: 'static-toolchain-retirement', settle: async () => { await retire(); } }]),
          { label: 'static-publication-network', settle: settleNetwork }
        ] });
    } catch (settlement) { throw new LinuxDockerStaticPublicationError(phase, physicallyAbsent ? null : root, settlement); }
    throw error;
  }
}
