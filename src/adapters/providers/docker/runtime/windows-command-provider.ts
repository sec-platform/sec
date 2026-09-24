import path from 'node:path';

import type { OperationDigest } from '../../../../execution/operation/semantic.ts';
import { settleResources as settlePhysicalResources } from '../../../../execution/resource-settlement.ts';
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
import {
  openRetainedWindowsRuntimeStateDirectory,
  type RetainedRuntimeStateDirectory
} from '../../../runtime-state/physical/runtime/retained-runtime-state-directory.ts';
import { resolveWindowsKnownFolderPath } from '../../../runtime-state/physical/runtime/windows-known-folders.ts';
import type { DockerCommandProviderCapability } from '../contract/command-provider.ts';
import { DockerCommandProviderUnavailableError } from '../contract/command-provider.ts';
import {
  DOCKER_WINDOWS_INSTALLATION_PROFILE,
  DOCKER_WINDOWS_INSTALLATION_PROFILE_DIGEST
} from '../contract/windows-installation-profile.ts';
import { issueDockerCommandProviderCapability } from './command-provider.ts';

function requireOperationDigest(value: string, label: string): OperationDigest {
  if (!isOperationDigest(value)) {
    throw new DockerCommandProviderUnavailableError(
      `Windows Docker provider ${label} is invalid.`
    );
  }
  return value;
}

function isOperationDigest(value: string): value is OperationDigest {
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
  const providerContractDigest = requireOperationDigest(
    DOCKER_WINDOWS_INSTALLATION_PROFILE_DIGEST,
    'installation profile digest'
  );
  const retainedOwners: RetainedRuntimeStateDirectory[] = [];
  let executable: ReturnType<typeof retainNoFollowOrdinaryFile> | null = null;
  const cliPlugins: ReturnType<typeof retainNoFollowOrdinaryFile>[] = [];
  let wslExecutable: ReturnType<typeof retainNoFollowOrdinaryFile> | null = null;
  let workingDirectory: ReturnType<typeof retainNoFollowDirectoryForChildProcess> | null = null;
  try {
    const installation = await openRetainedWindowsRuntimeStateDirectory({
      childDescriptor: profile.installation.directoryChildDescriptor,
      folder: profile.installation.folder,
      mode: 'open-existing',
      segments: profile.installation.directorySegments,
      requireHostNamespace: true
    });
    retainedOwners.push(installation);
    const cliPluginDirectory = await openRetainedWindowsRuntimeStateDirectory({
      childDescriptor: profile.installation.cliPluginDirectoryChildDescriptor,
      folder: profile.installation.folder,
      mode: 'open-existing',
      segments: profile.installation.cliPluginDirectorySegments,
      requireHostNamespace: true
    });
    retainedOwners.push(cliPluginDirectory);
    const [profilePath, localAppDataPath, roamingAppDataPath, programDataPath] =
      await Promise.all([
        resolveWindowsKnownFolderPath(profile.environment.profile.folder),
        resolveWindowsKnownFolderPath(profile.environment.localAppData.folder),
        resolveWindowsKnownFolderPath(profile.environment.roamingAppData.folder),
        resolveWindowsKnownFolderPath(profile.environment.programData.folder)
      ]);
    const tempPath = path.win32.join(
      await resolveWindowsKnownFolderPath(profile.environment.temp.folder),
      ...profile.environment.temp.directorySegments
    );
    const windowsRoot = await openRetainedWindowsRuntimeStateDirectory({
      childDescriptor: profile.environment.windows.rootChildDescriptor,
      folder: profile.environment.windows.folder,
      mode: 'open-existing',
      requireHostNamespace: true
    });
    retainedOwners.push(windowsRoot);
    const systemDirectory = await openRetainedWindowsRuntimeStateDirectory({
      childDescriptor: profile.environment.windows.systemDirectoryChildDescriptor,
      folder: profile.environment.windows.folder,
      mode: 'open-existing',
      segments: profile.environment.windows.systemDirectorySegments,
      requireHostNamespace: true
    });
    retainedOwners.push(systemDirectory);
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
    const systemDirectoryChain = inspectNoFollowDirectoryChain(
      systemDirectory.path,
      'Windows system directory'
    );
    if (systemDirectoryChain.target.device !== systemDirectory.directory.device
        || systemDirectoryChain.target.inode !== systemDirectory.directory.inode) {
      throw new DockerCommandProviderUnavailableError(
        'Windows system directory changed during admission.'
      );
    }
    const wslEntry = inspectNoFollowOrdinaryFileEntry(
      systemDirectory.directory,
      profile.environment.windows.wslExecutableName
    );
    if (wslEntry === null || wslEntry.kind !== 'file') {
      throw new DockerCommandProviderUnavailableError(
        'Canonical Windows WSL executable is unavailable.'
      );
    }
    wslExecutable = retainNoFollowOrdinaryFile(
      systemDirectoryChain,
      profile.environment.windows.wslExecutableName,
      { device: wslEntry.device, inode: wslEntry.inode },
      'Windows Docker WSL operating-system input',
      profile.environment.windows.wslExecutableChildDescriptor,
      'ordinary-file'
    );
    const workingDirectoryChain = inspectNoFollowDirectoryChain(
      workingDirectoryPath,
      'Windows Docker command provider working directory'
    );
    workingDirectory = retainNoFollowDirectoryForChildProcess(
      workingDirectoryChain,
      RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
      'Windows Docker command provider working directory'
    );
    return issueDockerCommandProviderCapability({
      boundary: issueRetainedCommandBoundary({
        executable,
        workingDirectory,
        auxiliaryInputs: [...cliPlugins, wslExecutable].map((capability) => ({
          capability,
          kind: 'ordinary-file' as const
        }))
      }),
      environment: {
        APPDATA: roamingAppDataPath,
        HOME: profilePath,
        LANG: 'C',
        LC_ALL: 'C',
        LOCALAPPDATA: localAppDataPath,
        PATH: systemDirectory.path,
        PROGRAMDATA: programDataPath,
        PROGRAMFILES: installation.root.path,
        SYSTEMROOT: windowsRoot.path,
        TEMP: tempPath,
        TMP: tempPath,
        TZ: 'UTC',
        USERPROFILE: profilePath,
        WINDIR: windowsRoot.path
      },
      platform: 'win32',
      providerContractDigest,
      retainedOwners,
      workingDirectory: workingDirectoryChain.target
    });
  } catch (error) {
    const retainedWorkingDirectory = workingDirectory;
    const retainedExecutable = executable;
    const retainedWslExecutable = wslExecutable;
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
          ...(retainedWslExecutable === null ? [] : [{
            label: 'wsl-executable-dispose',
            settle: () => retainedWslExecutable.dispose()
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
