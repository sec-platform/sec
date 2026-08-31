import path from 'node:path';

import { inspectNoFollowDirectoryChain } from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import { resolveWindowsKnownFolderPath } from '../../../runtime-state/physical/runtime/windows-known-folders.ts';
import { DockerDaemonAvailabilityFailure } from '../contract/daemon.ts';
import { withDockerDesktopLauncherLockAtOwnerIssuedDirectory } from './launcher-lock.ts';

export function dockerDesktopLauncherLockDirectory(localAppData: string): string {
  const canonical = path.resolve(localAppData);
  if (!path.isAbsolute(localAppData) || canonical !== localAppData) {
    throw new Error('Docker Desktop launcher lock Known Folder path is not canonical.');
  }
  return path.join(canonical, 'Docker');
}

export async function withDockerDesktopLauncherLock<T>(
  input: Readonly<{ deadlineAtUnixMs: number; endpointHost: string }>,
  operation: () => Promise<T>
): Promise<T | null> {
  const remaining = input.deadlineAtUnixMs - Date.now();
  if (!Number.isSafeInteger(input.deadlineAtUnixMs) || remaining < 1) {
    throw new DockerDaemonAvailabilityFailure({
      endpointHost: input.endpointHost,
      reason: 'deadline-exhausted',
      phase: 'admission'
    });
  }
  try {
    // The lock parent comes only from the current Windows token's Known Folder
    // owner. No ambient environment value or caller-authored filesystem path
    // participates in launcher serialization.
    const localAppData = await resolveWindowsKnownFolderPath('local-app-data');
    const parent = inspectNoFollowDirectoryChain(
      dockerDesktopLauncherLockDirectory(localAppData),
      'Docker Desktop launcher lock directory'
    ).target;
    return await withDockerDesktopLauncherLockAtOwnerIssuedDirectory({
      deadlineAtUnixMs: input.deadlineAtUnixMs,
      endpointHost: input.endpointHost,
      operation,
      parent,
    });
  } catch (error) {
    if (error instanceof DockerDaemonAvailabilityFailure) throw error;
    throw new DockerDaemonAvailabilityFailure({
      endpointHost: input.endpointHost,
      reason: 'desktop-environment-unavailable',
      phase: 'admission',
      providerEvidence: error instanceof Error ? error.message : String(error)
    });
  }
}
