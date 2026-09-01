import path from 'node:path';

import {
  inspectNoFollowDirectoryChain,
  inspectNoFollowOrdinaryFileEntry,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile,
  scanNoFollowDirectoryTreeMetadata
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
  RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
  issueRetainedCommandBoundary
} from '../../../runtime-state/physical/runtime/process.ts';
import { settlePhysicalResources } from '../../../runtime-state/physical/runtime/resource-settlement.ts';
import {
  openRetainedWindowsRuntimeStateDirectory,
  type RetainedRuntimeStateDirectory
} from '../../../runtime-state/physical/runtime/retained-runtime-state-directory.ts';
import type { SecOperationDigest } from '../../../system-architecture/operation/semantic.ts';
import type { DockerCommandProviderCapability } from '../contract/command-provider.ts';
import { DockerCommandProviderUnavailableError } from '../contract/command-provider.ts';
import {
  DOCKER_WINDOWS_INSTALLATION_PROFILE,
  DOCKER_WINDOWS_INSTALLATION_PROFILE_DIGEST
} from '../contract/windows-installation-profile.ts';
import { issueDockerCommandProviderCapability } from './command-provider.ts';

function requireSecOperationDigest(value: string, label: string): SecOperationDigest {
  if (!isSecOperationDigest(value)) {
    throw new DockerCommandProviderUnavailableError(
      `Windows Docker provider ${label} is invalid.`
    );
  }
  return value;
}

function isSecOperationDigest(value: string): value is SecOperationDigest {
  return /^sha256:[a-f0-9]{64}$/u.test(value);
}

/**
 * Opens the installed Windows Docker provider from the OS Program Files owner
 * and the one strict Docker installation profile. No PATH, registry, caller
 * executable, ProgramFiles environment variable, or guessed alternate layout
 * participates in admission.
 */
