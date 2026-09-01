import type { SecOperationDigest } from '../../../system-architecture/operation/semantic.ts';

export const DOCKER_DESKTOP_LOGIN_START_SCHEMA =
  'sec-docker-desktop-login-start-v1' as const;

export const DOCKER_DESKTOP_LOGIN_START_CONFIGURATION_OWNER =
  'docker-desktop-settings-ui' as const;

export const DOCKER_DESKTOP_LOGIN_START_OBSERVATION_SOURCE =
  'docker-desktop-documented-settings-store' as const;

export type DockerDesktopLoginStartUnavailableReason =
  | 'operation-input-invalid'
  | 'provider-admission-unavailable'
  | 'platform-unsupported'
  | 'settings-store-unavailable'
  | 'settings-store-invalid'
  | 'auto-start-setting-unavailable';

/**
 * Read-only projection of Docker Desktop's own per-user login-start setting.
 *
 * The admitted Docker Desktop CLI can start the current session but exposes no
 * settings mutation command. Reconciliation therefore remains explicitly
 * owned by Docker Desktop's Settings UI; SEC never edits the settings store or
 * the Windows Run key.
 */
export type DockerDesktopLoginStart =
  | Readonly<{
    schema: typeof DOCKER_DESKTOP_LOGIN_START_SCHEMA;
    status: 'enabled' | 'disabled';
    configurationOwner: typeof DOCKER_DESKTOP_LOGIN_START_CONFIGURATION_OWNER;
    observationSource: typeof DOCKER_DESKTOP_LOGIN_START_OBSERVATION_SOURCE;
    automatedReconciliation: 'unsupported-by-admitted-provider';
    reconciliation: 'satisfied' | 'docker-desktop-settings-ui-required';
    settingsStoreDigest: SecOperationDigest;
  }>
  | Readonly<{
    schema: typeof DOCKER_DESKTOP_LOGIN_START_SCHEMA;
    status: 'unavailable';
    configurationOwner: typeof DOCKER_DESKTOP_LOGIN_START_CONFIGURATION_OWNER;
    observationSource: typeof DOCKER_DESKTOP_LOGIN_START_OBSERVATION_SOURCE;
    automatedReconciliation: 'unsupported-by-admitted-provider';
    reconciliation: 'observation-unavailable';
    reason: DockerDesktopLoginStartUnavailableReason;
    detailDigest: SecOperationDigest;
  }>;

export function assertDockerDesktopLoginStart(value: DockerDesktopLoginStart): void {
  if (value.schema !== DOCKER_DESKTOP_LOGIN_START_SCHEMA
      || value.configurationOwner !== DOCKER_DESKTOP_LOGIN_START_CONFIGURATION_OWNER
      || value.observationSource !== DOCKER_DESKTOP_LOGIN_START_OBSERVATION_SOURCE
      || value.automatedReconciliation !== 'unsupported-by-admitted-provider') {
    throw new Error('Docker Desktop login-start projection identity is invalid.');
  }
  if (value.status === 'enabled' || value.status === 'disabled') {
    if (value.reconciliation !== (value.status === 'enabled'
      ? 'satisfied'
      : 'docker-desktop-settings-ui-required')
        || !/^sha256:[a-f0-9]{64}$/u.test(value.settingsStoreDigest)) {
      throw new Error('Docker Desktop login-start setting projection is invalid.');
    }
    return;
  }
  if (value.status !== 'unavailable'
      || value.reconciliation !== 'observation-unavailable'
      || !/^sha256:[a-f0-9]{64}$/u.test(value.detailDigest)) {
    throw new Error('Docker Desktop login-start unavailable projection is invalid.');
  }
}
