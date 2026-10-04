import { fstatSync } from 'node:fs';
import path from 'node:path';
import { types as nativeTypes } from 'node:util';
import { assertRetainedCommandBoundaryCurrent } from '../../../runtime-state/physical/runtime/retained-command-boundary.ts';

import { sha256 } from '../../../../contracts/canonical.ts';
import type { OperationDigest } from '../../../../execution/operation/semantic.ts';
import { settleResources as settlePhysicalResources } from '../../../../execution/resource-settlement.ts';
import type { PhysicalDirectoryIdentity, RetainedNoFollowOrdinaryFile } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  assertRetainedNoFollowCapability,
  assertSameNoFollowDirectoryIdentity
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  retainedCommandBoundaryAuxiliaryInputs,
  type RetainedCommandAuxiliaryInput,
  type RetainedCommandBoundary
} from '../../../runtime-state/physical/runtime/retained-command-boundary.ts';
import type {
  RetainedRuntimeStateDirectory
} from '../../../runtime-state/physical/runtime/retained-runtime-state-directory.ts';
import {
  DockerCommandProviderUnavailableError,
  type DockerCommandProviderCapability
} from '../contract/command-provider.ts';
import { LINUX_DOCKER_CLI_PROFILE_DIGEST } from '../contract/linux-cli-profile.ts';
import { assertQualifiedLinuxDockerCliBinding, type QualifiedLinuxDockerCli } from './linux-cli-qualification.ts';
import { assertLinuxDockerEndpoint, type LinuxDockerEndpoint } from './linux-endpoint.ts';
import { assertLinuxDockerRuntimeState, type LinuxDockerRuntimeState } from './linux-runtime-state.ts';

const DOCKER_COMMAND_ENVIRONMENT_KEYS = new Set([
  'APPDATA',
  'DOCKER_CONFIG',
  'HOME',
  'LANG',
  'LC_ALL',
  'LOCALAPPDATA',
  'PATH',
  'PROGRAMDATA',
  'PROGRAMFILES',
  'SYSTEMROOT',
  'TEMP',
  'TMP',
  'TMPDIR',
  'TZ',
  'USERPROFILE',
  'WINDIR'
]);

export interface DockerCommandProviderObservation {
  readonly linuxCli?: QualifiedLinuxDockerCli;
  readonly boundary: RetainedCommandBoundary;
  readonly commandProtocol?: 'docker-cli' | 'engine-http';
  readonly daemonProbe?: RetainedNoFollowOrdinaryFile;
  readonly endpointHost?: string;
  readonly linuxEndpoint?: LinuxDockerEndpoint;
  readonly privateState?: LinuxDockerRuntimeState;
  readonly environment: Readonly<NodeJS.ProcessEnv>;
  readonly retainedOwners?: readonly RetainedRuntimeStateDirectory[];
  readonly platform: NodeJS.Platform;
  readonly providerContractDigest: OperationDigest;
  readonly workingDirectory: PhysicalDirectoryIdentity;
}

export interface ClaimedDockerCommandProvider {
  readonly linuxCli?: QualifiedLinuxDockerCli;
  readonly auxiliaryInputs: readonly RetainedCommandAuxiliaryInput[];
  readonly boundary: RetainedCommandBoundary;
  readonly commandProtocol: 'docker-cli' | 'engine-http';
  readonly daemonProbe?: RetainedNoFollowOrdinaryFile;
  readonly endpointHost?: string;
  readonly linuxEndpoint?: LinuxDockerEndpoint;
  readonly privateState?: LinuxDockerRuntimeState;
  readonly environment: Readonly<NodeJS.ProcessEnv>;
  readonly environmentDigest: OperationDigest;
  readonly retainedOwners: readonly RetainedRuntimeStateDirectory[];
  readonly executable: string;
  readonly platform: NodeJS.Platform;
  readonly providerIdentityDigest: OperationDigest;
  readonly workingDirectory: PhysicalDirectoryIdentity;
}

type DockerCommandProviderRecord = ClaimedDockerCommandProvider & {
  state: 'available' | 'claimed' | 'disposed';
};

const dockerCommandProviders = new WeakMap<object, DockerCommandProviderRecord>();
const claimedDockerCommandProviders = new WeakMap<object, DockerCommandProviderRecord>();

