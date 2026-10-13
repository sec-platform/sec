import { sha256 } from '../../../../contracts/canonical.ts';

/**
 * Inspection of vendor bytes, not a claim about an installed Docker daemon.
 * The Debian docker-ce-cli supplied by the hosted image is dynamically linked
 * and is deliberately not an interchangeable input to this static supply.
 */
export const LINUX_DOCKER_STATIC_TOOLCHAIN = Object.freeze({
  schema: 'sec-linux-docker-static-toolchain-v1' as const,
  platform: 'linux' as const,
  architecture: 'x64' as const,
  docker: Object.freeze({
    version: '28.0.4',
    archiveUrl: 'https://download.docker.com/linux/static/stable/x86_64/docker-28.0.4.tgz',
    archiveBytes: 78_805_317,
    archiveDigest: 'sha256:6b130fa5fb13516620d5ece0b63f63a495cede428bb2f9e24449022e9d72e0cb',
    archiveMember: 'docker/docker',
    file: 'docker',
    executableBytes: 41_631_432,
    executableDigest: 'sha256:b8ab40a60aa9222c2396570dc2ac9cb1e9f6a8dcaf6e19993d33a92f3d1b2a29'
  }),
  buildx: Object.freeze({
    version: '0.23.0',
    url: 'https://github.com/docker/buildx/releases/download/v0.23.0/buildx-v0.23.0.linux-amd64',
    file: 'docker-buildx',
    executableBytes: 66_044_056,
    executableDigest: 'sha256:55838fdd095084e158e06a63635a07fe8a8bc6cb4db507f203394dc1ffa7fb8b'
  }),
  maximumProgramHeaders: 128,
  programHeaderBytes: 56,
  elfHeaderBytes: 64
} as const);

export const LINUX_DOCKER_STATIC_TOOLCHAIN_DIGEST = sha256(LINUX_DOCKER_STATIC_TOOLCHAIN);

/** Known Docker CLI search closure. A private extra directory does not replace it. */
export const LINUX_DOCKER_SYSTEM_PLUGIN_DIRECTORIES = Object.freeze([
  '/usr/local/lib/docker/cli-plugins',
  '/usr/local/libexec/docker/cli-plugins',
  '/usr/lib/docker/cli-plugins',
  '/usr/libexec/docker/cli-plugins'
] as const);

export class LinuxDockerStaticToolchainError extends Error {
  readonly code = 'SEC-LINUX-DOCKER-STATIC-TOOLCHAIN-UNQUALIFIED' as const;

  constructor(
    readonly disposition: 'unsupported' | 'mismatch' | 'unavailable',
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'LinuxDockerStaticToolchainError';
  }
}

function unsupported(message: string): never {
  throw new LinuxDockerStaticToolchainError('unsupported', message);
}

/** Bounded ELF framing only. It does not issue an execution capability. */
export function inspectLinuxDockerStaticElfHeader(header: Uint8Array, fileBytes: number): Readonly<{
  programHeaderOffset: number;
  programHeaderCount: number;
  entryAddress: bigint;
}> {
  const bytes = Buffer.from(header);
  if (!Number.isSafeInteger(fileBytes) || fileBytes < 64 || bytes.length !== 64
      || !bytes.subarray(0, 7).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1]))
      || ![0, 3].includes(bytes[7]!)
      || bytes.readUInt16LE(16) !== 2 || bytes.readUInt16LE(18) !== 62
      || bytes.readUInt32LE(20) !== 1 || bytes.readUInt16LE(52) !== 64
      || bytes.readUInt16LE(54) !== 56) {
    unsupported('Docker static supply requires one ordinary Linux x64 ELF64 executable.');
  }
  const programHeaderOffset = bytes.readBigUInt64LE(32);
  const programHeaderCount = bytes.readUInt16LE(56);
  if (programHeaderCount < 1 || programHeaderCount > LINUX_DOCKER_STATIC_TOOLCHAIN.maximumProgramHeaders
      || programHeaderOffset < 64n
      || programHeaderOffset + BigInt(programHeaderCount * 56) > BigInt(fileBytes)) {
    unsupported('Docker static supply has an out-of-bounds ELF program table.');
  }
  return Object.freeze({
    programHeaderOffset: Number(programHeaderOffset),
    programHeaderCount,
    entryAddress: bytes.readBigUInt64LE(24)
  });
}

/** Explicitly excludes an interpreter/dynamic loader rather than omitting its closure. */
export function assertLinuxDockerStaticElfProgramHeaders(input: Readonly<{
  header: ReturnType<typeof inspectLinuxDockerStaticElfHeader>;
  programHeaders: Uint8Array;
  fileBytes: number;
}>): void {
  const { header } = input;
  const bytes = Buffer.from(input.programHeaders);
  if (!Number.isSafeInteger(input.fileBytes) || input.fileBytes < 64
      || !Number.isSafeInteger(header.programHeaderCount)
      || header.programHeaderCount < 1
      || header.programHeaderCount > LINUX_DOCKER_STATIC_TOOLCHAIN.maximumProgramHeaders
      || bytes.length !== header.programHeaderCount * 56
      || typeof header.entryAddress !== 'bigint') {
    unsupported('Docker static supply ELF program table is incomplete.');
  }
  let entryIsExecutable = false;
  for (let index = 0; index < header.programHeaderCount; index += 1) {
    const offset = index * 56;
    const type = bytes.readUInt32LE(offset);
    if (type === 2 || type === 3) {
      unsupported('Docker supply with an interpreter or dynamic linking is unsupported by this static owner.');
    }
    if (type !== 1) continue;
    const flags = bytes.readUInt32LE(offset + 4);
    const fileOffset = bytes.readBigUInt64LE(offset + 8);
    const virtualAddress = bytes.readBigUInt64LE(offset + 16);
    const fileSize = bytes.readBigUInt64LE(offset + 32);
    const memorySize = bytes.readBigUInt64LE(offset + 40);
    if (fileSize > memorySize || fileOffset + fileSize > BigInt(input.fileBytes)
        || virtualAddress + memorySize > 0xffff_ffff_ffff_ffffn) {
      unsupported('Docker static supply has an out-of-bounds executable segment.');
    }
    if ((flags & 1) !== 0 && header.entryAddress >= virtualAddress
        && header.entryAddress < virtualAddress + fileSize) entryIsExecutable = true;
  }
  if (!entryIsExecutable) unsupported('Docker static supply entry point is outside executable file bytes.');
}
