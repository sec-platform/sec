import { z } from 'zod';

import { deepFreeze, sha256 } from '../../../contracts/canonical.ts';
import source from './windows-installation-profile.json' with { type: 'json' };

const childDescriptor = z.number().int().min(5).max(64);
const segment = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,127}$/u)
  .refine((value) => value !== '.' && value !== '..');
const knownFolder = z.enum([
  'local-app-data',
  'profile',
  'program-data',
  'program-files',
  'roaming-app-data',
  'windows'
]);
const environmentFolder = z.object({ folder: knownFolder }).strict();
const profileSchema = z.object({
  schema: z.literal('sec-docker-windows-installation-profile-v4'),
  platform: z.literal('win32'),
  installation: z.object({
    folder: z.literal('program-files'),
    directorySegments: z.array(segment).min(1).max(16),
    executableName: z.literal('docker.exe'),
    directoryChildDescriptor: childDescriptor,
    cliPluginDirectorySegments: z.array(segment).min(1).max(16),
    cliPluginDirectoryChildDescriptor: childDescriptor,
    cliPlugins: z.array(z.object({
      id: z.enum(['desktop', 'buildx']),
      executableName: z.enum(['docker-desktop.exe', 'docker-buildx.exe']),
      childDescriptor
    }).strict()).length(2)
  }).strict(),
  environment: z.object({
    windows: z.object({
      folder: z.literal('windows'),
      rootChildDescriptor: childDescriptor,
      systemDirectorySegments: z.tuple([z.literal('System32')]),
      systemDirectoryChildDescriptor: childDescriptor,
      wslExecutableName: z.literal('wsl.exe'),
      wslExecutableChildDescriptor: childDescriptor
    }).strict(),
    profile: environmentFolder,
    localAppData: environmentFolder,
    roamingAppData: environmentFolder,
    programData: environmentFolder,
    temp: z.object({
      folder: z.literal('local-app-data'),
      directorySegments: z.array(segment).min(1).max(4),
    }).strict()
  }).strict()
}).strict().superRefine((value, context) => {
  const descriptors = [
    value.installation.directoryChildDescriptor,
    value.installation.cliPluginDirectoryChildDescriptor,
    ...value.installation.cliPlugins.map(({ childDescriptor: descriptor }) => descriptor),
    value.environment.windows.rootChildDescriptor,
    value.environment.windows.systemDirectoryChildDescriptor,
    value.environment.windows.wslExecutableChildDescriptor
  ];
  if (new Set(descriptors).size !== descriptors.length) {
    context.addIssue({
      code: 'custom',
      message: 'Docker Windows installation profile child descriptors must be unique.'
    });
  }
  const plugins = new Map(value.installation.cliPlugins.map((plugin) => [plugin.id, plugin]));
  if (plugins.size !== value.installation.cliPlugins.length
      || plugins.get('desktop')?.executableName !== 'docker-desktop.exe'
      || plugins.get('buildx')?.executableName !== 'docker-buildx.exe') {
    context.addIssue({
      code: 'custom',
      message: 'Docker Windows installation profile CLI plugins are noncanonical.'
    });
  }
});

export type DockerWindowsInstallationProfile = z.infer<typeof profileSchema>;

export function parseDockerWindowsInstallationProfile(
  value: unknown
): DockerWindowsInstallationProfile {
  return deepFreeze(profileSchema.parse(value));
}

export const DOCKER_WINDOWS_INSTALLATION_PROFILE =
  parseDockerWindowsInstallationProfile(source);

export const DOCKER_WINDOWS_INSTALLATION_PROFILE_DIGEST = sha256({
  domain: 'sec.docker.windows-installation-profile',
  profile: DOCKER_WINDOWS_INSTALLATION_PROFILE
});