function settleDockerCommandProviderRecord(
  record: DockerCommandProviderRecord,
  primary?: Readonly<{ label: string; error: unknown }>
): void {
  record.state = 'disposed';
  settlePhysicalResources({
    ...(primary === undefined ? {} : { primary }),
    cleanup: [
      { label: 'linux-endpoint-close', settle: () => record.linuxEndpoint?.close() },
      { label: 'private-state-close', settle: () => record.privateState?.close() },
      { label: 'daemon-probe-dispose', settle: () => record.daemonProbe?.dispose() },
      ...[...record.auxiliaryInputs].reverse().map((auxiliary, index) => ({
        label: `auxiliary-input-dispose-${index}`,
        settle: () => auxiliary.capability.dispose()
      })),
      ...[...record.retainedOwners].reverse().map((owner, index) => ({
        label: `retained-owner-close-${index}`,
        settle: () => { owner.close(); }
      })),
      {
        label: 'working-directory-dispose',
        settle: () => record.boundary.workingDirectory.dispose()
      },
      {
        label: 'executable-dispose',
        // The qualified static supply owns both retained executable handles.
        settle: () => { if (record.linuxCli === undefined) record.boundary.executable.dispose(); }
      },
      { label: 'linux-cli-close', settle: () => record.linuxCli?.close() },
    ]
  });
}

function providerFailure(message: string, cause?: unknown): never {
  throw new DockerCommandProviderUnavailableError(
    message,
    cause === undefined ? undefined : { cause }
  );
}

function canonicalAbsolutePath(value: unknown, platform: NodeJS.Platform, label: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) {
    providerFailure(`Docker command provider ${label} is invalid.`);
  }
  const pathOwner = platform === 'win32' ? path.win32 : path.posix;
  const canonical = pathOwner.resolve(value);
  if (!pathOwner.isAbsolute(value) || canonical !== value) {
    providerFailure(`Docker command provider ${label} is noncanonical.`);
  }
  return canonical;
}

function canonicalEnvironment(
  source: Readonly<NodeJS.ProcessEnv>,
  platform: NodeJS.Platform
): Readonly<NodeJS.ProcessEnv> {
  const entries = Object.entries(source);
  const folded = new Set<string>();
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    const canonicalKey = key.toUpperCase();
    if (!DOCKER_COMMAND_ENVIRONMENT_KEYS.has(canonicalKey)
        || folded.has(canonicalKey)
        || value === undefined
        || value.includes('\0')) {
      providerFailure('Docker command provider environment is noncanonical.');
    }
    folded.add(canonicalKey);
    environment[canonicalKey] = value;
  }
  const required = platform === 'win32'
    ? ['APPDATA', 'HOME', 'LOCALAPPDATA', 'PATH', 'PROGRAMDATA',
      'PROGRAMFILES', 'SYSTEMROOT', 'TEMP', 'TMP', 'USERPROFILE', 'WINDIR']
    : ['HOME', 'PATH', 'TEMP', 'TMP'];
  if (required.some((key) => environment[key] === undefined)) {
    providerFailure('Docker command provider environment is incomplete.');
  }
  for (const key of required.filter((key) => platform === 'win32' || key !== 'PATH')) {
    environment[key] = canonicalAbsolutePath(environment[key], platform, `environment ${key}`);
  }
  if (platform !== 'win32' && environment.PATH !== '') {
    providerFailure('Docker command provider PATH must be empty.');
  }
  for (const key of ['DOCKER_CONFIG', 'TMPDIR']) {
    if (environment[key] !== undefined) {
      if (platform !== 'linux') providerFailure(`Docker command provider ${key} requires Linux.`);
      environment[key] = canonicalAbsolutePath(environment[key], platform, `environment ${key}`);
    }
  }
  if (environment.TMPDIR !== undefined && environment.TMPDIR !== environment.TMP) {
    providerFailure('Docker command provider TMPDIR and TMP must have one owner.');
  }
  if (environment.TEMP !== environment.TMP) {
    providerFailure('Docker command provider TEMP and TMP must have one owner.');
  }
  if (platform === 'win32') {
    if (environment.HOME !== environment.USERPROFILE) {
      providerFailure('Docker command provider profile has multiple owners.');
    }
    if (environment.SYSTEMROOT !== environment.WINDIR) {
      providerFailure('Docker command provider Windows root has multiple owners.');
    }
    if (environment.PATH !== path.win32.join(environment.SYSTEMROOT!, 'System32')) {
      providerFailure('Docker command provider PATH is not the retained Windows system directory.');
    }
  }
  return Object.freeze(environment);
}

