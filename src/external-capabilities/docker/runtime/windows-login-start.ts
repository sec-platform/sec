import {
  inspectNoFollowOrdinaryFileEntry
} from '../../../runtime-state/physical/runtime/physical-no-follow.ts';
import {
  openRetainedWindowsRuntimeStateDirectory
} from '../../../runtime-state/physical/runtime/retained-runtime-state-directory.ts';
import { sha256 } from '../../../system-architecture/foundation/runtime/canonical.ts';
import type { SecOperationDigest } from '../../../system-architecture/operation/semantic.ts';
import {
  DOCKER_DESKTOP_LOGIN_START_CONFIGURATION_OWNER,
  DOCKER_DESKTOP_LOGIN_START_OBSERVATION_SOURCE,
  DOCKER_DESKTOP_LOGIN_START_SCHEMA,
  type DockerDesktopLoginStart,
  type DockerDesktopLoginStartUnavailableReason
} from '../contract/login-start.ts';

const SETTINGS_STORE_FILE = 'settings-store.json';
const MAXIMUM_SETTINGS_STORE_BYTES = 1024 * 1024;

function unavailable(
  reason: DockerDesktopLoginStartUnavailableReason,
  detail: unknown
): DockerDesktopLoginStart {
  return Object.freeze({
    schema: DOCKER_DESKTOP_LOGIN_START_SCHEMA,
    status: 'unavailable',
    configurationOwner: DOCKER_DESKTOP_LOGIN_START_CONFIGURATION_OWNER,
    observationSource: DOCKER_DESKTOP_LOGIN_START_OBSERVATION_SOURCE,
    automatedReconciliation: 'unsupported-by-admitted-provider',
    reconciliation: 'observation-unavailable',
    reason,
    detailDigest: sha256({
      domain: 'sec.docker.desktop-login-start.failure',
      reason,
      detail: detail instanceof Error
        ? { name: detail.name, message: detail.message }
        : String(detail)
    }) as SecOperationDigest
  });
}

export function unavailableDockerDesktopLoginStart(
  reason: DockerDesktopLoginStartUnavailableReason,
  detail: unknown
): DockerDesktopLoginStart {
  return unavailable(reason, detail);
}

export function projectDockerDesktopLoginStartSettingsStore(
  bytes: Uint8Array
): DockerDesktopLoginStart {
  if (bytes.byteLength === 0 || bytes.byteLength > MAXIMUM_SETTINGS_STORE_BYTES) {
    return unavailable('settings-store-invalid', 'Settings store byte length is outside bounds.');
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    return unavailable('settings-store-invalid', error);
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return unavailable('settings-store-invalid', 'Settings store root is not an object.');
  }
  const autoStart = (value as Record<string, unknown>).AutoStart;
  if (typeof autoStart !== 'boolean') {
    return unavailable(
      'auto-start-setting-unavailable',
      'Docker Desktop AutoStart is not a boolean.'
    );
  }
  const status = autoStart ? 'enabled' : 'disabled';
  return Object.freeze({
    schema: DOCKER_DESKTOP_LOGIN_START_SCHEMA,
    status,
    configurationOwner: DOCKER_DESKTOP_LOGIN_START_CONFIGURATION_OWNER,
    observationSource: DOCKER_DESKTOP_LOGIN_START_OBSERVATION_SOURCE,
    automatedReconciliation: 'unsupported-by-admitted-provider',
    reconciliation: autoStart ? 'satisfied' : 'docker-desktop-settings-ui-required',
    settingsStoreDigest: sha256({
      domain: 'sec.docker.desktop-login-start.settings-store',
      bytes: Buffer.from(bytes).toString('base64')
    }) as SecOperationDigest
  });
}

/**
 * Reads Docker Desktop's documented per-user settings-store location through
 * the retained Windows Known Folder owner. This function has no write,
 * registry, process, network, start, stop, or retry Effect.
 */
export async function observeWindowsDockerDesktopLoginStart(): Promise<DockerDesktopLoginStart> {
  if (process.platform !== 'win32') {
    return unavailable('platform-unsupported', process.platform);
  }
  let settingsDirectory: Awaited<ReturnType<typeof openRetainedWindowsRuntimeStateDirectory>>
    | null = null;
  let result: DockerDesktopLoginStart;
  try {
    settingsDirectory = await openRetainedWindowsRuntimeStateDirectory({
      childDescriptor: 53,
      folder: 'roaming-app-data',
      mode: 'open-existing',
      segments: ['Docker']
    });
    const entry = inspectNoFollowOrdinaryFileEntry(
      settingsDirectory.directory,
      SETTINGS_STORE_FILE
    );
    if (entry === null || entry.kind !== 'file' || entry.bytes === null) {
      result = unavailable('settings-store-unavailable', 'Settings store is absent.');
    } else {
      result = projectDockerDesktopLoginStartSettingsStore(entry.bytes);
    }
  } catch (error) {
    result = unavailable('settings-store-unavailable', error);
  }
  if (settingsDirectory !== null) {
    try {
      settingsDirectory.close();
    } catch (error) {
      return unavailable('settings-store-unavailable', error);
    }
  }
  return result;
}
