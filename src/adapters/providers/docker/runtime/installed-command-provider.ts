import {
  DockerCommandProviderUnavailableError,
  type DockerCommandProviderCapability
} from '../contract/command-provider.ts';
import { openLinuxDockerCommandProvider } from './linux-command-provider.ts';
import { openWindowsDockerCommandProvider } from './windows-command-provider.ts';

/** Select an installed platform owner; never install or fall back to ambient discovery. */
export async function openDockerCommandProvider(input: Readonly<{
  workingDirectory: string;
}>): Promise<DockerCommandProviderCapability> {
  if (process.platform === 'win32') return await openWindowsDockerCommandProvider(input);
  if (process.platform === 'linux') return await openLinuxDockerCommandProvider(input);
  throw new DockerCommandProviderUnavailableError('Installed Docker command provider is unavailable on this platform.');
}
