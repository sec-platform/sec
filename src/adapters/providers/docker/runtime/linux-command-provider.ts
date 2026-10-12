import path from 'node:path';

import { settleResources } from '../../../../execution/resource-settlement.ts';
import {
  inspectNoFollowDirectoryChain,
  retainNoFollowDirectoryForChildProcess,
  retainNoFollowOrdinaryFile,
  type RetainedNoFollowChildProcessDirectory,
  type RetainedNoFollowOrdinaryFile,
  type RetainedNoFollowProvenDirectoryGeneration
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  RETAINED_EXECUTABLE_CHILD_DESCRIPTOR,
  RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR,
  issueRetainedCommandBoundary
} from '../../../runtime-state/physical/runtime/process.ts';
import { assertAuthenticatedGitHubJobOriginCurrent, type AuthenticatedGitHubJobOrigin } from '../../github-api/hosted-job-origin.ts';
import {
  DockerCommandProviderUnavailableError,
  type DockerCommandProviderCapability
} from '../contract/command-provider.ts';
import { LINUX_DOCKER_CLI_PROFILE_DIGEST } from '../contract/linux-cli-profile.ts';
import {
  DOCKER_LINUX_INSTALLATION_PROFILE_DIGEST,
  DOCKER_LINUX_INSTALLATION_PROFILE as profile
} from '../contract/linux-installation-profile.ts';
import { issueDockerCommandProviderCapability } from './command-provider.ts';
import { qualifyLinuxDockerCli, type QualifiedLinuxDockerCli } from './linux-cli-qualification.ts';
import { openLinuxDockerEndpoint, type LinuxDockerEndpoint } from './linux-endpoint.ts';
import { openLinuxDockerRuntimeState, type LinuxDockerRuntimeState } from './linux-runtime-state.ts';
import { linuxDockerStaticToolchainInputs, retainLinuxDockerStaticToolchain, type RetainedLinuxDockerStaticToolchain } from './linux-static-toolchain.ts';

/** No executable/PATH, config, endpoint, plugin or credential environment discovery. */
export async function openLinuxDockerCommandProvider(input: Readonly<{
  workingDirectory: string;
}>): Promise<DockerCommandProviderCapability> {
  if (process.platform !== profile.platform || process.arch !== profile.architecture) {
    throw new DockerCommandProviderUnavailableError('Linux Docker command provider is unavailable on this platform.');
  }
  if (!path.posix.isAbsolute(input.workingDirectory)
      || path.posix.resolve(input.workingDirectory) !== input.workingDirectory) {
    throw new DockerCommandProviderUnavailableError('Linux Docker command provider working directory is noncanonical.');
  }
  let executable: RetainedNoFollowOrdinaryFile | undefined;
  let workingDirectory: RetainedNoFollowChildProcessDirectory | undefined;
  let privateState: LinuxDockerRuntimeState | undefined;
  let linuxEndpoint: LinuxDockerEndpoint | undefined;
  try {
    const retainExecutable = (file: string): RetainedNoFollowOrdinaryFile => retainNoFollowOrdinaryFile(
      inspectNoFollowDirectoryChain(path.posix.dirname(file), 'Linux Docker installation directory'),
      path.posix.basename(file), undefined, 'Linux Docker installed executable',
      RETAINED_EXECUTABLE_CHILD_DESCRIPTOR, 'executable'
    );
    // The Linux transport never launches Docker CLI while its system-plugin
    // executable/membership closure is unavailable. Readiness needs only curl.
    executable = retainExecutable(profile.daemonProbeExecutable);
    const directory = inspectNoFollowDirectoryChain(input.workingDirectory, 'Linux Docker working directory');
    workingDirectory = retainNoFollowDirectoryForChildProcess(
      directory, RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR, 'Linux Docker working directory'
    );
    privateState = openLinuxDockerRuntimeState();
    linuxEndpoint = openLinuxDockerEndpoint({ endpointHost: profile.endpointHost, peerUid: profile.daemonPeerUid });
    return issueDockerCommandProviderCapability({
      boundary: issueRetainedCommandBoundary({ executable, workingDirectory }),
      commandProtocol: profile.commandProtocol,
      daemonProbe: executable, privateState, linuxEndpoint, endpointHost: profile.endpointHost,
      environment: privateState.environment,
      platform: profile.platform,
      providerContractDigest: DOCKER_LINUX_INSTALLATION_PROFILE_DIGEST,
      workingDirectory: directory.target
    });
  } catch (error) {
    try {
      settleResources({
        primary: { label: 'linux-docker-provider-admission', error },
        cleanup: [
          { label: 'linux-endpoint-close', settle: () => linuxEndpoint?.close() },
          { label: 'private-runtime-close', settle: () => privateState?.close() },
          { label: 'working-directory-dispose', settle: () => workingDirectory?.dispose() },
          { label: 'daemon-probe-dispose', settle: () => executable?.dispose() }
        ]
      });
    } catch (cause) {
      throw new DockerCommandProviderUnavailableError('Linux Docker command provider admission failed.', { cause });
    }
    throw new DockerCommandProviderUnavailableError('Linux Docker command provider admission failed.', { cause: error });
  }
}

