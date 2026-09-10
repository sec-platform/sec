import type { WindowsKnownFolder } from '../../../runtime-state/physical/runtime/windows-known-folders.ts';

export const DOCKER_DESKTOP_WINDOWS_RUNTIME_STATE_CONTRACT = Object.freeze({
  profile: Object.freeze({ folder: 'profile' as WindowsKnownFolder, childDescriptor: 61 }),
  localAppData: Object.freeze({
    folder: 'local-app-data' as WindowsKnownFolder,
    childDescriptor: 62
  }),
  roamingAppData: Object.freeze({
    folder: 'roaming-app-data' as WindowsKnownFolder,
    childDescriptor: 63
  }),
  programData: Object.freeze({
    folder: 'program-data' as WindowsKnownFolder,
    childDescriptor: 64
  }),
  generationRoots: Object.freeze([
    Object.freeze({
      id: 'desktop-runtime',
      folder: 'local-app-data' as WindowsKnownFolder,
      segments: Object.freeze(['Docker', 'run'] as const),
      childDescriptor: 55
    }),
    Object.freeze({
      id: 'secrets-engine',
      folder: 'local-app-data' as WindowsKnownFolder,
      segments: Object.freeze(['docker-secrets-engine'] as const),
      childDescriptor: 56
    })
  ]),
  generationCensus: Object.freeze({
    maximumBytesPerRoot: 512 * 1024 * 1024,
    maximumEntriesPerRoot: 512,
    maximumDurationMs: 1_000
  })
});

export function isDockerDesktopManagedEndpoint(endpointHost: string): boolean {
  return /^npipe:\/{4}\.\/pipe\/dockerDesktop[A-Za-z0-9_.-]*$/u.test(endpointHost);
}
