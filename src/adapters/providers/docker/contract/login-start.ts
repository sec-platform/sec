import type { OperationDigest } from '../../../../execution/operation/semantic.ts';

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
    providerIdentityDigest: OperationDigest;
    providerVersionDigest: OperationDigest;
    physicalObservationReceiptDigest: OperationDigest;
    semanticValueDigest: OperationDigest;
  }>
  | Readonly<{
    schema: typeof DOCKER_DESKTOP_LOGIN_START_SCHEMA;
    status: 'unavailable';
    configurationOwner: typeof DOCKER_DESKTOP_LOGIN_START_CONFIGURATION_OWNER;
    observationSource: typeof DOCKER_DESKTOP_LOGIN_START_OBSERVATION_SOURCE;
    automatedReconciliation: 'unsupported-by-admitted-provider';
    reconciliation: 'observation-unavailable';
    reason: DockerDesktopLoginStartUnavailableReason;
    detailDigest: OperationDigest;
  }>;
