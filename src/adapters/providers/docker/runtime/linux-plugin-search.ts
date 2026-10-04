import { fstatSync } from 'node:fs';
import path from 'node:path';

import { sha256 } from '../../../../contracts/canonical.ts';
import { settleResources } from '../../../../execution/resource-settlement.ts';
import {
  inspectExactNoFollowDirectoryPresence,
  inspectNoFollowDirectoryChain,
  publishExclusiveDurableCanonicalFile,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile,
  scanNoFollowDirectoryDirectMetadata,
  type PhysicalDirectoryIdentity,
  type RetainedNoFollowChildProcessDirectory,
  type RetainedNoFollowOrdinaryFile
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { LINUX_DOCKER_CLI_PROFILE } from '../contract/linux-cli-profile.ts';
import { LINUX_DOCKER_SYSTEM_PLUGIN_DIRECTORIES } from '../contract/linux-static-toolchain.ts';
import { linuxDockerStaticToolchainInputs, type RetainedLinuxDockerStaticToolchain } from './linux-static-toolchain.ts';

/** Search observation and private deny files, not arbitrary-writer exclusion. */
export interface LinuxDockerPluginSearch {
  readonly identityDigest: `sha256:${string}`;
  readonly toolchainIdentityDigest: `sha256:${string}`;
  readonly extraDirectories: readonly string[];
  assertCurrent(): void;
  close(): void;
}

const issued = new WeakSet<object>();
const candidateName = /^docker-[a-z][a-z0-9]*$/u;
const denyFiles = new WeakSet<object>();

export class LinuxDockerPluginSearchUnavailableError extends Error {
  readonly code = 'SEC-LINUX-DOCKER-PLUGIN-SEARCH-UNAVAILABLE' as const;
  constructor(message: string, readonly disposition: 'unsupported' | 'unavailable' = 'unavailable') { super(message); }
}

function fail(message: string, disposition: 'unsupported' | 'unavailable' = 'unavailable'): never {
  throw new LinuxDockerPluginSearchUnavailableError(`Linux Docker plugin search: ${message}`, disposition);
}

/** Ordinary-file producer only; does not prove the complete search namespace. */
export function retainLinuxDockerPluginDenyFile(input: Readonly<{
  directory: PhysicalDirectoryIdentity;
  name: string;
  deadlineAtUnixMs: number;
}>): RetainedNoFollowOrdinaryFile {
  if (process.platform !== 'linux') fail('deny candidate production requires Linux', 'unsupported');
  if (!candidateName.test(input.name) || input.name === 'docker-buildx'
      || input.name.length > 255 || !Number.isSafeInteger(input.deadlineAtUnixMs)
      || Date.now() >= input.deadlineAtUnixMs) fail('deny candidate name or original deadline is invalid');
  publishExclusiveDurableCanonicalFile({
    parent: input.directory, name: input.name, bytes: Buffer.alloc(0),
    permissionMode: LINUX_DOCKER_CLI_PROFILE.pluginSearch.denyCandidate.mode,
    validate: (bytes) => { if (bytes.byteLength !== 0) fail('deny candidate has bytes'); }
  });
  const marker = retainNoFollowOrdinaryFile(inspectNoFollowDirectoryChain(input.directory.path), input.name,
    undefined, 'Docker non-executable deny candidate', 51);
  denyFiles.add(marker);
  try { assertLinuxDockerPluginDenyFile(marker); return marker; }
  catch (error) {
    settleResources({ primary: { label: 'deny-candidate-readback', error },
      cleanup: [{ label: 'deny-candidate-dispose', settle: () => marker.dispose() }] });
    throw error;
  }
}

export function assertLinuxDockerPluginDenyFile(marker: RetainedNoFollowOrdinaryFile): void {
  if (!denyFiles.has(marker)) fail('deny file is not owner-issued');
  marker.assertCurrent();
  const metadata = fstatSync(marker.stdioSourceDescriptor!, { bigint: true });
  if (!metadata.isFile() || metadata.size !== 0n || metadata.nlink !== 1n
      || metadata.uid !== BigInt(process.geteuid!()) || (metadata.mode & 0o7777n) !== 0o400n) {
    fail('deny candidate bytes, mode, owner or link count changed');
  }
}

export function assertLinuxDockerPluginSearch(value: LinuxDockerPluginSearch): void {
  if (!issued.has(value)) fail('search is not owner-issued');
  value.assertCurrent();
}

/**
 * Docker v28 manager.GetPlugin/ListPlugins/PluginRunCommand select only the
 * first candidate. Invalid metadata is terminal for that name, never fallback.
 * Empty, non-executable first candidates therefore make lower executable bytes
 * unreachable, including help and flag-error metadata discovery. Only the
 * original pinned docker-buildx may execute. No link or executable alias is
 * created here. Admission still requires a separate authenticated host lifetime
 * that excludes candidate writers; these readbacks cannot create that premise.
 */
export function openLinuxDockerPluginSearch(input: Readonly<{
  toolchain: RetainedLinuxDockerStaticToolchain;
  denyDirectory: PhysicalDirectoryIdentity;
  privateConfig: PhysicalDirectoryIdentity;
  deadlineAtUnixMs: number;
}>): LinuxDockerPluginSearch {
  input = Object.freeze({ ...input,
    denyDirectory: Object.freeze({ ...input.denyDirectory }),
    privateConfig: Object.freeze({ ...input.privateConfig })
  });
  const supply = linuxDockerStaticToolchainInputs(input.toolchain);
  const directories: RetainedNoFollowChildProcessDirectory[] = [];
  const markers: RetainedNoFollowOrdinaryFile[] = [];
  let closed = false;
  let closeFailure: unknown;
  const checkBudget = (): void => {
    if (!Number.isSafeInteger(input.deadlineAtUnixMs) || Date.now() >= input.deadlineAtUnixMs) {
      fail('original admission deadline is exhausted');
    }
  };
  const close = (): void => {
    if (closed) { if (closeFailure !== undefined) throw closeFailure; return; }
    closed = true;
    try {
      settleResources({ cleanup: [
        ...[...markers].reverse().map((marker) => ({ label: `deny-${marker.name}`, settle: () => marker.dispose() })),
        ...[...directories].reverse().map((directory, index) => ({ label: `plugin-parent-${index}`, settle: () => directory.dispose() }))
      ] });
    } catch (error) { closeFailure = error; throw error; }
  };
  try {
    checkBudget();
    const scan = (root: PhysicalDirectoryIdentity) => scanNoFollowDirectoryDirectMetadata(root, {
      deadlineAtMs: performance.now() + Math.max(0, input.deadlineAtUnixMs - Date.now()),
      maximumEntries: LINUX_DOCKER_CLI_PROFILE.pluginSearch.maximumEntriesPerDirectory,
      includePermissionMode: true
    });
    const retainedParents = new Map<string, RetainedNoFollowChildProcessDirectory>();
    const observeDefault = (directory: string, retain: boolean) => {
      const parents: PhysicalDirectoryIdentity[] = [];
      let current = '/';
      // Retain every present ancestor, including the parent of the first
      // missing component. Absence never drops the remaining requested path.
      for (const part of ['', ...directory.slice(1).split('/')]) {
        current = part === '' ? '/' : path.posix.join(current, part);
        const observed = inspectExactNoFollowDirectoryPresence(current, 'Docker system plugin directory');
        if (observed.state === 'absent') return Object.freeze({ directory, parents, absentAt: current, entries: null });
        const physical = observed.directory.target;
        parents.push(physical);
        let handle = retainedParents.get(current);
        if (handle === undefined && retain) {
          handle = retainNoFollowDirectoryForChildProcess(observed.directory, 50, 'Docker system plugin parent');
          retainedParents.set(current, handle);
          directories.push(handle);
        }
        if (handle === undefined) fail('previously absent system plugin ancestor appeared');
        handle.assertCurrent();
        const metadata = fstatSync(handle.stdioSourceDescriptor!, { bigint: true });
        if (metadata.uid !== 0n || (metadata.mode & 0o022n) !== 0n) fail('system plugin parent is not administrator-owned');
      }
      return Object.freeze({ directory, parents, absentAt: null, entries: scan(parents.at(-1)!) });
    };
    const before = LINUX_DOCKER_SYSTEM_PLUGIN_DIRECTORIES.map((directory) => observeDefault(directory, true));
    const names = [...new Set(before.flatMap(({ entries }) => (entries ?? [])
      .filter(({ kind, relativePath }) => (kind === 'file' || kind === 'link')
        && candidateName.test(relativePath) && relativePath !== 'docker-buildx')
      .map(({ relativePath }) => relativePath)))].sort();
    if (names.length > LINUX_DOCKER_CLI_PROFILE.pluginSearch.maximumEntriesPerDirectory) fail('aggregate candidate bound exceeded');
    if (scan(input.denyDirectory).length !== 0) fail('deny directory must start empty');
    for (const name of names) {
      checkBudget();
      markers.push(retainLinuxDockerPluginDenyFile({ directory: input.denyDirectory, name, deadlineAtUnixMs: input.deadlineAtUnixMs }));
    }
    const denyInventory = scan(input.denyDirectory);
    const defaultsDigest = sha256(before);
    const assertCurrent = (): void => {
      if (closed) fail('search has been closed');
      checkBudget();
      linuxDockerStaticToolchainInputs(input.toolchain);
      for (const directory of directories) directory.assertCurrent();
      if (sha256(LINUX_DOCKER_SYSTEM_PLUGIN_DIRECTORIES.map((directory) => observeDefault(directory, false))) !== defaultsDigest) {
        fail('system plugin membership or negative dependency changed');
      }
      if (inspectExactNoFollowDirectoryPresence(path.posix.join(input.privateConfig.path, 'cli-plugins')).state !== 'absent') {
        fail('private default plugin directory must remain absent');
      }
      if (sha256(scan(input.denyDirectory)) !== sha256(denyInventory)) fail('deny candidate membership changed');
      for (const marker of markers) {
        assertLinuxDockerPluginDenyFile(marker);
      }
    };
    assertCurrent();
    const extraDirectories = Object.freeze([supply.generation.root.path, input.denyDirectory.path]);
    const capability = Object.freeze({
      identityDigest: sha256({ domain: 'sec.docker.linux-plugin-search', toolchain: input.toolchain.identityDigest,
        before, denyDirectory: input.denyDirectory, denyInventory, privateConfig: input.privateConfig, extraDirectories }) as `sha256:${string}`,
      toolchainIdentityDigest: input.toolchain.identityDigest,
      extraDirectories, assertCurrent, close
    });
    issued.add(capability);
    return capability;
  } catch (error) {
    settleResources({ primary: { label: 'plugin-search-admission', error }, cleanup: [{ label: 'plugin-search-close', settle: close }] });
    throw error;
  }
}