/**
 * Converts one physical-owner observation into the only Docker command
 * provider capability. No executable discovery or ambient environment read is
 * performed here. Ownership of the retained boundary transfers to the first
 * successful session claim.
 */
export function issueDockerCommandProviderCapability(
  observation: DockerCommandProviderObservation
): DockerCommandProviderCapability {
  const capture = <Value extends object>(source: Value): Value => {
    if (nativeTypes.isProxy(source)) providerFailure('Docker provider observation cannot be a Proxy.');
    const descriptors = Object.getOwnPropertyDescriptors(source);
    for (const key of Reflect.ownKeys(descriptors)) {
      const descriptor = Object.getOwnPropertyDescriptor(descriptors, key)!.value;
      if (!Object.hasOwn(descriptor, 'value')) providerFailure('Docker provider observation requires own data.');
    }
    return Object.freeze(Object.defineProperties({}, descriptors)) as Value;
  };
  const ancestry = new WeakSet<object>();
  const pure = <Value>(source: Value): Value => {
    if (source === null || typeof source !== 'object') return source;
    if (ancestry.has(source)) providerFailure('Docker provider data cannot contain a cycle.');
    ancestry.add(source);
    const captured = capture(source);
    const output = Array.isArray(source) ? [] : {};
    for (const key of Reflect.ownKeys(captured)) {
      if (Array.isArray(source) && key === 'length') continue;
      Object.defineProperty(output, key, { value: pure(Object.getOwnPropertyDescriptor(captured, key)!.value), enumerable: true });
    }
    ancestry.delete(source);
    return Object.freeze(output) as Value;
  };
  observation = capture(observation);
  observation = Object.freeze({ ...observation,
    environment: pure(observation.environment),
    workingDirectory: pure(observation.workingDirectory),
    retainedOwners: observation.retainedOwners === undefined ? undefined : Object.freeze(
      Object.values(Object.getOwnPropertyDescriptors(capture(observation.retainedOwners)))
        .filter(descriptor => descriptor.enumerable).map(descriptor => descriptor.value)
    )
  });
  assertRetainedCommandBoundaryCurrent(observation.boundary);
  if (!/^sha256:[a-f0-9]{64}$/u.test(observation.providerContractDigest)) {
    providerFailure('Docker command provider contract identity is invalid.');
  }
  try {
    if (observation.linuxCli !== undefined) {
      if (observation.platform !== 'linux' || observation.commandProtocol !== 'docker-cli'
          || observation.daemonProbe !== undefined || observation.providerContractDigest !== LINUX_DOCKER_CLI_PROFILE_DIGEST) {
        providerFailure('Qualified Linux CLI has an incompatible command protocol or policy.');
      }
      assertQualifiedLinuxDockerCliBinding(observation.linuxCli, {
        executable: observation.boundary.executable, workingDirectory: observation.boundary.workingDirectory,
        runtimeState: observation.privateState, endpoint: observation.linuxEndpoint
      });
      const observed = assertSameNoFollowDirectoryIdentity(observation.workingDirectory, 'Qualified Linux Docker cwd').target;
      const retained = fstatSync(observation.boundary.workingDirectory.stdioSourceDescriptor!, { bigint: true });
      if (observed.device !== String(retained.dev) || observed.inode !== String(retained.ino)) {
        providerFailure('Qualified Linux Docker working-directory projection differs from its retained descriptor.');
      }
    }
    assertRetainedNoFollowCapability(
      observation.boundary.executable,
      'executable',
      'Docker command provider executable'
    );
    assertRetainedNoFollowCapability(
      observation.boundary.workingDirectory,
      'working-directory',
      'Docker command provider working directory'
    );
    observation.boundary.executable.assertCurrent();
    observation.boundary.workingDirectory.assertCurrent();
    for (const owner of observation.retainedOwners ?? []) owner.assertCurrent();
    if (observation.daemonProbe !== undefined) {
      assertRetainedNoFollowCapability(observation.daemonProbe, 'executable', 'Docker daemon probe');
      observation.daemonProbe.assertCurrent();
      if (observation.platform !== 'linux' || observation.endpointHost === undefined) {
        providerFailure('Daemon probe requires a Linux endpoint.');
      }
    }
    if (observation.privateState !== undefined) assertLinuxDockerRuntimeState(observation.privateState);
    if (observation.linuxEndpoint !== undefined) {
      assertLinuxDockerEndpoint(observation.linuxEndpoint);
      if (observation.platform !== 'linux' || observation.endpointHost !== observation.linuxEndpoint.endpointHost) {
        providerFailure('Linux Docker endpoint owner does not bind the declared endpoint.');
      }
    }
  } catch (error) {
    providerFailure('Docker command provider physical observation is unavailable.', error);
  }
  const executable = canonicalAbsolutePath(
    observation.boundary.executable.path,
    observation.platform,
    'executable path'
  );
  const workingDirectoryPath = canonicalAbsolutePath(
    observation.workingDirectory.path,
    observation.platform,
    'working directory'
  );
  if (observation.platform === 'win32'
      && observation.boundary.workingDirectory.childPath !== workingDirectoryPath) {
    providerFailure('Docker command provider working-directory observation changed.');
  }
  const environment = canonicalEnvironment(observation.environment, observation.platform);
  const commandProtocol = observation.commandProtocol ?? 'docker-cli';
  if (commandProtocol !== 'docker-cli' && (commandProtocol !== 'engine-http'
      || observation.platform !== 'linux' || observation.daemonProbe !== observation.boundary.executable)) {
    providerFailure('Container Engine HTTP protocol must retain its actual daemon probe executable.');
  }
  if (observation.endpointHost !== undefined
      && (observation.platform !== 'linux'
        || !/^unix:\/\/\/[^\u0000-\u001f]+$/u.test(observation.endpointHost)
        || path.posix.resolve(observation.endpointHost.slice(7)) !== observation.endpointHost.slice(7))) {
    providerFailure('Docker command provider endpoint is noncanonical.');
  }
  if (observation.privateState !== undefined
      && JSON.stringify(Object.entries(environment).sort())
        !== JSON.stringify(Object.entries(observation.privateState.environment).sort())) {
    providerFailure('Docker command provider private runtime environment changed.');
  }
  const auxiliaryInputs = retainedCommandBoundaryAuxiliaryInputs(observation.boundary);
  const retainedOwners = Object.freeze([...(observation.retainedOwners ?? [])]);
  const environmentDigest = sha256({
    domain: 'sec.docker.command-provider.environment',
    entries: Object.entries(environment)
  }) as OperationDigest;
  const executableDigest = observation.boundary.executable.digest();
  const providerIdentityDigest = sha256({
    domain: 'sec.docker.command-provider',
    ...(observation.linuxCli === undefined ? {} : { linuxCli: observation.linuxCli.identityDigest }),
    ...(commandProtocol === 'docker-cli' ? {} : { commandProtocol }),
    ...(observation.endpointHost === undefined ? {} : { endpointHost: observation.endpointHost }),
    ...(observation.linuxEndpoint === undefined ? {} : { linuxEndpoint: observation.linuxEndpoint.identityDigest }),
    ...(observation.privateState === undefined ? {} : { privateState: observation.privateState.identityDigest }),
    ...(observation.daemonProbe === undefined ? {} : { daemonProbe: {
      path: observation.daemonProbe.path, parent: observation.daemonProbe.parent,
      physical: observation.daemonProbe.physical, ...observation.daemonProbe.digest()
    } }),
    environmentDigest,
    auxiliaryInputs: auxiliaryInputs.map(({ capability, kind }) => ({
      kind,
      childPath: capability.childPath,
      ...('physical' in capability ? {
        parent: capability.parent,
        physical: capability.physical,
        ...capability.digest()
      } : {})
    })),
    retainedOwners: retainedOwners.map(({ root, directory }) => ({ root, directory })),
    executable: {
      path: executable,
      parent: observation.boundary.executable.parent,
      physical: observation.boundary.executable.physical,
      ...executableDigest
    },
    platform: observation.platform,
    providerContractDigest: observation.providerContractDigest,
    workingDirectory: observation.workingDirectory
  }) as OperationDigest;
  const capability = Object.freeze({
    executable,
    commandProtocol,
    providerIdentityDigest,
    workingDirectory: workingDirectoryPath
  });
  dockerCommandProviders.set(capability, {
    ...(observation.linuxCli === undefined ? {} : { linuxCli: observation.linuxCli }),
    auxiliaryInputs,
    commandProtocol,
    boundary: observation.boundary,
    ...(observation.daemonProbe === undefined ? {} : { daemonProbe: observation.daemonProbe }),
    ...(observation.endpointHost === undefined ? {} : { endpointHost: observation.endpointHost }),
    ...(observation.privateState === undefined ? {} : { privateState: observation.privateState }),
    ...(observation.linuxEndpoint === undefined ? {} : { linuxEndpoint: observation.linuxEndpoint }),
    environment,
    environmentDigest,
    retainedOwners,
    executable,
    platform: observation.platform,
    providerIdentityDigest,
    state: 'available',
    workingDirectory: observation.workingDirectory
  });
  return capability;
}