/** Explicit new profile only; the installed/generic Linux opener stays observe-only. */
export async function openAuthenticatedLinuxDockerCommandProvider(input: Readonly<{
  origin: AuthenticatedGitHubJobOrigin;
  generation: RetainedNoFollowProvenDirectoryGeneration;
  workingDirectory: string;
  deadlineAtUnixMs: number;
}>): Promise<DockerCommandProviderCapability> {
  // Authenticate before touching caller-selected filesystem inputs.
  input = Object.freeze({ ...input });
  const origin = assertAuthenticatedGitHubJobOriginCurrent(input.origin);
  if (process.platform !== 'linux' || process.arch !== 'x64'
      || !Number.isSafeInteger(input.deadlineAtUnixMs) || Date.now() >= input.deadlineAtUnixMs
      || input.deadlineAtUnixMs > origin.originalDeadlineAtUnixMs) {
    throw new DockerCommandProviderUnavailableError('Authenticated Linux Docker platform or original deadline is unavailable.');
  }
  if (!path.posix.isAbsolute(input.workingDirectory)
      || path.posix.resolve(input.workingDirectory) !== input.workingDirectory) {
    throw new DockerCommandProviderUnavailableError('Authenticated Linux Docker working directory is noncanonical.');
  }
  let toolchain: RetainedLinuxDockerStaticToolchain | undefined;
  let workingDirectory: RetainedNoFollowChildProcessDirectory | undefined;
  let privateState: LinuxDockerRuntimeState | undefined;
  let linuxEndpoint: LinuxDockerEndpoint | undefined;
  let linuxCli: QualifiedLinuxDockerCli | undefined;
  try {
    toolchain = await retainLinuxDockerStaticToolchain({ generation: input.generation, deadlineAtUnixMs: input.deadlineAtUnixMs });
    const directory = inspectNoFollowDirectoryChain(input.workingDirectory, 'Authenticated Linux Docker working directory');
    workingDirectory = retainNoFollowDirectoryForChildProcess(directory, RETAINED_WORKING_DIRECTORY_CHILD_DESCRIPTOR);
    privateState = openLinuxDockerRuntimeState({ toolchain, deadlineAtUnixMs: input.deadlineAtUnixMs });
    linuxEndpoint = openLinuxDockerEndpoint({ endpointHost: profile.endpointHost, peerUid: profile.daemonPeerUid });
    linuxCli = await qualifyLinuxDockerCli({
      origin: input.origin, toolchain, runtimeState: privateState, endpoint: linuxEndpoint,
      workingDirectory, deadlineAtUnixMs: input.deadlineAtUnixMs
    });
    return issueDockerCommandProviderCapability({
      boundary: issueRetainedCommandBoundary({ executable: linuxDockerStaticToolchainInputs(toolchain).docker, workingDirectory }),
      commandProtocol: 'docker-cli', linuxCli, privateState, linuxEndpoint,
      endpointHost: profile.endpointHost, environment: privateState.environment,
      platform: 'linux', providerContractDigest: LINUX_DOCKER_CLI_PROFILE_DIGEST as `sha256:${string}`,
      workingDirectory: directory.target
    });
  } catch (error) {
    settleResources({ primary: { label: 'authenticated-linux-cli-admission', error }, cleanup: [
      { label: 'linux-endpoint-close', settle: () => linuxEndpoint?.close() },
      { label: 'private-runtime-close', settle: () => privateState?.close() },
      { label: 'working-directory-dispose', settle: () => workingDirectory?.dispose() },
      { label: 'static-toolchain-close', settle: () => {
        if (linuxCli === undefined) toolchain?.close(); else linuxCli.close();
      } }
    ] });
    throw error;
  }
}
