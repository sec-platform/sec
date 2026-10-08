import { readSync } from 'node:fs';

import { sha256 } from '../../../../contracts/canonical.ts';
import { settleResources } from '../../../../execution/resource-settlement.ts';
import {
  assertRetainedNoFollowProvenDirectoryGeneration,
  retainNoFollowGenerationExecutable,
  scanNoFollowDirectoryTreeInventory,
  type RetainedNoFollowOrdinaryFile,
  type RetainedNoFollowProvenDirectoryGeneration
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  assertLinuxDockerStaticElfProgramHeaders,
  inspectLinuxDockerStaticElfHeader,
  LINUX_DOCKER_STATIC_TOOLCHAIN,
  LINUX_DOCKER_STATIC_TOOLCHAIN_DIGEST,
  LinuxDockerStaticToolchainError
} from '../contract/linux-static-toolchain.ts';

/**
 * Static tool bytes only. This is not a DockerCommandProviderCapability and
 * cannot authorize a process, Engine operation, plugin namespace or hosted
 * origin. The generation publisher retains its own retirement responsibility.
 */
export interface RetainedLinuxDockerStaticToolchain {
  readonly identityDigest: `sha256:${string}`;
  readonly toolchainDigest: string;
  assertCurrent(): Promise<void>;
  close(): void;
}

const issued = new WeakMap<object, Readonly<{
  generation: RetainedNoFollowProvenDirectoryGeneration;
  docker: RetainedNoFollowOrdinaryFile;
  buildx: RetainedNoFollowOrdinaryFile;
  isClosed(): boolean;
}>>();

function unavailable(message: string, cause?: unknown): never {
  throw new LinuxDockerStaticToolchainError('unavailable', message,
    cause === undefined ? undefined : { cause });
}

function readExact(executable: RetainedNoFollowOrdinaryFile, offset: number, count: number): Buffer {
  executable.assertCurrent();
  if (executable.stdioSourceDescriptor === null || !Number.isSafeInteger(offset)
      || offset < 0 || count < 1 || count > 128 * 56
      || offset + count > executable.size) unavailable('Retained Docker ELF read is out of bounds.');
  const bytes = Buffer.alloc(count);
  let read = 0;
  while (read < count) {
    const next = readSync(executable.stdioSourceDescriptor, bytes, read, count - read, offset + read);
    if (next < 1) unavailable('Retained Docker ELF read did not make progress.');
    read += next;
  }
  executable.assertCurrent();
  return bytes;
}

function assertStaticExecutable(executable: RetainedNoFollowOrdinaryFile): void {
  const header = inspectLinuxDockerStaticElfHeader(readExact(executable, 0, 64), executable.size);
  assertLinuxDockerStaticElfProgramHeaders({
    header,
    programHeaders: readExact(executable, header.programHeaderOffset, header.programHeaderCount * 56),
    fileBytes: executable.size
  });
}

