import path from 'node:path';

import { sha256 } from '../../../../contracts/canonical.ts';
import type { OperationDigest } from '../../../../execution/operation/semantic.ts';
import { settleResources as settlePhysicalResources } from '../../../../execution/resource-settlement.ts';
import type { PhysicalDirectoryIdentity } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  assertRetainedNoFollowCapability
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

const DOCKER_COMMAND_ENVIRONMENT_KEYS = new Set([
  'APPDATA',
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
  'TZ',
  'USERPROFILE',
  'WINDIR'
]);

export interface DockerCommandProviderObservation {
  readonly boundary: RetainedCommandBoundary;
  readonly environment: Readonly<NodeJS.ProcessEnv>;
  readonly retainedOwners?: readonly RetainedRuntimeStateDirectory[];
  readonly platform: NodeJS.Platform;
  readonly providerContractDigest: OperationDigest;
  readonly workingDirectory: PhysicalDirectoryIdentity;
}

export interface ClaimedDockerCommandProvider {
  readonly auxiliaryInputs: readonly RetainedCommandAuxiliaryInput[];
  readonly boundary: RetainedCommandBoundary;
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

function settleDockerCommandProviderRecord(
  record: DockerCommandProviderRecord,
  primary?: Readonly<{ label: string; error: unknown }>
): void {
  record.state = 'disposed';
  settlePhysicalResources({
    ...(primary === undefined ? {} : { primary }),
    cleanup: [
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
        settle: () => record.boundary.executable.dispose()
      },
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
  if (!/^sha256:[a-f0-9]{64}$/u.test(observation.providerContractDigest)) {
    providerFailure('Docker command provider contract identity is invalid.');
  }
  try {
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
  const auxiliaryInputs = retainedCommandBoundaryAuxiliaryInputs(observation.boundary);
  const retainedOwners = Object.freeze([...(observation.retainedOwners ?? [])]);
  const environmentDigest = sha256({
    domain: 'sec.docker.command-provider.environment',
    entries: Object.entries(environment)
  }) as OperationDigest;
  const executableDigest = observation.boundary.executable.digest();
  const providerIdentityDigest = sha256({
    domain: 'sec.docker.command-provider',
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
    providerIdentityDigest,
    workingDirectory: workingDirectoryPath
  });
  dockerCommandProviders.set(capability, {
    auxiliaryInputs,
    boundary: observation.boundary,
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
    record.boundary.executable.assertCurrent();
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
  return Object.freeze({
    auxiliaryInputs: record.auxiliaryInputs,
    boundary: record.boundary,
    environment: record.environment,
    environmentDigest: record.environmentDigest,
    retainedOwners: record.retainedOwners,
    executable: record.executable,
    platform: record.platform,
    providerIdentityDigest: record.providerIdentityDigest,
    workingDirectory: record.workingDirectory
  });
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