export async function openWindowsDockerCommandProvider(input: Readonly<{
  workingDirectory: string;
}>): Promise<DockerCommandProviderCapability> {
  if (process.platform !== 'win32') {
    throw new DockerCommandProviderUnavailableError(
      'Windows Docker command provider is unavailable on this platform.'
    );
  }
  const workingDirectoryPath = path.win32.resolve(input.workingDirectory);
  if (!path.win32.isAbsolute(input.workingDirectory)
      || workingDirectoryPath !== input.workingDirectory) {
    throw new DockerCommandProviderUnavailableError(
      'Windows Docker command provider working directory is noncanonical.'
    );
  }
  const profile = DOCKER_WINDOWS_INSTALLATION_PROFILE;
  const providerContractDigest = requireSecOperationDigest(
    DOCKER_WINDOWS_INSTALLATION_PROFILE_DIGEST,
    'installation profile digest'
  );
  const retainedOwners: RetainedRuntimeStateDirectory[] = [];
  let executable: ReturnType<typeof retainNoFollowOrdinaryFile> | null = null;
  const cliPlugins: ReturnType<typeof retainNoFollowOrdinaryFile>[] = [];
  let workingDirectory: ReturnType<typeof retainNoFollowDirectoryForChildProcess> | null = null;
  try {
    const installation = await openRetainedWindowsRuntimeStateDirectory({
      childDescriptor: profile.installation.directoryChildDescriptor,
      folder: profile.installation.folder,
      mode: 'open-existing',
      segments: profile.installation.directorySegments
    });
    retainedOwners.push(installation);
    const cliPluginDirectory = await openRetainedWindowsRuntimeStateDirectory({
      childDescriptor: profile.installation.cliPluginDirectoryChildDescriptor,
      folder: profile.installation.folder,
      mode: 'open-existing',
      segments: profile.installation.cliPluginDirectorySegments
    });
    retainedOwners.push(cliPluginDirectory);
    const environmentOwners: RetainedRuntimeStateDirectory[] = [];
    for (const owner of [
      profile.environment.profile,
      profile.environment.localAppData,
      profile.environment.roamingAppData,
      profile.environment.programData
    ]) {
      const retained = await openRetainedWindowsRuntimeStateDirectory({
        ...owner,
        mode: 'open-existing'
      });
      retainedOwners.push(retained);
      environmentOwners.push(retained);
    }
    const tempOwner = await openRetainedWindowsRuntimeStateDirectory({
      childDescriptor: profile.environment.temp.childDescriptor,
      folder: profile.environment.temp.folder,
      mode: 'open-existing',
      segments: profile.environment.temp.directorySegments
    });
    retainedOwners.push(tempOwner);
    environmentOwners.push(tempOwner);
    const installationChain = inspectNoFollowDirectoryChain(
      installation.path,
      'Windows Docker installation directory'
    );
    if (installationChain.target.device !== installation.directory.device
        || installationChain.target.inode !== installation.directory.inode) {
      throw new DockerCommandProviderUnavailableError(
        'Windows Docker installation directory changed during admission.'
      );
    }
    const executableEntry = inspectNoFollowOrdinaryFileEntry(
      installation.directory,
      profile.installation.executableName
    );
    if (executableEntry === null || executableEntry.kind !== 'file') {
      throw new DockerCommandProviderUnavailableError(
        'Canonical Windows Docker executable is unavailable.'
      );
    }
    executable = retainNoFollowOrdinaryFile(
      installationChain,
      profile.installation.executableName,
      { device: executableEntry.device, inode: executableEntry.inode },
      'Windows Docker command provider executable',
      RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
      'executable'
    );
    const cliPluginChain = inspectNoFollowDirectoryChain(
      cliPluginDirectory.path,
      'Windows Docker CLI plugin directory'
    );
    if (cliPluginChain.target.device !== cliPluginDirectory.directory.device
        || cliPluginChain.target.inode !== cliPluginDirectory.directory.inode) {
      throw new DockerCommandProviderUnavailableError(
        'Windows Docker CLI plugin directory changed during admission.'
      );
    }
    const cliPluginInventory = scanNoFollowDirectoryTreeMetadata(
      cliPluginDirectory.directory,
      {
        deadlineAtMs: performance.now() + 5_000,
        maximumBytes: 1024 * 1024 * 1024,
        maximumEntries: 128
      }
    );
    for (const plugin of profile.installation.cliPlugins) {
      const pluginEntry = cliPluginInventory.find(
        ({ relativePath }) => relativePath === plugin.executableName
      );
      if (pluginEntry === undefined || pluginEntry.kind !== 'file') {
        throw new DockerCommandProviderUnavailableError(
          `Canonical Windows Docker ${plugin.id} CLI plugin is unavailable.`
        );
      }
      cliPlugins.push(retainNoFollowOrdinaryFile(
        cliPluginChain,
        plugin.executableName,
        { device: pluginEntry.device, inode: pluginEntry.inode },
        `Windows Docker ${plugin.id} CLI plugin`,
        plugin.childDescriptor,
        'ordinary-file'
      ));
    }
    const workingDirectoryChain = inspectNoFollowDirectoryChain(
      workingDirectoryPath,
      'Windows Docker command provider working directory'
    );
    workingDirectory = retainNoFollowDirectoryForChildProcess(
      workingDirectoryChain,
      RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
      'Windows Docker command provider working directory'
    );
    const [profileOwner, localAppData, roamingAppData, programData, temp] = environmentOwners;
    return issueDockerCommandProviderCapability({
      boundary: issueRetainedCommandBoundary({
        executable,
        workingDirectory,
        auxiliaryInputs: cliPlugins.map((capability) => ({
          capability,
          kind: 'ordinary-file' as const
        }))
      }),
      environment: {
        APPDATA: roamingAppData.path,
        HOME: profileOwner.path,
        LANG: 'C',
        LC_ALL: 'C',
        LOCALAPPDATA: localAppData.path,
        PATH: '',
        PROGRAMDATA: programData.path,
        PROGRAMFILES: installation.root.path,
        TEMP: temp.path,
        TMP: temp.path,
        TZ: 'UTC',
        USERPROFILE: profileOwner.path
      },
      platform: 'win32',
      providerContractDigest,
      retainedOwners,
      workingDirectory: workingDirectoryChain.target
    });
  } catch (error) {
    const retainedWorkingDirectory = workingDirectory;
    const retainedExecutable = executable;
    try {
      settlePhysicalResources({
        primary: Object.freeze({ label: 'windows-docker-provider-admission', error }),
        cleanup: [
          ...(retainedWorkingDirectory === null ? [] : [{
            label: 'working-directory-dispose',
            settle: () => retainedWorkingDirectory.dispose()
          }]),
          ...(retainedExecutable === null ? [] : [{
            label: 'executable-dispose',
            settle: () => retainedExecutable.dispose()
          }]),
          ...[...cliPlugins].reverse().map((plugin, index) => ({
            label: `cli-plugin-dispose-${index}`,
            settle: () => plugin.dispose()
          })),
          ...[...retainedOwners].reverse().map((owner, index) => ({
            label: `retained-owner-close-${index}`,
            settle: () => owner.close()
          }))
        ]
      });
    } catch (settlementError) {
      if (settlementError === error && error instanceof DockerCommandProviderUnavailableError) {
        throw error;
      }
      throw new DockerCommandProviderUnavailableError(
        `Windows Docker provider ${DOCKER_WINDOWS_INSTALLATION_PROFILE_DIGEST} admission failed.`,
        { cause: settlementError }
      );
    }
    throw new DockerCommandProviderUnavailableError(
      `Windows Docker provider ${DOCKER_WINDOWS_INSTALLATION_PROFILE_DIGEST} admission failed.`,
      { cause: error }
    );
  }
}
