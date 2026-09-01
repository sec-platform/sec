import path from 'node:path';

import { expect, test } from 'bun:test';

import { resolveWindowsKnownFolderPath } from '../../../runtime-state/physical/runtime/windows-known-folders.ts';
import {
  DOCKER_WINDOWS_INSTALLATION_PROFILE,
  DOCKER_WINDOWS_INSTALLATION_PROFILE_DIGEST
} from '../contract/windows-installation-profile.ts';
import {
  claimDockerCommandProviderCapability,
  disposeUnclaimedDockerCommandProviderCapability
} from './command-provider.ts';
import { openWindowsDockerCommandProvider } from './windows-command-provider.ts';

test.skipIf(process.platform !== 'win32')(
  'Windows Docker provider ignores ambient PATH, ProgramFiles, and temp redirection',
  async () => {
    const original = {
      PATH: process.env.PATH,
      PROGRAMFILES: process.env.PROGRAMFILES,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP
    };
    let provider: Awaited<ReturnType<typeof openWindowsDockerCommandProvider>> | undefined;
    let claimed: ReturnType<typeof claimDockerCommandProviderCapability> | undefined;
    try {
      process.env.PATH = String.raw`C:\ambient-docker-bin`;
      process.env.PROGRAMFILES = String.raw`C:\ambient-program-files`;
      process.env.TEMP = String.raw`C:\ambient-temp`;
      process.env.TMP = String.raw`C:\ambient-tmp`;
      provider = await openWindowsDockerCommandProvider({
        workingDirectory: path.win32.resolve(process.cwd())
      });
      const programFiles = await resolveWindowsKnownFolderPath('program-files');
      expect(provider.executable).toBe(path.win32.join(
        programFiles,
        ...DOCKER_WINDOWS_INSTALLATION_PROFILE.installation.directorySegments,
        DOCKER_WINDOWS_INSTALLATION_PROFILE.installation.executableName
      ));
      expect(provider.executable.startsWith(process.env.PROGRAMFILES)).toBe(false);
      expect(DOCKER_WINDOWS_INSTALLATION_PROFILE_DIGEST).toMatch(/^sha256:[a-f0-9]{64}$/u);
      claimed = claimDockerCommandProviderCapability(provider);
      expect(claimed.environment.PROGRAMFILES).toBe(programFiles);
      expect(claimed.environment.PATH).toBe('');
      expect(claimed.auxiliaryInputs.map(({ capability }) => path.win32.basename(capability.childPath)))
        .toEqual(['docker-desktop.exe', 'docker-buildx.exe']);
      for (const auxiliary of claimed.auxiliaryInputs) auxiliary.capability.assertCurrent();
    } finally {
      if (claimed !== undefined) {
        for (const auxiliary of [...claimed.auxiliaryInputs].reverse()) {
          auxiliary.capability.dispose();
        }
        for (const owner of [...claimed.retainedOwners].reverse()) owner.close();
        claimed.boundary.workingDirectory.dispose();
        claimed.boundary.executable.dispose();
      } else if (provider !== undefined) {
        disposeUnclaimedDockerCommandProviderCapability(provider);
      }
      for (const [key, value] of Object.entries(original)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }
);

test('Windows Docker provider rejects a noncanonical working directory before discovery', async () => {
  await expect(openWindowsDockerCommandProvider({ workingDirectory: '.' }))
    .rejects.toThrow(/working directory|platform/u);
});
