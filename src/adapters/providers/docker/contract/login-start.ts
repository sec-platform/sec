import type { SecOperationDigest } from '../../../../execution/operation/semantic.ts';

export const DOCKER_DESKTOP_LOGIN_START_SCHEMA =
  'sec-docker-desktop-login-start-v1' as const;

export const DOCKER_DESKTOP_LOGIN_START_CONFIGURATION_OWNER =
  'docker-desktop-settings-ui' as const;

export const DOCKER_DESKTOP_LOGIN_START_OBSERVATION_SOURCE =
  'docker-desktop-documented-settings-store' as const;

export type DockerDesktopLoginStartUnavailableReason =
  | 'operation-input-invalid'
  | 'platform-unsupported'
  | 'settings-store-unavailable'
  | 'settings-store-invalid'
  | 'settings-schema-unrecognized';

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
    status: 'observed-provider-value';
    value: 'enabled' | 'disabled';
    schemaSupport: 'unsupported';
    configurationOwner: typeof DOCKER_DESKTOP_LOGIN_START_CONFIGURATION_OWNER;
    observationSource: typeof DOCKER_DESKTOP_LOGIN_START_OBSERVATION_SOURCE;
    automatedReconciliation: 'unsupported-by-admitted-provider';
    reconciliation: 'schema-unsupported';
    providerIdentityDigest: SecOperationDigest;
    providerVersionDigest: SecOperationDigest;
    physicalObservationReceiptDigest: SecOperationDigest;
    semanticValueDigest: SecOperationDigest;
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
  if (value.status === 'observed-provider-value') {
    if ((value.value !== 'enabled' && value.value !== 'disabled')
        || value.schemaSupport !== 'unsupported'
        || value.reconciliation !== 'schema-unsupported'
        || !/^sha256:[a-f0-9]{64}$/u.test(value.providerIdentityDigest)
        || !/^sha256:[a-f0-9]{64}$/u.test(value.providerVersionDigest)
        || !/^sha256:[a-f0-9]{64}$/u.test(value.physicalObservationReceiptDigest)
        || !/^sha256:[a-f0-9]{64}$/u.test(value.semanticValueDigest)) {
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
