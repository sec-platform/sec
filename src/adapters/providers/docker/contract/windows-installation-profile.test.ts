import { expect, test } from 'bun:test';

import {
  DOCKER_WINDOWS_INSTALLATION_PROFILE,
  parseDockerWindowsInstallationProfile
} from './windows-installation-profile.ts';

test('Docker Windows installation profile rejects unknown state and descriptor aliasing', () => {
  expect(() => parseDockerWindowsInstallationProfile({
    ...DOCKER_WINDOWS_INSTALLATION_PROFILE,
    fallbackPath: 'C:\\ambient\\docker.exe'
  })).toThrow();
  expect(() => parseDockerWindowsInstallationProfile({
    ...DOCKER_WINDOWS_INSTALLATION_PROFILE,
    environment: {
      ...DOCKER_WINDOWS_INSTALLATION_PROFILE.environment,
      windows: {
        ...DOCKER_WINDOWS_INSTALLATION_PROFILE.environment.windows,
        rootChildDescriptor:
          DOCKER_WINDOWS_INSTALLATION_PROFILE.installation.directoryChildDescriptor
      }
    }
  })).toThrow('child descriptors must be unique');
  expect(() => parseDockerWindowsInstallationProfile({
    ...DOCKER_WINDOWS_INSTALLATION_PROFILE,
    environment: {
      ...DOCKER_WINDOWS_INSTALLATION_PROFILE.environment,
      localAppData: {
        ...DOCKER_WINDOWS_INSTALLATION_PROFILE.environment.localAppData,
        childDescriptor: 43
      }
    }
  })).toThrow();
  expect(() => parseDockerWindowsInstallationProfile({
    ...DOCKER_WINDOWS_INSTALLATION_PROFILE,
    environment: {
      ...DOCKER_WINDOWS_INSTALLATION_PROFILE.environment,
      windows: {
        ...DOCKER_WINDOWS_INSTALLATION_PROFILE.environment.windows,
        systemDirectorySegments: ['Sysnative']
      }
    }
  })).toThrow();
  expect(() => parseDockerWindowsInstallationProfile({
    ...DOCKER_WINDOWS_INSTALLATION_PROFILE,
    installation: {
      ...DOCKER_WINDOWS_INSTALLATION_PROFILE.installation,
      cliPlugins: DOCKER_WINDOWS_INSTALLATION_PROFILE.installation.cliPlugins.map((plugin) => (
        plugin.id === 'desktop'
          ? { ...plugin, executableName: 'docker-buildx.exe' as const }
          : plugin
      ))
    }
  })).toThrow('CLI plugins are noncanonical');
  expect(() => parseDockerWindowsInstallationProfile({
    ...DOCKER_WINDOWS_INSTALLATION_PROFILE,
    installation: {
      ...DOCKER_WINDOWS_INSTALLATION_PROFILE.installation,
      desktopLauncher: {}
    }
  })).toThrow();
});
