import { fstatSync } from 'node:fs';

import { sha256 } from '../../../../contracts/canonical.ts';
import type { OperationDigest } from '../../../../execution/operation/semantic.ts';
import { settleResources } from '../../../../execution/resource-settlement.ts';
import {
  assertSameNoFollowDirectoryIdentity,
  createExclusiveNoFollowRandomDirectory,
  createNoFollowOrdinaryDirectoryChain,
  inspectNoFollowDirectoryChain,
  inspectNoFollowOrdinaryFileEntry,
  publishExclusiveDurableCanonicalFile,
  retainNoFollowDirectoryForChildProcess,
  retireNoFollowDirectoryTree,
  scanNoFollowDirectoryTreeInventory,
  type PhysicalDirectoryIdentity,
  type RetainedNoFollowChildProcessDirectory
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { DOCKER_LINUX_INSTALLATION_PROFILE as profile } from '../contract/linux-installation-profile.ts';
import { assertLinuxDockerPluginSearch, openLinuxDockerPluginSearch, type LinuxDockerPluginSearch } from './linux-plugin-search.ts';
import type { RetainedLinuxDockerStaticToolchain } from './linux-static-toolchain.ts';

/** One exclusive, credential-free configuration and temporary-state lifetime. */
export interface LinuxDockerRuntimeState {
  readonly identityDigest: OperationDigest;
  readonly environment: Readonly<NodeJS.ProcessEnv>;
  assertCurrent(): void;
  close(): void;
}

/** Exact recovery locator for a private root that could not be settled within
 * its original budget. The error never authorizes a prefix-based cleanup. */
export class LinuxDockerRuntimeStateSettlementError extends Error {
  readonly code = 'SEC-LINUX-DOCKER-RUNTIME-SETTLEMENT-UNKNOWN' as const;
  readonly disposition = 'unknown' as const;
  readonly ownedRoot: PhysicalDirectoryIdentity;
  constructor(root: PhysicalDirectoryIdentity, cause: unknown) {
    super('Linux Docker private runtime settlement is unconfirmed.', { cause });
    this.ownedRoot = Object.freeze({ ...root });
  }
}

const issued = new WeakSet<object>();
const cliSearch = new WeakMap<object, LinuxDockerPluginSearch>();

export function assertLinuxDockerRuntimeState(value: LinuxDockerRuntimeState): void {
  if (!issued.has(value)) throw new Error('Linux Docker runtime state is not owner-issued.');
  value.assertCurrent();
}

export function assertLinuxDockerCliRuntimeState(state: LinuxDockerRuntimeState, toolchain: RetainedLinuxDockerStaticToolchain): void {
  assertLinuxDockerRuntimeState(state);
  const search = cliSearch.get(state);
  if (search === undefined || search.toolchainIdentityDigest !== toolchain.identityDigest) {
    throw new Error('Linux Docker CLI runtime does not bind the retained static toolchain.');
  }
  assertLinuxDockerPluginSearch(search);
}

export function openLinuxDockerRuntimeState(input?: Readonly<{
  toolchain: RetainedLinuxDockerStaticToolchain;
  deadlineAtUnixMs: number;
}>): LinuxDockerRuntimeState {
  input = input === undefined ? undefined : Object.freeze({ ...input });
  if (process.platform !== 'linux') throw new Error('Linux Docker runtime state is unavailable.');
  const parent = inspectNoFollowDirectoryChain(profile.runtimeParent, 'Docker runtime parent').target;
  const root = createExclusiveNoFollowRandomDirectory(parent, profile.runtimePrefix);
  const retained: Array<Readonly<{
    identity: PhysicalDirectoryIdentity;
    capability: RetainedNoFollowChildProcessDirectory;
  }>> = [];
  let configuration: PhysicalDirectoryIdentity | undefined;
  let pluginSearch: LinuxDockerPluginSearch | undefined;
  let configurationText: string | undefined;
  let closed = false;
  let closeFailure: unknown;
  const retire = (): void => {
    const remainingMs = input === undefined ? profile.runtimeRetirementTimeoutMs
      : Math.min(profile.runtimeRetirementTimeoutMs, input.deadlineAtUnixMs - Date.now());
    if (remainingMs <= 0) throw new Error('Linux Docker private runtime original retirement deadline expired.');
    const deadlineAtMonotonicMs = performance.now() + remainingMs;
    const inventory = scanNoFollowDirectoryTreeInventory(root, {
      deadlineAtMs: deadlineAtMonotonicMs,
      maximumEntries: profile.maximumRuntimeEntries,
      maximumBytes: profile.maximumRuntimeBytes
    });
    retireNoFollowDirectoryTree({ parent, root, inventory, deadlineAtMonotonicMs });
  };
  const assertCurrent = (): void => {
    if (closed) throw new Error('Linux Docker runtime state is closed.');
    if (configuration !== undefined) {
      const config = inspectNoFollowOrdinaryFileEntry(configuration, 'config.json', { maximumBytes: 4096 });
      if (configurationText !== undefined && (config === null || config.bytes === null
          || Buffer.from(config.bytes).toString('utf8') !== configurationText)) {
        throw new Error('Linux Docker CLI config differs from the exact private plugin-search configuration.');
      }
      if (config !== null && configurationText === undefined) {
        if (config.kind !== 'file' || config.bytes === null) throw new Error('Linux Docker config is not an ordinary file.');
        let value: unknown;
        try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(config.bytes)); }
        catch { throw new Error('Linux Docker config is not valid UTF-8 JSON.'); }
        if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 0) {
          throw new Error('Linux Docker config must remain credential-free and cannot add plugin search paths.');
        }
      }
    }
    pluginSearch?.assertCurrent();
    for (const { identity, capability } of retained) {
      capability.assertCurrent();
      assertSameNoFollowDirectoryIdentity(identity, 'Linux Docker private runtime directory');
      const metadata = fstatSync(capability.stdioSourceDescriptor!, { bigint: true });
      if (!metadata.isDirectory() || metadata.uid !== BigInt(process.geteuid!())
          || (metadata.mode & 0o777n) !== 0o700n) {
        throw new Error('Linux Docker runtime directory is not private to the effective owner.');
      }
    }
  };
  const close = (): void => {
    if (closed) {
      if (closeFailure !== undefined) throw closeFailure;
      return;
    }
    try {
      settleResources({ cleanup: [
        { label: 'private-runtime-readback', settle: assertCurrent },
        { label: 'private-plugin-search-close', settle: () => pluginSearch?.close() },
        ...[...retained].reverse().map(({ capability }, index) => ({
          label: `private-runtime-descriptor-${index}`, settle: () => capability.dispose()
        })),
        { label: 'private-runtime-retirement', settle: retire }
      ] });
    } catch (error) {
      closeFailure = new LinuxDockerRuntimeStateSettlementError(root, error);
      throw closeFailure;
    } finally {
      closed = true;
    }
  };
  try {
    const retain = (identity: PhysicalDirectoryIdentity): string => {
      const capability = retainNoFollowDirectoryForChildProcess(
        assertSameNoFollowDirectoryIdentity(identity, 'Linux Docker private runtime directory'),
        41 + retained.length,
        'Linux Docker private runtime directory'
      );
      retained.push({ identity, capability });
      // Children and their helpers address this owner's live descriptor. Go's
      // exec may close inherited descriptors, so /proc/self/fd is not enough.
      return `/proc/${process.pid}/fd/${capability.stdioSourceDescriptor}`;
    };
    retain(root);
    const home = retain(createNoFollowOrdinaryDirectoryChain(root, ['home']));
    configuration = createNoFollowOrdinaryDirectoryChain(root, ['config']);
    const config = retain(configuration);
    const temporary = retain(createNoFollowOrdinaryDirectoryChain(root, ['tmp']));
    if (input !== undefined) {
      const denyDirectory = createNoFollowOrdinaryDirectoryChain(root, ['deny-plugins']);
      retain(denyDirectory);
      pluginSearch = openLinuxDockerPluginSearch({
        toolchain: input.toolchain, denyDirectory, privateConfig: configuration,
        deadlineAtUnixMs: input.deadlineAtUnixMs
      });
      configurationText = `${JSON.stringify({ cliPluginsExtraDirs: pluginSearch.extraDirectories })}\n`;
      publishExclusiveDurableCanonicalFile({
        parent: configuration, name: 'config.json', bytes: Buffer.from(configurationText),
        permissionMode: 0o400,
        validate: (bytes) => {
          if (Buffer.from(bytes).toString('utf8') !== configurationText) throw new Error('Linux Docker private config bytes changed.');
        }
      });
    }
    assertCurrent();
    const environment = Object.freeze({
      HOME: home, DOCKER_CONFIG: config, PATH: '',
      TEMP: temporary, TMP: temporary, TMPDIR: temporary,
      LANG: 'C', LC_ALL: 'C', TZ: 'UTC'
    });
    const state = Object.freeze({
      identityDigest: sha256({
        domain: 'sec.docker.linux-private-runtime',
        directories: retained.map(({ identity }) => identity),
        environment,
        ...(pluginSearch === undefined ? {} : { pluginSearch: pluginSearch.identityDigest })
      }) as OperationDigest,
      environment, assertCurrent, close
    });
    issued.add(state);
    if (pluginSearch !== undefined) cliSearch.set(state, pluginSearch);
    return state;
  } catch (error) {
    settleResources({
      primary: { label: 'private-runtime-admission', error },
      cleanup: [{ label: 'private-runtime-close', settle: close }]
    });
    throw error;
  }
}