/** Borrow one already owner-issued generation; never install, chmod or execute it. */
export async function retainLinuxDockerStaticToolchain(input: Readonly<{
  generation: RetainedNoFollowProvenDirectoryGeneration;
  deadlineAtUnixMs: number;
}>): Promise<RetainedLinuxDockerStaticToolchain> {
  input = Object.freeze({ ...input });
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    throw new LinuxDockerStaticToolchainError('unsupported', 'Static Docker supply requires Linux x64.');
  }
  if (!Number.isSafeInteger(input.deadlineAtUnixMs) || input.deadlineAtUnixMs <= Date.now()) {
    unavailable('Static Docker supply admission has no remaining budget.');
  }
  assertRetainedNoFollowProvenDirectoryGeneration(input.generation, 'Docker static tool generation');
  const generation = input.generation;
  const executables: RetainedNoFollowOrdinaryFile[] = [];
  let closed = false;
  let closeFailure: unknown;
  const close = (): void => {
    if (closed) {
      if (closeFailure !== undefined) throw closeFailure;
      return;
    }
    closed = true;
    try {
      settleResources({ cleanup: [...executables].reverse().map((executable) => ({
        label: `docker-static-${executable.name}-dispose`,
        settle: () => executable.dispose()
      })) });
    } catch (error) { closeFailure = error; throw error; }
  };
  try {
    await generation.assertAuthorityCurrent();
    const inventory = scanNoFollowDirectoryTreeInventory(generation.root, {
      deadlineAtMs: performance.now() + Math.min(30_000, input.deadlineAtUnixMs - Date.now()),
      maximumEntries: 2,
      maximumBytes: LINUX_DOCKER_STATIC_TOOLCHAIN.docker.executableBytes
        + LINUX_DOCKER_STATIC_TOOLCHAIN.buildx.executableBytes
    });
    const tools = [LINUX_DOCKER_STATIC_TOOLCHAIN.docker, LINUX_DOCKER_STATIC_TOOLCHAIN.buildx] as const;
    if (inventory.length !== 2 || tools.some((tool) => !inventory.some((entry) => (
      entry.relativePath === tool.file && entry.kind === 'file' && entry.size === tool.executableBytes
    )))) {
      throw new LinuxDockerStaticToolchainError('mismatch', 'Static Docker generation must contain exactly the pinned CLI and Buildx files.');
    }
    for (const [index, tool] of tools.entries()) {
      if (Date.now() >= input.deadlineAtUnixMs) unavailable('Static Docker supply admission budget expired.');
      const executable = await retainNoFollowGenerationExecutable(
        generation, tool.file, 16 + index, `Docker static ${tool.file}`
      );
      executables.push(executable);
      const observed = executable.digest();
      if (observed.size !== tool.executableBytes || observed.byteDigest !== tool.executableDigest) {
        throw new LinuxDockerStaticToolchainError('mismatch', `Static Docker ${tool.file} differs from the inspected vendor bytes.`);
      }
      assertStaticExecutable(executable);
    }
    const assertCurrent = async (): Promise<void> => {
      if (closed) unavailable('Static Docker toolchain has been closed.');
      await generation.assertAuthorityCurrent();
      generation.assertCurrent();
      for (const executable of executables) executable.assertCurrent();
    };
    await assertCurrent();
    const identityDigest = sha256({
        domain: 'sec.docker.linux-static-toolchain',
        toolchainDigest: LINUX_DOCKER_STATIC_TOOLCHAIN_DIGEST,
        generation: generation.root,
        executables: executables.map((executable) => ({
          file: executable.name, physical: executable.physical, ...executable.digest()
        }))
      }) as `sha256:${string}`;
    // Hashing and the physical owner's final readback can exhaust the budget.
    // No late observation may issue a fresh supply handle after that deadline.
    if (Date.now() >= input.deadlineAtUnixMs) unavailable('Static Docker supply admission budget expired.');
    const capability = Object.freeze({
      toolchainDigest: LINUX_DOCKER_STATIC_TOOLCHAIN_DIGEST,
      identityDigest,
      assertCurrent,
      close
    });
    issued.set(capability, Object.freeze({ generation, docker: executables[0]!, buildx: executables[1]!, isClosed: () => closed }));
    return capability;
  } catch (error) {
    settleResources({ primary: { label: 'docker-static-toolchain-admission', error },
      cleanup: [{ label: 'docker-static-toolchain-close', settle: close }] });
    throw error;
  }
}

export async function assertRetainedLinuxDockerStaticToolchain(
  capability: RetainedLinuxDockerStaticToolchain
): Promise<void> {
  if (!issued.has(capability)) unavailable('Static Docker toolchain is not owner-issued.');
  await capability.assertCurrent();
}

/** Borrowed physical inputs only. The caller must retain the supply lifetime;
 * these inputs cannot establish host isolation or issue an Engine grant. */
export function linuxDockerStaticToolchainInputs(capability: RetainedLinuxDockerStaticToolchain) {
  const retained = issued.get(capability);
  if (retained === undefined) unavailable('Static Docker toolchain is not owner-issued.');
  if (retained.isClosed()) unavailable('Static Docker toolchain has been closed.');
  retained.generation.assertCurrent();
  retained.docker.assertCurrent();
  retained.buildx.assertCurrent();
  return retained;
}