export function assertDockerCommandProviderCapability(
  capability: DockerCommandProviderCapability
): void {
  if (!dockerCommandProviders.has(capability)) {
    providerFailure('Docker command provider capability is not owner-issued.');
  }
}

export function requireDockerCommandProviderCapability(
  capability: DockerCommandProviderCapability | undefined
): DockerCommandProviderCapability {
  if (capability === undefined) {
    providerFailure('Docker command provider capability is unavailable.');
  }
  assertDockerCommandProviderCapability(capability);
  return capability;
}

export function claimDockerCommandProviderCapability(
  capability: DockerCommandProviderCapability
): ClaimedDockerCommandProvider {
  assertDockerCommandProviderCapability(capability);
  const record = dockerCommandProviders.get(capability)!;
  if (record.state !== 'available') {
    providerFailure(`Docker command provider capability is ${record.state}.`);
  }
  if (record.platform !== process.platform) {
    providerFailure('Docker command provider platform changed before admission.');
  }
  try {
    if (record.linuxCli !== undefined) assertQualifiedLinuxDockerCliBinding(record.linuxCli, {
      executable: record.boundary.executable, workingDirectory: record.boundary.workingDirectory,
      runtimeState: record.privateState, endpoint: record.linuxEndpoint
    });
    record.boundary.executable.assertCurrent();
    record.daemonProbe?.assertCurrent();
    record.privateState?.assertCurrent();
    record.linuxEndpoint?.assertCurrent();
    record.boundary.workingDirectory.assertCurrent();
    for (const auxiliary of record.auxiliaryInputs) auxiliary.capability.assertCurrent();
    for (const owner of record.retainedOwners) owner.assertCurrent();
  } catch (error) {
    const failure = new DockerCommandProviderUnavailableError(
      'Docker command provider changed before admission.',
      { cause: error }
    );
    settleDockerCommandProviderRecord(record, {
      label: 'command-provider-readback',
      error: failure
    });
    throw failure;
  }
  record.state = 'claimed';
  const claimed = Object.freeze({
    ...(record.linuxCli === undefined ? {} : { linuxCli: record.linuxCli }),
    auxiliaryInputs: record.auxiliaryInputs,
    ...(record.daemonProbe === undefined ? {} : { daemonProbe: record.daemonProbe }),
    ...(record.endpointHost === undefined ? {} : { endpointHost: record.endpointHost }),
    ...(record.privateState === undefined ? {} : { privateState: record.privateState }),
    ...(record.linuxEndpoint === undefined ? {} : { linuxEndpoint: record.linuxEndpoint }),
    boundary: record.boundary,
    commandProtocol: record.commandProtocol,
    environment: record.environment,
    environmentDigest: record.environmentDigest,
    retainedOwners: record.retainedOwners,
    executable: record.executable,
    platform: record.platform,
    providerIdentityDigest: record.providerIdentityDigest,
    workingDirectory: record.workingDirectory
  });
  claimedDockerCommandProviders.set(claimed, record);
  return claimed;
}

/** Settle all transferred resources, including any platform-private state. */
export function disposeClaimedDockerCommandProvider(claimed: ClaimedDockerCommandProvider): void {
  const record = claimedDockerCommandProviders.get(claimed);
  if (record === undefined || record.state !== 'claimed') {
    providerFailure('Docker command provider is not a live owner-issued claim.');
  }
  settleDockerCommandProviderRecord(record);
}

export function disposeUnclaimedDockerCommandProviderCapability(
  capability: DockerCommandProviderCapability
): void {
  assertDockerCommandProviderCapability(capability);
  const record = dockerCommandProviders.get(capability)!;
  if (record.state !== 'available') {
    providerFailure(`Docker command provider capability is ${record.state}.`);
  }
  settleDockerCommandProviderRecord(record);
}
